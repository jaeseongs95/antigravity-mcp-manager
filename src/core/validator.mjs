/**
 * Non-Executing Static Validator for MCP Server Names & Specs (`src/core/validator.mjs`).
 * Enforces Stdio & Streamable HTTP invariants, blocks prototype pollution,
 * rejects dangerous env overrides, and blocks plaintext HTTP credentials on non-loopback hosts.
 */

import {
  CAUTION_ENV_KEYS,
  DANGEROUS_ENV_KEYS,
  FORBIDDEN_OBJECT_KEYS,
  TRANSPORT_KINDS,
  isPlainObject,
} from './model.mjs';

const SERVER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SENSITIVE_HEADER_RE = /^(authorization|proxy-authorization|x-api-key|api-key|x-auth-token|cookie)$/i;

export function isLoopbackHostname(hostname) {
  const clean = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return clean === 'localhost' || clean === '127.0.0.1' || clean === '::1';
}

export function isLegacySseUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return /\/sse\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function validateServerName(name) {
  const errors = [];
  if (typeof name !== 'string' || !name.trim()) {
    errors.push('Server name is required.');
    return { ok: false, errors };
  }
  const trimmed = name.trim();
  if (trimmed !== name) {
    errors.push('Server name must not have leading or trailing whitespace.');
  }
  if (FORBIDDEN_OBJECT_KEYS.has(trimmed)) {
    errors.push(`Forbidden server name "${trimmed}".`);
  }
  if (!SERVER_NAME_RE.test(trimmed)) {
    errors.push('Server name must start with alphanumeric and contain only A-Z, a-z, 0-9, ".", "_", "-" (max 64 chars).');
  }
  return { ok: errors.length === 0, errors };
}

export function extractUrlFromSpec(spec) {
  if (!isPlainObject(spec)) return { url: null, key: null };
  const hasUrl = Object.prototype.hasOwnProperty.call(spec, 'url') && spec.url !== undefined;
  const hasServerUrl = Object.prototype.hasOwnProperty.call(spec, 'serverUrl') && spec.serverUrl !== undefined;
  if (hasUrl && hasServerUrl && spec.url !== spec.serverUrl) {
    return { url: null, key: 'conflict', conflict: true };
  }
  if (hasUrl) return { url: spec.url, key: 'url' };
  if (hasServerUrl) return { url: spec.serverUrl, key: 'serverUrl' };
  return { url: null, key: null };
}

export function validateServerSpec(spec) {
  const errors = [];
  const warnings = [];
  let requiresStdioConfirmation = false;
  let transport = null;

  if (!isPlainObject(spec)) {
    return {
      ok: false,
      transport: null,
      errors: ['Server configuration must be a JSON object.'],
      warnings: [],
      requiresStdioConfirmation: false,
    };
  }

  for (const key of Object.keys(spec)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      errors.push(`Forbidden property "${key}" in server spec.`);
    }
  }

  const hasCommand = Object.prototype.hasOwnProperty.call(spec, 'command') && spec.command !== undefined;
  const urlInfo = extractUrlFromSpec(spec);
  if (urlInfo.conflict) {
    errors.push('Spec cannot define both "url" and "serverUrl" with different values.');
  }
  const hasUrl = urlInfo.key !== null && !urlInfo.conflict;

  if (hasCommand && hasUrl) {
    errors.push('Server spec cannot define both Stdio ("command") and HTTP ("url"/"serverUrl") transports.');
  } else if (!hasCommand && !hasUrl) {
    errors.push('Server spec must define either "command" (Stdio) or "url" (Streamable HTTP).');
  }

  if (hasCommand) {
    transport = TRANSPORT_KINDS.STDIO;
    requiresStdioConfirmation = true;

    if (typeof spec.command !== 'string' || !spec.command.trim()) {
      errors.push('"command" must be a non-empty string.');
    } else if (/[\r\n\0]/.test(spec.command)) {
      errors.push('"command" must not contain control characters.');
    }

    if (spec.args !== undefined) {
      if (!Array.isArray(spec.args)) {
        errors.push('"args" must be an array of strings.');
      } else {
        for (let i = 0; i < spec.args.length; i += 1) {
          if (typeof spec.args[i] !== 'string') {
            errors.push(`"args[${i}]" must be a string.`);
          } else if (/\0/.test(spec.args[i])) {
            errors.push(`"args[${i}]" must not contain NUL bytes.`);
          }
        }
      }
    }

    if (spec.env !== undefined) {
      if (!isPlainObject(spec.env)) {
        errors.push('"env" must be an object mapping string keys to string values.');
      } else {
        for (const [k, v] of Object.entries(spec.env)) {
          if (FORBIDDEN_OBJECT_KEYS.has(k)) {
            errors.push(`Forbidden env key "${k}".`);
            continue;
          }
          if (!ENV_KEY_RE.test(k)) {
            errors.push(`Invalid env key "${k}".`);
          }
          if (typeof v !== 'string') {
            errors.push(`Env value for "${k}" must be a string.`);
          }
          const upper = k.toUpperCase();
          if (DANGEROUS_ENV_KEYS.has(upper)) {
            errors.push(`Dangerous environment variable "${k}" is blocked for security.`);
          } else if (CAUTION_ENV_KEYS.has(upper)) {
            warnings.push(`Overriding "${k}" alters executable resolution; verify before saving.`);
          }
        }
      }
    }
  }

  if (hasUrl) {
    if (typeof urlInfo.url !== 'string' || !urlInfo.url.trim()) {
      errors.push(`"${urlInfo.key}" must be a non-empty string.`);
    } else {
      let parsed = null;
      try {
        parsed = new URL(urlInfo.url.trim());
      } catch {
        errors.push(`"${urlInfo.key}" must be a valid absolute http(s) URL.`);
      }
      if (parsed) {
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          errors.push(`Unsupported URL protocol "${parsed.protocol}". Only https: and http: are allowed.`);
        } else {
          const isLegacySse = isLegacySseUrl(parsed.href);
          transport = isLegacySse ? TRANSPORT_KINDS.LEGACY_SSE : TRANSPORT_KINDS.STREAMABLE_HTTP;
          if (isLegacySse) {
            warnings.push('Legacy HTTP+SSE (/sse) is not supported directly; use Streamable HTTP (/mcp) or a stdio mcp-remote bridge.');
          }
          if (parsed.username || parsed.password) {
            errors.push('Embedded credentials in URL (user:pass@host) are forbidden; use headers instead.');
          }
          const hasAuthHeader =
            isPlainObject(spec.headers) &&
            Object.keys(spec.headers).some((hk) => SENSITIVE_HEADER_RE.test(hk));
          if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
            if (hasAuthHeader) {
              errors.push('Cleartext http:// with authentication headers is forbidden on non-loopback hosts; use https://.');
            } else {
              warnings.push('Using unencrypted http:// on a non-loopback host; prefer https://.');
            }
          }
        }
      }
    }

    if (spec.headers !== undefined) {
      if (!isPlainObject(spec.headers)) {
        errors.push('"headers" must be an object mapping header names to string values.');
      } else {
        const seenLower = new Set();
        for (const [hk, hv] of Object.entries(spec.headers)) {
          if (FORBIDDEN_OBJECT_KEYS.has(hk)) {
            errors.push(`Forbidden header key "${hk}".`);
            continue;
          }
          if (!HEADER_NAME_RE.test(hk)) {
            errors.push(`Invalid HTTP header name "${hk}".`);
          }
          const lower = hk.toLowerCase();
          if (seenLower.has(lower)) {
            errors.push(`Duplicate HTTP header "${hk}" (case-insensitive).`);
          }
          seenLower.add(lower);
          if (typeof hv !== 'string' || /[\r\n\0]/.test(hv)) {
            errors.push(`Header "${hk}" value must be a single-line string.`);
          }
        }
      }
    }
  }

  if (spec.disabled !== undefined && typeof spec.disabled !== 'boolean') {
    errors.push('"disabled" must be a boolean.');
  }

  if (spec.disabledTools !== undefined) {
    if (!Array.isArray(spec.disabledTools) || spec.disabledTools.some((t) => typeof t !== 'string' || !t.trim())) {
      errors.push('"disabledTools" must be an array of non-empty strings.');
    }
  }

  return {
    ok: errors.length === 0,
    transport,
    errors,
    warnings,
    requiresStdioConfirmation,
  };
}
