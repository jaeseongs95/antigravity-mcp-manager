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

import {
  FRAME_ATTR,
  SLOT_IDS,
  createSidecarLauncherView,
  hasVisibleBg,
  normalizedText,
  replaceLeafText,
  sameFrameBaseAndTheme,
} from './host-runtime.mjs';
import { createNativeMcpPanel } from './native-mcp-panel.mjs';

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

export function createSettingsSidebarMount({ runtime, onLangChange = () => {}, win = window, doc = document }) {
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
  let nativePanelView = null;
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

    if (typeof runtime.hasConfigBridge === 'function' && runtime.hasConfigBridge()) {
      if (frameEl && frameEl.parentNode) frameEl.parentNode.removeChild(frameEl);
      frameEl = null;
      if (launcherView && launcherView.element.parentNode) launcherView.element.parentNode.removeChild(launcherView.element);
      launcherView = null;

      if (!nativePanelView || nativePanelView.element.parentNode !== slotRoot) {
        if (nativePanelView) nativePanelView.dispose();
        while (slotRoot.firstChild) slotRoot.removeChild(slotRoot.firstChild);
        const service = runtime.createConfigService();
        nativePanelView = createNativeMcpPanel({ runtime, service, surface: 'settings', onLangChange, doc });
        slotRoot.appendChild(nativePanelView.element);
      } else {
        nativePanelView.syncLang();
      }
      return;
    }

    if (nativePanelView) {
      nativePanelView.dispose();
      nativePanelView = null;
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
    if (nativePanelView) {
      nativePanelView.syncLang();
    }
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
    if (nativePanelView) {
      nativePanelView.dispose();
      nativePanelView = null;
    }
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
