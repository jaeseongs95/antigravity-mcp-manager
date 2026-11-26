/**
 * AUTO-GENERATED AddonManifest.v3 Renderer Entry (`src/adapters/antigravity/addon-renderer.js`).
 * Source of truth: `src/adapters/antigravity/renderer/*.mjs` (run `npm run build:renderer`).
 *
 * Executed by Extenra (`extenra`, v3.1.0+/v3.2.1, Desktop & Remote Web) as
 * `(function(addonHost){ ... })(__addonHandle)` with `AddonContextV3` (`apiVersion: 3`).
 * ZERO unsafe DOM sinks, ZERO direct DOM scraping, 100% 3-Tier API-First.
 */

(function (addonHost) {
  'use strict';

  if (!addonHost || addonHost.apiVersion !== 3 || !addonHost.ui || !addonHost.storage || !addonHost.lifecycle) {
    return;
  }

  // --- module: core/model.mjs ---
  /**
   * Domain constants, error codes, and transport types (`src/core/model.mjs`).
   * 100% vendor-independent and runtime-agnostic (zero Node/DOM/host imports).
   */
  const TRANSPORT_KINDS = Object.freeze({
    STDIO: 'stdio',
    STREAMABLE_HTTP: 'streamable_http',
    LEGACY_SSE: 'legacy_sse',
  });
  const ERROR_CODES = Object.freeze({
    MALFORMED_JSON: 'MALFORMED_JSON',
    CONFLICT: 'CONFLICT',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    COLLISION: 'COLLISION',
    CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
    WRITE_JAIL_VIOLATION: 'WRITE_JAIL_VIOLATION',
    LOCK_BUSY: 'LOCK_BUSY',
    IO_ERROR: 'IO_ERROR',
  });
  const FORBIDDEN_OBJECT_KEYS = Object.freeze(
    new Set(['__proto__', 'constructor', 'prototype'])
  );

  /**
   * Environment variables that hijack dynamic linkers, interpreters, or command resolution.
   * Hard-blocked or flagged before persistence.
   */
  const DANGEROUS_ENV_KEYS = Object.freeze(
    new Set([
      'LD_PRELOAD',
      'LD_LIBRARY_PATH',
      'DYLD_INSERT_LIBRARIES',
      'DYLD_LIBRARY_PATH',
      'NODE_OPTIONS',
      'NODE_EXTRA_CA_CERTS',
      'NODE_TLS_REJECT_UNAUTHORIZED',
      'PYTHONPATH',
      'PYTHONSTARTUP',
      'RUBYOPT',
      'PERL5OPT',
      'BASH_ENV',
      'ENV',
      'IFS',
      'COMSPEC',
      'PATHEXT',
      'PROMPT_COMMAND',
    ])
  );
  const CAUTION_ENV_KEYS = Object.freeze(new Set(['PATH']));
  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }
  function createSafeRecord() {
    return Object.create(null);
  }

  // --- module: core/sha256.mjs ---
  /**
   * Standard Web Crypto API SHA-256 over UTF-8 (`src/core/sha256.mjs`).
   * Uses runtime-standard `TextEncoder` + `globalThis.crypto.subtle.digest('SHA-256', ...)`
   * (available natively in Node 22+, Deno, Bun, and modern browsers) with zero hand-rolled
   * cryptography and zero `node:*` imports.
   */

  const UTF8_ENCODER = new TextEncoder();
  async function sha256Hex(input) {
    const bytes = UTF8_ENCODER.encode(String(input ?? ''));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // --- module: core/ports.mjs ---
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
  const DEFAULT_GENERIC_DIALECT = Object.freeze({
    serversRootKey: 'mcpServers',
    primaryUrlKey: 'url',
    acceptedUrlKeys: Object.freeze(['url', 'serverUrl']),
    supportsNativeDisabled: true,
    supportsDisabledTools: true,
  });
  function assertConfigStorePort(store) {
    if (!store || typeof store.readGlobalConfig !== 'function' || typeof store.writeGlobalConfig !== 'function') {
      throw new TypeError('ConfigStorePort requires readGlobalConfig() and writeGlobalConfig()');
    }
  }

  // --- module: core/secret-redactor.mjs ---
  /**
   * Secret Redaction & Masking (`src/core/secret-redactor.mjs`).
   * Ensures env values, header values, and URL credentials never leak in redacted DTOs or logs.
   */
  const REDACTED_MASK = '••••••••';
  function redactUrl(rawUrl) {
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
  function maskSecretMap(mapObj) {
    if (!isPlainObject(mapObj)) return {};
    const masked = {};
    for (const [k, v] of Object.entries(mapObj)) {
      masked[k] = typeof v === 'string' && v.length > 0 ? REDACTED_MASK : '';
    }
    return masked;
  }
  function redactServerSpec(spec) {
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
  function redactErrorMessage(message) {
    return String(message || '')
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1REDACTED')
      .replace(/(Basic\s+)[A-Za-z0-9+/=]+/gi, '$1REDACTED')
      .replace(/([?&](?:token|api_?key|secret|auth|password|code)=)[^&\s"']+/gi, '$1REDACTED')
      .replace(/(https?:\/\/)([^:@/\s]+):([^@/\s]+)@/gi, '$1REDACTED:REDACTED@');
  }

  // --- module: core/collision-detector.mjs ---
  /**
   * Server Name Collision Detector (`src/core/collision-detector.mjs`).
   * Detects exact & case-insensitive duplicates inside global scope and across plugin scopes.
   */
  function detectCollisions(globalServerNames = [], pluginServers = []) {
    const globalCaseDuplicates = [];
    const seenGlobal = new Map();

    for (const name of globalServerNames) {
      const lower = String(name).toLowerCase();
      if (seenGlobal.has(lower)) {
        globalCaseDuplicates.push({
          existingName: seenGlobal.get(lower),
          conflictingName: name,
        });
      } else {
        seenGlobal.set(lower, name);
      }
    }

    const pluginCollisions = [];
    for (const entry of pluginServers) {
      const lower = String(entry.name || '').toLowerCase();
      if (seenGlobal.has(lower)) {
        pluginCollisions.push({
          serverName: entry.name,
          globalName: seenGlobal.get(lower),
          pluginName: entry.pluginName,
          pluginDir: entry.pluginDir,
          exactMatch: seenGlobal.get(lower) === entry.name,
        });
      }
    }

    return {
      globalCaseDuplicates,
      pluginCollisions,
    };
  }
  function findCaseInsensitiveConflict(existingNames, candidateName, ignoreName = null) {
    const targetLower = String(candidateName || '').toLowerCase();
    const ignoreLower = ignoreName ? String(ignoreName).toLowerCase() : null;
    for (const existing of existingNames) {
      if (ignoreName && existing === ignoreName) continue;
      if (ignoreLower && existing.toLowerCase() === ignoreLower && existing === ignoreName) continue;
      if (existing.toLowerCase() === targetLower) {
        return existing;
      }
    }
    return null;
  }

  // --- module: core/validator.mjs ---
  /**
   * Non-Executing Static Validator for MCP Server Names & Specs (`src/core/validator.mjs`).
   * Enforces Stdio & Streamable HTTP invariants, blocks prototype pollution,
   * rejects dangerous env overrides, and blocks plaintext HTTP credentials on non-loopback hosts.
   */
  const SERVER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
  const SENSITIVE_HEADER_RE = /^(authorization|proxy-authorization|x-api-key|api-key|x-auth-token|cookie)$/i;
  function isLoopbackHostname(hostname) {
    const clean = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return clean === 'localhost' || clean === '127.0.0.1' || clean === '::1';
  }
  function isLegacySseUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      return /\/sse\/?$/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }
  function validateServerName(name) {
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
  function extractUrlFromSpec(spec) {
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
  function validateServerSpec(spec) {
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
            const hasSensitiveQueryParam = [...parsed.searchParams.keys()].some((qk) =>
              /token|api_?key|secret|auth|pass|code|sig/i.test(qk)
            );
            if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
              if (hasAuthHeader || hasSensitiveQueryParam) {
                errors.push('Cleartext http:// with authentication headers or credential query parameters is forbidden on non-loopback hosts; use https://.');
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

  // --- module: core/document-engine.mjs ---
  /**
   * Lossless JSON Document Engine with Fail-Closed Parsing & SHA-256 CAS (`src/core/document-engine.mjs`).
   *
   * Invariants:
   * 1. Never coerces malformed JSON into `{ mcpServers: {} }`.
   * 2. Preserves all unknown top-level keys and unknown per-server keys losslessly.
   * 3. Rejects prototype-pollution keys (`__proto__`, `constructor`, `prototype`).
   * 4. Detects line endings (`\r\n` vs `\n`) and preserves them on serialization.
   */
  function detectEol(text) {
    return String(text || '').includes('\r\n') ? '\r\n' : '\n';
  }

  function extractSyntaxPosition(rawText, errorMessage) {
    const posMatch = /position\s+(\d+)/i.exec(String(errorMessage || ''));
    if (!posMatch) return { line: null, column: null };
    const offset = Number(posMatch[1]);
    if (!Number.isFinite(offset) || offset < 0) return { line: null, column: null };
    const slice = rawText.slice(0, offset);
    const lines = slice.split('\n');
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
    };
  }

  function hasForbiddenKeyRecursive(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = hasForbiddenKeyRecursive(item);
        if (hit) return hit;
      }
      return null;
    }
    for (const key of Object.keys(node)) {
      if (FORBIDDEN_OBJECT_KEYS.has(key)) return key;
      const hit = hasForbiddenKeyRecursive(node[key]);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Parses `rawText` fail-closed.
   * - `exists === false` -> empty valid document `{ mcpServers: {} }` with `sha256: null`.
   * - `exists === true` and whitespace-only -> fail-closed `MALFORMED_JSON` (never silently overwrites empty/corrupt file).
   */
  async function parseConfigDocument(rawText, exists = true, serversRootKey = 'mcpServers') {
    if (!exists) {
      return {
        ok: true,
        exists: false,
        sha256: null,
        eol: '\n',
        doc: { [serversRootKey]: {} },
        servers: {},
        rawText: '',
        parseError: null,
      };
    }

    const text = String(rawText ?? '');
    const sha256 = await sha256Hex(text);
    const eol = detectEol(text);

    if (!text.trim()) {
      return {
        ok: false,
        code: ERROR_CODES.MALFORMED_JSON,
        exists: true,
        sha256,
        eol,
        doc: null,
        servers: {},
        rawText: text,
        parseError: {
          message: 'Config file is empty (0 bytes) and cannot be parsed as JSON.',
          line: 1,
          column: 1,
        },
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const pos = extractSyntaxPosition(text, err?.message);
      return {
        ok: false,
        code: ERROR_CODES.MALFORMED_JSON,
        exists: true,
        sha256,
        eol,
        doc: null,
        servers: {},
        rawText: text,
        parseError: {
          message: err?.message || 'Invalid JSON',
          line: pos.line,
          column: pos.column,
        },
      };
    }

    if (!isPlainObject(parsed)) {
      return {
        ok: false,
        code: ERROR_CODES.MALFORMED_JSON,
        exists: true,
        sha256,
        eol,
        doc: null,
        servers: {},
        rawText: text,
        parseError: {
          message: 'Top-level JSON value must be an object.',
          line: 1,
          column: 1,
        },
      };
    }

    const forbidden = hasForbiddenKeyRecursive(parsed);
    if (forbidden) {
      return {
        ok: false,
        code: ERROR_CODES.VALIDATION_ERROR,
        exists: true,
        sha256,
        eol,
        doc: null,
        servers: {},
        rawText: text,
        parseError: {
          message: `Forbidden key "${forbidden}" detected in config JSON.`,
          line: null,
          column: null,
        },
      };
    }

    const serversObj = parsed[serversRootKey];
    if (serversObj !== undefined && !isPlainObject(serversObj)) {
      return {
        ok: false,
        code: ERROR_CODES.MALFORMED_JSON,
        exists: true,
        sha256,
        eol,
        doc: null,
        servers: {},
        rawText: text,
        parseError: {
          message: `"${serversRootKey}" must be a JSON object.`,
          line: null,
          column: null,
        },
      };
    }

    return {
      ok: true,
      exists: true,
      sha256,
      eol,
      doc: parsed,
      servers: serversObj || {},
      rawText: text,
      parseError: null,
    };
  }
  function serializeConfigDocument(doc, eol = '\n') {
    const json = `${JSON.stringify(doc, null, 2)}\n`;
    return eol === '\r\n' ? json.replace(/\n/g, '\r\n') : json;
  }

  /**
   * Losslessly merges updated known fields onto `existingSpec`, preserving unknown host/future keys.
   */
  function mergeServerSpecLossless(existingSpec, nextSpec) {
    const base = isPlainObject(existingSpec) ? { ...existingSpec } : {};
    const isNextStdio = nextSpec.command !== undefined;
    const isNextHttp = nextSpec.url !== undefined || nextSpec.serverUrl !== undefined;

    if (isNextStdio) {
      delete base.url;
      delete base.serverUrl;
      delete base.headers;
      base.command = nextSpec.command;
      if (Array.isArray(nextSpec.args) && nextSpec.args.length > 0) base.args = [...nextSpec.args];
      else delete base.args;
      if (isPlainObject(nextSpec.env) && Object.keys(nextSpec.env).length > 0) base.env = { ...nextSpec.env };
      else delete base.env;
    } else if (isNextHttp) {
      delete base.command;
      delete base.args;
      delete base.env;
      delete base.serverUrl;
      base.url = nextSpec.url !== undefined ? nextSpec.url : nextSpec.serverUrl;
      if (isPlainObject(nextSpec.headers) && Object.keys(nextSpec.headers).length > 0) {
        base.headers = { ...nextSpec.headers };
      } else {
        delete base.headers;
      }
    }

    if (typeof nextSpec.disabled === 'boolean') {
      if (nextSpec.disabled) base.disabled = true;
      else delete base.disabled;
    }

    if (Array.isArray(nextSpec.disabledTools)) {
      if (nextSpec.disabledTools.length > 0) base.disabledTools = [...nextSpec.disabledTools];
      else delete base.disabledTools;
    }

    return base;
  }
  function applyUpsertToDocument(parsedDoc, { name, originalName = null, spec }, serversRootKey = 'mcpServers') {
    const nextDoc = { ...parsedDoc.doc };
    const prevServers = isPlainObject(parsedDoc.doc[serversRootKey]) ? parsedDoc.doc[serversRootKey] : {};
    const nextServers = {};
    const targetLookup = originalName || name;
    const existingSpec = Object.prototype.hasOwnProperty.call(prevServers, targetLookup)
      ? prevServers[targetLookup]
      : null;
    const merged = mergeServerSpecLossless(existingSpec, spec);

    let inserted = false;
    for (const [k, v] of Object.entries(prevServers)) {
      if (originalName && k === originalName) {
        nextServers[name] = merged;
        inserted = true;
      } else if (!originalName && k === name) {
        nextServers[name] = merged;
        inserted = true;
      } else {
        nextServers[k] = v;
      }
    }
    if (!inserted) {
      nextServers[name] = merged;
    }

    nextDoc[serversRootKey] = nextServers;
    return serializeConfigDocument(nextDoc, parsedDoc.eol);
  }
  function applyToggleDisabledToDocument(parsedDoc, name, disabled, serversRootKey = 'mcpServers') {
    const prevServers = isPlainObject(parsedDoc.doc[serversRootKey]) ? parsedDoc.doc[serversRootKey] : {};
    if (!Object.prototype.hasOwnProperty.call(prevServers, name)) {
      return null;
    }
    const nextDoc = { ...parsedDoc.doc };
    const nextServers = { ...prevServers };
    const updated = { ...prevServers[name] };
    if (disabled) updated.disabled = true;
    else delete updated.disabled;
    nextServers[name] = updated;
    nextDoc[serversRootKey] = nextServers;
    return serializeConfigDocument(nextDoc, parsedDoc.eol);
  }
  function applyDeleteFromDocument(parsedDoc, name, serversRootKey = 'mcpServers') {
    const prevServers = isPlainObject(parsedDoc.doc[serversRootKey]) ? parsedDoc.doc[serversRootKey] : {};
    if (!Object.prototype.hasOwnProperty.call(prevServers, name)) {
      return null;
    }
    const nextDoc = { ...parsedDoc.doc };
    const nextServers = {};
    for (const [k, v] of Object.entries(prevServers)) {
      if (k !== name) nextServers[k] = v;
    }
    nextDoc[serversRootKey] = nextServers;
    return serializeConfigDocument(nextDoc, parsedDoc.eol);
  }

  // --- module: core/input-parser.mjs ---
  /**
   * Declarative Smart Paste Parser (`src/core/input-parser.mjs`).
   *
   * Parses ONLY declarative JSON snippets (`mcpServers` map, single named entry, or raw spec)
   * and absolute http(s) URLs. Explicitly rejects raw shell command strings (`npx ...`, `curl ...`)
   * in v1 per security invariants. Normalizes `serverUrl` -> `url` and surfaces an editable
   * `mcp-remote` preview when a legacy `/sse` endpoint is detected.
   */
  function deriveNameFromUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      const hostPart = u.hostname.replace(/^www\./i, '').split('.')[0] || 'remote-mcp';
      const clean = hostPart.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '');
      return clean ? clean.slice(0, 48) : 'remote-mcp';
    } catch {
      return 'remote-mcp';
    }
  }

  function normalizeParsedSpec(rawSpec) {
    const spec = { ...rawSpec };
    if (spec.serverUrl !== undefined && spec.url === undefined) {
      spec.url = spec.serverUrl;
      delete spec.serverUrl;
    }
    return spec;
  }

  function buildEntryPreview(name, rawSpec) {
    const normalized = normalizeParsedSpec(rawSpec);
    const nameCheck = validateServerName(name);
    const specCheck = validateServerSpec(normalized);
    const legacySseDetected = specCheck.transport === TRANSPORT_KINDS.LEGACY_SSE;
    const mcpRemotePreview = legacySseDetected
      ? {
          command: 'npx',
          args: ['-y', 'mcp-remote', String(normalized.url || '').trim()],
        }
      : null;

    return {
      name,
      spec: normalized,
      transport: specCheck.transport,
      legacySseDetected,
      mcpRemotePreview,
      requiresStdioConfirmation: specCheck.requiresStdioConfirmation,
      valid: nameCheck.ok && specCheck.ok,
      errors: [...nameCheck.errors, ...specCheck.errors],
      warnings: [...specCheck.warnings],
    };
  }
  function parseDeclarativeInput(rawInput) {
    const text = String(rawInput ?? '').trim();
    if (!text) {
      return { ok: false, entries: [], errors: ['Paste a JSON configuration or an https:// MCP URL.'], warnings: [] };
    }

    // 1. Direct HTTP(S) URL
    if (/^https?:\/\/\S+$/i.test(text)) {
      const name = deriveNameFromUrl(text);
      const entry = buildEntryPreview(name, { url: text });
      return {
        ok: entry.valid,
        sourceKind: 'url',
        entries: [entry],
        errors: entry.errors,
        warnings: entry.warnings,
      };
    }

    // 2. Reject raw shell strings explicitly (v1 security boundary)
    if (!text.startsWith('{') && !text.startsWith('[')) {
      return {
        ok: false,
        sourceKind: 'rejected_shell',
        entries: [],
        errors: [
          'Raw shell commands (e.g. npx/uvx/curl) are not parsed automatically. Paste a JSON mcpServers snippet, an https:// URL, or fill the structured Stdio form (command + args).',
        ],
        warnings: [],
      };
    }

    // 3. Structured JSON snippet
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return {
        ok: false,
        sourceKind: 'invalid_json',
        entries: [],
        errors: [`Invalid JSON: ${err?.message || String(err)}`],
        warnings: [],
      };
    }

    if (!isPlainObject(parsed)) {
      return {
        ok: false,
        sourceKind: 'invalid_json',
        entries: [],
        errors: ['JSON input must be an object.'],
        warnings: [],
      };
    }

    // Case A: { "mcpServers": { "name": { ... } } }
    if (isPlainObject(parsed.mcpServers)) {
      const entries = [];
      for (const [k, v] of Object.entries(parsed.mcpServers)) {
        if (FORBIDDEN_OBJECT_KEYS.has(k)) {
          return { ok: false, sourceKind: 'json_map', entries: [], errors: [`Forbidden server key "${k}".`], warnings: [] };
        }
        entries.push(buildEntryPreview(k, v));
      }
      if (entries.length === 0) {
        return { ok: false, sourceKind: 'json_map', entries: [], errors: ['"mcpServers" object is empty.'], warnings: [] };
      }
      const allErrors = entries.flatMap((e) => e.errors.map((m) => `[${e.name}] ${m}`));
      const allWarnings = entries.flatMap((e) => e.warnings.map((m) => `[${e.name}] ${m}`));
      return {
        ok: entries.every((e) => e.valid),
        sourceKind: 'json_map',
        entries,
        errors: allErrors,
        warnings: allWarnings,
      };
    }

    // Case B: Raw single server spec { "command": ... } or { "url": ... } or { "serverUrl": ... }
    if (parsed.command !== undefined || parsed.url !== undefined || parsed.serverUrl !== undefined) {
      const suggestedName =
        typeof parsed.url === 'string'
          ? deriveNameFromUrl(parsed.url)
          : typeof parsed.serverUrl === 'string'
            ? deriveNameFromUrl(parsed.serverUrl)
            : 'custom-mcp';
      const entry = buildEntryPreview(suggestedName, parsed);
      return {
        ok: entry.valid,
        sourceKind: 'json_spec',
        entries: [entry],
        errors: entry.errors,
        warnings: entry.warnings,
      };
    }

    // Case C: Named entry map { "my-server": { "url": ... } }
    const keys = Object.keys(parsed);
    if (keys.length > 0 && keys.every((k) => !FORBIDDEN_OBJECT_KEYS.has(k) && isPlainObject(parsed[k]))) {
      const entries = keys.map((k) => buildEntryPreview(k, parsed[k]));
      const allErrors = entries.flatMap((e) => e.errors.map((m) => `[${e.name}] ${m}`));
      const allWarnings = entries.flatMap((e) => e.warnings.map((m) => `[${e.name}] ${m}`));
      return {
        ok: entries.every((e) => e.valid),
        sourceKind: 'json_named',
        entries,
        errors: allErrors,
        warnings: allWarnings,
      };
    }

    return {
      ok: false,
      sourceKind: 'unknown_json',
      entries: [],
      errors: ['Unrecognized JSON shape. Expected { "mcpServers": { ... } }, a named server map, or a server spec with "command"/"url".'],
      warnings: [],
    };
  }

  // --- module: core/manager-service.mjs ---
  /**
   * Vendor-Independent MCP Manager Use-Case Service (`src/core/manager-service.mjs`).
   *
   * Coordinates `ConfigStorePort`, `ConfigDialectPort`, and optional `RuntimeInspectorPort`.
   * Enforces fail-closed JSON handling, SHA-256 CAS, lossless updates, secret masking/preservation,
   * Stdio confirmation gates, read-only plugin visibility, and 1-time legacy import preview.
   */
  function restoreMaskedUrlQuery(existingUrl, incomingUrl) {
    if (typeof existingUrl !== 'string' || typeof incomingUrl !== 'string') return incomingUrl;
    try {
      const prev = new URL(existingUrl.trim());
      const next = new URL(incomingUrl.trim());
      if (prev.origin === next.origin && prev.pathname === next.pathname) {
        let changed = false;
        for (const [k, v] of next.searchParams.entries()) {
          if (v === 'REDACTED' && prev.searchParams.has(k)) {
            next.searchParams.set(k, prev.searchParams.get(k));
            changed = true;
          }
        }
        if (changed) return next.href;
      }
    } catch {
      // Keep incomingUrl as-is if non-URL
    }
    return incomingUrl;
  }

  function restoreMaskedSecrets(existingSpec, incomingSpec) {
    if (!isPlainObject(existingSpec) || !isPlainObject(incomingSpec)) return incomingSpec;
    const out = { ...incomingSpec };
    const prevUrl = typeof existingSpec.url === 'string' ? existingSpec.url : existingSpec.serverUrl;
    if (typeof out.url === 'string' && prevUrl) {
      out.url = restoreMaskedUrlQuery(prevUrl, out.url);
    }
    if (typeof out.serverUrl === 'string' && prevUrl) {
      out.serverUrl = restoreMaskedUrlQuery(prevUrl, out.serverUrl);
    }
    for (const mapKey of ['env', 'headers']) {
      if (isPlainObject(out[mapKey]) && isPlainObject(existingSpec[mapKey])) {
        const mergedMap = { ...out[mapKey] };
        for (const [k, v] of Object.entries(mergedMap)) {
          if (v === REDACTED_MASK && typeof existingSpec[mapKey][k] === 'string') {
            mergedMap[k] = existingSpec[mapKey][k];
          }
        }
        out[mapKey] = mergedMap;
      }
    }
    return out;
  }

  function resolveAuthoritativeSha256(readRes, fallbackSha256) {
    if (!readRes?.exists) return null;
    if (typeof readRes.sha256 === 'string' && readRes.sha256.trim()) {
      return readRes.sha256.trim();
    }
    return fallbackSha256 ?? null;
  }
  class McpManagerService {
    constructor({ configStore, dialect = DEFAULT_GENERIC_DIALECT, runtimeInspector = null }) {
      assertConfigStorePort(configStore);
      this.configStore = configStore;
      this.dialect = { ...DEFAULT_GENERIC_DIALECT, ...dialect };
      this.runtimeInspector = runtimeInspector;
    }

    async getSnapshot({ workspaceUris = [], includeRawText = false } = {}) {
      const globalRead = await this.configStore.readGlobalConfig();
      const parsedGlobal = await parseConfigDocument(globalRead.rawText, globalRead.exists, this.dialect.serversRootKey);

      const runtime = this.runtimeInspector
        ? await this.runtimeInspector.inspectRuntime(workspaceUris).catch(() => ({
            available: false,
            servers: {},
            plugins: [],
          }))
        : { available: false, servers: {}, plugins: [] };

      const pluginReads = this.configStore.readPluginConfigs
        ? await this.configStore.readPluginConfigs({ workspaceUris }).catch(() => [])
        : [];

      const normalizePathForMatch = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      const runtimePluginsList = Array.isArray(runtime.plugins) ? runtime.plugins : [];
      const runtimePluginsById = new Map();
      const runtimeGlobalPluginsByDir = new Map();
      const runtimeWorkspacePluginsByDir = new Map();
      for (const rp of runtimePluginsList) {
        if (rp?.pluginId) runtimePluginsById.set(rp.pluginId, rp);
        if (rp?.dir) {
          const rpScope =
            rp.scope || (typeof rp.isGlobal === 'boolean' ? (rp.isGlobal ? 'global' : 'workspace') : 'global');
          if (rpScope === 'global') {
            runtimeGlobalPluginsByDir.set(rp.dir, rp);
          } else if (rpScope === 'workspace') {
            runtimeWorkspacePluginsByDir.set(rp.dir, rp);
          }
        }
      }

      const pluginServers = [];
      for (const pFile of pluginReads) {
        const pParsed = await parseConfigDocument(pFile.rawText, true, this.dialect.serversRootKey);
        if (!pParsed.ok) continue;
        const pluginScope = pFile.pluginScope || 'global';
        const pluginId = pFile.pluginId || `${pluginScope}:${pFile.pluginDir}`;
        const normDisplayPath = normalizePathForMatch(pFile.displayPath);
        const pathMatchedPlugin = normDisplayPath
          ? runtimePluginsList.find((rp) => {
              const normRpPath = normalizePathForMatch(rp?.path);
              return normRpPath && (normDisplayPath === normRpPath || normDisplayPath.startsWith(`${normRpPath}/`));
            }) || null
          : null;
        const livePlugin =
          runtimePluginsById.get(pluginId) ||
          pathMatchedPlugin ||
          (pluginScope === 'global'
            ? runtimeGlobalPluginsByDir.get(pFile.pluginDir)
            : runtimeWorkspacePluginsByDir.get(pFile.pluginDir)) ||
          null;
        for (const [sName, sSpec] of Object.entries(pParsed.servers)) {
          const val = validateServerSpec(sSpec);
          const rt = runtime.servers && Object.hasOwn(runtime.servers, sName) ? runtime.servers[sName] : null;
          pluginServers.push({
            name: sName,
            pluginId,
            pluginScope,
            pluginName: pFile.pluginName,
            pluginDir: pFile.pluginDir,
            pluginDisabled: livePlugin ? Boolean(livePlugin.disabled) : false,
            displayPath: pFile.displayPath,
            transport: val.transport,
            disabled: Boolean(sSpec?.disabled),
            spec: redactServerSpec(sSpec),
            runtime: rt,
            readOnly: true,
          });
        }
      }

      const legacyRead = this.configStore.readLegacyConfig
        ? await this.configStore.readLegacyConfig().catch(() => ({ exists: false, rawText: '', displayPath: '' }))
        : { exists: false, rawText: '', displayPath: '' };

      const legacyServers = [];
      if (legacyRead.exists) {
        const lParsed = await parseConfigDocument(legacyRead.rawText, true, this.dialect.serversRootKey);
        if (lParsed.ok) {
          for (const [sName, sSpec] of Object.entries(lParsed.servers)) {
            const val = validateServerSpec(sSpec);
            legacyServers.push({
              name: sName,
              transport: val.transport,
              spec: redactServerSpec(sSpec),
              valid: val.ok,
              warnings: val.warnings,
            });
          }
        }
      }

      const globalServers = [];
      if (parsedGlobal.ok) {
        for (const [sName, sSpec] of Object.entries(parsedGlobal.servers)) {
          const val = validateServerSpec(sSpec);
          const rt = runtime.servers && Object.hasOwn(runtime.servers, sName) ? runtime.servers[sName] : null;
          globalServers.push({
            name: sName,
            transport: val.transport,
            disabled: Boolean(sSpec?.disabled),
            spec: redactServerSpec(sSpec),
            validation: {
              ok: val.ok,
              errors: val.errors,
              warnings: val.warnings,
            },
            runtime: rt,
          });
        }
      }

      const collisions = detectCollisions(
        globalServers.map((s) => s.name),
        pluginServers
      );

      return {
        ok: true,
        globalConfig: {
          exists: globalRead.exists,
          displayPath: globalRead.displayPath,
          sha256: resolveAuthoritativeSha256(globalRead, parsedGlobal.sha256),
          malformed: !parsedGlobal.ok,
          parseError: parsedGlobal.parseError,
          servers: globalServers,
          rawText: includeRawText || !parsedGlobal.ok ? globalRead.rawText : undefined,
        },
        pluginServers,
        legacyImport: {
          exists: legacyRead.exists && legacyServers.length > 0,
          displayPath: legacyRead.displayPath,
          servers: legacyServers,
        },
        collisions,
        runtimeAvailable: Boolean(runtime.available),
        runtimePlugins: Array.isArray(runtime.plugins) ? runtime.plugins : [],
        capabilities: {
          supportsNativeDisabled: Boolean(this.dialect.supportsNativeDisabled),
        },
      };
    }

    previewSmartPaste(rawInput) {
      return parseDeclarativeInput(rawInput);
    }

    async upsertServer({ name, originalName = null, spec, expectedSha256, confirmStdio = false }) {
      if (expectedSha256 === undefined) {
        return { ok: false, code: ERROR_CODES.VALIDATION_ERROR, errors: ['expectedSha256 is required for CAS-protected saves (pass null only when creating a new file).'] };
      }
      const nameCheck = validateServerName(name);
      if (!nameCheck.ok) {
        return { ok: false, code: ERROR_CODES.VALIDATION_ERROR, errors: nameCheck.errors };
      }

      const readRes = await this.configStore.readGlobalConfig();
      const parsed = await parseConfigDocument(readRes.rawText, readRes.exists, this.dialect.serversRootKey);
      if (!parsed.ok) {
        return {
          ok: false,
          code: ERROR_CODES.MALFORMED_JSON,
          errors: [parsed.parseError?.message || 'Config file contains invalid JSON; repair in Raw JSON mode first.'],
        };
      }

      const currentSha256 = resolveAuthoritativeSha256(readRes, parsed.sha256);
      if (currentSha256 !== expectedSha256) {
        return {
          ok: false,
          code: ERROR_CODES.CONFLICT,
          errors: ['Config file changed on disk since last load. Reload and review before saving.'],
          actualSha256: currentSha256,
        };
      }

      const existingNames = Object.keys(parsed.servers);
      // When originalName is null (create/clone/import), forbid overwriting ANY existing exact or case-insensitive server!
      const conflict = findCaseInsensitiveConflict(existingNames, name, originalName);
      if (conflict) {
        return {
          ok: false,
          code: ERROR_CODES.COLLISION,
          errors: [`Server name "${name}" conflicts with existing server "${conflict}".`],
        };
      }

      const existingSpec = originalName ? parsed.servers[originalName] || null : null;
      const unmaskedSpec = restoreMaskedSecrets(existingSpec, spec);
      const specCheck = validateServerSpec(unmaskedSpec);
      if (!specCheck.ok) {
        return { ok: false, code: ERROR_CODES.VALIDATION_ERROR, errors: specCheck.errors, warnings: specCheck.warnings };
      }

      if (specCheck.requiresStdioConfirmation && !confirmStdio) {
        return {
          ok: false,
          code: ERROR_CODES.CONFIRMATION_REQUIRED,
          errors: ['Explicit confirmation is required before saving a local Stdio command server.'],
          warnings: specCheck.warnings,
          confirmationPreview: {
            name,
            command: unmaskedSpec.command,
            args: unmaskedSpec.args || [],
            envKeys: isPlainObject(unmaskedSpec.env) ? Object.keys(unmaskedSpec.env) : [],
          },
        };
      }

      const nextRaw = applyUpsertToDocument(parsed, { name, originalName, spec: unmaskedSpec }, this.dialect.serversRootKey);
      const writeRes = await this.configStore.writeGlobalConfig({
        rawText: nextRaw,
        expectedSha256: currentSha256,
      });
      if (!writeRes.ok) {
        return {
          ok: false,
          code: writeRes.code || ERROR_CODES.IO_ERROR,
          errors: [redactErrorMessage(writeRes.error || 'Failed to write mcp_config.json')],
          actualSha256: writeRes.actualSha256 ?? null,
        };
      }

      return { ok: true, sha256: writeRes.sha256, warnings: specCheck.warnings };
    }

    async toggleServerDisabled({ name, disabled, expectedSha256 }) {
      if (expectedSha256 === undefined) {
        return { ok: false, code: ERROR_CODES.VALIDATION_ERROR, errors: ['expectedSha256 is required for CAS-protected toggle.'] };
      }
      if (!this.dialect.supportsNativeDisabled) {
        return { ok: false, code: ERROR_CODES.VALIDATION_ERROR, errors: ['Native disabled toggle is not supported by this host dialect.'] };
      }
      const readRes = await this.configStore.readGlobalConfig();
      const parsed = await parseConfigDocument(readRes.rawText, readRes.exists, this.dialect.serversRootKey);
      if (!parsed.ok) {
        return { ok: false, code: ERROR_CODES.MALFORMED_JSON, errors: [parsed.parseError?.message || 'Malformed JSON'] };
      }
      const currentSha256 = resolveAuthoritativeSha256(readRes, parsed.sha256);
      if (currentSha256 !== expectedSha256) {
        return { ok: false, code: ERROR_CODES.CONFLICT, errors: ['Config changed on disk. Reload first.'], actualSha256: currentSha256 };
      }

      const nextRaw = applyToggleDisabledToDocument(parsed, name, Boolean(disabled), this.dialect.serversRootKey);
      if (nextRaw === null) {
        return { ok: false, code: ERROR_CODES.NOT_FOUND, errors: [`Server "${name}" not found.`] };
      }
      const writeRes = await this.configStore.writeGlobalConfig({
        rawText: nextRaw,
        expectedSha256: currentSha256,
      });
      if (!writeRes.ok) {
        return {
          ok: false,
          code: writeRes.code || ERROR_CODES.IO_ERROR,
          errors: [redactErrorMessage(writeRes.error || 'Failed to toggle server')],
          actualSha256: writeRes.actualSha256 ?? null,
        };
      }
      return { ok: true, sha256: writeRes.sha256 };
    }

    async deleteServer({ name, expectedSha256 }) {
      if (expectedSha256 === undefined) {
        return { ok: false, code: ERROR_CODES.VALIDATION_ERROR, errors: ['expectedSha256 is required for CAS-protected delete.'] };
      }
      const readRes = await this.configStore.readGlobalConfig();
      const parsed = await parseConfigDocument(readRes.rawText, readRes.exists, this.dialect.serversRootKey);
      if (!parsed.ok) {
        return { ok: false, code: ERROR_CODES.MALFORMED_JSON, errors: [parsed.parseError?.message || 'Malformed JSON'] };
      }
      const currentSha256 = resolveAuthoritativeSha256(readRes, parsed.sha256);
      if (currentSha256 !== expectedSha256) {
        return { ok: false, code: ERROR_CODES.CONFLICT, errors: ['Config changed on disk. Reload first.'], actualSha256: currentSha256 };
      }

      const nextRaw = applyDeleteFromDocument(parsed, name, this.dialect.serversRootKey);
      if (nextRaw === null) {
        return { ok: false, code: ERROR_CODES.NOT_FOUND, errors: [`Server "${name}" not found.`] };
      }
      const writeRes = await this.configStore.writeGlobalConfig({
        rawText: nextRaw,
        expectedSha256: currentSha256,
      });
      if (!writeRes.ok) {
        return {
          ok: false,
          code: writeRes.code || ERROR_CODES.IO_ERROR,
          errors: [redactErrorMessage(writeRes.error || 'Failed to delete server')],
          actualSha256: writeRes.actualSha256 ?? null,
        };
      }
      return { ok: true, sha256: writeRes.sha256 };
    }

    async clonePluginServer({ pluginId = null, pluginDir = null, serverName, targetName = null, workspaceUris = [], expectedSha256, confirmStdio = false }) {
      const pluginReads = this.configStore.readPluginConfigs
        ? await this.configStore.readPluginConfigs({ workspaceUris })
        : [];
      const targetPlugin = pluginId
        ? pluginReads.find((p) => (p.pluginId || `${p.pluginScope || 'global'}:${p.pluginDir}`) === pluginId)
        : pluginReads.find((p) => p.pluginDir === pluginDir);
      if (!targetPlugin) {
        return { ok: false, code: ERROR_CODES.NOT_FOUND, errors: [`Plugin "${pluginId || pluginDir}" not found.`] };
      }
      const pParsed = await parseConfigDocument(targetPlugin.rawText, true, this.dialect.serversRootKey);
      if (!pParsed.ok || !Object.prototype.hasOwnProperty.call(pParsed.servers, serverName)) {
        return { ok: false, code: ERROR_CODES.NOT_FOUND, errors: [`Server "${serverName}" not found in plugin "${pluginId || pluginDir}".`] };
      }
      return this.upsertServer({
        name: targetName || serverName,
        spec: pParsed.servers[serverName],
        expectedSha256,
        confirmStdio,
      });
    }

    async importLegacyServer({ serverName, targetName = null, expectedSha256, confirmStdio = false }) {
      const legacyRead = this.configStore.readLegacyConfig
        ? await this.configStore.readLegacyConfig()
        : { exists: false, rawText: '' };
      if (!legacyRead.exists) {
        return { ok: false, code: ERROR_CODES.NOT_FOUND, errors: ['Legacy config file does not exist.'] };
      }
      const lParsed = await parseConfigDocument(legacyRead.rawText, true, this.dialect.serversRootKey);
      if (!lParsed.ok || !Object.prototype.hasOwnProperty.call(lParsed.servers, serverName)) {
        return { ok: false, code: ERROR_CODES.NOT_FOUND, errors: [`Server "${serverName}" not found in legacy config.`] };
      }
      return this.upsertServer({
        name: targetName || serverName,
        spec: lParsed.servers[serverName],
        expectedSha256,
        confirmStdio,
      });
    }

    async saveRawJson({ rawText, expectedSha256, confirmStdio = false }) {
      if (expectedSha256 === undefined) {
        return { ok: false, code: ERROR_CODES.VALIDATION_ERROR, errors: ['expectedSha256 is required for CAS-protected raw save.'] };
      }
      const parsedNext = await parseConfigDocument(rawText, true, this.dialect.serversRootKey);
      if (!parsedNext.ok) {
        return {
          ok: false,
          code: parsedNext.code || ERROR_CODES.MALFORMED_JSON,
          errors: [parsedNext.parseError?.message || 'Raw JSON is invalid.'],
        };
      }

      const errors = [];
      let hasStdio = false;
      const seenLower = new Set();
      for (const [sName, sSpec] of Object.entries(parsedNext.servers)) {
        const nc = validateServerName(sName);
        if (!nc.ok) errors.push(...nc.errors.map((e) => `[${sName}] ${e}`));
        const lower = sName.toLowerCase();
        if (seenLower.has(lower)) errors.push(`Duplicate server name "${sName}" (case-insensitive).`);
        seenLower.add(lower);
        const sc = validateServerSpec(sSpec);
        if (!sc.ok) errors.push(...sc.errors.map((e) => `[${sName}] ${e}`));
        if (sc.requiresStdioConfirmation) hasStdio = true;
      }
      if (errors.length > 0) {
        return { ok: false, code: ERROR_CODES.VALIDATION_ERROR, errors };
      }

      const currentRead = await this.configStore.readGlobalConfig();
      const fallbackSha256 = currentRead.exists ? await sha256Hex(currentRead.rawText) : null;
      const currentSha256 = resolveAuthoritativeSha256(currentRead, fallbackSha256);
      if (currentSha256 !== expectedSha256) {
        return {
          ok: false,
          code: ERROR_CODES.CONFLICT,
          errors: ['Config changed on disk since last load. Reload before retrying.'],
          actualSha256: currentSha256,
        };
      }

      if (hasStdio && !confirmStdio) {
        return {
          ok: false,
          code: ERROR_CODES.CONFIRMATION_REQUIRED,
          errors: ['Raw JSON contains Stdio command server(s); explicit confirmation is required before saving.'],
        };
      }

      const normalizedRaw = serializeConfigDocument(parsedNext.doc, parsedNext.eol);
      const writeRes = await this.configStore.writeGlobalConfig({
        rawText: normalizedRaw,
        expectedSha256: currentSha256,
      });
      if (!writeRes.ok) {
        return {
          ok: false,
          code: writeRes.code || ERROR_CODES.IO_ERROR,
          errors: [redactErrorMessage(writeRes.error || 'Failed to save raw JSON')],
          actualSha256: writeRes.actualSha256 ?? null,
        };
      }
      return { ok: true, sha256: writeRes.sha256 };
    }

    async restoreBackup({ expectedSha256 } = {}) {
      if (expectedSha256 === undefined) {
        return { ok: false, code: ERROR_CODES.VALIDATION_ERROR, errors: ['expectedSha256 is required for CAS-protected backup restore.'] };
      }
      if (typeof this.configStore.restoreLastBackup !== 'function') {
        return { ok: false, code: ERROR_CODES.IO_ERROR, errors: ['Backup restore is not supported by this config store.'] };
      }
      const res = await this.configStore.restoreLastBackup({ expectedSha256 });
      if (!res.ok) {
        return { ok: false, code: res.code || ERROR_CODES.IO_ERROR, errors: [res.error || 'No backup available to restore.'], actualSha256: res.actualSha256 ?? null };
      }
      return { ok: true, sha256: res.sha256 };
    }
  }

  // --- module: host-config-store.mjs ---
  /**
   * Host Named-Scope Config Bridge Store Adapter (`src/adapters/antigravity/renderer/host-config-store.mjs`).
   *
   * SOLID Boundaries:
   * - SRP: Translates Extenra (`extenra`, v3.1.0+/v3.2.1) `AddonContextV3` Named-Scope Config Bridge
   *   (`ctx.env.capabilities.hasConfigBridge`, `ctx.configBridge.scopes`, `ctx.configBridge.read`,
   *   `ctx.configBridge.write`) into the vendor-independent `ConfigStorePort` contract consumed by
   *   `src/core/manager-service.mjs`.
   * - DIP: `McpManagerService` and `native-mcp-panel.mjs` depend solely on `ConfigStorePort`,
   *   never directly on Electron IPC or host-specific bridge methods.
   */
  const HOST_CONFIG_SCOPES = Object.freeze({
    GLOBAL_MCP: 'antigravity:mcp-config',
    PLUGIN_MCP: 'antigravity:plugin-mcp-configs',
    LEGACY_MCP: 'antigravity:mcp-config-legacy',
  });
  const REMOTE_HOST_NOT_CONNECTED_CODE = 'ERR_REMOTE_HOST_NOT_CONNECTED';

  const REMOTE_BRIDGE_DISCONNECTED_REASONS = Object.freeze([
    'ERR_REMOTE_HOST_NOT_CONNECTED',
    'ERR_REMOTE_CONFIG_BRIDGE_OFFLINE',
    'ERR_REMOTE_CONFIG_BRIDGE_READ_ONLY',
    'ERR_REMOTE_TRANSPORT_UNAVAILABLE',
  ]);
  function isRemoteBridgeDisconnectedReason(reasonOrError) {
    if (!reasonOrError) return false;
    const code = typeof reasonOrError === 'object' ? String(reasonOrError.code || '') : '';
    const msg = typeof reasonOrError === 'object' ? String(reasonOrError.message || reasonOrError.reason || '') : String(reasonOrError);
    const haystack = `${code} ${msg}`;
    return REMOTE_BRIDGE_DISCONNECTED_REASONS.some((token) => haystack.includes(token));
  }

  function createRemoteDisconnectedError(rawReason) {
    const err = new Error(String(rawReason || REMOTE_HOST_NOT_CONNECTED_CODE));
    err.code = REMOTE_HOST_NOT_CONNECTED_CODE;
    return err;
  }

  const DEFAULT_DISPLAY_PATHS = Object.freeze({
    [HOST_CONFIG_SCOPES.GLOBAL_MCP]: '~/.gemini/config/mcp_config.json',
    [HOST_CONFIG_SCOPES.LEGACY_MCP]: '~/.gemini/antigravity/mcp_config.json',
  });

  function resolveSnapshotRawText(res) {
    if (typeof res?.rawText === 'string') return res.rawText;
    if (res?.status === 'ok' && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
      return `${JSON.stringify(res.data, null, 2)}\n`;
    }
    return null;
  }

  function hasDeclaredScope(configBridge, scopeId, requiredAccess = null) {
    if (!Array.isArray(configBridge?.scopes)) return true;
    const entry = configBridge.scopes.find((s) => s && s.scopeId === scopeId);
    if (!entry) return false;
    if (requiredAccess === 'rw') return entry.access === 'rw';
    if (requiredAccess === 'ro') return entry.access === 'ro' || entry.access === 'rw';
    return true;
  }

  function mapHostBridgeReasonToErrorCode(reason) {
    const code = String(reason || '').trim();
    if (!code) return ERROR_CODES.IO_ERROR;
    if (isRemoteBridgeDisconnectedReason(code)) {
      return REMOTE_HOST_NOT_CONNECTED_CODE;
    }
    if (code === 'ERR_CONFIG_CAS_CONFLICT' || code === ERROR_CODES.CONFLICT) {
      return ERROR_CODES.CONFLICT;
    }
    if (code === 'ERR_CONFIG_LOCK_BUSY' || code === ERROR_CODES.LOCK_BUSY) {
      return ERROR_CODES.LOCK_BUSY;
    }
    if (
      code === 'ERR_CONFIG_INVALID_JSON' ||
      code === 'ERR_CONFIG_MUST_BE_OBJECT' ||
      code === 'ERR_CONFIG_UNSAFE_PROTO_KEY' ||
      code === 'ERR_CONFIG_FILE_TOO_LARGE' ||
      code === 'ERR_INVALID_EXPECTED_SHA256' ||
      code === 'ERR_INVALID_CONFIG_SCOPE_ID'
    ) {
      return ERROR_CODES.VALIDATION_ERROR;
    }
    if (
      code === 'ERR_CONFIG_SYMLINK_FORBIDDEN' ||
      code === 'ERR_CONFIG_ANCESTOR_SYMLINK_FORBIDDEN' ||
      code === 'ERR_CONFIG_BACKUP_SYMLINK_FORBIDDEN' ||
      code === 'ERR_CONFIG_RESERVED_PATH' ||
      code === 'ERR_CONFIG_SCOPE_READ_ONLY' ||
      code.startsWith('ERR_CONFIG_SCOPE_READ_ONLY:')
    ) {
      return ERROR_CODES.WRITE_JAIL_VIOLATION;
    }
    return code;
  }
  function resolveHostConfigBridge(ctx) {
    if (!ctx || typeof ctx !== 'object') return null;
    if (ctx.env?.capabilities?.hasConfigBridge !== true) return null;
    const bridge = ctx.configBridge;
    if (!bridge || typeof bridge !== 'object') return null;
    if (typeof bridge.read !== 'function' || typeof bridge.write !== 'function') {
      return null;
    }
    if (!hasDeclaredScope(bridge, HOST_CONFIG_SCOPES.GLOBAL_MCP, 'rw')) {
      return null;
    }
    return bridge;
  }
  function createHostBridgeConfigStore(ctx) {
    const bridge = resolveHostConfigBridge(ctx);
    if (!bridge) {
      throw new TypeError(
        'Host Config Bridge requires ctx.env.capabilities.hasConfigBridge === true, ctx.configBridge.read/write(), and rw access to antigravity:mcp-config'
      );
    }

    async function readGlobalConfig() {
      const res = await bridge.read(HOST_CONFIG_SCOPES.GLOBAL_MCP);
      if (!res || typeof res !== 'object') {
        throw new Error('Host Config Bridge returned an invalid response for global MCP config.');
      }
      if (res.status === 'missing') {
        return {
          exists: false,
          rawText: '',
          sha256: null,
          displayPath: DEFAULT_DISPLAY_PATHS[HOST_CONFIG_SCOPES.GLOBAL_MCP],
        };
      }
      if (res.status === 'unavailable' || isRemoteBridgeDisconnectedReason(res.reason)) {
        throw createRemoteDisconnectedError(res.reason);
      }
      if (res.ok === false || res.status === 'error') {
        throw new Error(String(res.reason || 'ERR_CONFIG_READ_FAILED'));
      }
      const displayPath = DEFAULT_DISPLAY_PATHS[HOST_CONFIG_SCOPES.GLOBAL_MCP];
      const rawText = resolveSnapshotRawText(res);
      if (rawText === null) {
        throw new Error(String(res.reason || 'ERR_CONFIG_EMPTY_PAYLOAD'));
      }
      return {
        exists: true,
        rawText,
        sha256: typeof res.sha256 === 'string' && res.sha256.trim() ? res.sha256.trim() : null,
        displayPath,
      };
    }

    async function writeGlobalConfig({ rawText, expectedSha256 }) {
      try {
        const res = await bridge.write(
          HOST_CONFIG_SCOPES.GLOBAL_MCP,
          String(rawText ?? ''),
          { expectedSha256: expectedSha256 ?? null }
        );
        if (!res || typeof res !== 'object') {
          return {
            ok: false,
            code: ERROR_CODES.IO_ERROR,
            error: 'Host Config Bridge returned an invalid write response.',
            actualSha256: null,
          };
        }
        if (!res.ok) {
          return {
            ok: false,
            code: mapHostBridgeReasonToErrorCode(res.reason),
            error: String(res.reason || 'Failed to write mcp_config.json via Host Config Bridge.'),
            actualSha256: typeof res.currentSha256 === 'string' ? res.currentSha256 : null,
          };
        }
        return {
          ok: true,
          sha256: typeof res.currentSha256 === 'string' ? res.currentSha256 : null,
          backupFileName: typeof res.backupFileName === 'string' ? res.backupFileName : null,
        };
      } catch (err) {
        const rawReason = String(err?.code || err?.message || '').trim();
        return {
          ok: false,
          code: mapHostBridgeReasonToErrorCode(rawReason),
          error: rawReason || 'Host Config Bridge write failed.',
          actualSha256: null,
        };
      }
    }

    async function readPluginConfigs() {
      if (!hasDeclaredScope(bridge, HOST_CONFIG_SCOPES.PLUGIN_MCP, 'ro')) {
        return [];
      }
      const res = await bridge.read(HOST_CONFIG_SCOPES.PLUGIN_MCP);
      if (!res || typeof res !== 'object') {
        throw new Error('Host Config Bridge returned an invalid response for plugin MCP configs.');
      }
      if (res.status === 'missing') {
        return [];
      }
      if (res.status === 'unavailable' || isRemoteBridgeDisconnectedReason(res.reason)) {
        throw createRemoteDisconnectedError(res.reason);
      }
      if (res.ok === false || res.status === 'error') {
        throw new Error(String(res.reason || 'ERR_CONFIG_PLUGIN_READ_FAILED'));
      }
      const rawItems = Array.isArray(res.items) ? res.items : [];
      const normalized = [];
      for (const item of rawItems) {
        if (!item || typeof item !== 'object') continue;
        if (item.status !== 'ok') continue;
        const rawText = resolveSnapshotRawText(item);
        if (rawText === null) continue;
        const rawId = String(item.pluginId || '').trim();
        if (!rawId) continue;
        const colonIdx = rawId.indexOf(':');
        const pluginScope = rawId.startsWith('workspace:') ? 'workspace' : 'global';
        const pluginDir = colonIdx >= 0 ? rawId.slice(colonIdx + 1).trim() : rawId;
        if (!pluginDir) continue;
        const pluginId = colonIdx >= 0 ? rawId : `${pluginScope}:${pluginDir}`;
        normalized.push({
          pluginId,
          pluginScope,
          pluginName: pluginDir,
          pluginDir,
          rawText,
          displayPath:
            pluginScope === 'workspace'
              ? `<workspace>/.agents/plugins/${pluginDir}/mcp_config.json`
              : `~/.gemini/config/plugins/${pluginDir}/mcp_config.json`,
        });
      }
      return normalized;
    }

    async function readLegacyConfig() {
      if (!hasDeclaredScope(bridge, HOST_CONFIG_SCOPES.LEGACY_MCP, 'ro')) {
        return { exists: false, rawText: '', displayPath: '' };
      }
      try {
        const res = await bridge.read(HOST_CONFIG_SCOPES.LEGACY_MCP);
        if (!res || typeof res !== 'object' || res.ok === false || res.status === 'missing' || res.status === 'error') {
          return { exists: false, rawText: '', displayPath: '' };
        }
        const rawText = resolveSnapshotRawText(res);
        if (rawText === null) {
          return { exists: false, rawText: '', displayPath: '' };
        }
        return {
          exists: true,
          rawText,
          displayPath: DEFAULT_DISPLAY_PATHS[HOST_CONFIG_SCOPES.LEGACY_MCP],
        };
      } catch {
        return { exists: false, rawText: '', displayPath: '' };
      }
    }

    return Object.freeze({
      readGlobalConfig,
      writeGlobalConfig,
      readPluginConfigs,
      readLegacyConfig,
    });
  }

  // --- module: storage-draft-config-store.mjs ---
  /**
   * AddonContextV3 Storage-Backed Draft Config Store (`src/adapters/antigravity/renderer/storage-draft-config-store.mjs`).
   *
   * SOLID Boundaries:
   * - SRP: Implements the vendor-independent `ConfigStorePort` contract over `ctx.storage`
   *   (`get`/`set`/`onDidChange`) for surfaces where local filesystem Config Bridge is unavailable
   *   (e.g., Remote Web or restricted Desktop). Enforces UTF-8 SHA-256 CAS guards and byte budgets.
   * - LSP / DIP: Drop-in substitute for `HostBridgeConfigStore` consumed by `McpManagerService`
   *   and `native-mcp-panel.mjs` with zero direct `window.localStorage` or `settingsBridge` calls.
   */
  const STORAGE_DRAFT_SCHEMA_VERSION = 1;
  const STORAGE_DRAFT_MAX_BYTES = 240000;
  const STORAGE_DRAFT_KEY = 'remote-draft:v1';
  const STORAGE_DRAFT_DISPLAY_PATH = 'browser-draft://mcp_config.json (ctx.storage)';

  function utf8ByteLength(text) {
    const s = String(text ?? '');
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(s).length;
    }
    return s.length;
  }

  function extractDraftRawText(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    if (typeof record.rawText === 'string') return record.rawText;
    if (record.mcpServers && typeof record.mcpServers === 'object' && !Array.isArray(record.mcpServers)) {
      return `${JSON.stringify({ mcpServers: record.mcpServers }, null, 2)}\n`;
    }
    return null;
  }
  function createStorageDraftConfigStore(storage, { key = STORAGE_DRAFT_KEY } = {}) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
      throw new TypeError('Storage draft config store requires ctx.storage.get() and ctx.storage.set()');
    }

    let cachedSha256 = null;

    async function readCurrentState() {
      const record = await storage.get(key);
      const rawText = extractDraftRawText(record);
      if (rawText === null) {
        cachedSha256 = null;
        return { exists: false, rawText: '', sha256: null };
      }
      const sha256 = await sha256Hex(rawText);
      cachedSha256 = sha256;
      return { exists: true, rawText, sha256 };
    }

    async function readGlobalConfig() {
      const cur = await readCurrentState();
      return {
        exists: cur.exists,
        rawText: cur.rawText,
        sha256: cur.sha256,
        displayPath: STORAGE_DRAFT_DISPLAY_PATH,
      };
    }

    async function writeGlobalConfig({ rawText, expectedSha256 }) {
      const nextText = String(rawText ?? '');
      if (utf8ByteLength(nextText) > STORAGE_DRAFT_MAX_BYTES) {
        return {
          ok: false,
          code: ERROR_CODES.VALIDATION_ERROR,
          error: `Remote draft exceeds maximum size (${STORAGE_DRAFT_MAX_BYTES} bytes).`,
          actualSha256: cachedSha256,
        };
      }

      const cur = await readCurrentState();
      const expected = expectedSha256 ?? null;
      if (expected !== cur.sha256) {
        return {
          ok: false,
          code: ERROR_CODES.CONFLICT,
          error: 'MCP draft changed in another tab or session (CAS conflict). Reload latest before retrying.',
          actualSha256: cur.sha256,
        };
      }

      const nextSha256 = await sha256Hex(nextText);
      const payload = {
        schemaVersion: STORAGE_DRAFT_SCHEMA_VERSION,
        rawText: nextText,
        updatedAt: new Date().toISOString(),
      };

      try {
        const saved = await storage.set(key, payload);
        if (saved === false) {
          return {
            ok: false,
            code: ERROR_CODES.IO_ERROR,
            error: 'Failed to persist MCP draft to ctx.storage.',
            actualSha256: cur.sha256,
          };
        }
        cachedSha256 = nextSha256;
        return {
          ok: true,
          sha256: nextSha256,
          backupFileName: null,
        };
      } catch (err) {
        const rawReason = String(err?.code || err?.message || '').trim();
        const isValidation =
          rawReason.includes('QUOTA') ||
          rawReason.includes('TOO_LARGE') ||
          rawReason.includes('INVALID') ||
          rawReason.includes('PROTO');
        return {
          ok: false,
          code: isValidation ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.IO_ERROR,
          error: rawReason || 'Failed to persist MCP draft to ctx.storage.',
          actualSha256: cur.sha256,
        };
      }
    }

    async function readPluginConfigs() {
      return [];
    }

    async function readLegacyConfig() {
      return { exists: false, rawText: '', displayPath: '' };
    }

    return Object.freeze({
      readGlobalConfig,
      writeGlobalConfig,
      readPluginConfigs,
      readLegacyConfig,
    });
  }

  // --- module: host-runtime.mjs ---
  /**
   * AddonContextV3 Runtime Adapter (`src/adapters/antigravity/renderer/host-runtime.mjs`).
   *
   * SOLID Boundaries:
   * - SRP: Validates `AddonContextV3` (`apiVersion === 3`), branches strictly on abstract
   *   `ctx.env.surface` / `ctx.env.layoutMode` / `ctx.env.capabilities.hasConfigBridge` (zero
   *   `hostProfileId`, zero raw DOM scraping, zero `window.localStorage`), manages `ctx.storage`
   *   language persistence, and exposes a narrow capability facade to UI adapters.
   * - DIP: `mcp-v3-shell.mjs` and `native-mcp-panel.mjs` depend on this capability port rather
   *   than host internals.
   */
  const LANG_STORAGE_KEY = 'lang';
  const REMOTE_BRIDGE_CHANGED_EVENT = 'host:remote-bridge-changed';
  function normalizeLangCode(raw) {
    const val = String(raw || '').trim().toLowerCase();
    if (val === 'ko' || val.startsWith('ko-') || val.startsWith('ko_')) return 'ko';
    if (val === 'en' || val.startsWith('en-') || val.startsWith('en_')) return 'en';
    return '';
  }
  function assertAddonContextV3(ctx) {
    if (!ctx || typeof ctx !== 'object') {
      throw new Error('ERR_MISSING_ADDON_CONTEXT_V3');
    }
    if (ctx.apiVersion !== 3) {
      throw new Error(`ERR_UNSUPPORTED_ADDON_API_VERSION:${String(ctx.apiVersion)}`);
    }
    for (const ns of ['meta', 'env', 'ui', 'storage', 'i18n', 'theme', 'lifecycle']) {
      if (!ctx[ns] || typeof ctx[ns] !== 'object') {
        throw new Error(`ERR_INVALID_ADDON_CONTEXT_V3:${ns}`);
      }
    }
    for (const fn of ['openPanel', 'openModal', 'registerSettingsPage', 'registerStatusItem', 'registerCommand', 'showToast', 'confirm']) {
      if (typeof ctx.ui[fn] !== 'function') {
        throw new Error(`ERR_INVALID_ADDON_CONTEXT_V3:ui.${fn}`);
      }
    }
    for (const fn of ['get', 'set', 'onDidChange']) {
      if (typeof ctx.storage[fn] !== 'function') {
        throw new Error(`ERR_INVALID_ADDON_CONTEXT_V3:storage.${fn}`);
      }
    }
    if (typeof ctx.lifecycle.onDispose !== 'function') {
      throw new Error('ERR_INVALID_ADDON_CONTEXT_V3:lifecycle.onDispose');
    }
    return ctx;
  }
  function createHostRuntime({ ctx, doc = typeof document !== 'undefined' ? document : null }) {
    const v3 = assertAddonContextV3(ctx);
    const pluginId = String(v3.meta.pluginId || 'antigravity-mcp-manager');
    const displayName = String(v3.meta.displayName || 'Antigravity MCP Manager');
    const version = String(v3.meta.version || '4.3.0');
    const trustLevel = String(v3.meta.trustLevel || 'restricted');
    const surface = v3.env.surface === 'remote-web' ? 'remote-web' : 'desktop';

    let savedLang = '';

    function detectDefaultLang() {
      try {
        const locale = typeof v3.i18n.getLocale === 'function' ? v3.i18n.getLocale() : 'en';
        return normalizeLangCode(locale) || 'en';
      } catch {
        return 'en';
      }
    }

    function readSavedLang() {
      return savedLang;
    }

    function resolveEffectiveLang() {
      if (savedLang === 'ko' || savedLang === 'en') return savedLang;
      return detectDefaultLang();
    }

    async function loadSavedLang() {
      try {
        const stored = await v3.storage.get(LANG_STORAGE_KEY);
        savedLang = normalizeLangCode(stored);
      } catch {
        // Ignore storage read errors; fall back to host locale
      }
      return resolveEffectiveLang();
    }

    function writeSavedLang(lang) {
      const norm = normalizeLangCode(lang);
      if (!norm) return false;
      savedLang = norm;
      try {
        Promise.resolve(v3.storage.set(LANG_STORAGE_KEY, norm)).catch(() => {});
        return true;
      } catch {
        return false;
      }
    }

    function getSurface() {
      return surface;
    }

    function getLayoutMode() {
      return String(v3.env.layoutMode || 'desktop');
    }

    function hasConfigBridge() {
      return Boolean(resolveHostConfigBridge(v3));
    }

    function hasRemoteHostBridge() {
      return Boolean(v3.env?.capabilities?.hasRemoteHostBridge === true);
    }

    function getConfigStoreMode() {
      if (surface === 'remote-web') {
        if (hasConfigBridge()) {
          return hasRemoteHostBridge() ? 'host-bridge' : 'remote-bridge-disconnected';
        }
        return 'remote-draft';
      }
      return hasConfigBridge() ? 'host-bridge' : 'remote-draft';
    }

    function onRemoteBridgeChange(cb) {
      if (typeof cb !== 'function' || !v3.events || typeof v3.events.on !== 'function') {
        return () => {};
      }
      return v3.events.on(REMOTE_BRIDGE_CHANGED_EVENT, (payload) => {
        cb(payload && typeof payload === 'object' ? payload : {});
      });
    }

    function createConfigService() {
      if (hasConfigBridge()) {
        const configStore = createHostBridgeConfigStore(v3);
        return new McpManagerService({ configStore });
      }
      const configStore = createStorageDraftConfigStore(v3.storage, { key: STORAGE_DRAFT_KEY });
      return new McpManagerService({ configStore });
    }

    function createStyleElementSafe(cssText) {
      if (typeof v3.ui.createStyleElementSafe === 'function') {
        return v3.ui.createStyleElementSafe(cssText);
      }
      if (!doc || typeof doc.createElement !== 'function') return null;
      const styleEl = doc.createElement('style');
      styleEl.textContent = String(cssText || '');
      return styleEl;
    }

    function showToast(opts) {
      try {
        return v3.ui.showToast(opts);
      } catch {
        return { id: '', dismiss() {} };
      }
    }

    async function confirm(opts) {
      try {
        return Boolean(await v3.ui.confirm(opts));
      } catch {
        return true;
      }
    }

    function onStorageChange(cb) {
      if (typeof cb !== 'function') return () => {};
      return v3.storage.onDidChange((ev) => {
        if (ev && ev.key === LANG_STORAGE_KEY) {
          savedLang = normalizeLangCode(ev.newValue);
        }
        cb(ev);
      });
    }

    function onThemeChange(cb) {
      if (typeof cb !== 'function' || typeof v3.theme.onDidChange !== 'function') return () => {};
      return v3.theme.onDidChange(cb);
    }

    function onLocaleChange(cb) {
      if (typeof cb !== 'function' || !v3.i18n || typeof v3.i18n.onDidChange !== 'function') return () => {};
      return v3.i18n.onDidChange(cb);
    }

    function registerSectionAction(spec) {
      if (typeof v3.ui.registerSectionAction !== 'function') return null;
      return v3.ui.registerSectionAction(spec);
    }

    return Object.freeze({
      apiVersion: 3,
      pluginId,
      displayName,
      version,
      trustLevel,
      getSurface,
      getLayoutMode,
      hasConfigBridge,
      hasRemoteHostBridge,
      getConfigStoreMode,
      createConfigService,
      readSavedLang,
      loadSavedLang,
      writeSavedLang,
      resolveEffectiveLang,
      showToast,
      confirm,
      registerCommand: (commandId, spec) => v3.ui.registerCommand(commandId, spec),
      registerStatusItem: (spec) => v3.ui.registerStatusItem(spec),
      registerSectionAction,
      registerSettingsPage: (spec) => v3.ui.registerSettingsPage(spec),
      openPanel: (opts) => v3.ui.openPanel(opts),
      openModal: (opts) => v3.ui.openModal(opts),
      openPopup: (opts) => v3.ui.openPopup(opts),
      createStyleElementSafe,
      getThemeMode: () => (typeof v3.theme.getMode === 'function' ? v3.theme.getMode() : 'dark'),
      onThemeChange,
      onLocaleChange,
      onStorageChange,
      onRemoteBridgeChange,
      signal: v3.lifecycle.signal || null,
      onDispose: (fn) => v3.lifecycle.onDispose(fn),
      addManagedListener: (target, type, listener, opts) =>
        typeof v3.lifecycle.addManagedListener === 'function'
          ? v3.lifecycle.addManagedListener(target, type, listener, opts)
          : () => {},
      runSafe: (fn) => (typeof v3.lifecycle.runSafe === 'function' ? v3.lifecycle.runSafe(fn) : fn()),
    });
  }

  // --- module: native-mcp-panel.mjs ---
  /**
   * Native Shadow DOM MCP Manager CRUD Panel (`src/adapters/antigravity/renderer/native-mcp-panel.mjs`).
   *
   * SOLID Boundaries:
   * - SRP: Renders the full interactive MCP Manager UI (Global CRUD, Stdio confirmation gate,
   *   Declarative Smart Paste, Raw JSON with CAS conflict & backup restore, Read-Only Plugin
   *   list + Clone to Global, Legacy import, EN/KO switcher) inside Shadow DOM with ZERO
   *   unsafe HTML injection or dynamic script execution sinks (DOM APIs + textContent only).
   * - DIP: Consumes `McpManagerService` via `runtime.createConfigService()` (backed by
   *   `HostBridgeConfigStore`), remaining completely decoupled from Electron IPC or filesystem.
   */
  const NATIVE_PANEL_ATTR = 'data-agy-mcp-native-panel';

  const NATIVE_PANEL_I18N = Object.freeze({
    en: Object.freeze({
      appTitle: 'MCP Manager',
      langAria: 'Language',
      loading: 'Loading…',
      bridgeConnected: 'Host Bridge Connected',
      remoteBridgeDisconnectedBadge: 'Host Bridge Disconnected',
      remoteBridgeDisconnectedTitle: 'Desktop Host Bridge Not Connected',
      remoteBridgeDisconnectedNotice:
        'Connect your Desktop host in the bottom-right Addons → Host Bridge tab on Remote Web.',
      remoteDraftBadge: 'Remote Draft (Browser)',
      refresh: 'Refresh',
      addServer: '+ Add Server',
      tabServers: 'Servers',
      tabRaw: 'Raw JSON',
      remoteDraftHint: 'Browser-local draft (ctx.storage). Import or export mcp_config.json to sync with Desktop.',
      importJsonFile: 'Import JSON',
      copyJson: 'Copy JSON',
      downloadJson: 'Download JSON',
      copiedJsonNotice: 'Copied mcp_config.json to clipboard.',
      downloadedJsonNotice: 'Downloaded mcp_config.json.',
      importedJsonNotice: 'Imported mcp_config.json into browser draft.',
      importJsonFailed: 'Failed to import JSON file.',
      copyJsonFailed: 'Clipboard copy unavailable. Use Raw JSON or Download JSON.',
      downloadJsonFailed: 'Failed to download mcp_config.json.',
      loadFailed: 'Failed to load MCP configuration.',
      saveFailed: 'Save failed.',
      cloneFailed: 'Clone failed.',
      importFailed: 'Import failed.',
      rawSaveFailed: 'Raw JSON save failed.',
      toggleFailed: 'Toggle failed.',
      deleteFailed: 'Delete failed.',
      restoreFailed: 'Restore failed.',
      conflictMessage: 'mcp_config.json changed on disk (Conflict). Reload latest before retrying.',
      reloadLatest: 'Reload Latest',
      confirmStdioTitle: (name) => `Confirm Local Stdio Command: ${name || ''}`,
      rawStdioPreviewName: 'mcp_config.json (Raw JSON)',
      rawStdioPreviewCmd: 'Contains Stdio command server(s)',
      confirmAndSave: 'Confirm & Save',
      cancel: 'Cancel',
      brokenJsonTitle: (loc) => `Broken mcp_config.json detected${loc}`,
      brokenJsonFallback: 'File cannot be parsed as JSON. Structured edits are blocked to prevent data loss.',
      restoreBackup: 'Restore Last Good Backup',
      smartPasteTitle: 'Declarative Smart Paste',
      smartPastePlaceholder: 'Paste mcpServers JSON or https://... Streamable HTTP URL (raw shell commands are rejected)',
      previewPaste: 'Preview Paste',
      loadIntoEditor: 'Load into Editor',
      useMcpRemoteTemplate: 'Use mcp-remote Stdio Template',
      hideQuickPaste: 'Hide',
      quickPasteBtn: 'Quick Paste JSON / URL',
      settingsSubtitle: 'Manage global MCP servers in ~/.gemini/config/mcp_config.json and inspect plugin servers.',
      kvKeyPlaceholder: 'KEY',
      kvValuePlaceholder: 'VALUE (masked)',
      remove: 'Remove',
      addKvItem: (label) => `+ Add ${label}`,
      editServerTitle: (name) => `Edit Server: ${name}`,
      addGlobalServerTitle: 'Add Global MCP Server',
      serverNameLabel: 'Server Name',
      transportLabel: 'Transport',
      transportHttpOption: 'Streamable HTTP (url)',
      transportStdioOption: 'Stdio (local command)',
      commandLabel: 'Command',
      argsLabel: 'Arguments (one per line)',
      envVarLabel: 'Environment Variable',
      endpointUrlLabel: 'Endpoint URL',
      httpHeaderLabel: 'HTTP Header',
      save: 'Save',
      legacyDetected: (count) => `Legacy config detected (${count} server(s))`,
      importNamed: (name) => `Import "${name}"`,
      dismiss: 'Dismiss',
      globalServersTitle: (count) => `Global MCP Servers (${count})`,
      pluginServersTitle: (count) => `Plugin MCP Servers (Read-Only · ${count})`,
      noGlobalServers: 'No global MCP servers configured yet.',
      statusDisabled: 'Disabled',
      statusReady: 'Ready',
      statusConfigured: 'Configured',
      toolsSuffix: (count) => ` · ${count} tools`,
      transportUnknown: 'unknown',
      enable: 'Enable',
      disable: 'Disable',
      edit: 'Edit',
      delete: 'Delete',
      pluginBadge: (name, disabled) => `Plugin · ${name}${disabled ? ' (Disabled)' : ''}`,
      collidesWithGlobal: (name) => `Collides with global "${name}"`,
      cloneToGlobal: 'Clone to Global',
      validateAndSaveRaw: 'Validate & Save Raw JSON',
    }),
    ko: Object.freeze({
      appTitle: 'MCP 매니저',
      langAria: '언어 선택',
      loading: '불러오는 중…',
      bridgeConnected: '호스트 브리지 연결됨',
      remoteBridgeDisconnectedBadge: '호스트 브리지 미연결',
      remoteBridgeDisconnectedTitle: '데스크톱 호스트 브리지 미연결',
      remoteBridgeDisconnectedNotice:
        '원격 웹 우측 하단 Addons → Host Bridge 탭에서 데스크톱 호스트를 연결하세요.',
      remoteDraftBadge: '원격 초안 (브라우저 저장)',
      refresh: '새로고침',
      addServer: '+ 서버 추가',
      tabServers: '서버 목록',
      tabRaw: '원본 JSON',
      remoteDraftHint: '브라우저 저장소(ctx.storage) 기반 원격 초안입니다. PC와 동기화하려면 mcp_config.json을 가져오거나 내보내세요.',
      importJsonFile: 'JSON 가져오기',
      copyJson: 'JSON 복사',
      downloadJson: 'JSON 다운로드',
      copiedJsonNotice: 'mcp_config.json을 클립보드에 복사했습니다.',
      downloadedJsonNotice: 'mcp_config.json 파일을 다운로드했습니다.',
      importedJsonNotice: 'JSON 파일을 브라우저 초안으로 가져왔습니다.',
      importJsonFailed: 'JSON 파일 가져오기에 실패했습니다.',
      copyJsonFailed: '클립보드 복사를 사용할 수 없습니다. 원본 JSON 또는 다운로드를 이용해 주세요.',
      downloadJsonFailed: 'mcp_config.json 다운로드에 실패했습니다.',
      loadFailed: 'MCP 설정을 불러오지 못했습니다.',
      saveFailed: '저장에 실패했습니다.',
      cloneFailed: '복제에 실패했습니다.',
      importFailed: '가져오기에 실패했습니다.',
      rawSaveFailed: '원본 JSON 저장에 실패했습니다.',
      toggleFailed: '상태 변경에 실패했습니다.',
      deleteFailed: '삭제에 실패했습니다.',
      restoreFailed: '백업 복원에 실패했습니다.',
      conflictMessage: '디스크의 mcp_config.json이 변경되었습니다 (충돌). 최신 상태를 불러온 뒤 다시 시도하세요.',
      reloadLatest: '최신 상태 불러오기',
      confirmStdioTitle: (name) => `로컬 Stdio 명령 확인: ${name || ''}`,
      rawStdioPreviewName: 'mcp_config.json (원본 JSON)',
      rawStdioPreviewCmd: 'Stdio 명령어 서버가 포함되어 있습니다',
      confirmAndSave: '확인 후 저장',
      cancel: '취소',
      brokenJsonTitle: (loc) => `손상된 mcp_config.json 감지${loc}`,
      brokenJsonFallback: 'JSON 구문 오류가 있어 데이터 손실을 막기 위해 구조화 편집이 차단되었습니다.',
      restoreBackup: '마지막 정상 백업 복원',
      smartPasteTitle: '스마트 붙여넣기 (JSON / URL)',
      smartPastePlaceholder: 'mcpServers JSON 또는 https://... Streamable HTTP URL을 붙여넣으세요 (일반 셸 명령은 거부됨)',
      previewPaste: '미리보기',
      loadIntoEditor: '편집기로 불러오기',
      useMcpRemoteTemplate: 'mcp-remote Stdio 템플릿 사용',
      hideQuickPaste: '닫기',
      quickPasteBtn: 'JSON / URL 빠른 붙여넣기',
      settingsSubtitle: '~/.gemini/config/mcp_config.json의 전역 MCP 서버를 관리하고 플러그인 서버를 확인합니다.',
      kvKeyPlaceholder: '키 (KEY)',
      kvValuePlaceholder: '값 (마스킹됨)',
      remove: '제거',
      addKvItem: (label) => `+ ${label} 추가`,
      editServerTitle: (name) => `서버 편집: ${name}`,
      addGlobalServerTitle: '전역 MCP 서버 추가',
      serverNameLabel: '서버 이름',
      transportLabel: '전송 방식',
      transportHttpOption: 'Streamable HTTP (URL)',
      transportStdioOption: 'Stdio (로컬 명령어)',
      commandLabel: '명령어',
      argsLabel: '인자 (한 줄에 하나씩)',
      envVarLabel: '환경 변수',
      endpointUrlLabel: '엔드포인트 URL',
      httpHeaderLabel: 'HTTP 헤더',
      save: '저장',
      legacyDetected: (count) => `이전 설정 파일 감지됨 (서버 ${count}개)`,
      importNamed: (name) => `"${name}" 가져오기`,
      dismiss: '닫기',
      globalServersTitle: (count) => `전역 MCP 서버 (${count})`,
      pluginServersTitle: (count) => `플러그인 MCP 서버 (읽기 전용 · ${count})`,
      noGlobalServers: '등록된 전역 MCP 서버가 없습니다.',
      statusDisabled: '비활성화됨',
      statusReady: '준비됨',
      statusConfigured: '설정됨',
      toolsSuffix: (count) => ` · 도구 ${count}개`,
      transportUnknown: '알 수 없음',
      enable: '활성화',
      disable: '비활성화',
      edit: '편집',
      delete: '삭제',
      pluginBadge: (name, disabled) => `플러그인 · ${name}${disabled ? ' (비활성화됨)' : ''}`,
      collidesWithGlobal: (name) => `전역 "${name}"과 이름 충돌`,
      cloneToGlobal: '전역으로 복제',
      validateAndSaveRaw: '검증 후 원본 JSON 저장',
    }),
  });
  function createNativeMcpPanel({
    runtime,
    service,
    mode = null,
    surface = 'settings',
    inline = false,
    onLangChange = () => {},
    onSnapshotChange = () => {},
    doc = document,
    win: winOverride = null,
  }) {
    if (!service) {
      throw new Error('ERR_MISSING_MCP_MANAGER_SERVICE');
    }

    const fixedMode =
      mode === 'remote-draft' || mode === 'host-bridge' || mode === 'remote-bridge-disconnected' ? mode : null;
    const win = winOverride || doc?.defaultView || (typeof window !== 'undefined' ? window : null);

    let disposed = false;
    let remoteBridgeDisconnected = false;
    let activeTab = 'servers';

    function getPanelMode() {
      if (fixedMode) return fixedMode;
      const liveMode =
        typeof runtime.getConfigStoreMode === 'function' ? runtime.getConfigStoreMode() : 'host-bridge';
      if (remoteBridgeDisconnected && liveMode !== 'remote-draft') {
        return 'remote-bridge-disconnected';
      }
      return liveMode;
    }

    function isRemoteDraftMode() {
      return getPanelMode() === 'remote-draft';
    }

    function isRemoteBridgeDisconnectedMode() {
      return getPanelMode() === 'remote-bridge-disconnected';
    }

    function shouldShowRemoteBridgeGuide() {
      if (isRemoteBridgeDisconnectedMode()) return true;
      const isRemoteSurface = typeof runtime.getSurface === 'function' && runtime.getSurface() === 'remote-web';
      const connected = typeof runtime.hasRemoteHostBridge === 'function' && runtime.hasRemoteHostBridge();
      return isRemoteSurface && !connected;
    }
    let snapshot = null;
    let bannerState = null;
    let legacyDismissed = false;
    let editorState = null;
    let pendingStdioConfirm = null;
    let pastePreview = null;
    let pasteInputDraft = '';
    let smartPasteOpen = false;
    let rawDraft = '';
    let rawDraftDirty = false;
    let snapshotRequestSeq = 0;
    let busy = false;
    let mutating = false;

    function getLang() {
      const resolved =
        typeof runtime.resolveEffectiveLang === 'function'
          ? runtime.resolveEffectiveLang()
          : runtime.readSavedLang();
      return resolved === 'ko' ? 'ko' : 'en';
    }

    function t(key, ...args) {
      const lang = getLang();
      const dict = NATIVE_PANEL_I18N[lang] || NATIVE_PANEL_I18N.en;
      const entry = dict[key] !== undefined ? dict[key] : NATIVE_PANEL_I18N.en[key];
      return typeof entry === 'function' ? entry(...args) : entry;
    }

    function isImeComposing(event) {
      return Boolean(event && (event.isComposing === true || event.keyCode === 229));
    }

    function clearNode(node) {
      while (node && node.firstChild) {
        node.removeChild(node.firstChild);
      }
    }

    function createTextChild(text) {
      const str = String(text);
      if (typeof doc.createTextNode === 'function') {
        return doc.createTextNode(str);
      }
      const span = doc.createElement('span');
      span.textContent = str;
      return span;
    }

    function setClassFlag(node, token, enabled) {
      if (!node) return;
      if (node.classList && typeof node.classList.toggle === 'function') {
        node.classList.toggle(token, Boolean(enabled));
        return;
      }
      const parts = String(node.className || '')
        .split(/\s+/)
        .filter(Boolean);
      const has = parts.includes(token);
      if (enabled && !has) parts.push(token);
      else if (!enabled && has) parts.splice(parts.indexOf(token), 1);
      node.className = parts.join(' ');
    }

    function toDataAttrName(camelKey) {
      return `data-${String(camelKey).replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`;
    }

    function el(tag, props, ...children) {
      const node = doc.createElement(tag);
      let deferredValue;
      if (props) {
        for (const [k, v] of Object.entries(props)) {
          if (v === undefined || v === null || v === false) continue;
          if (k === 'className') node.className = String(v);
          else if (k === 'value') deferredValue = String(v);
          else if (k === 'checked') node.checked = Boolean(v);
          else if (k === 'disabled') node.disabled = Boolean(v);
          else if (k === 'dataset' && typeof v === 'object') {
            for (const [dk, dv] of Object.entries(v)) {
              if (dv !== undefined && dv !== null) {
                node.setAttribute(toDataAttrName(dk), String(dv));
              }
            }
          } else if (k.startsWith('on') && typeof v === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), v);
          } else {
            node.setAttribute(k, v === true ? '' : String(v));
          }
        }
      }
      const flatChildren = [];
      for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        if (Array.isArray(child)) {
          for (const c of child) {
            if (c !== null && c !== undefined && c !== false) flatChildren.push(c);
          }
        } else {
          flatChildren.push(child);
        }
      }
      if (flatChildren.length === 1 && typeof flatChildren[0] === 'string' && typeof doc.createTextNode !== 'function') {
        node.textContent = flatChildren[0];
      } else {
        for (const c of flatChildren) {
          node.appendChild(typeof c === 'string' ? createTextChild(c) : c);
        }
      }
      if (deferredValue !== undefined) {
        node.value = deferredValue;
      }
      return node;
    }

    const root = el('section', {
      [NATIVE_PANEL_ATTR]: 'true',
      'data-agy-mcp-surface': surface,
      'data-agy-mcp-mode': getPanelMode(),
      ...(inline ? { 'data-agy-mcp-inline': 'true' } : {}),
    });
    const shell = el('div', { className: 'mcp-shell' });
    const headerEl = el('header', { className: 'mcp-header' });
    const titleGroup = el('div', { className: 'mcp-title-group' });
    const titleEl = surface === 'settings' ? el('h1', { className: 'mcp-title' }) : null;
    const statusBadge = el('span', {
      className: isRemoteBridgeDisconnectedMode()
        ? 'mcp-badge mcp-badge-warn'
        : isRemoteDraftMode()
          ? 'mcp-badge mcp-badge-info'
          : 'mcp-badge mcp-badge-ok',
      dataset: { testid: 'bridge-status-badge' },
    });
    if (titleEl) titleGroup.appendChild(titleEl);
    titleGroup.appendChild(statusBadge);

    const actionsGroup = el('div', { className: 'mcp-header-actions' });
    const langSwitch = el('div', {
      className: 'mcp-lang-switch',
      role: 'group',
      dataset: { testid: 'lang-switch' },
    });
    const btnLangEn = el(
      'button',
      {
        type: 'button',
        className: 'mcp-lang-btn',
        'data-agy-mcp-lang-btn': 'en',
        onClick: (ev) => {
          ev.preventDefault();
          runtime.writeSavedLang('en');
          syncLang();
          onLangChange('en');
        },
      },
      'EN'
    );
    const btnLangKo = el(
      'button',
      {
        type: 'button',
        className: 'mcp-lang-btn',
        'data-agy-mcp-lang-btn': 'ko',
        onClick: (ev) => {
          ev.preventDefault();
          runtime.writeSavedLang('ko');
          syncLang();
          onLangChange('ko');
        },
      },
      '한국어'
    );
    langSwitch.appendChild(btnLangEn);
    langSwitch.appendChild(btnLangKo);

    const btnRefresh = el('button', {
      type: 'button',
      className: 'mcp-btn',
      dataset: { testid: 'btn-refresh' },
      onClick: () => void loadSnapshot(activeTab === 'raw'),
    });
    const btnAdd = el('button', {
      type: 'button',
      className: 'mcp-btn mcp-btn-primary',
      dataset: { testid: 'btn-add-server' },
      onClick: () => openEditorForServer(null),
    });
    actionsGroup.appendChild(langSwitch);
    actionsGroup.appendChild(btnRefresh);
    actionsGroup.appendChild(btnAdd);
    headerEl.appendChild(titleGroup);
    headerEl.appendChild(actionsGroup);

    const tabsEl = el('div', { className: 'mcp-tabs', role: 'tablist' });
    const tabServers = el('button', {
      type: 'button',
      className: 'mcp-tab',
      role: 'tab',
      dataset: { testid: 'tab-servers' },
      onClick: () => {
        activeTab = 'servers';
        pastePreview = null;
        scrubSensitiveState({ keepRawIfMalformed: true });
        renderAll();
      },
    });
    const tabRaw = el('button', {
      type: 'button',
      className: 'mcp-tab',
      role: 'tab',
      dataset: { testid: 'tab-raw' },
      onClick: () => {
        activeTab = 'raw';
        pastePreview = null;
        scrubSensitiveState({ keepRawIfMalformed: true });
        void loadSnapshot(true);
      },
    });
    tabsEl.appendChild(tabServers);
    tabsEl.appendChild(tabRaw);

    const bannerRegion = el('div', { className: 'mcp-banner-region' });
    const mainRegion = el('div', { className: 'mcp-main-region' });

    shell.appendChild(headerEl);
    shell.appendChild(tabsEl);
    shell.appendChild(bannerRegion);
    shell.appendChild(mainRegion);
    root.appendChild(shell);

    function scrubSensitiveState({ keepRawIfMalformed = false } = {}) {
      if (editorState) {
        editorState.envRows = [];
        editorState.headerRows = [];
        editorState = null;
      }
      pendingStdioConfirm = null;
      pasteInputDraft = '';
      if (!keepRawIfMalformed || !snapshot?.globalConfig?.malformed) {
        rawDraft = '';
        rawDraftDirty = false;
      }
    }

    function setBanner(kind, message, actions = []) {
      bannerState = { kind, message, actions };
      renderBanners();
    }

    function clearBanner() {
      bannerState = null;
      renderBanners();
    }

    function handleConflictBanner() {
      pendingStdioConfirm = null;
      bannerState = {
        kind: 'warn',
        message: t('conflictMessage'),
        actions: [
          {
            label: t('reloadLatest'),
            testid: 'btn-reload-latest',
            onClick: () => {
              clearBanner();
              void loadSnapshot(true);
            },
          },
        ],
      };
      renderAll();
    }

    function openEditorForServer(serverEntry = null) {
      pendingStdioConfirm = null;
      if (!serverEntry) {
        editorState = {
          mode: 'create',
          originalName: null,
          name: '',
          transport: 'streamable_http',
          url: '',
          command: '',
          argsText: '',
          envRows: [],
          headerRows: [],
          disabled: false,
        };
      } else {
        const spec = serverEntry.spec || {};
        const isStdio = spec.command !== undefined;
        editorState = {
          mode: 'edit',
          originalName: serverEntry.name,
          name: serverEntry.name,
          transport: isStdio ? 'stdio' : 'streamable_http',
          url: spec.url || spec.serverUrl || '',
          command: spec.command || '',
          argsText: Array.isArray(spec.args) ? spec.args.join('\n') : '',
          envRows: Object.entries(spec.env || {}).map(([k, v]) => ({ key: k, value: v })),
          headerRows: Object.entries(spec.headers || {}).map(([k, v]) => ({ key: k, value: v })),
          disabled: Boolean(serverEntry.disabled),
        };
      }
      activeTab = 'servers';
      renderAll();
    }

    function buildSpecFromEditor() {
      if (!editorState) return null;
      const spec = {};
      if (editorState.transport === 'stdio') {
        spec.command = editorState.command.trim();
        const args = editorState.argsText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        if (args.length > 0) spec.args = args;
        const env = {};
        for (const row of editorState.envRows) {
          if (row.key.trim()) env[row.key.trim()] = row.value;
        }
        if (Object.keys(env).length > 0) spec.env = env;
      } else {
        spec.url = editorState.url.trim();
        const headers = {};
        for (const row of editorState.headerRows) {
          if (row.key.trim()) headers[row.key.trim()] = row.value;
        }
        if (Object.keys(headers).length > 0) spec.headers = headers;
      }
      if (editorState.disabled) spec.disabled = true;
      return spec;
    }

    async function loadSnapshot(includeRawText = activeTab === 'raw') {
      if (disposed) return;
      const seq = ++snapshotRequestSeq;
      const liveMode =
        fixedMode || (typeof runtime.getConfigStoreMode === 'function' ? runtime.getConfigStoreMode() : 'host-bridge');
      if (liveMode === 'remote-bridge-disconnected') {
        remoteBridgeDisconnected = true;
        snapshot = null;
        bannerState = null;
        busy = false;
        syncStaticLabels();
        renderAll();
        return;
      }
      busy = true;
      syncStaticLabels();
      try {
        const data = await service.getSnapshot({ includeRawText });
        if (disposed || seq !== snapshotRequestSeq) return;
        busy = false;
        if (!data || !data.ok) {
          const joinedErr = (data?.errors || [t('loadFailed')]).join(' ');
          if (isRemoteBridgeDisconnectedReason(data?.code || joinedErr)) {
            remoteBridgeDisconnected = true;
            snapshot = null;
            bannerState = null;
            syncStaticLabels();
            renderAll();
            return;
          }
          setBanner('error', joinedErr);
          syncStaticLabels();
          return;
        }
        remoteBridgeDisconnected = false;
        snapshot = data;
        if (typeof data.globalConfig?.rawText === 'string' && (includeRawText || (!rawDraftDirty && !rawDraft))) {
          rawDraft = data.globalConfig.rawText;
          if (includeRawText) rawDraftDirty = false;
        }
        if (data.globalConfig?.malformed) {
          activeTab = 'raw';
        }
        if (typeof onSnapshotChange === 'function') {
          try {
            onSnapshotChange(data);
          } catch {}
        }
        syncStaticLabels();
        renderAll();
      } catch (err) {
        if (disposed || seq !== snapshotRequestSeq) return;
        busy = false;
        if (isRemoteBridgeDisconnectedReason(err)) {
          remoteBridgeDisconnected = true;
          snapshot = null;
          bannerState = null;
          syncStaticLabels();
          renderAll();
          return;
        }
        setBanner('error', err?.message || t('loadFailed'));
        syncStaticLabels();
      }
    }

    async function runMutation(fallbackErrorKey, task) {
      if (mutating || disposed) return;
      mutating = true;
      try {
        const reloadMode = await task();
        if (disposed) return;
        if (reloadMode) {
          await loadSnapshot(reloadMode === 'raw');
        }
      } catch (err) {
        if (disposed) return;
        if (isRemoteBridgeDisconnectedReason(err)) {
          remoteBridgeDisconnected = true;
          snapshot = null;
          bannerState = null;
          syncStaticLabels();
          renderAll();
        } else {
          setBanner('error', err?.message || t(fallbackErrorKey));
        }
      } finally {
        mutating = false;
      }
    }

    async function submitEditor(confirmStdio = false) {
      if (!editorState || !snapshot || disposed) return;
      await runMutation('saveFailed', async () => {
        const spec = buildSpecFromEditor();
        const payload = {
          name: editorState.name.trim(),
          originalName: editorState.originalName,
          spec,
          expectedSha256: snapshot.globalConfig.sha256,
          confirmStdio,
        };
        const data = await service.upsertServer(payload);
        if (disposed) return false;
        if (data.code === 'CONFIRMATION_REQUIRED') {
          pendingStdioConfirm = {
            kind: 'upsert',
            payload,
            preview: data.confirmationPreview || { name: payload.name, command: spec.command, args: spec.args || [] },
          };
          renderAll();
          return false;
        }
        if (data.code === 'CONFLICT') {
          handleConflictBanner();
          return false;
        }
        if (!data.ok) {
          setBanner('error', (data.errors || [t('saveFailed')]).join(' '));
          return false;
        }
        scrubSensitiveState({ keepRawIfMalformed: true });
        clearBanner();
        return activeTab === 'raw' ? 'raw' : 'list';
      });
    }

    async function submitClonePlugin(ps, confirmStdio = false) {
      if (!snapshot || disposed) return;
      await runMutation('cloneFailed', async () => {
        const targetName = `${ps.name}-copy`;
        const payload = {
          pluginId: ps.pluginId || null,
          pluginDir: ps.pluginDir,
          serverName: ps.name,
          targetName,
          expectedSha256: snapshot.globalConfig.sha256,
          confirmStdio,
        };
        const data = await service.clonePluginServer(payload);
        if (disposed) return false;
        if (data.code === 'CONFIRMATION_REQUIRED') {
          pendingStdioConfirm = {
            kind: 'clone',
            payload,
            preview: data.confirmationPreview || { name: targetName, command: ps.spec?.command || '', args: ps.spec?.args || [] },
          };
          renderAll();
          return false;
        }
        if (data.code === 'CONFLICT') {
          handleConflictBanner();
          return false;
        }
        if (!data.ok) {
          setBanner('error', (data.errors || [t('cloneFailed')]).join(' '));
          return false;
        }
        pendingStdioConfirm = null;
        clearBanner();
        return 'list';
      });
    }

    async function submitImportLegacy(ls, confirmStdio = false) {
      if (!snapshot || disposed) return;
      await runMutation('importFailed', async () => {
        const payload = {
          serverName: ls.name,
          expectedSha256: snapshot.globalConfig.sha256,
          confirmStdio,
        };
        const data = await service.importLegacyServer(payload);
        if (disposed) return false;
        if (data.code === 'CONFIRMATION_REQUIRED') {
          pendingStdioConfirm = {
            kind: 'legacy',
            payload,
            preview: data.confirmationPreview || { name: ls.name, command: ls.spec?.command || '', args: ls.spec?.args || [] },
          };
          renderAll();
          return false;
        }
        if (data.code === 'CONFLICT') {
          handleConflictBanner();
          return false;
        }
        if (!data.ok) {
          setBanner('error', (data.errors || [t('importFailed')]).join(' '));
          return false;
        }
        pendingStdioConfirm = null;
        clearBanner();
        return 'list';
      });
    }

    async function submitRawJson(confirmStdio = false, rawTextOverride = null, successNoticeKey = null) {
      if (!snapshot || disposed) return;
      await runMutation('rawSaveFailed', async () => {
        const nextRawText = typeof rawTextOverride === 'string' ? rawTextOverride : rawDraft;
        const payload = {
          rawText: nextRawText,
          expectedSha256: snapshot.globalConfig.sha256,
          confirmStdio,
        };
        const data = await service.saveRawJson(payload);
        if (disposed) return false;
        if (data.code === 'CONFIRMATION_REQUIRED') {
          pendingStdioConfirm = {
            kind: 'raw',
            payload,
            successNoticeKey,
            preview: { name: t('rawStdioPreviewName'), command: t('rawStdioPreviewCmd'), args: [] },
          };
          renderAll();
          return false;
        }
        if (data.code === 'CONFLICT') {
          handleConflictBanner();
          return false;
        }
        if (!data.ok) {
          setBanner('error', (data.errors || [t('rawSaveFailed')]).join(' '));
          return false;
        }
        pendingStdioConfirm = null;
        if (successNoticeKey) {
          setBanner('info', t(successNoticeKey));
        } else {
          clearBanner();
        }
        return activeTab === 'raw' ? 'raw' : 'list';
      });
    }

    async function resolveExportRawText() {
      if (activeTab === 'raw' && rawDraftDirty && typeof rawDraft === 'string' && rawDraft.trim()) {
        return rawDraft;
      }
      if (typeof snapshot?.globalConfig?.rawText === 'string' && snapshot.globalConfig.rawText.trim()) {
        return snapshot.globalConfig.rawText;
      }
      const fresh = await service.getSnapshot({ includeRawText: true });
      if (fresh?.ok && typeof fresh.globalConfig?.rawText === 'string' && fresh.globalConfig.rawText.trim()) {
        return fresh.globalConfig.rawText;
      }
      return '{\n  "mcpServers": {}\n}\n';
    }

    async function handleImportJsonText(rawText) {
      if (disposed) return;
      if (!snapshot) {
        await loadSnapshot(true);
        if (!snapshot || disposed) return;
      }
      rawDraft = String(rawText ?? '');
      rawDraftDirty = true;
      await submitRawJson(false, rawDraft, 'importedJsonNotice');
    }

    async function handleCopyJson() {
      if (disposed) return;
      try {
        const text = await resolveExportRawText();
        const clipboard = win?.navigator?.clipboard;
        if (!clipboard || typeof clipboard.writeText !== 'function') {
          setBanner('warn', t('copyJsonFailed'));
          return;
        }
        await clipboard.writeText(text);
        if (!disposed) {
          setBanner('info', t('copiedJsonNotice'));
          if (typeof runtime.showToast === 'function') {
            runtime.showToast({ message: t('copiedJsonNotice'), variant: 'success' });
          }
        }
      } catch {
        if (!disposed) setBanner('warn', t('copyJsonFailed'));
      }
    }

    async function handleDownloadJson() {
      if (disposed) return;
      try {
        const text = await resolveExportRawText();
        const BlobCtor = win?.Blob || (typeof Blob !== 'undefined' ? Blob : null);
        const UrlApi = win?.URL || (typeof URL !== 'undefined' ? URL : null);
        if (!BlobCtor || !UrlApi || typeof UrlApi.createObjectURL !== 'function') {
          setBanner('warn', t('downloadJsonFailed'));
          return;
        }
        const blob = new BlobCtor([text], { type: 'application/json;charset=utf-8' });
        const href = UrlApi.createObjectURL(blob);
        const link = doc.createElement('a');
        link.setAttribute('href', href);
        link.setAttribute('download', 'mcp_config.json');
        link.style.display = 'none';
        const parent = doc.body || root;
        parent.appendChild(link);
        try {
          link.click();
        } finally {
          if (link.parentNode) link.parentNode.removeChild(link);
          if (typeof UrlApi.revokeObjectURL === 'function') {
            UrlApi.revokeObjectURL(href);
          }
        }
        if (!disposed) {
          setBanner('info', t('downloadedJsonNotice'));
          if (typeof runtime.showToast === 'function') {
            runtime.showToast({ message: t('downloadedJsonNotice'), variant: 'success' });
          }
        }
      } catch {
        if (!disposed) setBanner('error', t('downloadJsonFailed'));
      }
    }

    function renderRemoteIoBar() {
      const fileInput = el('input', {
        type: 'file',
        accept: '.json,application/json',
        className: 'mcp-file-input-hidden',
        dataset: { testid: 'input-import-json-file' },
        onChange: (ev) => {
          const inputEl = ev.target;
          const file = inputEl?.files?.[0];
          if (!file) return;
          Promise.resolve()
            .then(() => {
              if (typeof file.text === 'function') return file.text();
              return new Promise((resolve, reject) => {
                const ReaderCtor = win?.FileReader || (typeof FileReader !== 'undefined' ? FileReader : null);
                if (!ReaderCtor) {
                  reject(new Error('FileReader unavailable'));
                  return;
                }
                const reader = new ReaderCtor();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error || new Error('File read failed'));
                reader.readAsText(file);
              });
            })
            .then((text) => handleImportJsonText(text))
            .catch(() => {
              if (!disposed) setBanner('error', t('importJsonFailed'));
            })
            .finally(() => {
              if (inputEl) inputEl.value = '';
            });
        },
      });

      return el(
        'div',
        { className: 'mcp-remote-io-bar', dataset: { testid: 'remote-io-bar' } },
        el('span', { className: 'mcp-remote-io-hint' }, t('remoteDraftHint')),
        fileInput,
        el(
          'div',
          { className: 'mcp-row-actions' },
          el(
            'button',
            {
              type: 'button',
              className: 'mcp-btn mcp-btn-sm',
              dataset: { testid: 'btn-import-json-file' },
              onClick: () => fileInput.click(),
            },
            t('importJsonFile')
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'mcp-btn mcp-btn-sm',
              dataset: { testid: 'btn-copy-json' },
              onClick: () => void handleCopyJson(),
            },
            t('copyJson')
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'mcp-btn mcp-btn-sm',
              dataset: { testid: 'btn-download-json' },
              onClick: () => void handleDownloadJson(),
            },
            t('downloadJson')
          )
        )
      );
    }

    async function confirmPendingStdio() {
      if (!pendingStdioConfirm || disposed) return;
      const pending = pendingStdioConfirm;
      if (pending.kind === 'upsert') {
        await submitEditor(true);
      } else if (pending.kind === 'clone') {
        await submitClonePlugin(
          {
            pluginId: pending.payload.pluginId || null,
            pluginDir: pending.payload.pluginDir,
            name: pending.payload.serverName,
          },
          true
        );
      } else if (pending.kind === 'legacy') {
        await submitImportLegacy({ name: pending.payload.serverName }, true);
      } else if (pending.kind === 'raw') {
        await submitRawJson(true, pending.payload?.rawText ?? null, pending.successNoticeKey || null);
      }
    }

    async function handleToggleDisabled(server) {
      if (!snapshot || disposed) return;
      await runMutation('toggleFailed', async () => {
        const data = await service.toggleServerDisabled({
          name: server.name,
          disabled: !server.disabled,
          expectedSha256: snapshot.globalConfig.sha256,
        });
        if (disposed) return false;
        if (data.code === 'CONFLICT') {
          handleConflictBanner();
          return false;
        }
        if (!data.ok) {
          setBanner('error', (data.errors || [t('toggleFailed')]).join(' '));
          return false;
        }
        clearBanner();
        return 'list';
      });
    }

    async function handleDelete(server) {
      if (!snapshot || disposed) return;
      await runMutation('deleteFailed', async () => {
        const data = await service.deleteServer({
          name: server.name,
          expectedSha256: snapshot.globalConfig.sha256,
        });
        if (disposed) return false;
        if (data.code === 'CONFLICT') {
          handleConflictBanner();
          return false;
        }
        if (!data.ok) {
          setBanner('error', (data.errors || [t('deleteFailed')]).join(' '));
          return false;
        }
        clearBanner();
        return 'list';
      });
    }

    async function handleRestoreBackup() {
      if (!snapshot || disposed) return;
      await runMutation('restoreFailed', async () => {
        const data = await service.restoreBackup({
          expectedSha256: snapshot.globalConfig.sha256,
        });
        if (disposed) return false;
        if (data.code === 'CONFLICT') {
          handleConflictBanner();
          return false;
        }
        if (!data.ok) {
          setBanner('error', (data.errors || [t('restoreFailed')]).join(' '));
          return false;
        }
        clearBanner();
        return 'raw';
      });
    }

    function renderStdioConfirmPanel() {
      if (!pendingStdioConfirm) return null;
      const p = pendingStdioConfirm.preview || {};
      return el(
        'div',
        { className: 'mcp-banner mcp-banner-warn', dataset: { testid: 'stdio-confirm-panel' } },
        el('strong', null, t('confirmStdioTitle', p.name)),
        el('div', { className: 'mcp-server-meta' }, `${p.command || ''} ${(p.args || []).join(' ')}`.trim()),
        el(
          'div',
          { className: 'mcp-banner-actions' },
          el(
            'button',
            {
              type: 'button',
              className: 'mcp-btn mcp-btn-primary mcp-btn-sm',
              dataset: { testid: 'btn-confirm-stdio' },
              onClick: () => void confirmPendingStdio(),
            },
            t('confirmAndSave')
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'mcp-btn mcp-btn-sm',
              dataset: { testid: 'btn-cancel-stdio' },
              onClick: () => {
                pendingStdioConfirm = null;
                renderAll();
              },
            },
            t('cancel')
          )
        )
      );
    }

    function renderBanners() {
      clearNode(bannerRegion);
      if (snapshot?.globalConfig?.malformed) {
        const err = snapshot.globalConfig.parseError;
        const loc = err?.line ? ` (line ${err.line}, col ${err.column || 1})` : '';
        const canRestore = typeof service.configStore?.restoreLastBackup === 'function';
        bannerRegion.appendChild(
          el(
            'div',
            { className: 'mcp-banner mcp-banner-error', role: 'alert', dataset: { testid: 'malformed-json-banner' } },
            el('strong', null, t('brokenJsonTitle', loc)),
            el('div', null, err?.message || t('brokenJsonFallback')),
            canRestore
              ? el(
                  'div',
                  { className: 'mcp-banner-actions' },
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'mcp-btn mcp-btn-sm',
                      dataset: { testid: 'btn-restore-backup' },
                      onClick: () => void handleRestoreBackup(),
                    },
                    t('restoreBackup')
                  )
                )
              : null
          )
        );
      }

      if (bannerState) {
        bannerRegion.appendChild(
          el(
            'div',
            {
              className: `mcp-banner ${
                bannerState.kind === 'error'
                  ? 'mcp-banner-error'
                  : bannerState.kind === 'info'
                    ? 'mcp-banner-info'
                    : 'mcp-banner-warn'
              }`,
              role: 'alert',
              dataset: { testid: 'status-banner' },
            },
            el('div', null, bannerState.message),
            bannerState.actions?.length
              ? el(
                  'div',
                  { className: 'mcp-banner-actions' },
                  bannerState.actions.map((a) =>
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'mcp-btn mcp-btn-sm',
                        dataset: a.testid ? { testid: a.testid } : undefined,
                        onClick: a.onClick,
                      },
                      a.label
                    )
                  )
                )
              : null
          )
        );
      }
    }

    function renderSmartPasteCard() {
      const inputEl = el('textarea', {
        rows: '3',
        className: 'mcp-textarea',
        value: pasteInputDraft,
        placeholder: t('smartPastePlaceholder'),
        dataset: { testid: 'smart-paste-input' },
        onInput: (e) => {
          pasteInputDraft = e.target.value;
        },
        onKeydown: (e) => {
          if (isImeComposing(e)) return;
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            runPreview();
          }
        },
      });

      function runPreview() {
        pastePreview = service.previewSmartPaste(inputEl.value || pasteInputDraft);
        renderAll();
      }

      const previewNodes = [];
      if (pastePreview) {
        if (pastePreview.errors?.length) {
          previewNodes.push(el('div', { className: 'mcp-banner mcp-banner-error' }, pastePreview.errors.join(' ')));
        }
        for (const entry of pastePreview.entries || []) {
          previewNodes.push(
            el(
              'div',
              { className: 'mcp-card', dataset: { testid: 'paste-preview-entry' } },
              el(
                'div',
                { className: 'mcp-server-header' },
                el('span', { className: 'mcp-server-name' }, entry.name),
                el('span', { className: 'mcp-badge mcp-badge-muted' }, entry.transport || t('transportUnknown'))
              ),
              entry.warnings?.length ? el('div', { className: 'mcp-badge mcp-badge-warn' }, entry.warnings.join(' ')) : null,
              el(
                'div',
                { className: 'mcp-row-actions' },
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'mcp-btn mcp-btn-primary mcp-btn-sm',
                    dataset: { testid: 'btn-load-paste-entry' },
                    onClick: () => {
                      openEditorForServer({ name: entry.name, spec: entry.spec, disabled: false });
                      editorState.mode = 'create';
                      editorState.originalName = null;
                      pastePreview = null;
                      renderAll();
                    },
                  },
                  t('loadIntoEditor')
                ),
                entry.mcpRemotePreview
                  ? el(
                      'button',
                      {
                        type: 'button',
                        className: 'mcp-btn mcp-btn-sm',
                        onClick: () => {
                          openEditorForServer({ name: entry.name, spec: entry.mcpRemotePreview, disabled: false });
                          editorState.mode = 'create';
                          editorState.originalName = null;
                          pastePreview = null;
                          renderAll();
                        },
                      },
                      t('useMcpRemoteTemplate')
                    )
                  : null
              )
            )
          );
        }
      }

      return el(
        'section',
        { className: 'mcp-card', dataset: { testid: 'smart-paste-card' } },
        el(
          'div',
          { className: 'mcp-server-header' },
          el('strong', null, t('smartPasteTitle')),
          el(
            'button',
            {
              type: 'button',
              className: 'mcp-btn mcp-btn-sm',
              onClick: () => {
                smartPasteOpen = false;
                pastePreview = null;
                renderAll();
              },
            },
            t('hideQuickPaste')
          )
        ),
        inputEl,
        el(
          'div',
          { className: 'mcp-row-actions' },
          el(
            'button',
            {
              type: 'button',
              className: 'mcp-btn mcp-btn-sm',
              dataset: { testid: 'btn-preview-paste' },
              onClick: runPreview,
            },
            t('previewPaste')
          )
        ),
        previewNodes
      );
    }

    function renderKvEditor(label, rows) {
      const container = el('div', { className: 'mcp-field' }, el('label', null, label));
      rows.forEach((row, idx) => {
        container.appendChild(
          el(
            'div',
            { className: 'mcp-kv-row' },
            el('input', {
              type: 'text',
              className: 'mcp-input',
              placeholder: t('kvKeyPlaceholder'),
              value: row.key,
              onInput: (e) => {
                row.key = e.target.value;
              },
            }),
            el('input', {
              type: 'password',
              className: 'mcp-input',
              autocomplete: 'off',
              placeholder: t('kvValuePlaceholder'),
              value: row.value,
              dataset: { secretInput: 'true' },
              onInput: (e) => {
                row.value = e.target.value;
              },
            }),
            el(
              'button',
              {
                type: 'button',
                className: 'mcp-btn mcp-btn-danger mcp-btn-sm',
                onClick: () => {
                  rows.splice(idx, 1);
                  renderAll();
                },
              },
              t('remove')
            )
          )
        );
      });
      container.appendChild(
        el(
          'button',
          {
            type: 'button',
            className: 'mcp-btn mcp-btn-sm',
            onClick: () => {
              rows.push({ key: '', value: '' });
              renderAll();
            },
          },
          t('addKvItem', label)
        )
      );
      return container;
    }

    function renderEditorCard() {
      if (!editorState) return null;
      const isStdio = editorState.transport === 'stdio';
      return el(
        'section',
        {
          className: 'mcp-card',
          dataset: { testid: 'server-editor-card' },
          onKeydown: (e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              scrubSensitiveState({ keepRawIfMalformed: true });
              renderAll();
            }
          },
        },
        el(
          'strong',
          null,
          editorState.mode === 'edit' ? t('editServerTitle', editorState.originalName) : t('addGlobalServerTitle')
        ),
        el(
          'div',
          { className: 'mcp-field' },
          el('label', null, t('serverNameLabel')),
          el('input', {
            type: 'text',
            className: 'mcp-input',
            value: editorState.name,
            dataset: { testid: 'input-server-name' },
            onInput: (e) => {
              editorState.name = e.target.value;
            },
          })
        ),
        el(
          'div',
          { className: 'mcp-field' },
          el('label', null, t('transportLabel')),
          el(
            'select',
            {
              className: 'mcp-select',
              value: editorState.transport,
              dataset: { testid: 'select-transport' },
              onChange: (e) => {
                editorState.transport = e.target.value;
                pendingStdioConfirm = null;
                renderAll();
              },
            },
            el('option', { value: 'streamable_http', selected: !isStdio }, t('transportHttpOption')),
            el('option', { value: 'stdio', selected: isStdio }, t('transportStdioOption'))
          )
        ),
        isStdio
          ? [
              el(
                'div',
                { className: 'mcp-field' },
                el('label', null, t('commandLabel')),
                el('input', {
                  type: 'text',
                  className: 'mcp-input',
                  value: editorState.command,
                  placeholder: 'node / npx / uvx',
                  dataset: { testid: 'input-stdio-command' },
                  onInput: (e) => {
                    editorState.command = e.target.value;
                  },
                })
              ),
              el(
                'div',
                { className: 'mcp-field' },
                el('label', null, t('argsLabel')),
                el('textarea', {
                  rows: '3',
                  className: 'mcp-textarea',
                  value: editorState.argsText,
                  dataset: { testid: 'input-stdio-args' },
                  onInput: (e) => {
                    editorState.argsText = e.target.value;
                  },
                })
              ),
              renderKvEditor(t('envVarLabel'), editorState.envRows),
            ]
          : [
              el(
                'div',
                { className: 'mcp-field' },
                el('label', null, t('endpointUrlLabel')),
                el('input', {
                  type: 'text',
                  className: 'mcp-input',
                  value: editorState.url,
                  placeholder: 'https://example.com/mcp',
                  dataset: { testid: 'input-http-url' },
                  onInput: (e) => {
                    editorState.url = e.target.value;
                  },
                })
              ),
              renderKvEditor(t('httpHeaderLabel'), editorState.headerRows),
            ],
        pendingStdioConfirm?.kind === 'upsert' ? renderStdioConfirmPanel() : null,
        el(
          'div',
          { className: 'mcp-row-actions' },
          el(
            'button',
            {
              type: 'button',
              className: 'mcp-btn mcp-btn-primary',
              dataset: { testid: 'btn-save-server' },
              onClick: () => void submitEditor(false),
            },
            t('save')
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'mcp-btn',
              dataset: { testid: 'btn-cancel-editor' },
              onClick: () => {
                scrubSensitiveState({ keepRawIfMalformed: true });
                renderAll();
              },
            },
            t('cancel')
          )
        )
      );
    }

    function renderRemoteBridgeDisconnectedNotice({ card = false } = {}) {
      if (card) {
        return el(
          'section',
          { className: 'mcp-card', dataset: { testid: 'remote-bridge-disconnected-notice' } },
          el('strong', null, t('remoteBridgeDisconnectedTitle')),
          el('div', { className: 'mcp-subtitle' }, t('remoteBridgeDisconnectedNotice')),
          el(
            'div',
            { className: 'mcp-row-actions' },
            el(
              'button',
              {
                type: 'button',
                className: 'mcp-btn mcp-btn-sm',
                dataset: { testid: 'btn-retry-remote-bridge' },
                onClick: () => void loadSnapshot(activeTab === 'raw'),
              },
              t('refresh')
            )
          )
        );
      }
      return el(
        'div',
        { className: 'mcp-banner mcp-banner-info', dataset: { testid: 'remote-bridge-disconnected-notice' } },
        el('span', null, t('remoteBridgeDisconnectedNotice'))
      );
    }

    function renderServersTab() {
      if (isRemoteBridgeDisconnectedMode()) {
        return [renderRemoteBridgeDisconnectedNotice({ card: true })];
      }
      const nodes = [];
      if (shouldShowRemoteBridgeGuide()) {
        nodes.push(renderRemoteBridgeDisconnectedNotice({ card: false }));
      }
      if (isRemoteDraftMode()) {
        nodes.push(renderRemoteIoBar());
      }
      if (pendingStdioConfirm && (pendingStdioConfirm.kind === 'clone' || pendingStdioConfirm.kind === 'legacy' || (isRemoteDraftMode() && pendingStdioConfirm.kind === 'raw'))) {
        nodes.push(renderStdioConfirmPanel());
      }

      if (snapshot?.legacyImport?.exists && !legacyDismissed) {
        nodes.push(
          el(
            'div',
            { className: 'mcp-banner mcp-banner-warn', dataset: { testid: 'legacy-import-banner' } },
            el('strong', null, t('legacyDetected', snapshot.legacyImport.servers.length)),
            el('div', { className: 'mcp-server-meta' }, snapshot.legacyImport.displayPath),
            el(
              'div',
              { className: 'mcp-banner-actions' },
              snapshot.legacyImport.servers.map((ls) =>
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'mcp-btn mcp-btn-sm',
                    dataset: { testid: `btn-import-legacy-${ls.name}` },
                    onClick: () => void submitImportLegacy(ls, false),
                  },
                  t('importNamed', ls.name)
                )
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'mcp-btn mcp-btn-sm',
                  onClick: () => {
                    legacyDismissed = true;
                    renderAll();
                  },
                },
                t('dismiss')
              )
            )
          )
        );
      }

      if (editorState) {
        nodes.push(renderEditorCard());
      } else if (!snapshot?.globalConfig?.malformed) {
        if (!smartPasteOpen) {
          nodes.push(
            el(
              'div',
              { className: 'mcp-toolbar-row' },
              el('span', { className: 'mcp-subtitle' }, t('settingsSubtitle')),
              el(
                'button',
                {
                  type: 'button',
                  className: 'mcp-btn mcp-btn-sm',
                  dataset: { testid: 'btn-toggle-smart-paste' },
                  onClick: () => {
                    smartPasteOpen = true;
                    renderAll();
                  },
                },
                t('quickPasteBtn')
              )
            )
          );
        } else {
          nodes.push(renderSmartPasteCard());
        }
      }

      const formatTransport = (tr) =>
        tr === 'streamable_http' ? 'HTTP' : tr === 'stdio' ? 'Stdio' : tr || t('transportUnknown');
      const globalServers = snapshot?.globalConfig?.servers || [];
      nodes.push(el('h2', { className: 'mcp-section-title' }, t('globalServersTitle', globalServers.length)));
      const globalList = el('div', { className: 'mcp-server-list' });
      for (const s of globalServers) {
        const rtStatus = s.disabled
          ? t('statusDisabled')
          : s.runtime?.status === 'MCP_SERVER_STATUS_READY'
            ? t('statusReady')
            : s.runtime?.status || t('statusConfigured');
        const badgeClass = s.disabled
          ? 'mcp-badge-muted'
          : s.runtime?.error
            ? 'mcp-badge-err'
            : s.runtime?.status === 'MCP_SERVER_STATUS_READY'
              ? 'mcp-badge-ok'
              : 'mcp-badge-muted';
        globalList.appendChild(
          el(
            'div',
            {
              className: `mcp-server-row${s.disabled ? ' mcp-row-disabled' : ''}`,
              dataset: { testid: `global-server-${s.name}` },
            },
            el(
              'div',
              { className: 'mcp-server-info' },
              el(
                'div',
                { className: 'mcp-server-header' },
                el('span', { className: 'mcp-server-name' }, s.name),
                el(
                  'div',
                  { className: 'mcp-server-badges' },
                  el(
                    'span',
                    { className: `mcp-badge ${badgeClass}` },
                    `${rtStatus}${s.runtime?.toolCount ? t('toolsSuffix', s.runtime.toolCount) : ''}`
                  ),
                  el('span', { className: 'mcp-badge mcp-badge-muted' }, formatTransport(s.transport))
                )
              ),
              el('div', { className: 'mcp-server-meta' }, s.spec?.url || s.spec?.serverUrl || s.spec?.command || ''),
              s.runtime?.error ? el('div', { className: 'mcp-badge mcp-badge-err' }, s.runtime.error) : null
            ),
            el(
              'div',
              { className: 'mcp-row-actions mcp-server-row-actions' },
              el(
                'button',
                {
                  type: 'button',
                  className: 'mcp-btn mcp-btn-sm',
                  dataset: { testid: `btn-toggle-${s.name}` },
                  onClick: () => void handleToggleDisabled(s),
                },
                s.disabled ? t('enable') : t('disable')
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'mcp-btn mcp-btn-sm',
                  dataset: { testid: `btn-edit-${s.name}` },
                  onClick: () => openEditorForServer(s),
                },
                t('edit')
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'mcp-btn mcp-btn-danger mcp-btn-sm',
                  dataset: { testid: `btn-delete-${s.name}` },
                  onClick: () => void handleDelete(s),
                },
                t('delete')
              )
            )
          )
        );
      }
      if (globalServers.length === 0) {
        globalList.appendChild(el('div', { className: 'mcp-empty-row' }, t('noGlobalServers')));
      }
      nodes.push(globalList);

      const pluginServers = snapshot?.pluginServers || [];
      if (pluginServers.length > 0) {
        nodes.push(el('h2', { className: 'mcp-section-title' }, t('pluginServersTitle', pluginServers.length)));
        const pluginList = el('div', { className: 'mcp-server-list' });
        for (const ps of pluginServers) {
          const collision = (snapshot.collisions?.pluginCollisions || []).find(
            (c) => c.pluginDir === ps.pluginDir && c.serverName === ps.name
          );
          const safePluginKey = String(ps.pluginId || ps.pluginDir).replace(/[^a-zA-Z0-9_-]/g, '-');
          pluginList.appendChild(
            el(
              'div',
              { className: 'mcp-server-row', dataset: { testid: `plugin-server-${safePluginKey}-${ps.name}` } },
              el(
                'div',
                { className: 'mcp-server-info' },
                el(
                  'div',
                  { className: 'mcp-server-header' },
                  el('span', { className: 'mcp-server-name' }, ps.name),
                  el(
                    'div',
                    { className: 'mcp-server-badges' },
                    el('span', { className: 'mcp-badge mcp-badge-muted' }, t('pluginBadge', ps.pluginName, ps.pluginDisabled)),
                    collision ? el('span', { className: 'mcp-badge mcp-badge-warn' }, t('collidesWithGlobal', collision.globalName)) : null
                  )
                ),
                el('div', { className: 'mcp-server-meta' }, ps.spec?.url || ps.spec?.serverUrl || ps.spec?.command || '')
              ),
              el(
                'div',
                { className: 'mcp-row-actions mcp-server-row-actions' },
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'mcp-btn mcp-btn-sm',
                    dataset: { testid: `btn-clone-${safePluginKey}-${ps.name}` },
                    onClick: () => void submitClonePlugin(ps, false),
                  },
                  t('cloneToGlobal')
                )
              )
            )
          );
        }
        nodes.push(pluginList);
      }

      return nodes;
    }

    function renderRawTab() {
      if (isRemoteBridgeDisconnectedMode()) {
        return [renderRemoteBridgeDisconnectedNotice({ card: true })];
      }
      const ta = el('textarea', {
        className: 'mcp-textarea mcp-mono',
        value: rawDraft,
        dataset: { testid: 'raw-json-textarea' },
        onInput: (e) => {
          rawDraft = e.target.value;
          rawDraftDirty = true;
        },
      });
      return [
        shouldShowRemoteBridgeGuide() ? renderRemoteBridgeDisconnectedNotice({ card: false }) : null,
        isRemoteDraftMode() ? renderRemoteIoBar() : null,
        el(
          'section',
          { className: 'mcp-card' },
          el('strong', null, snapshot?.globalConfig?.displayPath || '~/.gemini/config/mcp_config.json'),
          ta,
          pendingStdioConfirm?.kind === 'raw' ? renderStdioConfirmPanel() : null,
          el(
            'div',
            { className: 'mcp-row-actions' },
            el(
              'button',
              {
                type: 'button',
                className: 'mcp-btn mcp-btn-primary',
                dataset: { testid: 'btn-save-raw' },
                onClick: () => void submitRawJson(false),
              },
              t('validateAndSaveRaw')
            )
          )
        ),
      ];
    }

    function syncStaticLabels() {
      const lang = getLang();
      const currentMode = getPanelMode();
      root.setAttribute('data-agy-mcp-lang', lang);
      root.setAttribute('data-agy-mcp-mode', currentMode);
      if (titleEl) titleEl.textContent = t('appTitle');
      statusBadge.className =
        currentMode === 'remote-bridge-disconnected'
          ? 'mcp-badge mcp-badge-warn'
          : currentMode === 'remote-draft'
            ? 'mcp-badge mcp-badge-info'
            : 'mcp-badge mcp-badge-ok';
      statusBadge.textContent =
        busy && !snapshot
          ? t('loading')
          : currentMode === 'remote-bridge-disconnected'
            ? t('remoteBridgeDisconnectedBadge')
            : currentMode === 'remote-draft'
              ? t('remoteDraftBadge')
              : t('bridgeConnected');
      langSwitch.setAttribute('aria-label', t('langAria'));
      btnLangEn.setAttribute('aria-pressed', lang === 'en' ? 'true' : 'false');
      btnLangKo.setAttribute('aria-pressed', lang === 'ko' ? 'true' : 'false');
      btnRefresh.textContent = t('refresh');
      btnAdd.textContent = t('addServer');
      tabServers.textContent = t('tabServers');
      tabRaw.textContent = t('tabRaw');
    }

    function renderAll() {
      if (disposed) return;
      setClassFlag(tabServers, 'active', activeTab === 'servers');
      tabServers.setAttribute('aria-selected', String(activeTab === 'servers'));
      setClassFlag(tabRaw, 'active', activeTab === 'raw');
      tabRaw.setAttribute('aria-selected', String(activeTab === 'raw'));
      renderBanners();
      clearNode(mainRegion);
      const content = activeTab === 'raw' ? renderRawTab() : renderServersTab();
      for (const node of content) {
        if (node) mainRegion.appendChild(node);
      }
    }

    function syncLang() {
      if (disposed) return;
      syncStaticLabels();
      renderAll();
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      scrubSensitiveState({ keepRawIfMalformed: false });
      clearNode(root);
    }

    syncStaticLabels();
    renderAll();
    void loadSnapshot(false);

    return Object.freeze({
      element: root,
      syncLang,
      refresh: () => loadSnapshot(activeTab === 'raw'),
      dispose,
    });
  }

  // --- module: addon-styles.mjs ---
  /**
   * Tier-3 Canvas CSS Definitions (`src/adapters/antigravity/renderer/addon-styles.mjs`).
   *
   * SOLID Responsibility (SRP):
   * - Declares Extenra (`extenra` v3.2.1) `--ag-*` semantic theme-tokenized CSS for the Tier-3
   *   `NativeMcpPanel` mounted inside host-managed Shadow DOM overlays (`ui.openModal` /
   *   `ui.registerSettingsPage`) via `ctx.ui.createStyleElementSafe(buildNativePanelCss())`.
   * - Aligns with Extenra v3.2.1 tokens (`--ag-primary`, `--ag-primary-hover`, `--ag-primary-fg`,
   *   `--ag-input-bg`, `--ag-surface-hover`, `--ag-border-strong`, `--ag-focus-ring`,
   *   `--ag-scrollbar-thumb`, `--ag-scrollbar-thumb-hover`, `--ag-radius`) with v3.1.x fallbacks.
   * - 100% compliant with Extenra `validateSafeCssText` (zero `@import`, zero CSS nesting,
   *   zero `:has(`, zero unsafe URLs or `data:` URIs).
   */
  function buildNativePanelCss() {
    return [
      '[data-agy-mcp-native-panel="true"] {',
      '  box-sizing: border-box;',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  overflow: auto;',
      '  color: var(--ag-text, #f1f5f9);',
      '  font-family: var(--ag-font, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif);',
      '  font-size: 13px;',
      '  line-height: 1.5;',
      '  scrollbar-width: thin;',
      '  scrollbar-color: var(--ag-scrollbar-thumb, rgba(148, 163, 184, 0.28)) transparent;',
      '}',
      '[data-agy-mcp-native-panel="true"]::-webkit-scrollbar,',
      '[data-agy-mcp-native-panel="true"] .mcp-textarea::-webkit-scrollbar {',
      '  width: 6px;',
      '  height: 6px;',
      '}',
      '[data-agy-mcp-native-panel="true"]::-webkit-scrollbar-track,',
      '[data-agy-mcp-native-panel="true"] .mcp-textarea::-webkit-scrollbar-track {',
      '  background: transparent;',
      '}',
      '[data-agy-mcp-native-panel="true"]::-webkit-scrollbar-thumb,',
      '[data-agy-mcp-native-panel="true"] .mcp-textarea::-webkit-scrollbar-thumb {',
      '  background: var(--ag-scrollbar-thumb, rgba(148, 163, 184, 0.28));',
      '  border-radius: 999px;',
      '}',
      '[data-agy-mcp-native-panel="true"]::-webkit-scrollbar-thumb:hover,',
      '[data-agy-mcp-native-panel="true"] .mcp-textarea::-webkit-scrollbar-thumb:hover {',
      '  background: var(--ag-scrollbar-thumb-hover, rgba(148, 163, 184, 0.46));',
      '}',
      '[data-agy-mcp-native-panel="true"]::-webkit-scrollbar-corner,',
      '[data-agy-mcp-native-panel="true"] .mcp-textarea::-webkit-scrollbar-corner {',
      '  background: transparent;',
      '}',
      '[data-agy-mcp-native-panel="true"] * {',
      '  box-sizing: border-box;',
      '}',
      '[data-agy-mcp-native-panel="true"] .mcp-shell {',
      '  width: 100%;',
      '  max-width: 780px;',
      '  margin: 0 auto;',
      '  padding: 6px 4px 16px;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 12px;',
      '}',
      '[data-agy-mcp-native-panel="true"][data-agy-mcp-inline="true"] {',
      '  height: auto;',
      '  overflow: visible;',
      '}',
      '[data-agy-mcp-native-panel="true"][data-agy-mcp-inline="true"] .mcp-shell {',
      '  max-width: 860px;',
      '  margin: 0;',
      '  padding: 0 0 12px;',
      '}',
      '.mcp-header {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 10px;',
      '  flex-wrap: wrap;',
      '}',
      '.mcp-title-group {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 10px;',
      '  flex-wrap: wrap;',
      '}',
      '.mcp-title {',
      '  margin: 0;',
      '  font-size: 18px;',
      '  font-weight: 600;',
      '  letter-spacing: -0.02em;',
      '  line-height: 1.3;',
      '  color: var(--ag-text, #f1f5f9);',
      '}',
      '.mcp-header-actions {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  flex-wrap: wrap;',
      '}',
      '.mcp-lang-switch {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 2px;',
      '  padding: 2px;',
      '  border: 1px solid var(--ag-border-strong, rgba(255, 255, 255, 0.16));',
      '  border-radius: 8px;',
      '  background: var(--ag-surface-elevated, rgba(255, 255, 255, 0.04));',
      '}',
      '.mcp-lang-btn {',
      '  background: transparent;',
      '  color: var(--ag-text, #f1f5f9);',
      '  opacity: 0.78;',
      '  border: 0;',
      '  border-radius: 6px;',
      '  padding: 4px 9px;',
      '  cursor: pointer;',
      '  font-family: inherit;',
      '  font-size: 11.5px;',
      '  font-weight: 500;',
      '  line-height: 1.3;',
      '  transition: background-color 140ms ease, color 140ms ease, opacity 140ms ease;',
      '}',
      '.mcp-lang-btn:hover {',
      '  background: var(--ag-surface-hover, rgba(255, 255, 255, 0.08));',
      '  opacity: 1;',
      '}',
      '.mcp-lang-btn[aria-pressed="true"] {',
      '  background: var(--ag-primary, #2563eb);',
      '  color: var(--ag-primary-fg, #ffffff);',
      '  opacity: 1;',
      '}',
      '.mcp-lang-btn:focus-visible {',
      '  outline: 2px solid var(--ag-primary, #2563eb);',
      '  outline-offset: 1px;',
      '}',
      '.mcp-tabs {',
      '  display: inline-flex;',
      '  align-self: flex-start;',
      '  gap: 2px;',
      '  padding: 3px;',
      '  border: 1px solid var(--ag-border-strong, rgba(255, 255, 255, 0.16));',
      '  border-radius: 9px;',
      '  background: var(--ag-surface-elevated, rgba(255, 255, 255, 0.04));',
      '}',
      '.mcp-tab {',
      '  background: transparent;',
      '  color: var(--ag-text, #f1f5f9);',
      '  opacity: 0.78;',
      '  border: 0;',
      '  border-radius: 6px;',
      '  padding: 5px 12px;',
      '  cursor: pointer;',
      '  font-family: inherit;',
      '  font-size: 12px;',
      '  font-weight: 500;',
      '  transition: background-color 140ms ease, opacity 140ms ease;',
      '}',
      '.mcp-tab:hover {',
      '  background: var(--ag-surface-hover, rgba(255, 255, 255, 0.08));',
      '  opacity: 1;',
      '}',
      '.mcp-tab.active {',
      '  background: rgba(148, 163, 184, 0.24);',
      '  opacity: 1;',
      '}',
      '.mcp-tab:focus-visible {',
      '  outline: 2px solid var(--ag-primary, #2563eb);',
      '  outline-offset: 1px;',
      '}',
      '.mcp-btn {',
      '  border-radius: 8px;',
      '  padding: 6px 12px;',
      '  font-family: inherit;',
      '  font-size: 12px;',
      '  font-weight: 500;',
      '  cursor: pointer;',
      '  border: 1px solid var(--ag-border-strong, rgba(255, 255, 255, 0.16));',
      '  background: var(--ag-surface-elevated, rgba(255, 255, 255, 0.04));',
      '  color: var(--ag-text, #f1f5f9);',
      '  line-height: 1.3;',
      '  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;',
      '}',
      '.mcp-btn:hover {',
      '  background: var(--ag-surface-hover, rgba(255, 255, 255, 0.08));',
      '  border-color: var(--ag-primary, #2563eb);',
      '}',
      '.mcp-btn:focus-visible {',
      '  outline: 2px solid var(--ag-primary, #2563eb);',
      '  outline-offset: 1px;',
      '}',
      '.mcp-btn-primary {',
      '  background: var(--ag-primary, #2563eb);',
      '  color: var(--ag-primary-fg, #ffffff);',
      '  border-color: transparent;',
      '  font-weight: 600;',
      '}',
      '.mcp-btn-primary:hover {',
      '  background: var(--ag-primary-hover, #3b82f6);',
      '  border-color: transparent;',
      '}',
      '.mcp-btn-danger {',
      '  background: transparent;',
      '  color: var(--ag-danger, #ef4444);',
      '  border-color: rgba(239, 68, 68, 0.42);',
      '}',
      '.mcp-btn-danger:hover {',
      '  background: rgba(239, 68, 68, 0.14);',
      '  border-color: var(--ag-danger, #ef4444);',
      '}',
      '.mcp-btn-sm {',
      '  padding: 4px 10px;',
      '  font-size: 11.5px;',
      '}',
      '.mcp-badge {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  padding: 2px 8px;',
      '  border-radius: 999px;',
      '  font-size: 11px;',
      '  font-weight: 500;',
      '  border: 1px solid var(--ag-border-strong, rgba(255, 255, 255, 0.16));',
      '  background: rgba(148, 163, 184, 0.14);',
      '}',
      '.mcp-badge-ok {',
      '  color: var(--ag-success, #4ade80);',
      '  border-color: rgba(74, 222, 128, 0.42);',
      '  background: rgba(74, 222, 128, 0.12);',
      '}',
      '.mcp-badge-info {',
      '  color: var(--ag-accent, #38bdf8);',
      '  border-color: rgba(56, 189, 248, 0.42);',
      '  background: rgba(56, 189, 248, 0.12);',
      '}',
      '.mcp-badge-warn {',
      '  color: var(--ag-warning, #fbbf24);',
      '  border-color: rgba(251, 191, 36, 0.45);',
      '  background: rgba(251, 191, 36, 0.12);',
      '}',
      '.mcp-badge-err {',
      '  color: var(--ag-danger, #ef4444);',
      '  border-color: rgba(239, 68, 68, 0.45);',
      '  background: rgba(239, 68, 68, 0.12);',
      '}',
      '.mcp-badge-muted {',
      '  color: var(--ag-text-muted, #94a3b8);',
      '}',
      '.mcp-remote-io-bar {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 8px;',
      '  flex-wrap: wrap;',
      '  padding: 9px 12px;',
      '  border-radius: 10px;',
      '  border: 1px solid rgba(56, 189, 248, 0.34);',
      '  background: rgba(56, 189, 248, 0.08);',
      '}',
      '.mcp-remote-io-hint {',
      '  font-size: 12px;',
      '  color: var(--ag-text, #f1f5f9);',
      '  opacity: 0.9;',
      '  flex: 1 1 220px;',
      '}',
      '.mcp-file-input-hidden {',
      '  display: none;',
      '}',
      '.mcp-banner-region {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 8px;',
      '}',
      '.mcp-main-region {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 12px;',
      '}',
      '.mcp-banner {',
      '  padding: 10px 12px;',
      '  border-radius: 10px;',
      '  border: 1px solid var(--ag-border-strong, rgba(255, 255, 255, 0.16));',
      '  background: var(--ag-surface-elevated, rgba(255, 255, 255, 0.04));',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 6px;',
      '}',
      '.mcp-banner-error {',
      '  border-color: var(--ag-danger, #ef4444);',
      '  background: rgba(239, 68, 68, 0.10);',
      '}',
      '.mcp-banner-warn {',
      '  border-color: var(--ag-warning, #fbbf24);',
      '  background: rgba(251, 191, 36, 0.10);',
      '}',
      '.mcp-banner-info {',
      '  border-color: var(--ag-accent, #38bdf8);',
      '  background: rgba(56, 189, 248, 0.10);',
      '}',
      '.mcp-banner-actions {',
      '  display: flex;',
      '  gap: 6px;',
      '  flex-wrap: wrap;',
      '}',
      '.mcp-toolbar-row {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 10px;',
      '  flex-wrap: wrap;',
      '}',
      '.mcp-subtitle {',
      '  color: var(--ag-text-muted, #94a3b8);',
      '  font-size: 12.5px;',
      '}',
      '.mcp-section-title {',
      '  margin: 4px 0 0;',
      '  font-size: 13.5px;',
      '  font-weight: 600;',
      '  letter-spacing: -0.01em;',
      '}',
      '.mcp-server-list {',
      '  display: flex;',
      '  flex-direction: column;',
      '  border: 1px solid var(--ag-border, rgba(255, 255, 255, 0.09));',
      '  border-radius: var(--ag-radius, 12px);',
      '  background: var(--ag-surface-elevated, rgba(255, 255, 255, 0.04));',
      '  overflow: hidden;',
      '}',
      '.mcp-server-row {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 14px;',
      '  padding: 12px 14px;',
      '  border-bottom: 1px solid var(--ag-border, rgba(255, 255, 255, 0.09));',
      '}',
      '.mcp-server-row:last-child {',
      '  border-bottom: 0;',
      '}',
      '.mcp-server-row.mcp-row-disabled {',
      '  opacity: 0.65;',
      '}',
      '.mcp-empty-row {',
      '  padding: 14px;',
      '  color: var(--ag-text-muted, #94a3b8);',
      '  font-size: 12.5px;',
      '}',
      '.mcp-server-info {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 4px;',
      '  min-width: 0;',
      '  flex: 1 1 auto;',
      '}',
      '.mcp-server-header {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 8px;',
      '  flex-wrap: wrap;',
      '}',
      '.mcp-server-info .mcp-server-header {',
      '  justify-content: flex-start;',
      '}',
      '.mcp-server-name {',
      '  font-size: 13.5px;',
      '  font-weight: 600;',
      '  word-break: break-word;',
      '}',
      '.mcp-server-badges {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 5px;',
      '  flex-wrap: wrap;',
      '}',
      '.mcp-server-meta {',
      '  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;',
      '  font-size: 11.5px;',
      '  color: var(--ag-text-muted, #94a3b8);',
      '  word-break: break-all;',
      '}',
      '.mcp-row-actions {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  flex-wrap: wrap;',
      '}',
      '.mcp-server-row-actions {',
      '  flex-shrink: 0;',
      '}',
      '.mcp-card {',
      '  border: 1px solid var(--ag-border, rgba(255, 255, 255, 0.09));',
      '  border-radius: var(--ag-radius, 12px);',
      '  padding: 14px 16px;',
      '  background: var(--ag-surface-elevated, rgba(255, 255, 255, 0.04));',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 10px;',
      '}',
      '.mcp-field {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 4px;',
      '}',
      '.mcp-field label {',
      '  font-size: 12px;',
      '  color: var(--ag-text-muted, #94a3b8);',
      '}',
      '.mcp-input, .mcp-select, .mcp-textarea {',
      '  width: 100%;',
      '  background: var(--ag-input-bg, var(--ag-bg, #0d1117));',
      '  color: var(--ag-text, #f1f5f9);',
      '  border: 1px solid var(--ag-border-strong, rgba(255, 255, 255, 0.16));',
      '  border-radius: 8px;',
      '  padding: 7px 10px;',
      '  font-family: inherit;',
      '  font-size: 12.5px;',
      '  transition: border-color 140ms ease, box-shadow 140ms ease;',
      '}',
      '.mcp-textarea {',
      '  min-height: 92px;',
      '  scrollbar-width: thin;',
      '  scrollbar-color: var(--ag-scrollbar-thumb, rgba(148, 163, 184, 0.28)) transparent;',
      '}',
      '.mcp-input:focus-visible, .mcp-select:focus-visible, .mcp-textarea:focus-visible {',
      '  outline: 2px solid var(--ag-primary, #2563eb);',
      '  outline-offset: 1px;',
      '  box-shadow: 0 0 0 3px var(--ag-focus-ring, rgba(59, 130, 246, 0.32));',
      '}',
      '.mcp-textarea.mcp-mono {',
      '  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;',
      '  min-height: 220px;',
      '  resize: vertical;',
      '}',
      '.mcp-kv-row {',
      '  display: grid;',
      '  grid-template-columns: 1fr 1fr auto;',
      '  gap: 6px;',
      '  align-items: center;',
      '}',
      '@media (prefers-reduced-motion: reduce) {',
      '  .mcp-lang-btn, .mcp-tab, .mcp-btn, .mcp-input, .mcp-select, .mcp-textarea {',
      '    transition: none;',
      '  }',
      '}',
    ].join('\n');
  }

  // --- module: mcp-v3-shell.mjs ---
  /**
   * AddonContextV3 3-Tier API-First UI Shell (`src/adapters/antigravity/renderer/mcp-v3-shell.mjs`).
   *
   * SOLID Boundaries:
   * - SRP: Connects Antigravity MCP Manager exclusively through `AddonContextV3` 3-Tier host APIs:
   *   - Tier 1 (Zero-DOM): `registerStatusItem`, `registerSettingsPage`, `registerCommand`, `showToast`, `confirm`
   *   - Tier 2 (Declarative Host Panel): `openPanel` with 16 closed schema primitives + `handle.update(nextTree, nextState)`
   *     ID-based in-place patching and host-managed mobile bottom-sheet auto-switching (`<=640px`)
   *   - Tier 3 (Host Shadow Canvas): `openModal` + Settings Page `render(canvasRoot)` mounting `NativeMcpPanel`
   *     styled with `ctx.ui.createStyleElementSafe(buildNativePanelCss())`
   * - Zero manual DOM queries, zero coordinate math, zero `hostProfileId` checks, clean `AbortSignal` / `onDispose`.
   */
  const V3_IDS = Object.freeze({
    STATUS_ITEM: 'mcp-manager',
    SECTION_ACTION: 'mcp-manager',
    SECTION_TARGET: 'customizations.mcp-servers.header',
    SETTINGS_PAGE: 'mcp-manager',
    CMD_OPEN_MANAGER: 'open-mcp-manager',
    CMD_OPEN_PANEL: 'open-mcp-panel',
    CMD_OPEN_SETTINGS: 'open-mcp-settings',
  });

  const SHELL_I18N = Object.freeze({
    en: Object.freeze({
      title: 'MCP Manager',
      panelTitle: 'MCP Manager · Quick Overview',
      statusLabel: 'MCP',
      statusTooltip: (mode, count) =>
        mode === 'host-bridge'
          ? `MCP Manager (Host Bridge · ${count} servers)`
          : mode === 'remote-bridge-disconnected'
            ? 'MCP Manager (Host Bridge Disconnected)'
            : `MCP Manager (Remote Draft · ${count} servers)`,
      cmdOpenManager: 'Open MCP Manager',
      cmdOpenPanel: 'Open MCP Quick Panel',
      cmdOpenSettings: 'Open MCP Manager Settings',
      modeHostBridge: 'Host Bridge Connected',
      modeRemoteBridgeDisconnected: 'Host Bridge Disconnected',
      modeRemoteDraft: 'Remote Draft (ctx.storage)',
      remoteBridgeDisconnectedNotice:
        'Connect your Desktop host in the bottom-right Addons → Host Bridge tab on Remote Web.',
      summaryHeading: 'Configured MCP Servers',
      summaryLine: (globalCount, enabledCount, pluginCount) =>
        `Global: ${globalCount} (${enabledCount} active) · Plugins: ${pluginCount}`,
      malformedAlert: 'Broken mcp_config.json detected. Open Full Editor -> Raw JSON to repair safely.',
      loadErrorAlert: 'Failed to load MCP configuration.',
      quickListTitle: 'Global Servers',
      noServersItem: 'No global MCP servers configured yet.',
      enableAction: 'Enable',
      disableAction: 'Disable',
      languageLabel: 'Language',
      openEditorBtn: 'Open Full Editor',
      openSettingsBtn: 'Settings Page',
      refreshBtn: 'Refresh',
      toggledToast: (name, disabled) =>
        disabled ? `Disabled "${name}".` : `Enabled "${name}".`,
      conflictToast: 'Config changed externally (CAS conflict). Reloaded latest snapshot.',
      toggleFailedToast: 'Failed to toggle MCP server.',
    }),
    ko: Object.freeze({
      title: 'MCP 매니저',
      panelTitle: 'MCP 매니저 · 빠른 요약',
      statusLabel: 'MCP',
      statusTooltip: (mode, count) =>
        mode === 'host-bridge'
          ? `MCP 매니저 (호스트 브리지 · 서버 ${count}개)`
          : mode === 'remote-bridge-disconnected'
            ? 'MCP 매니저 (호스트 브리지 미연결)'
            : `MCP 매니저 (원격 초안 · 서버 ${count}개)`,
      cmdOpenManager: 'MCP 매니저 열기',
      cmdOpenPanel: 'MCP 빠른 패널 열기',
      cmdOpenSettings: 'MCP 매니저 설정 열기',
      modeHostBridge: '호스트 브리지 연결됨',
      modeRemoteBridgeDisconnected: '호스트 브리지 미연결',
      modeRemoteDraft: '원격 초안 (ctx.storage)',
      remoteBridgeDisconnectedNotice:
        '원격 웹 우측 하단 Addons → Host Bridge 탭에서 데스크톱 호스트를 연결하세요.',
      summaryHeading: '등록된 MCP 서버',
      summaryLine: (globalCount, enabledCount, pluginCount) =>
        `전역: ${globalCount}개 (활성 ${enabledCount}개) · 플러그인: ${pluginCount}개`,
      malformedAlert: '손상된 mcp_config.json이 감지되었습니다. 전체 편집기의 원본 JSON 탭에서 안전하게 복구하세요.',
      loadErrorAlert: 'MCP 설정을 불러오지 못했습니다.',
      quickListTitle: '전역 서버 목록',
      noServersItem: '등록된 전역 MCP 서버가 없습니다.',
      enableAction: '활성화',
      disableAction: '비활성화',
      languageLabel: '언어',
      openEditorBtn: '전체 편집기 열기',
      openSettingsBtn: '설정 페이지',
      refreshBtn: '새로고침',
      toggledToast: (name, disabled) =>
        disabled ? `"${name}" 서버를 비활성화했습니다.` : `"${name}" 서버를 활성화했습니다.`,
      conflictToast: '외부에서 설정이 변경되었습니다(CAS 충돌). 최신 상태를 다시 불러왔습니다.',
      toggleFailedToast: 'MCP 서버 상태 변경에 실패했습니다.',
    }),
  });
  function buildQuickPanelSchema({
    snapshot,
    mode,
    surface,
    lang,
    errorMessage = '',
    remoteBridgeConnected = false,
  }) {
    const dict = SHELL_I18N[lang === 'ko' ? 'ko' : 'en'];
    const globalServers = snapshot?.globalConfig?.servers || [];
    const enabledCount = globalServers.filter((s) => !s.disabled).length;
    const pluginCount = (snapshot?.pluginServers || []).length;
    const malformed = Boolean(snapshot?.globalConfig?.malformed);
    const showRemoteBridgeNotice =
      surface === 'remote-web' && (!remoteBridgeConnected || mode === 'remote-bridge-disconnected');
    const modeBadgeText =
      mode === 'host-bridge'
        ? dict.modeHostBridge
        : mode === 'remote-bridge-disconnected'
          ? dict.modeRemoteBridgeDisconnected
          : dict.modeRemoteDraft;
    const modeBadgeVariant =
      mode === 'host-bridge' ? 'success' : mode === 'remote-bridge-disconnected' ? 'warning' : 'default';

    const serverItems =
      globalServers.length > 0
        ? globalServers.map((s) => ({
            id: `srv-${s.name}`,
            label: `${s.name} · ${s.disabled ? dict.disableAction : s.transport === 'stdio' ? 'Stdio' : 'HTTP'}`,
            actionId: 'toggle-server',
            actionLabel: s.disabled ? dict.enableAction : dict.disableAction,
            payload: { name: s.name, disabled: !s.disabled },
          }))
        : [{ id: 'empty-global', label: dict.noServersItem }];

    const tree = {
      type: 'stack',
      id: 'mcp-quick-root',
      children: [
        {
          type: 'row',
          id: 'mcp-quick-badges',
          children: [
            {
              type: 'badge',
              id: 'mcp-mode-badge',
              text: modeBadgeText,
              variant: modeBadgeVariant,
            },
            {
              type: 'badge',
              id: 'mcp-surface-badge',
              text: surface,
            },
          ],
        },
        {
          type: 'alert',
          id: 'mcp-remote-bridge-notice',
          variant: 'info',
          text: dict.remoteBridgeDisconnectedNotice,
          visibleWhen: { field: 'showRemoteBridgeNotice', eq: true },
        },
        {
          type: 'alert',
          id: 'mcp-malformed-alert',
          variant: 'danger',
          text: dict.malformedAlert,
          visibleWhen: { field: 'malformed', eq: true },
        },
        {
          type: 'alert',
          id: 'mcp-error-alert',
          variant: 'warning',
          text: errorMessage || dict.loadErrorAlert,
          visibleWhen: { field: 'hasError', eq: true },
        },
        {
          type: 'section',
          id: 'mcp-summary-section',
          title: dict.summaryHeading,
          children: [
            {
              type: 'text',
              id: 'mcp-summary-text',
              text: dict.summaryLine(globalServers.length, enabledCount, pluginCount),
            },
            {
              type: 'list',
              id: 'mcp-server-list',
              items: serverItems,
            },
          ],
        },
        {
          type: 'divider',
          id: 'mcp-quick-divider',
        },
        {
          type: 'select',
          id: 'mcp-lang-select',
          label: dict.languageLabel,
          field: 'lang',
          options: [
            { value: 'en', label: 'English' },
            { value: 'ko', label: '한국어' },
          ],
        },
        {
          type: 'row',
          id: 'mcp-quick-actions',
          children: [
            {
              type: 'button',
              id: 'mcp-btn-open-editor',
              label: dict.openEditorBtn,
              variant: 'primary',
              actionId: 'open-full-editor',
            },
            {
              type: 'button',
              id: 'mcp-btn-refresh',
              label: dict.refreshBtn,
              actionId: 'refresh',
            },
          ],
        },
      ],
    };

    const state = {
      lang: lang === 'ko' ? 'ko' : 'en',
      mode,
      surface,
      remoteBridgeConnected: Boolean(remoteBridgeConnected),
      showRemoteBridgeNotice,
      serverCount: globalServers.length,
      enabledCount,
      pluginCount,
      malformed,
      hasError: Boolean(errorMessage),
    };

    return { tree, state };
  }
  function createMcpV3Shell({
    runtime,
    doc = typeof document !== 'undefined' ? document : null,
    win = typeof window !== 'undefined' ? window : null,
  }) {
    const surface = runtime.getSurface();
    const service = runtime.createConfigService();

    let disposed = false;
    let latestSnapshot = null;
    let latestError = '';
    let remoteBridgeDisconnected = false;
    let statusItemHandle = null;
    let sectionActionHandle = null;
    let settingsPageHandle = null;
    let quickPanelHandle = null;
    let fullModalHandle = null;
    let fullModalPanel = null;
    let settingsCanvasPanel = null;
    const commandHandles = [];
    const unsubscribers = [];

    function isRemoteBridgeConnected() {
      return typeof runtime.hasRemoteHostBridge === 'function' ? runtime.hasRemoteHostBridge() : false;
    }

    function getMode() {
      if (remoteBridgeDisconnected && surface === 'remote-web' && !isRemoteBridgeConnected()) {
        return 'remote-bridge-disconnected';
      }
      return runtime.getConfigStoreMode();
    }

    function getLang() {
      return runtime.resolveEffectiveLang() === 'ko' ? 'ko' : 'en';
    }

    function dict() {
      return SHELL_I18N[getLang()];
    }

    function syncSectionAction() {
      if (!sectionActionHandle || disposed) return;
      const mode = getMode();
      const count = latestSnapshot?.globalConfig?.servers?.length ?? 0;
      const d = dict();
      try {
        sectionActionHandle.update({
          label: d.title,
          tooltip: d.statusTooltip(mode, count),
          badge: mode === 'remote-bridge-disconnected' ? '!' : null,
        });
      } catch {
        // Ignore updates during disposal
      }
    }

    function syncStatusItem() {
      syncSectionAction();
      if (!statusItemHandle || disposed) return;
      const mode = getMode();
      const count = latestSnapshot?.globalConfig?.servers?.length ?? 0;
      const d = dict();
      try {
        statusItemHandle.update({
          label: d.statusLabel,
          tooltip: d.statusTooltip(mode, count),
          badge: mode === 'remote-bridge-disconnected' ? '!' : latestSnapshot ? String(count) : null,
        });
      } catch {
        // Ignore updates during disposal
      }
    }

    function syncQuickPanel() {
      if (!quickPanelHandle || disposed) return;
      const { tree, state } = buildQuickPanelSchema({
        snapshot: latestSnapshot,
        mode: getMode(),
        surface,
        lang: getLang(),
        errorMessage: latestError,
        remoteBridgeConnected: isRemoteBridgeConnected(),
      });
      try {
        quickPanelHandle.update(tree, state);
      } catch {
        // Panel may already be closed
      }
    }

    function syncAllUi() {
      if (disposed) return;
      syncStatusItem();
      syncQuickPanel();
      if (fullModalPanel) fullModalPanel.syncLang();
      if (settingsCanvasPanel) settingsCanvasPanel.syncLang();
    }

    async function refreshSnapshot() {
      if (disposed) return null;
      if (runtime.getConfigStoreMode() === 'remote-bridge-disconnected') {
        remoteBridgeDisconnected = true;
        latestSnapshot = null;
        latestError = '';
        syncStatusItem();
        syncQuickPanel();
        return null;
      }
      try {
        const snap = await service.getSnapshot({ includeRawText: false });
        if (disposed) return null;
        if (snap && snap.ok) {
          remoteBridgeDisconnected = false;
          latestSnapshot = snap;
          latestError = '';
        } else {
          const joinedErr = (snap?.errors || [dict().loadErrorAlert]).join(' ');
          if (isRemoteBridgeDisconnectedReason(snap?.code || joinedErr)) {
            remoteBridgeDisconnected = true;
            latestSnapshot = null;
            latestError = '';
          } else {
            latestError = joinedErr;
          }
        }
      } catch (err) {
        if (disposed) return null;
        if (isRemoteBridgeDisconnectedReason(err)) {
          remoteBridgeDisconnected = true;
          latestSnapshot = null;
          latestError = '';
        } else {
          latestError = err?.message || dict().loadErrorAlert;
        }
      }
      syncStatusItem();
      syncQuickPanel();
      return latestSnapshot;
    }

    async function handleQuickToggle(payload) {
      if (!payload || !payload.name || disposed) return;
      if (!latestSnapshot) {
        await refreshSnapshot();
        if (!latestSnapshot || disposed) return;
      }
      try {
        const res = await service.toggleServerDisabled({
          name: payload.name,
          disabled: Boolean(payload.disabled),
          expectedSha256: latestSnapshot.globalConfig.sha256,
        });
        if (disposed) return;
        if (res.code === 'CONFLICT') {
          runtime.showToast({ message: dict().conflictToast, variant: 'warning' });
          await refreshSnapshot();
          return;
        }
        if (isRemoteBridgeDisconnectedReason(res.code || (res.errors || []).join(' '))) {
          remoteBridgeDisconnected = true;
          latestSnapshot = null;
          latestError = '';
          runtime.showToast({ message: dict().remoteBridgeDisconnectedNotice, variant: 'warning' });
          syncAllUi();
          return;
        }
        if (!res.ok) {
          runtime.showToast({ message: (res.errors || [dict().toggleFailedToast]).join(' '), variant: 'error' });
          return;
        }
        runtime.showToast({ message: dict().toggledToast(payload.name, Boolean(payload.disabled)), variant: 'success' });
        await refreshSnapshot();
        if (fullModalPanel) void fullModalPanel.refresh();
        if (settingsCanvasPanel) void settingsCanvasPanel.refresh();
      } catch (err) {
        if (!disposed) {
          if (isRemoteBridgeDisconnectedReason(err)) {
            remoteBridgeDisconnected = true;
            latestSnapshot = null;
            latestError = '';
            runtime.showToast({ message: dict().remoteBridgeDisconnectedNotice, variant: 'warning' });
            syncAllUi();
          } else {
            runtime.showToast({ message: err?.message || dict().toggleFailedToast, variant: 'error' });
          }
        }
      }
    }

    function mountNativePanelInCanvas(canvasRoot, overlayHandle, panelSurface) {
      if (!canvasRoot || disposed) return null;
      const styleEl = runtime.createStyleElementSafe(buildNativePanelCss());
      if (styleEl && typeof canvasRoot.appendChild === 'function') {
        canvasRoot.appendChild(styleEl);
      }
      const panel = createNativeMcpPanel({
        runtime,
        service,
        mode: null,
        surface: panelSurface,
        inline: overlayHandle?.kind === 'inline-settings',
        doc,
        win,
        onLangChange: () => syncAllUi(),
        onSnapshotChange: (snap) => {
          remoteBridgeDisconnected = false;
          latestSnapshot = snap;
          latestError = '';
          syncStatusItem();
          syncQuickPanel();
        },
      });
      canvasRoot.appendChild(panel.element);
      return panel;
    }

    function openFullModal() {
      if (disposed) return null;
      if (fullModalHandle) {
        try {
          fullModalHandle.close();
        } catch {}
        fullModalHandle = null;
      }
      if (fullModalPanel) {
        fullModalPanel.dispose();
        fullModalPanel = null;
      }

      const handle = runtime.openModal({
        title: dict().title,
        placement: {
          zone: 'surface-center',
          surface: 'auto',
          width: 820,
          maxHeight: 720,
        },
        onClose: () => {
          if (fullModalPanel) {
            fullModalPanel.dispose();
            fullModalPanel = null;
          }
          fullModalHandle = null;
        },
      });
      fullModalHandle = handle;
      if (handle && handle.bodyEl) {
        fullModalPanel = mountNativePanelInCanvas(handle.bodyEl, handle, 'customizations');
      }
      return handle;
    }

    function openQuickPanel(anchorEl = null) {
      if (disposed) return null;
      if (quickPanelHandle) {
        try {
          quickPanelHandle.close();
        } catch {}
        quickPanelHandle = null;
      }

      const { tree, state } = buildQuickPanelSchema({
        snapshot: latestSnapshot,
        mode: getMode(),
        surface,
        lang: getLang(),
        errorMessage: latestError,
        remoteBridgeConnected: isRemoteBridgeConnected(),
      });

      const placement = {
        zone: 'drawer',
        side: 'right',
        width: 420,
        ...(anchorEl ? { anchorEl } : {}),
      };

      const handle = runtime.openPanel({
        title: dict().panelTitle,
        placement,
        tree,
        state,
        onChange: (ev) => {
          if (ev && ev.field === 'lang' && (ev.value === 'en' || ev.value === 'ko')) {
            runtime.writeSavedLang(ev.value);
            syncAllUi();
          }
        },
        onAction: (ev) => {
          if (!ev) return;
          if (ev.actionId === 'open-full-editor') {
            if (quickPanelHandle) {
              try {
                quickPanelHandle.close();
              } catch {}
            }
            openFullModal();
          } else if (ev.actionId === 'refresh') {
            void refreshSnapshot();
          } else if (ev.actionId === 'toggle-server') {
            void handleQuickToggle(ev.payload);
          }
        },
        onClose: () => {
          quickPanelHandle = null;
        },
      });
      quickPanelHandle = handle;
      void refreshSnapshot();
      return handle;
    }

    function openSettingsPage() {
      if (disposed || !settingsPageHandle) return null;
      return settingsPageHandle.open();
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsub of unsubscribers.splice(0)) {
        try {
          unsub();
        } catch {}
      }
      for (const cmd of commandHandles.splice(0)) {
        try {
          if (typeof cmd.dispose === 'function') cmd.dispose();
          else if (typeof cmd.unregister === 'function') cmd.unregister();
        } catch {}
      }
      if (quickPanelHandle) {
        try {
          quickPanelHandle.close();
        } catch {}
        quickPanelHandle = null;
      }
      if (fullModalHandle) {
        try {
          fullModalHandle.close();
        } catch {}
        fullModalHandle = null;
      }
      if (fullModalPanel) {
        fullModalPanel.dispose();
        fullModalPanel = null;
      }
      if (settingsCanvasPanel) {
        settingsCanvasPanel.dispose();
        settingsCanvasPanel = null;
      }
      if (statusItemHandle) {
        try {
          statusItemHandle.dispose();
        } catch {}
        statusItemHandle = null;
      }
      if (sectionActionHandle) {
        try {
          sectionActionHandle.dispose();
        } catch {}
        sectionActionHandle = null;
      }
      if (settingsPageHandle) {
        try {
          settingsPageHandle.dispose();
        } catch {}
        settingsPageHandle = null;
      }
    }

    function start() {
      if (disposed) return;
      const d = dict();

      // Host v3.0.3 contract:
      // - Desktop renders inline inside Settings via registerSettingsPage() only (no status item).
      // - Remote Web registers registerStatusItem() for the bottom-right entry point.
      if (surface === 'remote-web') {
        statusItemHandle = runtime.registerStatusItem({
          id: V3_IDS.STATUS_ITEM,
          label: d.statusLabel,
          tooltip: d.statusTooltip(getMode(), 0),
          align: 'right',
          priority: 60,
          onClick: (ev) => {
            openQuickPanel(ev?.anchorEl || null);
          },
        });
      }

      // Extenra v3.3.0 Tier-1 Declarative Section Action:
      // Mounts a host-styled action button on the Customizations -> MCP Servers section header
      // (Desktop & Remote Web) with zero plugin-side DOM scraping.
      if (typeof runtime.registerSectionAction === 'function') {
        sectionActionHandle = runtime.registerSectionAction({
          id: V3_IDS.SECTION_ACTION,
          target: V3_IDS.SECTION_TARGET,
          label: d.title,
          tooltip: d.statusTooltip(getMode(), 0),
          order: 60,
          onClick: () => {
            openFullModal();
          },
        });
      }

      settingsPageHandle = runtime.registerSettingsPage({
        id: V3_IDS.SETTINGS_PAGE,
        title: d.title,
        order: 60,
        width: 820,
        render: (canvasRoot, handle) => {
          if (settingsCanvasPanel) {
            settingsCanvasPanel.dispose();
            settingsCanvasPanel = null;
          }
          settingsCanvasPanel = mountNativePanelInCanvas(canvasRoot, handle, 'settings');
        },
        onClose: () => {
          if (settingsCanvasPanel) {
            settingsCanvasPanel.dispose();
            settingsCanvasPanel = null;
          }
        },
      });

      commandHandles.push(
        runtime.registerCommand(V3_IDS.CMD_OPEN_MANAGER, {
          label: d.cmdOpenManager,
          run: () => openFullModal(),
        }),
        runtime.registerCommand(V3_IDS.CMD_OPEN_PANEL, {
          label: d.cmdOpenPanel,
          run: () => openQuickPanel(),
        }),
        runtime.registerCommand(V3_IDS.CMD_OPEN_SETTINGS, {
          label: d.cmdOpenSettings,
          run: () => openSettingsPage(),
        })
      );

      unsubscribers.push(
        runtime.onStorageChange((ev) => {
          if (!ev || disposed) return;
          if (ev.key === LANG_STORAGE_KEY) {
            syncAllUi();
          } else if (ev.key === STORAGE_DRAFT_KEY) {
            void refreshSnapshot();
          }
        }),
        runtime.onThemeChange(() => {
          syncQuickPanel();
        }),
        typeof runtime.onLocaleChange === 'function'
          ? runtime.onLocaleChange(() => {
              if (!disposed) syncAllUi();
            })
          : () => {},
        typeof runtime.onRemoteBridgeChange === 'function'
          ? runtime.onRemoteBridgeChange(() => {
              if (disposed) return;
              remoteBridgeDisconnected = false;
              latestError = '';
              void refreshSnapshot();
              if (fullModalPanel) void fullModalPanel.refresh();
              if (settingsCanvasPanel) void settingsCanvasPanel.refresh();
              syncAllUi();
            })
          : () => {}
      );

      if (runtime.signal && typeof runtime.signal.addEventListener === 'function') {
        const onAbort = () => dispose();
        runtime.signal.addEventListener('abort', onAbort, { once: true });
        unsubscribers.push(() => {
          try {
            runtime.signal.removeEventListener('abort', onAbort);
          } catch {}
        });
      }
      runtime.onDispose(() => dispose());

      void runtime.loadSavedLang().then(() => {
        if (!disposed) syncAllUi();
      });
      void refreshSnapshot();
    }

    return Object.freeze({
      start,
      openQuickPanel,
      openFullModal,
      openSettingsPage,
      refreshSnapshot,
      getQuickPanelHandle: () => quickPanelHandle,
      getFullModalHandle: () => fullModalHandle,
      dispose,
    });
  }

  // --- composition root (AddonContextV3 API-First) ---
  const doc = typeof document !== "undefined" ? document : null;
  const win = typeof window !== "undefined" ? window : null;
  const runtime = createHostRuntime({ ctx: addonHost, doc });
  const shell = createMcpV3Shell({ runtime, doc, win });
  shell.start();
})(typeof addonHost !== "undefined" ? addonHost : undefined);
