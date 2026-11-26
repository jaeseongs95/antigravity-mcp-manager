import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_HOST_LIB_URL,
  DEFAULT_NAMESPACE,
  DEFAULT_UPDATE_BASE_URL,
  REMOTE_WEB_PROFILE,
  buildUserscriptArtifacts,
  normalizeHostLibUrl,
  verifyUserscriptSafety,
} from '../../scripts/build-userscript.mjs';
import { RENDERER_OUTPUT_PATH } from '../../scripts/build-renderer.mjs';
import { createHostRuntime } from '../../src/adapters/antigravity/renderer/host-runtime.mjs';
import {
  STORAGE_DRAFT_DISPLAY_PATH,
  STORAGE_DRAFT_KEY,
  STORAGE_DRAFT_MAX_BYTES,
  createStorageDraftConfigStore,
} from '../../src/adapters/antigravity/renderer/storage-draft-config-store.mjs';
import { V3_IDS } from '../../src/adapters/antigravity/renderer/mcp-v3-shell.mjs';
import { McpManagerService } from '../../src/core/manager-service.mjs';
import { ERROR_CODES } from '../../src/core/model.mjs';
import {
  buildAddonContextV3HarnessScript,
  findChromiumBinary,
  launchCdpSession,
  waitUntil,
} from '../helpers/cdp-browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'addon-manifest.json');

test('NMCP-TC-034 (Unit): StorageDraftConfigStore & host-runtime route Remote Web (hasConfigBridge: false) cleanly to ctx.storage with UTF-8 SHA-256 CAS, conflict guards, and byte budget checks', async () => {
  const kv = new Map();
  const storage = {
    get: async (k) => (kv.has(k) ? structuredClone(kv.get(k)) : undefined),
    set: async (k, v) => {
      kv.set(k, structuredClone(v));
      return true;
    },
    onDidChange: () => () => {},
  };

  const mockRemoteCtx = Object.freeze({
    apiVersion: 3,
    meta: { pluginId: 'antigravity-mcp-manager', displayName: 'Antigravity MCP Manager', version: '4.0.0', trustLevel: 'restricted', sourceSchemaVersion: 3 },
    env: {
      surface: 'remote-web',
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
      showToast: () => ({ id: 't', dismiss() {} }),
      confirm: async () => true,
      prompt: async () => null,
      registerCommand: () => ({ unregister() {}, dispose() {} }),
      registerStatusItem: () => ({ id: 's', update() {}, dispose() {} }),
      registerSettingsPage: () => ({ id: 'p', open() {}, update() {}, dispose() {} }),
      openPanel: () => ({}),
      openModal: () => ({}),
      openPopup: () => ({}),
    },
    storage,
    lifecycle: { signal: new AbortController().signal, onDispose: () => {}, addManagedListener: () => () => {}, runSafe: (fn) => fn() },
  });

  const rt = createHostRuntime({ ctx: mockRemoteCtx, doc: null });
  assert.equal(rt.getSurface(), 'remote-web');
  assert.equal(rt.hasConfigBridge(), false);
  assert.equal(rt.getConfigStoreMode(), 'remote-draft');

  const service = rt.createConfigService();
  assert.ok(service instanceof McpManagerService);

  // 1. Initial empty draft
  const initSnap = await service.getSnapshot({ includeRawText: true });
  assert.equal(initSnap.ok, true);
  assert.equal(initSnap.globalConfig.exists, false);
  assert.equal(initSnap.globalConfig.sha256, null);
  assert.equal(initSnap.globalConfig.displayPath, STORAGE_DRAFT_DISPLAY_PATH);

  // 2. Create server -> persists into ctx.storage under STORAGE_DRAFT_KEY
  const addRes = await service.upsertServer({
    name: 'remote-http',
    spec: { url: 'https://remote.example/mcp' },
    expectedSha256: null,
  });
  assert.equal(addRes.ok, true);
  assert.ok(addRes.sha256);
  assert.ok(kv.has(STORAGE_DRAFT_KEY));

  const afterSnap = await service.getSnapshot({ includeRawText: true });
  assert.equal(afterSnap.globalConfig.exists, true);
  assert.equal(afterSnap.globalConfig.servers.length, 1);
  assert.equal(afterSnap.globalConfig.servers[0].name, 'remote-http');

  // 3. Stale CAS conflict rejection
  const store = createStorageDraftConfigStore(storage);
  const conflictRes = await store.writeGlobalConfig({
    rawText: '{"mcpServers":{}}\n',
    expectedSha256: 'stale-sha',
  });
  assert.equal(conflictRes.ok, false);
  assert.equal(conflictRes.code, ERROR_CODES.CONFLICT);
  assert.equal(conflictRes.actualSha256, afterSnap.globalConfig.sha256);

  // 4. Oversized payload rejection
  const bigRes = await store.writeGlobalConfig({
    rawText: 'x'.repeat(STORAGE_DRAFT_MAX_BYTES + 10),
    expectedSha256: afterSnap.globalConfig.sha256,
  });
  assert.equal(bigRes.ok, false);
  assert.equal(bigRes.code, ERROR_CODES.VALIDATION_ERROR);
});

test('NMCP-TC-035 (Unit): build-userscript.mjs produces deterministic AddonManifest.v3 @require Userscript with sanitized Remote Web permissions (configBridge stripped, trustLevel restricted, zero unsafe sinks)', () => {
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-us-v3-a-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-us-v3-b-'));
  try {
    const resA = buildUserscriptArtifacts({ outDir: tmpA });
    const resB = buildUserscriptArtifacts({ outDir: tmpB });
    assert.equal(resA.ok, true);
    assert.equal(resA.buildManifest.buildSha256, resB.buildManifest.buildSha256);
    assert.equal(resA.buildManifest.mode, 'modular-addon-userscript');
    assert.equal(resA.buildManifest.profileId, REMOTE_WEB_PROFILE.id);

    const userJs = fs.readFileSync(resA.userscriptPath, 'utf8');
    const metaJs = fs.readFileSync(resA.metaPath, 'utf8');

    assert.equal(verifyUserscriptSafety(userJs).ok, true);
    assert.equal(DEFAULT_NAMESPACE, 'https://github.com/jaeseongs95/extenra');
    assert.equal(
      DEFAULT_HOST_LIB_URL,
      'https://github.com/jaeseongs95/extenra/releases/latest/download/antigravity-remote-host.lib.js'
    );
    assert.ok(metaJs.includes(`// @namespace    ${DEFAULT_NAMESPACE}`));
    assert.ok(metaJs.includes('// @match        https://antigravity.google.com/*'));
    assert.ok(metaJs.includes('// @inject-into  content'));
    assert.ok(metaJs.includes(`// @require      ${DEFAULT_HOST_LIB_URL}`));
    assert.ok(metaJs.includes('// @grant        GM_getValue'));
    assert.ok(metaJs.includes('// @grant        GM_setValue'));
    assert.ok(metaJs.includes('// @grant        GM_deleteValue'));
    assert.ok(metaJs.includes(`// @updateURL    ${DEFAULT_UPDATE_BASE_URL}/antigravity-mcp-manager.meta.js`));
    assert.ok(metaJs.includes(`// @downloadURL  ${DEFAULT_UPDATE_BASE_URL}/antigravity-mcp-manager.user.js`));

    // Extenra v3.2.x optional SRI pinning (#sha256=<64hex>) & mismatch guard
    const sampleSha = 'a'.repeat(64);
    assert.equal(
      normalizeHostLibUrl(DEFAULT_HOST_LIB_URL, { hostLibSha256: sampleSha }),
      `${DEFAULT_HOST_LIB_URL}#sha256=${sampleSha}`
    );
    assert.throws(
      () => normalizeHostLibUrl(`${DEFAULT_HOST_LIB_URL}#sha256=${'b'.repeat(64)}`, { hostLibSha256: sampleSha }),
      /ERR_HOST_LIB_SHA256_MISMATCH/
    );
    assert.throws(
      () => normalizeHostLibUrl(`${DEFAULT_HOST_LIB_URL}#not-sri`),
      /ERR_HOST_LIB_URL_UNSAFE/
    );

    const registered = [];
    let bootCount = 0;
    const sandbox = { console, Promise, globalThis: null };
    sandbox.globalThis = sandbox;
    sandbox.__addonHostRemoteRuntime = {
      registerAddon(desc) {
        registered.push(desc);
        return { ok: true };
      },
      bootRemoteWebHost() {
        bootCount += 1;
        return Promise.resolve({ ok: true });
      },
    };
    vm.runInNewContext(userJs, sandbox);

    assert.equal(registered.length, 1);
    assert.equal(bootCount, 1);
    assert.equal(registered[0].pluginMeta.schemaVersion, 3);
    assert.equal(registered[0].pluginMeta.apiVersion, 3);
    assert.equal(registered[0].pluginMeta.trustLevel, 'restricted');
    assert.equal(registered[0].pluginMeta.hasConfigBridge, false);
    assert.equal(registered[0].pluginMeta.hasSettingsBridge, false);
    assert.equal(registered[0].pluginMeta.permissions.configBridge, undefined, 'Desktop-only configBridge must be stripped from Remote Web Userscript');
    assert.equal(registered[0].pluginMeta.permissions.net, undefined);
    assert.equal(registered[0].pluginMeta.permissions.dom, undefined);
    assert.equal(registered[0].pluginMeta.permissions.storage.maxBytes, 262144);
    assert.equal(typeof registered[0].run, 'function');
  } finally {
    fs.rmSync(tmpA, { recursive: true, force: true });
    fs.rmSync(tmpB, { recursive: true, force: true });
  }
});

test('NMCP-TC-036 (Real Chromium CDP E2E): Remote Web AddonContextV3 opens unified Settings Page in remote-draft mode, persists CRUD via ctx.storage, supports Copy/Download JSON & Stdio-gated File Import, and cleans up on dispose()', async (t) => {
  const browserBin = findChromiumBinary();
  if (!browserBin || typeof WebSocket !== 'function') {
    t.skip('Headless Chromium/Edge binary or global WebSocket is unavailable on this host');
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const rendererSrc = fs.readFileSync(RENDERER_OUTPUT_PATH, 'utf8');
  const hostHarness = buildAddonContextV3HarnessScript(manifest, { surface: 'remote-web', locale: 'en-US' });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-remote-v3-cdp-'));
  const profileDir = path.join(tmpDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const parentServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body style="margin:0;height:100vh;background:#0f131a;color:#e6edf3;font-family:sans-serif;">
      <script>
        (function() {
          const downloads = [];
          let copiedText = null;
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
              writeText: (txt) => {
                copiedText = String(txt);
                return Promise.resolve();
              },
            },
          });
          const origClick = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function() {
            if (this.hasAttribute('download')) {
              downloads.push({ download: this.getAttribute('download'), href: this.getAttribute('href') });
              return;
            }
            return origClick.apply(this, arguments);
          };
          window.__REMOTE_IO_DIAG__ = {
            getCopiedText: () => copiedText,
            getDownloads: () => downloads.slice(),
          };
        })();
      </script>
      <script>${hostHarness}</script>
      <script>(function(addonHost){ ${rendererSrc} })(window.__TEST_ADDON_CTX_V3__);</script>
    </body></html>`);
  });
  await new Promise((r) => parentServer.listen(0, '127.0.0.1', r));
  const parentPort = parentServer.address().port;

  const session = await launchCdpSession({ browserBin, profileDir });
  try {
    const { cdp, evalMain, exceptions } = session;
    await cdp('Page.navigate', { url: `http://localhost:${parentPort}/` });
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(window.__TEST_V3_DIAG__ && window.__TEST_V3_DIAG__.getSettingsPages().length > 0)`), 8000, 30),
      true
    );

    // 1. Verify Remote Web AddonContextV3 omits configBridge/net/dom and registers Status Item
    const ctxCheck = await evalMain(`({
      surface: window.__TEST_ADDON_CTX_V3__.env.surface,
      hasConfigBridge: window.__TEST_ADDON_CTX_V3__.env.capabilities.hasConfigBridge,
      configBridgeUndef: window.__TEST_ADDON_CTX_V3__.configBridge === undefined,
      netUndef: window.__TEST_ADDON_CTX_V3__.net === undefined,
      domUndef: window.__TEST_ADDON_CTX_V3__.dom === undefined,
      statusItems: window.__TEST_V3_DIAG__.getStatusItems().map((s) => ({ id: s.id, align: s.align })),
    })`);
    assert.deepEqual(ctxCheck, {
      surface: 'remote-web',
      hasConfigBridge: false,
      configBridgeUndef: true,
      netUndef: true,
      domUndef: true,
      statusItems: [{ id: V3_IDS.STATUS_ITEM, align: 'right' }],
    });

    // 1b. Clicking Remote Web Status Item opens Tier-2 declarative Quick Panel
    await evalMain(`window.__TEST_V3_DIAG__.clickStatusItem(${JSON.stringify(V3_IDS.STATUS_ITEM)})`);
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(document.querySelector('[data-addon-host-v3-overlay="panel"]'))`)),
      true,
      'Remote Web status item click must open Tier-2 Quick Panel'
    );
    await evalMain(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    assert.equal(await evalMain(`document.querySelectorAll('[data-addon-host-v3-overlay="panel"]').length`), 0);

    // 2. Open unified Settings Page -> mounts NativeMcpPanel in remote-draft mode with remote-io-bar
    await evalMain(`window.__TEST_V3_DIAG__.openSettingsPage(${JSON.stringify(V3_IDS.SETTINGS_PAGE)})`);
    assert.equal(
      await waitUntil(() =>
        evalMain(`(() => {
          const dlg = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]');
          const sr = dlg?.firstElementChild?.shadowRoot;
          const panel = sr?.querySelector('[data-agy-mcp-native-panel="true"]');
          return Boolean(dlg?.open && panel?.getAttribute('data-agy-mcp-mode') === 'remote-draft' && sr?.querySelector('[data-testid="remote-io-bar"]'));
        })()`)
      ),
      true
    );

    // 3. Add HTTP server -> persists in ctx.storage
    await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot;
      sr.querySelector('[data-testid="btn-add-server"]').click();
      const nameInput = sr.querySelector('[data-testid="input-server-name"]');
      const urlInput = sr.querySelector('[data-testid="input-http-url"]');
      nameInput.value = 'web-draft-srv';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      urlInput.value = 'https://draft.example/mcp';
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      sr.querySelector('[data-testid="btn-save-server"]').click();
    })()`);
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="global-server-web-draft-srv"]'))`)),
      true
    );
    const draftStored = await evalMain(`window.__TEST_V3_DIAG__.getStorageSnapshot()[${JSON.stringify(STORAGE_DRAFT_KEY)}]`);
    assert.ok(draftStored?.rawText?.includes('web-draft-srv'));

    // 4. Copy JSON & Download JSON (also emit Tier-1 Toasts)
    await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot;
      sr.querySelector('[data-testid="btn-copy-json"]').click();
      sr.querySelector('[data-testid="btn-download-json"]').click();
    })()`);
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(window.__REMOTE_IO_DIAG__.getCopiedText() && window.__REMOTE_IO_DIAG__.getDownloads().length === 1)`)),
      true
    );
    assert.equal(await evalMain(`window.__TEST_V3_DIAG__.getToasts().length >= 2`), true);

    // 5. Import JSON file containing Stdio server -> triggers Stdio confirmation gate -> confirm
    await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot;
      const input = sr.querySelector('[data-testid="input-import-json-file"]');
      const dt = new DataTransfer();
      const json = JSON.stringify({ mcpServers: { importedStdio: { command: 'npx', args: ['-y', '@demo/mcp'] } } }, null, 2);
      dt.items.add(new File([json], 'mcp_config.json', { type: 'application/json' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="stdio-confirm-panel"]'))`)),
      true
    );
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-confirm-stdio"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="global-server-importedStdio"]'))`)),
      true
    );

    // 6. Clean disposal
    await evalMain(`window.__TEST_V3_DIAG__.dispose()`);
    assert.equal(await evalMain(`document.querySelectorAll('[data-addon-host-owner="antigravity-mcp-manager"]').length`), 0);
    assert.equal(exceptions.length, 0);
  } finally {
    await session.close();
    await new Promise((r) => parentServer.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  }
});
