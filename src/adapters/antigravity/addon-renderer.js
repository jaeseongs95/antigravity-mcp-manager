/**
 * AUTO-GENERATED AddonManifest.v2 Renderer Entry (`src/adapters/antigravity/addon-renderer.js`).
 * Source of truth: `src/adapters/antigravity/renderer/*.mjs` (run `npm run build:renderer`).
 *
 * Executed by `antigravity-native-addon-host` v2.0.0+ in Isolated World `998` as
 * `(function(addonHost){ ... })(__addonHandle)` under `trustLevel: "restricted"`.
 * ZERO unsafe DOM sinks, ZERO direct `app.asar` hooks, 100% owner/Shadow DOM scoped APIs.
 */

(function (addonHost) {
  'use strict';

  if (!addonHost || typeof addonHost.mountSlot !== "function" || typeof addonHost.openModal !== "function") {
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
   * - SRP: Translates `antigravity-native-addon-host` v2.3.0+ Option A Named-Scope Config Bridge
   *   (`addonHost.hasConfigBridge`, `addonHost.configScopes`, `addonHost.readConfigScope`,
   *   `addonHost.writeConfigScope`) into the vendor-independent `ConfigStorePort` contract
   *   consumed by `src/core/manager-service.mjs`.
   * - DIP: `McpManagerService` and `native-mcp-panel.mjs` depend solely on `ConfigStorePort`,
   *   never directly on Electron IPC or host-specific bridge methods.
   */
  const HOST_CONFIG_SCOPES = Object.freeze({
    GLOBAL_MCP: 'antigravity:mcp-config',
    PLUGIN_MCP: 'antigravity:plugin-mcp-configs',
    LEGACY_MCP: 'antigravity:mcp-config-legacy',
  });

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

  function hasDeclaredScope(addonHost, scopeId, requiredAccess = null) {
    if (!Array.isArray(addonHost?.configScopes)) return true;
    const entry = addonHost.configScopes.find((s) => s && s.scopeId === scopeId);
    if (!entry) return false;
    if (requiredAccess === 'rw') return entry.access === 'rw';
    if (requiredAccess === 'ro') return entry.access === 'ro' || entry.access === 'rw';
    return true;
  }

  function mapHostBridgeReasonToErrorCode(reason) {
    const code = String(reason || '').trim();
    if (!code) return ERROR_CODES.IO_ERROR;
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
  function resolveHostConfigBridge(addonHost) {
    if (!addonHost || typeof addonHost !== 'object') return null;
    if (addonHost.hasConfigBridge !== true) return null;
    if (
      typeof addonHost.readConfigScope !== 'function' ||
      typeof addonHost.writeConfigScope !== 'function'
    ) {
      return null;
    }
    if (!hasDeclaredScope(addonHost, HOST_CONFIG_SCOPES.GLOBAL_MCP, 'rw')) {
      return null;
    }
    return addonHost;
  }
  function createHostBridgeConfigStore(addonHost) {
    const bridge = resolveHostConfigBridge(addonHost);
    if (!bridge) {
      throw new TypeError(
        'Host Config Bridge requires addonHost.hasConfigBridge === true, readConfigScope(), writeConfigScope(), and rw access to antigravity:mcp-config'
      );
    }

    async function readGlobalConfig() {
      const res = await bridge.readConfigScope(HOST_CONFIG_SCOPES.GLOBAL_MCP);
      if (!res || typeof res !== 'object') {
        throw new Error('Host Config Bridge returned an invalid response for global MCP config.');
      }
      if (res.ok === false || res.status === 'error') {
        throw new Error(String(res.reason || 'ERR_CONFIG_READ_FAILED'));
      }
      const displayPath = DEFAULT_DISPLAY_PATHS[HOST_CONFIG_SCOPES.GLOBAL_MCP];
      if (res.status === 'missing') {
        return {
          exists: false,
          rawText: '',
          sha256: null,
          displayPath,
        };
      }
      // Host v2.3.0 config-bridge.js returns `{ status: 'ok', data, rawText: null, sha256 }`
      // for valid files and `{ status: 'corrupt', data: null, rawText, sha256 }` for malformed JSON.
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
        const res = await bridge.writeConfigScope(
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
      const res = await bridge.readConfigScope(HOST_CONFIG_SCOPES.PLUGIN_MCP);
      if (!res || typeof res !== 'object') {
        throw new Error('Host Config Bridge returned an invalid response for plugin MCP configs.');
      }
      if (res.ok === false || res.status === 'error') {
        throw new Error(String(res.reason || 'ERR_CONFIG_PLUGIN_READ_FAILED'));
      }
      if (res.status === 'missing') {
        return [];
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
        const res = await bridge.readConfigScope(HOST_CONFIG_SCOPES.LEGACY_MCP);
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

  // --- module: host-runtime.mjs ---
  /**
   * Host Capability Runtime Adapter (`src/adapters/antigravity/renderer/host-runtime.mjs`).
   *
   * SOLID Boundaries:
   * - SRP: Owns `AddonManifest.v2` `addonHost` capability handle delegation (Shadow DOM
   *   Option B2 `mountSlot({ container })`, `openModal`, slot-scoped `injectStyle`,
   *   `addManagedListener`), loopback URL validation, namespaced language storage (with
   *   1-time migration from legacy v2.1 key), theme URL building, origin/source-validated
   *   iframe `postMessage` checks, and the zero-`innerHTML` EN/KO Native Sidecar launcher view.
   * - DIP: Renderer mount adapters depend on this narrow capability port rather than
   *   raw global `window.__ADDON_HOST_API__`, un-namespaced `localStorage`, or direct
   *   `<style>` DOM injection.
   */
  const SLOT_IDS = Object.freeze({
    SETTINGS_PANE: 'antigravity-mcp-manager.pane',
    SETTINGS_NAV: 'antigravity-mcp-manager.settings-nav',
    CUSTOMIZATIONS_BTN: 'antigravity-mcp-manager.customizations-btn',
    CUSTOMIZATIONS_OVERLAY: 'antigravity-mcp-manager.customizations-overlay',
  });
  const FRAME_ATTR = 'data-agy-mcp-manager-frame';
  const LAUNCHER_ATTR = 'data-agy-mcp-sidecar-launcher';
  const LEGACY_LANG_STORAGE_KEY = 'agy-mcp-manager-lang';

  const KO_HOST_UI_MARKERS = Object.freeze(
    new Set([
      'mcp 서버',
      '설정',
      '일반',
      '브라우저',
      '애플리케이션',
      '단축키',
      '알림',
      '모델',
      '사용자 정의',
      '맞춤 설정',
      '커스터마이징',
    ])
  );
  const EN_HOST_UI_MARKERS = Object.freeze(
    new Set([
      'mcp servers',
      'settings',
      'general',
      'browser',
      'application',
      'shortcuts',
      'notifications',
      'models',
      'customizations',
    ])
  );

  const LAUNCHER_COPY = Object.freeze({
    en: Object.freeze({
      title: 'MCP Manager',
      badge: 'AddonManifest.v2 · Config Bridge',
      status: 'Awaiting Host Config Bridge',
      lead: 'Running in antigravity-addons (AddonManifest.v2) Shadow DOM isolation (AUX_PANE sidecar removed). Direct editing inside Settings & Customizations popup activates automatically once the host exposes Named-Scope Config Bridge or loopback URL.',
      stepsHeading: 'How this panel connects',
      steps: Object.freeze([
        'All MCP edits target ~/.gemini/config/mcp_config.json atomically with CAS conflict guards and secret redaction.',
        'Upgrade antigravity-addons (formerly antigravity-native-addon-host) to v2.3.0+ supporting Named-Scope Config Bridge (Option A) for direct in-Settings & popup management.',
        'This view switches automatically to the live MCP Manager UI as soon as the host bridge or loopback URL is provided.',
      ]),
      configLabel: 'Config File',
      configPath: '~/.gemini/config/mcp_config.json',
      surfaceSettings: 'Settings Integration',
      surfaceCustomizations: 'Customizations Popup',
    }),
    ko: Object.freeze({
      title: 'MCP 매니저',
      badge: 'AddonManifest.v2 · Config Bridge',
      status: '호스트 설정 브리지 대기 중',
      lead: 'antigravity-addons(AddonManifest.v2) Shadow DOM 격리 모드로 실행 중입니다(AUX_PANE 사이드카 제거 완료). 호스트가 Named-Scope Config Bridge 또는 loopback URL을 제공하면 설정 화면과 Customizations 팝업에서 즉시 실시간 편집이 활성화됩니다.',
      stepsHeading: '연동 안내',
      steps: Object.freeze([
        '모든 MCP 설정 변경은 CAS 충돌 방지 및 시크릿 마스킹과 함께 ~/.gemini/config/mcp_config.json에 원자적으로 저장됩니다.',
        '설정 화면과 팝업에서 바로 편집하려면 Named-Scope Config Bridge(안 A)를 지원하는 antigravity-addons(구 antigravity-native-addon-host) v2.3.0+ 버전을 적용하세요.',
        '호스트 브리지 또는 loopback URL이 연결되면 이 화면이 자동으로 실제 MCP 매니저 UI로 전환됩니다.',
      ]),
      configLabel: '설정 파일',
      configPath: '~/.gemini/config/mcp_config.json',
      surfaceSettings: 'Settings 통합',
      surfaceCustomizations: 'Customizations 팝업',
    }),
  });
  function isSafeLoopbackIframeUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
    try {
      const parsed = new URL(rawUrl);
      return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && Boolean(parsed.port);
    } catch {
      return false;
    }
  }
  function normalizedText(el) {
    return String(el?.textContent || '').trim().toLowerCase();
  }
  function detectHostLang(doc = document) {
    try {
      if (doc && typeof doc.querySelectorAll === 'function') {
        const nodes = doc.querySelectorAll('h1, h2, h3, h4, button, span, div, a, li');
        let hasEnMarker = false;
        for (const el of nodes) {
          if (!el || (el.children && el.children.length > 2)) continue;
          if (
            typeof el.closest === 'function' &&
            (el.closest('[data-addon-host-owner="antigravity-mcp-manager"]') ||
              el.closest('[data-agy-mcp-manager-nav="true"]'))
          ) {
            continue;
          }
          const txt = normalizedText(el);
          if (!txt || txt.length > 32) continue;
          const baseTxt = txt.replace(/[\s(]*\d+[\s)]*$/, '').trim();
          if (KO_HOST_UI_MARKERS.has(baseTxt)) return 'ko';
          if (EN_HOST_UI_MARKERS.has(baseTxt)) hasEnMarker = true;
        }
        if (hasEnMarker) return 'en';
      }
      const docLang = String(doc?.documentElement?.lang || '').trim().toLowerCase();
      if (docLang === 'ko' || docLang.startsWith('ko-')) return 'ko';
    } catch {
      // Fall back safely to English if host DOM is unavailable
    }
    return 'en';
  }
  function hasVisibleBg(el, win = window) {
    const bg = win.getComputedStyle(el)?.backgroundColor || '';
    return Boolean(bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent');
  }
  function replaceLeafText(root, nextText, doc = document) {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let current = walker.nextNode();
    while (current) {
      if (current.nodeValue && current.nodeValue.trim()) {
        textNodes.push(current);
      }
      current = walker.nextNode();
    }
    if (textNodes.length > 0) {
      textNodes[0].nodeValue = nextText;
      for (let i = 1; i < textNodes.length; i += 1) {
        textNodes[i].nodeValue = '';
      }
    } else {
      root.textContent = nextText;
    }
  }
  function sameFrameBaseAndTheme(currentSrc, nextSrc) {
    try {
      const a = new URL(currentSrc);
      const b = new URL(nextSrc);
      a.searchParams.delete('lang');
      b.searchParams.delete('lang');
      return a.toString() === b.toString();
    } catch {
      return currentSrc === nextSrc;
    }
  }
  function getSlotHostElement(rootEl) {
    if (!rootEl) return null;
    const root = typeof rootEl.getRootNode === 'function' ? rootEl.getRootNode() : null;
    return root && root.host ? root.host : rootEl;
  }
  function assertAddonHostHandle(addonHost) {
    if (!addonHost || typeof addonHost !== 'object') {
      throw new Error('ERR_MISSING_ADDON_HOST_HANDLE');
    }
    for (const method of ['mountSlot', 'unmountSlot', 'injectStyle', 'removeStyle', 'openModal', 'onDispose']) {
      if (typeof addonHost[method] !== 'function') {
        throw new Error(`ERR_INVALID_ADDON_HOST_HANDLE:${method}`);
      }
    }
    return addonHost;
  }
  function createSidecarLauncherView({ runtime, surface = 'settings', onLangChange = () => {}, doc = document }) {
    const container = doc.createElement('section');
    container.setAttribute(LAUNCHER_ATTR, 'true');
    container.setAttribute('data-agy-mcp-surface', surface);

    const card = doc.createElement('div');
    card.setAttribute('data-agy-mcp-launcher-card', 'true');

    const header = doc.createElement('header');
    header.setAttribute('data-agy-mcp-launcher-header', 'true');

    const titleWrap = doc.createElement('div');
    titleWrap.setAttribute('data-agy-mcp-launcher-title-wrap', 'true');

    const titleEl = doc.createElement('h2');
    titleEl.setAttribute('data-agy-mcp-launcher-title', 'true');

    const badgeEl = doc.createElement('span');
    badgeEl.setAttribute('data-agy-mcp-launcher-badge', 'true');

    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(badgeEl);

    const langGroup = doc.createElement('div');
    langGroup.setAttribute('data-agy-mcp-lang-switch', 'true');
    langGroup.setAttribute('role', 'group');
    langGroup.setAttribute('aria-label', 'Language');

    const enBtn = doc.createElement('button');
    enBtn.type = 'button';
    enBtn.setAttribute('data-agy-mcp-lang-btn', 'en');
    enBtn.textContent = 'EN';

    const koBtn = doc.createElement('button');
    koBtn.type = 'button';
    koBtn.setAttribute('data-agy-mcp-lang-btn', 'ko');
    koBtn.textContent = '한국어';

    const handleLangClick = (lang) => (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      runtime.writeSavedLang(lang);
      syncLang();
      onLangChange(lang);
    };
    enBtn.addEventListener('click', handleLangClick('en'));
    koBtn.addEventListener('click', handleLangClick('ko'));

    langGroup.appendChild(enBtn);
    langGroup.appendChild(koBtn);

    header.appendChild(titleWrap);
    header.appendChild(langGroup);

    const metaRow = doc.createElement('div');
    metaRow.setAttribute('data-agy-mcp-launcher-meta', 'true');

    const statusPill = doc.createElement('span');
    statusPill.setAttribute('data-agy-mcp-launcher-status', 'true');

    const surfaceTag = doc.createElement('span');
    surfaceTag.setAttribute('data-agy-mcp-launcher-surface', 'true');

    metaRow.appendChild(statusPill);
    metaRow.appendChild(surfaceTag);

    const leadEl = doc.createElement('p');
    leadEl.setAttribute('data-agy-mcp-launcher-lead', 'true');

    const stepsTitle = doc.createElement('h3');
    stepsTitle.setAttribute('data-agy-mcp-launcher-steps-title', 'true');

    const stepsList = doc.createElement('ol');
    stepsList.setAttribute('data-agy-mcp-launcher-steps', 'true');
    const stepItems = [doc.createElement('li'), doc.createElement('li'), doc.createElement('li')];
    for (const li of stepItems) {
      stepsList.appendChild(li);
    }

    const footer = doc.createElement('div');
    footer.setAttribute('data-agy-mcp-launcher-footer', 'true');

    const configLabelEl = doc.createElement('span');
    configLabelEl.setAttribute('data-agy-mcp-launcher-config-label', 'true');

    const configPathEl = doc.createElement('code');
    configPathEl.setAttribute('data-agy-mcp-launcher-config-path', 'true');

    footer.appendChild(configLabelEl);
    footer.appendChild(configPathEl);

    card.appendChild(header);
    card.appendChild(metaRow);
    card.appendChild(leadEl);
    card.appendChild(stepsTitle);
    card.appendChild(stepsList);
    card.appendChild(footer);
    container.appendChild(card);

    function syncLang() {
      const lang = (typeof runtime.resolveEffectiveLang === 'function' ? runtime.resolveEffectiveLang() : runtime.readSavedLang()) === 'ko' ? 'ko' : 'en';
      const copy = LAUNCHER_COPY[lang];
      container.setAttribute('data-agy-mcp-lang', lang);
      titleEl.textContent = copy.title;
      badgeEl.textContent = copy.badge;
      statusPill.textContent = copy.status;
      surfaceTag.textContent = surface === 'customizations' ? copy.surfaceCustomizations : copy.surfaceSettings;
      leadEl.textContent = copy.lead;
      stepsTitle.textContent = copy.stepsHeading;
      for (let i = 0; i < stepItems.length; i += 1) {
        stepItems[i].textContent = copy.steps[i] || '';
      }
      configLabelEl.textContent = copy.configLabel;
      configPathEl.textContent = copy.configPath;
      enBtn.setAttribute('aria-pressed', lang === 'en' ? 'true' : 'false');
      koBtn.setAttribute('aria-pressed', lang === 'ko' ? 'true' : 'false');
    }

    syncLang();

    return Object.freeze({
      element: container,
      syncLang,
    });
  }
  function createHostRuntime({ addonHost, win = window, doc = document }) {
    const host = assertAddonHostHandle(addonHost);
    const pluginId = String(host.pluginId || 'antigravity-mcp-manager');
    const trustLevel = String(host.trustLevel || 'restricted');
    const schemaVersion = Number(host.schemaVersion || 2);
    const storageNamespace = String(host.storageNamespace || pluginId);
    const ipcChannelPrefix = host.ipcChannelPrefix ? String(host.ipcChannelPrefix) : 'mcp-manager:';
    const langStorageKey = `${storageNamespace}:lang`;

    function readSavedLang() {
      try {
        const storage = win.localStorage;
        if (!storage) return '';
        const namespaced = storage.getItem(langStorageKey);
        if (namespaced === 'ko' || namespaced === 'en') return namespaced;
        // One-time migration from legacy v2.1.0 un-namespaced key
        const legacy = storage.getItem(LEGACY_LANG_STORAGE_KEY);
        if (legacy === 'ko' || legacy === 'en') {
          try {
            storage.setItem(langStorageKey, legacy);
          } catch {
            // Ignore write errors during migration
          }
          return legacy;
        }
        return '';
      } catch {
        return '';
      }
    }

    function writeSavedLang(lang) {
      if (lang !== 'ko' && lang !== 'en') return false;
      try {
        win.localStorage?.setItem(langStorageKey, lang);
        return true;
      } catch {
        return false;
      }
    }

    function resolveEffectiveLang() {
      const saved = readSavedLang();
      if (saved === 'ko' || saved === 'en') return saved;
      return detectHostLang(doc);
    }

    function hasConfigBridge() {
      return Boolean(resolveHostConfigBridge(host));
    }

    function createConfigService() {
      const bridge = resolveHostConfigBridge(host);
      if (!bridge) return null;
      const configStore = createHostBridgeConfigStore(bridge);
      return new McpManagerService({ configStore });
    }

    function getServerUrl() {
      const raw = win.__AGY_MCP_MANAGER_URL__;
      return isSafeLoopbackIframeUrl(raw) ? raw : '';
    }

    function bindServerUrlListener(callback) {
      if (typeof callback !== 'function') return () => {};
      const handler = (nextUrl) => {
        callback(isSafeLoopbackIframeUrl(nextUrl) ? nextUrl : '');
      };
      win.__AGY_MCP_ON_SERVER_URL__ = handler;
      return () => {
        if (win.__AGY_MCP_ON_SERVER_URL__ === handler) {
          try {
            delete win.__AGY_MCP_ON_SERVER_URL__;
          } catch {
            win.__AGY_MCP_ON_SERVER_URL__ = undefined;
          }
        }
      };
    }

    function buildThemedIframeUrl(baseUrl, contentPane) {
      try {
        const url = new URL(baseUrl);
        url.searchParams.set('hostMode', 'settings');
        const effectiveLang = resolveEffectiveLang();
        if (effectiveLang) {
          url.searchParams.set('lang', effectiveLang);
        }
        const bodyCs = doc.body ? win.getComputedStyle(doc.body) : null;
        if (bodyCs?.fontFamily) {
          url.searchParams.set('hostFont', bodyCs.fontFamily);
        }
        if (bodyCs?.color) {
          url.searchParams.set('hostFg', bodyCs.color);
        }
        const paneBg = contentPane ? win.getComputedStyle(contentPane)?.backgroundColor : '';
        if (paneBg && paneBg !== 'rgba(0, 0, 0, 0)' && paneBg !== 'transparent') {
          url.searchParams.set('hostBg', paneBg);
        } else if (bodyCs?.backgroundColor && bodyCs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          url.searchParams.set('hostBg', bodyCs.backgroundColor);
        }
        return url.toString();
      } catch {
        return baseUrl;
      }
    }

    function isTrustedIframeMessage(ev, frames) {
      const baseUrl = getServerUrl();
      if (!baseUrl) return false;
      try {
        const expectedOrigin = new URL(baseUrl).origin;
        if (ev.origin !== expectedOrigin) return false;
      } catch {
        return false;
      }
      if (!Array.isArray(frames) || frames.length === 0) return false;
      return frames.some((frame) => frame && frame.contentWindow === ev.source);
    }

    function mountSlot(slotId, containerOrOpts) {
      const opts =
        containerOrOpts && typeof containerOrOpts === 'object' && containerOrOpts.nodeType === 1
          ? { container: containerOrOpts }
          : containerOrOpts || {};
      return host.mountSlot(slotId, opts);
    }

    function injectStyle(styleId, cssText, opts) {
      return opts ? host.injectStyle(styleId, cssText, opts) : host.injectStyle(styleId, cssText);
    }

    function addManagedListener(target, type, listener, opts) {
      if (!target || typeof target.addEventListener !== 'function') return () => {};
      if (typeof host.addManagedListener === 'function') {
        const detach = host.addManagedListener(target, type, listener, opts);
        return typeof detach === 'function' ? detach : () => {};
      }
      target.addEventListener(type, listener, opts);
      let active = true;
      const detach = () => {
        if (!active) return;
        active = false;
        try {
          target.removeEventListener(type, listener, opts);
        } catch {
          // Ignore teardown errors
        }
      };
      host.onDispose(detach);
      return detach;
    }

    function getSurfaceBounds(surfaceIdOrOpts) {
      return typeof host.getSurfaceBounds === 'function' ? host.getSurfaceBounds(surfaceIdOrOpts) : null;
    }

    function getActiveSurface() {
      return typeof host.getActiveSurface === 'function' ? host.getActiveSurface() : null;
    }

    function listSurfaces() {
      return typeof host.listSurfaces === 'function' ? host.listSurfaces() : [];
    }

    return Object.freeze({
      pluginId,
      trustLevel,
      schemaVersion,
      storageNamespace,
      ipcChannelPrefix,
      langStorageKey,
      readSavedLang,
      writeSavedLang,
      resolveEffectiveLang,
      hasConfigBridge,
      createConfigService,
      getServerUrl,
      bindServerUrlListener,
      buildThemedIframeUrl,
      isTrustedIframeMessage,
      getSlotHostElement,
      mountSlot,
      unmountSlot: (slotId) => host.unmountSlot(slotId),
      openModal: (slotId, opts) => host.openModal(slotId, opts || {}),
      getSurfaceBounds,
      getActiveSurface,
      listSurfaces,
      injectStyle,
      removeStyle: (styleId) => host.removeStyle(styleId),
      addManagedListener,
      onDispose: (fn) => host.onDispose(fn),
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
   *   unsafe DOM sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`).
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
      refresh: 'Refresh',
      addServer: '+ Add Server',
      tabServers: 'Servers',
      tabRaw: 'Raw JSON',
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
      refresh: '새로고침',
      addServer: '+ 서버 추가',
      tabServers: '서버 목록',
      tabRaw: '원본 JSON',
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
    surface = 'settings',
    onLangChange = () => {},
    doc = document,
  }) {
    if (!service) {
      throw new Error('ERR_MISSING_MCP_MANAGER_SERVICE');
    }

    let disposed = false;
    let activeTab = 'servers';
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
              if (dv !== undefined && dv !== null) node.dataset[dk] = String(dv);
            }
          } else if (k.startsWith('on') && typeof v === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), v);
          } else {
            node.setAttribute(k, v === true ? '' : String(v));
          }
        }
      }
      for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        if (Array.isArray(child)) {
          for (const c of child) {
            if (c !== null && c !== undefined && c !== false) {
              node.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
            }
          }
        } else {
          node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
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
    });
    const shell = el('div', { className: 'mcp-shell' });
    const headerEl = el('header', { className: 'mcp-header' });
    const titleGroup = el('div', { className: 'mcp-title-group' });
    const titleEl = surface === 'settings' ? el('h1', { className: 'mcp-title' }) : null;
    const statusBadge = el('span', { className: 'mcp-badge mcp-badge-ok', dataset: { testid: 'bridge-status-badge' } });
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
      busy = true;
      syncStaticLabels();
      try {
        const data = await service.getSnapshot({ includeRawText });
        if (disposed || seq !== snapshotRequestSeq) return;
        busy = false;
        if (!data || !data.ok) {
          setBanner('error', (data?.errors || [t('loadFailed')]).join(' '));
          syncStaticLabels();
          return;
        }
        snapshot = data;
        if (typeof data.globalConfig?.rawText === 'string' && (includeRawText || (!rawDraftDirty && !rawDraft))) {
          rawDraft = data.globalConfig.rawText;
          if (includeRawText) rawDraftDirty = false;
        }
        if (data.globalConfig?.malformed) {
          activeTab = 'raw';
        }
        syncStaticLabels();
        renderAll();
      } catch (err) {
        if (disposed || seq !== snapshotRequestSeq) return;
        busy = false;
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
        setBanner('error', err?.message || t(fallbackErrorKey));
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

    async function submitRawJson(confirmStdio = false) {
      if (!snapshot || disposed) return;
      await runMutation('rawSaveFailed', async () => {
        const payload = {
          rawText: rawDraft,
          expectedSha256: snapshot.globalConfig.sha256,
          confirmStdio,
        };
        const data = await service.saveRawJson(payload);
        if (disposed) return false;
        if (data.code === 'CONFIRMATION_REQUIRED') {
          pendingStdioConfirm = {
            kind: 'raw',
            payload,
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
        clearBanner();
        return 'raw';
      });
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
        await submitRawJson(true);
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
              className: `mcp-banner ${bannerState.kind === 'error' ? 'mcp-banner-error' : 'mcp-banner-warn'}`,
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

    function renderServersTab() {
      const nodes = [];
      if (pendingStdioConfirm && (pendingStdioConfirm.kind === 'clone' || pendingStdioConfirm.kind === 'legacy')) {
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
      root.setAttribute('data-agy-mcp-lang', lang);
      if (titleEl) titleEl.textContent = t('appTitle');
      statusBadge.textContent = busy && !snapshot ? t('loading') : t('bridgeConnected');
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
      tabServers.classList.toggle('active', activeTab === 'servers');
      tabServers.setAttribute('aria-selected', String(activeTab === 'servers'));
      tabRaw.classList.toggle('active', activeTab === 'raw');
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
   * ShadowRoot & Slot-Scoped CSS Definitions (`src/adapters/antigravity/renderer/addon-styles.mjs`).
   *
   * SOLID Responsibility (SRP):
   * - Declares strictly slot-scoped CSS injected via `addonHost.injectStyle(styleId, cssText, { slotId })`
   *   for every Shadow DOM slot (`pane`, `customizations-btn`, `customizations-overlay`).
   * - 100% compliant with `antigravity-native-addon-host` v2 `validateSafeCssText` and
   *   `scopeCssToOwner` (zero `@import`, zero CSS nesting, zero sibling combinators, exact
   *   `:host` and `[data-addon-host-owner="antigravity-mcp-manager"].addon-host-slot-root` rooting).
   * - Light DOM `settings-nav` (`shadow: false`) sets inline `display: contents` directly on its
   *   host wrapper so zero `<style>` tags pollute `document.head`.
   */
  const OWNER_ROOT = '[data-addon-host-owner="antigravity-mcp-manager"].addon-host-slot-root';
  const STYLE_IDS = Object.freeze({
    PANE: 'mcp-manager-pane',
    CUSTOMIZATIONS_BTN: 'mcp-manager-customizations-btn',
    CUSTOMIZATIONS_OVERLAY: 'mcp-manager-customizations-overlay',
  });

  function buildLauncherCss() {
    return [
      '[data-agy-mcp-sidecar-launcher="true"] {',
      '  box-sizing: border-box;',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  overflow: auto;',
      '  padding: 24px;',
      '  display: flex;',
      '  align-items: flex-start;',
      '  justify-content: center;',
      '  color: inherit;',
      '  font-family: inherit;',
      '}',
      '[data-agy-mcp-launcher-card="true"] {',
      '  box-sizing: border-box;',
      '  width: 100%;',
      '  max-width: 680px;',
      '  border: 1px solid rgba(128, 128, 128, 0.28);',
      '  border-radius: 12px;',
      '  padding: 20px 22px;',
      '  background: rgba(128, 128, 128, 0.08);',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 14px;',
      '}',
      '[data-agy-mcp-launcher-header="true"] {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 12px;',
      '  flex-wrap: wrap;',
      '}',
      '[data-agy-mcp-launcher-title-wrap="true"] {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 10px;',
      '  flex-wrap: wrap;',
      '}',
      '[data-agy-mcp-launcher-title="true"] {',
      '  margin: 0;',
      '  font-size: 18px;',
      '  font-weight: 600;',
      '  line-height: 1.3;',
      '}',
      '[data-agy-mcp-launcher-badge="true"] {',
      '  font-size: 11px;',
      '  font-weight: 500;',
      '  padding: 2px 8px;',
      '  border-radius: 999px;',
      '  border: 1px solid rgba(128, 128, 128, 0.32);',
      '  background: rgba(128, 128, 128, 0.14);',
      '}',
      '[data-agy-mcp-lang-switch="true"] {',
      '  display: inline-flex;',
      '  gap: 4px;',
      '}',
      '[data-agy-mcp-lang-btn] {',
      '  background: transparent;',
      '  border: 1px solid rgba(128, 128, 128, 0.32);',
      '  border-radius: 6px;',
      '  color: inherit;',
      '  font-family: inherit;',
      '  font-size: 12px;',
      '  font-weight: 500;',
      '  padding: 4px 9px;',
      '  cursor: pointer;',
      '}',
      '[data-agy-mcp-lang-btn][aria-pressed="true"] {',
      '  background: rgba(128, 128, 128, 0.24);',
      '  border-color: rgba(128, 128, 128, 0.6);',
      '}',
      '[data-agy-mcp-launcher-meta="true"] {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  flex-wrap: wrap;',
      '}',
      '[data-agy-mcp-launcher-status="true"] {',
      '  font-size: 12px;',
      '  font-weight: 500;',
      '  padding: 3px 9px;',
      '  border-radius: 6px;',
      '  background: rgba(34, 197, 94, 0.16);',
      '  border: 1px solid rgba(34, 197, 94, 0.35);',
      '}',
      '[data-agy-mcp-launcher-surface="true"] {',
      '  font-size: 12px;',
      '  opacity: 0.78;',
      '}',
      '[data-agy-mcp-launcher-lead="true"] {',
      '  margin: 0;',
      '  font-size: 13px;',
      '  line-height: 1.55;',
      '  opacity: 0.9;',
      '}',
      '[data-agy-mcp-launcher-steps-title="true"] {',
      '  margin: 4px 0 0 0;',
      '  font-size: 13px;',
      '  font-weight: 600;',
      '}',
      '[data-agy-mcp-launcher-steps="true"] {',
      '  margin: 0;',
      '  padding-left: 20px;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 6px;',
      '  font-size: 13px;',
      '  line-height: 1.5;',
      '}',
      '[data-agy-mcp-launcher-footer="true"] {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  flex-wrap: wrap;',
      '  padding-top: 10px;',
      '  border-top: 1px solid rgba(128, 128, 128, 0.22);',
      '  font-size: 12px;',
      '}',
      '[data-agy-mcp-launcher-config-label="true"] {',
      '  opacity: 0.78;',
      '}',
      '[data-agy-mcp-launcher-config-path="true"] {',
      '  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;',
      '  font-size: 12px;',
      '  padding: 2px 6px;',
      '  border-radius: 4px;',
      '  background: rgba(128, 128, 128, 0.16);',
      '}',
    ].join('\n');
  }

  function buildNativePanelCss() {
    return [
      '[data-agy-mcp-native-panel="true"] {',
      '  box-sizing: border-box;',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  overflow: auto;',
      '  color: inherit;',
      '  font-family: inherit;',
      '  font-size: 13px;',
      '  line-height: 1.45;',
      '}',
      '[data-agy-mcp-native-panel="true"] * {',
      '  box-sizing: border-box;',
      '}',
      '[data-agy-mcp-native-panel="true"][data-agy-mcp-surface="settings"] .mcp-shell {',
      '  max-width: 780px;',
      '  margin: 0 auto;',
      '  padding: 28px 44px 40px 36px;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 14px;',
      '}',
      '[data-agy-mcp-native-panel="true"][data-agy-mcp-surface="customizations"] .mcp-shell {',
      '  width: 100%;',
      '  padding: 16px 20px 24px;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 12px;',
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
      '  font-size: 20px;',
      '  font-weight: 600;',
      '  letter-spacing: -0.02em;',
      '  line-height: 1.3;',
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
      '  border: 1px solid rgba(128, 128, 128, 0.28);',
      '  border-radius: 8px;',
      '  background: rgba(128, 128, 128, 0.08);',
      '}',
      '.mcp-lang-btn {',
      '  background: transparent;',
      '  color: inherit;',
      '  opacity: 0.78;',
      '  border: 0;',
      '  border-radius: 6px;',
      '  padding: 4px 9px;',
      '  cursor: pointer;',
      '  font-family: inherit;',
      '  font-size: 11.5px;',
      '  font-weight: 500;',
      '  line-height: 1.3;',
      '}',
      '.mcp-lang-btn[aria-pressed="true"] {',
      '  background: rgba(128, 128, 128, 0.24);',
      '  opacity: 1;',
      '}',
      '.mcp-lang-btn:focus-visible {',
      '  outline: 2px solid #3b82f6;',
      '  outline-offset: 1px;',
      '}',
      '.mcp-tabs {',
      '  display: inline-flex;',
      '  align-self: flex-start;',
      '  gap: 2px;',
      '  padding: 3px;',
      '  border: 1px solid rgba(128, 128, 128, 0.24);',
      '  border-radius: 9px;',
      '  background: rgba(128, 128, 128, 0.08);',
      '}',
      '.mcp-tab {',
      '  background: transparent;',
      '  color: inherit;',
      '  opacity: 0.78;',
      '  border: 0;',
      '  border-radius: 6px;',
      '  padding: 5px 12px;',
      '  cursor: pointer;',
      '  font-family: inherit;',
      '  font-size: 12px;',
      '  font-weight: 500;',
      '}',
      '.mcp-tab.active {',
      '  background: rgba(128, 128, 128, 0.24);',
      '  opacity: 1;',
      '}',
      '.mcp-tab:focus-visible {',
      '  outline: 2px solid #3b82f6;',
      '  outline-offset: 1px;',
      '}',
      '.mcp-btn {',
      '  border-radius: 8px;',
      '  padding: 6px 12px;',
      '  font-family: inherit;',
      '  font-size: 12px;',
      '  font-weight: 500;',
      '  cursor: pointer;',
      '  border: 1px solid rgba(128, 128, 128, 0.28);',
      '  background: rgba(128, 128, 128, 0.12);',
      '  color: inherit;',
      '  line-height: 1.3;',
      '}',
      '.mcp-btn:hover {',
      '  background: rgba(128, 128, 128, 0.22);',
      '  border-color: rgba(128, 128, 128, 0.42);',
      '}',
      '.mcp-btn:focus-visible {',
      '  outline: 2px solid #3b82f6;',
      '  outline-offset: 1px;',
      '}',
      '.mcp-btn-primary {',
      '  background: #2563eb;',
      '  color: #ffffff;',
      '  border-color: transparent;',
      '  font-weight: 600;',
      '}',
      '.mcp-btn-primary:hover {',
      '  background: #1d4ed8;',
      '}',
      '.mcp-btn-danger {',
      '  background: transparent;',
      '  color: #f87171;',
      '  border-color: rgba(239, 68, 68, 0.36);',
      '}',
      '.mcp-btn-danger:hover {',
      '  background: rgba(239, 68, 68, 0.16);',
      '  border-color: rgba(239, 68, 68, 0.56);',
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
      '  border: 1px solid rgba(128, 128, 128, 0.28);',
      '  background: rgba(128, 128, 128, 0.10);',
      '}',
      '.mcp-badge-ok {',
      '  color: #34d399;',
      '  border-color: rgba(16, 185, 129, 0.42);',
      '  background: rgba(16, 185, 129, 0.12);',
      '}',
      '.mcp-badge-warn {',
      '  color: #fbbf24;',
      '  border-color: rgba(245, 158, 11, 0.45);',
      '  background: rgba(245, 158, 11, 0.12);',
      '}',
      '.mcp-badge-err {',
      '  color: #f87171;',
      '  border-color: rgba(239, 68, 68, 0.45);',
      '  background: rgba(239, 68, 68, 0.12);',
      '}',
      '.mcp-badge-muted {',
      '  opacity: 0.82;',
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
      '  border-radius: 8px;',
      '  border: 1px solid rgba(128, 128, 128, 0.30);',
      '  background: rgba(128, 128, 128, 0.10);',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 6px;',
      '}',
      '.mcp-banner-error {',
      '  border-color: rgba(239, 68, 68, 0.56);',
      '  background: rgba(239, 68, 68, 0.10);',
      '}',
      '.mcp-banner-warn {',
      '  border-color: rgba(245, 158, 11, 0.56);',
      '  background: rgba(245, 158, 11, 0.10);',
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
      '  opacity: 0.78;',
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
      '  border: 1px solid rgba(128, 128, 128, 0.24);',
      '  border-radius: 12px;',
      '  background: rgba(128, 128, 128, 0.05);',
      '  overflow: hidden;',
      '}',
      '.mcp-server-row {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 14px;',
      '  padding: 13px 16px;',
      '  border-bottom: 1px solid rgba(128, 128, 128, 0.16);',
      '}',
      '.mcp-server-row:last-child {',
      '  border-bottom: 0;',
      '}',
      '.mcp-server-row.mcp-row-disabled {',
      '  opacity: 0.65;',
      '}',
      '.mcp-empty-row {',
      '  padding: 16px;',
      '  opacity: 0.78;',
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
      '  opacity: 0.78;',
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
      '  border: 1px solid rgba(128, 128, 128, 0.26);',
      '  border-radius: 10px;',
      '  padding: 14px 16px;',
      '  background: rgba(128, 128, 128, 0.06);',
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
      '  opacity: 0.82;',
      '}',
      '.mcp-input, .mcp-select, .mcp-textarea {',
      '  width: 100%;',
      '  background: rgba(128, 128, 128, 0.10);',
      '  color: inherit;',
      '  border: 1px solid rgba(128, 128, 128, 0.34);',
      '  border-radius: 6px;',
      '  padding: 7px 9px;',
      '  font-family: inherit;',
      '  font-size: 12.5px;',
      '}',
      '.mcp-select option {',
      '  background: #181a1f;',
      '  color: #f3f4f6;',
      '}',
      '.mcp-input:focus-visible, .mcp-select:focus-visible, .mcp-textarea:focus-visible {',
      '  outline: 2px solid #3b82f6;',
      '  outline-offset: 1px;',
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
    ].join('\n');
  }
  function buildPaneSlotCss() {
    return [
      ':host {',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      ':host([data-agy-mcp-hidden="true"]) {',
      '  display: none;',
      '}',
      `${OWNER_ROOT} {`,
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      '[data-agy-mcp-manager-frame="true"] {',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  border: 0;',
      '  display: block;',
      '  background: transparent;',
      '}',
      buildLauncherCss(),
      buildNativePanelCss(),
    ].join('\n');
  }
  function buildCustomizationsBtnSlotCss() {
    return [
      ':host {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  flex-shrink: 0;',
      '}',
      `${OWNER_ROOT} {`,
      '  display: inline-flex;',
      '  align-items: center;',
      '}',
      '[data-agy-mcp-customizations-btn="true"] {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  height: 24px;',
      '  box-sizing: border-box;',
      '  background: rgba(128, 128, 128, 0.10);',
      '  border: 1px solid rgba(128, 128, 128, 0.24);',
      '  border-radius: 6px;',
      '  color: inherit;',
      '  font-family: inherit;',
      '  font-size: 11.5px;',
      '  font-weight: 500;',
      '  line-height: 1;',
      '  padding: 0 9px;',
      '  margin-right: 4px;',
      '  cursor: pointer;',
      '  white-space: nowrap;',
      '  transition: background-color 120ms ease, border-color 120ms ease;',
      '}',
      '[data-agy-mcp-customizations-btn="true"]:hover {',
      '  background: rgba(128, 128, 128, 0.20);',
      '  border-color: rgba(128, 128, 128, 0.40);',
      '}',
      '[data-agy-mcp-customizations-btn="true"]:focus-visible {',
      '  outline: 2px solid currentColor;',
      '  outline-offset: 2px;',
      '}',
      '@media (prefers-reduced-motion: reduce) {',
      '  [data-agy-mcp-customizations-btn="true"] {',
      '    transition: none;',
      '  }',
      '}',
    ].join('\n');
  }
  function buildCustomizationsOverlaySlotCss() {
    return [
      ':host {',
      '  width: 100%;',
      '  height: 100%;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      `${OWNER_ROOT} {`,
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      '[data-agy-mcp-customizations-topbar="true"] {',
      '  height: 46px;',
      '  flex: 0 0 auto;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  padding: 0 16px;',
      '  border-bottom: 1px solid rgba(128, 128, 128, 0.22);',
      '}',
      '[data-agy-mcp-customizations-title="true"] {',
      '  margin: 0;',
      '  font-size: 14px;',
      '  font-weight: 600;',
      '  line-height: 1.3;',
      '  color: inherit;',
      '}',
      '[data-agy-mcp-customizations-close="true"] {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  background: transparent;',
      '  border: 0;',
      '  border-radius: 6px;',
      '  color: inherit;',
      '  font-size: 15px;',
      '  line-height: 1;',
      '  width: 28px;',
      '  height: 28px;',
      '  cursor: pointer;',
      '  transition: background-color 120ms ease;',
      '}',
      '[data-agy-mcp-customizations-close="true"]:hover {',
      '  background: rgba(128, 128, 128, 0.18);',
      '}',
      '[data-agy-mcp-customizations-close="true"]:focus-visible {',
      '  outline: 2px solid currentColor;',
      '  outline-offset: 2px;',
      '}',
      '@media (prefers-reduced-motion: reduce) {',
      '  [data-agy-mcp-customizations-close="true"] {',
      '    transition: none;',
      '  }',
      '}',
      '[data-agy-mcp-customizations-content="true"] {',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      '[data-agy-mcp-manager-frame="true"] {',
      '  width: 100%;',
      '  height: 100%;',
      '  flex: 1 1 auto;',
      '  min-height: 0;',
      '  border: 0;',
      '  display: block;',
      '  background: transparent;',
      '}',
      buildLauncherCss(),
      buildNativePanelCss(),
    ].join('\n');
  }
  function buildSlotStyleDescriptors() {
    return Object.freeze([
      Object.freeze({
        styleId: STYLE_IDS.PANE,
        slotId: SLOT_IDS.SETTINGS_PANE,
        cssText: buildPaneSlotCss(),
      }),
      Object.freeze({
        styleId: STYLE_IDS.CUSTOMIZATIONS_BTN,
        slotId: SLOT_IDS.CUSTOMIZATIONS_BTN,
        cssText: buildCustomizationsBtnSlotCss(),
      }),
      Object.freeze({
        styleId: STYLE_IDS.CUSTOMIZATIONS_OVERLAY,
        slotId: SLOT_IDS.CUSTOMIZATIONS_OVERLAY,
        cssText: buildCustomizationsOverlaySlotCss(),
      }),
    ]);
  }

  // --- module: settings-sidebar-mount.mjs ---
  /**
   * Settings Sidebar Mount Adapter (`src/adapters/antigravity/renderer/settings-sidebar-mount.mjs`).
   *
   * SOLID Boundaries:
   * - SRP: Discovers Antigravity's Settings left sidebar (`Browser`/`브라우저`) and right
   *   content pane, mounts `settings-nav` (`shadow: false`) and `pane` (`shadow: true`) via
   *   `AddonManifest.v2` `runtime.mountSlot(slotId, { container })`, handles paint-only
   *   0px-shift selection, preserves native top-right close (`✕`), renders either a live
   *   loopback `<iframe>` (when a host/test SidecarBridge URL is present) or the EN/KO Native
   *   Sidecar launcher panel, and restores all native DOM state on sibling click or `dispose()`.
   * - LSP / ISP: Implements the standard Mount Adapter contract (`id`, `ensureMount`,
   *   `syncLabels`, `getFrames`, `handleKeydown`, `dispose`) using only the narrow `runtime` port.
   */
  const NAV_ATTR = 'data-agy-mcp-manager-nav';
  const PREV_DISPLAY_ATTR = 'agyMcpPrevDisplay';
  const SUPPRESSED_BG_ATTR = 'agyMcpSuppressedBg';
  const SUPPRESSED_COLOR_ATTR = 'agyMcpSuppressedColor';

  const BROWSER_LABELS = ['browser', '브라우저'];
  const REQUIRED_SIBLING_LABELS = [
    'general',
    'application',
    'appearance',
    'shortcuts',
    'notifications',
    'models',
    'browser',
    '일반',
    '애플리케이션',
    '앱',
    '외관',
    '모양',
    '화면',
    '단축키',
    '바로가기',
    '알림',
    '모델',
    '브라우저',
  ];
  function createSettingsSidebarMount({ runtime, onLangChange = () => {}, win = window, doc = document }) {
    let boundClickHost = null;
    let boundClickHandler = null;
    let activeSidebar = null;
    let activeContentPane = null;
    let navHostEl = null;
    let navItemEl = null;
    let paneHostEl = null;
    let paneRootEl = null;
    let frameEl = null;
    let launcherView = null;
    let nativePanelView = null;
    let isPaneActive = false;

    function findSettingsSidebarAndAnchor() {
      const candidates = doc.querySelectorAll('button, a, [role="tab"], [role="menuitem"], [role="button"], li, div');
      for (const el of candidates) {
        if (el.hasAttribute(NAV_ATTR) || el.closest?.(`[data-addon-host-slot="${SLOT_IDS.SETTINGS_NAV}"]`)) continue;
        if (el.children.length > 2) continue;
        if (!BROWSER_LABELS.includes(normalizedText(el))) continue;

        let container = el.parentElement;
        for (let depth = 0; depth < 4 && container && container !== doc.body; depth += 1) {
          const items = Array.from(
            container.querySelectorAll('button, a, [role="tab"], [role="menuitem"], [role="button"], li, div')
          );
          const seen = new Map();
          for (const item of items) {
            if (item.children.length > 2) continue;
            const txt = normalizedText(item);
            if (REQUIRED_SIBLING_LABELS.includes(txt) && !seen.has(txt)) {
              seen.set(txt, item);
            }
          }
          if (seen.size >= 4) {
            let anchor = el;
            while (anchor.parentElement && anchor.parentElement !== container && anchor.parentElement.children.length === 1) {
              anchor = anchor.parentElement;
            }
            const listParent = anchor.parentElement || container;
            const directSiblings = Array.from(listParent.children).filter(
              (c) =>
                c.nodeType === 1 &&
                !c.hasAttribute(NAV_ATTR) &&
                c.getAttribute('data-addon-host-slot') !== SLOT_IDS.SETTINGS_NAV &&
                REQUIRED_SIBLING_LABELS.includes(normalizedText(c))
            );
            const inactiveSibling =
              directSiblings.find(
                (c) => !hasVisibleBg(c, win) && !['general', '일반', ...BROWSER_LABELS].includes(normalizedText(c))
              ) ||
              directSiblings.find((c) => !hasVisibleBg(c, win)) ||
              anchor;
            return { sidebar: container, listParent, browserItem: anchor, inactiveTemplate: inactiveSibling };
          }
          container = container.parentElement;
        }
      }
      return null;
    }

    function findSettingsLayout(sidebar) {
      const sidebarRect = sidebar.getBoundingClientRect?.() || { left: 0, right: 0, width: 0, height: 0 };
      let cursor = sidebar;
      for (let depth = 0; depth < 8 && cursor && cursor.parentElement && cursor.parentElement !== doc.documentElement; depth += 1) {
        const parent = cursor.parentElement;
        const cursorRect = cursor.getBoundingClientRect?.() || sidebarRect;
        const rightBoundary = Math.max(sidebarRect.right, cursorRect.right);
        const siblings = Array.from(parent.children).filter((child) => {
          if (child === cursor || child.nodeType !== 1) return false;
          if (child.tagName === 'STYLE' || child.tagName === 'SCRIPT') return false;
          const r = child.getBoundingClientRect?.();
          if (!r) return false;
          return r.width >= 280 && r.height >= 200 && r.left >= rightBoundary - 24;
        });
        if (siblings.length > 0) {
          let best = siblings[0];
          let bestArea = 0;
          for (const sib of siblings) {
            const r = sib.getBoundingClientRect();
            const area = r.width * r.height;
            if (area > bestArea) {
              bestArea = area;
              best = sib;
            }
          }
          return { outerSidebar: cursor, contentPane: best };
        }
        cursor = parent;
      }
      return { outerSidebar: sidebar, contentPane: null };
    }

    function isSettingsCloseControl(child, contentPaneRect) {
      if (!child || child.nodeType !== 1) return false;
      const isCloseBtn = (btn) => {
        const aria = String(btn.getAttribute?.('aria-label') || btn.getAttribute?.('title') || '').toLowerCase();
        if (aria.includes('close') || aria.includes('닫기')) return true;
        const txt = normalizedText(btn);
        if (txt === '×' || txt === '✕' || txt === 'x') return true;
        const r = btn.getBoundingClientRect?.();
        if (!r || !contentPaneRect) return false;
        const isSmall = r.width > 0 && r.width <= 52 && r.height > 0 && r.height <= 52;
        const isTopRight = r.right >= contentPaneRect.right - 72 && r.top <= contentPaneRect.top + 72;
        return isSmall && isTopRight;
      };
      if (child.tagName === 'BUTTON' && isCloseBtn(child)) return true;
      const r = child.getBoundingClientRect?.();
      if (
        r &&
        contentPaneRect &&
        r.width <= 64 &&
        r.height <= 64 &&
        r.right >= contentPaneRect.right - 72 &&
        r.top <= contentPaneRect.top + 72
      ) {
        const innerBtn = child.querySelector?.('button');
        if (innerBtn && isCloseBtn(innerBtn)) return true;
      }
      return false;
    }

    // Paint-only active suppression: NEVER mutates className, padding, margin, height, or font-weight (0px shift)
    function suppressNativeActiveItems(listParent, navHost, inactiveColor) {
      let detectedActiveBg = 'rgba(255, 255, 255, 0.08)';
      let detectedActiveColor = '#ffffff';
      const dimNode = (el) => {
        if (!Object.prototype.hasOwnProperty.call(el.dataset, SUPPRESSED_BG_ATTR)) {
          el.dataset[SUPPRESSED_BG_ATTR] = el.style.backgroundColor || '';
          el.dataset[SUPPRESSED_COLOR_ATTR] = el.style.color || '';
        }
        el.style.setProperty('background-color', 'transparent', 'important');
        if (inactiveColor) {
          el.style.setProperty('color', inactiveColor, 'important');
        }
      };

      if (listParent) {
        for (const sib of Array.from(listParent.children)) {
          if (sib.nodeType !== 1 || sib === navHost || sib.getAttribute('data-addon-host-slot') === SLOT_IDS.SETTINGS_NAV) continue;
          const cs = win.getComputedStyle(sib);
          if (hasVisibleBg(sib, win)) {
            detectedActiveBg = cs.backgroundColor;
            if (cs.color) detectedActiveColor = cs.color;
          }
          dimNode(sib);
          for (const inner of Array.from(sib.querySelectorAll('button, span, div'))) {
            const ics = win.getComputedStyle(inner);
            if (hasVisibleBg(inner, win)) {
              detectedActiveBg = ics.backgroundColor;
              if (ics.color) detectedActiveColor = ics.color;
            }
            dimNode(inner);
          }
        }
      }
      return { activeBg: detectedActiveBg, activeColor: detectedActiveColor };
    }

    function restoreNativeActiveItems(outerSidebar) {
      if (!outerSidebar) return;
      const suppressed = outerSidebar.querySelectorAll('[data-agy-mcp-suppressed-bg]');
      for (const item of suppressed) {
        item.style.removeProperty('background-color');
        item.style.removeProperty('color');
        if (item.dataset[SUPPRESSED_BG_ATTR]) {
          item.style.backgroundColor = item.dataset[SUPPRESSED_BG_ATTR];
        }
        if (item.dataset[SUPPRESSED_COLOR_ATTR]) {
          item.style.color = item.dataset[SUPPRESSED_COLOR_ATTR];
        }
        delete item.dataset[SUPPRESSED_BG_ATTR];
        delete item.dataset[SUPPRESSED_COLOR_ATTR];
      }
    }

    function restoreNativePane(outerSidebar, contentPane, navItem) {
      isPaneActive = false;
      restoreNativeActiveItems(outerSidebar);
      if (navItem) {
        navItem.setAttribute('aria-selected', 'false');
        navItem.dataset.agyMcpActive = 'false';
        navItem.style.removeProperty('background-color');
        navItem.style.removeProperty('color');
        for (const inner of Array.from(navItem.querySelectorAll('button, span, div'))) {
          inner.style.removeProperty('background-color');
          inner.style.removeProperty('color');
        }
      }
      if (paneHostEl) {
        paneHostEl.setAttribute('data-agy-mcp-hidden', 'true');
        paneHostEl.style.display = 'none';
      }
      if (!contentPane) return;
      for (const child of Array.from(contentPane.children)) {
        if (child === paneHostEl || child.getAttribute('data-addon-host-slot') === SLOT_IDS.SETTINGS_PANE) continue;
        if (child.dataset && Object.prototype.hasOwnProperty.call(child.dataset, PREV_DISPLAY_ATTR)) {
          child.style.display = child.dataset[PREV_DISPLAY_ATTR];
          delete child.dataset[PREV_DISPLAY_ATTR];
        }
      }
    }

    function renderPaneContent(contentPane) {
      if (!contentPane) return;
      const slotRoot = runtime.mountSlot(SLOT_IDS.SETTINGS_PANE, { container: contentPane });
      if (!slotRoot) return;
      const slotHost = runtime.getSlotHostElement(slotRoot);
      paneRootEl = slotRoot;
      paneHostEl = slotHost;

      if (slotHost && slotHost.style) {
        slotHost.removeAttribute('data-agy-mcp-hidden');
        slotHost.style.display = 'flex';
        slotHost.style.flexDirection = 'column';
        slotHost.style.flex = '1 1 auto';
        slotHost.style.minHeight = '0';
        slotHost.style.width = '100%';
        slotHost.style.height = '100%';
      }

      if (typeof runtime.hasConfigBridge === 'function' && runtime.hasConfigBridge()) {
        if (frameEl && frameEl.parentNode) frameEl.parentNode.removeChild(frameEl);
        frameEl = null;
        if (launcherView && launcherView.element.parentNode) launcherView.element.parentNode.removeChild(launcherView.element);
        launcherView = null;

        if (!nativePanelView || nativePanelView.element.parentNode !== slotRoot) {
          if (nativePanelView) nativePanelView.dispose();
          while (slotRoot.firstChild) slotRoot.removeChild(slotRoot.firstChild);
          const service = runtime.createConfigService();
          nativePanelView = createNativeMcpPanel({ runtime, service, surface: 'settings', onLangChange, doc });
          slotRoot.appendChild(nativePanelView.element);
        } else {
          nativePanelView.syncLang();
        }
        return;
      }

      if (nativePanelView) {
        nativePanelView.dispose();
        nativePanelView = null;
      }

      const baseUrl = runtime.getServerUrl();
      if (baseUrl) {
        if (launcherView && launcherView.element.parentNode) {
          launcherView.element.parentNode.removeChild(launcherView.element);
        }
        launcherView = null;

        const themedUrl = runtime.buildThemedIframeUrl(baseUrl, contentPane);
        if (!frameEl || frameEl.parentNode !== slotRoot) {
          while (slotRoot.firstChild) slotRoot.removeChild(slotRoot.firstChild);
          frameEl = doc.createElement('iframe');
          frameEl.setAttribute(FRAME_ATTR, 'true');
          frameEl.setAttribute('title', 'MCP Manager');
          frameEl.src = themedUrl;
          slotRoot.appendChild(frameEl);
        } else if (!sameFrameBaseAndTheme(frameEl.src, themedUrl)) {
          frameEl.src = themedUrl;
        }
        return;
      }

      if (frameEl && frameEl.parentNode) {
        frameEl.parentNode.removeChild(frameEl);
      }
      frameEl = null;

      if (!launcherView || launcherView.element.parentNode !== slotRoot) {
        while (slotRoot.firstChild) slotRoot.removeChild(slotRoot.firstChild);
        launcherView = createSidecarLauncherView({ runtime, surface: 'settings', onLangChange, doc });
        slotRoot.appendChild(launcherView.element);
      } else {
        launcherView.syncLang();
      }
    }

    function showMcpManagerPane(outerSidebar, listParent, contentPane, navHost, navItem) {
      if (!contentPane) return;

      activeSidebar = outerSidebar;
      activeContentPane = contentPane;
      isPaneActive = true;

      const inactiveColor = navItem?.dataset?.agyMcpInactiveColor || '';
      const { activeBg, activeColor } = suppressNativeActiveItems(listParent, navHost, inactiveColor);

      if (navItem) {
        navItem.setAttribute('aria-selected', 'true');
        navItem.dataset.agyMcpActive = 'true';
        const nextTextColor = activeColor || '#ffffff';
        navItem.style.setProperty('background-color', activeBg, 'important');
        navItem.style.setProperty('color', nextTextColor, 'important');
        for (const inner of Array.from(navItem.querySelectorAll('button, span, div'))) {
          inner.style.setProperty('background-color', 'transparent', 'important');
          inner.style.setProperty('color', nextTextColor, 'important');
        }
      }

      const contentPaneRect = contentPane.getBoundingClientRect?.();
      for (const child of Array.from(contentPane.children)) {
        if (child === paneHostEl || child.getAttribute('data-addon-host-slot') === SLOT_IDS.SETTINGS_PANE) continue;
        if (isSettingsCloseControl(child, contentPaneRect)) {
          child.style.zIndex = '20';
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(child.dataset, PREV_DISPLAY_ATTR)) {
          child.dataset[PREV_DISPLAY_ATTR] = child.style.display || '';
        }
        child.style.display = 'none';
      }

      renderPaneContent(contentPane);
    }

    function ensureMount() {
      const found = findSettingsSidebarAndAnchor();
      if (!found) return;
      const { sidebar, listParent, browserItem, inactiveTemplate } = found;
      const { outerSidebar, contentPane: initialContentPane } = findSettingsLayout(sidebar);

      if (navItemEl && navItemEl.isConnected && sidebar.contains(navItemEl)) {
        if (isPaneActive && initialContentPane) {
          renderPaneContent(initialContentPane);
        } else if (frameEl && frameEl.isConnected) {
          const baseUrl = runtime.getServerUrl();
          if (baseUrl) {
            const nextUrl = runtime.buildThemedIframeUrl(baseUrl, initialContentPane);
            if (!sameFrameBaseAndTheme(frameEl.src, nextUrl)) {
              frameEl.src = nextUrl;
            }
          }
        }
        return;
      }

      const navSlot = runtime.mountSlot(SLOT_IDS.SETTINGS_NAV, { container: listParent });
      if (!navSlot) return;
      const navHost = runtime.getSlotHostElement(navSlot);
      if (navHost && navHost.style) {
        navHost.style.display = 'contents';
      }
      while (navSlot.firstChild) navSlot.removeChild(navSlot.firstChild);

      // Clone an INACTIVE native sibling node and keep its className immutable (0px shift, native focus ring intact)
      const navItem = inactiveTemplate.cloneNode(true);
      navItem.removeAttribute('id');
      navItem.setAttribute(NAV_ATTR, 'true');
      navItem.setAttribute('aria-selected', 'false');
      navItem.dataset.agyMcpActive = 'false';
      navItem.dataset.agyMcpInactiveColor = win.getComputedStyle(inactiveTemplate)?.color || '';
      replaceLeafText(navItem, 'MCP Manager', doc);

      navItem.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const layout = findSettingsLayout(sidebar);
        showMcpManagerPane(layout.outerSidebar, listParent, layout.contentPane, navHost, navItem);
      });

      navSlot.appendChild(navItem);
      navHostEl = navHost;
      navItemEl = navItem;

      // Position inside the same listParent right after browserItem (parentNode unchanged -> host idempotent & auto-disposed)
      if (browserItem.nextSibling && browserItem.nextSibling !== navHost) {
        listParent.insertBefore(navHost, browserItem.nextSibling);
      }

      const clickHost = outerSidebar || sidebar;
      if (boundClickHost !== clickHost) {
        if (boundClickHost && boundClickHandler) {
          boundClickHost.removeEventListener('click', boundClickHandler, true);
        }
        boundClickHost = clickHost;
        boundClickHandler = (ev) => {
          const target = ev.target;
          if (!target || target.closest?.(`[${NAV_ATTR}="true"]`)) return;
          if (navItemEl && navItemEl.isConnected && navItemEl.dataset.agyMcpActive === 'true') {
            const layout = findSettingsLayout(sidebar);
            restoreNativePane(layout.outerSidebar, layout.contentPane, navItemEl);
          }
        };
        clickHost.addEventListener('click', boundClickHandler, true);
      }
    }

    function syncLabels() {
      if (nativePanelView) {
        nativePanelView.syncLang();
      }
      if (launcherView) {
        launcherView.syncLang();
      }
    }

    function getFrames() {
      return frameEl && frameEl.isConnected ? [frameEl] : [];
    }

    function dispose() {
      restoreNativePane(activeSidebar || boundClickHost, activeContentPane, navItemEl);
      if (boundClickHost && boundClickHandler) {
        boundClickHost.removeEventListener('click', boundClickHandler, true);
      }
      boundClickHost = null;
      boundClickHandler = null;
      activeSidebar = null;
      activeContentPane = null;
      navHostEl = null;
      navItemEl = null;
      paneHostEl = null;
      paneRootEl = null;
      if (nativePanelView) {
        nativePanelView.dispose();
        nativePanelView = null;
      }
      frameEl = null;
      launcherView = null;
      isPaneActive = false;
      try {
        runtime.unmountSlot(SLOT_IDS.SETTINGS_PANE);
      } catch {
        // Ignore if host already unmounted
      }
      try {
        runtime.unmountSlot(SLOT_IDS.SETTINGS_NAV);
      } catch {
        // Ignore if host already unmounted
      }
    }

    return Object.freeze({
      id: 'settings-sidebar',
      ensureMount,
      syncLabels,
      getFrames,
      handleKeydown: () => {},
      dispose,
    });
  }

  // --- module: customizations-mount.mjs ---
  /**
   * Customizations Screen Mount Adapter (`src/adapters/antigravity/renderer/customizations-mount.mjs`).
   *
   * SOLID Boundaries:
   * - SRP: Detects Antigravity's Customizations (`MCP Servers` / `MCP 서버`) header,
   *   mounts the trigger button (`custom` slot, Shadow DOM Option B2) immediately before
   *   right-hand action icons, and opens/closes the full-pane modal overlay via
   *   `AddonManifest.v2` `runtime.openModal(slotId, { shadow: true, onClose })` (preserving
   *   host `marginTop`/`zIndex` & `PortalArbiter` LIFO `Escape` / focus restoration), rendering
   *   either the live loopback `<iframe>` or the EN/KO Native Sidecar launcher panel.
   * - LSP / ISP: Implements the exact same Mount Adapter contract as `settings-sidebar-mount.mjs`.
   */
  const CUSTOMIZATIONS_BTN_ATTR = 'data-agy-mcp-customizations-btn';
  const CUSTOMIZATIONS_OVERLAY_ATTR = 'data-agy-mcp-customizations-overlay';
  const CUSTOMIZATIONS_TOPBAR_ATTR = 'data-agy-mcp-customizations-topbar';
  const CUSTOMIZATIONS_TITLE_ATTR = 'data-agy-mcp-customizations-title';
  const CUSTOMIZATIONS_CLOSE_ATTR = 'data-agy-mcp-customizations-close';
  const CUSTOMIZATIONS_CONTENT_ATTR = 'data-agy-mcp-customizations-content';

  const CUSTOMIZATIONS_PAGE_MARKERS = [
    'customizations',
    'skills & rules',
    'custom agents',
    '사용자 정의',
    '맞춤 설정',
    '커스터마이징',
    '스킬 및 규칙',
    '사용자 지정 에이전트',
    '커스텀 에이전트',
  ];
  const MCP_SERVERS_SECTION_LABELS = ['mcp servers', 'mcp 서버'];

  function isCustomizationsMarker(txt) {
    return CUSTOMIZATIONS_PAGE_MARKERS.some(
      (marker) => txt === marker || (txt.startsWith(marker) && /^[\s(]*\d*[\s)]*$/.test(txt.slice(marker.length)))
    );
  }

  function isMcpServersLabel(txt) {
    return MCP_SERVERS_SECTION_LABELS.some(
      (label) => txt === label || (txt.startsWith(label) && /^[\s(]*\d+[\s)]*$/.test(txt.slice(label.length)))
    );
  }
  function createCustomizationsMount({ runtime, onLangChange = () => {}, win = window, doc = document }) {
    let lastTriggerBtn = null;
    let btnHostEl = null;
    let btnRootEl = null;
    let btnEl = null;
    let activeModalHandle = null;
    let modalTitleEl = null;
    let modalCloseBtnEl = null;
    let modalContentEl = null;
    let modalFrameEl = null;
    let modalLauncherView = null;
    let modalNativePanel = null;

    function resolveLang() {
      return (typeof runtime.resolveEffectiveLang === 'function' ? runtime.resolveEffectiveLang() : runtime.readSavedLang()) === 'ko'
        ? 'ko'
        : 'en';
    }

    function getButtonLabel() {
      return resolveLang() === 'ko' ? 'MCP 매니저' : 'MCP Manager';
    }

    function getCloseAriaLabel() {
      return resolveLang() === 'ko' ? 'MCP 매니저 닫기' : 'Close MCP Manager';
    }

    function isInsideOwnSlot(el) {
      if (!el || typeof el.closest !== 'function') return false;
      return Boolean(
        el.closest(`[${CUSTOMIZATIONS_OVERLAY_ATTR}="true"]`) ||
          el.closest('[data-addon-host-modal-dialog="1"]') ||
          el.closest(`[data-addon-host-slot="${SLOT_IDS.CUSTOMIZATIONS_BTN}"]`)
      );
    }

    function isCustomizationsPageVisible() {
      const candidates = doc.querySelectorAll('h1, h2, h3, h4, div, span, button');
      for (const el of candidates) {
        if (el.children.length > 2) continue;
        if (isInsideOwnSlot(el)) continue;
        if (isCustomizationsMarker(normalizedText(el))) {
          const rect = el.getBoundingClientRect?.();
          if (!rect || (rect.width > 0 && rect.height > 0)) return true;
        }
      }
      return false;
    }

    function hasMatchingMcpLabelDescendant(el) {
      const descendants = el.querySelectorAll('h1, h2, h3, h4, span, div, button, p');
      for (const child of descendants) {
        if (child === el || isInsideOwnSlot(child) || child.hasAttribute(CUSTOMIZATIONS_BTN_ATTR)) continue;
        if (isMcpServersLabel(normalizedText(child))) return true;
      }
      return false;
    }

    function findCustomizationsMcpHeader() {
      if (!isCustomizationsPageVisible()) return null;
      const candidates = doc.querySelectorAll('h1, h2, h3, h4, span, div, button, p');
      for (const el of candidates) {
        if (el.children.length > 2) continue;
        if (isInsideOwnSlot(el)) continue;
        if (el.hasAttribute(CUSTOMIZATIONS_BTN_ATTR)) continue;
        if (!isMcpServersLabel(normalizedText(el))) continue;
        // Pick the innermost label node; never match an outer wrapper that wraps the collapse <button>
        if (hasMatchingMcpLabelDescendant(el)) continue;
        if (el.tagName !== 'BUTTON' && el.querySelector('button')) continue;

        const leftAnchor = el.closest?.('button') || el;
        const anchorRect = leftAnchor.getBoundingClientRect?.() || null;
        const hasAnchorBox = Boolean(anchorRect && anchorRect.width > 0 && anchorRect.height > 0);
        const anchorCenterY = hasAnchorBox ? (anchorRect.top + anchorRect.bottom) / 2 : 0;

        let row = leftAnchor.parentElement;
        for (let depth = 0; depth < 5 && row && row !== doc.body; depth += 1) {
          const rightButtons = Array.from(row.querySelectorAll('button')).filter((b) => {
            if (b === leftAnchor || b.hasAttribute(CUSTOMIZATIONS_BTN_ATTR) || isInsideOwnSlot(b)) return false;
            if (b.contains(leftAnchor) || leftAnchor.contains(b)) return false;
            if (isMcpServersLabel(normalizedText(b))) return false;
            if (hasAnchorBox) {
              const bRect = b.getBoundingClientRect?.();
              if (!bRect || bRect.width <= 0 || bRect.height <= 0) return false;
              const bCenterY = (bRect.top + bRect.bottom) / 2;
              const maxRowDelta = Math.max(anchorRect.height, bRect.height, 28);
              if (Math.abs(bCenterY - anchorCenterY) > maxRowDelta) return false;
              if (bRect.left < anchorRect.right - 2) return false;
            }
            return true;
          });

          if (rightButtons.length >= 1) {
            rightButtons.sort((a, b) => {
              const ar = a.getBoundingClientRect?.();
              const br = b.getBoundingClientRect?.();
              return (ar?.left || 0) - (br?.left || 0);
            });
            // Anchor into the rightmost action group (e.g. [] and + icon cluster) so a separate chevron button is never chosen
            const rightmostBtn = rightButtons[rightButtons.length - 1];
            const actionContainer = rightmostBtn.parentElement || row;
            const firstActionButton =
              rightButtons.find((b) => b.parentElement === actionContainer) || rightmostBtn;
            return {
              row,
              actionContainer,
              firstActionButton,
              alignRightInRow: actionContainer === row,
            };
          }
          row = row.parentElement;
        }

        const fallbackRow = leftAnchor.parentElement;
        if (fallbackRow && fallbackRow !== doc.body) {
          return { row: fallbackRow, actionContainer: fallbackRow, firstActionButton: null, alignRightInRow: true };
        }
      }
      return null;
    }

    function syncLabels() {
      const label = getButtonLabel();
      if (btnEl) btnEl.textContent = label;
      if (modalTitleEl) modalTitleEl.textContent = label;
      if (modalCloseBtnEl) modalCloseBtnEl.setAttribute('aria-label', getCloseAriaLabel());
      if (activeModalHandle?.element) activeModalHandle.element.setAttribute('aria-label', label);
      if (modalNativePanel) modalNativePanel.syncLang();
      if (modalLauncherView) modalLauncherView.syncLang();
    }

    function clearModalRefs() {
      if (modalNativePanel) {
        modalNativePanel.dispose();
      }
      activeModalHandle = null;
      modalTitleEl = null;
      modalCloseBtnEl = null;
      modalContentEl = null;
      modalFrameEl = null;
      modalLauncherView = null;
      modalNativePanel = null;
    }

    function handleModalClosed() {
      clearModalRefs();
      if (lastTriggerBtn && lastTriggerBtn.isConnected && typeof lastTriggerBtn.focus === 'function') {
        try {
          lastTriggerBtn.focus();
        } catch {
          // Ignore focus restoration errors
        }
      }
    }

    function closeOverlay() {
      const handle = activeModalHandle;
      if (!handle) return;
      clearModalRefs();
      try {
        handle.close();
      } catch {
        // Ignore if host already closed modal
      }
    }

    function renderModalContent() {
      if (!modalContentEl) return;

      if (typeof runtime.hasConfigBridge === 'function' && runtime.hasConfigBridge()) {
        if (modalFrameEl && modalFrameEl.parentNode) modalFrameEl.parentNode.removeChild(modalFrameEl);
        modalFrameEl = null;
        if (modalLauncherView && modalLauncherView.element.parentNode) {
          modalLauncherView.element.parentNode.removeChild(modalLauncherView.element);
        }
        modalLauncherView = null;

        if (!modalNativePanel || modalNativePanel.element.parentNode !== modalContentEl) {
          if (modalNativePanel) modalNativePanel.dispose();
          while (modalContentEl.firstChild) modalContentEl.removeChild(modalContentEl.firstChild);
          const service = runtime.createConfigService();
          modalNativePanel = createNativeMcpPanel({ runtime, service, surface: 'customizations', onLangChange, doc });
          modalContentEl.appendChild(modalNativePanel.element);
        } else {
          modalNativePanel.syncLang();
        }
        return;
      }

      if (modalNativePanel) {
        modalNativePanel.dispose();
        modalNativePanel = null;
      }

      const baseUrl = runtime.getServerUrl();
      if (baseUrl) {
        if (modalLauncherView && modalLauncherView.element.parentNode) {
          modalLauncherView.element.parentNode.removeChild(modalLauncherView.element);
        }
        modalLauncherView = null;

        const themedUrl = runtime.buildThemedIframeUrl(baseUrl, doc.body);
        if (!modalFrameEl || modalFrameEl.parentNode !== modalContentEl) {
          while (modalContentEl.firstChild) modalContentEl.removeChild(modalContentEl.firstChild);
          modalFrameEl = doc.createElement('iframe');
          modalFrameEl.setAttribute(FRAME_ATTR, 'true');
          modalFrameEl.setAttribute('data-agy-mcp-customizations-frame', 'true');
          modalFrameEl.setAttribute('title', 'MCP Manager');
          modalFrameEl.src = themedUrl;
          modalContentEl.appendChild(modalFrameEl);
        } else if (!sameFrameBaseAndTheme(modalFrameEl.src, themedUrl)) {
          modalFrameEl.src = themedUrl;
        }
        return;
      }

      if (modalFrameEl && modalFrameEl.parentNode) {
        modalFrameEl.parentNode.removeChild(modalFrameEl);
      }
      modalFrameEl = null;

      if (!modalLauncherView || modalLauncherView.element.parentNode !== modalContentEl) {
        while (modalContentEl.firstChild) modalContentEl.removeChild(modalContentEl.firstChild);
        modalLauncherView = createSidecarLauncherView({ runtime, surface: 'customizations', onLangChange, doc });
        modalContentEl.appendChild(modalLauncherView.element);
      } else {
        modalLauncherView.syncLang();
      }
    }

    function openOverlay(triggerBtn) {
      if (!doc.body) return;
      lastTriggerBtn = triggerBtn || btnEl || null;

      if (activeModalHandle && activeModalHandle.element && activeModalHandle.element.isConnected) {
        if (typeof activeModalHandle.reposition === 'function') {
          activeModalHandle.reposition('customizations-page');
        }
        renderModalContent();
        syncLabels();
        return;
      }

      const bodyCs = win.getComputedStyle(doc.body);
      const bodyBg = bodyCs?.backgroundColor || '';
      const hostBg = bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent' ? bodyBg : '#0d0e11';
      const hostFg = bodyCs?.color || '#e5e7eb';
      const hostFont = bodyCs?.fontFamily || 'sans-serif';

      const modalHandle = runtime.openModal(SLOT_IDS.CUSTOMIZATIONS_OVERLAY, {
        shadow: true,
        surface: 'customizations-page',
        onClose: handleModalClosed,
      });
      if (!modalHandle || !modalHandle.bodyEl) return;

      activeModalHandle = modalHandle;
      const dlg = modalHandle.element;
      if (dlg) {
        dlg.setAttribute(CUSTOMIZATIONS_OVERLAY_ATTR, 'true');
        dlg.setAttribute('aria-label', getButtonLabel());
        // Centered popup modal window:
        // - On antigravity-addons v2.4.0+, preserve host-managed surface insets (`left`/`top`/`right`/`bottom`, `margin: auto`)
        //   and dynamic resize-tracked `maxWidth`/`maxHeight` when `data-addon-host-modal-surface` is active.
        // - On legacy Host v2.3.0, preserve titlebar safe inset (`marginTop`/`top`) and viewport-clamped centering.
        if (dlg.style) {
          const hostManagedSurface = Boolean(dlg.getAttribute?.('data-addon-host-modal-surface'));
          dlg.style.boxSizing = 'border-box';
          if (hostManagedSurface) {
            dlg.style.width = '820px';
            dlg.style.height = '660px';
          } else {
            dlg.style.width = 'min(820px, calc(100vw - 48px))';
            dlg.style.maxWidth = 'calc(100vw - 48px)';
            dlg.style.height = 'min(660px, calc(100vh - 88px))';
            dlg.style.maxHeight = 'calc(100vh - 88px)';
            if (dlg.style.margin !== 'auto') {
              dlg.style.marginLeft = 'auto';
              dlg.style.marginRight = 'auto';
            }
          }
          dlg.style.padding = '0';
          dlg.style.border = '1px solid rgba(128, 128, 128, 0.28)';
          dlg.style.borderRadius = '14px';
          dlg.style.boxShadow = '0 24px 64px rgba(0, 0, 0, 0.52), 0 0 0 100vmax rgba(0, 0, 0, 0.45)';
          dlg.style.background = hostBg;
          dlg.style.color = hostFg;
          dlg.style.fontFamily = hostFont;
          dlg.style.overflow = 'hidden';
        }
        // Dismiss popup cleanly when clicking the dimmed backdrop outside the dialog bounds
        dlg.addEventListener('click', (ev) => {
          if (ev.target !== dlg) return;
          const rect = dlg.getBoundingClientRect?.();
          if (!rect || rect.width <= 0 || rect.height <= 0) return;
          const outside =
            ev.clientX < rect.left ||
            ev.clientX > rect.right ||
            ev.clientY < rect.top ||
            ev.clientY > rect.bottom;
          if (outside) {
            closeOverlay();
          }
        });
      }

      const shadowHost = runtime.getSlotHostElement(modalHandle.bodyEl);
      if (shadowHost && shadowHost !== dlg && shadowHost.style) {
        shadowHost.style.width = '100%';
        shadowHost.style.height = '100%';
        shadowHost.style.display = 'flex';
        shadowHost.style.flexDirection = 'column';
      }

      const bodyRoot = modalHandle.bodyEl;
      while (bodyRoot.firstChild) bodyRoot.removeChild(bodyRoot.firstChild);

      const topBar = doc.createElement('div');
      topBar.setAttribute(CUSTOMIZATIONS_TOPBAR_ATTR, 'true');

      const titleEl = doc.createElement('h2');
      titleEl.setAttribute(CUSTOMIZATIONS_TITLE_ATTR, 'true');
      titleEl.textContent = getButtonLabel();

      const closeBtn = doc.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute(CUSTOMIZATIONS_CLOSE_ATTR, 'true');
      closeBtn.setAttribute('aria-label', getCloseAriaLabel());
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        closeOverlay();
      });

      topBar.appendChild(titleEl);
      topBar.appendChild(closeBtn);

      const content = doc.createElement('div');
      content.setAttribute(CUSTOMIZATIONS_CONTENT_ATTR, 'true');

      bodyRoot.appendChild(topBar);
      bodyRoot.appendChild(content);

      modalTitleEl = titleEl;
      modalCloseBtnEl = closeBtn;
      modalContentEl = content;
      renderModalContent();
      syncLabels();
    }

    function ensureMount() {
      const found = findCustomizationsMcpHeader();
      if (!found) return;
      const { actionContainer, firstActionButton, alignRightInRow } = found;

      if (btnHostEl && btnHostEl.isConnected && btnHostEl.parentElement === actionContainer) {
        if (firstActionButton && firstActionButton.parentElement === actionContainer && btnHostEl.nextElementSibling !== firstActionButton) {
          actionContainer.insertBefore(btnHostEl, firstActionButton);
        }
        if (activeModalHandle && activeModalHandle.element && activeModalHandle.element.isConnected) {
          renderModalContent();
        }
        return;
      }

      const btnRoot = runtime.mountSlot(SLOT_IDS.CUSTOMIZATIONS_BTN, { container: actionContainer });
      if (!btnRoot) return;
      const btnHost = runtime.getSlotHostElement(btnRoot);
      if (btnHost && btnHost.style) {
        btnHost.style.display = 'inline-flex';
        btnHost.style.alignItems = 'center';
        btnHost.style.flexShrink = '0';
        btnHost.style.marginLeft = alignRightInRow ? 'auto' : '';
      }
      while (btnRoot.firstChild) btnRoot.removeChild(btnRoot.firstChild);

      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.setAttribute(CUSTOMIZATIONS_BTN_ATTR, 'true');
      btn.textContent = getButtonLabel();
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openOverlay(btn);
      });

      btnRoot.appendChild(btn);
      btnHostEl = btnHost;
      btnRootEl = btnRoot;
      btnEl = btn;

      if (firstActionButton && firstActionButton.parentElement === actionContainer && firstActionButton !== btnHost) {
        actionContainer.insertBefore(btnHost, firstActionButton);
      }
    }

    function handleKeydown(ev) {
      // Host ModalPortal handles capture-phase Escape LIFO; keep fallback only if not already handled
      if (ev.key !== 'Escape' || ev.defaultPrevented || ev.isComposing || ev.keyCode === 229) return;
      if (activeModalHandle && activeModalHandle.element && activeModalHandle.element.isConnected) {
        ev.preventDefault();
        closeOverlay();
      }
    }

    function getFrames() {
      return modalFrameEl && modalFrameEl.isConnected ? [modalFrameEl] : [];
    }

    function dispose() {
      lastTriggerBtn = null;
      closeOverlay();
      btnHostEl = null;
      btnRootEl = null;
      btnEl = null;
      try {
        runtime.unmountSlot(SLOT_IDS.CUSTOMIZATIONS_BTN);
      } catch {
        // Ignore if host already unmounted
      }
    }

    return Object.freeze({
      id: 'customizations',
      ensureMount,
      syncLabels,
      getFrames,
      handleKeydown,
      dispose,
    });
  }

  // --- module: mount-coordinator.mjs ---
  /**
   * Renderer Mount Coordinator (`src/adapters/antigravity/renderer/mount-coordinator.mjs`).
   *
   * SOLID Boundaries:
   * - OCP: Coordinates an open list of uniform Mount Adapters (`ensureMount`, `syncLabels`,
   *   `getFrames`, `handleKeydown`, `dispose`) and slot-scoped CSS descriptors without knowing
   *   internal DOM details of each surface.
   * - DIP: Receives `runtime` (wrapping `AddonManifest.v2` `addonHost`) and `adapters` via
   *   dependency injection; wires a single deterministic `runtime.onDispose(...)` teardown that
   *   disconnects observers, detaches managed listeners, disposes adapters, and removes every
   *   slot-scoped style.
   */
  function createMountCoordinator({ runtime, adapters, win = window, doc = document }) {
    const styleDescriptors = buildSlotStyleDescriptors();
    let started = false;
    let disposed = false;
    let scheduled = false;
    let observer = null;
    let unbindUrlListener = null;
    let detachKeydown = null;
    let detachMessage = null;
    let detachDomReady = null;

    function ensureAllMounts() {
      if (disposed) return;
      for (const adapter of adapters) {
        adapter.ensureMount();
      }
    }

    function syncAllLabels() {
      if (disposed) return;
      for (const adapter of adapters) {
        adapter.syncLabels();
      }
    }

    function collectFrames() {
      const frames = [];
      for (const adapter of adapters) {
        for (const frame of adapter.getFrames()) {
          frames.push(frame);
        }
      }
      return frames;
    }

    function scheduleEnsure() {
      if (disposed || scheduled) return;
      scheduled = true;
      const run = () => {
        scheduled = false;
        ensureAllMounts();
      };
      if (typeof win.requestAnimationFrame === 'function') {
        win.requestAnimationFrame(run);
      } else {
        setTimeout(run, 16);
      }
    }

    function onKeydown(ev) {
      if (disposed) return;
      for (const adapter of adapters) {
        adapter.handleKeydown(ev);
      }
    }

    function onMessage(ev) {
      if (disposed) return;
      if (!runtime.isTrustedIframeMessage(ev, collectFrames())) return;
      if (ev.data?.type === 'agy-mcp-lang-change' && (ev.data.lang === 'ko' || ev.data.lang === 'en')) {
        runtime.writeSavedLang(ev.data.lang);
        syncAllLabels();
      }
    }

    function attachObserver() {
      if (disposed || !doc.body || observer) return;
      ensureAllMounts();
      observer = new MutationObserver(scheduleEnsure);
      observer.observe(doc.body, { childList: true, subtree: true });
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      scheduled = false;

      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (detachDomReady) {
        detachDomReady();
        detachDomReady = null;
      }
      if (detachKeydown) {
        detachKeydown();
        detachKeydown = null;
      }
      if (detachMessage) {
        detachMessage();
        detachMessage = null;
      }
      if (unbindUrlListener) {
        unbindUrlListener();
        unbindUrlListener = null;
      }

      for (let i = adapters.length - 1; i >= 0; i -= 1) {
        try {
          adapters[i].dispose();
        } catch {
          // Isolate per-adapter teardown errors
        }
      }
      for (const desc of styleDescriptors) {
        try {
          runtime.removeStyle(desc.styleId);
        } catch {
          // Ignore if host already removed style
        }
      }
    }

    function start() {
      if (started || disposed) return;
      started = true;

      for (const desc of styleDescriptors) {
        runtime.injectStyle(desc.styleId, desc.cssText, { slotId: desc.slotId });
      }
      runtime.onDispose(dispose);

      detachKeydown = runtime.addManagedListener(win, 'keydown', onKeydown);
      detachMessage = runtime.addManagedListener(win, 'message', onMessage);
      unbindUrlListener = runtime.bindServerUrlListener((nextUrl) => {
        if (nextUrl) {
          scheduleEnsure();
        }
      });

      if (doc.body) {
        attachObserver();
      } else {
        detachDomReady = runtime.addManagedListener(
          win,
          'DOMContentLoaded',
          () => {
            detachDomReady = null;
            attachObserver();
          },
          { once: true }
        );
      }
    }

    return Object.freeze({
      start,
      ensureAllMounts,
      syncAllLabels,
      dispose,
    });
  }

  // --- composition root ---
  const runtime = createHostRuntime({ addonHost, win: window, doc: document });
  let coordinator = null;
  const onLangChange = () => {
    if (coordinator) coordinator.syncAllLabels();
  };
  coordinator = createMountCoordinator({
    runtime,
    adapters: [
      createSettingsSidebarMount({ runtime, onLangChange, win: window, doc: document }),
      createCustomizationsMount({ runtime, onLangChange, win: window, doc: document }),
    ],
    win: window,
    doc: document,
  });
  coordinator.start();
})(typeof addonHost !== "undefined" ? addonHost : undefined);
