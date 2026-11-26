import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { startDesktopMcpServer } from '../../src/adapters/antigravity/desktop-server.mjs';
import { V3_IDS } from '../../src/adapters/antigravity/renderer/mcp-v3-shell.mjs';
import {
  buildAddonContextV3HarnessScript,
  findChromiumBinary,
  launchCdpSession,
  waitUntil,
} from '../helpers/cdp-browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const APP_JS_PATH = path.join(ROOT_DIR, 'src', 'ui', 'app.js');
const RENDERER_PATH = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'addon-renderer.js');
const MANIFEST_PATH = path.join(ROOT_DIR, 'addon-manifest.json');

function httpRequest({ port, method = 'GET', reqPath = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path: reqPath,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

test('NMCP-TC-023 (Unit): desktop-server.mjs enforces security guards, error codes, and full CRUD lifecycle', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-desktop-srv-unit-'));
  const cfgDir = path.join(tmpDir, '.gemini', 'config');
  fs.mkdirSync(cfgDir, { recursive: true });
  const srv = await startDesktopMcpServer({ homeDir: tmpDir });

  try {
    // 1. Loopback & 256-bit random hex token contract
    assert.ok(Number.isInteger(srv.port) && srv.port > 0);
    assert.match(srv.token, /^[0-9a-f]{64}$/);
    assert.equal(srv.url, `http://127.0.0.1:${srv.port}/?token=${srv.token}`);

    // 2. Static assets & minimal preload.js
    const indexRes = await httpRequest({ port: srv.port, method: 'GET', reqPath: '/' });
    assert.equal(indexRes.status, 200);
    assert.match(indexRes.headers['content-type'], /text\/html/);
    assert.ok(indexRes.headers['content-security-policy']);

    const preloadRes = await httpRequest({ port: srv.port, method: 'GET', reqPath: '/preload.js' });
    assert.equal(preloadRes.status, 200);
    assert.match(preloadRes.headers['content-type'], /application\/javascript/);
    assert.equal(preloadRes.text.includes('getWorkspaceUris'), true);

    // 3. Error codes: 404, 405, 401 (missing/wrong token), 403 (cross-site/origin), 400 (bad JSON)
    const notFound = await httpRequest({ port: srv.port, method: 'GET', reqPath: '/does-not-exist' });
    assert.equal(notFound.status, 404);

    const methodNotAllowed = await httpRequest({ port: srv.port, method: 'GET', reqPath: '/api/snapshot' });
    assert.equal(methodNotAllowed.status, 405);

    const noToken = await httpRequest({ port: srv.port, method: 'POST', reqPath: '/api/snapshot', body: '{}' });
    assert.equal(noToken.status, 401);

    const wrongToken = await httpRequest({
      port: srv.port,
      method: 'POST',
      reqPath: '/api/snapshot',
      headers: { 'x-sidecar-token': '0'.repeat(64) },
      body: '{}',
    });
    assert.equal(wrongToken.status, 401);

    const crossSite = await httpRequest({
      port: srv.port,
      method: 'POST',
      reqPath: '/api/snapshot',
      headers: { 'x-sidecar-token': srv.token, 'sec-fetch-site': 'cross-site' },
      body: '{}',
    });
    assert.equal(crossSite.status, 403);

    const evilOrigin = await httpRequest({
      port: srv.port,
      method: 'POST',
      reqPath: '/api/snapshot',
      headers: { 'x-sidecar-token': srv.token, origin: 'https://evil.example' },
      body: '{}',
    });
    assert.equal(evilOrigin.status, 403);

    const badJson = await httpRequest({
      port: srv.port,
      method: 'POST',
      reqPath: '/api/snapshot',
      headers: { 'x-sidecar-token': srv.token, 'content-type': 'application/json' },
      body: '{invalid-json',
    });
    assert.equal(badJson.status, 400);

    // 4. Full CRUD round-trip via desktop-server.mjs
    const postApi = async (reqPath, payload) => {
      const res = await httpRequest({
        port: srv.port,
        method: 'POST',
        reqPath,
        headers: {
          'x-sidecar-token': srv.token,
          'content-type': 'application/json',
          origin: `http://127.0.0.1:${srv.port}`,
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify(payload),
      });
      return { status: res.status, json: JSON.parse(res.text) };
    };

    const snap0 = await postApi('/api/snapshot', { workspaceUris: [] });
    assert.equal(snap0.status, 200);
    assert.equal(snap0.json.ok, true);
    assert.equal(snap0.json.globalConfig.servers.length, 0);

    const created = await postApi('/api/upsert', {
      name: 'demoHttp',
      spec: { url: 'https://demo.example/mcp' },
      expectedSha256: snap0.json.globalConfig.sha256,
    });
    assert.equal(created.status, 200);
    assert.equal(created.json.ok, true);
    const snap1 = await postApi('/api/snapshot', { workspaceUris: [] });
    assert.equal(snap1.json.globalConfig.servers.length, 1);
    assert.equal(snap1.json.globalConfig.servers[0].name, 'demoHttp');
    assert.equal(snap1.json.globalConfig.servers[0].disabled, false);

    const disabled = await postApi('/api/toggle-disabled', {
      name: 'demoHttp',
      disabled: true,
      expectedSha256: snap1.json.globalConfig.sha256,
    });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.json.ok, true);
    const snap2 = await postApi('/api/snapshot', { workspaceUris: [] });
    assert.equal(snap2.json.globalConfig.servers[0].disabled, true);

    const updated = await postApi('/api/upsert', {
      name: 'demoHttp',
      originalName: 'demoHttp',
      spec: { url: 'https://updated.example/mcp', disabled: false },
      expectedSha256: snap2.json.globalConfig.sha256,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.ok, true);
    const snap3 = await postApi('/api/snapshot', { workspaceUris: [] });
    assert.equal(snap3.json.globalConfig.servers[0].spec.url, 'https://updated.example/mcp');
    assert.equal(snap3.json.globalConfig.servers[0].disabled, false);

    const deleted = await postApi('/api/delete', {
      name: 'demoHttp',
      expectedSha256: snap3.json.globalConfig.sha256,
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.json.ok, true);
    const snap4 = await postApi('/api/snapshot', { workspaceUris: [] });
    assert.equal(snap4.json.globalConfig.servers.length, 0);
  } finally {
    await srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('NMCP-TC-025 (Unit): UI I18N dictionary has 100% EN/KO key parity, matching value types, and valid formatter outputs', () => {
  const src = fs.readFileSync(APP_JS_PATH, 'utf8');
  const startIdx = src.indexOf('const I18N = {');
  assert.ok(startIdx > 0, 'I18N dictionary must exist in app.js');
  const endMarker = '\n  function resolveInitialLang()';
  const endIdx = src.indexOf(endMarker, startIdx);
  assert.ok(endIdx > startIdx, 'resolveInitialLang must follow I18N in app.js');

  const dictCode = `${src.slice(startIdx, endIdx)}\nI18N;`;
  const I18N = vm.runInNewContext(dictCode, Object.create(null));

  const enKeys = Object.keys(I18N.en).sort();
  const koKeys = Object.keys(I18N.ko).sort();
  assert.deepEqual(koKeys, enKeys, 'I18N.ko and I18N.en must have identical key sets');
  assert.ok(enKeys.length >= 60, `Expected comprehensive i18n dictionary (>=60 keys, got ${enKeys.length})`);

  for (const key of enKeys) {
    const enVal = I18N.en[key];
    const koVal = I18N.ko[key];
    assert.equal(typeof koVal, typeof enVal, `Type mismatch for i18n key "${key}"`);
    if (typeof enVal === 'string') {
      assert.ok(enVal.trim().length > 0, `Empty EN string for "${key}"`);
      assert.ok(koVal.trim().length > 0, `Empty KO string for "${key}"`);
    } else if (typeof enVal === 'function') {
      const enOut = enVal('sample', true);
      const koOut = koVal('sample', true);
      assert.equal(typeof enOut, 'string', `EN formatter "${key}" must return string`);
      assert.equal(typeof koOut, 'string', `KO formatter "${key}" must return string`);
      assert.ok(enOut.trim().length > 0, `EN formatter "${key}" returned empty string`);
      assert.ok(koOut.trim().length > 0, `KO formatter "${key}" returned empty string`);
    }
  }
});

test('NMCP-TC-026 (Real Chromium CDP): AddonContextV3 switches EN/KO live via ctx.storage without page reload and renders Korean interactive UI panels cleanly', async (t) => {
  const browserBin = findChromiumBinary();
  if (!browserBin || typeof WebSocket !== 'function') {
    t.skip('Headless Chromium/Edge binary or global WebSocket is unavailable on this host');
    return;
  }

  const rendererSrc = fs.readFileSync(RENDERER_PATH, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const hostHarness = buildAddonContextV3HarnessScript(manifest, { surface: 'desktop', locale: 'en-US' });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-v21-cdp-'));
  const profileDir = path.join(tmpDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const parentServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body style="margin:0;height:100vh;background:#111;color:#eee;font-family:sans-serif;">
      <script>
        window.__TEST_V3_CONFIG_BRIDGE__ = {
          async read(scopeId) {
            if (scopeId === 'antigravity:mcp-config') {
              return { ok: true, scopeId, status: 'ok', data: { mcpServers: { alphaSrv: { url: 'https://alpha.example/mcp' } } }, rawText: null, sha256: 'sha-alpha' };
            }
            return { ok: true, scopeId, status: 'missing', data: null, rawText: null, sha256: null };
          },
          async write() { return { ok: true, currentSha256: 'sha-alpha-2' }; }
        };
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

    await evalMain(`window.__TEST_V3_DIAG__.openSettingsPage(${JSON.stringify(V3_IDS.SETTINGS_PAGE)})`);
    assert.equal(
      await waitUntil(() =>
        evalMain(`Boolean(document.querySelector('dialog[data-addon-host-v3-overlay="modal"]')?.firstElementChild?.shadowRoot?.querySelector('[data-testid="global-server-alphaSrv"]'))`)
      ),
      true
    );

    // 1. Switch EN -> KO live inside Tier-3 panel -> persists via ctx.storage with zero reload
    await evalMain(`window.__NO_RELOAD_SENTINEL__ = 42`);
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-agy-mcp-lang-btn="ko"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`window.__TEST_V3_DIAG__.getStorageSnapshot().lang === 'ko'`)),
      true
    );
    assert.equal(await evalMain(`window.__NO_RELOAD_SENTINEL__`), 42);

    // 2. Korean interactive UI panels: Quick Paste toggle, Add Server editor, Raw JSON tab
    const quickPasteBefore = await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-toggle-smart-paste"]')?.textContent?.trim()`);
    assert.equal(quickPasteBefore, 'JSON / URL 빠른 붙여넣기');
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-toggle-smart-paste"]').click()`);
    const quickPasteAfter = await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot;
      return {
        cardTitle: sr.querySelector('[data-testid="smart-paste-card"] strong')?.textContent?.trim(),
        hasTextarea: Boolean(sr.querySelector('[data-testid="smart-paste-input"]')),
      };
    })()`);
    assert.equal(quickPasteAfter.cardTitle, '스마트 붙여넣기 (JSON / URL)');
    assert.equal(quickPasteAfter.hasTextarea, true);

    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-add-server"]').click()`);
    const modalKo = await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot;
      return {
        heading: sr.querySelector('[data-testid="server-editor-card"] strong')?.textContent?.trim(),
        saveText: sr.querySelector('[data-testid="btn-save-server"]')?.textContent?.trim(),
        cancelText: sr.querySelector('[data-testid="btn-cancel-editor"]')?.textContent?.trim(),
      };
    })()`);
    assert.equal(modalKo.heading, '전역 MCP 서버 추가');
    assert.equal(modalKo.saveText, '저장');
    assert.equal(modalKo.cancelText, '취소');
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-cancel-editor"]').click()`);

    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="tab-raw"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-save-raw"]'))`)),
      true
    );
    const rawKo = await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-testid="btn-save-raw"]')?.textContent?.trim()`);
    assert.equal(rawKo, '검증 후 원본 JSON 저장');
    assert.equal(exceptions.length, 0);
  } finally {
    await session.close();
    await new Promise((r) => parentServer.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  }
});
