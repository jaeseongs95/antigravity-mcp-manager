import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { RENDERER_OUTPUT_PATH } from '../../scripts/build-renderer.mjs';
import { createHostRuntime, LANG_STORAGE_KEY } from '../../src/adapters/antigravity/renderer/host-runtime.mjs';
import { V3_IDS, createMcpV3Shell } from '../../src/adapters/antigravity/renderer/mcp-v3-shell.mjs';

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

  // 2. Tier 1: Desktop uses Settings Page + Commands ONLY (no Status Item on Desktop per host v3.0.3 contract)
  const statusItems = host.getStatusItems();
  assert.equal(statusItems.length, 0, 'Desktop surface must not register a status item');

  const settingsPages = host.getSettingsPages();
  assert.equal(settingsPages.length, 1);
  assert.equal(settingsPages[0].id, V3_IDS.SETTINGS_PAGE);
  assert.equal(settingsPages[0].kind, 'canvas');
  assert.equal(settingsPages[0].title, 'MCP 매니저', 'Korean locale must set Korean Settings Page title on first run');

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
  assert.equal(host.getStatusItems().length, 0, 'Desktop must remain free of status items after CRUD save');

  // 5. Clean disposal via host.disposePlugin()
  assert.equal(ctx.lifecycle.signal.aborted, false);
  assert.equal(host.disposePlugin(manifest.pluginId), true);
  assert.equal(ctx.lifecycle.signal.aborted, true);
  assert.equal(host.getStatusItems().length, 0);
  assert.equal(host.getSettingsPages().length, 0);
});

test('NMCP-TC-038 (@antigravity-addons/sdk Remote Web Parity — Disconnected): real createTestHost({ surface: "remote-web", remoteBridgeConnected: false }) omits configBridge/net/dom, shows Host Bridge pairing notice without plugin URL/token inputs, persists CRUD drafts via ctx.storage, renders remote-io-bar, and supports mobile sheet + disposePlugin()', async (t) => {
  const sdk = loadAddonHostSdk();
  if (!sdk || typeof sdk.createTestHost !== 'function') {
    t.skip('@antigravity-addons/sdk sibling repository is not present in this checkout');
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const host = sdk.createTestHost({
    surface: 'remote-web',
    remoteBridgeConnected: false,
    locale: 'ko-KR',
    themeMode: 'light',
    viewport: { width: 1280, height: 800 },
  });

  const ctx = await host.mountPlugin(manifest, (addonCtx) => {
    runAssembledRendererInSdkHost(host, addonCtx);
  });

  await flushMicrotasks(60);

  // 1. Remote Web disconnected capability branching & strict omission of desktop-only namespaces
  assert.equal(ctx.apiVersion, 3);
  assert.equal(ctx.env.surface, 'remote-web');
  assert.equal(ctx.env.capabilities.hasConfigBridge, false);
  assert.equal(ctx.env.capabilities.hasRemoteHostBridge, false);
  assert.equal(ctx.configBridge, undefined, 'configBridge must be strictly undefined on disconnected remote-web');
  assert.equal(ctx.net, undefined);
  assert.equal(ctx.dom, undefined);

  // 2. Tier-1 Status Item & Settings Page parity
  assert.equal(host.getStatusItems().length, 1);
  assert.equal(host.getStatusItems()[0].badge, '0');
  assert.equal(host.getSettingsPages().length, 1);

  // 3. Open unified Settings Page -> mounts NativeMcpPanel in remote-draft mode with Host Bridge notice + Import/Copy/Download bar
  const settingsHandle = ctx.ui.invokeCommand(manifest.pluginId, V3_IDS.CMD_OPEN_SETTINGS);
  await flushMicrotasks(60);
  assert.ok(settingsHandle && settingsHandle.bodyEl);
  const panelRoot = settingsHandle.bodyEl.querySelector('[data-agy-mcp-native-panel="true"]');
  assert.ok(panelRoot);
  assert.equal(panelRoot.getAttribute('data-agy-mcp-mode'), 'remote-draft');
  assert.equal(panelRoot.getAttribute('data-agy-mcp-surface'), 'settings');
  const bridgeNotice = panelRoot.querySelector('[data-testid="remote-bridge-disconnected-notice"]');
  assert.ok(bridgeNotice, 'Disconnected Remote Web must display Host Bridge pairing guidance');
  assert.ok(bridgeNotice.textContent.includes('Addons → Host Bridge'));
  assert.equal(panelRoot.querySelector('[data-testid="input-remote-bridge-url"]'), null, 'Plugin must never render its own remote URL input');
  assert.equal(panelRoot.querySelector('[data-testid="input-remote-bridge-token"]'), null, 'Plugin must never render its own remote token input');
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

  // 4. Tier-2 Quick Panel shows Remote Draft badge, Host Bridge notice, and mobile bottom sheet at <=640px
  const quickPanel = ctx.ui.invokeCommand(manifest.pluginId, V3_IDS.CMD_OPEN_PANEL);
  await flushMicrotasks(50);
  assert.equal(quickPanel.getState().mode, 'remote-draft');
  assert.equal(quickPanel.getState().showRemoteBridgeNotice, true);
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

test('NMCP-TC-040 (@antigravity-addons/sdk v3.1.1 Remote Web Connected): real createTestHost({ surface: "remote-web", remoteBridgeConnected: true }) routes ctx.configBridge live to Desktop mcp_config.json without disconnected notice or plugin URL/token inputs', async (t) => {
  const sdk = loadAddonHostSdk();
  if (!sdk || typeof sdk.createTestHost !== 'function') {
    t.skip('@antigravity-addons/sdk sibling repository is not present in this checkout');
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const host = sdk.createTestHost({
    surface: 'remote-web',
    remoteBridgeConnected: true,
    locale: 'ko-KR',
    themeMode: 'dark',
    viewport: { width: 1280, height: 800 },
    configScopes: {
      'antigravity:mcp-config': {
        data: {
          mcpServers: {
            desktopLive: { url: 'https://desktop-live.example/mcp' },
          },
        },
        sha256: 'remote-live-sha-1',
      },
    },
  });

  const ctx = await host.mountPlugin(manifest, (addonCtx) => {
    runAssembledRendererInSdkHost(host, addonCtx);
  });

  await flushMicrotasks(60);

  // 1. Connected Remote Host Bridge exposes configBridge + hasRemoteHostBridge === true
  assert.equal(ctx.apiVersion, 3);
  assert.equal(ctx.env.surface, 'remote-web');
  assert.equal(ctx.env.capabilities.hasConfigBridge, true);
  assert.equal(ctx.env.capabilities.hasRemoteHostBridge, true);
  assert.ok(ctx.configBridge && typeof ctx.configBridge.read === 'function');
  assert.equal(ctx.net, undefined);
  assert.equal(ctx.dom, undefined);

  // 2. Remote Web keeps Status Item with live Desktop server count
  assert.equal(host.getStatusItems().length, 1);
  assert.equal(host.getStatusItems()[0].badge, '1');

  // 3. Tier-2 Quick Panel shows host-bridge mode and hides disconnected notice
  const quickPanel = ctx.ui.invokeCommand(manifest.pluginId, V3_IDS.CMD_OPEN_PANEL);
  await flushMicrotasks(50);
  assert.equal(quickPanel.getState().mode, 'host-bridge');
  assert.equal(quickPanel.getState().remoteBridgeConnected, true);
  assert.equal(quickPanel.getState().showRemoteBridgeNotice, false);
  assert.equal(quickPanel.getState().serverCount, 1);
  quickPanel.close();

  // 4. Unified Settings Page runs live host-bridge CRUD against Desktop mcp_config.json
  const settingsHandle = ctx.ui.invokeCommand(manifest.pluginId, V3_IDS.CMD_OPEN_SETTINGS);
  await flushMicrotasks(60);
  assert.ok(settingsHandle && settingsHandle.bodyEl);
  const panelRoot = settingsHandle.bodyEl.querySelector('[data-agy-mcp-native-panel="true"]');
  assert.ok(panelRoot);
  assert.equal(panelRoot.getAttribute('data-agy-mcp-mode'), 'host-bridge');
  assert.equal(panelRoot.querySelector('[data-testid="remote-bridge-disconnected-notice"]'), null);
  assert.equal(panelRoot.querySelector('[data-testid="remote-io-bar"]'), null);
  assert.ok(panelRoot.querySelector('[data-testid="global-server-desktopLive"]'));

  panelRoot.querySelector('[data-testid="btn-add-server"]').click();
  const nameInput = panelRoot.querySelector('[data-testid="input-server-name"]');
  const urlInput = panelRoot.querySelector('[data-testid="input-http-url"]');
  nameInput.value = 'remote-paired-srv';
  nameInput.dispatchEvent({ type: 'input', target: nameInput });
  urlInput.value = 'https://remote-paired.example/mcp';
  urlInput.dispatchEvent({ type: 'input', target: urlInput });
  panelRoot.querySelector('[data-testid="btn-save-server"]').click();
  await flushMicrotasks(80);

  const afterRead = await ctx.configBridge.read('antigravity:mcp-config');
  assert.equal(afterRead.data.mcpServers['remote-paired-srv'].url, 'https://remote-paired.example/mcp');
  assert.equal(host.getStatusItems()[0].badge, '2');

  // 5. Clean disposal
  assert.equal(host.disposePlugin(manifest.pluginId), true);
  assert.equal(ctx.lifecycle.signal.aborted, true);
  assert.equal(host.getStatusItems().length, 0);
  assert.equal(host.getSettingsPages().length, 0);
});

function createMinimalMockDoc() {
  const makeNode = (tag) => {
    const attrs = new Map();
    const listeners = new Map();
    const childNodes = [];
    let textContentValue = '';
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      nodeType: 1,
      parentNode: null,
      childNodes,
      style: {},
      className: '',
      value: '',
      checked: false,
      disabled: false,
      get firstChild() {
        return childNodes[0] || null;
      },
      get textContent() {
        if (childNodes.length === 0) return textContentValue;
        return textContentValue + childNodes.map((c) => c.textContent || '').join('');
      },
      set textContent(v) {
        textContentValue = String(v ?? '');
        childNodes.length = 0;
      },
      setAttribute(k, v) {
        attrs.set(String(k), String(v));
      },
      getAttribute(k) {
        return attrs.has(String(k)) ? attrs.get(String(k)) : null;
      },
      appendChild(child) {
        if (!child) return child;
        child.parentNode = el;
        childNodes.push(child);
        return child;
      },
      removeChild(child) {
        const idx = childNodes.indexOf(child);
        if (idx !== -1) {
          childNodes.splice(idx, 1);
          child.parentNode = null;
        }
        return child;
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
      },
      querySelector(selector) {
        const match = String(selector || '').match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        const walk = (n) => {
          for (const c of n.childNodes || []) {
            if (!c || c.nodeType !== 1) continue;
            if (match) {
              const val = c.getAttribute(match[1]);
              if (val !== null && (match[2] === undefined || val === match[2])) return c;
            } else if (c.tagName.toLowerCase() === String(selector).toLowerCase()) {
              return c;
            }
            const nested = walk(c);
            if (nested) return nested;
          }
          return null;
        };
        return walk(el);
      },
    };
    return el;
  };
  return {
    createElement: (tag) => makeNode(tag),
  };
}

function createStandaloneMockContext({ surface = 'desktop', locale = 'ko-KR', initialStorage = {} } = {}) {
  const kv = new Map(Object.entries(initialStorage));
  const storageListeners = new Set();
  const statusItemCalls = [];
  const settingsPageCalls = [];
  const openPanelCalls = [];
  const commandCalls = [];
  const abortController = new AbortController();
  const disposers = [];

  const ctx = {
    apiVersion: 3,
    meta: {
      pluginId: 'antigravity-mcp-manager',
      displayName: 'Antigravity MCP Manager',
      version: '4.0.1',
      trustLevel: surface === 'desktop' ? 'trusted' : 'restricted',
      sourceSchemaVersion: 3,
    },
    env: {
      surface,
      layoutMode: 'desktop',
      capabilities: {
        hasLocalLoopback: false,
        hasNetHttps: false,
        hasConfigBridge: surface === 'desktop',
        hasSettingsBridge: false,
        hasDocumentTransform: false,
      },
    },
    i18n: {
      getLocale: () => locale,
      t: (k) => k,
    },
    theme: {
      getMode: () => 'dark',
      getTokens: () => ({}),
      getTokenCss: () => '',
      onDidChange: () => () => {},
    },
    ui: {
      showToast: () => ({ id: 'toast', dismiss() {} }),
      confirm: async () => true,
      prompt: async () => null,
      registerCommand: (id, spec) => {
        commandCalls.push({ id, spec });
        return { unregister() {}, dispose() {} };
      },
      registerStatusItem: (spec) => {
        statusItemCalls.push(spec);
        return { id: spec.id, update() {}, dispose() {} };
      },
      registerSettingsPage: (spec) => {
        settingsPageCalls.push(spec);
        return { id: spec.id, open: () => null, update() {}, dispose() {} };
      },
      openPanel: (opts) => {
        openPanelCalls.push(opts);
        return { kind: 'panel', update() {}, close() {} };
      },
      openModal: () => ({ kind: 'modal', bodyEl: null, close() {} }),
      openPopup: () => ({ kind: 'popup', close() {} }),
      createStyleElementSafe: (cssText) => {
        const styleEl = createMinimalMockDoc().createElement('style');
        styleEl.textContent = String(cssText || '');
        return styleEl;
      },
    },
    storage: {
      get: async (k) => (kv.has(k) ? kv.get(k) : undefined),
      set: async (k, v) => {
        const oldValue = kv.get(k);
        kv.set(k, v);
        for (const fn of storageListeners) fn({ key: k, oldValue, newValue: v });
        return true;
      },
      onDidChange: (fn) => {
        storageListeners.add(fn);
        return () => storageListeners.delete(fn);
      },
    },
    lifecycle: {
      signal: abortController.signal,
      onDispose: (fn) => disposers.push(fn),
      addManagedListener: () => () => {},
      runSafe: (fn) => fn(),
    },
  };

  if (surface === 'desktop') {
    ctx.configBridge = {
      scopes: [
        { scopeId: 'antigravity:mcp-config', access: 'rw', maxBytes: 262144 },
        { scopeId: 'antigravity:plugin-mcp-configs', access: 'ro', maxBytes: 262144 },
        { scopeId: 'antigravity:mcp-config-legacy', access: 'ro', maxBytes: 262144 },
      ],
      read: async (scopeId) =>
        scopeId === 'antigravity:mcp-config'
          ? { ok: true, scopeId, status: 'ok', data: { mcpServers: {} }, rawText: null, sha256: 'sha-0' }
          : { ok: true, scopeId, status: 'missing', data: null, rawText: null, sha256: null },
      write: async () => ({ ok: true, currentSha256: 'sha-1' }),
    };
  }

  return { ctx, statusItemCalls, settingsPageCalls, openPanelCalls, commandCalls, kv, disposers };
}

test('NMCP-TC-039 (Unit): Host v3.0.3 contract — Desktop omits registerStatusItem and mounts inline Settings Page with onClose cleanup, Remote Web registers registerStatusItem, and initial language follows ctx.i18n.getLocale() with saved preference override', async () => {
  // 1. Desktop (ko-KR, no saved preference): NO registerStatusItem, inline registerSettingsPage + onClose cleanup, Korean default
  const docDesktop = createMinimalMockDoc();
  const desktop = createStandaloneMockContext({ surface: 'desktop', locale: 'ko-KR' });
  const desktopRuntime = createHostRuntime({ ctx: desktop.ctx, doc: docDesktop });
  const desktopShell = createMcpV3Shell({ runtime: desktopRuntime, doc: docDesktop, win: null });
  desktopShell.start();
  await flushMicrotasks(20);

  assert.equal(desktop.statusItemCalls.length, 0, 'Desktop surface must NOT call registerStatusItem()');
  assert.equal(desktop.settingsPageCalls.length, 1, 'Desktop surface must register exactly 1 Settings Page');
  const pageSpec = desktop.settingsPageCalls[0];
  assert.equal(pageSpec.id, V3_IDS.SETTINGS_PAGE);
  assert.equal(pageSpec.title, 'MCP 매니저', 'Initial Korean locale must not default to English');

  // Simulate host v3.0.3 inline mount inside mountedContentPane
  const canvasRoot = docDesktop.createElement('div');
  const inlineHandle = { kind: 'inline-settings', bodyEl: canvasRoot, close() {} };
  pageSpec.render(canvasRoot, inlineHandle);
  await flushMicrotasks(20);

  const styleNode = canvasRoot.querySelector('style');
  const panelNode = canvasRoot.querySelector('[data-agy-mcp-native-panel="true"]');
  assert.ok(styleNode && styleNode.textContent.includes('[data-agy-mcp-inline="true"]'), 'Inline Settings CSS rules must be injected');
  assert.ok(panelNode, 'NativeMcpPanel must mount inside inline Settings canvasRoot');
  assert.equal(panelNode.getAttribute('data-agy-mcp-inline'), 'true', 'Inline handle must set data-agy-mcp-inline="true"');
  assert.equal(panelNode.getAttribute('data-agy-mcp-lang'), 'ko', 'Mounted panel must use Korean default from ctx.i18n.getLocale()');
  assert.ok(panelNode.childNodes.length > 0, 'Mounted panel must have rendered DOM children');

  // Simulate Settings tab switch / close -> host invokes spec.onClose()
  pageSpec.onClose();
  assert.equal(panelNode.childNodes.length, 0, 'onClose() must dispose and clear inline settingsCanvasPanel DOM');
  desktopShell.dispose();

  // 2. Desktop with Korean locale + saved user preference "en" -> saved preference takes precedence
  const docPref = createMinimalMockDoc();
  const prefDesktop = createStandaloneMockContext({
    surface: 'desktop',
    locale: 'ko-KR',
    initialStorage: { [LANG_STORAGE_KEY]: 'en' },
  });
  const prefRuntime = createHostRuntime({ ctx: prefDesktop.ctx, doc: docPref });
  const prefShell = createMcpV3Shell({ runtime: prefRuntime, doc: docPref, win: null });
  prefShell.start();
  await flushMicrotasks(20);
  assert.equal(prefRuntime.resolveEffectiveLang(), 'en', 'Saved user preference in ctx.storage must override host locale');
  prefShell.dispose();

  // 3. Remote Web (en-US): DOES call registerStatusItem() aligned right, clicking it opens Tier-2 Quick Panel
  const docRemote = createMinimalMockDoc();
  const remote = createStandaloneMockContext({ surface: 'remote-web', locale: 'en-US' });
  const remoteRuntime = createHostRuntime({ ctx: remote.ctx, doc: docRemote });
  const remoteShell = createMcpV3Shell({ runtime: remoteRuntime, doc: docRemote, win: null });
  remoteShell.start();
  await flushMicrotasks(20);

  assert.equal(remote.statusItemCalls.length, 1, 'Remote Web must call registerStatusItem()');
  assert.equal(remote.statusItemCalls[0].id, V3_IDS.STATUS_ITEM);
  assert.equal(remote.statusItemCalls[0].align, 'right');
  assert.equal(remote.settingsPageCalls.length, 1, 'Remote Web must also register Settings Page');
  assert.equal(remote.settingsPageCalls[0].title, 'MCP Manager');

  remote.statusItemCalls[0].onClick({});
  assert.equal(remote.openPanelCalls.length, 1, 'Clicking Remote Web status item must open Tier-2 Quick Panel');
  remoteShell.dispose();
});

test('NMCP-TC-041 (Unit): Remote Web unified Host Bridge handles ERR_REMOTE_HOST_NOT_CONNECTED cleanly without crash and auto-reloads on host:remote-bridge-changed connect/disconnect', async () => {
  const doc = createMinimalMockDoc();
  let bridgeConnected = false;
  let lastStatusUpdate = null;
  let lastPanelState = null;
  const eventListeners = new Map();

  const remoteCtx = {
    apiVersion: 3,
    meta: {
      pluginId: 'antigravity-mcp-manager',
      displayName: 'Antigravity MCP Manager',
      version: '4.1.0',
      trustLevel: 'trusted',
      sourceSchemaVersion: 3,
    },
    env: {
      surface: 'remote-web',
      layoutMode: 'desktop',
      capabilities: {
        hasLocalLoopback: false,
        hasNetHttps: false,
        hasConfigBridge: true,
        get hasRemoteHostBridge() {
          return bridgeConnected;
        },
        hasSettingsBridge: false,
        hasDocumentTransform: false,
      },
    },
    i18n: { getLocale: () => 'ko-KR', t: (k) => k },
    theme: { getMode: () => 'dark', getTokens: () => ({}), getTokenCss: () => '', onDidChange: () => () => {} },
    events: {
      on(topic, fn) {
        if (!eventListeners.has(topic)) eventListeners.set(topic, new Set());
        eventListeners.get(topic).add(fn);
        return () => eventListeners.get(topic)?.delete(fn);
      },
    },
    ui: {
      showToast: () => ({ id: 't', dismiss() {} }),
      confirm: async () => true,
      prompt: async () => null,
      registerCommand: () => ({ unregister() {}, dispose() {} }),
      registerStatusItem: (spec) => {
        lastStatusUpdate = { ...spec };
        return {
          id: spec.id,
          update(patch) {
            lastStatusUpdate = { ...lastStatusUpdate, ...patch };
          },
          dispose() {},
        };
      },
      registerSettingsPage: (spec) => {
        remoteCtx._settingsSpec = spec;
        return { id: spec.id, open: () => null, update() {}, dispose() {} };
      },
      openPanel: (opts) => {
        lastPanelState = opts.state;
        return {
          kind: 'panel',
          update(_tree, nextState) {
            lastPanelState = nextState;
          },
          close() {},
        };
      },
      openModal: () => ({ kind: 'modal', bodyEl: null, close() {} }),
      openPopup: () => ({ kind: 'popup', close() {} }),
      createStyleElementSafe: (cssText) => {
        const s = doc.createElement('style');
        s.textContent = String(cssText || '');
        return s;
      },
    },
    storage: {
      get: async () => undefined,
      set: async () => true,
      onDidChange: () => () => {},
    },
    configBridge: {
      scopes: [
        { scopeId: 'antigravity:mcp-config', access: 'rw', maxBytes: 262144 },
        { scopeId: 'antigravity:plugin-mcp-configs', access: 'ro', maxBytes: 262144 },
        { scopeId: 'antigravity:mcp-config-legacy', access: 'ro', maxBytes: 262144 },
      ],
      async read(scopeId) {
        if (!bridgeConnected) {
          return { ok: false, scopeId, status: 'unavailable', data: null, rawText: null, sha256: null, reason: 'ERR_REMOTE_HOST_NOT_CONNECTED' };
        }
        if (scopeId === 'antigravity:mcp-config') {
          return {
            ok: true,
            scopeId,
            status: 'ok',
            data: { mcpServers: { pairedSrv: { url: 'https://paired.example/mcp' } } },
            rawText: null,
            sha256: 'paired-sha-1',
          };
        }
        return { ok: true, scopeId, status: 'missing', data: null, rawText: null, sha256: null };
      },
      async write() {
        if (!bridgeConnected) return { ok: false, reason: 'ERR_REMOTE_HOST_NOT_CONNECTED', currentSha256: null };
        return { ok: true, currentSha256: 'paired-sha-2' };
      },
    },
    lifecycle: {
      signal: new AbortController().signal,
      onDispose: () => {},
      addManagedListener: () => () => {},
      runSafe: (fn) => fn(),
    },
  };

  const runtime = createHostRuntime({ ctx: remoteCtx, doc });
  const shell = createMcpV3Shell({ runtime, doc, win: null });
  shell.start();
  await flushMicrotasks(30);

  // 1. Disconnected initial state: clean guidance notice, badge '!', zero crash, zero URL/token inputs
  assert.equal(lastStatusUpdate.badge, '!');
  shell.openQuickPanel();
  await flushMicrotasks(20);
  assert.equal(lastPanelState.mode, 'remote-bridge-disconnected');
  assert.equal(lastPanelState.showRemoteBridgeNotice, true);
  assert.equal(lastPanelState.hasError, false);

  const canvasRoot = doc.createElement('div');
  remoteCtx._settingsSpec.render(canvasRoot, { kind: 'modal', bodyEl: canvasRoot, close() {} });
  await flushMicrotasks(30);
  const panelRoot = canvasRoot.querySelector('[data-agy-mcp-native-panel="true"]');
  assert.equal(panelRoot.getAttribute('data-agy-mcp-mode'), 'remote-bridge-disconnected');
  const notice = panelRoot.querySelector('[data-testid="remote-bridge-disconnected-notice"]');
  assert.ok(notice, 'Disconnected state must render Host Bridge guidance notice');
  assert.ok(notice.textContent.includes('원격 웹 우측 하단 Addons → Host Bridge 탭에서 데스크톱 호스트를 연결하세요'));
  assert.equal(panelRoot.querySelector('input'), null, 'Disconnected state must not render any plugin URL/token input');

  // 2. Pair via host:remote-bridge-changed { connected: true } -> auto-reloads live Desktop servers
  bridgeConnected = true;
  for (const fn of eventListeners.get('host:remote-bridge-changed') || []) {
    fn({ connected: true, baseUrl: 'http://127.0.0.1:19384' });
  }
  await flushMicrotasks(50);

  assert.equal(lastStatusUpdate.badge, '1', 'Status badge must auto-update to live server count on connect');
  assert.equal(lastPanelState.mode, 'host-bridge');
  assert.equal(lastPanelState.showRemoteBridgeNotice, false);
  assert.equal(lastPanelState.serverCount, 1);
  assert.equal(panelRoot.getAttribute('data-agy-mcp-mode'), 'host-bridge');
  assert.equal(panelRoot.querySelector('[data-testid="remote-bridge-disconnected-notice"]'), null);
  assert.ok(panelRoot.querySelector('[data-testid="global-server-pairedSrv"]'), 'Live Desktop server must auto-render after pairing');

  // 3. Disconnect via host:remote-bridge-changed { connected: false } -> cleanly reverts to guidance notice
  bridgeConnected = false;
  for (const fn of eventListeners.get('host:remote-bridge-changed') || []) {
    fn({ connected: false, baseUrl: null });
  }
  await flushMicrotasks(50);

  assert.equal(lastStatusUpdate.badge, '!');
  assert.equal(lastPanelState.mode, 'remote-bridge-disconnected');
  assert.equal(lastPanelState.showRemoteBridgeNotice, true);
  assert.equal(panelRoot.getAttribute('data-agy-mcp-mode'), 'remote-bridge-disconnected');
  assert.ok(panelRoot.querySelector('[data-testid="remote-bridge-disconnected-notice"]'));

  shell.dispose();
});
