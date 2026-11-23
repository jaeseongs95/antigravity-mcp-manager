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

test('NMCP-TC-027 (Real Chromium CDP E2E): Customizations MCP Servers header mounts Shadow DOM button & openModal <dialog> overlay with PortalArbiter, preserves marginTop/zIndex, syncs EN/KO, closes via Back/Esc, supports Korean page, and cleans up on dispose()', async (t) => {
  const browserBin = findChromiumBinary();
  if (!browserBin || typeof WebSocket !== 'function') {
    t.skip('Headless Chromium/Edge binary or global WebSocket is unavailable on this host');
    return;
  }

  const rendererSrc = fs.readFileSync(RENDERER_PATH, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const hostHarness = buildAddonHostHarnessScript(manifest);
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
          <script>${hostHarness}</script>
          <script>
            (function(addonHost) {
              ${rendererSrc}
            })(window.__TEST_ADDON_HOST__);
            // Simulate late SidecarBridge URL delivery in Isolated World 998 after renderer boot
            setTimeout(() => {
              const u = ${JSON.stringify(desktopSrv.url)};
              window.__AGY_MCP_MANAGER_URL__ = u;
              if (typeof window.__AGY_MCP_ON_SERVER_URL__ === 'function') {
                window.__AGY_MCP_ON_SERVER_URL__(u);
              }
            }, 30);
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

    // 1. Button slot mounted inside Shadow DOM right before native [] and + buttons with AddonManifest.v2 attrs
    assert.equal(
      await waitUntil(() =>
        evalMain(`(() => {
          const slot = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]');
          return Boolean(slot && slot.shadowRoot && slot.shadowRoot.querySelector('[data-agy-mcp-customizations-btn="true"]') && window.__AGY_MCP_MANAGER_URL__);
        })()`)
      ),
      true,
      'MCP Manager button must be mounted inside Shadow DOM in Customizations MCP Servers header'
    );
    const btnPlacement = await evalMain(`(() => {
      const actions = document.getElementById('mcp-header-actions');
      const slot = actions?.firstElementChild;
      const sr = slot?.shadowRoot;
      const btn = sr?.querySelector('[data-agy-mcp-customizations-btn="true"]');
      const rect = btn?.getBoundingClientRect();
      return {
        slotCount: document.querySelectorAll('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]').length,
        slotOwner: slot?.getAttribute('data-addon-host-owner'),
        slotId: slot?.getAttribute('data-addon-host-slot'),
        slotTranslate: slot?.getAttribute('translate'),
        slotHostNoTranslate: slot?.getAttribute('data-addon-host-no-translate'),
        slotAgyNoTranslate: slot?.getAttribute('data-agy-no-translate'),
        hasShadow: Boolean(sr),
        hasShadowStyle: Boolean(sr?.querySelector('style[data-addon-host-owner="antigravity-mcp-manager"]')),
        nextId: slot?.nextElementSibling?.id,
        text: btn?.textContent?.trim(),
        width: rect?.width || 0,
        height: rect?.height || 0,
      };
    })()`);
    assert.equal(btnPlacement.slotCount, 1);
    assert.equal(btnPlacement.slotOwner, 'antigravity-mcp-manager');
    assert.equal(btnPlacement.slotId, 'antigravity-mcp-manager.customizations-btn');
    assert.equal(btnPlacement.slotTranslate, 'no');
    assert.equal(btnPlacement.slotHostNoTranslate, 'true');
    assert.equal(btnPlacement.slotAgyNoTranslate, 'true');
    assert.equal(btnPlacement.hasShadow, true);
    assert.equal(btnPlacement.hasShadowStyle, true);
    assert.equal(btnPlacement.nextId, 'btn-raw-config');
    assert.equal(btnPlacement.text, 'MCP Manager');
    assert.ok(btnPlacement.width > 40 && btnPlacement.height > 16);

    // 2. Click button -> opens host openModal <dialog> with ShadowRoot + PortalArbiter without destroying native DOM
    await evalMain(`document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]').shadowRoot.querySelector('[data-agy-mcp-customizations-btn="true"]').click()`);
    assert.equal(await waitUntil(hasIframe, 8000, 40), true);
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
    const overlayState = await evalMain(`(() => {
      const dlg = document.querySelector('dialog[data-addon-host-modal-dialog="1"][data-addon-host-slot="antigravity-mcp-manager.customizations-overlay"]');
      const shadowHost = dlg?.querySelector('.addon-host-modal-shadow-host');
      const sr = shadowHost?.shadowRoot;
      return {
        exists: Boolean(dlg),
        isOpen: Boolean(dlg?.open),
        owner: dlg?.getAttribute('data-addon-host-owner'),
        translate: dlg?.getAttribute('translate'),
        role: dlg?.getAttribute('role'),
        marginTop: dlg?.style.marginTop || '',
        zIndex: Number(dlg?.style.zIndex || 0),
        portalActive: window.__TEST_ADDON_HOST_DIAG__.getPortalActive(),
        hasShadow: Boolean(sr),
        hasShadowStyle: Boolean(sr?.querySelector('style[data-addon-host-owner="antigravity-mcp-manager"]')),
        nativeListIntact: Boolean(document.getElementById('native-mcp-list')),
        backText: sr?.querySelector('[data-agy-mcp-customizations-back="true"]')?.textContent?.trim(),
      };
    })()`);
    assert.equal(overlayState.exists, true);
    assert.equal(overlayState.isOpen, true);
    assert.equal(overlayState.owner, 'antigravity-mcp-manager');
    assert.equal(overlayState.translate, 'no');
    assert.equal(overlayState.role, 'dialog');
    assert.equal(overlayState.marginTop.includes('36px'), true, 'openModal marginTop titlebar safe inset must be preserved');
    assert.ok(overlayState.zIndex >= 2147483001, 'openModal host zIndex must be preserved');
    assert.equal(overlayState.portalActive, true);
    assert.equal(overlayState.hasShadow, true);
    assert.equal(overlayState.hasShadowStyle, true);
    assert.equal(overlayState.nativeListIntact, true);
    assert.equal(overlayState.backText, '← Back to Customizations');

    // 3. Switch language to Korean inside overlay -> Shadow DOM button & Back button + namespaced localStorage update live
    await evalIframe(`document.querySelector('[data-testid="btn-lang-ko"]').click()`);
    assert.equal(
      await waitUntil(() => evalMain(`window.localStorage.getItem('antigravity-mcp-manager:lang') === 'ko'`), 3000, 30),
      true
    );
    const koLabels = await evalMain(`(() => {
      const btnSr = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]').shadowRoot;
      const modalSr = document.querySelector('dialog[data-addon-host-modal-dialog="1"] .addon-host-modal-shadow-host').shadowRoot;
      return {
        btnText: btnSr.querySelector('[data-agy-mcp-customizations-btn="true"]')?.textContent?.trim(),
        backText: modalSr.querySelector('[data-agy-mcp-customizations-back="true"]')?.textContent?.trim(),
      };
    })()`);
    assert.equal(koLabels.btnText, 'MCP 매니저');
    assert.equal(koLabels.backText, '← Customizations로 돌아가기');

    // 4. Close via Back button -> <dialog> closes & PortalArbiter deactivates
    await evalMain(`document.querySelector('dialog[data-addon-host-modal-dialog="1"] .addon-host-modal-shadow-host').shadowRoot.querySelector('[data-agy-mcp-customizations-back="true"]').click()`);
    const closedAfterBack = await evalMain(`({
      modalCount: document.querySelectorAll('dialog[data-addon-host-modal-dialog="1"]').length,
      portalActive: window.__TEST_ADDON_HOST_DIAG__.getPortalActive(),
    })`);
    assert.equal(closedAfterBack.modalCount, 0);
    assert.equal(closedAfterBack.portalActive, false);

    // 5. Reopen and close via capture-phase Escape key
    await evalMain(`document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]').shadowRoot.querySelector('[data-agy-mcp-customizations-btn="true"]').click()`);
    assert.equal(
      await evalMain(`Boolean(document.querySelector('dialog[data-addon-host-modal-dialog="1"]')?.open)`),
      true
    );
    await evalMain(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    assert.equal(await evalMain(`document.querySelectorAll('dialog[data-addon-host-modal-dialog="1"]').length`), 0);
    assert.equal(await evalMain(`window.__TEST_ADDON_HOST_DIAG__.getPortalActive()`), false);

    // 6. Korean-localized Customizations page still mounts Shadow DOM button cleanly
    await evalMain(`(() => {
      document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]')?.remove();
      document.getElementById('page-title').textContent = '사용자 정의';
      document.getElementById('skills-title').textContent = '스킬 및 규칙 13';
      document.getElementById('mcp-section-title').textContent = 'MCP 서버';
    })()`);
    assert.equal(
      await waitUntil(
        () =>
          evalMain(`(() => {
            const slot = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]');
            return Boolean(slot && slot.shadowRoot && slot.shadowRoot.querySelector('[data-agy-mcp-customizations-btn="true"]'));
          })()`),
        4000,
        30
      ),
      true,
      'Renderer must also mount Shadow DOM button on Korean-localized Customizations screen'
    );

    // 7. addonHost.dispose() removes custom slot, open modal, and all owner styles cleanly
    await evalMain(`document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]').shadowRoot.querySelector('[data-agy-mcp-customizations-btn="true"]').click()`);
    await evalMain(`window.__TEST_ADDON_HOST__.dispose()`);
    assert.equal(
      await evalMain(`document.querySelectorAll('[data-addon-host-owner="antigravity-mcp-manager"]').length`),
      0
    );
    assert.equal(await evalMain(`window.__TEST_ADDON_HOST_DIAG__.getPortalActive()`), false);
  } finally {
    await session.close();
    await desktopSrv.close();
    await new Promise((r) => parentServer.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  }
});
