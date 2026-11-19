/**
 * Antigravity 2.0 Settings Left-Sidebar Menu Injector
 * (`src/adapters/antigravity/settings-menu-injector.js`).
 *
 * Security & UX Invariants:
 * 1. ZERO unsafe DOM sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`).
 * 2. Only accepts loopback `http://127.0.0.1:<port>/?token=...` iframe URLs.
 * 3. NEVER removes or mutates Antigravity's native React nodes — only hides/restores sibling
 *    content elements via `style.display` while preserving top-right Settings close (`X`) controls.
 * 4. Matches native Settings sidebar typography, spacing, and single-active pill highlight
 *    (no dual-active tabs, no browser default blue focus box), and syncs host font & surface
 *    theme into the embedded iframe.
 * 5. Idempotent across repeated `dom-ready` / `did-finish-load` injections.
 */

(function () {
  'use strict';

  const NAV_ATTR = 'data-agy-mcp-manager-nav';
  const FRAME_ATTR = 'data-agy-mcp-manager-frame';
  const PREV_DISPLAY_ATTR = 'agyMcpPrevDisplay';
  const SUPPRESSED_BG_ATTR = 'agyMcpSuppressedBg';
  const SUPPRESSED_COLOR_ATTR = 'agyMcpSuppressedColor';
  const REQUIRED_SIBLING_LABELS = ['general', 'application', 'appearance', 'shortcuts', 'notifications', 'models', 'browser'];

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

  function findSettingsSidebarAndAnchor() {
    const candidates = document.querySelectorAll('button, a, [role="tab"], [role="menuitem"], [role="button"], li, div');
    for (const el of candidates) {
      if (el.hasAttribute(NAV_ATTR)) continue;
      if (el.children.length > 2) continue;
      if (normalizedText(el) !== 'browser') continue;

      let container = el.parentElement;
      for (let depth = 0; depth < 4 && container && container !== document.body; depth += 1) {
        const items = Array.from(container.querySelectorAll('button, a, [role="tab"], [role="menuitem"], [role="button"], li, div'));
        const seen = new Set();
        for (const item of items) {
          if (item.children.length > 2) continue;
          const txt = normalizedText(item);
          if (REQUIRED_SIBLING_LABELS.includes(txt)) seen.add(txt);
        }
        if (seen.size >= 4) {
          let anchor = el;
          while (anchor.parentElement && anchor.parentElement !== container && anchor.parentElement.children.length === 1) {
            anchor = anchor.parentElement;
          }
          return { sidebar: container, listParent: anchor.parentElement || container, browserItem: anchor };
        }
        container = container.parentElement;
      }
    }
    return null;
  }

  function findSettingsLayout(sidebar) {
    const sidebarRect = sidebar.getBoundingClientRect?.() || { left: 0, right: 0, width: 0, height: 0 };
    let cursor = sidebar;
    for (let depth = 0; depth < 8 && cursor && cursor.parentElement && cursor.parentElement !== document.documentElement; depth += 1) {
      const parent = cursor.parentElement;
      const cursorRect = cursor.getBoundingClientRect?.() || sidebarRect;
      const rightBoundary = Math.max(sidebarRect.right, cursorRect.right);
      const siblings = Array.from(parent.children).filter((child) => {
        if (child === cursor || child.nodeType !== 1) return false;
        if (child.tagName === 'STYLE' || child.tagName === 'SCRIPT') return false;
        const r = child.getBoundingClientRect?.();
        if (!r) return false;
        // Must be positioned horizontally to the RIGHT of the left sidebar (never a vertical sibling inside the sidebar!)
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
    // Also preserve a compact top-right wrapper that only holds the close button
    const r = child.getBoundingClientRect?.();
    if (r && contentPaneRect && r.width <= 64 && r.height <= 64 && r.right >= contentPaneRect.right - 72 && r.top <= contentPaneRect.top + 72) {
      const innerBtn = child.querySelector?.('button');
      if (innerBtn && isCloseBtn(innerBtn)) return true;
    }
    return false;
  }

  function buildThemedIframeUrl(baseUrl, contentPane) {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('hostMode', 'settings');
      const bodyCs = window.getComputedStyle(document.body);
      if (bodyCs?.fontFamily) {
        url.searchParams.set('hostFont', bodyCs.fontFamily);
      }
      if (bodyCs?.color) {
        url.searchParams.set('hostFg', bodyCs.color);
      }
      const paneBg = contentPane ? window.getComputedStyle(contentPane)?.backgroundColor : '';
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

  function suppressNativeActiveItems(outerSidebar, navItem) {
    let detectedActiveBg = 'rgba(255, 255, 255, 0.09)';
    let detectedActiveColor = '';
    const items = outerSidebar ? outerSidebar.querySelectorAll('button, a, [role="tab"], [role="menuitem"], [role="button"], li, div') : [];
    for (const item of items) {
      if (item === navItem || item.hasAttribute(NAV_ATTR)) continue;
      if (item.children.length > 2) continue;
      const cs = window.getComputedStyle(item);
      const bg = cs?.backgroundColor || '';
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        const r = item.getBoundingClientRect?.();
        if (r && r.height >= 24 && r.height <= 48 && r.width >= 80 && r.width <= 260) {
          detectedActiveBg = bg;
          if (cs.color) detectedActiveColor = cs.color;
          if (!Object.prototype.hasOwnProperty.call(item.dataset, SUPPRESSED_BG_ATTR)) {
            item.dataset[SUPPRESSED_BG_ATTR] = item.style.backgroundColor || '';
            item.dataset[SUPPRESSED_COLOR_ATTR] = item.style.color || '';
          }
          item.style.setProperty('background-color', 'transparent', 'important');
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
      navItem.style.backgroundColor = 'transparent';
      if (navItem.dataset.agyMcpBaseColor) {
        navItem.style.color = navItem.dataset.agyMcpBaseColor;
      }
    }
    if (!contentPane) return;
    const frame = contentPane.querySelector(`[${FRAME_ATTR}="true"]`);
    if (frame) frame.style.display = 'none';
    for (const child of Array.from(contentPane.children)) {
      if (child.hasAttribute(FRAME_ATTR)) continue;
      if (child.dataset && Object.prototype.hasOwnProperty.call(child.dataset, PREV_DISPLAY_ATTR)) {
        child.style.display = child.dataset[PREV_DISPLAY_ATTR];
        delete child.dataset[PREV_DISPLAY_ATTR];
      }
    }
  }

  function showMcpManagerPane(outerSidebar, contentPane, navItem) {
    const baseUrl = window.__AGY_MCP_MANAGER_URL__;
    if (!isSafeLoopbackIframeUrl(baseUrl) || !contentPane) return;

    const { activeBg, activeColor } = suppressNativeActiveItems(outerSidebar, navItem);
    if (navItem) {
      navItem.setAttribute('aria-selected', 'true');
      navItem.dataset.agyMcpActive = 'true';
      navItem.style.backgroundColor = activeBg;
      if (activeColor) navItem.style.color = activeColor;
    }

    const contentPaneRect = contentPane.getBoundingClientRect?.();
    for (const child of Array.from(contentPane.children)) {
      if (child.hasAttribute(FRAME_ATTR)) continue;
      if (isSettingsCloseControl(child, contentPaneRect)) {
        child.style.zIndex = '20';
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(child.dataset, PREV_DISPLAY_ATTR)) {
        child.dataset[PREV_DISPLAY_ATTR] = child.style.display || '';
      }
      child.style.display = 'none';
    }

    const themedUrl = buildThemedIframeUrl(baseUrl, contentPane);
    let frame = contentPane.querySelector(`[${FRAME_ATTR}="true"]`);
    if (!frame) {
      frame = document.createElement('iframe');
      frame.setAttribute(FRAME_ATTR, 'true');
      frame.setAttribute('title', 'MCP Manager');
      frame.style.width = '100%';
      frame.style.height = '100%';
      frame.style.minHeight = 'calc(100vh - 64px)';
      frame.style.border = '0';
      frame.style.display = 'block';
      frame.style.background = 'transparent';
      frame.src = themedUrl;
      contentPane.appendChild(frame);
    } else {
      if (frame.src !== themedUrl) frame.src = themedUrl;
      frame.style.display = 'block';
    }
  }

  function applyNativeNavTypography(navItem, referenceItem) {
    const cs = window.getComputedStyle(referenceItem);
    navItem.style.fontFamily = cs.fontFamily || 'inherit';
    navItem.style.fontSize = cs.fontSize || '13px';
    navItem.style.fontWeight = cs.fontWeight || '400';
    navItem.style.lineHeight = cs.lineHeight || 'normal';
    navItem.style.letterSpacing = cs.letterSpacing || 'normal';
    navItem.style.padding = cs.padding || '8px 12px';
    navItem.style.borderRadius = cs.borderRadius || '6px';
    navItem.style.color = cs.color || 'inherit';
    navItem.dataset.agyMcpBaseColor = cs.color || '';
    navItem.style.width = '100%';
    navItem.style.textAlign = 'left';
    navItem.style.cursor = 'pointer';
    navItem.style.border = '0';
    navItem.style.outline = 'none';
    navItem.style.boxShadow = 'none';
    navItem.style.backgroundColor = 'transparent';
    navItem.style.appearance = 'none';
  }

  function ensureSettingsMenuItem() {
    const baseUrl = window.__AGY_MCP_MANAGER_URL__;
    if (!isSafeLoopbackIframeUrl(baseUrl)) return;

    const found = findSettingsSidebarAndAnchor();
    if (!found) return;
    const { sidebar, listParent, browserItem } = found;
    const { outerSidebar, contentPane: initialContentPane } = findSettingsLayout(sidebar);

    const existingNav = sidebar.querySelector(`[${NAV_ATTR}="true"]`);
    if (existingNav) {
      const existingFrame = initialContentPane?.querySelector(`[${FRAME_ATTR}="true"]`);
      const nextUrl = buildThemedIframeUrl(baseUrl, initialContentPane);
      if (existingFrame && existingFrame.src !== nextUrl) {
        existingFrame.src = nextUrl;
      }
      return;
    }

    const navItem = document.createElement(browserItem.tagName === 'LI' ? 'li' : 'button');
    if (navItem.tagName === 'BUTTON') navItem.type = 'button';
    navItem.setAttribute(NAV_ATTR, 'true');
    navItem.setAttribute('role', 'tab');
    navItem.setAttribute('aria-selected', 'false');
    navItem.className = browserItem.className || '';
    navItem.textContent = 'MCP Manager';
    applyNativeNavTypography(navItem, browserItem);

    navItem.addEventListener('mouseenter', () => {
      if (navItem.dataset.agyMcpActive !== 'true') {
        navItem.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
      }
    });
    navItem.addEventListener('mouseleave', () => {
      if (navItem.dataset.agyMcpActive !== 'true') {
        navItem.style.backgroundColor = 'transparent';
      }
    });

    navItem.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      navItem.blur?.();
      const layout = findSettingsLayout(sidebar);
      showMcpManagerPane(layout.outerSidebar, layout.contentPane, navItem);
    });

    const clickHost = outerSidebar || sidebar;
    if (!clickHost.dataset.agyMcpClickBound) {
      clickHost.dataset.agyMcpClickBound = 'true';
      clickHost.addEventListener(
        'click',
        (ev) => {
          const target = ev.target;
          if (!target || target.closest?.(`[${NAV_ATTR}="true"]`)) return;
          const activeNav = clickHost.querySelector(`[${NAV_ATTR}="true"]`);
          if (activeNav && activeNav.dataset.agyMcpActive === 'true') {
            const layout = findSettingsLayout(sidebar);
            restoreNativePane(layout.outerSidebar, layout.contentPane, activeNav);
          }
        },
        true
      );
    }

    if (browserItem.nextSibling) {
      listParent.insertBefore(navItem, browserItem.nextSibling);
    } else {
      listParent.appendChild(navItem);
    }
  }

  if (window.__AGY_MCP_MANAGER_INJECTOR_ACTIVE__) {
    ensureSettingsMenuItem();
    return;
  }
  window.__AGY_MCP_MANAGER_INJECTOR_ACTIVE__ = true;

  let scheduled = false;
  const scheduleEnsure = () => {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      ensureSettingsMenuItem();
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(run);
    } else {
      setTimeout(run, 16);
    }
  };

  if (document.body) {
    ensureSettingsMenuItem();
    const observer = new MutationObserver(scheduleEnsure);
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => {
        ensureSettingsMenuItem();
        const observer = new MutationObserver(scheduleEnsure);
        observer.observe(document.body, { childList: true, subtree: true });
      },
      { once: true }
    );
  }
})();
