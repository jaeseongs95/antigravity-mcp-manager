'use strict';

const { normalizeMcpConfigObject } = require('./mcp-config-schema');

const STORAGE_FALLBACK_KEY = 'agy-custom-mcp-config-backup-v1';
const STORAGE_URI_OVERRIDE_KEY = 'agy-custom-mcp-config-uri-v1';

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
  const ls = opts.localStorage || (win && win.localStorage ? win.localStorage : null);
  let cachedService = opts.hostService || null;
  let cachedConfigDirUri = null;
  let cachedElectronNative = null;
  let resolvedConfigUri = null;
  let lastKnownStates = [];

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

  function getRemoteControlProxyAdapter() {
    try {
      const candidateWins = [win, win?.parent !== win ? win?.parent : null].filter(Boolean);
      for (const w of candidateWins) {
        let rcInst = w.__agyRemoteControlInstance && !w.__agyRemoteControlInstance.destroyed
          ? w.__agyRemoteControlInstance
          : null;
        if (!rcInst && w.document) {
          const rcEl = w.document.querySelector?.('ga-remote-control');
          const ctx = rcEl?.__ngContext__;
          if (ctx && typeof ctx === 'object') {
            const list = Array.isArray(ctx) ? ctx : (Array.isArray(ctx.lView) ? ctx.lView : [ctx.component, ctx]);
            for (const item of list) {
              if (item && typeof item === 'object' && typeof item.proxyCommand === 'function') {
                rcInst = item;
                w.__agyRemoteControlInstance = item;
                break;
              }
            }
          }
        }
        if (rcInst && typeof rcInst.proxyCommand === 'function') {
          const callRpc = async (rpcPath, reqObj) => {
            const bytes = new TextEncoder().encode(JSON.stringify(reqObj || {}));
            const res = await rcInst.proxyCommand(rpcPath, bytes);
            if (!res || !res.payload) return {};
            const text = new TextDecoder().decode(res.payload);
            return text ? JSON.parse(text) : {};
          };
          return {
            __isRcProxyAdapter: true,
            async getMcpServerStates() {
              return await callRpc('/exa.language_server_pb.LanguageServerService/GetMcpServerStates', {});
            },
            async refreshMcpServers(req) {
              return await callRpc('/exa.language_server_pb.LanguageServerService/RefreshMcpServers', req || {});
            },
            async toggleMcpServer(req) {
              return await callRpc('/exa.language_server_pb.LanguageServerService/ToggleMcpServer', req || {});
            },
            async completeMcpOAuth(serverName, authorizationCode) {
              return await callRpc('/exa.language_server_pb.LanguageServerService/CompleteMcpOAuth', {
                serverName: String(serverName),
                authorizationCode: String(authorizationCode),
              });
            },
            async disconnectMcpOAuth(serverName, account) {
              return await callRpc('/exa.language_server_pb.LanguageServerService/DisconnectMcpOAuth', {
                serverName: String(serverName),
                account: String(account || ''),
              });
            },
            async getStandaloneDir() {
              return await callRpc('/exa.language_server_pb.LanguageServerService/GetStandaloneDir', {});
            },
            async getCustomizationStates() {
              return await callRpc('/exa.language_server_pb.LanguageServerService/GetCustomizationStates', {});
            },
            async getLocalUserInfo() {
              return await callRpc('/exa.language_server_pb.LanguageServerService/GetLocalUserInfo', {});
            },
            async readFile(req) {
              const r = await callRpc('/exa.language_server_pb.LanguageServerService/ReadFile', { uri: req?.uri });
              if (r && typeof r.content === 'string') {
                return { content: decodeBase64ToBytes(r.content) };
              }
              return r;
            },
            async writeFile(req) {
              const contentB64 = bytesIsUint8(req?.content) ? encodeBytesToBase64(req.content) : (req?.content || '');
              return await callRpc('/exa.language_server_pb.LanguageServerService/WriteFile', {
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

        // 1. Walk up `.return` chain first (fast path when starting from conversation-view or settings-modal-container)
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

        // 2. Bounded DFS down `.child` / `.sibling` when starting from root container
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

    // Try deriving from already loaded MCP server states (`spec.configPath` or `spec.pluginRoot`)
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

    // Try deriving from `getStandaloneDir()` (`<home>/.gemini/antigravity/scratch`)
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

    // Try deriving from `getLocalUserInfo()` (`homeDirUri` or `homeDir`)
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

    // Try deriving from `getCustomizationStates()`
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

    // Fallback to environment variables if available in preload/node context
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
        if (res?.content && res.content.length > 0) {
          const text = new TextDecoder().decode(res.content);
          if (text.trim()) {
            const norm = normalizeMcpConfigObject(text);
            if (norm.ok) {
              try {
                ls?.setItem?.(STORAGE_FALLBACK_KEY, JSON.stringify(norm.config));
              } catch {}
              return { config: norm.config, uri, fsPath: toFsPathFromFileUri(uri), error: null };
            }
            return {
              config: { mcpServers: {} },
              uri,
              fsPath: toFsPathFromFileUri(uri),
              error: norm.error,
            };
          }
        }
        return { config: { mcpServers: {} }, uri, fsPath: toFsPathFromFileUri(uri), error: null };
      } catch {
        // File might not exist yet — treat as empty `{ mcpServers: {} }`
        return { config: { mcpServers: {} }, uri, fsPath: toFsPathFromFileUri(uri), error: null };
      }
    }

    // Fallback to localStorage backup when in pure web mock / test sandbox without readFile
    try {
      const raw = ls?.getItem?.(STORAGE_FALLBACK_KEY);
      if (raw) {
        const norm = normalizeMcpConfigObject(raw);
        if (norm.ok) {
          return {
            config: norm.config,
            uri: uri || 'localStorage://mcp_config.json',
            fsPath: toFsPathFromFileUri(uri) || '~/.gemini/config/mcp_config.json',
            error: null,
          };
        }
      }
    } catch {}

    return {
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
      const bytes = new TextEncoder().encode(serialized);
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
      // Native Antigravity `lB().completeMcpOAuth(serverName, authorizationCode)` takes 2 positional strings!
      // Passing an object as first argument causes:
      // `[internal] cannot encode field exa.language_server_pb.CompleteMcpOAuthRequest.server_name to JSON: expected string, got object`
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
      // Native Antigravity `lB().disconnectMcpOAuth(serverName, account)` takes 2 positional strings!
      await svc.disconnectMcpOAuth(String(cleanName), String(account || ''));
      await refreshServers(cleanName);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || `Failed to disconnect OAuth for "${cleanName}".` };
    }
  }

  function openAuthUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      if (win && typeof win.open === 'function') {
        win.open(url, '_blank', 'noopener,noreferrer');
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
    const { config } = await readMcpConfig();
    const nextServers = { ...(config.mcpServers || {}) };
    const names = Array.isArray(serverNames) && serverNames.length > 0
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
    const svc = scanFiberTree();
    if (svc && typeof svc.toggleMcpServer === 'function') {
      try {
        await svc.toggleMcpServer({ serverName, enabled: Boolean(enabled) });
      } catch (e) {
        return { ok: false, error: e?.message || `Failed to toggle MCP server "${serverName}".` };
      }
    }
    // Also persist `disabled` flag in mcp_config.json if this server is a custom server
    const { config } = await readMcpConfig();
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
      await writeMcpConfig(nextConfig, serverName);
    }
    return fetchServerStates();
  }

  async function upsertCustomServer(serverName, spec, previousName = null) {
    const { config } = await readMcpConfig();
    const nextServers = { ...(config.mcpServers || {}) };
    if (previousName && previousName !== serverName && nextServers[previousName]) {
      delete nextServers[previousName];
    }
    nextServers[serverName] = spec;
    return writeMcpConfig({ ...config, mcpServers: nextServers }, serverName);
  }

  async function deleteCustomServer(serverName) {
    const { config } = await readMcpConfig();
    const nextServers = { ...(config.mcpServers || {}) };
    if (!(serverName in nextServers)) {
      return { ok: false, error: `Custom server "${serverName}" was not found in mcp_config.json.` };
    }
    delete nextServers[serverName];
    return writeMcpConfig({ ...config, mcpServers: nextServers }, serverName);
  }

  async function toggleServerTool(serverName, toolName, enabled) {
    const { config } = await readMcpConfig();
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
    const svc = scanFiberTree();
    const uri = await resolveMcpConfigUri();
    let persisted = false;
    if (svc && typeof svc.writeFile === 'function' && uri) {
      const bytes = new TextEncoder().encode(JSON.stringify(nextConfig, null, 2) + '\n');
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
      ls?.setItem?.(STORAGE_FALLBACK_KEY, JSON.stringify(nextConfig, null, 2));
    } catch {}
    if (svc && typeof svc.refreshMcpServers === 'function') {
      try {
        await svc.refreshMcpServers({ shallow: true, serverName });
      } catch {}
    }
    await fetchServerStates();
    return { ok: true, persisted, config: nextConfig };
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
    const svc = scanFiberTree();
    if (!svc || typeof svc.readFile !== 'function') return null;

    let geminiRoot = null;
    const extractRoot = (rawPath) => {
      if (!rawPath || typeof rawPath !== 'string') return null;
      const norm = rawPath.replace(/\\/g, '/');
      const idx = norm.indexOf('/.gemini/');
      if (idx === -1) return null;
      return norm.slice(0, idx + '/.gemini'.length);
    };

    try {
      const cfgUri = await resolveMcpConfigUri();
      if (cfgUri) {
        geminiRoot = extractRoot(toFsPathFromFileUri(cfgUri));
      }
    } catch {}

    if (!geminiRoot && typeof svc.getCustomizationStates === 'function') {
      try {
        const st = await svc.getCustomizationStates([]);
        const items = Array.isArray(st) ? st : (Array.isArray(st?.states) ? st.states : (Array.isArray(st?.items) ? st.items : []));
        for (const item of items) {
          const p = item?.path || item?.uri || item?.skillItem?.path || item?.ruleItem?.path || item?.pluginItem?.path || '';
          const r = extractRoot(p);
          if (r) {
            geminiRoot = r;
            break;
          }
        }
      } catch {}
    }

    if (!geminiRoot) return null;

    const autoinjectUri = toFileUriFromFsPath(`${geminiRoot}/antigravity/statusbar_autoinject.js`);
    if (!autoinjectUri) return null;

    try {
      let res = null;
      try {
        res = await svc.readFile({ uri: autoinjectUri });
      } catch {
        res = await svc.readFile(autoinjectUri);
      }
      const rawBytes = res instanceof Uint8Array || ArrayBuffer.isView(res) ? res : res?.content;
      const text = typeof res === 'string'
        ? res
        : (rawBytes && rawBytes.length > 0 ? new TextDecoder().decode(rawBytes) : '');
      if (!text) return null;

      const mcpBeginLine = '// === ' + ['BEGIN_AGY_MCP', 'MANAGER_V1'].join('_') + ' ===';
      const mcpEndLine = '// === ' + ['END_AGY_MCP', 'MANAGER_V1'].join('_') + ' ===';
      const mcpBeginBlock = '/* === ' + ['BEGIN_AGY_MCP', 'MANAGER_V1'].join('_') + ' === */';
      const mcpEndBlock = '/* === ' + ['END_AGY_MCP', 'MANAGER_V1'].join('_') + ' === */';
      const koBeginLine = '// === ' + ['BEGIN_AGY_KO', 'THOUGHT_LOCALIZER_V2'].join('_') + ' ===';
      const koEndLine = '// === ' + ['END_AGY_KO', 'THOUGHT_LOCALIZER_V2'].join('_') + ' ===';
      const koBeginBlock = '/* === ' + ['BEGIN_AGY_KO', 'THOUGHT_LOCALIZER_V2'].join('_') + ' === */';
      const koEndBlock = '/* === ' + ['END_AGY_KO', 'THOUGHT_LOCALIZER_V2'].join('_') + ' === */';

      const mcpBeginMarker = text.includes(mcpBeginBlock) ? mcpBeginBlock : mcpBeginLine;
      const mcpEndMarker = text.includes(mcpEndBlock) ? mcpEndBlock : mcpEndLine;
      const koBeginMarker = text.includes(koBeginBlock) ? koBeginBlock : koBeginLine;
      const koEndMarker = text.includes(koEndBlock) ? koEndBlock : koEndLine;

      const mcpB = text.indexOf(mcpBeginMarker);
      const mcpE = text.indexOf(mcpEndMarker);
      const koB = text.indexOf(koBeginMarker);
      const koE = text.indexOf(koEndMarker);

      const firstMarkerIdx = [mcpB, koB].filter((i) => i !== -1).sort((a, b) => a - b)[0] ?? text.length;
      const baseSegment = text.slice(0, firstMarkerIdx).trim();

      const hasStatusbar = baseSegment.includes('mountStatusBar') || baseSegment.includes('agyStatusBar');
      const hasMcpManager = (mcpB !== -1 && mcpE > mcpB) || text.includes('mountMcpManager');
      const hasKoTranslator = (koB !== -1 && koE > koB) || text.includes('__agyKoThoughtCleanup');

      cachedHostPluginInfo = {
        geminiRoot,
        autoinjectUri,
        hasStatusbar,
        hasMcpManager,
        hasKoTranslator,
        statusbarBlock: hasStatusbar ? baseSegment : '',
        mcpBlock: mcpB !== -1 && mcpE > mcpB ? text.slice(mcpB, mcpE + mcpEndMarker.length) : '',
        koBlock: koB !== -1 && koE > koB ? text.slice(koB, koE + koEndMarker.length) : '',
      };
      return cachedHostPluginInfo;
    } catch {
      return null;
    }
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
    toFsPathFromFileUri,
  };
}

module.exports = {
  toFileUriFromFsPath,
  toFsPathFromFileUri,
  extractGeminiConfigUriFromPath,
  normalizeAuthorizationCode,
  createHostMcpBridge,
};
