/**
 * Antigravity 2.0 Settings Left-Sidebar Menu Injector
 * (`src/adapters/antigravity/settings-menu-injector.js`).
 *
 * Security & UX Invariants:
 * 1. ZERO unsafe DOM sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`).
 * 2. Only accepts loopback `http://127.0.0.1:<port>/?token=...` iframe URLs.
 * 3. Clones an inactive native Settings sidebar item (`cloneNode(true)`) and NEVER mutates
 *    `className` or box-model properties on click — only paint-only `background-color` & `color`
 *    change, guaranteeing 0px layout shift and preserving Antigravity's native focus ring.
 * 4. Preserves top-right Settings close (`X`) controls without destroying native React nodes.
 * 5. Idempotent across repeated `dom-ready` / `did-finish-load` injections.
 */

(function () {
  'use strict';

  const NAV_ATTR = 'data-agy-mcp-manager-nav';
  const FRAME_ATTR = 'data-agy-mcp-manager-frame';
  const CUSTOMIZATIONS_BTN_ATTR = 'data-agy-mcp-customizations-btn';
  const CUSTOMIZATIONS_OVERLAY_ATTR = 'data-agy-mcp-customizations-overlay';
  const CUSTOMIZATIONS_BACK_ATTR = 'data-agy-mcp-customizations-back';
  const CUSTOMIZATIONS_CLOSE_ATTR = 'data-agy-mcp-customizations-close';
  const PREV_DISPLAY_ATTR = 'agyMcpPrevDisplay';
  const SUPPRESSED_BG_ATTR = 'agyMcpSuppressedBg';
  const SUPPRESSED_COLOR_ATTR = 'agyMcpSuppressedColor';
  const LANG_STORAGE_KEY = 'agy-mcp-manager-lang';
  const BROWSER_LABELS = ['browser', '브라우저'];
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

  function replaceLeafText(root, nextText) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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

  function hasVisibleBg(el) {
    const bg = window.getComputedStyle(el)?.backgroundColor || '';
    return Boolean(bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent');
  }

  function findSettingsSidebarAndAnchor() {
    const candidates = document.querySelectorAll('button, a, [role="tab"], [role="menuitem"], [role="button"], li, div');
    for (const el of candidates) {
      if (el.hasAttribute(NAV_ATTR)) continue;
      if (el.children.length > 2) continue;
      if (!BROWSER_LABELS.includes(normalizedText(el))) continue;

      let container = el.parentElement;
      for (let depth = 0; depth < 4 && container && container !== document.body; depth += 1) {
        const items = Array.from(container.querySelectorAll('button, a, [role="tab"], [role="menuitem"], [role="button"], li, div'));
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
            (c) => c.nodeType === 1 && !c.hasAttribute(NAV_ATTR) && REQUIRED_SIBLING_LABELS.includes(normalizedText(c))
          );
          const inactiveSibling =
            directSiblings.find(
              (c) => !hasVisibleBg(c) && !['general', '일반', ...BROWSER_LABELS].includes(normalizedText(c))
            ) ||
            directSiblings.find((c) => !hasVisibleBg(c)) ||
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
    for (let depth = 0; depth < 8 && cursor && cursor.parentElement && cursor.parentElement !== document.documentElement; depth += 1) {
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
    if (r && contentPaneRect && r.width <= 64 && r.height <= 64 && r.right >= contentPaneRect.right - 72 && r.top <= contentPaneRect.top + 72) {
      const innerBtn = child.querySelector?.('button');
      if (innerBtn && isCloseBtn(innerBtn)) return true;
    }
    return false;
  }

  function readSavedLang() {
    try {
      const v = window.localStorage?.getItem(LANG_STORAGE_KEY);
      return v === 'ko' || v === 'en' ? v : '';
    } catch {
      return '';
    }
  }

  function buildThemedIframeUrl(baseUrl, contentPane) {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('hostMode', 'settings');
      const savedLang = readSavedLang();
      if (savedLang) {
        url.searchParams.set('lang', savedLang);
      }
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

  // Paint-only active suppression: NEVER mutates className, padding, margin, height, or font-weight (0px layout shift!)
  function suppressNativeActiveItems(listParent, navItem, inactiveColor) {
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
        if (sib.nodeType !== 1 || sib === navItem || sib.hasAttribute(NAV_ATTR)) continue;
        const cs = window.getComputedStyle(sib);
        if (hasVisibleBg(sib)) {
          detectedActiveBg = cs.backgroundColor;
          if (cs.color) detectedActiveColor = cs.color;
        }
        dimNode(sib);
        for (const inner of Array.from(sib.querySelectorAll('button, span, div'))) {
          const ics = window.getComputedStyle(inner);
          if (hasVisibleBg(inner)) {
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

  function showMcpManagerPane(outerSidebar, listParent, contentPane, navItem) {
    const baseUrl = window.__AGY_MCP_MANAGER_URL__;
    if (!isSafeLoopbackIframeUrl(baseUrl) || !contentPane) return;

    const inactiveColor = navItem?.dataset?.agyMcpInactiveColor || '';
    const { activeBg, activeColor } = suppressNativeActiveItems(listParent, navItem, inactiveColor);

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
      frame.style.flex = '1 1 auto';
      frame.style.minHeight = '0';
      frame.style.border = '0';
      frame.style.display = 'block';
      frame.style.background = 'transparent';
      frame.src = themedUrl;
      contentPane.appendChild(frame);
    } else {
      if (!sameFrameBaseAndTheme(frame.src, themedUrl)) frame.src = themedUrl;
      frame.style.display = 'block';
    }
  }

  function ensureSettingsMenuItem() {
    const baseUrl = window.__AGY_MCP_MANAGER_URL__;
    if (!isSafeLoopbackIframeUrl(baseUrl)) return;

    const found = findSettingsSidebarAndAnchor();
    if (!found) return;
    const { sidebar, listParent, browserItem, inactiveTemplate } = found;
    const { outerSidebar, contentPane: initialContentPane } = findSettingsLayout(sidebar);

    const existingNav = sidebar.querySelector(`[${NAV_ATTR}="true"]`);
    if (existingNav) {
      const existingFrame = initialContentPane?.querySelector(`[${FRAME_ATTR}="true"]`);
      const nextUrl = buildThemedIframeUrl(baseUrl, initialContentPane);
      if (existingFrame && !sameFrameBaseAndTheme(existingFrame.src, nextUrl)) {
        existingFrame.src = nextUrl;
      }
      return;
    }

    // Clone an INACTIVE native sibling node and keep its className immutable forever (0px layout shift, native focus ring intact!)
    const navItem = inactiveTemplate.cloneNode(true);
    navItem.removeAttribute('id');
    navItem.setAttribute(NAV_ATTR, 'true');
    navItem.setAttribute('aria-selected', 'false');
    navItem.dataset.agyMcpActive = 'false';
    navItem.dataset.agyMcpInactiveColor = window.getComputedStyle(inactiveTemplate)?.color || '';
    replaceLeafText(navItem, 'MCP Manager');

    navItem.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const layout = findSettingsLayout(sidebar);
      showMcpManagerPane(layout.outerSidebar, listParent, layout.contentPane, navItem);
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

  function isCustomizationsPageVisible() {
    const candidates = document.querySelectorAll('h1, h2, h3, h4, div, span, button');
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
    const candidates = document.querySelectorAll('h1, h2, h3, h4, span, div, button, p');
    for (const el of candidates) {
      if (el.children.length > 2) continue;
      if (el.closest?.(`[${CUSTOMIZATIONS_OVERLAY_ATTR}="true"]`)) continue;
      if (el.hasAttribute(CUSTOMIZATIONS_BTN_ATTR)) continue;
      if (!isMcpServersLabel(normalizedText(el))) continue;

      let row = el.parentElement;
      for (let depth = 0; depth < 4 && row && row !== document.body; depth += 1) {
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
      if (fallbackRow && fallbackRow !== document.body) {
        return { row: fallbackRow, actionContainer: fallbackRow, firstActionButton: null };
      }
    }
    return null;
  }

  function getCustomizationsButtonLabel() {
    return readSavedLang() === 'ko' ? 'MCP 매니저' : 'MCP Manager';
  }

  function getCustomizationsBackLabel() {
    return readSavedLang() === 'ko' ? '← Customizations로 돌아가기' : '← Back to Customizations';
  }

  function syncCustomizationsLabels() {
    const btn = document.querySelector(`[${CUSTOMIZATIONS_BTN_ATTR}="true"]`);
    if (btn) btn.textContent = getCustomizationsButtonLabel();
    const backBtn = document.querySelector(`[${CUSTOMIZATIONS_BACK_ATTR}="true"]`);
    if (backBtn) backBtn.textContent = getCustomizationsBackLabel();
  }

  let lastCustomizationsTrigger = null;

  function closeCustomizationsOverlay() {
    const overlay = document.querySelector(`[${CUSTOMIZATIONS_OVERLAY_ATTR}="true"]`);
    if (overlay) {
      overlay.style.display = 'none';
    }
    if (lastCustomizationsTrigger && typeof lastCustomizationsTrigger.focus === 'function') {
      try {
        lastCustomizationsTrigger.focus();
      } catch {
        // Ignore focus errors
      }
    }
  }

  function openCustomizationsOverlay(triggerBtn) {
    const baseUrl = window.__AGY_MCP_MANAGER_URL__;
    if (!isSafeLoopbackIframeUrl(baseUrl)) return;
    lastCustomizationsTrigger = triggerBtn || null;

    const bodyCs = window.getComputedStyle(document.body);
    const bodyBg = bodyCs?.backgroundColor || '';
    const hostBg = bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent' ? bodyBg : '#0d0e11';
    const hostFg = bodyCs?.color || '#e5e7eb';
    const hostFont = bodyCs?.fontFamily || 'sans-serif';
    const themedUrl = buildThemedIframeUrl(baseUrl, document.body);

    let overlay = document.querySelector(`[${CUSTOMIZATIONS_OVERLAY_ATTR}="true"]`);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute(CUSTOMIZATIONS_OVERLAY_ATTR, 'true');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'MCP Manager');
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.zIndex = '9999';
      overlay.style.display = 'flex';
      overlay.style.flexDirection = 'column';
      overlay.style.background = hostBg;
      overlay.style.color = hostFg;
      overlay.style.fontFamily = hostFont;

      const topBar = document.createElement('div');
      topBar.style.height = '44px';
      topBar.style.flex = '0 0 auto';
      topBar.style.display = 'flex';
      topBar.style.alignItems = 'center';
      topBar.style.justifyContent = 'space-between';
      topBar.style.padding = '0 16px';
      topBar.style.borderBottom = '1px solid rgba(128, 128, 128, 0.22)';

      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.setAttribute(CUSTOMIZATIONS_BACK_ATTR, 'true');
      backBtn.textContent = getCustomizationsBackLabel();
      backBtn.style.background = 'transparent';
      backBtn.style.border = '1px solid rgba(128, 128, 128, 0.28)';
      backBtn.style.borderRadius = '6px';
      backBtn.style.color = 'inherit';
      backBtn.style.fontFamily = 'inherit';
      backBtn.style.fontSize = '12px';
      backBtn.style.fontWeight = '500';
      backBtn.style.padding = '4px 10px';
      backBtn.style.cursor = 'pointer';
      backBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        closeCustomizationsOverlay();
      });

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute(CUSTOMIZATIONS_CLOSE_ATTR, 'true');
      closeBtn.setAttribute('aria-label', 'Close MCP Manager');
      closeBtn.textContent = '✕';
      closeBtn.style.background = 'transparent';
      closeBtn.style.border = '0';
      closeBtn.style.borderRadius = '6px';
      closeBtn.style.color = 'inherit';
      closeBtn.style.fontSize = '15px';
      closeBtn.style.lineHeight = '1';
      closeBtn.style.width = '28px';
      closeBtn.style.height = '28px';
      closeBtn.style.cursor = 'pointer';
      closeBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        closeCustomizationsOverlay();
      });

      topBar.appendChild(backBtn);
      topBar.appendChild(closeBtn);

      const frame = document.createElement('iframe');
      frame.setAttribute(FRAME_ATTR, 'true');
      frame.setAttribute('data-agy-mcp-customizations-frame', 'true');
      frame.setAttribute('title', 'MCP Manager');
      frame.style.width = '100%';
      frame.style.height = '100%';
      frame.style.flex = '1 1 auto';
      frame.style.minHeight = '0';
      frame.style.border = '0';
      frame.style.display = 'block';
      frame.style.background = 'transparent';
      frame.src = themedUrl;

      overlay.appendChild(topBar);
      overlay.appendChild(frame);
      document.body.appendChild(overlay);
    } else {
      overlay.style.background = hostBg;
      overlay.style.color = hostFg;
      overlay.style.fontFamily = hostFont;
      const frame = overlay.querySelector(`[${FRAME_ATTR}="true"]`);
      if (frame && !sameFrameBaseAndTheme(frame.src, themedUrl)) {
        frame.src = themedUrl;
      }
      syncCustomizationsLabels();
      overlay.style.display = 'flex';
    }
  }

  function ensureCustomizationsButton() {
    const baseUrl = window.__AGY_MCP_MANAGER_URL__;
    if (!isSafeLoopbackIframeUrl(baseUrl)) return;

    const found = findCustomizationsMcpHeader();
    if (!found) return;
    const { row, actionContainer, firstActionButton } = found;

    if (row.querySelector(`[${CUSTOMIZATIONS_BTN_ATTR}="true"]`)) {
      return;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(CUSTOMIZATIONS_BTN_ATTR, 'true');
    btn.textContent = getCustomizationsButtonLabel();
    btn.style.background = 'rgba(128, 128, 128, 0.14)';
    btn.style.border = '1px solid rgba(128, 128, 128, 0.28)';
    btn.style.borderRadius = '6px';
    btn.style.color = 'inherit';
    btn.style.fontFamily = 'inherit';
    btn.style.fontSize = '12px';
    btn.style.fontWeight = '500';
    btn.style.lineHeight = '1.4';
    btn.style.padding = '3px 10px';
    btn.style.marginRight = '6px';
    btn.style.cursor = 'pointer';
    btn.style.whiteSpace = 'nowrap';
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(128, 128, 128, 0.24)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(128, 128, 128, 0.14)';
    });
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openCustomizationsOverlay(btn);
    });

    if (firstActionButton && firstActionButton.parentElement === actionContainer) {
      actionContainer.insertBefore(btn, firstActionButton);
    } else {
      actionContainer.appendChild(btn);
    }
  }

  function ensureAllMounts() {
    ensureSettingsMenuItem();
    ensureCustomizationsButton();
  }

  if (window.__AGY_MCP_MANAGER_INJECTOR_ACTIVE__) {
    ensureAllMounts();
    return;
  }
  window.__AGY_MCP_MANAGER_INJECTOR_ACTIVE__ = true;

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      const overlay = document.querySelector(`[${CUSTOMIZATIONS_OVERLAY_ATTR}="true"]`);
      if (overlay && overlay.style.display !== 'none') {
        ev.preventDefault();
        closeCustomizationsOverlay();
      }
    }
  });

  window.addEventListener('message', (ev) => {
    const baseUrl = window.__AGY_MCP_MANAGER_URL__;
    if (!isSafeLoopbackIframeUrl(baseUrl)) return;
    try {
      const expectedOrigin = new URL(baseUrl).origin;
      if (ev.origin !== expectedOrigin) return;
    } catch {
      return;
    }
    const frames = Array.from(document.querySelectorAll(`[${FRAME_ATTR}="true"]`));
    if (!frames.some((frame) => frame.contentWindow === ev.source)) return;
    if (ev.data?.type === 'agy-mcp-lang-change' && (ev.data.lang === 'ko' || ev.data.lang === 'en')) {
      try {
        window.localStorage?.setItem(LANG_STORAGE_KEY, ev.data.lang);
      } catch {
        // Ignore storage errors
      }
      syncCustomizationsLabels();
    }
  });

  let scheduled = false;
  const scheduleEnsure = () => {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      ensureAllMounts();
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(run);
    } else {
      setTimeout(run, 16);
    }
  };

  if (document.body) {
    ensureAllMounts();
    const observer = new MutationObserver(scheduleEnsure);
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => {
        ensureAllMounts();
        const observer = new MutationObserver(scheduleEnsure);
        observer.observe(document.body, { childList: true, subtree: true });
      },
      { once: true }
    );
  }
})();
