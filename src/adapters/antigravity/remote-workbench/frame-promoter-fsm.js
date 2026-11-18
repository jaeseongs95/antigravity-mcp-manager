'use strict';

/**
 * 6-State Remote Workbench Cross-Origin Frame Promotion FSM (`frame-promoter-fsm.js`).
 *
 * States:
 *   `idle` -> `preflight` -> `promoting` -> `ready` | `passive_attached` | `rolled_back`
 *
 * Guarantees:
 * 1. Zero `document.write` calls: uses WHATWG HTML §8.4 zero-arg `cd.open(); cd.close();`
 *    so `require-trusted-types-for 'script'` is satisfied with zero `TrustedHTML` sinks.
 * 2. Companion ownership coordination (`PASSIVE_ATTACHED` when `statusbar` or `ko-thought`
 *    already promoted the iframe, `MCP-TC-039` / `MCP-TC-048`).
 * 3. TrustedScriptURL preflight failure (`AUDIT-M1`) and `mainScript.onerror` HTTP 500
 *    failure (`AUDIT-M2`) cleanly transition to `ROLLED_BACK` and restore original `iframe.src`.
 * 4. Dynamic `csrfToken` propagation (zero hardcoded `'csrf_token'` literal in FSM) and
 *    `INITIAL_CONFIG` / `MessagePort` buffering across promotion.
 */

const { DisposableStore } = require('../../../core/disposable');
const { hasPathTraversal } = require('../../../core/security/url-policy');
const { getOrCreateTrustedTypesPolicy, getScriptNonce } = require('../../../security/trusted-types');
const { disposableTimeout, disposableEvent, disposableObserver } = require('../../../shared/dom-disposables');
const { buildAllowedScriptUrlValidator } = require('../host-config');
const { incrementIframeSuppression } = require('../remote-control-lease');
const { installChildHistoryAdapter, installChildAssetAdapter } = require('./child-asset-adapter');
const { installCdnWorkerAdapter } = require('./cdn-worker-bridge');

const FRAME_PROMOTION_STATE = Object.freeze({
  IDLE: 'idle',
  PREFLIGHT: 'preflight',
  PROMOTING: 'promoting',
  READY: 'ready',
  PASSIVE_ATTACHED: 'passive_attached',
  ROLLED_BACK: 'rolled_back',
});

/**
 * Checks whether `mcp-manager` can take primary ownership of promoting `iframe`,
 * or whether a companion plugin already owns it.
 *
 * @param {any} iframe
 * @param {string} version
 */
function inspectPromotionOwnership(iframe, version, win) {
  if (!iframe) return { canPromote: false, isCompanionOwned: false };

  if (iframe.__agyMcpPromoted === version || iframe.__agyMcpPromotionFailed) {
    return { canPromote: false, isCompanionOwned: false };
  }

  const winOwner = win ? win.__agyRemotePromotionOwner : undefined;
  if (
    iframe.__agyKoPromoted ||
    iframe.__agyPromoted ||
    (iframe.__agyRemotePromotionOwner &&
      iframe.__agyRemotePromotionOwner !== 'mcp-manager' &&
      iframe.__agyRemotePromotionState !== FRAME_PROMOTION_STATE.ROLLED_BACK) ||
    (winOwner && winOwner !== 'mcp-manager')
  ) {
    return { canPromote: false, isCompanionOwned: true };
  }

  return { canPromote: true, isCompanionOwned: false };
}

/**
 * Attaches passive LanguageServer client capture to an already-promoted companion iframe.
 */
function attachPassiveCompanionHooks(win, iframe, onReady) {
  iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.PASSIVE_ATTACHED;
  let cleanupDec = () => {};
  try {
    const cw = iframe.contentWindow;
    if (cw) {
      if (cw.__agyCapturedLsClient && !win.__agyCapturedLsClient) {
        win.__agyCapturedLsClient = cw.__agyCapturedLsClient;
      }
      const hadOwn = Object.prototype.hasOwnProperty.call(cw, '__JETSKI_LS_CLIENT_DECORATOR__');
      const prevDec = cw.__JETSKI_LS_CLIENT_DECORATOR__;
      const passiveDec = function (client) {
        const decorated = typeof prevDec === 'function' ? prevDec(client) || client : client;
        if (decorated && typeof decorated === 'object') {
          win.__agyCapturedLsClient = decorated;
        }
        return decorated;
      };
      cw.__JETSKI_LS_CLIENT_DECORATOR__ = passiveDec;
      cleanupDec = () => {
        try {
          if (cw.__JETSKI_LS_CLIENT_DECORATOR__ === passiveDec) {
            if (hadOwn) cw.__JETSKI_LS_CLIENT_DECORATOR__ = prevDec;
            else delete cw.__JETSKI_LS_CLIENT_DECORATOR__;
          }
        } catch {
          // Ignore
        }
      };
    }
  } catch {
    // Still cross-origin; companion promotion in progress
  }
  if (typeof onReady === 'function') {
    onReady();
  }
  return {
    state: FRAME_PROMOTION_STATE.PASSIVE_ATTACHED,
    dispose() {
      cleanupDec();
    },
  };
}

/**
 * Promotes a cross-origin `<ga-remote-control>` workbench `iframe` into a same-origin shell.
 *
 * @param {{
 *   win: any,
 *   doc: any,
 *   iframe: any,
 *   hostConfig: any,
 *   remoteLease: any,
 *   onReady?: () => void,
 *   version?: string
 * }} params
 */
function promoteCrossOriginRemoteIframe(params) {
  const {
    win,
    doc,
    iframe,
    hostConfig,
    remoteLease,
    onReady,
    version = '2.0.0',
  } = params;

  if (!win || !doc || !iframe) return { promoted: false, state: FRAME_PROMOTION_STATE.IDLE, dispose() {} };

  const ownership = inspectPromotionOwnership(iframe, version, win);
  if (!ownership.canPromote) {
    if (ownership.isCompanionOwned) {
      const passive = attachPassiveCompanionHooks(win, iframe, onReady);
      return { promoted: false, state: passive.state, dispose: passive.dispose };
    }
    return {
      promoted: false,
      state: iframe.__agyRemotePromotionState || FRAME_PROMOTION_STATE.IDLE,
      dispose() {},
    };
  }

  const rcInst = remoteLease && typeof remoteLease.getInstance === 'function'
    ? remoteLease.getInstance(win, doc)
    : null;

  const rawCandidate =
    iframe.getAttribute?.('src') ||
    iframe.src ||
    (rcInst && typeof rcInst.iframeSrc === 'function' ? String(rcInst.iframeSrc() || '') : '') ||
    '';
  const rawSrc = String(rawCandidate).match(/https?:\/\/[^\s"'<>)+]+/)?.[0] || String(rawCandidate);
  if (!rawSrc) {
    return { promoted: false, state: FRAME_PROMOTION_STATE.IDLE, dispose() {} };
  }

  iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.PREFLIGHT;

  let parsedUrl;
  try {
    parsedUrl = new URL(rawSrc, win.location?.href || 'https://localhost');
  } catch {
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
    return { promoted: false, state: FRAME_PROMOTION_STATE.ROLLED_BACK, dispose() {} };
  }

  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.searchParams.get('iframe') !== 'true'
  ) {
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
    return { promoted: false, state: FRAME_PROMOTION_STATE.ROLLED_BACK, dispose() {} };
  }

  const trustedStaticHosts = new Set();
  for (const staticOrig of hostConfig.staticCdnOrigins || []) {
    try {
      const su = new URL(String(staticOrig));
      if (su.protocol === 'https:') {
        trustedStaticHosts.add(su.hostname.toLowerCase());
      }
    } catch {
      // Ignore invalid static origin
    }
  }
  let cdnOriginParsed = null;
  try {
    cdnOriginParsed = new URL(String(hostConfig.cdnOrigin || ''));
    if (cdnOriginParsed.protocol === 'https:') {
      trustedStaticHosts.add(cdnOriginParsed.hostname.toLowerCase());
    }
  } catch {
    cdnOriginParsed = null;
  }

  const candidateHost = parsedUrl.hostname.toLowerCase();
  if (!trustedStaticHosts.has(candidateHost) && !hostConfig.isRemoteHost(candidateHost)) {
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
    return { promoted: false, state: FRAME_PROMOTION_STATE.ROLLED_BACK, dispose() {} };
  }

  const cdnPathPrefix = `/${String(hostConfig.cdnPathPrefix || '/web/').replace(/^\/+|\/+$/g, '')}/`;
  const rawPathname = parsedUrl.pathname;
  const htmlMatch = rawPathname.match(/\/([^/]+)\.html?$/i);
  const htmlEntryStem = htmlMatch && htmlMatch[1].toLowerCase() !== 'index' ? htmlMatch[1] : '';
  const dirPathname = htmlMatch ? rawPathname.slice(0, -htmlMatch[0].length) : rawPathname.replace(/\/+$/, '');
  const prefixPos = dirPathname.indexOf(cdnPathPrefix);
  const basePath = (prefixPos >= 0 ? dirPathname.slice(prefixPos) : dirPathname).replace(/\/+$/, '');

  if (
    !basePath.startsWith(cdnPathPrefix) ||
    !basePath.slice(cdnPathPrefix.length) ||
    hasPathTraversal(dirPathname) ||
    /["'<>\\\s]/.test(dirPathname)
  ) {
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
    return { promoted: false, state: FRAME_PROMOTION_STATE.ROLLED_BACK, dispose() {} };
  }

  const afterPrefix = basePath.slice(cdnPathPrefix.length);
  const appVersion = afterPrefix.split('/')[0] || '2.33.0';
  const cdnBaseUrl =
    cdnOriginParsed && parsedUrl.origin === cdnOriginParsed.origin
      ? `${parsedUrl.origin}${dirPathname}`
      : `${hostConfig.cdnOrigin}${basePath}`;

  const isAllowedScriptUrl = buildAllowedScriptUrlValidator(hostConfig, win);
  const ttPolicyCtrl = getOrCreateTrustedTypesPolicy(win, {
    policyNames: hostConfig.trustedTypesPolicyNames,
    isAllowedScriptUrl,
  });

  const prismUrl = htmlEntryStem ? '' : `${cdnBaseUrl}/prism_bundle.js`;
  const mainUrl = `${cdnBaseUrl}/${htmlEntryStem || 'main'}.js`;
  let trustedPrismUrl = null;
  let trustedMainUrl;
  try {
    if (prismUrl) {
      trustedPrismUrl = ttPolicyCtrl.toScriptURL(prismUrl);
    }
    trustedMainUrl = ttPolicyCtrl.toScriptURL(mainUrl);
    const probeScript = doc.createElement?.('script');
    if (probeScript) {
      probeScript.src = trustedMainUrl;
    }
  } catch {
    // AUDIT-M1: TrustedScriptURL preflight blocked — fail closed before touching live iframe.src
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
    iframe.__agyMcpPromotionFailed = true;
    return { promoted: false, state: FRAME_PROMOTION_STATE.ROLLED_BACK, dispose() {} };
  }

  const promotionStore = new DisposableStore();
  const activeWorkerBridges = new Set();

  iframe.__agyRemotePromotionOwner = 'mcp-manager';
  win.__agyRemotePromotionOwner = 'mcp-manager';
  iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.PROMOTING;
  iframe.__agyMcpPromoted = version;

  const releaseSuppression = incrementIframeSuppression(rcInst);

  const savedChildPath = String(
    new URLSearchParams(win.location?.search || '').get('p') ||
      rcInst?.lastSyncedChildPath ||
      rcInst?.initialChildPath ||
      ''
  ).replace(/^\/+/, '');
  if (savedChildPath && rcInst) {
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

  const IframeCtor =
    win?.HTMLIFrameElement || (typeof HTMLIFrameElement !== 'undefined' ? HTMLIFrameElement : null);
  const origSrcDesc =
    IframeCtor && iframe instanceof IframeCtor && IframeCtor.prototype
      ? Object.getOwnPropertyDescriptor(IframeCtor.prototype, 'src')
      : null;

  const hostOrigin = win.location?.origin || parsedUrl.origin;
  const canonicalFrameUrl = `${hostOrigin}${basePath}/${parsedUrl.search || '?iframe=true'}`;

  let childWindowRef = null;
  let hadOwnChildDec = false;
  let prevChildDec = undefined;
  let wrappedChildDec = null;
  let capturedLsByThisPromotion = null;
  let rolledBack = false;
  let readyNotified = false;
  let fallbackTimerDisp = null;

  const cleanupWorkers = () => {
    for (const bridge of Array.from(activeWorkerBridges)) {
      try {
        bridge.terminate();
      } catch {
        // Ignore
      }
    }
    activeWorkerBridges.clear();
  };

  const unspoofIframeSrcProperty = () => {
    try {
      delete iframe.src;
    } catch {
      // Ignore
    }
  };

  const restoreDecoratorAndGlobals = () => {
    try {
      const targetCw = childWindowRef || iframe.contentWindow;
      if (targetCw) {
        if (wrappedChildDec && targetCw.__JETSKI_LS_CLIENT_DECORATOR__ === wrappedChildDec) {
          if (hadOwnChildDec) targetCw.__JETSKI_LS_CLIENT_DECORATOR__ = prevChildDec;
          else delete targetCw.__JETSKI_LS_CLIENT_DECORATOR__;
        }
        delete targetCw.__agyCapturedLsClient;
      }
      if (
        capturedLsByThisPromotion &&
        win.__agyCapturedLsClient === capturedLsByThisPromotion &&
        !win.agyStatusBar
      ) {
        delete win.__agyCapturedLsClient;
      }
    } catch {
      // Ignore cross-origin access after navigation
    }
  };

  const setNativeIframeSrc = (targetSrc) => {
    if (origSrcDesc && typeof origSrcDesc.set === 'function') {
      origSrcDesc.set.call(iframe, targetSrc);
    } else {
      iframe.setAttribute?.('src', targetSrc);
      iframe.src = targetSrc;
    }
  };

  const rollbackToOriginalSrc = () => {
    if (rolledBack) return;
    rolledBack = true;
    if (fallbackTimerDisp) {
      fallbackTimerDisp.dispose();
      fallbackTimerDisp = null;
    }
    cleanupWorkers();
    releaseSuppression();
    restoreDecoratorAndGlobals();
    unspoofIframeSrcProperty();
    promotionStore.dispose();

    delete iframe.__agyMcpPromoted;
    delete iframe.__agyMcpRestorePromotion;
    if (iframe.__agyRemotePromotionOwner === 'mcp-manager') {
      delete iframe.__agyRemotePromotionOwner;
    }
    if (win.__agyRemotePromotionOwner === 'mcp-manager') {
      delete win.__agyRemotePromotionOwner;
    }
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
    iframe.__agyMcpPromotionFailed = true;
    try {
      setNativeIframeSrc(rawSrc);
    } catch {
      // Ignore detached iframe errors
    }
  };

  const cleanupPromotedIframeOnDestroy = () => {
    if (fallbackTimerDisp) {
      fallbackTimerDisp.dispose();
      fallbackTimerDisp = null;
    }
    cleanupWorkers();
    releaseSuppression();
    restoreDecoratorAndGlobals();
    unspoofIframeSrcProperty();
    promotionStore.dispose();

    if (iframe.__agyRemotePromotionOwner === 'mcp-manager') {
      delete iframe.__agyRemotePromotionOwner;
    }
    if (win.__agyRemotePromotionOwner === 'mcp-manager') {
      delete win.__agyRemotePromotionOwner;
    }
    delete iframe.__agyRemotePromotionState;
    delete iframe.__agyMcpPromoted;
    delete iframe.__agyMcpPromotionFailed;
    delete iframe.__agyMcpRestorePromotion;
  };

  const notifyReadyOnce = () => {
    if (readyNotified || rolledBack) return;
    readyNotified = true;
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.READY;
    if (typeof onReady === 'function') {
      onReady();
    }
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

      if (typeof cd.open === 'function' && typeof cd.close === 'function') {
        cd.open();
        cd.close();
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
      installChildAssetAdapter({
        cw,
        cd,
        nonce,
        cdnBaseUrl,
        hostOrigin,
        hostConfig,
        ttPolicyCtrl,
        installWorkerConstructorAdapter(origCreateEl) {
          installCdnWorkerAdapter({
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
          });
        },
      });

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

      cw.history?.replaceState?.(null, '', buildInitialIframeHistoryUrl());
      try {
        Object.defineProperty(cd, 'referrer', {
          configurable: true,
          get: () => win.location?.href || '',
        });
      } catch {
        // Ignore
      }

      const dynamicCsrfToken = String(
        win?.__APP_CONFIG__?.csrfToken || rcInst?.csrfToken || hostConfig.remoteCsrfToken || ''
      );
      cw.__APP_CONFIG__ = {
        productName: String(win?.__APP_CONFIG__?.productName || 'antigravity'),
        csrfToken: dynamicCsrfToken,
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

      if (typeof cw.addEventListener === 'function' && !cw.__agyMsgBufferInstalled) {
        cw.__agyMsgBufferInstalled = true;
        const msgListeners = new Set();
        const origAddEv = cw.addEventListener.bind(cw);
        const origRemoveEv = typeof cw.removeEventListener === 'function' ? cw.removeEventListener.bind(cw) : null;
        origAddEv('message', (ev) => {
          const msgType = String(ev?.data?.type || '');
          if (msgType === 'INITIAL_CONFIG' || msgType.endsWith('-v2') || (ev?.ports && ev.ports.length > 0)) {
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
                listener.call(cw, bufferedEv);
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

      let prismScript = null;
      if (trustedPrismUrl) {
        prismScript = cd.createElement('script');
        if (nonce) {
          prismScript.nonce = nonce;
          prismScript.setAttribute?.('nonce', nonce);
        }
        prismScript.async = false;
        prismScript.src = trustedPrismUrl;
      }

      const mainScript = cd.createElement('script');
      if (nonce) {
        mainScript.nonce = nonce;
        mainScript.setAttribute?.('nonce', nonce);
      }
      mainScript.async = false;
      mainScript.src = trustedMainUrl;

      const markPromotedReady = () => {
        if (rcInst) {
          if (typeof rcInst.markIframeReady === 'function') {
            rcInst.markIframeReady();
          } else {
            rcInst.iframeLoading?.set?.(false);
            rcInst.iframeUiReady?.set?.(true);
          }
        }
        notifyReadyOnce();
      };

      const onMainScriptLoad = () => {
        releaseSuppression();
        cw.__agyMainBooted = true;
        if (savedChildPath && rcInst) rcInst.initialChildPath = savedChildPath;
        let loadRet = null;
        if (rcInst && remoteLease && !cw.__initialConfigReceived && !cw.__agyOnIframeLoadCalled) {
          cw.__agyOnIframeLoadCalled = true;
          loadRet = remoteLease.invokeOriginalOnIframeLoad(rcInst);
        }
        if (loadRet && typeof loadRet.then === 'function') {
          loadRet.then(markPromotedReady, markPromotedReady);
        } else {
          markPromotedReady();
        }
      };

      const onMainScriptError = () => {
        rollbackToOriginalSrc();
      };

      if (typeof mainScript.addEventListener === 'function') {
        promotionStore.add(disposableEvent(mainScript, 'load', onMainScriptLoad, { once: true }));
        promotionStore.add(disposableEvent(mainScript, 'error', onMainScriptError, { once: true }));
      } else {
        mainScript.onload = onMainScriptLoad;
        mainScript.onerror = onMainScriptError;
      }

      if (headEl && typeof headEl.appendChild === 'function') {
        if (prismScript) headEl.appendChild(prismScript);
        headEl.appendChild(mainScript);
      } else {
        rollbackToOriginalSrc();
      }
    } catch {
      rollbackToOriginalSrc();
    }
  };

  unspoofIframeSrcProperty();
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
    if (fallbackTimerDisp) {
      fallbackTimerDisp.dispose();
      fallbackTimerDisp = null;
    }
    onBlankLoad();
  };

  promotionStore.add(disposableEvent(iframe, 'load', triggerBlankLoadOnce));

  try {
    setNativeIframeSrc('about:blank');
  } catch {
    rollbackToOriginalSrc();
    return { promoted: false, state: FRAME_PROMOTION_STATE.ROLLED_BACK, dispose() {} };
  }

  try {
    Object.defineProperty(iframe, 'src', {
      configurable: true,
      enumerable: true,
      get: () => rawSrc,
      set: (nextSrc) => {
        rolledBack = true;
        cleanupPromotedIframeOnDestroy();
        setNativeIframeSrc(nextSrc);
      },
    });
  } catch {
    // Ignore non-configurable mock iframe.src
  }

  iframe.__agyMcpRestorePromotion = cleanupPromotedIframeOnDestroy;

  const isNativeDomIframe = Boolean(win.HTMLIFrameElement && iframe instanceof win.HTMLIFrameElement);
  fallbackTimerDisp = disposableTimeout(win, triggerBlankLoadOnce, isNativeDomIframe ? 120 : 20);
  promotionStore.add(fallbackTimerDisp);

  return {
    promoted: true,
    get state() {
      return iframe.__agyRemotePromotionState || FRAME_PROMOTION_STATE.PROMOTING;
    },
    dispose: cleanupPromotedIframeOnDestroy,
  };
}

/**
 * Watches `doc` for `<ga-remote-control> iframe` appearance and promotes it automatically.
 *
 * @param {{
 *   win: any,
 *   doc: any,
 *   hostConfig: any,
 *   remoteLease: any,
 *   onPromotedReady?: () => void,
 *   version?: string
 * }} deps
 */
function createRemoteFramePromoterCoordinator(deps) {
  const { win, doc, hostConfig, remoteLease, onPromotedReady, version = '2.0.0' } = deps;
  const store = new DisposableStore();
  const activePromotions = new Map();

  function checkAndPromote() {
    if (store.isDisposed || !doc || typeof doc.querySelector !== 'function') return;
    let iframe = null;
    try {
      iframe = doc.querySelector('ga-remote-control iframe');
    } catch {
      return;
    }
    if (!iframe || activePromotions.has(iframe)) return;

    const handle = promoteCrossOriginRemoteIframe({
      win,
      doc,
      iframe,
      hostConfig,
      remoteLease,
      onReady: onPromotedReady,
      version,
    });
    if (handle.promoted || handle.state === FRAME_PROMOTION_STATE.PASSIVE_ATTACHED) {
      activePromotions.set(iframe, handle);
    }
  }

  function start() {
    if (store.isDisposed) return;
    checkAndPromote();

    const ObserverCtor =
      (win && typeof win.MutationObserver === 'function' ? win.MutationObserver : null) ||
      (typeof MutationObserver === 'function' ? MutationObserver : null);
    if (ObserverCtor && doc && (doc.body || doc.documentElement)) {
      const obs = new ObserverCtor(() => checkAndPromote());
      store.add(
        disposableObserver(obs, doc.body || doc.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['src'],
        })
      );
    }
  }

  store.add({
    dispose() {
      for (const handle of activePromotions.values()) {
        handle.dispose();
      }
      activePromotions.clear();
    },
  });

  return {
    start,
    checkAndPromote,
    dispose: () => store.dispose(),
  };
}

module.exports = {
  FRAME_PROMOTION_STATE,
  inspectPromotionOwnership,
  promoteCrossOriginRemoteIframe,
  createRemoteFramePromoterCoordinator,
};
