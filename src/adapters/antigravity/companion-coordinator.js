'use strict';

/**
 * Remote Companion Script Coordinator (`antigravity-statusbar`, `ko-thought-translator`).
 *
 * Uses `DisposableStore`-tracked `1500ms` retry timers so `dispose()` cancels pending
 * companion retries immediately (`AUDIT-M6` / `MCP-TC-029` / `MCP-TC-049`).
 */

const { DisposableStore } = require('../../core/disposable');
const { getOrCreateTrustedTypesPolicy, getScriptNonce } = require('../../security/trusted-types');
const { disposableTimeout } = require('../../shared/dom-disposables');
const { buildAllowedScriptUrlValidator } = require('./host-config');

const COMPANION_RETRY_DELAY_MS = 1500;
const MAX_COMPANION_RETRIES = 4;

/**
 * @param {{
 *   win: any,
 *   doc: any,
 *   hostConfig: any,
 *   rpcTransport: any
 * }} deps
 */
function createCompanionCoordinator(deps) {
  const { win, doc, hostConfig, rpcTransport } = deps;
  const store = new DisposableStore();
  const injectedUrls = new Set();
  let retryCount = 0;
  let activeRetryDisp = null;

  const isAllowedScriptUrl = buildAllowedScriptUrlValidator(hostConfig, win);

  function isRemoteEnvironment() {
    if (!win || !doc) return false;
    try {
      if (typeof doc.querySelector === 'function' && doc.querySelector('ga-remote-control')) {
        return true;
      }
      const host = String(win.location?.hostname || '').toLowerCase();
      return hostConfig.isRemoteHost(host);
    } catch {
      return false;
    }
  }

  function injectApprovedCompanionScript(url, dataAttr) {
    if (store.isDisposed || !doc || typeof doc.createElement !== 'function') return false;
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl || !isAllowedScriptUrl(cleanUrl)) return false;
    if (injectedUrls.has(cleanUrl)) return true;

    if (typeof doc.querySelector === 'function') {
      const existing = doc.querySelector(`script[data-agy-companion="${dataAttr}"]`);
      if (existing) {
        injectedUrls.add(cleanUrl);
        return true;
      }
    }

    const ttCtrl = getOrCreateTrustedTypesPolicy(win, {
      policyNames: hostConfig.trustedTypesPolicyNames,
      isAllowedScriptUrl,
    });

    let safeSrc;
    try {
      safeSrc = ttCtrl.toScriptURL(cleanUrl);
    } catch {
      return false;
    }

    const scriptEl = doc.createElement('script');
    const nonce = getScriptNonce(doc);
    if (nonce) {
      scriptEl.nonce = nonce;
      scriptEl.setAttribute?.('nonce', nonce);
    }
    scriptEl.async = true;
    scriptEl.setAttribute?.('data-agy-companion', dataAttr);
    scriptEl.src = safeSrc;

    const parent = doc.head || doc.body || doc.documentElement;
    if (!parent || typeof parent.appendChild !== 'function') return false;
    parent.appendChild(scriptEl);
    injectedUrls.add(cleanUrl);
    return true;
  }

  async function syncCompanionsOnce() {
    if (store.isDisposed || !isRemoteEnvironment()) return;

    let pluginInfo = win && win.__agyHostInstalledPlugins ? win.__agyHostInstalledPlugins : null;
    if (!pluginInfo && rpcTransport.isAvailable()) {
      pluginInfo = await rpcTransport.fetchHostInstalledPluginInfo();
    }
    if (store.isDisposed) return;

    if (!pluginInfo) {
      if (retryCount < MAX_COMPANION_RETRIES) {
        retryCount += 1;
        if (activeRetryDisp) activeRetryDisp.dispose();
        activeRetryDisp = disposableTimeout(
          win,
          () => {
            activeRetryDisp = null;
            void syncCompanionsOnce();
          },
          COMPANION_RETRY_DELAY_MS
        );
        store.add(activeRetryDisp);
      }
      return;
    }

    if (pluginInfo.hasStatusbar && !win.agyStatusBar && hostConfig.companionUrls?.statusbar) {
      injectApprovedCompanionScript(hostConfig.companionUrls.statusbar, 'statusbar');
    }
    if (
      pluginInfo.hasKoTranslator &&
      !win.agyKoThoughtTranslator &&
      !win.__agyKoLocalizerActive &&
      hostConfig.companionUrls?.koTranslator
    ) {
      injectApprovedCompanionScript(hostConfig.companionUrls.koTranslator, 'ko-thought-translator');
    }
  }

  function start() {
    if (store.isDisposed) return;
    void syncCompanionsOnce();
  }

  return {
    start,
    syncCompanionsOnce,
    injectApprovedCompanionScript,
    dispose() {
      if (activeRetryDisp) {
        activeRetryDisp.dispose();
        activeRetryDisp = null;
      }
      store.dispose();
    },
  };
}

module.exports = {
  COMPANION_RETRY_DELAY_MS,
  createCompanionCoordinator,
};
