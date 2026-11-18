'use strict';

/**
 * Cross-Origin CDN Web Worker Bridge (`cdn-worker-bridge.js`).
 *
 * Standards-Aligned Guarantees (Rev 6 §5.3 & F4):
 * 1. Zero `<base>` elements (`base-uri 'self'` CSP safe): Module Workers load via external
 *    `<script type="module" src="...">` so relative `import` and `import.meta.url` resolve natively.
 * 2. Prototype-inheritance-aware WebIDL `[Replaceable]` property guard
 *    (`(!ownDesc && Object.isExtensible(wfw)) || (ownDesc && ownDesc.configurable === true)`)
 *    defines `self`, `globalThis`, and `origin` (`parsedWorkerUrl.origin`) cleanly (`Rev 6 F4`).
 * 3. `workerSelfProxy` binds WebIDL platform methods (`addEventListener`, `setTimeout`,
 *    `structuredClone`, `fetch`, etc.) via WeakMap cache while preserving constructors
 *    (`URL`, `Object`, `Request`, `Worker`) and static namespaces (`URL.createObjectURL`, `Object.keys`).
 * 4. `wfw.URL` Proxy rewrites `base` in `new URL(rel, base)`, `URL.canParse(rel, base)`, and `URL.parse(rel, base)`.
 * 5. `syncCaptureStack` (`{ hasErr: boolean, error: any }`) preserves nested `importScripts`
 *    recovery, falsy thrown values (`0`, `''`, `false`, `null`, `undefined`), `EvalError`
 *    normalization under CSP / `hasNativePolicy === false`, and synchronous cancelable `cw.ErrorEvent`.
 */

const { isNativeTrustedScriptURL, getOrCreateTrustedTypesPolicy } = require('../../../security/trusted-types');
const { resolveWorkbenchAssetUrl } = require('./child-asset-adapter');

const MAX_NESTED_WORKER_DEPTH = 8;

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
  'fetch',
  'postMessage',
  'close',
  'importScripts',
]);

function canDefineOwnPropertyOnScope(target, prop) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) return false;
  const ownDesc = Object.getOwnPropertyDescriptor(target, prop);
  return (!ownDesc && Object.isExtensible(target)) || Boolean(ownDesc && ownDesc.configurable === true);
}

/**
 * Installs the adapted `Worker` constructor on `cw` and tracks active worker bridges.
 *
 * @param {{
 *   cw: any,
 *   cd: any,
 *   origCreateEl: Function,
 *   nonce: string,
 *   cdnBaseUrl: string,
 *   hostOrigin: string,
 *   hostConfig: any,
 *   isAllowedScriptUrl: (url: string) => boolean,
 *   ttPolicyCtrl: any,
 *   activeWorkerBridges: Set<{ terminate: () => void }>
 * }} env
 */
function installCdnWorkerAdapter(env) {
  const {
    cw,
    cd,
    origCreateEl,
    nonce,
    cdnBaseUrl,
    hostOrigin,
    hostConfig,
    isAllowedScriptUrl,
    ttPolicyCtrl,
    activeWorkerBridges,
  } = env;

  const cdnPathPrefix = hostConfig?.cdnPathPrefix || '/web/';

  function createCdnWorkerBridge(resolvedUrl, workerOptions, bridgeDepth = 0) {
    if (bridgeDepth > MAX_NESTED_WORKER_DEPTH) {
      // ceiling: limit nested worker bridge recursion depth to prevent runaway iframe creation
      throw new (cw.RangeError || RangeError)('Nested Worker bridge depth limit exceeded');
    }

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

    let workerFrame = null;
    let wfw = null;
    let wfd = null;

    const dispatchHostEvent = (type, eventObj) => {
      if (terminated) return true;
      let canceled = false;

      const markCanceledIfPrevented = () => {
        if (eventObj && eventObj.defaultPrevented === true) {
          canceled = true;
        }
      };

      const direct =
        type === 'message'
          ? onmessageHandler
          : type === 'error'
            ? onerrorHandler
            : type === 'messageerror'
              ? onmessageerrorHandler
              : null;

      if (typeof direct === 'function') {
        const ret = direct.call(shim, eventObj);
        if (type === 'error' && ret === true && eventObj && typeof eventObj.preventDefault === 'function') {
          eventObj.preventDefault();
        }
        markCanceledIfPrevented();
      }

      const list = (listeners[type] || []).slice();
      for (let i = 0; i < list.length; i += 1) {
        const entry = list[i];
        if (typeof entry.fn === 'function') {
          entry.fn.call(shim, eventObj);
        } else if (entry.fn && typeof entry.fn.handleEvent === 'function') {
          entry.fn.handleEvent(eventObj);
        }
        markCanceledIfPrevented();
        if (entry.once) {
          const idx = listeners[type].indexOf(entry);
          if (idx >= 0) listeners[type].splice(idx, 1);
        }
      }

      return !canceled;
    };

    const createHostErrorEvent = (errInfo) => {
      const hasThrownProp = Boolean(errInfo && Object.prototype.hasOwnProperty.call(errInfo, 'error'));
      const errorVal = hasThrownProp ? errInfo.error : null;
      const message = String(errInfo?.message ?? (errorVal && errorVal.message ? errorVal.message : String(errorVal ?? 'Worker script error')));
      const initDict = {
        message,
        filename: resolvedUrl,
        lineno: Number(errInfo?.lineno || 0),
        colno: Number(errInfo?.colno || 0),
        error: errorVal,
        cancelable: true,
      };
      if (typeof cw.ErrorEvent === 'function') {
        try {
          return new cw.ErrorEvent('error', initDict);
        } catch {
          // Fallback to synthetic cancelable ErrorEvent object
        }
      }
      let prevented = false;
      return {
        type: 'error',
        ...initDict,
        get defaultPrevented() {
          return prevented;
        },
        preventDefault() {
          if (this.cancelable) prevented = true;
        },
      };
    };

    const emitHostError = (errInfo) => {
      if (terminated) return true;
      const ev = createHostErrorEvent(errInfo);
      return dispatchHostEvent('error', ev);
    };

    const emitHostMessage = (data, ports) => {
      if (terminated) return;
      const deliver = () => {
        if (terminated) return;
        let ev;
        if (typeof cw.MessageEvent === 'function') {
          try {
            ev = new cw.MessageEvent('message', { data, ports: ports || [] });
          } catch {
            ev = { type: 'message', data, ports: ports || [] };
          }
        } else {
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

    const bridgeHandle = { terminate: () => terminateBridge() };

    const terminateBridge = () => {
      if (terminated) return;
      terminated = true;
      pendingInbound.length = 0;
      if (activeWorkerBridges && typeof activeWorkerBridges.delete === 'function') {
        activeWorkerBridges.delete(bridgeHandle);
      }
      if (hostPort) {
        try {
          hostPort.onmessage = null;
          hostPort.close();
        } catch {
          // Ignore
        }
      }
      if (workerPort) {
        try {
          workerPort.onmessage = null;
          workerPort.close();
        } catch {
          // Ignore
        }
      }
      if (wfw && typeof wfw.removeEventListener === 'function') {
        try {
          wfw.removeEventListener('error', onWfwErrorCapture, true);
        } catch {
          // Ignore
        }
      }
      if (workerFrame) {
        try {
          if (typeof workerFrame.remove === 'function') {
            workerFrame.remove();
          } else if (workerFrame.parentNode && typeof workerFrame.parentNode.removeChild === 'function') {
            workerFrame.parentNode.removeChild(workerFrame);
          }
        } catch {
          // Ignore
        }
        workerFrame = null;
      }
    };

    if (activeWorkerBridges && typeof activeWorkerBridges.add === 'function') {
      activeWorkerBridges.add(bridgeHandle);
    }

    const shim = {
      postMessage(msg, transfer) {
        if (terminated) return;
        if (hostPort) {
          if (transfer !== undefined) hostPort.postMessage(msg, transfer);
          else hostPort.postMessage(msg);
          return;
        }
        if (!loaded) {
          pendingInbound.push({ msg, transfer });
          return;
        }
        deliverToWorkerScope(msg, Array.isArray(transfer) ? transfer : []);
      },
      terminate: terminateBridge,
      addEventListener(type, fn, opts) {
        if (!fn || !listeners[type]) return;
        const once = Boolean(opts && typeof opts === 'object' && opts.once);
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
        return dispatchHostEvent(ev.type, ev);
      },
    };

    Object.defineProperties(shim, {
      onmessage: {
        get: () => onmessageHandler,
        set: (fn) => {
          onmessageHandler = typeof fn === 'function' ? fn : null;
        },
        enumerable: true,
        configurable: true,
      },
      onerror: {
        get: () => onerrorHandler,
        set: (fn) => {
          onerrorHandler = typeof fn === 'function' ? fn : null;
        },
        enumerable: true,
        configurable: true,
      },
      onmessageerror: {
        get: () => onmessageerrorHandler,
        set: (fn) => {
          onmessageerrorHandler = typeof fn === 'function' ? fn : null;
        },
        enumerable: true,
        configurable: true,
      },
    });
    if (cw.Worker && cw.Worker.prototype) {
      try {
        Object.setPrototypeOf(shim, cw.Worker.prototype);
      } catch {
        // Ignore
      }
    }

    const hostParent = cd.body || cd.documentElement;
    if (!hostParent || typeof hostParent.appendChild !== 'function') {
      terminateBridge();
      throw new TypeError('Unable to mount isolated CDN Worker helper frame');
    }

    workerFrame = origCreateEl('iframe');
    workerFrame.src = 'about:blank';
    workerFrame.setAttribute?.('aria-hidden', 'true');
    if (workerFrame.style) {
      workerFrame.style.cssText =
        'display:none;width:0;height:0;border:0;position:absolute;left:-9999px;visibility:hidden;';
    }
    hostParent.appendChild(workerFrame);

    wfw = workerFrame.contentWindow;
    wfd = workerFrame.contentDocument || wfw?.document;
    if (!wfw || !wfd) {
      terminateBridge();
      throw new TypeError('Failed to initialize isolated CDN Worker helper frame');
    }

    if (typeof wfd.open === 'function' && typeof wfd.close === 'function') {
      wfd.open();
      wfd.close();
    }

    // Capture inherited document URL immediately after zero-arg open/close (no <base> element injected!)
    const inheritedDocUrl = String(wfw.location?.href || 'about:blank');

    const wfwTtPolicyCtrl = getOrCreateTrustedTypesPolicy(wfw, {
      policyNames: hostConfig.trustedTypesPolicyNames,
      isAllowedScriptUrl,
    });
    const effectiveTtCtrl = wfwTtPolicyCtrl.hasNativePolicy ? wfwTtPolicyCtrl : (ttPolicyCtrl || wfwTtPolicyCtrl);

    let parsedWorkerUrl = null;
    let workerScriptDir = cdnBaseUrl;
    try {
      parsedWorkerUrl = new URL(resolvedUrl);
      workerScriptDir = new URL('.', resolvedUrl).href.replace(/\/+$/, '');
    } catch {
      // Keep cdnBaseUrl fallback
    }

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

    const shouldReplaceUrlBase = (baseArg) => {
      if (baseArg === undefined || baseArg === null) return false;
      if (baseArg === wfw.location || baseArg === workerLocationObj) return true;
      const baseStr = String(baseArg);
      if (baseStr === 'about:blank') return true;
      if (inheritedDocUrl && inheritedDocUrl !== resolvedUrl && baseStr === inheritedDocUrl) {
        return true;
      }
      return false;
    };

    const OrigWfwURL = typeof wfw.URL === 'function' ? wfw.URL : URL;
    const ProxyCtor = wfw.Proxy || Proxy;
    if (typeof OrigWfwURL === 'function' && typeof ProxyCtor === 'function') {
      const AdaptedWfwURL = new ProxyCtor(OrigWfwURL, {
        construct(Target, args, newTarget) {
          if (args.length >= 2 && shouldReplaceUrlBase(args[1])) {
            const nextArgs = args.slice();
            nextArgs[1] = resolvedUrl;
            return Reflect.construct(Target, nextArgs, newTarget);
          }
          return Reflect.construct(Target, args, newTarget);
        },
        get(target, prop) {
          if ((prop === 'canParse' || prop === 'parse') && typeof target[prop] === 'function') {
            return function (urlInput, baseInput, ...rest) {
              if (baseInput !== undefined && shouldReplaceUrlBase(baseInput)) {
                return target[prop](urlInput, resolvedUrl, ...rest);
              }
              return baseInput !== undefined
                ? target[prop](urlInput, baseInput, ...rest)
                : target[prop](urlInput);
            };
          }
          const val = Reflect.get(target, prop, target);
          return typeof val === 'function' ? val.bind(target) : val;
        },
      });
      if (canDefineOwnPropertyOnScope(wfw, 'URL')) {
        Object.defineProperty(wfw, 'URL', {
          value: AdaptedWfwURL,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      }
    }

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
      return resolveWorkbenchAssetUrl(rawStr, relBase, hostOrigin, cdnPathPrefix) || rawStr;
    };

    const resolveImportUrl = (rawArg) => {
      if (isNativeTrustedScriptURL(cw, rawArg) || isNativeTrustedScriptURL(wfw, rawArg)) {
        const str = String(rawArg).trim();
        if (isAllowedScriptUrl(str)) return str;
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
      const candidate = resolveWorkbenchAssetUrl(rawImport, workerScriptDir, hostOrigin, cdnPathPrefix) || rawImport;
      if (!isAllowedScriptUrl(candidate)) {
        throw new (wfw.TypeError || TypeError)(`Untrusted importScripts URL rejected: ${rawImport}`);
      }
      return candidate;
    };

    const origXhrProto = wfw.XMLHttpRequest && wfw.XMLHttpRequest.prototype;
    const origXhrOpen = origXhrProto && typeof origXhrProto.open === 'function' ? origXhrProto.open : null;
    if (origXhrOpen) {
      origXhrProto.open = function (method, url, ...rest) {
        const rewrittenUrl =
          typeof url === 'string' || (url && typeof url.href === 'string')
            ? rewriteWorkerAssetUrl(url)
            : url;
        return origXhrOpen.call(this, method, rewrittenUrl, ...rest);
      };
    }

    const origWfwFetch = typeof wfw.fetch === 'function' ? wfw.fetch.bind(wfw) : null;
    if (origWfwFetch && canDefineOwnPropertyOnScope(wfw, 'fetch')) {
      Object.defineProperty(wfw, 'fetch', {
        value: (input, init) => {
          if (
            typeof input === 'string' ||
            (input && typeof input.href === 'string' && !(wfw.Request && input instanceof wfw.Request))
          ) {
            return origWfwFetch(rewriteWorkerAssetUrl(input), init);
          }
          return origWfwFetch(input, init);
        },
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    if (typeof wfw.Request === 'function' && typeof ProxyCtor === 'function' && canDefineOwnPropertyOnScope(wfw, 'Request')) {
      const OrigWfwRequest = wfw.Request;
      Object.defineProperty(wfw, 'Request', {
        value: new ProxyCtor(OrigWfwRequest, {
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
        }),
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }

    let workerSelfProxy = wfw;
    if (typeof ProxyCtor === 'function') {
      const boundMethodCache = new WeakMap();
      workerSelfProxy = new ProxyCtor(wfw, {
        get(target, prop) {
          if (prop === 'self' || prop === 'globalThis') return workerSelfProxy;
          if (prop === 'location') return workerLocationObj;
          if (prop === 'origin' && parsedWorkerUrl) return parsedWorkerUrl.origin;

          const val = Reflect.get(target, prop, target);
          if (typeof val === 'function' && prop !== 'eval' && typeof prop === 'string') {
            const shouldBindToTarget =
              WINDOW_RECEIVER_METHODS.has(prop) || !('prototype' in val) || val.prototype === undefined;
            if (shouldBindToTarget) {
              let bound = boundMethodCache.get(val);
              if (!bound) {
                bound = val.bind(target);
                boundMethodCache.set(val, bound);
              }
              return bound;
            }
          }
          return val;
        },
        set(target, prop, value) {
          if (prop === 'location') return true;
          return Reflect.set(target, prop, value, target);
        },
        has(target, prop) {
          if (prop === Symbol.unscopables) return false;
          return (
            prop === 'location' ||
            prop === 'self' ||
            prop === 'globalThis' ||
            prop === 'origin' ||
            Reflect.has(target, prop)
          );
        },
      });
    }

    // Rev 6 F4: Prototype-inheritance-aware WebIDL [Replaceable] guard (zero silent try/catch)
    if (canDefineOwnPropertyOnScope(wfw, 'self')) {
      Object.defineProperty(wfw, 'self', {
        value: workerSelfProxy,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    if (canDefineOwnPropertyOnScope(wfw, 'globalThis')) {
      Object.defineProperty(wfw, 'globalThis', {
        value: workerSelfProxy,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
    if (parsedWorkerUrl && canDefineOwnPropertyOnScope(wfw, 'origin')) {
      Object.defineProperty(wfw, 'origin', {
        value: parsedWorkerUrl.origin,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    if (canDefineOwnPropertyOnScope(wfw, 'location')) {
      Object.defineProperty(wfw, 'location', {
        value: workerLocationObj,
        writable: false,
        configurable: true,
        enumerable: true,
      });
    }

    const syncCaptureStack = [];
    const CAPTURE_HOOK_PROP = '__agyRecordSyncWorkerThrow';

    if (canDefineOwnPropertyOnScope(wfw, CAPTURE_HOOK_PROP)) {
      Object.defineProperty(wfw, CAPTURE_HOOK_PROP, {
        value: (thrownValue) => {
          if (syncCaptureStack.length > 0) {
            const top = syncCaptureStack[syncCaptureStack.length - 1];
            top.hasErr = true;
            top.error = thrownValue;
          }
        },
        writable: false,
        configurable: true,
        enumerable: false,
      });
    }

    const onWfwErrorCapture = (ev) => {
      if (terminated) return;
      if (syncCaptureStack.length > 0) {
        const top = syncCaptureStack[syncCaptureStack.length - 1];
        if (!top.hasErr) {
          top.hasErr = true;
          if (ev && 'error' in ev && (ev.error !== null || !ev.message)) {
            top.error = ev.error;
          } else {
            top.error = new (wfw.SyntaxError || SyntaxError)(ev?.message || 'Worker script error');
          }
        }
        ev?.preventDefault?.();
        ev?.stopImmediatePropagation?.();
        return;
      }
      const hasErrProp = Boolean(ev && 'error' in ev);
      emitHostError({
        message: ev?.message || 'Worker script error',
        lineno: ev?.lineno || 0,
        colno: ev?.colno || 0,
        error: hasErrProp ? ev.error : null,
      });
    };

    if (typeof wfw.addEventListener === 'function') {
      wfw.addEventListener('error', onWfwErrorCapture, true);
    }

    const isCspOrTrustedTypesBlockError = (err) => {
      if (!err) return false;
      const EvalErrCtor = wfw.EvalError || EvalError;
      if (err instanceof EvalErrCtor || err instanceof EvalError || err.name === 'EvalError') {
        return true;
      }
      const msg = String(err.message || '');
      return /TrustedScript|TrustedTypes|Content Security Policy|unsafe-eval|Refused to evaluate|requires 'TrustedScript'/i.test(
        msg
      );
    };

    let execSeq = 0;
    const runScopedClassicScript = (code, label, allowEvalFallback = true) => {
      const targetEl = wfd.head || wfd.body || wfd.documentElement;
      if (!targetEl) {
        throw new (wfw.Error || Error)('Worker helper document unavailable');
      }

      const execFlag = `__agyImpDone_${++execSeq}`;
      const markedCode =
        `try {\n` +
        `  with (self) {\n${code}\n}\n` +
        `} catch (__agyCaught) {\n` +
        `  ${CAPTURE_HOOK_PROP}(__agyCaught);\n` +
        `}\n` +
        `self[${JSON.stringify(execFlag)}] = 1;`;

      const frame = { hasErr: false, error: undefined };
      syncCaptureStack.push(frame);
      let executedSync = false;
      let sinkBlockErr = null;

      try {
        delete wfw[execFlag];
        const depEl = wfd.createElement('script');
        if (nonce) {
          depEl.nonce = nonce;
          depEl.setAttribute?.('nonce', nonce);
        }
        const scriptToken = effectiveTtCtrl.issueScriptToken(markedCode);
        try {
          depEl.text = effectiveTtCtrl.toScript(markedCode, scriptToken);
          targetEl.appendChild(depEl);
          executedSync = wfw[execFlag] === 1;
        } catch (sinkErr) {
          sinkBlockErr = sinkErr;
        } finally {
          effectiveTtCtrl.revokeScriptToken(scriptToken);
          delete wfw[execFlag];
        }

        if (frame.hasErr) {
          throw frame.error;
        }

        if (!executedSync && allowEvalFallback && typeof wfw.eval === 'function') {
          const evalToken = effectiveTtCtrl.issueScriptToken(markedCode);
          try {
            const evalPayload = effectiveTtCtrl.toScript(markedCode, evalToken);
            (0, wfw.eval)(evalPayload);
            executedSync = wfw[execFlag] === 1;
          } catch (evalErr) {
            sinkBlockErr = evalErr;
          } finally {
            effectiveTtCtrl.revokeScriptToken(evalToken);
            delete wfw[execFlag];
          }

          if (frame.hasErr) {
            throw frame.error;
          }
        }
      } finally {
        syncCaptureStack.pop();
      }

      if (!executedSync) {
        if (isCspOrTrustedTypesBlockError(sinkBlockErr) || !effectiveTtCtrl.hasNativePolicy) {
          const EvalErrCtor = wfw.EvalError || EvalError;
          throw new EvalErrCtor(
            `${label} blocked by Content Security Policy / TrustedTypes${sinkBlockErr?.message ? `: ${sinkBlockErr.message}` : ''}`
          );
        }
        if (sinkBlockErr) {
          throw sinkBlockErr;
        }
      }

      return { executedSync };
    };

    const loadImportedScriptSync = (safeImportUrl) => {
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
      const { executedSync } = runScopedClassicScript(code, 'importScripts', true);
      if (!executedSync) {
        throw new (wfw.EvalError || EvalError)(`importScripts blocked from synchronous execution: ${safeImportUrl}`);
      }
    };

    const workerScopeOrig =
      typeof wfw.Worker === 'function' ? wfw.Worker : (typeof cw.Worker === 'function' ? cw.Worker : null);
    if (workerScopeOrig && !workerScopeOrig.__agyWorkerAdapted && canDefineOwnPropertyOnScope(wfw, 'Worker')) {
      Object.defineProperty(wfw, 'Worker', {
        value: buildAdaptedWorkerCtor(workerScopeOrig, workerScriptDir, bridgeDepth + 1),
        configurable: true,
        writable: true,
      });
    }

    if (canDefineOwnPropertyOnScope(wfw, 'postMessage')) {
      Object.defineProperty(wfw, 'postMessage', {
        value: (msg, transfer) => {
          if (terminated) return;
          if (workerPort) {
            if (transfer !== undefined) workerPort.postMessage(msg, transfer);
            else workerPort.postMessage(msg);
            return;
          }
          emitHostMessage(msg, Array.isArray(transfer) ? transfer : []);
        },
        configurable: true,
        writable: true,
      });
    }

    if (canDefineOwnPropertyOnScope(wfw, 'close')) {
      Object.defineProperty(wfw, 'close', {
        value: terminateBridge,
        configurable: true,
        writable: true,
      });
    }

    if (canDefineOwnPropertyOnScope(wfw, 'importScripts')) {
      Object.defineProperty(wfw, 'importScripts', {
        value: (...urls) => {
          if (terminated) return;
          if (workerOptions && workerOptions.type === 'module') {
            throw new (wfw.TypeError || TypeError)("Module scripts don't support importScripts().");
          }
          const resolvedUrls = [];
          for (let i = 0; i < urls.length; i += 1) {
            resolvedUrls.push(resolveImportUrl(urls[i]));
          }
          for (let i = 0; i < resolvedUrls.length; i += 1) {
            loadImportedScriptSync(resolvedUrls[i]);
          }
        },
        configurable: true,
        writable: true,
      });
    }

    if (workerOptions && workerOptions.name !== undefined) {
      wfw.name = String(workerOptions.name);
    }

    const deliverToWorkerScope = (msg, ports) => {
      if (terminated || !wfw) return;
      let errReported = false;
      const reportScopeErr = (err) => {
        if (errReported || terminated) return;
        errReported = true;
        emitHostError({
          message: err && typeof err === 'object' && 'message' in err ? err.message : String(err),
          error: err,
        });
      };

      const ev =
        typeof wfw.MessageEvent === 'function'
          ? new wfw.MessageEvent('message', { data: msg, ports: ports || [] })
          : { type: 'message', data: msg, ports: ports || [] };

      const prevOnMsg = typeof wfw.onmessage === 'function' ? wfw.onmessage : null;
      let onMsgRan = false;
      let sentinel = null;
      if (prevOnMsg) {
        sentinel = function (eventArg) {
          onMsgRan = true;
          try {
            return prevOnMsg.call(workerSelfProxy, eventArg);
          } catch (err) {
            reportScopeErr(err);
            return undefined;
          }
        };
        try {
          wfw.onmessage = sentinel;
        } catch {
          sentinel = null;
        }
      }
      try {
        wfw.dispatchEvent?.(ev);
      } catch (err) {
        reportScopeErr(err);
      } finally {
        if (sentinel && wfw.onmessage === sentinel) {
          try {
            wfw.onmessage = prevOnMsg;
          } catch {
            // Ignore
          }
        }
      }
      if (prevOnMsg && !onMsgRan) {
        try {
          prevOnMsg.call(workerSelfProxy, ev);
        } catch (err) {
          reportScopeErr(err);
        }
      }
    };

    const flushInboundQueueIfReady = () => {
      if (terminated || !loaded) return;
      if (workerPort) {
        workerPort.onmessage = (ev) => {
          deliverToWorkerScope(ev.data, ev.ports);
        };
        workerPort.start?.();
      }
      const queued = pendingInbound.splice(0, pendingInbound.length);
      for (let i = 0; i < queued.length; i += 1) {
        const item = queued[i];
        if (hostPort) {
          if (item.transfer !== undefined) hostPort.postMessage(item.msg, item.transfer);
          else hostPort.postMessage(item.msg);
        } else {
          deliverToWorkerScope(item.msg, Array.isArray(item.transfer) ? item.transfer : []);
        }
      }
    };

    if (hostPort && workerPort) {
      hostPort.onmessage = (ev) => {
        emitHostMessage(ev.data, ev.ports);
      };
      hostPort.start?.();
    }

    const loadViaExternalScriptElement = () => {
      if (terminated) return;
      const sc = wfd.createElement('script');
      if (nonce) {
        sc.nonce = nonce;
        sc.setAttribute?.('nonce', nonce);
      }
      if (workerOptions && workerOptions.type === 'module') {
        sc.type = 'module';
      }
      sc.src = effectiveTtCtrl.toScriptURL(resolvedUrl);
      sc.addEventListener?.(
        'load',
        () => {
          if (terminated) return;
          loaded = true;
          flushInboundQueueIfReady();
        },
        { once: true }
      );
      sc.addEventListener?.(
        'error',
        () => {
          emitHostError({ message: `Failed to load Worker script: ${resolvedUrl}`, error: null });
        },
        { once: true }
      );
      const frameTarget = wfd.head || wfd.body || wfd.documentElement;
      frameTarget.appendChild(sc);
    };

    const isModuleWorker = Boolean(workerOptions && workerOptions.type === 'module');
    if (!isModuleWorker && origWfwFetch) {
      Promise.resolve(origWfwFetch(resolvedUrl))
        .then(async (resp) => {
          if (terminated) return;
          if (!resp || resp.ok === false) {
            emitHostError({
              message: `Failed to fetch worker script (${resp?.status ?? 'network'}): ${resolvedUrl}`,
              error: null,
            });
            return;
          }
          const code = await resp.text();
          if (terminated) return;
          try {
            const { executedSync } = runScopedClassicScript(code, 'Worker', false);
            if (executedSync) {
              loaded = true;
              flushInboundQueueIfReady();
              return;
            }
          } catch (err) {
            if (!isCspOrTrustedTypesBlockError(err)) {
              emitHostError({
                message: err && typeof err === 'object' && 'message' in err ? err.message : String(err),
                error: err,
              });
              return;
            }
          }
          loadViaExternalScriptElement();
        })
        .catch(() => {
          loadViaExternalScriptElement();
        });
    } else {
      // Module Workers load directly via external <script type="module" src="..."> without <base>
      loadViaExternalScriptElement();
    }

    return shim;
  }

  function buildAdaptedWorkerCtor(OrigWorker, baseCdnDir, bridgeDepth) {
    const AdaptedWorker = function (scriptURL, options) {
      const isTrustedObj = isNativeTrustedScriptURL(cw, scriptURL);
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
        if (!isTrustedObj && ttPolicyCtrl) {
          const blobToken = ttPolicyCtrl.issueBlobUrlToken(rawStr, hostOrigin || undefined);
          try {
            safeBlob = ttPolicyCtrl.toScriptURL(rawStr, blobToken);
          } finally {
            ttPolicyCtrl.revokeBlobUrlToken(blobToken);
          }
        }
        return options !== undefined ? new OrigWorker(safeBlob, options) : new OrigWorker(safeBlob);
      }

      const resolvedUrl = resolveWorkbenchAssetUrl(rawStr, baseCdnDir, hostOrigin, cdnPathPrefix) || rawStr;
      if (!isAllowedScriptUrl(resolvedUrl)) {
        throw new TypeError(`Untrusted Worker script URL rejected: ${rawStr}`);
      }

      let sameOriginWithPage = false;
      try {
        const pageOrigin =
          cw.location && cw.location.origin && cw.location.origin !== 'null'
            ? cw.location.origin
            : (hostOrigin ? new URL(String(hostOrigin)).origin : '');
        sameOriginWithPage = Boolean(pageOrigin && new URL(resolvedUrl).origin === pageOrigin);
      } catch {
        sameOriginWithPage = false;
      }

      if (sameOriginWithPage) {
        const safeDirect = isTrustedObj ? scriptURL : (ttPolicyCtrl ? ttPolicyCtrl.toScriptURL(resolvedUrl) : resolvedUrl);
        return options !== undefined ? new OrigWorker(safeDirect, options) : new OrigWorker(safeDirect);
      }

      return createCdnWorkerBridge(resolvedUrl, options, bridgeDepth);
    };

    AdaptedWorker.prototype = OrigWorker.prototype;
    try {
      Object.setPrototypeOf(AdaptedWorker, OrigWorker);
    } catch {
      // Ignore
    }
    AdaptedWorker.__agyWorkerAdapted = true;
    return AdaptedWorker;
  }

  if (cw && typeof cw.Worker === 'function' && !cw.Worker.__agyWorkerAdapted) {
    const OrigWorker = cw.Worker;
    const AdaptedWorker = buildAdaptedWorkerCtor(OrigWorker, cdnBaseUrl, 0);
    if (canDefineOwnPropertyOnScope(cw, 'Worker')) {
      Object.defineProperty(cw, 'Worker', {
        value: AdaptedWorker,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  }
}

module.exports = {
  MAX_NESTED_WORKER_DEPTH,
  WINDOW_RECEIVER_METHODS,
  canDefineOwnPropertyOnScope,
  installCdnWorkerAdapter,
};
