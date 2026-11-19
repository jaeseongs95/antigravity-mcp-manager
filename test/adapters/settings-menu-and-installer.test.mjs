import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startDesktopMcpServer } from '../../src/adapters/antigravity/desktop-server.mjs';
import {
  buildAddonHostHarnessScript,
  findChromiumBinary,
  launchCdpSession,
  waitUntil,
} from '../helpers/cdp-browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const RENDERER_PATH = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'addon-renderer.js');
const MANIFEST_PATH = path.join(ROOT_DIR, 'addon-manifest.json');
const DESKTOP_SERVER_PATH = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'desktop-server.mjs');

test('NMCP-TC-021 (Real Chromium CDP E2E): AddonManifest.v1 renderer mounts Settings nav & pane via addonHost capability handle with 0px shift, no-translate isolation, EN/KO sync, and clean dispose()', async (t) => {
  const rendererSrc = fs.readFileSync(RENDERER_PATH, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const serverSrc = fs
    .readFileSync(DESKTOP_SERVER_PATH, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
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
  const hostHarness = buildAddonHostHarnessScript(manifest);
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
            <main id="settings-content" style="flex:1;padding:16px;position:relative;display:flex;flex-direction:column;">
              <button type="button" id="settings-close-btn" aria-label="Close Settings" style="position:absolute;top:12px;right:12px;width:32px;height:32px;">✕</button>
              <div id="native-general-pane">Native General Settings Panel</div>
            </main>
          </div>
          <script>${hostHarness}</script>
          <script>
            window.__AGY_MCP_MANAGER_URL__ = ${JSON.stringify(desktopSrv.url)};
            (function(addonHost) {
              ${rendererSrc}
            })(window.__TEST_ADDON_HOST__);
          </script>
        </body>
      </html>`);
  });
  await new Promise((r) => parentServer.listen(0, '127.0.0.1', r));
  const parentPort = parentServer.address().port;

  const session = await launchCdpSession({
    browserBin,
    profileDir,
    iframeOrigin: `http://127.0.0.1:${desktopSrv.port}`,
  });

  try {
    const { cdp, evalMain, evalIframe, hasIframe } = session;
    await cdp('Page.navigate', { url: `http://localhost:${parentPort}/` });

    // 1. Verify MCP Manager slot is mounted right after Browser with AddonManifest.v1 isolation attrs
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(document.querySelector('[data-agy-mcp-manager-nav="true"]'))`)),
      true,
      'MCP Manager nav item should be inserted into Settings sidebar'
    );
    const placement = await evalMain(`(() => {
      const browserBtn = document.getElementById('nav-browser');
      const slot = browserBtn.nextElementSibling;
      const nav = slot?.querySelector('[data-agy-mcp-manager-nav="true"]');
      const styleEl = document.querySelector('style[data-addon-host-owner="antigravity-mcp-manager"]');
      return {
        slotOwner: slot?.getAttribute('data-addon-host-owner'),
        slotId: slot?.getAttribute('data-addon-host-slot'),
        slotTranslate: slot?.getAttribute('translate'),
        slotAgyNoTranslate: slot?.getAttribute('data-agy-no-translate'),
        navText: nav?.textContent?.trim(),
        totalCount: document.querySelectorAll('[data-agy-mcp-manager-nav="true"]').length,
        hasScopedStyle: Boolean(styleEl),
      };
    })()`);
    assert.equal(placement.slotOwner, 'antigravity-mcp-manager');
    assert.equal(placement.slotId, 'antigravity-mcp-manager.settings-nav');
    assert.equal(placement.slotTranslate, 'no');
    assert.equal(placement.slotAgyNoTranslate, 'true');
    assert.equal(placement.navText, 'MCP Manager');
    assert.equal(placement.totalCount, 1);
    assert.equal(placement.hasScopedStyle, true);

    // 2. Capture exact navItem & Projects geometry BEFORE click, then click MCP Manager -> assert 0px layout shift
    const beforeClickRect = await evalMain(`(() => {
      const nav = document.querySelector('[data-agy-mcp-manager-nav="true"]').getBoundingClientRect();
      const proj = document.getElementById('left-sidebar-projects').getBoundingClientRect();
      return { left: nav.left, top: nav.top, width: nav.width, height: nav.height, projTop: proj.top };
    })()`);
    await evalMain(`document.querySelector('[data-agy-mcp-manager-nav="true"]').click()`);
    const afterClickRect = await evalMain(`(() => {
      const nav = document.querySelector('[data-agy-mcp-manager-nav="true"]').getBoundingClientRect();
      const proj = document.getElementById('left-sidebar-projects').getBoundingClientRect();
      return { left: nav.left, top: nav.top, width: nav.width, height: nav.height, projTop: proj.top };
    })()`);
    assert.deepEqual(afterClickRect, beforeClickRect, 'Clicking MCP Manager nav button MUST cause 0px layout shift');
    assert.equal(await waitUntil(hasIframe, 8000, 40), true);
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
      paneOwner: document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]')?.getAttribute('data-addon-host-owner') || '',
      paneParentId: document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]')?.parentElement?.id || '',
      frameLeft: document.querySelector('[data-agy-mcp-manager-frame="true"]')?.getBoundingClientRect().left || 0,
      frameWidth: document.querySelector('[data-agy-mcp-manager-frame="true"]')?.getBoundingClientRect().width || 0,
      sidebarRight: document.getElementById('settings-sidebar').getBoundingClientRect().right,
    })`);
    assert.equal(hiddenCheck.nativeDisplay, 'none');
    assert.notEqual(hiddenCheck.closeBtnDisplay, 'none');
    assert.equal(hiddenCheck.generalBg, 'rgba(0, 0, 0, 0)');
    assert.equal(hiddenCheck.mcpFontWeight, '400');
    assert.ok(Math.abs(hiddenCheck.mcpLeft - hiddenCheck.browserLeft) <= 1);
    assert.ok(Math.abs(hiddenCheck.mcpWidth - hiddenCheck.browserWidth) <= 1);
    assert.equal(hiddenCheck.frameSrc.includes('hostMode=settings'), true);
    assert.equal(hiddenCheck.frameSrc.includes('hostFont='), true);
    assert.equal(hiddenCheck.paneOwner, 'antigravity-mcp-manager');
    assert.equal(hiddenCheck.paneParentId, 'settings-content');
    assert.ok(hiddenCheck.frameLeft >= hiddenCheck.sidebarRight - 24);
    assert.ok(hiddenCheck.frameWidth >= 300);

    // 3. Switch language to Korean and back to English -> persisted under storageNamespace key
    await evalIframe(`document.querySelector('[data-testid="btn-lang-ko"]').click()`);
    const koState = await evalIframe(`({
      htmlLang: document.documentElement.lang,
      title: document.getElementById('app-title')?.textContent?.trim(),
      refresh: document.getElementById('btn-refresh')?.textContent?.trim(),
      add: document.getElementById('btn-add')?.textContent?.trim(),
      tabServers: document.getElementById('tab-servers')?.textContent?.trim(),
      tabRaw: document.getElementById('tab-raw')?.textContent?.trim(),
      sectionTitle: document.querySelector('.section-title')?.textContent?.trim(),
      koPressed: document.querySelector('[data-testid="btn-lang-ko"]')?.getAttribute('aria-pressed'),
    })`);
    assert.equal(koState.htmlLang, 'ko');
    assert.equal(koState.title, 'MCP 매니저');
    assert.equal(koState.refresh, '새로고침');
    assert.equal(koState.add, '+ 서버 추가');
    assert.equal(koState.tabServers, '서버 목록');
    assert.equal(koState.tabRaw, '원본 JSON');
    assert.equal(koState.sectionTitle, '전역 MCP 서버 (1)');
    assert.equal(koState.koPressed, 'true');
    assert.equal(
      await waitUntil(() => evalMain(`window.localStorage.getItem('antigravity-mcp-manager:lang') === 'ko'`), 3000, 30),
      true,
      'Parent host must persist Korean language choice under storageNamespace key'
    );

    await evalIframe(`document.querySelector('[data-testid="btn-lang-en"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`window.localStorage.getItem('antigravity-mcp-manager:lang') === 'en'`), 3000, 30),
      true
    );

    // 4. Click General -> hides pane slot and restores native pane
    await evalMain(`document.getElementById('nav-general').click()`);
    const restored = await evalMain(`({
      nativeDisplay: document.getElementById('native-general-pane').style.display,
      paneDisplay: document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.pane"]').style.display,
      navActive: document.querySelector('[data-agy-mcp-manager-nav="true"]').dataset.agyMcpActive,
    })`);
    assert.equal(restored.nativeDisplay, '');
    assert.equal(restored.paneDisplay, 'none');
    assert.equal(restored.navActive, 'false');

    // 5. Korean-localized Settings sidebar still mounts under 브라우저
    await evalMain(`(() => {
      document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.settings-nav"]')?.remove();
      const map = {
        'nav-general': '일반',
        'nav-application': '애플리케이션',
        'nav-appearance': '외관',
        'nav-shortcuts': '단축키',
        'nav-notifications': '알림',
        'nav-models': '모델',
        'nav-browser': '브라우저',
      };
      for (const [id, text] of Object.entries(map)) {
        document.getElementById(id).textContent = text;
      }
    })()`);
    assert.equal(
      await waitUntil(
        () =>
          evalMain(
            `document.getElementById('nav-browser')?.nextElementSibling?.getAttribute('data-addon-host-slot') === 'antigravity-mcp-manager.settings-nav'`
          ),
        4000,
        30
      ),
      true
    );

    // 6. Re-open MCP Manager pane and invoke addonHost.dispose() -> ALL slots/styles removed & native pane restored
    await evalMain(`document.querySelector('[data-agy-mcp-manager-nav="true"]').click()`);
    await evalMain(`window.__TEST_ADDON_HOST__.dispose()`);
    const disposedState = await evalMain(`({
      ownedSlots: document.querySelectorAll('[data-addon-host-owner="antigravity-mcp-manager"]').length,
      nativeDisplay: document.getElementById('native-general-pane').style.display,
      suppressedNodes: document.querySelectorAll('[data-agy-mcp-suppressed-bg]').length,
    })`);
    assert.equal(disposedState.ownedSlots, 0, 'addonHost.dispose() must remove all owned slots and styles');
    assert.equal(disposedState.nativeDisplay, '', 'addonHost.dispose() must restore hidden native Settings pane');
    assert.equal(disposedState.suppressedNodes, 0, 'addonHost.dispose() must restore suppressed native active highlights');
  } finally {
    await session.close();
    await desktopSrv.close();
    await new Promise((r) => parentServer.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  }
});
