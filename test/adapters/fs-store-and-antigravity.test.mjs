import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ERROR_CODES } from '../../src/core/model.mjs';
import { createFsConfigStore } from '../../src/adapters/fs-config-store.mjs';
import { ANTIGRAVITY_DIALECT } from '../../src/adapters/antigravity/dialect.mjs';
import { resolveAntigravityPaths } from '../../src/adapters/antigravity/paths.mjs';
import { createAntigravityLsInspector } from '../../src/adapters/antigravity/ls-inspector.mjs';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agy-mcp-${prefix}-`));
}

test('NMCP-TC-011: fs-config-store enforces Write Jail (blocks config.json, plugins/*, and symlink targets)', async () => {
  const dir = makeTempDir('jail');
  try {
    // config.json MUST be refused immediately
    assert.throws(
      () => createFsConfigStore({ globalConfigPath: path.join(dir, 'config.json') }),
      /Write jail violation/i
    );
    // plugins/*/mcp_config.json MUST be refused immediately
    assert.throws(
      () => createFsConfigStore({ globalConfigPath: path.join(dir, 'plugins', 'demo', 'mcp_config.json') }),
      /Write jail violation/i
    );

    // Symlink target refused on read/write (best-effort if OS permits symlink creation)
    const outsideFile = path.join(dir, 'outside.json');
    fs.writeFileSync(outsideFile, '{"mcpServers":{}}\n', 'utf8');
    const linkDir = path.join(dir, 'cfg');
    fs.mkdirSync(linkDir, { recursive: true });
    const linkPath = path.join(linkDir, 'mcp_config.json');
    let symlinkCreated = false;
    try {
      fs.symlinkSync(outsideFile, linkPath);
      symlinkCreated = true;
    } catch {
      // Windows without Developer Mode may disallow file symlinks; skip symlink sub-assertion only
    }
    if (symlinkCreated) {
      const store = createFsConfigStore({ globalConfigPath: linkPath });
      const wr = await store.writeGlobalConfig({ rawText: '{"mcpServers":{}}\n', expectedSha256: undefined });
      assert.equal(wr.ok, false);
      assert.equal(wr.code, ERROR_CODES.WRITE_JAIL_VIOLATION);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('NMCP-TC-012: fs-config-store performs atomic write, CAS conflict, lock rejection, and private backup restore', async () => {
  const dir = makeTempDir('atomic');
  try {
    const targetPath = path.join(dir, 'mcp_config.json');
    const backupDir = path.join(dir, '.backups');
    const store = createFsConfigStore({ globalConfigPath: targetPath, backupDir });

    const r0 = await store.readGlobalConfig();
    assert.equal(r0.exists, false);

    const v1 = '{\n  "mcpServers": { "a": { "url": "https://a.example.com/mcp" } }\n}\n';
    const w1 = await store.writeGlobalConfig({ rawText: v1, expectedSha256: null });
    assert.equal(w1.ok, true);

    // Lock contention returns LOCK_BUSY
    const lockPath = `${targetPath}.lock`;
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf8');
    const busy = await store.writeGlobalConfig({ rawText: v1, expectedSha256: w1.sha256 });
    assert.equal(busy.ok, false);
    assert.equal(busy.code, ERROR_CODES.LOCK_BUSY);
    fs.unlinkSync(lockPath);

    // Write v2 creates backup of v1
    const v2 = '{\n  "mcpServers": { "b": { "url": "https://b.example.com/mcp" } }\n}\n';
    const w2 = await store.writeGlobalConfig({ rawText: v2, expectedSha256: w1.sha256 });
    assert.equal(w2.ok, true);

    // Stale CAS fails
    const stale = await store.writeGlobalConfig({ rawText: v1, expectedSha256: w1.sha256 });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, ERROR_CODES.CONFLICT);

    // Corrupt disk and restore last-good backup (v1)
    fs.writeFileSync(targetPath, '{ broken', 'utf8');
    const restored = await store.restoreLastBackup();
    assert.equal(restored.ok, true);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), v1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('NMCP-TC-013: Antigravity dialect, paths, and read-only LS inspector return redacted DTOs without leaking CSRF token', async () => {
  assert.equal(ANTIGRAVITY_DIALECT.serversRootKey, 'mcpServers');
  assert.equal(ANTIGRAVITY_DIALECT.supportsNativeDisabled, true);

  const dir = makeTempDir('agy-paths');
  try {
    const paths = resolveAntigravityPaths({ homeDir: dir });
    assert.equal(paths.globalConfigPath, path.join(dir, '.gemini', 'config', 'mcp_config.json'));
    assert.equal(paths.legacyConfigPath, path.join(dir, '.gemini', 'antigravity', 'mcp_config.json'));

    const calls = [];
    const fakeFetch = async (url, init) => {
      calls.push({ url, csrf: init.headers['x-codeium-csrf-token'] });
      if (url.endsWith('/GetMcpServerStates')) {
        return {
          ok: true,
          async json() {
            return {
              states: [
                {
                  spec: { name: 'ledger' },
                  status: 'MCP_SERVER_STATUS_READY',
                  tools: [{ name: 'query' }, { name: 'save' }],
                  error: 'Auth failed with Bearer secret-token-999',
                  hasAuthToken: true,
                },
              ],
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            plugins: [{ name: 'sennard', path: '/home/.gemini/config/plugins/sennard', disabled: false, isGlobal: true, mcpServers: [{ name: 'sennard_sennard' }] }],
          };
        },
      };
    };

    const inspector = createAntigravityLsInspector({
      lsAddress: '127.0.0.1:60538',
      csrfToken: 'super-secret-csrf',
      fetchImpl: fakeFetch,
    });
    const rt = await inspector.inspectRuntime();
    assert.equal(rt.available, true);
    assert.equal(rt.servers.ledger.toolCount, 2);
    assert.equal(rt.servers.ledger.error.includes('secret-token-999'), false);
    assert.equal(JSON.stringify(rt).includes('super-secret-csrf'), false);
    assert.equal(calls.length, 2);
    assert.equal(calls.every((c) => c.csrf === 'super-secret-csrf'), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
