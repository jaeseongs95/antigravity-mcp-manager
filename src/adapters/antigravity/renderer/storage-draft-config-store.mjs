/**
 * AddonContextV3 Storage-Backed Draft Config Store (`src/adapters/antigravity/renderer/storage-draft-config-store.mjs`).
 *
 * SOLID Boundaries:
 * - SRP: Implements the vendor-independent `ConfigStorePort` contract over `ctx.storage`
 *   (`get`/`set`/`onDidChange`) for surfaces where local filesystem Config Bridge is unavailable
 *   (e.g., Remote Web or restricted Desktop). Enforces UTF-8 SHA-256 CAS guards and byte budgets.
 * - LSP / DIP: Drop-in substitute for `HostBridgeConfigStore` consumed by `McpManagerService`
 *   and `native-mcp-panel.mjs` with zero direct `window.localStorage` or `settingsBridge` calls.
 */

import { ERROR_CODES } from '../../../core/model.mjs';
import { sha256Hex } from '../../../core/sha256.mjs';

export const STORAGE_DRAFT_SCHEMA_VERSION = 1;
export const STORAGE_DRAFT_MAX_BYTES = 240000;
export const STORAGE_DRAFT_KEY = 'remote-draft:v1';
export const STORAGE_DRAFT_DISPLAY_PATH = 'browser-draft://mcp_config.json (ctx.storage)';

function utf8ByteLength(text) {
  const s = String(text ?? '');
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s).length;
  }
  return s.length;
}

function extractDraftRawText(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (typeof record.rawText === 'string') return record.rawText;
  if (record.mcpServers && typeof record.mcpServers === 'object' && !Array.isArray(record.mcpServers)) {
    return `${JSON.stringify({ mcpServers: record.mcpServers }, null, 2)}\n`;
  }
  return null;
}

export function createStorageDraftConfigStore(storage, { key = STORAGE_DRAFT_KEY } = {}) {
  if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
    throw new TypeError('Storage draft config store requires ctx.storage.get() and ctx.storage.set()');
  }

  let cachedSha256 = null;

  async function readCurrentState() {
    const record = await storage.get(key);
    const rawText = extractDraftRawText(record);
    if (rawText === null) {
      cachedSha256 = null;
      return { exists: false, rawText: '', sha256: null };
    }
    const sha256 = await sha256Hex(rawText);
    cachedSha256 = sha256;
    return { exists: true, rawText, sha256 };
  }

  async function readGlobalConfig() {
    const cur = await readCurrentState();
    return {
      exists: cur.exists,
      rawText: cur.rawText,
      sha256: cur.sha256,
      displayPath: STORAGE_DRAFT_DISPLAY_PATH,
    };
  }

  async function writeGlobalConfig({ rawText, expectedSha256 }) {
    const nextText = String(rawText ?? '');
    if (utf8ByteLength(nextText) > STORAGE_DRAFT_MAX_BYTES) {
      return {
        ok: false,
        code: ERROR_CODES.VALIDATION_ERROR,
        error: `Remote draft exceeds maximum size (${STORAGE_DRAFT_MAX_BYTES} bytes).`,
        actualSha256: cachedSha256,
      };
    }

    const cur = await readCurrentState();
    const expected = expectedSha256 ?? null;
    if (expected !== cur.sha256) {
      return {
        ok: false,
        code: ERROR_CODES.CONFLICT,
        error: 'MCP draft changed in another tab or session (CAS conflict). Reload latest before retrying.',
        actualSha256: cur.sha256,
      };
    }

    const nextSha256 = await sha256Hex(nextText);
    const payload = {
      schemaVersion: STORAGE_DRAFT_SCHEMA_VERSION,
      rawText: nextText,
      updatedAt: new Date().toISOString(),
    };

    try {
      const saved = await storage.set(key, payload);
      if (saved === false) {
        return {
          ok: false,
          code: ERROR_CODES.IO_ERROR,
          error: 'Failed to persist MCP draft to ctx.storage.',
          actualSha256: cur.sha256,
        };
      }
      cachedSha256 = nextSha256;
      return {
        ok: true,
        sha256: nextSha256,
        backupFileName: null,
      };
    } catch (err) {
      const rawReason = String(err?.code || err?.message || '').trim();
      const isValidation =
        rawReason.includes('QUOTA') ||
        rawReason.includes('TOO_LARGE') ||
        rawReason.includes('INVALID') ||
        rawReason.includes('PROTO');
      return {
        ok: false,
        code: isValidation ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.IO_ERROR,
        error: rawReason || 'Failed to persist MCP draft to ctx.storage.',
        actualSha256: cur.sha256,
      };
    }
  }

  async function readPluginConfigs() {
    return [];
  }

  async function readLegacyConfig() {
    return { exists: false, rawText: '', displayPath: '' };
  }

  return Object.freeze({
    readGlobalConfig,
    writeGlobalConfig,
    readPluginConfigs,
    readLegacyConfig,
  });
}
