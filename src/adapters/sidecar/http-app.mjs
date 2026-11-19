/**
 * Hardened Antigravity UI Sidecar HTTP Adapter (`src/adapters/sidecar/http-app.mjs`).
 *
 * Security Invariants:
 * 1. Zero `child_process` imports or command execution.
 * 2. All `/api/*` endpoints are registered as `POST` ONLY so `SidecarApp.#validateToken`
 *    enforces `ANTIGRAVITY_SIDECAR_UI_TOKEN` (`x-sidecar-token`) on every data & write route.
 * 3. Every HTML/CSS/JS/JSON response includes strict `Content-Security-Policy`,
 *    `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store`.
 * 4. Error responses redact credentials and never echo `process.env` or `ANTIGRAVITY_CSRF_TOKEN`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ERROR_CODES } from '../../core/model.mjs';
import { redactErrorMessage } from '../../core/secret-redactor.mjs';

export const STRICT_SIDECAR_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': STRICT_SIDECAR_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
});

function statusForErrorCode(code) {
  switch (code) {
    case ERROR_CODES.CONFLICT:
      return 409;
    case ERROR_CODES.NOT_FOUND:
      return 404;
    case ERROR_CODES.LOCK_BUSY:
      return 423;
    case ERROR_CODES.WRITE_JAIL_VIOLATION:
      return 403;
    case ERROR_CODES.VALIDATION_ERROR:
    case ERROR_CODES.MALFORMED_JSON:
    case ERROR_CODES.COLLISION:
      return 400;
    default:
      return 200;
  }
}

export function registerSidecarRoutes({ app, ResponseClass, service, uiDir }) {
  const jsonResponse = (payload, status = 200) =>
    new ResponseClass(JSON.stringify(payload), {
      status,
      contentType: 'application/json; charset=utf-8',
      headers: { ...SECURITY_HEADERS },
    });

  const staticResponse = (fileName, contentType) => {
    const filePath = path.join(uiDir, fileName);
    const body = fs.readFileSync(filePath, 'utf8');
    return new ResponseClass(body, {
      status: 200,
      contentType,
      headers: { ...SECURITY_HEADERS },
    });
  };

  // Static UI assets (GET only — zero secret data)
  app.page('/', () => staticResponse('index.html', 'text/html; charset=utf-8'));
  app.api('/styles.css', () => staticResponse('styles.css', 'text/css; charset=utf-8'), 'GET');
  app.api('/app.js', () => staticResponse('app.js', 'application/javascript; charset=utf-8'), 'GET');

  const wrapPost = (routePath, handler) => {
    app.api(
      routePath,
      async (data) => {
        try {
          const result = await handler(data && typeof data === 'object' ? data : {});
          const httpStatus = result?.ok === false ? statusForErrorCode(result.code) : 200;
          return jsonResponse(result, httpStatus);
        } catch (err) {
          return jsonResponse(
            {
              ok: false,
              code: ERROR_CODES.IO_ERROR,
              errors: [redactErrorMessage(err?.message || 'Unexpected sidecar error')],
            },
            500
          );
        }
      },
      'POST'
    );
  };

  // ALL data & mutation routes are POST-only to enforce SidecarApp x-sidecar-token auth
  wrapPost('/api/snapshot', (data) =>
    service.getSnapshot({
      workspaceUris: Array.isArray(data.workspaceUris) ? data.workspaceUris : [],
      includeRawText: Boolean(data.includeRawText),
    })
  );

  wrapPost('/api/preview-paste', (data) => service.previewSmartPaste(data.rawInput ?? ''));

  wrapPost('/api/upsert', (data) =>
    service.upsertServer({
      name: data.name,
      originalName: data.originalName || null,
      spec: data.spec,
      expectedSha256: data.expectedSha256,
      confirmStdio: Boolean(data.confirmStdio),
    })
  );

  wrapPost('/api/toggle-disabled', (data) =>
    service.toggleServerDisabled({
      name: data.name,
      disabled: Boolean(data.disabled),
      expectedSha256: data.expectedSha256,
    })
  );

  wrapPost('/api/delete', (data) =>
    service.deleteServer({
      name: data.name,
      expectedSha256: data.expectedSha256,
    })
  );

  wrapPost('/api/clone-plugin', (data) =>
    service.clonePluginServer({
      pluginDir: data.pluginDir,
      serverName: data.serverName,
      targetName: data.targetName || null,
      expectedSha256: data.expectedSha256,
      confirmStdio: Boolean(data.confirmStdio),
    })
  );

  wrapPost('/api/import-legacy', (data) =>
    service.importLegacyServer({
      serverName: data.serverName,
      targetName: data.targetName || null,
      expectedSha256: data.expectedSha256,
      confirmStdio: Boolean(data.confirmStdio),
    })
  );

  wrapPost('/api/save-raw', (data) =>
    service.saveRawJson({
      rawText: data.rawText,
      expectedSha256: data.expectedSha256,
      confirmStdio: Boolean(data.confirmStdio),
    })
  );

  wrapPost('/api/restore-backup', () => service.restoreBackup());
}
