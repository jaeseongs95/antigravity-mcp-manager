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
      const currentSha = state.exists ? sha256Hex(state.rawText) : null;
      if (expectedSha256 !== undefined && currentSha !== expectedSha256) {
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
    async restoreLastBackup() {
      if (!state.backupText) return { ok: false, code: ERROR_CODES.NOT_FOUND, error: 'No backup' };
      state.exists = true;
      state.rawText = state.backupText;
      return { ok: true, sha256: sha256Hex(state.rawText) };
    },
  };
}

test('NMCP-TC-007: lossless unknown-key preservation & masked secret preservation across updates and toggles', async () => {
  const initial = JSON.stringify({
    $schema: 'https://example.com/mcp-schema.json',
    customTopLevel: { keepMe: true },
    mcpServers: {
      api: {
        url: 'https://api.example.com/mcp',
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

  // Edit URL while sending back masked Authorization -> real secret + unknown keys MUST be preserved!
  const res = await svc.upsertServer({
    name: 'api',
    originalName: 'api',
    spec: {
      url: 'https://api-v2.example.com/mcp',
      headers: { Authorization: REDACTED_MASK },
    },
    expectedSha256: snap.globalConfig.sha256,
  });
  assert.equal(res.ok, true);

  const saved = JSON.parse(store.state.rawText);
  assert.equal(saved.customTopLevel.keepMe, true);
  assert.equal(saved.mcpServers.api.url, 'https://api-v2.example.com/mcp');
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

test('NMCP-TC-009: stale baseSha256 CAS rejects with CONFLICT without mutating disk', async () => {
  const store = createMemoryStore({ initialRaw: '{\n  "mcpServers": {}\n}\n' });
  const svc = new McpManagerService({ configStore: store });
  const snap = await svc.getSnapshot();

  // Simulate concurrent external edit
  store.state.rawText = '{\n  "mcpServers": { "ext": { "url": "https://ext.example.com/mcp" } }\n}\n';

  const conflict = await svc.upsertServer({
    name: 'mine',
    spec: { url: 'https://mine.example.com/mcp' },
    expectedSha256: snap.globalConfig.sha256,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, ERROR_CODES.CONFLICT);
  assert.equal(JSON.parse(store.state.rawText).mcpServers.mine, undefined);
});

test('NMCP-TC-010: ManagerService enforces Stdio confirmation gate, RO plugin clone, and non-mutating legacy import', async () => {
  const pluginRaw = JSON.stringify({
    mcpServers: { p1: { url: 'https://plugin.example.com/mcp' } },
  });
  const legacyRaw = JSON.stringify({
    mcpServers: { oldStdio: { command: 'node', args: ['old.js'] } },
  });
  const store = createMemoryStore({
    initialRaw: '{\n  "mcpServers": {}\n}\n',
    plugins: [{ pluginName: 'Demo Plugin', pluginDir: 'demo', rawText: pluginRaw, displayPath: '/plugins/demo/mcp_config.json' }],
    legacyRaw,
  });
  const svc = new McpManagerService({ configStore: store });
  const snap = await svc.getSnapshot();
  assert.equal(snap.pluginServers.length, 1);
  assert.equal(snap.pluginServers[0].readOnly, true);
  assert.equal(snap.legacyImport.exists, true);

  // Clone HTTP plugin server to global
  const cloned = await svc.clonePluginServer({
    pluginDir: 'demo',
    serverName: 'p1',
    targetName: 'p1-local',
    expectedSha256: snap.globalConfig.sha256,
  });
  assert.equal(cloned.ok, true);

  // Legacy Stdio import requires explicit confirmStdio
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
  // Legacy source remains untouched
  assert.equal(store.state.legacyRaw, legacyRaw);
});
