'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  QUICK_TEMPLATES,
  parseArgsInput,
  parseKeyValueInput,
  parseSmartMcpInput,
  validateAndBuildServerSpec,
  normalizeMcpConfigObject,
} = require('../src/mcp-config-schema');

const {
  createHostMcpBridge,
} = require('../src/host-mcp-bridge');

const {
  cleanupLegacyStatusBarArtifacts,
} = require('../src/index');

const {
  mergeMcpManagerBlock,
  MCP_BEGIN,
  MCP_END,
} = require('../scripts/install');

test('parseArgsInput parses multi-line strings, shell quotes, and JSON arrays', () => {
  assert.deepEqual(
    parseArgsInput('-y\n@modelcontextprotocol/server-filesystem\nD:/work'),
    ['-y', '@modelcontextprotocol/server-filesystem', 'D:/work']
  );
  assert.deepEqual(
    parseArgsInput('["-y", "mcp-server-fetch"]'),
    ['-y', 'mcp-server-fetch']
  );
  assert.deepEqual(
    parseArgsInput('-y "D:/My Folder/server.js"'),
    ['-y', 'D:/My Folder/server.js']
  );
});

test('parseKeyValueInput parses KEY=VALUE, Header: Value, and JSON objects', () => {
  assert.deepEqual(
    parseKeyValueInput('API_KEY=secret=123\n# comment\nNODE_ENV=production'),
    { API_KEY: 'secret=123', NODE_ENV: 'production' }
  );
  assert.deepEqual(
    parseKeyValueInput('Authorization: Bearer tok_abc\nX-Custom: val'),
    { Authorization: 'Bearer tok_abc', 'X-Custom': 'val' }
  );
  assert.deepEqual(
    parseKeyValueInput('{"FOO": "bar", "NUM": 42}'),
    { FOO: 'bar', NUM: '42' }
  );
});

test('validateAndBuildServerSpec validates stdio and http specs and all QUICK_TEMPLATES', () => {
  const stdioBuilt = validateAndBuildServerSpec({
    serverName: 'my-fs',
    transport: 'stdio',
    command: 'npx',
    argsText: '-y\n@modelcontextprotocol/server-filesystem\nC:/Temp',
    envText: 'LOG_LEVEL=debug',
    cwd: 'C:/Temp',
  });
  assert.equal(stdioBuilt.ok, true);
  assert.equal(stdioBuilt.serverName, 'my-fs');
  assert.deepEqual(stdioBuilt.spec, {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/Temp'],
    env: { LOG_LEVEL: 'debug' },
    cwd: 'C:/Temp',
  });

  const httpBuilt = validateAndBuildServerSpec({
    serverName: 'remote_api',
    transport: 'http',
    url: 'https://mcp.example.com/mcp',
    headersText: 'Authorization: Bearer xyz',
    disabled: true,
  });
  assert.equal(httpBuilt.ok, true);
  assert.equal(httpBuilt.serverName, 'remote_api');
  assert.deepEqual(httpBuilt.spec, {
    url: 'https://mcp.example.com/mcp',
    headers: { Authorization: 'Bearer xyz' },
    disabled: true,
  });

  for (const tpl of QUICK_TEMPLATES) {
    const res = validateAndBuildServerSpec({
      serverName: tpl.serverName,
      transport: tpl.transport,
      command: tpl.command,
      argsText: (tpl.args || []).join('\n'),
      envText: JSON.stringify(tpl.env || {}),
      url: tpl.url,
      headersText: JSON.stringify(tpl.headers || {}),
    });
    assert.equal(res.ok, true);
    assert.equal(res.serverName, tpl.serverName);
  }

  const badName = validateAndBuildServerSpec({ serverName: 'bad name!', transport: 'stdio', command: 'npx' });
  assert.equal(badName.ok, false);
  assert.match(badName.error, /letters, numbers/);

  const badUrl = validateAndBuildServerSpec({ serverName: 'valid', transport: 'http', url: 'ftp://bad' });
  assert.equal(badUrl.ok, false);
  assert.match(badUrl.error, /http:\/\/ or https:\/\//);
});

test('parseSmartMcpInput automatically resolves remote URLs, GitHub/npm URLs, package names, commands, and JSON', () => {
  // 1. Remote HTTP URL -> auto serverName & HTTP spec
  const remoteRes = parseSmartMcpInput('https://mcp.deepwiki.com/mcp');
  assert.equal(remoteRes.ok, true);
  assert.equal(remoteRes.serverName, 'deepwiki');
  assert.deepEqual(remoteRes.spec, { url: 'https://mcp.deepwiki.com/mcp' });

  // 2. Localhost URL -> auto serverName with port
  const localRes = parseSmartMcpInput('http://localhost:8080/mcp');
  assert.equal(localRes.ok, true);
  assert.equal(localRes.serverName, 'local-8080');
  assert.deepEqual(localRes.spec, { url: 'http://localhost:8080/mcp' });

  // 3. GitHub repo URL -> npx github:owner/repo
  const ghRes = parseSmartMcpInput('https://github.com/upstash/context7-mcp');
  assert.equal(ghRes.ok, true);
  assert.equal(ghRes.serverName, 'context7-mcp');
  assert.deepEqual(ghRes.spec, {
    command: 'npx',
    args: ['-y', 'github:upstash/context7-mcp'],
  });

  // 4. Official modelcontextprotocol/servers GitHub tree URL -> @modelcontextprotocol/server-*
  const officialGh = parseSmartMcpInput('https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem');
  assert.equal(officialGh.ok, true);
  assert.equal(officialGh.serverName, 'filesystem');
  assert.deepEqual(officialGh.spec, {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
  });

  // 5. Bare npm package or uvx package
  const npmPkg = parseSmartMcpInput('@playwright/mcp@latest');
  assert.equal(npmPkg.ok, true);
  assert.equal(npmPkg.serverName, 'mcp');
  assert.deepEqual(npmPkg.spec, {
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
  });

  const uvxPkg = parseSmartMcpInput('mcp-server-fetch');
  assert.equal(uvxPkg.ok, true);
  assert.equal(uvxPkg.serverName, 'fetch');
  assert.deepEqual(uvxPkg.spec, {
    command: 'uvx',
    args: ['mcp-server-fetch'],
  });

  // 6. Full command line
  const cmdRes = parseSmartMcpInput('npx -y @modelcontextprotocol/server-github');
  assert.equal(cmdRes.ok, true);
  assert.equal(cmdRes.serverName, 'github');
  assert.deepEqual(cmdRes.spec, {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
  });

  // 7. validateAndBuildServerSpec smart fallback when serverName is omitted or URL is pasted into serverName/command
  const omittedName = validateAndBuildServerSpec({
    serverName: '',
    transport: 'http',
    url: 'https://mcp.context7.com/mcp',
  });
  assert.equal(omittedName.ok, true);
  assert.equal(omittedName.serverName, 'context7');

  const urlInNameField = validateAndBuildServerSpec({
    serverName: 'https://mcp.deepwiki.com/mcp',
    transport: 'stdio',
    command: 'npx',
  });
  assert.equal(urlInNameField.ok, true);
  assert.equal(urlInNameField.serverName, 'deepwiki');
  assert.equal(urlInNameField.spec.url, 'https://mcp.deepwiki.com/mcp');
});

test('normalizeMcpConfigObject accepts standard mcpServers object and direct server map', () => {
  const res1 = normalizeMcpConfigObject('{"mcpServers": {"fs": {"command": "npx"}}}');
  assert.equal(res1.ok, true);
  assert.equal(res1.config.mcpServers.fs.command, 'npx');

  const res2 = normalizeMcpConfigObject('{"direct": {"url": "https://mcp.example.com"}}');
  assert.equal(res2.ok, true);
  assert.equal(res2.config.mcpServers.direct.url, 'https://mcp.example.com');
});

test('createHostMcpBridge resolves URI, performs CRUD, toggles tools, and refreshes MCP servers', async () => {
  const files = new Map();
  const refreshCalls = [];
  const toggleCalls = [];

  const mockHostService = {
    async getStandaloneDir() {
      return { standaloneDir: 'C:\\Users\\TestUser\\.gemini\\antigravity\\scratch' };
    },
    async readFile({ uri }) {
      if (!files.has(uri)) throw new Error('ENOENT');
      return { content: files.get(uri) };
    },
    async writeFile({ uri, content }) {
      files.set(uri, content);
      return {};
    },
    async getMcpServerStates() {
      return {
        states: [
          {
            serverName: 'filesystem',
            status: 2,
            tools: [{ name: 'read_file' }, { name: 'write_file' }],
          },
        ],
      };
    },
    async refreshMcpServers(opts) {
      refreshCalls.push(opts);
      return {};
    },
    async toggleMcpServer(opts) {
      toggleCalls.push(opts);
      return {};
    },
  };

  const bridge = createHostMcpBridge({ hostService: mockHostService });
  const uri = await bridge.resolveMcpConfigUri();
  assert.equal(uri, 'file:///C:/Users/TestUser/.gemini/config/mcp_config.json');

  // Initial read when file does not exist returns empty mcpServers
  const initial = await bridge.readMcpConfig();
  assert.deepEqual(initial.config, { mcpServers: {} });

  // Upsert custom server
  await bridge.upsertCustomServer('filesystem', {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/Users/TestUser'],
  });

  const afterUpsert = await bridge.readMcpConfig();
  assert.equal(
    afterUpsert.config.mcpServers.filesystem.command,
    'npx'
  );
  assert.equal(refreshCalls.length, 1);
  assert.equal(refreshCalls[0].serverName, 'filesystem');

  // Toggle tool disable/enable
  await bridge.toggleServerTool('filesystem', 'write_file', false);
  let cfg = (await bridge.readMcpConfig()).config;
  assert.deepEqual(cfg.mcpServers.filesystem.disabledTools, ['write_file']);

  await bridge.toggleServerTool('filesystem', 'write_file', true);
  cfg = (await bridge.readMcpConfig()).config;
  assert.equal(cfg.mcpServers.filesystem.disabledTools, undefined);

  // Disable & enable server
  await bridge.toggleServerEnabled('filesystem', false);
  cfg = (await bridge.readMcpConfig()).config;
  assert.equal(cfg.mcpServers.filesystem.disabled, true);
  assert.equal(toggleCalls.at(-1).enabled, false);

  // Delete server
  await bridge.deleteCustomServer('filesystem');
  cfg = (await bridge.readMcpConfig()).config;
  assert.deepEqual(cfg.mcpServers, {});
});

test('cleanupLegacyStatusBarArtifacts removes any legacy statusbar adapter and never registers into statusbar', () => {
  const unregistered = [];
  const customMap = new Map([['mcp-manager', { id: 'mcp-manager' }]]);
  let removedDom = 0;
  const mockWin = {
    agyStatusBar: {
      unregisterAdapter(id) {
        unregistered.push(id);
      },
    },
    __agyCustomStatusBarAdapters: customMap,
  };
  const mockDoc = {
    querySelectorAll() {
      return [
        {
          remove() {
            removedDom++;
          },
        },
      ];
    },
  };

  cleanupLegacyStatusBarArtifacts(mockWin, mockDoc);
  assert.deepEqual(unregistered, ['mcp-manager']);
  assert.equal(customMap.has('mcp-manager'), false);
  assert.equal(removedDom, 1);
});

test('mergeMcpManagerBlock preserves statusbar base code and KO_THOUGHT_LOCALIZER_V2 block idempotently', () => {
  const existing = [
    '// Statusbar v14 code',
    'window.agyStatusBar = {};',
    '',
    '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
    'console.log("ko");',
    '// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
  ].join('\n');

  const merged1 = mergeMcpManagerBlock(existing, 'console.log("mcp v1");');
  assert.ok(merged1.includes('window.agyStatusBar = {};'));
  assert.ok(merged1.includes(MCP_BEGIN));
  assert.ok(merged1.includes('console.log("mcp v1");'));
  assert.ok(merged1.includes(MCP_END));
  assert.ok(merged1.indexOf(MCP_BEGIN) < merged1.indexOf('// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ==='));

  // Re-merging updates MCP block without duplicating
  const merged2 = mergeMcpManagerBlock(merged1, 'console.log("mcp v1.1");');
  assert.equal(merged2.split(MCP_BEGIN).length - 1, 1);
  assert.ok(merged2.includes('console.log("mcp v1.1");'));
  assert.ok(!merged2.includes('console.log("mcp v1");'));
  assert.ok(merged2.includes('// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ==='));
});

test('buildBundle produces valid self-contained userscript bundle without statusbar registerAdapter', () => {
  const { buildBundle } = require('../scripts/build');
  const res = buildBundle();
  assert.ok(res.size > 5000);
  assert.ok(res.bundle.includes('Antigravity Custom MCP Server Manager'));
  assert.ok(!res.bundle.includes('.registerAdapter('));
});
