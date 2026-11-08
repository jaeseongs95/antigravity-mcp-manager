'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  QUICK_TEMPLATES,
  parseArgsInput,
  parseKeyValueInput,
  extractAuthFromSpec,
  buildAuthHeaders,
  parseSmartMcpInput,
  validateAndBuildServerSpec,
  normalizeMcpConfigObject,
} = require('../src/mcp-config-schema');

const {
  normalizeAuthorizationCode,
  createHostMcpBridge,
} = require('../src/host-mcp-bridge');

const {
  MCP_MANAGER_VERSION,
  mountMcpManager,
  ensureRemoteCompanionScripts,
  cleanupLegacyStatusBarArtifacts,
  isRelevantMutationList,
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
  const remoteRes = parseSmartMcpInput('https://mcp.deepwiki.com/mcp');
  assert.equal(remoteRes.ok, true);
  assert.equal(remoteRes.serverName, 'deepwiki');
  assert.deepEqual(remoteRes.spec, { url: 'https://mcp.deepwiki.com/mcp' });

  const localRes = parseSmartMcpInput('http://localhost:8080/mcp');
  assert.equal(localRes.ok, true);
  assert.equal(localRes.serverName, 'local-8080');
  assert.deepEqual(localRes.spec, { url: 'http://localhost:8080/mcp' });

  const ghRes = parseSmartMcpInput('https://github.com/upstash/context7-mcp');
  assert.equal(ghRes.ok, true);
  assert.equal(ghRes.serverName, 'context7-mcp');
  assert.deepEqual(ghRes.spec, {
    command: 'npx',
    args: ['-y', 'github:upstash/context7-mcp'],
  });

  const officialGh = parseSmartMcpInput('https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem');
  assert.equal(officialGh.ok, true);
  assert.equal(officialGh.serverName, 'filesystem');
  assert.deepEqual(officialGh.spec, {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
  });

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

  const cmdRes = parseSmartMcpInput('npx -y @modelcontextprotocol/server-github');
  assert.equal(cmdRes.ok, true);
  assert.equal(cmdRes.serverName, 'github');
  assert.deepEqual(cmdRes.spec, {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
  });

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

  const initial = await bridge.readMcpConfig();
  assert.deepEqual(initial.config, { mcpServers: {} });

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

  await bridge.toggleServerTool('filesystem', 'write_file', false);
  let cfg = (await bridge.readMcpConfig()).config;
  assert.deepEqual(cfg.mcpServers.filesystem.disabledTools, ['write_file']);

  await bridge.toggleServerTool('filesystem', 'write_file', true);
  cfg = (await bridge.readMcpConfig()).config;
  assert.equal(cfg.mcpServers.filesystem.disabledTools, undefined);

  await bridge.toggleServerEnabled('filesystem', false);
  cfg = (await bridge.readMcpConfig()).config;
  assert.equal(cfg.mcpServers.filesystem.disabled, true);
  assert.equal(toggleCalls.at(-1).enabled, false);

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

  const merged2 = mergeMcpManagerBlock(merged1, 'console.log("mcp v1.1");');
  assert.equal(merged2.split(MCP_BEGIN).length - 1, 1);
  assert.ok(merged2.includes('console.log("mcp v1.1");'));
  assert.ok(!merged2.includes('console.log("mcp v1");'));
  assert.ok(merged2.includes('// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ==='));
});

test('extractAuthFromSpec, buildAuthHeaders, and parseSmartMcpInput support Bearer, API Key, Basic auth, and inline/URL tokens', () => {
  const withTokenParam = parseSmartMcpInput('https://ledger-mcp.jaeseong.dev/mcp', 'my_secret_jwt_123');
  assert.equal(withTokenParam.ok, true);
  assert.equal(withTokenParam.serverName, 'ledger-mcp-jaeseong');
  assert.deepEqual(withTokenParam.spec, {
    url: 'https://ledger-mcp.jaeseong.dev/mcp',
    headers: { Authorization: 'Bearer my_secret_jwt_123' },
  });

  const inlineBearer = parseSmartMcpInput('https://ledger-mcp.jaeseong.dev/mcp Bearer tok_xyz');
  assert.equal(inlineBearer.ok, true);
  assert.deepEqual(inlineBearer.spec.headers, { Authorization: 'Bearer tok_xyz' });

  const urlUserToken = parseSmartMcpInput('https://tok_123@ssh-approval-origin.jaeseong.dev/mcp');
  assert.equal(urlUserToken.ok, true);
  assert.equal(urlUserToken.spec.url, 'https://ssh-approval-origin.jaeseong.dev/mcp');
  assert.deepEqual(urlUserToken.spec.headers, { Authorization: 'Bearer tok_123' });

  const defaultOAuth = extractAuthFromSpec({
    url: 'https://ledger-mcp.jaeseong.dev/mcp',
  });
  assert.equal(defaultOAuth.authMode, 'oauth');
  assert.equal(defaultOAuth.oauthClientMode, 'auto');

  const builtOAuthCustom = validateAndBuildServerSpec({
    serverName: 'ledger-mcp-jaeseong',
    description: 'Ledger OAuth MCP Server',
    transport: 'http',
    url: 'https://ledger-mcp.jaeseong.dev/mcp',
    authMode: 'oauth',
    oauthClientMode: 'custom',
    oauthClientId: 'my-client-id',
    oauthClientSecret: 'my-client-secret',
    oauthScopes: 'mcp:tools openid',
    headersText: 'Authorization: Bearer stale_token\nX-Custom: 1',
  });
  assert.equal(builtOAuthCustom.ok, true);
  assert.equal(builtOAuthCustom.spec.description, 'Ledger OAuth MCP Server');
  assert.deepEqual(builtOAuthCustom.spec.headers, { 'X-Custom': '1' });
  assert.deepEqual(builtOAuthCustom.spec.oauth, {
    clientId: 'my-client-id',
    clientSecret: 'my-client-secret',
    scopes: ['mcp:tools', 'openid'],
  });

  const extractedBearer = extractAuthFromSpec({
    url: 'https://ledger-mcp.jaeseong.dev/mcp',
    headers: { Authorization: 'Bearer abc_999', 'X-Trace': '1' },
  });
  assert.equal(extractedBearer.authMode, 'bearer');
  assert.equal(extractedBearer.bearerToken, 'abc_999');
  assert.deepEqual(extractedBearer.extraHeaders, { 'X-Trace': '1' });

  const rebuiltBasic = buildAuthHeaders({
    authMode: 'basic',
    basicUser: 'admin',
    basicPass: 'pw123',
    baseHeaders: { 'X-Trace': '1' },
  });
  const extractedBasic = extractAuthFromSpec({ headers: rebuiltBasic });
  assert.equal(extractedBasic.authMode, 'basic');
  assert.equal(extractedBasic.basicUser, 'admin');
  assert.equal(extractedBasic.basicPass, 'pw123');
});

test('createHostMcpBridge strictly matches native Antigravity lB() positional string signature for completeMcpOAuth & disconnectMcpOAuth', async () => {
  const files = new Map();
  const oauthCalls = [];
  const disconnectCalls = [];

  // Replicates exact `/main.js` protobuf serializer `$b(cha, { serverName: t, authorizationCode: v })`
  // which throws `cannot encode field exa.language_server_pb.CompleteMcpOAuthRequest.server_name to JSON: expected string, got object`
  // if `t` is not a string!
  const strictNativeHostService = {
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
            status: 3,
            error: 'calling "initialize": sending "initialize": Unauthorized',
            spec: { serverName: 'ledger-portal-jaeseong', serverUrl: 'https://ledger-portal.jaeseong.dev/mcp' },
          },
        ],
      };
    },
    async refreshMcpServers() {
      return {};
    },
    async completeMcpOAuth(t, v) {
      if (typeof t !== 'string') {
        throw new Error(
          `[internal] cannot encode field exa.language_server_pb.CompleteMcpOAuthRequest.server_name to JSON: expected string, got ${typeof t}`
        );
      }
      if (typeof v !== 'string') {
        throw new Error(
          `[internal] cannot encode field exa.language_server_pb.CompleteMcpOAuthRequest.authorization_code to JSON: expected string, got ${typeof v}`
        );
      }
      oauthCalls.push({ serverName: t, authorizationCode: v });
      return {};
    },
    async disconnectMcpOAuth(t, v) {
      if (typeof t !== 'string') {
        throw new Error(
          `[internal] cannot encode field exa.language_server_pb.DisconnectMcpOAuthRequest.server_name to JSON: expected string, got ${typeof t}`
        );
      }
      if (v !== undefined && typeof v !== 'string') {
        throw new Error(
          `[internal] cannot encode field exa.language_server_pb.DisconnectMcpOAuthRequest.account to JSON: expected string, got ${typeof v}`
        );
      }
      disconnectCalls.push({ serverName: t, account: v });
      return {};
    },
  };

  const bridge = createHostMcpBridge({ hostService: strictNativeHostService });
  const statesRes = await bridge.fetchServerStates();
  assert.equal(statesRes.ok, true);
  assert.equal(statesRes.states[0].serverName, 'ledger-portal-jaeseong');

  // 1. Raw authorization code string (like `sMOKbcUULzxXCQ5JqCOh7upU7OKmVLs7:EUkVS7lH...`)
  const rawCode = 'sMOKbcUULzxXCQ5JqCOh7upU7OKmVLs7:EUkVS7lH0';
  const oauthRes1 = await bridge.completeOAuth('ledger-portal-jaeseong', rawCode);
  assert.equal(oauthRes1.ok, true);
  assert.deepEqual(oauthCalls[0], {
    serverName: 'ledger-portal-jaeseong',
    authorizationCode: rawCode,
  });

  // 2. Full callback URL pasted into the input box -> extracts `code` query param
  const callbackUrl = 'http://127.0.0.1:54321/oauth/callback?code=extracted_code_999&state=xyz123';
  assert.equal(normalizeAuthorizationCode(callbackUrl), 'extracted_code_999');
  const oauthRes2 = await bridge.completeOAuth('ledger-portal-jaeseong', callbackUrl);
  assert.equal(oauthRes2.ok, true);
  assert.deepEqual(oauthCalls[1], {
    serverName: 'ledger-portal-jaeseong',
    authorizationCode: 'extracted_code_999',
  });

  // 3. Disconnect OAuth passes 2 positional strings
  const discRes = await bridge.disconnectOAuth('ledger-portal-jaeseong');
  assert.equal(discRes.ok, true);
  assert.deepEqual(disconnectCalls[0], {
    serverName: 'ledger-portal-jaeseong',
    account: '',
  });
});

test('createHostMcpBridge works over Remote Control proxyCommand adapter when Fiber service is absent', async () => {
  const rpcLog = [];
  const mockWin = {
    __agyRemoteControlInstance: {
      destroyed: false,
      async proxyCommand(rpcPath, bytes) {
        const reqObj = JSON.parse(new TextDecoder().decode(bytes));
        rpcLog.push({ rpcPath, reqObj });
        if (rpcPath.endsWith('/GetMcpServerStates')) {
          const payload = new TextEncoder().encode(
            JSON.stringify({
              states: [{ serverName: 'remote-srv', status: 2, authUrl: 'https://remote.example.com/auth' }],
            })
          );
          return { payload };
        }
        return { payload: new TextEncoder().encode('{}') };
      },
    },
  };

  const bridge = createHostMcpBridge({ window: mockWin });
  const states = await bridge.getMcpServerStates();
  assert.equal(states.length, 1);
  assert.equal(states[0].serverName, 'remote-srv');

  const oauthRes = await bridge.completeOAuth('remote-srv', 'remote_code_777');
  assert.equal(oauthRes.ok, true);
  const completeCall = rpcLog.find((c) => c.rpcPath.endsWith('/CompleteMcpOAuth'));
  assert.ok(completeCall);
  assert.deepEqual(completeCall.reqObj, {
    serverName: 'remote-srv',
    authorizationCode: 'remote_code_777',
  });
});

test('buildBundle produces valid self-contained userscript bundle with 100% English default UI strings without mutating disk', () => {
  const { buildBundle } = require('../scripts/build');
  const res = buildBundle({ write: false });
  assert.ok(res.size > 5000);
  assert.ok(res.bundle.includes('Antigravity Custom MCP Server Manager'));
  assert.ok(res.bundle.includes('Add Custom MCP Server'));
  assert.ok(res.bundle.includes('Advanced OAuth Settings'));
  assert.ok(res.bundle.includes('settings-nav-item-McpManager'));
  assert.ok(res.bundle.includes('MCP Servers'));
  assert.ok(!res.bundle.includes('.registerAdapter('));
});

test('createModalController and mountMcpManager render English UI, prevent MutationObserver freeze loop, and mount into remote iframe', async () => {
  const { createModalController } = require('../src/modal-ui');

  function makeClassList(owner) {
    return {
      add(...tokens) {
        const set = new Set((owner.className || '').split(/\s+/).filter(Boolean));
        for (const t of tokens) set.add(t);
        owner.className = Array.from(set).join(' ');
      },
      remove(...tokens) {
        const set = new Set((owner.className || '').split(/\s+/).filter(Boolean));
        for (const t of tokens) set.delete(t);
        owner.className = Array.from(set).join(' ');
      },
      contains(t) {
        return (owner.className || '').split(/\s+/).filter(Boolean).includes(t);
      },
    };
  }

  function makeEl(tag, mutationCounter) {
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      value: '',
      type: '',
      placeholder: '',
      checked: false,
      style: {},
      attributes: new Map(),
      children: [],
      listeners: new Map(),
      parentNode: null,
      parentElement: null,
      get firstChild() {
        return this.children[0] || null;
      },
      get firstElementChild() {
        return this.children[0] || null;
      },
      get nextSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.children.indexOf(this);
        return idx !== -1 && idx + 1 < this.parentElement.children.length
          ? this.parentElement.children[idx + 1]
          : null;
      },
      get nextElementSibling() {
        return this.nextSibling;
      },
      get options() {
        return this.children.filter((c) => c.tagName === 'OPTION');
      },
      setAttribute(k, v) {
        this.attributes.set(k, String(v));
        if (k === 'id') this.id = String(v);
      },
      getAttribute(k) {
        if (k === 'id') return this.id || null;
        return this.attributes.has(k) ? this.attributes.get(k) : null;
      },
      hasAttribute(k) {
        return k === 'id' ? Boolean(this.id) : this.attributes.has(k);
      },
      removeAttribute(k) {
        this.attributes.delete(k);
      },
      appendChild(child) {
        if (mutationCounter) mutationCounter.count++;
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        child.parentElement = this;
        this.children.push(child);
        return child;
      },
      insertBefore(child, refNode) {
        if (mutationCounter) mutationCounter.count++;
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        child.parentElement = this;
        const idx = refNode ? this.children.indexOf(refNode) : -1;
        if (idx === -1) this.children.push(child);
        else this.children.splice(idx, 0, child);
        return child;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
          this.children.splice(idx, 1);
          child.parentNode = null;
          child.parentElement = null;
        }
        return child;
      },
      addEventListener(ev, fn) {
        if (!this.listeners.has(ev)) this.listeners.set(ev, []);
        this.listeners.get(ev).push(fn);
      },
      click() {
        const evObj = { target: this, preventDefault() {}, stopPropagation() {} };
        const ancestors = [];
        let p = this.parentElement;
        while (p) {
          ancestors.unshift(p);
          p = p.parentElement;
        }
        for (const anc of ancestors) {
          const ancFns = anc.listeners && anc.listeners.get('click') ? anc.listeners.get('click') : [];
          for (const fn of ancFns) fn(evObj);
        }
        const fns = this.listeners.get('click') || [];
        for (const fn of fns) fn(evObj);
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (sel === '.flex.flex-col.gap-0\\.5' && cur.className === 'flex flex-col gap-0.5') return cur;
          if (sel.startsWith('button[data-testid^="settings-nav-item-"]')) {
            const tid = cur.getAttribute && cur.getAttribute('data-testid');
            if (cur.tagName === 'BUTTON' && tid && tid.startsWith('settings-nav-item-')) return cur;
          }
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const out = [];
        const match = (node) => {
          if (sel === 'ga-remote-control iframe') return node.tagName === 'IFRAME';
          if (sel.startsWith('#')) return node.id === sel.slice(1);
          if (sel === '.grow.w-full') return node.className === 'grow w-full';
          if (sel.startsWith('.')) return (node.className || '').split(/\s+/).includes(sel.slice(1));
          const mTagPrefixAttr = /^([a-z0-9_-]+)\[([^=\]^]+)\^="([^"]+)"\]$/i.exec(sel);
          if (mTagPrefixAttr) {
            const val = node.getAttribute(mTagPrefixAttr[2]) || '';
            return node.tagName === mTagPrefixAttr[1].toUpperCase() && val.startsWith(mTagPrefixAttr[3]);
          }
          const mTagAttr = /^([a-z0-9_-]+)\[([^=\]]+)="([^"]+)"\]$/i.exec(sel);
          if (mTagAttr) {
            return node.tagName === mTagAttr[1].toUpperCase() && node.getAttribute(mTagAttr[2]) === mTagAttr[3];
          }
          const mAttr = /^\[([^=\]]+)="([^"]+)"\]$/.exec(sel);
          if (mAttr) return node.getAttribute(mAttr[1]) === mAttr[2];
          const mHasAttr = /^\[([^=\]]+)\]$/.exec(sel);
          if (mHasAttr) return node.hasAttribute(mHasAttr[1]);
          return node.tagName === sel.toUpperCase();
        };
        const walk = (node) => {
          for (const c of node.children) {
            if (match(c)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
    el.classList = makeClassList(el);
    return el;
  }

  function makeDoc(mutationCounter) {
    return {
      head: makeEl('head', mutationCounter),
      body: makeEl('body', mutationCounter),
      createElement: (tag) => makeEl(tag, mutationCounter),
      getElementById(id) {
        return this.head.querySelector(`#${id}`) || this.body.querySelector(`#${id}`);
      },
      querySelector(sel) {
        return this.body.querySelector(sel);
      },
      querySelectorAll(sel) {
        return this.body.querySelectorAll(sel);
      },
    };
  }

  const mutationCounter = { count: 0 };
  const doc = makeDoc(mutationCounter);

  let openedUrl = '';
  let completedOAuthArgs = null;
  const mockBridge = {
    async readMcpConfig() {
      return {
        uri: 'file:///C:/Users/TestUser/.gemini/config/mcp_config.json',
        rawText: '{"mcpServers":{"ledger-portal-jaeseong":{"url":"https://ledger-portal.jaeseong.dev/mcp"}}}',
        config: {
          mcpServers: {
            'ledger-portal-jaeseong': { url: 'https://ledger-portal.jaeseong.dev/mcp' },
          },
        },
      };
    },
    async fetchServerStates() {
      return {
        ok: true,
        states: [
          {
            serverName: 'ledger-portal-jaeseong',
            status: 1,
            authUrl: 'https://ledger-portal.jaeseong.dev/oauth/authorize?client_id=abc',
            spec: { serverName: 'ledger-portal-jaeseong', serverUrl: 'https://ledger-portal.jaeseong.dev/mcp' },
          },
        ],
      };
    },
    async completeOAuth(serverName, code) {
      completedOAuthArgs = [serverName, code];
      return { ok: true };
    },
    openAuthUrl(url) {
      openedUrl = url;
      return { ok: true };
    },
  };

  const modal = createModalController({ doc, bridge: mockBridge });

  // 1. Open Edit Popup -> verify English labels and OAuth default
  await modal.openEditPopup('ledger-portal-jaeseong', { focusAuth: true });
  assert.equal(modal.isEditPopupOpen(), true);
  const authSelect = doc.body.querySelector('[data-field="authMode"]');
  assert.ok(authSelect);
  assert.equal(authSelect.value, 'oauth');
  assert.deepEqual(
    authSelect.options.map((o) => o.textContent),
    [
      'OAuth',
      'No Authentication',
      'OAuth or No Authentication',
      'Bearer Token (Authorization: Bearer <token>)',
      'API Key Header (X-API-Key or Custom Header)',
      'Basic Auth (Username & Password)',
    ]
  );
  modal.closeEditPopup();
  assert.equal(modal.isEditPopupOpen(), false);

  // 2. Open OAuth Connect Modal -> verify English "Connect <name> ↗" and code submission
  await modal.openOAuthConnectModal('ledger-portal-jaeseong', 'https://example.com/oauth/authorize');
  assert.equal(modal.isOAuthConnectModalOpen(), true);
  const launchBtn = doc.body.querySelector('[data-testid="agy-mcp-oauth-launch-btn"]');
  assert.ok(launchBtn);
  assert.equal(launchBtn.textContent, 'Connect ledger-portal-jaeseong ↗');
  launchBtn.click();
  assert.equal(openedUrl, 'https://example.com/oauth/authorize');

  const codeInput = doc.body.querySelector('[data-field="oauthModalCode"]');
  assert.ok(codeInput);
  codeInput.value = 'sMOKbcUULzxXCQ5JqCOh7upU7OKmVLs7:EUkVS7lH0';
  const buttonsInModal = doc.body.querySelectorAll('button');
  const submitCodeBtn = buttonsInModal.find((b) => b.textContent === 'Submit Code');
  assert.ok(submitCodeBtn);
  await submitCodeBtn.click();
  // Wait a microtask for async click handler
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(completedOAuthArgs, ['ledger-portal-jaeseong', 'sMOKbcUULzxXCQ5JqCOh7upU7OKmVLs7:EUkVS7lH0']);
  assert.equal(modal.isOAuthConnectModalOpen(), false);

  // 3. Verify Settings modal integration with KoTranslator wrapper does NOT cause infinite MutationObserver loop
  const settingsModal = makeEl('div', mutationCounter);
  settingsModal.className = 'settings-modal-container';
  const navGroup = makeEl('div', mutationCounter);
  navGroup.className = 'flex flex-col gap-0.5';

  const modelsWrap = makeEl('div', mutationCounter);
  modelsWrap.className = 'relative group/nav-item mx-2';
  const modelsBtn = makeEl('button', mutationCounter);
  modelsBtn.setAttribute('data-testid', 'settings-nav-item-Models');
  modelsBtn.className = 'bg-sidebar-secondary';
  const modelsSpan = makeEl('span', mutationCounter);
  modelsSpan.className = 'text-foreground font-medium';
  modelsSpan.textContent = 'Models';
  modelsBtn.appendChild(modelsSpan);
  modelsWrap.appendChild(modelsBtn);

  // Exact KoTranslator DOM structure (`navWrap > button[data-testid="settings-nav-item-KoTranslator"]`)
  const koWrap = makeEl('div', mutationCounter);
  koWrap.className = 'relative group/nav-item mx-2 agy-ko-settings-root';
  const koBtn = makeEl('button', mutationCounter);
  koBtn.setAttribute('data-testid', 'settings-nav-item-KoTranslator');
  const koSpan = makeEl('span', mutationCounter);
  koSpan.textContent = '한글 번역';
  koBtn.appendChild(koSpan);
  koWrap.appendChild(koBtn);

  navGroup.appendChild(modelsWrap);
  navGroup.appendChild(koWrap);

  const contentArea = makeEl('div', mutationCounter);
  contentArea.className = 'grow w-full';
  const nativeGeneralPane = makeEl('div', mutationCounter);
  nativeGeneralPane.id = 'native-general';
  contentArea.appendChild(nativeGeneralPane);

  settingsModal.appendChild(navGroup);
  settingsModal.appendChild(contentArea);
  doc.body.appendChild(settingsModal);

  // Also add a remote control iframe with its own Customizations button and a legacy beside-edit-btn to ensure it gets cleaned up
  const iframeDoc = makeDoc();
  const addMcpParent = makeEl('div');
  const legacyBesideEditBtn = makeEl('button');
  legacyBesideEditBtn.setAttribute('data-agy-custom-mcp-btn', 'beside-edit-btn');
  addMcpParent.appendChild(legacyBesideEditBtn);
  const nativeAddBtn = makeEl('button');
  nativeAddBtn.setAttribute('data-testid', 'add-mcp-button');
  addMcpParent.appendChild(nativeAddBtn);
  iframeDoc.body.appendChild(addMcpParent);

  const iframeWin = {
    document: iframeDoc,
    addEventListener() {},
    removeEventListener() {},
  };
  const rcIframe = makeEl('iframe', mutationCounter);
  rcIframe.contentWindow = iframeWin;
  rcIframe.contentDocument = iframeDoc;
  doc.body.appendChild(rcIframe);

  const mockWin = {
    document: doc,
    addEventListener() {},
    removeEventListener() {},
  };

  const mgr = mountMcpManager({ window: mockWin, document: doc, bridge: mockBridge });
  assert.equal(mgr.version, MCP_MANAGER_VERSION);

  const mcpNavBtn = navGroup.querySelector('[data-testid="settings-nav-item-McpManager"]');
  assert.ok(mcpNavBtn);
  assert.equal(mcpNavBtn.children[0].textContent, 'MCP Servers');

  // Verify that calling injectIntoNativeMcpScreens() repeatedly produces ZERO additional DOM mutations!
  const beforeCount = mutationCounter.count;
  for (let i = 0; i < 10; i++) {
    mgr.injectIntoNativeMcpScreens();
  }
  assert.equal(mutationCounter.count, beforeCount, 'Repeated injectIntoNativeMcpScreens must not mutate DOM or re-append nav item');

  // Verify own node mutation filter returns false for our injected nav button
  assert.equal(
    isRelevantMutationList([{ target: mcpNavBtn, addedNodes: [] }]),
    false
  );

  // Click MCP Servers tab -> opens #agy-mcp-settings-pane with English content and clears highlight on Models tab
  mcpNavBtn.click();
  assert.equal(mcpNavBtn.classList.contains('bg-sidebar-secondary'), true, 'MCP Servers tab must be highlighted when active');
  assert.equal(modelsBtn.classList.contains('bg-sidebar-secondary'), false, 'Models tab must NOT stay highlighted when MCP Servers is active');
  assert.equal(modelsSpan.classList.contains('text-secondary-foreground'), true);
  const injectedPane = contentArea.querySelector('#agy-mcp-settings-pane');
  assert.ok(injectedPane);
  assert.equal(injectedPane.style.display, 'block');
  assert.equal(nativeGeneralPane.style.display, 'none');
  const settingsAddBtn = injectedPane.querySelector('[data-testid="agy-mcp-settings-add-btn"]');
  assert.ok(settingsAddBtn);
  assert.equal(settingsAddBtn.textContent, '+ Add Custom MCP Server');

  // Click Models tab back -> restores highlight on Models tab and clears highlight on MCP Servers tab
  modelsBtn.click();
  assert.equal(modelsBtn.classList.contains('bg-sidebar-secondary'), true, 'Models tab highlight must be restored when clicked back');
  assert.equal(modelsSpan.classList.contains('text-foreground'), true);
  assert.equal(mcpNavBtn.classList.contains('bg-sidebar-secondary'), false, 'MCP Servers tab highlight must be cleared when switching back to Models');
  assert.equal(injectedPane.style.display, 'none');
  assert.equal(nativeGeneralPane.style.display, '');

  // Verify remote iframe was also automatically mounted and injected "+ Custom MCP" beside [data-testid="add-mcp-button"],
  // and removed any legacy beside-edit-btn gear button from the section header
  assert.ok(iframeWin.agyMcpManager);
  const remoteCustomBtn = addMcpParent.querySelector('[data-agy-custom-mcp-btn="beside-add-btn"]');
  assert.ok(remoteCustomBtn);
  assert.equal(remoteCustomBtn.textContent, '+ Custom MCP');
  assert.equal(
    addMcpParent.querySelector('[data-agy-custom-mcp-btn="beside-edit-btn"]'),
    null,
    'Redundant beside-edit-btn gear button in MCP Servers header must be removed and never injected'
  );
});

test('fetchHostInstalledPluginInfo and ensureRemoteCompanionScripts respect single-plugin vs multi-plugin host installations', async () => {
  const mcpBegin = '// === ' + ['BEGIN_AGY_MCP', 'MANAGER_V1'].join('_') + ' ===';
  const mcpEnd = '// === ' + ['END_AGY_MCP', 'MANAGER_V1'].join('_') + ' ===';
  const koBegin = '// === ' + ['BEGIN_AGY_KO', 'THOUGHT_LOCALIZER_V2'].join('_') + ' ===';
  const koEnd = '// === ' + ['END_AGY_KO', 'THOUGHT_LOCALIZER_V2'].join('_') + ' ===';

  let currentHostAutoinjectContent = '';
  const mockHostService = {
    async getStandaloneDir() {
      return { standaloneDir: 'C:\\Users\\TestUser\\.gemini\\antigravity\\scratch' };
    },
    async readFile({ uri }) {
      assert.equal(uri, 'file:///C:/Users/TestUser/.gemini/antigravity/statusbar_autoinject.js');
      return { content: new TextEncoder().encode(currentHostAutoinjectContent) };
    },
  };

  function makeRemoteTestEnv(fetchImpl) {
    const scriptsAdded = [];
    const doc = {
      head: {
        appendChild(s) {
          scriptsAdded.push(s.text || '');
        },
      },
      createElement(tag) {
        return { tagName: tag, text: '', nonce: '' };
      },
      querySelector(sel) {
        if (sel === 'ga-remote-control') return {};
        return null;
      },
    };
    const win = {
      location: { hostname: 'antigravity.google.com' },
      document: doc,
      fetch: fetchImpl,
    };
    const bridge = createHostMcpBridge({ window: win, document: doc, hostService: mockHostService });
    return { win, doc, bridge, scriptsAdded };
  }

  // Case 1: User ONLY installed antigravity-mcp-manager (1 plugin)
  currentHostAutoinjectContent = `${mcpBegin}\nfunction mountMcpManager(){}\n${mcpEnd}`;
  {
    const fetchedUrls = [];
    const { win, doc, bridge, scriptsAdded } = makeRemoteTestEnv(async (url) => {
      fetchedUrls.push(url);
      return { ok: true, async text() { return '// fetched'; } };
    });
    const info = await bridge.fetchHostInstalledPluginInfo(true);
    assert.equal(info.hasStatusbar, false);
    assert.equal(info.hasMcpManager, true);
    assert.equal(info.hasKoTranslator, false);

    const res = await ensureRemoteCompanionScripts(win, doc, bridge);
    assert.deepEqual(res.loaded, []);
    assert.equal(fetchedUrls.length, 0);
    assert.equal(scriptsAdded.length, 0);
  }

  // Case 2: User installed mcp-manager + statusbar (2 plugins) -> executes host statusbarBlock FIRST without calling external fetch
  currentHostAutoinjectContent = `function mountStatusBar(){}\nwindow.agyStatusBar={};\n${mcpBegin}\nfunction mountMcpManager(){}\n${mcpEnd}`;
  {
    const fetchedUrls = [];
    const { win, doc, bridge, scriptsAdded } = makeRemoteTestEnv(async (url) => {
      fetchedUrls.push(url);
      return { ok: true, async text() { return '// statusbar remote bundle'; } };
    });
    const res = await ensureRemoteCompanionScripts(win, doc, bridge);
    assert.deepEqual(res.loaded, ['antigravity-statusbar']);
    assert.equal(fetchedUrls.length, 0, 'must NOT call external fetch when host statusbarBlock is already available');
    assert.equal(scriptsAdded.length, 1);
    assert.ok(scriptsAdded[0].includes('mountStatusBar'));
  }

  // Case 2B: When hostCodeFallback is empty, falls back to jaeseongs95 GitHub Raw URL
  {
    const fetchedUrls = [];
    const { win, doc, scriptsAdded } = makeRemoteTestEnv(async (url) => {
      fetchedUrls.push(url);
      return { ok: true, async text() { return '// statusbar remote bundle'; } };
    });
    const noBlockBridge = {
      async fetchHostInstalledPluginInfo() {
        return {
          hasStatusbar: true,
          hasMcpManager: true,
          hasKoTranslator: true,
          statusbarBlock: '',
          koBlock: '',
        };
      },
    };
    const res = await ensureRemoteCompanionScripts(win, doc, noBlockBridge);
    assert.deepEqual(res.loaded, ['antigravity-statusbar', 'ko-thought-translator']);
    assert.equal(fetchedUrls.length, 2);
    assert.ok(fetchedUrls[0].includes('jaeseongs95/antigravity-statusbar/main/dist/statusbar_autoinject.js'));
    assert.ok(fetchedUrls[1].includes('jaeseongs95/antigravity-ko-translator/main/plugins/ko-thought-translator/scripts/ko_thought_autoinject.js'));
    assert.ok(!fetchedUrls.some((u) => u.includes('superselect321')));
    assert.equal(scriptsAdded.length, 2);
  }

  // Case 3: User installed all 3 plugins, and network fetch fails -> falls back to host code blocks
  currentHostAutoinjectContent = [
    'function mountStatusBar(){}',
    'window.agyStatusBar={};',
    mcpBegin,
    'function mountMcpManager(){}',
    mcpEnd,
    koBegin,
    'window.__agyKoThoughtCleanup=()=>{};',
    koEnd,
  ].join('\n');
  {
    const { win, doc, bridge, scriptsAdded } = makeRemoteTestEnv(async () => {
      throw new Error('Network unreachable');
    });
    const res = await ensureRemoteCompanionScripts(win, doc, bridge);
    assert.deepEqual(res.loaded, ['antigravity-statusbar', 'ko-thought-translator']);
    assert.equal(scriptsAdded.length, 2);
    assert.ok(scriptsAdded[0].includes('mountStatusBar'));
    assert.ok(scriptsAdded[1].includes('__agyKoThoughtCleanup'));
  }
});

test('covers D-0005~D-0011 regressions: writeMcpConfig/toggleServerTool persistence error checks, GetCustomizationStates states[].path, parseSmartMcpInput non-5 runtimes with URL args, and Settings pane banner', async () => {
  // 1. D-0010: parseSmartMcpInput with bun/deno/custom binary + URL argument must remain stdio
  const bunCmd = parseSmartMcpInput('bun run server.ts --endpoint https://api.example.com/v1');
  assert.equal(bunCmd.ok, true);
  assert.equal(bunCmd.spec.command, 'bun');
  assert.deepEqual(bunCmd.spec.args, ['run', 'server.ts', '--endpoint', 'https://api.example.com/v1']);
  assert.equal(bunCmd.spec.url, undefined);

  // 2. D-0005 & D-0006: createHostMcpBridge returns ok:false when writeFile is missing on a real host service, and resolves path from states[].path
  const readOnlyHostService = {
    async getCustomizationStates() {
      return {
        states: [{ path: 'C:/Users/TestUser/.gemini/config/plugins/test/SKILL.md' }],
      };
    },
    async readFile() {
      return { content: new TextEncoder().encode('{"mcpServers":{"my-srv":{"command":"npx"}}}') };
    },
    async getMcpServerStates() {
      return { states: [] };
    },
    async refreshMcpServers() {
      return {};
    },
  };

  const roBridge = createHostMcpBridge({ hostService: readOnlyHostService });
  const resolvedUri = await roBridge.resolveMcpConfigUri();
  assert.equal(resolvedUri, 'file:///C:/Users/TestUser/.gemini/config/mcp_config.json');

  const pluginInfo = await roBridge.fetchHostInstalledPluginInfo(true);
  assert.ok(pluginInfo === null || pluginInfo.geminiRoot === 'C:/Users/TestUser/.gemini');

  const writeAttempt = await roBridge.writeMcpConfig({ mcpServers: { a: { command: 'npx' } } });
  assert.equal(writeAttempt.ok, false, 'writeMcpConfig must return ok:false when host service lacks writeFile');

  const toggleToolAttempt = await roBridge.toggleServerTool('my-srv', 'tool_a', false);
  assert.equal(toggleToolAttempt.ok, false, 'toggleServerTool must return ok:false when host service lacks writeFile');

  // 3. D-0013: getRemoteControlProxyAdapter captures RemoteControlComponent via Angular 19 numeric __ngContext__ + ɵgetLContext OR visibilitychange/method hooks when handleIframeMessage was bound BEFORE bookmarklet
  class FakeRemoteControlComponent {
    constructor(winRef, docRef) {
      this._boundMsg = this.handleIframeMessage.bind(this);
      if (winRef && typeof winRef.addEventListener === 'function') {
        winRef.addEventListener('message', this._boundMsg);
      }
      if (docRef && typeof docRef.addEventListener === 'function') {
        docRef.addEventListener('visibilitychange', () => this.isTabHidden());
      }
    }
    handleIframeMessage(_ev) {}
    isTabHidden() {
      return false;
    }
    async proxyCommand(rpcPath, _bytes) {
      if (rpcPath.endsWith('/GetMcpServerStates')) {
        return {
          payload: new TextEncoder().encode(JSON.stringify({ states: [{ serverName: 'rc-srv', status: 2 }] })),
        };
      }
      return { payload: new TextEncoder().encode('{}') };
    }
  }
  const winListeners = [];
  const docListeners = [];
  const rcElNumeric = { __ngContext__: 42 };
  let rcCompInstance = null;
  const rcDoc = {
    addEventListener(type, fn) {
      if (type === 'visibilitychange') docListeners.push(fn);
    },
    dispatchEvent(ev) {
      if (ev?.type === 'visibilitychange') {
        for (const fn of docListeners) fn(ev);
      }
    },
    querySelector(sel) {
      if (sel === 'ga-remote-control') return rcElNumeric;
      return null;
    },
  };
  const rcWin = {
    document: rcDoc,
    addEventListener(type, fn) {
      if (type === 'message') winListeners.push(fn);
    },
    dispatchEvent(ev) {
      if (ev?.type === 'message') {
        for (const fn of winListeners) fn(ev);
      }
    },
    default_GoogleAntigravity: {
      rcMod: {
        RemoteControlComponent: FakeRemoteControlComponent,
        '\u0275getLContext'(el) {
          if (el === rcElNumeric) {
            return { lView: [null, null, rcCompInstance] };
          }
          return null;
        },
      },
    },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    MessageEvent: class {
      constructor(type, init) {
        this.type = type;
        this.data = init?.data;
      }
    },
  };
  // Instantiate component and bind listener BEFORE createHostMcpBridge runs (real bookmarklet order!)
  rcCompInstance = new FakeRemoteControlComponent(rcWin, rcDoc);
  const rcBridge = createHostMcpBridge({ window: rcWin, document: rcDoc });
  const rcStatesRes = await rcBridge.fetchServerStates();
  assert.equal(rcStatesRes.ok, true);
  assert.equal(rcStatesRes.states.length, 1);
  assert.equal(rcStatesRes.states[0].serverName, 'rc-srv');

  // 4. D-0013: ensureRemoteCompanionScripts retries when fetchHostInstalledPluginInfo initially returns null
  let fetchInfoCalls = 0;
  let scheduledRetryFn = null;
  const retryWin = {
    location: { hostname: 'antigravity.google.com' },
    setTimeout(fn) {
      scheduledRetryFn = fn;
      return 1;
    },
    async fetch() {
      return { ok: true, async text() { return '// statusbar delayed load'; } };
    },
  };
  const retryScripts = [];
  const retryDoc = {
    head: {
      appendChild(s) {
        retryScripts.push(s);
      },
    },
    createElement() {
      return { text: '' };
    },
    querySelector() {
      return null;
    },
  };
  const retryBridge = {
    async fetchHostInstalledPluginInfo() {
      fetchInfoCalls += 1;
      if (fetchInfoCalls === 1) return null;
      return {
        resolved: true,
        hasStatusbar: true,
        hasMcpManager: true,
        hasKoTranslator: false,
        statusbarBlock: 'function mountStatusBar(){}',
      };
    },
  };
  const firstTry = await ensureRemoteCompanionScripts(retryWin, retryDoc, retryBridge);
  assert.deepEqual(firstTry.loaded, []);
  assert.equal(typeof scheduledRetryFn, 'function', 'must schedule retry when host info is not yet available');
  const secondTry = await scheduledRetryFn();
  assert.deepEqual(secondTry.loaded, ['antigravity-statusbar']);
  assert.equal(retryScripts.length, 1);
});

test('covers MCP-BUG-01..06 regressions: line-anchored marker extraction, 2-plugin install false-positive prevention, UI error banners, Auto-Fill originalName safety, async Blob URL revoke, and body replacement rebind', async () => {
  // 1. MCP-BUG-01: 3-plugin bundle with literal marker inside ko-thought-translator must extract clean statusbarBlock and mcpBlock
  const threePluginBundle = [
    '// Antigravity Custom Statusbar',
    'function mountStatusBar() { window.agyStatusBar = {}; }',
    '// === BEGIN_AGY_MCP_MANAGER_V1 ===',
    '// Antigravity Custom MCP Server Manager',
    'function mountMcpManager() { window.agyMcpManager = {}; }',
    '// === END_AGY_MCP_MANAGER_V1 ===',
    '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
    'const literalMarkers = ["/* === BEGIN_AGY_MCP_MANAGER_V1 === */", "// === BEGIN_AGY_MCP_MANAGER_V1 ==="];',
    'window.__agyKoThoughtCleanup = () => {};',
    '// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
  ].join('\n');

  const threePluginBridge = createHostMcpBridge({
    hostService: {
      async getCustomizationStates() {
        return { states: [{ path: 'C:/Users/Lenovo/.gemini/config/plugins/test/SKILL.md' }] };
      },
      async readFile() {
        return { content: new TextEncoder().encode(threePluginBundle) };
      },
    },
  });
  const info3 = await threePluginBridge.fetchHostInstalledPluginInfo(true);
  assert.equal(info3.hasStatusbar, true);
  assert.equal(info3.hasMcpManager, true);
  assert.equal(info3.hasKoTranslator, true);
  assert.ok(info3.statusbarBlock.includes('function mountStatusBar()'));
  assert.ok(!info3.statusbarBlock.includes('function mountMcpManager()'), 'statusbarBlock must NOT include mcp-manager code');
  assert.ok(info3.mcpBlock.includes('function mountMcpManager()'));
  assert.ok(!info3.mcpBlock.includes('literalMarkers'), 'mcpBlock must NOT match string literals inside ko-thought-translator');

  // 2. MCP-BUG-01b: 2-plugin install (mcp-manager + ko-translator without statusbar) must have hasStatusbar: false
  const twoPluginBundle = [
    '// === BEGIN_AGY_MCP_MANAGER_V1 ===',
    '// Antigravity Custom MCP Server Manager',
    'function mountMcpManager() { if (window.agyStatusBar) {} }',
    '// === END_AGY_MCP_MANAGER_V1 ===',
    '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
    'window.__agyKoThoughtCleanup = () => {};',
    '// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
  ].join('\n');
  const twoPluginBridge = createHostMcpBridge({
    hostService: {
      async getCustomizationStates() {
        return { states: [{ path: 'C:/Users/Lenovo/.gemini/config/plugins/test/SKILL.md' }] };
      },
      async readFile() {
        return { content: new TextEncoder().encode(twoPluginBundle) };
      },
    },
  });
  const info2 = await twoPluginBridge.fetchHostInstalledPluginInfo(true);
  assert.equal(info2.hasStatusbar, false, '2-plugin install without statusbar must report hasStatusbar: false');
  assert.equal(info2.statusbarBlock, '');
  assert.equal(info2.hasMcpManager, true);
  assert.equal(info2.hasKoTranslator, true);

  // 3. MCP-BUG-04: toggleServerEnabled returns ok:false when writeMcpConfig fails
  const roToggleBridge = createHostMcpBridge({
    hostService: {
      async getCustomizationStates() {
        return { states: [{ path: 'C:/Users/Lenovo/.gemini/config/plugins/test/SKILL.md' }] };
      },
      async readFile() {
        return { content: new TextEncoder().encode(JSON.stringify({ mcpServers: { srv1: { command: 'npx' } } })) };
      },
      async getMcpServerStates() {
        return { states: [{ serverName: 'srv1', status: 2, tools: [{ name: 't1' }] }] };
      },
    },
  });
  const toggleRes = await roToggleBridge.toggleServerEnabled('srv1', false);
  assert.equal(toggleRes.ok, false, 'toggleServerEnabled must return ok:false when writeFile is unavailable');
});
