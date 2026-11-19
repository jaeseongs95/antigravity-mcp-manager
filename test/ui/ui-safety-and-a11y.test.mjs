import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { McpManagerService } from '../../src/core/manager-service.mjs';
import { createFsConfigStore } from '../../src/adapters/fs-config-store.mjs';
import { attachSidecarSecurityMiddleware, registerSidecarRoutes } from '../../src/adapters/sidecar/http-app.mjs';

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

test('NMCP-TC-019 & NMCP-TC-020 (Live DOM Execution): Korean IME guard, Clone secret preservation, Raw Stdio confirmation gate, 409 Conflict & Malformed Recovery', async () => {
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

    await new Promise((r) => setTimeout(r, 80));

    // 1. Live Clone-to-Global via UI button MUST preserve real unmasked secret + disabledTools on disk (F2!)
    const cloneBtn = ids.get('main-region').findByTestId('btn-clone-demo-psrv');
    assert.ok(cloneBtn, 'Expected Clone to Global button for plugin server');
    cloneBtn.dispatch('click');
    await new Promise((r) => setTimeout(r, 80));
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
    await new Promise((r) => setTimeout(r, 80));
    const ta = ids.get('main-region').findByTestId('raw-json-textarea');
    assert.ok(ta);
    ta.value = JSON.stringify({ mcpServers: { rawCmd: { command: 'node', args: ['a.js'] } } }, null, 2);
    ta.dispatch('input', { target: ta });
    ids.get('main-region').findByTestId('btn-save-raw').dispatch('click');
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(ids.get('main-region').findByTestId('stdio-confirm-panel'), 'Raw JSON Stdio save must pause for explicit confirmation');
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.rawCmd, undefined);

    // 4. Confirming Raw JSON Stdio writes to disk
    ids.get('main-region').findByTestId('btn-confirm-stdio').dispatch('click');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.rawCmd.command, 'node');

    // 5. External disk change triggers 409 Conflict banner (F6!)
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { external: { url: 'https://ext.example.com/mcp' } } }) + '\n', 'utf8');
    ids.get('main-region').findByTestId('btn-save-raw').dispatch('click');
    await new Promise((r) => setTimeout(r, 80));
    const conflictBanner = ids.get('banner-region').findByTestId('status-banner');
    assert.ok(conflictBanner);

    // 6. Malformed JSON on disk renders malformed-json-banner + restore backup works with CAS (F6!)
    fs.writeFileSync(configPath, '{ broken json', 'utf8');
    ids.get('btn-refresh').dispatch('click');
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(ids.get('banner-region').findByTestId('malformed-json-banner'));
    ids.get('banner-region').findByTestId('btn-restore-backup').dispatch('click');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(ids.get('banner-region').findByTestId('malformed-json-banner'), null);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
