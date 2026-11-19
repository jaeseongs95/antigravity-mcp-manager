/**
 * Declarative Smart Paste Parser (`src/core/input-parser.mjs`).
 *
 * Parses ONLY declarative JSON snippets (`mcpServers` map, single named entry, or raw spec)
 * and absolute http(s) URLs. Explicitly rejects raw shell command strings (`npx ...`, `curl ...`)
 * in v1 per security invariants. Normalizes `serverUrl` -> `url` and surfaces an editable
 * `mcp-remote` preview when a legacy `/sse` endpoint is detected.
 */

import { FORBIDDEN_OBJECT_KEYS, TRANSPORT_KINDS, isPlainObject } from './model.mjs';
import { isLegacySseUrl, validateServerName, validateServerSpec } from './validator.mjs';

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

export function parseDeclarativeInput(rawInput) {
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

export { isLegacySseUrl };
