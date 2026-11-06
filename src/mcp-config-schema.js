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
  const result = {
    authMode: 'none', // 'none' | 'bearer' | 'apiKey' | 'basic' | 'oauth'
    bearerToken: '',
    apiKeyHeader: 'X-API-Key',
    apiKeyValue: '',
    basicUser: '',
    basicPass: '',
    extraHeaders: {},
  };
  if (!spec || typeof spec !== 'object') return result;

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

  if (mode === 'none') {
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
  delete base.disabled;

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
    if (Object.keys(finalHeaders).length > 0) {
      spec.headers = finalHeaders;
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
