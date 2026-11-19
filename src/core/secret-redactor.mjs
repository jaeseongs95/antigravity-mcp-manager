/**
 * Secret Redaction & Masking (`src/core/secret-redactor.mjs`).
 * Ensures env values, header values, and URL credentials never leak in redacted DTOs or logs.
 */

import { isPlainObject } from './model.mjs';

export const REDACTED_MASK = '••••••••';

export function redactUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.username || parsed.password) {
      parsed.username = 'REDACTED';
      parsed.password = 'REDACTED';
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|key|secret|auth|pass|code|sig/i.test(key)) {
        parsed.searchParams.set(key, 'REDACTED');
      }
    }
    return parsed.href;
  } catch {
    return rawUrl.replace(/([?&](?:token|api_?key|secret|auth|password|code)=)[^&\s]+/gi, '$1REDACTED');
  }
}

export function maskSecretMap(mapObj) {
  if (!isPlainObject(mapObj)) return {};
  const masked = {};
  for (const [k, v] of Object.entries(mapObj)) {
    masked[k] = typeof v === 'string' && v.length > 0 ? REDACTED_MASK : '';
  }
  return masked;
}

export function redactServerSpec(spec) {
  if (!isPlainObject(spec)) return {};
  const out = {};
  for (const [k, v] of Object.entries(spec)) {
    if (k === 'env' && isPlainObject(v)) {
      out.env = maskSecretMap(v);
    } else if (k === 'headers' && isPlainObject(v)) {
      out.headers = maskSecretMap(v);
    } else if ((k === 'url' || k === 'serverUrl') && typeof v === 'string') {
      out[k] = redactUrl(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function redactErrorMessage(message) {
  return String(message || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1REDACTED')
    .replace(/(Basic\s+)[A-Za-z0-9+/=]+/gi, '$1REDACTED')
    .replace(/([?&](?:token|api_?key|secret|auth|password|code)=)[^&\s"']+/gi, '$1REDACTED')
    .replace(/(https?:\/\/)([^:@/\s]+):([^@/\s]+)@/gi, '$1REDACTED:REDACTED@');
}
