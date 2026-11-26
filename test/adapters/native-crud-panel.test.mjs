import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RENDERER_OUTPUT_PATH } from '../../scripts/build-renderer.mjs';
import {
  HOST_CONFIG_SCOPES,
  createHostBridgeConfigStore,
  resolveHostConfigBridge,
} from '../../src/adapters/antigravity/renderer/host-config-store.mjs';
import { V3_IDS } from '../../src/adapters/antigravity/renderer/mcp-v3-shell.mjs';
import { McpManagerService } from '../../src/core/manager-service.mjs';
import { ERROR_CODES } from '../../src/core/model.mjs';
import { sha256Hex } from '../../src/core/sha256.mjs';
import {
  buildAddonContextV3HarnessScript,
  findChromiumBinary,
  launchCdpSession,
  waitUntil,
} from '../helpers/cdp-browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'addon-manifest.json');

test('NMCP-TC-031 (Unit): HostBridgeConfigStore + McpManagerService adapt AddonContextV3 ctx.configBridge (status:ok rawText:null + data + on-disk CRLF sha256 CAS, plugin-files global/workspace, legacy, corrupt recovery, lock/jail error mapping)', async () => {
  // 1. Scope ID constants match locked v3 contract
  assert.equal(HOST_CONFIG_SCOPES.GLOBAL_MCP, 'antigravity:mcp-config');
  assert.equal(HOST_CONFIG_SCOPES.PLUGIN_MCP, 'antigravity:plugin-mcp-configs');
  assert.equal(HOST_CONFIG_SCOPES.LEGACY_MCP, 'antigravity:mcp-config-legacy');

  // 2. Reject missing or ro-only global scope declaration
  assert.equal(resolveHostConfigBridge({ env: { capabilities: { hasConfigBridge: false } } }), null);
  assert.equal(
    resolveHostConfigBridge({
      env: { capabilities: { hasConfigBridge: true } },
      configBridge: {
        scopes: Object.freeze([{ scopeId: 'antigravity:mcp-config', access: 'ro', maxBytes: 262144 }]),
        read: async () => ({}),
        write: async () => ({}),
      },
    }),
    null
  );

  // 3. Real AddonContextV3 ctx.configBridge contract:
  //    status === 'ok' returns rawText: null, data: parsedObj, sha256: sha256(actualDiskBytes)
  //    status === 'corrupt' returns rawText: rawDiskText, data: null, sha256: sha256(actualDiskBytes)
  let globalMode = 'missing';
  let storedRaw = '';
  let storedSha = null;
  let forceWriteReason = null;
  const legacyRaw = '{\r\n    "mcpServers": {\r\n        "oldSrv": { "url": "https://legacy.example/mcp" }\r\n    }\r\n}';
  const bridgeCalls = [];

  const mockCtxV3 = Object.freeze({
    apiVersion: 3,
    env: Object.freeze({
      surface: 'desktop',
      layoutMode: 'desktop',
      capabilities: Object.freeze({
        hasLocalLoopback: false,
        hasNetHttps: false,
        hasConfigBridge: true,
        hasSettingsBridge: false,
        hasDocumentTransform: false,
      }),
    }),
    configBridge: Object.freeze({
      scopes: Object.freeze([
        Object.freeze({ scopeId: 'antigravity:mcp-config', access: 'rw', maxBytes: 262144 }),
        Object.freeze({ scopeId: 'antigravity:plugin-mcp-configs', access: 'ro', maxBytes: 262144 }),
        Object.freeze({ scopeId: 'antigravity:mcp-config-legacy', access: 'ro', maxBytes: 262144 }),
      ]),
      async read(scopeId) {
        bridgeCalls.push(['read', scopeId]);
        if (scopeId === HOST_CONFIG_SCOPES.GLOBAL_MCP) {
          if (globalMode === 'missing') {
            return Object.freeze({ ok: true, scopeId, kind: 'file', status: 'missing', data: null, rawText: null, sha256: null, reason: null });
          }
          if (globalMode === 'corrupt') {
            return Object.freeze({ ok: true, scopeId, kind: 'file', status: 'corrupt', data: null, rawText: storedRaw, sha256: storedSha, reason: 'ERR_CONFIG_INVALID_JSON' });
          }
          return Object.freeze({ ok: true, scopeId, kind: 'file', status: 'ok', data: JSON.parse(storedRaw), rawText: null, sha256: storedSha, reason: null });
        }
        if (scopeId === HOST_CONFIG_SCOPES.PLUGIN_MCP) {
          return Object.freeze({
            ok: true,
            scopeId,
            kind: 'plugin-files',
            status: 'ok',
            items: Object.freeze([
              Object.freeze({ pluginId: 'sennard', status: 'ok', data: { mcpServers: { sennard: { url: 'https://sennard.example/mcp' } } }, rawText: null, sha256: 'abc', reason: null }),
              Object.freeze({ pluginId: 'workspace:local-demo', status: 'ok', data: { mcpServers: { wsTool: { url: 'https://ws-tool.example/mcp' } } }, rawText: null, sha256: 'ws1', reason: null }),
              Object.freeze({ pluginId: 'broken-plugin', status: 'corrupt', data: null, rawText: '{bad', sha256: 'def', reason: 'ERR_CONFIG_INVALID_JSON' }),
            ]),
            truncated: false,
            reason: null,
          });
        }
        if (scopeId === HOST_CONFIG_SCOPES.LEGACY_MCP) {
          return Object.freeze({ ok: true, scopeId, kind: 'file', status: 'ok', data: JSON.parse(legacyRaw), rawText: null, sha256: await sha256Hex(legacyRaw), reason: null });
        }
        throw new Error(`ERR_CONFIG_SCOPE_NOT_DECLARED:${scopeId}`);
      },
      async write(scopeId, nextDataOrRawJson, opts = {}) {
        bridgeCalls.push(['write', scopeId, opts?.expectedSha256 ?? null]);
        if (forceWriteReason) {
          const reason = forceWriteReason;
          forceWriteReason = null;
          return Object.freeze({ ok: false, reason, currentSha256: storedSha, snapshot: null });
        }
        if ((opts?.expectedSha256 ?? null) !== storedSha) {
          return Object.freeze({ ok: false, reason: 'ERR_CONFIG_CAS_CONFLICT', currentSha256: storedSha, snapshot: null });
        }
        storedRaw = typeof nextDataOrRawJson === 'string' ? nextDataOrRawJson : `${JSON.stringify(nextDataOrRawJson, null, 2)}\n`;
        storedSha = await sha256Hex(storedRaw);
        globalMode = 'ok';
        return Object.freeze({ ok: true, reason: null, backupFileName: 'mcp_config.20261126.bak.json', currentSha256: storedSha, snapshot: null });
      },
    }),
  });

  const store = createHostBridgeConfigStore(mockCtxV3);
  const service = new McpManagerService({ configStore: store });

  // 3a. Initial missing file + plugin-files + legacy
  const initSnap = await service.getSnapshot({ includeRawText: true });
  assert.equal(initSnap.ok, true);
  assert.equal(initSnap.globalConfig.exists, false);
  assert.equal(initSnap.globalConfig.sha256, null);
  assert.equal(initSnap.pluginServers.length, 2);
  assert.equal(initSnap.pluginServers.find((p) => p.pluginId === 'global:sennard')?.displayPath, '~/.gemini/config/plugins/sennard/mcp_config.json');
  assert.equal(initSnap.pluginServers.find((p) => p.pluginId === 'workspace:local-demo')?.displayPath, '<workspace>/.agents/plugins/local-demo/mcp_config.json');
  assert.equal(initSnap.legacyImport.exists, true);
  assert.equal(initSnap.legacyImport.servers[0].name, 'oldSrv');

  // 3b. New file creation with expectedSha256: null
  const createRes = await service.upsertServer({ name: 'alpha', spec: { url: 'https://alpha.example/mcp' }, expectedSha256: null });
  assert.equal(createRes.ok, true);
  assert.equal(createRes.sha256, storedSha);

  // 3c. On-disk CRLF + 4-space indentation + no trailing newline CAS parity
  const crlfNonCanonical = '{\r\n    "mcpServers": {\r\n        "alpha": {\r\n            "url": "https://alpha.example/mcp"\r\n        }\r\n    }\r\n}';
  const crlfSha = await sha256Hex(crlfNonCanonical);
  storedRaw = crlfNonCanonical;
  storedSha = crlfSha;
  globalMode = 'ok';

  const crlfSnap = await service.getSnapshot({ includeRawText: true });
  assert.equal(crlfSnap.globalConfig.malformed, false);
  assert.equal(crlfSnap.globalConfig.sha256, crlfSha);

  assert.equal((await service.upsertServer({ name: 'beta', spec: { url: 'https://beta.example/mcp' }, expectedSha256: crlfSha })).ok, true);
  storedRaw = crlfNonCanonical;
  storedSha = crlfSha;
  assert.equal((await service.toggleServerDisabled({ name: 'alpha', disabled: true, expectedSha256: crlfSha })).ok, true);
  storedRaw = crlfNonCanonical;
  storedSha = crlfSha;
  assert.equal((await service.deleteServer({ name: 'alpha', expectedSha256: crlfSha })).ok, true);
  storedRaw = crlfNonCanonical;
  storedSha = crlfSha;
  assert.equal(
    (await service.saveRawJson({ rawText: `${JSON.stringify({ mcpServers: { gamma: { url: 'https://gamma.example/mcp' } } }, null, 2)}\n`, expectedSha256: crlfSha })).ok,
    true
  );

  // 3d. Conflict, lock busy, symlink jail error mappings
  const conflict = await store.writeGlobalConfig({ rawText: '{}', expectedSha256: 'stale-sha' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, ERROR_CODES.CONFLICT);

  forceWriteReason = 'ERR_CONFIG_LOCK_BUSY';
  assert.equal((await store.writeGlobalConfig({ rawText: storedRaw, expectedSha256: storedSha })).code, ERROR_CODES.LOCK_BUSY);

  forceWriteReason = 'ERR_CONFIG_SYMLINK_FORBIDDEN';
  assert.equal((await store.writeGlobalConfig({ rawText: storedRaw, expectedSha256: storedSha })).code, ERROR_CODES.WRITE_JAIL_VIOLATION);

  // 3e. Corrupt JSON fail-closed detection + Raw JSON CAS repair
  storedRaw = '{ "mcpServers": broken';
  storedSha = await sha256Hex(storedRaw);
  globalMode = 'corrupt';
  const corruptSnap = await service.getSnapshot({ includeRawText: true });
  assert.equal(corruptSnap.globalConfig.malformed, true);
  assert.equal(corruptSnap.globalConfig.rawText, storedRaw);

  const repairedJson = `${JSON.stringify({ mcpServers: { recovered: { url: 'https://recovered.example/mcp' } } }, null, 2)}\n`;
  assert.equal((await service.saveRawJson({ rawText: repairedJson, expectedSha256: storedSha })).ok, true);
  assert.equal((await service.getSnapshot()).globalConfig.servers[0].name, 'recovered');
  assert.equal(bridgeCalls.some((c) => c[0] === 'read' && c[1] === HOST_CONFIG_SCOPES.LEGACY_MCP), true);
  assert.equal(bridgeCalls.some((c) => c[0] === 'write' && c[1] === HOST_CONFIG_SCOPES.GLOBAL_MCP), true);
});

test('NMCP-TC-032 (Real Chromium CDP E2E): Desktop AddonContextV3 Settings Page & Full Modal run full CRUD (CRLF CAS, masked secret preservation, Stdio confirm gate, toggle, delete, plugin clone, Raw JSON CAS conflict recovery, Smart Paste, Esc editor close) via ctx.configBridge', async (t) => {
  const browserBin = findChromiumBinary();
  if (!browserBin || typeof WebSocket !== 'function') {
    t.skip('Headless Chromium/Edge binary or global WebSocket is unavailable on this host');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-v3-crud-'));
  const profileDir = path.join(tmpDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const hostHarness = buildAddonContextV3HarnessScript(manifest, { surface: 'desktop', locale: 'ko-KR' });
  const rendererSrc = fs.readFileSync(RENDERER_OUTPUT_PATH, 'utf8');

  const bridgeSetupScript = `(function(){
    const enc = new TextEncoder();
    async function sha256(text) {
      const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(text || '')));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    let globalRaw = '{\\r\\n    "mcpServers": {\\r\\n        "ledger": {\\r\\n            "url": "https://ledger.example/mcp",\\r\\n            "headers": {\\r\\n                "Authorization": "Bearer super-secret-token-123"\\r\\n            }\\r\\n        }\\r\\n    }\\r\\n}';
    const pluginRaw = JSON.stringify({ mcpServers: { sennard: { url: 'https://sennard.example/mcp' } } }, null, 2) + '\\n';

    window.__TEST_V3_CONFIG_BRIDGE__ = {
      async read(scopeId) {
        if (window.__TEST_THROW_NEXT__) {
          window.__TEST_THROW_NEXT__ = false;
          throw new Error('ERR_CONFIG_SIMULATED_THROW');
        }
        if (scopeId === 'antigravity:mcp-config') {
          const hash = await sha256(globalRaw);
          try {
            const parsed = JSON.parse(globalRaw);
            return Object.freeze({ ok: true, scopeId, kind: 'file', status: 'ok', data: parsed, rawText: null, sha256: hash, reason: null });
          } catch {
            return Object.freeze({ ok: true, scopeId, kind: 'file', status: 'corrupt', data: null, rawText: globalRaw, sha256: hash, reason: 'ERR_CONFIG_INVALID_JSON' });
          }
        }
        if (scopeId === 'antigravity:plugin-mcp-configs') {
          return Object.freeze({
            ok: true,
            scopeId,
            kind: 'plugin-files',
            status: 'ok',
            items: Object.freeze([
              Object.freeze({ pluginId: 'sennard', status: 'ok', data: JSON.parse(pluginRaw), rawText: null, sha256: await sha256(pluginRaw), reason: null })
            ]),
          });
        }
        if (scopeId === 'antigravity:mcp-config-legacy') {
          return Object.freeze({ ok: true, scopeId, kind: 'file', status: 'missing', data: null, rawText: null, sha256: null, reason: null });
        }
        throw new Error('ERR_CONFIG_SCOPE_NOT_DECLARED:' + scopeId);
      },
      async write(scopeId, nextDataOrRawJson, opts) {
        const actualSha256 = await sha256(globalRaw);
        if ((opts?.expectedSha256 ?? null) !== actualSha256) {
          return Object.freeze({ ok: false, reason: 'ERR_CONFIG_CAS_CONFLICT', currentSha256: actualSha256 });
        }
        globalRaw = typeof nextDataOrRawJson === 'string' ? nextDataOrRawJson : JSON.stringify(nextDataOrRawJson, null, 2) + '\\n';
        return Object.freeze({ ok: true, reason: null, backupFileName: 'mcp_config.backup.json', currentSha256: await sha256(globalRaw) });
      }
    };
    window.__TEST_BRIDGE_CTRL__ = {
      getRaw: () => globalRaw,
      setRawExternally: (next) => { globalRaw = next; }
    };
  })();`;

  const parentServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body style="margin:0;height:100vh;background:#0d0e11;color:#e5e7eb;font-family:sans-serif;">
      <script>${bridgeSetupScript}</script>
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

    // 1. Open unified Settings Page -> mounts NativeMcpPanel in Korean (host locale ko-KR)
    await evalMain(`window.__TEST_V3_DIAG__.openSettingsPage(${JSON.stringify(V3_IDS.SETTINGS_PAGE)})`);
    assert.equal(
      await waitUntil(
        () =>
          evalMain(`(() => {
            const dlg = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]');
            const sr = dlg?.firstElementChild?.shadowRoot;
            return Boolean(
              sr?.querySelector('[data-agy-mcp-native-panel="true"][data-agy-mcp-mode="host-bridge"]') &&
              sr?.querySelector('[data-testid="global-server-ledger"]') &&
              sr?.querySelector('[data-testid="plugin-server-global-sennard-sennard"]')
            );
          })()`),
        5000,
        30
      ),
      true,
      'Settings page must render NativeMcpPanel with Global + Plugin servers'
    );

    const initMeta = await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot;
      return {
        lang: sr.querySelector('[data-agy-mcp-native-panel="true"]').getAttribute('data-agy-mcp-lang'),
        title: sr.querySelector('.mcp-title')?.textContent?.trim(),
        badge: sr.querySelector('[data-testid="bridge-status-badge"]')?.textContent?.trim(),
      };
    })()`);
    assert.equal(initMeta.lang, 'ko');
    assert.equal(initMeta.title, 'MCP 매니저');
    assert.equal(initMeta.badge, '호스트 브리지 연결됨');

    // 2. Edit 'ledger' on CRLF file preserving masked Authorization header
    await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot;
      sr.querySelector('[data-testid="btn-edit-ledger"]').click();
      const urlInput = sr.querySelector('[data-testid="input-http-url"]');
      urlInput.value = 'https://ledger-v4.example/mcp';
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      sr.querySelector('[data-testid="btn-save-server"]').click();
    })()`);
    assert.equal(
      await waitUntil(() =>
        evalMain(`(() => {
          const raw = JSON.parse(window.__TEST_BRIDGE_CTRL__.getRaw());
          return raw.mcpServers.ledger?.url === 'https://ledger-v4.example/mcp' &&
                 raw.mcpServers.ledger?.headers?.Authorization === 'Bearer super-secret-token-123';
        })()`)
      ),
      true
    );

    // 3. Add Stdio server -> confirmation gate -> confirm -> toggle -> delete
    await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot;
      sr.querySelector('[data-testid="btn-add-server"]').click();
      const nameInput = sr.querySelector('[data-testid="input-server-name"]');
      nameInput.value = 'local-tools';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      const sel = sr.querySelector('[data-testid="select-transport"]');
      sel.value = 'stdio';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const cmdInput = sr.querySelector('[data-testid="input-stdio-command"]');
      cmdInput.value = 'npx';
      cmdInput.dispatchEvent(new Event('input', { bubbles: true }));
      sr.querySelector('[data-testid="btn-save-server"]').click();
    })()`);
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="stdio-confirm-panel"]'))`)),
      true
    );
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-confirm-stdio"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="global-server-local-tools"]'))`)),
      true
    );
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-toggle-local-tools"]').click()`);
    assert.equal(await waitUntil(() => evalMain(`JSON.parse(window.__TEST_BRIDGE_CTRL__.getRaw()).mcpServers['local-tools']?.disabled === true`)), true);
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-delete-local-tools"]').click()`);
    assert.equal(await waitUntil(() => evalMain(`!JSON.parse(window.__TEST_BRIDGE_CTRL__.getRaw()).mcpServers['local-tools']`)), true);

    // 4. Plugin Clone to Global
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-clone-global-sennard-sennard"]').click()`);
    assert.equal(await waitUntil(() => evalMain(`Boolean(JSON.parse(window.__TEST_BRIDGE_CTRL__.getRaw()).mcpServers['sennard-copy'])`)), true);

    // 5. Raw JSON CAS conflict & Reload Latest
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="tab-raw"]').click()`);
    assert.equal(await waitUntil(() => evalMain(`Boolean(document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="raw-json-textarea"]'))`)), true);
    await evalMain(`(() => {
      const external = JSON.parse(window.__TEST_BRIDGE_CTRL__.getRaw());
      external.mcpServers.externalSrv = { url: 'https://external.example/mcp' };
      window.__TEST_BRIDGE_CTRL__.setRawExternally(JSON.stringify(external, null, 2) + '\\n');
      document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-save-raw"]').click();
    })()`);
    assert.equal(await waitUntil(() => evalMain(`Boolean(document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-reload-latest"]'))`)), true);
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-reload-latest"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="raw-json-textarea"]')?.value?.includes('externalSrv')`)),
      true
    );

    // 6. Smart Paste + Esc closes editor only without dismissing modal
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="tab-servers"]').click()`);
    await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot;
      sr.querySelector('[data-testid="btn-toggle-smart-paste"]').click();
      const ta = sr.querySelector('[data-testid="smart-paste-input"]');
      ta.value = 'https://paste-demo.example/mcp';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      sr.querySelector('[data-testid="btn-preview-paste"]').click();
      sr.querySelector('[data-testid="btn-load-paste-entry"]').click();
    })()`);
    await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot;
      sr.querySelector('[data-testid="server-editor-card"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    })()`);
    const afterEsc = await evalMain(`(() => {
      const dlg = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]');
      const sr = dlg?.firstElementChild?.shadowRoot;
      return { dialogOpen: Boolean(dlg?.open), editorClosed: !sr?.querySelector('[data-testid="server-editor-card"]') };
    })()`);
    assert.equal(afterEsc.dialogOpen, true);
    assert.equal(afterEsc.editorClosed, true);

    // 7. Mid-session throw renders error banner without uncaught rejection
    await evalMain(`window.__TEST_THROW_NEXT__ = true;`);
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-refresh"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('.mcp-banner-error')?.textContent?.includes('ERR_CONFIG_SIMULATED_THROW'))`)),
      true
    );
    assert.equal(exceptions.length, 0, `Expected zero uncaught browser exceptions, got: ${exceptions.join('; ')}`);

    await evalMain(`window.__TEST_V3_DIAG__.dispose()`);
    assert.equal(await evalMain(`document.querySelectorAll('[data-addon-host-owner="antigravity-mcp-manager"]').length`), 0);
  } finally {
    await session.close();
    await new Promise((r) => parentServer.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  }
});
