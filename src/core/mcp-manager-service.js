'use strict';

const { DisposableStore, toDisposable } = require('./disposable');
const { AsyncMutex } = require('./async-mutex');
const { sha256Hex } = require('./sha256');
const {
  CONFIG_READ_REASONS,
  CONFIG_WRITE_REASONS,
  normalizeAuthorizationCode,
  normalizeConfigReadResult,
  createDefaultPorts,
} = require('./ports');
const { validateExternalAuthUrl } = require('./security/url-policy');
const {
  extractAndValidateTransport,
  assertServerSpecSecurity,
  normalizeMcpConfigObject,
} = require('./schema/server-spec');
const { applyJsoncServerMutations } = require('./schema/jsonc-codec');
const {
  buildAuthHeaders,
  mergeHeadersCaseInsensitive,
  redactSensitiveText,
} = require('./schema/auth-codec');

const OAUTH_SESSION_STATES = Object.freeze({
  IDLE: 'IDLE',
  DISCOVERING_AUTH_URL: 'DISCOVERING_AUTH_URL',
  AWAITING_BROWSER_CALLBACK: 'AWAITING_BROWSER_CALLBACK',
  SUBMITTING_CODE: 'SUBMITTING_CODE',
  AUTHORIZED: 'AUTHORIZED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

function createEmptyEditorDraft() {
  return {
    serverName: '',
    originalName: '',
    description: '',
    transport: 'http',
    url: '',
    command: '',
    argsText: '',
    cwd: '',
    envText: '',
    headersText: '',
    authMode: 'oauth',
    oauthClientMode: 'auto',
    oauthClientId: '',
    oauthClientSecret: '',
    oauthScopes: '',
    bearerToken: '',
    apiKeyHeader: 'X-API-Key',
    apiKeyValue: '',
    basicUser: '',
    basicPass: '',
    applyAuthToAllHttp: false,
    confirmPathOverride: false,
    allowInsecureHttp: false,
    disabled: false,
  };
}

/**
 * Pure vendor-independent application service (`src/core/mcp-manager-service.js` — Rev 6 §5.1–5.2, 5095348c-F4):
 * - Single JSONC parsing point (`readMcpConfig`), preserving 0-byte `""` `FOUND` (`exists: true`, `digest: sha256Hex('')`).
 * - Optimistic concurrency control (`expectedExists` + `expectedDigest` -> `CONFLICT`).
 * - Disk-first `toggleServerEnabled` with explicit `RUNTIME_SYNC_FAILED` / `ROLLBACK_CONFLICT` / `ROLLBACK_FAILED` + immediate resync.
 * - Single-mutex single-CAS `saveServerSpec` & `applyAuthToAllHttp` (case-insensitive header dedupe + non-loopback `http://` skip).
 * - Core-enforced `validateExternalAuthUrl` in `openAuthUrl` + complete `clearSensitiveDrafts` (incl. Quick-Add & Settings tab-leave).
 */
class McpManagerService {
  constructor(ports = {}) {
    const resolved = createDefaultPorts(ports);
    this._brandProfile = resolved.brandProfile;
    this._configRepo = resolved.configRepo;
    this._mcpRuntime = resolved.mcpRuntime;
    this._oauthBroker = resolved.oauthBroker;
    this._mutex = new AsyncMutex();
    this._disposables = new DisposableStore();
    this._listeners = new Set();

    this._oauthSessionSeq = 0;
    this._activeOAuthStore = null;

    this._state = {
      configStatus: 'IDLE',
      configError: null,
      configReason: null,
      configUri: null,
      configFsPath: null,
      configExists: false,
      configDigest: null,
      config: { mcpServers: {} },
      rawTextDraft: '',
      quickAddInput: '',
      quickAddAuthToken: '',
      pendingCommandConfirmation: null,
      conflictState: null,
      runtimeServers: [],
      editorFormDraft: createEmptyEditorDraft(),
      oauthCodeDraft: '',
      oauthSession: {
        state: OAUTH_SESSION_STATES.IDLE,
        serverName: '',
        authUrl: '',
        error: null,
        seq: 0,
      },
    };
  }

  get brandProfile() {
    return this._brandProfile;
  }

  get isDisposed() {
    return this._disposables.isDisposed;
  }

  getState() {
    return this._state;
  }

  getDraftState() {
    return this._state;
  }

  updateDraftState(patch) {
    if (!patch || typeof patch !== 'object') return this._state;
    const next = { ...this._state };
    if ('quickAddInput' in patch) {
      next.quickAddInput = typeof patch.quickAddInput === 'string' ? patch.quickAddInput : '';
    }
    if ('quickAddAuthToken' in patch) {
      next.quickAddAuthToken = typeof patch.quickAddAuthToken === 'string' ? patch.quickAddAuthToken : '';
    }
    if ('pendingCommandConfirmation' in patch) {
      next.pendingCommandConfirmation = patch.pendingCommandConfirmation || null;
    }
    if ('rawTextDraft' in patch) {
      next.rawTextDraft =
        patch.rawTextDraft === null || patch.rawTextDraft === undefined ? '' : String(patch.rawTextDraft);
    }
    if ('oauthCodeDraft' in patch) {
      next.oauthCodeDraft = typeof patch.oauthCodeDraft === 'string' ? patch.oauthCodeDraft : '';
    }
    if ('editorFormDraft' in patch) {
      next.editorFormDraft =
        patch.editorFormDraft && typeof patch.editorFormDraft === 'object'
          ? { ...patch.editorFormDraft }
          : createEmptyEditorDraft();
    }
    this._state = next;
    this._emit();
    return this._state;
  }

  subscribe(listener) {
    if (typeof listener !== 'function' || this.isDisposed) {
      return toDisposable(null);
    }
    this._listeners.add(listener);
    return this._disposables.add(() => {
      this._listeners.delete(listener);
    });
  }

  _emit() {
    if (this.isDisposed) return;
    const snap = this._state;
    for (const fn of Array.from(this._listeners)) {
      try {
        fn(snap);
      } catch {}
    }
  }

  registerDisposable(item) {
    return this._disposables.add(item);
  }

  updateEditorDraft(patch) {
    if (!patch || typeof patch !== 'object') return;
    this._state = {
      ...this._state,
      editorFormDraft: {
        ...this._state.editorFormDraft,
        ...patch,
      },
    };
    this._emit();
  }

  updateQuickAddDraft(patch) {
    if (!patch || typeof patch !== 'object') return;
    const next = { ...this._state };
    if ('quickAddInput' in patch) {
      next.quickAddInput = typeof patch.quickAddInput === 'string' ? patch.quickAddInput : '';
    }
    if ('quickAddAuthToken' in patch) {
      next.quickAddAuthToken = typeof patch.quickAddAuthToken === 'string' ? patch.quickAddAuthToken : '';
    }
    if ('pendingCommandConfirmation' in patch) {
      next.pendingCommandConfirmation = patch.pendingCommandConfirmation || null;
    }
    this._state = next;
    this._emit();
  }

  setRawTextDraft(rawText) {
    this._state = {
      ...this._state,
      rawTextDraft: typeof rawText === 'string' ? rawText : '',
    };
    this._emit();
  }

  setOAuthCodeDraft(code) {
    this._state = {
      ...this._state,
      oauthCodeDraft: typeof code === 'string' ? code : '',
    };
    this._emit();
  }

  /**
   * Zeroizes all in-memory secret drafts (`quickAddInput`, `quickAddAuthToken`, `pendingCommandConfirmation`,
   * `editorFormDraft`, `rawTextDraft`, `oauthCodeDraft`) on modal close, Settings tab-leave, or `destroy()` (`Rev 6 §5.2`).
   */
  clearSensitiveDrafts({ keepRawIfValid = false } = {}) {
    this._state = {
      ...this._state,
      quickAddInput: '',
      quickAddAuthToken: '',
      pendingCommandConfirmation: null,
      rawTextDraft: keepRawIfValid ? this._state.rawTextDraft : '',
      oauthCodeDraft: '',
      editorFormDraft: createEmptyEditorDraft(),
    };
    this._emit();
    return this._state;
  }

  async resolveMcpConfigUri() {
    if (typeof this._configRepo.resolveConfigUri === 'function') {
      return this._configRepo.resolveConfigUri();
    }
    return null;
  }

  /**
   * Single JSONC parsing point (`Rev 6 §5.1`, `5095348c-F4`).
   * Preserves 0-byte `""` `FOUND` (`exists: true`, `digest: sha256Hex('')`) and populates `rawTextDraft` on `INVALID_JSON`.
   */
  async readMcpConfig() {
    const raw = await this._configRepo.readConfig();
    const repoRes = normalizeConfigReadResult(raw);

    if (!repoRes.ok) {
      this._state = {
        ...this._state,
        configStatus: 'ERROR',
        configReason: repoRes.reason,
        configError: redactSensitiveText(repoRes.error || 'Failed to read mcp_config.json.'),
        configUri: repoRes.uri || this._state.configUri,
        configFsPath: repoRes.fsPath || this._state.configFsPath,
        configDigest: repoRes.digest ?? this._state.configDigest,
      };
      this._emit();
      return {
        ...repoRes,
        code: repoRes.reason,
        config: null,
        servers: {},
      };
    }

    if (!repoRes.exists) {
      const emptyCfg = { mcpServers: {} };
      this._state = {
        ...this._state,
        configStatus: 'MISSING',
        configError: null,
        configReason: null,
        configUri: repoRes.uri || this._state.configUri,
        configFsPath: repoRes.fsPath || this._state.configFsPath,
        configExists: false,
        configDigest: null,
        config: emptyCfg,
        rawTextDraft: '{\n  "mcpServers": {}\n}\n',
        conflictState: null,
      };
      this._emit();
      return {
        ok: true,
        status: 'MISSING',
        exists: false,
        uri: repoRes.uri,
        fsPath: repoRes.fsPath,
        rawText: '',
        digest: null,
        config: emptyCfg,
        servers: emptyCfg.mcpServers,
      };
    }

    // `repoRes.exists === true` (`FOUND`): preserve exact `rawText` & `digest` even for 0-byte `""` (`5095348c-F4`)
    const exactRawText = repoRes.rawText;
    const exactDigest = repoRes.digest || sha256Hex(exactRawText);

    if (exactRawText.trim() === '') {
      const emptyCfg = { mcpServers: {} };
      this._state = {
        ...this._state,
        configStatus: 'FOUND',
        configError: null,
        configReason: null,
        configUri: repoRes.uri || this._state.configUri,
        configFsPath: repoRes.fsPath || this._state.configFsPath,
        configExists: true,
        configDigest: exactDigest,
        config: emptyCfg,
        rawTextDraft: exactRawText || '{\n  "mcpServers": {}\n}\n',
        conflictState: null,
      };
      this._emit();
      return {
        ok: true,
        status: 'FOUND',
        exists: true,
        uri: repoRes.uri,
        fsPath: repoRes.fsPath,
        rawText: exactRawText,
        digest: exactDigest,
        config: emptyCfg,
        servers: emptyCfg.mcpServers,
      };
    }

    const norm = normalizeMcpConfigObject(exactRawText);
    if (!norm.ok) {
      const cleanErr = redactSensitiveText(norm.error || 'Invalid JSON/JSONC in mcp_config.json.');
      this._state = {
        ...this._state,
        configStatus: 'ERROR',
        configReason: CONFIG_READ_REASONS.INVALID_JSON,
        configError: cleanErr,
        configUri: repoRes.uri || this._state.configUri,
        configFsPath: repoRes.fsPath || this._state.configFsPath,
        configExists: true,
        configDigest: exactDigest,
        rawTextDraft: exactRawText,
      };
      this._emit();
      return {
        ok: false,
        reason: CONFIG_READ_REASONS.INVALID_JSON,
        code: CONFIG_READ_REASONS.INVALID_JSON,
        validationCode: norm.code,
        exists: true,
        uri: repoRes.uri,
        fsPath: repoRes.fsPath,
        rawText: exactRawText,
        digest: exactDigest,
        config: null,
        servers: {},
        error: cleanErr,
      };
    }

    this._state = {
      ...this._state,
      configStatus: 'FOUND',
      configError: null,
      configReason: null,
      configUri: repoRes.uri || this._state.configUri,
      configFsPath: repoRes.fsPath || this._state.configFsPath,
      configExists: true,
      configDigest: exactDigest,
      config: norm.config,
      rawTextDraft: exactRawText,
      conflictState: null,
    };
    this._emit();
    return {
      ok: true,
      status: 'FOUND',
      exists: true,
      uri: repoRes.uri,
      fsPath: repoRes.fsPath,
      rawText: exactRawText,
      digest: exactDigest,
      config: norm.config,
      servers: norm.config.mcpServers || {},
    };
  }

  async _readMcpConfigUnlocked(lockToken) {
    this._mutex.assertHeld(lockToken);
    return this.readMcpConfig();
  }

  async _writeWithCasUnlocked(lockToken, { uri, rawText, expectedExists, expectedDigest }) {
    this._mutex.assertHeld(lockToken);
    const writeRes = await this._configRepo.writeConfig({
      uri,
      rawText,
      expectedExists,
      expectedDigest,
    });
    if (!writeRes || !writeRes.ok) {
      if (writeRes && writeRes.reason === CONFIG_WRITE_REASONS.CONFLICT) {
        this._state = {
          ...this._state,
          conflictState: {
            reason: CONFIG_WRITE_REASONS.CONFLICT,
            currentExists: Boolean(writeRes.currentExists),
            currentRawText: typeof writeRes.currentRawText === 'string' ? writeRes.currentRawText : null,
            currentDigest: writeRes.currentDigest || null,
          },
          configError: redactSensitiveText(
            writeRes.error || 'mcp_config.json was modified externally. Reload before saving to avoid overwriting changes.'
          ),
        };
        this._emit();
      }
      const reason = writeRes?.reason || CONFIG_WRITE_REASONS.WRITE_FAILED;
      return {
        ok: false,
        persisted: false,
        reason,
        code: reason,
        uri: writeRes?.uri || uri || '',
        currentExists: writeRes?.currentExists,
        currentRawText: writeRes?.currentRawText,
        currentDigest: writeRes?.currentDigest,
        error: redactSensitiveText(writeRes?.error || 'Failed to persist MCP configuration.'),
      };
    }

    const nextDigest = writeRes.digest || sha256Hex(rawText);
    const norm = rawText.trim() === '' ? { ok: true, config: { mcpServers: {} } } : normalizeMcpConfigObject(rawText);
    if (norm.ok) {
      this._state = {
        ...this._state,
        configStatus: 'FOUND',
        configError: null,
        configReason: null,
        configExists: true,
        configUri: writeRes.uri || uri || this._state.configUri,
        configFsPath: writeRes.fsPath || this._state.configFsPath,
        configDigest: nextDigest,
        config: norm.config,
        rawTextDraft: rawText,
        conflictState: null,
      };
      this._emit();
    }
    return {
      ...writeRes,
      ok: true,
      persisted: true,
      rawText,
      digest: nextDigest,
      config: norm.ok ? norm.config : undefined,
    };
  }

  /**
   * Saves raw JSON/JSONC text from the Raw Config Editor (`Rev 6 §5.2`).
   * Validates every server via `extractAndValidateTransport` + `assertServerSpecSecurity` before CAS write.
   */
  async saveRawConfig(rawText, options = {}) {
    return this._mutex.runExclusive(async (lockToken) => {
      const text = typeof rawText === 'string' ? rawText : '';
      const norm = normalizeMcpConfigObject(text, {
        enforceSecurity: true,
        confirmPathOverride: Boolean(options.confirmPathOverride),
        allowInsecureHttp: Boolean(options.allowInsecureHttp),
      });
      if (!norm.ok) {
        return {
          ok: false,
          persisted: false,
          code: norm.code,
          requiresConfirmation: Boolean(norm.requiresConfirmation),
          error: norm.error,
        };
      }

      const current = await this._readMcpConfigUnlocked(lockToken);
      if (!current.ok && current.reason !== CONFIG_READ_REASONS.INVALID_JSON) {
        return {
          ok: false,
          persisted: false,
          reason: current.reason,
          error: current.error,
        };
      }

      const expectedExists = current.ok ? current.exists : Boolean(current.exists !== false);
      const expectedDigest = options.expectedDigest !== undefined ? options.expectedDigest : current.digest;
      const cleanLf = text.replace(/\r\n?/g, '\n');
      const normalizedOut = cleanLf.trim()
        ? (cleanLf.endsWith('\n') ? cleanLf : `${cleanLf}\n`)
        : `${JSON.stringify(norm.config, null, 2)}\n`;

      const writeRes = await this._writeWithCasUnlocked(lockToken, {
        uri: current.uri,
        rawText: normalizedOut,
        expectedExists,
        expectedDigest,
      });
      if (!writeRes.ok) return writeRes;
      await this._safeRefresh();
      return writeRes;
    });
  }

  async writeMcpConfig(rawOrConfigObj, options = {}) {
    if (typeof rawOrConfigObj === 'string') {
      return this.saveRawConfig(rawOrConfigObj, options);
    }
    return this._mutex.runExclusive(async (lockToken) => {
      const norm = normalizeMcpConfigObject(rawOrConfigObj, {
        enforceSecurity: true,
        confirmPathOverride: Boolean(options.confirmPathOverride),
        allowInsecureHttp: Boolean(options.allowInsecureHttp),
      });
      if (!norm.ok) {
        return {
          ok: false,
          persisted: false,
          code: norm.code,
          requiresConfirmation: Boolean(norm.requiresConfirmation),
          error: norm.error,
        };
      }
      const current = await this._readMcpConfigUnlocked(lockToken);
      if (!current.ok) {
        return {
          ok: false,
          persisted: false,
          reason: current.reason,
          error: current.error,
        };
      }
      const serialized = `${JSON.stringify(norm.config, null, 2)}\n`;
      const writeRes = await this._writeWithCasUnlocked(lockToken, {
        uri: current.uri,
        rawText: serialized,
        expectedExists: current.exists,
        expectedDigest: current.digest,
      });
      if (!writeRes.ok) return writeRes;
      await this._safeRefresh();
      return writeRes;
    });
  }

  /**
   * Single-mutex single-CAS atomic server upsert + optional `applyAuthToAllHttp` propagation (`Rev 6 F5`, `5095348c-F4`).
   * - Validates primary `spec` via `assertServerSpecSecurity`.
   * - Excludes non-loopback `http://` sibling servers (`skippedInsecureHttpServers`) so credentials never leak over cleartext HTTP.
   * - Deduplicates headers case-insensitively via `mergeHeadersCaseInsensitive`.
   */
  async saveServerSpec({
    serverName,
    spec,
    previousServerName = null,
    applyAuthToAllHttp = false,
    sharedAuthHeaders = null,
    authInput = null,
    confirmPathOverride = false,
    allowInsecureHttp = false,
  }) {
    const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
    if (!cleanName) {
      return { ok: false, error: 'Server name is required.' };
    }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      return { ok: false, code: 'INVALID_SERVER_SPEC', error: 'Server specification must be an object.' };
    }

    const effectiveSharedHeaders =
      sharedAuthHeaders && typeof sharedAuthHeaders === 'object' && Object.keys(sharedAuthHeaders).length > 0
        ? sharedAuthHeaders
        : authInput && typeof authInput === 'object'
          ? buildAuthHeaders(authInput)
          : spec.headers && typeof spec.headers === 'object' && Object.keys(spec.headers).length > 0
            ? spec.headers
            : null;

    const primarySec = assertServerSpecSecurity(spec, {
      confirmPathOverride: Boolean(confirmPathOverride),
      allowInsecureHttp: Boolean(allowInsecureHttp),
    });
    if (!primarySec.ok) {
      return {
        ok: false,
        persisted: false,
        code: primarySec.code,
        requiresConfirmation: Boolean(primarySec.requiresConfirmation),
        error: primarySec.error,
      };
    }

    return this._mutex.runExclusive(async (lockToken) => {
      const current = await this._readMcpConfigUnlocked(lockToken);
      if (!current.ok) {
        return {
          ok: false,
          persisted: false,
          reason: current.reason,
          error: current.error,
        };
      }

      const mutations = [];
      const prevName = typeof previousServerName === 'string' ? previousServerName.trim() : '';
      if (prevName && prevName !== cleanName && current.config.mcpServers[prevName]) {
        mutations.push({ op: 'delete', name: prevName });
      }
      mutations.push({ op: 'set', name: cleanName, spec: { ...primarySec.spec } });

      const updatedSiblingServers = [];
      const skippedInsecureHttpServers = [];

      if (
        applyAuthToAllHttp &&
        effectiveSharedHeaders &&
        typeof effectiveSharedHeaders === 'object' &&
        Object.keys(effectiveSharedHeaders).length > 0
      ) {
        for (const [sibName, sibSpec] of Object.entries(current.config.mcpServers || {})) {
          if (sibName === cleanName || sibName === prevName) continue;
          const sibTr = extractAndValidateTransport(sibSpec);
          if (!sibTr.ok || sibTr.transport !== 'http') continue;
          if (sibTr.urlInfo.isInsecureRemoteHttp) {
            skippedInsecureHttpServers.push(sibName);
            continue;
          }
          const mergedCandidate = {
            ...sibSpec,
            headers: mergeHeadersCaseInsensitive(sibSpec.headers, effectiveSharedHeaders),
          };
          const sibSec = assertServerSpecSecurity(mergedCandidate, {
            confirmPathOverride: true,
            allowInsecureHttp: false,
          });
          if (!sibSec.ok) {
            return {
              ok: false,
              persisted: false,
              code: sibSec.code,
              error: `Sibling server "${sibName}": ${sibSec.error}`,
            };
          }
          mutations.push({ op: 'set', name: sibName, spec: sibSec.spec });
          updatedSiblingServers.push(sibName);
        }
      }

      const nextRawText = applyJsoncServerMutations(current.rawText, mutations);
      const writeRes = await this._writeWithCasUnlocked(lockToken, {
        uri: current.uri,
        rawText: nextRawText,
        expectedExists: current.exists,
        expectedDigest: current.digest,
      });
      if (!writeRes.ok) return writeRes;

      await this._safeRefresh(updatedSiblingServers.length > 0 ? undefined : cleanName);
      return {
        ...writeRes,
        ok: true,
        serverName: cleanName,
        updatedSiblingServers,
        skippedInsecureHttpServers,
      };
    });
  }

  async upsertCustomServer(serverName, spec, previousNameOrOptions = null) {
    const previousServerName =
      typeof previousNameOrOptions === 'string'
        ? previousNameOrOptions
        : previousNameOrOptions?.previousServerName || null;
    const confirmPathOverride =
      typeof previousNameOrOptions === 'object' && previousNameOrOptions !== null
        ? Boolean(previousNameOrOptions.confirmPathOverride)
        : false;
    const allowInsecureHttp =
      typeof previousNameOrOptions === 'object' && previousNameOrOptions !== null
        ? Boolean(previousNameOrOptions.allowInsecureHttp)
        : false;
    return this.saveServerSpec({
      serverName,
      spec,
      previousServerName,
      confirmPathOverride,
      allowInsecureHttp,
    });
  }

  /**
   * Standalone batch auth propagation under a single `AsyncMutex` + single `writeConfig` CAS (`Rev 6 F5`, `5095348c-F4`).
   */
  async applyAuthToAllHttp(authHeaders, targetServerNames = null) {
    return this.applyAuthHeadersToServers(targetServerNames, authHeaders);
  }

  async applyAuthHeadersToServers(serverNames, authHeaders) {
    if (!authHeaders || typeof authHeaders !== 'object' || Object.keys(authHeaders).length === 0) {
      return { ok: true, persisted: true, updated: [], skippedInsecureHttpServers: [] };
    }
    return this._mutex.runExclusive(async (lockToken) => {
      const current = await this._readMcpConfigUnlocked(lockToken);
      if (!current.ok) {
        return { ok: false, persisted: false, reason: current.reason, error: current.error };
      }
      const targetSet = Array.isArray(serverNames) && serverNames.length > 0 ? new Set(serverNames) : null;
      const mutations = [];
      const updated = [];
      const skippedInsecureHttpServers = [];

      for (const [name, spec] of Object.entries(current.config.mcpServers || {})) {
        if (targetSet && !targetSet.has(name)) continue;
        const tr = extractAndValidateTransport(spec);
        if (!tr.ok || tr.transport !== 'http') continue;
        if (tr.urlInfo.isInsecureRemoteHttp) {
          skippedInsecureHttpServers.push(name);
          continue;
        }
        const candidate = {
          ...spec,
          headers: mergeHeadersCaseInsensitive(spec.headers, authHeaders),
        };
        const sec = assertServerSpecSecurity(candidate, {
          confirmPathOverride: true,
          allowInsecureHttp: false,
        });
        if (!sec.ok) {
          return {
            ok: false,
            persisted: false,
            code: sec.code,
            error: `Server "${name}": ${sec.error}`,
          };
        }
        mutations.push({ op: 'set', name, spec: sec.spec });
        updated.push(name);
      }

      if (mutations.length === 0) {
        return {
          ok: true,
          persisted: false,
          updated: [],
          skippedInsecureHttpServers,
        };
      }

      const nextRawText = applyJsoncServerMutations(current.rawText, mutations);
      const writeRes = await this._writeWithCasUnlocked(lockToken, {
        uri: current.uri,
        rawText: nextRawText,
        expectedExists: current.exists,
        expectedDigest: current.digest,
      });
      if (!writeRes.ok) return writeRes;
      await this._safeRefresh();
      return {
        ...writeRes,
        ok: true,
        updated,
        updatedCount: updated.length,
        skippedInsecureHttpServers,
      };
    });
  }

  async upsertMultipleServers(serversMap, options = {}) {
    if (!serversMap || typeof serversMap !== 'object' || Array.isArray(serversMap)) {
      return { ok: false, error: 'Servers map must be a valid object.' };
    }
    const validatedEntries = [];
    for (const [name, spec] of Object.entries(serversMap)) {
      const cleanName = String(name || '').trim();
      if (!cleanName) continue;
      const sec = assertServerSpecSecurity(spec, {
        confirmPathOverride: Boolean(options.confirmPathOverride),
        allowInsecureHttp: Boolean(options.allowInsecureHttp),
      });
      if (!sec.ok) {
        return {
          ok: false,
          persisted: false,
          code: sec.code,
          requiresConfirmation: Boolean(sec.requiresConfirmation),
          error: `Server "${cleanName}": ${sec.error}`,
        };
      }
      validatedEntries.push({ op: 'set', name: cleanName, spec: sec.spec });
    }

    return this._mutex.runExclusive(async (lockToken) => {
      const current = await this._readMcpConfigUnlocked(lockToken);
      if (!current.ok) {
        return {
          ok: false,
          persisted: false,
          reason: current.reason,
          error: current.error,
        };
      }
      const nextRawText = applyJsoncServerMutations(current.rawText, validatedEntries);
      const writeRes = await this._writeWithCasUnlocked(lockToken, {
        uri: current.uri,
        rawText: nextRawText,
        expectedExists: current.exists,
        expectedDigest: current.digest,
      });
      if (!writeRes.ok) return writeRes;
      await this._safeRefresh();
      return writeRes;
    });
  }

  async deleteServer(serverName) {
    return this.deleteCustomServer(serverName);
  }

  async deleteCustomServer(serverName) {
    const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
    if (!cleanName) {
      return { ok: false, error: 'Server name is required.' };
    }
    return this._mutex.runExclusive(async (lockToken) => {
      const current = await this._readMcpConfigUnlocked(lockToken);
      if (!current.ok) {
        return {
          ok: false,
          persisted: false,
          reason: current.reason,
          error: current.error,
        };
      }
      if (!(cleanName in (current.config.mcpServers || {}))) {
        return {
          ok: false,
          persisted: false,
          error: `Custom server "${cleanName}" was not found in mcp_config.json.`,
        };
      }
      const nextRawText = applyJsoncServerMutations(current.rawText, [{ op: 'delete', name: cleanName }]);
      const writeRes = await this._writeWithCasUnlocked(lockToken, {
        uri: current.uri,
        rawText: nextRawText,
        expectedExists: current.exists,
        expectedDigest: current.digest,
      });
      if (!writeRes.ok) return writeRes;
      await this._safeRefresh(cleanName);
      return { ...writeRes, ok: true, serverName: cleanName };
    });
  }

  /**
   * Disk-first server enable/disable with compensating rollback across all 3 rollback outcomes
   * (`RUNTIME_SYNC_FAILED`, `ROLLBACK_CONFLICT`, `ROLLBACK_FAILED`) + immediate disk & runtime resync (`Rev 6 §5.1 #3`).
   */
  async toggleServerEnabled(serverName, enabled) {
    const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
    if (!cleanName) {
      return { ok: false, error: 'Server name is required.' };
    }
    const targetEnabled = Boolean(enabled);

    return this._mutex.runExclusive(async (lockToken) => {
      const current = await this._readMcpConfigUnlocked(lockToken);
      if (!current.ok) {
        return {
          ok: false,
          persisted: false,
          reason: current.reason,
          error: current.error,
        };
      }

      const existingSpec = current.config.mcpServers?.[cleanName];
      let diskWriteDigest = null;

      if (existingSpec && typeof existingSpec === 'object') {
        const updatedSpec = { ...existingSpec };
        if (targetEnabled) {
          delete updatedSpec.disabled;
        } else {
          updatedSpec.disabled = true;
        }
        const nextRawText = applyJsoncServerMutations(current.rawText, [
          { op: 'set', name: cleanName, spec: updatedSpec },
        ]);
        const writeRes = await this._writeWithCasUnlocked(lockToken, {
          uri: current.uri,
          rawText: nextRawText,
          expectedExists: current.exists,
          expectedDigest: current.digest,
        });
        if (!writeRes.ok) {
          return writeRes;
        }
        diskWriteDigest = writeRes.digest;
      }

      if (typeof this._mcpRuntime.toggleServer === 'function') {
        let runtimeRes;
        try {
          runtimeRes = await this._mcpRuntime.toggleServer(cleanName, targetEnabled);
        } catch (err) {
          runtimeRes = {
            ok: false,
            error: err && err.message ? err.message : `Failed to toggle MCP server "${cleanName}".`,
          };
        }

        if (runtimeRes && runtimeRes.ok === false) {
          let reason = 'RUNTIME_SYNC_FAILED';
          let rolledBack = true;

          if (diskWriteDigest !== null) {
            const rb = await this._writeWithCasUnlocked(lockToken, {
              uri: current.uri,
              rawText: current.rawText,
              expectedExists: true,
              expectedDigest: diskWriteDigest,
            });
            if (rb && rb.ok) {
              reason = 'RUNTIME_SYNC_FAILED';
              rolledBack = true;
            } else if (rb && rb.reason === CONFIG_WRITE_REASONS.CONFLICT) {
              reason = 'ROLLBACK_CONFLICT';
              rolledBack = false;
            } else {
              reason = 'ROLLBACK_FAILED';
              rolledBack = false;
            }
          }

          // Always resync both disk and runtime state immediately across ALL rollback outcomes (`Rev 6 §5.1 #3`)
          const resynced = await this._readMcpConfigUnlocked(lockToken);
          await this.fetchServerStates();

          return {
            ok: false,
            reason,
            code: reason,
            rolledBack,
            currentRawText: resynced?.rawText ?? null,
            error: redactSensitiveText(
              runtimeRes.error || `Runtime failed to toggle MCP server "${cleanName}".`
            ),
          };
        }
      }

      await this._safeRefresh(cleanName);
      return { ok: true, persisted: true, serverName: cleanName, enabled: targetEnabled };
    });
  }

  async toggleServerTool(serverName, toolName, enabled) {
    const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
    const cleanTool = typeof toolName === 'string' ? toolName.trim() : '';
    if (!cleanName || !cleanTool) {
      return { ok: false, error: 'Both serverName and toolName are required.' };
    }
    const targetEnabled = Boolean(enabled);

    return this._mutex.runExclusive(async (lockToken) => {
      const current = await this._readMcpConfigUnlocked(lockToken);
      if (!current.ok) {
        return {
          ok: false,
          persisted: false,
          reason: current.reason,
          error: current.error,
        };
      }
      const existingSpec = current.config.mcpServers?.[cleanName];
      if (!existingSpec || typeof existingSpec !== 'object') {
        return {
          ok: false,
          persisted: false,
          error: `Tool toggling via mcp_config.json is only supported for custom servers in mcp_config.json ("${cleanName}").`,
        };
      }
      const disabledSet = new Set(
        Array.isArray(existingSpec.disabledTools) ? existingSpec.disabledTools.map((t) => String(t)) : []
      );
      if (targetEnabled) {
        disabledSet.delete(cleanTool);
      } else {
        disabledSet.add(cleanTool);
      }
      const updatedSpec = { ...existingSpec };
      if (disabledSet.size > 0) {
        updatedSpec.disabledTools = Array.from(disabledSet);
      } else {
        delete updatedSpec.disabledTools;
      }
      const nextRawText = applyJsoncServerMutations(current.rawText, [
        { op: 'set', name: cleanName, spec: updatedSpec },
      ]);
      const writeRes = await this._writeWithCasUnlocked(lockToken, {
        uri: current.uri,
        rawText: nextRawText,
        expectedExists: current.exists,
        expectedDigest: current.digest,
      });
      if (!writeRes.ok) return writeRes;
      await this._safeRefresh(cleanName);
      return {
        ...writeRes,
        ok: true,
        serverName: cleanName,
        toolName: cleanTool,
        enabled: targetEnabled,
      };
    });
  }

  async fetchServerStates(opts = {}) {
    const res = await this._mcpRuntime.listServerStates(opts);
    const servers = Array.isArray(res)
      ? res
      : Array.isArray(res?.servers)
        ? res.servers
        : Array.isArray(res?.states)
          ? res.states
          : [];
    const ok = !res || res.ok !== false;
    this._state = {
      ...this._state,
      runtimeServers: servers,
    };
    this._emit();
    return {
      ok,
      servers,
      states: servers,
      error: res?.error ? redactSensitiveText(res.error) : undefined,
    };
  }

  async listRuntimeServerStates(opts = {}) {
    return this.fetchServerStates(opts);
  }

  async getMcpServerStates() {
    const res = await this.fetchServerStates();
    return res.servers;
  }

  async refreshServer(serverName) {
    return this._safeRefresh(serverName);
  }

  async refreshServers(serverName) {
    return this._safeRefresh(serverName);
  }

  async discoverOAuthMetadata(serverName, spec = {}) {
    const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
    if (!cleanName) {
      return { ok: false, error: 'Server name is required for OAuth discovery.' };
    }
    const specAuthUrl = String(spec?.oauth?.authUrl || spec?.oauth?.authorizationUrl || '').trim();
    if (specAuthUrl) {
      const check = validateExternalAuthUrl(specAuthUrl);
      if (!check.ok) {
        return { ok: false, code: check.code, error: check.error };
      }
      return { ok: true, authUrl: check.href };
    }
    if (typeof this._oauthBroker.discoverOAuthMetadata === 'function') {
      const disc = await this._oauthBroker.discoverOAuthMetadata(cleanName, spec);
      if (disc && disc.ok && disc.authUrl) {
        const check = validateExternalAuthUrl(disc.authUrl);
        if (!check.ok) {
          return { ok: false, code: check.code, error: check.error };
        }
        return { ok: true, authUrl: check.href };
      }
      return disc || { ok: false, error: 'No OAuth authorization URL advertised by server yet.' };
    }
    if (typeof this._oauthBroker.waitForAuthReadyOrUrl === 'function') {
      const st = await this._oauthBroker.waitForAuthReadyOrUrl(cleanName, 1200, { cancelled: false });
      if (st && st.authUrl) {
        const check = validateExternalAuthUrl(st.authUrl);
        if (!check.ok) {
          return { ok: false, code: check.code, error: check.error };
        }
        return { ok: true, authUrl: check.href };
      }
    }
    return { ok: false, error: 'No OAuth authorization URL advertised by server yet.' };
  }

  beginOAuthSession(serverName, initialAuthUrl = '') {
    this.cancelOAuthSession();
    const seq = ++this._oauthSessionSeq;
    const sessionStore = new DisposableStore();
    this._activeOAuthStore = sessionStore;
    this._disposables.add(sessionStore);

    const nextState = initialAuthUrl
      ? OAUTH_SESSION_STATES.AWAITING_BROWSER_CALLBACK
      : OAUTH_SESSION_STATES.DISCOVERING_AUTH_URL;
    this._state = {
      ...this._state,
      oauthCodeDraft: '',
      oauthSession: {
        state: nextState,
        serverName: String(serverName || '').trim(),
        authUrl: String(initialAuthUrl || '').trim(),
        error: null,
        seq,
      },
    };
    this._emit();

    return {
      seq,
      store: sessionStore,
      get cancelled() {
        return sessionStore.isDisposed;
      },
    };
  }

  cancelOAuthSession() {
    if (this._activeOAuthStore && !this._activeOAuthStore.isDisposed) {
      this._activeOAuthStore.dispose();
    }
    this._activeOAuthStore = null;
    if (
      this._state.oauthSession.state !== OAUTH_SESSION_STATES.IDLE &&
      this._state.oauthSession.state !== OAUTH_SESSION_STATES.AUTHORIZED
    ) {
      this._state = {
        ...this._state,
        oauthCodeDraft: '',
        oauthSession: {
          ...this._state.oauthSession,
          state: OAUTH_SESSION_STATES.CANCELLED,
        },
      };
      this._emit();
    }
  }

  async waitForServerOAuthOrReady(serverName, timeoutMs = 3000, sessionHandle = null) {
    if (typeof this._oauthBroker.waitForAuthReadyOrUrl !== 'function') {
      return null;
    }
    const signal = sessionHandle || {
      get cancelled() {
        return false;
      },
    };
    const st = await this._oauthBroker.waitForAuthReadyOrUrl(serverName, timeoutMs, signal);
    if (sessionHandle && !sessionHandle.cancelled && this._state.oauthSession.seq === sessionHandle.seq && st) {
      if (st.hasAuthToken) {
        this._state = {
          ...this._state,
          oauthSession: {
            ...this._state.oauthSession,
            state: OAUTH_SESSION_STATES.AUTHORIZED,
          },
        };
        this._emit();
      } else if (st.authUrl) {
        this._state = {
          ...this._state,
          oauthSession: {
            ...this._state.oauthSession,
            state: OAUTH_SESSION_STATES.AWAITING_BROWSER_CALLBACK,
            authUrl: st.authUrl,
          },
        };
        this._emit();
      }
    }
    return st;
  }

  /**
   * Core-level external OAuth URL security gate (`MCP-TC-019`, `Rev 6 §5.1`).
   * Rejects dangerous schemes, non-loopback `http://`, and embedded `user:pass@` BEFORE invoking `OAuthBrokerPort`.
   */
  async openAuthUrl(url) {
    const check = validateExternalAuthUrl(url);
    if (!check.ok) {
      return { ok: false, code: check.code, error: check.error };
    }
    const opener =
      typeof this._oauthBroker.openAuthorizationUrl === 'function'
        ? this._oauthBroker.openAuthorizationUrl.bind(this._oauthBroker)
        : typeof this._oauthBroker.openExternalUrl === 'function'
          ? this._oauthBroker.openExternalUrl.bind(this._oauthBroker)
          : null;
    if (!opener) {
      return { ok: false, error: 'External authorization launcher is not connected.' };
    }
    const res = await opener(check.href);
    if (typeof res === 'boolean') {
      return res ? { ok: true, href: check.href } : { ok: false, error: 'Failed to open authorization URL.' };
    }
    if (res && res.ok) {
      return { ok: true, href: check.href };
    }
    return { ok: false, error: res?.error || 'Failed to open authorization URL.' };
  }

  async completeOAuth(serverName, rawCodeOrCallbackUrl) {
    const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
    const code = normalizeAuthorizationCode(rawCodeOrCallbackUrl);
    if (!cleanName || !code) {
      return { ok: false, error: 'Server name and authorization code are required.' };
    }
    this._state = {
      ...this._state,
      oauthSession: {
        ...this._state.oauthSession,
        serverName: cleanName,
        state: OAUTH_SESSION_STATES.SUBMITTING_CODE,
        error: null,
      },
    };
    this._emit();

    const res = await this._oauthBroker.completeAuthorization(cleanName, code);
    if (res && res.ok) {
      this._state = {
        ...this._state,
        oauthCodeDraft: '',
        oauthSession: {
          ...this._state.oauthSession,
          serverName: cleanName,
          state: OAUTH_SESSION_STATES.AUTHORIZED,
          error: null,
        },
      };
      this._emit();
      await this._safeRefresh(cleanName);
      return res;
    }
    const errMsg = redactSensitiveText(res?.error || 'OAuth authorization completion failed.');
    this._state = {
      ...this._state,
      oauthSession: {
        ...this._state.oauthSession,
        serverName: cleanName,
        state: OAUTH_SESSION_STATES.FAILED,
        error: errMsg,
      },
    };
    this._emit();
    return { ok: false, error: errMsg };
  }

  async disconnectOAuth(serverName, account = '') {
    const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
    if (!cleanName) {
      return { ok: false, error: 'Server name is required.' };
    }
    const res = await this._oauthBroker.disconnectSession(cleanName, typeof account === 'string' ? account : '');
    if (res && res.ok) {
      await this._safeRefresh(cleanName);
    }
    return res || { ok: false, error: 'OAuth disconnect failed.' };
  }

  async revealConfigInExplorer(uri) {
    if (typeof this._configRepo.revealConfigInExplorer === 'function') {
      return this._configRepo.revealConfigInExplorer(uri);
    }
    return { ok: false, error: 'File explorer reveal is not supported in this host.' };
  }

  async _safeRefresh(serverName) {
    let refreshRes = { ok: true };
    if (typeof this._mcpRuntime.refreshServers === 'function') {
      try {
        refreshRes =
          (await this._mcpRuntime.refreshServers(
            serverName ? { shallow: true, serverName } : { shallow: false }
          )) || { ok: true };
      } catch (err) {
        refreshRes = {
          ok: false,
          error: redactSensitiveText(err?.message || 'Failed to refresh MCP servers.'),
        };
      }
    }
    await this.fetchServerStates();
    return refreshRes;
  }

  dispose() {
    this.cancelOAuthSession();
    this.clearSensitiveDrafts();
    this._listeners.clear();
    this._disposables.dispose();
  }
}

module.exports = {
  OAUTH_SESSION_STATES,
  createEmptyEditorDraft,
  McpManagerService,
};
