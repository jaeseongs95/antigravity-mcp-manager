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
            <section id="mcp-section" style="max-width:720px;">
              <div id="mcp-header-row" style="display:flex;align-items:center;justify-content:space-between;">
                <div id="mcp-left-wrapper" style="display:flex;flex-direction:column;align-items:flex-start;">
                  <button type="button" id="mcp-collapse-btn" style="background:transparent;border:0;color:inherit;display:inline-flex;gap:8px;align-items:center;padding:4px 0;">
                    <span id="mcp-section-title">MCP Servers</span>
                    <span>3</span>
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"></svg>
                  </button>
                </div>
                <div id="mcp-header-actions" style="display:flex;align-items:center;gap:6px;">
                  <button type="button" id="btn-raw-config" aria-label="Open mcp_config.json" style="width:24px;height:24px;">[]</button>
                  <button type="button" id="btn-add-mcp" aria-label="Add MCP server" style="width:24px;height:24px;">+</button>
                </div>
              </div>
              <div id="native-mcp-list" style="margin-top:12px;">
                <div>ledger <button type="button" class="signout-btn">Sign out</button></div>
              </div>
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
      const slot = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]');
      const sr = slot?.shadowRoot;
      const btn = sr?.querySelector('[data-agy-mcp-customizations-btn="true"]');
      const titleBtn = document.getElementById('mcp-collapse-btn');
      const rawBtn = document.getElementById('btn-raw-config');
      const rect = btn?.getBoundingClientRect();
      const titleRect = titleBtn?.getBoundingClientRect();
      const rawRect = rawBtn?.getBoundingClientRect();
      const btnCy = rect ? (rect.top + rect.bottom) / 2 : 0;
      const titleCy = titleRect ? (titleRect.top + titleRect.bottom) / 2 : 0;
      const rawCy = rawRect ? (rawRect.top + rawRect.bottom) / 2 : 0;
      return {
        slotCount: document.querySelectorAll('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]').length,
        parentId: slot?.parentElement?.id || null,
        isFirstInActions: actions?.firstElementChild === slot,
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
        sameRowAsActions: Boolean(rect && rawRect && Math.abs(btnCy - rawCy) <= 4),
        sameRowAsTitle: Boolean(rect && titleRect && Math.abs(btnCy - titleCy) <= 4),
        rightOfTitle: Boolean(rect && titleRect && rect.left > titleRect.right),
        leftOfRawConfig: Boolean(rect && rawRect && rect.right <= rawRect.left),
      };
    })()`);
    assert.equal(btnPlacement.slotCount, 1);
    assert.equal(btnPlacement.parentId, 'mcp-header-actions');
    assert.equal(btnPlacement.isFirstInActions, true);
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
    assert.equal(btnPlacement.sameRowAsActions, true, 'MCP Manager button must align on the same horizontal row as [] and +');
    assert.equal(btnPlacement.sameRowAsTitle, true, 'MCP Manager button must align on the same horizontal row as MCP Servers heading');
    assert.equal(btnPlacement.rightOfTitle, true, 'MCP Manager button must sit to the right of MCP Servers heading (never stacked above on left)');
    assert.equal(btnPlacement.leftOfRawConfig, true, 'MCP Manager button must sit immediately before [] action button');

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
      const rect = dlg?.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const centerX = rect ? (rect.left + rect.right) / 2 : 0;
      return {
        exists: Boolean(dlg),
        isOpen: Boolean(dlg?.open),
        owner: dlg?.getAttribute('data-addon-host-owner'),
        translate: dlg?.getAttribute('translate'),
        role: dlg?.getAttribute('role'),
        marginTop: dlg?.style.marginTop || '',
        borderRadius: dlg?.style.borderRadius || '',
        zIndex: Number(dlg?.style.zIndex || 0),
        portalActive: window.__TEST_ADDON_HOST_DIAG__.getPortalActive(),
        hasShadow: Boolean(sr),
        hasShadowStyle: Boolean(sr?.querySelector('style[data-addon-host-owner="antigravity-mcp-manager"]')),
        nativeListIntact: Boolean(document.getElementById('native-mcp-list')),
        popupTitle: sr?.querySelector('[data-agy-mcp-customizations-title="true"]')?.textContent?.trim(),
        isNotFullscreenWidth: Boolean(rect && rect.width > 0 && rect.width <= vw - 40),
        isNotFullscreenHeight: Boolean(rect && rect.height > 0 && rect.height <= vh - 60),
        isHorizontallyCentered: Boolean(rect && Math.abs(centerX - vw / 2) <= 4),
        belowTitlebar: Boolean(rect && rect.top >= 36),
      };
    })()`);
    assert.equal(overlayState.exists, true);
    assert.equal(overlayState.isOpen, true);
    assert.equal(overlayState.owner, 'antigravity-mcp-manager');
    assert.equal(overlayState.translate, 'no');
    assert.equal(overlayState.role, 'dialog');
    assert.equal(overlayState.marginTop.includes('36px'), true, 'openModal marginTop titlebar safe inset must be preserved');
    assert.equal(overlayState.borderRadius, '14px', 'Popup modal must have rounded window corners');
    assert.ok(overlayState.zIndex >= 2147483001, 'openModal host zIndex must be preserved');
    assert.equal(overlayState.portalActive, true);
    assert.equal(overlayState.hasShadow, true);
    assert.equal(overlayState.hasShadowStyle, true);
    assert.equal(overlayState.nativeListIntact, true);
    assert.equal(overlayState.popupTitle, 'MCP Manager');
    assert.equal(overlayState.isNotFullscreenWidth, true, 'Popup modal width must be narrower than fullscreen viewport');
    assert.equal(overlayState.isNotFullscreenHeight, true, 'Popup modal height must be shorter than fullscreen viewport');
    assert.equal(overlayState.isHorizontallyCentered, true, 'Popup modal must be horizontally centered');
    assert.equal(overlayState.belowTitlebar, true, 'Popup modal must respect titlebar safe top inset');

    // 3. Switch language to Korean inside popup -> Shadow DOM button & popup title + namespaced localStorage update live
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
        popupTitle: modalSr.querySelector('[data-agy-mcp-customizations-title="true"]')?.textContent?.trim(),
      };
    })()`);
    assert.equal(koLabels.btnText, 'MCP 매니저');
    assert.equal(koLabels.popupTitle, 'MCP 매니저');

    // 4. Close via ✕ button -> <dialog> closes & PortalArbiter deactivates
    await evalMain(`document.querySelector('dialog[data-addon-host-modal-dialog="1"] .addon-host-modal-shadow-host').shadowRoot.querySelector('[data-agy-mcp-customizations-close="true"]').click()`);
    const closedAfterCloseBtn = await evalMain(`({
      modalCount: document.querySelectorAll('dialog[data-addon-host-modal-dialog="1"]').length,
      portalActive: window.__TEST_ADDON_HOST_DIAG__.getPortalActive(),
    })`);
    assert.equal(closedAfterCloseBtn.modalCount, 0);
    assert.equal(closedAfterCloseBtn.portalActive, false);

    // 4b. Reopen and close via clicking dimmed backdrop outside dialog bounds
    await evalMain(`document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]').shadowRoot.querySelector('[data-agy-mcp-customizations-btn="true"]').click()`);
    assert.equal(
      await evalMain(`Boolean(document.querySelector('dialog[data-addon-host-modal-dialog="1"]')?.open)`),
      true
    );
    await evalMain(`(() => {
      const dlg = document.querySelector('dialog[data-addon-host-modal-dialog="1"]');
      dlg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 4, clientY: 4 }));
    })()`);
    assert.equal(await evalMain(`document.querySelectorAll('dialog[data-addon-host-modal-dialog="1"]').length`), 0);
    assert.equal(await evalMain(`window.__TEST_ADDON_HOST_DIAG__.getPortalActive()`), false);

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

test('NMCP-TC-033 (Real Chromium CDP E2E): Customizations popup passes surface="customizations-page" to antigravity-addons v2.4.0+ openModal, centers inside non-full-viewport content surface (excluding left sidebar), and respects dynamic host maxWidth on narrow resize', async (t) => {
  const browserBin = findChromiumBinary();
  if (!browserBin || typeof WebSocket !== 'function') {
    t.skip('Headless Chromium/Edge binary or global WebSocket is unavailable on this host');
    return;
  }

  const rendererSrc = fs.readFileSync(RENDERER_PATH, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const hostHarness = buildAddonHostHarnessScript(manifest, { enableSurfaceGeometry: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-customizations-surface-cdp-'));
  const profileDir = path.join(tmpDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const parentServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
      <html>
        <body style="margin:0;padding:0;background:#0d0e11;color:#e5e7eb;font-family:sans-serif;display:flex;height:100vh;width:100vw;overflow:hidden;">
          <aside data-testid="sidebar" style="width:260px;flex:0 0 260px;height:100vh;background:#16181d;border-right:1px solid #2b2f38;">Sidebar</aside>
          <main data-testid="customizations-view" style="flex:1;min-width:0;padding:48px 24px 24px 24px;box-sizing:border-box;">
            <h1>Customizations</h1>
            <section id="mcp-section" style="max-width:720px;">
              <div id="mcp-header-row" style="display:flex;align-items:center;justify-content:space-between;">
                <button type="button" id="mcp-collapse-btn" style="background:transparent;border:0;color:inherit;">
                  <span>MCP Servers</span> <span>3</span>
                </button>
                <div id="mcp-header-actions" style="display:flex;align-items:center;gap:6px;">
                  <button type="button" id="btn-raw-config" style="width:24px;height:24px;">[]</button>
                  <button type="button" id="btn-add-mcp" style="width:24px;height:24px;">+</button>
                </div>
              </div>
            </section>
          </main>
          <script>${hostHarness}</script>
          <script>
            (function(addonHost) {
              ${rendererSrc}
            })(window.__TEST_ADDON_HOST__);
          </script>
        </body>
      </html>`);
  });
  await new Promise((r) => parentServer.listen(0, '127.0.0.1', r));
  const parentPort = parentServer.address().port;

  const session = await launchCdpSession({ browserBin, profileDir });
  try {
    const { cdp, evalMain } = session;
    await cdp('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp('Page.navigate', { url: `http://localhost:${parentPort}/` });

    assert.equal(
      await waitUntil(() =>
        evalMain(`(() => {
          const slot = document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]');
          return Boolean(slot && slot.shadowRoot && slot.shadowRoot.querySelector('[data-agy-mcp-customizations-btn="true"]'));
        })()`)
      ),
      true,
      'Customizations MCP Manager button must mount inside Shadow DOM'
    );

    // 1. Wide viewport (1280x800, left sidebar 260px -> customizations-page surface [260..1280, 36..800], centerX=770, centerY=418)
    await evalMain(`document.querySelector('[data-addon-host-slot="antigravity-mcp-manager.customizations-btn"]').shadowRoot.querySelector('[data-agy-mcp-customizations-btn="true"]').click()`);
    const wideMetrics = await evalMain(`(() => {
      const dlg = document.querySelector('dialog[data-addon-host-modal-dialog="1"]');
      const surfaceBounds = window.__TEST_ADDON_HOST__.getSurfaceBounds('customizations-page');
      const rect = dlg?.getBoundingClientRect();
      return {
        modalCalls: window.__TEST_ADDON_HOST_DIAG__.getModalCalls(),
        surfaceAttr: dlg?.getAttribute('data-addon-host-modal-surface') || null,
        maxWidthInline: dlg?.style.maxWidth || '',
        dlgLeft: rect?.left ?? 0,
        dlgRight: rect?.right ?? 0,
        dlgTop: rect?.top ?? 0,
        dlgBottom: rect?.bottom ?? 0,
        dlgWidth: rect?.width ?? 0,
        dlgHeight: rect?.height ?? 0,
        dlgCenterX: rect ? (rect.left + rect.right) / 2 : 0,
        dlgCenterY: rect ? (rect.top + rect.bottom) / 2 : 0,
        surfaceCenterX: surfaceBounds.centerX,
        surfaceCenterY: surfaceBounds.centerY,
        viewportCenterX: window.innerWidth / 2,
      };
    })()`);
    assert.equal(wideMetrics.modalCalls.length, 1);
    assert.equal(wideMetrics.modalCalls[0].surface, 'customizations-page');
    assert.equal(wideMetrics.surfaceAttr, 'customizations-page');
    assert.ok(
      !wideMetrics.maxWidthInline.includes('100vw'),
      `Renderer must NOT overwrite host surface maxWidth with 100vw; got: ${wideMetrics.maxWidthInline}`
    );
    assert.ok(
      Math.abs(wideMetrics.dlgCenterX - wideMetrics.surfaceCenterX) <= 2,
      `Modal centerX (${wideMetrics.dlgCenterX}) must match customizations-page surface centerX (${wideMetrics.surfaceCenterX}), not viewport centerX (${wideMetrics.viewportCenterX})`
    );
    assert.ok(
      Math.abs(wideMetrics.dlgCenterX - wideMetrics.viewportCenterX) >= 100,
      'Modal must visibly shift into the content surface right of the 260px sidebar'
    );
    assert.ok(
      Math.abs(wideMetrics.dlgCenterY - wideMetrics.surfaceCenterY) <= 2,
      `Modal centerY (${wideMetrics.dlgCenterY}) must match surface centerY (${wideMetrics.surfaceCenterY})`
    );
    assert.ok(Math.abs(wideMetrics.dlgWidth - 820) <= 2, `Expected 820px width on wide surface, got ${wideMetrics.dlgWidth}`);

    // 2. Narrow viewport (960x680, left sidebar 260px -> surface width=700, maxWidth=676 < 820, centerX=610)
    await cdp('Emulation.setDeviceMetricsOverride', {
      width: 960,
      height: 680,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evalMain(`window.dispatchEvent(new Event('resize'))`);
    const narrowMetrics = await evalMain(`(() => {
      const dlg = document.querySelector('dialog[data-addon-host-modal-dialog="1"]');
      const surfaceBounds = window.__TEST_ADDON_HOST__.getSurfaceBounds('customizations-page');
      const rect = dlg?.getBoundingClientRect();
      return {
        dlgLeft: rect?.left ?? 0,
        dlgRight: rect?.right ?? 0,
        dlgWidth: rect?.width ?? 0,
        dlgCenterX: rect ? (rect.left + rect.right) / 2 : 0,
        surfaceLeft: surfaceBounds.left,
        surfaceRight: surfaceBounds.right,
        surfaceWidth: surfaceBounds.width,
        surfaceCenterX: surfaceBounds.centerX,
      };
    })()`);
    assert.ok(
      narrowMetrics.dlgLeft >= narrowMetrics.surfaceLeft && narrowMetrics.dlgRight <= narrowMetrics.surfaceRight + 1,
      `Modal [${narrowMetrics.dlgLeft}..${narrowMetrics.dlgRight}] must stay clamped inside narrow surface [${narrowMetrics.surfaceLeft}..${narrowMetrics.surfaceRight}]`
    );
    assert.ok(
      narrowMetrics.dlgWidth <= narrowMetrics.surfaceWidth - 20,
      `Modal width (${narrowMetrics.dlgWidth}) must shrink to host surface maxWidth (${narrowMetrics.surfaceWidth - 24})`
    );
    assert.ok(
      Math.abs(narrowMetrics.dlgCenterX - narrowMetrics.surfaceCenterX) <= 2,
      `Narrow modal centerX (${narrowMetrics.dlgCenterX}) must remain centered at surface centerX (${narrowMetrics.surfaceCenterX})`
    );

    // 3. Clean dispose() removes custom slot, open modal, and all owner styles
    await evalMain(`window.__TEST_ADDON_HOST__.dispose()`);
    assert.equal(await evalMain(`document.querySelectorAll('[data-addon-host-owner="antigravity-mcp-manager"]').length`), 0);
  } finally {
    await session.close();
    await new Promise((r) => parentServer.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  }
});
