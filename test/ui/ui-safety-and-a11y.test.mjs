import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { McpManagerService } from '../../src/core/manager-service.mjs';
import { createFsConfigStore } from '../../src/adapters/fs-config-store.mjs';
import { attachSidecarSecurityMiddleware, registerSidecarRoutes, SECURITY_HEADERS } from '../../src/adapters/sidecar/http-app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(__dirname, '../../sidecars/mcp_manager/ui');

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

async function waitUntil(fn, timeoutMs = 5000, intervalMs = 30) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return Boolean(await fn());
}

test('NMCP-TC-017: UI has ZERO unsafe DOM sinks and ZERO external CDN/font links', () => {
  const appJs = fs.readFileSync(path.join(UI_DIR, 'app.js'), 'utf8');
  const forbiddenSinks = [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML\s*\(/, /document\.write\s*\(/, /\beval\s*\(/, /new\s+Function\s*\(/];
  for (const rx of forbiddenSinks) {
    assert.equal(rx.test(appJs), false, `Forbidden DOM sink matched: ${rx}`);
  }
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');
  assert.equal(/https?:\/\//i.test(html), false, 'index.html must not reference external CDNs/fonts');
  assert.equal(html.includes('src="/preload.js"'), true);
  assert.equal(html.includes('href="/styles.css"'), true);
  assert.equal(html.includes('src="/app.js"'), true);
});

test('NMCP-TC-018: styles.css binds Antigravity theme tokens, supports narrow 420px pane, and respects prefers-reduced-motion', () => {
  const css = fs.readFileSync(path.join(UI_DIR, 'styles.css'), 'utf8');
  assert.equal(css.includes('var(--background'), true);
  assert.equal(css.includes('var(--foreground'), true);
  assert.equal(css.includes('var(--primary'), true);
  assert.equal(css.includes('@media (max-width: 420px)'), true);
  assert.equal(css.includes('@media (prefers-reduced-motion: reduce)'), true);
});

test('NMCP-TC-019 & NMCP-TC-020 / NMCP-TC-020B (Real Headless Chromium/Edge CDP E2E): CSP, postMessage guard, password/scrub, Smart Paste & Editor Korean IME, serverUrl meta, Clone secret preservation, Raw Stdio 428, 409 Conflict & Malformed Recovery', async (t) => {
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
  fs.writeFileSync(
    configPath,
    JSON.stringify({ mcpServers: { legacyMeta: { serverUrl: 'https://legacy-meta.example/mcp' } } }, null, 2) + '\n',
    'utf8'
  );

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
    let wsUrl = null;
    await waitUntil(async () => {
      try {
        const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
        if (listRes.ok) {
          const targets = await listRes.json();
          const pageTarget = targets.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
          if (pageTarget) {
            wsUrl = pageTarget.webSocketDebuggerUrl;
            return true;
          }
        }
      } catch {
        // Retry until browser binds CDP port
      }
      return false;
    }, 12000, 100);
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

    const waitForSelector = (selector, timeoutMs = 6000) =>
      waitUntil(() => evalJs(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), timeoutMs, 40);

    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__cspViolations = [];
        window.__snapshotFetchCount = 0;
        window.addEventListener('securitypolicyviolation', (e) => {
          window.__cspViolations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
        });
        const origFetch = window.fetch.bind(window);
        window.fetch = (...args) => {
          if (String(args[0]).includes('/api/snapshot')) window.__snapshotFetchCount += 1;
          return origFetch(...args);
        };
      `,
    });

    await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/?token=${token}` });
    const cloneSelector = '[data-testid="btn-clone-global-demo-psrv"]';
    assert.equal(await waitForSelector(cloneSelector), true, 'Real Chromium should render Clone to Global button with scoped pluginId');

    // 1. Verify zero CSP violations, styles.css loaded, and serverUrl metadata rendered (F4)
    assert.equal(await evalJs('window.__cspViolations.length'), 0, 'Expected zero CSP violations in real Chromium');
    assert.ok((await evalJs('document.styleSheets.length')) >= 1, 'Expected styles.css stylesheet to load under strict CSP');
    const legacyMetaText = await evalJs(`document.querySelector('[data-testid="global-server-legacyMeta"] .server-meta')?.textContent || ''`);
    assert.equal(legacyMetaText, 'https://legacy-meta.example/mcp', 'serverUrl must be displayed in server card metadata');

    // 2. Verify postMessage ignores spoofed top-level window & file:// origin messages (R4 F2)
    const countBeforeMsg = await evalJs('window.__snapshotFetchCount');
    await evalJs(`(() => {
      window.postMessage({ type: 'workspace-change', payload: { workspaceUris: ['file:///evil'] } }, '*');
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'file://',
        data: { type: 'workspace-change', payload: { workspaceUris: ['file:///evil2'] } },
      }));
    })()`);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(await evalJs('window.__snapshotFetchCount'), countBeforeMsg, 'Spoofed top-level / file:// postMessage must be ignored');

    // 3. Smart Paste Korean IME (keyCode 229) Ctrl+Enter MUST NOT trigger preview (R4 F2)
    const pasteImeCheck = await evalJs(`(() => {
      const ta = document.querySelector('[data-testid="smart-paste-input"]');
      ta.value = 'https://ime-test.example/mcp';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      const imeEvt = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
      Object.defineProperty(imeEvt, 'keyCode', { value: 229 });
      ta.dispatchEvent(imeEvt);
      return Boolean(document.querySelector('[data-testid="smart-paste-preview"]'));
    })()`);
    assert.equal(pasteImeCheck, false, 'Korean IME keyCode 229 Ctrl+Enter must not submit Smart Paste');

    // 4. Real click on Clone to Global preserves full plugin secret on disk (never '••••••••')
    await evalJs(`document.querySelector(${JSON.stringify(cloneSelector)}).click()`);
    assert.equal(
      await waitUntil(() => Boolean(JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers?.['psrv-copy'])),
      true,
      'Clone to Global should persist psrv-copy on disk'
    );
    const afterClone = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(afterClone.mcpServers['psrv-copy'].headers.Authorization, 'Bearer real-plugin-secret-xyz');
    assert.deepEqual(afterClone.mcpServers['psrv-copy'].disabledTools, ['x']);

    // 5. Editor secret input uses type="password", scrubs on Cancel, and Korean IME Escape bubbling is guarded (R4 F2)
    await evalJs(`document.querySelector('#btn-add').click()`);
    assert.equal(await waitForSelector('[data-testid="server-editor-card"]'), true);
    const secretAndImeResult = await evalJs(`(() => {
      const addHeaderBtn = Array.from(document.querySelectorAll('[data-testid="server-editor-card"] button'))
        .find((b) => b.textContent.includes('Add HTTP Header'));
      addHeaderBtn.click();
      const secretInput = document.querySelector('[data-testid="server-editor-card"] input[data-secret-input="true"]');
      const isPassword = secretInput?.type === 'password';
      secretInput.value = 'temp-secret-draft';
      secretInput.dispatchEvent(new Event('input', { bubbles: true }));

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

      // Re-open editor to confirm previous secret draft was scrubbed
      document.querySelector('#btn-add').click();
      const remainingSecretInputs = document.querySelectorAll('[data-testid="server-editor-card"] input[data-secret-input="true"]').length;
      document.querySelector('[data-testid="server-editor-card"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      return { isPassword, stillOpenAfterIme, closedAfterEsc, remainingSecretInputs };
    })()`);
    assert.equal(secretAndImeResult.isPassword, true, 'Secret input must default to type="password"');
    assert.equal(secretAndImeResult.stillOpenAfterIme, true, 'Korean IME keyCode 229 Escape bubbling from <input> must NOT close editor');
    assert.equal(secretAndImeResult.closedAfterEsc, true, 'Non-IME Escape bubbling from <input> MUST close editor');
    assert.equal(secretAndImeResult.remainingSecretInputs, 0, 'Closing editor must scrub draft secret rows');

    // 6. Real Raw JSON Stdio save triggers 428 confirmation gate, then confirm writes to disk
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
    assert.equal(
      await waitUntil(() => JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers?.browserCmd?.command === 'node'),
      true,
      'Confirming Raw JSON Stdio should write browserCmd to disk'
    );

    // 7. External disk change triggers 409 Conflict banner in real Chromium
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { ext: { url: 'https://ext.example/mcp' } } }) + '\n', 'utf8');
    await evalJs(`document.querySelector('[data-testid="btn-save-raw"]').click()`);
    assert.equal(await waitForSelector('[data-testid="status-banner"]'), true, 'Expected 409 Conflict status banner');

    // 8. Malformed JSON on disk renders recovery banner + CAS backup restore works
    fs.writeFileSync(configPath, '{ broken-json', 'utf8');
    await evalJs(`document.querySelector('#btn-refresh').click()`);
    assert.equal(await waitForSelector('[data-testid="malformed-json-banner"]'), true);
    await evalJs(`document.querySelector('[data-testid="btn-restore-backup"]').click()`);
    assert.equal(
      await waitUntil(() => evalJs(`!document.querySelector('[data-testid="malformed-json-banner"]')`)),
      true,
      'Restoring backup should clear malformed-json-banner'
    );
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
    await new Promise((r) => setTimeout(r, 200));
    if (server) {
      await new Promise((r) => server.close(r));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
