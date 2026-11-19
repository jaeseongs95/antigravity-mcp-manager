/**
 * Antigravity 2.0 Canonical Config & Read-Only Plugin Paths (`src/adapters/antigravity/paths.mjs`).
 *
 * Sole R/W Target: `~/.gemini/config/mcp_config.json`
 * Read-Only Plugin Roots: `~/.gemini/config/plugins`, `<workspace>/.agents/plugins`
 * Read-Only Legacy Detection: `~/.gemini/antigravity/mcp_config.json`
 * Private Backup Dir: `~/.gemini/config/.mcp-manager-backups`
 */

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveAntigravityPaths({ homeDir = null, workspaceUris = [] } = {}) {
  const home = homeDir || process.env.USERPROFILE || process.env.HOME || os.homedir();
  const configDir = path.join(home, '.gemini', 'config');
  const globalConfigPath = path.join(configDir, 'mcp_config.json');
  const globalPluginsDir = path.join(configDir, 'plugins');
  const legacyConfigPath = path.join(home, '.gemini', 'antigravity', 'mcp_config.json');
  const backupDir = path.join(configDir, '.mcp-manager-backups');

  const pluginRoots = [globalPluginsDir];
  for (const uri of workspaceUris) {
    if (typeof uri !== 'string' || !uri.startsWith('file://')) continue;
    try {
      const wsPath = fileURLToPath(uri);
      pluginRoots.push(path.join(wsPath, '.agents', 'plugins'));
    } catch {
      // Ignore malformed workspace URI
    }
  }

  return {
    configDir,
    globalConfigPath,
    pluginRoots,
    legacyConfigPath,
    backupDir,
  };
}
