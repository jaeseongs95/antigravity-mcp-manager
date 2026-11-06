// ==UserScript==
// @name         Antigravity Custom MCP Server Manager
// @namespace    https://github.com/jaeseongs95/antigravity-mcp-manager
// @version      1.0.0
// @description  Add, edit, toggle, and manage custom Stdio & HTTP MCP servers (mcp_config.json) directly inside the Antigravity 2.0 native app.
// @match        https://antigravity.google.com/*
// @match        https://*.antigravity.google.com/*
// @match        https://127.0.0.1/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(() => {
  'use strict';
  const __modules = {
  "./mcp-config-schema": function(module, exports, __require) {
    const require = (spec) => __require(".", spec);
    'use strict';

    const QUICK_TEMPLATES = [
      {
        id: 'filesystem',
        label: '📁 Filesystem',
        transport: 'stdio',
        serverName: 'filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:/workspace'],
        env: {},
        description: 'Local directory read/write/search access via official MCP Filesystem server.',
      },
      {
        id: 'memory',
        label: '🧠 Memory',
        transport: 'stdio',
        serverName: 'memory',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: {},
        description: 'Persistent knowledge graph memory server.',
      },
      {
        id: 'fetch',
        label: '🌐 Fetch',
        transport: 'stdio',
        serverName: 'fetch',
        command: 'uvx',
        args: ['mcp-server-fetch'],
        env: {},
        description: 'Web page fetching and HTML-to-markdown conversion.',
      },
      {
        id: 'github',
        label: '🐙 GitHub',
        transport: 'stdio',
        serverName: 'github',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: '<YOUR_GITHUB_TOKEN>',
        },
        description: 'GitHub repository, issue, PR, and search integration.',
      },
      {
        id: 'postgres',
        label: '🐘 PostgreSQL',
        transport: 'stdio',
        serverName: 'postgres',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost:5432/mydb'],
        env: {},
        description: 'Read-only schema inspection and SQL query execution for PostgreSQL.',
      },
      {
        id: 'sqlite',
        label: '🗄️ SQLite',
        transport: 'stdio',
        serverName: 'sqlite',
        command: 'uvx',
        args: ['mcp-server-sqlite', '--db-path', 'D:/data/database.db'],
        env: {},
        description: 'SQLite database query and business insight memo server.',
      },
      {
        id: 'playwright',
        label: '🎭 Playwright',
        transport: 'stdio',
        serverName: 'playwright',
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest'],
        env: {},
        description: 'Browser automation via Playwright MCP server.',
      },
      {
        id: 'remote-http',
        label: '☁️ Remote HTTP',
        transport: 'http',
        serverName: 'remote-service',
        url: 'https://mcp.example.com/mcp',
        headers: {},
        description: 'Streamable HTTP remote MCP endpoint (MCP spec 2025-03-26).',
      },
    ];

    function parseArgsInput(raw) {
      if (Array.isArray(raw)) {
        return raw.map((x) => String(x)).filter((x) => x.length > 0);
      }
      if (typeof raw !== 'string') return [];
      const trimmed = raw.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed.map((x) => String(x));
          }
        } catch {}
      }
      if (trimmed.includes('\n')) {
        return trimmed
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
      }
      // Tokenize respecting single/double quotes
      const tokens = [];
      const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
      let match;
      while ((match = re.exec(trimmed)) !== null) {
        tokens.push(match[1] ?? match[2] ?? match[3]);
      }
      return tokens;
    }

    function formatArgsForInput(args) {
      if (!Array.isArray(args) || args.length === 0) return '';
      return args.join('\n');
    }

    function parseKeyValueInput(raw) {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const out = {};
        for (const [k, v] of Object.entries(raw)) {
          if (k.trim() && v !== undefined && v !== null) {
            out[k.trim()] = String(v);
          }
        }
        return out;
      }
      if (typeof raw !== 'string') return {};
      const trimmed = raw.trim();
      if (!trimmed) return {};
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const out = {};
            for (const [k, v] of Object.entries(parsed)) {
              if (k.trim() && v !== undefined && v !== null) {
                out[k.trim()] = String(v);
              }
            }
            return out;
          }
        } catch {}
      }
      const out = {};
      const lines = trimmed.split(/\r?\n/);
      for (const line of lines) {
        const clean = line.trim();
        if (!clean || clean.startsWith('#')) continue;
        const eqIdx = clean.indexOf('=');
        const colonIdx = clean.indexOf(':');
        let sepIdx = -1;
        if (eqIdx !== -1 && (colonIdx === -1 || eqIdx < colonIdx)) {
          sepIdx = eqIdx;
        } else if (colonIdx !== -1) {
          sepIdx = colonIdx;
        }
        if (sepIdx > 0) {
          const key = clean.slice(0, sepIdx).trim();
          let val = clean.slice(sepIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (key) out[key] = val;
        }
      }
      return out;
    }

    function formatKeyValueForInput(obj, sep = '=') {
      if (!obj || typeof obj !== 'object') return '';
      const entries = Object.entries(obj);
      if (entries.length === 0) return '';
      return entries.map(([k, v]) => `${k}${sep}${v}`).join('\n');
    }

    function detectTransport(spec) {
      if (!spec || typeof spec !== 'object') return 'stdio';
      if (typeof spec.url === 'string' && spec.url.trim()) return 'http';
      if (typeof spec.serverUrl === 'string' && spec.serverUrl.trim()) return 'http';
      return 'stdio';
    }

    function validateAndBuildServerSpec({
      serverName,
      transport,
      command,
      args,
      argsText,
      env,
      envText,
      cwd,
      url,
      headers,
      headersText,
      disabled,
      existingSpec,
    }) {
      const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
      if (!cleanName) {
        return { ok: false, error: 'Server name is required (e.g. "filesystem" or "my-mcp-server").' };
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(cleanName)) {
        return {
          ok: false,
          error: 'Server name may only contain letters, numbers, hyphens (-), underscores (_), and dots (.).',
        };
      }

      const base = existingSpec && typeof existingSpec === 'object' ? { ...existingSpec } : {};
      delete base.command;
      delete base.args;
      delete base.env;
      delete base.cwd;
      delete base.url;
      delete base.serverUrl;
      delete base.headers;
      delete base.disabled;

      if (transport === 'http') {
        const cleanUrl = typeof url === 'string' ? url.trim() : '';
        if (!cleanUrl) {
          return { ok: false, error: 'Remote MCP Server URL is required for Streamable HTTP transport.' };
        }
        if (!/^https?:\/\/.+/i.test(cleanUrl)) {
          return { ok: false, error: 'Remote MCP Server URL must start with http:// or https://.' };
        }
        const parsedHeaders = parseKeyValueInput(headers !== undefined ? headers : headersText);
        const spec = {
          ...base,
          url: cleanUrl,
        };
        if (Object.keys(parsedHeaders).length > 0) {
          spec.headers = parsedHeaders;
        }
        if (disabled) {
          spec.disabled = true;
        }
        return { ok: true, serverName: cleanName, spec };
      }

      const cleanCmd = typeof command === 'string' ? command.trim() : '';
      if (!cleanCmd) {
        return { ok: false, error: 'Executable command is required for Stdio transport (e.g. "npx", "node", "uvx").' };
      }
      const parsedArgs = parseArgsInput(args !== undefined ? args : argsText);
      const parsedEnv = parseKeyValueInput(env !== undefined ? env : envText);
      const cleanCwd = typeof cwd === 'string' ? cwd.trim() : '';

      const spec = {
        ...base,
        command: cleanCmd,
      };
      if (parsedArgs.length > 0) {
        spec.args = parsedArgs;
      }
      if (Object.keys(parsedEnv).length > 0) {
        spec.env = parsedEnv;
      }
      if (cleanCwd) {
        spec.cwd = cleanCwd;
      }
      if (disabled) {
        spec.disabled = true;
      }
      return { ok: true, serverName: cleanName, spec };
    }

    function normalizeMcpConfigObject(raw) {
      let parsed = raw;
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) {
          return { ok: true, config: { mcpServers: {} } };
        }
        try {
          parsed = JSON.parse(trimmed);
        } catch (e) {
          return { ok: false, error: `Invalid JSON: ${e.message}` };
        }
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'MCP config root must be a JSON object.' };
      }

      // Support pasting either `{ "mcpServers": { ... } }` or direct `{ "my-server": { "command": "..." } }`
      let serversMap = parsed.mcpServers;
      if (!serversMap || typeof serversMap !== 'object' || Array.isArray(serversMap)) {
        const keys = Object.keys(parsed);
        const looksLikeDirectServerMap =
          keys.length > 0 &&
          keys.every(
            (k) =>
              parsed[k] &&
              typeof parsed[k] === 'object' &&
              !Array.isArray(parsed[k]) &&
              (typeof parsed[k].command === 'string' ||
                typeof parsed[k].url === 'string' ||
                typeof parsed[k].serverUrl === 'string')
          );
        if (looksLikeDirectServerMap) {
          serversMap = parsed;
          parsed = { mcpServers: serversMap };
        } else if (parsed.mcpServers === undefined) {
          parsed = { ...parsed, mcpServers: {} };
        } else {
          return { ok: false, error: '"mcpServers" must be a JSON object mapping server names to configurations.' };
        }
      }

      for (const [name, spec] of Object.entries(parsed.mcpServers)) {
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
          return { ok: false, error: `Server "${name}" configuration must be a JSON object.` };
        }
        const hasCmd = typeof spec.command === 'string' && spec.command.trim().length > 0;
        const hasUrl =
          (typeof spec.url === 'string' && spec.url.trim().length > 0) ||
          (typeof spec.serverUrl === 'string' && spec.serverUrl.trim().length > 0);
        if (!hasCmd && !hasUrl) {
          return {
            ok: false,
            error: `Server "${name}" must specify either "command" (Stdio) or "url" (Streamable HTTP).`,
          };
        }
      }

      return { ok: true, config: parsed };
    }

    module.exports = {
      QUICK_TEMPLATES,
      parseArgsInput,
      formatArgsForInput,
      formatArgsForEditor: formatArgsForInput,
      parseKeyValueInput,
      formatKeyValueForInput,
      formatKeyValueForEditor: formatKeyValueForInput,
      detectTransport,
      validateAndBuildServerSpec,
      normalizeMcpConfigObject,
    };

  },
  "./host-mcp-bridge": function(module, exports, __require) {
    const require = (spec) => __require(".", spec);
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

      function scanFiberTree() {
        if (cachedService && typeof cachedService.getMcpServerStates === 'function') {
          return cachedService;
        }
        const docs = [doc, getAccessibleRemoteIframeDoc()].filter(Boolean);
        for (const d of docs) {
          const roots = [
            d.querySelector?.('#root'),
            d.querySelector?.('#app'),
            d.querySelector?.('[data-testid="conversation-view"]'),
            d.body?.firstElementChild,
            d.body,
          ].filter(Boolean);

          for (const rootEl of roots) {
            const fk = Object.keys(rootEl).find(
              (k) => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$')
            );
            const startFiber = fk ? rootEl[fk] : null;
            if (!startFiber) continue;

            // 1. Walk up `.return` chain first (fast path when starting from conversation-view)
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
            if (cachedService) return cachedService;

            // 2. Bounded DFS down `.child` / `.sibling` when starting from root container
            const stack = [startFiber];
            const visited = new Set();
            while (stack.length > 0 && visited.size < 3500) {
              const f = stack.pop();
              if (!f || visited.has(f)) continue;
              visited.add(f);

              inspectFiberValue(f.memoizedProps?.value);
              if (cachedService && cachedConfigDirUri) return cachedService;

              if (f.child) stack.push(f.child);
              if (f.sibling) stack.push(f.sibling);
            }
            if (cachedService) return cachedService;
          }
        }
        return cachedService;
      }

      function inspectFiberValue(val) {
        if (!val || typeof val !== 'object') return;
        if (
          !cachedService &&
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
            const fromStandalone = extractGeminiConfigUriFromPath(res?.standaloneDir);
            if (fromStandalone) {
              resolvedConfigUri = fromStandalone;
              return resolvedConfigUri;
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
        if (svc && typeof svc.writeFile === 'function' && uri) {
          try {
            const bytes = new TextEncoder().encode(serialized);
            await svc.writeFile({ uri, content: bytes, overwrite: true });
          } catch (e) {
            return { ok: false, error: `Failed to write mcp_config.json: ${e?.message || String(e)}` };
          }
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
        return { ok: true, config: norm.config, uri, fsPath: toFsPathFromFileUri(uri) };
      }

      async function fetchServerStates() {
        const svc = scanFiberTree();
        if (svc && typeof svc.getMcpServerStates === 'function') {
          try {
            const res = await svc.getMcpServerStates();
            const states = Array.isArray(res?.states) ? res.states : [];
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
        if (svc && typeof svc.writeFile === 'function' && uri) {
          const bytes = new TextEncoder().encode(JSON.stringify(nextConfig, null, 2) + '\n');
          await svc.writeFile({ uri, content: bytes, overwrite: true });
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
        return { ok: true, config: nextConfig };
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

      return {
        scanFiberTree,
        resolveMcpConfigUri,
        readMcpConfig,
        writeMcpConfig,
        fetchServerStates,
        refreshServers,
        toggleServerEnabled,
        upsertCustomServer,
        deleteCustomServer,
        toggleServerTool,
        revealConfigInExplorer,
        getLastKnownStates,
        setCustomConfigUriOverride,
        toFsPathFromFileUri,
      };
    }

    module.exports = {
      toFileUriFromFsPath,
      toFsPathFromFileUri,
      extractGeminiConfigUriFromPath,
      createHostMcpBridge,
    };

  },
  "./modal-ui": function(module, exports, __require) {
    const require = (spec) => __require(".", spec);
    'use strict';

    const {
      QUICK_TEMPLATES,
      validateAndBuildServerSpec,
      formatArgsForEditor,
      formatKeyValueForEditor,
      normalizeMcpConfigObject,
    } = require('./mcp-config-schema');

    const MODAL_ID = 'agy-mcp-manager-modal-backdrop';
    const STYLE_ID = 'agy-mcp-manager-styles';

    function ensureModalStyles(doc) {
      if (!doc || doc.getElementById(STYLE_ID)) return;
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        #${MODAL_ID} {
          position: fixed;
          inset: 0;
          z-index: 2147483645;
          background: rgba(9, 11, 17, 0.72);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif;
          color: #e4e7ef;
          padding: 20px;
          box-sizing: border-box;
        }
        #${MODAL_ID} * {
          box-sizing: border-box;
        }
        .agy-mcp-dialog {
          width: min(860px, 96vw);
          max-height: min(760px, 90vh);
          background: #161821;
          border: 1px solid #2c3144;
          border-radius: 12px;
          box-shadow: 0 22px 60px rgba(0, 0, 0, 0.65);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .agy-mcp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          background: #1c1f2b;
          border-bottom: 1px solid #282d3f;
        }
        .agy-mcp-title-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .agy-mcp-title {
          font-size: 15px;
          font-weight: 600;
          color: #f3f5fa;
          margin: 0;
        }
        .agy-mcp-badge {
          font-size: 11px;
          padding: 2px 7px;
          border-radius: 999px;
          background: rgba(99, 102, 241, 0.18);
          color: #a5b4fc;
          border: 1px solid rgba(99, 102, 241, 0.35);
        }
        .agy-mcp-close-btn {
          background: transparent;
          border: 1px solid transparent;
          color: #9aa2b8;
          font-size: 16px;
          width: 28px;
          height: 28px;
          border-radius: 6px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .agy-mcp-close-btn:hover {
          background: #272b3b;
          color: #ffffff;
        }
        .agy-mcp-tabs {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 18px;
          background: #191c26;
          border-bottom: 1px solid #262a3b;
        }
        .agy-mcp-tab {
          background: transparent;
          border: 1px solid transparent;
          color: #9aa2b8;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .agy-mcp-tab:hover {
          color: #e4e7ef;
          background: rgba(255, 255, 255, 0.04);
        }
        .agy-mcp-tab.active {
          color: #ffffff;
          background: #272c3f;
          border-color: #3b425e;
        }
        .agy-mcp-tab-spacer {
          flex: 1;
        }
        .agy-mcp-status-banner {
          padding: 8px 18px;
          font-size: 12px;
          border-bottom: 1px solid #262a3b;
          display: none;
        }
        .agy-mcp-status-banner.info {
          display: block;
          background: rgba(59, 130, 246, 0.14);
          color: #93c5fd;
        }
        .agy-mcp-status-banner.success {
          display: block;
          background: rgba(16, 185, 129, 0.14);
          color: #6ee7b7;
        }
        .agy-mcp-status-banner.error {
          display: block;
          background: rgba(239, 68, 68, 0.16);
          color: #fca5a5;
        }
        .agy-mcp-body {
          padding: 16px 18px;
          overflow-y: auto;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .agy-mcp-btn {
          background: #262b3d;
          color: #e4e7ef;
          border: 1px solid #383f58;
          border-radius: 6px;
          padding: 6px 11px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .agy-mcp-btn:hover {
          background: #30374f;
          border-color: #4a5373;
        }
        .agy-mcp-btn.primary {
          background: #4f46e5;
          border-color: #6366f1;
          color: #ffffff;
        }
        .agy-mcp-btn.primary:hover {
          background: #4338ca;
        }
        .agy-mcp-btn.danger {
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.4);
          color: #fca5a5;
        }
        .agy-mcp-btn.danger:hover {
          background: rgba(239, 68, 68, 0.28);
        }
        .agy-mcp-card {
          background: #1d202d;
          border: 1px solid #2b3042;
          border-radius: 8px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .agy-mcp-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }
        .agy-mcp-card-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .agy-mcp-server-name {
          font-size: 13.5px;
          font-weight: 600;
          color: #f3f5fa;
        }
        .agy-mcp-pill {
          font-size: 10.5px;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
          text-transform: uppercase;
        }
        .agy-mcp-pill.ready {
          background: rgba(16, 185, 129, 0.18);
          color: #6ee7b7;
          border: 1px solid rgba(16, 185, 129, 0.35);
        }
        .agy-mcp-pill.pending {
          background: rgba(245, 158, 11, 0.18);
          color: #fcd34d;
          border: 1px solid rgba(245, 158, 11, 0.35);
        }
        .agy-mcp-pill.error {
          background: rgba(239, 68, 68, 0.18);
          color: #fca5a5;
          border: 1px solid rgba(239, 68, 68, 0.35);
        }
        .agy-mcp-pill.disabled {
          background: rgba(148, 163, 184, 0.15);
          color: #94a3b8;
          border: 1px solid rgba(148, 163, 184, 0.3);
        }
        .agy-mcp-pill.source-custom {
          background: rgba(99, 102, 241, 0.18);
          color: #c7d2fe;
          border: 1px solid rgba(99, 102, 241, 0.35);
        }
        .agy-mcp-pill.source-plugin {
          background: rgba(14, 165, 233, 0.15);
          color: #7dd3fc;
          border: 1px solid rgba(14, 165, 233, 0.3);
        }
        .agy-mcp-cmd-preview {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11.5px;
          color: #9aa2b8;
          background: #141722;
          padding: 5px 8px;
          border-radius: 5px;
          border: 1px solid #232838;
          word-break: break-all;
        }
        .agy-mcp-tools-wrap {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-top: 2px;
        }
        .agy-mcp-tool-chip {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11px;
          padding: 2px 7px;
          border-radius: 4px;
          background: #252a3b;
          color: #cbd5e1;
          border: 1px solid #353c54;
          cursor: pointer;
        }
        .agy-mcp-tool-chip.disabled {
          opacity: 0.48;
          text-decoration: line-through;
          background: #191c27;
        }
        .agy-mcp-form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .agy-mcp-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .agy-mcp-field.full {
          grid-column: 1 / -1;
        }
        .agy-mcp-label {
          font-size: 12px;
          font-weight: 500;
          color: #cbd5e1;
        }
        .agy-mcp-hint {
          font-size: 11px;
          color: #828ca6;
        }
        .agy-mcp-input, .agy-mcp-textarea, .agy-mcp-select {
          width: 100%;
          background: #12151f;
          border: 1px solid #2d3348;
          border-radius: 6px;
          padding: 7px 10px;
          color: #f1f5f9;
          font-size: 12.5px;
          font-family: inherit;
        }
        .agy-mcp-textarea {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          min-height: 74px;
          resize: vertical;
        }
        .agy-mcp-input:focus, .agy-mcp-textarea:focus, .agy-mcp-select:focus {
          outline: none;
          border-color: #6366f1;
        }
        .agy-mcp-templates-bar {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .agy-mcp-template-chip {
          font-size: 11.5px;
          padding: 4px 9px;
          border-radius: 6px;
          background: #212638;
          border: 1px solid #323954;
          color: #d5dcf0;
          cursor: pointer;
        }
        .agy-mcp-template-chip:hover {
          background: #2b324a;
          border-color: #4f5980;
        }
        .agy-mcp-injected-native-btn {
          margin-left: 8px;
          background: #4f46e5;
          color: #ffffff;
          border: 1px solid #6366f1;
          border-radius: 6px;
          padding: 5px 10px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .agy-mcp-injected-native-btn:hover {
          background: #4338ca;
        }
      `;
      doc.head.appendChild(style);
    }

    function statusPillInfo(statusCode, isDisabled) {
      if (isDisabled || statusCode === 4) {
        return { label: 'DISABLED', cls: 'disabled' };
      }
      if (statusCode === 2) {
        return { label: 'READY', cls: 'ready' };
      }
      if (statusCode === 1) {
        return { label: 'PENDING', cls: 'pending' };
      }
      if (statusCode === 3) {
        return { label: 'ERROR', cls: 'error' };
      }
      return { label: 'CONFIGURED', cls: 'pending' };
    }

    function formatSpecPreview(spec) {
      if (!spec || typeof spec !== 'object') return '(managed by plugin)';
      if (spec.url || spec.serverUrl) {
        return `HTTP ${spec.url || spec.serverUrl}`;
      }
      const cmd = spec.command || '';
      const args = Array.isArray(spec.args) ? spec.args.join(' ') : '';
      return `${cmd} ${args}`.trim() || '(empty command)';
    }

    function createModalController({ doc, bridge, onStateChanged }) {
      let activeTab = 'servers'; // 'servers' | 'editor' | 'raw'
      let editingForm = {
        originalName: '',
        serverName: '',
        transport: 'stdio',
        command: 'npx',
        argsText: '',
        envText: '',
        cwd: '',
        url: '',
        headersText: '',
        disabled: false,
      };
      let cachedConfig = { uri: '', rawText: '{\n  "mcpServers": {}\n}\n', config: { mcpServers: {} } };
      let cachedStates = [];
      let bannerState = { type: '', message: '' };

      function setBanner(type, message) {
        bannerState = { type, message };
        renderBanner();
      }

      function renderBanner() {
        const backdrop = doc.getElementById(MODAL_ID);
        if (!backdrop) return;
        const banner = backdrop.querySelector('.agy-mcp-status-banner');
        if (!banner) return;
        banner.className = 'agy-mcp-status-banner';
        if (bannerState.type && bannerState.message) {
          banner.classList.add(bannerState.type);
          banner.textContent = bannerState.message;
        } else {
          banner.textContent = '';
        }
      }

      async function reloadData() {
        try {
          const [cfgResult, statesResult] = await Promise.all([
            bridge.readMcpConfig(),
            bridge.fetchServerStates(),
          ]);
          cachedConfig = cfgResult && cfgResult.config ? cfgResult : { uri: '', config: { mcpServers: {} } };
          const statesList = Array.isArray(statesResult)
            ? statesResult
            : (statesResult && Array.isArray(statesResult.states) ? statesResult.states : []);
          cachedStates = statesList;
          if (typeof onStateChanged === 'function') {
            onStateChanged({ config: cachedConfig.config, states: cachedStates });
          }
        } catch (err) {
          setBanner('error', `Failed to load MCP configuration: ${err.message || err}`);
        }
      }

      function populateFormFromSpec(serverName, spec) {
        const isHttp = Boolean(spec && (spec.url || spec.serverUrl || spec.type === 'http'));
        editingForm = {
          originalName: serverName || '',
          serverName: serverName || '',
          transport: isHttp ? 'http' : 'stdio',
          command: spec && spec.command ? spec.command : 'npx',
          argsText: formatArgsForEditor(spec && spec.args),
          envText: formatKeyValueForEditor(spec && spec.env, '='),
          cwd: spec && spec.cwd ? spec.cwd : '',
          url: (spec && (spec.url || spec.serverUrl)) || '',
          headersText: formatKeyValueForEditor(spec && spec.headers, ': '),
          disabled: Boolean(spec && spec.disabled),
        };
      }

      function resetForm() {
        populateFormFromSpec('', { command: 'npx', args: [], env: {} });
      }

      function renderServersTab(container) {
        const topActions = doc.createElement('div');
        topActions.style.display = 'flex';
        topActions.style.justifyContent = 'space-between';
        topActions.style.alignItems = 'center';
        topActions.style.flexWrap = 'wrap';
        topActions.style.gap = '8px';

        const summary = doc.createElement('div');
        summary.style.fontSize = '12.5px';
        summary.style.color = '#9aa2b8';
        const customNames = Object.keys((cachedConfig.config && cachedConfig.config.mcpServers) || {});
        summary.textContent = `Custom Servers: ${customNames.length} | Active Runtime States: ${cachedStates.length}`;
        topActions.appendChild(summary);

        const btnGroup = doc.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '6px';

        const refreshBtn = doc.createElement('button');
        refreshBtn.className = 'agy-mcp-btn';
        refreshBtn.textContent = '↻ Refresh All Servers';
        refreshBtn.addEventListener('click', async () => {
          setBanner('info', 'Refreshing MCP servers...');
          await bridge.refreshServers();
          await reloadData();
          setBanner('success', 'MCP servers refreshed.');
          renderBody();
        });

        const addBtn = doc.createElement('button');
        addBtn.className = 'agy-mcp-btn primary';
        addBtn.setAttribute('data-testid', 'agy-mcp-open-add-tab');
        addBtn.textContent = '+ Add Custom MCP Server';
        addBtn.addEventListener('click', () => {
          resetForm();
          activeTab = 'editor';
          renderModalContent();
        });

        btnGroup.appendChild(refreshBtn);
        btnGroup.appendChild(addBtn);
        topActions.appendChild(btnGroup);
        container.appendChild(topActions);

        const customMap = (cachedConfig.config && cachedConfig.config.mcpServers) || {};
        const stateByName = new Map();
        for (const st of cachedStates) {
          if (st && st.serverName) {
            stateByName.set(st.serverName, st);
          }
        }

        const allServerNames = Array.from(
          new Set([...Object.keys(customMap), ...Array.from(stateByName.keys())])
        );

        if (allServerNames.length === 0) {
          const empty = doc.createElement('div');
          empty.className = 'agy-mcp-card';
          empty.style.textAlign = 'center';
          empty.style.padding = '28px 16px';
          empty.style.color = '#9aa2b8';
          empty.textContent = 'No custom MCP servers configured yet. Click "+ Add Custom MCP Server" to register a local Stdio or remote HTTP MCP server.';
          container.appendChild(empty);
          return;
        }

        for (const name of allServerNames) {
          const customSpec = customMap[name] || null;
          const runtimeState = stateByName.get(name) || null;
          const isCustom = Boolean(customSpec);
          const isDisabled = Boolean((customSpec && customSpec.disabled) || (runtimeState && runtimeState.status === 4));
          const pill = statusPillInfo(runtimeState ? runtimeState.status : 0, isDisabled);

          const card = doc.createElement('div');
          card.className = 'agy-mcp-card';
          card.setAttribute('data-mcp-server-card', name);

          const topRow = doc.createElement('div');
          topRow.className = 'agy-mcp-card-top';

          const titleRow = doc.createElement('div');
          titleRow.className = 'agy-mcp-card-title-row';

          const nameEl = doc.createElement('span');
          nameEl.className = 'agy-mcp-server-name';
          nameEl.textContent = name;
          titleRow.appendChild(nameEl);

          const statusBadge = doc.createElement('span');
          statusBadge.className = `agy-mcp-pill ${pill.cls}`;
          statusBadge.textContent = pill.label;
          titleRow.appendChild(statusBadge);

          const sourceBadge = doc.createElement('span');
          sourceBadge.className = `agy-mcp-pill ${isCustom ? 'source-custom' : 'source-plugin'}`;
          sourceBadge.textContent = isCustom ? 'Custom' : 'Plugin';
          titleRow.appendChild(sourceBadge);

          topRow.appendChild(titleRow);

          const actionsRow = doc.createElement('div');
          actionsRow.style.display = 'flex';
          actionsRow.style.gap = '6px';
          actionsRow.style.flexWrap = 'wrap';

          const toggleBtn = doc.createElement('button');
          toggleBtn.className = 'agy-mcp-btn';
          toggleBtn.textContent = isDisabled ? 'Enable' : 'Disable';
          toggleBtn.addEventListener('click', async () => {
            try {
              await bridge.toggleServerEnabled(name, isDisabled);
              await reloadData();
              setBanner('success', `Server "${name}" ${isDisabled ? 'enabled' : 'disabled'}.`);
              renderBody();
            } catch (err) {
              setBanner('error', `Failed to toggle "${name}": ${err.message || err}`);
            }
          });
          actionsRow.appendChild(toggleBtn);

          const restartBtn = doc.createElement('button');
          restartBtn.className = 'agy-mcp-btn';
          restartBtn.textContent = '↻ Restart';
          restartBtn.addEventListener('click', async () => {
            setBanner('info', `Restarting "${name}"...`);
            await bridge.refreshServers(name);
            await reloadData();
            setBanner('success', `Restarted "${name}".`);
            renderBody();
          });
          actionsRow.appendChild(restartBtn);

          if (isCustom) {
            const editBtn = doc.createElement('button');
            editBtn.className = 'agy-mcp-btn';
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', () => {
              populateFormFromSpec(name, customSpec);
              activeTab = 'editor';
              renderModalContent();
            });
            actionsRow.appendChild(editBtn);

            const delBtn = doc.createElement('button');
            delBtn.className = 'agy-mcp-btn danger';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async () => {
              try {
                await bridge.deleteCustomServer(name);
                await reloadData();
                setBanner('success', `Removed custom server "${name}".`);
                renderBody();
              } catch (err) {
                setBanner('error', `Failed to delete "${name}": ${err.message || err}`);
              }
            });
            actionsRow.appendChild(delBtn);
          }

          topRow.appendChild(actionsRow);
          card.appendChild(topRow);

          const preview = doc.createElement('div');
          preview.className = 'agy-mcp-cmd-preview';
          preview.textContent = formatSpecPreview(customSpec || (runtimeState && runtimeState.spec));
          card.appendChild(preview);

          if (runtimeState && runtimeState.error) {
            const errBox = doc.createElement('div');
            errBox.style.fontSize = '11.5px';
            errBox.style.color = '#fca5a5';
            errBox.textContent = `Error: ${runtimeState.error}`;
            card.appendChild(errBox);
          }

          const tools = (runtimeState && Array.isArray(runtimeState.tools)) ? runtimeState.tools : [];
          const disabledToolsSet = new Set(
            (customSpec && Array.isArray(customSpec.disabledTools)) ? customSpec.disabledTools : []
          );

          if (tools.length > 0) {
            const toolsHeader = doc.createElement('div');
            toolsHeader.style.fontSize = '11px';
            toolsHeader.style.color = '#8b95b0';
            toolsHeader.textContent = `Tools (${tools.length}) ${isCustom ? '— click a tool chip to enable/disable it in mcp_config.json' : ''}:`;
            card.appendChild(toolsHeader);

            const toolsWrap = doc.createElement('div');
            toolsWrap.className = 'agy-mcp-tools-wrap';

            for (const t of tools) {
              const toolName = t && (t.name || t.toolName);
              if (!toolName) continue;
              const isToolDisabled = disabledToolsSet.has(toolName);
              const chip = doc.createElement('button');
              chip.type = 'button';
              chip.className = `agy-mcp-tool-chip${isToolDisabled ? ' disabled' : ''}`;
              chip.textContent = toolName;
              chip.title = (t && t.description) ? t.description : toolName;
              if (isCustom) {
                chip.addEventListener('click', async () => {
                  try {
                    await bridge.toggleServerTool(name, toolName, isToolDisabled);
                    await reloadData();
                    setBanner('success', `Tool "${toolName}" on "${name}" ${isToolDisabled ? 'enabled' : 'disabled'}.`);
                    renderBody();
                  } catch (err) {
                    setBanner('error', `Failed to toggle tool: ${err.message || err}`);
                  }
                });
              }
              toolsWrap.appendChild(chip);
            }
            card.appendChild(toolsWrap);
          }

          container.appendChild(card);
        }
      }

      function renderEditorTab(container) {
        const templateSection = doc.createElement('div');
        templateSection.className = 'agy-mcp-field';
        const tplLabel = doc.createElement('div');
        tplLabel.className = 'agy-mcp-label';
        tplLabel.textContent = 'Quick Preset Templates (Click to prefill):';
        templateSection.appendChild(tplLabel);

        const tplBar = doc.createElement('div');
        tplBar.className = 'agy-mcp-templates-bar';
        for (const tpl of QUICK_TEMPLATES) {
          const btn = doc.createElement('button');
          btn.type = 'button';
          btn.className = 'agy-mcp-template-chip';
          btn.setAttribute('data-template-id', tpl.id);
          btn.textContent = tpl.label;
          btn.title = tpl.description;
          btn.addEventListener('click', () => {
            editingForm = {
              originalName: editingForm.originalName,
              serverName: tpl.serverName,
              transport: tpl.transport,
              command: tpl.command || 'npx',
              argsText: formatArgsForEditor(tpl.args || []),
              envText: formatKeyValueForEditor(tpl.env || {}, '='),
              cwd: tpl.cwd || '',
              url: tpl.url || '',
              headersText: formatKeyValueForEditor(tpl.headers || {}, ': '),
              disabled: false,
            };
            setBanner('info', `Loaded preset "${tpl.label}". Review placeholders before saving.`);
            renderBody();
          });
          tplBar.appendChild(btn);
        }
        templateSection.appendChild(tplBar);
        container.appendChild(templateSection);

        const grid = doc.createElement('div');
        grid.className = 'agy-mcp-form-grid';

        // Server Name
        const nameField = doc.createElement('div');
        nameField.className = 'agy-mcp-field';
        const nameLabel = doc.createElement('label');
        nameLabel.className = 'agy-mcp-label';
        nameLabel.textContent = 'Server Name (ID)';
        const nameInput = doc.createElement('input');
        nameInput.className = 'agy-mcp-input';
        nameInput.setAttribute('data-field', 'serverName');
        nameInput.placeholder = 'e.g. filesystem, github, my-mcp';
        nameInput.value = editingForm.serverName;
        nameInput.addEventListener('input', (e) => {
          editingForm.serverName = e.target.value;
        });
        nameField.appendChild(nameLabel);
        nameField.appendChild(nameInput);
        grid.appendChild(nameField);

        // Transport
        const transField = doc.createElement('div');
        transField.className = 'agy-mcp-field';
        const transLabel = doc.createElement('label');
        transLabel.className = 'agy-mcp-label';
        transLabel.textContent = 'Transport Type';
        const transSelect = doc.createElement('select');
        transSelect.className = 'agy-mcp-select';
        transSelect.setAttribute('data-field', 'transport');
        const optStdio = doc.createElement('option');
        optStdio.value = 'stdio';
        optStdio.textContent = 'Stdio (Local Process: npx / uvx / node / python / docker)';
        const optHttp = doc.createElement('option');
        optHttp.value = 'http';
        optHttp.textContent = 'Streamable HTTP / Remote URL';
        transSelect.appendChild(optStdio);
        transSelect.appendChild(optHttp);
        transSelect.value = editingForm.transport;
        transSelect.addEventListener('change', (e) => {
          editingForm.transport = e.target.value;
          renderBody();
        });
        transField.appendChild(transLabel);
        transField.appendChild(transSelect);
        grid.appendChild(transField);

        if (editingForm.transport === 'http') {
          const urlField = doc.createElement('div');
          urlField.className = 'agy-mcp-field full';
          const urlLabel = doc.createElement('label');
          urlLabel.className = 'agy-mcp-label';
          urlLabel.textContent = 'Remote MCP Server URL (http:// or https://)';
          const urlInput = doc.createElement('input');
          urlInput.className = 'agy-mcp-input';
          urlInput.setAttribute('data-field', 'url');
          urlInput.placeholder = 'https://mcp.example.com/mcp';
          urlInput.value = editingForm.url;
          urlInput.addEventListener('input', (e) => {
            editingForm.url = e.target.value;
          });
          urlField.appendChild(urlLabel);
          urlField.appendChild(urlInput);
          grid.appendChild(urlField);

          const hdrField = doc.createElement('div');
          hdrField.className = 'agy-mcp-field full';
          const hdrLabel = doc.createElement('label');
          hdrLabel.className = 'agy-mcp-label';
          hdrLabel.textContent = 'HTTP Headers (One "Header: Value" per line or JSON object)';
          const hdrArea = doc.createElement('textarea');
          hdrArea.className = 'agy-mcp-textarea';
          hdrArea.setAttribute('data-field', 'headersText');
          hdrArea.placeholder = 'Authorization: Bearer <TOKEN>';
          hdrArea.value = editingForm.headersText;
          hdrArea.addEventListener('input', (e) => {
            editingForm.headersText = e.target.value;
          });
          hdrField.appendChild(hdrLabel);
          hdrField.appendChild(hdrArea);
          grid.appendChild(hdrField);
        } else {
          const cmdField = doc.createElement('div');
          cmdField.className = 'agy-mcp-field';
          const cmdLabel = doc.createElement('label');
          cmdLabel.className = 'agy-mcp-label';
          cmdLabel.textContent = 'Command Executable';
          const cmdInput = doc.createElement('input');
          cmdInput.className = 'agy-mcp-input';
          cmdInput.setAttribute('data-field', 'command');
          cmdInput.placeholder = 'npx, uvx, node, python, docker...';
          cmdInput.value = editingForm.command;
          cmdInput.addEventListener('input', (e) => {
            editingForm.command = e.target.value;
          });
          cmdField.appendChild(cmdLabel);
          cmdField.appendChild(cmdInput);
          grid.appendChild(cmdField);

          const cwdField = doc.createElement('div');
          cwdField.className = 'agy-mcp-field';
          const cwdLabel = doc.createElement('label');
          cwdLabel.className = 'agy-mcp-label';
          cwdLabel.textContent = 'Working Directory (cwd, optional)';
          const cwdInput = doc.createElement('input');
          cwdInput.className = 'agy-mcp-input';
          cwdInput.setAttribute('data-field', 'cwd');
          cwdInput.placeholder = 'e.g. D:/projects/my-server';
          cwdInput.value = editingForm.cwd;
          cwdInput.addEventListener('input', (e) => {
            editingForm.cwd = e.target.value;
          });
          cwdField.appendChild(cwdLabel);
          cwdField.appendChild(cwdInput);
          grid.appendChild(cwdField);

          const argsField = doc.createElement('div');
          argsField.className = 'agy-mcp-field full';
          const argsLabel = doc.createElement('label');
          argsLabel.className = 'agy-mcp-label';
          argsLabel.textContent = 'Arguments (One argument per line, or JSON array ["arg1", "arg2"])';
          const argsArea = doc.createElement('textarea');
          argsArea.className = 'agy-mcp-textarea';
          argsArea.setAttribute('data-field', 'argsText');
          argsArea.placeholder = '-y\n@modelcontextprotocol/server-filesystem\nD:/workspace';
          argsArea.value = editingForm.argsText;
          argsArea.addEventListener('input', (e) => {
            editingForm.argsText = e.target.value;
          });
          argsField.appendChild(argsLabel);
          argsField.appendChild(argsArea);
          grid.appendChild(argsField);

          const envField = doc.createElement('div');
          envField.className = 'agy-mcp-field full';
          const envLabel = doc.createElement('label');
          envLabel.className = 'agy-mcp-label';
          envLabel.textContent = 'Environment Variables (One KEY=VALUE per line, or JSON object)';
          const envArea = doc.createElement('textarea');
          envArea.className = 'agy-mcp-textarea';
          envArea.setAttribute('data-field', 'envText');
          envArea.placeholder = 'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx\nNODE_ENV=production';
          envArea.value = editingForm.envText;
          envArea.addEventListener('input', (e) => {
            editingForm.envText = e.target.value;
          });
          envField.appendChild(envLabel);
          envField.appendChild(envArea);
          grid.appendChild(envField);
        }

        container.appendChild(grid);

        const footerRow = doc.createElement('div');
        footerRow.style.display = 'flex';
        footerRow.style.justifyContent = 'space-between';
        footerRow.style.alignItems = 'center';
        footerRow.style.marginTop = '6px';

        const chkLabel = doc.createElement('label');
        chkLabel.style.display = 'inline-flex';
        chkLabel.style.alignItems = 'center';
        chkLabel.style.gap = '6px';
        chkLabel.style.fontSize = '12px';
        chkLabel.style.cursor = 'pointer';
        const chk = doc.createElement('input');
        chk.type = 'checkbox';
        chk.checked = Boolean(editingForm.disabled);
        chk.addEventListener('change', (e) => {
          editingForm.disabled = e.target.checked;
        });
        const chkText = doc.createElement('span');
        chkText.textContent = 'Save as disabled initially';
        chkLabel.appendChild(chk);
        chkLabel.appendChild(chkText);
        footerRow.appendChild(chkLabel);

        const actionBtns = doc.createElement('div');
        actionBtns.style.display = 'flex';
        actionBtns.style.gap = '8px';

        const cancelBtn = doc.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'agy-mcp-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => {
          activeTab = 'servers';
          renderModalContent();
        });

        const saveBtn = doc.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'agy-mcp-btn primary';
        saveBtn.setAttribute('data-testid', 'agy-mcp-save-server-btn');
        saveBtn.textContent = 'Save & Connect Server';
        saveBtn.addEventListener('click', async () => {
          try {
            const built = validateAndBuildServerSpec(editingForm);
            if (!built.ok) {
              setBanner('error', built.error);
              return;
            }
            setBanner('info', `Saving "${built.serverName}" to mcp_config.json...`);
            const res = await bridge.upsertCustomServer(built.serverName, built.spec, editingForm.originalName);
            if (res && res.ok === false) {
              setBanner('error', res.error || 'Failed to save server');
              return;
            }
            await reloadData();
            setBanner('success', `Saved and triggered reload for "${built.serverName}".`);
            activeTab = 'servers';
            renderModalContent();
          } catch (err) {
            setBanner('error', err.message || String(err));
          }
        });

        actionBtns.appendChild(cancelBtn);
        actionBtns.appendChild(saveBtn);
        footerRow.appendChild(actionBtns);
        container.appendChild(footerRow);
      }

      function renderRawTab(container) {
        const pathBar = doc.createElement('div');
        pathBar.style.display = 'flex';
        pathBar.style.justifyContent = 'space-between';
        pathBar.style.alignItems = 'center';
        pathBar.style.gap = '8px';
        pathBar.style.flexWrap = 'wrap';

        const uriCode = doc.createElement('code');
        uriCode.style.fontSize = '11.5px';
        uriCode.style.color = '#a5b4fc';
        uriCode.textContent = cachedConfig.uri || 'file://~/.gemini/config/mcp_config.json';
        pathBar.appendChild(uriCode);

        const pathBtns = doc.createElement('div');
        pathBtns.style.display = 'flex';
        pathBtns.style.gap = '6px';

        const revealBtn = doc.createElement('button');
        revealBtn.type = 'button';
        revealBtn.className = 'agy-mcp-btn';
        revealBtn.textContent = 'Open in Explorer';
        revealBtn.addEventListener('click', async () => {
          await bridge.revealConfigInExplorer();
        });
        pathBtns.appendChild(revealBtn);
        pathBar.appendChild(pathBtns);
        container.appendChild(pathBar);

        const editorArea = doc.createElement('textarea');
        editorArea.className = 'agy-mcp-textarea';
        editorArea.setAttribute('data-testid', 'agy-mcp-raw-json-textarea');
        editorArea.style.minHeight = '320px';
        editorArea.value = JSON.stringify(cachedConfig.config, null, 2) + '\n';
        container.appendChild(editorArea);

        const actionRow = doc.createElement('div');
        actionRow.style.display = 'flex';
        actionRow.style.justifyContent = 'flex-end';
        actionRow.style.gap = '8px';

        const formatBtn = doc.createElement('button');
        formatBtn.type = 'button';
        formatBtn.className = 'agy-mcp-btn';
        formatBtn.textContent = 'Format JSON';
        formatBtn.addEventListener('click', () => {
          const norm = normalizeMcpConfigObject(editorArea.value);
          if (!norm.ok) {
            setBanner('error', norm.error);
            return;
          }
          editorArea.value = JSON.stringify(norm.config, null, 2) + '\n';
          setBanner('info', 'Formatted JSON.');
        });

        const saveRawBtn = doc.createElement('button');
        saveRawBtn.type = 'button';
        saveRawBtn.className = 'agy-mcp-btn primary';
        saveRawBtn.setAttribute('data-testid', 'agy-mcp-save-raw-btn');
        saveRawBtn.textContent = 'Save mcp_config.json & Refresh';
        saveRawBtn.addEventListener('click', async () => {
          const norm = normalizeMcpConfigObject(editorArea.value);
          if (!norm.ok) {
            setBanner('error', norm.error);
            return;
          }
          const res = await bridge.writeMcpConfig(norm.config);
          if (res && res.ok === false) {
            setBanner('error', res.error);
            return;
          }
          await reloadData();
          setBanner('success', 'Saved mcp_config.json and refreshed MCP servers.');
          renderBody();
        });

        actionRow.appendChild(formatBtn);
        actionRow.appendChild(saveRawBtn);
        container.appendChild(actionRow);
      }

      function renderBody() {
        const backdrop = doc.getElementById(MODAL_ID);
        if (!backdrop) return;
        const body = backdrop.querySelector('.agy-mcp-body');
        if (!body) return;
        while (body.firstChild) body.removeChild(body.firstChild);

        if (activeTab === 'servers') {
          renderServersTab(body);
        } else if (activeTab === 'editor') {
          renderEditorTab(body);
        } else {
          renderRawTab(body);
        }
      }

      function renderModalContent() {
        const backdrop = doc.getElementById(MODAL_ID);
        if (!backdrop) return;
        const tabs = backdrop.querySelectorAll('.agy-mcp-tab');
        tabs.forEach((tab) => {
          if (tab.getAttribute('data-tab') === activeTab) {
            tab.classList.add('active');
          } else {
            tab.classList.remove('active');
          }
        });
        renderBanner();
        renderBody();
      }

      async function openModal(initialTab = 'servers') {
        ensureModalStyles(doc);
        activeTab = initialTab;
        bannerState = { type: '', message: '' };

        let backdrop = doc.getElementById(MODAL_ID);
        if (!backdrop) {
          backdrop = doc.createElement('div');
          backdrop.id = MODAL_ID;
          backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeModal();
          });

          const dialog = doc.createElement('div');
          dialog.className = 'agy-mcp-dialog';
          dialog.setAttribute('role', 'dialog');
          dialog.setAttribute('aria-label', 'Antigravity Custom MCP Server Manager');

          // Header
          const header = doc.createElement('div');
          header.className = 'agy-mcp-header';
          const titleWrap = doc.createElement('div');
          titleWrap.className = 'agy-mcp-title-wrap';
          const title = doc.createElement('h2');
          title.className = 'agy-mcp-title';
          title.textContent = '🔌 Antigravity Custom MCP Server Manager';
          const badge = doc.createElement('span');
          badge.className = 'agy-mcp-badge';
          badge.textContent = 'Native RPC Bridge';
          titleWrap.appendChild(title);
          titleWrap.appendChild(badge);

          const closeBtn = doc.createElement('button');
          closeBtn.type = 'button';
          closeBtn.className = 'agy-mcp-close-btn';
          closeBtn.setAttribute('aria-label', 'Close MCP Manager');
          closeBtn.textContent = '✕';
          closeBtn.addEventListener('click', () => closeModal());

          header.appendChild(titleWrap);
          header.appendChild(closeBtn);
          dialog.appendChild(header);

          // Tabs
          const tabsBar = doc.createElement('div');
          tabsBar.className = 'agy-mcp-tabs';
          const tabDefs = [
            { id: 'servers', label: 'Servers & Tools' },
            { id: 'editor', label: '+ Add / Edit Server' },
            { id: 'raw', label: '{ } Raw mcp_config.json' },
          ];
          for (const td of tabDefs) {
            const tBtn = doc.createElement('button');
            tBtn.type = 'button';
            tBtn.className = 'agy-mcp-tab';
            tBtn.setAttribute('data-tab', td.id);
            tBtn.textContent = td.label;
            tBtn.addEventListener('click', () => {
              if (td.id === 'editor' && !editingForm.serverName) {
                resetForm();
              }
              activeTab = td.id;
              renderModalContent();
            });
            tabsBar.appendChild(tBtn);
          }
          dialog.appendChild(tabsBar);

          // Banner
          const banner = doc.createElement('div');
          banner.className = 'agy-mcp-status-banner';
          dialog.appendChild(banner);

          // Body
          const body = doc.createElement('div');
          body.className = 'agy-mcp-body';
          dialog.appendChild(body);

          backdrop.appendChild(dialog);
          doc.body.appendChild(backdrop);
        }

        renderModalContent();
        await reloadData();
        renderModalContent();
      }

      function closeModal() {
        const backdrop = doc.getElementById(MODAL_ID);
        if (backdrop && backdrop.parentNode) {
          backdrop.parentNode.removeChild(backdrop);
        }
      }

      function isOpen() {
        return Boolean(doc.getElementById(MODAL_ID));
      }

      return {
        openModal,
        closeModal,
        isOpen,
        reloadData,
        getCachedState: () => ({ config: cachedConfig.config, states: cachedStates }),
      };
    }

    module.exports = {
      MODAL_ID,
      STYLE_ID,
      ensureModalStyles,
      createModalController,
    };

  },
  "./index": function(module, exports, __require) {
    const require = (spec) => __require(".", spec);
    'use strict';

    const schema = require('./mcp-config-schema');
    const { createHostMcpBridge } = require('./host-mcp-bridge');
    const { ensureModalStyles, createModalController } = require('./modal-ui');

    const MCP_MANAGER_VERSION = 'v1.0.1';
    const NATIVE_BTN_ATTR = 'data-agy-custom-mcp-btn';

    function cleanupLegacyStatusBarArtifacts(win, doc) {
      try {
        if (win && win.agyStatusBar && typeof win.agyStatusBar.unregisterAdapter === 'function') {
          win.agyStatusBar.unregisterAdapter('mcp-manager');
        }
        if (win && win.__agyCustomStatusBarAdapters && typeof win.__agyCustomStatusBarAdapters.delete === 'function') {
          win.__agyCustomStatusBarAdapters.delete('mcp-manager');
        }
        if (doc && typeof doc.querySelectorAll === 'function') {
          doc
            .querySelectorAll('[data-agy-adapter-id="mcp-manager"], [data-testid="agy-statusbar-mcp-btn"]')
            .forEach((el) => {
              try {
                el.remove();
              } catch (_e) {
                // ignore
              }
            });
        }
      } catch (_err) {
        // ignore
      }
    }

    function mountMcpManager(env = {}) {
      const win = env.window || (typeof window !== 'undefined' ? window : null);
      const doc = env.document || (win && win.document ? win.document : null);
      if (!win || !doc || !doc.body) return null;

      // Ensure no statusbar buttons/adapters remain from any prior version
      cleanupLegacyStatusBarArtifacts(win, doc);

      if (win.agyMcpManager && win.agyMcpManager.version === MCP_MANAGER_VERSION) {
        return win.agyMcpManager;
      }
      if (win.agyMcpManager && typeof win.agyMcpManager.destroy === 'function') {
        try {
          win.agyMcpManager.destroy();
        } catch (_e) {
          // ignore cleanup error
        }
      }

      ensureModalStyles(doc);

      const bridge = env.bridge || createHostMcpBridge({ win });
      const modal = createModalController({
        doc,
        bridge,
      });

      // Inject "+ Custom MCP Server" controls strictly into Antigravity's native Customizations / MCP views
      function injectIntoNativeMcpScreens() {
        if (!doc.body) return;

        // A) Next to native [data-testid="add-mcp-button"] in Customizations -> MCP Servers header
        const addMcpBtns = doc.querySelectorAll('[data-testid="add-mcp-button"]');
        addMcpBtns.forEach((nativeBtn) => {
          const parent = nativeBtn.parentElement;
          if (!parent || parent.querySelector(`[${NATIVE_BTN_ATTR}="beside-add-btn"]`)) return;
          const customBtn = doc.createElement('button');
          customBtn.type = 'button';
          customBtn.className = 'agy-mcp-injected-native-btn';
          customBtn.setAttribute(NATIVE_BTN_ATTR, 'beside-add-btn');
          customBtn.textContent = '+ Custom MCP';
          customBtn.title = 'Add or manage custom MCP servers in ~/.gemini/config/mcp_config.json';
          customBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            modal.openModal('editor');
          });
          parent.insertBefore(customBtn, nativeBtn);
        });

        // B) Inside native [data-testid="add-mcp-screen"] ("Add MCP Server" modal / screen)
        const addMcpScreens = doc.querySelectorAll('[data-testid="add-mcp-screen"]');
        addMcpScreens.forEach((screen) => {
          if (screen.querySelector(`[${NATIVE_BTN_ATTR}="inside-add-screen"]`)) return;
          const headerRow = screen.firstElementChild;
          if (!headerRow) return;

          const banner = doc.createElement('div');
          banner.setAttribute(NATIVE_BTN_ATTR, 'inside-add-screen');
          banner.style.display = 'flex';
          banner.style.alignItems = 'center';
          banner.style.justifyContent = 'space-between';
          banner.style.gap = '10px';
          banner.style.margin = '4px 0 8px 0';
          banner.style.padding = '8px 12px';
          banner.style.borderRadius = '8px';
          banner.style.background = 'rgba(79, 70, 229, 0.12)';
          banner.style.border = '1px solid rgba(99, 102, 241, 0.32)';
          banner.style.fontSize = '12px';

          const desc = doc.createElement('span');
          desc.textContent = 'Custom Stdio (npx / uvx / node / python) or HTTP MCP server:';

          const btnGroup = doc.createElement('div');
          btnGroup.style.display = 'flex';
          btnGroup.style.gap = '6px';

          const openEditorBtn = doc.createElement('button');
          openEditorBtn.type = 'button';
          openEditorBtn.className = 'agy-mcp-injected-native-btn';
          openEditorBtn.style.marginLeft = '0';
          openEditorBtn.textContent = '+ Add Custom MCP Server';
          openEditorBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            modal.openModal('editor');
          });

          const manageBtn = doc.createElement('button');
          manageBtn.type = 'button';
          manageBtn.className = 'agy-mcp-btn';
          manageBtn.textContent = 'Manage Custom Servers';
          manageBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            modal.openModal('servers');
          });

          btnGroup.appendChild(openEditorBtn);
          btnGroup.appendChild(manageBtn);
          banner.appendChild(desc);
          banner.appendChild(btnGroup);

          if (headerRow.nextSibling) {
            screen.insertBefore(banner, headerRow.nextSibling);
          } else {
            screen.appendChild(banner);
          }
        });

        // C) Next to the "No MCP servers yet. Use Add to browse the store." empty note in Customizations -> MCP Servers
        const paragraphs = doc.querySelectorAll('p');
        paragraphs.forEach((p) => {
          if (
            p.textContent &&
            p.textContent.includes('No MCP servers yet.') &&
            p.parentElement &&
            !p.parentElement.querySelector(`[${NATIVE_BTN_ATTR}="empty-mcp-note"]`)
          ) {
            const wrap = doc.createElement('div');
            wrap.setAttribute(NATIVE_BTN_ATTR, 'empty-mcp-note');
            wrap.style.display = 'flex';
            wrap.style.alignItems = 'center';
            wrap.style.gap = '8px';
            wrap.style.paddingLeft = '12px';
            wrap.style.marginTop = '6px';

            const addCustomBtn = doc.createElement('button');
            addCustomBtn.type = 'button';
            addCustomBtn.className = 'agy-mcp-injected-native-btn';
            addCustomBtn.style.marginLeft = '0';
            addCustomBtn.textContent = '+ Add Custom MCP Server';
            addCustomBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              modal.openModal('editor');
            });

            const rawBtn = doc.createElement('button');
            rawBtn.type = 'button';
            rawBtn.className = 'agy-mcp-btn';
            rawBtn.textContent = '{ } Edit mcp_config.json';
            rawBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              modal.openModal('raw');
            });

            wrap.appendChild(addCustomBtn);
            wrap.appendChild(rawBtn);
            p.parentElement.appendChild(wrap);
          }
        });
      }

      injectIntoNativeMcpScreens();

      let observer = null;
      if (typeof win.MutationObserver === 'function') {
        observer = new win.MutationObserver(() => {
          injectIntoNativeMcpScreens();
        });
        observer.observe(doc.body, { childList: true, subtree: true });
      }

      // Keyboard shortcut: Ctrl+Shift+M to open/toggle modal, Escape to close
      function onKeyDown(e) {
        if (!e) return;
        if (e.key === 'Escape' && modal.isOpen()) {
          modal.closeModal();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key).toLowerCase() === 'm') {
          e.preventDefault();
          if (modal.isOpen()) {
            modal.closeModal();
          } else {
            modal.openModal('servers');
          }
        }
      }
      win.addEventListener('keydown', onKeyDown);

      const controller = {
        version: MCP_MANAGER_VERSION,
        openModal: (tab) => modal.openModal(tab),
        closeModal: () => modal.closeModal(),
        isOpen: () => modal.isOpen(),
        reload: () => modal.reloadData(),
        bridge,
        schema,
        destroy() {
          if (observer) {
            observer.disconnect();
            observer = null;
          }
          win.removeEventListener('keydown', onKeyDown);
          modal.closeModal();
          cleanupLegacyStatusBarArtifacts(win, doc);
          doc.querySelectorAll(`[${NATIVE_BTN_ATTR}]`).forEach((el) => {
            if (el.parentNode) el.parentNode.removeChild(el);
          });
          if (win.agyMcpManager === controller) {
            delete win.agyMcpManager;
          }
        },
      };

      win.agyMcpManager = controller;
      return controller;
    }

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => mountMcpManager());
      } else {
        mountMcpManager();
      }
    }

    module.exports = {
      MCP_MANAGER_VERSION,
      mountMcpManager,
      cleanupLegacyStatusBarArtifacts,
      schema,
      createHostMcpBridge,
      createModalController,
    };

  }
  };
  const __cache = {};
  function __resolve(baseDir, spec) {
    const cleanSpec = spec.replace(/\.js$/, '');
    const parts = (baseDir + '/' + cleanSpec).split('/');
    const out = [];
    for (const p of parts) {
      if (!p || p === '.') continue;
      if (p === '..') out.pop();
      else out.push(p);
    }
    return './' + out.join('/');
  }
  function __require(baseDir, spec) {
    const id = __resolve(baseDir, spec);
    if (__cache[id]) return __cache[id].exports;
    const fn = __modules[id];
    if (!fn) throw new Error('Module not found: ' + id);
    const module = { exports: {} };
    __cache[id] = module;
    fn(module, module.exports, __require);
    return module.exports;
  }
  __require('.', './index');
})();
