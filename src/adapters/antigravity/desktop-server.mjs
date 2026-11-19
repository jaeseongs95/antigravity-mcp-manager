/**
 * Standalone Loopback Desktop Server for Antigravity Settings Menu Integration
 * (`src/adapters/antigravity/desktop-server.mjs`).
 *
 * Reuses 100% of the verified v2.0.0 core (`McpManagerService`), write-jailed FS store
 * (`createFsConfigStore`), loopback-only LS inspector (`createAntigravityLsInspector`),
 * and hardened HTTP security middleware (`attachSidecarSecurityMiddleware` + `registerSidecarRoutes`)
 * without requiring `sidecar_sdk`. Zero `child_process` imports.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpManagerService } from '../../core/manager-service.mjs';
import { createFsConfigStore } from '../fs-config-store.mjs';
import { ANTIGRAVITY_DIALECT } from './dialect.mjs';
import { resolveAntigravityPaths } from './paths.mjs';
import { createAntigravityLsInspector } from './ls-inspector.mjs';
import {
  attachSidecarSecurityMiddleware,
  registerSidecarRoutes,
  SECURITY_HEADERS,
} from '../sidecar/http-app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UI_DIR = path.resolve(__dirname, '../../../sidecars/mcp_manager/ui');

class DesktopResponse {
  constructor(body, { contentType = 'application/json; charset=utf-8', status = 200, headers = {} } = {}) {
    this.body = body;
    this.contentType = contentType;
    this.status = status;
    this.headers = headers;
  }
}

const MINIMAL_PRELOAD_JS =
  'window.sidecar = window.sidecar || { getWorkspaceUris: async () => [] };\n';

export async function startDesktopMcpServer({
  homeDir = process.env.AGY_MCP_HOME_OVERRIDE || undefined,
  lsAddress = process.env.ANTIGRAVITY_LS_ADDRESS || '',
  csrfToken = process.env.ANTIGRAVITY_CSRF_TOKEN || '',
  token = crypto.randomBytes(32).toString('hex'),
  port = 0,
  uiDir = DEFAULT_UI_DIR,
} = {}) {
  const paths = resolveAntigravityPaths({ homeDir });
  const configStore = createFsConfigStore({
    globalConfigPath: paths.globalConfigPath,
    pluginRoots: paths.pluginRoots,
    legacyConfigPath: paths.legacyConfigPath,
    backupDir: paths.backupDir,
  });
  const runtimeInspector = createAntigravityLsInspector({ lsAddress, csrfToken });
  const service = new McpManagerService({
    configStore,
    dialect: ANTIGRAVITY_DIALECT,
    runtimeInspector,
  });

  const pages = new Map();
  const apis = new Map();
  const app = {
    page(routePath, handler) {
      pages.set(routePath, handler);
    },
    api(routePath, handler, method = 'POST') {
      if (!apis.has(routePath)) apis.set(routePath, new Map());
      apis.get(routePath).set(method.toUpperCase(), handler);
    },
  };

  registerSidecarRoutes({ app, ResponseClass: DesktopResponse, service, uiDir });
  app.api(
    '/preload.js',
    () =>
      new DesktopResponse(MINIMAL_PRELOAD_JS, {
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        headers: { ...SECURITY_HEADERS },
      }),
    'GET'
  );

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;

    if (req.method === 'GET' && pages.has(pathname)) {
      Promise.resolve(pages.get(pathname)())
        .then((out) => {
          if (res.headersSent) return;
          res.writeHead(out.status || 200, { 'Content-Type': out.contentType, ...out.headers });
          res.end(out.body);
        })
        .catch(() => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
            res.end(JSON.stringify({ ok: false, error: 'Failed to serve page' }));
          }
        });
      return;
    }

    if (apis.has(pathname)) {
      const methodMap = apis.get(pathname);
      if (!methodMap.has(req.method)) {
        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
        return;
      }
      const chunks = [];
      req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
      req.on('end', async () => {
        if (res.headersSent) return;
        try {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          const data = rawBody ? JSON.parse(rawBody) : {};
          const out = await methodMap.get(req.method)(data);
          if (!res.headersSent) {
            res.writeHead(out.status || 200, { 'Content-Type': out.contentType, ...out.headers });
            res.end(out.body);
          }
        } catch {
          if (!res.headersSent) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
            res.end(JSON.stringify({ ok: false, error: 'Invalid JSON request body' }));
          }
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
  });

  attachSidecarSecurityMiddleware(server, { token });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const boundPort = server.address().port;
  const url = `http://127.0.0.1:${boundPort}/?token=${encodeURIComponent(token)}`;

  return {
    server,
    port: boundPort,
    token,
    url,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
