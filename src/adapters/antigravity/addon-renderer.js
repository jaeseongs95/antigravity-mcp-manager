/**
 * AUTO-GENERATED AddonManifest.v1 Renderer Entry (`src/adapters/antigravity/addon-renderer.js`).
 * Source of truth: `src/adapters/antigravity/renderer/*.mjs` (run `npm run build:renderer`).
 *
 * Executed by `antigravity-native-addon-host` as `(function(addonHost){ ... })(__addonHandle)`.
 * ZERO unsafe DOM sinks, ZERO direct `app.asar` hooks, 100% owner-scoped `addonHost` APIs.
 */

(function (addonHost) {
  'use strict';

  if (!addonHost || typeof addonHost.mountSlot !== "function") {
    return;
  }

  // --- module: host-runtime.mjs ---
  /**
   * Host Capability Runtime Adapter (`src/adapters/antigravity/renderer/host-runtime.mjs`).
   *
   * SOLID Boundaries:
   * - SRP: Owns `addonHost` capability handle delegation, loopback URL validation,
   *   namespaced language storage (with 1-time migration from legacy v2.1 key),
   *   theme URL building, and origin/source-validated iframe `postMessage` checks.
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
  const LEGACY_LANG_STORAGE_KEY = 'agy-mcp-manager-lang';
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
  function assertAddonHostHandle(addonHost) {
    if (!addonHost || typeof addonHost !== 'object') {
      throw new Error('ERR_MISSING_ADDON_HOST_HANDLE');
    }
    for (const method of ['mountSlot', 'unmountSlot', 'injectStyle', 'removeStyle', 'onDispose']) {
      if (typeof addonHost[method] !== 'function') {
        throw new Error(`ERR_INVALID_ADDON_HOST_HANDLE:${method}`);
      }
    }
    return addonHost;
  }
  function createHostRuntime({ addonHost, win = window, doc = document }) {
    const host = assertAddonHostHandle(addonHost);
    const pluginId = String(host.pluginId || 'antigravity-mcp-manager');
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

    return Object.freeze({
      pluginId,
      storageNamespace,
      ipcChannelPrefix,
      langStorageKey,
      readSavedLang,
      writeSavedLang,
      getServerUrl,
      bindServerUrlListener,
      buildThemedIframeUrl,
      isTrustedIframeMessage,
      mountSlot: (slotId, parentEl) => host.mountSlot(slotId, parentEl),
      unmountSlot: (slotId) => host.unmountSlot(slotId),
      injectStyle: (styleId, cssText) => host.injectStyle(styleId, cssText),
      removeStyle: (styleId) => host.removeStyle(styleId),
      onDispose: (fn) => host.onDispose(fn),
    });
  }

  // --- module: addon-styles.mjs ---
  /**
   * Owner-Scoped CSS Definitions (`src/adapters/antigravity/renderer/addon-styles.mjs`).
   *
   * SOLID Responsibility (SRP):
   * - Declares strictly owner/slot-scoped CSS injected via `addonHost.injectStyle(...)`
   *   so zero global selectors leak into Antigravity Desktop or sibling plugins,
   *   and `addonHost.dispose()` automatically removes every rule.
   */
  const ADDON_STYLE_ID = 'mcp-manager-ui';
  function buildAddonCss() {
    return [
      '[data-addon-host-slot="antigravity-mcp-manager.settings-nav"],',
      '[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"] {',
      '  display: contents;',
      '}',
      '[data-addon-host-slot="antigravity-mcp-manager.pane"] {',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  display: block;',
      '}',
      '[data-addon-host-slot="antigravity-mcp-manager.pane"][data-agy-mcp-hidden="true"] {',
      '  display: none;',
      '}',
      '[data-addon-host-slot="antigravity-mcp-manager.customizations-overlay"] {',
      '  position: fixed;',
      '  inset: 0;',
      '  z-index: 9999;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      '[data-addon-host-slot="antigravity-mcp-manager.customizations-overlay"][data-agy-mcp-hidden="true"] {',
      '  display: none;',
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
      '[data-agy-mcp-manager-frame="true"] {',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  border: 0;',
      '  display: block;',
      '  background: transparent;',
      '}',
    ].join('\n');
  }

  // --- module: settings-sidebar-mount.mjs ---
  /**
   * Settings Sidebar Mount Adapter (`src/adapters/antigravity/renderer/settings-sidebar-mount.mjs`).
   *
   * SOLID Boundaries:
   * - SRP: Discovers Antigravity's Settings left sidebar (`Browser`/`브라우저`) and right
   *   content pane, mounts the `settings-nav` and `pane` slots via `runtime.mountSlot(...)`,
   *   handles paint-only 0px-shift selection, preserves native top-right close (`✕`),
   *   and restores all native DOM state on sibling click or `dispose()`.
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
  function createSettingsSidebarMount({ runtime, win = window, doc = document }) {
    let boundClickHost = null;
    let boundClickHandler = null;
    let activeSidebar = null;
    let activeContentPane = null;

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
    function suppressNativeActiveItems(listParent, navSlot, inactiveColor) {
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
          if (sib.nodeType !== 1 || sib === navSlot || sib.getAttribute('data-addon-host-slot') === SLOT_IDS.SETTINGS_NAV) continue;
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
      if (!contentPane) return;
      const paneSlot = contentPane.querySelector(`[data-addon-host-slot="${SLOT_IDS.SETTINGS_PANE}"]`);
      if (paneSlot) {
        paneSlot.setAttribute('data-agy-mcp-hidden', 'true');
        paneSlot.style.display = 'none';
      }
      for (const child of Array.from(contentPane.children)) {
        if (child.getAttribute('data-addon-host-slot') === SLOT_IDS.SETTINGS_PANE) continue;
        if (child.dataset && Object.prototype.hasOwnProperty.call(child.dataset, PREV_DISPLAY_ATTR)) {
          child.style.display = child.dataset[PREV_DISPLAY_ATTR];
          delete child.dataset[PREV_DISPLAY_ATTR];
        }
      }
    }

    function showMcpManagerPane(outerSidebar, listParent, contentPane, navSlot, navItem) {
      const baseUrl = runtime.getServerUrl();
      if (!baseUrl || !contentPane) return;

      activeSidebar = outerSidebar;
      activeContentPane = contentPane;

      const inactiveColor = navItem?.dataset?.agyMcpInactiveColor || '';
      const { activeBg, activeColor } = suppressNativeActiveItems(listParent, navSlot, inactiveColor);

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
        if (child.getAttribute('data-addon-host-slot') === SLOT_IDS.SETTINGS_PANE) continue;
        if (isSettingsCloseControl(child, contentPaneRect)) {
          child.style.zIndex = '20';
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(child.dataset, PREV_DISPLAY_ATTR)) {
          child.dataset[PREV_DISPLAY_ATTR] = child.style.display || '';
        }
        child.style.display = 'none';
      }

      const themedUrl = runtime.buildThemedIframeUrl(baseUrl, contentPane);
      const paneSlot = runtime.mountSlot(SLOT_IDS.SETTINGS_PANE, contentPane);
      paneSlot.removeAttribute('data-agy-mcp-hidden');
      paneSlot.style.display = 'block';

      let frame = paneSlot.querySelector(`[${FRAME_ATTR}="true"]`);
      if (!frame) {
        frame = doc.createElement('iframe');
        frame.setAttribute(FRAME_ATTR, 'true');
        frame.setAttribute('title', 'MCP Manager');
        frame.src = themedUrl;
        paneSlot.appendChild(frame);
      } else if (!sameFrameBaseAndTheme(frame.src, themedUrl)) {
        frame.src = themedUrl;
      }
    }

    function ensureMount() {
      const baseUrl = runtime.getServerUrl();
      if (!baseUrl) return;

      const found = findSettingsSidebarAndAnchor();
      if (!found) return;
      const { sidebar, listParent, browserItem, inactiveTemplate } = found;
      const { outerSidebar, contentPane: initialContentPane } = findSettingsLayout(sidebar);

      const existingNav = sidebar.querySelector(`[${NAV_ATTR}="true"]`);
      if (existingNav) {
        const existingFrame = initialContentPane?.querySelector(`[${FRAME_ATTR}="true"]`);
        const nextUrl = runtime.buildThemedIframeUrl(baseUrl, initialContentPane);
        if (existingFrame && !sameFrameBaseAndTheme(existingFrame.src, nextUrl)) {
          existingFrame.src = nextUrl;
        }
        return;
      }

      const navSlot = runtime.mountSlot(SLOT_IDS.SETTINGS_NAV, listParent);
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
        showMcpManagerPane(layout.outerSidebar, listParent, layout.contentPane, navSlot, navItem);
      });

      navSlot.appendChild(navItem);

      // Position inside the same listParent right after browserItem (parentNode unchanged -> host idempotent & auto-disposed)
      if (browserItem.nextSibling && browserItem.nextSibling !== navSlot) {
        listParent.insertBefore(navSlot, browserItem.nextSibling);
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
          const activeNav = clickHost.querySelector(`[${NAV_ATTR}="true"]`);
          if (activeNav && activeNav.dataset.agyMcpActive === 'true') {
            const layout = findSettingsLayout(sidebar);
            restoreNativePane(layout.outerSidebar, layout.contentPane, activeNav);
          }
        };
        clickHost.addEventListener('click', boundClickHandler, true);
      }
    }

    function getFrames() {
      const paneSlot = doc.querySelector(`[data-addon-host-slot="${SLOT_IDS.SETTINGS_PANE}"]`);
      const frame = paneSlot?.querySelector(`[${FRAME_ATTR}="true"]`);
      return frame ? [frame] : [];
    }

    function dispose() {
      const navItem = doc.querySelector(`[${NAV_ATTR}="true"]`);
      restoreNativePane(activeSidebar || boundClickHost, activeContentPane, navItem);
      if (boundClickHost && boundClickHandler) {
        boundClickHost.removeEventListener('click', boundClickHandler, true);
      }
      boundClickHost = null;
      boundClickHandler = null;
      activeSidebar = null;
      activeContentPane = null;
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
      syncLabels: () => {},
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
   *   mounts the trigger button (`custom` slot) immediately before right-hand action icons
   *   and opens/closes the full-pane `role="dialog"` overlay (`overlay` slot) with live
   *   EN/KO label sync, Back/Close/Escape handling, and focus restoration.
   * - LSP / ISP: Implements the exact same Mount Adapter contract as `settings-sidebar-mount.mjs`.
   */
  const CUSTOMIZATIONS_BTN_ATTR = 'data-agy-mcp-customizations-btn';
  const CUSTOMIZATIONS_OVERLAY_ATTR = 'data-agy-mcp-customizations-overlay';
  const CUSTOMIZATIONS_TOPBAR_ATTR = 'data-agy-mcp-customizations-topbar';
  const CUSTOMIZATIONS_BACK_ATTR = 'data-agy-mcp-customizations-back';
  const CUSTOMIZATIONS_CLOSE_ATTR = 'data-agy-mcp-customizations-close';

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
  function createCustomizationsMount({ runtime, win = window, doc = document }) {
    let lastTriggerBtn = null;

    function getButtonLabel() {
      return runtime.readSavedLang() === 'ko' ? 'MCP 매니저' : 'MCP Manager';
    }

    function getBackLabel() {
      return runtime.readSavedLang() === 'ko' ? '← Customizations로 돌아가기' : '← Back to Customizations';
    }

    function isCustomizationsPageVisible() {
      const candidates = doc.querySelectorAll('h1, h2, h3, h4, div, span, button');
      for (const el of candidates) {
        if (el.children.length > 2) continue;
        if (el.closest?.(`[${CUSTOMIZATIONS_OVERLAY_ATTR}="true"]`)) continue;
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
        if (el.closest?.(`[${CUSTOMIZATIONS_OVERLAY_ATTR}="true"]`)) continue;
        if (el.hasAttribute(CUSTOMIZATIONS_BTN_ATTR)) continue;
        if (!isMcpServersLabel(normalizedText(el))) continue;

        let row = el.parentElement;
        for (let depth = 0; depth < 4 && row && row !== doc.body; depth += 1) {
          const buttons = Array.from(row.querySelectorAll('button')).filter(
            (b) => !b.hasAttribute(CUSTOMIZATIONS_BTN_ATTR) && !b.contains(el)
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
      const btn = doc.querySelector(`[${CUSTOMIZATIONS_BTN_ATTR}="true"]`);
      if (btn) btn.textContent = getButtonLabel();
      const backBtn = doc.querySelector(`[${CUSTOMIZATIONS_BACK_ATTR}="true"]`);
      if (backBtn) backBtn.textContent = getBackLabel();
    }

    function closeOverlay() {
      const overlay = doc.querySelector(`[data-addon-host-slot="${SLOT_IDS.CUSTOMIZATIONS_OVERLAY}"]`);
      if (overlay) {
        overlay.setAttribute('data-agy-mcp-hidden', 'true');
        overlay.style.display = 'none';
      }
      if (lastTriggerBtn && typeof lastTriggerBtn.focus === 'function') {
        try {
          lastTriggerBtn.focus();
        } catch {
          // Ignore focus restoration errors
        }
      }
    }

    function openOverlay(triggerBtn) {
      const baseUrl = runtime.getServerUrl();
      if (!baseUrl || !doc.body) return;
      lastTriggerBtn = triggerBtn || null;

      const bodyCs = win.getComputedStyle(doc.body);
      const bodyBg = bodyCs?.backgroundColor || '';
      const hostBg = bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent' ? bodyBg : '#0d0e11';
      const hostFg = bodyCs?.color || '#e5e7eb';
      const hostFont = bodyCs?.fontFamily || 'sans-serif';
      const themedUrl = runtime.buildThemedIframeUrl(baseUrl, doc.body);

      const overlay = runtime.mountSlot(SLOT_IDS.CUSTOMIZATIONS_OVERLAY, doc.body);
      overlay.setAttribute(CUSTOMIZATIONS_OVERLAY_ATTR, 'true');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'MCP Manager');
      overlay.style.background = hostBg;
      overlay.style.color = hostFg;
      overlay.style.fontFamily = hostFont;

      let frame = overlay.querySelector(`[${FRAME_ATTR}="true"]`);
      if (!frame) {
        while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

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

        frame = doc.createElement('iframe');
        frame.setAttribute(FRAME_ATTR, 'true');
        frame.setAttribute('data-agy-mcp-customizations-frame', 'true');
        frame.setAttribute('title', 'MCP Manager');
        frame.src = themedUrl;

        overlay.appendChild(topBar);
        overlay.appendChild(frame);
      } else if (!sameFrameBaseAndTheme(frame.src, themedUrl)) {
        frame.src = themedUrl;
      }

      syncLabels();
      overlay.removeAttribute('data-agy-mcp-hidden');
      overlay.style.display = 'flex';
    }

    function ensureMount() {
      const baseUrl = runtime.getServerUrl();
      if (!baseUrl) return;

      const found = findCustomizationsMcpHeader();
      if (!found) return;
      const { row, actionContainer, firstActionButton } = found;

      if (row.querySelector(`[${CUSTOMIZATIONS_BTN_ATTR}="true"]`)) {
        return;
      }

      const btnSlot = runtime.mountSlot(SLOT_IDS.CUSTOMIZATIONS_BTN, actionContainer);
      while (btnSlot.firstChild) btnSlot.removeChild(btnSlot.firstChild);

      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.setAttribute(CUSTOMIZATIONS_BTN_ATTR, 'true');
      btn.textContent = getButtonLabel();
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openOverlay(btn);
      });

      btnSlot.appendChild(btn);

      if (firstActionButton && firstActionButton.parentElement === actionContainer && firstActionButton !== btnSlot) {
        actionContainer.insertBefore(btnSlot, firstActionButton);
      }
    }

    function handleKeydown(ev) {
      if (ev.key !== 'Escape') return;
      const overlay = doc.querySelector(`[data-addon-host-slot="${SLOT_IDS.CUSTOMIZATIONS_OVERLAY}"]`);
      if (overlay && overlay.style.display !== 'none' && overlay.getAttribute('data-agy-mcp-hidden') !== 'true') {
        ev.preventDefault();
        closeOverlay();
      }
    }

    function getFrames() {
      const overlay = doc.querySelector(`[data-addon-host-slot="${SLOT_IDS.CUSTOMIZATIONS_OVERLAY}"]`);
      const frame = overlay?.querySelector(`[${FRAME_ATTR}="true"]`);
      return frame ? [frame] : [];
    }

    function dispose() {
      lastTriggerBtn = null;
      try {
        runtime.unmountSlot(SLOT_IDS.CUSTOMIZATIONS_OVERLAY);
      } catch {
        // Ignore if host already unmounted
      }
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
   *   `getFrames`, `handleKeydown`, `dispose`) without knowing internal DOM details of each surface.
   * - DIP: Receives `runtime` (wrapping `addonHost`) and `adapters` via dependency injection;
   *   wires a single deterministic `runtime.onDispose(...)` teardown that disconnects observers,
   *   detaches window listeners, disposes adapters, and removes owner-scoped CSS.
   */
  function createMountCoordinator({ runtime, adapters, win = window, doc = document }) {
    let started = false;
    let disposed = false;
    let scheduled = false;
    let observer = null;
    let unbindUrlListener = null;
    let domReadyHandler = null;

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
      if (domReadyHandler) {
        win.removeEventListener('DOMContentLoaded', domReadyHandler);
        domReadyHandler = null;
      }
      win.removeEventListener('keydown', onKeydown);
      win.removeEventListener('message', onMessage);
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
      try {
        runtime.removeStyle(ADDON_STYLE_ID);
      } catch {
        // Ignore if host already removed style
      }
    }

    function start() {
      if (started || disposed) return;
      started = true;

      runtime.injectStyle(ADDON_STYLE_ID, buildAddonCss());
      runtime.onDispose(dispose);

      win.addEventListener('keydown', onKeydown);
      win.addEventListener('message', onMessage);
      unbindUrlListener = runtime.bindServerUrlListener((nextUrl) => {
        if (nextUrl) {
          scheduleEnsure();
        }
      });

      if (doc.body) {
        attachObserver();
      } else {
        domReadyHandler = () => {
          domReadyHandler = null;
          attachObserver();
        };
        win.addEventListener('DOMContentLoaded', domReadyHandler, { once: true });
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
  const coordinator = createMountCoordinator({
    runtime,
    adapters: [
      createSettingsSidebarMount({ runtime, win: window, doc: document }),
      createCustomizationsMount({ runtime, win: window, doc: document }),
    ],
    win: window,
    doc: document,
  });
  coordinator.start();
})(typeof addonHost !== "undefined" ? addonHost : undefined);
