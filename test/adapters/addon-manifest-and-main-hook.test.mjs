import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MODULE_ORDER,
  RENDERER_OUTPUT_PATH,
  assembleRendererSource,
} from '../../scripts/build-renderer.mjs';
import {
  HOST_CONFIG_SCOPES,
} from '../../src/adapters/antigravity/renderer/host-config-store.mjs';
import {
  SLOT_IDS,
  assertAddonHostHandle,
  createHostRuntime,
  getSlotHostElement,
  isSafeLoopbackIframeUrl,
} from '../../src/adapters/antigravity/renderer/host-runtime.mjs';
import { startDesktopMcpServer } from '../../src/adapters/antigravity/desktop-server.mjs';
import {
  buildAddonHostHarnessScript,
  findChromiumBinary,
  launchCdpSession,
  waitUntil,
} from '../helpers/cdp-browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'addon-manifest.json');
const RENDERER_SRC_DIR = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'renderer');
const LEGACY_ELECTRON_HOOK_PATH = path.join(ROOT_DIR, 'scripts', 'electron-hook.cjs');

test('NMCP-TC-022 (Contract & SOLID Parity): addon-manifest.json satisfies AddonManifest.v2 (trusted, renderer-only, Named-Scope Config Bridge, Shadow DOM declarations), zero legacy mainHook/app.asar code exists, and addon-renderer.js matches modular SOLID sources with zero unsafe DOM sinks', () => {
  // 1. AddonManifest.v2 schema & contract checks
  assert.equal(fs.existsSync(MANIFEST_PATH), true, 'addon-manifest.json must exist at repository root');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const pluginJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'plugin.json'), 'utf8'));

  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.pluginId, 'antigravity-mcp-manager');
  assert.equal(manifest.version, pkg.version);
  assert.equal(pluginJson.version, pkg.version);
  assert.equal(manifest.trustLevel, 'trusted');
  assert.deepEqual(manifest.compatibility, { hostProfile: 'antigravity-desktop', minHostVersion: '2.3.0' });
  assert.deepEqual(manifest.capabilities, ['renderer']);
  assert.deepEqual(manifest.configBridge, {
    scopes: [
      { scopeId: HOST_CONFIG_SCOPES.GLOBAL_MCP, access: 'rw' },
      { scopeId: HOST_CONFIG_SCOPES.PLUGIN_MCP, access: 'ro' },
      { scopeId: HOST_CONFIG_SCOPES.LEGACY_MCP, access: 'ro' },
    ],
  });
  assert.equal(manifest.entry.rendererScript, 'src/adapters/antigravity/addon-renderer.js');
  assert.equal(manifest.entry.mainHookScript, undefined, 'Renderer-only AddonManifest.v2 plugin must not declare mainHookScript');
  assert.equal(fs.existsSync(path.join(ROOT_DIR, manifest.entry.rendererScript)), true);
  assert.equal(fs.existsSync(LEGACY_ELECTRON_HOOK_PATH), false, 'Legacy v1 scripts/electron-hook.cjs must be removed');
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'sidecars')), false, 'AUX_PANE sidecars/ directory must be removed');

  // Entry path must remain strictly relative and confined inside plugin root
  assert.equal(path.isAbsolute(manifest.entry.rendererScript), false);
  assert.equal(manifest.entry.rendererScript.includes('..'), false);

  // Declared uiSlots must match SLOT_IDS with exact Shadow DOM Option B2 contract
  const declaredSlotIds = manifest.uiSlots.map((s) => s.slotId).sort();
  assert.deepEqual(declaredSlotIds, Object.values(SLOT_IDS).sort());
  const slotsById = new Map(manifest.uiSlots.map((s) => [s.slotId, s]));
  for (const slot of manifest.uiSlots) {
    assert.equal(slot.exclusive, false);
    assert.equal(slot.scope, 'addon-owned-slot');
  }
  assert.equal(slotsById.get(SLOT_IDS.SETTINGS_NAV).shadow, false, 'settings-nav must declare shadow: false for Light DOM Tailwind inheritance');
  assert.equal(slotsById.get(SLOT_IDS.SETTINGS_PANE).shadow, true);
  assert.equal(slotsById.get(SLOT_IDS.CUSTOMIZATIONS_BTN).shadow, true);
  assert.equal(slotsById.get(SLOT_IDS.CUSTOMIZATIONS_OVERLAY).shadow, true);

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

test('NMCP-TC-024 (Unit): host-runtime enforces AddonManifest.v2 handle contract (mountSlot({container}), openModal, getSlotHostElement, addManagedListener, loopback allowlist, and 1-time storageNamespace language migration)', () => {
  // 1. Strict handle validation (must include openModal in v2)
  assert.throws(() => assertAddonHostHandle(null), /ERR_MISSING_ADDON_HOST_HANDLE/);
  assert.throws(
    () =>
      assertAddonHostHandle({
        mountSlot: () => {},
        unmountSlot: () => {},
        injectStyle: () => {},
        removeStyle: () => {},
        onDispose: () => {},
      }),
    /ERR_INVALID_ADDON_HOST_HANDLE:openModal/
  );

  // 2. Loopback URL allowlist
  assert.equal(isSafeLoopbackIframeUrl('http://127.0.0.1:12345/?token=abc'), true);
  assert.equal(isSafeLoopbackIframeUrl('https://evil.example/?token=abc'), false);
  assert.equal(isSafeLoopbackIframeUrl('http://localhost:12345/?token=abc'), false);
  assert.equal(isSafeLoopbackIframeUrl('javascript:alert(1)'), false);

  // 3. v2 handle omits storageNamespace/ipcChannelPrefix -> falls back cleanly to pluginId / 'mcp-manager:'
  const mem = new Map([['agy-mcp-manager-lang', 'ko']]);
  const fakeWin = {
    localStorage: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
    },
  };
  const mountCalls = [];
  const styleCalls = [];
  const modalCalls = [];
  const disposers = [];
  const fakeHost = {
    pluginId: 'antigravity-mcp-manager',
    version: '3.0.0',
    trustLevel: 'restricted',
    schemaVersion: 2,
    mountSlot: (slotId, opts) => {
      mountCalls.push({ slotId, opts });
      return { getRootNode: () => ({ host: { id: 'shadow-host' } }) };
    },
    unmountSlot: () => true,
    injectStyle: (styleId, cssText, opts) => {
      styleCalls.push({ styleId, cssText, opts });
      return {};
    },
    removeStyle: () => true,
    openModal: (slotId, opts) => {
      modalCalls.push({ slotId, opts });
      return { id: 'modal-1', element: {}, bodyEl: {}, close: () => {} };
    },
    onDispose: (fn) => disposers.push(fn),
  };

  const rt = createHostRuntime({ addonHost: fakeHost, win: fakeWin, doc: {} });
  assert.equal(rt.schemaVersion, 2);
  assert.equal(rt.trustLevel, 'restricted');
  assert.equal(rt.storageNamespace, 'antigravity-mcp-manager');
  assert.equal(rt.ipcChannelPrefix, 'mcp-manager:');
  assert.equal(rt.langStorageKey, 'antigravity-mcp-manager:lang');
  assert.equal(rt.readSavedLang(), 'ko', 'Legacy v2.1 language key must migrate on first read');
  assert.equal(mem.get('antigravity-mcp-manager:lang'), 'ko', 'Migrated value must be persisted under storageNamespace');
  assert.equal(rt.writeSavedLang('en'), true);
  assert.equal(mem.get('antigravity-mcp-manager:lang'), 'en');
  assert.equal(rt.writeSavedLang('xx'), false);

  // 4. mountSlot normalizes raw DOM Element -> { container } and forwards options object verbatim
  const fakeEl = { nodeType: 1, id: 'container-1' };
  const rootEl = rt.mountSlot(SLOT_IDS.SETTINGS_PANE, fakeEl);
  assert.deepEqual(mountCalls[0], { slotId: SLOT_IDS.SETTINGS_PANE, opts: { container: fakeEl } });
  assert.deepEqual(getSlotHostElement(rootEl), { id: 'shadow-host' });
  assert.equal(getSlotHostElement(fakeEl), fakeEl);

  rt.injectStyle('s1', ':host { display: block; }', { slotId: SLOT_IDS.SETTINGS_PANE });
  assert.deepEqual(styleCalls[0].opts, { slotId: SLOT_IDS.SETTINGS_PANE });

  rt.openModal(SLOT_IDS.CUSTOMIZATIONS_OVERLAY, { shadow: true });
  assert.deepEqual(modalCalls[0], { slotId: SLOT_IDS.CUSTOMIZATIONS_OVERLAY, opts: { shadow: true } });

  // 5. addManagedListener fallback removes listener on onDispose()
  const removed = [];
  const fakeTarget = {
    addEventListener: () => {},
    removeEventListener: (type, fn) => removed.push({ type, fn }),
  };
  const listener = () => {};
  rt.addManagedListener(fakeTarget, 'keydown', listener);
  assert.equal(disposers.length, 1);
  disposers[0]();
  assert.equal(removed.length, 1);
  assert.equal(removed[0].type, 'keydown');
});

test('NMCP-TC-028 (Option A Restricted Mode & Late SidecarBridge Upgrade CDP E2E): without loopback URL, renderer mounts Settings & Customizations immediately with EN/KO Native Sidecar launcher in Shadow DOM, then upgrades live when a loopback URL arrives', async (t) => {
  const browserBin = findChromiumBinary();
  if (!browserBin || typeof WebSocket !== 'function') {
    t.skip('Headless Chromium/Edge binary or global WebSocket is unavailable on this host');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-v2-opt-a-'));
  const profileDir = path.join(tmpDir, 'profile');
  const cfgDir = path.join(tmpDir, '.gemini', 'config');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, 'mcp_config.json'),
    JSON.stringify({ mcpServers: { bridgeSrv: { url: 'https://bridge.example/mcp' } } }, null, 2) + '\n',
    'utf8'
  );

  const desktopSrv = await startDesktopMcpServer({ homeDir: tmpDir });
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const hostHarness = buildAddonHostHarnessScript(manifest);
  const rendererSrc = fs.readFileSync(RENDERER_OUTPUT_PATH, 'utf8');

  const parentServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body style="margin:0;height:100vh;background:#111;color:#eee;font-family:sans-serif;display:flex;flex-direction:column;">
      <div id="settings-root" style="display:flex;flex:1;">
        <aside id="settings-sidebar" style="width:220px;display:flex;flex-direction:column;gap:4px;">
          <nav>
            <button id="nav-general">General</button>
            <button id="nav-application">Application</button>
            <button id="nav-appearance">Appearance</button>
            <button id="nav-shortcuts">Shortcuts</button>
            <button id="nav-notifications">Notifications</button>
            <button id="nav-models">Models</button>
            <button id="nav-browser">Browser</button>
          </nav>
        </aside>
        <main id="settings-content" style="flex:1;min-width:360px;min-height:300px;display:flex;flex-direction:column;">
          <div id="native-general-pane">Native General</div>
        </main>
      </div>
      <section id="customizations-page" style="padding:12px;">
        <h1>Customizations</h1>
        <div id="mcp-header-row" style="display:flex;align-items:center;justify-content:space-between;">
          <span>MCP Servers</span>
          <div id="mcp-header-actions" style="display:flex;align-items:center;gap:6px;">
            <button type="button" id="btn-raw-config">[]</button>
          </div>
        </div>
      </section>
      <script>${hostHarness}</script>
      <script>(function(addonHost){ ${rendererSrc} })(window.__TEST_ADDON_HOST__);</script>
    </body></html>`);
  });
  await new Promise((r) => parentServer.listen(0, '127.0.0.1', r));
  const parentPort = parentServer.address().port;

  const session = await launchCdpSession({
    browserBin,
    profileDir,
    iframeOrigin: `http://127.0.0.1:${desktopSrv.port}`,
  });

  try {
    const { cdp, evalMain, evalIframe, hasIframe } = session;
    await cdp('Page.navigate', { url: `http://localhost:${parentPort}/` });

    // 1. Both Settings nav (Light DOM) and Customizations button (Shadow DOM) mount WITHOUT any loopback URL
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(document.querySelector('[data-agy-mcp-manager-nav="true"]'))`), 4000, 30),
      true,
      'Settings nav must mount immediately in restricted Option A mode with no loopback URL'
    );
    assert.equal(
      await waitUntil(
        () =>
          evalMain(`(() => {
            const host = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]');
            return Boolean(host && host.shadowRoot && host.shadowRoot.querySelector('[data-agy-mcp-customizations-btn="true"]'));
          })()`),
        4000,
        30
      ),
      true,
      'Customizations button must mount inside Shadow DOM immediately with no loopback URL'
    );

    // 2. Click Settings MCP Manager -> Shadow DOM pane renders EN Native Sidecar launcher & zero head style for pane
    await evalMain(`document.querySelector('[data-agy-mcp-manager-nav="true"]').click()`);
    const enLauncher = await evalMain(`(() => {
      const host = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]');
      const sr = host?.shadowRoot;
      const launcher = sr?.querySelector('[data-agy-mcp-sidecar-launcher="true"]');
      const shadowStyle = sr?.querySelector('style[data-addon-host-style="antigravity-mcp-manager:mcp-manager-pane"]');
      const headPaneStyle = document.head.querySelector('style[data-addon-host-style="antigravity-mcp-manager:mcp-manager-pane"]');
      return {
        hasShadow: Boolean(sr),
        hasLauncher: Boolean(launcher),
        title: sr?.querySelector('[data-agy-mcp-launcher-title="true"]')?.textContent?.trim(),
        status: sr?.querySelector('[data-agy-mcp-launcher-status="true"]')?.textContent?.trim(),
        hasShadowStyle: Boolean(shadowStyle),
        hasHeadPaneStyle: Boolean(headPaneStyle),
      };
    })()`);
    assert.equal(enLauncher.hasShadow, true);
    assert.equal(enLauncher.hasLauncher, true);
    assert.equal(enLauncher.title, 'MCP Manager');
    assert.equal(enLauncher.status, 'Awaiting Host Config Bridge');
    assert.equal(enLauncher.hasShadowStyle, true);
    assert.equal(enLauncher.hasHeadPaneStyle, false, 'Targeted ShadowRoot style must clean up document.head fallback');

    // 3. Switch language to Korean inside Shadow DOM launcher -> syncs Customizations button & localStorage
    await evalMain(`(() => {
      const sr = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot;
      sr.querySelector('[data-agy-mcp-lang-btn="ko"]').click();
    })()`);
    const koSync = await evalMain(`(() => {
      const paneSr = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot;
      const btnSr = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]').shadowRoot;
      return {
        paneTitle: paneSr.querySelector('[data-agy-mcp-launcher-title="true"]')?.textContent?.trim(),
        paneStatus: paneSr.querySelector('[data-agy-mcp-launcher-status="true"]')?.textContent?.trim(),
        btnText: btnSr.querySelector('[data-agy-mcp-customizations-btn="true"]')?.textContent?.trim(),
        savedLang: window.localStorage.getItem('antigravity-mcp-manager:lang'),
      };
    })()`);
    assert.equal(koSync.paneTitle, 'MCP 매니저');
    assert.equal(koSync.paneStatus, '호스트 설정 브리지 대기 중');
    assert.equal(koSync.btnText, 'MCP 매니저');
    assert.equal(koSync.savedLang, 'ko');

    // 4. OCP Late SidecarBridge URL delivery upgrades active launcher to live iframe automatically
    await evalMain(`(() => {
      const u = ${JSON.stringify(desktopSrv.url)};
      window.__AGY_MCP_MANAGER_URL__ = u;
      if (typeof window.__AGY_MCP_ON_SERVER_URL__ === 'function') window.__AGY_MCP_ON_SERVER_URL__(u);
    })()`);
    assert.equal(await waitUntil(hasIframe, 8000, 40), true, 'Late loopback URL must upgrade launcher to live iframe');
    assert.equal(
      await waitUntil(async () => {
        try {
          return await evalIframe(`Boolean(document.querySelector('[data-testid="global-server-bridgeSrv"]'))`);
        } catch {
          return false;
        }
      }, 8000, 40),
      true,
      'Upgraded live iframe must render global-server-bridgeSrv'
    );

    // 5. dispose() cleans everything cleanly
    await evalMain(`window.__TEST_ADDON_HOST__.dispose()`);
    assert.equal(await evalMain(`document.querySelectorAll('[data-addon-host-owner="antigravity-mcp-manager"]').length`), 0);
    assert.equal(await evalMain(`document.getElementById('native-general-pane').style.display`), '');
  } finally {
    await session.close();
    await desktopSrv.close();
    await new Promise((r) => parentServer.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  }
});
