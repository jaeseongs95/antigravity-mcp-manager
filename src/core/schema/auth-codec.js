'use strict';

const { classifyHttpServerUrl } = require('../security/url-policy');

/**
 * Pure ECMAScript UTF-8 Base64 codec, Case-Insensitive Auth Header Builder & Sensitive Data Redactor
 * (`src/core/schema/auth-codec.js` — Rev 6 §5.2, 5095348c-F2/F4).
 * Zero Node (`Buffer`) or Browser (`btoa`/`atob`/`window`) globals; uses `Uint8Array` + RFC 4648 table only.
 */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const SENSITIVE_QUERY_PARAM_RE =
  /^(?:access_token|id_token|refresh_token|auth_token|bearer|api_key|apikey|x_api_key|token|secret|client_secret|code|key|password|passwd|pwd|sig|signature)$/i;

function toUtf8Bytes(str) {
  const input = String(str ?? '');
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(input);
  }
  const out = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        i += 1;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return new Uint8Array(out);
}

function fromUtf8Bytes(bytes) {
  if (typeof TextDecoder === 'function') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if ((b0 & 0xe0) === 0xc0 && i < bytes.length) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if ((b0 & 0xf0) === 0xe0 && i + 1 < bytes.length) {
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
    } else if (i + 2 < bytes.length) {
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      const cp = (((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

function encodeBytesToBase64(bytesInput) {
  const bytes = bytesInput instanceof Uint8Array ? bytesInput : new Uint8Array(bytesInput || 0);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_ALPHABET[(triplet >> 18) & 0x3f];
    out += BASE64_ALPHABET[(triplet >> 12) & 0x3f];
    out += hasB1 ? BASE64_ALPHABET[(triplet >> 6) & 0x3f] : '=';
    out += hasB2 ? BASE64_ALPHABET[triplet & 0x3f] : '=';
  }
  return out;
}

function decodeBase64ToBytes(b64) {
  const clean = String(b64 ?? '').replace(/[\r\n\s]/g, '');
  if (!clean || clean.length % 4 === 1) return null;
  const bytes = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = BASE64_ALPHABET.indexOf(clean[i]);
    const c1 = BASE64_ALPHABET.indexOf(clean[i + 1]);
    const ch2 = clean[i + 2];
    const ch3 = clean[i + 3];
    const c2 = ch2 === '=' || i + 2 >= clean.length ? -1 : BASE64_ALPHABET.indexOf(ch2);
    const c3 = ch3 === '=' || i + 3 >= clean.length ? -1 : BASE64_ALPHABET.indexOf(ch3);
    if (c0 < 0 || c1 < 0 || (ch2 && ch2 !== '=' && c2 < 0) || (ch3 && ch3 !== '=' && c3 < 0)) {
      return null;
    }
    const triplet = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
    bytes.push((triplet >> 16) & 0xff);
    if (c2 >= 0) bytes.push((triplet >> 8) & 0xff);
    if (c3 >= 0) bytes.push(triplet & 0xff);
  }
  return new Uint8Array(bytes);
}

function encodeBase64(str) {
  return encodeBytesToBase64(toUtf8Bytes(str));
}

function decodeBase64(b64) {
  try {
    const u8 = decodeBase64ToBytes(b64);
    if (!u8) return '';
    return fromUtf8Bytes(u8);
  } catch {
    return '';
  }
}

/**
 * Merges HTTP header objects case-insensitively (`D-0015`, `5095348c-F4`),
 * replacing any existing key that matches in lowercase with the latest canonical header key.
 */
function mergeHeadersCaseInsensitive(...headerMaps) {
  const out = {};
  const lowerToKey = new Map();
  for (let m = 0; m < headerMaps.length; m++) {
    const map = headerMaps[m];
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const [rawKey, rawVal] of Object.entries(map)) {
      const key = String(rawKey || '').trim();
      if (!key || rawVal === undefined || rawVal === null) continue;
      const lower = key.toLowerCase();
      const prevKey = lowerToKey.get(lower);
      if (prevKey && prevKey !== key) {
        delete out[prevKey];
      }
      lowerToKey.set(lower, key);
      out[key] = String(rawVal);
    }
  }
  return out;
}

function parseKeyValueInput(raw, { caseInsensitiveKeys = false } = {}) {
  let rawPairs = [];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    rawPairs = Object.entries(raw);
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          rawPairs = Object.entries(parsed);
        }
      } catch {}
    }
    if (rawPairs.length === 0) {
      const lines = trimmed.split(/\r?\n/);
      for (const line of lines) {
        const clean = line.trim();
        if (!clean || clean.startsWith('#')) continue;
        const eqIdx = clean.indexOf('=');
        const colonIdx = clean.indexOf(':');
        let sepIdx = -1;
        if (eqIdx !== -1 && (colonIdx === -1 || eqIdx < colonIdx)) {
          sepIdx = eqIdx;
        } else if (colonIdx !== -1) {
          sepIdx = colonIdx;
        }
        if (sepIdx > 0) {
          const key = clean.slice(0, sepIdx).trim();
          let val = clean.slice(sepIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          rawPairs.push([key, val]);
        }
      }
    }
  }

  const out = {};
  const lowerToKey = new Map();
  for (const [k, v] of rawPairs) {
    const key = String(k || '').trim();
    if (!key || v === undefined || v === null) continue;
    if (caseInsensitiveKeys) {
      const lower = key.toLowerCase();
      const prev = lowerToKey.get(lower);
      if (prev && prev !== key) delete out[prev];
      lowerToKey.set(lower, key);
    }
    out[key] = String(v);
  }
  return out;
}

function formatKeyValueForInput(obj, sep = '=') {
  if (!obj || typeof obj !== 'object') return '';
  const entries = Object.entries(obj);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}${sep}${v}`).join('\n');
}

function extractAuthFromSpec(spec) {
  const isHttp = Boolean(spec && typeof spec === 'object' && (spec.url || spec.serverUrl || spec.type === 'http'));
  const result = {
    authMode: isHttp ? 'oauth' : 'none',
    oauthClientMode: 'auto',
    oauthClientId: '',
    oauthClientSecret: '',
    oauthScopes: '',
    bearerToken: '',
    apiKeyHeader: 'X-API-Key',
    apiKeyValue: '',
    basicUser: '',
    basicPass: '',
    extraHeaders: {},
  };
  if (!spec || typeof spec !== 'object') return result;

  if (spec.oauth && typeof spec.oauth === 'object') {
    result.authMode = 'oauth';
    result.oauthClientId = typeof spec.oauth.clientId === 'string' ? spec.oauth.clientId : '';
    result.oauthClientSecret = typeof spec.oauth.clientSecret === 'string' ? spec.oauth.clientSecret : '';
    result.oauthScopes = Array.isArray(spec.oauth.scopes)
      ? spec.oauth.scopes.join(' ')
      : typeof spec.oauth.scopes === 'string'
        ? spec.oauth.scopes
        : '';
    if (result.oauthClientId || result.oauthClientSecret) {
      result.oauthClientMode = 'custom';
    }
  }

  if (spec.authMode === 'none' || spec.authMode === 'oauth' || spec.authMode === 'oauth_or_none') {
    result.authMode = spec.authMode;
  }

  const rawHeaders = spec.headers && typeof spec.headers === 'object' ? mergeHeadersCaseInsensitive(spec.headers) : {};
  const entries = Object.entries(rawHeaders);
  let matchedKey = null;

  if (spec.authMode === 'apiKey') {
    result.authMode = 'apiKey';
    const explicitHdr =
      typeof spec.apiKeyHeader === 'string' && spec.apiKeyHeader.trim() ? spec.apiKeyHeader.trim() : '';
    if (explicitHdr) {
      result.apiKeyHeader = explicitHdr;
      for (const [k, v] of entries) {
        if (k.toLowerCase() === explicitHdr.toLowerCase() && typeof v === 'string') {
          result.apiKeyHeader = k;
          result.apiKeyValue = v.trim();
          matchedKey = k;
          break;
        }
      }
    }
  }

  if (!matchedKey) {
    for (const [k, v] of entries) {
      if (k.toLowerCase() === 'authorization' && typeof v === 'string') {
        const trimmed = v.trim();
        const bearerMatch = /^Bearer\s+(.+)$/i.exec(trimmed);
        if (bearerMatch) {
          result.authMode = 'bearer';
          result.bearerToken = bearerMatch[1].trim();
          matchedKey = k;
          break;
        }
        const basicMatch = /^Basic\s+(.+)$/i.exec(trimmed);
        if (basicMatch) {
          const decoded = decodeBase64(basicMatch[1].trim());
          const colonIdx = decoded.indexOf(':');
          result.authMode = 'basic';
          if (colonIdx !== -1) {
            result.basicUser = decoded.slice(0, colonIdx);
            result.basicPass = decoded.slice(colonIdx + 1);
          } else {
            result.basicUser = decoded;
          }
          matchedKey = k;
          break;
        }
        result.authMode = 'apiKey';
        result.apiKeyHeader = k;
        result.apiKeyValue = trimmed;
        matchedKey = k;
        break;
      }
    }
  }

  if (!matchedKey) {
    for (const [k, v] of entries) {
      if (/^(?:x-api-key|api-key|x-auth-token|x-mcp-token|x-access-token)$/i.test(k) && typeof v === 'string') {
        result.authMode = 'apiKey';
        result.apiKeyHeader = k;
        result.apiKeyValue = v.trim();
        matchedKey = k;
        break;
      }
    }
  }

  if (!matchedKey && spec.authMode === 'apiKey') {
    const [k, v] = entries[0] || [];
    if (k && typeof v === 'string') {
      result.authMode = 'apiKey';
      result.apiKeyHeader = k;
      result.apiKeyValue = v.trim();
      matchedKey = k;
    }
  }

  for (const [k, v] of entries) {
    if (k !== matchedKey) {
      result.extraHeaders[k] = String(v);
    }
  }

  return result;
}

function buildAuthHeaders({
  authMode,
  mode: legacyMode,
  bearerToken,
  apiKeyHeader,
  apiKeyValue,
  basicUser,
  basicPass,
  baseHeaders,
}) {
  const headers = baseHeaders && typeof baseHeaders === 'object' ? mergeHeadersCaseInsensitive(baseHeaders) : {};
  const rawMode = typeof authMode === 'string' && authMode ? authMode : legacyMode;
  const mode = typeof rawMode === 'string' ? rawMode.trim() : '';

  if (!mode) {
    return headers;
  }

  if (mode === 'none' || mode === 'oauth' || mode === 'oauth_or_none') {
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'authorization') delete headers[k];
    }
    return headers;
  }

  if (mode === 'bearer') {
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'authorization') delete headers[k];
    }
    const rawToken = typeof bearerToken === 'string' ? bearerToken.trim() : '';
    if (rawToken) {
      const cleanToken = rawToken.replace(/^Bearer\s+/i, '').trim();
      if (cleanToken) {
        headers.Authorization = `Bearer ${cleanToken}`;
      }
    }
    return headers;
  }

  if (mode === 'apiKey') {
    const hdrName = typeof apiKeyHeader === 'string' && apiKeyHeader.trim() ? apiKeyHeader.trim() : 'X-API-Key';
    const hdrLower = hdrName.toLowerCase();
    for (const k of Object.keys(headers)) {
      const kl = k.toLowerCase();
      if (kl === hdrLower || (hdrLower !== 'authorization' && kl === 'authorization')) {
        delete headers[k];
      }
    }
    const hdrVal = typeof apiKeyValue === 'string' ? apiKeyValue.trim() : '';
    if (hdrVal) {
      headers[hdrName] = hdrVal;
    }
    return headers;
  }

  if (mode === 'basic') {
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'authorization') delete headers[k];
    }
    const u = typeof basicUser === 'string' ? basicUser : '';
    const p = typeof basicPass === 'string' ? basicPass : '';
    if (u || p) {
      headers.Authorization = `Basic ${encodeBase64(`${u}:${p}`)}`;
    }
    return headers;
  }

  return headers;
}

function normalizeQuickAuthToken(rawAuth) {
  if (typeof rawAuth !== 'string' || !rawAuth.trim()) return null;
  const trimmed = rawAuth.trim();
  if (/^Bearer\s+(.+)$/i.test(trimmed)) {
    const tok = trimmed.replace(/^Bearer\s+/i, '').trim();
    return tok ? { headerKey: 'Authorization', headerValue: `Bearer ${tok}`, rawToken: tok } : null;
  }
  if (/^Basic\s+(.+)$/i.test(trimmed)) {
    return { headerKey: 'Authorization', headerValue: trimmed, rawToken: trimmed };
  }
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0 && /^[a-zA-Z0-9_-]+$/.test(trimmed.slice(0, colonIdx).trim())) {
    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();
    if (val) {
      return { headerKey: key, headerValue: val, rawToken: val };
    }
  }
  return {
    headerKey: 'Authorization',
    headerValue: `Bearer ${trimmed}`,
    rawToken: trimmed,
  };
}

function extractUrlAuthAndCleanUrl(rawUrlStr) {
  try {
    const u = new URL(rawUrlStr);
    const extractedHeaders = {};
    if (u.username || u.password) {
      const user = decodeURIComponent(u.username || '');
      const pass = decodeURIComponent(u.password || '');
      if (user && !pass) {
        extractedHeaders.Authorization = `Bearer ${user}`;
      } else if (user || pass) {
        extractedHeaders.Authorization = `Basic ${encodeBase64(`${user}:${pass}`)}`;
      }
      u.username = '';
      u.password = '';
    }
    for (const paramName of ['bearer', 'auth_token', 'access_token']) {
      if (u.searchParams.has(paramName)) {
        const val = u.searchParams.get(paramName);
        if (val && !extractedHeaders.Authorization) {
          extractedHeaders.Authorization = `Bearer ${val}`;
        }
        u.searchParams.delete(paramName);
      }
    }
    return { cleanUrl: u.toString(), extractedHeaders };
  } catch {
    return { cleanUrl: rawUrlStr, extractedHeaders: {} };
  }
}

/**
 * Returns true iff `canonicalUrl` is eligible for batch credential propagation (`https:` or loopback `http:`).
 */
function isEligibleForBatchHttpAuth(canonicalUrl) {
  const urlInfo = classifyHttpServerUrl(canonicalUrl);
  return Boolean(urlInfo.ok && !urlInfo.isInsecureRemoteHttp);
}

/**
 * Redacts embedded URL credentials (`user:pass@`) and sensitive query/hash parameters
 * before rendering URLs in server cards, dialogs, or banners.
 */
function redactSensitiveUrl(rawUrlStr) {
  if (typeof rawUrlStr !== 'string' || !rawUrlStr.trim()) return '';
  try {
    const u = new URL(rawUrlStr.trim());
    const hadUserInfo = Boolean(u.username || u.password);
    u.username = '';
    u.password = '';
    const qKeys = [];
    u.searchParams.forEach((_val, key) => {
      qKeys.push(key);
    });
    for (let i = 0; i < qKeys.length; i++) {
      const key = qKeys[i];
      if (SENSITIVE_QUERY_PARAM_RE.test(key)) {
        u.searchParams.set(key, '[REDACTED]');
      }
    }
    if (u.hash && u.hash.length > 1 && u.hash.includes('=')) {
      const hp = new URLSearchParams(u.hash.slice(1));
      let changed = false;
      const hKeys = [];
      hp.forEach((_val, key) => {
        hKeys.push(key);
      });
      for (let i = 0; i < hKeys.length; i++) {
        const key = hKeys[i];
        if (SENSITIVE_QUERY_PARAM_RE.test(key)) {
          hp.set(key, '[REDACTED]');
          changed = true;
        }
      }
      if (changed) {
        u.hash = `#${hp.toString()}`;
      }
    }
    let formatted = u.toString().replace(/%5BREDACTED%5D/gi, '[REDACTED]');
    if (hadUserInfo) {
      formatted = formatted.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)/, '$1***@');
    }
    return formatted;
  } catch {
    return redactSensitiveText(rawUrlStr);
  }
}

function redactSensitiveText(rawText) {
  if (typeof rawText !== 'string' || !rawText) return '';
  return rawText
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi, '$1 [REDACTED]')
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s:@]+(?::[^/\s@]*)?)@/g, '$1***@')
    .replace(
      /([?&#](?:access_token|id_token|refresh_token|auth_token|bearer|api_key|apikey|token|secret|client_secret|code|key|password)=)[^&#\s]+/gi,
      '$1[REDACTED]'
    );
}

module.exports = {
  SENSITIVE_QUERY_PARAM_RE,
  toUtf8Bytes,
  fromUtf8Bytes,
  encodeBytesToBase64,
  decodeBase64ToBytes,
  encodeBase64,
  decodeBase64,
  mergeHeadersCaseInsensitive,
  parseKeyValueInput,
  formatKeyValueForInput,
  formatKeyValueForEditor: formatKeyValueForInput,
  extractAuthFromSpec,
  buildAuthHeaders,
  normalizeQuickAuthToken,
  extractUrlAuthAndCleanUrl,
  isEligibleForBatchHttpAuth,
  redactSensitiveUrl,
  redactSensitiveText,
};
