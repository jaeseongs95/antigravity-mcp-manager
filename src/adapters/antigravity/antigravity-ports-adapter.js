'use strict';

/**
 * Antigravity Host Implementation of `ConfigRepositoryPort`, `McpRuntimePort`, and `OAuthBrokerPort`.
 *
 * Key Guarantees:
 * 1. Raw-text `readConfig()` preserves 0-byte empty `mcp_config.json` (`""`) as
 *    `{ ok: true, status: 'FOUND', exists: true, rawText: '', digest: sha256Hex('') }` (`5095348c-F4`).
 * 2. `isMissingFileError(err)` strictly separates genuine Go/Node OS filesystem absence (`ENOENT`,
 *    `no such file or directory`, `The system cannot find the file specified`) from HTTP `404` /
 *    `"Instance not found"` / network errors (`Rev 6 §5.1 #2`, `MCP-TC-023`).
 * 3. Pre-write SHA-256 re-read CAS (`writeConfig`) rejects external disk edits with `CONFLICT`
 *    before calling `WriteFile`.
 * 4. All polling timers (`280ms` OAuth discovery poll) are bound to `DisposableStore`.
 */

const { DisposableStore } = require('../../core/disposable');
const { sha256Hex } = require('../../core/sha256');
const { encodeBytesToBase64, decodeBase64ToBytes } = require('../../core/schema/auth-codec');
const { validateExternalAuthUrl } = require('../../core/security/url-policy');
const { disposableTimeout } = require('../../shared/dom-disposables');

const TRANSPORT_OR_ROUTE_FAILURE_RE =
  /\bhttp\s*404\b|\bstatus(?:\s*code)?\s*[:=]?\s*404\b|^404\b|404\s+page\s+not\s+found|instance\s+not\s+found|service\s+not\s+found|method\s+not\s+found|\bunimplemented\b|econnrefused|etimedout|enetunreach|econnreset|failed\s+to\s+fetch|networkerror|socket\s+hang\s+up|\bdisconnected\b/i;

const FILESYSTEM_MISSING_CODE_RE = /^(?:ENOENT|ERR_ENOENT|FileNotFound|EntryNotFound)$/i;

const FILESYSTEM_MISSING_MSG_RE =
  /\bENOENT\b|FileNotFound|EntryNotFound|no\s+such\s+file\s+or\s+directory|The\s+system\s+cannot\s+find\s+the\s+(?:file|path)\s+specified|cannot\s+find\s+the\s+file|file\s+does\s+not\s+exist/i;

/**
 * Strictly determines whether `err` represents a genuine OS/filesystem missing-file condition.
 * HTTP 404, RPC routing errors, and network failures ALWAYS return `false`.
 *
 * @param {any} err
 * @returns {boolean}
 */
function isMissingFileError(err) {
  if (!err) return false;
  const httpStatus = Number(err.status ?? err.statusCode ?? err.httpStatus ?? 0);
  if (httpStatus === 404 || httpStatus >= 500) {
    return false;
  }
  const msg = String(err.message ?? err ?? '');
  const code = String(err.code ?? '').trim();

  if (code === 'SERVICE_UNAVAILABLE' || TRANSPORT_OR_ROUTE_FAILURE_RE.test(msg)) {
    return false;
  }
  if (code && FILESYSTEM_MISSING_CODE_RE.test(code)) {
    return true;
  }
  return FILESYSTEM_MISSING_MSG_RE.test(msg);
}

function toFileUriFromFsPath(fsPath) {
  const raw = String(fsPath || '').trim();
  if (!raw) return '';
  if (raw.startsWith('file://')) return raw;
  const normalized = raw.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  if (normalized.startsWith('/')) {
    return `file://${normalized}`;
  }
  return `file:///${normalized}`;
}

function toFsPathFromFileUri(uri) {
  const raw = String(uri || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('file://')) return raw;
  try {
    const u = new URL(raw);
    let p = decodeURIComponent(u.pathname || '');
    if (/^\/[A-Za-z]:\//.test(p)) {
      p = p.slice(1);
    }
    return p;
  } catch {
    return raw.replace(/^file:\/\/\/?/, '');
  }
}

function normalizeConfigUriFromDir(dirOrPath) {
  const raw = String(dirOrPath || '').trim();
  if (!raw) return '';
  const slash = raw.replace(/\\/g, '/').replace(/\/+$/, '');
  if (slash.endsWith('/mcp_config.json')) {
    return toFileUriFromFsPath(slash);
  }
  if (slash.endsWith('/.gemini/config') || slash.endsWith('/config')) {
    return toFileUriFromFsPath(`${slash}/mcp_config.json`);
  }
  if (slash.endsWith('/.gemini')) {
    return toFileUriFromFsPath(`${slash}/config/mcp_config.json`);
  }
  const geminiIdx = slash.indexOf('/.gemini/');
  if (geminiIdx !== -1) {
    const geminiRoot = slash.slice(0, geminiIdx + '/.gemini'.length);
    return toFileUriFromFsPath(`${geminiRoot}/config/mcp_config.json`);
  }
  return toFileUriFromFsPath(`${slash}/.gemini/config/mcp_config.json`);
}

/**
 * Decodes a `ReadFile` RPC response into a UTF-8 `string` (preserving `""` for 0-byte files).
 *
 * @param {any} res
 * @returns {string}
 */
function decodeReadFileResponseToText(res) {
  if (typeof res === 'string') {
    return res;
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  if (res instanceof Uint8Array || ArrayBuffer.isView(res)) {
    return decoder.decode(new Uint8Array(res.buffer, res.byteOffset, res.byteLength));
  }
  if (!res || typeof res !== 'object') {
    return '';
  }

  if (res.content instanceof Uint8Array || ArrayBuffer.isView(res.content)) {
    const view = res.content;
    return decoder.decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  if (Array.isArray(res.content)) {
    return decoder.decode(Uint8Array.from(res.content));
  }
  if (typeof res.content === 'string') {
    if (res.content === '') return '';
    if (res.encoding === 'utf8' || res.encoding === 'utf-8') {
      return res.content;
    }
    if (res.encoding === 'base64' || res.__fromProxyCommand === true) {
      const bytes = decodeBase64ToBytes(res.content);
      if (bytes !== null) {
        return decoder.decode(bytes);
      }
      return res.content;
    }
    const trimmed = res.content.trimStart();
    if (
      trimmed.startsWith('{') ||
      trimmed.startsWith('[') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*')
    ) {
      return res.content;
    }
    const maybeBytes = decodeBase64ToBytes(res.content);
    if (maybeBytes !== null) {
      const strictDec = new TextDecoder('utf-8', { fatal: true });
      try {
        return strictDec.decode(maybeBytes);
      } catch {
        return res.content;
      }
    }
    return res.content;
  }
  if (typeof res.text === 'string') {
    return res.text;
  }
  // Proto3 JSON omits default empty `bytes content = 1` (`b""`) as `{}` when file is 0 bytes.
  return '';
}

/**
 * Creates the Antigravity adapter implementing `ConfigRepositoryPort`, `McpRuntimePort`, and `OAuthBrokerPort`.
 *
 * @param {{
 *   win: any,
 *   doc: any,
 *   hostConfig: any,
 *   fiberGateway: any,
 *   remoteLease: any,
 *   rpcTransport: any
 * }} deps
 */
function createAntigravityPortsAdapter(deps) {
  const { win, doc, hostConfig, fiberGateway, remoteLease, rpcTransport } = deps;
  const store = new DisposableStore();
  let cachedConfigUri = hostConfig.configUriOverride ? toFileUriFromFsPath(hostConfig.configUriOverride) : '';

  async function resolveMcpConfigUri() {
    if (cachedConfigUri) return cachedConfigUri;

    const fromFiberDir = fiberGateway.getConfigDir();
    if (fromFiberDir) {
      cachedConfigUri = normalizeConfigUriFromDir(fromFiberDir);
      if (cachedConfigUri) return cachedConfigUri;
    }

    try {
      const dirRes = await rpcTransport.callMethod('GetStandaloneDir', {});
      const dirStr = dirRes?.standaloneDir || dirRes?.dir || dirRes?.path || (typeof dirRes === 'string' ? dirRes : '');
      if (dirStr) {
        cachedConfigUri = normalizeConfigUriFromDir(dirStr);
        if (cachedConfigUri) return cachedConfigUri;
      }
    } catch {
      // Fallback to GetLocalUserInfo / state hints
    }

    try {
      const userRes = await rpcTransport.callMethod('GetLocalUserInfo', {});
      const homeDir = userRes?.homeDir || userRes?.userHome || userRes?.configDir || '';
      if (homeDir) {
        cachedConfigUri = normalizeConfigUriFromDir(homeDir);
        if (cachedConfigUri) return cachedConfigUri;
      }
    } catch {
      // Fallback to server states / process env
    }

    try {
      const stRes = await rpcTransport.callMethod('GetMcpServerStates', {});
      const list = Array.isArray(stRes?.states) ? stRes.states : [];
      for (let i = 0; i < list.length; i += 1) {
        const hint = list[i]?.spec?.configPath || list[i]?.configPath || '';
        if (hint) {
          cachedConfigUri = normalizeConfigUriFromDir(hint);
          if (cachedConfigUri) return cachedConfigUri;
        }
      }
    } catch {
      // Ignore
    }

    if (typeof process !== 'undefined' && process && process.env) {
      const envHome = process.env.USERPROFILE || process.env.HOME || '';
      if (envHome) {
        cachedConfigUri = normalizeConfigUriFromDir(envHome);
        if (cachedConfigUri) return cachedConfigUri;
      }
    }

    return '';
  }

  async function readRawAtUri(uri) {
    const fsPath = toFsPathFromFileUri(uri);
    try {
      const res = await rpcTransport.callMethod('ReadFile', {
        uri,
        path: fsPath,
        filePath: fsPath,
        absolutePath: fsPath,
      });
      const rawText = decodeReadFileResponseToText(res);
      return {
        ok: true,
        status: 'FOUND',
        exists: true,
        uri,
        fsPath,
        rawText,
        digest: sha256Hex(rawText),
      };
    } catch (err) {
      if (isMissingFileError(err)) {
        return {
          ok: true,
          status: 'MISSING',
          exists: false,
          uri,
          fsPath,
          rawText: '',
          digest: null,
        };
      }
      const isUnavailable = err?.code === 'SERVICE_UNAVAILABLE' || !rpcTransport.isAvailable();
      return {
        ok: false,
        reason: isUnavailable ? 'SERVICE_UNAVAILABLE' : 'READ_FAILED',
        uri,
        fsPath,
        rawText: null,
        digest: null,
        error: `Failed to read mcp_config.json: ${err?.message || String(err)}`,
      };
    }
  }

  const configRepo = {
    async readConfig() {
      if (!rpcTransport.isAvailable()) {
        return {
          ok: false,
          reason: 'SERVICE_UNAVAILABLE',
          uri: cachedConfigUri || null,
          fsPath: cachedConfigUri ? toFsPathFromFileUri(cachedConfigUri) : null,
          rawText: null,
          digest: null,
          error: 'Antigravity LanguageServerService is not available in this session.',
        };
      }

      const uri = await resolveMcpConfigUri();
      if (!uri) {
        return {
          ok: false,
          reason: 'URI_UNRESOLVED',
          uri: null,
          fsPath: null,
          rawText: null,
          digest: null,
          error: 'Unable to resolve ~/.gemini/config/mcp_config.json path from host.',
        };
      }

      return await readRawAtUri(uri);
    },

    async writeConfig(req) {
      // ceiling: Host LanguageServerService.WriteFile has no native server-side etag parameter,
      // so we re-read immediately prior to WriteFile and verify (exists, sha256) to block lost updates.
      if (!rpcTransport.isAvailable()) {
        return {
          ok: false,
          reason: 'SERVICE_UNAVAILABLE',
          uri: req?.uri || cachedConfigUri || null,
          error: 'Antigravity LanguageServerService is not available for writing.',
        };
      }

      const uri = req?.uri || (await resolveMcpConfigUri());
      if (!uri) {
        return {
          ok: false,
          reason: 'URI_UNRESOLVED',
          uri: null,
          error: 'Unable to resolve mcp_config.json URI for writing.',
        };
      }

      const preCheck = await readRawAtUri(uri);
      if (!preCheck.ok) {
        return {
          ok: false,
          reason: preCheck.reason,
          uri,
          error: preCheck.error,
        };
      }

      const expectedExists = Boolean(req.expectedExists);
      const expectedDigest = expectedExists ? String(req.expectedDigest ?? '') : null;

      if (preCheck.exists !== expectedExists || preCheck.digest !== expectedDigest) {
        return {
          ok: false,
          reason: 'CONFLICT',
          uri,
          error: 'mcp_config.json changed on disk before save; reload to avoid overwriting external edits.',
          currentExists: preCheck.exists,
          currentRawText: preCheck.rawText,
          currentDigest: preCheck.digest,
        };
      }

      const rawText = String(req.rawText ?? '');
      const utf8Bytes = new TextEncoder().encode(rawText);
      const fsPath = toFsPathFromFileUri(uri);
      const directSvc = fiberGateway.getLanguageServerService();

      try {
        if (directSvc && typeof directSvc.writeFile === 'function') {
          await directSvc.writeFile({ uri, path: fsPath, content: utf8Bytes, overwrite: true });
        } else {
          await rpcTransport.callMethod('WriteFile', {
            uri,
            path: fsPath,
            filePath: fsPath,
            content: encodeBytesToBase64(utf8Bytes),
            overwrite: true,
          });
        }
      } catch (err) {
        return {
          ok: false,
          reason: 'WRITE_FAILED',
          uri,
          error: `Failed to write mcp_config.json: ${err?.message || String(err)}`,
        };
      }

      return {
        ok: true,
        uri,
        fsPath,
        digest: sha256Hex(rawText),
      };
    },

    async revealConfigInExplorer(uriArg) {
      const uri = uriArg || (await resolveMcpConfigUri());
      if (!uri) {
        return { ok: false, error: 'Config URI is unresolved.' };
      }
      const ef = fiberGateway.getElectronNativeFeature();
      if (!ef || typeof ef.revealInFilePicker !== 'function') {
        return { ok: false, error: 'File picker reveal is only supported in the desktop app.' };
      }
      try {
        await ef.revealInFilePicker(uri);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    },
  };

  const extractAuthUrlFromState = (st) => {
    if (!st || typeof st !== 'object') return '';
    return String(
      st.authUrl ||
        st.authorizationUrl ||
        st.oauthUrl ||
        st.oauth?.authUrl ||
        st.oauth?.authorizationUrl ||
        ''
    ).trim();
  };

  const runtimePort = {
    async listServerStates() {
      try {
        const res = await rpcTransport.callMethod('GetMcpServerStates', {});
        const rawList = Array.isArray(res?.states) ? res.states : [];
        const states = rawList.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const serverName = String(item.serverName || item.name || item.spec?.serverName || '').trim();
          return {
            ...item,
            serverName,
          };
        });
        return { ok: true, servers: states, states };
      } catch (err) {
        return {
          ok: false,
          servers: [],
          states: [],
          error: err?.message || String(err),
        };
      }
    },

    async refreshServers(opts = {}) {
      try {
        const cleanName = typeof opts === 'string' ? opts.trim() : String(opts?.serverName || '').trim();
        const payload = cleanName
          ? { shallow: Boolean(opts?.shallow), serverName: cleanName }
          : { shallow: false };
        await rpcTransport.callMethod('RefreshMcpServers', payload);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    },

    async refreshServer(serverName) {
      return runtimePort.refreshServers({ shallow: false, serverName });
    },

    async refreshAllServers() {
      return runtimePort.refreshServers({ shallow: false });
    },

    async toggleServer(serverName, enabled) {
      try {
        await rpcTransport.callMethod('ToggleMcpServer', {
          serverName: String(serverName || '').trim(),
          enabled: Boolean(enabled),
        });
        return { ok: true, supported: true };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    },

    async toggleRuntimeServer(serverName, enabled) {
      return runtimePort.toggleServer(serverName, enabled);
    },
  };

  const oauthBroker = {
    async discoverOAuthMetadata(serverName) {
      const cleanName = String(serverName || '').trim();
      if (!cleanName) {
        return { ok: false, error: 'Server name is required for OAuth discovery.' };
      }

      const checkStatesOnce = async () => {
        const stRes = await runtimePort.listServerStates();
        if (!stRes.ok) return '';
        const match = stRes.states.find((s) => s?.serverName === cleanName);
        return extractAuthUrlFromState(match);
      };

      let foundUrl = await checkStatesOnce();
      if (!foundUrl) {
        await runtimePort.refreshServer(cleanName);
        foundUrl = await new Promise((resolve) => {
          if (store.isDisposed) {
            resolve('');
            return;
          }
          const timerDisp = disposableTimeout(
            win,
            async () => {
              store.delete?.(timerDisp);
              if (store.isDisposed) {
                resolve('');
                return;
              }
              resolve(await checkStatesOnce());
            },
            280
          );
          store.add(timerDisp);
        });
      }

      if (!foundUrl) {
        return {
          ok: false,
          error: 'No OAuth authorization URL advertised by server yet.',
        };
      }

      const check = validateExternalAuthUrl(foundUrl);
      if (!check.ok) {
        return {
          ok: false,
          error: check.reason || 'Server advertised an unsafe OAuth authorization URL.',
        };
      }
      return {
        ok: true,
        authUrl: check.normalizedUrl,
      };
    },

    async openExternalUrl(validatedUrl) {
      const check = validateExternalAuthUrl(validatedUrl);
      if (!check.ok) {
        return { ok: false, error: check.reason || 'Unsafe external URL rejected.' };
      }
      const safeUrl = check.normalizedUrl;

      const ef = fiberGateway.getElectronNativeFeature();
      if (ef && typeof ef.openExternal === 'function') {
        try {
          await ef.openExternal(safeUrl);
          return { ok: true };
        } catch {
          // Fall through to RemoteControl / window.open
        }
      }

      const rc = remoteLease.getInstance(win, doc);
      if (rc && typeof rc.openExternalUrl === 'function') {
        try {
          await rc.openExternalUrl(safeUrl);
          return { ok: true };
        } catch {
          // Fall through to window.open
        }
      }

      if (win && typeof win.open === 'function') {
        win.open(safeUrl, '_blank', 'noopener,noreferrer');
        return { ok: true };
      }
      return { ok: false, error: 'No external browser opener available in this environment.' };
    },

    async openAuthorizationUrl(validatedUrl) {
      return oauthBroker.openExternalUrl(validatedUrl);
    },

    async waitForAuthReadyOrUrl(serverName, _timeoutMs = 1200, signal = null) {
      if (signal?.cancelled || store.isDisposed) return null;
      const cleanName = String(serverName || '').trim();
      const stRes = await runtimePort.listServerStates();
      if (stRes.ok) {
        const match = stRes.states.find((s) => s?.serverName === cleanName);
        if (match?.oauthConnected || match?.hasAuthToken) {
          return { hasAuthToken: true };
        }
        const url = extractAuthUrlFromState(match);
        if (url) {
          const chk = validateExternalAuthUrl(url);
          if (chk.ok) return { authUrl: chk.href };
        }
      }
      const disc = await oauthBroker.discoverOAuthMetadata(cleanName);
      if (signal?.cancelled || store.isDisposed) return null;
      if (disc && disc.ok && disc.authUrl) {
        return { authUrl: disc.authUrl };
      }
      return null;
    },

    async completeOAuth(serverName, authorizationCode) {
      const cleanName = String(serverName || '').trim();
      const cleanCode = String(authorizationCode || '').trim();
      try {
        await rpcTransport.callMethod(
          'CompleteMcpOAuth',
          { serverName: cleanName, authorizationCode: cleanCode, code: cleanCode },
          { positionalArgs: [cleanName, cleanCode] }
        );
        await runtimePort.refreshServer(cleanName);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    },

    async completeAuthorization(serverName, authorizationCode) {
      return oauthBroker.completeOAuth(serverName, authorizationCode);
    },

    async disconnectOAuth(serverName, account = '') {
      const cleanName = String(serverName || '').trim();
      const cleanAccount = String(account || '').trim();
      try {
        await rpcTransport.callMethod(
          'DisconnectMcpOAuth',
          { serverName: cleanName, account: cleanAccount },
          { positionalArgs: [cleanName, cleanAccount] }
        );
        await runtimePort.refreshServer(cleanName);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    },

    async disconnectSession(serverName, account = '') {
      return oauthBroker.disconnectOAuth(serverName, account);
    },
  };

  return {
    configRepo,
    mcpRuntime: runtimePort,
    runtimePort,
    oauthBroker,
    resolveMcpConfigUri,
    dispose: () => store.dispose(),
  };
}

module.exports = {
  isMissingFileError,
  toFileUriFromFsPath,
  toFsPathFromFileUri,
  normalizeConfigUriFromDir,
  decodeReadFileResponseToText,
  createAntigravityPortsAdapter,
};
