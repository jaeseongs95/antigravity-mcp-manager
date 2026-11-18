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

const KNOWN_UVX_PACKAGES = new Set([
  'mcp-server-fetch',
  'mcp-server-sqlite',
  'mcp-server-git',
  'mcp-server-time',
  'mcp-server-sentry',
]);

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

module.exports = {
  QUICK_TEMPLATES,
  KNOWN_UVX_PACKAGES,
  sanitizeServerName,
  deriveServerNameFromUrl,
  deriveServerNameFromCommandAndArgs,
};
