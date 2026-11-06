// ==UserScript==
// @name         Antigravity Custom MCP Server Manager
// @namespace    https://github.com/jaeseongs95/antigravity-mcp-manager
// @version      1.4.0
// @description  Add, edit, toggle, and manage custom Stdio & HTTP MCP servers (mcp_config.json) directly inside the Antigravity 2.0 native app and Remote Control web.
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

    function encodeBase64(str) {
      if (typeof Buffer !== 'undefined') {
        return Buffer.from(String(str), 'utf8').toString('base64');
      }
      if (typeof btoa === 'function') {
        return btoa(unescape(encodeURIComponent(String(str))));
      }
      return String(str);
    }

    function decodeBase64(b64) {
      try {
        if (typeof Buffer !== 'undefined') {
          return Buffer.from(String(b64), 'base64').toString('utf8');
        }
        if (typeof atob === 'function') {
          return decodeURIComponent(escape(atob(String(b64))));
        }
      } catch {}
      return '';
    }

    function extractAuthFromSpec(spec) {
      const isHttp = Boolean(spec && typeof spec === 'object' && (spec.url || spec.serverUrl || spec.type === 'http'));
      const result = {
        authMode: isHttp ? 'oauth' : 'none', // 'oauth' | 'none' | 'oauth_or_none' | 'bearer' | 'apiKey' | 'basic'
        oauthClientMode: 'auto', // 'auto' | 'custom'
        oauthClientId: '',
        oauthClientSecret: '',
        oauthScopes: '',
        bearerToken: '',
        apiKeyHeader: 'X-API-Key',
        apiKeyValue: '',
        basicUser: '',
        basicPass: '',
        extraHeaders: {},
      };
      if (!spec || typeof spec !== 'object') return result;

      if (spec.oauth && typeof spec.oauth === 'object') {
        result.authMode = 'oauth';
        result.oauthClientId = typeof spec.oauth.clientId === 'string' ? spec.oauth.clientId : '';
        result.oauthClientSecret = typeof spec.oauth.clientSecret === 'string' ? spec.oauth.clientSecret : '';
        result.oauthScopes = Array.isArray(spec.oauth.scopes)
          ? spec.oauth.scopes.join(' ')
          : (typeof spec.oauth.scopes === 'string' ? spec.oauth.scopes : '');
        if (result.oauthClientId || result.oauthClientSecret) {
          result.oauthClientMode = 'custom';
        }
      }

      if (spec.authMode === 'none' || spec.authMode === 'oauth' || spec.authMode === 'oauth_or_none') {
        result.authMode = spec.authMode;
      }

      const rawHeaders = spec.headers && typeof spec.headers === 'object' ? { ...spec.headers } : {};
      const entries = Object.entries(rawHeaders);
      let matchedKey = null;

      for (const [k, v] of entries) {
        if (k.toLowerCase() === 'authorization' && typeof v === 'string') {
          const trimmed = v.trim();
          const bearerMatch = /^Bearer\s+(.+)$/i.exec(trimmed);
          if (bearerMatch) {
            result.authMode = 'bearer';
            result.bearerToken = bearerMatch[1].trim();
            matchedKey = k;
            break;
          }
          const basicMatch = /^Basic\s+(.+)$/i.exec(trimmed);
          if (basicMatch) {
            const decoded = decodeBase64(basicMatch[1].trim());
            const colonIdx = decoded.indexOf(':');
            result.authMode = 'basic';
            if (colonIdx !== -1) {
              result.basicUser = decoded.slice(0, colonIdx);
              result.basicPass = decoded.slice(colonIdx + 1);
            } else {
              result.basicUser = decoded;
            }
            matchedKey = k;
            break;
          }
          result.authMode = 'apiKey';
          result.apiKeyHeader = k;
          result.apiKeyValue = trimmed;
          matchedKey = k;
          break;
        }
      }

      if (!matchedKey) {
        for (const [k, v] of entries) {
          if (/^(?:x-api-key|api-key|x-auth-token|x-mcp-token|x-access-token)$/i.test(k) && typeof v === 'string') {
            result.authMode = 'apiKey';
            result.apiKeyHeader = k;
            result.apiKeyValue = v.trim();
            matchedKey = k;
            break;
          }
        }
      }

      for (const [k, v] of entries) {
        if (k !== matchedKey) {
          result.extraHeaders[k] = String(v);
        }
      }

      return result;
    }

    function buildAuthHeaders({
      authMode,
      bearerToken,
      apiKeyHeader,
      apiKeyValue,
      basicUser,
      basicPass,
      baseHeaders,
    }) {
      const headers = baseHeaders && typeof baseHeaders === 'object' ? { ...baseHeaders } : {};
      const mode = typeof authMode === 'string' ? authMode.trim() : '';

      if (!mode) {
        return headers;
      }

      if (mode === 'none' || mode === 'oauth' || mode === 'oauth_or_none') {
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === 'authorization') delete headers[k];
        }
        return headers;
      }

      if (mode === 'bearer') {
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === 'authorization') delete headers[k];
        }
        const rawToken = typeof bearerToken === 'string' ? bearerToken.trim() : '';
        if (rawToken) {
          const cleanToken = rawToken.replace(/^Bearer\s+/i, '').trim();
          if (cleanToken) {
            headers.Authorization = `Bearer ${cleanToken}`;
          }
        }
        return headers;
      }

      if (mode === 'apiKey') {
        const hdrName = (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) ? apiKeyHeader.trim() : 'X-API-Key';
        const hdrVal = typeof apiKeyValue === 'string' ? apiKeyValue.trim() : '';
        if (hdrVal) {
          headers[hdrName] = hdrVal;
        }
        return headers;
      }

      if (mode === 'basic') {
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === 'authorization') delete headers[k];
        }
        const u = typeof basicUser === 'string' ? basicUser : '';
        const p = typeof basicPass === 'string' ? basicPass : '';
        if (u || p) {
          headers.Authorization = `Basic ${encodeBase64(`${u}:${p}`)}`;
        }
        return headers;
      }

      return headers;
    }

    function normalizeQuickAuthToken(rawAuth) {
      if (typeof rawAuth !== 'string' || !rawAuth.trim()) return null;
      const trimmed = rawAuth.trim();
      if (/^Bearer\s+(.+)$/i.test(trimmed)) {
        const tok = trimmed.replace(/^Bearer\s+/i, '').trim();
        return tok ? { headerKey: 'Authorization', headerValue: `Bearer ${tok}`, rawToken: tok } : null;
      }
      if (/^Basic\s+(.+)$/i.test(trimmed)) {
        return { headerKey: 'Authorization', headerValue: trimmed, rawToken: trimmed };
      }
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0 && /^[a-zA-Z0-9_-]+$/.test(trimmed.slice(0, colonIdx).trim())) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim();
        if (val) {
          return { headerKey: key, headerValue: val, rawToken: val };
        }
      }
      return {
        headerKey: 'Authorization',
        headerValue: `Bearer ${trimmed}`,
        rawToken: trimmed,
      };
    }

    function sanitizeServerName(raw) {
      if (!raw || typeof raw !== 'string') return '';
      const cleaned = raw
        .trim()
        .toLowerCase()
        .replace(/^@[^/]+\//, '')
        .replace(/@[0-9a-z._-]+$/i, '')
        .replace(/^(?:mcp-server-|server-|mcp-)/, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      return cleaned || '';
    }

    function deriveServerNameFromUrl(urlStr) {
      try {
        const u = new URL(urlStr);
        const hostParts = u.hostname.toLowerCase().split('.').filter(Boolean);
        const ignored = new Set(['www', 'mcp', 'api', 'server', 'com', 'org', 'net', 'io', 'dev', 'ai', 'app', 'co', 'kr']);
        const meaningfulHost = hostParts.filter((p) => !ignored.has(p));
        const pathParts = u.pathname
          .split('/')
          .map((p) => sanitizeServerName(p))
          .filter((p) => p && p !== 'mcp' && p !== 'sse' && p !== 'v1' && p !== 'v2');

        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
          const suffix = pathParts[0] || (u.port ? `${u.port}` : 'local');
          return sanitizeServerName(`local-${suffix}`) || 'local-mcp';
        }
        if (meaningfulHost.length > 0 && pathParts.length > 0) {
          return sanitizeServerName(`${meaningfulHost[0]}-${pathParts[pathParts.length - 1]}`);
        }
        if (meaningfulHost.length > 0) {
          return sanitizeServerName(meaningfulHost.join('-'));
        }
        if (pathParts.length > 0) {
          return sanitizeServerName(pathParts[pathParts.length - 1]);
        }
        return sanitizeServerName(u.hostname) || 'remote-mcp';
      } catch {
        return 'remote-mcp';
      }
    }

    function deriveServerNameFromCommandAndArgs(command, args) {
      const list = Array.isArray(args) ? args : [];
      for (let i = list.length - 1; i >= 0; i--) {
        const token = String(list[i] || '').trim();
        if (!token || token.startsWith('-')) continue;
        if (/^https?:\/\//i.test(token)) {
          return deriveServerNameFromUrl(token);
        }
        if (token.startsWith('github:')) {
          const repoPart = token.slice('github:'.length).split('/').pop();
          const name = sanitizeServerName(repoPart);
          if (name) return name;
        }
        if (token.startsWith('@') || token.includes('mcp') || i === 0) {
          const base = token.replace(/\\/g, '/').split('/').pop().replace(/\.(?:js|mjs|cjs|py|ts)$/i, '');
          const name = sanitizeServerName(base);
          if (name) return name;
        }
      }
      return sanitizeServerName(command) || 'custom-mcp';
    }

    const KNOWN_UVX_PACKAGES = new Set([
      'mcp-server-fetch',
      'mcp-server-sqlite',
      'mcp-server-git',
      'mcp-server-time',
      'mcp-server-sentry',
    ]);

    function extractUrlAuthAndCleanUrl(rawUrlStr) {
      try {
        const u = new URL(rawUrlStr);
        const extractedHeaders = {};
        if (u.username || u.password) {
          const user = decodeURIComponent(u.username || '');
          const pass = decodeURIComponent(u.password || '');
          if (user && !pass) {
            extractedHeaders.Authorization = `Bearer ${user}`;
          } else if (user || pass) {
            extractedHeaders.Authorization = `Basic ${encodeBase64(`${user}:${pass}`)}`;
          }
          u.username = '';
          u.password = '';
        }
        for (const paramName of ['bearer', 'auth_token', 'access_token']) {
          if (u.searchParams.has(paramName)) {
            const val = u.searchParams.get(paramName);
            if (val && !extractedHeaders.Authorization) {
              extractedHeaders.Authorization = `Bearer ${val}`;
            }
            u.searchParams.delete(paramName);
          }
        }
        return { cleanUrl: u.toString(), extractedHeaders };
      } catch {
        return { cleanUrl: rawUrlStr, extractedHeaders: {} };
      }
    }

    function applyQuickAuthToResult(res, quickAuth) {
      if (!res || !res.ok || !quickAuth) return res;
      if (res.multipleServers) {
        for (const spec of Object.values(res.multipleServers)) {
          if (spec && (spec.url || spec.serverUrl)) {
            spec.headers = { ...(spec.headers || {}), [quickAuth.headerKey]: quickAuth.headerValue };
          }
        }
      }
      if (res.spec) {
        if (res.spec.url || res.spec.serverUrl) {
          res.spec.headers = {
            ...(res.spec.headers || {}),
            [quickAuth.headerKey]: quickAuth.headerValue,
          };
        } else if (res.spec.command) {
          const env = { ...(res.spec.env || {}) };
          const placeholderKey = Object.keys(env).find((k) => /^<.*>$/.test(String(env[k] || '').trim()));
          if (placeholderKey) {
            env[placeholderKey] = quickAuth.rawToken;
          } else {
            env.MCP_AUTH_TOKEN = quickAuth.rawToken;
          }
          res.spec.env = env;
        }
      }
      return res;
    }

    function parseSmartMcpInput(rawInput, optionalAuthToken = '') {
      if (typeof rawInput !== 'string' || !rawInput.trim()) {
        return {
          ok: false,
          error: 'Please enter an MCP server URL, package name, command, or JSON snippet.',
        };
      }
      const trimmed = rawInput.trim();
      const quickAuth = normalizeQuickAuthToken(optionalAuthToken);

      // 1. JSON snippet (`{ "mcpServers": ... }`, `{ "my-server": { ... } }`, or `{ "url": "..." }`)
      if (trimmed.startsWith('{')) {
        try {
          const obj = JSON.parse(trimmed);
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            if (typeof obj.url === 'string' || typeof obj.serverUrl === 'string' || typeof obj.command === 'string') {
              const isHttp = Boolean(obj.url || obj.serverUrl);
              const url = obj.url || obj.serverUrl || '';
              const serverName = sanitizeServerName(obj.name || obj.serverName) ||
                (isHttp ? deriveServerNameFromUrl(url) : deriveServerNameFromCommandAndArgs(obj.command, obj.args));
              const built = validateAndBuildServerSpec({
                serverName,
                transport: isHttp ? 'http' : 'stdio',
                command: obj.command,
                args: obj.args,
                env: obj.env,
                cwd: obj.cwd,
                url,
                headers: obj.headers,
                bearerToken: obj.bearerToken || obj.token || '',
                authMode: (obj.bearerToken || obj.token) ? 'bearer' : undefined,
                disabled: Boolean(obj.disabled),
              });
              return applyQuickAuthToResult(built, quickAuth);
            }
            const norm = normalizeMcpConfigObject(obj);
            if (norm.ok && norm.config && norm.config.mcpServers) {
              const entries = Object.entries(norm.config.mcpServers);
              if (entries.length > 0) {
                const [firstName, firstSpec] = entries[0];
                return applyQuickAuthToResult({
                  ok: true,
                  serverName: firstName,
                  spec: firstSpec,
                  multipleServers: entries.length > 1 ? norm.config.mcpServers : null,
                }, quickAuth);
              }
            }
          }
        } catch (e) {
          return { ok: false, error: `Invalid JSON input: ${e.message}` };
        }
      }

      // 1b. URL accompanied by inline auth flags/tokens (e.g. `https://host/mcp Bearer xxx`, `https://host/mcp --token xxx`, `curl -H "Authorization: Bearer xxx" https://host/mcp`)
      if (/https?:\/\/\S+/i.test(trimmed) && /\s/.test(trimmed)) {
        const tokens = parseArgsInput(trimmed);
        const urlToken = tokens.find((t) => /^https?:\/\/\S+$/i.test(t));
        if (urlToken && tokens[0] !== 'npx' && tokens[0] !== 'uvx' && tokens[0] !== 'node' && tokens[0] !== 'python' && tokens[0] !== 'docker') {
          const rest = tokens.filter((t) => t !== urlToken && t !== 'curl');
          const inlineHeaders = {};
          for (let i = 0; i < rest.length; i++) {
            const tk = rest[i];
            if ((tk === '-H' || tk === '--header') && rest[i + 1]) {
              Object.assign(inlineHeaders, parseKeyValueInput(rest[i + 1]));
              i++;
            } else if ((tk === '--token' || tk === '--bearer' || /^bearer$/i.test(tk)) && rest[i + 1]) {
              inlineHeaders.Authorization = `Bearer ${rest[i + 1].replace(/^Bearer\s+/i, '')}`;
              i++;
            } else if ((tk === '--api-key' || tk === '--apikey') && rest[i + 1]) {
              inlineHeaders['X-API-Key'] = rest[i + 1];
              i++;
            } else if (rest.length === 1 && !tk.startsWith('-')) {
              const parsedAuth = normalizeQuickAuthToken(tk);
              if (parsedAuth) {
                inlineHeaders[parsedAuth.headerKey] = parsedAuth.headerValue;
              }
            }
          }
          const baseRes = parseSmartMcpInput(urlToken, optionalAuthToken);
          if (baseRes.ok && baseRes.spec && Object.keys(inlineHeaders).length > 0) {
            baseRes.spec.headers = { ...(baseRes.spec.headers || {}), ...inlineHeaders };
          }
          return baseRes;
        }
      }

      // 2. Single-token URL (`http://...` or `https://...`)
      if (/^https?:\/\/\S+$/i.test(trimmed)) {
        try {
          const u = new URL(trimmed);
          const host = u.hostname.toLowerCase();

          // 2a. GitHub repository URL -> convert to npx package spec
          if (host === 'github.com' || host === 'www.github.com') {
            const parts = u.pathname.split('/').filter(Boolean);
            // Official modelcontextprotocol/servers tree link
            const srcIdx = parts.indexOf('src');
            if (parts[0] === 'modelcontextprotocol' && parts[1] === 'servers' && srcIdx !== -1 && parts[srcIdx + 1]) {
              const subPkg = parts[srcIdx + 1];
              const pkgName = `@modelcontextprotocol/server-${subPkg}`;
              return applyQuickAuthToResult(validateAndBuildServerSpec({
                serverName: sanitizeServerName(subPkg) || 'mcp-server',
                transport: 'stdio',
                command: 'npx',
                args: ['-y', pkgName],
              }), quickAuth);
            }
            if (parts.length >= 2) {
              const owner = parts[0];
              const repo = parts[1].replace(/\.git$/i, '');
              return applyQuickAuthToResult(validateAndBuildServerSpec({
                serverName: sanitizeServerName(repo) || sanitizeServerName(owner) || 'github-mcp',
                transport: 'stdio',
                command: 'npx',
                args: ['-y', `github:${owner}/${repo}`],
              }), quickAuth);
            }
          }

          // 2b. npmjs.com package URL -> convert to npx -y <pkg>
          if ((host === 'npmjs.com' || host === 'www.npmjs.com') && u.pathname.startsWith('/package/')) {
            const pkgName = u.pathname.slice('/package/'.length).replace(/\/+$/, '');
            if (pkgName) {
              return applyQuickAuthToResult(validateAndBuildServerSpec({
                serverName: deriveServerNameFromCommandAndArgs('npx', [pkgName]),
                transport: 'stdio',
                command: 'npx',
                args: ['-y', pkgName],
              }), quickAuth);
            }
          }

          // 2c. Standard remote Streamable HTTP / SSE MCP server endpoint
          const { cleanUrl, extractedHeaders } = extractUrlAuthAndCleanUrl(trimmed);
          const serverName = deriveServerNameFromUrl(cleanUrl);
          const built = validateAndBuildServerSpec({
            serverName,
            transport: 'http',
            url: cleanUrl,
            headers: extractedHeaders,
          });
          return applyQuickAuthToResult(built, quickAuth);
        } catch {
          return { ok: false, error: 'Invalid URL format.' };
        }
      }

      // 3. Bare package name (`@scope/pkg` or `mcp-server-*`)
      if (/^(?:@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-._~]+|mcp-server-[a-z0-9-._~]+|[a-z0-9-._~]+-mcp(?:-server)?)(?:@[^\s]+)?$/i.test(trimmed)) {
        const barePkg = trimmed.replace(/@[^@/]+$/, '');
        const isUvx = KNOWN_UVX_PACKAGES.has(barePkg.toLowerCase());
        const command = isUvx ? 'uvx' : 'npx';
        const args = isUvx ? [trimmed] : ['-y', trimmed];
        return applyQuickAuthToResult(validateAndBuildServerSpec({
          serverName: deriveServerNameFromCommandAndArgs(command, args),
          transport: 'stdio',
          command,
          args,
        }), quickAuth);
      }

      // 4. Full command line (`npx -y @playwright/mcp@latest`, `uvx mcp-server-fetch`, `node server.js`, etc.)
      const tokens = parseArgsInput(trimmed);
      if (tokens.length > 0) {
        const command = tokens[0];
        const args = tokens.slice(1);
        const serverName = deriveServerNameFromCommandAndArgs(command, args);
        return applyQuickAuthToResult(validateAndBuildServerSpec({
          serverName,
          transport: 'stdio',
          command,
          args,
        }), quickAuth);
      }

      return { ok: false, error: 'Could not recognize MCP server address or command.' };
    }

    function validateAndBuildServerSpec({
      serverName,
      description,
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
      authMode,
      oauth,
      oauthClientMode,
      oauthClientId,
      oauthClientSecret,
      oauthScopes,
      bearerToken,
      apiKeyHeader,
      apiKeyValue,
      basicUser,
      basicPass,
      disabled,
      existingSpec,
    }) {
      let cleanName = typeof serverName === 'string' ? serverName.trim() : '';
      const rawCmd = typeof command === 'string' ? command.trim() : '';
      const rawUrl = typeof url === 'string' ? url.trim() : '';
      const rawArgsStr = typeof args === 'string' ? args.trim() : (typeof argsText === 'string' ? argsText.trim() : '');

      // Smart fallback: if the user pasted a URL or full command into serverName, command, or args
      if (/^https?:\/\/\S+$/i.test(cleanName) && !rawUrl) {
        return parseSmartMcpInput(cleanName, bearerToken || apiKeyValue || '');
      }
      if (transport !== 'http' && !rawUrl) {
        if (/^https?:\/\/\S+$/i.test(rawCmd)) {
          const smart = parseSmartMcpInput(rawCmd, bearerToken || apiKeyValue || '');
          if (smart.ok) {
            if (cleanName && /^[a-zA-Z0-9._-]+$/.test(cleanName)) smart.serverName = cleanName;
            return smart;
          }
        }
        if ((rawCmd === 'npx' || !rawCmd) && /^https?:\/\/\S+$/i.test(rawArgsStr)) {
          const smart = parseSmartMcpInput(rawArgsStr, bearerToken || apiKeyValue || '');
          if (smart.ok) {
            if (cleanName && /^[a-zA-Z0-9._-]+$/.test(cleanName)) smart.serverName = cleanName;
            return smart;
          }
        }
        if (rawCmd.includes(' ') && !rawArgsStr) {
          const smart = parseSmartMcpInput(rawCmd, bearerToken || apiKeyValue || '');
          if (smart.ok) {
            if (cleanName && /^[a-zA-Z0-9._-]+$/.test(cleanName)) smart.serverName = cleanName;
            return smart;
          }
        }
      }

      if (!cleanName) {
        if (transport === 'http' || /^https?:\/\/.+/i.test(rawUrl)) {
          cleanName = deriveServerNameFromUrl(rawUrl);
        } else {
          const parsedArgsCandidate = parseArgsInput(args !== undefined ? args : argsText);
          cleanName = deriveServerNameFromCommandAndArgs(command, parsedArgsCandidate);
        }
      }
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
      delete base.oauth;
      delete base.authMode;
      delete base.description;
      delete base.disabled;

      const cleanDesc = typeof description === 'string' ? description.trim() : '';

      if (transport === 'http') {
        const rawTrimmedUrl = typeof url === 'string' ? url.trim() : '';
        if (!rawTrimmedUrl) {
          return { ok: false, error: 'Remote MCP Server URL is required for Streamable HTTP transport.' };
        }
        if (!/^https?:\/\/.+/i.test(rawTrimmedUrl)) {
          return { ok: false, error: 'Remote MCP Server URL must start with http:// or https://.' };
        }
        const { cleanUrl, extractedHeaders } = extractUrlAuthAndCleanUrl(rawTrimmedUrl);
        const manualHeaders = parseKeyValueInput(headers !== undefined ? headers : headersText);
        const combinedBaseHeaders = { ...extractedHeaders, ...manualHeaders };
        const finalHeaders = buildAuthHeaders({
          authMode,
          bearerToken,
          apiKeyHeader,
          apiKeyValue,
          basicUser,
          basicPass,
          baseHeaders: combinedBaseHeaders,
        });
        const spec = {
          ...base,
          url: cleanUrl,
        };
        if (cleanDesc) {
          spec.description = cleanDesc;
        }
        if (Object.keys(finalHeaders).length > 0) {
          spec.headers = finalHeaders;
        }
        const cId = typeof oauthClientId === 'string' ? oauthClientId.trim() : (typeof oauth?.clientId === 'string' ? oauth.clientId.trim() : '');
        const cSec = typeof oauthClientSecret === 'string' ? oauthClientSecret.trim() : (typeof oauth?.clientSecret === 'string' ? oauth.clientSecret.trim() : '');
        const cScopes = typeof oauthScopes === 'string' ? oauthScopes.trim() : '';
        if ((authMode === 'oauth' || authMode === 'oauth_or_none' || !authMode) && (oauthClientMode === 'custom' || cId || cSec)) {
          const oauthObj = {};
          if (cId) oauthObj.clientId = cId;
          if (cSec) oauthObj.clientSecret = cSec;
          if (cScopes) oauthObj.scopes = cScopes.split(/[\s,]+/).filter(Boolean);
          if (Object.keys(oauthObj).length > 0) {
            spec.oauth = oauthObj;
          }
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
      if (authMode === 'bearer' && typeof bearerToken === 'string' && bearerToken.trim()) {
        const cleanTok = bearerToken.trim().replace(/^Bearer\s+/i, '');
        if (cleanTok && !parsedEnv.MCP_AUTH_TOKEN) {
          parsedEnv.MCP_AUTH_TOKEN = cleanTok;
        }
      } else if (authMode === 'apiKey' && typeof apiKeyValue === 'string' && apiKeyValue.trim()) {
        const envKey = (typeof apiKeyHeader === 'string' && apiKeyHeader.trim())
          ? apiKeyHeader.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
          : 'MCP_API_KEY';
        parsedEnv[envKey] = apiKeyValue.trim();
      }
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
      extractAuthFromSpec,
      buildAuthHeaders,
      normalizeQuickAuthToken,
      sanitizeServerName,
      deriveServerNameFromUrl,
      deriveServerNameFromCommandAndArgs,
      parseSmartMcpInput,
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
            const st = await svc.getCustomizationStates();
            for (const item of st?.items || []) {
              const p = item?.skillItem?.path || item?.ruleItem?.path || item?.pluginItem?.path || '';
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
          const res = await svc.readFile({ uri: autoinjectUri });
          const text = res?.content && res.content.length > 0 ? new TextDecoder().decode(res.content) : '';
          if (!text) return null;

          const mcpBeginMarker = '// === ' + ['BEGIN_AGY_MCP', 'MANAGER_V1'].join('_') + ' ===';
          const mcpEndMarker = '// === ' + ['END_AGY_MCP', 'MANAGER_V1'].join('_') + ' ===';
          const koBeginMarker = '// === ' + ['BEGIN_AGY_KO', 'THOUGHT_LOCALIZER_V2'].join('_') + ' ===';
          const koEndMarker = '// === ' + ['END_AGY_KO', 'THOUGHT_LOCALIZER_V2'].join('_') + ' ===';

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

  },
  "./modal-ui": function(module, exports, __require) {
    const require = (spec) => __require(".", spec);
    'use strict';

    const {
      QUICK_TEMPLATES,
      extractAuthFromSpec,
      buildAuthHeaders,
      parseSmartMcpInput,
      validateAndBuildServerSpec,
      formatArgsForEditor,
      formatKeyValueForEditor,
      normalizeMcpConfigObject,
    } = require('./mcp-config-schema');

    const MODAL_ID = 'agy-mcp-manager-modal-backdrop';
    const EDIT_POPUP_ID = 'agy-mcp-edit-popup-backdrop';
    const OAUTH_MODAL_ID = 'agy-mcp-oauth-connect-backdrop';
    const STYLE_ID = 'agy-mcp-manager-styles';

    function isAuthErrorText(errText) {
      if (!errText || typeof errText !== 'string') return false;
      return /unauthorized|401|403|forbidden|authentication|unauthenticated|invalid[_\s-]?token|missing.*authorization|bearer|api[_\s-]?key|oauth/i.test(
        errText
      );
    }

    function ensureModalStyles(doc) {
      if (!doc || !doc.head) return;
      let style = doc.getElementById(STYLE_ID);
      if (!style) {
        style = doc.createElement('style');
        style.id = STYLE_ID;
        doc.head.appendChild(style);
      }
      style.textContent = `
        #${MODAL_ID}, #${EDIT_POPUP_ID}, #${OAUTH_MODAL_ID} {
          position: fixed;
          inset: 0;
          z-index: 2147483645;
          background: rgba(9, 11, 17, 0.75);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif;
          color: #e4e7ef;
          padding: 20px;
          box-sizing: border-box;
        }
        #${EDIT_POPUP_ID} {
          z-index: 2147483646;
        }
        #${OAUTH_MODAL_ID} {
          z-index: 2147483647;
        }
        #${MODAL_ID} *, #${EDIT_POPUP_ID} *, #${OAUTH_MODAL_ID} *, #agy-mcp-settings-pane * {
          box-sizing: border-box;
        }
        .agy-mcp-dialog {
          width: min(860px, 96vw);
          max-height: min(800px, 92vh);
          background: #161821;
          border: 1px solid #2c3144;
          border-radius: 14px;
          box-shadow: 0 22px 60px rgba(0, 0, 0, 0.65);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .agy-mcp-dialog.popup {
          width: min(640px, 95vw);
          max-height: min(780px, 92vh);
          border-color: #3b425e;
        }
        .agy-mcp-dialog.oauth-connect {
          width: min(440px, 94vw);
          background: #181a24;
          border: 1px solid #32384e;
          border-radius: 20px;
          padding: 26px 24px 22px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 14px;
          position: relative;
        }
        .agy-mcp-oauth-icons {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-top: 4px;
        }
        .agy-mcp-oauth-icon-box {
          width: 52px;
          height: 52px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          font-weight: 700;
          background: #232738;
          border: 1px solid #383f58;
          color: #f8fafc;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
        }
        .agy-mcp-oauth-icon-box.brand {
          background: linear-gradient(135deg, #4f46e5, #3730a3);
          border-color: #6366f1;
        }
        .agy-mcp-oauth-dots {
          color: #64748b;
          font-size: 18px;
          letter-spacing: 2px;
          font-weight: 700;
        }
        .agy-mcp-oauth-title {
          font-size: 20px;
          font-weight: 700;
          color: #f8fafc;
          margin: 2px 0 0 0;
        }
        .agy-mcp-oauth-desc {
          font-size: 12.5px;
          line-height: 1.55;
          color: #94a3b8;
          text-align: left;
          background: rgba(255, 255, 255, 0.025);
          border: 1px solid rgba(148, 163, 184, 0.14);
          border-radius: 10px;
          padding: 12px 14px;
          width: 100%;
        }
        .agy-mcp-oauth-full-btn {
          width: 100%;
          padding: 11px 16px;
          border-radius: 999px;
          font-size: 13.5px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all 0.14s ease;
        }
        .agy-mcp-oauth-full-btn.launch {
          background: #4f46e5;
          border-color: #6366f1;
          color: #ffffff;
        }
        .agy-mcp-oauth-full-btn.launch:hover {
          background: #4338ca;
        }
        .agy-mcp-oauth-full-btn.cancel {
          background: #25293a;
          border-color: #383f58;
          color: #e2e8f0;
        }
        .agy-mcp-oauth-full-btn.cancel:hover {
          background: #2f354a;
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
          border-radius: 7px;
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
          border-radius: 10px;
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
          border-radius: 6px;
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
          font-size: 12.5px;
          font-weight: 600;
          color: #e2e8f0;
        }
        .agy-mcp-hint {
          font-size: 11.5px;
          color: #8b95b0;
          line-height: 1.45;
        }
        .agy-mcp-input, .agy-mcp-textarea, .agy-mcp-select {
          width: 100%;
          background: #12151f;
          border: 1px solid #2d3348;
          border-radius: 8px;
          padding: 8px 11px;
          color: #f1f5f9;
          font-size: 12.5px;
          font-family: inherit;
        }
        .agy-mcp-textarea {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          min-height: 70px;
          resize: vertical;
        }
        .agy-mcp-input:focus, .agy-mcp-textarea:focus, .agy-mcp-select:focus {
          outline: none;
          border-color: #6366f1;
        }
        .agy-mcp-segmented {
          display: inline-flex;
          align-items: center;
          background: #11141d;
          border: 1px solid #2b3147;
          border-radius: 999px;
          padding: 2px;
          gap: 2px;
        }
        .agy-mcp-seg-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 11.5px;
          font-weight: 600;
          padding: 4px 12px;
          border-radius: 999px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .agy-mcp-seg-btn.active {
          background: #272d42;
          color: #f8fafc;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
        }
        .agy-mcp-adv-oauth-card {
          background: #191d2b;
          border: 1px solid #2d344d;
          border-radius: 10px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .agy-mcp-adv-oauth-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          cursor: pointer;
          user-select: none;
        }
        .agy-mcp-risk-notice {
          background: rgba(245, 158, 11, 0.08);
          border: 1px solid rgba(245, 158, 11, 0.28);
          border-radius: 10px;
          padding: 10px 13px;
          font-size: 11.5px;
          color: #fcd34d;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          line-height: 1.45;
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
        .agy-mcp-btn.auth {
          background: rgba(99, 102, 241, 0.18);
          border-color: rgba(99, 102, 241, 0.48);
          color: #c7d2fe;
        }
        .agy-mcp-btn.auth:hover {
          background: rgba(99, 102, 241, 0.3);
          border-color: rgba(99, 102, 241, 0.7);
        }
        .agy-mcp-inline-row-btn {
          background: #252a3d;
          color: #e2e8f0;
          border: 1px solid #3b425e;
          border-radius: 5px;
          padding: 2px 8px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          line-height: 1.4;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .agy-mcp-inline-row-btn:hover {
          background: #323954;
          border-color: #525d82;
          color: #ffffff;
        }
        .agy-mcp-inline-row-btn.auth {
          background: rgba(99, 102, 241, 0.18);
          border-color: rgba(99, 102, 241, 0.48);
          color: #c7d2fe;
        }
        .agy-mcp-inline-row-btn.auth:hover {
          background: rgba(99, 102, 241, 0.32);
          border-color: rgba(99, 102, 241, 0.75);
        }
        .agy-mcp-auth-box {
          background: rgba(99, 102, 241, 0.06);
          border: 1px solid rgba(99, 102, 241, 0.28);
          border-radius: 10px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
      `;
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

    function formatSpecPreview(spec, runtimeState) {
      if (!spec || typeof spec !== 'object') return '(managed by plugin)';
      if (spec.url || spec.serverUrl) {
        const hasCustomAuthHdr = Boolean(
          spec.headers &&
          Object.keys(spec.headers).some((k) =>
            /^(?:authorization|x-api-key|api-key|x-auth-token|x-mcp-token|x-access-token)$/i.test(k)
          )
        );
        const hasOAuth = Boolean(runtimeState?.hasAuthToken || runtimeState?.authUrl || spec.oauth);
        const suffix = runtimeState?.hasAuthToken
          ? '  [🔗 OAuth Connected]'
          : hasCustomAuthHdr
          ? '  [🔑 Auth Header Configured]'
          : hasOAuth
          ? '  [🔗 OAuth]'
          : '';
        return `HTTP ${spec.url || spec.serverUrl}${suffix}`;
      }
      const cmd = spec.command || '';
      const args = Array.isArray(spec.args) ? spec.args.join(' ') : '';
      return `${cmd} ${args}`.trim() || '(empty command)';
    }

    function createDefaultFormState() {
      return {
        originalName: '',
        serverName: '',
        description: '',
        transport: 'http',
        command: 'npx',
        argsText: '',
        envText: '',
        cwd: '',
        url: '',
        headersText: '',
        authMode: 'oauth',
        oauthClientMode: 'auto',
        oauthClientId: '',
        oauthClientSecret: '',
        oauthScopes: '',
        advancedOAuthOpen: false,
        bearerToken: '',
        apiKeyHeader: 'X-API-Key',
        apiKeyValue: '',
        basicUser: '',
        basicPass: '',
        oauthCode: '',
        showSecret: false,
        applyAuthToAllHttp: false,
        disabled: false,
      };
    }

    function createModalController({ doc, bridge, onStateChanged }) {
      let activeTab = 'servers'; // 'servers' | 'editor' | 'raw'
      let editingForm = createDefaultFormState();
      let popupForm = createDefaultFormState();
      let cachedConfig = { uri: '', rawText: '{\n  "mcpServers": {}\n}\n', config: { mcpServers: {} } };
      let cachedStates = [];
      let bannerState = { type: '', message: '' };
      let popupBannerState = { type: '', message: '' };
      let oauthPollTimer = null;

      function setBanner(type, message) {
        bannerState = { type, message };
        renderBanner();
      }

      function setPopupBanner(type, message) {
        popupBannerState = { type, message };
        renderPopupBanner();
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

      function renderPopupBanner() {
        const backdrop = doc.getElementById(EDIT_POPUP_ID);
        if (!backdrop) return;
        const banner = backdrop.querySelector('.agy-mcp-status-banner');
        if (!banner) return;
        banner.className = 'agy-mcp-status-banner';
        if (popupBannerState.type && popupBannerState.message) {
          banner.classList.add(popupBannerState.type);
          banner.textContent = popupBannerState.message;
        } else {
          banner.textContent = '';
        }
      }

      function findRuntimeState(serverName) {
        if (!serverName) return null;
        return (
          cachedStates.find(
            (st) => st && (st.serverName === serverName || st.spec?.serverName === serverName)
          ) || null
        );
      }

      function refreshEmbeddedSettingsPaneIfVisible() {
        const pane = doc.getElementById('agy-mcp-settings-pane');
        if (pane && pane.style.display !== 'none') {
          renderSettingsPageContent(pane);
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
          refreshEmbeddedSettingsPaneIfVisible();
        } catch (err) {
          setBanner('error', `Failed to load MCP configuration: ${err.message || err}`);
        }
      }

      function buildFormStateFromSpec(serverName, spec, options = {}) {
        const runtimeState = findRuntimeState(serverName);
        const effectiveSpec = spec || runtimeState?.spec || {};
        const hasExplicitCmd = Boolean(effectiveSpec && typeof effectiveSpec.command === 'string' && effectiveSpec.command.trim());
        const hasExplicitUrl = Boolean(effectiveSpec && (effectiveSpec.url || effectiveSpec.serverUrl || effectiveSpec.type === 'http'));
        const isHttp = hasExplicitUrl || (!hasExplicitCmd && !serverName);
        const extractedAuth = extractAuthFromSpec(isHttp ? { ...effectiveSpec, url: effectiveSpec.url || effectiveSpec.serverUrl || 'https://example.com/mcp' } : effectiveSpec);
        const authMode = extractedAuth.authMode || (isHttp ? 'oauth' : 'none');

        return {
          originalName: serverName || '',
          serverName: serverName || '',
          description: (effectiveSpec && typeof effectiveSpec.description === 'string') ? effectiveSpec.description : '',
          transport: isHttp ? 'http' : 'stdio',
          command: effectiveSpec && effectiveSpec.command ? effectiveSpec.command : 'npx',
          argsText: formatArgsForEditor(effectiveSpec && effectiveSpec.args),
          envText: formatKeyValueForEditor(effectiveSpec && effectiveSpec.env, '='),
          cwd: effectiveSpec && effectiveSpec.cwd ? effectiveSpec.cwd : '',
          url: (effectiveSpec && (effectiveSpec.url || effectiveSpec.serverUrl)) || '',
          headersText: formatKeyValueForEditor(
            (authMode === 'none' || authMode === 'oauth' || authMode === 'oauth_or_none')
              ? extractedAuth.extraHeaders
              : extractedAuth.extraHeaders,
            ': '
          ),
          authMode,
          oauthClientMode: extractedAuth.oauthClientMode || 'auto',
          oauthClientId: extractedAuth.oauthClientId || '',
          oauthClientSecret: extractedAuth.oauthClientSecret || '',
          oauthScopes: extractedAuth.oauthScopes || '',
          advancedOAuthOpen: Boolean(extractedAuth.oauthClientId || extractedAuth.oauthClientSecret || options.focusAuth),
          bearerToken: extractedAuth.bearerToken,
          apiKeyHeader: extractedAuth.apiKeyHeader || 'X-API-Key',
          apiKeyValue: extractedAuth.apiKeyValue,
          basicUser: extractedAuth.basicUser,
          basicPass: extractedAuth.basicPass,
          oauthCode: '',
          showSecret: false,
          applyAuthToAllHttp: false,
          disabled: Boolean(effectiveSpec && effectiveSpec.disabled),
        };
      }

      function populateFormFromSpec(serverName, spec, options = {}) {
        editingForm = buildFormStateFromSpec(serverName, spec, options);
      }

      function resetForm() {
        editingForm = createDefaultFormState();
      }

      function closeOAuthConnectModal() {
        if (oauthPollTimer) {
          clearInterval(oauthPollTimer);
          oauthPollTimer = null;
        }
        const backdrop = doc.getElementById(OAUTH_MODAL_ID);
        if (backdrop && backdrop.parentNode) {
          backdrop.parentNode.removeChild(backdrop);
        }
      }

      function isOAuthConnectModalOpen() {
        return Boolean(doc.getElementById(OAUTH_MODAL_ID));
      }

      async function openOAuthConnectModal(serverName, initialAuthUrl = '') {
        ensureModalStyles(doc);
        closeOAuthConnectModal();
        await reloadData();

        let st = findRuntimeState(serverName);
        if (!initialAuthUrl && (!st || (!st.authUrl && !st.hasAuthToken)) && typeof bridge.waitForServerOAuthOrReady === 'function') {
          st = await bridge.waitForServerOAuthOrReady(serverName, 2500);
          await reloadData();
        }
        const authUrl = initialAuthUrl || st?.authUrl || '';

        const backdrop = doc.createElement('div');
        backdrop.id = OAUTH_MODAL_ID;
        backdrop.setAttribute('data-testid', 'agy-mcp-oauth-connect-modal');
        backdrop.setAttribute('data-agy-custom-mcp-btn', 'oauth-modal');
        backdrop.addEventListener('click', (e) => {
          if (e.target === backdrop) closeOAuthConnectModal();
        });

        const dialog = doc.createElement('div');
        dialog.className = 'agy-mcp-dialog oauth-connect';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-label', `Connect ${serverName}`);

        const closeBtn = doc.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'agy-mcp-close-btn';
        closeBtn.style.position = 'absolute';
        closeBtn.style.top = '14px';
        closeBtn.style.right = '14px';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => closeOAuthConnectModal());
        dialog.appendChild(closeBtn);

        const iconsRow = doc.createElement('div');
        iconsRow.className = 'agy-mcp-oauth-icons';
        const brandIcon = doc.createElement('div');
        brandIcon.className = 'agy-mcp-oauth-icon-box brand';
        brandIcon.textContent = 'A';
        const dots = doc.createElement('span');
        dots.className = 'agy-mcp-oauth-dots';
        dots.textContent = '•••';
        const mcpIcon = doc.createElement('div');
        mcpIcon.className = 'agy-mcp-oauth-icon-box';
        mcpIcon.textContent = '🔗';
        iconsRow.appendChild(brandIcon);
        iconsRow.appendChild(dots);
        iconsRow.appendChild(mcpIcon);
        dialog.appendChild(iconsRow);

        const titleEl = doc.createElement('h2');
        titleEl.className = 'agy-mcp-oauth-title';
        titleEl.textContent = `Connect ${serverName}`;
        dialog.appendChild(titleEl);

        const descEl = doc.createElement('div');
        descEl.className = 'agy-mcp-oauth-desc';
        descEl.textContent =
          `Antigravity uses browser OAuth authentication to interact with the "${serverName}" MCP server. Click Connect below to sign in and authorize access in your browser.`;
        dialog.appendChild(descEl);

        const statusLine = doc.createElement('div');
        statusLine.className = 'agy-mcp-hint';
        statusLine.style.color = authUrl ? '#a5b4fc' : '#fcd34d';
        statusLine.textContent = authUrl
          ? 'OAuth authorization URL is ready.'
          : 'Checking OAuth authorization URL from host...';
        dialog.appendChild(statusLine);

        const codeSection = doc.createElement('div');
        codeSection.style.display = 'flex';
        codeSection.style.width = '100%';
        codeSection.style.flexDirection = 'column';
        codeSection.style.gap = '6px';

        const codeInputRow = doc.createElement('div');
        codeInputRow.style.display = 'flex';
        codeInputRow.style.gap = '6px';
        codeInputRow.style.width = '100%';

        const codeInput = doc.createElement('input');
        codeInput.type = 'text';
        codeInput.className = 'agy-mcp-input';
        codeInput.style.flex = '1';
        codeInput.setAttribute('data-field', 'oauthModalCode');
        codeInput.placeholder = 'Paste authorization code here if shown in browser (optional)';

        const codeSubmitBtn = doc.createElement('button');
        codeSubmitBtn.type = 'button';
        codeSubmitBtn.className = 'agy-mcp-btn primary';
        codeSubmitBtn.textContent = 'Submit Code';
        codeSubmitBtn.addEventListener('click', async () => {
          const code = codeInput.value.trim();
          if (!code) return;
          statusLine.style.color = '#93c5fd';
          statusLine.textContent = 'Submitting OAuth authorization code...';
          const res = await bridge.completeOAuth(serverName, code);
          if (!res || !res.ok) {
            statusLine.style.color = '#fca5a5';
            statusLine.textContent = (res && res.error) || 'Failed to submit OAuth authorization code.';
            return;
          }
          await reloadData();
          closeOAuthConnectModal();
          setBanner('success', `OAuth authentication and connection completed for "${serverName}".`);
          if (isOpen()) renderModalContent();
          if (isEditPopupOpen()) renderEditPopupBody();
        });

        codeInputRow.appendChild(codeInput);
        codeInputRow.appendChild(codeSubmitBtn);
        codeSection.appendChild(codeInputRow);
        dialog.appendChild(codeSection);

        const launchBtn = doc.createElement('button');
        launchBtn.type = 'button';
        launchBtn.className = 'agy-mcp-oauth-full-btn launch';
        launchBtn.setAttribute('data-testid', 'agy-mcp-oauth-launch-btn');
        launchBtn.textContent = `Connect ${serverName} ↗`;
        launchBtn.addEventListener('click', async () => {
          let targetUrl = authUrl;
          if (!targetUrl && typeof bridge.waitForServerOAuthOrReady === 'function') {
            statusLine.textContent = 'Requesting OAuth session from host...';
            await bridge.refreshServers(serverName);
            const refreshedState = await bridge.waitForServerOAuthOrReady(serverName, 3500);
            targetUrl = refreshedState?.authUrl || '';
          }
          if (targetUrl) {
            bridge.openAuthUrl(targetUrl);
            statusLine.style.color = '#6ee7b7';
            statusLine.textContent = 'Opened OAuth authorization window in your browser. It will connect automatically once signed in.';
            codeSection.style.display = 'flex';
            if (oauthPollTimer) clearInterval(oauthPollTimer);
            let ticks = 0;
            oauthPollTimer = setInterval(async () => {
              ticks++;
              if (ticks > 60 || !isOAuthConnectModalOpen()) {
                clearInterval(oauthPollTimer);
                oauthPollTimer = null;
                return;
              }
              await reloadData();
              const cur = findRuntimeState(serverName);
              if (cur && (cur.hasAuthToken || cur.status === 2)) {
                clearInterval(oauthPollTimer);
                oauthPollTimer = null;
                closeOAuthConnectModal();
                setBanner('success', `OAuth authentication and connection completed for "${serverName}".`);
                if (isOpen()) renderModalContent();
                if (isEditPopupOpen()) renderEditPopupBody();
              }
            }, 1200);
          } else {
            statusLine.style.color = '#fca5a5';
            statusLine.textContent =
              'Could not retrieve OAuth authorization URL (authUrl) from host. Verify that the server URL supports OAuth Discovery (/.well-known/oauth-authorization-server).';
          }
        });
        dialog.appendChild(launchBtn);

        const cancelBtn = doc.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'agy-mcp-oauth-full-btn cancel';
        cancelBtn.setAttribute('data-testid', 'agy-mcp-oauth-cancel-btn');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => closeOAuthConnectModal());
        dialog.appendChild(cancelBtn);

        backdrop.appendChild(dialog);
        doc.body.appendChild(backdrop);
      }

      function renderSmartAutoAddBar(container) {
        const box = doc.createElement('div');
        box.className = 'agy-mcp-card';
        box.style.background = 'rgba(79, 70, 229, 0.09)';
        box.style.borderColor = 'rgba(99, 102, 241, 0.38)';

        const label = doc.createElement('div');
        label.className = 'agy-mcp-label';
        label.textContent = '⚡ Quick Auto-Add (Enter MCP Portal / Server URL, GitHub/npm Address, Command, or JSON):';
        box.appendChild(label);

        const row = doc.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '8px';
        row.style.alignItems = 'center';
        row.style.flexWrap = 'wrap';

        const input = doc.createElement('input');
        input.type = 'text';
        input.className = 'agy-mcp-input';
        input.style.flex = '1';
        input.style.minWidth = '240px';
        input.setAttribute('data-testid', 'agy-mcp-smart-input');
        input.placeholder = 'https://example.com/mcp (OAuth auto-discovered), https://github.com/owner/repo, or npx -y ...';

        async function handleQuickConnect() {
          const parsed = parseSmartMcpInput(input.value);
          if (!parsed.ok) {
            setBanner('error', parsed.error);
            return;
          }
          try {
            if (parsed.multipleServers) {
              const names = Object.keys(parsed.multipleServers);
              setBanner('info', `Saving ${names.length} MCP servers (${names.join(', ')})...`);
              const nextServers = {
                ...((cachedConfig.config && cachedConfig.config.mcpServers) || {}),
                ...parsed.multipleServers,
              };
              const writeRes = await bridge.writeMcpConfig({
                ...(cachedConfig.config || {}),
                mcpServers: nextServers,
              });
              if (writeRes && writeRes.ok === false) {
                setBanner('error', writeRes.error);
                return;
              }
              await reloadData();
              setBanner('success', `Automatically configured and connected ${names.length} servers: ${names.join(', ')}.`);
            } else {
              setBanner('info', `Auto-configuring "${parsed.serverName}"...`);
              const res = await bridge.upsertCustomServer(parsed.serverName, parsed.spec);
              if (res && res.ok === false) {
                setBanner('error', res.error);
                return;
              }
              let st = null;
              if ((parsed.spec?.url || parsed.spec?.serverUrl) && typeof bridge.waitForServerOAuthOrReady === 'function') {
                st = await bridge.waitForServerOAuthOrReady(parsed.serverName, 3000);
              }
              await reloadData();
              st = st || findRuntimeState(parsed.serverName);
              if (st && st.authUrl && !st.hasAuthToken) {
                setBanner('info', `OAuth authentication detected for "${parsed.serverName}". Complete sign-in in the connection dialog.`);
                openOAuthConnectModal(parsed.serverName, st.authUrl);
              } else {
                setBanner('success', `Automatically added and connected "${parsed.serverName}".`);
              }
            }
            input.value = '';
            activeTab = 'servers';
            if (isOpen()) renderModalContent();
          } catch (err) {
            setBanner('error', err.message || String(err));
          }
        }

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleQuickConnect();
          }
        });

        const autoConnectBtn = doc.createElement('button');
        autoConnectBtn.type = 'button';
        autoConnectBtn.className = 'agy-mcp-btn primary';
        autoConnectBtn.setAttribute('data-testid', 'agy-mcp-smart-add-btn');
        autoConnectBtn.textContent = 'Auto-Add & Connect';
        autoConnectBtn.addEventListener('click', handleQuickConnect);

        const fillFormBtn = doc.createElement('button');
        fillFormBtn.type = 'button';
        fillFormBtn.className = 'agy-mcp-btn';
        fillFormBtn.setAttribute('data-testid', 'agy-mcp-smart-fill-btn');
        fillFormBtn.textContent = 'Auto-Fill Form';
        fillFormBtn.addEventListener('click', () => {
          const parsed = parseSmartMcpInput(input.value);
          if (!parsed.ok) {
            setBanner('error', parsed.error);
            return;
          }
          populateFormFromSpec(parsed.serverName, parsed.spec);
          activeTab = 'editor';
          setBanner('info', `Auto-filled form for "${parsed.serverName}". Review OAuth / connection settings below.`);
          if (isOpen()) renderModalContent();
        });

        row.appendChild(input);
        row.appendChild(autoConnectBtn);
        row.appendChild(fillFormBtn);
        box.appendChild(row);
        container.appendChild(box);
      }

      function renderAuthFieldsSection(container, formObj, runtimeState, reRenderFn, bannerFn) {
        const authBox = doc.createElement('div');
        authBox.className = 'agy-mcp-auth-box';
        authBox.setAttribute('data-testid', 'agy-mcp-auth-section');

        const authField = doc.createElement('div');
        authField.className = 'agy-mcp-field full';

        const titleEl = doc.createElement('label');
        titleEl.className = 'agy-mcp-label';
        titleEl.textContent = 'Authentication';
        authField.appendChild(titleEl);

        const modeSelect = doc.createElement('select');
        modeSelect.className = 'agy-mcp-select';
        modeSelect.setAttribute('data-field', 'authMode');
        const authOptions = [
          { value: 'oauth', label: 'OAuth' },
          { value: 'none', label: 'No Authentication' },
          { value: 'oauth_or_none', label: 'OAuth or No Authentication' },
          { value: 'bearer', label: 'Bearer Token (Authorization: Bearer <token>)' },
          { value: 'apiKey', label: 'API Key Header (X-API-Key or Custom Header)' },
          { value: 'basic', label: 'Basic Auth (Username & Password)' },
        ];
        for (const opt of authOptions) {
          const o = doc.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          modeSelect.appendChild(o);
        }
        modeSelect.value = formObj.authMode || (formObj.transport === 'http' ? 'oauth' : 'none');
        modeSelect.addEventListener('change', (e) => {
          formObj.authMode = e.target.value;
          reRenderFn();
        });
        authField.appendChild(modeSelect);
        authBox.appendChild(authField);

        if (formObj.authMode === 'oauth' || formObj.authMode === 'oauth_or_none') {
          const authUrl = runtimeState?.authUrl || '';
          const hasToken = Boolean(runtimeState?.hasAuthToken);
          const activeServerName = formObj.serverName || formObj.originalName;

          // Instant OAuth Connect bar if server is already registered or has authUrl
          if (authUrl || hasToken || activeServerName) {
            const quickOAuthBar = doc.createElement('div');
            quickOAuthBar.style.display = 'flex';
            quickOAuthBar.style.alignItems = 'center';
            quickOAuthBar.style.justifyContent = 'space-between';
            quickOAuthBar.style.flexWrap = 'wrap';
            quickOAuthBar.style.gap = '8px';
            quickOAuthBar.style.padding = '8px 11px';
            quickOAuthBar.style.borderRadius = '8px';
            quickOAuthBar.style.background = hasToken ? 'rgba(16, 185, 129, 0.12)' : 'rgba(79, 70, 229, 0.14)';
            quickOAuthBar.style.border = hasToken
              ? '1px solid rgba(16, 185, 129, 0.35)'
              : '1px solid rgba(99, 102, 241, 0.38)';

            const statusTxt = doc.createElement('span');
            statusTxt.style.fontSize = '12px';
            statusTxt.style.color = hasToken ? '#6ee7b7' : '#c7d2fe';
            statusTxt.textContent = hasToken
              ? `● OAuth Connected (${activeServerName})`
              : authUrl
              ? `🔗 OAuth Ready — Sign in to "${activeServerName}" in your browser.`
              : 'Automatically detects MCP portal OAuth settings and opens the sign-in window after saving.';
            quickOAuthBar.appendChild(statusTxt);

            const btnWrap = doc.createElement('div');
            btnWrap.style.display = 'flex';
            btnWrap.style.gap = '6px';

            if (activeServerName && !hasToken) {
              const connectBtn = doc.createElement('button');
              connectBtn.type = 'button';
              connectBtn.className = 'agy-mcp-btn primary';
              connectBtn.setAttribute('data-testid', 'agy-mcp-open-oauth-connect-btn');
              connectBtn.textContent = `Connect ${activeServerName} ↗`;
              connectBtn.addEventListener('click', () => {
                openOAuthConnectModal(activeServerName, authUrl);
              });
              btnWrap.appendChild(connectBtn);
            }

            if (hasToken && activeServerName) {
              const signOutBtn = doc.createElement('button');
              signOutBtn.type = 'button';
              signOutBtn.className = 'agy-mcp-btn danger';
              signOutBtn.textContent = 'Disconnect OAuth';
              signOutBtn.addEventListener('click', async () => {
                const res = await bridge.disconnectOAuth(activeServerName);
                if (!res || !res.ok) {
                  bannerFn('error', (res && res.error) || 'Failed to disconnect OAuth.');
                  return;
                }
                await reloadData();
                bannerFn('info', `Disconnected OAuth for "${activeServerName}".`);
                reRenderFn();
              });
              btnWrap.appendChild(signOutBtn);
            }

            quickOAuthBar.appendChild(btnWrap);
            authBox.appendChild(quickOAuthBar);
          }

          // Collapsible "Advanced OAuth Settings" card matching ChatGPT's UI
          const advCard = doc.createElement('div');
          advCard.className = 'agy-mcp-adv-oauth-card';

          const advHeader = doc.createElement('div');
          advHeader.className = 'agy-mcp-adv-oauth-header';
          advHeader.setAttribute('data-testid', 'agy-mcp-advanced-oauth-toggle');

          const advLeft = doc.createElement('div');
          advLeft.style.display = 'flex';
          advLeft.style.flexDirection = 'column';
          advLeft.style.gap = '3px';

          const advTitle = doc.createElement('div');
          advTitle.className = 'agy-mcp-label';
          advTitle.textContent = 'Advanced OAuth Settings';

          const advSub = doc.createElement('div');
          advSub.className = 'agy-mcp-hint';
          advSub.textContent =
            'Review auto-detected OAuth settings or enter custom credentials, select client configuration mode, and set default scopes.';

          advLeft.appendChild(advTitle);
          advLeft.appendChild(advSub);

          const advArrow = doc.createElement('span');
          advArrow.style.fontSize = '16px';
          advArrow.style.color = '#94a3b8';
          advArrow.textContent = formObj.advancedOAuthOpen ? '⌄' : '›';

          advHeader.appendChild(advLeft);
          advHeader.appendChild(advArrow);
          advHeader.addEventListener('click', () => {
            formObj.advancedOAuthOpen = !formObj.advancedOAuthOpen;
            reRenderFn();
          });
          advCard.appendChild(advHeader);

          if (formObj.advancedOAuthOpen) {
            const advBody = doc.createElement('div');
            advBody.style.display = 'flex';
            advBody.style.flexDirection = 'column';
            advBody.style.gap = '10px';
            advBody.style.paddingTop = '8px';
            advBody.style.borderTop = '1px solid #2b324a';

            const clientModeField = doc.createElement('div');
            clientModeField.className = 'agy-mcp-field';
            const cmLbl = doc.createElement('label');
            cmLbl.className = 'agy-mcp-label';
            cmLbl.textContent = 'Client Configuration';
            const cmSelect = doc.createElement('select');
            cmSelect.className = 'agy-mcp-select';
            cmSelect.setAttribute('data-field', 'oauthClientMode');
            const optAuto = doc.createElement('option');
            optAuto.value = 'auto';
            optAuto.textContent = 'Automatic Discovery & Dynamic Client Registration';
            const optCustom = doc.createElement('option');
            optCustom.value = 'custom';
            optCustom.textContent = 'Custom Client ID & Secret';
            cmSelect.appendChild(optAuto);
            cmSelect.appendChild(optCustom);
            cmSelect.value = formObj.oauthClientMode || 'auto';
            cmSelect.addEventListener('change', (e) => {
              formObj.oauthClientMode = e.target.value;
              reRenderFn();
            });
            clientModeField.appendChild(cmLbl);
            clientModeField.appendChild(cmSelect);
            advBody.appendChild(clientModeField);

            if (formObj.oauthClientMode === 'custom') {
              const grid = doc.createElement('div');
              grid.className = 'agy-mcp-form-grid';

              const cidField = doc.createElement('div');
              cidField.className = 'agy-mcp-field';
              const cidLbl = doc.createElement('label');
              cidLbl.className = 'agy-mcp-label';
              cidLbl.textContent = 'Client ID';
              const cidInput = doc.createElement('input');
              cidInput.className = 'agy-mcp-input';
              cidInput.setAttribute('data-field', 'oauthClientId');
              cidInput.placeholder = 'OAuth Client ID';
              cidInput.value = formObj.oauthClientId || '';
              cidInput.addEventListener('input', (e) => {
                formObj.oauthClientId = e.target.value;
              });
              cidField.appendChild(cidLbl);
              cidField.appendChild(cidInput);

              const csecField = doc.createElement('div');
              csecField.className = 'agy-mcp-field';
              const csecLbl = doc.createElement('label');
              csecLbl.className = 'agy-mcp-label';
              csecLbl.textContent = 'Client Secret (Optional)';
              const csecInput = doc.createElement('input');
              csecInput.type = 'password';
              csecInput.className = 'agy-mcp-input';
              csecInput.setAttribute('data-field', 'oauthClientSecret');
              csecInput.placeholder = 'OAuth Client Secret (optional)';
              csecInput.value = formObj.oauthClientSecret || '';
              csecInput.addEventListener('input', (e) => {
                formObj.oauthClientSecret = e.target.value;
              });
              csecField.appendChild(csecLbl);
              csecField.appendChild(csecInput);

              grid.appendChild(cidField);
              grid.appendChild(csecField);
              advBody.appendChild(grid);
            }

            const scopeField = doc.createElement('div');
            scopeField.className = 'agy-mcp-field';
            const scopeLbl = doc.createElement('label');
            scopeLbl.className = 'agy-mcp-label';
            scopeLbl.textContent = 'Default Scopes (Optional)';
            const scopeInput = doc.createElement('input');
            scopeInput.className = 'agy-mcp-input';
            scopeInput.setAttribute('data-field', 'oauthScopes');
            scopeInput.placeholder = 'Auto-detected (e.g. openid profile mcp:tools)';
            scopeInput.value = formObj.oauthScopes || '';
            scopeInput.addEventListener('input', (e) => {
              formObj.oauthScopes = e.target.value;
            });
            scopeField.appendChild(scopeLbl);
            scopeField.appendChild(scopeInput);
            advBody.appendChild(scopeField);

            // Manual authorization code fallback row
            const manualCodeRow = doc.createElement('div');
            manualCodeRow.style.display = 'flex';
            manualCodeRow.style.gap = '6px';
            manualCodeRow.style.alignItems = 'center';

            const codeInput = doc.createElement('input');
            codeInput.type = 'text';
            codeInput.className = 'agy-mcp-input';
            codeInput.style.flex = '1';
            codeInput.setAttribute('data-field', 'oauthCode');
            codeInput.placeholder = 'Enter authorization code manually (optional)...';
            codeInput.value = formObj.oauthCode || '';
            codeInput.addEventListener('input', (e) => {
              formObj.oauthCode = e.target.value;
            });

            const submitCodeBtn = doc.createElement('button');
            submitCodeBtn.type = 'button';
            submitCodeBtn.className = 'agy-mcp-btn';
            submitCodeBtn.setAttribute('data-testid', 'agy-mcp-submit-oauth-btn');
            submitCodeBtn.textContent = 'Submit Auth Code';
            submitCodeBtn.addEventListener('click', async () => {
              const targetServer = formObj.serverName || formObj.originalName;
              if (!targetServer) {
                bannerFn('error', 'Save the server first or enter a Server Name before submitting an OAuth code.');
                return;
              }
              const res = await bridge.completeOAuth(targetServer, formObj.oauthCode);
              if (!res || !res.ok) {
                bannerFn('error', (res && res.error) || 'Failed to complete OAuth.');
                return;
              }
              formObj.oauthCode = '';
              await reloadData();
              bannerFn('success', `OAuth authentication completed for "${targetServer}".`);
              reRenderFn();
            });

            manualCodeRow.appendChild(codeInput);
            manualCodeRow.appendChild(submitCodeBtn);
            advBody.appendChild(manualCodeRow);

            advCard.appendChild(advBody);
          }

          authBox.appendChild(advCard);
        } else if (formObj.authMode === 'bearer') {
          const field = doc.createElement('div');
          field.className = 'agy-mcp-field';
          const lbl = doc.createElement('label');
          lbl.className = 'agy-mcp-label';
          lbl.textContent =
            formObj.transport === 'http'
              ? 'Bearer Token (Automatically sets "Authorization: Bearer <token>" header)'
              : 'Auth Token (Automatically sets MCP_AUTH_TOKEN environment variable)';
          const inputRow = doc.createElement('div');
          inputRow.style.display = 'flex';
          inputRow.style.gap = '6px';

          const tokInput = doc.createElement('input');
          tokInput.type = formObj.showSecret ? 'text' : 'password';
          tokInput.className = 'agy-mcp-input';
          tokInput.style.flex = '1';
          tokInput.setAttribute('data-field', 'bearerToken');
          tokInput.placeholder = 'Paste Bearer token here (e.g. eyJhbGci... or mcp_secret_...)';
          tokInput.value = formObj.bearerToken || '';
          tokInput.addEventListener('input', (e) => {
            formObj.bearerToken = e.target.value;
          });

          const toggleVisBtn = doc.createElement('button');
          toggleVisBtn.type = 'button';
          toggleVisBtn.className = 'agy-mcp-btn';
          toggleVisBtn.textContent = formObj.showSecret ? 'Hide' : 'Show';
          toggleVisBtn.addEventListener('click', () => {
            formObj.showSecret = !formObj.showSecret;
            tokInput.type = formObj.showSecret ? 'text' : 'password';
            toggleVisBtn.textContent = formObj.showSecret ? 'Hide' : 'Show';
          });

          inputRow.appendChild(tokInput);
          inputRow.appendChild(toggleVisBtn);
          field.appendChild(lbl);
          field.appendChild(inputRow);
          authBox.appendChild(field);
        } else if (formObj.authMode === 'apiKey') {
          const grid = doc.createElement('div');
          grid.className = 'agy-mcp-form-grid';

          const hdrNameField = doc.createElement('div');
          hdrNameField.className = 'agy-mcp-field';
          const hdrNameLbl = doc.createElement('label');
          hdrNameLbl.className = 'agy-mcp-label';
          hdrNameLbl.textContent = 'Auth Header / Env Key Name';
          const hdrNameInput = doc.createElement('input');
          hdrNameInput.className = 'agy-mcp-input';
          hdrNameInput.setAttribute('data-field', 'apiKeyHeader');
          hdrNameInput.placeholder = 'X-API-Key or Authorization';
          hdrNameInput.value = formObj.apiKeyHeader || 'X-API-Key';
          hdrNameInput.addEventListener('input', (e) => {
            formObj.apiKeyHeader = e.target.value;
          });
          hdrNameField.appendChild(hdrNameLbl);
          hdrNameField.appendChild(hdrNameInput);

          const hdrValField = doc.createElement('div');
          hdrValField.className = 'agy-mcp-field';
          const hdrValLbl = doc.createElement('label');
          hdrValLbl.className = 'agy-mcp-label';
          hdrValLbl.textContent = 'API Key / Secret Value';
          const valRow = doc.createElement('div');
          valRow.style.display = 'flex';
          valRow.style.gap = '6px';
          const hdrValInput = doc.createElement('input');
          hdrValInput.type = formObj.showSecret ? 'text' : 'password';
          hdrValInput.className = 'agy-mcp-input';
          hdrValInput.style.flex = '1';
          hdrValInput.setAttribute('data-field', 'apiKeyValue');
          hdrValInput.placeholder = 'Enter API key value...';
          hdrValInput.value = formObj.apiKeyValue || '';
          hdrValInput.addEventListener('input', (e) => {
            formObj.apiKeyValue = e.target.value;
          });
          const toggleVisBtn = doc.createElement('button');
          toggleVisBtn.type = 'button';
          toggleVisBtn.className = 'agy-mcp-btn';
          toggleVisBtn.textContent = formObj.showSecret ? 'Hide' : 'Show';
          toggleVisBtn.addEventListener('click', () => {
            formObj.showSecret = !formObj.showSecret;
            hdrValInput.type = formObj.showSecret ? 'text' : 'password';
            toggleVisBtn.textContent = formObj.showSecret ? 'Hide' : 'Show';
          });
          valRow.appendChild(hdrValInput);
          valRow.appendChild(toggleVisBtn);
          hdrValField.appendChild(hdrValLbl);
          hdrValField.appendChild(valRow);

          grid.appendChild(hdrNameField);
          grid.appendChild(hdrValField);
          authBox.appendChild(grid);
        } else if (formObj.authMode === 'basic') {
          const grid = doc.createElement('div');
          grid.className = 'agy-mcp-form-grid';

          const uField = doc.createElement('div');
          uField.className = 'agy-mcp-field';
          const uLbl = doc.createElement('label');
          uLbl.className = 'agy-mcp-label';
          uLbl.textContent = 'Username';
          const uInput = doc.createElement('input');
          uInput.className = 'agy-mcp-input';
          uInput.setAttribute('data-field', 'basicUser');
          uInput.placeholder = 'Username';
          uInput.value = formObj.basicUser || '';
          uInput.addEventListener('input', (e) => {
            formObj.basicUser = e.target.value;
          });
          uField.appendChild(uLbl);
          uField.appendChild(uInput);

          const pField = doc.createElement('div');
          pField.className = 'agy-mcp-field';
          const pLbl = doc.createElement('label');
          pLbl.className = 'agy-mcp-label';
          pLbl.textContent = 'Password';
          const pInput = doc.createElement('input');
          pInput.type = formObj.showSecret ? 'text' : 'password';
          pInput.className = 'agy-mcp-input';
          pInput.setAttribute('data-field', 'basicPass');
          pInput.placeholder = 'Password';
          pInput.value = formObj.basicPass || '';
          pInput.addEventListener('input', (e) => {
            formObj.basicPass = e.target.value;
          });
          pField.appendChild(pLbl);
          pField.appendChild(pInput);

          grid.appendChild(uField);
          grid.appendChild(pField);
          authBox.appendChild(grid);
        }

        // Batch apply checkbox when multiple custom HTTP servers exist and custom header auth is selected
        const customServers = (cachedConfig.config && cachedConfig.config.mcpServers) || {};
        const httpServerNames = Object.keys(customServers).filter((k) =>
          Boolean(customServers[k]?.url || customServers[k]?.serverUrl)
        );
        if (
          formObj.transport === 'http' &&
          (formObj.authMode === 'bearer' || formObj.authMode === 'apiKey' || formObj.authMode === 'basic') &&
          httpServerNames.length > 1
        ) {
          const batchLabel = doc.createElement('label');
          batchLabel.style.display = 'inline-flex';
          batchLabel.style.alignItems = 'center';
          batchLabel.style.gap = '6px';
          batchLabel.style.fontSize = '11.5px';
          batchLabel.style.color = '#c7d2fe';
          batchLabel.style.cursor = 'pointer';

          const batchChk = doc.createElement('input');
          batchChk.type = 'checkbox';
          batchChk.setAttribute('data-field', 'applyAuthToAllHttp');
          batchChk.checked = Boolean(formObj.applyAuthToAllHttp);
          batchChk.addEventListener('change', (e) => {
            formObj.applyAuthToAllHttp = e.target.checked;
          });

          const batchSpan = doc.createElement('span');
          batchSpan.textContent = `Apply this authentication to all ${httpServerNames.length} custom HTTP servers (${httpServerNames.join(', ')})`;
          batchLabel.appendChild(batchChk);
          batchLabel.appendChild(batchSpan);
          authBox.appendChild(batchLabel);
        }

        container.appendChild(authBox);
      }

      function renderServerConnectionFields(container, formObj, reRenderFn) {
        const grid = doc.createElement('div');
        grid.className = 'agy-mcp-form-grid';

        // 1. Name
        const nameField = doc.createElement('div');
        nameField.className = 'agy-mcp-field full';
        const nameLabel = doc.createElement('label');
        nameLabel.className = 'agy-mcp-label';
        nameLabel.textContent = 'Name';
        const nameInput = doc.createElement('input');
        nameInput.className = 'agy-mcp-input';
        nameInput.setAttribute('data-field', 'serverName');
        nameInput.placeholder = 'Custom tool name (auto-generated from Server URL if left blank)';
        nameInput.value = formObj.serverName;
        nameInput.addEventListener('input', (e) => {
          formObj.serverName = e.target.value;
        });
        nameField.appendChild(nameLabel);
        nameField.appendChild(nameInput);
        grid.appendChild(nameField);

        // 2. Description (Optional)
        const descField = doc.createElement('div');
        descField.className = 'agy-mcp-field full';
        const descLabel = doc.createElement('label');
        descLabel.className = 'agy-mcp-label';
        descLabel.textContent = 'Description (Optional)';
        const descInput = doc.createElement('input');
        descInput.className = 'agy-mcp-input';
        descInput.setAttribute('data-field', 'description');
        descInput.placeholder = 'Briefly describe what this server does';
        descInput.value = formObj.description || '';
        descInput.addEventListener('input', (e) => {
          formObj.description = e.target.value;
        });
        descField.appendChild(descLabel);
        descField.appendChild(descInput);
        grid.appendChild(descField);

        // 3. Connection header + Segmented toggle (Connection: Server URL | Local / Tunnel (Stdio))
        const connHeaderField = doc.createElement('div');
        connHeaderField.className = 'agy-mcp-field full';
        const connTopRow = doc.createElement('div');
        connTopRow.style.display = 'flex';
        connTopRow.style.alignItems = 'center';
        connTopRow.style.justifyContent = 'space-between';
        connTopRow.style.gap = '10px';

        const connLabel = doc.createElement('label');
        connLabel.className = 'agy-mcp-label';
        connLabel.textContent = 'Connection';

        const segWrap = doc.createElement('div');
        segWrap.className = 'agy-mcp-segmented';

        const segHttpBtn = doc.createElement('button');
        segHttpBtn.type = 'button';
        segHttpBtn.className = `agy-mcp-seg-btn${formObj.transport === 'http' ? ' active' : ''}`;
        segHttpBtn.textContent = 'Server URL';
        segHttpBtn.addEventListener('click', () => {
          formObj.transport = 'http';
          if (!formObj.authMode || formObj.authMode === 'none') {
            formObj.authMode = 'oauth';
          }
          reRenderFn();
        });

        const segStdioBtn = doc.createElement('button');
        segStdioBtn.type = 'button';
        segStdioBtn.className = `agy-mcp-seg-btn${formObj.transport === 'stdio' ? ' active' : ''}`;
        segStdioBtn.textContent = 'Local / Tunnel (Stdio)';
        segStdioBtn.addEventListener('click', () => {
          formObj.transport = 'stdio';
          reRenderFn();
        });

        segWrap.appendChild(segHttpBtn);
        segWrap.appendChild(segStdioBtn);

        // Keep hidden/accessible select for [data-field="transport"] programmatic compatibility
        const transSelect = doc.createElement('select');
        transSelect.className = 'agy-mcp-select';
        transSelect.style.display = 'none';
        transSelect.setAttribute('data-field', 'transport');
        const optHttp = doc.createElement('option');
        optHttp.value = 'http';
        optHttp.textContent = 'Streamable HTTP / Remote URL';
        const optStdio = doc.createElement('option');
        optStdio.value = 'stdio';
        optStdio.textContent = 'Stdio (Local Process: npx / uvx / node / python / docker)';
        transSelect.appendChild(optHttp);
        transSelect.appendChild(optStdio);
        transSelect.value = formObj.transport;
        transSelect.addEventListener('change', (e) => {
          formObj.transport = e.target.value;
          reRenderFn();
        });

        connTopRow.appendChild(connLabel);
        connTopRow.appendChild(segWrap);
        connHeaderField.appendChild(connTopRow);
        connHeaderField.appendChild(transSelect);

        if (formObj.transport === 'http') {
          const urlInput = doc.createElement('input');
          urlInput.className = 'agy-mcp-input';
          urlInput.setAttribute('data-field', 'url');
          urlInput.placeholder = 'https://example.com/mcp';
          urlInput.value = formObj.url;
          urlInput.addEventListener('input', (e) => {
            formObj.url = e.target.value;
          });
          connHeaderField.appendChild(urlInput);
          grid.appendChild(connHeaderField);
        } else {
          grid.appendChild(connHeaderField);

          const cmdField = doc.createElement('div');
          cmdField.className = 'agy-mcp-field';
          const cmdLabel = doc.createElement('label');
          cmdLabel.className = 'agy-mcp-label';
          cmdLabel.textContent = 'Command Executable';
          const cmdInput = doc.createElement('input');
          cmdInput.className = 'agy-mcp-input';
          cmdInput.setAttribute('data-field', 'command');
          cmdInput.placeholder = 'npx, uvx, node, python, docker...';
          cmdInput.value = formObj.command;
          cmdInput.addEventListener('input', (e) => {
            formObj.command = e.target.value;
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
          cwdInput.value = formObj.cwd;
          cwdInput.addEventListener('input', (e) => {
            formObj.cwd = e.target.value;
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
          argsArea.value = formObj.argsText;
          argsArea.addEventListener('input', (e) => {
            formObj.argsText = e.target.value;
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
          envArea.value = formObj.envText;
          envArea.addEventListener('input', (e) => {
            formObj.envText = e.target.value;
          });
          envField.appendChild(envLabel);
          envField.appendChild(envArea);
          grid.appendChild(envField);
        }

        container.appendChild(grid);
      }

      async function saveServerForm(formObj, bannerFn) {
        const built = validateAndBuildServerSpec(formObj);
        if (!built.ok) {
          bannerFn('error', built.error);
          return { ok: false, error: built.error };
        }
        bannerFn('info', `Saving "${built.serverName}" to mcp_config.json...`);
        const res = await bridge.upsertCustomServer(built.serverName, built.spec, formObj.originalName);
        if (res && res.ok === false) {
          bannerFn('error', res.error || 'Failed to save server');
          return res;
        }

        if (formObj.applyAuthToAllHttp && formObj.transport === 'http') {
          const authHeadersOnly = buildAuthHeaders({
            authMode: formObj.authMode,
            bearerToken: formObj.bearerToken,
            apiKeyHeader: formObj.apiKeyHeader,
            apiKeyValue: formObj.apiKeyValue,
            basicUser: formObj.basicUser,
            basicPass: formObj.basicPass,
            baseHeaders: {},
          });
          if (Object.keys(authHeadersOnly).length > 0 && typeof bridge.applyAuthHeadersToServers === 'function') {
            await bridge.applyAuthHeadersToServers(null, authHeadersOnly);
          }
        }

        let st = null;
        if (
          formObj.transport === 'http' &&
          (formObj.authMode === 'oauth' || formObj.authMode === 'oauth_or_none') &&
          typeof bridge.waitForServerOAuthOrReady === 'function'
        ) {
          st = await bridge.waitForServerOAuthOrReady(built.serverName, 3000);
        }

        await reloadData();
        st = st || findRuntimeState(built.serverName);

        if (
          formObj.transport === 'http' &&
          (formObj.authMode === 'oauth' || formObj.authMode === 'oauth_or_none') &&
          st &&
          st.authUrl &&
          !st.hasAuthToken
        ) {
          bannerFn('info', `OAuth sign-in window is ready for "${built.serverName}".`);
          openOAuthConnectModal(built.serverName, st.authUrl);
        } else {
          bannerFn('success', `Saved and triggered reload for "${built.serverName}".`);
        }

        return { ok: true, serverName: built.serverName, spec: built.spec, runtimeState: st };
      }

      function renderServerCardsList(container, customBannerFn = setBanner) {
        const customMap = (cachedConfig.config && cachedConfig.config.mcpServers) || {};
        const stateByName = new Map();
        for (const st of cachedStates) {
          const sName = st && (st.serverName || st.spec?.serverName);
          if (sName) {
            stateByName.set(sName, st);
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
          empty.textContent = 'No custom MCP servers configured yet. Click "+ Add Custom MCP Server" to register a remote OAuth MCP portal or local Stdio server.';
          container.appendChild(empty);
          return;
        }

        for (const name of allServerNames) {
          const customSpec = customMap[name] || null;
          const runtimeState = stateByName.get(name) || null;
          const isCustom = Boolean(customSpec);
          const isDisabled = Boolean((customSpec && customSpec.disabled) || (runtimeState && runtimeState.status === 4));
          const pill = statusPillInfo(runtimeState ? runtimeState.status : 0, isDisabled);
          const hasOAuthUrl = Boolean(runtimeState?.authUrl && !runtimeState?.hasAuthToken);
          const needsAuth = Boolean(hasOAuthUrl || (runtimeState && isAuthErrorText(runtimeState.error)));

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

          if (hasOAuthUrl) {
            const oauthConnectBtn = doc.createElement('button');
            oauthConnectBtn.type = 'button';
            oauthConnectBtn.className = 'agy-mcp-btn primary';
            oauthConnectBtn.setAttribute('data-testid', `agy-mcp-oauth-connect-btn-${name}`);
            oauthConnectBtn.textContent = `🔗 Connect ${name} ↗`;
            oauthConnectBtn.addEventListener('click', () => {
              openOAuthConnectModal(name, runtimeState.authUrl);
            });
            actionsRow.appendChild(oauthConnectBtn);
          }

          if (isCustom || needsAuth) {
            const authBtn = doc.createElement('button');
            authBtn.type = 'button';
            authBtn.className = `agy-mcp-btn${needsAuth ? ' auth' : ''}`;
            authBtn.setAttribute('data-testid', `agy-mcp-auth-btn-${name}`);
            authBtn.textContent = hasOAuthUrl ? '⚙️ OAuth Settings' : '🔑 Authenticate';
            authBtn.addEventListener('click', () => {
              if (hasOAuthUrl) {
                openOAuthConnectModal(name, runtimeState.authUrl);
              } else {
                openEditPopup(name, { focusAuth: true });
              }
            });
            actionsRow.appendChild(authBtn);
          }

          const toggleBtn = doc.createElement('button');
          toggleBtn.className = 'agy-mcp-btn';
          toggleBtn.textContent = isDisabled ? 'Enable' : 'Disable';
          toggleBtn.addEventListener('click', async () => {
            try {
              await bridge.toggleServerEnabled(name, isDisabled);
              await reloadData();
              customBannerFn('success', `Server "${name}" ${isDisabled ? 'enabled' : 'disabled'}.`);
              if (isOpen()) renderBody();
            } catch (err) {
              customBannerFn('error', `Failed to toggle "${name}": ${err.message || err}`);
            }
          });
          actionsRow.appendChild(toggleBtn);

          const restartBtn = doc.createElement('button');
          restartBtn.className = 'agy-mcp-btn';
          restartBtn.textContent = '↻ Restart';
          restartBtn.addEventListener('click', async () => {
            customBannerFn('info', `Restarting "${name}"...`);
            await bridge.refreshServers(name);
            await reloadData();
            customBannerFn('success', `Restarted "${name}".`);
            if (isOpen()) renderBody();
          });
          actionsRow.appendChild(restartBtn);

          if (isCustom) {
            const editBtn = doc.createElement('button');
            editBtn.className = 'agy-mcp-btn';
            editBtn.setAttribute('data-testid', `agy-mcp-edit-btn-${name}`);
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', () => {
              openEditPopup(name);
            });
            actionsRow.appendChild(editBtn);

            const delBtn = doc.createElement('button');
            delBtn.className = 'agy-mcp-btn danger';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async () => {
              try {
                await bridge.deleteCustomServer(name);
                await reloadData();
                customBannerFn('success', `Removed custom server "${name}".`);
                if (isOpen()) renderBody();
              } catch (err) {
                customBannerFn('error', `Failed to delete "${name}": ${err.message || err}`);
              }
            });
            actionsRow.appendChild(delBtn);
          }

          topRow.appendChild(actionsRow);
          card.appendChild(topRow);

          const preview = doc.createElement('div');
          preview.className = 'agy-mcp-cmd-preview';
          preview.textContent = formatSpecPreview(customSpec || (runtimeState && runtimeState.spec), runtimeState);
          card.appendChild(preview);

          if (runtimeState && runtimeState.error) {
            const errBox = doc.createElement('div');
            errBox.style.display = 'flex';
            errBox.style.alignItems = 'center';
            errBox.style.justifyContent = 'space-between';
            errBox.style.gap = '8px';
            errBox.style.flexWrap = 'wrap';
            errBox.style.fontSize = '11.5px';
            errBox.style.color = '#fca5a5';

            const errMsg = doc.createElement('span');
            errMsg.textContent = `Error: ${runtimeState.error}`;
            errBox.appendChild(errMsg);

            if (needsAuth || isCustom) {
              const fixAuthBtn = doc.createElement('button');
              fixAuthBtn.type = 'button';
              fixAuthBtn.className = 'agy-mcp-inline-row-btn auth';
              fixAuthBtn.textContent = hasOAuthUrl ? `🔗 Connect ${name} ↗` : '⚙️ Edit Settings / Connect OAuth';
              fixAuthBtn.addEventListener('click', () => {
                if (hasOAuthUrl) {
                  openOAuthConnectModal(name, runtimeState.authUrl);
                } else {
                  openEditPopup(name, { focusAuth: true });
                }
              });
              errBox.appendChild(fixAuthBtn);
            }
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
                    customBannerFn('success', `Tool "${toolName}" on "${name}" ${isToolDisabled ? 'enabled' : 'disabled'}.`);
                    if (isOpen()) renderBody();
                  } catch (err) {
                    customBannerFn('error', `Failed to toggle tool: ${err.message || err}`);
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

      function renderServersTab(container) {
        renderSmartAutoAddBar(container);

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
        btnGroup.style.flexWrap = 'wrap';

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

        const editPopupBtn = doc.createElement('button');
        editPopupBtn.className = 'agy-mcp-btn';
        editPopupBtn.setAttribute('data-testid', 'agy-mcp-open-edit-popup-btn');
        editPopupBtn.textContent = '⚙️ Edit Custom MCP Settings';
        editPopupBtn.addEventListener('click', () => {
          openEditPopup(customNames[0] || '');
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
        btnGroup.appendChild(editPopupBtn);
        btnGroup.appendChild(addBtn);
        topActions.appendChild(btnGroup);
        container.appendChild(topActions);

        renderServerCardsList(container, setBanner);
      }

      function renderEditorTab(container) {
        renderSmartAutoAddBar(container);

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
              ...createDefaultFormState(),
              originalName: editingForm.originalName,
              serverName: tpl.serverName,
              description: tpl.description || '',
              transport: tpl.transport,
              command: tpl.command || 'npx',
              argsText: formatArgsForEditor(tpl.args || []),
              envText: formatKeyValueForEditor(tpl.env || {}, '='),
              cwd: tpl.cwd || '',
              url: tpl.url || '',
              headersText: formatKeyValueForEditor(tpl.headers || {}, ': '),
              authMode: tpl.transport === 'http' ? 'oauth' : 'none',
              disabled: false,
            };
            setBanner('info', `Loaded preset "${tpl.label}".`);
            renderBody();
          });
          tplBar.appendChild(btn);
        }
        templateSection.appendChild(tplBar);
        container.appendChild(templateSection);

        const runtimeState = findRuntimeState(editingForm.serverName || editingForm.originalName);
        renderServerConnectionFields(container, editingForm, renderBody);
        renderAuthFieldsSection(container, editingForm, runtimeState, renderBody, setBanner);

        const riskBox = doc.createElement('div');
        riskBox.className = 'agy-mcp-risk-notice';
        riskBox.textContent =
          '⚠️ Custom MCP servers carry risks. Only connect to MCP servers you trust.';
        container.appendChild(riskBox);

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
            const res = await saveServerForm(editingForm, setBanner);
            if (!res.ok) return;
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

      function renderEditPopupBody() {
        const backdrop = doc.getElementById(EDIT_POPUP_ID);
        if (!backdrop) return;
        const body = backdrop.querySelector('.agy-mcp-body');
        if (!body) return;
        while (body.firstChild) body.removeChild(body.firstChild);

        const customMap = (cachedConfig.config && cachedConfig.config.mcpServers) || {};
        const customNames = Object.keys(customMap);
        const activeName = popupForm.originalName || popupForm.serverName;
        const runtimeState = findRuntimeState(activeName);

        // Server selector bar at top of popup
        const selectorCard = doc.createElement('div');
        selectorCard.className = 'agy-mcp-card';
        selectorCard.style.background = '#191d2b';

        const selectorRow = doc.createElement('div');
        selectorRow.style.display = 'flex';
        selectorRow.style.alignItems = 'center';
        selectorRow.style.justifyContent = 'space-between';
        selectorRow.style.gap = '10px';
        selectorRow.style.flexWrap = 'wrap';

        const selLabel = doc.createElement('label');
        selLabel.className = 'agy-mcp-label';
        selLabel.textContent = 'Select Custom MCP Server to Edit:';
        selectorRow.appendChild(selLabel);

        const sel = doc.createElement('select');
        sel.className = 'agy-mcp-select';
        sel.style.flex = '1';
        sel.style.minWidth = '220px';
        sel.setAttribute('data-field', 'popupServerSelect');

        const newOpt = doc.createElement('option');
        newOpt.value = '';
        newOpt.textContent = '+ Add Custom MCP Server (New Custom MCP Server)';
        sel.appendChild(newOpt);

        const allCandidateNames = Array.from(new Set([...customNames, ...(activeName ? [activeName] : [])]));
        for (const sName of allCandidateNames) {
          const opt = doc.createElement('option');
          opt.value = sName;
          opt.textContent = sName;
          sel.appendChild(opt);
        }
        sel.value = activeName || '';
        sel.addEventListener('change', (e) => {
          const chosen = e.target.value;
          if (!chosen) {
            popupForm = createDefaultFormState();
          } else {
            popupForm = buildFormStateFromSpec(chosen, customMap[chosen]);
          }
          popupBannerState = { type: '', message: '' };
          renderPopupBanner();
          renderEditPopupBody();
        });
        selectorRow.appendChild(sel);
        selectorCard.appendChild(selectorRow);

        if (runtimeState) {
          const stRow = doc.createElement('div');
          stRow.style.display = 'flex';
          stRow.style.alignItems = 'center';
          stRow.style.gap = '8px';
          stRow.style.flexWrap = 'wrap';
          stRow.style.fontSize = '11.5px';

          const pill = statusPillInfo(runtimeState.status, Boolean(popupForm.disabled));
          const badge = doc.createElement('span');
          badge.className = `agy-mcp-pill ${pill.cls}`;
          badge.textContent = pill.label;
          stRow.appendChild(badge);

          if (runtimeState.error) {
            const errSpan = doc.createElement('span');
            errSpan.style.color = '#fca5a5';
            errSpan.textContent = `Error: ${runtimeState.error}`;
            stRow.appendChild(errSpan);
          } else if (runtimeState.status === 2) {
            const okSpan = doc.createElement('span');
            okSpan.style.color = '#6ee7b7';
            okSpan.textContent = `Connected (${Array.isArray(runtimeState.tools) ? runtimeState.tools.length : 0} tools available)`;
            stRow.appendChild(okSpan);
          }
          selectorCard.appendChild(stRow);
        }

        body.appendChild(selectorCard);

        renderServerConnectionFields(body, popupForm, renderEditPopupBody);
        renderAuthFieldsSection(body, popupForm, runtimeState, renderEditPopupBody, setPopupBanner);

        const riskBox = doc.createElement('div');
        riskBox.className = 'agy-mcp-risk-notice';
        riskBox.textContent =
          '⚠️ Custom MCP servers carry risks. Only connect to MCP servers you trust.';
        body.appendChild(riskBox);

        const footerRow = doc.createElement('div');
        footerRow.style.display = 'flex';
        footerRow.style.justifyContent = 'space-between';
        footerRow.style.alignItems = 'center';
        footerRow.style.gap = '10px';
        footerRow.style.flexWrap = 'wrap';
        footerRow.style.marginTop = '6px';

        const leftControls = doc.createElement('div');
        leftControls.style.display = 'flex';
        leftControls.style.alignItems = 'center';
        leftControls.style.gap = '10px';

        const chkLabel = doc.createElement('label');
        chkLabel.style.display = 'inline-flex';
        chkLabel.style.alignItems = 'center';
        chkLabel.style.gap = '6px';
        chkLabel.style.fontSize = '12px';
        chkLabel.style.cursor = 'pointer';
        const chk = doc.createElement('input');
        chk.type = 'checkbox';
        chk.checked = Boolean(popupForm.disabled);
        chk.addEventListener('change', (e) => {
          popupForm.disabled = e.target.checked;
        });
        const chkText = doc.createElement('span');
        chkText.textContent = 'Save as disabled initially';
        chkLabel.appendChild(chk);
        chkLabel.appendChild(chkText);
        leftControls.appendChild(chkLabel);

        if (popupForm.originalName && customMap[popupForm.originalName]) {
          const delBtn = doc.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'agy-mcp-btn danger';
          delBtn.setAttribute('data-testid', 'agy-mcp-popup-delete-btn');
          delBtn.textContent = 'Delete Server';
          delBtn.addEventListener('click', async () => {
            try {
              await bridge.deleteCustomServer(popupForm.originalName);
              await reloadData();
              if (isOpen()) renderModalContent();
              const remaining = Object.keys((cachedConfig.config && cachedConfig.config.mcpServers) || {});
              if (remaining.length > 0) {
                popupForm = buildFormStateFromSpec(remaining[0], cachedConfig.config.mcpServers[remaining[0]]);
                setPopupBanner('success', 'Deleted custom server.');
                renderEditPopupBody();
              } else {
                closeEditPopup();
              }
            } catch (err) {
              setPopupBanner('error', err.message || String(err));
            }
          });
          leftControls.appendChild(delBtn);
        }

        footerRow.appendChild(leftControls);

        const rightBtns = doc.createElement('div');
        rightBtns.style.display = 'flex';
        rightBtns.style.gap = '8px';

        const openFullBtn = doc.createElement('button');
        openFullBtn.type = 'button';
        openFullBtn.className = 'agy-mcp-btn';
        openFullBtn.textContent = 'Open Full Manager';
        openFullBtn.addEventListener('click', () => {
          closeEditPopup();
          openModal('servers');
        });

        const cancelBtn = doc.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'agy-mcp-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => closeEditPopup());

        const saveBtn = doc.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'agy-mcp-btn primary';
        saveBtn.setAttribute('data-testid', 'agy-mcp-popup-save-btn');
        saveBtn.textContent = popupForm.originalName ? 'Save & Reconnect' : 'Create & Connect';
        saveBtn.addEventListener('click', async () => {
          try {
            const res = await saveServerForm(popupForm, setPopupBanner);
            if (!res.ok) return;
            popupForm = buildFormStateFromSpec(res.serverName, res.spec);
            renderEditPopupBody();
            if (isOpen()) renderModalContent();
          } catch (err) {
            setPopupBanner('error', err.message || String(err));
          }
        });

        rightBtns.appendChild(openFullBtn);
        rightBtns.appendChild(cancelBtn);
        rightBtns.appendChild(saveBtn);
        footerRow.appendChild(rightBtns);
        body.appendChild(footerRow);
      }

      async function openEditPopup(serverName = '', options = {}) {
        ensureModalStyles(doc);
        popupBannerState = { type: '', message: '' };
        await reloadData();

        const customMap = (cachedConfig.config && cachedConfig.config.mcpServers) || {};
        const customNames = Object.keys(customMap);
        const targetName = serverName !== undefined && serverName !== null && serverName !== ''
          ? serverName
          : (options.createNew ? '' : (customNames[0] || ''));
        const targetSpec = targetName ? customMap[targetName] : null;
        popupForm = buildFormStateFromSpec(targetName, targetSpec, options);

        let backdrop = doc.getElementById(EDIT_POPUP_ID);
        if (!backdrop) {
          backdrop = doc.createElement('div');
          backdrop.id = EDIT_POPUP_ID;
          backdrop.setAttribute('data-testid', 'agy-mcp-edit-popup');
          backdrop.setAttribute('data-agy-custom-mcp-btn', 'edit-popup');
          backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeEditPopup();
          });

          const dialog = doc.createElement('div');
          dialog.className = 'agy-mcp-dialog popup';
          dialog.setAttribute('role', 'dialog');
          dialog.setAttribute('aria-label', 'Add or Edit Custom MCP Server');

          const header = doc.createElement('div');
          header.className = 'agy-mcp-header';
          const titleWrap = doc.createElement('div');
          titleWrap.className = 'agy-mcp-title-wrap';
          const title = doc.createElement('h2');
          title.className = 'agy-mcp-title';
          title.textContent = targetName ? '⚙️ Edit Custom MCP Server Settings' : 'Add Custom MCP Server';
          const badge = doc.createElement('span');
          badge.className = 'agy-mcp-badge';
          badge.textContent = 'OAuth & Custom MCP';
          titleWrap.appendChild(title);
          titleWrap.appendChild(badge);

          const closeBtn = doc.createElement('button');
          closeBtn.type = 'button';
          closeBtn.className = 'agy-mcp-close-btn';
          closeBtn.setAttribute('aria-label', 'Close Edit Popup');
          closeBtn.textContent = '✕';
          closeBtn.addEventListener('click', () => closeEditPopup());

          header.appendChild(titleWrap);
          header.appendChild(closeBtn);
          dialog.appendChild(header);

          const banner = doc.createElement('div');
          banner.className = 'agy-mcp-status-banner';
          dialog.appendChild(banner);

          const body = doc.createElement('div');
          body.className = 'agy-mcp-body';
          dialog.appendChild(body);

          backdrop.appendChild(dialog);
          doc.body.appendChild(backdrop);
        }

        renderPopupBanner();
        renderEditPopupBody();
      }

      function closeEditPopup() {
        const backdrop = doc.getElementById(EDIT_POPUP_ID);
        if (backdrop && backdrop.parentNode) {
          backdrop.parentNode.removeChild(backdrop);
        }
      }

      function isEditPopupOpen() {
        return Boolean(doc.getElementById(EDIT_POPUP_ID));
      }

      // Render full Settings page content when user selects "MCP 서버" tab inside native Settings modal (.settings-modal-container)
      function renderSettingsPageContent(container) {
        if (!container) return;
        ensureModalStyles(doc);
        while (container.firstChild) container.removeChild(container.firstChild);

        const wrapper = doc.createElement('div');
        wrapper.className = 'p-6 flex flex-col gap-5 w-full max-w-2xl mx-auto';
        wrapper.style.padding = '24px';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.gap = '18px';
        wrapper.style.maxWidth = '720px';
        wrapper.style.margin = '0 auto';

        const pageHdr = doc.createElement('div');
        pageHdr.style.display = 'flex';
        pageHdr.style.alignItems = 'flex-start';
        pageHdr.style.justifyContent = 'space-between';
        pageHdr.style.gap = '12px';
        pageHdr.style.flexWrap = 'wrap';

        const titleCol = doc.createElement('div');
        titleCol.style.display = 'flex';
        titleCol.style.flexDirection = 'column';
        titleCol.style.gap = '4px';

        const h2 = doc.createElement('h2');
        h2.style.fontSize = '20px';
        h2.style.fontWeight = '600';
        h2.style.margin = '0';
        h2.style.color = '#f8fafc';
        h2.textContent = 'MCP Servers';

        const sub = doc.createElement('div');
        sub.style.fontSize = '13px';
        sub.style.color = '#94a3b8';
        sub.textContent = 'Register, authenticate, and manage remote OAuth MCP portals and local (Stdio) custom MCP servers.';

        titleCol.appendChild(h2);
        titleCol.appendChild(sub);
        pageHdr.appendChild(titleCol);

        const hdrActions = doc.createElement('div');
        hdrActions.style.display = 'flex';
        hdrActions.style.gap = '8px';
        hdrActions.style.flexWrap = 'wrap';

        const addPopupBtn = doc.createElement('button');
        addPopupBtn.type = 'button';
        addPopupBtn.className = 'agy-mcp-btn primary';
        addPopupBtn.setAttribute('data-testid', 'agy-mcp-settings-add-btn');
        addPopupBtn.textContent = '+ Add Custom MCP Server';
        addPopupBtn.addEventListener('click', () => {
          openEditPopup('', { createNew: true });
        });

        const editPopupBtn = doc.createElement('button');
        editPopupBtn.type = 'button';
        editPopupBtn.className = 'agy-mcp-btn';
        editPopupBtn.setAttribute('data-testid', 'agy-mcp-settings-edit-btn');
        editPopupBtn.textContent = '⚙️ Edit Server Settings';
        editPopupBtn.addEventListener('click', () => {
          openEditPopup();
        });

        const rawModalBtn = doc.createElement('button');
        rawModalBtn.type = 'button';
        rawModalBtn.className = 'agy-mcp-btn';
        rawModalBtn.textContent = '{ } Edit mcp_config.json';
        rawModalBtn.addEventListener('click', () => {
          openModal('raw');
        });

        const refreshBtn = doc.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'agy-mcp-btn';
        refreshBtn.textContent = '↻ Refresh';
        refreshBtn.addEventListener('click', async () => {
          await bridge.refreshServers();
          await reloadData();
        });

        hdrActions.appendChild(addPopupBtn);
        hdrActions.appendChild(editPopupBtn);
        hdrActions.appendChild(rawModalBtn);
        hdrActions.appendChild(refreshBtn);
        pageHdr.appendChild(hdrActions);
        wrapper.appendChild(pageHdr);

        renderSmartAutoAddBar(wrapper);
        renderServerCardsList(wrapper, setBanner);

        container.appendChild(wrapper);
      }

      async function openModal(initialTab = 'servers') {
        ensureModalStyles(doc);
        activeTab = initialTab;
        bannerState = { type: '', message: '' };

        let backdrop = doc.getElementById(MODAL_ID);
        if (!backdrop) {
          backdrop = doc.createElement('div');
          backdrop.id = MODAL_ID;
          backdrop.setAttribute('data-agy-custom-mcp-btn', 'main-modal');
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
        openEditPopup,
        closeEditPopup,
        isEditPopupOpen,
        openOAuthConnectModal,
        closeOAuthConnectModal,
        isOAuthConnectModalOpen,
        renderSettingsPageContent,
        reloadData,
        getCachedState: () => ({ config: cachedConfig.config, states: cachedStates }),
      };
    }

    module.exports = {
      MODAL_ID,
      EDIT_POPUP_ID,
      OAUTH_MODAL_ID,
      STYLE_ID,
      isAuthErrorText,
      ensureModalStyles,
      createModalController,
    };

  },
  "./index": function(module, exports, __require) {
    const require = (spec) => __require(".", spec);
    'use strict';

    const schema = require('./mcp-config-schema');
    const { createHostMcpBridge } = require('./host-mcp-bridge');
    const {
      MODAL_ID,
      EDIT_POPUP_ID,
      OAUTH_MODAL_ID,
      ensureModalStyles,
      createModalController,
    } = require('./modal-ui');

    const MCP_MANAGER_VERSION = 'v1.4.1';
    const NATIVE_BTN_ATTR = 'data-agy-custom-mcp-btn';

    function extractServerNameFromRow(row) {
      if (!row || typeof row.querySelector !== 'function') return '';
      const fixBtn = row.querySelector('[data-testid="mcp-server-fix-with-agent"]');
      if (fixBtn) {
        const aria = fixBtn.getAttribute('aria-label') || '';
        const m = /^Fix with Agent:\s*(.+)$/i.exec(aria.trim());
        if (m && m[1]) return m[1].trim();
      }
      const buttons = row.querySelectorAll('button[aria-label]');
      for (let i = 0; i < buttons.length; i++) {
        const aria = buttons[i].getAttribute('aria-label') || '';
        const m = /^More actions for\s+(.+)$/i.exec(aria.trim());
        if (m && m[1]) return m[1].trim();
      }
      const topLine = row.firstElementChild;
      const leftGroup = topLine && topLine.firstElementChild ? topLine.firstElementChild : row;
      const nameSpan = leftGroup.querySelector('span');
      if (nameSpan) {
        const fromTitle = (nameSpan.getAttribute('title') || '').trim();
        if (fromTitle && !/blocked by organization/i.test(fromTitle)) {
          return fromTitle;
        }
        const fromText = (nameSpan.textContent || '').trim();
        if (fromText) return fromText;
      }
      return '';
    }

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

    function isOwnMcpNode(node) {
      let cur = node;
      while (cur && cur.nodeType === 1) {
        if (
          cur.id === MODAL_ID ||
          cur.id === EDIT_POPUP_ID ||
          cur.id === OAUTH_MODAL_ID ||
          cur.id === 'agy-mcp-settings-pane' ||
          (typeof cur.hasAttribute === 'function' && cur.hasAttribute(NATIVE_BTN_ATTR))
        ) {
          return true;
        }
        cur = cur.parentElement || cur.parentNode;
      }
      return false;
    }

    function isRelevantMutationList(mutations) {
      if (!Array.isArray(mutations) || mutations.length === 0) return true;
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (!m) continue;
        if (!isOwnMcpNode(m.target)) {
          const added = m.addedNodes;
          if (!added || added.length === 0) return true;
          for (let j = 0; j < added.length; j++) {
            if (!isOwnMcpNode(added[j])) return true;
          }
        }
      }
      return false;
    }

    function ensureRemoteCompanionScripts(win, doc, bridge) {
      try {
        const isRemoteWeb =
          Boolean(win?.location?.hostname && String(win.location.hostname).includes('antigravity.google.com')) ||
          Boolean(doc?.querySelector?.('ga-remote-control'));
        if (!isRemoteWeb || !doc?.head) return Promise.resolve({ loaded: [] });

        const execScriptText = (code) => {
          if (!code || !doc.head) return false;
          const s = doc.createElement('script');
          const nonceEl = doc.querySelector?.('script[nonce]');
          const nonce = nonceEl ? nonceEl.nonce || nonceEl.getAttribute?.('nonce') : '';
          if (nonce) s.nonce = nonce;
          let policy = win.__agyTrustedTypesPolicy || null;
          if (!policy && win.trustedTypes && typeof win.trustedTypes.createPolicy === 'function') {
            try {
              policy = win.trustedTypes.createPolicy('agy-companion-' + Date.now(), {
                createScript: (x) => x,
              });
              win.__agyTrustedTypesPolicy = policy;
            } catch (_e) {}
          }
          s.text = policy ? policy.createScript(code) : code;
          doc.head.appendChild(s);
          return true;
        };

        const injectRemoteOrHostFallback = async (flagKey, url, hostCodeFallback) => {
          if (win[flagKey]) return false;
          win[flagKey] = true;
          try {
            if (typeof win.fetch === 'function') {
              const r = await win.fetch(`${url}?t=${Date.now()}`);
              const code = r && r.ok ? await r.text() : '';
              if (code && execScriptText(code)) return true;
            }
          } catch (_e) {}
          if (hostCodeFallback && execScriptText(hostCodeFallback)) {
            return true;
          }
          win[flagKey] = false;
          return false;
        };

        return Promise.resolve(
          bridge && typeof bridge.fetchHostInstalledPluginInfo === 'function'
            ? bridge.fetchHostInstalledPluginInfo()
            : null
        )
          .then(async (info) => {
            const loaded = [];
            if (!info) return { loaded };

            if (info.hasStatusbar && !win.agyStatusBar) {
              const ok = await injectRemoteOrHostFallback(
                '__agyLoadingStatusBarCompanion',
                'https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/main/dist/statusbar_autoinject.js',
                info.statusbarBlock
              );
              if (ok) loaded.push('antigravity-statusbar');
            }
            if (info.hasKoTranslator && !win.__agyKoThoughtCleanup) {
              const ok = await injectRemoteOrHostFallback(
                '__agyLoadingKoThoughtCompanion',
                'https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/plugins/ko-thought-translator/scripts/ko_thought_autoinject.js',
                info.koBlock
              );
              if (ok) loaded.push('ko-thought-translator');
            }
            return { loaded, hostInfo: info };
          })
          .catch(() => ({ loaded: [] }));
      } catch (_e) {
        return Promise.resolve({ loaded: [] });
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

      const bridge = env.bridge || createHostMcpBridge({ window: win, document: doc });
      const modal = createModalController({
        doc,
        bridge,
      });

      async function handleServerAuthenticateAction(serverName) {
        if (!serverName) {
          modal.openEditPopup('', { focusAuth: true });
          return;
        }
        try {
          const statesRes = await bridge.fetchServerStates();
          const states = Array.isArray(statesRes)
            ? statesRes
            : (statesRes && Array.isArray(statesRes.states) ? statesRes.states : []);
          const matched = states.find(
            (s) => s && (s.serverName === serverName || s.spec?.serverName === serverName)
          );
          if (matched && matched.authUrl) {
            modal.openOAuthConnectModal(serverName, matched.authUrl);
            return;
          }
        } catch (_e) {
          // fallback to edit popup
        }
        modal.openEditPopup(serverName, { focusAuth: true });
      }

      // Inject "MCP Servers" sidebar tab inside Antigravity's Settings modal (.settings-modal-container),
      // matching the exact DOM wrapper structure of native nav items & KoTranslator without ever re-appending.
      function ensureNativeSettingsModalIntegration() {
        if (!doc.body) return;
        const settingsModal = doc.querySelector('.settings-modal-container');
        if (!settingsModal) return;

        const modelsNavBtn = settingsModal.querySelector('button[data-testid="settings-nav-item-Models"]');
        if (!modelsNavBtn) return;

        const navGroup =
          modelsNavBtn.closest('.flex.flex-col.gap-0\\.5') ||
          modelsNavBtn.parentElement?.parentElement ||
          modelsNavBtn.parentElement;
        if (!navGroup) return;

        // IMPORTANT: If button already exists in settingsModal, DO NOT move or re-append it!
        // Re-appending inside MutationObserver causes an infinite microtask loop that freezes the app.
        let mcpNavBtn = settingsModal.querySelector('button[data-testid="settings-nav-item-McpManager"]');
        if (!mcpNavBtn) {
          const navWrap = doc.createElement('div');
          navWrap.className = 'relative group/nav-item mx-2 agy-mcp-settings-root';
          navWrap.setAttribute(NATIVE_BTN_ATTR, 'settings-nav-wrap');

          mcpNavBtn = doc.createElement('button');
          mcpNavBtn.type = 'button';
          mcpNavBtn.setAttribute('data-testid', 'settings-nav-item-McpManager');
          mcpNavBtn.setAttribute(NATIVE_BTN_ATTR, 'settings-nav-item');
          mcpNavBtn.className =
            'flex items-center gap-1.5 w-full px-2 py-1 rounded-lg cursor-pointer border-none text-left transition-all outline-none hover:bg-sidebar-muted';

          const labelSpan = doc.createElement('span');
          labelSpan.className =
            'text-sm transition-colors select-none truncate flex-1 text-secondary-foreground group-hover/nav-item:text-foreground';
          labelSpan.textContent = 'MCP Servers';
          mcpNavBtn.appendChild(labelSpan);
          navWrap.appendChild(mcpNavBtn);

          const koNavBtn = settingsModal.querySelector('button[data-testid="settings-nav-item-KoTranslator"]');
          const koWrap = koNavBtn ? (koNavBtn.parentElement !== navGroup ? koNavBtn.parentElement : koNavBtn) : null;
          if (koWrap && koWrap.parentElement === navGroup && koWrap.nextSibling) {
            navGroup.insertBefore(navWrap, koWrap.nextSibling);
          } else {
            navGroup.appendChild(navWrap);
          }

          const activateMcpPane = () => {
            const contentContainer = settingsModal.querySelector('.grow.w-full');
            if (!contentContainer) return;

            // Deactivate KoTranslator button styling if present
            const currentKoBtn = settingsModal.querySelector('button[data-testid="settings-nav-item-KoTranslator"]');
            if (currentKoBtn) {
              currentKoBtn.classList?.remove?.('bg-sidebar-secondary');
              const koSpan = currentKoBtn.querySelector?.('span');
              if (koSpan) {
                koSpan.classList?.remove?.('text-foreground');
                koSpan.classList?.add?.('text-secondary-foreground');
              }
            }

            // Hide other panes (preserving native display in `data-agy-prev-display` compatible with KoTranslator)
            Array.from(contentContainer.children).forEach((child) => {
              if (child.id === 'agy-mcp-settings-pane') return;
              if (child.id === 'agy-ko-settings-pane') {
                child.style.display = 'none';
                return;
              }
              if (child.getAttribute('data-agy-prev-display') === null) {
                child.setAttribute('data-agy-prev-display', child.style.display || '');
              }
              child.style.display = 'none';
            });

            let pane = contentContainer.querySelector('#agy-mcp-settings-pane');
            if (!pane) {
              pane = doc.createElement('div');
              pane.id = 'agy-mcp-settings-pane';
              pane.setAttribute(NATIVE_BTN_ATTR, 'settings-pane');
              pane.className = 'w-full bg-transparent h-full overflow-y-auto px-6 py-5 select-none';
              contentContainer.appendChild(pane);
            }
            pane.style.display = 'block';
            modal.renderSettingsPageContent(pane);

            mcpNavBtn.classList?.add?.('bg-sidebar-secondary');
            labelSpan.classList?.remove?.('text-secondary-foreground');
            labelSpan.classList?.add?.('text-foreground');
          };

          mcpNavBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            activateMcpPane();
          });
        }

        if (!settingsModal.hasAttribute('data-agy-mcp-nav-bound')) {
          settingsModal.setAttribute('data-agy-mcp-nav-bound', 'true');
          settingsModal.addEventListener(
            'click',
            (e) => {
              const btn = e.target && typeof e.target.closest === 'function'
                ? e.target.closest('button[data-testid^="settings-nav-item-"]')
                : null;
              if (!btn) return;
              const testId = btn.getAttribute('data-testid') || '';
              if (testId === 'settings-nav-item-McpManager') return;

              const contentContainer = settingsModal.querySelector('.grow.w-full');
              if (!contentContainer) return;

              const pane = contentContainer.querySelector('#agy-mcp-settings-pane');
              const wasMcpPaneVisible = Boolean(pane && pane.style.display !== 'none');
              if (pane) {
                pane.style.display = 'none';
                pane.removeAttribute('data-agy-prev-display');
              }

              const currentMcpBtn = settingsModal.querySelector('button[data-testid="settings-nav-item-McpManager"]');
              if (currentMcpBtn) {
                currentMcpBtn.classList?.remove?.('bg-sidebar-secondary');
                const sp = currentMcpBtn.querySelector?.('span');
                if (sp) {
                  sp.classList?.remove?.('text-foreground');
                  sp.classList?.add?.('text-secondary-foreground');
                }
              }

              // Restore native children if switching from MCP pane to a native tab (not KoTranslator)
              if (wasMcpPaneVisible && testId !== 'settings-nav-item-KoTranslator') {
                Array.from(contentContainer.children).forEach((child) => {
                  if (child.id !== 'agy-mcp-settings-pane' && child.id !== 'agy-ko-settings-pane') {
                    const prev = child.getAttribute('data-agy-prev-display');
                    if (prev !== null) {
                      child.style.display = prev;
                      child.removeAttribute('data-agy-prev-display');
                    } else {
                      child.style.display = '';
                    }
                  }
                });
              }
            },
            true
          );
        }
      }

      // Inject "+ Add Custom MCP Server", "⚙️ Edit Custom MCP Settings", and "🔗 OAuth / Auth Settings" controls into Customizations / MCP views
      function buildQuickActionToolbar() {
        const wrap = doc.createElement('div');
        wrap.setAttribute(NATIVE_BTN_ATTR, 'empty-mcp-note');
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.flexWrap = 'wrap';
        wrap.style.gap = '8px';
        wrap.style.paddingLeft = '12px';
        wrap.style.marginTop = '6px';
        wrap.style.marginBottom = '6px';

        const addCustomBtn = doc.createElement('button');
        addCustomBtn.type = 'button';
        addCustomBtn.className = 'agy-mcp-injected-native-btn';
        addCustomBtn.style.marginLeft = '0';
        addCustomBtn.textContent = '+ Add Custom MCP Server';
        addCustomBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          modal.openEditPopup('', { createNew: true });
        });

        const editCustomBtn = doc.createElement('button');
        editCustomBtn.type = 'button';
        editCustomBtn.className = 'agy-mcp-btn';
        editCustomBtn.setAttribute(NATIVE_BTN_ATTR, 'toolbar-edit-popup-btn');
        editCustomBtn.textContent = '⚙️ Edit Custom MCP Settings';
        editCustomBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          modal.openEditPopup();
        });

        const authCustomBtn = doc.createElement('button');
        authCustomBtn.type = 'button';
        authCustomBtn.className = 'agy-mcp-btn auth';
        authCustomBtn.setAttribute(NATIVE_BTN_ATTR, 'toolbar-auth-popup-btn');
        authCustomBtn.textContent = '🔗 OAuth / Auth Settings';
        authCustomBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          modal.openEditPopup('', { focusAuth: true });
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
        wrap.appendChild(editCustomBtn);
        wrap.appendChild(authCustomBtn);
        wrap.appendChild(rawBtn);
        return wrap;
      }

      function ensureRemoteIframeMounted() {
        try {
          const iframe = doc.querySelector?.('ga-remote-control iframe');
          const iframeWin = iframe?.contentWindow;
          const iframeDoc = iframe?.contentDocument || iframeWin?.document;
          if (iframeWin && iframeDoc && iframeDoc.body) {
            if (!iframeWin.agyMcpManager || iframeWin.agyMcpManager.version !== MCP_MANAGER_VERSION) {
              mountMcpManager({
                window: iframeWin,
                document: iframeDoc,
                bridge,
              });
            }
          }
        } catch (_e) {
          // Cross-origin or not yet ready
        }
      }

      ensureRemoteCompanionScripts(win, doc, bridge);

      function injectIntoNativeMcpScreens() {
        if (!doc.body) return;

        // Support Remote Control web (`https://antigravity.google.com/r/...`) inner workbench iframe
        ensureRemoteIframeMounted();

        // 0) Settings Modal ("MCP Servers" tab right below "Models" / "KoTranslator")
        ensureNativeSettingsModalIntegration();

        // A) Next to native [data-testid="add-mcp-button"] in Customizations -> MCP Servers header
        const addMcpBtns = doc.querySelectorAll('[data-testid="add-mcp-button"]');
        addMcpBtns.forEach((nativeBtn) => {
          const parent = nativeBtn.parentElement;
          if (!parent) return;
          if (!parent.querySelector(`[${NATIVE_BTN_ATTR}="beside-add-btn"]`)) {
            const customBtn = doc.createElement('button');
            customBtn.type = 'button';
            customBtn.className = 'agy-mcp-injected-native-btn';
            customBtn.setAttribute(NATIVE_BTN_ATTR, 'beside-add-btn');
            customBtn.textContent = '+ Custom MCP';
            customBtn.title = 'Add or manage custom MCP servers in ~/.gemini/config/mcp_config.json';
            customBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              modal.openEditPopup('', { createNew: true });
            });
            parent.insertBefore(customBtn, nativeBtn);
          }
          if (!parent.querySelector(`[${NATIVE_BTN_ATTR}="beside-edit-btn"]`)) {
            const editBtn = doc.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'agy-mcp-btn';
            editBtn.style.marginLeft = '6px';
            editBtn.setAttribute(NATIVE_BTN_ATTR, 'beside-edit-btn');
            editBtn.textContent = '⚙️ Edit Settings';
            editBtn.title = 'Edit custom MCP server settings & OAuth authentication';
            editBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              modal.openEditPopup();
            });
            parent.insertBefore(editBtn, nativeBtn);
          }
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
          banner.style.flexWrap = 'wrap';
          banner.style.gap = '10px';
          banner.style.margin = '4px 0 8px 0';
          banner.style.padding = '8px 12px';
          banner.style.borderRadius = '8px';
          banner.style.background = 'rgba(79, 70, 229, 0.12)';
          banner.style.border = '1px solid rgba(99, 102, 241, 0.32)';
          banner.style.fontSize = '12px';

          const desc = doc.createElement('span');
          desc.textContent = 'Custom MCP Servers (OAuth Server URL or Local/Tunnel Stdio):';

          const btnGroup = doc.createElement('div');
          btnGroup.style.display = 'flex';
          btnGroup.style.gap = '6px';
          btnGroup.style.flexWrap = 'wrap';

          const openEditorBtn = doc.createElement('button');
          openEditorBtn.type = 'button';
          openEditorBtn.className = 'agy-mcp-injected-native-btn';
          openEditorBtn.style.marginLeft = '0';
          openEditorBtn.textContent = '+ Add Custom MCP Server';
          openEditorBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            modal.openEditPopup('', { createNew: true });
          });

          const editAuthBtn = doc.createElement('button');
          editAuthBtn.type = 'button';
          editAuthBtn.className = 'agy-mcp-btn';
          editAuthBtn.textContent = '⚙️ Edit Custom MCP Settings';
          editAuthBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            modal.openEditPopup();
          });

          const manageBtn = doc.createElement('button');
          manageBtn.type = 'button';
          manageBtn.className = 'agy-mcp-btn';
          manageBtn.textContent = 'Manage Servers';
          manageBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            modal.openModal('servers');
          });

          btnGroup.appendChild(openEditorBtn);
          btnGroup.appendChild(editAuthBtn);
          btnGroup.appendChild(manageBtn);
          banner.appendChild(desc);
          banner.appendChild(btnGroup);

          if (headerRow.nextSibling) {
            screen.insertBefore(banner, headerRow.nextSibling);
          } else {
            screen.appendChild(banner);
          }
        });

        // C) Next to the "No MCP servers yet." empty note OR above the [data-testid="mcp-server-row"] list
        const paragraphs = doc.querySelectorAll('p');
        paragraphs.forEach((p) => {
          if (
            p.textContent &&
            (p.textContent.includes('No MCP servers yet.') || p.textContent.includes('등록된 MCP 서버가 없습니다')) &&
            p.parentElement &&
            !p.parentElement.querySelector(`[${NATIVE_BTN_ATTR}="empty-mcp-note"]`)
          ) {
            p.parentElement.appendChild(buildQuickActionToolbar());
          }
        });

        const firstServerRow = doc.querySelector('[data-testid="mcp-server-row"]');
        if (firstServerRow && firstServerRow.parentElement && firstServerRow.parentElement.parentElement) {
          const listContainer = firstServerRow.parentElement;
          const sectionBody = listContainer.parentElement;
          const existingToolbar = sectionBody.querySelector(`[${NATIVE_BTN_ATTR}="empty-mcp-note"]`);
          if (!existingToolbar) {
            sectionBody.insertBefore(buildQuickActionToolbar(), listContainer);
          }
        }

        // D) Inside each native [data-testid="mcp-server-row"] item: inject "⚙️ Edit Settings" and "🔗 Connect OAuth / Auth" buttons
        const rows = doc.querySelectorAll('[data-testid="mcp-server-row"]');
        rows.forEach((row) => {
          const serverName = extractServerNameFromRow(row);
          if (!serverName) return;

          // D1) Top title/badge line of the row
          const topLine = row.firstElementChild;
          const leftGroup = topLine && topLine.firstElementChild ? topLine.firstElementChild : null;
          if (leftGroup && !leftGroup.querySelector(`[${NATIVE_BTN_ATTR}="row-edit-btn"]`)) {
            const editRowBtn = doc.createElement('button');
            editRowBtn.type = 'button';
            editRowBtn.className = 'agy-mcp-inline-row-btn';
            editRowBtn.setAttribute(NATIVE_BTN_ATTR, 'row-edit-btn');
            editRowBtn.setAttribute('data-mcp-server', serverName);
            editRowBtn.textContent = '⚙️ Edit Settings';
            editRowBtn.title = `Edit settings and OAuth authentication for "${serverName}"`;
            editRowBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              modal.openEditPopup(serverName);
            });

            const authRowBtn = doc.createElement('button');
            authRowBtn.type = 'button';
            authRowBtn.className = 'agy-mcp-inline-row-btn auth';
            authRowBtn.setAttribute(NATIVE_BTN_ATTR, 'row-auth-btn');
            authRowBtn.setAttribute('data-mcp-server', serverName);
            authRowBtn.textContent = '🔗 Connect OAuth / Auth';
            authRowBtn.title = `Open OAuth connection dialog or configure authentication for "${serverName}"`;
            authRowBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              handleServerAuthenticateAction(serverName);
            });

            leftGroup.appendChild(editRowBtn);
            leftGroup.appendChild(authRowBtn);
          }

          // D2) Next to [data-testid="mcp-server-fix-with-agent"] inside error boxes (e.g. "Unauthorized")
          const fixBtn = row.querySelector('[data-testid="mcp-server-fix-with-agent"]');
          if (fixBtn && fixBtn.parentElement && !fixBtn.parentElement.querySelector(`[${NATIVE_BTN_ATTR}="fix-auth-btn"]`)) {
            const btnWrap = doc.createElement('div');
            btnWrap.style.display = 'inline-flex';
            btnWrap.style.alignItems = 'center';
            btnWrap.style.gap = '6px';
            btnWrap.setAttribute(NATIVE_BTN_ATTR, 'fix-actions-wrap');

            const fixAuthBtn = doc.createElement('button');
            fixAuthBtn.type = 'button';
            fixAuthBtn.className = 'agy-mcp-inline-row-btn auth';
            fixAuthBtn.setAttribute(NATIVE_BTN_ATTR, 'fix-auth-btn');
            fixAuthBtn.setAttribute('data-mcp-server', serverName);
            fixAuthBtn.textContent = '🔗 Connect OAuth / Auth';
            fixAuthBtn.title = `Connect OAuth or configure authentication for "${serverName}"`;
            fixAuthBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              handleServerAuthenticateAction(serverName);
            });

            const fixEditBtn = doc.createElement('button');
            fixEditBtn.type = 'button';
            fixEditBtn.className = 'agy-mcp-inline-row-btn';
            fixEditBtn.setAttribute(NATIVE_BTN_ATTR, 'fix-edit-btn');
            fixEditBtn.setAttribute('data-mcp-server', serverName);
            fixEditBtn.textContent = '⚙️ Edit Settings';
            fixEditBtn.title = `Edit settings for "${serverName}"`;
            fixEditBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              modal.openEditPopup(serverName);
            });

            btnWrap.appendChild(fixAuthBtn);
            btnWrap.appendChild(fixEditBtn);
            fixBtn.parentElement.insertBefore(btnWrap, fixBtn);
          }
        });
      }

      injectIntoNativeMcpScreens();

      let observer = null;
      let injectTimer = null;
      if (typeof win.MutationObserver === 'function') {
        observer = new win.MutationObserver((mutations) => {
          if (!isRelevantMutationList(mutations)) return;
          if (injectTimer) return;
          const setTimer = typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
          injectTimer = setTimer(() => {
            injectTimer = null;
            injectIntoNativeMcpScreens();
          }, 25);
        });
        observer.observe(doc.body, { childList: true, subtree: true });
      }

      // Keyboard shortcut: Ctrl+Shift+M to open/toggle modal, Escape to close
      function onKeyDown(e) {
        if (!e) return;
        if (e.key === 'Escape') {
          if (modal.isOAuthConnectModalOpen()) {
            modal.closeOAuthConnectModal();
            return;
          }
          if (modal.isEditPopupOpen()) {
            modal.closeEditPopup();
            return;
          }
          if (modal.isOpen()) {
            modal.closeModal();
            return;
          }
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
        openEditPopup: (serverName, options) => modal.openEditPopup(serverName, options),
        closeEditPopup: () => modal.closeEditPopup(),
        isEditPopupOpen: () => modal.isEditPopupOpen(),
        openOAuthConnectModal: (serverName, authUrl, options) => modal.openOAuthConnectModal(serverName, authUrl, options),
        closeOAuthConnectModal: () => modal.closeOAuthConnectModal(),
        isOAuthConnectModalOpen: () => modal.isOAuthConnectModalOpen(),
        renderSettingsPageContent: (container) => modal.renderSettingsPageContent(container),
        injectIntoNativeMcpScreens,
        reload: () => modal.reloadData(),
        bridge,
        schema,
        destroy() {
          if (injectTimer) {
            const clr = typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
            clr(injectTimer);
            injectTimer = null;
          }
          if (observer) {
            observer.disconnect();
            observer = null;
          }
          win.removeEventListener('keydown', onKeyDown);
          modal.closeOAuthConnectModal();
          modal.closeEditPopup();
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
      ensureRemoteCompanionScripts,
      cleanupLegacyStatusBarArtifacts,
      isOwnMcpNode,
      isRelevantMutationList,
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
