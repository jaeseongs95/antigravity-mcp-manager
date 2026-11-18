'use strict';

/**
 * Native Antigravity DOM Integration & Non-Invasive Remote Host Launcher (`antigravity-mcp-manager`).
 *
 * Responsibilities:
 * 1. Injects `"MCP Servers"` (`settings-nav-item-McpManager`) into `.settings-modal-container` with
 *    exclusive tab highlight and native pane display restoration.
 * 2. Enhances `[data-testid="add-mcp-button"]`, `[data-testid="add-mcp-screen"]`, and
 *    `[data-testid="mcp-server-row"]` / `[data-testid="mcp-server-fix-with-agent"]` with custom MCP actions.
 * 3. Renders a non-invasive floating `"MCP Servers"` launcher (`#agy-mcp-remote-launcher`) on Remote Control
 *    host pages outside `.agy-ctx-statusbar` so mobile and strict-CSP users can open the manager without
 *    needing keyboard shortcuts or cross-origin iframe promotion.
 * 4. Filters own/companion DOM mutations (`isRelevantMutationList`) and deterministically restores native DOM on `destroy()`.
 */

const { MODAL_ID, EDIT_POPUP_ID, OAUTH_MODAL_ID } = require('./modal-ui');

const NATIVE_BTN_ATTR = 'data-agy-custom-mcp-btn';
const REMOTE_LAUNCHER_ID = 'agy-mcp-remote-launcher';

function extractServerNameFromRow(row) {
  if (!row || typeof row.querySelector !== 'function') return '';
  const fixBtn = row.querySelector('[data-testid="mcp-server-fix-with-agent"]');
  if (fixBtn) {
    const aria = fixBtn.getAttribute('aria-label') || '';
    const m = /^Fix with Agent:\s*(.+)$/i.exec(aria.trim());
    if (m && m[1]) return m[1].trim();
  }
  const buttons = row.querySelectorAll('button[aria-label]');
  for (let i = 0; i < buttons.length; i++) {
    const aria = buttons[i].getAttribute('aria-label') || '';
    const m = /^More actions for\s+(.+)$/i.exec(aria.trim());
    if (m && m[1]) return m[1].trim();
  }
  const topLine = row.firstElementChild;
  const leftGroup = topLine && topLine.firstElementChild ? topLine.firstElementChild : row;
  const nameSpan = leftGroup.querySelector('span');
  if (nameSpan) {
    const fromTitle = (nameSpan.getAttribute('title') || '').trim();
    if (fromTitle && !/blocked by organization/i.test(fromTitle)) {
      return fromTitle;
    }
    const fromText = (nameSpan.textContent || '').trim();
    if (fromText) return fromText;
  }
  return '';
}

function cleanupLegacyStatusBarArtifacts(win, doc) {
  try {
    if (win && win.agyStatusBar && typeof win.agyStatusBar.unregisterAdapter === 'function') {
      win.agyStatusBar.unregisterAdapter('mcp-manager');
    }
    if (win && win.__agyCustomStatusBarAdapters && typeof win.__agyCustomStatusBarAdapters.delete === 'function') {
      win.__agyCustomStatusBarAdapters.delete('mcp-manager');
    }
    if (doc && typeof doc.querySelectorAll === 'function') {
      doc
        .querySelectorAll(
          `[data-agy-adapter-id="mcp-manager"], [data-testid="agy-statusbar-mcp-btn"], [${NATIVE_BTN_ATTR}="beside-edit-btn"]`
        )
        .forEach((el) => {
          try {
            if (typeof el.remove === 'function') {
              el.remove();
            } else if (el.parentNode) {
              el.parentNode.removeChild(el);
            }
          } catch {}
        });
    }
  } catch {}
}

function isOwnMcpNode(node) {
  let cur = node && node.nodeType !== 1 ? (node.parentElement || node.parentNode) : node;
  while (cur && cur.nodeType === 1) {
    if (
      cur.id === MODAL_ID ||
      cur.id === EDIT_POPUP_ID ||
      cur.id === OAUTH_MODAL_ID ||
      cur.id === REMOTE_LAUNCHER_ID ||
      cur.id === 'agy-mcp-settings-pane' ||
      cur.id === 'agy-ko-settings-pane' ||
      cur.id === 'agy-ctx-debug-modal' ||
      cur.id === 'agy-ctx-statusbar-style' ||
      cur.id === 'agy-mcp-manager-styles' ||
      (typeof cur.className === 'string' &&
        (cur.className.includes('agy-ctx-statusbar') || cur.className.includes('agy-ctx-menu'))) ||
      (typeof cur.hasAttribute === 'function' &&
        (cur.hasAttribute(NATIVE_BTN_ATTR) ||
          cur.hasAttribute('data-agy-no-translate') ||
          cur.hasAttribute('data-ko-translated') ||
          cur.hasAttribute('data-agy-ko-translated')))
    ) {
      return true;
    }
    cur = cur.parentElement || cur.parentNode;
  }
  return false;
}

function nodeTouchesMcpAnchors(node) {
  if (!node || node.nodeType !== 1) return false;
  const tag = String(node.tagName || '').toUpperCase();
  if (tag === 'GA-REMOTE-CONTROL' || tag === 'IFRAME') return true;
  const cls = typeof node.className === 'string' ? node.className : '';
  if (cls.includes('settings-modal-container')) return true;
  const tid = typeof node.getAttribute === 'function' ? node.getAttribute('data-testid') : '';
  if (
    tid === 'add-mcp-button' ||
    tid === 'add-mcp-screen' ||
    tid === 'mcp-server-row' ||
    tid === 'mcp-server-fix-with-agent' ||
    (tid && tid.startsWith('settings-nav-item-'))
  ) {
    return true;
  }
  if (typeof node.querySelector === 'function') {
    try {
      if (
        node.querySelector(
          '.settings-modal-container, [data-testid="add-mcp-button"], [data-testid="add-mcp-screen"], [data-testid="mcp-server-row"], [data-testid="mcp-server-fix-with-agent"], [data-testid^="settings-nav-item-"], ga-remote-control, iframe'
        )
      ) {
        return true;
      }
    } catch {}
  }
  return false;
}

function isRelevantMutationList(mutations) {
  if (!Array.isArray(mutations) || mutations.length === 0) return true;
  for (let i = 0; i < mutations.length; i++) {
    const m = mutations[i];
    if (!m) continue;
    if (isOwnMcpNode(m.target)) continue;
    const added = m.addedNodes;
    if (!added || added.length === 0) {
      if (!m.removedNodes) return true;
      if (nodeTouchesMcpAnchors(m.target)) return true;
      continue;
    }
    for (let j = 0; j < added.length; j++) {
      const n = added[j];
      if (!n || isOwnMcpNode(n)) continue;
      if (!n.nodeType || nodeTouchesMcpAnchors(n) || nodeTouchesMcpAnchors(m.target)) return true;
    }
  }
  return false;
}

function createNativeDomIntegrator({
  doc,
  modal,
  bridge,
  isRemoteHostPage = false,
  onEnsureRemoteIframeMounted = null,
}) {
  let disposed = false;
  let remoteLauncherEl = null;

  async function handleServerAuthenticateAction(serverName) {
    if (!serverName) {
      modal.openEditPopup('', { focusAuth: true });
      return;
    }
    try {
      const statesRes = await bridge.fetchServerStates();
      const states = Array.isArray(statesRes)
        ? statesRes
        : (statesRes && Array.isArray(statesRes.states) ? statesRes.states : []);
      const matched = states.find(
        (s) => s && (s.serverName === serverName || s.spec?.serverName === serverName)
      );
      if (matched && matched.authUrl) {
        modal.openOAuthConnectModal(serverName, matched.authUrl);
        return;
      }
    } catch {}
    modal.openEditPopup(serverName, { focusAuth: true });
  }

  function ensureRemoteHostLauncher() {
    if (disposed || !isRemoteHostPage || !doc?.body || typeof doc.createElement !== 'function') return;
    if (remoteLauncherEl && (remoteLauncherEl.parentNode || remoteLauncherEl.isConnected !== false)) {
      return;
    }
    const existing =
      (typeof doc.getElementById === 'function' ? doc.getElementById(REMOTE_LAUNCHER_ID) : null) ||
      doc.querySelector?.(`#${REMOTE_LAUNCHER_ID}`) ||
      doc.querySelector?.(`[${NATIVE_BTN_ATTR}="remote-host-launcher"]`) ||
      null;
    if (existing) {
      remoteLauncherEl = existing;
      return;
    }
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.id = REMOTE_LAUNCHER_ID;
    btn.setAttribute?.('id', REMOTE_LAUNCHER_ID);
    btn.setAttribute?.(NATIVE_BTN_ATTR, 'remote-host-launcher');
    btn.setAttribute?.('data-testid', REMOTE_LAUNCHER_ID);
    btn.setAttribute?.('data-agy-no-translate', 'true');
    btn.setAttribute?.('translate', 'no');
    btn.setAttribute?.('aria-label', 'Open Custom MCP Server Manager');
    btn.title = 'Open Custom MCP Server Manager (Ctrl+Alt+M)';
    btn.textContent = 'MCP Servers';
    if (btn.style) {
      btn.style.position = 'fixed';
      btn.style.top = '10px';
      btn.style.right = '88px';
      btn.style.zIndex = '2147483640';
      btn.style.padding = '5px 11px';
      btn.style.borderRadius = '999px';
      btn.style.border = '1px solid rgba(99, 102, 241, 0.45)';
      btn.style.background = 'rgba(22, 24, 33, 0.88)';
      btn.style.color = '#e2e8f0';
      btn.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      btn.style.fontSize = '12px';
      btn.style.fontWeight = '600';
      btn.style.lineHeight = '1.2';
      btn.style.cursor = 'pointer';
      btn.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.45)';
      btn.style.backdropFilter = 'blur(6px)';
    }
    if (typeof btn.addEventListener === 'function') {
      btn.addEventListener('click', (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        if (modal.isOpen()) {
          modal.closeModal();
        } else {
          modal.openModal('servers');
        }
      });
    }
    remoteLauncherEl = btn;
    doc.body.appendChild?.(btn);
  }

  function ensureNativeSettingsModalIntegration() {
    if (disposed || !doc?.body) return;
    const settingsModal = doc.querySelector?.('.settings-modal-container');
    if (!settingsModal) return;

    const modelsNavBtn = settingsModal.querySelector('button[data-testid="settings-nav-item-Models"]');
    if (!modelsNavBtn) return;

    const navGroup =
      modelsNavBtn.closest('.flex.flex-col.gap-0\\.5') ||
      modelsNavBtn.parentElement?.parentElement ||
      modelsNavBtn.parentElement;
    if (!navGroup) return;

    const setNavBtnActiveVisual = (btnEl, isActive) => {
      if (!btnEl) return;
      const sp = btnEl.querySelector?.('span');
      if (isActive) {
        btnEl.classList?.add?.('bg-sidebar-secondary');
        if (sp) {
          sp.classList?.remove?.('text-secondary-foreground');
          sp.classList?.add?.('text-foreground', 'font-medium');
        }
      } else {
        btnEl.classList?.remove?.('bg-sidebar-secondary');
        if (sp) {
          sp.classList?.remove?.('text-foreground', 'font-medium');
          sp.classList?.add?.('text-secondary-foreground');
        }
      }
    };

    const syncExclusiveNavHighlight = (activeTestId) => {
      const allNavBtns = settingsModal.querySelectorAll('button[data-testid^="settings-nav-item-"]');
      allNavBtns.forEach((b) => {
        const tid = b.getAttribute?.('data-testid') || '';
        setNavBtnActiveVisual(b, tid === activeTestId);
      });
    };

    let mcpNavBtn = settingsModal.querySelector('button[data-testid="settings-nav-item-McpManager"]');
    if (!mcpNavBtn) {
      const navWrap = doc.createElement('div');
      navWrap.className = 'relative group/nav-item mx-2 agy-mcp-settings-root';
      navWrap.setAttribute(NATIVE_BTN_ATTR, 'settings-nav-wrap');

      mcpNavBtn = doc.createElement('button');
      mcpNavBtn.type = 'button';
      mcpNavBtn.setAttribute('data-testid', 'settings-nav-item-McpManager');
      mcpNavBtn.setAttribute(NATIVE_BTN_ATTR, 'settings-nav-item');
      mcpNavBtn.className =
        'flex items-center gap-1.5 w-full px-2 py-1 rounded-lg cursor-pointer border-none text-left transition-all outline-none hover:bg-sidebar-muted';

      const labelSpan = doc.createElement('span');
      labelSpan.className =
        'text-sm transition-colors select-none truncate flex-1 text-secondary-foreground group-hover/nav-item:text-foreground';
      labelSpan.textContent = 'MCP Servers';
      mcpNavBtn.appendChild(labelSpan);
      navWrap.appendChild(mcpNavBtn);

      const koNavBtn = settingsModal.querySelector('button[data-testid="settings-nav-item-KoTranslator"]');
      const koWrap = koNavBtn ? (koNavBtn.parentElement !== navGroup ? koNavBtn.parentElement : koNavBtn) : null;
      if (koWrap && koWrap.parentElement === navGroup && koWrap.nextSibling) {
        navGroup.insertBefore(navWrap, koWrap.nextSibling);
      } else {
        navGroup.appendChild(navWrap);
      }

      const activateMcpPane = () => {
        const contentContainer = settingsModal.querySelector('.grow.w-full');
        if (!contentContainer) return;

        const existingPane = contentContainer.querySelector('#agy-mcp-settings-pane');
        const alreadyActive = Boolean(existingPane && existingPane.style.display !== 'none');
        if (!alreadyActive) {
          let prevTid = '';
          const allNavBtns = settingsModal.querySelectorAll('button[data-testid^="settings-nav-item-"]');
          allNavBtns.forEach((b) => {
            const tid = b.getAttribute?.('data-testid') || '';
            if (
              tid &&
              tid !== 'settings-nav-item-McpManager' &&
              tid !== 'settings-nav-item-KoTranslator' &&
              b.classList?.contains?.('bg-sidebar-secondary')
            ) {
              prevTid = tid;
            }
          });
          const fallbackTid = settingsModal.getAttribute?.('data-agy-mcp-prev-nav') || 'settings-nav-item-Models';
          settingsModal.setAttribute('data-agy-mcp-prev-nav', prevTid || fallbackTid);
        }

        Array.from(contentContainer.children).forEach((child) => {
          if (child.id === 'agy-mcp-settings-pane') return;
          if (child.id === 'agy-ko-settings-pane') {
            child.style.display = 'none';
            return;
          }
          if (child.getAttribute('data-agy-prev-display') === null) {
            child.setAttribute('data-agy-prev-display', child.style.display || '');
          }
          child.style.display = 'none';
        });

        let pane = existingPane;
        if (!pane) {
          pane = doc.createElement('div');
          pane.id = 'agy-mcp-settings-pane';
          pane.setAttribute(NATIVE_BTN_ATTR, 'settings-pane');
          pane.setAttribute('data-agy-no-translate', 'true');
          pane.setAttribute('translate', 'no');
          pane.className = 'w-full bg-transparent h-full overflow-y-auto px-6 py-5 select-none';
          contentContainer.appendChild(pane);
        }
        pane.style.display = 'block';
        modal.renderSettingsPageContent(pane);
        void modal.reloadData();

        syncExclusiveNavHighlight('settings-nav-item-McpManager');
      };

      mcpNavBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        activateMcpPane();
      });
    }

    if (!settingsModal.hasAttribute('data-agy-mcp-nav-bound')) {
      settingsModal.setAttribute('data-agy-mcp-nav-bound', 'true');
      const navClickHandler = (e) => {
        const btn =
          e.target && typeof e.target.closest === 'function'
            ? e.target.closest('button[data-testid^="settings-nav-item-"]')
            : null;
        if (!btn) return;
        const testId = btn.getAttribute('data-testid') || '';
        if (testId === 'settings-nav-item-McpManager') return;

        if (testId && testId !== 'settings-nav-item-KoTranslator') {
          settingsModal.setAttribute('data-agy-mcp-prev-nav', testId);
        }

        const contentContainer = settingsModal.querySelector('.grow.w-full');
        if (!contentContainer) return;

        const pane = contentContainer.querySelector('#agy-mcp-settings-pane');
        const wasMcpPaneVisible = Boolean(pane && pane.style.display !== 'none');
        if (pane) {
          pane.style.display = 'none';
          pane.removeAttribute('data-agy-prev-display');
        }

        syncExclusiveNavHighlight(testId);

        if (wasMcpPaneVisible && testId !== 'settings-nav-item-KoTranslator') {
          Array.from(contentContainer.children).forEach((child) => {
            if (child.id !== 'agy-mcp-settings-pane' && child.id !== 'agy-ko-settings-pane') {
              const prev = child.getAttribute('data-agy-prev-display');
              if (prev !== null) {
                child.style.display = prev;
                child.removeAttribute('data-agy-prev-display');
              } else {
                child.style.display = '';
              }
            }
          });
        }
      };
      settingsModal.__agyMcpNavClickHandler = navClickHandler;
      settingsModal.addEventListener('click', navClickHandler, true);
    }
  }

  function buildQuickActionToolbar() {
    const wrap = doc.createElement('div');
    wrap.setAttribute(NATIVE_BTN_ATTR, 'empty-mcp-note');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.flexWrap = 'wrap';
    wrap.style.gap = '8px';
    wrap.style.paddingLeft = '12px';
    wrap.style.marginTop = '6px';
    wrap.style.marginBottom = '6px';

    const addCustomBtn = doc.createElement('button');
    addCustomBtn.type = 'button';
    addCustomBtn.className = 'agy-mcp-injected-native-btn';
    addCustomBtn.style.marginLeft = '0';
    addCustomBtn.textContent = '+ Add Custom MCP Server';
    addCustomBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      modal.openEditPopup('', { createNew: true });
    });

    const editCustomBtn = doc.createElement('button');
    editCustomBtn.type = 'button';
    editCustomBtn.className = 'agy-mcp-btn';
    editCustomBtn.setAttribute(NATIVE_BTN_ATTR, 'toolbar-edit-popup-btn');
    editCustomBtn.textContent = '⚙️ Edit Custom MCP Settings';
    editCustomBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      modal.openEditPopup();
    });

    const authCustomBtn = doc.createElement('button');
    authCustomBtn.type = 'button';
    authCustomBtn.className = 'agy-mcp-btn auth';
    authCustomBtn.setAttribute(NATIVE_BTN_ATTR, 'toolbar-auth-popup-btn');
    authCustomBtn.textContent = '🔗 OAuth / Auth Settings';
    authCustomBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      modal.openEditPopup('', { focusAuth: true });
    });

    const rawBtn = doc.createElement('button');
    rawBtn.type = 'button';
    rawBtn.className = 'agy-mcp-btn';
    rawBtn.textContent = '{ } Edit mcp_config.json';
    rawBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      modal.openModal('raw');
    });

    wrap.appendChild(addCustomBtn);
    wrap.appendChild(editCustomBtn);
    wrap.appendChild(authCustomBtn);
    wrap.appendChild(rawBtn);
    return wrap;
  }

  function injectIntoNativeMcpScreens() {
    if (disposed || !doc?.body) return;

    if (typeof onEnsureRemoteIframeMounted === 'function') {
      onEnsureRemoteIframeMounted();
    }

    ensureRemoteHostLauncher();
    ensureNativeSettingsModalIntegration();

    const addMcpBtns = doc.querySelectorAll ? doc.querySelectorAll('[data-testid="add-mcp-button"]') : [];
    addMcpBtns.forEach((nativeBtn) => {
      const parent = nativeBtn.parentElement;
      if (!parent) return;
      const legacyBesideEdit = parent.querySelector(`[${NATIVE_BTN_ATTR}="beside-edit-btn"]`);
      if (legacyBesideEdit) {
        if (typeof legacyBesideEdit.remove === 'function') {
          legacyBesideEdit.remove();
        } else if (legacyBesideEdit.parentNode) {
          legacyBesideEdit.parentNode.removeChild(legacyBesideEdit);
        }
      }
      if (!parent.querySelector(`[${NATIVE_BTN_ATTR}="beside-add-btn"]`)) {
        const customBtn = doc.createElement('button');
        customBtn.type = 'button';
        customBtn.className = 'agy-mcp-injected-native-btn';
        customBtn.setAttribute(NATIVE_BTN_ATTR, 'beside-add-btn');
        customBtn.textContent = '+ Custom MCP';
        customBtn.title = 'Add or manage custom MCP servers in ~/.gemini/config/mcp_config.json';
        customBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          modal.openEditPopup('', { createNew: true });
        });
        parent.insertBefore(customBtn, nativeBtn);
      }
    });

    const addMcpScreens = doc.querySelectorAll ? doc.querySelectorAll('[data-testid="add-mcp-screen"]') : [];
    addMcpScreens.forEach((screen) => {
      if (screen.querySelector(`[${NATIVE_BTN_ATTR}="inside-add-screen"]`)) return;
      const headerRow = screen.firstElementChild;
      if (!headerRow) return;

      const banner = doc.createElement('div');
      banner.setAttribute(NATIVE_BTN_ATTR, 'inside-add-screen');
      banner.style.display = 'flex';
      banner.style.alignItems = 'center';
      banner.style.justifyContent = 'space-between';
      banner.style.flexWrap = 'wrap';
      banner.style.gap = '10px';
      banner.style.margin = '4px 0 8px 0';
      banner.style.padding = '8px 12px';
      banner.style.borderRadius = '8px';
      banner.style.background = 'rgba(79, 70, 229, 0.12)';
      banner.style.border = '1px solid rgba(99, 102, 241, 0.32)';
      banner.style.fontSize = '12px';

      const desc = doc.createElement('span');
      desc.textContent = 'Custom MCP Servers (OAuth Server URL or Local/Tunnel Stdio):';

      const btnGroup = doc.createElement('div');
      btnGroup.style.display = 'flex';
      btnGroup.style.gap = '6px';
      btnGroup.style.flexWrap = 'wrap';

      const openEditorBtn = doc.createElement('button');
      openEditorBtn.type = 'button';
      openEditorBtn.className = 'agy-mcp-injected-native-btn';
      openEditorBtn.style.marginLeft = '0';
      openEditorBtn.textContent = '+ Add Custom MCP Server';
      openEditorBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modal.openEditPopup('', { createNew: true });
      });

      const editAuthBtn = doc.createElement('button');
      editAuthBtn.type = 'button';
      editAuthBtn.className = 'agy-mcp-btn';
      editAuthBtn.textContent = '⚙️ Edit Custom MCP Settings';
      editAuthBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modal.openEditPopup();
      });

      const manageBtn = doc.createElement('button');
      manageBtn.type = 'button';
      manageBtn.className = 'agy-mcp-btn';
      manageBtn.textContent = 'Manage Servers';
      manageBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modal.openModal('servers');
      });

      btnGroup.appendChild(openEditorBtn);
      btnGroup.appendChild(editAuthBtn);
      btnGroup.appendChild(manageBtn);
      banner.appendChild(desc);
      banner.appendChild(btnGroup);

      if (headerRow.nextSibling) {
        screen.insertBefore(banner, headerRow.nextSibling);
      } else {
        screen.appendChild(banner);
      }
    });

    const firstServerRow = doc.querySelector?.('[data-testid="mcp-server-row"]');
    if (firstServerRow && firstServerRow.parentElement && firstServerRow.parentElement.parentElement) {
      const listContainer = firstServerRow.parentElement;
      const sectionBody = listContainer.parentElement;
      const existingToolbar = sectionBody.querySelector(`[${NATIVE_BTN_ATTR}="empty-mcp-note"]`);
      if (!existingToolbar) {
        sectionBody.insertBefore(buildQuickActionToolbar(), listContainer);
      }
    } else if (addMcpBtns.length > 0 || addMcpScreens.length > 0) {
      const scopeRoots = [];
      addMcpBtns.forEach((btn) => {
        const root =
          btn.closest?.('[data-testid="add-mcp-screen"]') ||
          btn.parentElement?.parentElement ||
          btn.parentElement;
        if (root && !scopeRoots.includes(root)) scopeRoots.push(root);
      });
      addMcpScreens.forEach((scr) => {
        if (scr && !scopeRoots.includes(scr)) scopeRoots.push(scr);
      });
      const paragraphs =
        scopeRoots.length > 0
          ? scopeRoots.flatMap((r) => Array.from(r.querySelectorAll ? r.querySelectorAll('p') : []))
          : Array.from(doc.querySelectorAll ? doc.querySelectorAll('p') : []);
      paragraphs.forEach((p) => {
        if (
          p.textContent &&
          (p.textContent.includes('No MCP servers yet.') ||
            p.textContent.includes('등록된 MCP 서버가 없습니다')) &&
          p.parentElement &&
          !p.parentElement.querySelector(`[${NATIVE_BTN_ATTR}="empty-mcp-note"]`)
        ) {
          p.parentElement.appendChild(buildQuickActionToolbar());
        }
      });
    }

    const rows = doc.querySelectorAll ? doc.querySelectorAll('[data-testid="mcp-server-row"]') : [];
    rows.forEach((row) => {
      const serverName = extractServerNameFromRow(row);
      if (!serverName) return;

      const topLine = row.firstElementChild;
      const leftGroup = topLine && topLine.firstElementChild ? topLine.firstElementChild : null;
      if (leftGroup && !leftGroup.querySelector(`[${NATIVE_BTN_ATTR}="row-edit-btn"]`)) {
        const editRowBtn = doc.createElement('button');
        editRowBtn.type = 'button';
        editRowBtn.className = 'agy-mcp-inline-row-btn';
        editRowBtn.setAttribute(NATIVE_BTN_ATTR, 'row-edit-btn');
        editRowBtn.setAttribute('data-mcp-server', serverName);
        editRowBtn.textContent = '⚙️ Edit Settings';
        editRowBtn.title = `Edit settings and OAuth authentication for "${serverName}"`;
        editRowBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          modal.openEditPopup(serverName);
        });

        const authRowBtn = doc.createElement('button');
        authRowBtn.type = 'button';
        authRowBtn.className = 'agy-mcp-inline-row-btn auth';
        authRowBtn.setAttribute(NATIVE_BTN_ATTR, 'row-auth-btn');
        authRowBtn.setAttribute('data-mcp-server', serverName);
        authRowBtn.textContent = '🔗 Connect OAuth / Auth';
        authRowBtn.title = `Open OAuth connection dialog or configure authentication for "${serverName}"`;
        authRowBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleServerAuthenticateAction(serverName);
        });

        leftGroup.appendChild(editRowBtn);
        leftGroup.appendChild(authRowBtn);
      }

      const fixBtn = row.querySelector('[data-testid="mcp-server-fix-with-agent"]');
      if (fixBtn && fixBtn.parentElement && !fixBtn.parentElement.querySelector(`[${NATIVE_BTN_ATTR}="fix-auth-btn"]`)) {
        const btnWrap = doc.createElement('div');
        btnWrap.style.display = 'inline-flex';
        btnWrap.style.alignItems = 'center';
        btnWrap.style.gap = '6px';
        btnWrap.setAttribute(NATIVE_BTN_ATTR, 'fix-actions-wrap');

        const fixAuthBtn = doc.createElement('button');
        fixAuthBtn.type = 'button';
        fixAuthBtn.className = 'agy-mcp-inline-row-btn auth';
        fixAuthBtn.setAttribute(NATIVE_BTN_ATTR, 'fix-auth-btn');
        fixAuthBtn.setAttribute('data-mcp-server', serverName);
        fixAuthBtn.textContent = '🔗 Connect OAuth / Auth';
        fixAuthBtn.title = `Connect OAuth or configure authentication for "${serverName}"`;
        fixAuthBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleServerAuthenticateAction(serverName);
        });

        const fixEditBtn = doc.createElement('button');
        fixEditBtn.type = 'button';
        fixEditBtn.className = 'agy-mcp-inline-row-btn';
        fixEditBtn.setAttribute(NATIVE_BTN_ATTR, 'fix-edit-btn');
        fixEditBtn.setAttribute('data-mcp-server', serverName);
        fixEditBtn.textContent = '⚙️ Edit Settings';
        fixEditBtn.title = `Edit settings for "${serverName}"`;
        fixEditBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          modal.openEditPopup(serverName);
        });

        btnWrap.appendChild(fixAuthBtn);
        btnWrap.appendChild(fixEditBtn);
        fixBtn.parentElement.insertBefore(btnWrap, fixBtn);
      }
    });
  }

  function restoreNativeDom() {
    disposed = true;
    if (!doc) return;
    const settingsModals = doc.querySelectorAll ? doc.querySelectorAll('.settings-modal-container') : [];
    Array.from(settingsModals).forEach((sm) => {
      const contentContainer = sm.querySelector ? sm.querySelector('.grow.w-full') : null;
      const pane =
        contentContainer && contentContainer.querySelector
          ? contentContainer.querySelector('#agy-mcp-settings-pane')
          : null;
      const wasVisible = Boolean(pane && pane.style && pane.style.display !== 'none');
      if (wasVisible && contentContainer && contentContainer.children) {
        Array.from(contentContainer.children).forEach((child) => {
          if (child.id !== 'agy-mcp-settings-pane' && child.id !== 'agy-ko-settings-pane') {
            const prev = child.getAttribute ? child.getAttribute('data-agy-prev-display') : null;
            if (prev !== null) {
              child.style.display = prev;
              if (typeof child.removeAttribute === 'function') child.removeAttribute('data-agy-prev-display');
            } else {
              child.style.display = '';
            }
          }
        });
        const prevNavTid =
          (typeof sm.getAttribute === 'function' && sm.getAttribute('data-agy-mcp-prev-nav')) ||
          'settings-nav-item-Models';
        const navCandidates = sm.querySelectorAll
          ? Array.from(sm.querySelectorAll('button[data-testid^="settings-nav-item-"]'))
          : [];
        const restoreBtn =
          navCandidates.find((b) => (b.getAttribute ? b.getAttribute('data-testid') : '') === prevNavTid) ||
          navCandidates.find(
            (b) => (b.getAttribute ? b.getAttribute('data-testid') : '') === 'settings-nav-item-Models'
          ) ||
          (sm.querySelector ? sm.querySelector('button[data-testid="settings-nav-item-Models"]') : null);
        if (restoreBtn) {
          restoreBtn.classList?.add?.('bg-sidebar-secondary');
          const sp = restoreBtn.querySelector ? restoreBtn.querySelector('span') : null;
          if (sp) {
            sp.classList?.remove?.('text-secondary-foreground');
            sp.classList?.add?.('text-foreground', 'font-medium');
          }
        }
      }
      if (sm.__agyMcpNavClickHandler && typeof sm.removeEventListener === 'function') {
        sm.removeEventListener('click', sm.__agyMcpNavClickHandler, true);
        delete sm.__agyMcpNavClickHandler;
      }
      if (typeof sm.removeAttribute === 'function') {
        sm.removeAttribute('data-agy-mcp-nav-bound');
        sm.removeAttribute('data-agy-mcp-prev-nav');
      }
    });

    if (remoteLauncherEl) {
      try {
        if (typeof remoteLauncherEl.remove === 'function') {
          remoteLauncherEl.remove();
        } else if (remoteLauncherEl.parentNode) {
          remoteLauncherEl.parentNode.removeChild(remoteLauncherEl);
        }
      } catch {}
      remoteLauncherEl = null;
    }

    if (doc.querySelectorAll) {
      doc.querySelectorAll(`[${NATIVE_BTN_ATTR}]`).forEach((el) => {
        try {
          if (typeof el.remove === 'function') {
            el.remove();
          } else if (el.parentNode) {
            el.parentNode.removeChild(el);
          }
        } catch {}
      });
    }
  }

  return {
    injectIntoNativeMcpScreens,
    restoreNativeDom,
  };
}

module.exports = {
  NATIVE_BTN_ATTR,
  REMOTE_LAUNCHER_ID,
  extractServerNameFromRow,
  cleanupLegacyStatusBarArtifacts,
  isOwnMcpNode,
  nodeTouchesMcpAnchors,
  isRelevantMutationList,
  createNativeDomIntegrator,
};
