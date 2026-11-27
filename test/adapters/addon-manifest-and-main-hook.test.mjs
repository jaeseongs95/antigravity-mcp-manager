import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MODULE_ORDER,
  RENDERER_OUTPUT_PATH,
  assembleRendererSource,
} from '../../scripts/build-renderer.mjs';
import { HOST_CONFIG_SCOPES } from '../../src/adapters/antigravity/renderer/host-config-store.mjs';
import {
  LANG_STORAGE_KEY,
  assertAddonContextV3,
  createHostRuntime,
} from '../../src/adapters/antigravity/renderer/host-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'addon-manifest.json');
const RENDERER_SRC_DIR = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'renderer');
const LEGACY_ELECTRON_HOOK_PATH = path.join(ROOT_DIR, 'scripts', 'electron-hook.cjs');

test('NMCP-TC-022 (Contract & SOLID Parity): addon-manifest.json satisfies AddonManifest.v3 (minimal permissions: ui, storage, configBridge only; net/dom/events/services/uiSlots omitted), obsolete v2 DOM mounts are removed, zero hostProfileId/app.asar/unsafe DOM sinks exist, and addon-renderer.js matches modular SOLID sources', () => {
  // 1. AddonManifest.v3 schema & minimal-permission contract
  assert.equal(fs.existsSync(MANIFEST_PATH), true, 'addon-manifest.json must exist at repository root');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const pluginJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'plugin.json'), 'utf8'));

  assert.equal(manifest.$schema, 'https://github.com/jaeseongs95/extenra/schemas/addon-manifest.v3.schema.json');
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.apiVersion, 3);
  assert.equal(manifest.pluginId, 'antigravity-mcp-manager');
  assert.equal(manifest.version, '4.3.2');
  assert.equal(manifest.version, pkg.version);
  assert.equal(pluginJson.version, pkg.version);
  assert.equal(manifest.trustLevel, 'trusted');
  assert.deepEqual(manifest.compatibility, {
    surfaces: ['desktop', 'remote-web'],
    hostProfiles: ['antigravity-desktop', 'antigravity-remote-web'],
    minHostVersion: '3.3.3',
  });
  assert.deepEqual(manifest.capabilities, ['renderer']);
  assert.equal(manifest.entry.rendererScript, 'src/adapters/antigravity/addon-renderer.js');
  assert.equal(manifest.entry.mainHookScript, undefined);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, manifest.entry.rendererScript)), true);

  // Minimal permissions: ONLY ui, storage, events (remote-bridge subscribe), configBridge (net, dom, secrets, services omitted)
  assert.deepEqual(Object.keys(manifest.permissions).sort(), ['configBridge', 'events', 'storage', 'ui']);
  assert.equal(manifest.permissions.ui.sectionActions, true, 'permissions.ui.sectionActions must be explicitly declared');
  assert.deepEqual(manifest.permissions.events, {
    subscribe: ['host:remote-bridge-changed'],
  });
  assert.equal(manifest.permissions.net, undefined, 'permissions.net must be omitted');
  assert.equal(manifest.permissions.dom, undefined, 'permissions.dom must be omitted');
  assert.equal(manifest.permissions.secrets, undefined, 'permissions.secrets must be omitted');
  assert.equal(manifest.permissions.services, undefined, 'permissions.services must be omitted');
  assert.equal(manifest.uiSlots, undefined, 'Legacy v2 uiSlots must be omitted');
  assert.equal(manifest.settingsBridge, undefined, 'Legacy v2 top-level settingsBridge must be omitted');
  assert.equal(manifest.configBridge, undefined, 'Legacy v2 top-level configBridge must be omitted');

  assert.deepEqual(manifest.permissions.configBridge, {
    scopes: [
      { scopeId: HOST_CONFIG_SCOPES.GLOBAL_MCP, access: 'rw', maxBytes: 262144 },
      { scopeId: HOST_CONFIG_SCOPES.PLUGIN_MCP, access: 'ro', maxBytes: 262144 },
      { scopeId: HOST_CONFIG_SCOPES.LEGACY_MCP, access: 'ro', maxBytes: 262144 },
    ],
  });
  assert.deepEqual(manifest.permissions.storage, {
    namespace: 'antigravity-mcp-manager',
    maxBytes: 262144,
  });
  assert.equal(manifest.loadOrder, 60);

  // 2. Removed legacy/v2 files must not exist
  const removedFiles = [
    LEGACY_ELECTRON_HOOK_PATH,
    path.join(ROOT_DIR, 'sidecars'),
    path.join(ROOT_DIR, 'scripts', 'install-settings-menu.mjs'),
    path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'settings-menu-injector.js'),
    path.join(RENDERER_SRC_DIR, 'settings-sidebar-mount.mjs'),
    path.join(RENDERER_SRC_DIR, 'customizations-mount.mjs'),
    path.join(RENDERER_SRC_DIR, 'remote-drawer-mount.mjs'),
    path.join(RENDERER_SRC_DIR, 'mount-coordinator.mjs'),
    path.join(RENDERER_SRC_DIR, 'remote-draft-config-store.mjs'),
  ];
  for (const p of removedFiles) {
    assert.equal(fs.existsSync(p), false, `Obsolete v1/v2 artifact must be removed: ${p}`);
  }
  assert.equal(pkg.dependencies?.['@electron/asar'], undefined);

  // 3. Deterministic build parity & zero unsafe sinks / hostProfileId / app.asar in renderer sources
  const expectedAssembled = assembleRendererSource();
  const actualAssembled = fs.readFileSync(RENDERER_OUTPUT_PATH, 'utf8');
  assert.equal(
    actualAssembled,
    expectedAssembled,
    'src/adapters/antigravity/addon-renderer.js is out of sync with renderer/*.mjs (run npm run build:renderer)'
  );

  const forbiddenPatterns = [
    /\.innerHTML\s*=/,
    /\.outerHTML\s*=/,
    /insertAdjacentHTML\s*\(/,
    /document\.write\s*\(/,
    /\beval\s*\(/,
    /new\s+Function\s*\(/,
    /@electron\/asar|app\.asar/,
    /\bhostProfileId\b/,
    /\bwindow\.localStorage\b/,
  ];
  for (const filePath of [RENDERER_OUTPUT_PATH, ...MODULE_ORDER.map((n) => path.join(RENDERER_SRC_DIR, n))]) {
    const codeOnly = fs
      .readFileSync(filePath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const rx of forbiddenPatterns) {
      assert.equal(rx.test(codeOnly), false, `Forbidden pattern ${rx} in ${filePath}`);
    }
  }
});

test('NMCP-TC-024 (Unit): host-runtime enforces AddonContextV3 contract, branches strictly on env.capabilities.hasConfigBridge, persists language via ctx.storage, and omits hostProfileId', async () => {
  // 1. Reject missing or v2 handles
  assert.throws(() => assertAddonContextV3(null), /ERR_MISSING_ADDON_CONTEXT_V3/);
  assert.throws(() => assertAddonContextV3({ apiVersion: 2 }), /ERR_UNSUPPORTED_ADDON_API_VERSION:2/);

  // 2. Construct minimal v3 context (desktop without configBridge -> falls back to remote-draft over ctx.storage)
  const kv = new Map([[LANG_STORAGE_KEY, 'ko']]);
  const listeners = new Set();
  const disposers = [];
  const abortController = new AbortController();

  const makeCtx = (overrides = {}) => ({
    apiVersion: 3,
    meta: {
      pluginId: 'antigravity-mcp-manager',
      displayName: 'Antigravity MCP Manager',
      version: '4.0.0',
      trustLevel: 'trusted',
      sourceSchemaVersion: 3,
    },
    env: {
      surface: 'desktop',
      layoutMode: 'desktop',
      capabilities: {
        hasLocalLoopback: false,
        hasNetHttps: false,
        hasConfigBridge: false,
        hasSettingsBridge: false,
        hasDocumentTransform: false,
      },
    },
    i18n: { getLocale: () => 'en-US', t: (k) => k },
    theme: { getMode: () => 'dark', getTokens: () => ({}), getTokenCss: () => '', onDidChange: () => () => {} },
    ui: {
      showToast: () => ({ id: 't1', dismiss() {} }),
      confirm: async () => true,
      prompt: async () => null,
      registerCommand: () => ({ unregister() {}, dispose() {} }),
      registerStatusItem: () => ({ id: 's1', update() {}, dispose() {} }),
      registerSettingsPage: () => ({ id: 'p1', open() {}, update() {}, dispose() {} }),
      openPanel: () => ({}),
      openModal: () => ({}),
      openPopup: () => ({}),
      createStyleElementSafe: (css) => ({ textContent: css }),
    },
    storage: {
      get: async (k) => kv.get(k),
      set: async (k, v) => {
        const oldValue = kv.get(k);
        kv.set(k, v);
        for (const fn of listeners) fn({ key: k, oldValue, newValue: v });
        return true;
      },
      onDidChange: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    lifecycle: {
      signal: abortController.signal,
      onDispose: (fn) => disposers.push(fn),
      addManagedListener: () => () => {},
      runSafe: (fn) => fn(),
    },
    ...overrides,
  });

  const rtNoBridge = createHostRuntime({ ctx: makeCtx(), doc: null });
  assert.equal(rtNoBridge.apiVersion, 3);
  assert.equal(rtNoBridge.getSurface(), 'desktop');
  assert.equal(rtNoBridge.getLayoutMode(), 'desktop');
  assert.equal(rtNoBridge.hasConfigBridge(), false);
  assert.equal(rtNoBridge.getConfigStoreMode(), 'remote-draft');
  assert.equal(rtNoBridge.resolveEffectiveLang(), 'en');
  assert.equal(await rtNoBridge.loadSavedLang(), 'ko');
  assert.equal(rtNoBridge.resolveEffectiveLang(), 'ko');
  assert.equal(rtNoBridge.writeSavedLang('en'), true);
  assert.equal(kv.get(LANG_STORAGE_KEY), 'en');
  assert.equal(rtNoBridge.writeSavedLang('fr'), false);

  // 2b. Korean locale defaults (ko / ko-KR / ko_KR) when storage is empty, overridden by saved preference
  kv.clear();
  const rtKoDefault = createHostRuntime({
    ctx: makeCtx({ i18n: { getLocale: () => 'ko_KR', t: (k) => k } }),
    doc: null,
  });
  assert.equal(rtKoDefault.resolveEffectiveLang(), 'ko', 'Korean locale must default to ko on first run');
  assert.equal(await rtKoDefault.loadSavedLang(), 'ko');
  kv.set(LANG_STORAGE_KEY, 'en');
  assert.equal(await rtKoDefault.loadSavedLang(), 'en', 'Saved user preference must override host locale');
  kv.delete(LANG_STORAGE_KEY);
  assert.equal(await rtKoDefault.loadSavedLang(), 'ko', 'Clearing saved preference must revert to host locale');

  // 2c. Central Extenra host locale switch (ctx.i18n.onDidChange) overrides stale savedLang immediately
  let hostLocale = 'ko-KR';
  const localeCbs = new Set();
  kv.set(LANG_STORAGE_KEY, 'en');
  const rtCentralSync = createHostRuntime({
    ctx: makeCtx({
      i18n: {
        getLocale: () => hostLocale,
        t: (k) => k,
        onDidChange: (fn) => {
          localeCbs.add(fn);
          return () => localeCbs.delete(fn);
        },
      },
    }),
    doc: null,
  });
  assert.equal(await rtCentralSync.loadSavedLang(), 'en');
  const observedLocales = [];
  const unsubLocale = rtCentralSync.onLocaleChange((loc) => observedLocales.push(loc));
  hostLocale = 'ko';
  for (const fn of localeCbs) fn('ko');
  assert.deepEqual(observedLocales, ['ko']);
  assert.equal(rtCentralSync.resolveEffectiveLang(), 'ko', 'Central host locale switch must immediately override stale savedLang');
  assert.equal(kv.get(LANG_STORAGE_KEY), 'ko', 'Central host locale switch must sync stored preference');
  unsubLocale();

  // 3. Desktop with hasConfigBridge: true + rw antigravity:mcp-config -> host-bridge mode
  const rtBridge = createHostRuntime({
    ctx: makeCtx({
      env: {
        surface: 'desktop',
        layoutMode: 'compact',
        capabilities: {
          hasLocalLoopback: false,
          hasNetHttps: false,
          hasConfigBridge: true,
          hasSettingsBridge: false,
          hasDocumentTransform: false,
        },
      },
      configBridge: {
        scopes: [{ scopeId: HOST_CONFIG_SCOPES.GLOBAL_MCP, access: 'rw', maxBytes: 262144 }],
        read: async () => ({ ok: true, status: 'missing' }),
        write: async () => ({ ok: true }),
      },
    }),
    doc: null,
  });
  assert.equal(rtBridge.hasConfigBridge(), true);
  assert.equal(rtBridge.getConfigStoreMode(), 'host-bridge');
  assert.equal(rtBridge.getLayoutMode(), 'compact');
  assert.ok(rtBridge.createConfigService());

  // 4. Remote Web with dynamic hasRemoteHostBridge getter + host:remote-bridge-changed subscription
  let remoteConnected = false;
  const eventHandlers = new Map();
  const rtRemoteBridge = createHostRuntime({
    ctx: makeCtx({
      env: {
        surface: 'remote-web',
        layoutMode: 'desktop',
        capabilities: {
          hasLocalLoopback: false,
          hasNetHttps: false,
          hasConfigBridge: true,
          get hasRemoteHostBridge() {
            return remoteConnected;
          },
          hasSettingsBridge: false,
          hasDocumentTransform: false,
        },
      },
      events: {
        on(topic, fn) {
          eventHandlers.set(topic, fn);
          return () => eventHandlers.delete(topic);
        },
      },
      configBridge: {
        scopes: [{ scopeId: HOST_CONFIG_SCOPES.GLOBAL_MCP, access: 'rw', maxBytes: 262144 }],
        read: async () => ({ ok: false, status: 'unavailable', reason: 'ERR_REMOTE_HOST_NOT_CONNECTED' }),
        write: async () => ({ ok: false, reason: 'ERR_REMOTE_HOST_NOT_CONNECTED' }),
      },
    }),
    doc: null,
  });
  assert.equal(rtRemoteBridge.hasRemoteHostBridge(), false);
  assert.equal(rtRemoteBridge.getConfigStoreMode(), 'remote-bridge-disconnected');
  const seenBridgeEvents = [];
  const unsubBridge = rtRemoteBridge.onRemoteBridgeChange((ev) => seenBridgeEvents.push(ev));
  remoteConnected = true;
  eventHandlers.get('host:remote-bridge-changed')({ connected: true, baseUrl: 'http://127.0.0.1:19384' });
  assert.equal(rtRemoteBridge.hasRemoteHostBridge(), true);
  assert.equal(rtRemoteBridge.getConfigStoreMode(), 'host-bridge');
  assert.equal(seenBridgeEvents.length, 1);
  assert.equal(seenBridgeEvents[0].connected, true);
  unsubBridge();
});
