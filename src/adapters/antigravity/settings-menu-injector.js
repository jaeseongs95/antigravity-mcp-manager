/**
 * Antigravity 2.0 Settings Left-Sidebar Menu Injector
 * (`src/adapters/antigravity/settings-menu-injector.js`).
 *
 * Security & UX Invariants:
 * 1. ZERO unsafe DOM sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`).
 * 2. Only accepts loopback `http://127.0.0.1:<port>/?token=...` iframe URLs.
 * 3. NEVER removes or mutates Antigravity's native React nodes — only hides/restores sibling
 *    content elements via `style.display` when toggling the `MCP Manager` Settings tab.
 * 4. Idempotent across repeated `dom-ready` / `did-finish-load` injections.
 */

(function () {
  'use strict';

  const NAV_ATTR = 'data-agy-mcp-manager-nav';
  const FRAME_ATTR = 'data-agy-mcp-manager-frame';
  const PREV_DISPLAY_ATTR = 'agyMcpPrevDisplay';
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

      // Walk up up to 4 levels to find the Settings left sidebar container holding General..Browser
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
          // Find the direct child of `container` (or list parent) that represents the Browser item
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

  function findSettingsContentPane(sidebar) {
    let cursor = sidebar;
    for (let depth = 0; depth < 4 && cursor && cursor.parentElement && cursor.parentElement !== document.body; depth += 1) {
      const parent = cursor.parentElement;
      const siblings = Array.from(parent.children).filter(
        (child) => child !== cursor && child.nodeType === 1 && child.tagName !== 'STYLE' && child.tagName !== 'SCRIPT'
      );
      if (siblings.length > 0) {
        // Pick the widest/largest non-sidebar sibling as the right-hand Settings content pane
        let best = siblings[0];
        for (const sib of siblings) {
          if ((sib.getBoundingClientRect?.().width || 0) > (best.getBoundingClientRect?.().width || 0)) {
            best = sib;
          }
        }
        return best;
      }
      cursor = parent;
    }
    return null;
  }

  function restoreNativePane(contentPane, navItem) {
    if (navItem) {
      navItem.setAttribute('aria-selected', 'false');
      navItem.dataset.agyMcpActive = 'false';
      navItem.style.backgroundColor = '';
      navItem.style.color = '';
      navItem.style.fontWeight = '';
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

  function showMcpManagerPane(contentPane, navItem) {
    const iframeUrl = window.__AGY_MCP_MANAGER_URL__;
    if (!isSafeLoopbackIframeUrl(iframeUrl) || !contentPane) return;

    if (navItem) {
      navItem.setAttribute('aria-selected', 'true');
      navItem.dataset.agyMcpActive = 'true';
      navItem.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
      navItem.style.color = 'inherit';
      navItem.style.fontWeight = '600';
    }

    for (const child of Array.from(contentPane.children)) {
      if (child.hasAttribute(FRAME_ATTR)) continue;
      if (!Object.prototype.hasOwnProperty.call(child.dataset, PREV_DISPLAY_ATTR)) {
        child.dataset[PREV_DISPLAY_ATTR] = child.style.display || '';
      }
      child.style.display = 'none';
    }

    let frame = contentPane.querySelector(`[${FRAME_ATTR}="true"]`);
    if (!frame) {
      frame = document.createElement('iframe');
      frame.setAttribute(FRAME_ATTR, 'true');
      frame.setAttribute('title', 'MCP Manager');
      frame.style.width = '100%';
      frame.style.height = '100%';
      frame.style.minHeight = '640px';
      frame.style.border = '0';
      frame.style.display = 'block';
      frame.style.background = 'transparent';
      frame.src = iframeUrl;
      contentPane.appendChild(frame);
    } else {
      if (frame.src !== iframeUrl) frame.src = iframeUrl;
      frame.style.display = 'block';
    }
  }

  function ensureSettingsMenuItem() {
    const iframeUrl = window.__AGY_MCP_MANAGER_URL__;
    if (!isSafeLoopbackIframeUrl(iframeUrl)) return;

    const found = findSettingsSidebarAndAnchor();
    if (!found) return;
    const { sidebar, listParent, browserItem } = found;

    // Update iframe URL if already mounted
    const existingNav = sidebar.querySelector(`[${NAV_ATTR}="true"]`);
    if (existingNav) {
      const contentPane = findSettingsContentPane(sidebar);
      const existingFrame = contentPane?.querySelector(`[${FRAME_ATTR}="true"]`);
      if (existingFrame && existingFrame.src !== iframeUrl) {
        existingFrame.src = iframeUrl;
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
    navItem.style.cursor = 'pointer';
    navItem.style.textAlign = 'left';
    if (navItem.tagName === 'BUTTON' && !navItem.className) {
      navItem.style.width = '100%';
      navItem.style.padding = '8px 12px';
      navItem.style.border = '0';
      navItem.style.borderRadius = '6px';
      navItem.style.background = 'transparent';
      navItem.style.color = 'inherit';
      navItem.style.font = 'inherit';
    }

    navItem.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const contentPane = findSettingsContentPane(sidebar);
      showMcpManagerPane(contentPane, navItem);
    });

    if (!sidebar.dataset.agyMcpClickBound) {
      sidebar.dataset.agyMcpClickBound = 'true';
      sidebar.addEventListener(
        'click',
        (ev) => {
          const target = ev.target;
          if (!target || target.closest?.(`[${NAV_ATTR}="true"]`)) return;
          const activeNav = sidebar.querySelector(`[${NAV_ATTR}="true"]`);
          if (activeNav && activeNav.dataset.agyMcpActive === 'true') {
            const contentPane = findSettingsContentPane(sidebar);
            restoreNativePane(contentPane, activeNav);
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
