import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { RENDERER_OUTPUT_PATH } from '../../scripts/build-renderer.mjs';
import { V3_IDS } from '../../src/adapters/antigravity/renderer/mcp-v3-shell.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'addon-manifest.json');
const require = createRequire(import.meta.url);

function loadAddonHostSdk() {
  const candidates = [
    process.env.ANTIGRAVITY_ADDONS_SDK_PATH,
    path.resolve(ROOT_DIR, '..', 'antigravity-addons', 'packages', 'sdk', 'src', 'index.js'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }
  return null;
}

function flushMicrotasks(ms = 40) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runAssembledRendererInSdkHost(host, ctx) {
  const rendererSrc = fs.readFileSync(RENDERER_OUTPUT_PATH, 'utf8');
  const sandbox = {
    window: host.win,
    document: host.doc,
    addonHost: ctx,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    TextEncoder,
    Uint8Array,
    ArrayBuffer,
    DataView,
    URL,
    crypto: globalThis.crypto,
    AbortController: globalThis.AbortController,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(rendererSrc, sandbox, { filename: 'addon-renderer.js' });
}

test('NMCP-TC-037 (@antigravity-addons/sdk Desktop Parity): real createTestHost({ surface: "desktop" }) verifies minimal ISP permissions (net/dom omitted, configBridge present), Tier-1 status item / settings page / commands, Tier-2 declarative openPanel + handle.update + mobile <=640px sheet, Tier-3 openModal CRUD, and clean disposePlugin()', async (t) => {
  const sdk = loadAddonHostSdk();
  if (!sdk || typeof sdk.createTestHost !== 'function') {
    t.skip('@antigravity-addons/sdk sibling repository is not present in this checkout');
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const host = sdk.createTestHost({
    surface: 'desktop',
    locale: 'ko-KR',
    themeMode: 'dark',
    viewport: { width: 1280, height: 800 },
    configScopes: {
      'antigravity:mcp-config': {
        data: {
          mcpServers: {
            ledger: { url: 'https://ledger.example/mcp' },
          },
        },
        sha256: 'desktop-init-sha',
      },
    },
  });

  const ctx = await host.mountPlugin(manifest, (addonCtx) => {
    runAssembledRendererInSdkHost(host, addonCtx);
  });

  await flushMicrotasks(60);

  // 1. ISP minimal permissions & abstract env contract
  assert.equal(ctx.apiVersion, 3);
  assert.equal(ctx.env.surface, 'desktop');
  assert.equal(ctx.env.layoutMode, 'desktop');
  assert.equal(ctx.env.capabilities.hasConfigBridge, true);
  assert.equal(ctx.env.capabilities.hasNetHttps, false);
  assert.equal(ctx.env.capabilities.hasLocalLoopback, false);
  assert.equal(ctx.env.capabilities.hasDocumentTransform, false);
  assert.equal(ctx.net, undefined, 'Undeclared permissions.net must be omitted from AddonContextV3');
  assert.equal(ctx.dom, undefined, 'Undeclared permissions.dom must be omitted from AddonContextV3');
  assert.ok(ctx.configBridge && typeof ctx.configBridge.read === 'function');
  assert.equal(ctx.configBridge.scopes.length, 3);

  // 2. Tier 1: Status Item, Settings Page, and Commands registered
  const statusItems = host.getStatusItems();
  assert.equal(statusItems.length, 1);
  assert.equal(statusItems[0].id, V3_IDS.STATUS_ITEM);
  assert.equal(statusItems[0].badge, '1');

  const settingsPages = host.getSettingsPages();
  assert.equal(settingsPages.length, 1);
  assert.equal(settingsPages[0].id, V3_IDS.SETTINGS_PAGE);
  assert.equal(settingsPages[0].kind, 'canvas');

  const commands = ctx.ui.listCommands().map((c) => c.actionId);
  assert.ok(commands.includes(V3_IDS.CMD_OPEN_MANAGER));
  assert.ok(commands.includes(V3_IDS.CMD_OPEN_PANEL));
  assert.ok(commands.includes(V3_IDS.CMD_OPEN_SETTINGS));

  // 3. Tier 2: Quick Panel (openPanel) declarative schema + ID-based handle.update + mobile <=640px sheet
  const panelHandle = ctx.ui.invokeCommand(manifest.pluginId, V3_IDS.CMD_OPEN_PANEL);
  await flushMicrotasks(50);
  assert.ok(panelHandle, 'open-mcp-panel command must open Tier-2 declarative panel');
  assert.equal(panelHandle.kind, 'panel');
  assert.equal(panelHandle.bodyEl, null, 'Tier-2 schema panel keeps DOM host-owned');
  assert.equal(panelHandle.getState().lang, 'ko');
  assert.equal(panelHandle.getState().serverCount, 1);
  assert.ok(panelHandle.getElementById('mcp-summary-text'));
  const desktopPlacement = panelHandle.getPlacement();
  assert.equal(desktopPlacement.zone, 'drawer');

  // Switch viewport to mobile (<=640px) -> PlacementEngine auto-switches to bottom sheet
  host.setViewport(480, 800);
  assert.equal(ctx.env.layoutMode, 'mobile');
  const mobilePlacement = panelHandle.reposition();
  assert.equal(mobilePlacement.zone, 'sheet', 'Viewport <=640px must auto-switch Tier-2 panel to mobile bottom sheet');
  panelHandle.close();

  // 4. Tier 3: Full Editor Modal mounts NativeMcpPanel via configBridge and writes a new server
  host.setViewport(1280, 800);
  const modalHandle = ctx.ui.invokeCommand(manifest.pluginId, V3_IDS.CMD_OPEN_MANAGER);
  await flushMicrotasks(60);
  assert.ok(modalHandle && modalHandle.bodyEl, 'open-mcp-manager must open Tier-3 modal with bodyEl');
  const panelRoot = modalHandle.bodyEl.querySelector('[data-agy-mcp-native-panel="true"]');
  assert.ok(panelRoot, 'NativeMcpPanel must mount inside Tier-3 modal bodyEl');
  assert.equal(panelRoot.getAttribute('data-agy-mcp-mode'), 'host-bridge');
  assert.ok(panelRoot.querySelector('[data-testid="global-server-ledger"]'), 'Desktop configBridge server must render');

  // Add a server through NativeMcpPanel DOM inside mock SDK host
  panelRoot.querySelector('[data-testid="btn-add-server"]').click();
  const nameInput = panelRoot.querySelector('[data-testid="input-server-name"]');
  const urlInput = panelRoot.querySelector('[data-testid="input-http-url"]');
  nameInput.value = 'sdk-desktop-srv';
  nameInput.dispatchEvent({ type: 'input', target: nameInput });
  urlInput.value = 'https://sdk-desktop.example/mcp';
  urlInput.dispatchEvent({ type: 'input', target: urlInput });
  panelRoot.querySelector('[data-testid="btn-save-server"]').click();
  await flushMicrotasks(80);

  const afterRead = await ctx.configBridge.read('antigravity:mcp-config');
  assert.equal(afterRead.data.mcpServers['sdk-desktop-srv'].url, 'https://sdk-desktop.example/mcp');
  assert.equal(host.getStatusItems()[0].badge, '2', 'Status item badge must update live after CRUD save');

  // 5. Clean disposal via host.disposePlugin()
  assert.equal(ctx.lifecycle.signal.aborted, false);
  assert.equal(host.disposePlugin(manifest.pluginId), true);
  assert.equal(ctx.lifecycle.signal.aborted, true);
  assert.equal(host.getStatusItems().length, 0);
  assert.equal(host.getSettingsPages().length, 0);
});

test('NMCP-TC-038 (@antigravity-addons/sdk Remote Web Parity): real createTestHost({ surface: "remote-web" }) omits configBridge/net/dom, persists CRUD drafts via ctx.storage, renders remote-io-bar in Settings Page, and supports mobile sheet + disposePlugin()', async (t) => {
  const sdk = loadAddonHostSdk();
  if (!sdk || typeof sdk.createTestHost !== 'function') {
    t.skip('@antigravity-addons/sdk sibling repository is not present in this checkout');
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const host = sdk.createTestHost({
    surface: 'remote-web',
    locale: 'en-US',
    themeMode: 'light',
    viewport: { width: 1280, height: 800 },
  });

  const ctx = await host.mountPlugin(manifest, (addonCtx) => {
    runAssembledRendererInSdkHost(host, addonCtx);
  });

  await flushMicrotasks(60);

  // 1. Remote Web capability branching & strict omission of desktop-only namespaces
  assert.equal(ctx.apiVersion, 3);
  assert.equal(ctx.env.surface, 'remote-web');
  assert.equal(ctx.env.capabilities.hasConfigBridge, false);
  assert.equal(ctx.configBridge, undefined, 'configBridge must be strictly undefined on remote-web');
  assert.equal(ctx.net, undefined);
  assert.equal(ctx.dom, undefined);

  // 2. Tier-1 Status Item & Settings Page parity with Desktop
  assert.equal(host.getStatusItems().length, 1);
  assert.equal(host.getStatusItems()[0].badge, '0');
  assert.equal(host.getSettingsPages().length, 1);

  // 3. Open unified Settings Page -> mounts NativeMcpPanel in remote-draft mode with Import/Copy/Download bar
  const settingsHandle = ctx.ui.invokeCommand(manifest.pluginId, V3_IDS.CMD_OPEN_SETTINGS);
  await flushMicrotasks(60);
  assert.ok(settingsHandle && settingsHandle.bodyEl);
  const panelRoot = settingsHandle.bodyEl.querySelector('[data-agy-mcp-native-panel="true"]');
  assert.ok(panelRoot);
  assert.equal(panelRoot.getAttribute('data-agy-mcp-mode'), 'remote-draft');
  assert.equal(panelRoot.getAttribute('data-agy-mcp-surface'), 'settings');
  assert.ok(panelRoot.querySelector('[data-testid="remote-io-bar"]'));

  // Add server -> persisted into ctx.storage (remote-draft:v1)
  panelRoot.querySelector('[data-testid="btn-add-server"]').click();
  const nameInput = panelRoot.querySelector('[data-testid="input-server-name"]');
  const urlInput = panelRoot.querySelector('[data-testid="input-http-url"]');
  nameInput.value = 'sdk-remote-srv';
  nameInput.dispatchEvent({ type: 'input', target: nameInput });
  urlInput.value = 'https://sdk-remote.example/mcp';
  urlInput.dispatchEvent({ type: 'input', target: urlInput });
  panelRoot.querySelector('[data-testid="btn-save-server"]').click();
  await flushMicrotasks(80);

  const storedDraft = await ctx.storage.get('remote-draft:v1');
  assert.ok(storedDraft && typeof storedDraft.rawText === 'string');
  assert.ok(storedDraft.rawText.includes('sdk-remote-srv'));
  assert.equal(host.getStatusItems()[0].badge, '1');

  // 4. Tier-2 Quick Panel shows Remote Draft badge and mobile bottom sheet at <=640px
  const quickPanel = ctx.ui.invokeCommand(manifest.pluginId, V3_IDS.CMD_OPEN_PANEL);
  await flushMicrotasks(50);
  assert.equal(quickPanel.getState().mode, 'remote-draft');
  assert.equal(quickPanel.getState().serverCount, 1);
  host.setViewport(390, 844);
  assert.equal(ctx.env.layoutMode, 'mobile');
  assert.equal(quickPanel.reposition().zone, 'sheet');

  // 5. Clean disposal
  assert.equal(host.disposePlugin(manifest.pluginId), true);
  assert.equal(ctx.lifecycle.signal.aborted, true);
  assert.equal(host.getStatusItems().length, 0);
  assert.equal(host.getSettingsPages().length, 0);
});
