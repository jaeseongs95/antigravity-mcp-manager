'use strict';

/**
 * Vendor-neutral URL, Origin, Loopback OAuth, and Parameterized CDN Path Policy (`src/core/security/url-policy.js`).
 * Pure ECMAScript (`URL` only); zero host/DOM/timer/vendor brand identifiers or strings.
 */

const IPV4_LOOPBACK_RE = /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function normalizeHostname(rawHostname) {
  return String(rawHostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');
}

/**
 * Checks whether `hostname` matches an entry in `allowedDomains` by exact match
 * or strict `.` subdomain boundary (`D-0011`, `D-0029`, `D-0033`).
 */
function matchesAllowedDomain(hostname, allowedDomains) {
  const host = normalizeHostname(hostname);
  if (!host || !Array.isArray(allowedDomains) || allowedDomains.length === 0) return false;
  for (let i = 0; i < allowedDomains.length; i++) {
    const dom = normalizeHostname(allowedDomains[i]).replace(/^\.+/, '');
    if (!dom) continue;
    if (host === dom || host.endsWith(`.${dom}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true iff `hostname` is an RFC loopback host (`localhost`, `127.0.0.0/8`, `::1`, `[::1]`).
 */
function isLoopbackHostname(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return false;
  if (host === 'localhost' || host === '::1' || host === '[::1]' || host === '[0:0:0:0:0:0:0:1]') {
    return true;
  }
  return IPV4_LOOPBACK_RE.test(host);
}

/**
 * Classifies an HTTP/HTTPS server URL (`D-0023`, `MCP-TC-045`):
 * - `https:` -> `{ ok: true, isLoopback: ..., isInsecureRemoteHttp: false }`
 * - `http:` on loopback -> `{ ok: true, isLoopback: true, isInsecureRemoteHttp: false }`
 * - `http:` on non-loopback -> `{ ok: true, isLoopback: false, isInsecureRemoteHttp: true }`
 * - Other schemes / invalid URLs -> `{ ok: false, code: 'INVALID_SERVER_URL' }`
 */
function classifyHttpServerUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { ok: false, code: 'INVALID_SERVER_URL', error: 'Server URL must be a non-empty string.' };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, code: 'INVALID_SERVER_URL', error: `Invalid URL format: "${rawUrl.trim()}".` };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      code: 'INVALID_SERVER_URL',
      error: `Unsupported URL scheme "${parsed.protocol}". Only https:// (or loopback http://) is supported.`,
    };
  }
  const loopback = isLoopbackHostname(parsed.hostname);
  const isInsecureRemoteHttp = parsed.protocol === 'http:' && !loopback;
  return {
    ok: true,
    parsed,
    href: parsed.href,
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    hasEmbeddedCredentials: Boolean(parsed.username || parsed.password),
    isLoopback: loopback,
    isInsecureRemoteHttp,
  };
}

/**
 * Validates external OAuth authorization URLs before launching a browser window (`MCP-TC-019`, `Rev 6 §5.1`):
 * - Must parse as a valid URL with zero embedded credentials (`username`/`password`).
 * - Allows `https:` or loopback-only `http:`.
 * - Rejects `javascript:`, `data:`, `file:`, `blob:`, non-loopback `http:`, and `user:pass@` URLs.
 */
function validateExternalAuthUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    const error = 'Authorization URL is empty.';
    return { ok: false, code: 'INVALID_AUTH_URL', reason: error, error };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    const error = 'Authorization URL is malformed.';
    return { ok: false, code: 'INVALID_AUTH_URL', reason: error, error };
  }
  if (parsed.username || parsed.password) {
    const error = 'Authorization URL must not contain embedded userinfo credentials.';
    return {
      ok: false,
      code: 'AUTH_URL_CREDENTIALS_FORBIDDEN',
      reason: error,
      error,
    };
  }
  if (parsed.protocol === 'https:') {
    return { ok: true, href: parsed.href, normalizedUrl: parsed.href, parsed };
  }
  if (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)) {
    return { ok: true, href: parsed.href, normalizedUrl: parsed.href, parsed };
  }
  const error = `Blocked unsafe or non-loopback authorization URL scheme "${parsed.protocol}".`;
  return {
    ok: false,
    code: 'INSECURE_AUTH_URL',
    reason: error,
    error,
  };
}

/**
 * Detects raw, single-encoded (`%2e%2e`), double-encoded (`%252e%252e`), or backslash path traversal (`MCP-TC-040`).
 */
function hasPathTraversal(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath) return false;
  let cur = inputPath;
  for (let pass = 0; pass < 4; pass++) {
    if (cur.includes('\\')) return true;
    if (/(?:^|\/)\.\.(?:\/|$)/.test(cur) || cur.includes('..')) return true;
    if (/%2e/i.test(cur) || /%5c/i.test(cur)) {
      try {
        const next = decodeURIComponent(cur);
        if (next === cur) break;
        cur = next;
        continue;
      } catch {
        return true;
      }
    }
    try {
      const next = decodeURIComponent(cur);
      if (next === cur) break;
      cur = next;
    } catch {
      return true;
    }
  }
  if (cur.includes('\\') || /(?:^|\/)\.\.(?:\/|$)/.test(cur) || cur.includes('..')) {
    return true;
  }
  return false;
}

/**
 * Validates whether a script URL is permitted under parameterized HTTPS origin/domain/prefix rules (`D-0033`, `D-0034`).
 * @param {string} rawUrl
 * @param {{
 *   allowedOrigins?: ReadonlyArray<string>,
 *   allowedDomains?: ReadonlyArray<string>,
 *   allowedBaseUrls?: ReadonlyArray<string>,
 *   extraExactUrls?: ReadonlyArray<string>,
 * }} [policy]
 */
function isAllowedHttpsScriptUrl(rawUrl, policy = {}) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  const trimmed = rawUrl.trim();
  if (hasPathTraversal(trimmed)) return false;

  const normalizedPolicy = Array.isArray(policy) ? { allowedDomains: policy } : (policy || {});

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return false;
  }
  if (hasPathTraversal(parsed.pathname)) {
    return false;
  }

  const exactList = Array.isArray(normalizedPolicy.extraExactUrls) ? normalizedPolicy.extraExactUrls : [];
  for (let i = 0; i < exactList.length; i++) {
    try {
      const exactParsed = new URL(String(exactList[i] || '').trim());
      if (
        exactParsed.protocol === 'https:' &&
        parsed.origin === exactParsed.origin &&
        parsed.pathname === exactParsed.pathname
      ) {
        return true;
      }
    } catch {}
  }

  const baseUrls = Array.isArray(normalizedPolicy.allowedBaseUrls) ? normalizedPolicy.allowedBaseUrls : [];
  for (let i = 0; i < baseUrls.length; i++) {
    try {
      const cleanBase = String(baseUrls[i] || '').trim().replace(/\/+$/, '');
      if (!cleanBase) continue;
      const baseParsed = new URL(`${cleanBase}/`);
      if (
        baseParsed.protocol === 'https:' &&
        parsed.origin === baseParsed.origin &&
        (parsed.pathname === baseParsed.pathname.replace(/\/$/, '') || parsed.pathname.startsWith(baseParsed.pathname))
      ) {
        return true;
      }
    } catch {}
  }

  const origins = Array.isArray(normalizedPolicy.allowedOrigins) ? normalizedPolicy.allowedOrigins : [];
  for (let i = 0; i < origins.length; i++) {
    try {
      const allowedOrig = new URL(String(origins[i] || '').trim()).origin;
      if (parsed.origin === allowedOrig) return true;
    } catch {}
  }

  if (matchesAllowedDomain(parsed.hostname, normalizedPolicy.allowedDomains)) {
    return true;
  }

  return false;
}

/**
 * Parameterized CDN relative/absolute asset resolver (`MCP-TC-040`, `Rev 6 §3`).
 * Confines resolved URLs strictly to `cdnOrigin` and `effectiveRootPrefix`, rejecting `%2e%2e`, `%252e%252e`,
 * backslashes, scheme-relative `//`, and non-HTTPS schemes while allowing safe normalized relative paths
 * (`./sub/../file.js`, `../shared/chunk.js`) that remain inside `effectiveRootPrefix`.
 *
 * @param {string} rawValue
 * @param {{
 *   cdnBaseUrl: string,
 *   hostOrigin?: string,
 *   allowedPathPrefix?: string,
 * }} options
 * @returns {string | null}
 */
function resolveCdnAssetUrl(rawValue, options = {}) {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  // Reject backslash or encoded dot/slash traversal before URL normalization collapses `%2e%2e`
  if (trimmed.includes('\\') || /%(?:2e|2f|5c|25(?:2e|2f|5c))/i.test(trimmed)) {
    return null;
  }

  const cleanCdnBase = String(options.cdnBaseUrl || '').trim().replace(/\/+$/, '');
  if (!cleanCdnBase) return null;

  const webSeg = String(options.allowedPathPrefix || '/web/').replace(/^\/+|\/+$/g, '') || 'web';
  const webMarkerRe = new RegExp(`\\/${webSeg}\\/.*$`);
  const cdnRoot = cleanCdnBase.replace(webMarkerRe, '');

  let cdnParsed;
  let rootUrl;
  try {
    cdnParsed = new URL(`${cleanCdnBase}/`);
    rootUrl = new URL(cdnRoot.endsWith('/') ? cdnRoot : `${cdnRoot}/`);
  } catch {
    return null;
  }
  if (cdnParsed.protocol !== 'https:' || rootUrl.protocol !== 'https:') {
    return null;
  }

  const cdnOrigin = cdnParsed.origin;
  const webPrefixSlash = `/${webSeg}/`;
  const effectiveRootPrefix =
    rootUrl.pathname !== '/'
      ? rootUrl.pathname
      : cdnParsed.pathname.startsWith(webPrefixSlash)
        ? webPrefixSlash
        : '/';

  if (/^(?:blob:|data:|javascript:|mailto:|tel:|about:|file:)/i.test(trimmed)) {
    return null;
  }

  const webBuildPathRe = new RegExp(`^\\/${webSeg}\\/[^/]+\\/`);
  const nestedWebBuildPathRe = new RegExp(`^\\/(?:[^/]+\\/)*${webSeg}\\/[^/]+\\/`);

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.username || parsed.password) return null;
      if (
        parsed.protocol === 'https:' &&
        parsed.origin === cdnOrigin &&
        parsed.pathname.startsWith(effectiveRootPrefix) &&
        !hasPathTraversal(parsed.pathname)
      ) {
        return parsed.href;
      }
      if (options.hostOrigin) {
        const hOrig = new URL(String(options.hostOrigin)).origin;
        if (
          parsed.origin === hOrig &&
          webBuildPathRe.test(parsed.pathname) &&
          !hasPathTraversal(parsed.pathname)
        ) {
          return `${cdnRoot}${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
      }
    } catch {}
    return null;
  }

  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('?')) {
    return null;
  }

  if (trimmed.startsWith(webPrefixSlash)) {
    // Reject `..` traversal when starting at `/web/...` if it attempts to escape above `rootUrl.pathname`
    try {
      const candidate = new URL(trimmed.slice(1), rootUrl);
      if (
        candidate.origin !== cdnOrigin ||
        !candidate.pathname.startsWith(rootUrl.pathname) ||
        !nestedWebBuildPathRe.test(candidate.pathname) ||
        hasPathTraversal(candidate.pathname)
      ) {
        return null;
      }
      return candidate.href;
    } catch {
      return null;
    }
  }

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    try {
      const baseForRel = trimmed.startsWith('/')
        ? effectiveRootPrefix !== '/' && trimmed.startsWith(effectiveRootPrefix)
          ? new URL('/', cdnOrigin)
          : rootUrl
        : cdnParsed;
      const relInput = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
      const candidate = new URL(relInput, baseForRel);
      if (
        candidate.origin !== cdnOrigin ||
        !candidate.pathname.startsWith(effectiveRootPrefix) ||
        hasPathTraversal(candidate.pathname)
      ) {
        return null;
      }
      // If `effectiveRootPrefix === '/'`, prevent escaping out of `/web/<build>/` via `../../other` when `cdnParsed` is under `/web/`
      if (effectiveRootPrefix === '/' && cdnParsed.pathname !== '/' && !candidate.pathname.startsWith(cdnParsed.pathname)) {
        return null;
      }
      return candidate.href;
    } catch {
      return null;
    }
  }

  return null;
}

module.exports = {
  normalizeHostname,
  matchesAllowedDomain,
  isLoopbackHostname,
  classifyHttpServerUrl,
  validateExternalAuthUrl,
  hasPathTraversal,
  isAllowedHttpsScriptUrl,
  resolveCdnAssetUrl,
};
