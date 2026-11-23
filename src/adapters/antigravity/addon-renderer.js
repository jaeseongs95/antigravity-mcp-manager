/**
 * AUTO-GENERATED AddonManifest.v2 Renderer Entry (`src/adapters/antigravity/addon-renderer.js`).
 * Source of truth: `src/adapters/antigravity/renderer/*.mjs` (run `npm run build:renderer`).
 *
 * Executed by `antigravity-native-addon-host` v2.0.0+ in Isolated World `998` as
 * `(function(addonHost){ ... })(__addonHandle)` under `trustLevel: "restricted"`.
 * ZERO unsafe DOM sinks, ZERO direct `app.asar` hooks, 100% owner/Shadow DOM scoped APIs.
 */

(function (addonHost) {
  'use strict';

  if (!addonHost || typeof addonHost.mountSlot !== "function" || typeof addonHost.openModal !== "function") {
    return;
  }

  // --- module: host-runtime.mjs ---
  /**
   * Host Capability Runtime Adapter (`src/adapters/antigravity/renderer/host-runtime.mjs`).
   *
   * SOLID Boundaries:
   * - SRP: Owns `AddonManifest.v2` `addonHost` capability handle delegation (Shadow DOM
   *   Option B2 `mountSlot({ container })`, `openModal`, slot-scoped `injectStyle`,
   *   `addManagedListener`), loopback URL validation, namespaced language storage (with
   *   1-time migration from legacy v2.1 key), theme URL building, origin/source-validated
   *   iframe `postMessage` checks, and the zero-`innerHTML` EN/KO Native Sidecar launcher view.
   * - DIP: Renderer mount adapters depend on this narrow capability port rather than
   *   raw global `window.__ADDON_HOST_API__`, un-namespaced `localStorage`, or direct
   *   `<style>` DOM injection.
   */
  const SLOT_IDS = Object.freeze({
    SETTINGS_PANE: 'antigravity-mcp-manager.pane',
    SETTINGS_NAV: 'antigravity-mcp-manager.settings-nav',
    CUSTOMIZATIONS_BTN: 'antigravity-mcp-manager.customizations-btn',
    CUSTOMIZATIONS_OVERLAY: 'antigravity-mcp-manager.customizations-overlay',
  });
  const FRAME_ATTR = 'data-agy-mcp-manager-frame';
  const LAUNCHER_ATTR = 'data-agy-mcp-sidecar-launcher';
  const LEGACY_LANG_STORAGE_KEY = 'agy-mcp-manager-lang';

  const LAUNCHER_COPY = Object.freeze({
    en: Object.freeze({
      title: 'MCP Manager',
      badge: 'AddonManifest.v2 · Restricted',
      status: 'Native Sidecar (AUX_PANE) Active',
      lead: 'Running in Antigravity Native Addon Host v2+ restricted mode with Shadow DOM isolation and zero elevated main-process hooks.',
      stepsHeading: 'How to manage MCP servers',
      steps: Object.freeze([
        'Open the MCP Manager panel from Antigravity Native Sidecar (Aux Pane) to inspect and edit your servers.',
        'All edits write atomically to ~/.gemini/config/mcp_config.json with CAS conflict guards and secret redaction.',
        'This embedded view upgrades automatically to a live panel if your host exposes a loopback SidecarBridge URL.',
      ]),
      configLabel: 'Config File',
      configPath: '~/.gemini/config/mcp_config.json',
      surfaceSettings: 'Settings Integration',
      surfaceCustomizations: 'Customizations Overlay',
    }),
    ko: Object.freeze({
      title: 'MCP 매니저',
      badge: 'AddonManifest.v2 · Restricted',
      status: '네이티브 Sidecar (AUX_PANE) 활성',
      lead: 'Antigravity Native Addon Host v2+ restricted 모드(Shadow DOM 격리, 메인 프로세스 훅 미사용)로 안전하게 실행 중입니다.',
      stepsHeading: 'MCP 서버 관리 방법',
      steps: Object.freeze([
        'Antigravity 공식 네이티브 Sidecar (Aux Pane)에서 MCP Manager 패널을 열어 서버를 조회·편집하세요.',
        '모든 변경은 CAS 충돌 방지 및 시크릿 마스킹과 함께 ~/.gemini/config/mcp_config.json에 원자적으로 저장됩니다.',
        '향후 호스트가 loopback SidecarBridge URL을 제공하면 이 임베디드 화면이 자동으로 실시간 패널로 전환됩니다.',
      ]),
      configLabel: '설정 파일',
      configPath: '~/.gemini/config/mcp_config.json',
      surfaceSettings: 'Settings 통합',
      surfaceCustomizations: 'Customizations 오버레이',
    }),
  });
  function isSafeLoopbackIframeUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
    try {
      const parsed = new URL(rawUrl);
      return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && Boolean(parsed.port);
    } catch {
      return false;
    }
  }
  function normalizedText(el) {
    return String(el?.textContent || '').trim().toLowerCase();
  }
  function hasVisibleBg(el, win = window) {
    const bg = win.getComputedStyle(el)?.backgroundColor || '';
    return Boolean(bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent');
  }
  function replaceLeafText(root, nextText, doc = document) {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let current = walker.nextNode();
    while (current) {
      if (current.nodeValue && current.nodeValue.trim()) {
        textNodes.push(current);
      }
      current = walker.nextNode();
    }
    if (textNodes.length > 0) {
      textNodes[0].nodeValue = nextText;
      for (let i = 1; i < textNodes.length; i += 1) {
        textNodes[i].nodeValue = '';
      }
    } else {
      root.textContent = nextText;
    }
  }
  function sameFrameBaseAndTheme(currentSrc, nextSrc) {
    try {
      const a = new URL(currentSrc);
      const b = new URL(nextSrc);
      a.searchParams.delete('lang');
      b.searchParams.delete('lang');
      return a.toString() === b.toString();
    } catch {
      return currentSrc === nextSrc;
    }
  }
  function getSlotHostElement(rootEl) {
    if (!rootEl) return null;
    const root = typeof rootEl.getRootNode === 'function' ? rootEl.getRootNode() : null;
    return root && root.host ? root.host : rootEl;
  }
  function assertAddonHostHandle(addonHost) {
    if (!addonHost || typeof addonHost !== 'object') {
      throw new Error('ERR_MISSING_ADDON_HOST_HANDLE');
    }
    for (const method of ['mountSlot', 'unmountSlot', 'injectStyle', 'removeStyle', 'openModal', 'onDispose']) {
      if (typeof addonHost[method] !== 'function') {
        throw new Error(`ERR_INVALID_ADDON_HOST_HANDLE:${method}`);
      }
    }
    return addonHost;
  }
  function createSidecarLauncherView({ runtime, surface = 'settings', onLangChange = () => {}, doc = document }) {
    const container = doc.createElement('section');
    container.setAttribute(LAUNCHER_ATTR, 'true');
    container.setAttribute('data-agy-mcp-surface', surface);

    const card = doc.createElement('div');
    card.setAttribute('data-agy-mcp-launcher-card', 'true');

    const header = doc.createElement('header');
    header.setAttribute('data-agy-mcp-launcher-header', 'true');

    const titleWrap = doc.createElement('div');
    titleWrap.setAttribute('data-agy-mcp-launcher-title-wrap', 'true');

    const titleEl = doc.createElement('h2');
    titleEl.setAttribute('data-agy-mcp-launcher-title', 'true');

    const badgeEl = doc.createElement('span');
    badgeEl.setAttribute('data-agy-mcp-launcher-badge', 'true');

    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(badgeEl);

    const langGroup = doc.createElement('div');
    langGroup.setAttribute('data-agy-mcp-lang-switch', 'true');
    langGroup.setAttribute('role', 'group');
    langGroup.setAttribute('aria-label', 'Language');

    const enBtn = doc.createElement('button');
    enBtn.type = 'button';
    enBtn.setAttribute('data-agy-mcp-lang-btn', 'en');
    enBtn.textContent = 'EN';

    const koBtn = doc.createElement('button');
    koBtn.type = 'button';
    koBtn.setAttribute('data-agy-mcp-lang-btn', 'ko');
    koBtn.textContent = '한국어';

    const handleLangClick = (lang) => (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      runtime.writeSavedLang(lang);
      syncLang();
      onLangChange(lang);
    };
    enBtn.addEventListener('click', handleLangClick('en'));
    koBtn.addEventListener('click', handleLangClick('ko'));

    langGroup.appendChild(enBtn);
    langGroup.appendChild(koBtn);

    header.appendChild(titleWrap);
    header.appendChild(langGroup);

    const metaRow = doc.createElement('div');
    metaRow.setAttribute('data-agy-mcp-launcher-meta', 'true');

    const statusPill = doc.createElement('span');
    statusPill.setAttribute('data-agy-mcp-launcher-status', 'true');

    const surfaceTag = doc.createElement('span');
    surfaceTag.setAttribute('data-agy-mcp-launcher-surface', 'true');

    metaRow.appendChild(statusPill);
    metaRow.appendChild(surfaceTag);

    const leadEl = doc.createElement('p');
    leadEl.setAttribute('data-agy-mcp-launcher-lead', 'true');

    const stepsTitle = doc.createElement('h3');
    stepsTitle.setAttribute('data-agy-mcp-launcher-steps-title', 'true');

    const stepsList = doc.createElement('ol');
    stepsList.setAttribute('data-agy-mcp-launcher-steps', 'true');
    const stepItems = [doc.createElement('li'), doc.createElement('li'), doc.createElement('li')];
    for (const li of stepItems) {
      stepsList.appendChild(li);
    }

    const footer = doc.createElement('div');
    footer.setAttribute('data-agy-mcp-launcher-footer', 'true');

    const configLabelEl = doc.createElement('span');
    configLabelEl.setAttribute('data-agy-mcp-launcher-config-label', 'true');

    const configPathEl = doc.createElement('code');
    configPathEl.setAttribute('data-agy-mcp-launcher-config-path', 'true');

    footer.appendChild(configLabelEl);
    footer.appendChild(configPathEl);

    card.appendChild(header);
    card.appendChild(metaRow);
    card.appendChild(leadEl);
    card.appendChild(stepsTitle);
    card.appendChild(stepsList);
    card.appendChild(footer);
    container.appendChild(card);

    function syncLang() {
      const lang = runtime.readSavedLang() === 'ko' ? 'ko' : 'en';
      const copy = LAUNCHER_COPY[lang];
      container.setAttribute('data-agy-mcp-lang', lang);
      titleEl.textContent = copy.title;
      badgeEl.textContent = copy.badge;
      statusPill.textContent = copy.status;
      surfaceTag.textContent = surface === 'customizations' ? copy.surfaceCustomizations : copy.surfaceSettings;
      leadEl.textContent = copy.lead;
      stepsTitle.textContent = copy.stepsHeading;
      for (let i = 0; i < stepItems.length; i += 1) {
        stepItems[i].textContent = copy.steps[i] || '';
      }
      configLabelEl.textContent = copy.configLabel;
      configPathEl.textContent = copy.configPath;
      enBtn.setAttribute('aria-pressed', lang === 'en' ? 'true' : 'false');
      koBtn.setAttribute('aria-pressed', lang === 'ko' ? 'true' : 'false');
    }

    syncLang();

    return Object.freeze({
      element: container,
      syncLang,
    });
  }
  function createHostRuntime({ addonHost, win = window, doc = document }) {
    const host = assertAddonHostHandle(addonHost);
    const pluginId = String(host.pluginId || 'antigravity-mcp-manager');
    const trustLevel = String(host.trustLevel || 'restricted');
    const schemaVersion = Number(host.schemaVersion || 2);
    const storageNamespace = String(host.storageNamespace || pluginId);
    const ipcChannelPrefix = host.ipcChannelPrefix ? String(host.ipcChannelPrefix) : 'mcp-manager:';
    const langStorageKey = `${storageNamespace}:lang`;

    function readSavedLang() {
      try {
        const storage = win.localStorage;
        if (!storage) return '';
        const namespaced = storage.getItem(langStorageKey);
        if (namespaced === 'ko' || namespaced === 'en') return namespaced;
        // One-time migration from legacy v2.1.0 un-namespaced key
        const legacy = storage.getItem(LEGACY_LANG_STORAGE_KEY);
        if (legacy === 'ko' || legacy === 'en') {
          try {
            storage.setItem(langStorageKey, legacy);
          } catch {
            // Ignore write errors during migration
          }
          return legacy;
        }
        return '';
      } catch {
        return '';
      }
    }

    function writeSavedLang(lang) {
      if (lang !== 'ko' && lang !== 'en') return false;
      try {
        win.localStorage?.setItem(langStorageKey, lang);
        return true;
      } catch {
        return false;
      }
    }

    function getServerUrl() {
      const raw = win.__AGY_MCP_MANAGER_URL__;
      return isSafeLoopbackIframeUrl(raw) ? raw : '';
    }

    function bindServerUrlListener(callback) {
      if (typeof callback !== 'function') return () => {};
      const handler = (nextUrl) => {
        callback(isSafeLoopbackIframeUrl(nextUrl) ? nextUrl : '');
      };
      win.__AGY_MCP_ON_SERVER_URL__ = handler;
      return () => {
        if (win.__AGY_MCP_ON_SERVER_URL__ === handler) {
          try {
            delete win.__AGY_MCP_ON_SERVER_URL__;
          } catch {
            win.__AGY_MCP_ON_SERVER_URL__ = undefined;
          }
        }
      };
    }

    function buildThemedIframeUrl(baseUrl, contentPane) {
      try {
        const url = new URL(baseUrl);
        url.searchParams.set('hostMode', 'settings');
        const savedLang = readSavedLang();
        if (savedLang) {
          url.searchParams.set('lang', savedLang);
        }
        const bodyCs = doc.body ? win.getComputedStyle(doc.body) : null;
        if (bodyCs?.fontFamily) {
          url.searchParams.set('hostFont', bodyCs.fontFamily);
        }
        if (bodyCs?.color) {
          url.searchParams.set('hostFg', bodyCs.color);
        }
        const paneBg = contentPane ? win.getComputedStyle(contentPane)?.backgroundColor : '';
        if (paneBg && paneBg !== 'rgba(0, 0, 0, 0)' && paneBg !== 'transparent') {
          url.searchParams.set('hostBg', paneBg);
        } else if (bodyCs?.backgroundColor && bodyCs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          url.searchParams.set('hostBg', bodyCs.backgroundColor);
        }
        return url.toString();
      } catch {
        return baseUrl;
      }
    }

    function isTrustedIframeMessage(ev, frames) {
      const baseUrl = getServerUrl();
      if (!baseUrl) return false;
      try {
        const expectedOrigin = new URL(baseUrl).origin;
        if (ev.origin !== expectedOrigin) return false;
      } catch {
        return false;
      }
      if (!Array.isArray(frames) || frames.length === 0) return false;
      return frames.some((frame) => frame && frame.contentWindow === ev.source);
    }

    function mountSlot(slotId, containerOrOpts) {
      const opts =
        containerOrOpts && typeof containerOrOpts === 'object' && containerOrOpts.nodeType === 1
          ? { container: containerOrOpts }
          : containerOrOpts || {};
      return host.mountSlot(slotId, opts);
    }

    function injectStyle(styleId, cssText, opts) {
      return opts ? host.injectStyle(styleId, cssText, opts) : host.injectStyle(styleId, cssText);
    }

    function addManagedListener(target, type, listener, opts) {
      if (!target || typeof target.addEventListener !== 'function') return () => {};
      if (typeof host.addManagedListener === 'function') {
        const detach = host.addManagedListener(target, type, listener, opts);
        return typeof detach === 'function' ? detach : () => {};
      }
      target.addEventListener(type, listener, opts);
      let active = true;
      const detach = () => {
        if (!active) return;
        active = false;
        try {
          target.removeEventListener(type, listener, opts);
        } catch {
          // Ignore teardown errors
        }
      };
      host.onDispose(detach);
      return detach;
    }

    return Object.freeze({
      pluginId,
      trustLevel,
      schemaVersion,
      storageNamespace,
      ipcChannelPrefix,
      langStorageKey,
      readSavedLang,
      writeSavedLang,
      getServerUrl,
      bindServerUrlListener,
      buildThemedIframeUrl,
      isTrustedIframeMessage,
      getSlotHostElement,
      mountSlot,
      unmountSlot: (slotId) => host.unmountSlot(slotId),
      openModal: (slotId, opts) => host.openModal(slotId, opts || {}),
      injectStyle,
      removeStyle: (styleId) => host.removeStyle(styleId),
      addManagedListener,
      onDispose: (fn) => host.onDispose(fn),
    });
  }

  // --- module: addon-styles.mjs ---
  /**
   * ShadowRoot & Slot-Scoped CSS Definitions (`src/adapters/antigravity/renderer/addon-styles.mjs`).
   *
   * SOLID Responsibility (SRP):
   * - Declares strictly slot-scoped CSS injected via `addonHost.injectStyle(styleId, cssText, { slotId })`
   *   for every Shadow DOM slot (`pane`, `customizations-btn`, `customizations-overlay`).
   * - 100% compliant with `antigravity-native-addon-host` v2 `validateSafeCssText` and
   *   `scopeCssToOwner` (zero `@import`, zero CSS nesting, zero sibling combinators, exact
   *   `:host` and `[data-addon-host-owner="antigravity-mcp-manager"].addon-host-slot-root` rooting).
   * - Light DOM `settings-nav` (`shadow: false`) sets inline `display: contents` directly on its
   *   host wrapper so zero `<style>` tags pollute `document.head`.
   */
  const OWNER_ROOT = '[data-addon-host-owner="antigravity-mcp-manager"].addon-host-slot-root';
  const STYLE_IDS = Object.freeze({
    PANE: 'mcp-manager-pane',
    CUSTOMIZATIONS_BTN: 'mcp-manager-customizations-btn',
    CUSTOMIZATIONS_OVERLAY: 'mcp-manager-customizations-overlay',
  });

  function buildLauncherCss() {
    return [
      '[data-agy-mcp-sidecar-launcher="true"] {',
      '  box-sizing: border-box;',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  overflow: auto;',
      '  padding: 24px;',
      '  display: flex;',
      '  align-items: flex-start;',
      '  justify-content: center;',
      '  color: inherit;',
      '  font-family: inherit;',
      '}',
      '[data-agy-mcp-launcher-card="true"] {',
      '  box-sizing: border-box;',
      '  width: 100%;',
      '  max-width: 680px;',
      '  border: 1px solid rgba(128, 128, 128, 0.28);',
      '  border-radius: 12px;',
      '  padding: 20px 22px;',
      '  background: rgba(128, 128, 128, 0.08);',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 14px;',
      '}',
      '[data-agy-mcp-launcher-header="true"] {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 12px;',
      '  flex-wrap: wrap;',
      '}',
      '[data-agy-mcp-launcher-title-wrap="true"] {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 10px;',
      '  flex-wrap: wrap;',
      '}',
      '[data-agy-mcp-launcher-title="true"] {',
      '  margin: 0;',
      '  font-size: 18px;',
      '  font-weight: 600;',
      '  line-height: 1.3;',
      '}',
      '[data-agy-mcp-launcher-badge="true"] {',
      '  font-size: 11px;',
      '  font-weight: 500;',
      '  padding: 2px 8px;',
      '  border-radius: 999px;',
      '  border: 1px solid rgba(128, 128, 128, 0.32);',
      '  background: rgba(128, 128, 128, 0.14);',
      '}',
      '[data-agy-mcp-lang-switch="true"] {',
      '  display: inline-flex;',
      '  gap: 4px;',
      '}',
      '[data-agy-mcp-lang-btn] {',
      '  background: transparent;',
      '  border: 1px solid rgba(128, 128, 128, 0.32);',
      '  border-radius: 6px;',
      '  color: inherit;',
      '  font-family: inherit;',
      '  font-size: 12px;',
      '  font-weight: 500;',
      '  padding: 4px 9px;',
      '  cursor: pointer;',
      '}',
      '[data-agy-mcp-lang-btn][aria-pressed="true"] {',
      '  background: rgba(128, 128, 128, 0.24);',
      '  border-color: rgba(128, 128, 128, 0.6);',
      '}',
      '[data-agy-mcp-launcher-meta="true"] {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  flex-wrap: wrap;',
      '}',
      '[data-agy-mcp-launcher-status="true"] {',
      '  font-size: 12px;',
      '  font-weight: 500;',
      '  padding: 3px 9px;',
      '  border-radius: 6px;',
      '  background: rgba(34, 197, 94, 0.16);',
      '  border: 1px solid rgba(34, 197, 94, 0.35);',
      '}',
      '[data-agy-mcp-launcher-surface="true"] {',
      '  font-size: 12px;',
      '  opacity: 0.78;',
      '}',
      '[data-agy-mcp-launcher-lead="true"] {',
      '  margin: 0;',
      '  font-size: 13px;',
      '  line-height: 1.55;',
      '  opacity: 0.9;',
      '}',
      '[data-agy-mcp-launcher-steps-title="true"] {',
      '  margin: 4px 0 0 0;',
      '  font-size: 13px;',
      '  font-weight: 600;',
      '}',
      '[data-agy-mcp-launcher-steps="true"] {',
      '  margin: 0;',
      '  padding-left: 20px;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 6px;',
      '  font-size: 13px;',
      '  line-height: 1.5;',
      '}',
      '[data-agy-mcp-launcher-footer="true"] {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  flex-wrap: wrap;',
      '  padding-top: 10px;',
      '  border-top: 1px solid rgba(128, 128, 128, 0.22);',
      '  font-size: 12px;',
      '}',
      '[data-agy-mcp-launcher-config-label="true"] {',
      '  opacity: 0.78;',
      '}',
      '[data-agy-mcp-launcher-config-path="true"] {',
      '  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;',
      '  font-size: 12px;',
      '  padding: 2px 6px;',
      '  border-radius: 4px;',
      '  background: rgba(128, 128, 128, 0.16);',
      '}',
    ].join('\n');
  }
  function buildPaneSlotCss() {
    return [
      ':host {',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      ':host([data-agy-mcp-hidden="true"]) {',
      '  display: none;',
      '}',
      `${OWNER_ROOT} {`,
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      '[data-agy-mcp-manager-frame="true"] {',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  border: 0;',
      '  display: block;',
      '  background: transparent;',
      '}',
      buildLauncherCss(),
    ].join('\n');
  }
  function buildCustomizationsBtnSlotCss() {
    return [
      ':host {',
      '  display: inline-flex;',
      '  align-items: center;',
      '}',
      `${OWNER_ROOT} {`,
      '  display: inline-flex;',
      '  align-items: center;',
      '}',
      '[data-agy-mcp-customizations-btn="true"] {',
      '  background: rgba(128, 128, 128, 0.14);',
      '  border: 1px solid rgba(128, 128, 128, 0.28);',
      '  border-radius: 6px;',
      '  color: inherit;',
      '  font-family: inherit;',
      '  font-size: 12px;',
      '  font-weight: 500;',
      '  line-height: 1.4;',
      '  padding: 3px 10px;',
      '  margin-right: 6px;',
      '  cursor: pointer;',
      '  white-space: nowrap;',
      '}',
      '[data-agy-mcp-customizations-btn="true"]:hover {',
      '  background: rgba(128, 128, 128, 0.24);',
      '}',
    ].join('\n');
  }
  function buildCustomizationsOverlaySlotCss() {
    return [
      ':host {',
      '  width: 100%;',
      '  height: 100%;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      `${OWNER_ROOT} {`,
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      '[data-agy-mcp-customizations-topbar="true"] {',
      '  height: 44px;',
      '  flex: 0 0 auto;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  padding: 0 16px;',
      '  border-bottom: 1px solid rgba(128, 128, 128, 0.22);',
      '}',
      '[data-agy-mcp-customizations-back="true"] {',
      '  background: transparent;',
      '  border: 1px solid rgba(128, 128, 128, 0.28);',
      '  border-radius: 6px;',
      '  color: inherit;',
      '  font-family: inherit;',
      '  font-size: 12px;',
      '  font-weight: 500;',
      '  padding: 4px 10px;',
      '  cursor: pointer;',
      '}',
      '[data-agy-mcp-customizations-close="true"] {',
      '  background: transparent;',
      '  border: 0;',
      '  border-radius: 6px;',
      '  color: inherit;',
      '  font-size: 15px;',
      '  line-height: 1;',
      '  width: 28px;',
      '  height: 28px;',
      '  cursor: pointer;',
      '}',
      '[data-agy-mcp-customizations-content="true"] {',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      '[data-agy-mcp-manager-frame="true"] {',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  border: 0;',
      '  display: block;',
      '  background: transparent;',
      '}',
      buildLauncherCss(),
    ].join('\n');
  }
  function buildSlotStyleDescriptors() {
    return Object.freeze([
      Object.freeze({
        styleId: STYLE_IDS.PANE,
        slotId: SLOT_IDS.SETTINGS_PANE,
        cssText: buildPaneSlotCss(),
      }),
      Object.freeze({
        styleId: STYLE_IDS.CUSTOMIZATIONS_BTN,
        slotId: SLOT_IDS.CUSTOMIZATIONS_BTN,
        cssText: buildCustomizationsBtnSlotCss(),
      }),
      Object.freeze({
        styleId: STYLE_IDS.CUSTOMIZATIONS_OVERLAY,
        slotId: SLOT_IDS.CUSTOMIZATIONS_OVERLAY,
        cssText: buildCustomizationsOverlaySlotCss(),
      }),
    ]);
  }

  // --- module: settings-sidebar-mount.mjs ---
  /**
   * Settings Sidebar Mount Adapter (`src/adapters/antigravity/renderer/settings-sidebar-mount.mjs`).
   *
   * SOLID Boundaries:
   * - SRP: Discovers Antigravity's Settings left sidebar (`Browser`/`브라우저`) and right
   *   content pane, mounts `settings-nav` (`shadow: false`) and `pane` (`shadow: true`) via
   *   `AddonManifest.v2` `runtime.mountSlot(slotId, { container })`, handles paint-only
   *   0px-shift selection, preserves native top-right close (`✕`), renders either a live
   *   loopback `<iframe>` (when a host/test SidecarBridge URL is present) or the EN/KO Native
   *   Sidecar launcher panel, and restores all native DOM state on sibling click or `dispose()`.
   * - LSP / ISP: Implements the standard Mount Adapter contract (`id`, `ensureMount`,
   *   `syncLabels`, `getFrames`, `handleKeydown`, `dispose`) using only the narrow `runtime` port.
   */
  const NAV_ATTR = 'data-agy-mcp-manager-nav';
  const PREV_DISPLAY_ATTR = 'agyMcpPrevDisplay';
  const SUPPRESSED_BG_ATTR = 'agyMcpSuppressedBg';
  const SUPPRESSED_COLOR_ATTR = 'agyMcpSuppressedColor';

  const BROWSER_LABELS = ['browser', '브라우저'];
  const REQUIRED_SIBLING_LABELS = [
    'general',
    'application',
    'appearance',
    'shortcuts',
    'notifications',
    'models',
    'browser',
    '일반',
    '애플리케이션',
    '앱',
    '외관',
    '모양',
    '화면',
    '단축키',
    '바로가기',
    '알림',
    '모델',
    '브라우저',
  ];
  function createSettingsSidebarMount({ runtime, onLangChange = () => {}, win = window, doc = document }) {
    let boundClickHost = null;
    let boundClickHandler = null;
    let activeSidebar = null;
    let activeContentPane = null;
    let navHostEl = null;
    let navItemEl = null;
    let paneHostEl = null;
    let paneRootEl = null;
    let frameEl = null;
    let launcherView = null;
    let isPaneActive = false;

    function findSettingsSidebarAndAnchor() {
      const candidates = doc.querySelectorAll('button, a, [role="tab"], [role="menuitem"], [role="button"], li, div');
      for (const el of candidates) {
        if (el.hasAttribute(NAV_ATTR) || el.closest?.(`[data-addon-host-slot="${SLOT_IDS.SETTINGS_NAV}"]`)) continue;
        if (el.children.length > 2) continue;
        if (!BROWSER_LABELS.includes(normalizedText(el))) continue;

        let container = el.parentElement;
        for (let depth = 0; depth < 4 && container && container !== doc.body; depth += 1) {
          const items = Array.from(
            container.querySelectorAll('button, a, [role="tab"], [role="menuitem"], [role="button"], li, div')
          );
          const seen = new Map();
          for (const item of items) {
            if (item.children.length > 2) continue;
            const txt = normalizedText(item);
            if (REQUIRED_SIBLING_LABELS.includes(txt) && !seen.has(txt)) {
              seen.set(txt, item);
            }
          }
          if (seen.size >= 4) {
            let anchor = el;
            while (anchor.parentElement && anchor.parentElement !== container && anchor.parentElement.children.length === 1) {
              anchor = anchor.parentElement;
            }
            const listParent = anchor.parentElement || container;
            const directSiblings = Array.from(listParent.children).filter(
              (c) =>
                c.nodeType === 1 &&
                !c.hasAttribute(NAV_ATTR) &&
                c.getAttribute('data-addon-host-slot') !== SLOT_IDS.SETTINGS_NAV &&
                REQUIRED_SIBLING_LABELS.includes(normalizedText(c))
            );
            const inactiveSibling =
              directSiblings.find(
                (c) => !hasVisibleBg(c, win) && !['general', '일반', ...BROWSER_LABELS].includes(normalizedText(c))
              ) ||
              directSiblings.find((c) => !hasVisibleBg(c, win)) ||
              anchor;
            return { sidebar: container, listParent, browserItem: anchor, inactiveTemplate: inactiveSibling };
          }
          container = container.parentElement;
        }
      }
      return null;
    }

    function findSettingsLayout(sidebar) {
      const sidebarRect = sidebar.getBoundingClientRect?.() || { left: 0, right: 0, width: 0, height: 0 };
      let cursor = sidebar;
      for (let depth = 0; depth < 8 && cursor && cursor.parentElement && cursor.parentElement !== doc.documentElement; depth += 1) {
        const parent = cursor.parentElement;
        const cursorRect = cursor.getBoundingClientRect?.() || sidebarRect;
        const rightBoundary = Math.max(sidebarRect.right, cursorRect.right);
        const siblings = Array.from(parent.children).filter((child) => {
          if (child === cursor || child.nodeType !== 1) return false;
          if (child.tagName === 'STYLE' || child.tagName === 'SCRIPT') return false;
          const r = child.getBoundingClientRect?.();
          if (!r) return false;
          return r.width >= 280 && r.height >= 200 && r.left >= rightBoundary - 24;
        });
        if (siblings.length > 0) {
          let best = siblings[0];
          let bestArea = 0;
          for (const sib of siblings) {
            const r = sib.getBoundingClientRect();
            const area = r.width * r.height;
            if (area > bestArea) {
              bestArea = area;
              best = sib;
            }
          }
          return { outerSidebar: cursor, contentPane: best };
        }
        cursor = parent;
      }
      return { outerSidebar: sidebar, contentPane: null };
    }

    function isSettingsCloseControl(child, contentPaneRect) {
      if (!child || child.nodeType !== 1) return false;
      const isCloseBtn = (btn) => {
        const aria = String(btn.getAttribute?.('aria-label') || btn.getAttribute?.('title') || '').toLowerCase();
        if (aria.includes('close') || aria.includes('닫기')) return true;
        const txt = normalizedText(btn);
        if (txt === '×' || txt === '✕' || txt === 'x') return true;
        const r = btn.getBoundingClientRect?.();
        if (!r || !contentPaneRect) return false;
        const isSmall = r.width > 0 && r.width <= 52 && r.height > 0 && r.height <= 52;
        const isTopRight = r.right >= contentPaneRect.right - 72 && r.top <= contentPaneRect.top + 72;
        return isSmall && isTopRight;
      };
      if (child.tagName === 'BUTTON' && isCloseBtn(child)) return true;
      const r = child.getBoundingClientRect?.();
      if (
        r &&
        contentPaneRect &&
        r.width <= 64 &&
        r.height <= 64 &&
        r.right >= contentPaneRect.right - 72 &&
        r.top <= contentPaneRect.top + 72
      ) {
        const innerBtn = child.querySelector?.('button');
        if (innerBtn && isCloseBtn(innerBtn)) return true;
      }
      return false;
    }

    // Paint-only active suppression: NEVER mutates className, padding, margin, height, or font-weight (0px shift)
    function suppressNativeActiveItems(listParent, navHost, inactiveColor) {
      let detectedActiveBg = 'rgba(255, 255, 255, 0.08)';
      let detectedActiveColor = '#ffffff';
      const dimNode = (el) => {
        if (!Object.prototype.hasOwnProperty.call(el.dataset, SUPPRESSED_BG_ATTR)) {
          el.dataset[SUPPRESSED_BG_ATTR] = el.style.backgroundColor || '';
          el.dataset[SUPPRESSED_COLOR_ATTR] = el.style.color || '';
        }
        el.style.setProperty('background-color', 'transparent', 'important');
        if (inactiveColor) {
          el.style.setProperty('color', inactiveColor, 'important');
        }
      };

      if (listParent) {
        for (const sib of Array.from(listParent.children)) {
          if (sib.nodeType !== 1 || sib === navHost || sib.getAttribute('data-addon-host-slot') === SLOT_IDS.SETTINGS_NAV) continue;
          const cs = win.getComputedStyle(sib);
          if (hasVisibleBg(sib, win)) {
            detectedActiveBg = cs.backgroundColor;
            if (cs.color) detectedActiveColor = cs.color;
          }
          dimNode(sib);
          for (const inner of Array.from(sib.querySelectorAll('button, span, div'))) {
            const ics = win.getComputedStyle(inner);
            if (hasVisibleBg(inner, win)) {
              detectedActiveBg = ics.backgroundColor;
              if (ics.color) detectedActiveColor = ics.color;
            }
            dimNode(inner);
          }
        }
      }
      return { activeBg: detectedActiveBg, activeColor: detectedActiveColor };
    }

    function restoreNativeActiveItems(outerSidebar) {
      if (!outerSidebar) return;
      const suppressed = outerSidebar.querySelectorAll('[data-agy-mcp-suppressed-bg]');
      for (const item of suppressed) {
        item.style.removeProperty('background-color');
        item.style.removeProperty('color');
        if (item.dataset[SUPPRESSED_BG_ATTR]) {
          item.style.backgroundColor = item.dataset[SUPPRESSED_BG_ATTR];
        }
        if (item.dataset[SUPPRESSED_COLOR_ATTR]) {
          item.style.color = item.dataset[SUPPRESSED_COLOR_ATTR];
        }
        delete item.dataset[SUPPRESSED_BG_ATTR];
        delete item.dataset[SUPPRESSED_COLOR_ATTR];
      }
    }

    function restoreNativePane(outerSidebar, contentPane, navItem) {
      isPaneActive = false;
      restoreNativeActiveItems(outerSidebar);
      if (navItem) {
        navItem.setAttribute('aria-selected', 'false');
        navItem.dataset.agyMcpActive = 'false';
        navItem.style.removeProperty('background-color');
        navItem.style.removeProperty('color');
        for (const inner of Array.from(navItem.querySelectorAll('button, span, div'))) {
          inner.style.removeProperty('background-color');
          inner.style.removeProperty('color');
        }
      }
      if (paneHostEl) {
        paneHostEl.setAttribute('data-agy-mcp-hidden', 'true');
        paneHostEl.style.display = 'none';
      }
      if (!contentPane) return;
      for (const child of Array.from(contentPane.children)) {
        if (child === paneHostEl || child.getAttribute('data-addon-host-slot') === SLOT_IDS.SETTINGS_PANE) continue;
        if (child.dataset && Object.prototype.hasOwnProperty.call(child.dataset, PREV_DISPLAY_ATTR)) {
          child.style.display = child.dataset[PREV_DISPLAY_ATTR];
          delete child.dataset[PREV_DISPLAY_ATTR];
        }
      }
    }

    function renderPaneContent(contentPane) {
      if (!contentPane) return;
      const slotRoot = runtime.mountSlot(SLOT_IDS.SETTINGS_PANE, { container: contentPane });
      if (!slotRoot) return;
      const slotHost = runtime.getSlotHostElement(slotRoot);
      paneRootEl = slotRoot;
      paneHostEl = slotHost;

      if (slotHost && slotHost.style) {
        slotHost.removeAttribute('data-agy-mcp-hidden');
        slotHost.style.display = 'flex';
        slotHost.style.flexDirection = 'column';
        slotHost.style.flex = '1 1 auto';
        slotHost.style.minHeight = '0';
        slotHost.style.width = '100%';
        slotHost.style.height = '100%';
      }

      const baseUrl = runtime.getServerUrl();
      if (baseUrl) {
        if (launcherView && launcherView.element.parentNode) {
          launcherView.element.parentNode.removeChild(launcherView.element);
        }
        launcherView = null;

        const themedUrl = runtime.buildThemedIframeUrl(baseUrl, contentPane);
        if (!frameEl || frameEl.parentNode !== slotRoot) {
          while (slotRoot.firstChild) slotRoot.removeChild(slotRoot.firstChild);
          frameEl = doc.createElement('iframe');
          frameEl.setAttribute(FRAME_ATTR, 'true');
          frameEl.setAttribute('title', 'MCP Manager');
          frameEl.src = themedUrl;
          slotRoot.appendChild(frameEl);
        } else if (!sameFrameBaseAndTheme(frameEl.src, themedUrl)) {
          frameEl.src = themedUrl;
        }
        return;
      }

      if (frameEl && frameEl.parentNode) {
        frameEl.parentNode.removeChild(frameEl);
      }
      frameEl = null;

      if (!launcherView || launcherView.element.parentNode !== slotRoot) {
        while (slotRoot.firstChild) slotRoot.removeChild(slotRoot.firstChild);
        launcherView = createSidecarLauncherView({ runtime, surface: 'settings', onLangChange, doc });
        slotRoot.appendChild(launcherView.element);
      } else {
        launcherView.syncLang();
      }
    }

    function showMcpManagerPane(outerSidebar, listParent, contentPane, navHost, navItem) {
      if (!contentPane) return;

      activeSidebar = outerSidebar;
      activeContentPane = contentPane;
      isPaneActive = true;

      const inactiveColor = navItem?.dataset?.agyMcpInactiveColor || '';
      const { activeBg, activeColor } = suppressNativeActiveItems(listParent, navHost, inactiveColor);

      if (navItem) {
        navItem.setAttribute('aria-selected', 'true');
        navItem.dataset.agyMcpActive = 'true';
        const nextTextColor = activeColor || '#ffffff';
        navItem.style.setProperty('background-color', activeBg, 'important');
        navItem.style.setProperty('color', nextTextColor, 'important');
        for (const inner of Array.from(navItem.querySelectorAll('button, span, div'))) {
          inner.style.setProperty('background-color', 'transparent', 'important');
          inner.style.setProperty('color', nextTextColor, 'important');
        }
      }

      const contentPaneRect = contentPane.getBoundingClientRect?.();
      for (const child of Array.from(contentPane.children)) {
        if (child === paneHostEl || child.getAttribute('data-addon-host-slot') === SLOT_IDS.SETTINGS_PANE) continue;
        if (isSettingsCloseControl(child, contentPaneRect)) {
          child.style.zIndex = '20';
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(child.dataset, PREV_DISPLAY_ATTR)) {
          child.dataset[PREV_DISPLAY_ATTR] = child.style.display || '';
        }
        child.style.display = 'none';
      }

      renderPaneContent(contentPane);
    }

    function ensureMount() {
      const found = findSettingsSidebarAndAnchor();
      if (!found) return;
      const { sidebar, listParent, browserItem, inactiveTemplate } = found;
      const { outerSidebar, contentPane: initialContentPane } = findSettingsLayout(sidebar);

      if (navItemEl && navItemEl.isConnected && sidebar.contains(navItemEl)) {
        if (isPaneActive && initialContentPane) {
          renderPaneContent(initialContentPane);
        } else if (frameEl && frameEl.isConnected) {
          const baseUrl = runtime.getServerUrl();
          if (baseUrl) {
            const nextUrl = runtime.buildThemedIframeUrl(baseUrl, initialContentPane);
            if (!sameFrameBaseAndTheme(frameEl.src, nextUrl)) {
              frameEl.src = nextUrl;
            }
          }
        }
        return;
      }

      const navSlot = runtime.mountSlot(SLOT_IDS.SETTINGS_NAV, { container: listParent });
      if (!navSlot) return;
      const navHost = runtime.getSlotHostElement(navSlot);
      if (navHost && navHost.style) {
        navHost.style.display = 'contents';
      }
      while (navSlot.firstChild) navSlot.removeChild(navSlot.firstChild);

      // Clone an INACTIVE native sibling node and keep its className immutable (0px shift, native focus ring intact)
      const navItem = inactiveTemplate.cloneNode(true);
      navItem.removeAttribute('id');
      navItem.setAttribute(NAV_ATTR, 'true');
      navItem.setAttribute('aria-selected', 'false');
      navItem.dataset.agyMcpActive = 'false';
      navItem.dataset.agyMcpInactiveColor = win.getComputedStyle(inactiveTemplate)?.color || '';
      replaceLeafText(navItem, 'MCP Manager', doc);

      navItem.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const layout = findSettingsLayout(sidebar);
        showMcpManagerPane(layout.outerSidebar, listParent, layout.contentPane, navHost, navItem);
      });

      navSlot.appendChild(navItem);
      navHostEl = navHost;
      navItemEl = navItem;

      // Position inside the same listParent right after browserItem (parentNode unchanged -> host idempotent & auto-disposed)
      if (browserItem.nextSibling && browserItem.nextSibling !== navHost) {
        listParent.insertBefore(navHost, browserItem.nextSibling);
      }

      const clickHost = outerSidebar || sidebar;
      if (boundClickHost !== clickHost) {
        if (boundClickHost && boundClickHandler) {
          boundClickHost.removeEventListener('click', boundClickHandler, true);
        }
        boundClickHost = clickHost;
        boundClickHandler = (ev) => {
          const target = ev.target;
          if (!target || target.closest?.(`[${NAV_ATTR}="true"]`)) return;
          if (navItemEl && navItemEl.isConnected && navItemEl.dataset.agyMcpActive === 'true') {
            const layout = findSettingsLayout(sidebar);
            restoreNativePane(layout.outerSidebar, layout.contentPane, navItemEl);
          }
        };
        clickHost.addEventListener('click', boundClickHandler, true);
      }
    }

    function syncLabels() {
      if (launcherView) {
        launcherView.syncLang();
      }
    }

    function getFrames() {
      return frameEl && frameEl.isConnected ? [frameEl] : [];
    }

    function dispose() {
      restoreNativePane(activeSidebar || boundClickHost, activeContentPane, navItemEl);
      if (boundClickHost && boundClickHandler) {
        boundClickHost.removeEventListener('click', boundClickHandler, true);
      }
      boundClickHost = null;
      boundClickHandler = null;
      activeSidebar = null;
      activeContentPane = null;
      navHostEl = null;
      navItemEl = null;
      paneHostEl = null;
      paneRootEl = null;
      frameEl = null;
      launcherView = null;
      isPaneActive = false;
      try {
        runtime.unmountSlot(SLOT_IDS.SETTINGS_PANE);
      } catch {
        // Ignore if host already unmounted
      }
      try {
        runtime.unmountSlot(SLOT_IDS.SETTINGS_NAV);
      } catch {
        // Ignore if host already unmounted
      }
    }

    return Object.freeze({
      id: 'settings-sidebar',
      ensureMount,
      syncLabels,
      getFrames,
      handleKeydown: () => {},
      dispose,
    });
  }

  // --- module: customizations-mount.mjs ---
  /**
   * Customizations Screen Mount Adapter (`src/adapters/antigravity/renderer/customizations-mount.mjs`).
   *
   * SOLID Boundaries:
   * - SRP: Detects Antigravity's Customizations (`MCP Servers` / `MCP 서버`) header,
   *   mounts the trigger button (`custom` slot, Shadow DOM Option B2) immediately before
   *   right-hand action icons, and opens/closes the full-pane modal overlay via
   *   `AddonManifest.v2` `runtime.openModal(slotId, { shadow: true, onClose })` (preserving
   *   host `marginTop`/`zIndex` & `PortalArbiter` LIFO `Escape` / focus restoration), rendering
   *   either the live loopback `<iframe>` or the EN/KO Native Sidecar launcher panel.
   * - LSP / ISP: Implements the exact same Mount Adapter contract as `settings-sidebar-mount.mjs`.
   */
  const CUSTOMIZATIONS_BTN_ATTR = 'data-agy-mcp-customizations-btn';
  const CUSTOMIZATIONS_OVERLAY_ATTR = 'data-agy-mcp-customizations-overlay';
  const CUSTOMIZATIONS_TOPBAR_ATTR = 'data-agy-mcp-customizations-topbar';
  const CUSTOMIZATIONS_BACK_ATTR = 'data-agy-mcp-customizations-back';
  const CUSTOMIZATIONS_CLOSE_ATTR = 'data-agy-mcp-customizations-close';
  const CUSTOMIZATIONS_CONTENT_ATTR = 'data-agy-mcp-customizations-content';

  const CUSTOMIZATIONS_PAGE_MARKERS = [
    'customizations',
    'skills & rules',
    'custom agents',
    '사용자 정의',
    '맞춤 설정',
    '커스터마이징',
    '스킬 및 규칙',
    '사용자 지정 에이전트',
    '커스텀 에이전트',
  ];
  const MCP_SERVERS_SECTION_LABELS = ['mcp servers', 'mcp 서버'];

  function isCustomizationsMarker(txt) {
    return CUSTOMIZATIONS_PAGE_MARKERS.some(
      (marker) => txt === marker || (txt.startsWith(marker) && /^[\s(]*\d*[\s)]*$/.test(txt.slice(marker.length)))
    );
  }

  function isMcpServersLabel(txt) {
    return MCP_SERVERS_SECTION_LABELS.some(
      (label) => txt === label || (txt.startsWith(label) && /^[\s(]*\d+[\s)]*$/.test(txt.slice(label.length)))
    );
  }
  function createCustomizationsMount({ runtime, onLangChange = () => {}, win = window, doc = document }) {
    let lastTriggerBtn = null;
    let btnHostEl = null;
    let btnRootEl = null;
    let btnEl = null;
    let activeModalHandle = null;
    let modalBackBtnEl = null;
    let modalContentEl = null;
    let modalFrameEl = null;
    let modalLauncherView = null;

    function getButtonLabel() {
      return runtime.readSavedLang() === 'ko' ? 'MCP 매니저' : 'MCP Manager';
    }

    function getBackLabel() {
      return runtime.readSavedLang() === 'ko' ? '← Customizations로 돌아가기' : '← Back to Customizations';
    }

    function isInsideOwnSlot(el) {
      if (!el || typeof el.closest !== 'function') return false;
      return Boolean(
        el.closest(`[${CUSTOMIZATIONS_OVERLAY_ATTR}="true"]`) ||
          el.closest('[data-addon-host-modal-dialog="1"]') ||
          el.closest(`[data-addon-host-slot="${SLOT_IDS.CUSTOMIZATIONS_BTN}"]`)
      );
    }

    function isCustomizationsPageVisible() {
      const candidates = doc.querySelectorAll('h1, h2, h3, h4, div, span, button');
      for (const el of candidates) {
        if (el.children.length > 2) continue;
        if (isInsideOwnSlot(el)) continue;
        if (isCustomizationsMarker(normalizedText(el))) {
          const rect = el.getBoundingClientRect?.();
          if (!rect || (rect.width > 0 && rect.height > 0)) return true;
        }
      }
      return false;
    }

    function findCustomizationsMcpHeader() {
      if (!isCustomizationsPageVisible()) return null;
      const candidates = doc.querySelectorAll('h1, h2, h3, h4, span, div, button, p');
      for (const el of candidates) {
        if (el.children.length > 2) continue;
        if (isInsideOwnSlot(el)) continue;
        if (el.hasAttribute(CUSTOMIZATIONS_BTN_ATTR)) continue;
        if (!isMcpServersLabel(normalizedText(el))) continue;

        let row = el.parentElement;
        for (let depth = 0; depth < 4 && row && row !== doc.body; depth += 1) {
          const buttons = Array.from(row.querySelectorAll('button')).filter(
            (b) => !b.hasAttribute(CUSTOMIZATIONS_BTN_ATTR) && !isInsideOwnSlot(b) && !b.contains(el)
          );
          if (buttons.length >= 1) {
            const actionContainer = buttons[0].parentElement || row;
            return { row, actionContainer, firstActionButton: buttons[0] };
          }
          row = row.parentElement;
        }

        const fallbackRow = el.parentElement;
        if (fallbackRow && fallbackRow !== doc.body) {
          return { row: fallbackRow, actionContainer: fallbackRow, firstActionButton: null };
        }
      }
      return null;
    }

    function syncLabels() {
      if (btnEl) btnEl.textContent = getButtonLabel();
      if (modalBackBtnEl) modalBackBtnEl.textContent = getBackLabel();
      if (modalLauncherView) modalLauncherView.syncLang();
    }

    function clearModalRefs() {
      activeModalHandle = null;
      modalBackBtnEl = null;
      modalContentEl = null;
      modalFrameEl = null;
      modalLauncherView = null;
    }

    function handleModalClosed() {
      clearModalRefs();
      if (lastTriggerBtn && lastTriggerBtn.isConnected && typeof lastTriggerBtn.focus === 'function') {
        try {
          lastTriggerBtn.focus();
        } catch {
          // Ignore focus restoration errors
        }
      }
    }

    function closeOverlay() {
      const handle = activeModalHandle;
      if (!handle) return;
      clearModalRefs();
      try {
        handle.close();
      } catch {
        // Ignore if host already closed modal
      }
    }

    function renderModalContent() {
      if (!modalContentEl) return;
      const baseUrl = runtime.getServerUrl();
      if (baseUrl) {
        if (modalLauncherView && modalLauncherView.element.parentNode) {
          modalLauncherView.element.parentNode.removeChild(modalLauncherView.element);
        }
        modalLauncherView = null;

        const themedUrl = runtime.buildThemedIframeUrl(baseUrl, doc.body);
        if (!modalFrameEl || modalFrameEl.parentNode !== modalContentEl) {
          while (modalContentEl.firstChild) modalContentEl.removeChild(modalContentEl.firstChild);
          modalFrameEl = doc.createElement('iframe');
          modalFrameEl.setAttribute(FRAME_ATTR, 'true');
          modalFrameEl.setAttribute('data-agy-mcp-customizations-frame', 'true');
          modalFrameEl.setAttribute('title', 'MCP Manager');
          modalFrameEl.src = themedUrl;
          modalContentEl.appendChild(modalFrameEl);
        } else if (!sameFrameBaseAndTheme(modalFrameEl.src, themedUrl)) {
          modalFrameEl.src = themedUrl;
        }
        return;
      }

      if (modalFrameEl && modalFrameEl.parentNode) {
        modalFrameEl.parentNode.removeChild(modalFrameEl);
      }
      modalFrameEl = null;

      if (!modalLauncherView || modalLauncherView.element.parentNode !== modalContentEl) {
        while (modalContentEl.firstChild) modalContentEl.removeChild(modalContentEl.firstChild);
        modalLauncherView = createSidecarLauncherView({ runtime, surface: 'customizations', onLangChange, doc });
        modalContentEl.appendChild(modalLauncherView.element);
      } else {
        modalLauncherView.syncLang();
      }
    }

    function openOverlay(triggerBtn) {
      if (!doc.body) return;
      lastTriggerBtn = triggerBtn || btnEl || null;

      if (activeModalHandle && activeModalHandle.element && activeModalHandle.element.isConnected) {
        renderModalContent();
        syncLabels();
        return;
      }

      const bodyCs = win.getComputedStyle(doc.body);
      const bodyBg = bodyCs?.backgroundColor || '';
      const hostBg = bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent' ? bodyBg : '#0d0e11';
      const hostFg = bodyCs?.color || '#e5e7eb';
      const hostFont = bodyCs?.fontFamily || 'sans-serif';

      const modalHandle = runtime.openModal(SLOT_IDS.CUSTOMIZATIONS_OVERLAY, {
        shadow: true,
        onClose: handleModalClosed,
      });
      if (!modalHandle || !modalHandle.bodyEl) return;

      activeModalHandle = modalHandle;
      const dlg = modalHandle.element;
      if (dlg) {
        dlg.setAttribute(CUSTOMIZATIONS_OVERLAY_ATTR, 'true');
        dlg.setAttribute('aria-label', 'MCP Manager');
        // Preserve host-managed `marginTop` (titlebar safe inset) and `zIndex`!
        if (dlg.style) {
          dlg.style.width = '100vw';
          dlg.style.maxWidth = '100vw';
          dlg.style.height = 'calc(100vh - max(env(titlebar-area-height, 36px), 36px))';
          dlg.style.maxHeight = 'calc(100vh - max(env(titlebar-area-height, 36px), 36px))';
          dlg.style.marginLeft = '0';
          dlg.style.marginRight = '0';
          dlg.style.marginBottom = '0';
          dlg.style.padding = '0';
          dlg.style.border = '0';
          dlg.style.background = hostBg;
          dlg.style.color = hostFg;
          dlg.style.fontFamily = hostFont;
          dlg.style.overflow = 'hidden';
        }
      }

      const shadowHost = runtime.getSlotHostElement(modalHandle.bodyEl);
      if (shadowHost && shadowHost !== dlg && shadowHost.style) {
        shadowHost.style.width = '100%';
        shadowHost.style.height = '100%';
        shadowHost.style.display = 'flex';
        shadowHost.style.flexDirection = 'column';
      }

      const bodyRoot = modalHandle.bodyEl;
      while (bodyRoot.firstChild) bodyRoot.removeChild(bodyRoot.firstChild);

      const topBar = doc.createElement('div');
      topBar.setAttribute(CUSTOMIZATIONS_TOPBAR_ATTR, 'true');

      const backBtn = doc.createElement('button');
      backBtn.type = 'button';
      backBtn.setAttribute(CUSTOMIZATIONS_BACK_ATTR, 'true');
      backBtn.textContent = getBackLabel();
      backBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        closeOverlay();
      });

      const closeBtn = doc.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute(CUSTOMIZATIONS_CLOSE_ATTR, 'true');
      closeBtn.setAttribute('aria-label', 'Close MCP Manager');
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        closeOverlay();
      });

      topBar.appendChild(backBtn);
      topBar.appendChild(closeBtn);

      const content = doc.createElement('div');
      content.setAttribute(CUSTOMIZATIONS_CONTENT_ATTR, 'true');

      bodyRoot.appendChild(topBar);
      bodyRoot.appendChild(content);

      modalBackBtnEl = backBtn;
      modalContentEl = content;
      renderModalContent();
      syncLabels();
    }

    function ensureMount() {
      const found = findCustomizationsMcpHeader();
      if (!found) return;
      const { row, actionContainer, firstActionButton } = found;

      if (btnHostEl && btnHostEl.isConnected && row.contains(btnHostEl)) {
        if (activeModalHandle && activeModalHandle.element && activeModalHandle.element.isConnected) {
          renderModalContent();
        }
        return;
      }

      const btnRoot = runtime.mountSlot(SLOT_IDS.CUSTOMIZATIONS_BTN, { container: actionContainer });
      if (!btnRoot) return;
      const btnHost = runtime.getSlotHostElement(btnRoot);
      if (btnHost && btnHost.style) {
        btnHost.style.display = 'inline-flex';
        btnHost.style.alignItems = 'center';
      }
      while (btnRoot.firstChild) btnRoot.removeChild(btnRoot.firstChild);

      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.setAttribute(CUSTOMIZATIONS_BTN_ATTR, 'true');
      btn.textContent = getButtonLabel();
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openOverlay(btn);
      });

      btnRoot.appendChild(btn);
      btnHostEl = btnHost;
      btnRootEl = btnRoot;
      btnEl = btn;

      if (firstActionButton && firstActionButton.parentElement === actionContainer && firstActionButton !== btnHost) {
        actionContainer.insertBefore(btnHost, firstActionButton);
      }
    }

    function handleKeydown(ev) {
      // Host ModalPortal handles capture-phase Escape LIFO; keep fallback only if not already handled
      if (ev.key !== 'Escape' || ev.defaultPrevented || ev.isComposing || ev.keyCode === 229) return;
      if (activeModalHandle && activeModalHandle.element && activeModalHandle.element.isConnected) {
        ev.preventDefault();
        closeOverlay();
      }
    }

    function getFrames() {
      return modalFrameEl && modalFrameEl.isConnected ? [modalFrameEl] : [];
    }

    function dispose() {
      lastTriggerBtn = null;
      closeOverlay();
      btnHostEl = null;
      btnRootEl = null;
      btnEl = null;
      try {
        runtime.unmountSlot(SLOT_IDS.CUSTOMIZATIONS_BTN);
      } catch {
        // Ignore if host already unmounted
      }
    }

    return Object.freeze({
      id: 'customizations',
      ensureMount,
      syncLabels,
      getFrames,
      handleKeydown,
      dispose,
    });
  }

  // --- module: mount-coordinator.mjs ---
  /**
   * Renderer Mount Coordinator (`src/adapters/antigravity/renderer/mount-coordinator.mjs`).
   *
   * SOLID Boundaries:
   * - OCP: Coordinates an open list of uniform Mount Adapters (`ensureMount`, `syncLabels`,
   *   `getFrames`, `handleKeydown`, `dispose`) and slot-scoped CSS descriptors without knowing
   *   internal DOM details of each surface.
   * - DIP: Receives `runtime` (wrapping `AddonManifest.v2` `addonHost`) and `adapters` via
   *   dependency injection; wires a single deterministic `runtime.onDispose(...)` teardown that
   *   disconnects observers, detaches managed listeners, disposes adapters, and removes every
   *   slot-scoped style.
   */
  function createMountCoordinator({ runtime, adapters, win = window, doc = document }) {
    const styleDescriptors = buildSlotStyleDescriptors();
    let started = false;
    let disposed = false;
    let scheduled = false;
    let observer = null;
    let unbindUrlListener = null;
    let detachKeydown = null;
    let detachMessage = null;
    let detachDomReady = null;

    function ensureAllMounts() {
      if (disposed) return;
      for (const adapter of adapters) {
        adapter.ensureMount();
      }
    }

    function syncAllLabels() {
      if (disposed) return;
      for (const adapter of adapters) {
        adapter.syncLabels();
      }
    }

    function collectFrames() {
      const frames = [];
      for (const adapter of adapters) {
        for (const frame of adapter.getFrames()) {
          frames.push(frame);
        }
      }
      return frames;
    }

    function scheduleEnsure() {
      if (disposed || scheduled) return;
      scheduled = true;
      const run = () => {
        scheduled = false;
        ensureAllMounts();
      };
      if (typeof win.requestAnimationFrame === 'function') {
        win.requestAnimationFrame(run);
      } else {
        setTimeout(run, 16);
      }
    }

    function onKeydown(ev) {
      if (disposed) return;
      for (const adapter of adapters) {
        adapter.handleKeydown(ev);
      }
    }

    function onMessage(ev) {
      if (disposed) return;
      if (!runtime.isTrustedIframeMessage(ev, collectFrames())) return;
      if (ev.data?.type === 'agy-mcp-lang-change' && (ev.data.lang === 'ko' || ev.data.lang === 'en')) {
        runtime.writeSavedLang(ev.data.lang);
        syncAllLabels();
      }
    }

    function attachObserver() {
      if (disposed || !doc.body || observer) return;
      ensureAllMounts();
      observer = new MutationObserver(scheduleEnsure);
      observer.observe(doc.body, { childList: true, subtree: true });
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      scheduled = false;

      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (detachDomReady) {
        detachDomReady();
        detachDomReady = null;
      }
      if (detachKeydown) {
        detachKeydown();
        detachKeydown = null;
      }
      if (detachMessage) {
        detachMessage();
        detachMessage = null;
      }
      if (unbindUrlListener) {
        unbindUrlListener();
        unbindUrlListener = null;
      }

      for (let i = adapters.length - 1; i >= 0; i -= 1) {
        try {
          adapters[i].dispose();
        } catch {
          // Isolate per-adapter teardown errors
        }
      }
      for (const desc of styleDescriptors) {
        try {
          runtime.removeStyle(desc.styleId);
        } catch {
          // Ignore if host already removed style
        }
      }
    }

    function start() {
      if (started || disposed) return;
      started = true;

      for (const desc of styleDescriptors) {
        runtime.injectStyle(desc.styleId, desc.cssText, { slotId: desc.slotId });
      }
      runtime.onDispose(dispose);

      detachKeydown = runtime.addManagedListener(win, 'keydown', onKeydown);
      detachMessage = runtime.addManagedListener(win, 'message', onMessage);
      unbindUrlListener = runtime.bindServerUrlListener((nextUrl) => {
        if (nextUrl) {
          scheduleEnsure();
        }
      });

      if (doc.body) {
        attachObserver();
      } else {
        detachDomReady = runtime.addManagedListener(
          win,
          'DOMContentLoaded',
          () => {
            detachDomReady = null;
            attachObserver();
          },
          { once: true }
        );
      }
    }

    return Object.freeze({
      start,
      ensureAllMounts,
      syncAllLabels,
      dispose,
    });
  }

  // --- composition root ---
  const runtime = createHostRuntime({ addonHost, win: window, doc: document });
  let coordinator = null;
  const onLangChange = () => {
    if (coordinator) coordinator.syncAllLabels();
  };
  coordinator = createMountCoordinator({
    runtime,
    adapters: [
      createSettingsSidebarMount({ runtime, onLangChange, win: window, doc: document }),
      createCustomizationsMount({ runtime, onLangChange, win: window, doc: document }),
    ],
    win: window,
    doc: document,
  });
  coordinator.start();
})(typeof addonHost !== "undefined" ? addonHost : undefined);
