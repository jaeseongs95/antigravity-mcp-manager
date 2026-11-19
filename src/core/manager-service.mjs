/**
 * Vendor-Independent MCP Manager Use-Case Service (`src/core/manager-service.mjs`).
 *
 * Coordinates `ConfigStorePort`, `ConfigDialectPort`, and optional `RuntimeInspectorPort`.
 * Enforces fail-closed JSON handling, SHA-256 CAS, lossless updates, secret masking/preservation,
 * Stdio confirmation gates, read-only plugin visibility, and 1-time legacy import preview.
 */

import { detectCollisions, findCaseInsensitiveConflict } from './collision-detector.mjs';
import {
  applyDeleteFromDocument,
  applyToggleDisabledToDocument,
  applyUpsertToDocument,
  parseConfigDocument,
  serializeConfigDocument,
} from './document-engine.mjs';
import { parseDeclarativeInput } from './input-parser.mjs';
import { ERROR_CODES, isPlainObject } from './model.mjs';
import { DEFAULT_GENERIC_DIALECT, assertConfigStorePort } from './ports.mjs';
import { REDACTED_MASK, redactErrorMessage, redactServerSpec } from './secret-redactor.mjs';
import { sha256Hex } from './sha256.mjs';
import { validateServerName, validateServerSpec } from './validator.mjs';

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

export class McpManagerService {
  constructor({ configStore, dialect = DEFAULT_GENERIC_DIALECT, runtimeInspector = null }) {
    assertConfigStorePort(configStore);
    this.configStore = configStore;
    this.dialect = { ...DEFAULT_GENERIC_DIALECT, ...dialect };
    this.runtimeInspector = runtimeInspector;
  }

  async getSnapshot({ workspaceUris = [], includeRawText = false } = {}) {
    const globalRead = await this.configStore.readGlobalConfig();
    const parsedGlobal = parseConfigDocument(globalRead.rawText, globalRead.exists, this.dialect.serversRootKey);

    const runtime = this.runtimeInspector
      ? await this.runtimeInspector.inspectRuntime(workspaceUris).catch(() => ({
          available: false,
          servers: {},
          plugins: [],
        }))
      : { available: false, servers: {}, plugins: [] };

    const pluginReads = this.configStore.readPluginConfigs
      ? await this.configStore.readPluginConfigs().catch(() => [])
      : [];

    const runtimePluginsByDir = new Map();
    for (const rp of Array.isArray(runtime.plugins) ? runtime.plugins : []) {
      if (rp?.dir) runtimePluginsByDir.set(rp.dir, rp);
    }

    const pluginServers = [];
    for (const pFile of pluginReads) {
      const pParsed = parseConfigDocument(pFile.rawText, true, this.dialect.serversRootKey);
      if (!pParsed.ok) continue;
      const livePlugin = runtimePluginsByDir.get(pFile.pluginDir) || null;
      for (const [sName, sSpec] of Object.entries(pParsed.servers)) {
        const val = validateServerSpec(sSpec);
        const rt = runtime.servers?.[sName] || null;
        pluginServers.push({
          name: sName,
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
      const lParsed = parseConfigDocument(legacyRead.rawText, true, this.dialect.serversRootKey);
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
        const rt = runtime.servers?.[sName] || null;
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
        sha256: parsedGlobal.sha256,
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
    const parsed = parseConfigDocument(readRes.rawText, readRes.exists, this.dialect.serversRootKey);
    if (!parsed.ok) {
      return {
        ok: false,
        code: ERROR_CODES.MALFORMED_JSON,
        errors: [parsed.parseError?.message || 'Config file contains invalid JSON; repair in Raw JSON mode first.'],
      };
    }

    if (parsed.sha256 !== expectedSha256) {
      return {
        ok: false,
        code: ERROR_CODES.CONFLICT,
        errors: ['Config file changed on disk since last load. Reload and review before saving.'],
        actualSha256: parsed.sha256,
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
      expectedSha256: parsed.sha256,
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
    const parsed = parseConfigDocument(readRes.rawText, readRes.exists, this.dialect.serversRootKey);
    if (!parsed.ok) {
      return { ok: false, code: ERROR_CODES.MALFORMED_JSON, errors: [parsed.parseError?.message || 'Malformed JSON'] };
    }
    if (parsed.sha256 !== expectedSha256) {
      return { ok: false, code: ERROR_CODES.CONFLICT, errors: ['Config changed on disk. Reload first.'], actualSha256: parsed.sha256 };
    }

    const nextRaw = applyToggleDisabledToDocument(parsed, name, Boolean(disabled), this.dialect.serversRootKey);
    if (nextRaw === null) {
      return { ok: false, code: ERROR_CODES.NOT_FOUND, errors: [`Server "${name}" not found.`] };
    }
    const writeRes = await this.configStore.writeGlobalConfig({
      rawText: nextRaw,
      expectedSha256: parsed.sha256,
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
    const parsed = parseConfigDocument(readRes.rawText, readRes.exists, this.dialect.serversRootKey);
    if (!parsed.ok) {
      return { ok: false, code: ERROR_CODES.MALFORMED_JSON, errors: [parsed.parseError?.message || 'Malformed JSON'] };
    }
    if (parsed.sha256 !== expectedSha256) {
      return { ok: false, code: ERROR_CODES.CONFLICT, errors: ['Config changed on disk. Reload first.'], actualSha256: parsed.sha256 };
    }

    const nextRaw = applyDeleteFromDocument(parsed, name, this.dialect.serversRootKey);
    if (nextRaw === null) {
      return { ok: false, code: ERROR_CODES.NOT_FOUND, errors: [`Server "${name}" not found.`] };
    }
    const writeRes = await this.configStore.writeGlobalConfig({
      rawText: nextRaw,
      expectedSha256: parsed.sha256,
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

  async clonePluginServer({ pluginDir, serverName, targetName = null, expectedSha256, confirmStdio = false }) {
    const pluginReads = this.configStore.readPluginConfigs ? await this.configStore.readPluginConfigs() : [];
    const targetPlugin = pluginReads.find((p) => p.pluginDir === pluginDir);
    if (!targetPlugin) {
      return { ok: false, code: ERROR_CODES.NOT_FOUND, errors: [`Plugin "${pluginDir}" not found.`] };
    }
    const pParsed = parseConfigDocument(targetPlugin.rawText, true, this.dialect.serversRootKey);
    if (!pParsed.ok || !Object.prototype.hasOwnProperty.call(pParsed.servers, serverName)) {
      return { ok: false, code: ERROR_CODES.NOT_FOUND, errors: [`Server "${serverName}" not found in plugin "${pluginDir}".`] };
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
    const lParsed = parseConfigDocument(legacyRead.rawText, true, this.dialect.serversRootKey);
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
    const parsedNext = parseConfigDocument(rawText, true, this.dialect.serversRootKey);
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
    const currentSha256 = currentRead.exists ? sha256Hex(currentRead.rawText) : null;
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
      expectedSha256,
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
