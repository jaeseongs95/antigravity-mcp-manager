'use strict';

const schema = require('./mcp-config-schema');
const { createHostMcpBridge } = require('./host-mcp-bridge');
const { ensureModalStyles, createModalController } = require('./modal-ui');

const MCP_MANAGER_VERSION = 'v1.2.0';
const NATIVE_BTN_ATTR = 'data-agy-custom-mcp-btn';

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
        .querySelectorAll('[data-agy-adapter-id="mcp-manager"], [data-testid="agy-statusbar-mcp-btn"]')
        .forEach((el) => {
          try {
            el.remove();
          } catch (_e) {
            // ignore
          }
        });
    }
  } catch (_err) {
    // ignore
  }
}

function mountMcpManager(env = {}) {
  const win = env.window || (typeof window !== 'undefined' ? window : null);
  const doc = env.document || (win && win.document ? win.document : null);
  if (!win || !doc || !doc.body) return null;

  // Ensure no statusbar buttons/adapters remain from any prior version
  cleanupLegacyStatusBarArtifacts(win, doc);

  if (win.agyMcpManager && win.agyMcpManager.version === MCP_MANAGER_VERSION) {
    return win.agyMcpManager;
  }
  if (win.agyMcpManager && typeof win.agyMcpManager.destroy === 'function') {
    try {
      win.agyMcpManager.destroy();
    } catch (_e) {
      // ignore cleanup error
    }
  }

  ensureModalStyles(doc);

  const bridge = env.bridge || createHostMcpBridge({ win });
  const modal = createModalController({
    doc,
    bridge,
  });

  // Inject "+ Custom MCP Server", "⚙️ Edit Settings", and "🔑 Authenticate" controls strictly into Antigravity's native Customizations / MCP views
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
      modal.openModal('editor');
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
    authCustomBtn.textContent = '🔑 MCP Auth Settings';
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
    if (!doc.body) return;

    // A) Next to native [data-testid="add-mcp-button"] in Customizations -> MCP Servers header
    const addMcpBtns = doc.querySelectorAll('[data-testid="add-mcp-button"]');
    addMcpBtns.forEach((nativeBtn) => {
      const parent = nativeBtn.parentElement;
      if (!parent) return;
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
          modal.openModal('editor');
        });
        parent.insertBefore(customBtn, nativeBtn);
      }
      if (!parent.querySelector(`[${NATIVE_BTN_ATTR}="beside-edit-btn"]`)) {
        const editBtn = doc.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'agy-mcp-btn';
        editBtn.style.marginLeft = '6px';
        editBtn.setAttribute(NATIVE_BTN_ATTR, 'beside-edit-btn');
        editBtn.textContent = '⚙️ Edit Custom MCP';
        editBtn.title = 'Edit custom MCP server settings & authentication';
        editBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          modal.openEditPopup();
        });
        parent.insertBefore(editBtn, nativeBtn);
      }
    });

    // B) Inside native [data-testid="add-mcp-screen"] ("Add MCP Server" modal / screen)
    const addMcpScreens = doc.querySelectorAll('[data-testid="add-mcp-screen"]');
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
      desc.textContent = 'Custom Stdio (npx / uvx / node / python) or HTTP MCP server:';

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
        modal.openModal('editor');
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
      manageBtn.textContent = 'Manage Custom Servers';
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

    // C) Next to the "No MCP servers yet." empty note OR above the [data-testid="mcp-server-row"] list
    const paragraphs = doc.querySelectorAll('p');
    paragraphs.forEach((p) => {
      if (
        p.textContent &&
        (p.textContent.includes('No MCP servers yet.') || p.textContent.includes('등록된 MCP 서버가 없습니다')) &&
        p.parentElement &&
        !p.parentElement.querySelector(`[${NATIVE_BTN_ATTR}="empty-mcp-note"]`)
      ) {
        p.parentElement.appendChild(buildQuickActionToolbar());
      }
    });

    const firstServerRow = doc.querySelector('[data-testid="mcp-server-row"]');
    if (firstServerRow && firstServerRow.parentElement && firstServerRow.parentElement.parentElement) {
      const listContainer = firstServerRow.parentElement;
      const sectionBody = listContainer.parentElement;
      const existingToolbar = sectionBody.querySelector(`[${NATIVE_BTN_ATTR}="empty-mcp-note"]`);
      if (!existingToolbar) {
        sectionBody.insertBefore(buildQuickActionToolbar(), listContainer);
      } else if (!existingToolbar.querySelector(`[${NATIVE_BTN_ATTR}="toolbar-edit-popup-btn"]`)) {
        existingToolbar.replaceWith(buildQuickActionToolbar());
      }
    }

    // D) Inside each native [data-testid="mcp-server-row"] item: inject "⚙️ Edit Settings" and "🔑 Authenticate" buttons
    const rows = doc.querySelectorAll('[data-testid="mcp-server-row"]');
    rows.forEach((row) => {
      const serverName = extractServerNameFromRow(row);
      if (!serverName) return;

      // D1) Top title/badge line of the row
      const topLine = row.firstElementChild;
      const leftGroup = topLine && topLine.firstElementChild ? topLine.firstElementChild : null;
      if (leftGroup && !leftGroup.querySelector(`[${NATIVE_BTN_ATTR}="row-edit-btn"]`)) {
        const editRowBtn = doc.createElement('button');
        editRowBtn.type = 'button';
        editRowBtn.className = 'agy-mcp-inline-row-btn';
        editRowBtn.setAttribute(NATIVE_BTN_ATTR, 'row-edit-btn');
        editRowBtn.setAttribute('data-mcp-server', serverName);
        editRowBtn.textContent = '⚙️ Edit Settings';
        editRowBtn.title = `Edit settings & authentication for "${serverName}"`;
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
        authRowBtn.textContent = '🔑 Authenticate';
        authRowBtn.title = `Configure Bearer token, API Key, or OAuth for "${serverName}"`;
        authRowBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          modal.openEditPopup(serverName, { focusAuth: true });
        });

        leftGroup.appendChild(editRowBtn);
        leftGroup.appendChild(authRowBtn);
      }

      // D2) Next to [data-testid="mcp-server-fix-with-agent"] inside error boxes (e.g. "Unauthorized")
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
        fixAuthBtn.textContent = '🔑 Authenticate';
        fixAuthBtn.title = `Configure authentication for "${serverName}"`;
        fixAuthBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          modal.openEditPopup(serverName, { focusAuth: true });
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

  injectIntoNativeMcpScreens();

  let observer = null;
  if (typeof win.MutationObserver === 'function') {
    observer = new win.MutationObserver(() => {
      injectIntoNativeMcpScreens();
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  // Keyboard shortcut: Ctrl+Shift+M to open/toggle modal, Escape to close
  function onKeyDown(e) {
    if (!e) return;
    if (e.key === 'Escape') {
      if (modal.isEditPopupOpen()) {
        modal.closeEditPopup();
        return;
      }
      if (modal.isOpen()) {
        modal.closeModal();
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key).toLowerCase() === 'm') {
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
    reload: () => modal.reloadData(),
    bridge,
    schema,
    destroy() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      win.removeEventListener('keydown', onKeyDown);
      modal.closeEditPopup();
      modal.closeModal();
      cleanupLegacyStatusBarArtifacts(win, doc);
      doc.querySelectorAll(`[${NATIVE_BTN_ATTR}]`).forEach((el) => {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      if (win.agyMcpManager === controller) {
        delete win.agyMcpManager;
      }
    },
  };

  win.agyMcpManager = controller;
  return controller;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountMcpManager());
  } else {
    mountMcpManager();
  }
}

module.exports = {
  MCP_MANAGER_VERSION,
  mountMcpManager,
  cleanupLegacyStatusBarArtifacts,
  schema,
  createHostMcpBridge,
  createModalController,
};
