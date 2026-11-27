import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { V3_IDS } from '../../src/adapters/antigravity/renderer/mcp-v3-shell.mjs';
import {
  buildAddonContextV3HarnessScript,
  findChromiumBinary,
  launchCdpSession,
  waitUntil,
} from '../helpers/cdp-browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const RENDERER_PATH = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'addon-renderer.js');
const MANIFEST_PATH = path.join(ROOT_DIR, 'addon-manifest.json');
const DESKTOP_SERVER_PATH = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'desktop-server.mjs');

test('NMCP-TC-021 (Real Chromium CDP E2E): AddonManifest.v3 registers Tier-1 Settings Page, Status Item, and Commands with zero host DOM scraping, persists EN/KO via ctx.storage, and cleans up on dispose()', async (t) => {
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-settings-v3-cdp-'));
  const profileDir = path.join(tmpDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const hostHarness = buildAddonContextV3HarnessScript(manifest, { surface: 'desktop', locale: 'en-US' });
  const parentServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body style="margin:0;height:100vh;background:#111;color:#eee;font-family:sans-serif;">
      <main id="host-shell">Host Shell (untouched)</main>
      <script>
        window.__TEST_V3_CONFIG_BRIDGE__ = {
          async read(scopeId) {
            if (scopeId === 'antigravity:mcp-config') {
              return { ok: true, scopeId, status: 'ok', data: { mcpServers: { settingsSrv: { url: 'https://settings-demo.example/mcp' } } }, rawText: null, sha256: 'sha-1' };
            }
            return { ok: true, scopeId, status: 'missing', data: null, rawText: null, sha256: null };
          },
          async write() { return { ok: true, currentSha256: 'sha-2' }; }
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
    assert.equal(
      await waitUntil(() => evalMain(`Boolean(window.__TEST_V3_DIAG__ && window.__TEST_V3_DIAG__.getSettingsPages().length > 0)`), 8000, 30),
      true
    );

    // 1. Tier-1 registrations exist immediately without mutating #host-shell (Desktop omits status item)
    const reg = await evalMain(`({
      statusItems: window.__TEST_V3_DIAG__.getStatusItems().map((s) => ({ id: s.id, label: s.label, badge: s.badge })),
      settingsPages: window.__TEST_V3_DIAG__.getSettingsPages(),
      commands: window.__TEST_V3_DIAG__.getCommands(),
      hostShellChildren: document.getElementById('host-shell').children.length,
    })`);
    assert.equal(reg.statusItems.length, 0, 'Desktop surface must not register a status item under host v3.0.3 contract');
    assert.deepEqual(reg.settingsPages, [V3_IDS.SETTINGS_PAGE]);
    assert.ok(reg.commands.includes(V3_IDS.CMD_OPEN_MANAGER));
    assert.ok(reg.commands.includes(V3_IDS.CMD_OPEN_PANEL));
    assert.ok(reg.commands.includes(V3_IDS.CMD_OPEN_SETTINGS));
    assert.equal(reg.hostShellChildren, 0, 'v3 API-First plugin must never scrape or mutate host shell DOM');

    // 2. Open Settings Page -> renders NativeMcpPanel inside ShadowRoot with Safe Style element
    await evalMain(`window.__TEST_V3_DIAG__.openSettingsPage(${JSON.stringify(V3_IDS.SETTINGS_PAGE)})`);
    assert.equal(
      await waitUntil(() =>
        evalMain(`(() => {
          const dlg = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]');
          const sr = dlg?.firstElementChild?.shadowRoot;
          return Boolean(
            dlg?.open &&
            sr?.querySelector('style[data-addon-host-owner="antigravity-mcp-manager"]') &&
            sr?.querySelector('[data-testid="global-server-settingsSrv"]')
          );
        })()`)
      ),
      true
    );

    // 3. Extenra v3.3.2+ host header [한국어|EN] switcher replaces duplicate inner switcher and syncs title + panel live
    const switchCheck = await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot;
      const hostKoBtn = sr.querySelector('[data-addon-host-lang="ko"]');
      const rect = hostKoBtn ? hostKoBtn.getBoundingClientRect() : null;
      return {
        hasHostLangSwitch: Boolean(hostKoBtn),
        hasDuplicateInnerLangSwitch: Boolean(sr.querySelector('[data-testid="lang-switch"]')),
        initialHeaderTitle: sr.querySelector('.ag-ui-title')?.textContent?.trim(),
        x: rect ? rect.left + rect.width / 2 : 0,
        y: rect ? rect.top + rect.height / 2 : 0,
      };
    })()`);
    assert.equal(switchCheck.hasHostLangSwitch, true, 'Settings Page must expose Extenra host header locale switch');
    assert.equal(switchCheck.hasDuplicateInnerLangSwitch, false, 'Inner duplicate language switcher must be omitted');
    assert.equal(switchCheck.initialHeaderTitle, 'MCP Manager');

    // Untrusted synthetic click must be ignored by Extenra host header switch
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-addon-host-lang="ko"]').click()`);
    assert.equal(await evalMain(`window.__TEST_V3_DIAG__.getLocale()`), 'en-US');

    // Real trusted mouse click via CDP switches host locale -> updates header title & panel live
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: switchCheck.x, y: switchCheck.y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: switchCheck.x, y: switchCheck.y, button: 'left', clickCount: 1 });
    assert.equal(
      await waitUntil(() => evalMain(`window.__TEST_V3_DIAG__.getLocale() === 'ko'`)),
      true,
      'Trusted click on Extenra host header locale switch must update central host locale'
    );
    const koTitles = await evalMain(`(() => {
      const sr = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot;
      return {
        headerTitle: sr.querySelector('.ag-ui-title')?.textContent?.trim(),
        panelTitle: sr.querySelector('.mcp-title')?.textContent?.trim(),
      };
    })()`);
    assert.equal(koTitles.headerTitle, 'MCP 매니저');
    assert.equal(koTitles.panelTitle, 'MCP 매니저');

    // 4. Clean disposal tears down overlays, status item, settings page, and commands
    await evalMain(`window.__TEST_V3_DIAG__.dispose()`);
    const afterDispose = await evalMain(`({
      overlays: document.querySelectorAll('[data-addon-host-owner="antigravity-mcp-manager"]').length,
      statusItems: window.__TEST_V3_DIAG__.getStatusItems().length,
      settingsPages: window.__TEST_V3_DIAG__.getSettingsPages().length,
      commands: window.__TEST_V3_DIAG__.getCommands().length,
    })`);
    assert.deepEqual(afterDispose, { overlays: 0, statusItems: 0, settingsPages: 0, commands: 0 });
    assert.equal(exceptions.length, 0);
  } finally {
    await session.close();
    await new Promise((r) => parentServer.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  }
});
