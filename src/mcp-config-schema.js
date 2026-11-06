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
