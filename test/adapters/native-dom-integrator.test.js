'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { McpManagerService } = require('../../src/core/mcp-manager-service');
const { createModalController, SETTINGS_PANE_ID } = require('../../src/ui/modal-controller');
const { resolveHostAdapterConfig } = require('../../src/adapters/antigravity/host-config');
const {
  LEGACY_LOCALSTORAGE_BACKUP_KEY,
  SETTINGS_NAV_TESTID,
  CUSTOMIZATIONS_EDIT_BTN_TESTID,
  REMOTE_LAUNCHER_ID,
  createNativeDomIntegrator,
} = require('../../src/adapters/antigravity/native-dom-integrator');
const {
  createInMemoryConfigRepo,
  createFakeMcpRuntime,
  createFakeOAuthBroker,
  createSyntheticDomEnv,
} = require('../helpers/dom-and-rpc-fakes');

test('MCP-TC-022, 039, 042 & 048: native-dom-integrator purges legacy localStorage backup, injects single Settings tab with tab-leave secret scrubbing, mounts remote launcher outside statusbar, and restores DOM on dispose()', async () => {
  const { win, doc, localStorage } = createSyntheticDomEnv({
    url: 'https://antigravity.google.com/r/live-session',
    initialLocalStorage: {
      [LEGACY_LOCALSTORAGE_BACKUP_KEY]: '{"mcpServers":{"leaked":{"headers":{"Authorization":"Bearer old"}}}}',
      'unrelated-host-key': 'keep-me',
    },
  });

  // Build realistic host DOM:
  // 1) `.agy-ctx-statusbar` companion bar
  const statusbar = doc.createElement('div');
  statusbar.className = 'agy-ctx-statusbar';
  doc.body.appendChild(statusbar);

  // 2) `ga-remote-control` (remote session active)
  const gaRemote = doc.createElement('ga-remote-control');
  doc.body.appendChild(gaRemote);

  // 3) Settings dialog with `Models` nav button + content pane
  const settingsRoot = doc.createElement('div');
  const navSidebar = doc.createElement('div');
  const modelsNavBtn = doc.createElement('button');
  modelsNavBtn.setAttribute('data-testid', 'settings-nav-item-Models');
  modelsNavBtn.setAttribute('aria-selected', 'true');
  modelsNavBtn.textContent = 'Models';
  navSidebar.appendChild(modelsNavBtn);

  const settingsContentHost = doc.createElement('div');
  const nativeModelsPane = doc.createElement('div');
  nativeModelsPane.id = 'native-models-pane';
  nativeModelsPane.style.display = 'block';
  settingsContentHost.appendChild(nativeModelsPane);

  settingsRoot.appendChild(navSidebar);
  settingsRoot.appendChild(settingsContentHost);
  doc.body.appendChild(settingsRoot);

  // 4) Customizations section with `[data-testid="add-mcp-button"]`
  const customizationsBar = doc.createElement('div');
  const addMcpBtn = doc.createElement('button');
  addMcpBtn.setAttribute('data-testid', 'add-mcp-button');
  addMcpBtn.textContent = '+ Add MCP';
  customizationsBar.appendChild(addMcpBtn);
  doc.body.appendChild(customizationsBar);

  const service = new McpManagerService({
    configRepo: createInMemoryConfigRepo(),
    mcpRuntime: createFakeMcpRuntime(),
    oauthBroker: createFakeOAuthBroker(),
  });
  const modalController = createModalController({ win, doc, service });
  const hostConfig = resolveHostAdapterConfig({}, win);

  const integrator = createNativeDomIntegrator({
    win,
    doc,
    hostConfig,
    modalController,
  });
  integrator.start();

  // 1. Legacy plaintext `localStorage['agy-custom-mcp-config-backup-v1']` purged immediately on startup!
  assert.equal(localStorage.getItem(LEGACY_LOCALSTORAGE_BACKUP_KEY), null);
  assert.equal(localStorage.getItem('unrelated-host-key'), 'keep-me');

  // 2. Reconciling multiple times injects ONLY ONE Settings nav tab, ONE Customizations button, and ONE Remote Launcher
  integrator.reconcileAll();
  integrator.reconcileAll();

  assert.equal(doc.querySelectorAll(`[data-testid="${SETTINGS_NAV_TESTID}"]`).length, 1);
  assert.equal(doc.querySelectorAll(`[data-testid="${CUSTOMIZATIONS_EDIT_BTN_TESTID}"]`).length, 1);
  assert.equal(doc.querySelectorAll(`#${REMOTE_LAUNCHER_ID}`).length, 1);

  const launcher = doc.getElementById(REMOTE_LAUNCHER_ID);
  assert.equal(statusbar.contains(launcher), false, 'Remote launcher must be mounted outside .agy-ctx-statusbar');

  // 3. Clicking `MCP Servers` Settings tab activates embedded pane; switching back to `Models` scrubs sensitive drafts!
  const mcpNavBtn = doc.querySelector(`[data-testid="${SETTINGS_NAV_TESTID}"]`);
  mcpNavBtn.click();
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(nativeModelsPane.style.display, 'none');
  const embeddedPane = doc.getElementById(SETTINGS_PANE_ID);
  assert.ok(embeddedPane);

  // Populate secret draft while on MCP Servers tab
  service.updateDraftState({
    quickAddInput: 'https://private.example.com/mcp',
    quickAddAuthToken: 'Bearer super-secret-tab-token',
  });
  assert.equal(service.getDraftState().quickAddAuthToken, 'Bearer super-secret-tab-token');

  // User clicks sibling `Models` Settings tab -> `onSettingsPaneHidden()` fires -> secrets scrubbed!
  modelsNavBtn.click();
  assert.equal(service.getDraftState().quickAddInput, '');
  assert.equal(service.getDraftState().quickAddAuthToken, '');
  assert.equal(nativeModelsPane.style.display, 'block');

  // 4. Re-activate MCP Servers tab and call `integrator.dispose()` -> restores native pane and removes all injected nodes
  mcpNavBtn.click();
  assert.equal(nativeModelsPane.style.display, 'none');

  integrator.dispose();
  modalController.dispose();
  service.dispose();

  assert.equal(nativeModelsPane.style.display, 'block', 'Native Settings pane display restored on dispose()');
  assert.equal(doc.querySelector(`[data-testid="${SETTINGS_NAV_TESTID}"]`), null);
  assert.equal(doc.querySelector(`[data-testid="${CUSTOMIZATIONS_EDIT_BTN_TESTID}"]`), null);
  assert.equal(doc.getElementById(REMOTE_LAUNCHER_ID), null);
});
