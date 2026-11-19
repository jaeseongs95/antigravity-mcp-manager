/**
 * Antigravity 2.0 UI Sidecar Composition Root (`sidecars/mcp_manager/main.mjs`).
 * Zero `child_process`, zero `app.asar` patching, zero global injection.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';
import { McpManagerService } from '../../src/core/manager-service.mjs';
import { createFsConfigStore } from '../../src/adapters/fs-config-store.mjs';
import { ANTIGRAVITY_DIALECT } from '../../src/adapters/antigravity/dialect.mjs';
import { resolveAntigravityPaths } from '../../src/adapters/antigravity/paths.mjs';
import { createAntigravityLsInspector } from '../../src/adapters/antigravity/ls-inspector.mjs';
import { attachSidecarSecurityMiddleware, registerSidecarRoutes } from '../../src/adapters/sidecar/http-app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');

const paths = resolveAntigravityPaths({
  homeDir: process.env.AGY_MCP_HOME_OVERRIDE || null,
});
const configStore = createFsConfigStore({
  globalConfigPath: paths.globalConfigPath,
  pluginRoots: paths.pluginRoots,
  legacyConfigPath: paths.legacyConfigPath,
  backupDir: paths.backupDir,
});
const runtimeInspector = createAntigravityLsInspector();
const service = new McpManagerService({
  configStore,
  dialect: ANTIGRAVITY_DIALECT,
  runtimeInspector,
});

const app = new SidecarApp();
registerSidecarRoutes({
  app,
  ResponseClass: Response,
  service,
  uiDir: UI_DIR,
});

const server = await app.run();
attachSidecarSecurityMiddleware(server, {
  token: process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '',
});
