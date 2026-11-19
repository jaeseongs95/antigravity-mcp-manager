import test from 'node:test';
import assert from 'node:assert/strict';

import { ERROR_CODES } from '../../src/core/model.mjs';
import { sha256Hex } from '../../src/core/sha256.mjs';
import { parseConfigDocument } from '../../src/core/document-engine.mjs';
import { REDACTED_MASK } from '../../src/core/secret-redactor.mjs';
import { McpManagerService } from '../../src/core/manager-service.mjs';

function createMemoryStore({ initialRaw = null, plugins = [], legacyRaw = null } = {}) {
  const state = {
    exists: initialRaw !== null,
    rawText: initialRaw ?? '',
    backupText: null,
    legacyRaw,
  };

  return {
    state,
    async readGlobalConfig() {
      return {
        exists: state.exists,
        rawText: state.rawText,
        sha256: state.exists ? sha256Hex(state.rawText) : null,
        displayPath: '/virtual/mcp_config.json',
      };
    },
    async writeGlobalConfig({ rawText, expectedSha256 }) {
      if (expectedSha256 === undefined) {
        return { ok: false, code: ERROR_CODES.VALIDATION_ERROR, error: 'expectedSha256 required' };
      }
      const currentSha = state.exists ? sha256Hex(state.rawText) : null;
      if (currentSha !== expectedSha256) {
        return { ok: false, code: ERROR_CODES.CONFLICT, error: 'CAS mismatch', actualSha256: currentSha };
      }
      if (state.exists) state.backupText = state.rawText;
      state.exists = true;
      state.rawText = rawText;
      return { ok: true, sha256: sha256Hex(rawText) };
    },
    async readPluginConfigs() {
      return plugins;
    },
    async readLegacyConfig() {
      return state.legacyRaw !== null
        ? { exists: true, rawText: state.legacyRaw, displayPath: '/virtual/legacy/mcp_config.json' }
        : { exists: false, rawText: '', displayPath: '' };
    },
    async restoreLastBackup({ expectedSha256 } = {}) {
      if (expectedSha256 === undefined) {
        return { ok: false, code: ERROR_CODES.VALIDATION_ERROR, error: 'expectedSha256 required' };
      }
      if (!state.backupText) return { ok: false, code: ERROR_CODES.NOT_FOUND, error: 'No backup' };
      const currentSha = state.exists ? sha256Hex(state.rawText) : null;
      if (currentSha !== expectedSha256) {
        return { ok: false, code: ERROR_CODES.CONFLICT, error: 'CAS mismatch', actualSha256: currentSha };
      }
      state.exists = true;
      state.rawText = state.backupText;
      return { ok: true, sha256: sha256Hex(state.rawText) };
    },
  };
}

test('NMCP-TC-007: lossless unknown-key preservation & masked secret + URL query REDACTED restoration across updates and toggles', async () => {
  const initial = JSON.stringify({
    $schema: 'https://example.com/mcp-schema.json',
    customTopLevel: { keepMe: true },
    mcpServers: {
      api: {
        url: 'https://api.example.com/mcp?api_key=real-query-secret&mode=read',
        headers: { Authorization: 'Bearer real-secret-token' },
        disabledTools: ['dangerous_tool'],
        futureHostOption: 42,
      },
    },
  }, null, 2) + '\n';

  const store = createMemoryStore({ initialRaw: initial });
  const svc = new McpManagerService({ configStore: store });
  const snap = await svc.getSnapshot();
  assert.equal(snap.globalConfig.servers[0].spec.headers.Authorization, REDACTED_MASK);
  assert.equal(snap.globalConfig.servers[0].spec.url.includes('REDACTED'), true);

  // Edit while passing back redacted URL query + masked Authorization -> BOTH secrets + unknown keys MUST be preserved!
  const res = await svc.upsertServer({
    name: 'api',
    originalName: 'api',
    spec: {
      url: snap.globalConfig.servers[0].spec.url,
      headers: { Authorization: REDACTED_MASK },
    },
    expectedSha256: snap.globalConfig.sha256,
  });
  assert.equal(res.ok, true);

  const saved = JSON.parse(store.state.rawText);
  assert.equal(saved.customTopLevel.keepMe, true);
  assert.equal(saved.mcpServers.api.url, 'https://api.example.com/mcp?api_key=real-query-secret&mode=read');
  assert.equal(saved.mcpServers.api.headers.Authorization, 'Bearer real-secret-token');
  assert.deepEqual(saved.mcpServers.api.disabledTools, ['dangerous_tool']);
  assert.equal(saved.mcpServers.api.futureHostOption, 42);

  // Toggle disabled true -> false preserves everything
  const t1 = await svc.toggleServerDisabled({ name: 'api', disabled: true, expectedSha256: res.sha256 });
  assert.equal(t1.ok, true);
  assert.equal(JSON.parse(store.state.rawText).mcpServers.api.disabled, true);

  const t2 = await svc.toggleServerDisabled({ name: 'api', disabled: false, expectedSha256: t1.sha256 });
  assert.equal(t2.ok, true);
  assert.equal(JSON.parse(store.state.rawText).mcpServers.api.disabled, undefined);
});

test('NMCP-TC-008: fail-closed malformed JSON blocks structured edits and allows explicit Raw JSON repair', async () => {
  const broken = '{\n  "mcpServers": { "broken": \n';
  const parsed = parseConfigDocument(broken, true);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, ERROR_CODES.MALFORMED_JSON);

  const store = createMemoryStore({ initialRaw: broken });
  const svc = new McpManagerService({ configStore: store });
  const snap = await svc.getSnapshot();
  assert.equal(snap.globalConfig.malformed, true);
  assert.equal(snap.globalConfig.rawText, broken);

  // Structured upsert MUST fail-closed and NEVER overwrite broken file
  const blocked = await svc.upsertServer({
    name: 'good',
    spec: { url: 'https://mcp.example.com/mcp' },
    expectedSha256: snap.globalConfig.sha256,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, ERROR_CODES.MALFORMED_JSON);
  assert.equal(store.state.rawText, broken);

  // Explicit valid Raw JSON save repairs cleanly
  const repaired = await svc.saveRawJson({
    rawText: JSON.stringify({ mcpServers: { good: { url: 'https://mcp.example.com/mcp' } } }, null, 2),
    expectedSha256: snap.globalConfig.sha256,
  });
  assert.equal(repaired.ok, true);
  assert.equal(JSON.parse(store.state.rawText).mcpServers.good.url, 'https://mcp.example.com/mcp');
});

test('NMCP-TC-009: mandatory expectedSha256 CAS rejects undefined and stale digests, and blocks exact same-name create overwrite (F3)', async () => {
  const store = createMemoryStore({
    initialRaw: '{\n  "mcpServers": { "existing": { "url": "https://existing.example.com/mcp" } }\n}\n',
  });
  const svc = new McpManagerService({ configStore: store });
  const snap = await svc.getSnapshot();

  // Undefined expectedSha256 MUST be rejected (never bypass CAS)
  const missingCas = await svc.upsertServer({
    name: 'fresh',
    spec: { url: 'https://fresh.example.com/mcp' },
  });
  assert.equal(missingCas.ok, false);
  assert.equal(missingCas.code, ERROR_CODES.VALIDATION_ERROR);

  const missingRestoreCas = await svc.restoreBackup({});
  assert.equal(missingRestoreCas.ok, false);
  assert.equal(missingRestoreCas.code, ERROR_CODES.VALIDATION_ERROR);

  // Creating a new server with exact same name as existing server MUST fail with COLLISION (originalName === null)
  const exactCollision = await svc.upsertServer({
    name: 'existing',
    originalName: null,
    spec: { url: 'https://hijack.example.com/mcp' },
    expectedSha256: snap.globalConfig.sha256,
  });
  assert.equal(exactCollision.ok, false);
  assert.equal(exactCollision.code, ERROR_CODES.COLLISION);
  assert.equal(JSON.parse(store.state.rawText).mcpServers.existing.url, 'https://existing.example.com/mcp');

  // Stale CAS rejects with CONFLICT
  store.state.rawText = '{\n  "mcpServers": { "ext": { "url": "https://ext.example.com/mcp" } }\n}\n';
  const conflict = await svc.upsertServer({
    name: 'mine',
    spec: { url: 'https://mine.example.com/mcp' },
    expectedSha256: snap.globalConfig.sha256,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, ERROR_CODES.CONFLICT);
});

test('NMCP-TC-010: ManagerService preserves real secrets on clone/import, enforces Stdio gate, and surfaces runtime.plugins status (F2/F5)', async () => {
  const pluginRaw = JSON.stringify({
    mcpServers: {
      p1: {
        url: 'https://plugin.example.com/mcp',
        headers: { Authorization: 'Bearer real-plugin-secret' },
        disabledTools: ['t1'],
      },
    },
  });
  const legacyRaw = JSON.stringify({
    mcpServers: {
      oldStdio: { command: 'node', args: ['old.js'], env: { API_TOKEN: 'real-legacy-secret' } },
    },
  });
  const store = createMemoryStore({
    initialRaw: '{\n  "mcpServers": {}\n}\n',
    plugins: [{ pluginName: 'Demo Plugin', pluginDir: 'demo', rawText: pluginRaw, displayPath: '/plugins/demo/mcp_config.json' }],
    legacyRaw,
  });
  const runtimeInspector = {
    async inspectRuntime() {
      return {
        available: true,
        servers: {},
        plugins: [{ name: 'Demo Plugin', dir: 'demo', disabled: true, isGlobal: true, mcpServerNames: ['p1'] }],
      };
    },
  };
  const svc = new McpManagerService({ configStore: store, runtimeInspector });
  const snap = await svc.getSnapshot();
  assert.equal(snap.pluginServers.length, 1);
  assert.equal(snap.pluginServers[0].pluginDisabled, true);
  assert.equal(snap.runtimePlugins.length, 1);

  // Clone preserves real unmasked secret + disabledTools
  const cloned = await svc.clonePluginServer({
    pluginDir: 'demo',
    serverName: 'p1',
    targetName: 'p1-local',
    expectedSha256: snap.globalConfig.sha256,
  });
  assert.equal(cloned.ok, true);
  const afterClone = JSON.parse(store.state.rawText);
  assert.equal(afterClone.mcpServers['p1-local'].headers.Authorization, 'Bearer real-plugin-secret');
  assert.deepEqual(afterClone.mcpServers['p1-local'].disabledTools, ['t1']);

  // Legacy Stdio import requires confirmation and preserves real env secret
  const needConfirm = await svc.importLegacyServer({
    serverName: 'oldStdio',
    expectedSha256: cloned.sha256,
    confirmStdio: false,
  });
  assert.equal(needConfirm.ok, false);
  assert.equal(needConfirm.code, ERROR_CODES.CONFIRMATION_REQUIRED);

  const imported = await svc.importLegacyServer({
    serverName: 'oldStdio',
    expectedSha256: cloned.sha256,
    confirmStdio: true,
  });
  assert.equal(imported.ok, true);
  assert.equal(JSON.parse(store.state.rawText).mcpServers.oldStdio.env.API_TOKEN, 'real-legacy-secret');
  assert.equal(store.state.legacyRaw, legacyRaw);
});
