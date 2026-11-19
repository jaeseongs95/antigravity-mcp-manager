import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';

import { startDesktopMcpServer } from '../../src/adapters/antigravity/desktop-server.mjs';
import {
  getSettingsHookStatus,
  HOOK_END_MARKER,
  HOOK_START_MARKER,
  installSettingsHook,
  uninstallSettingsHook,
} from '../../scripts/install-settings-menu.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const INJECTOR_PATH = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'settings-menu-injector.js');
const DESKTOP_SERVER_PATH = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'desktop-server.mjs');

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

test('NMCP-TC-021 (Real Chromium CDP E2E): Settings sidebar injector mounts MCP Manager under Browser, loads desktop-server.mjs OOPIF iframe, and restores native pane on sibling click', async (t) => {
  // Static security invariants
  const injectorSrc = fs.readFileSync(INJECTOR_PATH, 'utf8');
  for (const rx of [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML\s*\(/, /document\.write\s*\(/, /\beval\s*\(/, /new\s+Function\s*\(/]) {
    assert.equal(rx.test(injectorSrc), false, `Forbidden DOM sink in settings-menu-injector.js: ${rx}`);
  }
  const serverSrc = fs.readFileSync(DESKTOP_SERVER_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.equal(/child_process|spawnSync|execFile|execSync/.test(serverSrc), false, 'desktop-server.mjs must not import child_process');

  const browserBin = findChromiumBinary();
  if (!browserBin || typeof WebSocket !== 'function') {
    t.skip('Headless Chromium/Edge binary or global WebSocket is unavailable on this host');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-settings-cdp-'));
  const profileDir = path.join(tmpDir, 'profile');
  const cfgDir = path.join(tmpDir, '.gemini', 'config');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, 'mcp_config.json'),
    JSON.stringify({ mcpServers: { settingsSrv: { url: 'https://settings-demo.example/mcp' } } }, null, 2) + '\n',
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
              <div id="left-sidebar-header">Settings</div>
              <nav id="settings-nav-section" style="display:flex;flex-direction:column;gap:4px;">
                <button type="button" id="nav-general" style="background-color:rgba(255,255,255,0.08);border:0;border-radius:6px;padding:8px 12px;color:#fff;font-size:13px;font-weight:400;text-align:left;">General</button>
                <button type="button" id="nav-application" style="background:transparent;border:0;border-radius:6px;padding:8px 12px;color:#ccc;font-size:13px;font-weight:400;text-align:left;">Application</button>
                <button type="button" id="nav-appearance" style="background:transparent;border:0;border-radius:6px;padding:8px 12px;color:#ccc;font-size:13px;font-weight:400;text-align:left;">Appearance</button>
                <button type="button" id="nav-shortcuts" style="background:transparent;border:0;border-radius:6px;padding:8px 12px;color:#ccc;font-size:13px;font-weight:400;text-align:left;">Shortcuts</button>
                <button type="button" id="nav-notifications" style="background:transparent;border:0;border-radius:6px;padding:8px 12px;color:#ccc;font-size:13px;font-weight:400;text-align:left;">Notifications</button>
                <button type="button" id="nav-models" style="background:transparent;border:0;border-radius:6px;padding:8px 12px;color:#ccc;font-size:13px;font-weight:400;text-align:left;">Models</button>
                <button type="button" id="nav-browser" style="background:transparent;border:0;border-radius:6px;padding:8px 12px;color:#ccc;font-size:13px;font-weight:400;text-align:left;">Browser</button>
              </nav>
              <div id="left-sidebar-projects">Projects</div>
            </aside>
            <main id="settings-content" style="flex:1;padding:16px;position:relative;">
              <button type="button" id="settings-close-btn" aria-label="Close Settings" style="position:absolute;top:12px;right:12px;width:32px;height:32px;">✕</button>
              <div id="native-general-pane">Native General Settings Panel</div>
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

    // 1. Verify MCP Manager item is inserted right after Browser and idempotent
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(document.querySelector('[data-agy-mcp-manager-nav="true"]'))`)),
      true,
      'MCP Manager nav item should be inserted into Settings sidebar'
    );
    const placement = await evalMain(`(() => {
      const browserBtn = document.getElementById('nav-browser');
      const next = browserBtn.nextElementSibling;
      return {
        nextText: next?.textContent?.trim(),
        nextAttr: next?.getAttribute('data-agy-mcp-manager-nav'),
        totalCount: document.querySelectorAll('[data-agy-mcp-manager-nav="true"]').length,
      };
    })()`);
    assert.equal(placement.nextText, 'MCP Manager');
    assert.equal(placement.nextAttr, 'true');
    assert.equal(placement.totalCount, 1);

    // 2. Click MCP Manager -> hides native pane (without removing it) and renders desktop-server.mjs UI inside iframe
    await evalMain(`document.querySelector('[data-agy-mcp-manager-nav="true"]').click()`);
    assert.equal(await waitUntil(() => Boolean(iframeSessionId || iframeContextId), 8000, 40), true);
    assert.equal(
      await waitUntil(async () => {
        try {
          return await evalIframe(`Boolean(document.querySelector('[data-testid="global-server-settingsSrv"]'))`);
        } catch {
          return false;
        }
      }, 8000, 40),
      true,
      'Settings MCP Manager iframe must load and render global-server-settingsSrv'
    );
    const hiddenCheck = await evalMain(`({
      nativeDisplay: document.getElementById('native-general-pane').style.display,
      closeBtnDisplay: document.getElementById('settings-close-btn').style.display,
      generalBg: window.getComputedStyle(document.getElementById('nav-general')).backgroundColor,
      mcpFontWeight: window.getComputedStyle(document.querySelector('[data-agy-mcp-manager-nav="true"]')).fontWeight,
      mcpLeft: document.querySelector('[data-agy-mcp-manager-nav="true"]').getBoundingClientRect().left,
      browserLeft: document.getElementById('nav-browser').getBoundingClientRect().left,
      mcpWidth: document.querySelector('[data-agy-mcp-manager-nav="true"]').getBoundingClientRect().width,
      browserWidth: document.getElementById('nav-browser').getBoundingClientRect().width,
      frameSrc: document.querySelector('[data-agy-mcp-manager-frame="true"]')?.src || '',
      frameParentId: document.querySelector('[data-agy-mcp-manager-frame="true"]')?.parentElement?.id || '',
      frameLeft: document.querySelector('[data-agy-mcp-manager-frame="true"]')?.getBoundingClientRect().left || 0,
      frameWidth: document.querySelector('[data-agy-mcp-manager-frame="true"]')?.getBoundingClientRect().width || 0,
      sidebarRight: document.getElementById('settings-sidebar').getBoundingClientRect().right,
    })`);
    assert.equal(hiddenCheck.nativeDisplay, 'none', 'Native Settings pane must be hidden (not destroyed) while MCP Manager is active');
    assert.notEqual(hiddenCheck.closeBtnDisplay, 'none', 'Settings top-right X close button MUST remain visible while MCP Manager is active');
    assert.equal(hiddenCheck.generalBg, 'rgba(0, 0, 0, 0)', 'Native General active highlight must be cleared while MCP Manager is active');
    assert.equal(hiddenCheck.mcpFontWeight, '400', 'MCP Manager nav item must inherit inactive sibling font weight (not bold)');
    assert.ok(Math.abs(hiddenCheck.mcpLeft - hiddenCheck.browserLeft) <= 1, `MCP Manager nav item must align pixel-for-pixel with Browser (${hiddenCheck.mcpLeft} vs ${hiddenCheck.browserLeft})`);
    assert.ok(Math.abs(hiddenCheck.mcpWidth - hiddenCheck.browserWidth) <= 1, `MCP Manager nav width must match Browser (${hiddenCheck.mcpWidth} vs ${hiddenCheck.browserWidth})`);
    assert.equal(hiddenCheck.frameSrc.includes('hostMode=settings'), true, 'Iframe URL must pass hostMode=settings');
    assert.equal(hiddenCheck.frameSrc.includes('hostFont='), true, 'Iframe URL must pass hostFont');
    assert.equal(hiddenCheck.frameParentId, 'settings-content', 'MCP Manager iframe MUST mount in right-hand settings-content, NEVER inside left sidebar');
    assert.ok(hiddenCheck.frameLeft >= hiddenCheck.sidebarRight - 24, `Expected iframe to the right of sidebar (${hiddenCheck.frameLeft} >= ${hiddenCheck.sidebarRight - 24})`);
    assert.ok(hiddenCheck.frameWidth >= 300, `Expected wide right-hand iframe (>=300px, got ${hiddenCheck.frameWidth})`);

    // 3. Click General -> hides iframe and restores native pane
    await evalMain(`document.getElementById('nav-general').click()`);
    const restored = await evalMain(`({
      nativeDisplay: document.getElementById('native-general-pane').style.display,
      frameDisplay: document.querySelector('[data-agy-mcp-manager-frame="true"]').style.display,
      navActive: document.querySelector('[data-agy-mcp-manager-nav="true"]').dataset.agyMcpActive,
    })`);
    assert.equal(restored.nativeDisplay, '');
    assert.equal(restored.frameDisplay, 'none');
    assert.equal(restored.navActive, 'false');
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

test('NMCP-TC-022 (Real @electron/asar Round-Trip): install-settings-menu.mjs installs idempotently, preserves backups & sibling hooks, and uninstalls cleanly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-asar-test-'));
  const srcDir = path.join(tmpDir, 'src');
  const distDir = path.join(srcDir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const originalMain = "'use strict';\n// EXISTING_OTHER_PLUGIN_MARKER\nconsole.log('main boot');\n";
  fs.writeFileSync(path.join(distDir, 'main.js'), originalMain, 'utf8');

  const asarPath = path.join(tmpDir, 'app.asar');
  await asar.createPackage(srcDir, asarPath);

  try {
    // 1. Initial status: not installed
    const s0 = getSettingsHookStatus({ asarPath });
    assert.equal(s0.ok, true);
    assert.equal(s0.installed, false);

    // 2. First install: adds hook, creates backup, preserves sibling marker
    const r1 = await installSettingsHook({ asarPath, pluginDir: ROOT_DIR });
    assert.equal(r1.ok, true);
    assert.equal(r1.installed, true);
    assert.equal(r1.backupCreated, true);
    assert.equal(fs.existsSync(r1.backupPath), true);

    const s1 = getSettingsHookStatus({ asarPath });
    assert.equal(s1.installed, true);

    // 3. Second install: idempotent (exactly 1 marker, reuses existing backup)
    const r2 = await installSettingsHook({ asarPath, pluginDir: ROOT_DIR });
    assert.equal(r2.ok, true);
    assert.equal(r2.backupCreated, false);
    const patchedMain = asar.extractFile(asarPath, 'dist/main.js').toString('utf8');
    assert.equal(patchedMain.split(HOOK_START_MARKER).length - 1, 1);
    assert.equal(patchedMain.split(HOOK_END_MARKER).length - 1, 1);
    assert.equal(patchedMain.includes('// EXISTING_OTHER_PLUGIN_MARKER'), true);

    // 4. Uninstall: removes ONLY our hook, preserves sibling marker
    const u1 = await uninstallSettingsHook({ asarPath });
    assert.equal(u1.ok, true);
    assert.equal(u1.removed, true);
    assert.equal(u1.installed, false);

    const afterUninstallMain = asar.extractFile(asarPath, 'dist/main.js').toString('utf8');
    assert.equal(afterUninstallMain.includes(HOOK_START_MARKER), false);
    assert.equal(afterUninstallMain.includes('// EXISTING_OTHER_PLUGIN_MARKER'), true);
    assert.equal(afterUninstallMain.includes("console.log('main boot');"), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
