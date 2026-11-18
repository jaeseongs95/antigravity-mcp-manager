'use strict';

/**
 * Orchestrator Entry Point (`antigravity-mcp-manager` `v1.5.0`).
 *
 * Composes single-responsibility modules:
 * - `host-adapter-config.js`: Vendor/RPC/CDN/domain configuration boundary.
 * - `mcp-config-schema.js`: Smart input parser, OAuth/auth header builders & JSON schema validation.
 * - `remote-runtime.js`: Isolated `RemoteControlComponent` lease & companion manifest parser.
 * - `companion-loader.js`: Scoped `TrustedTypes` policy, CSP nonce propagation & companion script loader.
 * - `remote-frame-promoter.js`: Explicit FSM for cross-origin Remote Control workbench adaptation.
 * - `host-mcp-bridge.js`: React Fiber / Remote `proxyCommand` RPC bridge & serialized `mcp_config.json` I/O.
 * - `modal-ui.js`: Trusted-Types-safe standalone manager, server editor, OAuth modal & Settings pane.
 * - `native-dom-integrator.js`: Settings sidebar tab, Customizations buttons & non-invasive remote host launcher.
 */

const { resolveHostAdapterConfig } = require('./host-adapter-config');
const schema = require('./mcp-config-schema');
const { createHostMcpBridge } = require('./host-mcp-bridge');
const {
  ensureRemoteCompanionScripts,
  disposeTrustedTypesPolicy,
} = require('./companion-loader');
const { promoteCrossOriginRemoteIframe } = require('./remote-frame-promoter');
const {
  ensureModalStyles,
  createModalController,
} = require('./modal-ui');
const {
  cleanupLegacyStatusBarArtifacts,
  isOwnMcpNode,
  isRelevantMutationList,
  createNativeDomIntegrator,
} = require('./native-dom-integrator');

const MCP_MANAGER_VERSION = 'v1.5.0';

function mountMcpManager(env = {}) {
  const win = env.window || (typeof window !== 'undefined' ? window : null);
  const doc = env.document || (win && win.document ? win.document : null);
  if (!win || !doc || !doc.body) return null;

  cleanupLegacyStatusBarArtifacts(win, doc);

  if (win.agyMcpManager && win.agyMcpManager.version === MCP_MANAGER_VERSION) {
    if (typeof win.agyMcpManager.__rebindIfBodyReplaced === 'function') {
      win.agyMcpManager.__rebindIfBodyReplaced();
    }
    return win.agyMcpManager;
  }
  if (win.agyMcpManager && typeof win.agyMcpManager.destroy === 'function') {
    try {
      win.agyMcpManager.destroy();
    } catch {}
  }

  ensureModalStyles(doc);

  const resolvedHostCfg = resolveHostAdapterConfig(env.hostConfig || env.bridge?.hostConfig, win);
  const bridge = env.bridge || createHostMcpBridge({ window: win, document: doc, hostConfig: resolvedHostCfg });
  const modal = createModalController({
    doc,
    bridge,
  });

  let isChildFrame = false;
  try {
    isChildFrame = Boolean(win && win.parent && win.parent !== win);
  } catch {}

  const isRemoteHostPage =
    !isChildFrame &&
    (resolvedHostCfg.isRemoteHost(win?.location?.hostname) ||
      Boolean(doc?.querySelector?.('ga-remote-control'))) &&
    Boolean(doc?.head);
  let companionCheckDone = !(isRemoteHostPage && bridge && typeof bridge.fetchHostInstalledPluginInfo === 'function');
  let hostHasKoTranslator = false;
  let destroyed = false;
  const boundRemoteIframes = new Set();

  function mountIntoChildFrame(childWin, childDoc) {
    if (destroyed || !childWin || !childDoc || !childDoc.body) return null;
    if (!childWin.agyMcpManager || childWin.agyMcpManager.version !== MCP_MANAGER_VERSION) {
      return mountMcpManager({
        window: childWin,
        document: childDoc,
        bridge,
        hostConfig: resolvedHostCfg,
      });
    }
    if (typeof childWin.agyMcpManager.__rebindIfBodyReplaced === 'function') {
      childWin.agyMcpManager.__rebindIfBodyReplaced();
    }
    return childWin.agyMcpManager;
  }

  if (!isChildFrame) {
    win.__agyMountMcpManager = mountIntoChildFrame;
  }

  function ensureRemoteIframeMounted() {
    if (destroyed) return false;
    const rawList = doc.querySelectorAll ? Array.from(doc.querySelectorAll('ga-remote-control iframe')) : [];
    const singleFallback = rawList.length === 0 ? doc.querySelector?.('ga-remote-control iframe') : null;
    const iframes = singleFallback ? [singleFallback] : rawList;
    if (iframes.length === 0) return false;

    let anyMounted = false;
    for (const iframe of iframes) {
      if (!iframe) continue;
      if (!iframe.__agyMcpLoadBound && typeof iframe.addEventListener === 'function') {
        const onIframeLoad = () => {
          if (destroyed) return;
          ensureRemoteIframeMounted();
        };
        iframe.__agyMcpLoadBound = true;
        iframe.__agyMcpLoadHandler = onIframeLoad;
        boundRemoteIframes.add(iframe);
        iframe.addEventListener('load', onIframeLoad);
      }
      try {
        const iframeWin = iframe.contentWindow;
        const iframeDoc = iframe.contentDocument || iframeWin?.document;
        if (iframeWin && iframeDoc && iframeDoc.body) {
          mountIntoChildFrame(iframeWin, iframeDoc);
          anyMounted = true;
        }
      } catch {
        if (
          companionCheckDone &&
          !hostHasKoTranslator &&
          !win.__agyHostInstalledPlugins?.hasKoTranslator &&
          !win.__agyKoLocalizerActive &&
          !win.__agyLoadingKoThoughtCompanion &&
          !win.__agyLoadingKoTranslatorCompanion &&
          !win.__agyKoSyncingCompanions &&
          !win.__agyKoThoughtCleanup &&
          !iframe.__agyKoPromoted &&
          !iframe.__agyPromoted
        ) {
          promoteCrossOriginRemoteIframe(
            win,
            doc,
            iframe,
            bridge,
            () => {
              if (!destroyed) ensureRemoteIframeMounted();
            },
            MCP_MANAGER_VERSION
          );
        }
      }
    }
    return anyMounted;
  }

  const domIntegrator = createNativeDomIntegrator({
    doc,
    modal,
    bridge,
    isRemoteHostPage,
    onEnsureRemoteIframeMounted: ensureRemoteIframeMounted,
  });

  if (!isChildFrame) {
    const applyCompanionResult = (res, retriesExhausted) => {
      if (destroyed) return;
      if (
        res?.hostInfo?.hasKoTranslator ||
        win.__agyHostInstalledPlugins?.hasKoTranslator ||
        (Array.isArray(res?.loaded) && res.loaded.includes('ko-thought-translator'))
      ) {
        hostHasKoTranslator = true;
      }
      if (!res?.hostInfo || res.hostInfo.resolved !== false || retriesExhausted) {
        companionCheckDone = true;
      }
      ensureRemoteIframeMounted();
    };
    ensureRemoteCompanionScripts(win, doc, bridge, resolvedHostCfg, applyCompanionResult)
      .then((res) => applyCompanionResult(res, false))
      .catch(() => {
        if (destroyed) return;
        companionCheckDone = true;
        ensureRemoteIframeMounted();
      });
  }

  const hasSettledChildManager = () => {
    try {
      const ifr = doc.querySelector?.('ga-remote-control iframe');
      const cw = ifr?.contentWindow;
      const cd = ifr?.contentDocument || cw?.document;
      if (!cw || !cd || !cd.body || cw.agyMcpManager?.version !== MCP_MANAGER_VERSION) return false;
      if (isRemoteHostPage) {
        const root = cd.getElementById?.('root');
        return Boolean(root && root.childElementCount > 0);
      }
      return true;
    } catch {
      return false;
    }
  };

  let remoteIframePollTimer = null;
  const initialMounted = ensureRemoteIframeMounted();
  if (!isChildFrame && doc.querySelector?.('ga-remote-control') && (!initialMounted || !hasSettledChildManager())) {
    let pollCount = 0;
    const setTimer =
      typeof win.setTimeout === 'function'
        ? win.setTimeout.bind(win)
        : (typeof setTimeout === 'function' ? setTimeout : null);
    const pollIframe = () => {
      remoteIframePollTimer = null;
      if (destroyed) return;
      pollCount += 1;
      ensureRemoteIframeMounted();
      if (hasSettledChildManager() || pollCount >= 20 || !setTimer || destroyed) return;
      remoteIframePollTimer = setTimer(pollIframe, 600);
      if (remoteIframePollTimer && typeof remoteIframePollTimer.unref === 'function') {
        remoteIframePollTimer.unref();
      }
    };
    if (setTimer) {
      remoteIframePollTimer = setTimer(pollIframe, 400);
      if (remoteIframePollTimer && typeof remoteIframePollTimer.unref === 'function') {
        remoteIframePollTimer.unref();
      }
    }
  }

  function injectIntoNativeMcpScreens() {
    if (destroyed || !doc.body) return;
    domIntegrator.injectIntoNativeMcpScreens();
  }

  injectIntoNativeMcpScreens();

  let observer = null;
  let observedBody = null;
  let injectTimer = null;
  function attachBodyObserver() {
    if (!doc.body || typeof win.MutationObserver !== 'function') return;
    if (observer && observedBody === doc.body) return;
    if (observer) {
      try {
        observer.disconnect();
      } catch {}
    }
    observer = new win.MutationObserver((mutations) => {
      if (!isRelevantMutationList(mutations)) return;
      if (injectTimer) return;
      const setTimer = typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
      injectTimer = setTimer(() => {
        injectTimer = null;
        injectIntoNativeMcpScreens();
      }, 25);
    });
    observedBody = doc.body;
    observer.observe(doc.body, { childList: true, subtree: true });
  }
  attachBodyObserver();

  function rebindIfBodyReplaced() {
    const bodyReplaced = Boolean(doc.body && observedBody !== doc.body);
    const styleMissing = Boolean(
      doc.head && typeof doc.getElementById === 'function' && !doc.getElementById('agy-mcp-manager-styles')
    );
    if (!bodyReplaced && !styleMissing) return false;
    ensureModalStyles(doc);
    attachBodyObserver();
    injectIntoNativeMcpScreens();
    return true;
  }

  function onKeyDown(e) {
    if (!e) return;
    if (e.key === 'Escape') {
      if (modal.isOAuthConnectModalOpen()) {
        modal.closeOAuthConnectModal();
        return;
      }
      if (modal.isEditPopupOpen()) {
        modal.closeEditPopup();
        return;
      }
      if (modal.isOpen()) {
        modal.closeModal();
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'm') {
      e.preventDefault();
      if (modal.isOpen()) {
        modal.closeModal();
      } else {
        modal.openModal('servers');
      }
    }
  }
  win.addEventListener('keydown', onKeyDown);

  const controller = {
    version: MCP_MANAGER_VERSION,
    openModal: (tab) => modal.openModal(tab),
    closeModal: () => modal.closeModal(),
    isOpen: () => modal.isOpen(),
    openEditPopup: (serverName, options) => modal.openEditPopup(serverName, options),
    closeEditPopup: () => modal.closeEditPopup(),
    isEditPopupOpen: () => modal.isEditPopupOpen(),
    openOAuthConnectModal: (serverName, authUrl, options) => modal.openOAuthConnectModal(serverName, authUrl, options),
    closeOAuthConnectModal: () => modal.closeOAuthConnectModal(),
    isOAuthConnectModalOpen: () => modal.isOAuthConnectModalOpen(),
    renderSettingsPageContent: (container) => modal.renderSettingsPageContent(container),
    injectIntoNativeMcpScreens,
    __rebindIfBodyReplaced: rebindIfBodyReplaced,
    reload: () => modal.reloadData(),
    bridge,
    schema,
    destroy() {
      destroyed = true;
      if (win.__agyMcpDomReadyHandler) {
        if (typeof doc.removeEventListener === 'function') {
          doc.removeEventListener('DOMContentLoaded', win.__agyMcpDomReadyHandler);
        }
        delete win.__agyMcpDomReadyHandler;
      }
      if (injectTimer) {
        const clr = typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
        clr(injectTimer);
        injectTimer = null;
      }
      if (remoteIframePollTimer) {
        const clr = typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
        clr(remoteIframePollTimer);
        remoteIframePollTimer = null;
      }
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      win.removeEventListener('keydown', onKeyDown);
      modal.closeOAuthConnectModal();
      modal.closeEditPopup();
      modal.closeModal();
      cleanupLegacyStatusBarArtifacts(win, doc);
      domIntegrator.restoreNativeDom();

      const styleEl = doc.getElementById ? doc.getElementById('agy-mcp-manager-styles') : null;
      if (styleEl) {
        if (typeof styleEl.remove === 'function') styleEl.remove();
        else if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      }

      const iframesToClean = new Set(boundRemoteIframes);
      boundRemoteIframes.clear();
      if (doc.querySelectorAll) {
        doc.querySelectorAll('ga-remote-control iframe').forEach((ifr) => {
          if (ifr) iframesToClean.add(ifr);
        });
      }
      iframesToClean.forEach((ifr) => {
        try {
          if (typeof ifr.__agyMcpRestorePromotion === 'function') {
            ifr.__agyMcpRestorePromotion();
          }
        } catch {}
        try {
          if (ifr.__agyMcpLoadHandler && typeof ifr.removeEventListener === 'function') {
            ifr.removeEventListener('load', ifr.__agyMcpLoadHandler);
          }
          delete ifr.__agyMcpLoadHandler;
          delete ifr.__agyMcpLoadBound;
          delete ifr.__agyMcpPromotionFailed;
        } catch {}
        try {
          const childMgr = ifr?.contentWindow?.agyMcpManager;
          if (childMgr && childMgr !== controller && typeof childMgr.destroy === 'function') {
            childMgr.destroy();
          }
        } catch {}
      });

      if (bridge && typeof bridge.dispose === 'function') {
        try {
          bridge.dispose();
        } catch {}
      }
      try {
        disposeTrustedTypesPolicy(win);
        delete win.__agyLoadingStatusBarCompanion;
        delete win.__agyLoadingKoThoughtCompanion;
        delete win.__agyLoadingKoTranslatorCompanion;
        delete win.__agyProbingRcInstance;
        if (win.__agyMountMcpManager === mountIntoChildFrame) {
          delete win.__agyMountMcpManager;
        }
        if (!win.agyStatusBar) {
          delete win.__agyCapturedLsClient;
          delete win.__agyTrustedTypesPolicy;
          delete win.__agyTrustedHtmlPolicy;
        }
      } catch {}
      if (win.agyMcpManager === controller) {
        delete win.agyMcpManager;
        delete win.__agyMcpManagerActive;
      }
    },
  };

  win.agyMcpManager = controller;
  win.__agyMcpManagerActive = MCP_MANAGER_VERSION;
  return controller;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (window.__agyMcpDomReadyHandler && typeof document.removeEventListener === 'function') {
    document.removeEventListener('DOMContentLoaded', window.__agyMcpDomReadyHandler);
    delete window.__agyMcpDomReadyHandler;
  }
  if (document.readyState === 'loading') {
    const onDomReady = () => {
      if (window.__agyMcpDomReadyHandler === onDomReady) {
        delete window.__agyMcpDomReadyHandler;
      }
      mountMcpManager();
    };
    window.__agyMcpDomReadyHandler = onDomReady;
    document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
  } else {
    mountMcpManager();
  }
}

module.exports = {
  MCP_MANAGER_VERSION,
  mountMcpManager,
  ensureRemoteCompanionScripts,
  cleanupLegacyStatusBarArtifacts,
  isOwnMcpNode,
  isRelevantMutationList,
  schema,
  createHostMcpBridge,
  createModalController,
};
