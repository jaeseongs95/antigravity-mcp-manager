import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { startDesktopMcpServer } from '../../src/adapters/antigravity/desktop-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
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

test('NMCP-TC-027 (Real Chromium CDP E2E): Customizations MCP Servers header mounts MCP Manager button, opens full-pane overlay, syncs EN/KO, closes via Back/Esc, and supports Korean Customizations', async (t) => {
  const browserBin = findChromiumBinary();
  if (!browserBin || typeof WebSocket !== 'function') {
    t.skip('Headless Chromium/Edge binary or global WebSocket is unavailable on this host');
    return;
  }

  const injectorSrc = fs.readFileSync(INJECTOR_PATH, 'utf8');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-customizations-cdp-'));
  const profileDir = path.join(tmpDir, 'profile');
  const cfgDir = path.join(tmpDir, '.gemini', 'config');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, 'mcp_config.json'),
    JSON.stringify({ mcpServers: { custSrv: { url: 'https://cust-demo.example/mcp' } } }, null, 2) + '\n',
    'utf8'
  );

  const desktopSrv = await startDesktopMcpServer({ homeDir: tmpDir });
  const parentServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
      <html>
        <body style="margin:0;background:#0d0e11;color:#e5e7eb;font-family:sans-serif;padding:24px;">
          <main id="customizations-page">
            <h1 id="page-title">Customizations</h1>
            <section>
              <h2 id="skills-title">Skills &amp; Rules <span>13</span></h2>
            </section>
            <section>
              <h2 id="agents-title">Custom Agents <span>0</span></h2>
            </section>
            <section id="mcp-section">
              <div id="mcp-header-row" style="display:flex;align-items:center;justify-content:space-between;">
                <button type="button" id="mcp-collapse-btn" style="background:transparent;border:0;color:inherit;display:flex;gap:8px;align-items:center;">
                  <span id="mcp-section-title">MCP Servers</span>
                  <span>3</span>
                </button>
                <div id="mcp-header-actions" style="display:flex;align-items:center;gap:6px;">
                  <button type="button" id="btn-raw-config" aria-label="Open mcp_config.json">[]</button>
                  <button type="button" id="btn-add-mcp" aria-label="Add MCP server">+</button>
                </div>
              </div>
              <div id="native-mcp-list">ledger · prod_server_mcp · test_server_mcp</div>
            </section>
          </main>
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
    assert.ok(wsUrl, 'Headless browser did not expose CDP target');

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

    // 1. Button inserted once right before native [] and + buttons
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(document.querySelector('[data-agy-mcp-customizations-btn="true"]'))`)),
      true,
      'MCP Manager button must be mounted in Customizations MCP Servers header'
    );
    const btnPlacement = await evalMain(`(() => {
      const actions = document.getElementById('mcp-header-actions');
      const btn = document.querySelector('[data-agy-mcp-customizations-btn="true"]');
      return {
        count: document.querySelectorAll('[data-agy-mcp-customizations-btn="true"]').length,
        parentId: btn?.parentElement?.id,
        nextId: btn?.nextElementSibling?.id,
        text: btn?.textContent?.trim(),
        actionsFirstChildIsBtn: actions?.firstElementChild === btn,
      };
    })()`);
    assert.equal(btnPlacement.count, 1);
    assert.equal(btnPlacement.parentId, 'mcp-header-actions');
    assert.equal(btnPlacement.nextId, 'btn-raw-config');
    assert.equal(btnPlacement.text, 'MCP Manager');
    assert.equal(btnPlacement.actionsFirstChildIsBtn, true);

    // 2. Click button -> opens full-pane overlay without destroying native Customizations DOM
    await evalMain(`document.querySelector('[data-agy-mcp-customizations-btn="true"]').click()`);
    assert.equal(await waitUntil(() => Boolean(iframeSessionId || iframeContextId), 8000, 40), true);
    assert.equal(
      await waitUntil(async () => {
        try {
          return await evalIframe(`Boolean(document.querySelector('[data-testid="global-server-custSrv"]'))`);
        } catch {
          return false;
        }
      }, 8000, 40),
      true,
      'Customizations overlay iframe must load and render global-server-custSrv'
    );
    const overlayState = await evalMain(`({
      role: document.querySelector('[data-agy-mcp-customizations-overlay="true"]')?.getAttribute('role'),
      display: document.querySelector('[data-agy-mcp-customizations-overlay="true"]')?.style.display,
      nativeListIntact: Boolean(document.getElementById('native-mcp-list')),
      backText: document.querySelector('[data-agy-mcp-customizations-back="true"]')?.textContent?.trim(),
    })`);
    assert.equal(overlayState.role, 'dialog');
    assert.equal(overlayState.display, 'flex');
    assert.equal(overlayState.nativeListIntact, true);
    assert.equal(overlayState.backText, '← Back to Customizations');

    // 3. Switch language to Korean inside overlay -> host labels & localStorage update live
    await evalIframe(`document.querySelector('[data-testid="btn-lang-ko"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`window.localStorage.getItem('agy-mcp-manager-lang') === 'ko'`), 3000, 30),
      true
    );
    const koLabels = await evalMain(`({
      btnText: document.querySelector('[data-agy-mcp-customizations-btn="true"]')?.textContent?.trim(),
      backText: document.querySelector('[data-agy-mcp-customizations-back="true"]')?.textContent?.trim(),
    })`);
    assert.equal(koLabels.btnText, 'MCP 매니저');
    assert.equal(koLabels.backText, '← Customizations로 돌아가기');

    // 4. Close via Back button -> overlay hides cleanly
    await evalMain(`document.querySelector('[data-agy-mcp-customizations-back="true"]').click()`);
    assert.equal(
      await evalMain(`document.querySelector('[data-agy-mcp-customizations-overlay="true"]')?.style.display`),
      'none'
    );

    // 5. Reopen and close via Escape key
    await evalMain(`document.querySelector('[data-agy-mcp-customizations-btn="true"]').click()`);
    assert.equal(
      await evalMain(`document.querySelector('[data-agy-mcp-customizations-overlay="true"]')?.style.display`),
      'flex'
    );
    await evalMain(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.equal(
      await evalMain(`document.querySelector('[data-agy-mcp-customizations-overlay="true"]')?.style.display`),
      'none'
    );

    // 6. Korean-localized Customizations page still mounts button cleanly
    await evalMain(`(() => {
      document.querySelector('[data-agy-mcp-customizations-btn="true"]')?.remove();
      document.getElementById('page-title').textContent = '사용자 정의';
      document.getElementById('skills-title').textContent = '스킬 및 규칙 13';
      document.getElementById('mcp-section-title').textContent = 'MCP 서버';
    })()`);
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(document.querySelector('[data-agy-mcp-customizations-btn="true"]'))`), 4000, 30),
      true,
      'Injector must also mount button on Korean-localized Customizations screen'
    );
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
