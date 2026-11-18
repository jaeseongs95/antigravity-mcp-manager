'use strict';

/**
 * Antigravity Host Adapter Configuration & Brand Profile.
 *
 * Isolates all Antigravity-specific origins, RPC service paths, CDN prefixes,
 * TrustedTypes policy names, and focus-fallback CSS selectors inside the adapter layer.
 */

const { matchesAllowedDomain, isAllowedHttpsScriptUrl } = require('../../core/security/url-policy');

const ANTIGRAVITY_BRAND_PROFILE = Object.freeze({
  productDisplayName: 'Antigravity',
  trustedTypesPolicyNames: Object.freeze(['agy-mcp-manager', 'agy-mcp-companion']),
  fallbackFocusSelector:
    '#agy-mcp-remote-launcher, [data-testid="settings-nav-item-McpManager"], [data-testid="add-mcp-button"]',
  cdnPathPrefix: '/web/',
  rootAttributes: Object.freeze({
    'data-agy-no-translate': 'true',
  }),
});

const DEFAULT_HOST_ADAPTER_CONFIG = Object.freeze({
  rpcServicePrefix: '/exa.language_server_pb.LanguageServerService',
  remoteCsrfToken: 'csrf_token',
  remoteHostDomains: Object.freeze(['antigravity.google.com']),
  staticCdnOrigins: Object.freeze(['https://antigravity.static.usercontent.goog']),
  cdnOrigin: 'https://www.gstatic.com/antigravity',
  cdnPathPrefix: '/web/',
  allowedScriptDomains: Object.freeze([
    'antigravity.google.com',
    'antigravity.static.usercontent.goog',
    'www.gstatic.com',
    'raw.githubusercontent.com',
  ]),
  trustedTypesPolicyNames: Object.freeze([
    'agy-mcp-manager',
    'agy-mcp-companion',
    () => `agy-companion-${Date.now()}`,
  ]),
  companionUrls: Object.freeze({
    statusbar:
      'https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/main/dist/statusbar_autoinject.js',
    mcpManager:
      'https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js',
    koTranslator:
      'https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/plugins/ko-thought-translator/scripts/ko_thought_autoinject.js',
  }),
});

/**
 * Resolves effective Antigravity host configuration merged with optional runtime overrides.
 *
 * @param {Record<string, any> | null | undefined} overrides
 * @param {any} [win]
 */
function resolveHostAdapterConfig(overrides, win) {
  const winOverrides =
    win && win.__AGY_MCP_HOST_CONFIG__ && typeof win.__AGY_MCP_HOST_CONFIG__ === 'object'
      ? win.__AGY_MCP_HOST_CONFIG__
      : null;

  const src = {
    ...DEFAULT_HOST_ADAPTER_CONFIG,
    ...(winOverrides || {}),
    ...(overrides && typeof overrides === 'object' ? overrides : {}),
  };

  const remoteHostDomains = Array.isArray(src.remoteHostDomains)
    ? src.remoteHostDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
    : Array.from(DEFAULT_HOST_ADAPTER_CONFIG.remoteHostDomains);

  const allowedScriptDomains = Array.isArray(src.allowedScriptDomains)
    ? src.allowedScriptDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
    : Array.from(DEFAULT_HOST_ADAPTER_CONFIG.allowedScriptDomains);

  const staticCdnOrigins = Array.isArray(src.staticCdnOrigins)
    ? src.staticCdnOrigins.map((o) => String(o).trim()).filter(Boolean)
    : Array.from(DEFAULT_HOST_ADAPTER_CONFIG.staticCdnOrigins);

  const trustedTypesPolicyNames = Array.isArray(src.trustedTypesPolicyNames)
    ? src.trustedTypesPolicyNames.slice()
    : Array.from(DEFAULT_HOST_ADAPTER_CONFIG.trustedTypesPolicyNames);

  const companionUrls = {
    ...DEFAULT_HOST_ADAPTER_CONFIG.companionUrls,
    ...(src.companionUrls && typeof src.companionUrls === 'object' ? src.companionUrls : {}),
  };

  const isRemoteHost = (hostname) => {
    const clean = String(hostname || '').trim().toLowerCase();
    if (!clean) return false;
    return matchesAllowedDomain(clean, remoteHostDomains);
  };

  return Object.freeze({
    rpcServicePrefix: String(src.rpcServicePrefix || DEFAULT_HOST_ADAPTER_CONFIG.rpcServicePrefix).replace(/\/+$/, ''),
    remoteCsrfToken: String(src.remoteCsrfToken || ''),
    remoteHostDomains: Object.freeze(remoteHostDomains),
    staticCdnOrigins: Object.freeze(staticCdnOrigins),
    cdnOrigin: String(src.cdnOrigin || DEFAULT_HOST_ADAPTER_CONFIG.cdnOrigin).replace(/\/+$/, ''),
    cdnPathPrefix: String(src.cdnPathPrefix || DEFAULT_HOST_ADAPTER_CONFIG.cdnPathPrefix),
    allowedScriptDomains: Object.freeze(allowedScriptDomains),
    trustedTypesPolicyNames: Object.freeze(trustedTypesPolicyNames),
    companionUrls: Object.freeze(companionUrls),
    configUriOverride: typeof src.configUriOverride === 'string' ? src.configUriOverride : '',
    isRemoteHost,
  });
}

/**
 * Builds an `isAllowedScriptUrl` predicate bound to `hostCfg` and optional `win.location.hostname`.
 *
 * @param {ReturnType<typeof resolveHostAdapterConfig>} hostCfg
 * @param {any} [win]
 * @returns {(url: string) => boolean}
 */
function buildAllowedScriptUrlValidator(hostCfg, win) {
  const domains = new Set(hostCfg.allowedScriptDomains || []);
  try {
    const currentHost = String(win?.location?.hostname || '').trim().toLowerCase();
    const currentProto = String(win?.location?.protocol || '').toLowerCase();
    if (currentHost && currentProto === 'https:' && currentHost !== 'localhost') {
      domains.add(currentHost);
    }
  } catch {
    // Ignore cross-origin location access errors
  }
  const allowedList = Array.from(domains);
  const allowedOrigins = Array.isArray(hostCfg.staticCdnOrigins) ? hostCfg.staticCdnOrigins : [];
  return (candidateUrl) =>
    isAllowedHttpsScriptUrl(candidateUrl, {
      allowedDomains: allowedList,
      allowedOrigins,
    });
}

module.exports = {
  ANTIGRAVITY_BRAND_PROFILE,
  DEFAULT_HOST_ADAPTER_CONFIG,
  resolveHostAdapterConfig,
  buildAllowedScriptUrlValidator,
};
