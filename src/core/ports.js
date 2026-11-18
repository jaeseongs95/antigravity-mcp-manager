'use strict';

const { sha256Hex } = require('./sha256');

/**
 * Driven Port Contracts & Host Brand Profile (`src/core/ports.js` — Rev 6 §5.1, 5095348c-F4).
 * Zero host/DOM/timer/vendor globals; JSONC parsing belongs exclusively to `McpManagerService` (`src/core/`).
 */

const CONFIG_READ_REASONS = Object.freeze({
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  URI_UNRESOLVED: 'URI_UNRESOLVED',
  READ_FAILED: 'READ_FAILED',
  INVALID_JSON: 'INVALID_JSON',
});

const CONFIG_WRITE_REASONS = Object.freeze({
  CONFLICT: 'CONFLICT',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  URI_UNRESOLVED: 'URI_UNRESOLVED',
  READ_FAILED: 'READ_FAILED',
  WRITE_FAILED: 'WRITE_FAILED',
});

const DEFAULT_BRAND_PROFILE = Object.freeze({
  id: 'generic-mcp-host',
  displayName: 'MCP Host',
  configFileLabel: 'mcp_config.json',
  defaultConfigPathHint: 'mcp_config.json',
  settingsNavId: 'McpManager',
  settingsNavLabel: 'MCP Servers',
  i18nNoTranslateAttr: 'data-no-translate',
  trustedTypesPolicyNames: Object.freeze([]),
});

/**
 * Extracts a clean OAuth authorization code from either a raw code string
 * or a pasted callback URL containing `?code=...` or `#code=...`.
 * @param {string} rawInput
 * @returns {string}
 */
function normalizeAuthorizationCode(rawInput) {
  if (typeof rawInput !== 'string') return '';
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const queryCode = parsed.searchParams.get('code');
      if (queryCode && queryCode.trim()) {
        return queryCode.trim();
      }
      if (parsed.hash && parsed.hash.length > 1) {
        const hashParams = new URLSearchParams(parsed.hash.slice(1));
        const hashCode = hashParams.get('code');
        if (hashCode && hashCode.trim()) {
          return hashCode.trim();
        }
      }
    } catch {}
  }
  const inlineMatch = /(?:[?&#]|^)code=([^&#\s]+)/i.exec(trimmed);
  if (inlineMatch && inlineMatch[1]) {
    try {
      return decodeURIComponent(inlineMatch[1]).trim();
    } catch {
      return inlineMatch[1].trim();
    }
  }
  return trimmed;
}

/**
 * Normalizes a raw-text `ConfigRepositoryPort.readConfig()` result (`Rev 6 §5.1`, `5095348c-F4`):
 * - `{ ok: true, status: 'FOUND', exists: true, uri, fsPath, rawText, digest }`
 *   (Preserves 0-byte `""` files as `exists: true, rawText: '', digest: sha256Hex('')`!)
 * - `{ ok: true, status: 'MISSING', exists: false, uri, fsPath, rawText: '', digest: null }`
 * - `{ ok: false, reason: 'SERVICE_UNAVAILABLE' | 'URI_UNRESOLVED' | 'READ_FAILED', uri, fsPath, rawText, digest, error }`
 */
function normalizeConfigReadResult(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      reason: CONFIG_READ_REASONS.SERVICE_UNAVAILABLE,
      error: 'ConfigRepositoryPort returned an invalid response.',
      uri: null,
      fsPath: null,
      rawText: null,
      digest: null,
    };
  }

  if (raw.ok === false) {
    const rawText = typeof raw.rawText === 'string' ? raw.rawText : null;
    const digest =
      typeof raw.digest === 'string' && raw.digest
        ? raw.digest
        : rawText !== null
          ? sha256Hex(rawText)
          : null;
    return {
      ok: false,
      reason: typeof raw.reason === 'string' && raw.reason ? raw.reason : CONFIG_READ_REASONS.READ_FAILED,
      error: typeof raw.error === 'string' && raw.error ? raw.error : 'Failed to read MCP configuration.',
      uri: typeof raw.uri === 'string' && raw.uri ? raw.uri : null,
      fsPath: typeof raw.fsPath === 'string' && raw.fsPath ? raw.fsPath : null,
      rawText,
      digest,
    };
  }

  const exists = raw.status === 'MISSING' ? false : Boolean(raw.exists !== false);
  if (!exists) {
    return {
      ok: true,
      status: 'MISSING',
      exists: false,
      uri: typeof raw.uri === 'string' ? raw.uri : '',
      fsPath: typeof raw.fsPath === 'string' ? raw.fsPath : '',
      rawText: '',
      digest: null,
    };
  }

  const rawText = typeof raw.rawText === 'string' ? raw.rawText : '';
  const digest = typeof raw.digest === 'string' && raw.digest ? raw.digest : sha256Hex(rawText);

  return {
    ok: true,
    status: 'FOUND',
    exists: true,
    uri: typeof raw.uri === 'string' ? raw.uri : '',
    fsPath: typeof raw.fsPath === 'string' ? raw.fsPath : '',
    rawText,
    digest,
  };
}

/**
 * Normalizes `HostBrandProfile` with vendor-neutral defaults.
 */
function resolveBrandProfile(profile = {}) {
  return Object.freeze({
    ...DEFAULT_BRAND_PROFILE,
    ...(profile && typeof profile === 'object' ? profile : {}),
  });
}

/**
 * Creates safe default/disconnected implementations for `ConfigRepositoryPort`,
 * `McpRuntimePort`, `OAuthBrokerPort`, and `HostBrandProfile`.
 */
function createDefaultPorts(overrides = {}) {
  const runtimeOverride = overrides.mcpRuntime || overrides.runtimePort;
  return {
    brandProfile: resolveBrandProfile(overrides.brandProfile),
    configRepo: overrides.configRepo || {
      async resolveConfigUri() {
        return null;
      },
      async readConfig() {
        return {
          ok: false,
          reason: CONFIG_READ_REASONS.SERVICE_UNAVAILABLE,
          error: 'Configuration repository port is not connected to host RPC.',
          uri: null,
          fsPath: null,
          rawText: null,
          digest: null,
        };
      },
      async writeConfig() {
        return {
          ok: false,
          reason: CONFIG_WRITE_REASONS.SERVICE_UNAVAILABLE,
          persisted: false,
          error: 'Configuration repository port is not connected to host RPC.',
        };
      },
      async revealConfigInExplorer() {
        return { ok: false, error: 'File explorer integration is not available.' };
      },
    },
    mcpRuntime: runtimeOverride || {
      async listServerStates() {
        return { ok: true, servers: [], states: [] };
      },
      async refreshServers() {
        return { ok: true };
      },
      async toggleServer() {
        return { ok: true, supported: false };
      },
    },
    oauthBroker: overrides.oauthBroker || {
      async discoverOAuthMetadata() {
        return { ok: false, error: 'OAuth broker port is not connected.' };
      },
      async waitForAuthReadyOrUrl() {
        return null;
      },
      async openAuthorizationUrl() {
        return { ok: false, error: 'External authorization launcher is not connected.' };
      },
      async completeAuthorization() {
        return { ok: false, error: 'OAuth broker port is not connected.' };
      },
      async disconnectSession() {
        return { ok: false, error: 'OAuth broker port is not connected.' };
      },
    },
  };
}

module.exports = {
  CONFIG_READ_REASONS,
  CONFIG_WRITE_REASONS,
  DEFAULT_BRAND_PROFILE,
  normalizeAuthorizationCode,
  normalizeConfigReadResult,
  resolveBrandProfile,
  createDefaultPorts,
};
