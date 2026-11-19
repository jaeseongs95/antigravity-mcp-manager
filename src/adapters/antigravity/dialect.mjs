/**
 * Antigravity 2.0 Config Dialect (`src/adapters/antigravity/dialect.mjs`).
 * Verified against official Antigravity 2.0 MCP documentation.
 */

export const ANTIGRAVITY_DIALECT = Object.freeze({
  serversRootKey: 'mcpServers',
  primaryUrlKey: 'url',
  acceptedUrlKeys: Object.freeze(['url', 'serverUrl']),
  supportsNativeDisabled: true,
  supportsDisabledTools: true,
});
