'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { tokenizeJsSource } = require('../../scripts/lib/js-lexer');
const { McpManagerService } = require('../../src/core/mcp-manager-service');
const { getStylesheetText } = require('../../src/ui/design-tokens-styles');
const {
  isImeComposing,
  restoreFocusSafely,
  installDialogKeyboardTrap,
  preserveScrollTop,
} = require('../../src/ui/dom-kit');
const {
  MODAL_ID,
  createModalController,
} = require('../../src/ui/modal-controller');
const {
  createInMemoryConfigRepo,
  createFakeMcpRuntime,
  createFakeOAuthBroker,
  createSyntheticDomEnv,
} = require('../helpers/dom-and-rpc-fakes');

const UI_DIR = path.resolve(__dirname, '../../src/ui');

function collectUiFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectUiFiles(full));
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
  }
  return out.sort();
}

test('MCP-TC-046: src/ui/** contains ZERO unsafe HTML sinks and dom-kit.js contains ZERO vendor launcher selectors', () => {
  const UNSAFE_HTML_SINKS = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML']);
  const files = collectUiFiles(UI_DIR);
  assert.ok(files.length >= 8);

  for (const filePath of files) {
    const rel = path.relative(UI_DIR, filePath).replace(/\\/g, '/');
    const src = fs.readFileSync(filePath, 'utf8');
    const tokens = tokenizeJsSource(src);
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if (tk.type === 'identifier' && UNSAFE_HTML_SINKS.has(tk.value)) {
        assert.fail(`Unsafe HTML sink "${tk.value}" found in src/ui/${rel}`);
      }
      if (
        tk.type === 'identifier' &&
        tk.value === 'write' &&
        tokens[i - 1]?.value === '.' &&
        tokens[i - 2]?.value === 'document'
      ) {
        assert.fail(`Unsafe document.write found in src/ui/${rel}`);
      }
    }
  }

  // `src/ui/dom-kit.js` must not hardcode vendor launcher selectors (`#agy-mcp-remote-launcher`, `settings-nav-item-McpManager`)
  const domKitSrc = fs.readFileSync(path.join(UI_DIR, 'dom-kit.js'), 'utf8');
  assert.equal(/agy-mcp-remote-launcher|settings-nav-item-McpManager|antigravity/i.test(domKitSrc), false);

  // Responsive & reduced-motion CSS rules exist in design tokens stylesheet
  const css = getStylesheetText();
  assert.equal(css.includes('@media (max-width: 640px)'), true);
  assert.equal(css.includes('@media (prefers-reduced-motion: reduce)'), true);
});

test('MCP-TC-045 & 046: createModalController enforces confirmation gate for ALL stdio/npx/uvx/multi-server commands and populates broken rawText on INVALID_JSON', async () => {
  const { win, doc } = createSyntheticDomEnv();
  const repo = createInMemoryConfigRepo({ exists: true, rawText: '{\n  "mcpServers": {}\n}\n' });
  const runtime = createFakeMcpRuntime();
  const service = new McpManagerService({
    configRepo: repo,
    mcpRuntime: runtime,
    oauthBroker: createFakeOAuthBroker(),
  });
  const modal = createModalController({
    win,
    doc,
    service,
    brandProfile: { productDisplayName: 'Antigravity', fallbackFocusSelector: '#fallback-launcher' },
  });

  modal.openModal();
  await new Promise((r) => setTimeout(r, 20));

  // 1. Entering `npx` / GitHub / `uvx` package in Quick Auto-Add MUST pause at confirmation panel (`0` writes before confirm!)
  service.updateDraftState({ quickAddInput: '@modelcontextprotocol/server-memory', quickAddAuthToken: '' });
  modal.refreshView();
  await new Promise((r) => setTimeout(r, 15));

  const addBtn = doc.querySelector('[data-testid="agy-mcp-smart-add-btn"]');
  assert.ok(addBtn);
  addBtn.click();
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(repo.state.writeCalls.length, 0, 'Stdio command must NOT be persisted before user clicks Confirm');
  const confirmPanel = doc.querySelector('[data-testid="agy-mcp-confirm-command-panel"]');
  assert.ok(confirmPanel, 'Expected decomposed stdio command confirmation panel');
  assert.equal(confirmPanel.textContent.includes('npx'), true);

  // Clicking Confirm commits the server cleanly
  const confirmBtn = doc.querySelector('[data-testid="agy-mcp-confirm-command-btn"]');
  confirmBtn.click();
  await new Promise((r) => setTimeout(r, 25));

  assert.equal(repo.state.writeCalls.length, 1);
  const parsedDisk = JSON.parse(repo.state.rawText);
  assert.equal(parsedDisk.mcpServers.memory.command, 'npx');

  // 2. Multi-server JSON containing a `command` entry ALSO triggers confirmation gate
  service.updateDraftState({
    quickAddInput: JSON.stringify({
      mcpServers: {
        remoteHttp: { url: 'https://mcp.example.com/sse' },
        localGit: { command: 'uvx', args: ['mcp-server-git'] },
      },
    }),
  });
  addBtn.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(repo.state.writeCalls.length, 1, 'Multi-server snippet with command must wait for confirmation');
  assert.ok(doc.querySelector('[data-testid="agy-mcp-confirm-command-panel"]'));

  // Cancel clears pending confirmation without writing
  doc.querySelector('[data-testid="agy-mcp-cancel-command-btn"]').click();
  assert.equal(service.getDraftState().pendingCommandConfirmation, null);

  // 3. `INVALID_JSON` on disk switches modal to `raw` tab and loads broken on-disk text for user repair (`MCP-TC-024`)
  const corrupted = '{ "mcpServers": { "broken": ';
  repo.setExternalDiskContent(corrupted, true);
  await modal.refreshView();

  const rawTextarea = doc.querySelector('textarea[data-field="rawJsonText"], textarea');
  assert.ok(rawTextarea, 'Raw JSON editor textarea should be rendered automatically on INVALID_JSON');
  assert.equal(service.getDraftState().rawTextDraft, corrupted);

  modal.dispose();
  service.dispose();
});

test('MCP-TC-043, 044, 045 & 046: Focus trap cycles Tab/Shift+Tab, restores focus via injected fallback when opener disconnects, blocks Korean Hangul IME Enter/Escape, and preserves scrollTop', async () => {
  const { win, doc } = createSyntheticDomEnv();

  // Fallback button + transient opener button
  const fallbackBtn = doc.createElement('button');
  fallbackBtn.id = 'fallback-launcher';
  doc.body.appendChild(fallbackBtn);

  const transientOpener = doc.createElement('button');
  transientOpener.id = 'transient-opener';
  doc.body.appendChild(transientOpener);
  transientOpener.focus();

  const service = new McpManagerService({
    configRepo: createInMemoryConfigRepo(),
    mcpRuntime: createFakeMcpRuntime(),
    oauthBroker: createFakeOAuthBroker(),
  });
  const modal = createModalController({
    win,
    doc,
    service,
    brandProfile: { fallbackFocusSelector: '#fallback-launcher' },
  });

  modal.openModal({ openerEl: transientOpener });
  await new Promise((r) => setTimeout(r, 20));

  const backdrop = doc.getElementById(MODAL_ID);
  assert.ok(backdrop);
  const dialog = backdrop.querySelector('[role="dialog"]');
  assert.ok(dialog);

  // 1. Korean Hangul IME composition (`isComposing: true` or `keyCode: 229`) MUST NOT dismiss modal on Escape or trigger Quick Add on Enter!
  assert.equal(isImeComposing({ isComposing: true, key: 'Enter' }), true);
  assert.equal(isImeComposing({ isComposing: false, keyCode: 229, key: 'Escape' }), true);

  dialog.dispatchEvent({ type: 'keydown', key: 'Escape', isComposing: true, bubbles: true });
  assert.equal(modal.isModalOpen(), true, 'Escape during Korean IME composition must NOT close modal');

  dialog.dispatchEvent({ type: 'keydown', key: 'Escape', isComposing: false, keyCode: 229, bubbles: true });
  assert.equal(modal.isModalOpen(), true, 'keyCode 229 composition event must NOT close modal');

  const smartInput = backdrop.querySelector('[data-testid="agy-mcp-smart-input"]');
  smartInput.value = 'https://ime-test.example.com/mcp';
  smartInput.dispatchEvent({ type: 'input', target: smartInput, bubbles: true });
  smartInput.dispatchEvent({ type: 'keydown', key: 'Enter', isComposing: true, bubbles: true });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(
    service.getDraftState().quickAddInput,
    'https://ime-test.example.com/mcp',
    'Enter during Korean IME composition must NOT submit Quick Add'
  );

  // 2. Focus trap wraps Shift+Tab from first focusable -> last focusable, and Tab from last -> first
  const trapBox = doc.createElement('div');
  const b1 = doc.createElement('button');
  const b2 = doc.createElement('button');
  trapBox.appendChild(b1);
  trapBox.appendChild(b2);
  doc.body.appendChild(trapBox);
  const trapDisp = installDialogKeyboardTrap({ doc, dialogEl: trapBox });

  b1.focus();
  trapBox.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: true, bubbles: true });
  assert.equal(doc.activeElement, b2);

  b2.focus();
  trapBox.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: false, bubbles: true });
  assert.equal(doc.activeElement, b1);
  trapDisp.dispose();

  // 3. Disconnect `transientOpener` from DOM before closing modal -> focus falls back to `#fallback-launcher` via injected callback!
  transientOpener.remove();
  assert.equal(transientOpener.isConnected, false);

  dialog.dispatchEvent({ type: 'keydown', key: 'Escape', isComposing: false, bubbles: true });
  assert.equal(modal.isModalOpen(), false);
  assert.equal(doc.activeElement, fallbackBtn, 'Focus must restore to injected fallback target when opener was disconnected');

  // Direct `restoreFocusSafely` unit check
  const directTarget = restoreFocusSafely(doc, transientOpener, () => fallbackBtn);
  assert.equal(directTarget, fallbackBtn);

  // 4. `preserveScrollTop` keeps scroll offset across re-render
  const scrollBox = doc.createElement('div');
  scrollBox.scrollTop = 184;
  preserveScrollTop(scrollBox, () => {
    scrollBox.scrollTop = 0; // Simulated DOM clear resetting scrollTop
  });
  assert.equal(scrollBox.scrollTop, 184);

  modal.dispose();
  service.dispose();
});
