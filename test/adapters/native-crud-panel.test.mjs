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
import { createHostRuntime, detectHostLang } from '../../src/adapters/antigravity/renderer/host-runtime.mjs';
import { McpManagerService } from '../../src/core/manager-service.mjs';
import { ERROR_CODES } from '../../src/core/model.mjs';
import { sha256Hex } from '../../src/core/sha256.mjs';
import {
  buildAddonHostHarnessScript,
  findChromiumBinary,
  launchCdpSession,
  waitUntil,
} from '../helpers/cdp-browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'addon-manifest.json');

test('NMCP-TC-031 (Unit): detectHostLang auto-detects Korean vs English host DOM with explicit saved override, and HostBridgeConfigStore + McpManagerService match real addon-host v2.3.0 config-bridge.js contract (status:ok -> rawText:null + data + on-disk CRLF sha256 CAS, plugin-files, legacy, corrupt recovery, error mapping)', async () => {
  // 1. Scope ID constants match locked v2.3.0 contract
  assert.equal(HOST_CONFIG_SCOPES.GLOBAL_MCP, 'antigravity:mcp-config');
  assert.equal(HOST_CONFIG_SCOPES.PLUGIN_MCP, 'antigravity:plugin-mcp-configs');
  assert.equal(HOST_CONFIG_SCOPES.LEGACY_MCP, 'antigravity:mcp-config-legacy');

  // 2. Host UI language detection
  const makeFakeDoc = (texts, htmlLang = 'en') => ({
    documentElement: { lang: htmlLang },
    querySelectorAll: () =>
      texts.map((t) => ({
        textContent: t,
        children: [],
        closest: () => null,
      })),
  });
  assert.equal(detectHostLang(makeFakeDoc(['설정', '일반', '브라우저'])), 'ko');
  assert.equal(detectHostLang(makeFakeDoc(['MCP 서버 3'])), 'ko');
  assert.equal(detectHostLang(makeFakeDoc(['General', 'Browser', 'MCP Servers 3'])), 'en');
  assert.equal(detectHostLang(makeFakeDoc([], 'ko-KR')), 'ko');
  assert.equal(detectHostLang(makeFakeDoc([], 'en-US')), 'en');

  // 3. Explicit saved language always overrides detected host DOM language; v2.2.0 host without bridge stays graceful
  const mem = new Map();
  const fakeWin = {
    localStorage: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
    },
  };
  const fakeHostBase = {
    pluginId: 'antigravity-mcp-manager',
    trustLevel: 'restricted',
    schemaVersion: 2,
    hasConfigBridge: false,
    mountSlot: () => null,
    unmountSlot: () => true,
    injectStyle: () => null,
    removeStyle: () => true,
    openModal: () => null,
    onDispose: () => {},
  };
  const rtKoDom = createHostRuntime({ addonHost: fakeHostBase, win: fakeWin, doc: makeFakeDoc(['일반', '브라우저']) });
  assert.equal(rtKoDom.resolveEffectiveLang(), 'ko');
  rtKoDom.writeSavedLang('en');
  assert.equal(rtKoDom.resolveEffectiveLang(), 'en');
  assert.equal(rtKoDom.hasConfigBridge(), false);
  assert.equal(rtKoDom.createConfigService(), null);

  // Reject ro-only global scope declaration
  assert.equal(resolveHostConfigBridge(fakeHostBase), null);
  assert.equal(
    resolveHostConfigBridge({
      ...fakeHostBase,
      hasConfigBridge: true,
      configScopes: Object.freeze([{ scopeId: 'antigravity:mcp-config', access: 'ro', maxBytes: 262144 }]),
      readConfigScope: async () => ({}),
      writeConfigScope: async () => ({}),
    }),
    null
  );

  // 4. Real addon-host v2.3.0 config-bridge.js contract:
  //    status === 'ok' ALWAYS returns rawText: null, data: parsedObj, sha256: sha256(actualDiskBytes)
  //    status === 'corrupt' returns rawText: rawDiskText, data: null, sha256: sha256(actualDiskBytes)
  let globalMode = 'missing'; // 'missing' | 'ok' | 'corrupt'
  let storedRaw = '';
  let storedSha = null;
  let forceWriteReason = null;
  const legacyRaw = '{\r\n    "mcpServers": {\r\n        "oldSrv": { "url": "https://legacy.example/mcp" }\r\n    }\r\n}';
  const bridgeCalls = [];

  const mockAddonHostV23 = Object.freeze({
    ...fakeHostBase,
    trustLevel: 'trusted',
    hostProfileId: 'antigravity-desktop',
    hasConfigBridge: true,
    configScopes: Object.freeze([
      Object.freeze({ scopeId: 'antigravity:mcp-config', access: 'rw', maxBytes: 262144 }),
      Object.freeze({ scopeId: 'antigravity:plugin-mcp-configs', access: 'ro', maxBytes: 262144 }),
      Object.freeze({ scopeId: 'antigravity:mcp-config-legacy', access: 'ro', maxBytes: 262144 }),
    ]),
    async readConfigScope(scopeId) {
      bridgeCalls.push(['readConfigScope', scopeId]);
      if (scopeId === HOST_CONFIG_SCOPES.GLOBAL_MCP) {
        if (globalMode === 'missing') {
          return Object.freeze({
            ok: true,
            scopeId,
            kind: 'file',
            status: 'missing',
            data: null,
            rawText: null,
            sha256: null,
            reason: null,
            updatedAt: new Date().toISOString(),
          });
        }
        if (globalMode === 'corrupt') {
          return Object.freeze({
            ok: true,
            scopeId,
            kind: 'file',
            status: 'corrupt',
            data: null,
            rawText: storedRaw,
            sha256: storedSha,
            reason: 'ERR_CONFIG_INVALID_JSON',
            updatedAt: new Date().toISOString(),
          });
        }
        return Object.freeze({
          ok: true,
          scopeId,
          kind: 'file',
          status: 'ok',
          data: JSON.parse(storedRaw),
          rawText: null, // Real config-bridge.js:229 always sends rawText: null for status === 'ok'
          sha256: storedSha,
          reason: null,
          updatedAt: new Date().toISOString(),
        });
      }
      if (scopeId === HOST_CONFIG_SCOPES.PLUGIN_MCP) {
        return Object.freeze({
          ok: true,
          scopeId,
          kind: 'plugin-files',
          status: 'ok',
          items: Object.freeze([
            Object.freeze({
              pluginId: 'sennard',
              status: 'ok',
              data: { mcpServers: { sennard: { url: 'https://sennard.example/mcp' } } },
              rawText: null, // Real config-bridge.js always sends rawText: null for status === 'ok'
              sha256: 'abc',
              reason: null,
            }),
            Object.freeze({
              pluginId: 'workspace:local-demo',
              status: 'ok',
              data: { mcpServers: { wsTool: { url: 'https://ws-tool.example/mcp' } } },
              rawText: null,
              sha256: 'ws1',
              reason: null,
            }),
            Object.freeze({
              pluginId: 'broken-plugin',
              status: 'corrupt',
              data: null,
              rawText: '{bad',
              sha256: 'def',
              reason: 'ERR_CONFIG_INVALID_JSON',
            }),
          ]),
          truncated: false,
          reason: null,
          updatedAt: new Date().toISOString(),
        });
      }
      if (scopeId === HOST_CONFIG_SCOPES.LEGACY_MCP) {
        return Object.freeze({
          ok: true,
          scopeId,
          kind: 'file',
          status: 'ok',
          data: JSON.parse(legacyRaw),
          rawText: null, // Real config-bridge.js always sends rawText: null for status === 'ok'
          sha256: await sha256Hex(legacyRaw),
          reason: null,
          updatedAt: new Date().toISOString(),
        });
      }
      throw new Error(`ERR_CONFIG_SCOPE_NOT_DECLARED:${scopeId}`);
    },
    async writeConfigScope(scopeId, nextDataOrRawJson, opts = {}) {
      bridgeCalls.push(['writeConfigScope', scopeId, opts?.expectedSha256 ?? null]);
      if (forceWriteReason) {
        const reason = forceWriteReason;
        forceWriteReason = null;
        return Object.freeze({ ok: false, reason, currentSha256: storedSha, snapshot: null });
      }
      if ((opts?.expectedSha256 ?? null) !== storedSha) {
        return Object.freeze({
          ok: false,
          reason: 'ERR_CONFIG_CAS_CONFLICT',
          currentSha256: storedSha,
          snapshot: null,
        });
      }
      storedRaw =
        typeof nextDataOrRawJson === 'string'
          ? nextDataOrRawJson
          : JSON.stringify(nextDataOrRawJson, null, 2) + '\n';
      storedSha = await sha256Hex(storedRaw);
      globalMode = 'ok';
      return Object.freeze({
        ok: true,
        reason: null,
        backupFileName: 'mcp_config.20261123.bak.json',
        currentSha256: storedSha,
        snapshot: null,
      });
    },
  });

  const store = createHostBridgeConfigStore(mockAddonHostV23);
  const service = new McpManagerService({ configStore: store });

  // 4a. Initial missing file + plugin-files (rawText:null, global vs workspace displayPath F2) + legacy (rawText:null)
  const initSnap = await service.getSnapshot({ includeRawText: true });
  assert.equal(initSnap.ok, true);
  assert.equal(initSnap.globalConfig.exists, false);
  assert.equal(initSnap.globalConfig.sha256, null);
  assert.equal(initSnap.pluginServers.length, 2);
  const globalPlug = initSnap.pluginServers.find((p) => p.pluginId === 'global:sennard');
  const wsPlug = initSnap.pluginServers.find((p) => p.pluginId === 'workspace:local-demo');
  assert.ok(globalPlug, 'global plugin server must be listed');
  assert.equal(globalPlug.name, 'sennard');
  assert.equal(globalPlug.displayPath, '~/.gemini/config/plugins/sennard/mcp_config.json');
  assert.ok(wsPlug, 'workspace plugin server must be listed');
  assert.equal(wsPlug.name, 'wsTool');
  assert.equal(wsPlug.displayPath, '<workspace>/.agents/plugins/local-demo/mcp_config.json');
  assert.equal(initSnap.legacyImport.exists, true);
  assert.equal(initSnap.legacyImport.servers[0].name, 'oldSrv');

  // 4b. New file creation with expectedSha256: null
  const createRes = await service.upsertServer({
    name: 'alpha',
    spec: { url: 'https://alpha.example/mcp' },
    expectedSha256: null,
  });
  assert.equal(createRes.ok, true);
  assert.equal(createRes.sha256, storedSha);

  // 4c. On-disk CRLF + 4-space indentation + no trailing newline (sha256 differs from canonical JSON.stringify!)
  //     Must parse cleanly (malformed === false), preserve exact on-disk sha256, and pass CAS on upsert/toggle/delete/rawSave!
  const crlfNonCanonical =
    '{\r\n    "mcpServers": {\r\n        "alpha": {\r\n            "url": "https://alpha.example/mcp"\r\n        }\r\n    }\r\n}';
  const crlfSha = await sha256Hex(crlfNonCanonical);
  const canonicalSha = await sha256Hex(JSON.stringify(JSON.parse(crlfNonCanonical), null, 2) + '\n');
  assert.notEqual(crlfSha, canonicalSha, 'Test fixture must have distinct on-disk vs canonical SHA-256');
  storedRaw = crlfNonCanonical;
  storedSha = crlfSha;
  globalMode = 'ok';

  const crlfSnap = await service.getSnapshot({ includeRawText: true });
  assert.equal(crlfSnap.globalConfig.malformed, false, 'status:ok with rawText:null must NOT be treated as malformed JSON');
  assert.equal(crlfSnap.globalConfig.servers.length, 1);
  assert.equal(crlfSnap.globalConfig.sha256, crlfSha, 'Snapshot sha256 must preserve authoritative on-disk sha256');

  const crlfUpsert = await service.upsertServer({
    name: 'beta',
    spec: { url: 'https://beta.example/mcp' },
    expectedSha256: crlfSnap.globalConfig.sha256,
  });
  assert.equal(crlfUpsert.ok, true, 'Upsert against CRLF on-disk file must pass CAS without ERR_CONFIG_CAS_CONFLICT');
  assert.equal(crlfUpsert.sha256, storedSha);

  // Re-inject CRLF formatting and verify toggleServerDisabled, deleteServer, and saveRawJson also preserve on-disk sha256
  storedRaw = crlfNonCanonical;
  storedSha = crlfSha;
  const crlfToggle = await service.toggleServerDisabled({
    name: 'alpha',
    disabled: true,
    expectedSha256: crlfSha,
  });
  assert.equal(crlfToggle.ok, true, 'toggleServerDisabled against CRLF on-disk file must pass CAS');

  storedRaw = crlfNonCanonical;
  storedSha = crlfSha;
  const crlfDelete = await service.deleteServer({
    name: 'alpha',
    expectedSha256: crlfSha,
  });
  assert.equal(crlfDelete.ok, true, 'deleteServer against CRLF on-disk file must pass CAS');

  storedRaw = crlfNonCanonical;
  storedSha = crlfSha;
  const crlfRawSave = await service.saveRawJson({
    rawText: JSON.stringify({ mcpServers: { gamma: { url: 'https://gamma.example/mcp' } } }, null, 2) + '\n',
    expectedSha256: crlfSha,
  });
  assert.equal(crlfRawSave.ok, true, 'saveRawJson against CRLF on-disk file must pass CAS');

  // 4d. CAS conflict propagation from ERR_CONFIG_CAS_CONFLICT
  const directConflict = await store.writeGlobalConfig({ rawText: '{}', expectedSha256: 'stale-sha' });
  assert.equal(directConflict.ok, false);
  assert.equal(directConflict.code, ERROR_CODES.CONFLICT);
  assert.equal(directConflict.actualSha256, storedSha);

  // 4e. Lock busy & symlink jail error code mapping
  forceWriteReason = 'ERR_CONFIG_LOCK_BUSY';
  const lockRes = await store.writeGlobalConfig({ rawText: storedRaw, expectedSha256: storedSha });
  assert.equal(lockRes.ok, false);
  assert.equal(lockRes.code, ERROR_CODES.LOCK_BUSY);

  forceWriteReason = 'ERR_CONFIG_SYMLINK_FORBIDDEN';
  const jailRes = await store.writeGlobalConfig({ rawText: storedRaw, expectedSha256: storedSha });
  assert.equal(jailRes.ok, false);
  assert.equal(jailRes.code, ERROR_CODES.WRITE_JAIL_VIOLATION);

  forceWriteReason = 'ERR_CONFIG_BACKUP_SYMLINK_FORBIDDEN';
  const backupJailRes = await store.writeGlobalConfig({ rawText: storedRaw, expectedSha256: storedSha });
  assert.equal(backupJailRes.ok, false);
  assert.equal(backupJailRes.code, ERROR_CODES.WRITE_JAIL_VIOLATION);

  // 4f. Corrupt JSON fail-closed detection + Raw JSON CAS repair (corrupt carries rawText)
  storedRaw = '{ "mcpServers": broken';
  storedSha = await sha256Hex(storedRaw);
  globalMode = 'corrupt';
  const corruptSnap = await service.getSnapshot({ includeRawText: true });
  assert.equal(corruptSnap.globalConfig.exists, true);
  assert.equal(corruptSnap.globalConfig.malformed, true);
  assert.equal(corruptSnap.globalConfig.rawText, storedRaw);
  assert.equal(corruptSnap.globalConfig.sha256, storedSha);

  const repairedJson = JSON.stringify({ mcpServers: { recovered: { url: 'https://recovered.example/mcp' } } }, null, 2) + '\n';
  const repairRes = await service.saveRawJson({ rawText: repairedJson, expectedSha256: storedSha });
  assert.equal(repairRes.ok, true);
  assert.equal(repairRes.sha256, storedSha);
  const afterRepair = await service.getSnapshot();
  assert.equal(afterRepair.globalConfig.malformed, false);
  assert.equal(afterRepair.globalConfig.servers[0].name, 'recovered');

  assert.equal(bridgeCalls.some((c) => c[0] === 'readConfigScope' && c[1] === HOST_CONFIG_SCOPES.LEGACY_MCP), true);
  assert.equal(bridgeCalls.some((c) => c[0] === 'writeConfigScope' && c[1] === HOST_CONFIG_SCOPES.GLOBAL_MCP), true);
});

test('NMCP-TC-032 (CDP E2E): Native Shadow DOM MCP Manager CRUD panel works end-to-end inside both Settings pane and Customizations centered popup against real addon-host v2.3.0 config-bridge.js contract (rawText:null on ok, CRLF on-disk file CAS)', async (t) => {
  const browserBin = findChromiumBinary();
  if (!browserBin || typeof WebSocket !== 'function') {
    t.skip('Headless Chromium/Edge binary or global WebSocket is unavailable on this host');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-native-crud-'));
  const profileDir = path.join(tmpDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.trustLevel, 'trusted', 'addon-manifest.json must declare trusted for Host v2.3.0 Config Bridge');
  assert.equal(manifest.compatibility?.minHostVersion, '2.3.0');
  const declaredBridgeScopes = Array.isArray(manifest.configBridge?.scopes) ? manifest.configBridge.scopes : [];
  assert.deepEqual(
    declaredBridgeScopes.map((s) => ({ scopeId: s.scopeId, access: s.access })),
    [
      { scopeId: HOST_CONFIG_SCOPES.GLOBAL_MCP, access: 'rw' },
      { scopeId: HOST_CONFIG_SCOPES.PLUGIN_MCP, access: 'ro' },
      { scopeId: HOST_CONFIG_SCOPES.LEGACY_MCP, access: 'ro' },
    ],
    'NMCP-TC-032 must enforce manifest-to-scope parity with addon-manifest.json'
  );
  const hostHarness = buildAddonHostHarnessScript(manifest);
  const rendererSrc = fs.readFileSync(RENDERER_OUTPUT_PATH, 'utf8');

  // Mirror real addon-host v2.3.0 config-bridge.js:
  // - Initial file uses CRLF + 4-space indentation + no trailing newline
  // - status === 'ok' ALWAYS returns rawText: null + parsed data + actual on-disk sha256
  // - status === 'corrupt' returns rawText + data: null + actual on-disk sha256
  const bridgeSetupScript = `(function(){
    const enc = new TextEncoder();
    async function sha256(text) {
      const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(text || '')));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    let globalRaw = '{\\r\\n    "mcpServers": {\\r\\n        "ledger": {\\r\\n            "url": "https://ledger.example/mcp",\\r\\n            "headers": {\\r\\n                "Authorization": "Bearer super-secret-token-123"\\r\\n            }\\r\\n        }\\r\\n    }\\r\\n}';
    const pluginRaw = JSON.stringify({
      mcpServers: {
        sennard: { url: 'https://sennard.example/mcp' }
      }
    }, null, 2) + '\\n';

    const configScopes = Object.freeze(
      ${JSON.stringify(declaredBridgeScopes)}.map((s) => Object.freeze({ scopeId: s.scopeId, access: s.access, maxBytes: 262144 }))
    );

    async function readConfigScope(scopeId) {
      if (window.__TEST_ADDON_HOST_THROW_NEXT__) {
        window.__TEST_ADDON_HOST_THROW_NEXT__ = false;
        throw new Error('ERR_CONFIG_SIMULATED_THROW');
      }
      if (scopeId === 'antigravity:mcp-config') {
        const hash = await sha256(globalRaw);
        try {
          const parsed = JSON.parse(globalRaw);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return Object.freeze({ ok: true, scopeId, kind: 'file', status: 'corrupt', data: null, rawText: globalRaw, sha256: hash, reason: 'ERR_CONFIG_MUST_BE_OBJECT', updatedAt: new Date().toISOString() });
          }
          return Object.freeze({ ok: true, scopeId, kind: 'file', status: 'ok', data: parsed, rawText: null, sha256: hash, reason: null, updatedAt: new Date().toISOString() });
        } catch {
          return Object.freeze({ ok: true, scopeId, kind: 'file', status: 'corrupt', data: null, rawText: globalRaw, sha256: hash, reason: 'ERR_CONFIG_INVALID_JSON', updatedAt: new Date().toISOString() });
        }
      }
      if (scopeId === 'antigravity:plugin-mcp-configs') {
        return Object.freeze({
          ok: true,
          scopeId,
          kind: 'plugin-files',
          status: 'ok',
          items: Object.freeze([
            Object.freeze({
              pluginId: 'sennard',
              status: 'ok',
              data: JSON.parse(pluginRaw),
              rawText: null,
              sha256: await sha256(pluginRaw),
              reason: null
            })
          ]),
          truncated: false,
          reason: null,
          updatedAt: new Date().toISOString()
        });
      }
      if (scopeId === 'antigravity:mcp-config-legacy') {
        return Object.freeze({ ok: true, scopeId, kind: 'file', status: 'missing', data: null, rawText: null, sha256: null, reason: null, updatedAt: new Date().toISOString() });
      }
      throw new Error('ERR_CONFIG_SCOPE_NOT_DECLARED:' + scopeId);
    }

    async function writeConfigScope(scopeId, nextDataOrRawJson, opts) {
      if (scopeId !== 'antigravity:mcp-config') {
        throw new Error('ERR_CONFIG_SCOPE_READ_ONLY:' + scopeId);
      }
      const actualSha256 = await sha256(globalRaw);
      if ((opts?.expectedSha256 ?? null) !== actualSha256) {
        return Object.freeze({
          ok: false,
          reason: 'ERR_CONFIG_CAS_CONFLICT',
          currentSha256: actualSha256,
          snapshot: await readConfigScope(scopeId)
        });
      }
      globalRaw = typeof nextDataOrRawJson === 'string'
        ? nextDataOrRawJson
        : JSON.stringify(nextDataOrRawJson, null, 2) + '\\n';
      const nextSha = await sha256(globalRaw);
      return Object.freeze({
        ok: true,
        reason: null,
        backupFileName: 'mcp_config.backup.json',
        currentSha256: nextSha,
        snapshot: await readConfigScope(scopeId)
      });
    }

    window.__TEST_BRIDGE_CTRL__ = {
      getRaw: () => globalRaw,
      setRawExternally: (next) => { globalRaw = next; }
    };
    window.__TEST_ADDON_HOST_V23__ = Object.freeze({
      ...window.__TEST_ADDON_HOST__,
      trustLevel: 'trusted',
      hostProfileId: 'antigravity-desktop',
      hasConfigBridge: true,
      configScopes,
      readConfigScope,
      writeConfigScope
    });
  })();`;

  const parentServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body style="margin:0;height:100vh;background:#0d0e11;color:#e5e7eb;font-family:sans-serif;display:flex;flex-direction:column;">
      <div id="settings-root" style="display:flex;flex:1;">
        <aside id="settings-sidebar" style="width:220px;display:flex;flex-direction:column;gap:4px;">
          <nav>
            <button id="nav-general">일반</button>
            <button id="nav-application">애플리케이션</button>
            <button id="nav-appearance">모양 및 테마</button>
            <button id="nav-shortcuts">단축키</button>
            <button id="nav-notifications">알림</button>
            <button id="nav-models">모델</button>
            <button id="nav-browser">브라우저</button>
          </nav>
        </aside>
        <main id="settings-content" style="flex:1;min-width:480px;min-height:420px;display:flex;flex-direction:column;">
          <div id="native-general-pane">일반 설정</div>
        </main>
      </div>
      <section id="customizations-page" style="padding:12px;">
        <h1>사용자 정의</h1>
        <div id="mcp-header-row" style="display:flex;align-items:center;justify-content:space-between;">
          <span>MCP 서버</span>
          <div id="mcp-header-actions" style="display:flex;align-items:center;gap:6px;">
            <button type="button" id="btn-raw-config">[]</button>
            <button type="button" id="btn-add-native">+</button>
          </div>
        </div>
      </section>
      <script>${hostHarness}</script>
      <script>${bridgeSetupScript}</script>
      <script>(function(addonHost){ ${rendererSrc} })(window.__TEST_ADDON_HOST_V23__);</script>
    </body></html>`);
  });
  await new Promise((r) => parentServer.listen(0, '127.0.0.1', r));
  const parentPort = parentServer.address().port;

  const session = await launchCdpSession({ browserBin, profileDir });

  try {
    const { cdp, evalMain, exceptions } = session;
    await cdp('Page.navigate', { url: `http://localhost:${parentPort}/` });

    // 1. Korean Antigravity DOM auto-detects Korean without any prior localStorage preference
    assert.equal(
      await waitUntil(
        () =>
          evalMain(`(() => {
            const btnSr = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]')?.shadowRoot;
            return btnSr?.querySelector('[data-agy-mcp-customizations-btn="true"]')?.textContent?.trim() === 'MCP 매니저';
          })()`),
        4000,
        30
      ),
      true,
      'Customizations button must auto-detect Korean host UI and render MCP 매니저'
    );

    // 2. Click Settings MCP Manager -> Native Shadow DOM panel mounts directly (no iframe, no placeholder)
    await evalMain(`document.querySelector('[data-agy-mcp-manager-nav="true"]').click()`);
    assert.equal(
      await waitUntil(
        () =>
          evalMain(`(() => {
            const sr = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]')?.shadowRoot;
            return Boolean(
              sr?.querySelector('[data-agy-mcp-native-panel="true"]') &&
              sr?.querySelector('[data-testid="global-server-ledger"]') &&
              sr?.querySelector('[data-testid="plugin-server-global-sennard-sennard"]')
            );
          })()`),
        5000,
        30
      ),
      true,
      'Settings pane must render live native Shadow DOM CRUD panel with Global + Plugin servers'
    );

    const initialCheck = await evalMain(`(() => {
      const sr = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot;
      return {
        lang: sr.querySelector('[data-agy-mcp-native-panel="true"]').getAttribute('data-agy-mcp-lang'),
        hasIframe: Boolean(sr.querySelector('iframe')),
        hasLauncher: Boolean(sr.querySelector('[data-agy-mcp-sidecar-launcher="true"]')),
        title: sr.querySelector('.mcp-title')?.textContent?.trim(),
        badge: sr.querySelector('[data-testid="bridge-status-badge"]')?.textContent?.trim(),
      };
    })()`);
    assert.equal(initialCheck.lang, 'ko');
    assert.equal(initialCheck.hasIframe, false);
    assert.equal(initialCheck.hasLauncher, false);
    assert.equal(initialCheck.title, 'MCP 매니저');
    assert.equal(initialCheck.badge, '호스트 브리지 연결됨');

    // 3. Edit existing server ('ledger') on CRLF on-disk file without changing masked secret -> CAS succeeds & secret preserved intact
    await evalMain(`(() => {
      const sr = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot;
      sr.querySelector('[data-testid="btn-edit-ledger"]').click();
    })()`);
    await evalMain(`(() => {
      const sr = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot;
      const urlInput = sr.querySelector('[data-testid="input-http-url"]');
      urlInput.value = 'https://ledger-v2.example/mcp';
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      sr.querySelector('[data-testid="btn-save-server"]').click();
    })()`);
    assert.equal(
      await waitUntil(
        () =>
          evalMain(`(() => {
            const raw = JSON.parse(window.__TEST_BRIDGE_CTRL__.getRaw());
            return raw.mcpServers.ledger?.url === 'https://ledger-v2.example/mcp' &&
                   raw.mcpServers.ledger?.headers?.Authorization === 'Bearer super-secret-token-123';
          })()`),
        4000,
        30
      ),
      true,
      'Editing HTTP server on CRLF on-disk file must pass CAS and preserve masked Authorization header secret'
    );

    // 4. Add a Stdio server -> must require explicit confirmation before saving
    await evalMain(`(() => {
      const sr = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot;
      sr.querySelector('[data-testid="btn-add-server"]').click();
    })()`);
    await evalMain(`(() => {
      const sr = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot;
      const nameInput = sr.querySelector('[data-testid="input-server-name"]');
      nameInput.value = 'local-tools';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      const sel = sr.querySelector('[data-testid="select-transport"]');
      sel.value = 'stdio';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await evalMain(`(() => {
      const sr = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot;
      const cmdInput = sr.querySelector('[data-testid="input-stdio-command"]');
      cmdInput.value = 'npx';
      cmdInput.dispatchEvent(new Event('input', { bubbles: true }));
      const argsInput = sr.querySelector('[data-testid="input-stdio-args"]');
      argsInput.value = '-y\\n@modelcontextprotocol/server-memory';
      argsInput.dispatchEvent(new Event('input', { bubbles: true }));
      sr.querySelector('[data-testid="btn-save-server"]').click();
    })()`);
    assert.equal(
      await waitUntil(
        () =>
          evalMain(`Boolean(document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot.querySelector('[data-testid="stdio-confirm-panel"]'))`),
        4000,
        30
      ),
      true,
      'Stdio save must trigger explicit confirmation panel before persisting'
    );
    assert.equal(
      await evalMain(`Boolean(JSON.parse(window.__TEST_BRIDGE_CTRL__.getRaw()).mcpServers['local-tools'])`),
      false,
      'Stdio server must NOT be written before confirmation'
    );
    await evalMain(`document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot.querySelector('[data-testid="btn-confirm-stdio"]').click()`);
    assert.equal(
      await waitUntil(
        () =>
          evalMain(`Boolean(document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot.querySelector('[data-testid="global-server-local-tools"]'))`),
        4000,
        30
      ),
      true,
      'Confirmed Stdio server must save and render in Global MCP Servers list'
    );

    // 5. Toggle disable & Delete 'local-tools'
    await evalMain(`document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot.querySelector('[data-testid="btn-toggle-local-tools"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`JSON.parse(window.__TEST_BRIDGE_CTRL__.getRaw()).mcpServers['local-tools']?.disabled === true`), 4000, 30),
      true,
      'Disable button must persist disabled: true'
    );
    await evalMain(`document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot.querySelector('[data-testid="btn-delete-local-tools"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`!JSON.parse(window.__TEST_BRIDGE_CTRL__.getRaw()).mcpServers['local-tools']`), 4000, 30),
      true,
      'Delete button must remove server cleanly'
    );

    // 6. Plugin Clone to Global (from plugin-files with rawText: null)
    await evalMain(`document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot.querySelector('[data-testid="btn-clone-global-sennard-sennard"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(JSON.parse(window.__TEST_BRIDGE_CTRL__.getRaw()).mcpServers['sennard-copy'])`), 4000, 30),
      true,
      'Clone to Global must copy plugin server into global mcp_config.json'
    );

    // 7. Raw JSON tab + external CAS conflict banner -> Reload Latest recovery
    await evalMain(`document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot.querySelector('[data-testid="tab-raw"]').click()`);
    assert.equal(
      await waitUntil(
        () =>
          evalMain(`Boolean(document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot.querySelector('[data-testid="raw-json-textarea"]'))`),
        4000,
        30
      ),
      true
    );
    await evalMain(`(() => {
      const external = JSON.parse(window.__TEST_BRIDGE_CTRL__.getRaw());
      external.mcpServers.externalSrv = { url: 'https://external.example/mcp' };
      window.__TEST_BRIDGE_CTRL__.setRawExternally(JSON.stringify(external, null, 2) + '\\n');
      document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot.querySelector('[data-testid="btn-save-raw"]').click();
    })()`);
    assert.equal(
      await waitUntil(
        () =>
          evalMain(`Boolean(document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot.querySelector('[data-testid="btn-reload-latest"]'))`),
        4000,
        30
      ),
      true,
      'Stale Raw JSON save must surface CAS conflict banner with Reload Latest action'
    );
    await evalMain(`document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot.querySelector('[data-testid="btn-reload-latest"]').click()`);
    assert.equal(
      await waitUntil(
        () =>
          evalMain(`document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').shadowRoot.querySelector('[data-testid="raw-json-textarea"]')?.value?.includes('externalSrv')`),
        4000,
        30
      ),
      true,
      'Reload Latest must refresh Raw JSON textarea with externalSrv'
    );

    // 8. Customizations centered popup modal ALSO renders live native CRUD panel + Smart Paste + Esc closes editor first without dismissing popup
    await evalMain(`document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]').shadowRoot.querySelector('[data-agy-mcp-customizations-btn="true"]').click()`);
    assert.equal(
      await waitUntil(
        () =>
          evalMain(`(() => {
            const dlg = document.querySelector('dialog[data-agy-mcp-customizations-overlay="true"]');
            const sr = dlg?.querySelector('.addon-host-modal-shadow-host')?.shadowRoot;
            return Boolean(
              dlg && dlg.open &&
              sr?.querySelector('[data-agy-mcp-native-panel="true"][data-agy-mcp-surface="customizations"]') &&
              sr?.querySelector('[data-testid="global-server-externalSrv"]')
            );
          })()`),
        5000,
        30
      ),
      true,
      'Customizations centered popup must render live native Shadow DOM CRUD panel with latest externalSrv'
    );

    // Open Smart Paste inside popup -> Preview URL -> Load into Editor -> press Escape closes editor ONLY (popup stays open!)
    await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-agy-mcp-customizations-overlay="true"] .addon-host-modal-shadow-host').shadowRoot;
      sr.querySelector('[data-testid="btn-toggle-smart-paste"]').click();
    })()`);
    await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-agy-mcp-customizations-overlay="true"] .addon-host-modal-shadow-host').shadowRoot;
      const ta = sr.querySelector('[data-testid="smart-paste-input"]');
      ta.value = 'https://paste-demo.example/mcp';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      sr.querySelector('[data-testid="btn-preview-paste"]').click();
    })()`);
    await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-agy-mcp-customizations-overlay="true"] .addon-host-modal-shadow-host').shadowRoot;
      sr.querySelector('[data-testid="btn-load-paste-entry"]').click();
    })()`);
    const editorCheck = await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-agy-mcp-customizations-overlay="true"] .addon-host-modal-shadow-host').shadowRoot;
      return {
        hasEditor: Boolean(sr.querySelector('[data-testid="server-editor-card"]')),
        nameVal: sr.querySelector('[data-testid="input-server-name"]')?.value,
        urlVal: sr.querySelector('[data-testid="input-http-url"]')?.value,
      };
    })()`);
    assert.equal(editorCheck.hasEditor, true);
    assert.equal(editorCheck.nameVal, 'paste-demo');
    assert.equal(editorCheck.urlVal, 'https://paste-demo.example/mcp');

    // Escape inside editor card closes editor while keeping popup dialog open
    await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-agy-mcp-customizations-overlay="true"] .addon-host-modal-shadow-host').shadowRoot;
      const card = sr.querySelector('[data-testid="server-editor-card"]');
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    })()`);
    const afterEditorEsc = await evalMain(`(() => {
      const dlg = document.querySelector('dialog[data-agy-mcp-customizations-overlay="true"]');
      const sr = dlg?.querySelector('.addon-host-modal-shadow-host')?.shadowRoot;
      return {
        dialogStillOpen: Boolean(dlg && dlg.open),
        editorClosed: !sr?.querySelector('[data-testid="server-editor-card"]'),
      };
    })()`);
    assert.equal(afterEditorEsc.dialogStillOpen, true);
    assert.equal(afterEditorEsc.editorClosed, true);

    // 8b. F1 regression guard: mid-session write rejection renders error banner without uncaught rejection
    await evalMain(`window.__TEST_ADDON_HOST_THROW_NEXT__ = true;`);
    const f1State = await evalMain(`(async () => {
      const sr = document.querySelector('dialog[data-agy-mcp-customizations-overlay="true"] .addon-host-modal-shadow-host').shadowRoot;
      const prevErrorBanner = sr.querySelector('.mcp-banner-error')?.textContent || '';
      const toggleBtn = sr.querySelector('[data-testid="btn-toggle-externalSrv"]');
      if (toggleBtn) toggleBtn.click();
      await new Promise((r) => setTimeout(r, 120));
      return {
        hadToggleBtn: Boolean(toggleBtn),
        prevErrorBanner,
        afterBanner: sr.querySelector('.mcp-banner-error')?.textContent || '',
      };
    })()`);
    assert.equal(f1State.hadToggleBtn, true);
    assert.ok(
      f1State.afterBanner.includes('ERR_CONFIG_SIMULATED_THROW'),
      `F1 guard must catch thrown write-path error into banner instead of unhandled rejection; got: ${f1State.afterBanner}`
    );

    assert.deepEqual(exceptions, [], 'Zero uncaught runtime exceptions allowed');

    // 9. Clean dispose()
    await evalMain(`window.__TEST_ADDON_HOST__.dispose()`);
    assert.equal(await evalMain(`document.querySelectorAll('[data-addon-host-owner="antigravity-mcp-manager"]').length`), 0);
  } finally {
    await session.close();
    await new Promise((r) => parentServer.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  }
});
