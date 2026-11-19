import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import {
  MODULE_ORDER,
  RENDERER_OUTPUT_PATH,
  assembleRendererSource,
} from '../../scripts/build-renderer.mjs';
import {
  SLOT_IDS,
  createHostRuntime,
  isSafeLoopbackIframeUrl,
} from '../../src/adapters/antigravity/renderer/host-runtime.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'addon-manifest.json');
const RENDERER_SRC_DIR = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'renderer');
const ELECTRON_HOOK_PATH = path.join(ROOT_DIR, 'scripts', 'electron-hook.cjs');

test('NMCP-TC-022 (Contract & SOLID Parity): addon-manifest.json satisfies AddonManifest.v1, zero app.asar/@electron/asar code exists, and addon-renderer.js matches modular SOLID sources with zero unsafe DOM sinks', () => {
  // 1. Manifest schema & contract checks
  assert.equal(fs.existsSync(MANIFEST_PATH), true, 'addon-manifest.json must exist at repository root');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const pluginJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'plugin.json'), 'utf8'));

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.pluginId, 'antigravity-mcp-manager');
  assert.equal(manifest.version, pkg.version);
  assert.equal(pluginJson.version, pkg.version);
  assert.deepEqual(manifest.compatibility, { hostProfile: 'antigravity-desktop', minHostVersion: '1.0.0' });
  assert.deepEqual(manifest.capabilities, ['mainHook', 'renderer']);
  assert.equal(manifest.entry.rendererScript, 'src/adapters/antigravity/addon-renderer.js');
  assert.equal(manifest.entry.mainHookScript, 'scripts/electron-hook.cjs');
  assert.equal(fs.existsSync(path.join(ROOT_DIR, manifest.entry.rendererScript)), true);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, manifest.entry.mainHookScript)), true);

  // Entry paths must remain strictly relative and confined inside plugin root
  for (const rel of [manifest.entry.rendererScript, manifest.entry.mainHookScript]) {
    assert.equal(path.isAbsolute(rel), false);
    assert.equal(rel.includes('..'), false);
  }

  // Declared uiSlots must match SLOT_IDS exactly with exclusive: false & addon-owned-slot
  const declaredSlotIds = manifest.uiSlots.map((s) => s.slotId).sort();
  assert.deepEqual(declaredSlotIds, Object.values(SLOT_IDS).sort());
  for (const slot of manifest.uiSlots) {
    assert.equal(slot.exclusive, false);
    assert.equal(slot.scope, 'addon-owned-slot');
  }
  assert.deepEqual(manifest.isolation, {
    noTranslate: true,
    i18nSelfManaged: true,
    respectsNoTranslate: true,
    storageNamespace: 'antigravity-mcp-manager',
    ipcChannelPrefix: 'mcp-manager:',
  });
  assert.equal(manifest.loadOrder, 60);

  // 2. Zero direct app.asar patching/backup scripts or @electron/asar runtime dependencies
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'scripts', 'install-settings-menu.mjs')), false);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'settings-menu-injector.js')), false);
  assert.equal(pkg.dependencies?.['@electron/asar'], undefined, 'package.json must not depend on @electron/asar');

  const runtimeFiles = [
    ELECTRON_HOOK_PATH,
    RENDERER_OUTPUT_PATH,
    path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'desktop-server.mjs'),
    ...MODULE_ORDER.map((name) => path.join(RENDERER_SRC_DIR, name)),
  ];
  for (const filePath of runtimeFiles) {
    const codeOnly = fs
      .readFileSync(filePath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert.equal(/@electron\/asar|app\.asar/.test(codeOnly), false, `Forbidden app.asar reference in ${filePath}`);
  }

  // 3. Deterministic build parity & zero unsafe DOM sinks in modular renderer sources + assembled entry
  const expectedAssembled = assembleRendererSource();
  const actualAssembled = fs.readFileSync(RENDERER_OUTPUT_PATH, 'utf8');
  assert.equal(
    actualAssembled,
    expectedAssembled,
    'src/adapters/antigravity/addon-renderer.js is out of sync with renderer/*.mjs (run npm run build:renderer)'
  );

  const forbiddenSinks = [
    /\.innerHTML\s*=/,
    /\.outerHTML\s*=/,
    /insertAdjacentHTML\s*\(/,
    /document\.write\s*\(/,
    /\beval\s*\(/,
    /new\s+Function\s*\(/,
  ];
  for (const filePath of [RENDERER_OUTPUT_PATH, ...MODULE_ORDER.map((n) => path.join(RENDERER_SRC_DIR, n))]) {
    const src = fs.readFileSync(filePath, 'utf8');
    for (const rx of forbiddenSinks) {
      assert.equal(rx.test(src), false, `Forbidden DOM sink ${rx} in ${filePath}`);
    }
  }
});

test('NMCP-TC-024 (Unit): mainHook (electron-hook.cjs) honors AddonManifest.v1 lifecycle, Isolated World 999 direct URL delivery, TOCTOU URL re-check, and complete dispose()', async () => {
  const hookMod = require(ELECTRON_HOOK_PATH);
  assert.equal(typeof hookMod.activate, 'function');
  assert.equal(typeof hookMod.onWebContentsCreated, 'function');
  assert.equal(typeof hookMod.dispose, 'function');
  assert.equal(hookMod.DEFAULT_ISOLATED_WORLD_ID, 999);

  let startCount = 0;
  let closeCount = 0;
  let resolveDeferredStart = null;
  const fakeUrl = 'http://127.0.0.1:45678/?token=' + 'a'.repeat(64);

  const ctrl = hookMod.createMainHookController({
    startServer: () => {
      startCount += 1;
      if (startCount === 2) {
        return new Promise((resolve) => {
          resolveDeferredStart = () =>
            resolve({
              url: fakeUrl,
              close: () => {
                closeCount += 1;
                return Promise.resolve();
              },
            });
        });
      }
      return Promise.resolve({
        url: fakeUrl,
        close: () => {
          closeCount += 1;
          return Promise.resolve();
        },
      });
    },
  });

  const fakeApp = new EventEmitter();
  const makeFakeContents = (initialUrl, type = 'window') => {
    const wc = new EventEmitter();
    let liveUrl = initialUrl;
    let destroyed = false;
    const isolatedCalls = [];
    const mainWorldCalls = [];
    wc.getType = () => type;
    wc.getURL = () => liveUrl;
    wc.setURL = (u) => {
      liveUrl = u;
    };
    wc.isDestroyed = () => destroyed;
    wc.destroy = () => {
      destroyed = true;
      wc.emit('destroyed');
    };
    wc.executeJavaScriptInIsolatedWorld = (worldId, sources) => {
      isolatedCalls.push({ worldId, code: sources[0].code });
      return Promise.resolve();
    };
    wc.executeJavaScript = (code) => {
      mainWorldCalls.push(code);
      return Promise.resolve();
    };
    wc.isolatedCalls = isolatedCalls;
    wc.mainWorldCalls = mainWorldCalls;
    return wc;
  };

  const isAllowed = (u) => typeof u === 'string' && u.startsWith('http://127.0.0.1:');

  // 1. Activate + disallowed origin must NOT start server or inject anything
  ctrl.activate({ app: fakeApp, pluginId: 'antigravity-mcp-manager' });
  assert.equal(ctrl.isActive(), true);
  assert.equal(fakeApp.listenerCount('will-quit'), 1);

  const evilWc = makeFakeContents('https://evil.example/');
  ctrl.onWebContentsCreated({ app: fakeApp, contents: evilWc, isAllowedRendererUrl: isAllowed });
  evilWc.emit('dom-ready');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(startCount, 0, 'Disallowed renderer URL must not boot desktop server');
  assert.equal(evilWc.isolatedCalls.length, 0);
  assert.equal(evilWc.mainWorldCalls.length, 0);

  // 2. Non-window webContents (e.g. webview/backgroundPage) ignored
  const webviewWc = makeFakeContents('http://127.0.0.1:3000/', 'webview');
  ctrl.onWebContentsCreated({ app: fakeApp, contents: webviewWc, isAllowedRendererUrl: isAllowed });
  assert.equal(ctrl.getTrackedCount(), 1);

  // 3. Allowed window receives tokenized URL ONLY in Isolated World 999 (never World 0)
  const goodWc = makeFakeContents('http://127.0.0.1:3000/settings');
  ctrl.onWebContentsCreated({ app: fakeApp, contents: goodWc, isAllowedRendererUrl: isAllowed });
  goodWc.emit('dom-ready');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(startCount, 1);
  assert.equal(goodWc.isolatedCalls.length, 1);
  assert.equal(goodWc.isolatedCalls[0].worldId, 999);
  assert.equal(goodWc.isolatedCalls[0].code.includes(fakeUrl), true);
  assert.equal(goodWc.mainWorldCalls.length, 0, 'Tokenized URL must NEVER be pushed to World 0 when Isolated World is available');

  // 4. dispose() closes server, removes all listeners, and clears Isolated World 999 URL
  await ctrl.dispose();
  assert.equal(ctrl.isActive(), false);
  assert.equal(closeCount, 1);
  assert.equal(fakeApp.listenerCount('will-quit'), 0);
  assert.equal(ctrl.getTrackedCount(), 0);
  assert.equal(goodWc.listenerCount('dom-ready'), 0);
  assert.equal(goodWc.listenerCount('did-finish-load'), 0);
  assert.equal(goodWc.isolatedCalls.length, 2);
  assert.equal(goodWc.isolatedCalls[1].code.includes('var __u=null;'), true, 'dispose() must clear Isolated World URL');

  // 5. TOCTOU guard: if window navigates to disallowed URL while server boots, 0 injections happen
  ctrl.activate({ app: fakeApp, pluginId: 'antigravity-mcp-manager' });
  const toctouWc = makeFakeContents('http://127.0.0.1:3000/');
  ctrl.onWebContentsCreated({ app: fakeApp, contents: toctouWc, isAllowedRendererUrl: isAllowed });
  toctouWc.emit('dom-ready');
  await Promise.resolve();
  toctouWc.setURL('https://attacker.example/');
  assert.equal(typeof resolveDeferredStart, 'function');
  resolveDeferredStart();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(toctouWc.isolatedCalls.length, 0, 'TOCTOU navigation to untrusted origin must abort URL injection');
  await ctrl.dispose();
  assert.equal(closeCount, 2);
});

test('NMCP-TC-024B (Unit): host-runtime enforces loopback URL allowlist and 1-time storageNamespace language migration', () => {
  assert.equal(isSafeLoopbackIframeUrl('http://127.0.0.1:12345/?token=abc'), true);
  assert.equal(isSafeLoopbackIframeUrl('https://evil.example/?token=abc'), false);
  assert.equal(isSafeLoopbackIframeUrl('http://localhost:12345/?token=abc'), false);
  assert.equal(isSafeLoopbackIframeUrl('javascript:alert(1)'), false);

  const mem = new Map([['agy-mcp-manager-lang', 'ko']]);
  const fakeWin = {
    localStorage: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
    },
  };
  const fakeHost = {
    pluginId: 'antigravity-mcp-manager',
    storageNamespace: 'antigravity-mcp-manager',
    ipcChannelPrefix: 'mcp-manager:',
    mountSlot: () => ({}),
    unmountSlot: () => true,
    injectStyle: () => ({}),
    removeStyle: () => true,
    onDispose: () => {},
  };

  const rt = createHostRuntime({ addonHost: fakeHost, win: fakeWin, doc: {} });
  assert.equal(rt.langStorageKey, 'antigravity-mcp-manager:lang');
  assert.equal(rt.readSavedLang(), 'ko', 'Legacy v2.1 language key must migrate on first read');
  assert.equal(mem.get('antigravity-mcp-manager:lang'), 'ko', 'Migrated value must be persisted under storageNamespace');
  assert.equal(rt.writeSavedLang('en'), true);
  assert.equal(mem.get('antigravity-mcp-manager:lang'), 'en');
  assert.equal(rt.writeSavedLang('xx'), false);
});
