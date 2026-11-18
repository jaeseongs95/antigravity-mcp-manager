'use strict';

/**
 * Finite State Machine for Remote Control Cross-Origin Frame Adaptation (`antigravity-mcp-manager`).
 *
 * State transitions:
 *   idle -> preflight -> promoting -> ready | passive_attached | rolled_back
 */

const { resolveHostAdapterConfig } = require('./host-adapter-config');
const { acquireRemoteRuntimeLease } = require('./remote-runtime');
const {
  isAllowedMcpScriptUrl,
  getOrCreateTrustedTypesPolicy,
  getScriptNonce,
} = require('./companion-loader');

const FRAME_PROMOTION_STATE = Object.freeze({
  IDLE: 'idle',
  PREFLIGHT: 'preflight',
  PROMOTING: 'promoting',
  READY: 'ready',
  PASSIVE_ATTACHED: 'passive_attached',
  ROLLED_BACK: 'rolled_back',
});

function canAcquirePromotionOwnership(iframe, version) {
  if (!iframe) return false;
  if (
    iframe.__agyMcpPromoted === version ||
    iframe.__agyMcpPromotionFailed ||
    iframe.__agyKoPromoted ||
    iframe.__agyPromoted
  ) {
    return false;
  }
  if (
    iframe.__agyRemotePromotionOwner &&
    iframe.__agyRemotePromotionOwner !== 'mcp-manager' &&
    iframe.__agyRemotePromotionState !== FRAME_PROMOTION_STATE.ROLLED_BACK
  ) {
    return false;
  }
  return true;
}

function hasTraversalSegment(pathname) {
  if (!pathname) return false;
  if (pathname.includes('..') || /(^|\/)%2e%2e(\/|$)/i.test(pathname)) return true;
  try {
    if (decodeURIComponent(pathname).includes('..')) return true;
  } catch {}
  return false;
}

function isNativeTrustedUrlObject(cw, val) {
  if (!val || typeof val !== 'object') return false;
  if (typeof val.href === 'string') return false;
  try {
    if (cw && typeof cw.TrustedScriptURL === 'function' && val instanceof cw.TrustedScriptURL) {
      return true;
    }
  } catch {}
  try {
    return Object.prototype.toString.call(val) === '[object TrustedScriptURL]';
  } catch {
    return false;
  }
}

function resolveRelativeToCdnUrl(rawValue, cdnBaseUrl, hostOrigin) {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  const cleanCdnBase = String(cdnBaseUrl || '').replace(/\/+$/, '');
  if (!cleanCdnBase) return null;
  const cdnRoot = cleanCdnBase.replace(/\/web\/.*$/, '');

  let cdnParsed;
  try {
    cdnParsed = new URL(cleanCdnBase + '/');
  } catch {
    return null;
  }
  const cdnOrigin = cdnParsed.origin;
  let rootUrl;
  try {
    rootUrl = new URL(cdnRoot.endsWith('/') ? cdnRoot : cdnRoot + '/');
  } catch {
    return null;
  }
  const effectiveRootPrefix =
    rootUrl.pathname !== '/'
      ? rootUrl.pathname
      : (/^\/web\//.test(cdnParsed.pathname) ? '/web/' : '/');

  if (/^(?:blob:|data:|javascript:|mailto:|tel:|about:)/i.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (
        parsed.protocol === 'https:' &&
        parsed.origin === cdnOrigin &&
        parsed.pathname.startsWith(effectiveRootPrefix) &&
        !hasTraversalSegment(parsed.pathname)
      ) {
        return parsed.href;
      }
      if (hostOrigin) {
        const hOrig = new URL(String(hostOrigin)).origin;
        if (parsed.origin === hOrig && /^\/web\/[^/]+\//.test(parsed.pathname) && !hasTraversalSegment(parsed.pathname)) {
          return `${cdnRoot}${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
      }
    } catch {}
    return null;
  }
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('?') || trimmed.includes('\\') || /%2e%2e/i.test(trimmed)) {
    return null;
  }
  if (trimmed.startsWith('/web/')) {
    try {
      const candidate = new URL(trimmed.slice(1), rootUrl);
      if (
        candidate.origin !== cdnOrigin ||
        !candidate.pathname.startsWith(rootUrl.pathname) ||
        !/^\/(?:[^/]+\/)*web\/[^/]+\//.test(candidate.pathname) ||
        hasTraversalSegment(candidate.pathname)
      ) {
        return null;
      }
      return candidate.href;
    } catch {
      return null;
    }
  }
  const relInput = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  if (trimmed.startsWith('/') || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    try {
      const candidate = new URL(relInput, cdnParsed);
      if (
        candidate.origin !== cdnOrigin ||
        !candidate.pathname.startsWith(effectiveRootPrefix) ||
        hasTraversalSegment(candidate.pathname)
      ) {
        return null;
      }
      return candidate.href;
    } catch {
      return null;
    }
  }
  return null;
}

function installChildHistoryAdapter(cw, originUrl) {
  if (!cw || !cw.history) return;
  for (const methodName of ['replaceState', 'pushState']) {
    const origFn = cw.history[methodName];
    if (typeof origFn !== 'function' || origFn.__agyHistoryAdapted) continue;
    const adapted = function (state, unused, urlArg) {
      let nextUrl = urlArg;
      if (typeof urlArg === 'string' && urlArg.trim()) {
        try {
          const parsed = new URL(urlArg, originUrl);
          if (parsed.origin === new URL(originUrl).origin) {
            nextUrl = `${parsed.pathname}${parsed.search}${parsed.hash}`;
          }
        } catch {}
      }
      try {
        return origFn.call(this, state, unused, nextUrl);
      } catch {
        try {
          return origFn.call(this, state, unused);
        } catch {
          return undefined;
        }
      }
    };
    adapted.__agyHistoryAdapted = true;
    try {
      cw.history[methodName] = adapted;
    } catch {}
  }
}

function installChildAssetAdapter(cw, cd, nonce, cdnBaseUrl, hostOrigin, resolvedHostCfg, ttPolicyCtrl) {
  if (!cd || typeof cd.createElement !== 'function' || cd.__agyAssetAdapted) return;
  cd.__agyAssetAdapted = true;

  const rewriteAssetUrl = (raw) => resolveRelativeToCdnUrl(String(raw ?? ''), cdnBaseUrl, hostOrigin) || String(raw ?? '');
  const toSafeScriptUrl = (raw) => {
    const mapped = rewriteAssetUrl(raw);
    if (!ttPolicyCtrl) return mapped;
    try {
      return ttPolicyCtrl.toScriptURL(mapped);
    } catch {
      return mapped;
    }
  };

  const wrapProtoUrlProp = (ProtoObj, propName, isScriptProp) => {
    if (!ProtoObj || ProtoObj.__agyPropAdapted) return null;
    const desc = Object.getOwnPropertyDescriptor(ProtoObj, propName);
    if (!desc || typeof desc.set !== 'function' || typeof desc.get !== 'function') return null;
    try {
      Object.defineProperty(ProtoObj, propName, {
        configurable: true,
        enumerable: desc.enumerable,
        get() {
          return desc.get.call(this);
        },
        set(val) {
          if (nonce && (isScriptProp || propName === 'href') && !this.nonce) {
            try {
              this.nonce = nonce;
            } catch {}
          }
          if (isNativeTrustedUrlObject(cw, val)) {
            desc.set.call(this, val);
            return;
          }
          const rawStr = val && typeof val === 'object' && typeof val.href === 'string' ? val.href : val;
          const nextVal = isScriptProp ? toSafeScriptUrl(rawStr) : rewriteAssetUrl(rawStr);
          desc.set.call(this, nextVal);
        },
      });
      Object.defineProperty(ProtoObj, '__agyPropAdapted', {
        value: true,
        configurable: true,
      });
      return desc;
    } catch {
      return desc;
    }
  };

  const scriptSrcDesc = wrapProtoUrlProp(cw?.HTMLScriptElement?.prototype, 'src', true);
  wrapProtoUrlProp(cw?.HTMLImageElement?.prototype, 'src', false);
  wrapProtoUrlProp(cw?.HTMLSourceElement?.prototype, 'src', false);
  wrapProtoUrlProp(cw?.HTMLLinkElement?.prototype, 'href', false);

  if (cw?.Element?.prototype && typeof cw.Element.prototype.setAttribute === 'function' && !cw.Element.prototype.__agySetAttrAdapted) {
    const origElemSetAttr = cw.Element.prototype.setAttribute;
    try {
      cw.Element.prototype.setAttribute = function (name, value) {
        const attrLower = String(name || '').toLowerCase();
        const tagUpper = String(this?.tagName || '').toUpperCase();
        if (attrLower === 'src' && tagUpper === 'SCRIPT') {
          if (nonce) {
            try {
              this.nonce = nonce;
              origElemSetAttr.call(this, 'nonce', nonce);
            } catch {}
          }
          if (isNativeTrustedUrlObject(cw, value)) {
            return origElemSetAttr.call(this, name, value);
          }
          const rawVal = value && typeof value === 'object' && typeof value.href === 'string' ? value.href : value;
          const safeVal = toSafeScriptUrl(rawVal);
          if (scriptSrcDesc && typeof scriptSrcDesc.set === 'function') {
            scriptSrcDesc.set.call(this, safeVal);
            return undefined;
          }
          return origElemSetAttr.call(this, name, safeVal);
        }
        if (attrLower === 'src' && (tagUpper === 'IMG' || tagUpper === 'SOURCE' || tagUpper === 'AUDIO' || tagUpper === 'VIDEO')) {
          const rawImg = value && typeof value === 'object' && typeof value.href === 'string' ? value.href : value;
          return origElemSetAttr.call(this, name, isNativeTrustedUrlObject(cw, value) ? value : rewriteAssetUrl(rawImg));
        }
        if (attrLower === 'href' && tagUpper === 'LINK') {
          if (nonce) {
            try {
              this.nonce = nonce;
              origElemSetAttr.call(this, 'nonce', nonce);
            } catch {}
          }
          const rawLink = value && typeof value === 'object' && typeof value.href === 'string' ? value.href : value;
          return origElemSetAttr.call(this, name, isNativeTrustedUrlObject(cw, value) ? value : rewriteAssetUrl(rawLink));
        }
        return origElemSetAttr.call(this, name, value);
      };
      Object.defineProperty(cw.Element.prototype, '__agySetAttrAdapted', {
        value: true,
        configurable: true,
      });
    } catch {}
  }

  const origCreateEl = cd.createElement.bind(cd);

  function createCdnWorkerBridge(resolvedUrl, workerOptions) {
    let terminated = false;
    let loaded = false;
    const pendingInbound = [];
    const listeners = { message: [], error: [], messageerror: [] };
    let onmessageHandler = null;
    let onerrorHandler = null;
    let onmessageerrorHandler = null;
    const channel = typeof cw.MessageChannel === 'function' ? new cw.MessageChannel() : null;
    const hostPort = channel ? channel.port1 : null;
    const workerPort = channel ? channel.port2 : null;

    const dispatchHostEvent = (type, eventObj) => {
      if (terminated) return;
      const direct =
        type === 'message'
          ? onmessageHandler
          : type === 'error'
            ? onerrorHandler
            : type === 'messageerror'
              ? onmessageerrorHandler
              : null;
      if (typeof direct === 'function') {
        try {
          direct.call(shim, eventObj);
        } catch {}
      }
      const list = (listeners[type] || []).slice();
      for (let i = 0; i < list.length; i++) {
        try {
          const entry = list[i];
          if (typeof entry.fn === 'function') entry.fn.call(shim, eventObj);
          else if (entry.fn && typeof entry.fn.handleEvent === 'function') entry.fn.handleEvent(eventObj);
        } catch {}
        if (list[i].once) {
          const idx = listeners[type].indexOf(list[i]);
          if (idx >= 0) listeners[type].splice(idx, 1);
        }
      }
    };

    const emitHostMessage = (data, ports) => {
      if (terminated) return;
      const deliver = () => {
        if (terminated) return;
        let ev;
        try {
          ev =
            typeof cw.MessageEvent === 'function'
              ? new cw.MessageEvent('message', { data, ports: ports || [] })
              : { type: 'message', data, ports: ports || [] };
        } catch {
          ev = { type: 'message', data, ports: ports || [] };
        }
        dispatchHostEvent('message', ev);
      };
      if (hostPort) {
        deliver();
      } else if (typeof queueMicrotask === 'function') {
        queueMicrotask(deliver);
      } else {
        Promise.resolve().then(deliver);
      }
    };

    const emitHostError = (errInfo) => {
      if (terminated) return;
      const ev = {
        type: 'error',
        message: errInfo?.message || 'Worker script error',
        filename: resolvedUrl,
        error: errInfo?.error || null,
      };
      dispatchHostEvent('error', ev);
    };

    let workerFrame = null;
    let wfw = null;
    let wfd = null;

    const terminateBridge = () => {
      if (terminated) return;
      terminated = true;
      pendingInbound.length = 0;
      if (hostPort) {
        try { hostPort.onmessage = null; hostPort.close(); } catch {}
      }
      if (workerPort) {
        try { workerPort.onmessage = null; workerPort.close(); } catch {}
      }
      if (workerFrame) {
        try {
          if (typeof workerFrame.remove === 'function') workerFrame.remove();
          else if (workerFrame.parentNode) workerFrame.parentNode.removeChild(workerFrame);
        } catch {}
        workerFrame = null;
      }
    };

    const deliverToWorkerScope = (msg, ports) => {
      if (terminated || !wfw) return;
      try {
        const ev =
          typeof wfw.MessageEvent === 'function'
            ? new wfw.MessageEvent('message', { data: msg, ports: ports || [] })
            : { type: 'message', data: msg, ports: ports || [] };
        const prevOnMsg = typeof wfw.onmessage === 'function' ? wfw.onmessage : null;
        let onMsgRan = false;
        let sentinel = null;
        if (prevOnMsg) {
          sentinel = function () {
            onMsgRan = true;
            return prevOnMsg.apply(this, arguments);
          };
          try {
            wfw.onmessage = sentinel;
          } catch {
            sentinel = null;
          }
        }
        try {
          wfw.dispatchEvent?.(ev);
        } finally {
          if (sentinel) {
            try {
              if (wfw.onmessage === sentinel) wfw.onmessage = prevOnMsg;
            } catch {}
          }
        }
        if (prevOnMsg && !onMsgRan) {
          try {
            prevOnMsg.call(wfw, ev);
          } catch {}
        }
      } catch {}
    };

    const flushInboundQueueIfReady = () => {
      if (terminated || !loaded) return;
      const queued = pendingInbound.splice(0, pendingInbound.length);
      for (let i = 0; i < queued.length; i++) {
        const item = queued[i];
        if (hostPort) {
          try {
            if (item.transfer !== undefined) hostPort.postMessage(item.msg, item.transfer);
            else hostPort.postMessage(item.msg);
            continue;
          } catch {}
        }
        deliverToWorkerScope(item.msg);
      }
    };

    if (hostPort && workerPort) {
      hostPort.onmessage = (ev) => {
        emitHostMessage(ev.data, ev.ports);
      };
      workerPort.onmessage = (ev) => {
        deliverToWorkerScope(ev.data, ev.ports);
      };
      try { hostPort.start?.(); } catch {}
      try { workerPort.start?.(); } catch {}
    }

    const shim = {
      postMessage(msg, transfer) {
        if (terminated) return;
        if (!loaded) {
          pendingInbound.push({ msg, transfer });
          return;
        }
        if (hostPort) {
          try {
            if (transfer !== undefined) hostPort.postMessage(msg, transfer);
            else hostPort.postMessage(msg);
            return;
          } catch {}
        }
        deliverToWorkerScope(msg);
      },
      terminate: terminateBridge,
      addEventListener(type, fn, opts) {
        if (!fn || !listeners[type]) return;
        const once = Boolean(opts && (opts === true ? false : opts.once));
        if (!listeners[type].some((item) => item.fn === fn)) {
          listeners[type].push({ fn, once });
        }
      },
      removeEventListener(type, fn) {
        if (!listeners[type]) return;
        listeners[type] = listeners[type].filter((item) => item.fn !== fn);
      },
      dispatchEvent(ev) {
        if (!ev || !ev.type) return true;
        dispatchHostEvent(ev.type, ev);
        return true;
      },
    };
    Object.defineProperties(shim, {
      onmessage: {
        get() { return onmessageHandler; },
        set(fn) { onmessageHandler = typeof fn === 'function' ? fn : null; },
        enumerable: true,
        configurable: true,
      },
      onerror: {
        get() { return onerrorHandler; },
        set(fn) { onerrorHandler = typeof fn === 'function' ? fn : null; },
        enumerable: true,
        configurable: true,
      },
      onmessageerror: {
        get() { return onmessageerrorHandler; },
        set(fn) { onmessageerrorHandler = typeof fn === 'function' ? fn : null; },
        enumerable: true,
        configurable: true,
      },
    });
    try {
      Object.setPrototypeOf(shim, OrigWorker.prototype);
    } catch {}

    const hostParent = cd.body || cd.documentElement;
    if (!hostParent || typeof hostParent.appendChild !== 'function') {
      terminateBridge();
      throw new TypeError('Unable to mount isolated CDN Worker helper frame');
    }
    workerFrame = origCreateEl('iframe');
    workerFrame.src = 'about:blank';
    workerFrame.setAttribute?.('aria-hidden', 'true');
    if (workerFrame.style) {
      workerFrame.style.cssText = 'display:none;width:0;height:0;border:0;position:absolute;left:-9999px;visibility:hidden;';
    }
    hostParent.appendChild(workerFrame);
    wfw = workerFrame.contentWindow;
    wfd = workerFrame.contentDocument;
    if (!wfw || !wfd) {
      terminateBridge();
      throw new TypeError('Failed to initialize isolated CDN Worker helper frame');
    }
    try {
      wfd.open();
      wfd.close();
    } catch {}

    let workerScriptDir = cdnBaseUrl;
    let parsedWorkerUrl = null;
    try {
      parsedWorkerUrl = new URL(resolvedUrl);
      workerScriptDir = new URL('.', resolvedUrl).href.replace(/\/+$/, '');
    } catch {}

    const rewriteWorkerAssetUrl = (rawArg) => {
      const rawStr = String(
        rawArg && typeof rawArg === 'object' && typeof rawArg.href === 'string'
          ? rawArg.href
          : (rawArg ?? '')
      ).trim();
      if (!rawStr) return rawStr;
      if (/^(?:https?:|blob:|data:|about:)/i.test(rawStr) || rawStr.startsWith('//')) {
        return rawStr;
      }
      const relBase = rawStr.startsWith('/') ? cdnBaseUrl : workerScriptDir;
      return resolveRelativeToCdnUrl(rawStr, relBase, hostOrigin) || rawStr;
    };

    const resolveImportUrl = (rawArg) => {
      if (isNativeTrustedUrlObject(cw, rawArg) || isNativeTrustedUrlObject(wfw, rawArg)) {
        const str = String(rawArg).trim();
        if (isAllowedMcpScriptUrl(str, resolvedHostCfg)) return str;
        throw new (wfw.TypeError || TypeError)('Untrusted importScripts URL rejected');
      }
      const rawImport = String(
        rawArg && typeof rawArg === 'object' && typeof rawArg.href === 'string'
          ? rawArg.href
          : (rawArg ?? '')
      ).trim();
      if (!rawImport) {
        throw new (wfw.TypeError || TypeError)('Empty importScripts URL rejected');
      }
      const candidate = resolveRelativeToCdnUrl(rawImport, workerScriptDir, hostOrigin) || rawImport;
      if (!isAllowedMcpScriptUrl(candidate, resolvedHostCfg)) {
        throw new (wfw.TypeError || TypeError)(`Untrusted importScripts URL rejected: ${rawImport}`);
      }
      return candidate;
    };

    const origXhrProto = wfw.XMLHttpRequest && wfw.XMLHttpRequest.prototype;
    const origXhrOpen = origXhrProto && typeof origXhrProto.open === 'function' ? origXhrProto.open : null;
    if (origXhrOpen) {
      try {
        origXhrProto.open = function (method, url, ...rest) {
          const rewrittenUrl =
            typeof url === 'string' || (url && typeof url.href === 'string')
              ? rewriteWorkerAssetUrl(url)
              : url;
          return origXhrOpen.call(this, method, rewrittenUrl, ...rest);
        };
      } catch {}
    }

    if (typeof wfw.fetch === 'function') {
      try {
        const origWfwFetch = wfw.fetch.bind(wfw);
        wfw.fetch = (input, init) => {
          if (
            typeof input === 'string' ||
            (input && typeof input.href === 'string' && !(wfw.Request && input instanceof wfw.Request))
          ) {
            return origWfwFetch(rewriteWorkerAssetUrl(input), init);
          }
          return origWfwFetch(input, init);
        };
      } catch {}
    }

    if (typeof wfw.Request === 'function' && typeof (wfw.Proxy || Proxy) === 'function') {
      try {
        const OrigWfwRequest = wfw.Request;
        const ProxyCtor = wfw.Proxy || Proxy;
        wfw.Request = new ProxyCtor(OrigWfwRequest, {
          construct(Target, args, newTarget) {
            if (
              args.length > 0 &&
              (typeof args[0] === 'string' ||
                (args[0] && typeof args[0].href === 'string' && !(args[0] instanceof Target)))
            ) {
              const nextArgs = args.slice();
              nextArgs[0] = rewriteWorkerAssetUrl(args[0]);
              return Reflect.construct(Target, nextArgs, newTarget);
            }
            return Reflect.construct(Target, args, newTarget);
          },
        });
      } catch {}
    }

    let importSyncSeq = 0;
    const loadImportedScriptSync = (safeImportUrl) => {
      const targetEl = wfd.head || wfd.body || wfd.documentElement;
      if (!targetEl) throw new (wfw.Error || Error)('Worker helper document unavailable');
      if (typeof wfw.XMLHttpRequest !== 'function') {
        throw new (wfw.Error || Error)('importScripts requires synchronous XMLHttpRequest');
      }
      const xhr = new wfw.XMLHttpRequest();
      if (origXhrOpen) origXhrOpen.call(xhr, 'GET', safeImportUrl, false);
      else xhr.open('GET', safeImportUrl, false);
      xhr.send(null);
      if (xhr.status < 200 || xhr.status >= 300) {
        throw new (wfw.Error || Error)(`Failed to importScripts (${xhr.status}): ${safeImportUrl}`);
      }
      const code = String(xhr.responseText || '');
      const execFlag = `__agyImpSync_${++importSyncSeq}`;
      const markedCode = `${code}\n;try{self[${JSON.stringify(execFlag)}]=1;}catch{}`;
      const depEl = wfd.createElement('script');
      if (nonce) {
        depEl.nonce = nonce;
        depEl.setAttribute?.('nonce', nonce);
      }

      let executedSync = false;
      let syncRuntimeErr = null;
      const onSyncErr = (ev) => {
        syncRuntimeErr = ev?.error || new (wfw.Error || Error)(ev?.message || 'importScripts execution error');
      };
      wfw.addEventListener?.('error', onSyncErr);
      try {
        try { delete wfw[execFlag]; } catch {}
        if (ttPolicyCtrl) {
          ttPolicyCtrl.allowInline(markedCode);
          depEl.text = ttPolicyCtrl.toScript(markedCode);
          try {
            targetEl.appendChild(depEl);
          } finally {
            ttPolicyCtrl.revokeInline(markedCode);
          }
        } else {
          depEl.text = markedCode;
          targetEl.appendChild(depEl);
        }
        executedSync = wfw[execFlag] === 1;
      } finally {
        wfw.removeEventListener?.('error', onSyncErr);
        try { delete wfw[execFlag]; } catch {}
      }

      if (syncRuntimeErr) {
        throw syncRuntimeErr;
      }

      if (!executedSync && typeof wfw.eval === 'function') {
        try {
          if (ttPolicyCtrl) {
            ttPolicyCtrl.allowInline(markedCode);
            try {
              (0, wfw.eval)(ttPolicyCtrl.toScript(markedCode));
            } finally {
              ttPolicyCtrl.revokeInline(markedCode);
            }
          } else {
            (0, wfw.eval)(markedCode);
          }
          executedSync = wfw[execFlag] === 1;
        } finally {
          try { delete wfw[execFlag]; } catch {}
        }
      }

      if (!executedSync) {
        throw new (wfw.Error || Error)(`importScripts blocked from synchronous execution: ${safeImportUrl}`);
      }
    };

    const workerLocationObj = parsedWorkerUrl
      ? Object.freeze({
          href: parsedWorkerUrl.href,
          origin: parsedWorkerUrl.origin,
          protocol: parsedWorkerUrl.protocol,
          host: parsedWorkerUrl.host,
          hostname: parsedWorkerUrl.hostname,
          port: parsedWorkerUrl.port,
          pathname: parsedWorkerUrl.pathname,
          search: parsedWorkerUrl.search,
          hash: parsedWorkerUrl.hash,
          toString() {
            return parsedWorkerUrl.href;
          },
          valueOf() {
            return parsedWorkerUrl.href;
          },
        })
      : wfw.location;

    const WINDOW_RECEIVER_METHODS = new Set([
      'addEventListener',
      'removeEventListener',
      'dispatchEvent',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'atob',
      'btoa',
      'createImageBitmap',
      'structuredClone',
      'reportError',
      'getComputedStyle',
      'matchMedia',
    ]);

    let workerSelfProxy = wfw;
    if (typeof (wfw.Proxy || Proxy) === 'function') {
      const ProxyCtor = wfw.Proxy || Proxy;
      const boundMethodCache = new WeakMap();
      workerSelfProxy = new ProxyCtor(wfw, {
        get(target, prop) {
          if (prop === 'location') return workerLocationObj;
          if (prop === 'self') return workerSelfProxy;
          const val = Reflect.get(target, prop, target);
          if (typeof val === 'function' && WINDOW_RECEIVER_METHODS.has(prop)) {
            let bound = boundMethodCache.get(val);
            if (!bound) {
              bound = val.bind(target);
              boundMethodCache.set(val, bound);
            }
            return bound;
          }
          return val;
        },
        set(target, prop, value) {
          if (prop === 'location') return true;
          return Reflect.set(target, prop, value, target);
        },
        has(target, prop) {
          return prop === 'location' || prop === 'self' || Reflect.has(target, prop);
        },
      });
    }

    try {
      Object.defineProperty(wfw, 'self', {
        value: workerSelfProxy,
        configurable: true,
        writable: true,
        enumerable: true,
      });
      Object.defineProperty(wfw, 'postMessage', {
        value: (msg, transfer) => {
          if (terminated) return;
          if (workerPort) {
            try {
              if (transfer !== undefined) workerPort.postMessage(msg, transfer);
              else workerPort.postMessage(msg);
              return;
            } catch {}
          }
          emitHostMessage(msg);
        },
        configurable: true,
        writable: true,
      });
      Object.defineProperty(wfw, 'close', {
        value: terminateBridge,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(wfw, 'importScripts', {
        value: (...urls) => {
          if (terminated) return;
          if (workerOptions && workerOptions.type === 'module') {
            throw new (wfw.TypeError || TypeError)("Module scripts don't support importScripts().");
          }
          const resolvedUrls = [];
          for (let i = 0; i < urls.length; i++) {
            resolvedUrls.push(resolveImportUrl(urls[i]));
          }
          for (let i = 0; i < resolvedUrls.length; i++) {
            loadImportedScriptSync(resolvedUrls[i]);
          }
        },
        configurable: true,
        writable: true,
      });
      if (workerOptions && workerOptions.name !== undefined) {
        wfw.name = String(workerOptions.name);
      }
    } catch {}

    wfw.addEventListener?.('error', (ev) => {
      if (terminated) return;
      emitHostError({
        message: ev?.message || 'Worker script error',
        error: ev?.error || null,
      });
    });

    const sc = wfd.createElement('script');
    if (nonce) {
      sc.nonce = nonce;
      sc.setAttribute?.('nonce', nonce);
    }
    if (workerOptions && workerOptions.type === 'module') {
      sc.type = 'module';
    }
    sc.src = ttPolicyCtrl ? ttPolicyCtrl.toScriptURL(resolvedUrl) : resolvedUrl;
    sc.addEventListener?.('load', () => {
      if (terminated) return;
      loaded = true;
      flushInboundQueueIfReady();
    }, { once: true });
    sc.addEventListener?.('error', (ev) => {
      emitHostError(ev);
    }, { once: true });
    const frameTarget = wfd.head || wfd.body || wfd.documentElement;
    frameTarget.appendChild(sc);

    return shim;
  }

  if (cw && typeof cw.Worker === 'function' && !cw.Worker.__agyWorkerAdapted) {
    const OrigWorker = cw.Worker;
    const AdaptedWorker = function (scriptURL, options) {
      const isTrustedUrlObj = isNativeTrustedUrlObject(cw, scriptURL);
      const rawStr = String(
        scriptURL && typeof scriptURL === 'object' && typeof scriptURL.href === 'string'
          ? scriptURL.href
          : (scriptURL ?? '')
      ).trim();
      if (rawStr.startsWith('blob:')) {
        if (hostOrigin && !rawStr.startsWith(`blob:${hostOrigin}/`)) {
          throw new TypeError('Cross-origin blob Worker URL rejected');
        }
        let safeBlob = scriptURL;
        if (!isTrustedUrlObj && ttPolicyCtrl) {
          ttPolicyCtrl.allowBlob(rawStr);
          safeBlob = ttPolicyCtrl.toScriptURL(rawStr);
        }
        return options !== undefined ? new OrigWorker(safeBlob, options) : new OrigWorker(safeBlob);
      }
      const resolvedUrl = resolveRelativeToCdnUrl(rawStr, cdnBaseUrl, hostOrigin) || rawStr;
      if (!isAllowedMcpScriptUrl(resolvedUrl, resolvedHostCfg)) {
        throw new TypeError('Untrusted Worker script URL rejected');
      }
      let sameOriginWithPage = false;
      try {
        const pageOrigin =
          cw.location && cw.location.origin && cw.location.origin !== 'null'
            ? cw.location.origin
            : (hostOrigin ? new URL(String(hostOrigin)).origin : '');
        sameOriginWithPage = Boolean(pageOrigin && new URL(resolvedUrl).origin === pageOrigin);
      } catch {}
      if (sameOriginWithPage) {
        const safeDirect = isTrustedUrlObj ? scriptURL : (ttPolicyCtrl ? ttPolicyCtrl.toScriptURL(resolvedUrl) : resolvedUrl);
        return options !== undefined ? new OrigWorker(safeDirect, options) : new OrigWorker(safeDirect);
      }
      return createCdnWorkerBridge(resolvedUrl, options);
    };
    AdaptedWorker.prototype = OrigWorker.prototype;
    try {
      Object.setPrototypeOf(AdaptedWorker, OrigWorker);
    } catch {}
    AdaptedWorker.__agyWorkerAdapted = true;
    try {
      cw.Worker = AdaptedWorker;
    } catch {}
  }

  cd.createElement = function (tagName, options) {
    const el = options !== undefined ? origCreateEl(tagName, options) : origCreateEl(tagName);
    const lower = String(tagName || '').toLowerCase();
    if (el && nonce && (lower === 'script' || lower === 'style' || lower === 'link')) {
      try {
        el.nonce = nonce;
        el.setAttribute?.('nonce', nonce);
      } catch {}
    }
    const isNativeElem = Boolean(cw?.Element && el instanceof cw.Element);
    if (el && !isNativeElem) {
      if (typeof el.setAttribute === 'function' && !el.__agySyntheticSetAttrAdapted) {
        const origElSetAttr = el.setAttribute.bind(el);
        el.setAttribute = function (name, val) {
          const attrL = String(name || '').toLowerCase();
          if (attrL === 'src' && lower === 'script') {
            if (nonce) origElSetAttr('nonce', nonce);
            const safeVal = val && typeof val === 'object' ? val : toSafeScriptUrl(val);
            el.src = safeVal;
            return origElSetAttr(name, safeVal);
          }
          if (attrL === 'src' && (lower === 'img' || lower === 'source' || lower === 'audio' || lower === 'video')) {
            const mapped = val && typeof val === 'object' ? val : rewriteAssetUrl(val);
            el.src = mapped;
            return origElSetAttr(name, mapped);
          }
          if (attrL === 'href' && lower === 'link') {
            if (nonce) origElSetAttr('nonce', nonce);
            const mapped = val && typeof val === 'object' ? val : rewriteAssetUrl(val);
            el.href = mapped;
            return origElSetAttr(name, mapped);
          }
          return origElSetAttr(name, val);
        };
        el.__agySyntheticSetAttrAdapted = true;
      }
      if (lower === 'script' || lower === 'img' || lower === 'source' || lower === 'link') {
        const prop = lower === 'link' ? 'href' : 'src';
        let innerVal = el[prop] || '';
        try {
          Object.defineProperty(el, prop, {
            configurable: true,
            enumerable: true,
            get() {
              return innerVal;
            },
            set(val) {
              if (isNativeTrustedUrlObject(cw, val)) {
                innerVal = val;
                return;
              }
              const rawInner = val && typeof val === 'object' && typeof val.href === 'string' ? val.href : val;
              innerVal = lower === 'script' ? toSafeScriptUrl(rawInner) : rewriteAssetUrl(rawInner);
            },
          });
        } catch {}
      }
    }
    return el;
  };
}

function promoteCrossOriginRemoteIframe(win, doc, iframe, bridge, onReady, version = 'v1.5.0') {
  if (!win || !doc || !iframe) return false;
  if (!canAcquirePromotionOwnership(iframe, version)) {
    if (iframe.__agyKoPromoted || iframe.__agyPromoted) {
      iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.PASSIVE_ATTACHED;
    }
    return false;
  }

  const rcInst =
    (bridge && typeof bridge.resolveRemoteControlInstance === 'function'
      ? bridge.resolveRemoteControlInstance(win)
      : null) ||
    win.__agyRemoteControlInstance ||
    null;
  if (!rcInst) return false;

  const rawCandidate =
    iframe.getAttribute?.('src') ||
    iframe.src ||
    (typeof rcInst.iframeSrc === 'function' ? String(rcInst.iframeSrc() || '') : '') ||
    '';
  const rawSrc = String(rawCandidate).match(/https?:\/\/[^\s"'<>)+]+/)?.[0] || String(rawCandidate);
  if (!rawSrc) return false;

  let parsedUrl;
  try {
    parsedUrl = new URL(rawSrc, win.location?.href || 'https://antigravity.google.com');
  } catch {
    return false;
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    return false;
  }
  if (parsedUrl.searchParams.get('iframe') !== 'true') {
    return false;
  }

  const resolvedHostCfg = resolveHostAdapterConfig(bridge?.hostConfig, win);
  const trustedStaticHosts = new Set();
  for (const staticOrig of resolvedHostCfg.staticCdnOrigins || []) {
    try {
      const su = new URL(String(staticOrig));
      if (su.protocol === 'https:') {
        trustedStaticHosts.add(su.hostname.toLowerCase());
      }
    } catch {}
  }
  const candidateHost = parsedUrl.hostname.toLowerCase();
  if (!trustedStaticHosts.has(candidateHost) && !resolvedHostCfg.isRemoteHost(candidateHost)) {
    return false;
  }

  const basePath = parsedUrl.pathname.replace(/^\/antigravity/, '').replace(/\/+$/, '');
  if (basePath.includes('..') || /["'<>\\\s]/.test(basePath)) {
    return false;
  }
  const verMatch = basePath.match(/\/web\/([^/]+)/);
  const appVersion = verMatch ? verMatch[1] : '2.33.0';
  const cdnOrigin = String(resolvedHostCfg.cdnOrigin || 'https://www.gstatic.com/antigravity').replace(/\/+$/, '');
  const cdnBaseUrl = `${cdnOrigin}${basePath}`;

  iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.PREFLIGHT;
  const ttPolicyCtrl = getOrCreateTrustedTypesPolicy(win, resolvedHostCfg);
  const prismUrl = `${cdnBaseUrl}/prism_bundle.js`;
  const mainUrl = `${cdnBaseUrl}/main.js`;
  let trustedPrismUrl = prismUrl;
  let trustedMainUrl = mainUrl;
  try {
    trustedPrismUrl = ttPolicyCtrl ? ttPolicyCtrl.toScriptURL(prismUrl) : prismUrl;
    trustedMainUrl = ttPolicyCtrl ? ttPolicyCtrl.toScriptURL(mainUrl) : mainUrl;
    const probeScript = doc.createElement?.('script');
    if (probeScript) {
      probeScript.src = trustedMainUrl;
    }
  } catch {
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.IDLE;
    return false;
  }

  iframe.__agyRemotePromotionOwner = 'mcp-manager';
  iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.PROMOTING;
  iframe.__agyMcpPromoted = version;

  const savedChildPath = String(
    new URLSearchParams(win.location?.search || '').get('p') ||
      rcInst.lastSyncedChildPath ||
      rcInst.initialChildPath ||
      ''
  ).replace(/^\/+/, '');
  if (savedChildPath) {
    rcInst.initialChildPath = savedChildPath;
  }

  const buildInitialIframeHistoryUrl = () => {
    const baseQuery = parsedUrl.search ? parsedUrl.search.replace(/^\?/, '') : 'iframe=true';
    if (!savedChildPath) return `${basePath}/?${baseQuery}`;
    const qIdx = savedChildPath.indexOf('?');
    const subPath = qIdx >= 0 ? savedChildPath.slice(0, qIdx) : savedChildPath;
    const subQuery = qIdx >= 0 ? savedChildPath.slice(qIdx + 1) : '';
    const cleanSubPath = subPath.replace(/^\/+/, '');
    const fullPath = cleanSubPath ? `${basePath}/${cleanSubPath}` : `${basePath}/`;
    return subQuery ? `${fullPath}?${subQuery}&${baseQuery}` : `${fullPath}?${baseQuery}`;
  };

  const IframeCtor = win?.HTMLIFrameElement || (typeof HTMLIFrameElement !== 'undefined' ? HTMLIFrameElement : null);
  const origSrcDesc =
    IframeCtor && iframe instanceof IframeCtor && IframeCtor.prototype
      ? Object.getOwnPropertyDescriptor(IframeCtor.prototype, 'src')
      : null;
  const hostOrigin = win.location?.origin || 'https://antigravity.google.com';
  const canonicalFrameUrl = `${hostOrigin}${basePath}/${parsedUrl.search || '?iframe=true'}`;

  const ownsRuntimeLease = !(bridge && bridge.runtimeLease && typeof bridge.runtimeLease.tapTarget === 'function');
  const activeLease = ownsRuntimeLease
    ? acquireRemoteRuntimeLease({ hostConfig: resolvedHostCfg, defaultWin: win })
    : bridge.runtimeLease;
  activeLease.tapTarget(win, rcInst);

  rcInst.__agySuppressAutoIframeLoadCount = (rcInst.__agySuppressAutoIframeLoadCount || 0) + 1;
  rcInst.__agySuppressAutoIframeLoad = true;
  let suppressionActiveForToken = true;
  let leaseReleasedForToken = false;

  let childWindowRef = null;
  let hadOwnChildDec = false;
  let prevChildDec = undefined;
  let wrappedChildDec = null;
  let capturedLsByThisPromotion = null;

  const endSuppressionForThisPromotion = () => {
    if (!suppressionActiveForToken) return;
    suppressionActiveForToken = false;
    const nextCount = Math.max(0, (rcInst.__agySuppressAutoIframeLoadCount || 1) - 1);
    if (nextCount === 0) {
      delete rcInst.__agySuppressAutoIframeLoadCount;
      rcInst.__agySuppressAutoIframeLoad = false;
    } else {
      rcInst.__agySuppressAutoIframeLoadCount = nextCount;
      rcInst.__agySuppressAutoIframeLoad = true;
    }
  };

  const releaseRcHooks = () => {
    try {
      endSuppressionForThisPromotion();
      if (!(rcInst.__agySuppressAutoIframeLoadCount > 0) && rcInst.__agySuppressAutoIframeLoad === false) {
        delete rcInst.__agySuppressAutoIframeLoad;
      }
      if (ownsRuntimeLease && !leaseReleasedForToken) {
        leaseReleasedForToken = true;
        activeLease.release();
      }
    } catch {}
  };

  let rolledBack = false;
  let fallbackTimer = null;
  const clearFallbackTimer = () => {
    if (!fallbackTimer) return;
    const clr = typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
    try { clr(fallbackTimer); } catch {}
    fallbackTimer = null;
  };

  const rollbackToOriginalSrc = () => {
    if (rolledBack) return;
    rolledBack = true;
    clearFallbackTimer();
    releaseRcHooks();
    try {
      if (typeof iframe.removeEventListener === 'function') {
        iframe.removeEventListener('load', triggerBlankLoadOnce);
      }
    } catch {}
    try {
      delete iframe.src;
    } catch {}
    delete iframe.__agyMcpPromoted;
    delete iframe.__agyMcpRestorePromotion;
    if (iframe.__agyRemotePromotionOwner === 'mcp-manager') {
      delete iframe.__agyRemotePromotionOwner;
    }
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
    iframe.__agyMcpPromotionFailed = true;
    try {
      if (origSrcDesc && typeof origSrcDesc.set === 'function') {
        origSrcDesc.set.call(iframe, rawSrc);
      } else {
        iframe.setAttribute?.('src', rawSrc);
        iframe.src = rawSrc;
      }
    } catch {
      try {
        iframe.setAttribute?.('src', rawSrc);
        iframe.src = rawSrc;
      } catch {}
    }
  };

  let readyNotified = false;
  const notifyReadyOnce = () => {
    if (readyNotified) return;
    readyNotified = true;
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.READY;
    if (typeof onReady === 'function') onReady();
  };

  const onBlankLoad = () => {
    try {
      const cw = iframe.contentWindow;
      const cd = iframe.contentDocument || cw?.document;
      if (!cw || !cd) {
        rollbackToOriginalSrc();
        return;
      }
      childWindowRef = cw;

      // WHATWG HTML §8.4 zero-argument Document.open/close promotes child URL from about:blank
      // to parent https:// origin URL without invoking any TrustedHTML sink (zero cd.write calls).
      if (typeof cd.open === 'function' && typeof cd.close === 'function') {
        try {
          cd.open();
          cd.close();
        } catch {}
      }

      const nonce = getScriptNonce(doc);
      const clearChildren = (parent) => {
        if (!parent) return;
        while (parent.firstChild && typeof parent.removeChild === 'function') {
          parent.removeChild(parent.firstChild);
        }
      };
      if (cd.documentElement && typeof cd.documentElement.setAttribute === 'function') {
        cd.documentElement.setAttribute('lang', 'en');
      }
      const rawTheme = parsedUrl.searchParams.get('hostTheme');
      const resolvedTheme =
        rawTheme === 'dark' || rawTheme === 'light'
          ? rawTheme
          : win.matchMedia?.('(prefers-color-scheme: dark)')?.matches
          ? 'dark'
          : 'light';
      if (cd.documentElement?.style) {
        cd.documentElement.style.colorScheme = resolvedTheme;
      }
      let headEl = cd.head;
      if (!headEl && typeof cd.createElement === 'function') {
        headEl = cd.createElement('head');
        cd.documentElement?.appendChild?.(headEl);
      }
      let bodyEl = cd.body;
      if (!bodyEl && typeof cd.createElement === 'function') {
        bodyEl = cd.createElement('body');
        cd.documentElement?.appendChild?.(bodyEl);
      }
      clearChildren(headEl);
      clearChildren(bodyEl);

      installChildHistoryAdapter(cw, canonicalFrameUrl);
      installChildAssetAdapter(cw, cd, nonce, cdnBaseUrl, hostOrigin, resolvedHostCfg, ttPolicyCtrl);

      if (headEl && typeof headEl.appendChild === 'function' && typeof cd.createElement === 'function') {
        const metaCharset = cd.createElement('meta');
        metaCharset.setAttribute?.('charset', 'UTF-8');
        headEl.appendChild(metaCharset);

        const metaViewport = cd.createElement('meta');
        metaViewport.setAttribute?.('name', 'viewport');
        metaViewport.setAttribute?.(
          'content',
          'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover'
        );
        headEl.appendChild(metaViewport);

        for (const cssFile of ['jetbox.css', 'compiled_tailwind.css']) {
          const linkEl = cd.createElement('link');
          linkEl.setAttribute?.('rel', 'stylesheet');
          const href = `${cdnBaseUrl}/${cssFile}`;
          linkEl.setAttribute?.('href', href);
          linkEl.href = href;
          if (nonce) {
            linkEl.nonce = nonce;
            linkEl.setAttribute?.('nonce', nonce);
          }
          headEl.appendChild(linkEl);
        }

        const styleShell = cd.createElement('style');
        if (nonce) {
          styleShell.nonce = nonce;
          styleShell.setAttribute?.('nonce', nonce);
        }
        styleShell.textContent =
          'html,body,#root{height:100%;height:100dvh;max-height:100dvh;margin:0;overflow:hidden;background-color:transparent;overscroll-behavior:none;-webkit-text-size-adjust:100%;}';
        headEl.appendChild(styleShell);
      }

      if (bodyEl && typeof bodyEl.appendChild === 'function' && typeof cd.createElement === 'function') {
        const rootDiv = cd.createElement('div');
        rootDiv.id = 'root';
        rootDiv.setAttribute?.('id', 'root');
        bodyEl.appendChild(rootDiv);
      }

      try {
        hadOwnChildDec = Object.prototype.hasOwnProperty.call(cw, '__JETSKI_LS_CLIENT_DECORATOR__');
        prevChildDec = cw.__JETSKI_LS_CLIENT_DECORATOR__;
        wrappedChildDec = function (client) {
          const decorated = typeof prevChildDec === 'function' ? prevChildDec(client) || client : client;
          if (decorated && typeof decorated === 'object') {
            capturedLsByThisPromotion = decorated;
            cw.__agyCapturedLsClient = decorated;
            win.__agyCapturedLsClient = decorated;
          }
          return decorated;
        };
        cw.__JETSKI_LS_CLIENT_DECORATOR__ = wrappedChildDec;
      } catch {}

      try {
        cw.history?.replaceState?.(null, '', buildInitialIframeHistoryUrl());
      } catch {}
      try {
        Object.defineProperty(cd, 'referrer', {
          configurable: true,
          get: () => win.location?.href || '',
        });
      } catch {}

      cw.__APP_CONFIG__ = {
        productName: 'antigravity',
        csrfToken: String(win?.__APP_CONFIG__?.csrfToken || rcInst?.csrfToken || resolvedHostCfg.remoteCsrfToken || ''),
        appVersion,
        isRemoteControl: true,
      };
      const ua = cw.navigator?.userAgent || '';
      const platform =
        ua.indexOf('Windows') >= 0
          ? 'win32'
          : ua.indexOf('Macintosh') >= 0 || ua.indexOf('Mac OS') >= 0
          ? 'darwin'
          : 'linux';
      cw.process = cw.process || {
        env: { NODE_ENV: 'production' },
        platform,
        nextTick: (cb) => Promise.resolve().then(cb),
      };
      if (cw.AudioWorklet && cw.AudioWorklet.prototype) {
        cw.AudioWorklet.prototype.addModule = () => Promise.resolve();
      }
      if (cw.customElements && !cw.customElements.__agyGuarded) {
        const origDef = cw.customElements.define.bind(cw.customElements);
        cw.customElements.define = (name, ctor, opts) => {
          if (!cw.customElements.get(name)) origDef(name, ctor, opts);
        };
        cw.customElements.__agyGuarded = true;
      }

      const msgListeners = new Set();
      try {
        if (typeof cw.addEventListener === 'function' && !cw.__agyMsgBufferInstalled) {
          cw.__agyMsgBufferInstalled = true;
          const origAddEv = cw.addEventListener.bind(cw);
          const origRemoveEv = typeof cw.removeEventListener === 'function' ? cw.removeEventListener.bind(cw) : null;
          origAddEv('message', (ev) => {
            if (ev && ev.data && ev.data.type === 'INITIAL_CONFIG') {
              cw.__agyBufferedInitialConfigEvent = ev;
              if (msgListeners.size > 0) {
                cw.__initialConfigReceived = true;
              }
            }
          });
          cw.addEventListener = function (type, listener, options) {
            if (type === 'message' && typeof listener === 'function') {
              msgListeners.add(listener);
              const res = origAddEv(type, listener, options);
              if (cw.__agyBufferedInitialConfigEvent && !cw.__initialConfigReceived) {
                const bufferedEv = cw.__agyBufferedInitialConfigEvent;
                cw.__initialConfigReceived = true;
                Promise.resolve().then(() => {
                  try {
                    listener.call(cw, bufferedEv);
                  } catch {}
                });
              }
              return res;
            }
            return origAddEv(type, listener, options);
          };
          if (origRemoveEv) {
            cw.removeEventListener = function (type, listener, options) {
              if (type === 'message' && typeof listener === 'function') {
                msgListeners.delete(listener);
              }
              return origRemoveEv(type, listener, options);
            };
          }
        }
      } catch {}

      const prismScript = cd.createElement('script');
      if (nonce) {
        prismScript.nonce = nonce;
        prismScript.setAttribute?.('nonce', nonce);
      }
      prismScript.async = false;
      prismScript.src = trustedPrismUrl;

      const mainScript = cd.createElement('script');
      if (nonce) {
        mainScript.nonce = nonce;
        mainScript.setAttribute?.('nonce', nonce);
      }
      mainScript.async = false;
      mainScript.src = trustedMainUrl;

      const markPromotedReady = () => {
        try {
          if (typeof rcInst.markIframeReady === 'function') {
            rcInst.markIframeReady();
          } else {
            rcInst.iframeLoading?.set?.(false);
            rcInst.iframeUiReady?.set?.(true);
          }
        } catch {}
        notifyReadyOnce();
      };

      mainScript.onload = () => {
        endSuppressionForThisPromotion();
        cw.__agyMainBooted = true;
        if (savedChildPath) rcInst.initialChildPath = savedChildPath;
        let loadRet = null;
        if (!cw.__initialConfigReceived && !cw.__agyOnIframeLoadCalled) {
          cw.__agyOnIframeLoadCalled = true;
          try {
            loadRet = activeLease.invokeOriginalOnIframeLoad(rcInst);
          } catch {}
        }
        if (loadRet && typeof loadRet.then === 'function') {
          loadRet.then(markPromotedReady, markPromotedReady);
        } else {
          markPromotedReady();
        }
      };
      mainScript.onerror = () => {
        rollbackToOriginalSrc();
      };

      if (headEl && typeof headEl.appendChild === 'function') {
        headEl.appendChild(prismScript);
        headEl.appendChild(mainScript);
      } else {
        rollbackToOriginalSrc();
      }
    } catch {
      rollbackToOriginalSrc();
    }
  };

  try {
    delete iframe.src;
  } catch {}
  let blankLoadHandled = false;
  const triggerBlankLoadOnce = () => {
    if (blankLoadHandled || rolledBack) return;
    try {
      const cd = iframe.contentDocument || iframe.contentWindow?.document;
      const cw = iframe.contentWindow;
      if (!cd || !cw) return;
      blankLoadHandled = true;
    } catch {
      return;
    }
    try {
      if (typeof iframe.removeEventListener === 'function') {
        iframe.removeEventListener('load', triggerBlankLoadOnce);
      }
    } catch {}
    clearFallbackTimer();
    onBlankLoad();
  };
  if (typeof iframe.addEventListener === 'function') {
    iframe.addEventListener('load', triggerBlankLoadOnce);
  }
  try {
    if (origSrcDesc && typeof origSrcDesc.set === 'function') {
      origSrcDesc.set.call(iframe, 'about:blank');
    } else {
      iframe.setAttribute?.('src', 'about:blank');
      iframe.src = 'about:blank';
    }
  } catch {
    releaseRcHooks();
    delete iframe.__agyMcpPromoted;
    if (iframe.__agyRemotePromotionOwner === 'mcp-manager') {
      delete iframe.__agyRemotePromotionOwner;
    }
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.IDLE;
    return false;
  }
  const cleanupPromotedIframeState = () => {
    clearFallbackTimer();
    releaseRcHooks();
    try {
      let targetCw = childWindowRef;
      if (!targetCw) {
        try {
          targetCw = iframe.contentWindow;
        } catch {}
      }
      if (targetCw) {
        if (wrappedChildDec && targetCw.__JETSKI_LS_CLIENT_DECORATOR__ === wrappedChildDec) {
          if (hadOwnChildDec) targetCw.__JETSKI_LS_CLIENT_DECORATOR__ = prevChildDec;
          else delete targetCw.__JETSKI_LS_CLIENT_DECORATOR__;
        }
        delete targetCw.__agyCapturedLsClient;
      }
      if (capturedLsByThisPromotion && win.__agyCapturedLsClient === capturedLsByThisPromotion && !win.agyStatusBar) {
        delete win.__agyCapturedLsClient;
      }
    } catch {}
    try {
      if (typeof iframe.removeEventListener === 'function') {
        iframe.removeEventListener('load', triggerBlankLoadOnce);
      }
    } catch {}
    try {
      delete iframe.src;
    } catch {}
    if (iframe.__agyRemotePromotionOwner === 'mcp-manager') {
      delete iframe.__agyRemotePromotionOwner;
    }
    delete iframe.__agyRemotePromotionState;
    delete iframe.__agyMcpPromoted;
    delete iframe.__agyMcpPromotionFailed;
    delete iframe.__agyMcpRestorePromotion;
  };

  try {
    Object.defineProperty(iframe, 'src', {
      configurable: true,
      enumerable: true,
      get: () => canonicalFrameUrl,
      set: (v) => {
        rolledBack = true;
        cleanupPromotedIframeState();
        if (origSrcDesc && typeof origSrcDesc.set === 'function') {
          origSrcDesc.set.call(iframe, v);
        } else {
          iframe.setAttribute?.('src', v);
          iframe.src = v;
        }
      },
    });
  } catch {}

  iframe.__agyMcpRestorePromotion = cleanupPromotedIframeState;

  const setTimer = typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : (typeof setTimeout === 'function' ? setTimeout : null);
  const isNativeDomIframe = Boolean(win.HTMLIFrameElement && iframe instanceof win.HTMLIFrameElement);
  if (setTimer) {
    fallbackTimer = setTimer(triggerBlankLoadOnce, isNativeDomIframe ? 120 : 20);
    if (fallbackTimer && typeof fallbackTimer.unref === 'function') {
      fallbackTimer.unref();
    }
  } else {
    triggerBlankLoadOnce();
  }
  return true;
}

module.exports = {
  FRAME_PROMOTION_STATE,
  canAcquirePromotionOwnership,
  resolveRelativeToCdnUrl,
  promoteCrossOriginRemoteIframe,
};
