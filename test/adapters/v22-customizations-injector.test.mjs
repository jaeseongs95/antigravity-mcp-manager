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

test('NMCP-TC-027 & NMCP-TC-033 (Real Chromium CDP E2E): Tier-2 declarative openPanel (Status Item click -> drawer placement -> handle.update in-place language & server toggle -> mobile <=640px bottom sheet auto-switch) and Tier-3 openModal (surface-center placement -> Escape close -> clean dispose())', async (t) => {
  const browserBin = findChromiumBinary();
  if (!browserBin || typeof WebSocket !== 'function') {
    t.skip('Headless Chromium/Edge binary or global WebSocket is unavailable on this host');
    return;
  }

  const rendererSrc = fs.readFileSync(RENDERER_PATH, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const hostHarness = buildAddonContextV3HarnessScript(manifest, { surface: 'desktop', locale: 'en-US' });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-v3-overlay-cdp-'));
  const profileDir = path.join(tmpDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const parentServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;height:100vh;background:#0d0e11;color:#e5e7eb;font-family:sans-serif;">
      <script>
        (function() {
          let state = { mcpServers: { custSrv: { url: 'https://cust-demo.example/mcp' } } };
          let rev = 1;
          window.__TEST_V3_CONFIG_BRIDGE__ = {
            async read(scopeId) {
              if (scopeId === 'antigravity:mcp-config') {
                return { ok: true, scopeId, status: 'ok', data: JSON.parse(JSON.stringify(state)), rawText: null, sha256: 'rev-' + rev };
              }
              return { ok: true, scopeId, status: 'missing', data: null, rawText: null, sha256: null };
            },
            async write(scopeId, nextDataOrRawJson, opts) {
              if ((opts?.expectedSha256 ?? null) !== 'rev-' + rev) {
                return { ok: false, reason: 'ERR_CONFIG_CAS_CONFLICT', currentSha256: 'rev-' + rev };
              }
              state = typeof nextDataOrRawJson === 'string' ? JSON.parse(nextDataOrRawJson) : nextDataOrRawJson;
              rev += 1;
              return { ok: true, currentSha256: 'rev-' + rev };
            }
          };
          window.__TEST_STATE__ = () => state;
        })();
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
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: `http://localhost:${parentPort}/` });

    // 1. Click Tier-1 Status Item -> opens Tier-2 declarative drawer panel
    assert.equal(
      await waitUntil(() => evalMain(`window.__TEST_V3_DIAG__.getStatusItems()[0]?.badge === '1'`)),
      true
    );
    await evalMain(`window.__TEST_V3_DIAG__.clickStatusItem(${JSON.stringify(V3_IDS.STATUS_ITEM)})`);
    assert.equal(
      await waitUntil(() =>
        evalMain(`(() => {
          const panel = document.querySelector('[data-addon-host-v3-overlay="panel"]');
          return Boolean(panel && panel.getAttribute('data-addon-host-zone') === 'drawer' && panel.shadowRoot?.querySelector('[data-ag-node-id="mcp-server-list"]'));
        })()`)
      ),
      true,
      'Clicking status item must open Tier-2 declarative drawer panel'
    );

    // 2. Toggle server directly from Tier-2 declarative list action -> persists + emits Tier-1 Toast
    await evalMain(`document.querySelector('[data-addon-host-v3-overlay="panel"]').shadowRoot.querySelector('[data-ag-list-action="srv-custSrv"]').click()`);
    assert.equal(await waitUntil(() => evalMain(`window.__TEST_STATE__().mcpServers.custSrv.disabled === true`)), true);
    assert.equal(await evalMain(`window.__TEST_V3_DIAG__.getToasts().some((t) => t.variant === 'success')`), true);

    // 3. Resize viewport to mobile (<=640px) -> PlacementEngine auto-switches Tier-2 panel to bottom sheet
    await cdp('Emulation.setDeviceMetricsOverride', { width: 480, height: 800, deviceScaleFactor: 1, mobile: false });
    await evalMain(`window.dispatchEvent(new Event('resize'))`);
    assert.equal(
      await waitUntil(() => evalMain(`document.querySelector('[data-addon-host-v3-overlay="panel"]')?.getAttribute('data-addon-host-zone') === 'sheet'`)),
      true,
      'Narrow viewport <=640px must auto-switch Tier-2 panel to mobile bottom sheet'
    );

    // 4. Click "Open Full Editor" inside Tier-2 panel -> closes panel and opens Tier-3 surface-center modal
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await evalMain(`document.querySelector('[data-addon-host-v3-overlay="panel"]').shadowRoot.querySelector('[data-ag-node-id="mcp-btn-open-editor"]').click()`);
    assert.equal(
      await waitUntil(() =>
        evalMain(`(() => {
          const dlg = document.querySelector('dialog[data-addon-host-v3-overlay="modal"]');
          const sr = dlg?.firstElementChild?.shadowRoot;
          return Boolean(
            dlg?.open &&
            dlg.getAttribute('data-addon-host-zone') === 'surface-center' &&
            !document.querySelector('[data-addon-host-v3-overlay="panel"]') &&
            sr?.querySelector('[data-testid="global-server-custSrv"]')
          );
        })()`)
      ),
      true,
      'Open Full Editor button must transition cleanly from Tier-2 panel to Tier-3 centered modal'
    );

    // 5. Escape closes Tier-3 modal cleanly
    await evalMain(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    assert.equal(await evalMain(`document.querySelectorAll('dialog[data-addon-host-v3-overlay="modal"]').length`), 0);

    // 6. Clean dispose()
    await evalMain(`window.__TEST_V3_DIAG__.dispose()`);
    assert.equal(await evalMain(`document.querySelectorAll('[data-addon-host-owner="antigravity-mcp-manager"]').length`), 0);
    assert.equal(exceptions.length, 0);
  } finally {
    await session.close();
    await new Promise((r) => parentServer.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  }
});
