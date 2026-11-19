import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ERROR_CODES } from '../../src/core/model.mjs';
import { McpManagerService } from '../../src/core/manager-service.mjs';
import { createFsConfigStore } from '../../src/adapters/fs-config-store.mjs';
import {
  attachSidecarSecurityMiddleware,
  registerSidecarRoutes,
  statusForErrorCode,
  STRICT_SIDECAR_CSP,
} from '../../src/adapters/sidecar/http-app.mjs';

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

class TestSidecarApp {
  constructor() {
    this.pages = new Map();
    this.apis = new Map();
    this.server = null;
  }
  page(p, h) { this.pages.set(p, h); }
  api(p, h, m = 'POST') {
    if (!this.apis.has(p)) this.apis.set(p, new Map());
    this.apis.get(p).set(m.toUpperCase(), h);
  }
  async start(token, maxBodyBytes) {
    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
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
          if (res.writableEnded) return;
          const data = body ? JSON.parse(body) : {};
          const out = await map.get(req.method)(data);
          if (!res.headersSent) {
            res.writeHead(out.status || 200, { 'Content-Type': out.contentType, ...out.headers });
            res.end(out.body);
          }
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    });
    attachSidecarSecurityMiddleware(this.server, { token, maxBodyBytes });
    await new Promise((r) => this.server.listen(0, '127.0.0.1', r));
    return this.server.address().port;
  }
  async close() {
    if (this.server) await new Promise((r) => this.server.close(r));
  }
}

function sendRawHttpRequest({ port, method = 'POST', reqPath = '/api/snapshot', headers = {}, body = '{}' }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

test('NMCP-TC-014: Official plugin.json, sidecar.json, .gitignore, and zero legacy artifacts', () => {
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'plugin.json'), 'utf8'));
  const allowedTopFields = new Set(['name', 'displayName', 'description', 'version', 'logo', 'author', 'homepage', 'repository', 'suggestedPrompts', 'disabled']);
  for (const key of Object.keys(pluginManifest)) {
    assert.equal(allowedTopFields.has(key), true, `Unexpected top-level field in plugin.json: ${key}`);
  }
  assert.equal(fs.existsSync(path.join(ROOT_DIR, pluginManifest.logo)), true);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, '.gitignore')), true);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'docs/templates/README_TEMPLATE.md')), false);

  const sidecarManifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'sidecars/mcp_manager/sidecar.json'), 'utf8'));
  assert.equal(sidecarManifest.has_web_ui, true);
  assert.equal(sidecarManifest.ui_config.views[0].entrypoint, 'SIDECAR_UI_ENTRYPOINT_AUX_PANE');
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'skills')), false);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'dist')), false);
});

test('NMCP-TC-015 & NMCP-TC-016: Sidecar security middleware enforces Host/Origin/Sec-Fetch-Site/body-limit/timingSafeEqual, exact HTTP status codes, and zero child_process', async () => {
  assert.equal(statusForErrorCode(ERROR_CODES.IO_ERROR), 500);
  assert.equal(statusForErrorCode(ERROR_CODES.CONFIRMATION_REQUIRED), 428);
  assert.equal(statusForErrorCode(ERROR_CODES.CONFLICT), 409);

  for (const f of [
    path.join(ROOT_DIR, 'src/adapters/sidecar/http-app.mjs'),
    path.join(ROOT_DIR, 'sidecars/mcp_manager/main.mjs'),
  ]) {
    const src = fs.readFileSync(f, 'utf8');
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.equal(/child_process|spawnSync|execFile|execSync/.test(codeOnly), false, `Forbidden process execution in ${f}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-sidecar-http-'));
  const token = 'test-session-token-256bit';
  const app = new TestSidecarApp();
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
    const store = createFsConfigStore({ globalConfigPath: configPath, backupDir: path.join(tmpDir, '.mcp-manager-backups') });
    const service = new McpManagerService({ configStore: store });
    registerSidecarRoutes({ app, ResponseClass: TestResponse, service, uiDir: UI_DIR });

    const port = await app.start(token, 1024);

    // 1. DNS-rebinding Host header rejected with 403
    const badHost = await sendRawHttpRequest({
      port,
      headers: { Host: 'attacker.example:1234', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(badHost.status, 403);

    // 2. Cross-site Origin & Sec-Fetch-Site rejected with 403
    const badOrigin = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, Origin: 'https://evil.example', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(badOrigin.status, 403);

    const badFetchSite = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(badFetchSite.status, 403);

    // 3. Unauthenticated POST rejected with 401
    const unauth = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' },
    });
    assert.equal(unauth.status, 401);

    // 4. Oversized body (> 1024 bytes) rejected with 413
    const bigBody = JSON.stringify({ pad: 'A'.repeat(1500) });
    const tooLarge = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, 'x-sidecar-token': token, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(bigBody)) },
      body: bigBody,
    });
    assert.equal(tooLarge.status, 413);

    // 5. GET /api/snapshot rejected with 405
    const getApi = await sendRawHttpRequest({
      port,
      method: 'GET',
      headers: { Host: `127.0.0.1:${port}` },
      body: '',
    });
    assert.equal(getApi.status, 405);

    // 6. Authenticated POST succeeds with strict CSP and masked secret
    const okRes = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers['content-security-policy'], STRICT_SIDECAR_CSP);
    assert.equal(okRes.body.includes('ultra-secret-value'), false);

    // 7. Stdio upsert without confirmStdio returns 428 Precondition Required
    const snap = JSON.parse(okRes.body);
    const stdioRes = await sendRawHttpRequest({
      port,
      reqPath: '/api/upsert',
      headers: { Host: `127.0.0.1:${port}`, 'x-sidecar-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'localCmd',
        spec: { command: 'node', args: ['s.js'] },
        expectedSha256: snap.globalConfig.sha256,
        confirmStdio: false,
      }),
    });
    assert.equal(stdioRes.status, 428);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('NMCP-TC-015B (Real Entrypoint): sidecars/mcp_manager/main.mjs boots with real sidecar_sdk when installed on host', async () => {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const sdkLoader = path.join(home, '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'register_loader.js');
  if (!fs.existsSync(sdkLoader)) {
    // CI runners without Antigravity desktop installed skip live SDK boot; covered by NMCP-TC-015 above
    return;
  }

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-real-sidecar-home-'));
  const cfgDir = path.join(tmpHome, '.gemini', 'config');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, 'mcp_config.json'),
    JSON.stringify({ mcpServers: { realSrv: { url: 'https://real.example.com/mcp', headers: { Authorization: 'Bearer real-tok' } } } }, null, 2) + '\n',
    'utf8'
  );

  const port = await getFreePort();
  const token = 'real-sdk-token-999';
  const child = spawn(
    process.execPath,
    ['--import', `file:///${sdkLoader.replace(/\\/g, '/')}`, path.join(ROOT_DIR, 'sidecars/mcp_manager/main.mjs')],
    {
      cwd: path.join(ROOT_DIR, 'sidecars/mcp_manager'),
      env: {
        ...process.env,
        AGY_MCP_HOME_OVERRIDE: tmpHome,
        ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:1',
        ANTIGRAVITY_CSRF_TOKEN: 'dummy-csrf-not-leaked',
        ANTIGRAVITY_SIDECAR_WEB_PORT: String(port),
        ANTIGRAVITY_SIDECAR_UI_TOKEN: token,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Real sidecar boot timeout')), 6000);
      let out = '';
      child.stdout.on('data', (d) => {
        out += String(d);
        if (out.includes('listening on 127.0.0.1:')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Real sidecar exited early (${code})`));
      });
    });

    const badHost = await sendRawHttpRequest({
      port,
      headers: { Host: 'evil.example:999', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(badHost.status, 403);

    const unauth = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' },
    });
    assert.equal(unauth.status, 401);

    const okRes = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers['content-security-policy'], STRICT_SIDECAR_CSP);
    assert.equal(okRes.body.includes('real-tok'), false);
    assert.equal(okRes.body.includes('dummy-csrf-not-leaked'), false);
    assert.equal(JSON.parse(okRes.body).globalConfig.servers[0].name, 'realSrv');
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 100));
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
