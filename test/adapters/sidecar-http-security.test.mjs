import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpManagerService } from '../../src/core/manager-service.mjs';
import { createFsConfigStore } from '../../src/adapters/fs-config-store.mjs';
import { registerSidecarRoutes, STRICT_SIDECAR_CSP } from '../../src/adapters/sidecar/http-app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const UI_DIR = path.join(ROOT_DIR, 'sidecars', 'mcp_manager', 'ui');

class TestResponse {
  constructor(body, { contentType = 'text/plain', status = 200, headers = {} } = {}) {
    this.body = body;
    this.contentType = contentType;
    this.status = status;
    this.headers = headers;
  }
}

/**
 * Minimal loopback SidecarApp harness mirroring official `sidecar_sdk/index.mjs` token & routing semantics.
 */
class TestSidecarApp {
  constructor(token) {
    this.token = token;
    this.pages = new Map();
    this.apis = new Map();
    this.server = null;
  }
  page(p, h) { this.pages.set(p, h); }
  api(p, h, m = 'POST') {
    if (!this.apis.has(p)) this.apis.set(p, new Map());
    this.apis.get(p).set(m.toUpperCase(), h);
  }
  async start() {
    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method !== 'GET' && req.headers['x-sidecar-token'] !== this.token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (req.method === 'GET' && this.pages.has(url.pathname)) {
        const out = await this.pages.get(url.pathname)();
        res.writeHead(out.status || 200, { 'Content-Type': out.contentType, ...out.headers });
        res.end(out.body);
        return;
      }
      if (this.apis.has(url.pathname)) {
        const map = this.apis.get(url.pathname);
        if (!map.has(req.method)) {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', async () => {
          const data = body ? JSON.parse(body) : {};
          const out = await map.get(req.method)(data);
          res.writeHead(out.status || 200, { 'Content-Type': out.contentType, ...out.headers });
          res.end(out.body);
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    });
    await new Promise((r) => this.server.listen(0, '127.0.0.1', r));
    return this.server.address().port;
  }
  async close() {
    if (this.server) await new Promise((r) => this.server.close(r));
  }
}

test('NMCP-TC-014: Official plugin.json and sidecar.json contract (no unknown fields, AUX_PANE, zero SKILL.md / app.asar)', () => {
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'plugin.json'), 'utf8'));
  const allowedTopFields = new Set(['name', 'displayName', 'description', 'version', 'logo', 'author', 'homepage', 'repository', 'suggestedPrompts', 'disabled']);
  for (const key of Object.keys(pluginManifest)) {
    assert.equal(allowedTopFields.has(key), true, `Unexpected top-level field in plugin.json: ${key}`);
  }
  assert.equal(fs.existsSync(path.join(ROOT_DIR, pluginManifest.logo)), true);

  const sidecarManifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'sidecars/mcp_manager/sidecar.json'), 'utf8'));
  assert.equal(sidecarManifest.has_web_ui, true);
  assert.equal(sidecarManifest.ui_config.views[0].entrypoint, 'SIDECAR_UI_ENTRYPOINT_AUX_PANE');

  // Zero SKILL.md and zero legacy app.asar patcher files
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'skills')), false);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'dist')), false);
});

test('NMCP-TC-015 & NMCP-TC-016: Sidecar APIs are POST-only with token enforcement, strict CSP, zero child_process, and masked secrets', async () => {
  // Static check: zero child_process in sidecar adapter & entrypoint
  const sidecarFiles = [
    path.join(ROOT_DIR, 'src/adapters/sidecar/http-app.mjs'),
    path.join(ROOT_DIR, 'sidecars/mcp_manager/main.mjs'),
  ];
  for (const f of sidecarFiles) {
    const src = fs.readFileSync(f, 'utf8');
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.equal(/child_process|spawnSync|execFile|execSync/.test(codeOnly), false, `Forbidden process execution in ${f}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-sidecar-http-'));
  const token = 'test-session-token-256bit';
  const app = new TestSidecarApp(token);
  try {
    const configPath = path.join(tmpDir, 'mcp_config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          secretSrv: {
            url: 'https://api.example.com/mcp',
            headers: { Authorization: 'Bearer ultra-secret-value' },
          },
        },
      }, null, 2) + '\n',
      'utf8'
    );
    const store = createFsConfigStore({ globalConfigPath: configPath, backupDir: path.join(tmpDir, '.backups') });
    const service = new McpManagerService({ configStore: store });
    registerSidecarRoutes({ app, ResponseClass: TestResponse, service, uiDir: UI_DIR });

    const port = await app.start();
    const base = `http://127.0.0.1:${port}`;

    // 1. GET / serves HTML with strict CSP & no-store
    const pageRes = await fetch(`${base}/`);
    assert.equal(pageRes.status, 200);
    assert.equal(pageRes.headers.get('content-security-policy'), STRICT_SIDECAR_CSP);
    assert.equal(pageRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(pageRes.headers.get('cache-control'), 'no-store');

    // 2. GET /api/snapshot rejected with 405 Method Not Allowed
    const getApiRes = await fetch(`${base}/api/snapshot`);
    assert.equal(getApiRes.status, 405);

    // 3. Unauthenticated POST /api/snapshot rejected with 401
    const unauthRes = await fetch(`${base}/api/snapshot`, { method: 'POST', body: '{}' });
    assert.equal(unauthRes.status, 401);

    // 4. Authenticated POST /api/snapshot succeeds and masks secret values
    const authRes = await fetch(`${base}/api/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sidecar-token': token },
      body: JSON.stringify({}),
    });
    assert.equal(authRes.status, 200);
    assert.equal(authRes.headers.get('content-security-policy'), STRICT_SIDECAR_CSP);
    const snapText = await authRes.text();
    assert.equal(snapText.includes('ultra-secret-value'), false);
    const snapJson = JSON.parse(snapText);
    assert.equal(snapJson.ok, true);
    assert.equal(snapJson.globalConfig.servers[0].name, 'secretSrv');

    // 5. Stale CAS upsert returns HTTP 409
    const conflictRes = await fetch(`${base}/api/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sidecar-token': token },
      body: JSON.stringify({
        name: 'newSrv',
        spec: { url: 'https://new.example.com/mcp' },
        expectedSha256: '0'.repeat(64),
      }),
    });
    assert.equal(conflictRes.status, 409);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
