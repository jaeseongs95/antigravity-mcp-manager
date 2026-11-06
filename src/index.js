'use strict';

const schema = require('./mcp-config-schema');
const { createHostMcpBridge } = require('./host-mcp-bridge');
const { ensureModalStyles, createModalController } = require('./modal-ui');

const MCP_MANAGER_VERSION = 'v1.0.1';
const NATIVE_BTN_ATTR = 'data-agy-custom-mcp-btn';

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

  // Inject "+ Custom MCP Server" controls strictly into Antigravity's native Customizations / MCP views
  function injectIntoNativeMcpScreens() {
    if (!doc.body) return;

    // A) Next to native [data-testid="add-mcp-button"] in Customizations -> MCP Servers header
    const addMcpBtns = doc.querySelectorAll('[data-testid="add-mcp-button"]');
    addMcpBtns.forEach((nativeBtn) => {
      const parent = nativeBtn.parentElement;
      if (!parent || parent.querySelector(`[${NATIVE_BTN_ATTR}="beside-add-btn"]`)) return;
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
      btnGroup.appendChild(manageBtn);
      banner.appendChild(desc);
      banner.appendChild(btnGroup);

      if (headerRow.nextSibling) {
        screen.insertBefore(banner, headerRow.nextSibling);
      } else {
        screen.appendChild(banner);
      }
    });

    // C) Next to the "No MCP servers yet. Use Add to browse the store." empty note in Customizations -> MCP Servers
    const paragraphs = doc.querySelectorAll('p');
    paragraphs.forEach((p) => {
      if (
        p.textContent &&
        p.textContent.includes('No MCP servers yet.') &&
        p.parentElement &&
        !p.parentElement.querySelector(`[${NATIVE_BTN_ATTR}="empty-mcp-note"]`)
      ) {
        const wrap = doc.createElement('div');
        wrap.setAttribute(NATIVE_BTN_ATTR, 'empty-mcp-note');
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '8px';
        wrap.style.paddingLeft = '12px';
        wrap.style.marginTop = '6px';

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
        wrap.appendChild(rawBtn);
        p.parentElement.appendChild(wrap);
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
    if (e.key === 'Escape' && modal.isOpen()) {
      modal.closeModal();
      return;
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
    reload: () => modal.reloadData(),
    bridge,
    schema,
    destroy() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      win.removeEventListener('keydown', onKeyDown);
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
