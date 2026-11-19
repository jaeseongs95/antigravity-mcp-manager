/**
 * Hexagonal Port Contracts (`src/core/ports.mjs`).
 * Pure JSDoc & structural contract validators; zero vendor/runtime dependencies.
 */

/**
 * @typedef {Object} ConfigReadResult
 * @property {boolean} exists
 * @property {string} rawText
 * @property {string|null} sha256
 * @property {string} displayPath
 */

/**
 * @typedef {Object} ConfigWriteRequest
 * @property {string} rawText
 * @property {string|null} expectedSha256
 */

/**
 * @typedef {Object} ConfigWriteResult
 * @property {boolean} ok
 * @property {string} [code]
 * @property {string} [error]
 * @property {string|null} [sha256]
 * @property {string|null} [actualSha256]
 */

/**
 * @typedef {Object} ConfigStorePort
 * @property {() => Promise<ConfigReadResult>} readGlobalConfig
 * @property {(req: ConfigWriteRequest) => Promise<ConfigWriteResult>} writeGlobalConfig
 * @property {() => Promise<Array<{ pluginName: string, pluginDir: string, rawText: string, displayPath: string }>>} readPluginConfigs
 * @property {() => Promise<{ exists: boolean, rawText: string, displayPath: string }>} readLegacyConfig
 * @property {() => Promise<{ ok: boolean, code?: string, error?: string, sha256?: string|null }>} [restoreLastBackup]
 */

/**
 * @typedef {Object} ConfigDialectPort
 * @property {string} serversRootKey
 * @property {string} primaryUrlKey
 * @property {string[]} acceptedUrlKeys
 * @property {boolean} supportsNativeDisabled
 * @property {boolean} supportsDisabledTools
 */

/**
 * @typedef {Object} RuntimeInspectorPort
 * @property {(workspaceUris?: string[]) => Promise<{ available: boolean, servers: Record<string, { status: string, toolCount: number, toolNames: string[], error: string|null, hasAuthToken: boolean }>, plugins: Array<{ name: string, dir: string, disabled: boolean, isGlobal: boolean, mcpServerNames: string[] }> }>} inspectRuntime
 */

export const DEFAULT_GENERIC_DIALECT = Object.freeze({
  serversRootKey: 'mcpServers',
  primaryUrlKey: 'url',
  acceptedUrlKeys: Object.freeze(['url', 'serverUrl']),
  supportsNativeDisabled: true,
  supportsDisabledTools: true,
});

export function assertConfigStorePort(store) {
  if (!store || typeof store.readGlobalConfig !== 'function' || typeof store.writeGlobalConfig !== 'function') {
    throw new TypeError('ConfigStorePort requires readGlobalConfig() and writeGlobalConfig()');
  }
}
