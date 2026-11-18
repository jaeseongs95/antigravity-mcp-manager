'use strict';

/**
 * Design Tokens & Stylesheet Manager for MCP Server Manager UI.
 *
 * Propagates host CSP `nonce` onto `<style>` elements, enforces responsive single-column
 * layout at `<= 640px`, and honors `@media (prefers-reduced-motion: reduce)`.
 */

const { getScriptNonce } = require('../security/trusted-types');

const DEFAULT_STYLE_ID = 'agy-mcp-manager-styles';

const MODAL_CSS = `
:root {
  --mcp-bg-surface: #16181d;
  --mcp-bg-elevated: #1e222a;
  --mcp-bg-input: #111318;
  --mcp-border: rgba(255, 255, 255, 0.12);
  --mcp-border-strong: rgba(124, 156, 255, 0.45);
  --mcp-text-primary: #f3f5f8;
  --mcp-text-secondary: #a7b0c0;
  --mcp-accent: #5b8cff;
  --mcp-accent-hover: #739dff;
  --mcp-danger: #ef5350;
  --mcp-warning: #ffb74d;
  --mcp-success: #4caf50;
  --mcp-radius: 10px;
}
.agy-mcp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(8, 10, 14, 0.72);
  backdrop-filter: blur(4px);
  box-sizing: border-box;
}
.agy-mcp-dialog {
  width: min(860px, 100%);
  max-height: min(88vh, 860px);
  display: flex;
  flex-direction: column;
  background: var(--mcp-bg-surface);
  color: var(--mcp-text-primary);
  border: 1px solid var(--mcp-border);
  border-radius: var(--mcp-radius);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.45;
}
.agy-mcp-dialog-compact {
  width: min(560px, 100%);
}
.agy-mcp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--mcp-border);
  background: var(--mcp-bg-elevated);
}
.agy-mcp-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.agy-mcp-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--mcp-text-secondary);
}
.agy-mcp-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.agy-mcp-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 18px 0;
  border-bottom: 1px solid var(--mcp-border);
  background: var(--mcp-bg-surface);
}
.agy-mcp-tab-btn {
  padding: 8px 12px;
  min-height: 36px;
  background: transparent;
  color: var(--mcp-text-secondary);
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: color 120ms ease, border-color 120ms ease;
}
.agy-mcp-tab-btn[aria-selected="true"] {
  color: var(--mcp-text-primary);
  border-bottom-color: var(--mcp-accent);
}
.agy-mcp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.agy-mcp-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.agy-mcp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.agy-mcp-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--mcp-text-secondary);
}
.agy-mcp-input,
.agy-mcp-select,
.agy-mcp-textarea {
  width: 100%;
  min-height: 36px;
  padding: 7px 10px;
  box-sizing: border-box;
  background: var(--mcp-bg-input);
  color: var(--mcp-text-primary);
  border: 1px solid var(--mcp-border);
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
}
.agy-mcp-textarea {
  min-height: 88px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.agy-mcp-input:focus-visible,
.agy-mcp-select:focus-visible,
.agy-mcp-textarea:focus-visible,
.agy-mcp-btn:focus-visible,
.agy-mcp-tab-btn:focus-visible {
  outline: 2px solid var(--mcp-accent);
  outline-offset: 1px;
}
.agy-mcp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--mcp-border);
  background: var(--mcp-bg-elevated);
  color: var(--mcp-text-primary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.agy-mcp-btn:hover {
  border-color: var(--mcp-border-strong);
}
.agy-mcp-btn-primary {
  background: var(--mcp-accent);
  border-color: var(--mcp-accent);
  color: #ffffff;
}
.agy-mcp-btn-primary:hover {
  background: var(--mcp-accent-hover);
}
.agy-mcp-btn-danger {
  border-color: rgba(239, 83, 80, 0.5);
  color: #ff8a80;
}
.agy-mcp-card {
  padding: 12px 14px;
  border: 1px solid var(--mcp-border);
  border-radius: 8px;
  background: var(--mcp-bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agy-mcp-banner {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--mcp-border);
  font-size: 12px;
}
.agy-mcp-banner-error {
  border-color: rgba(239, 83, 80, 0.6);
  background: rgba(239, 83, 80, 0.12);
  color: #ffcdd2;
}
.agy-mcp-banner-warn {
  border-color: rgba(255, 183, 77, 0.6);
  background: rgba(255, 183, 77, 0.12);
  color: #ffe0b2;
}
.agy-mcp-banner-info {
  border-color: rgba(91, 140, 255, 0.5);
  background: rgba(91, 140, 255, 0.12);
  color: #dbe6ff;
}
.agy-mcp-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid var(--mcp-border);
  background: rgba(255, 255, 255, 0.05);
}
.agy-mcp-remote-launcher-btn {
  position: fixed;
  right: 16px;
  bottom: 40px;
  z-index: 2147482500;
  min-height: 34px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--mcp-border-strong);
  background: var(--mcp-bg-elevated);
  color: var(--mcp-text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}
@media (max-width: 640px) {
  .agy-mcp-backdrop {
    padding: 8px;
  }
  .agy-mcp-dialog {
    width: 100%;
    max-height: 94vh;
  }
  .agy-mcp-grid-2 {
    grid-template-columns: minmax(0, 1fr);
  }
  .agy-mcp-header,
  .agy-mcp-body {
    padding: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .agy-mcp-tab-btn,
  .agy-mcp-btn,
  .agy-mcp-backdrop,
  .agy-mcp-dialog {
    transition: none !important;
    animation: none !important;
  }
}
`;

/**
 * Ensures the MCP Manager stylesheet is mounted in `doc` with host CSP `nonce`.
 *
 * @param {any} doc
 * @param {string} [styleId]
 */
function ensureModalStyles(doc, styleId = DEFAULT_STYLE_ID) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  const existing = typeof doc.getElementById === 'function' ? doc.getElementById(styleId) : null;
  if (existing) return existing;

  const styleEl = doc.createElement('style');
  styleEl.id = styleId;
  if (typeof styleEl.setAttribute === 'function') {
    styleEl.setAttribute('id', styleId);
  }
  const nonce = getScriptNonce(doc);
  if (nonce) {
    styleEl.nonce = nonce;
    if (typeof styleEl.setAttribute === 'function') {
      styleEl.setAttribute('nonce', nonce);
    }
  }
  styleEl.textContent = MODAL_CSS;
  const target = doc.head || doc.body || doc.documentElement;
  if (target && typeof target.appendChild === 'function') {
    target.appendChild(styleEl);
  }
  return styleEl;
}

/**
 * Removes the MCP Manager stylesheet from `doc`.
 *
 * @param {any} doc
 * @param {string} [styleId]
 */
function removeModalStyles(doc, styleId = DEFAULT_STYLE_ID) {
  if (!doc || typeof doc.getElementById !== 'function') return;
  const el = doc.getElementById(styleId);
  if (!el) return;
  if (typeof el.remove === 'function') {
    el.remove();
  } else if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
    el.parentNode.removeChild(el);
  }
}

/**
 * Returns the canonical MCP Manager CSS text.
 *
 * @returns {string}
 */
function getStylesheetText() {
  return MODAL_CSS;
}

module.exports = {
  DEFAULT_STYLE_ID,
  MODAL_CSS,
  getStylesheetText,
  ensureModalStyles,
  removeModalStyles,
};
