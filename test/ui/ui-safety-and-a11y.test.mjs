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

import { McpManagerService } from '../../src/core/manager-service.mjs';
import { createFsConfigStore } from '../../src/adapters/fs-config-store.mjs';
import { attachSidecarSecurityMiddleware, registerSidecarRoutes, SECURITY_HEADERS } from '../../src/adapters/sidecar/http-app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(__dirname, '../../sidecars/mcp_manager/ui');

class MiniEl {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.value = '';
    this.className = '';
    this.classList = {
      toggle: (cls, force) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force) set.add(cls);
        else set.delete(cls);
        this.className = [...set].join(' ');
      },
    };
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  dispatch(type, ev = {}) {
    const fns = this.listeners.get(type) || [];
    for (const fn of fns) fn({ target: this, preventDefault() {}, ...ev });
  }
  findByTestId(tid) {
    if (this.dataset?.testid === tid) return this;
    for (const c of this.children) {
      if (c && typeof c.findByTestId === 'function') {
        const hit = c.findByTestId(tid);
        if (hit) return hit;
      }
    }
    return null;
  }
}

function createInteractiveDomHarness({ port, token }) {
  const ids = new Map([
    ['main-region', new MiniEl('main')],
    ['banner-region', new MiniEl('div')],
    ['runtime-badge', new MiniEl('span')],
    ['tab-servers', new MiniEl('button')],
    ['tab-raw', new MiniEl('button')],
    ['btn-refresh', new MiniEl('button')],
    ['btn-add', new MiniEl('button')],
  ]);
  const winListeners = new Map();
  const parentWin = { isMockParent: true };
  const win = {
    parent: parentWin,
    location: { search: `?token=${encodeURIComponent(token)}` },
    sidecar: {
      async getWorkspaceUris() { return []; },
    },
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    dispatch(type, ev) {
      for (const fn of winListeners.get(type) || []) fn(ev);
    },
  };
  const doc = {
    getElementById: (id) => ids.get(id) || null,
    createElement: (tag) => new MiniEl(tag),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
  };
  const liveFetch = (route, init) => globalThis.fetch(`http://127.0.0.1:${port}${route}`, init);
  return { win, parentWin, doc, ids, liveFetch };
}

test('NMCP-TC-017: UI has ZERO unsafe DOM sinks and ZERO external CDN/font links', () => {
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(UI_DIR, 'app.js'), 'utf8');
  const jsCodeOnly = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  assert.equal(/https?:\/\//i.test(html), false, 'index.html must not load external CDN/font URLs');
  assert.equal(html.includes('<script src="/preload.js"></script>'), true);
  assert.equal(html.includes('<script src="/app.js"></script>'), true);

  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
    assert.equal(jsCodeOnly.includes(sink), false, `Unsafe sink "${sink}" found in app.js`);
  }
});

test('NMCP-TC-018: styles.css binds Antigravity theme tokens, supports narrow 420px pane, and respects prefers-reduced-motion', () => {
  const css = fs.readFileSync(path.join(UI_DIR, 'styles.css'), 'utf8');
  assert.equal(css.includes('var(--background'), true);
  assert.equal(css.includes('var(--foreground'), true);
  assert.equal(css.includes('var(--primary'), true);
  assert.equal(css.includes('@media (max-width: 420px)'), true);
  assert.equal(css.includes('@media (prefers-reduced-motion: reduce)'), true);
});

test('NMCP-TC-019 & NMCP-TC-020 (Simulated DOM Contract): Korean IME guard, Clone secret preservation, Raw Stdio confirmation gate, 409 Conflict & Malformed Recovery', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ui-live-'));
  const token = 'ui-live-test-token';
  const pluginDir = path.join(tmpDir, 'plugins', 'demo');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'mcp_config.json'),
    JSON.stringify({
      mcpServers: {
        psrv: { url: 'https://p.example.com/mcp', headers: { Authorization: 'Bearer real-plugin-tok' }, disabledTools: ['x'] },
      },
    }),
    'utf8'
  );
  const configPath = path.join(tmpDir, 'mcp_config.json');
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2) + '\n', 'utf8');

  class Resp {
    constructor(body, { contentType = 'text/plain', status = 200, headers = {} } = {}) {
      this.body = body; this.contentType = contentType; this.status = status; this.headers = headers;
    }
  }
  const pages = new Map();
  const apis = new Map();
  const fakeApp = {
    page(p, h) { pages.set(p, h); },
    api(p, h, m = 'POST') {
      if (!apis.has(p)) apis.set(p, new Map());
      apis.get(p).set(m.toUpperCase(), h);
    },
  };
  const store = createFsConfigStore({
    globalConfigPath: configPath,
    pluginRoots: [path.join(tmpDir, 'plugins')],
    backupDir: path.join(tmpDir, '.mcp-manager-backups'),
  });
  const service = new McpManagerService({ configStore: store });
  registerSidecarRoutes({ app: fakeApp, ResponseClass: Resp, service, uiDir: UI_DIR });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const map = apis.get(url.pathname);
    if (!map || !map.has(req.method)) { res.writeHead(405); res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      if (res.writableEnded) return;
      const out = await map.get(req.method)(body ? JSON.parse(body) : {});
      if (!res.headersSent) { res.writeHead(out.status || 200, { 'Content-Type': out.contentType, ...out.headers }); res.end(out.body); }
    });
  });
  attachSidecarSecurityMiddleware(server, { token });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const { win, doc, ids, liveFetch } = createInteractiveDomHarness({ port, token });
    const appCode = fs.readFileSync(path.join(UI_DIR, 'app.js'), 'utf8');
    vm.runInNewContext(appCode, { window: win, document: doc, URLSearchParams, fetch: liveFetch, console, setTimeout, clearTimeout });

    const waitUntil = async (fn, timeoutMs = 3000) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        if (fn()) return true;
        await new Promise((r) => setTimeout(r, 25));
      }
      return Boolean(fn());
    };

    await waitUntil(() => Boolean(ids.get('main-region').findByTestId('btn-clone-demo-psrv')));

    // 1. Live Clone-to-Global via UI button MUST preserve real unmasked secret + disabledTools on disk (F2!)
    const cloneBtn = ids.get('main-region').findByTestId('btn-clone-demo-psrv');
    assert.ok(cloneBtn, 'Expected Clone to Global button for plugin server');
    cloneBtn.dispatch('click');
    await waitUntil(() => Boolean(JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers?.['psrv-copy']));
    const afterClone = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(afterClone.mcpServers['psrv-copy'].headers.Authorization, 'Bearer real-plugin-tok');
    assert.deepEqual(afterClone.mcpServers['psrv-copy'].disabledTools, ['x']);

    // 2. Korean Hangul IME Escape (isComposing: true & keyCode: 229) MUST NOT close editor (F6!)
    ids.get('btn-add').dispatch('click');
    const editorCard = ids.get('main-region').findByTestId('server-editor-card');
    assert.ok(editorCard);
    editorCard.dispatch('keydown', { key: 'Escape', isComposing: true });
    assert.ok(ids.get('main-region').findByTestId('server-editor-card'), 'IME isComposing Escape must not close editor');
    editorCard.dispatch('keydown', { key: 'Escape', isComposing: false, keyCode: 229 });
    assert.ok(ids.get('main-region').findByTestId('server-editor-card'), 'IME keyCode 229 Escape must not close editor');
    editorCard.dispatch('keydown', { key: 'Escape', isComposing: false, keyCode: 27 });
    assert.equal(ids.get('main-region').findByTestId('server-editor-card'), null, 'Non-IME Escape closes editor');

    // 3. Raw JSON save with Stdio MUST show stdio-confirm-panel instead of bypassing (F3!)
    ids.get('tab-raw').dispatch('click');
    await waitUntil(() => Boolean(ids.get('main-region').findByTestId('raw-json-textarea')));
    const ta = ids.get('main-region').findByTestId('raw-json-textarea');
    assert.ok(ta);
    ta.value = JSON.stringify({ mcpServers: { rawCmd: { command: 'node', args: ['a.js'] } } }, null, 2);
    ta.dispatch('input', { target: ta });
    ids.get('main-region').findByTestId('btn-save-raw').dispatch('click');
    await waitUntil(() => Boolean(ids.get('main-region').findByTestId('stdio-confirm-panel')));
    assert.ok(ids.get('main-region').findByTestId('stdio-confirm-panel'), 'Raw JSON Stdio save must pause for explicit confirmation');
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.rawCmd, undefined);

    // 4. Confirming Raw JSON Stdio writes to disk
    ids.get('main-region').findByTestId('btn-confirm-stdio').dispatch('click');
    await waitUntil(() => Boolean(JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers?.rawCmd));
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.rawCmd.command, 'node');

    // 5. External disk change triggers 409 Conflict banner (F6!)
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { external: { url: 'https://ext.example.com/mcp' } } }) + '\n', 'utf8');
    ids.get('main-region').findByTestId('btn-save-raw').dispatch('click');
    await waitUntil(() => Boolean(ids.get('banner-region').findByTestId('status-banner')));
    const conflictBanner = ids.get('banner-region').findByTestId('status-banner');
    assert.ok(conflictBanner);

    // 6. Malformed JSON on disk renders malformed-json-banner + restore backup works with CAS (F6!)
    fs.writeFileSync(configPath, '{ broken json', 'utf8');
    ids.get('btn-refresh').dispatch('click');
    await waitUntil(() => Boolean(ids.get('banner-region').findByTestId('malformed-json-banner')));
    assert.ok(ids.get('banner-region').findByTestId('malformed-json-banner'));
    ids.get('banner-region').findByTestId('btn-restore-backup').dispatch('click');
    await waitUntil(() => ids.get('banner-region').findByTestId('malformed-json-banner') === null);
    assert.equal(ids.get('banner-region').findByTestId('malformed-json-banner'), null);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

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
      const port = s.address().port;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

test('NMCP-TC-020B (Real Headless Chromium/Edge CDP E2E): real browser CSP, asset loads, Clone secret preservation, Korean IME input->section bubbling, Raw Stdio 428 gate, 409 Conflict & Malformed Recovery', async (t) => {
  const browserBin = findChromiumBinary();
  if (!browserBin || typeof WebSocket !== 'function') {
    t.skip('Headless Chromium/Edge binary or global WebSocket is unavailable on this host');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ui-cdp-'));
  const profileDir = path.join(tmpDir, 'browser-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  const token = 'real-browser-cdp-token';

  const cfgDir = path.join(tmpDir, '.gemini', 'config');
  const pluginDir = path.join(cfgDir, 'plugins', 'demo');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'mcp_config.json'),
    JSON.stringify({
      mcpServers: {
        psrv: { url: 'https://p.example.com/mcp', headers: { Authorization: 'Bearer real-plugin-secret-xyz' }, disabledTools: ['x'] },
      },
    }),
    'utf8'
  );
  const configPath = path.join(cfgDir, 'mcp_config.json');
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2) + '\n', 'utf8');

  // Prefer REAL sidecars/mcp_manager/main.mjs + host sidecar_sdk when Antigravity Desktop is installed!
  const hostHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const sdkLoader = path.join(hostHome, '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'register_loader.js');
  const useRealSidecarSdk = fs.existsSync(sdkLoader);

  let server = null;
  let sidecarChild = null;
  let port = 0;

  if (useRealSidecarSdk) {
    port = await getFreeTcpPort();
    sidecarChild = spawn(
      process.execPath,
      ['--import', `file:///${sdkLoader.replace(/\\/g, '/')}`, path.resolve(UI_DIR, '../main.mjs')],
      {
        cwd: path.resolve(UI_DIR, '..'),
        env: {
          ...process.env,
          AGY_MCP_HOME_OVERRIDE: tmpDir,
          ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:1',
          ANTIGRAVITY_CSRF_TOKEN: 'dummy-csrf-not-leaked',
          ANTIGRAVITY_SIDECAR_WEB_PORT: String(port),
          ANTIGRAVITY_SIDECAR_UI_TOKEN: token,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Real sidecar boot timeout in 020B')), 6000);
      let out = '';
      sidecarChild.stdout.on('data', (d) => {
        out += String(d);
        if (out.includes('listening on 127.0.0.1:')) {
          clearTimeout(timer);
          resolve();
        }
      });
      sidecarChild.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Real sidecar exited early (${code}) in 020B`));
      });
    });
  } else {
    class Resp {
      constructor(body, opts = {}) {
        this.body = body;
        this.status = opts.status ?? 200;
        this.contentType = opts.contentType ?? 'application/json; charset=utf-8';
        this.headers = opts.headers ?? {};
      }
    }

    const routes = new Map();
    const fakeApp = {
      page(p, fn) { routes.set(`GET ${p}`, fn); },
      api(p, fn, m = 'POST') { routes.set(`${m.toUpperCase()} ${p}`, fn); },
    };
    const store = createFsConfigStore({
      globalConfigPath: configPath,
      pluginRoots: [path.join(cfgDir, 'plugins')],
      backupDir: path.join(cfgDir, '.mcp-manager-backups'),
    });
    const service = new McpManagerService({ configStore: store });
    registerSidecarRoutes({ app: fakeApp, ResponseClass: Resp, service, uiDir: UI_DIR });
    fakeApp.api(
      '/preload.js',
      () =>
        new Resp('window.sidecar = { getWorkspaceUris: async () => [] };', {
          status: 200,
          contentType: 'application/javascript; charset=utf-8',
          headers: { ...SECURITY_HEADERS },
        }),
      'GET'
    );

    server = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      const key = `${req.method.toUpperCase()} ${pathname}`;
      const handler = routes.get(key);
      if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        if (res.headersSent) return;
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const data = body ? JSON.parse(body) : {};
          const out = await handler(data);
          if (res.headersSent) return;
          res.writeHead(out.status, { 'Content-Type': out.contentType, ...out.headers });
          res.end(out.body);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
            res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
          }
        }
      });
    });
    attachSidecarSecurityMiddleware(server, { token });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  }

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
    // Wait for CDP endpoint
    let wsUrl = null;
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      try {
        const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
        if (listRes.ok) {
          const targets = await listRes.json();
          const pageTarget = targets.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
          if (pageTarget) {
            wsUrl = pageTarget.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {
        // Retry until browser binds CDP port
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    assert.ok(wsUrl, 'Headless browser did not expose CDP WebSocket target');

    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    let seq = 0;
    const pending = new Map();
    const exceptions = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        exceptions.push(msg.params?.exceptionDetails?.text || 'Uncaught exception');
      }
    });

    const cdp = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });

    const evalJs = async (expression) => {
      const res = await cdp('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (res.exceptionDetails) {
        throw new Error(`Browser eval exception: ${res.exceptionDetails.text}`);
      }
      return res.result?.value;
    };

    const waitForSelector = async (selector, timeoutMs = 6000) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const found = await evalJs(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
        if (found) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    };

    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__cspViolations = [];
        window.addEventListener('securitypolicyviolation', (e) => {
          window.__cspViolations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
        });
      `,
    });

    await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/?token=${token}` });
    const hasCloneBtn = await waitForSelector('[data-testid="btn-clone-demo-psrv"]');
    if (!hasCloneBtn) {
      const diag = await evalJs(`JSON.stringify({ href: location.href, badge: document.querySelector('#runtime-badge')?.textContent, banner: document.querySelector('#banner-region')?.textContent, main: document.querySelector('#main-region')?.textContent, csp: window.__cspViolations })`);
      assert.fail(`Real Chromium did not render Clone to Global button. diag=${diag} exceptions=${JSON.stringify(exceptions)}`);
    }

    // 1. Verify zero CSP violations & styles.css loaded
    const cspCount = await evalJs('window.__cspViolations.length');
    assert.equal(cspCount, 0, 'Expected zero CSP violations in real Chromium');
    const styleCount = await evalJs('document.styleSheets.length');
    assert.ok(styleCount >= 1, 'Expected styles.css stylesheet to load under strict CSP');

    // 2. Real click on Clone to Global preserves full plugin secret on disk (never '••••••••')
    await evalJs(`document.querySelector('[data-testid="btn-clone-demo-psrv"]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    const afterClone = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(afterClone.mcpServers['psrv-copy'].headers.Authorization, 'Bearer real-plugin-secret-xyz');
    assert.deepEqual(afterClone.mcpServers['psrv-copy'].disabledTools, ['x']);

    // 3. Real DOM <input> -> <section> Korean IME Escape (keyCode 229) bubbling MUST NOT close editor
    await evalJs(`document.querySelector('#btn-add').click()`);
    assert.equal(await waitForSelector('[data-testid="server-editor-card"]'), true);
    const imeResult = await evalJs(`(() => {
      const inp = document.querySelector('[data-testid="server-editor-card"] input[type="text"]');
      inp.focus();
      const imeEvt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      Object.defineProperty(imeEvt, 'keyCode', { value: 229 });
      inp.dispatchEvent(imeEvt);
      const stillOpenAfterIme = Boolean(document.querySelector('[data-testid="server-editor-card"]'));

      const realEsc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      Object.defineProperty(realEsc, 'keyCode', { value: 27 });
      inp.dispatchEvent(realEsc);
      const closedAfterEsc = !document.querySelector('[data-testid="server-editor-card"]');
      return { stillOpenAfterIme, closedAfterEsc };
    })()`);
    assert.equal(imeResult.stillOpenAfterIme, true, 'Korean IME keyCode 229 Escape bubbling from <input> must NOT close editor');
    assert.equal(imeResult.closedAfterEsc, true, 'Non-IME Escape bubbling from <input> MUST close editor');

    // 4. Real Raw JSON Stdio save triggers 428 confirmation gate, then confirm writes to disk
    await evalJs(`document.querySelector('#tab-raw').click()`);
    assert.equal(await waitForSelector('[data-testid="raw-json-textarea"]'), true);
    await evalJs(`(() => {
      const ta = document.querySelector('[data-testid="raw-json-textarea"]');
      ta.value = JSON.stringify({ mcpServers: { browserCmd: { command: 'node', args: ['x.js'] } } }, null, 2);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-testid="btn-save-raw"]').click();
    })()`);
    assert.equal(await waitForSelector('[data-testid="stdio-confirm-panel"]'), true, 'Real Chromium Raw Stdio save must show confirmation panel');
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.browserCmd, undefined);

    await evalJs(`document.querySelector('[data-testid="btn-confirm-stdio"]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.browserCmd.command, 'node');

    // 5. External disk change triggers 409 Conflict banner in real Chromium
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { ext: { url: 'https://ext.example/mcp' } } }) + '\n', 'utf8');
    await evalJs(`document.querySelector('[data-testid="btn-save-raw"]').click()`);
    assert.equal(await waitForSelector('[data-testid="status-banner"]'), true, 'Expected 409 Conflict status banner');

    // 6. Malformed JSON on disk renders recovery banner + CAS backup restore works
    fs.writeFileSync(configPath, '{ broken-json', 'utf8');
    await evalJs(`document.querySelector('#btn-refresh').click()`);
    assert.equal(await waitForSelector('[data-testid="malformed-json-banner"]'), true);
    await evalJs(`document.querySelector('[data-testid="btn-restore-backup"]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await evalJs(`Boolean(document.querySelector('[data-testid="malformed-json-banner"]'))`), false);
    assert.equal(exceptions.length, 0, `Unexpected browser exceptions: ${exceptions.join('; ')}`);
    assert.equal(await evalJs('window.__cspViolations.length'), 0);
  } finally {
    if (ws) {
      try { ws.close(); } catch {}
    }
    try { browser.kill(); } catch {}
    if (sidecarChild) {
      try { sidecarChild.kill(); } catch {}
    }
    await new Promise((r) => setTimeout(r, 250));
    if (server) {
      await new Promise((r) => server.close(r));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
