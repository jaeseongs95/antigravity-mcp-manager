'use strict';

/**
 * Antigravity Native DOM Integrator.
 *
 * Responsibilities:
 * 1. Immediately deletes legacy cleartext `localStorage['agy-custom-mcp-config-backup-v1']` (`MCP-TC-042`).
 * 2. Injects a single Settings `"MCP Servers"` navigation item + pane, calling
 *    `modalController.onSettingsPaneHidden()` when the user switches to another Settings tab (`Rev 6 §5.2 #1`).
 * 3. Injects Customizations `"Edit MCP Servers"` button alongside `[data-testid="add-mcp-button"]`.
 * 4. Mounts `#agy-mcp-remote-launcher` directly on `document.body` outside `.agy-ctx-statusbar` (`MCP-TC-048`).
 * 5. Tracks `MutationObserver` and `25ms` debounce timer in `DisposableStore` and restores all
 *    native DOM state cleanly on `dispose()`.
 */

const { DisposableStore } = require('../../core/disposable');
const { ensureModalStyles, DEFAULT_STYLE_ID } = require('../../ui/design-tokens-styles');
const { h } = require('../../ui/dom-kit');
const { SETTINGS_PANE_ID } = require('../../ui/modal-controller');
const { disposableTimeout, disposableEvent, disposableObserver } = require('../../shared/dom-disposables');

const LEGACY_LOCALSTORAGE_BACKUP_KEY = 'agy-custom-mcp-config-backup-v1';
const SETTINGS_NAV_TESTID = 'settings-nav-item-McpManager';
const CUSTOMIZATIONS_EDIT_BTN_TESTID = 'agy-mcp-customizations-edit-btn';
const REMOTE_LAUNCHER_ID = 'agy-mcp-remote-launcher';
const RECONCILE_DEBOUNCE_MS = 25;

/**
 * @param {{
 *   win: any,
 *   doc: any,
 *   hostConfig: any,
 *   modalController: any
 * }} deps
 */
function createNativeDomIntegrator(deps) {
  const { win, doc, hostConfig, modalController } = deps;
  const store = new DisposableStore();
  const injectedElements = new Set();
  const hiddenSiblingDisplays = new Map();

  let debounceDisp = null;
  let wasMcpSettingsPaneActive = false;

  function purgeLegacyLocalStorageBackup() {
    try {
      const ls = win && win.localStorage;
      if (ls && typeof ls.removeItem === 'function') {
        ls.removeItem(LEGACY_LOCALSTORAGE_BACKUP_KEY);
      }
    } catch {
      // Ignore storage sandbox errors
    }
  }

  function registerInjected(el) {
    if (el) injectedElements.add(el);
    return el;
  }

  function restoreHiddenSettingsSiblings() {
    for (const [el, prevDisplay] of hiddenSiblingDisplays.entries()) {
      try {
        if (el && el.style) {
          el.style.display = prevDisplay;
        }
      } catch {
        // Ignore detached elements
      }
    }
    hiddenSiblingDisplays.clear();
  }

  function deactivateMcpSettingsPane(targetDoc) {
    const pane =
      targetDoc && typeof targetDoc.getElementById === 'function'
        ? targetDoc.getElementById(SETTINGS_PANE_ID)
        : null;
    if (pane && pane.style) {
      pane.style.display = 'none';
    }
    const navBtn =
      targetDoc && typeof targetDoc.querySelector === 'function'
        ? targetDoc.querySelector(`[data-testid="${SETTINGS_NAV_TESTID}"]`)
        : null;
    if (navBtn && typeof navBtn.setAttribute === 'function') {
      navBtn.setAttribute('aria-selected', 'false');
    }
    restoreHiddenSettingsSiblings();
    if (wasMcpSettingsPaneActive) {
      wasMcpSettingsPaneActive = false;
      modalController.onSettingsPaneHidden();
    }
  }

  function activateMcpSettingsPane(targetDoc, navParent, navBtn) {
    ensureModalStyles(targetDoc, DEFAULT_STYLE_ID);
    const contentHost = findSettingsContentContainer(navParent);
    if (!contentHost) {
      modalController.openModal({ openerEl: navBtn });
      return;
    }

    const siblings = contentHost.children || [];
    for (let i = 0; i < siblings.length; i += 1) {
      const sib = siblings[i];
      if (sib && sib.id !== SETTINGS_PANE_ID) {
        if (!hiddenSiblingDisplays.has(sib)) {
          hiddenSiblingDisplays.set(sib, sib.style ? sib.style.display || '' : '');
        }
        if (sib.style) {
          sib.style.display = 'none';
        }
      }
    }

    let pane =
      typeof targetDoc.getElementById === 'function' ? targetDoc.getElementById(SETTINGS_PANE_ID) : null;
    if (!pane) {
      pane = registerInjected(
        h(targetDoc, 'div', {
          id: SETTINGS_PANE_ID,
          style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px' },
          dataset: { testid: SETTINGS_PANE_ID },
        })
      );
      contentHost.appendChild(pane);
    } else if (pane.style) {
      pane.style.display = 'flex';
    }

    if (navBtn && typeof navBtn.setAttribute === 'function') {
      navBtn.setAttribute('aria-selected', 'true');
    }
    wasMcpSettingsPaneActive = true;
    modalController.renderSettingsPageContent(pane);
  }

  function findSettingsContentContainer(navParent) {
    if (!navParent || !navParent.parentNode) return null;
    const wrapper = navParent.parentNode;
    const kids = wrapper.children || [];
    for (let i = 0; i < kids.length; i += 1) {
      if (kids[i] !== navParent) {
        return kids[i];
      }
    }
    return null;
  }

  function reconcileSettingsNav(targetDoc) {
    if (!targetDoc || typeof targetDoc.querySelectorAll !== 'function') return;
    let navItems;
    try {
      navItems = targetDoc.querySelectorAll('[data-testid^="settings-nav-item-"]');
    } catch {
      return;
    }
    if (!navItems || navItems.length === 0) {
      if (wasMcpSettingsPaneActive) {
        wasMcpSettingsPaneActive = false;
        restoreHiddenSettingsSiblings();
        modalController.onSettingsPaneHidden();
      }
      return;
    }

    let existingMcpNav = null;
    let anchorNav = null;
    for (let i = 0; i < navItems.length; i += 1) {
      const item = navItems[i];
      const tid = item?.dataset?.testid || item?.getAttribute?.('data-testid') || '';
      if (tid === SETTINGS_NAV_TESTID) {
        if (!existingMcpNav) {
          existingMcpNav = item;
        } else {
          // Enforce strict single-tab invariant by removing duplicate nav button
          item.remove?.();
        }
      } else if (!anchorNav) {
        anchorNav = item;
      }
    }

    if (!anchorNav || !anchorNav.parentNode) return;
    const navParent = anchorNav.parentNode;

    if (!navParent.__agyMcpTabLeaveBound) {
      navParent.__agyMcpTabLeaveBound = true;
      store.add(
        disposableEvent(navParent, 'click', (e) => {
          const target = e?.target;
          const clickedNav =
            target && typeof target.closest === 'function'
              ? target.closest('[data-testid^="settings-nav-item-"]')
              : target;
          const tid = clickedNav?.dataset?.testid || clickedNav?.getAttribute?.('data-testid') || '';
          if (tid && tid !== SETTINGS_NAV_TESTID && wasMcpSettingsPaneActive) {
            deactivateMcpSettingsPane(targetDoc);
          }
        })
      );
    }

    if (!existingMcpNav) {
      const navBtn = registerInjected(
        h(
          targetDoc,
          'button',
          {
            type: 'button',
            className: anchorNav.className || 'agy-mcp-btn',
            'aria-selected': 'false',
            dataset: {
              testid: SETTINGS_NAV_TESTID,
              agyNoTranslate: 'true',
            },
            onClick: (e) => {
              e?.stopPropagation?.();
              activateMcpSettingsPane(targetDoc, navParent, navBtn);
            },
          },
          'MCP Servers'
        )
      );
      navParent.appendChild(navBtn);
    }
  }

  function reconcileCustomizationsButtons(targetDoc) {
    if (!targetDoc || typeof targetDoc.querySelector !== 'function') return;
    let addMcpBtn = null;
    try {
      addMcpBtn = targetDoc.querySelector('[data-testid="add-mcp-button"]');
    } catch {
      return;
    }
    if (!addMcpBtn || !addMcpBtn.parentNode) return;

    const parent = addMcpBtn.parentNode;
    const existingEditBtn =
      typeof parent.querySelector === 'function'
        ? parent.querySelector(`[data-testid="${CUSTOMIZATIONS_EDIT_BTN_TESTID}"]`)
        : null;
    if (existingEditBtn) return;

    ensureModalStyles(targetDoc, DEFAULT_STYLE_ID);
    const editBtn = registerInjected(
      h(
        targetDoc,
        'button',
        {
          type: 'button',
          className: 'agy-mcp-btn',
          dataset: {
            testid: CUSTOMIZATIONS_EDIT_BTN_TESTID,
            agyNoTranslate: 'true',
          },
          onClick: (e) => {
            e?.stopPropagation?.();
            modalController.openEditPopup({ openerEl: editBtn });
          },
        },
        'Edit MCP Servers'
      )
    );
    parent.appendChild(editBtn);
  }

  function shouldShowRemoteLauncher() {
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

  function reconcileRemoteLauncher() {
    if (!doc || !doc.body || !shouldShowRemoteLauncher()) return;
    const existing = typeof doc.getElementById === 'function' ? doc.getElementById(REMOTE_LAUNCHER_ID) : null;
    if (existing) {
      // Ensure launcher never sits inside `.agy-ctx-statusbar`
      if (existing.parentNode !== doc.body) {
        doc.body.appendChild(existing);
      }
      return;
    }

    ensureModalStyles(doc, DEFAULT_STYLE_ID);
    const launcherBtn = registerInjected(
      h(
        doc,
        'button',
        {
          id: REMOTE_LAUNCHER_ID,
          type: 'button',
          className: 'agy-mcp-remote-launcher-btn',
          'aria-label': 'Open Custom MCP Server Manager',
          dataset: {
            testid: REMOTE_LAUNCHER_ID,
            agyNoTranslate: 'true',
          },
          onClick: (e) => {
            e?.stopPropagation?.();
            modalController.openModal({ openerEl: launcherBtn });
          },
        },
        'MCP Servers'
      )
    );
    doc.body.appendChild(launcherBtn);
  }

  function reconcileAll() {
    if (store.isDisposed) return;
    reconcileSettingsNav(doc);
    reconcileCustomizationsButtons(doc);
    reconcileRemoteLauncher();

    if (doc && typeof doc.querySelector === 'function') {
      try {
        const promotedIframe = doc.querySelector('ga-remote-control iframe');
        const childDoc = promotedIframe?.contentDocument || promotedIframe?.contentWindow?.document;
        if (childDoc && childDoc !== doc) {
          reconcileSettingsNav(childDoc);
          reconcileCustomizationsButtons(childDoc);
        }
      } catch {
        // Cross-origin frame prior to promotion — ignore
      }
    }
  }

  function scheduleReconcile() {
    if (store.isDisposed) return;
    if (debounceDisp) return;
    debounceDisp = disposableTimeout(
      win,
      () => {
        debounceDisp = null;
        reconcileAll();
      },
      RECONCILE_DEBOUNCE_MS
    );
    store.add(debounceDisp);
  }

  function start() {
    if (store.isDisposed) return;
    purgeLegacyLocalStorageBackup();
    reconcileAll();

    const ObserverCtor =
      (win && typeof win.MutationObserver === 'function' ? win.MutationObserver : null) ||
      (typeof MutationObserver === 'function' ? MutationObserver : null);

    if (ObserverCtor && doc && (doc.body || doc.documentElement)) {
      const obs = new ObserverCtor(() => {
        scheduleReconcile();
      });
      store.add(
        disposableObserver(obs, doc.body || doc.documentElement, {
          childList: true,
          subtree: true,
        })
      );
    }
  }

  function restoreNativeDom() {
    if (debounceDisp) {
      debounceDisp.dispose();
      debounceDisp = null;
    }
    if (wasMcpSettingsPaneActive) {
      wasMcpSettingsPaneActive = false;
      modalController.onSettingsPaneHidden();
    }
    restoreHiddenSettingsSiblings();

    for (const el of injectedElements) {
      try {
        if (typeof el.remove === 'function') {
          el.remove();
        } else if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
          el.parentNode.removeChild(el);
        }
      } catch {
        // Ignore already-detached nodes
      }
    }
    injectedElements.clear();
  }

  store.add({ dispose: restoreNativeDom });

  return {
    start,
    reconcileAll,
    scheduleReconcile,
    purgeLegacyLocalStorageBackup,
    dispose: () => store.dispose(),
  };
}

module.exports = {
  LEGACY_LOCALSTORAGE_BACKUP_KEY,
  SETTINGS_NAV_TESTID,
  CUSTOMIZATIONS_EDIT_BTN_TESTID,
  REMOTE_LAUNCHER_ID,
  RECONCILE_DEBOUNCE_MS,
  createNativeDomIntegrator,
};
