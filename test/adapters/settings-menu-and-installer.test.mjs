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

    // 1. Tier-1 registrations exist immediately without mutating #host-shell
    const reg = await evalMain(`({
      statusItems: window.__TEST_V3_DIAG__.getStatusItems().map((s) => ({ id: s.id, label: s.label, badge: s.badge })),
      settingsPages: window.__TEST_V3_DIAG__.getSettingsPages(),
      commands: window.__TEST_V3_DIAG__.getCommands(),
      hostShellChildren: document.getElementById('host-shell').children.length,
    })`);
    assert.equal(reg.statusItems.length, 1);
    assert.equal(reg.statusItems[0].id, V3_IDS.STATUS_ITEM);
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

    // 3. Switch language EN -> KO -> persists in ctx.storage (NOT window.localStorage)
    await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('[data-agy-mcp-lang-btn="ko"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`window.__TEST_V3_DIAG__.getStorageSnapshot().lang === 'ko'`)),
      true,
      'Language preference must persist via ctx.storage'
    );
    const koTitle = await evalMain(`document.querySelector('dialog[data-addon-host-v3-overlay="modal"]').firstElementChild.shadowRoot.querySelector('.mcp-title')?.textContent?.trim()`);
    assert.equal(koTitle, 'MCP 매니저');

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
