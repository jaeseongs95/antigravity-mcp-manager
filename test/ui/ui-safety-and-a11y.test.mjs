import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(__dirname, '../../sidecars/mcp_manager/ui');

test('NMCP-TC-017: UI has ZERO unsafe DOM sinks and ZERO external CDN/font links', () => {
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(UI_DIR, 'app.js'), 'utf8');
  const jsCodeOnly = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  assert.equal(/https?:\/\//i.test(html), false, 'index.html must not load external CDN/font URLs');
  assert.equal(html.includes('<script src="/preload.js"></script>'), true);
  assert.equal(html.includes('<script src="/app.js"></script>'), true);

  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
    assert.equal(jsCodeOnly.includes(sink), false, `Unsafe sink "${sink}" found in app.js`);
  }
});

test('NMCP-TC-018: styles.css binds Antigravity theme tokens, supports narrow 420px pane, and respects prefers-reduced-motion', () => {
  const css = fs.readFileSync(path.join(UI_DIR, 'styles.css'), 'utf8');
  assert.equal(css.includes('var(--background'), true);
  assert.equal(css.includes('var(--foreground'), true);
  assert.equal(css.includes('var(--primary'), true);
  assert.equal(css.includes('@media (max-width: 420px)'), true);
  assert.equal(css.includes('@media (prefers-reduced-motion: reduce)'), true);
});

test('NMCP-TC-019 & NMCP-TC-020: app.js enforces Korean IME guard, password-masked secret inputs, malformed JSON recovery, and 409 conflict banner', () => {
  const js = fs.readFileSync(path.join(UI_DIR, 'app.js'), 'utf8');
  assert.equal(js.includes('isComposing === true || event.keyCode === 229'), true);
  assert.equal(js.includes("type: 'password'"), true);
  assert.equal(js.includes('scrubEditorSecrets'), true);
  assert.equal(js.includes('malformed-json-banner'), true);
  assert.equal(js.includes('btn-restore-backup'), true);
  assert.equal(js.includes('409 Conflict'), true);
  assert.equal(js.includes('stdio-confirm-panel'), true);
});
