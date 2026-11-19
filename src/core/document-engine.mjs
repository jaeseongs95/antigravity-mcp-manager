/**
 * Lossless JSON Document Engine with Fail-Closed Parsing & SHA-256 CAS (`src/core/document-engine.mjs`).
 *
 * Invariants:
 * 1. Never coerces malformed JSON into `{ mcpServers: {} }`.
 * 2. Preserves all unknown top-level keys and unknown per-server keys losslessly.
 * 3. Rejects prototype-pollution keys (`__proto__`, `constructor`, `prototype`).
 * 4. Detects line endings (`\r\n` vs `\n`) and preserves them on serialization.
 */

import { ERROR_CODES, FORBIDDEN_OBJECT_KEYS, isPlainObject } from './model.mjs';
import { sha256Hex } from './sha256.mjs';

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
export function parseConfigDocument(rawText, exists = true, serversRootKey = 'mcpServers') {
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
  const sha256 = sha256Hex(text);
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

export function serializeConfigDocument(doc, eol = '\n') {
  const json = `${JSON.stringify(doc, null, 2)}\n`;
  return eol === '\r\n' ? json.replace(/\n/g, '\r\n') : json;
}

/**
 * Losslessly merges updated known fields onto `existingSpec`, preserving unknown host/future keys.
 */
export function mergeServerSpecLossless(existingSpec, nextSpec) {
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

export function applyUpsertToDocument(parsedDoc, { name, originalName = null, spec }, serversRootKey = 'mcpServers') {
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

export function applyToggleDisabledToDocument(parsedDoc, name, disabled, serversRootKey = 'mcpServers') {
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

export function applyDeleteFromDocument(parsedDoc, name, serversRootKey = 'mcpServers') {
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
