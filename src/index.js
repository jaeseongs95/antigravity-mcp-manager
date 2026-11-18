'use strict';

/**
 * Composition Root (`src/index.js`) — Antigravity Custom MCP Server Manager `v2.0.0`.
 *
 * Wires the vendor-independent core (`McpManagerService`), host-neutral UI (`createModalController`),
 * and the Antigravity host adapter (`src/adapters/antigravity/*`) under a single LIFO `DisposableStore`.
 */

const { DisposableStore } = require('./core/disposable');
const { McpManagerService } = require('./core/mcp-manager-service');
const { createModalController, MODAL_ID, EDIT_POPUP_ID, OAUTH_MODAL_ID } = require('./ui/modal-controller');
const { ensureModalStyles, removeModalStyles, DEFAULT_STYLE_ID } = require('./ui/design-tokens-styles');
const { isImeComposing } = require('./ui/dom-kit');
const { disposableEvent } = require('./shared/dom-disposables');
const { ANTIGRAVITY_BRAND_PROFILE, resolveHostAdapterConfig } = require('./adapters/antigravity/host-config');
const { createReactFiberGateway } = require('./adapters/antigravity/react-fiber-gateway');
const { acquireRemoteControlLease } = require('./adapters/antigravity/remote-control-lease');
const { createRpcTransport } = require('./adapters/antigravity/rpc-transport');
const { createAntigravityPortsAdapter } = require('./adapters/antigravity/antigravity-ports-adapter');
const { createCompanionCoordinator } = require('./adapters/antigravity/companion-coordinator');
const { createNativeDomIntegrator } = require('./adapters/antigravity/native-dom-integrator');
const { createRemoteFramePromoterCoordinator } = require('./adapters/antigravity/remote-workbench/frame-promoter-fsm');

const MCP_MANAGER_VERSION = '2.0.0';

/**
 * Creates a fully wired MCP Manager application instance without global side effects.
 *
 * @param {{
 *   win: any,
 *   doc?: any,
 *   hostConfig?: Record<string, any>,
 *   portsOverride?: {
 *     configRepo?: any,
 *     runtimePort?: any,
 *     oauthBroker?: any
 *   },
 *   brandProfile?: Record<string, any>,
 *   enableDomIntegration?: boolean,
 *   enableCompanionLoader?: boolean,
 *   enableRemotePromotion?: boolean
 * }} options
 */
function createMcpManagerApp(options = {}) {
  const win = options.win;
  const doc = options.doc || win?.document || null;
  const appStore = new DisposableStore();

  const hostConfig = resolveHostAdapterConfig(options.hostConfig, win);
  const brandProfile = {
    ...ANTIGRAVITY_BRAND_PROFILE,
    ...(options.brandProfile || {}),
  };

  const fiberGateway = createReactFiberGateway({ win, doc });
  appStore.add(fiberGateway);

  let promoterCoordinator = null;
  let domIntegrator = null;

  const remoteLease = acquireRemoteControlLease({
    win,
    doc,
    onInstanceSeen() {
      promoterCoordinator?.checkAndPromote();
    },
  });
  appStore.add(remoteLease);

  const rpcTransport = createRpcTransport({
    win,
    doc,
    hostConfig,
    fiberGateway,
    remoteLease,
  });

  const antigravityPorts = createAntigravityPortsAdapter({
    win,
    doc,
    hostConfig,
    fiberGateway,
    remoteLease,
    rpcTransport,
  });
  appStore.add(antigravityPorts);

  const service = new McpManagerService({
    configRepo: options.portsOverride?.configRepo || antigravityPorts.configRepo,
    runtimePort: options.portsOverride?.runtimePort || antigravityPorts.runtimePort,
    oauthBroker: options.portsOverride?.oauthBroker || antigravityPorts.oauthBroker,
  });
  appStore.add(service);

  const hasCompanionUsingSharedStyles = () => Boolean(win && win.__agyMcpSharedStylesPinned);
  const modalController = createModalController({
    win,
    doc,
    service,
    brandProfile,
    ownsStyles: !hasCompanionUsingSharedStyles(),
  });
  appStore.add(modalController);

  if (options.enableRemotePromotion !== false) {
    promoterCoordinator = createRemoteFramePromoterCoordinator({
      win,
      doc,
      hostConfig,
      remoteLease,
      version: MCP_MANAGER_VERSION,
      onPromotedReady() {
        fiberGateway.resetCache();
        domIntegrator?.reconcileAll();
      },
    });
    appStore.add(promoterCoordinator);
    promoterCoordinator.start();
  }

  if (options.enableCompanionLoader !== false) {
    const companionCoordinator = createCompanionCoordinator({
      win,
      doc,
      hostConfig,
      rpcTransport,
    });
    appStore.add(companionCoordinator);
    companionCoordinator.start();
  }

  if (options.enableDomIntegration !== false) {
    domIntegrator = createNativeDomIntegrator({
      win,
      doc,
      hostConfig,
      modalController,
    });
    appStore.add(domIntegrator);
    domIntegrator.start();
  }

  if (win && typeof win.addEventListener === 'function') {
    appStore.add(
      disposableEvent(win, 'keydown', (event) => {
        if (!event || isImeComposing(event)) return;
        if (
          event.ctrlKey &&
          event.altKey &&
          !event.shiftKey &&
          !event.metaKey &&
          String(event.key || '').toLowerCase() === 'm'
        ) {
          event.preventDefault?.();
          if (modalController.isModalOpen()) {
            modalController.closeModal();
          } else {
            modalController.openModal();
          }
        }
      })
    );
  }

  let destroyed = false;
  const controller = {
    version: MCP_MANAGER_VERSION,
    service,
    modalController,
    openModal: (opts) => modalController.openModal(opts),
    closeModal: () => modalController.closeModal(),
    isModalOpen: () => modalController.isModalOpen(),
    openEditPopup: (opts) => modalController.openEditPopup(opts),
    closeEditPopup: () => modalController.closeEditPopup(),
    openOAuthConnectModal: (serverName, openerEl) =>
      modalController.openOAuthConnectModal(serverName, openerEl),
    closeOAuthConnectModal: () => modalController.closeOAuthConnectModal(),
    reconcileDom: () => domIntegrator?.reconcileAll(),
    isDestroyed: () => destroyed || appStore.isDisposed,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      appStore.dispose();
      if (!hasCompanionUsingSharedStyles()) {
        removeModalStyles(doc, DEFAULT_STYLE_ID);
      }
      if (win) {
        if (win.agyMcpManager === controller) {
          delete win.agyMcpManager;
        }
        if (win.__agyMountMcpManager === mountMcpManager) {
          delete win.__agyMountMcpManager;
        }
        try {
          delete win.__agyTrustedTypesPolicy;
        } catch {
          // Ignore non-configurable property
        }
      }
    },
  };

  return controller;
}

/**
 * Mounts MCP Manager onto `win` (`window.agyMcpManager` + `window.__agyMountMcpManager`) idempotently.
 *
 * @param {any} win
 * @param {Record<string, any>} [options]
 */
function mountMcpManager(win, options = {}) {
  if (!win || !win.document) return null;

  try {
    delete win.__agyTrustedTypesPolicy;
  } catch {
    // Ignore non-configurable property
  }

  win.__agyMountMcpManager = mountMcpManager;

  const existing = win.agyMcpManager;
  if (existing && typeof existing === 'object') {
    const stillAlive = typeof existing.isDestroyed === 'function' ? !existing.isDestroyed() : true;
    if (stillAlive && existing.version === MCP_MANAGER_VERSION && !options.forceRemount) {
      existing.reconcileDom?.();
      return existing;
    }
    if (typeof existing.destroy === 'function') {
      existing.destroy();
    }
  }

  ensureModalStyles(win.document, DEFAULT_STYLE_ID);
  const instance = createMcpManagerApp({
    ...options,
    win,
    doc: win.document,
  });
  win.agyMcpManager = instance;
  return instance;
}

if (typeof window !== 'undefined' && window && window.document) {
  window.__agyMountMcpManager = mountMcpManager;
  if (!window.__AGY_MCP_DISABLE_AUTOMOUNT__) {
    mountMcpManager(window);
  }
}

module.exports = {
  MCP_MANAGER_VERSION,
  MODAL_ID,
  EDIT_POPUP_ID,
  OAUTH_MODAL_ID,
  createMcpManagerApp,
  mountMcpManager,
};
