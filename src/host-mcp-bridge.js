'use strict';

const { normalizeMcpConfigObject } = require('./mcp-config-schema');
const { resolveHostAdapterConfig } = require('./host-adapter-config');
const {
  acquireRemoteRuntimeLease,
  parseAutoinjectCompanionManifest,
} = require('./remote-runtime');

const STORAGE_FALLBACK_KEY = 'agy-custom-mcp-config-backup-v1';
const STORAGE_URI_OVERRIDE_KEY = 'agy-custom-mcp-config-uri-v1';

function isMissingFileError(err) {
  const msg = String(err?.message || err || '');
  const code = String(err?.code || '');
  if (code.toUpperCase() === 'ENOENT') return true;
  return /enoent|file\s*not\s*found|not\s*found|does\s*not\s*exist|no\s*such\s*file|cannot\s*find\s*the\s*file|filenotfound|\b404\b/i.test(
    msg
  );
}

function toFileUriFromFsPath(fsPath) {
  if (!fsPath || typeof fsPath !== 'string') return null;
  const trimmed = fsPath.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('file://')) return trimmed;
  const normalized = trimmed.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  if (normalized.startsWith('/')) {
    return `file://${normalized}`;
  }
  return `file:///${normalized}`;
}

function toFsPathFromFileUri(uri) {
  if (!uri || typeof uri !== 'string') return '';
  const trimmed = uri.trim();
  if (!trimmed.startsWith('file://')) return trimmed;
  try {
    const withoutScheme = decodeURIComponent(trimmed.replace(/^file:\/\//i, ''));
    if (/^\/[a-zA-Z]:\//.test(withoutScheme)) {
      return withoutScheme.slice(1);
    }
    return withoutScheme;
  } catch {
    return trimmed;
  }
}

function extractGeminiConfigUriFromPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return null;
  const norm = rawPath.replace(/\\/g, '/');
  const idx = norm.indexOf('/.gemini/');
  if (idx === -1) return null;
  const geminiRoot = norm.slice(0, idx + '/.gemini'.length);
  return toFileUriFromFsPath(`${geminiRoot}/config/mcp_config.json`);
}

function normalizeAuthorizationCode(rawCode) {
  if (rawCode === null || rawCode === undefined) return '';
  const trimmed = String(rawCode).trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || (trimmed.includes('code=') && (trimmed.includes('?') || trimmed.includes('&')))) {
    try {
      const u = new URL(trimmed.startsWith('http') ? trimmed : `http://localhost/${trimmed.replace(/^\/+/, '')}`);
      const fromQuery = u.searchParams.get('code');
      if (fromQuery && fromQuery.trim()) return fromQuery.trim();
    } catch {}
    const m = /[?&]code=([^&#\s]+)/i.exec(trimmed);
    if (m && m[1]) {
      try {
        return decodeURIComponent(m[1]).trim();
      } catch {
        return m[1].trim();
      }
    }
  }
  return trimmed;
}

function encodeBytesToBase64(bytes) {
  if (!bytes) return '';
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  return typeof btoa === 'function' ? btoa(binary) : '';
}

function decodeBase64ToBytes(b64) {
  if (!b64) return new Uint8Array(0);
  if (bytesIsUint8(b64)) return b64;
  if (typeof Buffer !== 'undefined' && typeof b64 === 'string') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  if (typeof atob === 'function' && typeof b64 === 'string') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(0);
}

function bytesIsUint8(v) {
  return Boolean(v && (v instanceof Uint8Array || ArrayBuffer.isView(v)));
}

function createHostMcpBridge(opts = {}) {
  const win = opts.window || opts.win || (typeof window !== 'undefined' ? window : null);
  const doc = opts.document || opts.doc || (win && win.document ? win.document : null);
  const resolvedHostConfig = resolveHostAdapterConfig(opts.hostConfig, win);
  const runtimeLease = acquireRemoteRuntimeLease({ hostConfig: resolvedHostConfig, defaultWin: win });

  let ls = opts.localStorage || null;
  if (!ls && win) {
    try {
      ls = win.localStorage || null;
    } catch {
      ls = null;
    }
  }
  let cachedService = opts.hostService || null;
  let cachedConfigDirUri = null;
  let cachedElectronNative = null;
  let resolvedConfigUri = null;
  let lastKnownStates = [];
  let sharedTextEncoder = null;
  let sharedTextDecoder = null;
  // ceiling: 브릿지 인스턴스 내 비동기 직렬 잠금, 다중 프로세스 동시 편집이 필요하면 호스트 파일 잠금으로 확장
  let configMutationChain = Promise.resolve();

  function withConfigMutationLock(fn) {
    const next = configMutationChain.then(fn, fn);
    configMutationChain = next.catch(() => {});
    return next;
  }

  function encodeUtf8(str) {
    if (!sharedTextEncoder && typeof TextEncoder === 'function') {
      sharedTextEncoder = new TextEncoder();
    }
    if (sharedTextEncoder) return sharedTextEncoder.encode(str);
    return Uint8Array.from(String(str).split('').map((c) => c.charCodeAt(0) & 0xff));
  }

  function decodeUtf8(bytes) {
    if (typeof bytes === 'string') return bytes;
    if (!bytes) return '';
    if (!sharedTextDecoder && typeof TextDecoder === 'function') {
      sharedTextDecoder = new TextDecoder('utf-8');
    }
    if (sharedTextDecoder) return sharedTextDecoder.decode(bytes);
    return '';
  }

  function getAccessibleRemoteIframeDoc() {
    try {
      const iframe = doc?.querySelector?.('ga-remote-control iframe');
      return iframe?.contentDocument || iframe?.contentWindow?.document || null;
    } catch {
      return null;
    }
  }

  function getAccessibleParentDoc() {
    try {
      if (win && win.parent && win.parent !== win && win.parent.document) {
        return win.parent.document;
      }
    } catch {}
    return null;
  }

  function resolveRemoteControlInstance(w) {
    return runtimeLease.resolveRemoteControlInstance(w);
  }

  function getRemoteControlProxyAdapter() {
    try {
      const candidateWins = [win, win?.parent !== win ? win?.parent : null].filter(Boolean);
      for (const w of candidateWins) {
        const rcInst = resolveRemoteControlInstance(w);
        if (rcInst && typeof rcInst.proxyCommand === 'function') {
          const callRpc = async (rpcPath, reqObj) => {
            const bytes = encodeUtf8(JSON.stringify(reqObj || {}));
            const res = await rcInst.proxyCommand(rpcPath, bytes, {
              'content-type': 'application/json',
              'x-is-streaming': 'false',
            });
            if (!res || !res.payload) return {};
            const text = decodeUtf8(res.payload);
            return text ? JSON.parse(text) : {};
          };
          return {
            __isRcProxyAdapter: true,
            rcInst,
            async getMcpServerStates() {
              return await callRpc(resolvedHostConfig.buildRpcPath('GetMcpServerStates'), {});
            },
            async refreshMcpServers(req) {
              return await callRpc(resolvedHostConfig.buildRpcPath('RefreshMcpServers'), req || {});
            },
            async toggleMcpServer(req) {
              return await callRpc(resolvedHostConfig.buildRpcPath('ToggleMcpServer'), req || {});
            },
            async completeMcpOAuth(serverName, authorizationCode) {
              return await callRpc(resolvedHostConfig.buildRpcPath('CompleteMcpOAuth'), {
                serverName: String(serverName),
                authorizationCode: String(authorizationCode),
              });
            },
            async disconnectMcpOAuth(serverName, account) {
              return await callRpc(resolvedHostConfig.buildRpcPath('DisconnectMcpOAuth'), {
                serverName: String(serverName),
                account: String(account || ''),
              });
            },
            async getStandaloneDir() {
              return await callRpc(resolvedHostConfig.buildRpcPath('GetStandaloneDir'), {});
            },
            async getCustomizationStates() {
              return await callRpc(resolvedHostConfig.buildRpcPath('GetCustomizationStates'), {});
            },
            async getAllPlugins() {
              return await callRpc(resolvedHostConfig.buildRpcPath('GetAllPlugins'), {});
            },
            async getAllSkills() {
              return await callRpc(resolvedHostConfig.buildRpcPath('GetAllSkills'), {});
            },
            async getLocalUserInfo() {
              return await callRpc(resolvedHostConfig.buildRpcPath('GetLocalUserInfo'), {});
            },
            async readFile(req) {
              const uri = typeof req === 'string' ? req : req?.uri;
              const fsPath = uri ? toFsPathFromFileUri(uri) : '';
              const payloadReq = fsPath
                ? { uri, path: fsPath, filePath: fsPath, absolutePath: fsPath }
                : { uri };
              const r = await callRpc(resolvedHostConfig.buildRpcPath('ReadFile'), payloadReq);
              if (typeof r?.text === 'string' && r.text.length > 0) {
                return { content: encodeUtf8(r.text) };
              }
              const b64 =
                typeof r?.content === 'string'
                  ? r.content
                  : (typeof r?.contents === 'string' ? r.contents : (typeof r?.data === 'string' ? r.data : null));
              if (b64 !== null) {
                return { content: decodeBase64ToBytes(b64) };
              }
              return r;
            },
            async writeFile(req) {
              const contentB64 = bytesIsUint8(req?.content) ? encodeBytesToBase64(req.content) : (req?.content || '');
              return await callRpc(resolvedHostConfig.buildRpcPath('WriteFile'), {
                uri: req?.uri,
                content: contentB64,
                overwrite: Boolean(req?.overwrite),
              });
            },
          };
        }
      }
    } catch {}
    return null;
  }

  function scanFiberTree() {
    if (cachedService && typeof cachedService.getMcpServerStates === 'function' && !cachedService.__isRcProxyAdapter) {
      return cachedService;
    }
    const docs = [doc, getAccessibleRemoteIframeDoc(), getAccessibleParentDoc()].filter(Boolean);
    for (const d of docs) {
      const roots = [
        d.querySelector?.('#root'),
        d.querySelector?.('#app'),
        d.querySelector?.('[data-testid="conversation-view"]'),
        d.querySelector?.('.settings-modal-container'),
        d.body?.firstElementChild,
        d.body,
      ].filter(Boolean);

      for (const rootEl of roots) {
        const fk = Object.keys(rootEl).find(
          (k) => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$')
        );
        const startFiber = fk ? rootEl[fk] : null;
        if (!startFiber) continue;

        let up = startFiber;
        while (up) {
          inspectFiberValue(up.memoizedProps?.value);
          let dep = up.dependencies?.firstContext;
          while (dep) {
            inspectFiberValue(dep.memoizedValue);
            dep = dep.next;
          }
          up = up.return;
        }
        if (cachedService && !cachedService.__isRcProxyAdapter) return cachedService;

        const now = Date.now();
        if (d.__agyMcpLastDfsTs && now - d.__agyMcpLastDfsTs < 10000) {
          continue;
        }
        d.__agyMcpLastDfsTs = now;
        const stack = [startFiber];
        const visited = new Set();
        while (stack.length > 0 && visited.size < 3500) {
          const f = stack.pop();
          if (!f || visited.has(f)) continue;
          visited.add(f);

          inspectFiberValue(f.memoizedProps?.value);
          if (cachedService && !cachedService.__isRcProxyAdapter && cachedConfigDirUri) return cachedService;

          if (f.child) stack.push(f.child);
          if (f.sibling) stack.push(f.sibling);
        }
        if (cachedService && !cachedService.__isRcProxyAdapter) return cachedService;
      }
    }

    if (!cachedService) {
      const rcProxy = getRemoteControlProxyAdapter();
      if (rcProxy) {
        cachedService = rcProxy;
      }
    }
    return cachedService;
  }

  function inspectFiberValue(val) {
    if (!val || typeof val !== 'object') return;
    if (
      (!cachedService || cachedService.__isRcProxyAdapter) &&
      typeof val.getMcpServerStates === 'function' &&
      typeof val.refreshMcpServers === 'function'
    ) {
      cachedService = val;
    }
    if (!cachedConfigDirUri && val.selectedConfigDir) {
      const dirStr =
        typeof val.selectedConfigDir === 'string'
          ? val.selectedConfigDir
          : val.selectedConfigDir?.toString?.();
      if (dirStr) {
        cachedConfigDirUri = dirStr.replace(/\/+$/, '');
      }
    }
    if (!cachedConfigDirUri && val.selectedGeminiDir) {
      const gemStr =
        typeof val.selectedGeminiDir === 'string'
          ? val.selectedGeminiDir
          : val.selectedGeminiDir?.toString?.();
      if (gemStr) {
        cachedConfigDirUri = `${gemStr.replace(/\/+$/, '')}/config`;
      }
    }
    if (!cachedElectronNative && typeof val.get === 'function') {
      try {
        const nativeFeat = val.get('electronNativeFeature');
        if (nativeFeat && typeof nativeFeat === 'object') {
          cachedElectronNative = nativeFeat;
        }
      } catch {}
    }
  }

  async function resolveMcpConfigUri() {
    try {
      const override = ls?.getItem?.(STORAGE_URI_OVERRIDE_KEY);
      if (override && override.trim()) {
        resolvedConfigUri = toFileUriFromFsPath(override.trim());
        return resolvedConfigUri;
      }
    } catch {}

    if (resolvedConfigUri) return resolvedConfigUri;

    const svc = scanFiberTree();
    if (cachedConfigDirUri) {
      resolvedConfigUri = toFileUriFromFsPath(`${cachedConfigDirUri}/mcp_config.json`);
      if (resolvedConfigUri) return resolvedConfigUri;
    }

    if (svc && typeof svc.getMcpServerStates === 'function') {
      try {
        const res = await svc.getMcpServerStates();
        const states = Array.isArray(res?.states) ? res.states : [];
        if (states.length > 0) {
          lastKnownStates = states;
        }
        for (const st of states) {
          const fromCfg = extractGeminiConfigUriFromPath(st?.spec?.configPath || st?.spec?.pluginRoot || st?.spec?.cwd);
          if (fromCfg) {
            resolvedConfigUri = fromCfg;
            return resolvedConfigUri;
          }
        }
      } catch {}
    }

    if (svc && typeof svc.getStandaloneDir === 'function') {
      try {
        const res = await svc.getStandaloneDir();
        const fromStandalone = extractGeminiConfigUriFromPath(res?.standaloneDir || (typeof res === 'string' ? res : ''));
        if (fromStandalone) {
          resolvedConfigUri = fromStandalone;
          return resolvedConfigUri;
        }
      } catch {}
    }

    if (svc && typeof svc.getLocalUserInfo === 'function') {
      try {
        const uInfo = await svc.getLocalUserInfo();
        const homeUri = uInfo?.homeDirUri || uInfo?.homeDir || uInfo?.userInfo?.homeDirUri || '';
        if (homeUri) {
          const homeFs = toFsPathFromFileUri(String(homeUri)).replace(/\/+$/, '');
          if (homeFs) {
            resolvedConfigUri = toFileUriFromFsPath(`${homeFs}/.gemini/config/mcp_config.json`);
            if (resolvedConfigUri) return resolvedConfigUri;
          }
        }
      } catch {}
    }

    if (svc && typeof svc.getCustomizationStates === 'function') {
      try {
        const st = await svc.getCustomizationStates([]);
        const items = Array.isArray(st) ? st : (Array.isArray(st?.states) ? st.states : (Array.isArray(st?.items) ? st.items : []));
        for (const item of items) {
          const p = item?.path || item?.uri || item?.skillItem?.path || item?.ruleItem?.path || item?.pluginItem?.path || '';
          const fromCust = extractGeminiConfigUriFromPath(p);
          if (fromCust) {
            resolvedConfigUri = fromCust;
            return resolvedConfigUri;
          }
        }
      } catch {}
    }

    try {
      const home =
        (typeof process !== 'undefined' && (process.env?.USERPROFILE || process.env?.HOME)) || null;
      if (home) {
        resolvedConfigUri = toFileUriFromFsPath(`${home.replace(/\\/g, '/')}/.gemini/config/mcp_config.json`);
        return resolvedConfigUri;
      }
    } catch {}

    return resolvedConfigUri;
  }

  async function readMcpConfig() {
    const svc = scanFiberTree();
    const uri = await resolveMcpConfigUri();
    if (svc && typeof svc.readFile === 'function' && uri) {
      try {
        const res = await svc.readFile({ uri });
        const rawPayload = typeof res === 'string' ? res : res?.content;
        if (rawPayload && rawPayload.length > 0) {
          const text = decodeUtf8(rawPayload);
          if (text.trim()) {
            const norm = normalizeMcpConfigObject(text);
            if (norm.ok) {
              try {
                ls?.setItem?.(STORAGE_FALLBACK_KEY, JSON.stringify(norm.config));
              } catch {}
              return { ok: true, config: norm.config, uri, fsPath: toFsPathFromFileUri(uri), error: null };
            }
            return {
              ok: false,
              config: null,
              uri,
              fsPath: toFsPathFromFileUri(uri),
              error: norm.error,
            };
          }
        }
        return { ok: true, config: { mcpServers: {} }, uri, fsPath: toFsPathFromFileUri(uri), error: null };
      } catch (err) {
        if (isMissingFileError(err)) {
          return { ok: true, config: { mcpServers: {} }, uri, fsPath: toFsPathFromFileUri(uri), error: null };
        }
        return {
          ok: false,
          config: null,
          uri,
          fsPath: toFsPathFromFileUri(uri),
          error: `Failed to read mcp_config.json: ${err?.message || String(err)}`,
        };
      }
    }

    try {
      const raw = ls?.getItem?.(STORAGE_FALLBACK_KEY);
      if (raw) {
        const norm = normalizeMcpConfigObject(raw);
        if (norm.ok) {
          return {
            ok: true,
            config: norm.config,
            uri: uri || 'localStorage://mcp_config.json',
            fsPath: toFsPathFromFileUri(uri) || '~/.gemini/config/mcp_config.json',
            error: null,
          };
        }
      }
    } catch {}

    return {
      ok: true,
      config: { mcpServers: {} },
      uri: uri || 'file:///~/.gemini/config/mcp_config.json',
      fsPath: toFsPathFromFileUri(uri) || '~/.gemini/config/mcp_config.json',
      error: null,
    };
  }

  async function writeFileToHost(svc, uri, bytes) {
    if (!svc || typeof svc.writeFile !== 'function' || !uri) {
      return { ok: false, persisted: false };
    }
    try {
      await svc.writeFile({ uri, content: bytes, overwrite: true });
      return { ok: true, persisted: true };
    } catch (firstErr) {
      try {
        await svc.writeFile(uri, bytes);
        return { ok: true, persisted: true };
      } catch {
        return { ok: false, persisted: false, error: `Failed to write mcp_config.json: ${firstErr?.message || String(firstErr)}` };
      }
    }
  }

  async function writeMcpConfig(rawConfig, targetServerName) {
    const norm = normalizeMcpConfigObject(rawConfig);
    if (!norm.ok) {
      return { ok: false, error: norm.error };
    }
    const serialized = JSON.stringify(norm.config, null, 2) + '\n';
    try {
      ls?.setItem?.(STORAGE_FALLBACK_KEY, serialized);
    } catch {}

    const svc = scanFiberTree();
    const uri = await resolveMcpConfigUri();
    let persisted = false;
    if (svc && typeof svc.writeFile === 'function' && uri) {
      const bytes = encodeUtf8(serialized);
      const writeRes = await writeFileToHost(svc, uri, bytes);
      if (!writeRes.ok) {
        return { ok: false, persisted: false, error: writeRes.error };
      }
      persisted = true;
    } else if (svc) {
      return {
        ok: false,
        persisted: false,
        error: !uri
          ? 'Could not resolve ~/.gemini/config/mcp_config.json path from host.'
          : 'Host file writer (writeFile) is not available in this session.',
      };
    }

    if (svc && typeof svc.refreshMcpServers === 'function') {
      try {
        await svc.refreshMcpServers({
          shallow: false,
          ...(targetServerName ? { serverName: targetServerName } : {}),
        });
      } catch {}
    }

    await fetchServerStates();
    return { ok: true, persisted, config: norm.config, uri, fsPath: toFsPathFromFileUri(uri) };
  }

  async function fetchServerStates() {
    const svc = scanFiberTree();
    if (svc && typeof svc.getMcpServerStates === 'function') {
      try {
        const res = await svc.getMcpServerStates();
        const rawStates = Array.isArray(res?.states) ? res.states : [];
        const states = rawStates.map((st) => {
          if (!st || typeof st !== 'object') return st;
          const resolvedName = st.serverName || st.spec?.serverName || '';
          return st.serverName ? st : { ...st, serverName: resolvedName };
        });
        lastKnownStates = states;
        if (!resolvedConfigUri) {
          for (const st of states) {
            const fromCfg = extractGeminiConfigUriFromPath(
              st?.spec?.configPath || st?.spec?.pluginRoot || st?.spec?.cwd
            );
            if (fromCfg) {
              resolvedConfigUri = fromCfg;
              break;
            }
          }
        }
        return { ok: true, states, error: null };
      } catch (e) {
        return { ok: false, states: lastKnownStates, error: e?.message || 'Failed to load MCP server states.' };
      }
    }
    return { ok: true, states: lastKnownStates, error: null };
  }

  async function getMcpServerStates() {
    const res = await fetchServerStates();
    return Array.isArray(res?.states) ? res.states : [];
  }

  async function completeOAuth(serverName, authorizationCode) {
    const svc = scanFiberTree();
    const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
    const code = normalizeAuthorizationCode(authorizationCode);
    if (!cleanName || !code) {
      return { ok: false, error: 'Server name and authorization code are required.' };
    }
    if (!svc || typeof svc.completeMcpOAuth !== 'function') {
      return { ok: false, error: 'Host OAuth service (completeMcpOAuth) is not available.' };
    }
    try {
      await svc.completeMcpOAuth(String(cleanName), String(code));
      await refreshServers(cleanName);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || `Failed to complete OAuth for "${cleanName}".` };
    }
  }

  async function disconnectOAuth(serverName, account = '') {
    const svc = scanFiberTree();
    const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
    if (!cleanName) {
      return { ok: false, error: 'Server name is required.' };
    }
    if (!svc || typeof svc.disconnectMcpOAuth !== 'function') {
      return { ok: false, error: 'Host OAuth service (disconnectMcpOAuth) is not available.' };
    }
    try {
      await svc.disconnectMcpOAuth(String(cleanName), String(account || ''));
      await refreshServers(cleanName);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || `Failed to disconnect OAuth for "${cleanName}".` };
    }
  }

  function openAuthUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    try {
      if (win && typeof win.open === 'function') {
        win.open(parsed.href, '_blank', 'noopener,noreferrer');
        return true;
      }
    } catch {}
    return false;
  }

  async function waitForServerOAuthOrReady(serverName, timeoutMs = 3500) {
    if (!serverName) return null;
    const deadline = Date.now() + Math.max(200, Number(timeoutMs) || 3500);
    let latestState = null;
    while (Date.now() <= deadline) {
      const res = await fetchServerStates();
      const states = Array.isArray(res?.states) ? res.states : [];
      const found = states.find(
        (st) => st && (st.serverName === serverName || st.spec?.serverName === serverName)
      );
      if (found) {
        latestState = found;
        if (found.authUrl || found.hasAuthToken || found.status === 2 || (found.status === 3 && found.error)) {
          return found;
        }
      }
      if (Date.now() + 280 > deadline) break;
      await new Promise((r) => setTimeout(r, 280));
    }
    return latestState;
  }

  async function applyAuthHeadersToServers(serverNames, authHeaders) {
    return withConfigMutationLock(async () => {
      const readRes = await readMcpConfig();
      if (readRes.ok === false || !readRes.config) {
        return { ok: false, persisted: false, error: readRes.error || 'Failed to read mcp_config.json.' };
      }
      const { config } = readRes;
      const nextServers = { ...(config.mcpServers || {}) };
      const names =
        Array.isArray(serverNames) && serverNames.length > 0
          ? serverNames
          : Object.keys(nextServers).filter((k) => Boolean(nextServers[k]?.url || nextServers[k]?.serverUrl));

      let updatedCount = 0;
      for (const name of names) {
        const current = nextServers[name];
        if (!current || typeof current !== 'object') continue;
        if (current.url || current.serverUrl) {
          const mergedHeaders = { ...(current.headers || {}), ...(authHeaders || {}) };
          nextServers[name] = {
            ...current,
            headers: mergedHeaders,
          };
          updatedCount++;
        }
      }

      if (updatedCount === 0) {
        return { ok: false, error: 'No matching HTTP custom servers found to update authentication.' };
      }

      const res = await writeMcpConfig({ ...config, mcpServers: nextServers });
      return { ...res, updatedCount };
    });
  }

  async function refreshServers(serverName) {
    const svc = scanFiberTree();
    if (svc && typeof svc.refreshMcpServers === 'function') {
      try {
        await svc.refreshMcpServers({
          shallow: false,
          ...(serverName ? { serverName } : {}),
        });
      } catch (e) {
        return { ok: false, error: e?.message || 'Failed to refresh MCP servers.' };
      }
    }
    return fetchServerStates();
  }

  async function toggleServerEnabled(serverName, enabled) {
    return withConfigMutationLock(async () => {
      const svc = scanFiberTree();
      if (svc && typeof svc.toggleMcpServer === 'function') {
        try {
          await svc.toggleMcpServer({ serverName, enabled: Boolean(enabled) });
        } catch (e) {
          return { ok: false, error: e?.message || `Failed to toggle MCP server "${serverName}".` };
        }
      }
      const readRes = await readMcpConfig();
      if (readRes.ok === false || !readRes.config) {
        return { ok: false, persisted: false, error: readRes.error || 'Failed to read mcp_config.json.' };
      }
      const { config } = readRes;
      if (config.mcpServers && config.mcpServers[serverName]) {
        const nextConfig = {
          ...config,
          mcpServers: {
            ...config.mcpServers,
            [serverName]: {
              ...config.mcpServers[serverName],
            },
          },
        };
        if (enabled) {
          delete nextConfig.mcpServers[serverName].disabled;
        } else {
          nextConfig.mcpServers[serverName].disabled = true;
        }
        const writeRes = await writeMcpConfig(nextConfig, serverName);
        if (writeRes && writeRes.ok === false) {
          return writeRes;
        }
      }
      return fetchServerStates();
    });
  }

  async function upsertCustomServer(serverName, spec, previousName = null) {
    return withConfigMutationLock(async () => {
      const readRes = await readMcpConfig();
      if (readRes.ok === false || !readRes.config) {
        return { ok: false, persisted: false, error: readRes.error || 'Failed to read mcp_config.json.' };
      }
      const { config } = readRes;
      const nextServers = { ...(config.mcpServers || {}) };
      if (previousName && previousName !== serverName && nextServers[previousName]) {
        delete nextServers[previousName];
      }
      nextServers[serverName] = spec;
      return writeMcpConfig({ ...config, mcpServers: nextServers }, serverName);
    });
  }

  async function deleteCustomServer(serverName) {
    return withConfigMutationLock(async () => {
      const readRes = await readMcpConfig();
      if (readRes.ok === false || !readRes.config) {
        return { ok: false, persisted: false, error: readRes.error || 'Failed to read mcp_config.json.' };
      }
      const { config } = readRes;
      const nextServers = { ...(config.mcpServers || {}) };
      if (!(serverName in nextServers)) {
        return { ok: false, error: `Custom server "${serverName}" was not found in mcp_config.json.` };
      }
      delete nextServers[serverName];
      return writeMcpConfig({ ...config, mcpServers: nextServers }, serverName);
    });
  }

  async function toggleServerTool(serverName, toolName, enabled) {
    return withConfigMutationLock(async () => {
      const readRes = await readMcpConfig();
      if (readRes.ok === false || !readRes.config) {
        return { ok: false, persisted: false, error: readRes.error || 'Failed to read mcp_config.json.' };
      }
      const { config } = readRes;
      if (!config.mcpServers || !config.mcpServers[serverName]) {
        return {
          ok: false,
          error: `Tool toggling via mcp_config.json is only supported for custom servers in mcp_config.json ("${serverName}").`,
        };
      }
      const currentServer = { ...config.mcpServers[serverName] };
      let disabledTools = Array.isArray(currentServer.disabledTools)
        ? [...currentServer.disabledTools]
        : [];
      if (enabled) {
        disabledTools = disabledTools.filter((t) => t !== toolName);
      } else if (!disabledTools.includes(toolName)) {
        disabledTools.push(toolName);
      }
      if (disabledTools.length > 0) {
        currentServer.disabledTools = disabledTools;
      } else {
        delete currentServer.disabledTools;
      }
      const nextConfig = {
        ...config,
        mcpServers: {
          ...config.mcpServers,
          [serverName]: currentServer,
        },
      };
      const serialized = JSON.stringify(nextConfig, null, 2) + '\n';
      const svc = scanFiberTree();
      const uri = await resolveMcpConfigUri();
      let persisted = false;
      if (svc && typeof svc.writeFile === 'function' && uri) {
        const bytes = encodeUtf8(serialized);
        const writeRes = await writeFileToHost(svc, uri, bytes);
        if (!writeRes.ok) {
          return { ok: false, persisted: false, error: writeRes.error };
        }
        persisted = true;
      } else if (svc) {
        return {
          ok: false,
          persisted: false,
          error: !uri
            ? 'Could not resolve ~/.gemini/config/mcp_config.json path from host.'
            : 'Host file writer (writeFile) is not available in this session.',
        };
      }
      try {
        ls?.setItem?.(STORAGE_FALLBACK_KEY, serialized);
        if (!svc) persisted = true;
      } catch {}
      if (svc && typeof svc.refreshMcpServers === 'function') {
        try {
          await svc.refreshMcpServers({ shallow: true, serverName });
        } catch {}
      }
      await fetchServerStates();
      return { ok: true, persisted, config: nextConfig };
    });
  }

  async function revealConfigInExplorer() {
    scanFiberTree();
    const uri = await resolveMcpConfigUri();
    if (cachedElectronNative && typeof cachedElectronNative.revealInFilePicker === 'function' && uri) {
      try {
        await cachedElectronNative.revealInFilePicker(uri);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message || 'Failed to open file explorer.' };
      }
    }
    return { ok: false, error: 'File explorer reveal is not available in this environment.' };
  }

  function getLastKnownStates() {
    return lastKnownStates;
  }

  function setCustomConfigUriOverride(newPathOrUri) {
    if (!newPathOrUri || !String(newPathOrUri).trim()) {
      try {
        ls?.removeItem?.(STORAGE_URI_OVERRIDE_KEY);
      } catch {}
      resolvedConfigUri = null;
      return null;
    }
    const uri = toFileUriFromFsPath(String(newPathOrUri).trim());
    try {
      ls?.setItem?.(STORAGE_URI_OVERRIDE_KEY, uri);
    } catch {}
    resolvedConfigUri = uri;
    return uri;
  }

  let cachedHostPluginInfo = null;
  async function fetchHostInstalledPluginInfo(forceRefresh = false) {
    if (cachedHostPluginInfo && !forceRefresh) return cachedHostPluginInfo;
    const svc = scanFiberTree() || getRemoteControlProxyAdapter();
    if (!svc) return null;

    let geminiRoot = null;
    const extractRoot = (rawPath) => {
      if (!rawPath || typeof rawPath !== 'string') return null;
      const fsPath = toFsPathFromFileUri(rawPath);
      const norm = fsPath.replace(/\\/g, '/');
      const normWithSlash = norm.endsWith('/') ? norm : `${norm}/`;
      const idx = normWithSlash.indexOf('/.gemini/');
      if (idx === -1) return null;
      return normWithSlash.slice(0, idx + '/.gemini'.length);
    };

    try {
      const cfgUri = await resolveMcpConfigUri();
      if (cfgUri) {
        geminiRoot = extractRoot(cfgUri);
      }
    } catch {}

    const pluginNames = new Set();
    if (typeof svc.getAllPlugins === 'function') {
      try {
        const plRes = await svc.getAllPlugins({});
        const plugins = Array.isArray(plRes)
          ? plRes
          : (Array.isArray(plRes?.plugins) ? plRes.plugins : []);
        for (const p of plugins) {
          if (p?.name) pluginNames.add(String(p.name));
          const pPath = p?.path || p?.uri || '';
          if (!geminiRoot && pPath) {
            const r = extractRoot(pPath);
            if (r) geminiRoot = r;
          }
        }
      } catch {}
    }

    if (typeof svc.getCustomizationStates === 'function') {
      try {
        const st = await svc.getCustomizationStates([]);
        const items = Array.isArray(st) ? st : (Array.isArray(st?.states) ? st.states : (Array.isArray(st?.items) ? st.items : []));
        for (const item of items) {
          const p = item?.path || item?.uri || item?.skillItem?.path || item?.ruleItem?.path || item?.pluginItem?.path || '';
          if (p.includes('ko-thought-translator')) pluginNames.add('ko-thought-translator');
          if (p.includes('antigravity-statusbar')) pluginNames.add('antigravity-statusbar');
          if (p.includes('antigravity-mcp-manager')) pluginNames.add('antigravity-mcp-manager');
          if (!geminiRoot) {
            const r = extractRoot(p);
            if (r) geminiRoot = r;
          }
        }
      } catch {}
    }

    if (!geminiRoot && typeof svc.getAllSkills === 'function') {
      try {
        const skRes = await svc.getAllSkills([]);
        const skills = Array.isArray(skRes) ? skRes : (Array.isArray(skRes?.skills) ? skRes.skills : []);
        for (const sk of skills) {
          const p = sk?.path || sk?.uri || '';
          if (p.includes('ko-thought-translator')) pluginNames.add('ko-thought-translator');
          if (!geminiRoot) {
            const r = extractRoot(p);
            if (r) geminiRoot = r;
          }
        }
      } catch {}
    }

    if (!geminiRoot) {
      const rcSelected = svc?.rcInst?.localUserInfo?.selectedGeminiDir || '';
      if (rcSelected) {
        geminiRoot = extractRoot(rcSelected);
      }
    }

    if (!geminiRoot) {
      if (pluginNames.size > 0) {
        return {
          resolved: false,
          geminiRoot: null,
          autoinjectUri: null,
          hasStatusbar: pluginNames.has('antigravity-statusbar'),
          hasMcpManager: pluginNames.has('antigravity-mcp-manager'),
          hasKoTranslator: pluginNames.has('ko-thought-translator'),
          statusbarBlock: '',
          mcpBlock: '',
          koBlock: '',
        };
      }
      return null;
    }

    const autoinjectUri = toFileUriFromFsPath(`${geminiRoot}/antigravity/statusbar_autoinject.js`);
    if (!autoinjectUri) return null;

    let text = '';
    if (typeof svc.readFile === 'function') {
      try {
        let res = null;
        try {
          res = await svc.readFile({ uri: autoinjectUri });
        } catch {
          res = await svc.readFile(autoinjectUri);
        }
        const rawBytes = res instanceof Uint8Array || ArrayBuffer.isView(res) ? res : res?.content;
        text = typeof res === 'string'
          ? res
          : (rawBytes && rawBytes.length > 0 ? decodeUtf8(rawBytes) : '');
      } catch {}
    }

    if (!text) {
      if (pluginNames.size > 0) {
        return {
          resolved: false,
          geminiRoot,
          autoinjectUri,
          hasStatusbar: pluginNames.has('antigravity-statusbar'),
          hasMcpManager: pluginNames.has('antigravity-mcp-manager'),
          hasKoTranslator: pluginNames.has('ko-thought-translator'),
          statusbarBlock: '',
          mcpBlock: '',
          koBlock: '',
        };
      }
      return null;
    }

    const manifest = parseAutoinjectCompanionManifest(text, pluginNames);
    cachedHostPluginInfo = {
      resolved: true,
      geminiRoot,
      autoinjectUri,
      ...manifest,
    };
    return cachedHostPluginInfo;
  }

  return {
    scanFiberTree,
    resolveMcpConfigUri,
    readMcpConfig,
    writeMcpConfig,
    fetchServerStates,
    getMcpServerStates,
    refreshServers,
    completeOAuth,
    disconnectOAuth,
    openAuthUrl,
    waitForServerOAuthOrReady,
    applyAuthHeadersToServers,
    toggleServerEnabled,
    upsertCustomServer,
    deleteCustomServer,
    toggleServerTool,
    revealConfigInExplorer,
    getLastKnownStates,
    setCustomConfigUriOverride,
    fetchHostInstalledPluginInfo,
    resolveRemoteControlInstance,
    toFsPathFromFileUri,
    hostConfig: resolvedHostConfig,
    dispose() {
      runtimeLease.release();
      try {
        if (win) {
          delete win.__agyProbingRcInstance;
          if (!win.agyStatusBar) {
            delete win.__agyCapturedLsClient;
          }
        }
        if (doc) {
          delete doc.__agyMcpLastDfsTs;
        }
      } catch {}
    },
  };
}

module.exports = {
  toFileUriFromFsPath,
  toFsPathFromFileUri,
  extractGeminiConfigUriFromPath,
  normalizeAuthorizationCode,
  createHostMcpBridge,
};
