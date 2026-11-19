import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';

import { startDesktopMcpServer } from '../../src/adapters/antigravity/desktop-server.mjs';
import {
  buildHookSnippet,
  getSettingsHookStatus,
  HOOK_END_MARKER,
  HOOK_START_MARKER,
  installSettingsHook,
  resolveDefaultAsarPath,
  stripHookSnippet,
  uninstallSettingsHook,
} from '../../scripts/install-settings-menu.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const APP_JS_PATH = path.join(ROOT_DIR, 'sidecars', 'mcp_manager', 'ui', 'app.js');
const INJECTOR_PATH = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'settings-menu-injector.js');

function findChromiumBinary() {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/microsoft-edge',
          ];
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

function getFreeTcpPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

async function waitUntil(fn, timeoutMs = 8000, intervalMs = 40) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return Boolean(await fn());
}

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

    // Create HTTP server
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

    // Toggle disabled -> true
    const disabled = await postApi('/api/toggle-disabled', {
      name: 'demoHttp',
      disabled: true,
      expectedSha256: snap1.json.globalConfig.sha256,
    });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.json.ok, true);
    const snap2 = await postApi('/api/snapshot', { workspaceUris: [] });
    assert.equal(snap2.json.globalConfig.servers[0].disabled, true);

    // Update URL
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

    // Delete server
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

test('NMCP-TC-024 (Unit): install-settings-menu.mjs handles OS paths, snippet strip, missing asar, no-op uninstall, and existing .orig backup preservation', async () => {
  // 1. OS path resolution
  assert.match(
    resolveDefaultAsarPath({ homeDir: 'C:\\Users\\Demo', platform: 'win32' }),
    /antigravity[\\/]+resources[\\/]+app\.asar$/i
  );
  assert.equal(
    resolveDefaultAsarPath({ homeDir: '/Users/demo', platform: 'darwin' }),
    '/Applications/Antigravity.app/Contents/Resources/app.asar'
  );
  assert.equal(
    resolveDefaultAsarPath({ homeDir: '/home/demo', platform: 'linux' }),
    '/opt/Antigravity/resources/app.asar'
  );

  // 2. Snippet build & strip
  const snippetDefault = buildHookSnippet();
  assert.equal(snippetDefault.startsWith(HOOK_START_MARKER), true);
  assert.equal(snippetDefault.endsWith(HOOK_END_MARKER), true);
  assert.equal(snippetDefault.includes('electron-hook.cjs'), true);

  const combined = `// sibling\nconsole.log(1);\n${snippetDefault}\n// tail\n`;
  const stripped = stripHookSnippet(combined);
  assert.equal(stripped.includes(HOOK_START_MARKER), false);
  assert.equal(stripped.includes('// sibling'), true);
  assert.equal(stripped.includes('// tail'), true);
  assert.equal(stripHookSnippet('// clean\n'), '// clean\n');

  // 3. Missing app.asar handling
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-asar-unit-'));
  const missingAsar = path.join(tmpDir, 'nonexistent.asar');
  try {
    const missingStatus = getSettingsHookStatus({ asarPath: missingAsar });
    assert.equal(missingStatus.ok, false);
    assert.equal(missingStatus.exists, false);
    assert.equal(missingStatus.installed, false);
    await assert.rejects(() => installSettingsHook({ asarPath: missingAsar }), /not found/i);
    await assert.rejects(() => uninstallSettingsHook({ asarPath: missingAsar }), /not found/i);

    // 4. Existing app.asar.v2.33.0.orig preservation & idempotent no-op uninstall
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(path.join(srcDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'dist', 'main.js'), "console.log('orig');\n", 'utf8');
    const asarPath = path.join(tmpDir, 'app.asar');
    await asar.createPackage(srcDir, asarPath);

    const existingBackup = path.join(tmpDir, 'app.asar.v2.33.0.orig');
    fs.copyFileSync(asarPath, existingBackup);

    // Uninstall when not installed -> no-op
    const noop = await uninstallSettingsHook({ asarPath });
    assert.equal(noop.ok, true);
    assert.equal(noop.removed, false);
    assert.equal(noop.installed, false);

    // Install reuses existing app.asar.v2.33.0.orig (does not create second .orig)
    const installed = await installSettingsHook({ asarPath, pluginDir: ROOT_DIR });
    assert.equal(installed.ok, true);
    assert.equal(installed.backupCreated, false);
    assert.equal(installed.backupPath, existingBackup);
    assert.equal(fs.existsSync(path.join(tmpDir, 'app.asar.agy-mcp-manager.orig')), false);
  } finally {
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

test('NMCP-TC-026 (Real Chromium CDP): injector rejects untrusted postMessage, switches lang without iframe reload, and Korean interactive UI panels work', async (t) => {
  const browserBin = findChromiumBinary();
  if (!browserBin || typeof WebSocket !== 'function') {
    t.skip('Headless Chromium/Edge binary or global WebSocket is unavailable on this host');
    return;
  }

  const injectorSrc = fs.readFileSync(INJECTOR_PATH, 'utf8');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-v21-cdp-'));
  const profileDir = path.join(tmpDir, 'profile');
  const cfgDir = path.join(tmpDir, '.gemini', 'config');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, 'mcp_config.json'),
    JSON.stringify({ mcpServers: { alphaSrv: { url: 'https://alpha.example/mcp' } } }, null, 2) + '\n',
    'utf8'
  );

  const desktopSrv = await startDesktopMcpServer({ homeDir: tmpDir });
  const parentServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
      <html>
        <body style="display:flex;margin:0;height:100vh;background:#111;color:#eee;font-family:sans-serif;">
          <div id="settings-root" style="display:flex;width:100%;height:100%;">
            <aside id="settings-sidebar" style="width:220px;display:flex;flex-direction:column;gap:8px;padding:12px;">
              <nav id="settings-nav-section" style="display:flex;flex-direction:column;gap:4px;">
                <button type="button" id="nav-general">General</button>
                <button type="button" id="nav-application">Application</button>
                <button type="button" id="nav-appearance">Appearance</button>
                <button type="button" id="nav-shortcuts">Shortcuts</button>
                <button type="button" id="nav-notifications">Notifications</button>
                <button type="button" id="nav-models">Models</button>
                <button type="button" id="nav-browser">Browser</button>
              </nav>
            </aside>
            <main id="settings-content" style="flex:1;padding:16px;position:relative;">
              <div id="native-pane">Native</div>
            </main>
          </div>
          <script>
            window.__AGY_MCP_MANAGER_URL__ = ${JSON.stringify(desktopSrv.url)};
          </script>
          <script>${injectorSrc}</script>
        </body>
      </html>`);
  });
  await new Promise((r) => parentServer.listen(0, '127.0.0.1', r));
  const parentPort = parentServer.address().port;

  const cdpPort = await getFreeTcpPort();
  const browser = spawn(
    browserBin,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );

  let ws = null;
  try {
    let wsUrl = null;
    await waitUntil(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
        if (res.ok) {
          const targets = await res.json();
          const page = targets.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
          if (page) {
            wsUrl = page.webSocketDebuggerUrl;
            return true;
          }
        }
      } catch {}
      return false;
    }, 20000, 100);
    assert.ok(wsUrl);

    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    let seq = 0;
    const pending = new Map();
    const iframeOrigin = `http://127.0.0.1:${desktopSrv.port}`;
    let iframeSessionId = null;
    let iframeContextId = null;

    const cdp = (method, params = {}, sessionId = undefined) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      });

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Target.attachedToTarget') {
        const info = msg.params?.targetInfo;
        const sid = msg.params?.sessionId;
        if (sid && info && (info.type === 'iframe' || String(info.url || '').startsWith(iframeOrigin))) {
          iframeSessionId = sid;
          void cdp('Runtime.enable', {}, sid).catch(() => {});
        }
      } else if (msg.method === 'Runtime.executionContextCreated') {
        const ctx = msg.params?.context;
        if (ctx && ctx.origin === iframeOrigin && ctx.auxData?.isDefault) {
          iframeContextId = ctx.id;
        }
      }
    });

    const evalMain = async (expression) => {
      const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
      return res.result?.value;
    };
    const evalIframe = async (expression) => {
      if (iframeSessionId) {
        const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, iframeSessionId);
        if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
        return res.result?.value;
      }
      const res = await cdp('Runtime.evaluate', { contextId: iframeContextId, expression, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
      return res.result?.value;
    };

    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await cdp('Page.navigate', { url: `http://localhost:${parentPort}/` });

    assert.equal(await waitUntil(() => evalMain(`Boolean(document.querySelector('[data-agy-mcp-manager-nav="true"]'))`)), true);
    await evalMain(`document.querySelector('[data-agy-mcp-manager-nav="true"]').click()`);
    assert.equal(await waitUntil(() => Boolean(iframeSessionId || iframeContextId), 8000, 40), true);
    assert.equal(
      await waitUntil(async () => {
        try {
          return await evalIframe(`Boolean(document.querySelector('[data-testid="global-server-alphaSrv"]'))`);
        } catch {
          return false;
        }
      }, 8000, 40),
      true
    );

    // 1. Untrusted postMessage from wrong source (parent itself) MUST NOT overwrite localStorage
    await evalMain(`window.localStorage.setItem('agy-mcp-manager-lang', 'en')`);
    await evalMain(`window.postMessage({ type: 'agy-mcp-lang-change', lang: 'ko' }, '*')`);
    await evalMain(`window.postMessage({ type: 'agy-mcp-lang-change', lang: 'xx' }, '*')`);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(
      await evalMain(`window.localStorage.getItem('agy-mcp-manager-lang')`),
      'en',
      'Untrusted postMessage from non-iframe source must be ignored'
    );

    // 2. Plant sentinel inside iframe -> switch to Korean -> verify NO iframe reload occurred
    await evalIframe(`window.__NO_RELOAD_SENTINEL__ = 42`);
    await evalIframe(`document.querySelector('[data-testid="btn-lang-ko"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`window.localStorage.getItem('agy-mcp-manager-lang') === 'ko'`), 3000, 30),
      true
    );
    assert.equal(await evalIframe(`window.__NO_RELOAD_SENTINEL__`), 42, 'Switching language must not reload iframe');

    // 3. Korean interactive UI panels: Quick Paste toggle, Add Server modal, Raw JSON tab
    const quickPasteBefore = await evalIframe(`document.querySelector('[data-testid="btn-toggle-smart-paste"]')?.textContent?.trim()`);
    assert.equal(quickPasteBefore, 'JSON / URL 빠른 붙여넣기');
    await evalIframe(`document.querySelector('[data-testid="btn-toggle-smart-paste"]').click()`);
    const quickPasteAfter = await evalIframe(`({
      cardTitle: document.querySelector('.card .server-header strong')?.textContent?.trim(),
      hideBtnText: document.querySelector('.card .server-header button')?.textContent?.trim(),
      hasTextarea: Boolean(document.querySelector('[data-testid="smart-paste-input"]')),
    })`);
    assert.equal(quickPasteAfter.cardTitle, '스마트 붙여넣기 (JSON / URL)');
    assert.equal(quickPasteAfter.hideBtnText, '닫기');
    assert.equal(quickPasteAfter.hasTextarea, true);

    await evalIframe(`document.getElementById('btn-add').click()`);
    const modalKo = await evalIframe(`({
      heading: document.querySelector('[data-testid="server-editor-card"] strong')?.textContent?.trim(),
      saveText: document.querySelector('[data-testid="btn-save-server"]')?.textContent?.trim(),
      cancelText: Array.from(document.querySelectorAll('[data-testid="server-editor-card"] button')).at(-1)?.textContent?.trim(),
    })`);
    assert.equal(modalKo.heading, '전역 MCP 서버 추가');
    assert.equal(modalKo.saveText, '저장');
    assert.equal(modalKo.cancelText, '취소');
    await evalIframe(`Array.from(document.querySelectorAll('[data-testid="server-editor-card"] button')).at(-1).click()`);

    await evalIframe(`document.getElementById('tab-raw').click()`);
    assert.equal(
      await waitUntil(() => evalIframe(`Boolean(document.querySelector('[data-testid="btn-save-raw"]'))`), 3000, 30),
      true
    );
    const rawKo = await evalIframe(`document.querySelector('[data-testid="btn-save-raw"]')?.textContent?.trim()`);
    assert.equal(rawKo, '검증 후 원본 JSON 저장');
  } finally {
    if (ws) { try { ws.close(); } catch {} }
    try { browser.kill(); } catch {}
    await new Promise((resolve) => {
      if (browser.exitCode !== null) return resolve();
      const timer = setTimeout(resolve, 3000);
      browser.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await desktopSrv.close();
    await new Promise((r) => parentServer.close(r));
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
  }
});
