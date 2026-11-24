/**
 * Host Named-Scope Config Bridge Store Adapter (`src/adapters/antigravity/renderer/host-config-store.mjs`).
 *
 * SOLID Boundaries:
 * - SRP: Translates `antigravity-native-addon-host` v2.3.0+ Option A Named-Scope Config Bridge
 *   (`addonHost.hasConfigBridge`, `addonHost.configScopes`, `addonHost.readConfigScope`,
 *   `addonHost.writeConfigScope`) into the vendor-independent `ConfigStorePort` contract
 *   consumed by `src/core/manager-service.mjs`.
 * - DIP: `McpManagerService` and `native-mcp-panel.mjs` depend solely on `ConfigStorePort`,
 *   never directly on Electron IPC or host-specific bridge methods.
 */

import { ERROR_CODES } from '../../../core/model.mjs';

export const HOST_CONFIG_SCOPES = Object.freeze({
  GLOBAL_MCP: 'antigravity:mcp-config',
  PLUGIN_MCP: 'antigravity:plugin-mcp-configs',
  LEGACY_MCP: 'antigravity:mcp-config-legacy',
});

const DEFAULT_DISPLAY_PATHS = Object.freeze({
  [HOST_CONFIG_SCOPES.GLOBAL_MCP]: '~/.gemini/config/mcp_config.json',
  [HOST_CONFIG_SCOPES.LEGACY_MCP]: '~/.gemini/antigravity/mcp_config.json',
});

function resolveSnapshotRawText(res) {
  if (typeof res?.rawText === 'string') return res.rawText;
  if (res?.status === 'ok' && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
    return `${JSON.stringify(res.data, null, 2)}\n`;
  }
  return null;
}

function hasDeclaredScope(addonHost, scopeId, requiredAccess = null) {
  if (!Array.isArray(addonHost?.configScopes)) return true;
  const entry = addonHost.configScopes.find((s) => s && s.scopeId === scopeId);
  if (!entry) return false;
  if (requiredAccess === 'rw') return entry.access === 'rw';
  if (requiredAccess === 'ro') return entry.access === 'ro' || entry.access === 'rw';
  return true;
}

function mapHostBridgeReasonToErrorCode(reason) {
  const code = String(reason || '').trim();
  if (!code) return ERROR_CODES.IO_ERROR;
  if (code === 'ERR_CONFIG_CAS_CONFLICT' || code === ERROR_CODES.CONFLICT) {
    return ERROR_CODES.CONFLICT;
  }
  if (code === 'ERR_CONFIG_LOCK_BUSY' || code === ERROR_CODES.LOCK_BUSY) {
    return ERROR_CODES.LOCK_BUSY;
  }
  if (
    code === 'ERR_CONFIG_INVALID_JSON' ||
    code === 'ERR_CONFIG_MUST_BE_OBJECT' ||
    code === 'ERR_CONFIG_UNSAFE_PROTO_KEY' ||
    code === 'ERR_CONFIG_FILE_TOO_LARGE' ||
    code === 'ERR_INVALID_EXPECTED_SHA256' ||
    code === 'ERR_INVALID_CONFIG_SCOPE_ID'
  ) {
    return ERROR_CODES.VALIDATION_ERROR;
  }
  if (
    code === 'ERR_CONFIG_SYMLINK_FORBIDDEN' ||
    code === 'ERR_CONFIG_ANCESTOR_SYMLINK_FORBIDDEN' ||
    code === 'ERR_CONFIG_BACKUP_SYMLINK_FORBIDDEN' ||
    code === 'ERR_CONFIG_RESERVED_PATH' ||
    code === 'ERR_CONFIG_SCOPE_READ_ONLY' ||
    code.startsWith('ERR_CONFIG_SCOPE_READ_ONLY:')
  ) {
    return ERROR_CODES.WRITE_JAIL_VIOLATION;
  }
  return code;
}

export function resolveHostConfigBridge(addonHost) {
  if (!addonHost || typeof addonHost !== 'object') return null;
  if (addonHost.hasConfigBridge !== true) return null;
  if (
    typeof addonHost.readConfigScope !== 'function' ||
    typeof addonHost.writeConfigScope !== 'function'
  ) {
    return null;
  }
  if (!hasDeclaredScope(addonHost, HOST_CONFIG_SCOPES.GLOBAL_MCP, 'rw')) {
    return null;
  }
  return addonHost;
}

export function createHostBridgeConfigStore(addonHost) {
  const bridge = resolveHostConfigBridge(addonHost);
  if (!bridge) {
    throw new TypeError(
      'Host Config Bridge requires addonHost.hasConfigBridge === true, readConfigScope(), writeConfigScope(), and rw access to antigravity:mcp-config'
    );
  }

  async function readGlobalConfig() {
    const res = await bridge.readConfigScope(HOST_CONFIG_SCOPES.GLOBAL_MCP);
    if (!res || typeof res !== 'object') {
      throw new Error('Host Config Bridge returned an invalid response for global MCP config.');
    }
    if (res.ok === false || res.status === 'error') {
      throw new Error(String(res.reason || 'ERR_CONFIG_READ_FAILED'));
    }
    const displayPath = DEFAULT_DISPLAY_PATHS[HOST_CONFIG_SCOPES.GLOBAL_MCP];
    if (res.status === 'missing') {
      return {
        exists: false,
        rawText: '',
        sha256: null,
        displayPath,
      };
    }
    // Host v2.3.0 config-bridge.js returns `{ status: 'ok', data, rawText: null, sha256 }`
    // for valid files and `{ status: 'corrupt', data: null, rawText, sha256 }` for malformed JSON.
    const rawText = resolveSnapshotRawText(res);
    if (rawText === null) {
      throw new Error(String(res.reason || 'ERR_CONFIG_EMPTY_PAYLOAD'));
    }
    return {
      exists: true,
      rawText,
      sha256: typeof res.sha256 === 'string' && res.sha256.trim() ? res.sha256.trim() : null,
      displayPath,
    };
  }

  async function writeGlobalConfig({ rawText, expectedSha256 }) {
    try {
      const res = await bridge.writeConfigScope(
        HOST_CONFIG_SCOPES.GLOBAL_MCP,
        String(rawText ?? ''),
        { expectedSha256: expectedSha256 ?? null }
      );
      if (!res || typeof res !== 'object') {
        return {
          ok: false,
          code: ERROR_CODES.IO_ERROR,
          error: 'Host Config Bridge returned an invalid write response.',
          actualSha256: null,
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          code: mapHostBridgeReasonToErrorCode(res.reason),
          error: String(res.reason || 'Failed to write mcp_config.json via Host Config Bridge.'),
          actualSha256: typeof res.currentSha256 === 'string' ? res.currentSha256 : null,
        };
      }
      return {
        ok: true,
        sha256: typeof res.currentSha256 === 'string' ? res.currentSha256 : null,
        backupFileName: typeof res.backupFileName === 'string' ? res.backupFileName : null,
      };
    } catch (err) {
      const rawReason = String(err?.code || err?.message || '').trim();
      return {
        ok: false,
        code: mapHostBridgeReasonToErrorCode(rawReason),
        error: rawReason || 'Host Config Bridge write failed.',
        actualSha256: null,
      };
    }
  }

  async function readPluginConfigs() {
    if (!hasDeclaredScope(bridge, HOST_CONFIG_SCOPES.PLUGIN_MCP, 'ro')) {
      return [];
    }
    const res = await bridge.readConfigScope(HOST_CONFIG_SCOPES.PLUGIN_MCP);
    if (!res || typeof res !== 'object') {
      throw new Error('Host Config Bridge returned an invalid response for plugin MCP configs.');
    }
    if (res.ok === false || res.status === 'error') {
      throw new Error(String(res.reason || 'ERR_CONFIG_PLUGIN_READ_FAILED'));
    }
    if (res.status === 'missing') {
      return [];
    }
    const rawItems = Array.isArray(res.items) ? res.items : [];
    const normalized = [];
    for (const item of rawItems) {
      if (!item || typeof item !== 'object') continue;
      if (item.status !== 'ok') continue;
      const rawText = resolveSnapshotRawText(item);
      if (rawText === null) continue;
      const rawId = String(item.pluginId || '').trim();
      if (!rawId) continue;
      const colonIdx = rawId.indexOf(':');
      const pluginScope = rawId.startsWith('workspace:') ? 'workspace' : 'global';
      const pluginDir = colonIdx >= 0 ? rawId.slice(colonIdx + 1).trim() : rawId;
      if (!pluginDir) continue;
      const pluginId = colonIdx >= 0 ? rawId : `${pluginScope}:${pluginDir}`;
      normalized.push({
        pluginId,
        pluginScope,
        pluginName: pluginDir,
        pluginDir,
        rawText,
        displayPath: `~/.gemini/config/plugins/${pluginDir}/mcp_config.json`,
      });
    }
    return normalized;
  }

  async function readLegacyConfig() {
    if (!hasDeclaredScope(bridge, HOST_CONFIG_SCOPES.LEGACY_MCP, 'ro')) {
      return { exists: false, rawText: '', displayPath: '' };
    }
    try {
      const res = await bridge.readConfigScope(HOST_CONFIG_SCOPES.LEGACY_MCP);
      if (!res || typeof res !== 'object' || res.ok === false || res.status === 'missing' || res.status === 'error') {
        return { exists: false, rawText: '', displayPath: '' };
      }
      const rawText = resolveSnapshotRawText(res);
      if (rawText === null) {
        return { exists: false, rawText: '', displayPath: '' };
      }
      return {
        exists: true,
        rawText,
        displayPath: DEFAULT_DISPLAY_PATHS[HOST_CONFIG_SCOPES.LEGACY_MCP],
      };
    } catch {
      return { exists: false, rawText: '', displayPath: '' };
    }
  }

  return Object.freeze({
    readGlobalConfig,
    writeGlobalConfig,
    readPluginConfigs,
    readLegacyConfig,
  });
}
