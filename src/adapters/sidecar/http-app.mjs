/**
 * Hardened Antigravity UI Sidecar HTTP Adapter (`src/adapters/sidecar/http-app.mjs`).
 *
 * Security Invariants:
 * 1. Zero `child_process` imports or command execution.
 * 2. All `/api/*` endpoints are registered as `POST` ONLY.
 * 3. `attachSidecarSecurityMiddleware(server, { token, maxBodyBytes })` enforces:
 *    - Loopback-only `Host` header allowlist on ALL requests (blocks DNS rebinding -> `403`).
 *    - `Origin` + `Sec-Fetch-Site` validation on non-GET/HEAD requests (blocks cross-site CSRF -> `403`
 *      while allowing Antigravity Desktop `AUX_PANE` cross-origin `<iframe>` static `GET` loads).
 *    - Constant-time `crypto.timingSafeEqual` `x-sidecar-token` check on non-GET/HEAD requests (`401`).
 *    - Bounded request body size (`1 MiB` default -> `413 Payload Too Large`).
 * 4. Every HTML/CSS/JS/JSON response includes strict `Content-Security-Policy`,
 *    `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, and `Referrer-Policy: no-referrer`.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { ERROR_CODES } from '../../core/model.mjs';
import { redactErrorMessage } from '../../core/secret-redactor.mjs';
import { isLoopbackHostname } from '../../core/validator.mjs';

export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

export const STRICT_SIDECAR_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': STRICT_SIDECAR_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
});

export function statusForErrorCode(code) {
  switch (code) {
    case ERROR_CODES.CONFLICT:
      return 409;
    case ERROR_CODES.NOT_FOUND:
      return 404;
    case ERROR_CODES.LOCK_BUSY:
      return 423;
    case ERROR_CODES.WRITE_JAIL_VIOLATION:
      return 403;
    case ERROR_CODES.CONFIRMATION_REQUIRED:
      return 428;
    case ERROR_CODES.IO_ERROR:
      return 500;
    case ERROR_CODES.VALIDATION_ERROR:
    case ERROR_CODES.MALFORMED_JSON:
    case ERROR_CODES.COLLISION:
      return 400;
    default:
      return 500;
  }
}

function constantTimeTokenEquals(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isAllowedLoopbackHostHeader(hostHeader) {
  if (typeof hostHeader !== 'string') return false;
  const trimmed = hostHeader.trim();
  if (!trimmed || /[\s@/?#\\]/.test(trimmed)) return false;
  try {
    const parsed = new URL(`http://${trimmed}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      return false;
    }
    return isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function isAllowedOriginHeader(originHeader, expectedHostHeader) {
  if (!originHeader || originHeader === 'null') return false;
  if (typeof expectedHostHeader !== 'string' || !expectedHostHeader.trim()) return false;
  try {
    const parsedOrigin = new URL(originHeader);
    const parsedHost = new URL(`http://${expectedHostHeader.trim()}`);
    if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') return false;
    if (!isLoopbackHostname(parsedOrigin.hostname)) return false;
    return parsedOrigin.host.toLowerCase() === parsedHost.host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Wraps the `http.Server` returned by `SidecarApp.run()` with Host/Origin/Sec-Fetch-Site,
 * fail-closed `timingSafeEqual` token verification, and `maxBodyBytes` guards.
 */
export function attachSidecarSecurityMiddleware(server, { token = '', maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  const expectedToken = typeof token === 'string' ? token.trim() : '';
  const existingListeners = server.listeners('request');
  server.removeAllListeners('request');

  server.on('request', (req, res) => {
    const sendJsonErr = (status, error) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: false, error }));
    };

    if (!isAllowedLoopbackHostHeader(req.headers.host)) {
      sendJsonErr(403, 'Forbidden Host header');
      return;
    }

    const isReadMethod = req.method === 'GET' || req.method === 'HEAD';
    if (!isReadMethod) {
      const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
      if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
        sendJsonErr(403, 'Forbidden cross-site request');
        return;
      }

      if (req.headers.origin !== undefined && !isAllowedOriginHeader(String(req.headers.origin), req.headers.host)) {
        sendJsonErr(403, 'Forbidden Origin header');
        return;
      }

      const provided = typeof req.headers['x-sidecar-token'] === 'string' ? req.headers['x-sidecar-token'] : '';
      if (!expectedToken || !constantTimeTokenEquals(expectedToken, provided)) {
        sendJsonErr(401, 'Unauthorized');
        return;
      }
    }

    const declaredLen = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLen) && declaredLen > maxBodyBytes) {
      sendJsonErr(413, 'Payload Too Large');
      req.resume();
      return;
    }

    if (isReadMethod) {
      for (const listener of existingListeners) {
        listener.call(server, req, res);
      }
      return;
    }

    // Buffer non-GET body (including Transfer-Encoding: chunked) BEFORE invoking downstream
    // listeners so an oversized body responds 413 cleanly with ZERO ERR_HTTP_HEADERS_SENT race.
    const chunks = [];
    let receivedBytes = 0;
    let oversized = false;
    req.on('data', (chunk) => {
      if (oversized) return;
      const bufChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      receivedBytes += bufChunk.length;
      if (receivedBytes > maxBodyBytes) {
        oversized = true;
        chunks.length = 0;
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close', ...SECURITY_HEADERS });
          res.end(JSON.stringify({ ok: false, error: 'Payload Too Large' }));
        }
        req.resume();
        return;
      }
      chunks.push(bufChunk);
    });
    req.on('end', () => {
      if (oversized || res.headersSent) return;
      const fullBuf = Buffer.concat(chunks);
      const replayReq = Readable.from(fullBuf.length > 0 ? [fullBuf] : []);
      replayReq.method = req.method;
      replayReq.url = req.url;
      replayReq.headers = req.headers;
      replayReq.rawHeaders = req.rawHeaders;
      replayReq.httpVersion = req.httpVersion;
      replayReq.socket = req.socket;
      replayReq.connection = req.connection;
      replayReq.complete = true;
      for (const listener of existingListeners) {
        listener.call(server, replayReq, res);
      }
    });
    req.on('error', () => {
      // Client aborted before completing body
    });
  });

  return server;
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
          const knownCodes = Object.values(ERROR_CODES);
          const errCode = err?.code && knownCodes.includes(err.code) ? err.code : ERROR_CODES.IO_ERROR;
          return jsonResponse(
            {
              ok: false,
              code: errCode,
              errors: [redactErrorMessage(err?.message || 'Unexpected sidecar error')],
            },
            statusForErrorCode(errCode)
          );
        }
      },
      'POST'
    );
  };

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
      confirmStdio: data.confirmStdio === true,
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
      pluginId: data.pluginId || null,
      pluginDir: data.pluginDir || null,
      serverName: data.serverName,
      targetName: data.targetName || null,
      workspaceUris: Array.isArray(data.workspaceUris) ? data.workspaceUris : [],
      expectedSha256: data.expectedSha256,
      confirmStdio: data.confirmStdio === true,
    })
  );

  wrapPost('/api/import-legacy', (data) =>
    service.importLegacyServer({
      serverName: data.serverName,
      targetName: data.targetName || null,
      expectedSha256: data.expectedSha256,
      confirmStdio: data.confirmStdio === true,
    })
  );

  wrapPost('/api/save-raw', (data) =>
    service.saveRawJson({
      rawText: data.rawText,
      expectedSha256: data.expectedSha256,
      confirmStdio: data.confirmStdio === true,
    })
  );

  wrapPost('/api/restore-backup', (data) =>
    service.restoreBackup({
      expectedSha256: data.expectedSha256,
    })
  );
}
