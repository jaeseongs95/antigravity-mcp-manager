import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

    // 1. DNS-rebinding & userinfo Host headers rejected with 403
    const badHost = await sendRawHttpRequest({
      port,
      headers: { Host: 'attacker.example:1234', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(badHost.status, 403);

    const userinfoHost = await sendRawHttpRequest({
      port,
      headers: { Host: '127.0.0.1@evil.example:80', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(userinfoHost.status, 403);

    // 2. Cross-site, cross-port loopback, null Origin & Sec-Fetch-Site: same-site rejected with 403
    const badOrigin = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, Origin: 'https://evil.example', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(badOrigin.status, 403);

    const crossPortOrigin = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, Origin: 'http://localhost:3000', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(crossPortOrigin.status, 403);

    const nullOrigin = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, Origin: 'null', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(nullOrigin.status, 403);

    const badFetchSite = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(badFetchSite.status, 403);

    const sameSiteFetch = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-site', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(sameSiteFetch.status, 403);

    // 2b. Empty token fails closed (401 on POST, never fail-open)
    const emptyTokenApp = new TestSidecarApp();
    registerSidecarRoutes({ app: emptyTokenApp, ResponseClass: TestResponse, service, uiDir: UI_DIR });
    const emptyPort = await emptyTokenApp.start('', 1024);
    try {
      const failClosedRes = await sendRawHttpRequest({
        port: emptyPort,
        headers: { Host: `127.0.0.1:${emptyPort}`, 'Content-Type': 'application/json' },
      });
      assert.equal(failClosedRes.status, 401);
    } finally {
      await emptyTokenApp.close();
    }

    // 2c. WRITE_JAIL_VIOLATION thrown by service maps to 403, untyped error maps to 500 IO_ERROR (NB5)
    const jailApp = new TestSidecarApp();
    let throwUntyped = false;
    const throwingService = {
      getSnapshot: async () => {
        if (throwUntyped) throw new Error('Disk exploded with secret Bearer topsecret123');
        throw Object.assign(new Error('Write jail violation: symlink'), { code: 'WRITE_JAIL_VIOLATION' });
      },
    };
    registerSidecarRoutes({ app: jailApp, ResponseClass: TestResponse, service: throwingService, uiDir: UI_DIR });
    const jailPort = await jailApp.start(token, 1024);
    try {
      const jailRes = await sendRawHttpRequest({
        port: jailPort,
        headers: { Host: `127.0.0.1:${jailPort}`, 'x-sidecar-token': token, 'Content-Type': 'application/json' },
      });
      assert.equal(jailRes.status, 403);
      assert.equal(JSON.parse(jailRes.body).code, 'WRITE_JAIL_VIOLATION');

      throwUntyped = true;
      const err500Res = await sendRawHttpRequest({
        port: jailPort,
        headers: { Host: `127.0.0.1:${jailPort}`, 'x-sidecar-token': token, 'Content-Type': 'application/json' },
      });
      assert.equal(err500Res.status, 500);
      assert.equal(JSON.parse(err500Res.body).code, 'IO_ERROR');
      assert.equal(err500Res.body.includes('topsecret123'), false, '500 error message must redact Bearer tokens');
    } finally {
      await jailApp.close();
    }

    // 2d. Cross-origin iframe GET / with Sec-Fetch-Site: cross-site succeeds (200 + strict CSP) for AUX_PANE (R6 F1),
    // while GET / with attacker Host STILL fails with 403.
    const crossSiteGet = await sendRawHttpRequest({
      port,
      method: 'GET',
      reqPath: '/',
      headers: { Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site' },
      body: '',
    });
    assert.equal(crossSiteGet.status, 200);
    assert.equal(crossSiteGet.headers['content-security-policy'], STRICT_SIDECAR_CSP);

    const badHostGet = await sendRawHttpRequest({
      port,
      method: 'GET',
      reqPath: '/',
      headers: { Host: 'evil.example:80', 'Sec-Fetch-Site': 'cross-site' },
      body: '',
    });
    assert.equal(badHostGet.status, 403);

    // 3. Unauthenticated POST rejected with 401
    const unauth = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' },
    });
    assert.equal(unauth.status, 401);

    // 4. Oversized body (> 1024 bytes) rejected with 413 — BOTH Content-Length AND Transfer-Encoding: chunked (R3 F3)
    const bigBody = JSON.stringify({ pad: 'A'.repeat(1500) });
    const tooLarge = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, 'x-sidecar-token': token, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(bigBody)) },
      body: bigBody,
    });
    assert.equal(tooLarge.status, 413);

    const chunkedTooLarge = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/api/snapshot',
          headers: { Host: `127.0.0.1:${port}`, 'x-sidecar-token': token, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        }
      );
      req.on('error', (err) => {
        // Server may destroy socket after sending 413; ignore ECONNRESET if response already received
        if (err && err.code === 'ECONNRESET') return;
        reject(err);
      });
      req.write('{"pad":"' + 'B'.repeat(600));
      req.write('C'.repeat(700) + '"}');
      req.end();
    });
    assert.equal(chunkedTooLarge.status, 413);

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

test('NMCP-TC-015B (Real Entrypoint): sidecars/mcp_manager/main.mjs boots with real sidecar_sdk and serves assets + security guards', async (t) => {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const sdkLoader = path.join(home, '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'register_loader.js');
  if (!fs.existsSync(sdkLoader)) {
    t.skip('Antigravity Desktop sidecar_sdk is not installed on this host');
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
    ['--import', pathToFileURL(sdkLoader).href, path.join(ROOT_DIR, 'sidecars/mcp_manager/main.mjs')],
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

    // Verify GET /, /styles.css, /app.js (strict CSP + nosniff) and /preload.js (200)
    // including Sec-Fetch-Site: cross-site for Antigravity Desktop AUX_PANE cross-origin iframe (R6 F1)
    for (const assetPath of ['/', '/styles.css', '/app.js']) {
      const assetRes = await sendRawHttpRequest({
        port,
        method: 'GET',
        reqPath: assetPath,
        headers: { Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site' },
        body: '',
      });
      assert.equal(assetRes.status, 200, `Expected 200 for cross-site iframe GET ${assetPath}`);
      assert.equal(assetRes.headers['content-security-policy'], STRICT_SIDECAR_CSP);
      assert.equal(assetRes.headers['x-content-type-options'], 'nosniff');
    }
    const preloadRes = await sendRawHttpRequest({
      port,
      method: 'GET',
      reqPath: '/preload.js',
      headers: { Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site' },
      body: '',
    });
    assert.equal(preloadRes.status, 200, 'Expected 200 for cross-site iframe GET /preload.js from real sidecar_sdk');

    // GET /api/snapshot MUST be rejected with 405
    const getApiRes = await sendRawHttpRequest({
      port,
      method: 'GET',
      reqPath: '/api/snapshot',
      headers: { Host: `127.0.0.1:${port}` },
      body: '',
    });
    assert.equal(getApiRes.status, 405);

    const badHost = await sendRawHttpRequest({
      port,
      headers: { Host: 'evil.example:999', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(badHost.status, 403);

    const badOrigin = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, Origin: 'http://localhost:3000', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(badOrigin.status, 403);

    const badFetchSite = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-site', 'x-sidecar-token': token, 'Content-Type': 'application/json' },
    });
    assert.equal(badFetchSite.status, 403);

    const unauth = await sendRawHttpRequest({
      port,
      headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' },
    });
    assert.equal(unauth.status, 401);

    // Chunked > 1 MiB MUST return 413 without crashing real sidecar_sdk server
    const realChunked413 = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/api/snapshot',
          headers: {
            Host: `127.0.0.1:${port}`,
            Origin: `http://127.0.0.1:${port}`,
            'Sec-Fetch-Site': 'same-origin',
            'x-sidecar-token': token,
            'Content-Type': 'application/json',
            'Transfer-Encoding': 'chunked',
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        }
      );
      req.on('error', (err) => {
        if (err && err.code === 'ECONNRESET') return;
        reject(err);
      });
      const half = 'X'.repeat(600 * 1024);
      req.write('{"pad":"' + half);
      req.write(half + '"}');
      req.end();
    });
    assert.equal(realChunked413.status, 413);

    // Workspace .agents/plugins discovery over real sidecar_sdk
    const wsDir = path.join(tmpHome, 'sample-ws');
    const wsPlugDir = path.join(wsDir, '.agents', 'plugins', 'ws-real');
    fs.mkdirSync(wsPlugDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsPlugDir, 'mcp_config.json'),
      JSON.stringify({ mcpServers: { wsRealSrv: { url: 'https://wsreal.example/mcp' } } }),
      'utf8'
    );
    const wsUri = pathToFileURL(wsDir).href;

    const okRes = await sendRawHttpRequest({
      port,
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Sec-Fetch-Site': 'same-origin',
        'x-sidecar-token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workspaceUris: [wsUri] }),
    });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers['content-security-policy'], STRICT_SIDECAR_CSP);
    assert.equal(okRes.body.includes('real-tok'), false);
    assert.equal(okRes.body.includes('dummy-csrf-not-leaked'), false);
    const parsedSnap = JSON.parse(okRes.body);
    assert.equal(parsedSnap.globalConfig.servers[0].name, 'realSrv');
    assert.equal(parsedSnap.pluginServers.some((p) => p.pluginDir === 'ws-real' && p.name === 'wsRealSrv'), true);

    // 428 Precondition Required (Stdio confirmStdio: false) on real sidecar_sdk
    const stdio428 = await sendRawHttpRequest({
      port,
      reqPath: '/api/upsert',
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Sec-Fetch-Site': 'same-origin',
        'x-sidecar-token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'cmd1',
        spec: { command: 'node', args: ['a.js'] },
        expectedSha256: parsedSnap.globalConfig.sha256,
        confirmStdio: false,
      }),
    });
    assert.equal(stdio428.status, 428);

    // 409 Conflict (stale expectedSha256) on real sidecar_sdk
    const conflict409 = await sendRawHttpRequest({
      port,
      reqPath: '/api/upsert',
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        'Sec-Fetch-Site': 'same-origin',
        'x-sidecar-token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'http2',
        spec: { url: 'https://h2.example/mcp' },
        expectedSha256: '0'.repeat(64),
        confirmStdio: false,
      }),
    });
    assert.equal(conflict409.status, 409);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 100));
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
