'use strict';

/**
 * Finite State Machine for Remote Control Cross-Origin Frame Adaptation (`antigravity-mcp-manager`).
 *
 * State transitions:
 *   idle -> preflight -> promoting -> ready | passive_attached | rolled_back
 */

const { resolveHostAdapterConfig } = require('./host-adapter-config');
const { isAutoIframeLoadSuppressed } = require('./remote-runtime');
const { getOrCreateTrustedTypesPolicy, getScriptNonce } = require('./companion-loader');

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

function resolveRelativeToCdnUrl(rawValue, cdnBaseUrl) {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  if (/^(?:https?:|blob:|data:|javascript:)/i.test(trimmed)) return null;
  if (trimmed.startsWith('/web/')) {
    const cdnRoot = cdnBaseUrl.replace(/\/web\/[^/]+$/, '');
    return `${cdnRoot}${trimmed}`;
  }
  if (trimmed.startsWith('/')) {
    return `${cdnBaseUrl}${trimmed}`;
  }
  if (trimmed.startsWith('./')) {
    return `${cdnBaseUrl}/${trimmed.slice(2)}`;
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

function installChildAssetAdapter(cw, cd, nonce, cdnBaseUrl, ttPolicyCtrl) {
  if (!cd || typeof cd.createElement !== 'function' || cd.__agyAssetAdapted) return;
  cd.__agyAssetAdapted = true;
  const origCreateEl = cd.createElement.bind(cd);
  cd.createElement = function (tagName, options) {
    const el = options !== undefined ? origCreateEl(tagName, options) : origCreateEl(tagName);
    const lower = String(tagName || '').toLowerCase();
    if (el && nonce && (lower === 'script' || lower === 'style' || lower === 'link')) {
      try {
        el.nonce = nonce;
        el.setAttribute?.('nonce', nonce);
      } catch {}
    }
    if (el && lower === 'script' && ttPolicyCtrl) {
      const protoDesc =
        cw?.HTMLScriptElement?.prototype &&
        Object.getOwnPropertyDescriptor(cw.HTMLScriptElement.prototype, 'src');
      if (protoDesc && typeof protoDesc.set === 'function' && typeof protoDesc.get === 'function') {
        try {
          Object.defineProperty(el, 'src', {
            configurable: true,
            enumerable: true,
            get() {
              return protoDesc.get.call(this);
            },
            set(val) {
              if (val && typeof val === 'object') {
                protoDesc.set.call(this, val);
                return;
              }
              const mapped = resolveRelativeToCdnUrl(String(val ?? ''), cdnBaseUrl) || String(val ?? '');
              let safeVal = mapped;
              try {
                safeVal = ttPolicyCtrl.toScriptURL(mapped);
              } catch {}
              protoDesc.set.call(this, safeVal);
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

  const origSrcDesc =
    typeof HTMLIFrameElement !== 'undefined'
      ? Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')
      : null;
  const hostOrigin = win.location?.origin || 'https://antigravity.google.com';
  const canonicalFrameUrl = `${hostOrigin}${basePath}/${parsedUrl.search || '?iframe=true'}`;

  const promotionToken = {};
  const rcProto = Object.getPrototypeOf(rcInst);
  const hadOwnInstOnIframeLoad = Object.prototype.hasOwnProperty.call(rcInst, 'onIframeLoad');
  if (rcProto && typeof rcProto.onIframeLoad === 'function') {
    if (!rcProto.__agyMcpOrigOnIframeLoad) {
      const prevProtoOnLoad = rcProto.onIframeLoad;
      const wrappedProtoOnLoad = function (...args) {
        if (isAutoIframeLoadSuppressed(this)) return Promise.resolve();
        return prevProtoOnLoad.apply(this, args);
      };
      rcProto.__agyMcpOrigOnIframeLoad = prevProtoOnLoad;
      rcProto.__agyMcpWrappedOnIframeLoad = wrappedProtoOnLoad;
      rcProto.onIframeLoad = wrappedProtoOnLoad;
    }
    if (!(rcProto.__agyMcpActivePromotions instanceof Set)) {
      rcProto.__agyMcpActivePromotions = new Set();
    }
    rcProto.__agyMcpActivePromotions.add(promotionToken);
  }
  if (hadOwnInstOnIframeLoad && typeof rcInst.onIframeLoad === 'function') {
    if (!rcInst.__agyMcpOrigOnIframeLoad) {
      const prevInstOnLoad = rcInst.onIframeLoad;
      const wrappedInstOnLoad = function (...args) {
        if (isAutoIframeLoadSuppressed(this)) return Promise.resolve();
        return prevInstOnLoad.apply(this, args);
      };
      rcInst.__agyMcpOrigOnIframeLoad = prevInstOnLoad;
      rcInst.__agyMcpWrappedOnIframeLoad = wrappedInstOnLoad;
      rcInst.onIframeLoad = wrappedInstOnLoad;
    }
    if (!(rcInst.__agyMcpActivePromotions instanceof Set)) {
      rcInst.__agyMcpActivePromotions = new Set();
    }
    rcInst.__agyMcpActivePromotions.add(promotionToken);
  }
  if (!(rcInst.__agyMcpSuppressingPromotions instanceof Set)) {
    rcInst.__agyMcpSuppressingPromotions = new Set();
  }
  rcInst.__agyMcpSuppressingPromotions.add(promotionToken);
  rcInst.__agySuppressAutoIframeLoadCount = (rcInst.__agySuppressAutoIframeLoadCount || 0) + 1;
  rcInst.__agySuppressAutoIframeLoad = true;
  let suppressionActiveForToken = true;

  let childWindowRef = null;
  let hadOwnChildDec = false;
  let prevChildDec = undefined;
  let wrappedChildDec = null;
  let capturedLsByThisPromotion = null;

  const endSuppressionForThisPromotion = () => {
    if (suppressionActiveForToken) {
      suppressionActiveForToken = false;
      const nextCount = Math.max(0, (rcInst.__agySuppressAutoIframeLoadCount || 1) - 1);
      if (nextCount === 0) {
        delete rcInst.__agySuppressAutoIframeLoadCount;
      } else {
        rcInst.__agySuppressAutoIframeLoadCount = nextCount;
      }
    }
    if (rcInst.__agyMcpSuppressingPromotions instanceof Set) {
      rcInst.__agyMcpSuppressingPromotions.delete(promotionToken);
      if (rcInst.__agyMcpSuppressingPromotions.size === 0) {
        delete rcInst.__agyMcpSuppressingPromotions;
        rcInst.__agySuppressAutoIframeLoad = Boolean(rcInst.__agySuppressAutoIframeLoadCount > 0);
      } else {
        rcInst.__agySuppressAutoIframeLoad = true;
      }
    } else {
      rcInst.__agySuppressAutoIframeLoad = Boolean(rcInst.__agySuppressAutoIframeLoadCount > 0);
    }
  };

  const releaseRcHooks = () => {
    try {
      endSuppressionForThisPromotion();
      if (rcProto && rcProto.__agyMcpActivePromotions instanceof Set) {
        rcProto.__agyMcpActivePromotions.delete(promotionToken);
        if (rcProto.__agyMcpActivePromotions.size === 0) {
          if (rcProto.__agyMcpOrigOnIframeLoad && rcProto.onIframeLoad === rcProto.__agyMcpWrappedOnIframeLoad) {
            rcProto.onIframeLoad = rcProto.__agyMcpOrigOnIframeLoad;
          }
          delete rcProto.__agyMcpOrigOnIframeLoad;
          delete rcProto.__agyMcpWrappedOnIframeLoad;
          delete rcProto.__agyMcpActivePromotions;
        }
      }
      if (rcInst.__agyMcpActivePromotions instanceof Set) {
        rcInst.__agyMcpActivePromotions.delete(promotionToken);
        if (rcInst.__agyMcpActivePromotions.size === 0) {
          if (rcInst.__agyMcpOrigOnIframeLoad && rcInst.onIframeLoad === rcInst.__agyMcpWrappedOnIframeLoad) {
            rcInst.onIframeLoad = rcInst.__agyMcpOrigOnIframeLoad;
          } else if (!hadOwnInstOnIframeLoad && rcInst.onIframeLoad === rcInst.__agyMcpWrappedOnIframeLoad) {
            delete rcInst.onIframeLoad;
          }
          delete rcInst.__agyMcpOrigOnIframeLoad;
          delete rcInst.__agyMcpWrappedOnIframeLoad;
          delete rcInst.__agyMcpActivePromotions;
        }
      }
      if (
        !(rcProto?.__agyMcpActivePromotions?.size > 0) &&
        !(rcInst.__agyMcpActivePromotions?.size > 0) &&
        !(rcInst.__agySuppressAutoIframeLoadCount > 0)
      ) {
        delete rcInst.__agySuppressAutoIframeLoad;
      } else {
        rcInst.__agySuppressAutoIframeLoad = Boolean(
          rcInst.__agyMcpSuppressingPromotions?.size > 0 || rcInst.__agySuppressAutoIframeLoadCount > 0
        );
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
      installChildAssetAdapter(cw, cd, nonce, cdnBaseUrl, ttPolicyCtrl);

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
        const origLoad =
          rcInst.__agyMcpOrigOnIframeLoad ||
          rcProto?.__agyMcpOrigOnIframeLoad ||
          rcInst.onIframeLoad;
        let loadRet = null;
        if (typeof origLoad === 'function' && !cw.__initialConfigReceived && !cw.__agyOnIframeLoadCalled) {
          cw.__agyOnIframeLoadCalled = true;
          try {
            loadRet = origLoad.call(rcInst);
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
    clearFallbackTimer();
    onBlankLoad();
  };
  if (typeof iframe.addEventListener === 'function') {
    iframe.addEventListener('load', triggerBlankLoadOnce, { once: true });
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
  try {
    Object.defineProperty(iframe, 'src', {
      configurable: true,
      enumerable: true,
      get: () => canonicalFrameUrl,
      set: (v) => {
        if (origSrcDesc && typeof origSrcDesc.set === 'function') {
          origSrcDesc.set.call(iframe, v);
        } else {
          iframe.setAttribute?.('src', v);
        }
      },
    });
  } catch {}

  iframe.__agyMcpRestorePromotion = () => {
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
