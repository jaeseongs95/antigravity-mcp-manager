import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ERROR_CODES } from '../../src/core/model.mjs';
import { sha256Hex } from '../../src/core/sha256.mjs';
import { createFsConfigStore } from '../../src/adapters/fs-config-store.mjs';
import { ANTIGRAVITY_DIALECT } from '../../src/adapters/antigravity/dialect.mjs';
import { resolveAntigravityPaths } from '../../src/adapters/antigravity/paths.mjs';
import { createAntigravityLsInspector } from '../../src/adapters/antigravity/ls-inspector.mjs';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agy-mcp-${prefix}-`));
}

test('NMCP-TC-011: fs-config-store enforces Write Jail (blocks config.json, plugins/*, parent directory junction/symlink escape, and plugin symlink escape)', async () => {
  const dir = makeTempDir('jail');
  try {
    assert.throws(
      () => createFsConfigStore({ globalConfigPath: path.join(dir, 'config.json') }),
      /Write jail violation/i
    );
    assert.throws(
      () => createFsConfigStore({ globalConfigPath: path.join(dir, 'plugins', 'demo', 'mcp_config.json') }),
      /Write jail violation/i
    );

    // Parent directory symlink (POSIX) / directory junction (Windows, works without admin/Dev Mode!)
    const outsideDir = path.join(dir, 'outside');
    fs.mkdirSync(outsideDir, { recursive: true });
    const escapedParent = path.join(dir, 'linked-cfg');
    fs.symlinkSync(outsideDir, escapedParent, process.platform === 'win32' ? 'junction' : 'dir');

    const junctionStore = createFsConfigStore({
      globalConfigPath: path.join(escapedParent, 'mcp_config.json'),
    });
    const wr = await junctionStore.writeGlobalConfig({
      rawText: '{"mcpServers":{}}\n',
      expectedSha256: null,
    });
    assert.equal(wr.ok, false);
    assert.equal(wr.code, ERROR_CODES.WRITE_JAIL_VIOLATION);
    assert.equal(fs.existsSync(path.join(outsideDir, 'mcp_config.json')), false);

    // Plugin root escape via directory junction MUST be skipped by readPluginConfigs
    const pluginRoot = path.join(dir, 'plugins');
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'mcp_config.json'), '{"mcpServers":{"evil":{"url":"https://evil.example/mcp"}}}\n', 'utf8');
    fs.symlinkSync(outsideDir, path.join(pluginRoot, 'escaped-plugin'), process.platform === 'win32' ? 'junction' : 'dir');
    const pluginStore = createFsConfigStore({
      globalConfigPath: path.join(dir, 'mcp_config.json'),
      pluginRoots: [pluginRoot],
    });
    const plugins = await pluginStore.readPluginConfigs();
    assert.equal(plugins.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('NMCP-TC-012: fs-config-store enforces atomic write, mandatory CAS, stale-lock atomic reclaim, and CAS-protected backup restore', async () => {
  const dir = makeTempDir('atomic');
  try {
    const targetPath = path.join(dir, 'mcp_config.json');
    const backupDir = path.join(dir, '.mcp-manager-backups');
    const store = createFsConfigStore({ globalConfigPath: targetPath, backupDir });

    // Missing expectedSha256 (undefined) rejected
    const noCas = await store.writeGlobalConfig({ rawText: '{"mcpServers":{}}\n' });
    assert.equal(noCas.ok, false);
    assert.equal(noCas.code, ERROR_CODES.VALIDATION_ERROR);

    const v1 = '{\n  "mcpServers": { "a": { "url": "https://a.example.com/mcp" } }\n}\n';
    const w1 = await store.writeGlobalConfig({ rawText: v1, expectedSha256: null });
    assert.equal(w1.ok, true);

    // Live lock returns LOCK_BUSY
    const lockPath = `${targetPath}.lock`;
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf8');
    const busy = await store.writeGlobalConfig({ rawText: v1, expectedSha256: w1.sha256 });
    assert.equal(busy.ok, false);
    assert.equal(busy.code, ERROR_CODES.LOCK_BUSY);

    // Expired stale lock (> 15s old) is reclaimed atomically via rename
    const oldTime = new Date(Date.now() - 30000);
    fs.utimesSync(lockPath, oldTime, oldTime);
    const v2 = '{\n  "mcpServers": { "b": { "url": "https://b.example.com/mcp" } }\n}\n';
    const w2 = await store.writeGlobalConfig({ rawText: v2, expectedSha256: w1.sha256 });
    assert.equal(w2.ok, true);

    // Corrupt disk and test restoreLastBackup CAS conflict + success
    const broken = '{ broken';
    fs.writeFileSync(targetPath, broken, 'utf8');
    const restoreConflict = await store.restoreLastBackup({ expectedSha256: w2.sha256 });
    assert.equal(restoreConflict.ok, false);
    assert.equal(restoreConflict.code, ERROR_CODES.CONFLICT);

    const restored = await store.restoreLastBackup({ expectedSha256: sha256Hex(broken) });
    assert.equal(restored.ok, true);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), v1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('NMCP-TC-013: Antigravity paths keep backups outside plugins/, and ls-inspector blocks non-loopback CSRF leakage (F4/F5)', async () => {
  assert.equal(ANTIGRAVITY_DIALECT.serversRootKey, 'mcpServers');
  assert.equal(ANTIGRAVITY_DIALECT.supportsNativeDisabled, true);

  const dir = makeTempDir('agy-paths');
  try {
    const paths = resolveAntigravityPaths({ homeDir: dir });
    assert.equal(paths.globalConfigPath, path.join(dir, '.gemini', 'config', 'mcp_config.json'));
    assert.equal(paths.backupDir.replace(/\\/g, '/').includes('/plugins/'), false);

    // Non-loopback lsAddress MUST make 0 network calls and NEVER send CSRF token
    let leakedCalls = 0;
    const remoteInspector = createAntigravityLsInspector({
      lsAddress: 'evil.example.com:60538',
      csrfToken: 'super-secret-csrf',
      fetchImpl: async () => {
        leakedCalls += 1;
        return { ok: true, async json() { return {}; } };
      },
    });
    const remoteRes = await remoteInspector.inspectRuntime();
    assert.equal(remoteRes.available, false);
    assert.equal(leakedCalls, 0);

    // Loopback lsAddress succeeds and redacts errors/tokens
    const calls = [];
    const loopbackInspector = createAntigravityLsInspector({
      lsAddress: '127.0.0.1:60538',
      csrfToken: 'super-secret-csrf',
      fetchImpl: async (url, init) => {
        calls.push({ url, csrf: init.headers['x-codeium-csrf-token'] });
        if (url.endsWith('/GetMcpServerStates')) {
          return {
            ok: true,
            async json() {
              return {
                states: [{ spec: { name: 'ledger' }, status: 'MCP_SERVER_STATUS_READY', tools: [{ name: 'query' }], error: 'Bearer leak-999', hasAuthToken: true }],
              };
            },
          };
        }
        return {
          ok: true,
          async json() {
            return { plugins: [{ name: 'sennard', path: '/home/.gemini/config/plugins/sennard', disabled: false, isGlobal: true, mcpServers: [{ name: 'sennard_sennard' }] }] };
          },
        };
      },
    });
    const rt = await loopbackInspector.inspectRuntime();
    assert.equal(rt.available, true);
    assert.equal(rt.servers.ledger.error.includes('leak-999'), false);
    assert.equal(JSON.stringify(rt).includes('super-secret-csrf'), false);
    assert.equal(calls.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
