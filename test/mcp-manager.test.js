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
  assert.equal(mockWin.__agyMcpManagerActive, MCP_MANAGER_VERSION, 'MCP-D0016-ACTIVE-GLOBAL: mountMcpManager must set window.__agyMcpManagerActive to MCP_MANAGER_VERSION');

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
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(
    injectedPane.querySelector('[data-mcp-server-card="ledger-portal-jaeseong"]'),
    'MCP-CR-01: clicking MCP Servers tab in Settings modal must call reloadData() and render existing server cards'
  );

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

  // 3. D-0013 / MCP-BUG-02: resolveRemoteControlInstance captures pre-existing component on Angular 19 numeric __ngContext__ WITHOUT ɵgetLContext via URL_CHANGED prototype hook
  let urlChangedMutated = false;
  class FakeRemoteControlComponent {
    constructor(w) {
      this.destroyed = false;
      this._boundHandler = this.handleIframeMessage.bind(this);
      w.addEventListener('message', this._boundHandler);
    }
    handleIframeMessage(ev) {
      if (!ev || ev.data === '__agy_probe__') return;
      if (ev.data && ev.data.type === 'URL_CHANGED') {
        this.handleUrlChanged(ev.data.path || '');
      }
    }
    handleUrlChanged(_p) {
      urlChangedMutated = true;
    }
    async proxyCommand(rpcPath) {
      if (rpcPath.endsWith('/GetMcpServerStates')) {
        return {
          payload: new TextEncoder().encode(
            JSON.stringify({ states: [{ serverName: 'rc-srv', status: 2 }] })
          ),
        };
      }
      return { payload: new TextEncoder().encode('{}') };
    }
  }
  const winListeners = [];
  const rcElNumeric = { __ngContext__: 42, querySelector: () => null };
  const rcDoc = {
    addEventListener() {},
    dispatchEvent() {},
    querySelector(sel) {
      if (sel === 'ga-remote-control') return rcElNumeric;
      return null;
    },
  };
  const rcWin = {
    document: rcDoc,
    location: { href: 'https://antigravity.google.com/r/123', origin: 'https://antigravity.google.com' },
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
        this.origin = init?.origin;
        this.source = init?.source;
      }
    },
  };
  // Instantiate component and bind listener BEFORE createHostMcpBridge runs (real bookmarklet order!)
  new FakeRemoteControlComponent(rcWin);
  const rcBridge = createHostMcpBridge({ window: rcWin, document: rcDoc });
  const rcStatesRes = await rcBridge.fetchServerStates();
  assert.equal(rcStatesRes.ok, true);
  assert.equal(rcStatesRes.states.length, 1);
  assert.equal(rcStatesRes.states[0].serverName, 'rc-srv');
  assert.equal(urlChangedMutated, false, 'probing via URL_CHANGED must not execute original handleUrlChanged body');

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

  // 2b. MCP-BUG-01c: All 7 install combinations using real buildBundle({ write: false }).bundle without any false positives
  const { buildBundle } = require('../scripts/build');
  const realMcpBundle = buildBundle({ write: false }).bundle;
  const mcpBeginMark = '// === ' + ['BEGIN_AGY_MCP', 'MANAGER_V1'].join('_') + ' ===';
  const mcpEndMark = '// === ' + ['END_AGY_MCP', 'MANAGER_V1'].join('_') + ' ===';
  const koBeginMark = '// === ' + ['BEGIN_AGY_KO', 'THOUGHT_LOCALIZER_V2'].join('_') + ' ===';
  const koEndMark = '// === ' + ['END_AGY_KO', 'THOUGHT_LOCALIZER_V2'].join('_') + ' ===';
  const realMcpMarked = `${mcpBeginMark}\n${realMcpBundle}\n${mcpEndMark}`;
  const fakeSbBundle = [
    '// Antigravity Statusbar',
    'function mountStatusBar() { const l = "function mountMcpManager( __agyKoThoughtCleanup"; }',
  ].join('\n');
  const fakeKoMarked = [
    koBeginMark,
    'const literals = ["function mountStatusBar(", "function mountMcpManager(", "agy-ctx-statusbar"];',
    'window.__agyKoThoughtCleanup = () => {};',
    koEndMark,
  ].join('\n');

  const combos = [
    { name: '1: sb only', text: fakeSbBundle, exp: [true, false, false] },
    { name: '2: mcp only (marked)', text: realMcpMarked, exp: [false, true, false] },
    { name: '2b: mcp only (raw unmarked)', text: realMcpBundle, exp: [false, true, false] },
    { name: '3: ko only', text: fakeKoMarked, exp: [false, false, true] },
    { name: '4: sb + mcp', text: `${fakeSbBundle}\n${realMcpMarked}`, exp: [true, true, false] },
    { name: '5: sb + ko', text: `${fakeSbBundle}\n${fakeKoMarked}`, exp: [true, false, true] },
    { name: '6: mcp + ko', text: `${realMcpMarked}\n${fakeKoMarked}`, exp: [false, true, true] },
    { name: '7: sb + mcp + ko', text: `${fakeSbBundle}\n${realMcpMarked}\n${fakeKoMarked}`, exp: [true, true, true] },
  ];
  for (const c of combos) {
    const comboBridge = createHostMcpBridge({
      hostService: {
        async getCustomizationStates() {
          return { states: [{ path: 'C:/Users/Lenovo/.gemini/config/plugins/test/SKILL.md' }] };
        },
        async readFile() {
          return { content: new TextEncoder().encode(c.text) };
        },
      },
    });
    const res = await comboBridge.fetchHostInstalledPluginInfo(true);
    assert.deepEqual(
      [res.hasStatusbar, res.hasMcpManager, res.hasKoTranslator],
      c.exp,
      `combo ${c.name} failed detection`
    );
  }

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

  // 4. Rendering optimization: ensureModalStyles is idempotent, companion mutations are ignored, and __rebindIfBodyReplaced is a no-op unless body/styles changed
  const { ensureModalStyles } = require('../src/modal-ui');
  let styleSetterCount = 0;
  let storedCss = '';
  const styleEl = {
    id: 'agy-mcp-manager-styles',
    get textContent() { return storedCss; },
    set textContent(v) {
      styleSetterCount += 1;
      storedCss = v;
    },
  };
  const styleDoc = {
    head: { appendChild() {} },
    getElementById(id) { return id === 'agy-mcp-manager-styles' ? styleEl : null; },
    createElement() { return styleEl; },
  };
  ensureModalStyles(styleDoc);
  ensureModalStyles(styleDoc);
  ensureModalStyles(styleDoc);
  assert.equal(styleSetterCount, 1, 'ensureModalStyles must not overwrite style.textContent when unchanged');

  const koMutNode = {
    nodeType: 1,
    id: '',
    className: '',
    hasAttribute: (k) => k === 'data-ko-translated',
  };
  const statusBarMutNode = {
    nodeType: 1,
    id: '',
    className: 'agy-ctx-statusbar',
    hasAttribute: () => false,
  };
  assert.equal(
    isRelevantMutationList([
      { target: koMutNode, addedNodes: [statusBarMutNode] },
      { target: statusBarMutNode, addedNodes: [koMutNode] },
    ]),
    false,
    'ko-thought-translator and statusbar mutations must not trigger MCP Manager re-injection'
  );

  const plainChatParagraph = {
    nodeType: 1,
    tagName: 'P',
    id: '',
    className: 'chat-prose',
    getAttribute: () => null,
    hasAttribute: () => false,
    querySelector: () => null,
  };
  assert.equal(
    isRelevantMutationList([
      { target: plainChatParagraph, addedNodes: [plainChatParagraph], removedNodes: [] },
    ]),
    false,
    'ordinary chat paragraph mutations must not trigger MCP Manager DOM scans'
  );

  const settingsModalNode = {
    nodeType: 1,
    tagName: 'DIV',
    id: '',
    className: 'settings-modal-container',
    getAttribute: () => null,
    hasAttribute: () => false,
    querySelector: () => null,
  };
  assert.equal(
    isRelevantMutationList([
      { target: plainChatParagraph, addedNodes: [settingsModalNode], removedNodes: [] },
    ]),
    true,
    'adding settings-modal-container must trigger MCP Manager injection'
  );

  // 5. ANTIGRAVITY_MCP_MANAGER-D-0015 regressions:
  //    a) buildAuthHeaders in apiKey mode removes stale Authorization and case-insensitive duplicate headers
  const { buildAuthHeaders } = require('../src/mcp-config-schema');
  const cleanedHeaders = buildAuthHeaders({
    mode: 'apiKey',
    apiKeyHeader: 'X-API-Key',
    apiKeyValue: 'secret-key-123',
    baseHeaders: {
      Authorization: 'Bearer old-token',
      'x-api-key': 'old-key',
      'X-Custom-Extra': 'keep-me',
    },
  });
  assert.equal(cleanedHeaders.Authorization, undefined, 'apiKey mode must remove stale Authorization header');
  assert.equal(cleanedHeaders['x-api-key'], undefined, 'apiKey mode must remove case-insensitive duplicate header');
  assert.equal(cleanedHeaders['X-API-Key'], 'secret-key-123', 'apiKey mode must set canonical header key');
  assert.equal(cleanedHeaders['X-Custom-Extra'], 'keep-me', 'apiKey mode must preserve unrelated headers');

  //    b) toggleServerTool works with fallback localStorage and trailing newline even without hostService
  const localLsMap = new Map([
    ['agy-custom-mcp-config-backup-v1', JSON.stringify({ mcpServers: { srvA: { command: 'node' } } })],
  ]);
  const localOnlyBridge = createHostMcpBridge({
    localStorage: {
      getItem: (k) => localLsMap.get(k) || null,
      setItem: (k, v) => localLsMap.set(k, String(v)),
    },
  });
  const toolToggleRes = await localOnlyBridge.toggleServerTool('srvA', 'tool1', false);
  assert.equal(toolToggleRes.ok, true);
  assert.equal(toolToggleRes.persisted, true);
  assert.ok(
    localLsMap.get('agy-custom-mcp-config-backup-v1').endsWith('\n'),
    'toggleServerTool localStorage fallback must include trailing newline'
  );

  //    c) openEditPopup dynamically updates header title (.agy-mcp-title) when switching between Add and Edit modes
  const { createModalController } = require('../src/modal-ui');
  const popupEls = new Map();
  function makeSimpleNode(tag) {
    return {
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      value: '',
      type: '',
      checked: false,
      style: {},
      children: [],
      attrs: new Map(),
      listeners: new Map(),
      setAttribute(k, v) {
        this.attrs.set(k, String(v));
        if (k === 'id') this.id = String(v);
      },
      getAttribute(k) { return this.attrs.get(k) || null; },
      appendChild(c) {
        c.parentNode = this;
        this.children.push(c);
        if (c.id) popupEls.set(c.id, c);
        return c;
      },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i !== -1) this.children.splice(i, 1);
      },
      replaceChildren(...nodes) {
        this.children = [...nodes];
      },
      addEventListener(ev, fn) {
        this.listeners.set(ev, fn);
      },
      querySelector(sel) {
        const walk = (n) => {
          for (const ch of n.children || []) {
            if (sel.startsWith('.') && (ch.className || '').split(/\s+/).includes(sel.slice(1))) return ch;
            if (sel.startsWith('[data-testid="')) {
              const tid = sel.slice(14, -2);
              if (ch.getAttribute && ch.getAttribute('data-testid') === tid) return ch;
            }
            const found = walk(ch);
            if (found) return found;
          }
          return null;
        };
        return walk(this);
      },
    };
  }
  const popupDoc = {
    head: makeSimpleNode('head'),
    body: makeSimpleNode('body'),
    createElement: (t) => makeSimpleNode(t),
    createDocumentFragment: () => makeSimpleNode('frag'),
    getElementById: (id) => popupEls.get(id) || null,
  };
  const popupCtrl = createModalController({
    document: popupDoc,
    bridge: {
      async readMcpConfig() {
        return {
          uri: 'file:///mcp_config.json',
          rawText: JSON.stringify({ mcpServers: { existingSrv: { command: 'npx', args: ['-y', 'srv'] } } }),
          config: { mcpServers: { existingSrv: { command: 'npx', args: ['-y', 'srv'] } } },
        };
      },
      async fetchServerStates() { return []; },
    },
  });
  await popupCtrl.openEditPopup('', { createNew: true });
  const backdropEl = popupEls.get('agy-mcp-edit-popup-backdrop');
  assert.ok(backdropEl);
  assert.equal(backdropEl.querySelector('.agy-mcp-title').textContent, 'Add Custom MCP Server');
  await popupCtrl.openEditPopup('existingSrv');
  assert.equal(
    backdropEl.querySelector('.agy-mcp-title').textContent,
    '⚙️ Edit Custom MCP Server Settings',
    're-calling openEditPopup with an existing server while popup is open must update header title'
  );

  // 6. ANTIGRAVITY_MCP_MANAGER-D-0016 (MCP-CR-02..04) regressions:
  //    a) MCP-CR-02: editing and saving an existing custom server in openEditPopup preserves disabledTools
  {
    let upsertedSpec = null;
    const cr02Els = new Map();
    function makeCr02Node(tag) {
      const node = {
        tagName: String(tag).toUpperCase(),
        id: '',
        className: '',
        textContent: '',
        value: '',
        type: '',
        checked: false,
        style: {},
        children: [],
        attrs: new Map(),
        listeners: new Map(),
        classList: {
          add(...t) {
            const s = new Set((node.className || '').split(/\s+/).filter(Boolean));
            for (const x of t) s.add(x);
            node.className = Array.from(s).join(' ');
          },
          remove(...t) {
            const s = new Set((node.className || '').split(/\s+/).filter(Boolean));
            for (const x of t) s.delete(x);
            node.className = Array.from(s).join(' ');
          },
        },
        setAttribute(k, v) {
          this.attrs.set(k, String(v));
          if (k === 'id') {
            this.id = String(v);
            cr02Els.set(this.id, this);
          }
        },
        getAttribute(k) { return this.attrs.get(k) || null; },
        appendChild(c) {
          c.parentNode = this;
          this.children.push(c);
          if (c.id) cr02Els.set(c.id, c);
          return c;
        },
        removeChild(c) {
          const i = this.children.indexOf(c);
          if (i !== -1) this.children.splice(i, 1);
        },
        replaceChildren(...nodes) {
          this.children = [...nodes];
        },
        addEventListener(ev, fn) {
          this.listeners.set(ev, fn);
        },
        click() {
          const fn = this.listeners.get('click');
          if (fn) return fn({ target: this, preventDefault() {}, stopPropagation() {} });
        },
        querySelector(sel) {
          const walk = (n) => {
            for (const ch of n.children || []) {
              if (sel.startsWith('.') && (ch.className || '').split(/\s+/).includes(sel.slice(1))) return ch;
              if (sel.startsWith('[data-testid="')) {
                const tid = sel.slice(14, -2);
                if (ch.getAttribute && ch.getAttribute('data-testid') === tid) return ch;
              }
              const found = walk(ch);
              if (found) return found;
            }
            return null;
          };
          return walk(this);
        },
      };
      return node;
    }
    const cr02Doc = {
      head: makeCr02Node('head'),
      body: makeCr02Node('body'),
      createElement: (t) => makeCr02Node(t),
      createDocumentFragment: () => makeCr02Node('frag'),
      getElementById: (id) => cr02Els.get(id) || null,
    };
    const cr02Ctrl = createModalController({
      document: cr02Doc,
      bridge: {
        async readMcpConfig() {
          return {
            uri: 'file:///mcp_config.json',
            rawText: '{}',
            config: {
              mcpServers: {
                fsSrv: {
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-filesystem'],
                  disabledTools: ['write_file', 'delete_file'],
                },
              },
            },
          };
        },
        async fetchServerStates() { return []; },
        async upsertCustomServer(_name, spec) {
          upsertedSpec = spec;
          return { ok: true };
        },
      },
    });
    await cr02Ctrl.openEditPopup('fsSrv');
    const saveBtn = cr02Els.get('agy-mcp-edit-popup-backdrop').querySelector('[data-testid="agy-mcp-popup-save-btn"]');
    assert.ok(saveBtn);
    await saveBtn.click();
    assert.ok(upsertedSpec, 'MCP-CR-02: upsertCustomServer must be called on save');
    assert.deepEqual(
      upsertedSpec.disabledTools,
      ['write_file', 'delete_file'],
      'MCP-CR-02: editing and saving an existing server must preserve disabledTools'
    );
  }

  //    c) MCP-CR-03: saving a URL with embedded token in default oauth or none mode preserves extracted Authorization header
  {
    const urlEmbeddedBuilt = validateAndBuildServerSpec({
      serverName: 'embedded-tok-srv',
      transport: 'http',
      url: 'https://tok_url_123@ssh-approval-origin.jaeseong.dev/mcp',
      authMode: 'oauth',
    });
    assert.equal(urlEmbeddedBuilt.ok, true);
    assert.equal(urlEmbeddedBuilt.spec.url, 'https://ssh-approval-origin.jaeseong.dev/mcp');
    assert.deepEqual(
      urlEmbeddedBuilt.spec.headers,
      { Authorization: 'Bearer tok_url_123' },
      'MCP-CR-03: URL-extracted Authorization header must not be wiped when form authMode is default oauth'
    );

    const urlNoneBuilt = validateAndBuildServerSpec({
      serverName: 'embedded-tok-none-srv',
      transport: 'http',
      url: 'https://tok_none_456@ssh-approval-origin.jaeseong.dev/mcp',
      authMode: 'none',
    });
    assert.equal(urlNoneBuilt.ok, true);
    assert.equal(urlNoneBuilt.spec.url, 'https://ssh-approval-origin.jaeseong.dev/mcp');
    assert.deepEqual(
      urlNoneBuilt.spec.headers,
      { Authorization: 'Bearer tok_none_456' },
      'MCP-D0016-RESIDUAL-01: URL-extracted Authorization header must be preserved even when form authMode is none'
    );
    const extractedFromUrlNone = extractAuthFromSpec(urlNoneBuilt.spec);
    assert.equal(extractedFromUrlNone.authMode, 'bearer');
    assert.equal(extractedFromUrlNone.bearerToken, 'tok_none_456');
  }

  //    d) MCP-CR-04: HTTP authMode (none / oauth_or_none), auto-client oauthScopes, custom apiKeyHeader (single & multi-header), and OAuth single custom header round-trip
  {
    const noneBuilt = validateAndBuildServerSpec({
      serverName: 'public-http-srv',
      transport: 'http',
      url: 'https://public.example.com/mcp',
      authMode: 'none',
    });
    assert.equal(noneBuilt.ok, true);
    assert.equal(
      extractAuthFromSpec(noneBuilt.spec).authMode,
      'none',
      'MCP-CR-04: HTTP authMode="none" must round-trip through validateAndBuildServerSpec and extractAuthFromSpec'
    );

    const autoScopesBuilt = validateAndBuildServerSpec({
      serverName: 'auto-oauth-srv',
      transport: 'http',
      url: 'https://oauth.example.com/mcp',
      authMode: 'oauth',
      oauthClientMode: 'auto',
      oauthScopes: 'mcp:tools openid',
    });
    assert.equal(autoScopesBuilt.ok, true);
    assert.deepEqual(
      autoScopesBuilt.spec.oauth,
      { scopes: ['mcp:tools', 'openid'] },
      'MCP-CR-04: oauthScopes in auto client mode must be saved into spec.oauth.scopes'
    );
    const extractedAutoScopes = extractAuthFromSpec(autoScopesBuilt.spec);
    assert.equal(extractedAutoScopes.oauthClientMode, 'auto');
    assert.equal(extractedAutoScopes.oauthScopes, 'mcp:tools openid');

    const customApiKeyBuilt = validateAndBuildServerSpec({
      serverName: 'custom-hdr-srv',
      transport: 'http',
      url: 'https://api.example.com/mcp',
      authMode: 'apiKey',
      apiKeyHeader: 'X-Custom-Auth',
      apiKeyValue: 'custom_secret_789',
      headersText: 'X-Tenant-Id=acme\nX-Region=ap-northeast-2',
    });
    assert.equal(customApiKeyBuilt.ok, true);
    const extractedCustomKey = extractAuthFromSpec(customApiKeyBuilt.spec);
    assert.equal(extractedCustomKey.authMode, 'apiKey', 'MCP-D0016-RESIDUAL-02: custom apiKeyHeader with extra headers must round-trip as apiKey mode');
    assert.equal(extractedCustomKey.apiKeyHeader, 'X-Custom-Auth');
    assert.equal(extractedCustomKey.apiKeyValue, 'custom_secret_789');
    assert.deepEqual(extractedCustomKey.extraHeaders, {
      'X-Tenant-Id': 'acme',
      'X-Region': 'ap-northeast-2',
    });

    const oauthSingleHeaderBuilt = validateAndBuildServerSpec({
      serverName: 'oauth-single-hdr-srv',
      transport: 'http',
      url: 'https://oauth.example.com/mcp',
      authMode: 'oauth',
      oauthClientMode: 'auto',
      headersText: 'X-Workspace=my-ws',
    });
    assert.equal(oauthSingleHeaderBuilt.ok, true);
    const extractedOauthSingle = extractAuthFromSpec(oauthSingleHeaderBuilt.spec);
    assert.equal(
      extractedOauthSingle.authMode,
      'oauth',
      'MCP-D0016-RESIDUAL-02: OAuth server with a single custom header must not be misclassified as apiKey on reload'
    );
    assert.deepEqual(extractedOauthSingle.extraHeaders, { 'X-Workspace': 'my-ws' });
  }
});

test('D-0017: mergeMcpManagerBlock and fetchHostInstalledPluginInfo ignore indented marker literals inside ko-thought-translator and preserve block-comment markers', async () => {
  const vm = require('node:vm');
  const existingWithKoLiterals = [
    '(() => { function mountStatusBar() {} globalThis.__sbOk = 1; })();',
    '',
    '/* === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 === */',
    '(() => {',
    '  const arr = [',
    "    '// === BEGIN_AGY_MCP_MANAGER_V1 ===',",
    "    '// === END_AGY_MCP_MANAGER_V1 ===',",
    "    '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===',",
    '  ];',
    '  // === BEGIN_AGY_MCP_MANAGER_V1 ===',
    '  // === END_AGY_MCP_MANAGER_V1 ===',
    '  globalThis.__koArrLen = arr.length;',
    '})();',
    '/* === END_AGY_KO_THOUGHT_LOCALIZER_V2 === */',
    '',
  ].join('\n');

  const merged = mergeMcpManagerBlock(existingWithKoLiterals, '(() => { globalThis.__mcpOk = 2; })();');
  assert.doesNotThrow(
    () => new vm.Script(merged, { filename: 'merged_statusbar_autoinject.js' }),
    'D-0017: mergeMcpManagerBlock must not slice or insert inside indented string literals causing SyntaxError'
  );
  const ctx = vm.createContext({});
  ctx.globalThis = ctx;
  new vm.Script(merged).runInContext(ctx);
  assert.equal(ctx.__sbOk, 1);
  assert.equal(ctx.__mcpOk, 2);
  assert.equal(ctx.__koArrLen, 3, 'D-0017: ko-thought-translator array literals must remain intact');
  assert.ok(
    merged.indexOf('// === BEGIN_AGY_MCP_MANAGER_V1 ===') < merged.indexOf('/* === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 === */'),
    'D-0017: MCP block must be inserted before block-comment KO_THOUGHT_LOCALIZER_V2 marker'
  );

  // Verify host-mcp-bridge fetchHostInstalledPluginInfo does not misdetect indented markers and captures outer double-wrapped end marker
  const doubleWrappedKoOnly = [
    'function mountStatusBar() {}',
    '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
    '/* === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 === */',
    'const x = [',
    "  '// === BEGIN_AGY_MCP_MANAGER_V1 ===',",
    "  '// === END_AGY_MCP_MANAGER_V1 ===',",
    '];',
    '  // === BEGIN_AGY_MCP_MANAGER_V1 ===',
    '  // === END_AGY_MCP_MANAGER_V1 ===',
    '/* === END_AGY_KO_THOUGHT_LOCALIZER_V2 === */',
    '// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
  ].join('\n');

  const mockWin = {
    __agyRemoteControlInstance: {
      destroyed: false,
      localUserInfo: { selectedGeminiDir: '/virtual/.gemini' },
      async proxyCommand(rpcPath) {
        if (rpcPath.endsWith('/GetCustomizationStates')) {
          return { payload: new TextEncoder().encode(JSON.stringify({ states: [] })) };
        }
        if (rpcPath.endsWith('/ReadFile')) {
          return {
            payload: new TextEncoder().encode(
              JSON.stringify({ contents: Buffer.from(doubleWrappedKoOnly, 'utf8').toString('base64') })
            ),
          };
        }
        return { payload: new TextEncoder().encode('{}') };
      },
    },
  };
  const bridge = createHostMcpBridge({ window: mockWin });
  const info = await bridge.fetchHostInstalledPluginInfo();
  assert.equal(info.hasStatusbar, true);
  assert.equal(info.hasKoTranslator, true);
  assert.equal(info.hasMcpManager, false, 'D-0017: indented MCP markers inside KO block must not set hasMcpManager=true');
  assert.ok(
    info.koBlock.endsWith('// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ==='),
    'D-0017: double-wrapped KO block must include the outer trailing end marker'
  );

  // Also verify (?:_V\d+)? future/versionless marker support in mergeMcpManagerBlock and fetchHostInstalledPluginInfo
  const v3Existing = [
    'function mountStatusBar() {}',
    '// === BEGIN_AGY_MCP_MANAGER_V2 ===',
    'window.__oldMcpV2 = 1;',
    '// === END_AGY_MCP_MANAGER_V2 ===',
    '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V3 ===',
    'window.__agyKoThoughtCleanup = () => {};',
    '// === END_AGY_KO_THOUGHT_LOCALIZER_V3 ===',
  ].join('\n');
  const mergedV3 = mergeMcpManagerBlock(v3Existing, 'window.__newMcp = 2;');
  assert.equal(mergedV3.includes('__oldMcpV2'), false, 'D-0017: mergeMcpManagerBlock must replace prior MCP_MANAGER_V2+ block via (?:_V\\d+)?');
  assert.ok(
    mergedV3.indexOf(MCP_BEGIN) < mergedV3.indexOf('// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V3 ==='),
    'D-0017: mergeMcpManagerBlock must insert before KO_THOUGHT_LOCALIZER_V3+ via (?:_V\\d+)?'
  );
  mockWin.__agyRemoteControlInstance.proxyCommand = async (rpcPath) => {
    if (rpcPath.endsWith('/GetCustomizationStates')) {
      return { payload: new TextEncoder().encode(JSON.stringify({ states: [] })) };
    }
    if (rpcPath.endsWith('/ReadFile')) {
      return { payload: new TextEncoder().encode(JSON.stringify({ contents: Buffer.from(v3Existing, 'utf8').toString('base64') })) };
    }
    return { payload: new TextEncoder().encode('{}') };
  };
  const bridgeV3 = createHostMcpBridge({ window: mockWin });
  const infoV3 = await bridgeV3.fetchHostInstalledPluginInfo();
  assert.equal(infoV3.hasMcpManager, true, 'D-0017: host-mcp-bridge must support MCP_MANAGER_V2+ via (?:_V\\d+)?');
  assert.equal(infoV3.hasKoTranslator, true, 'D-0017: host-mcp-bridge must support KO_THOUGHT_LOCALIZER_V3+ via (?:_V\\d+)?');
});

test('D-0018: validateAndBuildServerSpec preserves description on Stdio servers and modal-ui renders headersText field for HTTP servers', async () => {
  const stdioBuilt = validateAndBuildServerSpec(
    {
      serverName: 'stdio-desc-srv',
      description: 'Filesystem MCP local stdio tool',
      transport: 'stdio',
      command: 'npx',
      argsText: '-y @modelcontextprotocol/server-filesystem D:/work',
      envText: 'NODE_ENV=production',
    },
    { description: 'Old description', disabledTools: ['rm_file'] }
  );
  assert.equal(stdioBuilt.ok, true);
  assert.equal(
    stdioBuilt.spec.description,
    'Filesystem MCP local stdio tool',
    'D-0018: Stdio server spec must preserve non-empty description instead of deleting it'
  );
  assert.deepEqual(stdioBuilt.spec.disabledTools, ['rm_file']);

  const { createModalController } = require('../src/modal-ui');
  function makeEl(tag) {
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
      setAttribute(k, v) { this.attributes.set(k, String(v)); if (k === 'id') this.id = String(v); },
      getAttribute(k) { return k === 'id' ? (this.id || null) : (this.attributes.get(k) ?? null); },
      hasAttribute(k) { return k === 'id' ? Boolean(this.id) : this.attributes.has(k); },
      removeAttribute(k) { this.attributes.delete(k); },
      appendChild(c) { c.parentNode = this; c.parentElement = this; this.children.push(c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1); return c; },
      addEventListener(ev, fn) { if (!this.listeners.has(ev)) this.listeners.set(ev, []); this.listeners.get(ev).push(fn); },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const mAttr = /^\[([^=\]]+)="([^"]+)"\]$/.exec(sel);
        const walk = (n) => {
          for (const c of n.children) {
            if (sel.startsWith('#') && c.id === sel.slice(1)) out.push(c);
            else if (sel.startsWith('.') && (c.className || '').split(/\s+/).includes(sel.slice(1))) out.push(c);
            else if (mAttr && c.getAttribute(mAttr[1]) === mAttr[2]) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      classList: { add() {}, remove() {}, contains: () => false },
    };
    return el;
  }
  const doc = {
    head: makeEl('head'),
    body: makeEl('body'),
    createElement: (t) => makeEl(t),
    getElementById(id) { return this.head.querySelector(`#${id}`) || this.body.querySelector(`#${id}`); },
  };
  let savedSpec = null;
  const mockBridge = {
    readMcpConfig: async () => ({
      ok: true,
      uri: 'file:///mock/mcp_config.json',
      rawText: '{}',
      config: {
        mcpServers: {
          'http-hdr-srv': {
            serverUrl: 'https://api.example.com/mcp',
            headers: { 'X-Workspace-Id': 'ws-initial' },
          },
        },
      },
    }),
    fetchServerStates: async () => ({ ok: true, states: [] }),
    upsertCustomServer: async (_name, spec) => { savedSpec = spec; return { ok: true }; },
  };
  const modal = createModalController({ window: {}, document: doc, bridge: mockBridge });
  await modal.reloadData();
  await modal.openEditPopup('http-hdr-srv');
  const headersInput = doc.body.querySelector('[data-field="headersText"]');
  assert.ok(headersInput, 'D-0018: HTTP server editor must render [data-field="headersText"] input');
  assert.ok(headersInput.value.includes('X-Workspace-Id: ws-initial'));
  headersInput.value = 'X-Workspace-Id: ws-updated\nX-Env: staging';
  for (const fn of headersInput.listeners.get('input') || []) {
    fn({ target: headersInput });
  }
  const saveBtn = doc.body.querySelector('[data-testid="agy-mcp-popup-save-btn"]');
  for (const fn of saveBtn.listeners.get('click') || []) {
    await fn({ preventDefault() {}, stopPropagation() {} });
  }
  assert.deepEqual(savedSpec.headers, { 'X-Workspace-Id': 'ws-updated', 'X-Env': 'staging' });
});

test('D-0019: openAuthUrl blocks non-http(s) URI schemes (javascript:, file:, ms-msdt:) and allows valid https:/http: URLs', () => {
  const openedUrls = [];
  const bridge = createHostMcpBridge({
    window: {
      open(url, target, features) {
        openedUrls.push({ url, target, features });
      },
    },
  });

  assert.equal(bridge.openAuthUrl('javascript:alert(document.cookie)'), false, 'D-0019: javascript: URL must be rejected');
  assert.equal(bridge.openAuthUrl('file:///C:/Windows/System32/calc.exe'), false, 'D-0019: file: URL must be rejected');
  assert.equal(bridge.openAuthUrl('ms-msdt:/id PCWDiagnostic'), false, 'D-0019: custom protocol handler URL must be rejected');
  assert.equal(bridge.openAuthUrl('data:text/html,<script>alert(1)</script>'), false, 'D-0019: data: URL must be rejected');
  assert.equal(openedUrls.length, 0, 'D-0019: window.open must never be invoked for disallowed schemes');

  assert.equal(bridge.openAuthUrl('https://auth.example.com/oauth/authorize?client_id=abc'), true);
  assert.equal(bridge.openAuthUrl('http://127.0.0.1:8787/oauth/start'), true);
  assert.equal(openedUrls.length, 2);
});

test('D-0020: ensure_statusbar_patch rejects on exceptionDetails, avoids expectsKo/expectsMcp false positives, and falls back to Electron 35+ Browser CDP WS', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const http = require('node:http');
  const crypto = require('node:crypto');
  const { buildBundle } = require('../scripts/build');
  const patcherPath = path.join(__dirname, '..', 'scripts', 'ensure_statusbar_patch.js');
  const patcherSrc = fs.readFileSync(patcherPath, 'utf8').replace(/^#!.*\n/, '');

  let nextWsBehavior = null;
  let lastSentPayload = null;
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      setImmediate(() => { if (typeof this.onopen === 'function') this.onopen(); });
    }
    send(raw) {
      lastSentPayload = JSON.parse(raw);
      if (nextWsBehavior) nextWsBehavior(this, lastSentPayload);
    }
    close() {}
  }

  const ctx = vm.createContext({
    require,
    module: { exports: {} },
    exports: {},
    __dirname: path.dirname(patcherPath),
    __filename: patcherPath,
    process: { ...process, argv: [process.execPath, patcherPath], exit() {} },
    WebSocket: FakeWebSocket,
    Buffer,
    setTimeout,
    clearTimeout,
    console,
  });
  new vm.Script(patcherSrc + '\n;globalThis.__testConfigureCdp = configureTargetViaCdp;').runInContext(ctx);

  nextWsBehavior = (ws) => {
    setImmediate(() => {
      ws.onmessage({
        data: JSON.stringify({
          id: 1,
          result: {
            result: { type: 'object', subtype: 'error' },
            exceptionDetails: { text: 'Uncaught ReferenceError: brokenBundle is not defined' },
          },
        }),
      });
    });
  };
  await assert.rejects(
    () => ctx.__testConfigureCdp('ws://127.0.0.1:9222/devtools/page/1', 'brokenBundle()', 'h1', 1000),
    /ReferenceError/,
    'D-0020: configureTargetViaCdp must reject on exceptionDetails'
  );

  const combinedCode = [
    'function mountStatusBar() {}',
    'function mountMcpManager() { window.agyMcpManager = { destroy() {} }; }',
    'window.__ranCombined = (window.__ranCombined || 0) + 1;',
    'mountMcpManager();',
  ].join('\n');
  nextWsBehavior = (ws) => {
    setImmediate(() => {
      ws.onmessage({ data: JSON.stringify({ id: 1, result: { result: { value: 'INJECTED_OK' } } }) });
    });
  };
  await ctx.__testConfigureCdp('ws://127.0.0.1:9222/devtools/page/1', combinedCode, 'h-comb', 1000);
  const expr = lastSentPayload.params.expression;

  const onlyStatusbarWin = {
    agyStatusBar: {},
    __agyStatusBarCleanup: () => {},
    __agyStatusBarHash: 'h-comb',
    document: { querySelector: () => ({}) },
  };
  onlyStatusbarWin.window = onlyStatusbarWin;
  assert.equal(
    vm.runInNewContext(expr, onlyStatusbarWin),
    'INJECTED_OK',
    'D-0020: when MCP manager is missing from window, combined bundle must re-inject instead of returning ALREADY_ACTIVE'
  );

  // Standalone dist/mcp_manager_autoinject.js contains !win.__agyKoThoughtCleanup reference;
  // in a 1-plugin solo installation (no KO installed), guard MUST return ALREADY_ACTIVE!
  const { bundle: soloMcpBundle } = buildBundle({ write: false });
  await ctx.__testConfigureCdp('ws://127.0.0.1:9222/devtools/page/1', soloMcpBundle, 'h-solo-mcp', 1000);
  const soloMcpGuardOnly = lastSentPayload.params.expression.replace(soloMcpBundle, 'window.__soloMcpReinjected = true;');
  const soloMcpActiveWin = {
    agyMcpManager: { destroy() {} },
    __agyStatusBarHash: 'h-solo-mcp',
    document: { querySelector: () => null },
  };
  soloMcpActiveWin.window = soloMcpActiveWin;
  assert.equal(
    vm.runInNewContext(soloMcpGuardOnly, soloMcpActiveWin),
    'ALREADY_ACTIVE',
    'D-0020: standalone mcp_manager_autoinject.js must NOT falsely set expectsKo=true from !win.__agyKoThoughtCleanup reference'
  );

  // Electron 35+ Browser CDP WS fallback when /json/list returns []
  const cdpMethodsSeen = [];
  const sendWsFrame = (socket, obj) => {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    const hdr = payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : (() => { const b = Buffer.alloc(4); b[0] = 0x81; b[1] = 126; b.writeUInt16BE(payload.length, 2); return b; })();
    socket.write(Buffer.concat([hdr, payload]));
  };
  const server = http.createServer((req, res) => {
    if (req.url === '/json/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('upgrade', (req, socket) => {
    if (req.url !== '/devtools/browser/mcp-browser-id') {
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    let recvBuf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      recvBuf = Buffer.concat([recvBuf, chunk]);
      while (recvBuf.length >= 2) {
        const opcode = recvBuf[0] & 0x0f;
        if (opcode === 0x08) { socket.end(); return; }
        const masked = (recvBuf[1] & 0x80) !== 0;
        let len = recvBuf[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (recvBuf.length < 4) return;
          len = recvBuf.readUInt16BE(2);
          offset = 4;
        }
        const maskLen = masked ? 4 : 0;
        if (recvBuf.length < offset + maskLen + len) return;
        const body = Buffer.from(recvBuf.subarray(offset + maskLen, offset + maskLen + len));
        if (masked) {
          const mask = recvBuf.subarray(offset, offset + 4);
          for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
        }
        recvBuf = recvBuf.subarray(offset + maskLen + len);
        const msg = JSON.parse(body.toString('utf8'));
        cdpMethodsSeen.push(msg.method);
        if (msg.method === 'Target.getTargets') {
          sendWsFrame(socket, {
            id: msg.id,
            result: { targetInfos: [{ targetId: 'mcp-p1', type: 'page', url: 'https://127.0.0.1:51234/workbench.html' }] },
          });
        } else if (msg.method === 'Target.attachToTarget') {
          sendWsFrame(socket, { id: msg.id, result: { sessionId: 'mcp-sess-1' } });
        } else if (msg.method === 'Runtime.evaluate' && msg.sessionId === 'mcp-sess-1') {
          sendWsFrame(socket, {
            id: msg.id,
            sessionId: 'mcp-sess-1',
            result: { result: { type: 'string', value: 'INJECTED_OK' } },
          });
        } else if (msg.method === 'Target.detachFromTarget') {
          sendWsFrame(socket, { id: msg.id, result: {} });
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const fakeHome = '/virtual-mcp-home';
    const fakeAppData = '/virtual-mcp-appdata';
    const autoPath = path.join(fakeHome, '.gemini', 'antigravity', 'statusbar_autoinject.js');
    const portFilePath = path.join(fakeAppData, 'Antigravity', 'DevToolsActivePort');
    const customReq = (spec) => {
      if (spec === 'fs') {
        return {
          existsSync: (p) => p === autoPath || p === portFilePath,
          readFileSync: (p) => {
            if (p === autoPath) return 'function mountMcpManager() {}\n';
            if (p === portFilePath) return `${port}\n/devtools/browser/mcp-browser-id\n`;
            return '';
          },
        };
      }
      return require(spec);
    };
    const liveCtx = vm.createContext({
      require: customReq,
      module: { exports: {} },
      exports: {},
      __dirname: path.dirname(patcherPath),
      __filename: patcherPath,
      process: {
        ...process,
        env: { USERPROFILE: fakeHome, HOME: fakeHome, APPDATA: fakeAppData },
        argv: [process.execPath, patcherPath],
        exit() {},
      },
      WebSocket: undefined,
      URL,
      Buffer,
      setTimeout,
      clearTimeout,
      console,
    });
    new vm.Script(patcherSrc + '\n;globalThis.__testInjectLive = injectViaCdpLive;').runInContext(liveCtx);
    const liveRes = await liveCtx.__testInjectLive();
    assert.equal(liveRes.pageTargetCount, 1, 'D-0020: Browser CDP WS fallback must discover 1 page target when /json/list is []');
    assert.equal(liveRes.injectedCount, 1, 'D-0020: Browser CDP WS fallback must inject via Target.attachToTarget + Runtime.evaluate');
    assert.ok(cdpMethodsSeen.includes('Target.getTargets'));
    assert.ok(cdpMethodsSeen.includes('Target.attachToTarget'));
    assert.ok(cdpMethodsSeen.includes('Target.detachFromTarget'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('D-0021: scripts/build.js preserves multiline template literals across regex literals (/\\/*/, /`/, /^file:\\/\\//i, /"/g, [/]), and README/README.ko/LICENSE/package.json are consistent', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const rootDir = path.join(__dirname, '..');
  const buildPath = path.join(rootDir, 'scripts', 'build.js');
  const buildSrc = fs.readFileSync(buildPath, 'utf8').replace(/^#!.*\n/, '');

  const sampleTplModule = [
    'const tpl = `line1',
    '',
    '// preserved-slash-line',
    'col0-line`;',
    'const rBlock = /\\/*/;',
    'const tpl1 = `a1',
    '',
    '// keep-1',
    'b1`;',
    'const rTick = /`/;',
    'const tpl2 = `a2',
    '',
    '// keep-2',
    'b2`;',
    "const rFile = 'file:///x'.replace(/^file:\\/\\//i, `a3",
    '',
    '// keep-3',
    'b3`);',
    'const rQuote = \'"\'.replace(/"/g, `a4',
    '',
    '// keep-4',
    'b4`);',
    "const rClass = '/web/2.31/z'.match(/\\/web\\/([^/]+)/)[1] + `a5",
    '',
    '// keep-5',
    'b5`;',
    '// comment to strip',
    'module.exports = { tpl, rBlock: Boolean(rBlock), tpl1, tpl2, rFile, rQuote, rClass };',
  ].join('\n');

  const customRequire = (spec) => {
    if (spec === 'fs') {
      return {
        readFileSync: (p) => {
          if (String(p).endsWith('package.json')) return JSON.stringify({ version: '1.4.15' });
          if (String(p).endsWith('index.js')) return "module.exports = require('./mcp-config-schema');\n";
          if (String(p).endsWith('mcp-config-schema.js')) return sampleTplModule;
          return 'module.exports = {};\n';
        },
        mkdirSync() {},
        writeFileSync() {},
      };
    }
    return require(spec);
  };
  const mod = { exports: {} };
  const ctx = vm.createContext({
    require: customRequire,
    module: mod,
    exports: mod.exports,
    __dirname: path.dirname(buildPath),
    __filename: buildPath,
    process,
    Buffer,
    console,
  });
  new vm.Script(buildSrc).runInContext(ctx);
  const { bundle } = mod.exports.buildBundle({ write: false });
  const evalBox = vm.createContext({});
  evalBox.globalThis = evalBox;
  new vm.Script(bundle.replace("__require('.', './index');", "globalThis.__out = __require('.', './index');")).runInContext(evalBox);
  assert.equal(
    evalBox.__out.tpl,
    'line1\n\n// preserved-slash-line\ncol0-line',
    'D-0021: build.js must preserve multiline template literal blank lines, // lines, and column-0 indentation'
  );
  assert.equal(evalBox.__out.tpl1, 'a1\n\n// keep-1\nb1', 'D-0021: /\\/*/ regex must not trigger block comment state');
  assert.equal(evalBox.__out.tpl2, 'a2\n\n// keep-2\nb2', 'D-0021: /`/ regex must not corrupt template stack');
  assert.equal(evalBox.__out.rFile, 'a3\n\n// keep-3\nb3/x', 'D-0021: /^file:\\/\\//i regex must not break line scan early');
  assert.equal(evalBox.__out.rQuote, 'a4\n\n// keep-4\nb4', 'D-0021: /"/g regex must not corrupt double-quote state');
  assert.equal(evalBox.__out.rClass, '2.31a5\n\n// keep-5\nb5', 'D-0021: [/] inside regex character class must not terminate regex early');

  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  assert.equal(
    pkg.scripts && pkg.scripts.status,
    'node scripts/ensure_statusbar_patch.js --status',
    'D-0021: package.json must define npm run status matching README instructions'
  );
  assert.equal(fs.existsSync(path.join(rootDir, 'LICENSE')), true, 'D-0021: MIT LICENSE file must exist at repository root');
  const readmeEn = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
  const readmeKo = fs.readFileSync(path.join(rootDir, 'README.ko.md'), 'utf8');
  assert.equal(readmeEn.includes('StandaloneZero-Offset'), false, 'D-0021: README.md typo StandaloneZero-Offset must be fixed');
  assert.ok(
    readmeEn.startsWith(`# Antigravity Custom MCP Server Manager (\`antigravity-mcp-manager\` \`v${pkg.version}\`)`),
    'D-0021: README.md title version must match package.json'
  );
  assert.ok(
    readmeKo.startsWith(`# Antigravity 커스텀 MCP 서버 매니저 (\`antigravity-mcp-manager\` \`v${pkg.version}\`)`),
    'D-0021: README.ko.md title version must match package.json'
  );
  assert.equal(readmeEn.includes('16/16'), false, 'D-0021: stale 16/16 test count must be updated in README.md');
  assert.equal(readmeKo.includes('16/16'), false, 'D-0021: stale 16/16 test count must be updated in README.ko.md');
  assert.ok(readmeEn.includes('31/31'), 'D-0021: README.md must state 31/31 tests');
  assert.ok(readmeKo.includes('31/31'), 'D-0021: README.ko.md must state 31/31 tests');
});

test('D-0022: destroy() cleans up style tag, DOMContentLoaded listener, remote iframe load listener, hidden native settings pane, and Models tab highlight', () => {
  const vm = require('node:vm');
  const { buildBundle } = require('../scripts/build');
  function makeClassList(owner) {
    return {
      add(...t) { const s = new Set((owner.className || '').split(/\s+/).filter(Boolean)); t.forEach((x) => s.add(x)); owner.className = [...s].join(' '); },
      remove(...t) { const s = new Set((owner.className || '').split(/\s+/).filter(Boolean)); t.forEach((x) => s.delete(x)); owner.className = [...s].join(' '); },
      contains(t) { return (owner.className || '').split(/\s+/).includes(t); },
    };
  }
  function makeEl(tag) {
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      style: {},
      attributes: new Map(),
      children: [],
      listeners: new Map(),
      parentNode: null,
      parentElement: null,
      setAttribute(k, v) { this.attributes.set(k, String(v)); if (k === 'id') this.id = String(v); },
      getAttribute(k) { return k === 'id' ? (this.id || null) : (this.attributes.get(k) ?? null); },
      hasAttribute(k) { return k === 'id' ? Boolean(this.id) : this.attributes.has(k); },
      removeAttribute(k) { this.attributes.delete(k); },
      appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; c.parentElement = this; this.children.push(c); return c; },
      insertBefore(c, r) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; c.parentElement = this; const i = r ? this.children.indexOf(r) : -1; if (i === -1) this.children.push(c); else this.children.splice(i, 0, c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) { this.children.splice(i, 1); c.parentNode = null; c.parentElement = null; } return c; },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      addEventListener(ev, fn) { if (!this.listeners.has(ev)) this.listeners.set(ev, []); this.listeners.get(ev).push(fn); },
      removeEventListener(ev, fn) { if (this.listeners.has(ev)) this.listeners.set(ev, this.listeners.get(ev).filter((x) => x !== fn)); },
      dispatchEvent(ev) { const fns = [...(this.listeners.get(ev.type) || [])]; for (const fn of fns) fn(ev); },
      click() { const fns = this.listeners.get('click') || []; for (const fn of fns) fn({ target: this, preventDefault() {}, stopPropagation() {} }); },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (sel === '.flex.flex-col.gap-0\\.5' && cur.className === 'flex flex-col gap-0.5') return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const mHas = /^\[([^=\]]+)\]$/.exec(sel);
        const mEq = /^(?:button)?\[([^=\]]+)="([^"]+)"\]$/i.exec(sel);
        const mBtnPrefix = /^button\[data-testid\^="([^"]+)"\]$/i.exec(sel);
        const walk = (n) => {
          for (const c of n.children) {
            if (sel === 'ga-remote-control iframe' && c.tagName === 'IFRAME') out.push(c);
            else if (sel === 'span' && c.tagName === 'SPAN') out.push(c);
            else if (sel.startsWith('#') && c.id === sel.slice(1)) out.push(c);
            else if (sel === '.settings-modal-container' && c.classList.contains('settings-modal-container')) out.push(c);
            else if (sel === '.grow.w-full' && c.className === 'grow w-full') out.push(c);
            else if (mBtnPrefix && c.tagName === 'BUTTON' && (c.getAttribute('data-testid') || '').startsWith(mBtnPrefix[1])) out.push(c);
            else if (mEq && c.getAttribute(mEq[1]) === mEq[2]) out.push(c);
            else if (mHas && c.hasAttribute(mHas[1])) out.push(c);
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
  function makeDoc() {
    const docListeners = new Map();
    return {
      readyState: 'complete',
      head: makeEl('head'),
      body: makeEl('body'),
      createElement: (t) => makeEl(t),
      getElementById(id) { return this.head.querySelector(`#${id}`) || this.body.querySelector(`#${id}`); },
      querySelector(sel) { return this.head.querySelector(sel) || this.body.querySelector(sel); },
      querySelectorAll(sel) { return [...this.head.querySelectorAll(sel), ...this.body.querySelectorAll(sel)]; },
      addEventListener(ev, fn) { if (!docListeners.has(ev)) docListeners.set(ev, []); docListeners.get(ev).push(fn); },
      removeEventListener(ev, fn) { if (docListeners.has(ev)) docListeners.set(ev, docListeners.get(ev).filter((x) => x !== fn)); },
      dispatchEvent(ev) { const fns = [...(docListeners.get(ev.type) || [])]; for (const fn of fns) fn(ev); },
    };
  }

  const doc = makeDoc();
  const settingsModal = makeEl('div');
  settingsModal.className = 'settings-modal-container';
  const navList = makeEl('div');
  navList.className = 'flex flex-col gap-0.5';
  const modelsBtn = makeEl('button');
  modelsBtn.setAttribute('data-testid', 'settings-nav-item-Models');
  modelsBtn.className = 'bg-sidebar-secondary';
  const modelsSpan = makeEl('span');
  modelsSpan.className = 'text-foreground font-medium';
  modelsSpan.textContent = 'Models';
  modelsBtn.appendChild(modelsSpan);
  navList.appendChild(modelsBtn);
  const contentContainer = makeEl('div');
  contentContainer.className = 'grow w-full';
  const nativeModelsPane = makeEl('div');
  nativeModelsPane.id = 'native-models-pane';
  nativeModelsPane.style.display = 'flex';
  contentContainer.appendChild(nativeModelsPane);
  settingsModal.appendChild(navList);
  settingsModal.appendChild(contentContainer);
  doc.body.appendChild(settingsModal);

  const iframeDoc = makeDoc();
  const iframeWin = {
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
  };
  iframeWin.parent = null;
  const gaRemote = makeEl('ga-remote-control');
  const iframe = makeEl('iframe');
  iframe.contentWindow = iframeWin;
  iframe.contentDocument = iframeDoc;
  gaRemote.appendChild(iframe);
  doc.body.appendChild(gaRemote);

  const win = {
    document: doc,
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
  };
  iframeWin.parent = win;

  const mockBridge = {
    readMcpConfig: async () => ({ ok: true, config: { mcpServers: {} } }),
    fetchServerStates: async () => ({ ok: true, states: [] }),
  };

  const ctrl = mountMcpManager({ window: win, document: doc, bridge: mockBridge });
  const mcpNavBtn = doc.querySelector('[data-testid="settings-nav-item-McpManager"]');
  assert.ok(mcpNavBtn, 'MCP Servers nav button should be injected');
  mcpNavBtn.click();
  assert.equal(modelsBtn.classList.contains('bg-sidebar-secondary'), false, 'Models tab highlight cleared while MCP Servers is active');
  assert.equal(nativeModelsPane.style.display, 'none', 'native pane should be hidden while MCP Servers tab is active');
  assert.ok(doc.getElementById('agy-mcp-manager-styles'), 'style tag should be injected');
  assert.ok(iframeWin.agyMcpManager, 'child remote iframe should have mounted agyMcpManager');
  assert.equal(iframe.__agyMcpLoadBound, true, 'remote iframe load listener bound');

  ctrl.destroy();

  assert.equal(doc.getElementById('agy-mcp-manager-styles'), null, 'D-0022: destroy() must remove #agy-mcp-manager-styles');
  assert.equal(nativeModelsPane.style.display, 'flex', 'D-0022: destroy() must restore hidden native settings pane display');
  assert.equal(modelsBtn.classList.contains('bg-sidebar-secondary'), true, 'D-0022: destroy() while MCP Servers tab is active must restore left Models tab highlight');
  assert.equal(modelsSpan.classList.contains('text-foreground'), true, 'D-0022: destroy() must restore Models tab label foreground class');
  assert.equal(iframeWin.agyMcpManager, undefined, 'D-0022: destroy() must also destroy same-origin remote iframe instance');
  assert.equal(iframe.__agyMcpLoadBound, undefined, 'D-0022: destroy() must clear __agyMcpLoadBound on remote iframe');

  // Firing 'load' on remote iframe after destroy() must NOT zombie-remount inside iframeWin
  iframe.dispatchEvent({ type: 'load' });
  assert.equal(iframeWin.agyMcpManager, undefined, 'D-0022: iframe reload after destroy() must NOT zombie-remount agyMcpManager');

  // Evaluating bundle while document.readyState === 'loading', then calling destroy() before DOMContentLoaded fires must NOT zombie-remount
  const loadingDoc = makeDoc();
  loadingDoc.readyState = 'loading';
  const loadingWin = {
    document: loadingDoc,
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
  };
  const { bundle } = buildBundle({ write: false });
  const bootCtx = vm.createContext({
    window: loadingWin,
    document: loadingDoc,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Buffer,
    console,
  });
  bootCtx.globalThis = bootCtx;
  new vm.Script(bundle).runInContext(bootCtx);
  const manualCtrl = mountMcpManager({ window: loadingWin, document: loadingDoc, bridge: mockBridge });
  manualCtrl.destroy();
  loadingDoc.readyState = 'complete';
  loadingDoc.dispatchEvent({ type: 'DOMContentLoaded' });
  assert.equal(loadingWin.agyMcpManager, undefined, 'D-0022: destroy() must remove pending DOMContentLoaded listener so firing DOMContentLoaded does not zombie-mount');
});

test('D-0023: readMcpConfig distinguishes ENOENT from permission/RPC/JSON errors to prevent wiping mcp_config.json, and concurrent mutations serialize without lost updates', async () => {
  let diskContent = JSON.stringify({
    mcpServers: {
      existingA: { command: 'npx', args: ['-y', 'srv-a'] },
      existingB: { url: 'https://b.example.com/mcp' },
    },
  });
  let simulateReadFailure = true;
  const failingBridge = createHostMcpBridge({
    hostService: {
      async getStandaloneDir() {
        return { standaloneDir: 'C:/Users/TestUser/.gemini/antigravity/scratch' };
      },
      async readFile() {
        if (simulateReadFailure) {
          throw new Error('EACCES: permission denied or RPC deadline exceeded');
        }
        return { content: diskContent };
      },
      async writeFile({ content }) {
        diskContent = typeof content === 'string' ? content : new TextDecoder().decode(content);
        return {};
      },
      async refreshMcpServers() { return {}; },
    },
  });

  const failedRead = await failingBridge.readMcpConfig();
  assert.equal(failedRead.ok, false, 'D-0023: non-ENOENT readFile failure must return ok:false');
  assert.ok(failedRead.error, 'D-0023: readMcpConfig must expose error message on read failure');

  const abortedUpsert = await failingBridge.upsertCustomServer('newSrv', { command: 'node', args: ['x.js'] });
  assert.equal(abortedUpsert.ok, false, 'D-0023: upsertCustomServer must abort rather than overwriting unreadable mcp_config.json with empty {}');
  assert.ok(JSON.parse(diskContent).mcpServers.existingA, 'D-0023: existing servers on disk must remain untouched when readFile failed');

  // Concurrent mutations serialization check (no Lost Update!)
  simulateReadFailure = false;
  const slowBridge = createHostMcpBridge({
    hostService: {
      async getStandaloneDir() {
        return { standaloneDir: 'C:/Users/TestUser/.gemini/antigravity/scratch' };
      },
      async readFile() {
        const snapshot = diskContent;
        await new Promise((r) => setTimeout(r, 15));
        return { content: snapshot };
      },
      async writeFile({ content }) {
        await new Promise((r) => setTimeout(r, 10));
        diskContent = typeof content === 'string' ? content : new TextDecoder().decode(content);
        return {};
      },
      async refreshMcpServers() { return {}; },
      async toggleMcpServer() { return {}; },
    },
  });

  await Promise.all([
    slowBridge.toggleServerTool('existingA', 'tool_1', false),
    slowBridge.toggleServerTool('existingA', 'tool_2', false),
    slowBridge.upsertCustomServer('concurrentC', { command: 'uvx', args: ['mcp-c'] }),
  ]);
  const finalSaved = JSON.parse(diskContent);
  assert.deepEqual(
    finalSaved.mcpServers.existingA.disabledTools.sort(),
    ['tool_1', 'tool_2'],
    'D-0023: concurrent toggleServerTool calls must be serialized without losing earlier tool toggles'
  );
  assert.ok(finalSaved.mcpServers.concurrentC, 'D-0023: concurrent upsertCustomServer must also be preserved');
});

test('D-0024: Raw JSON Save & Refresh and Quick Auto-Add multipleServers invoke bridge.refreshServers() and multi-server Auto-Fill avoids undefined server name', async () => {
  const { createModalController } = require('../src/modal-ui');
  function makeNode(tag) {
    const n = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      value: '',
      style: {},
      children: [],
      attrs: new Map(),
      listeners: new Map(),
      classList: {
        add(...t) { const s = new Set((n.className || '').split(/\s+/).filter(Boolean)); t.forEach((x) => s.add(x)); n.className = [...s].join(' '); },
        remove(...t) { const s = new Set((n.className || '').split(/\s+/).filter(Boolean)); t.forEach((x) => s.delete(x)); n.className = [...s].join(' '); },
      },
      setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') this.id = String(v); },
      getAttribute(k) { return k === 'id' ? (this.id || null) : (this.attrs.get(k) ?? null); },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1); return c; },
      replaceChildren(...nodes) { this.children = [...nodes]; },
      addEventListener(ev, fn) { if (!this.listeners.has(ev)) this.listeners.set(ev, []); this.listeners.get(ev).push(fn); },
      async click() { for (const fn of this.listeners.get('click') || []) await fn({ target: this, preventDefault() {}, stopPropagation() {} }); },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const mAttr = /^\[([^=\]]+)="([^"]+)"\]$/.exec(sel);
        const walk = (x) => {
          for (const c of x.children || []) {
            if (sel.startsWith('#') && c.id === sel.slice(1)) out.push(c);
            else if (sel.startsWith('.') && (c.className || '').split(/\s+/).includes(sel.slice(1))) out.push(c);
            else if (mAttr && c.getAttribute(mAttr[1]) === mAttr[2]) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
    return n;
  }
  const doc = {
    head: makeNode('head'),
    body: makeNode('body'),
    createElement: (t) => makeNode(t),
    createDocumentFragment: () => makeNode('frag'),
    getElementById(id) { return this.head.querySelector(`#${id}`) || this.body.querySelector(`#${id}`); },
  };
  let refreshCount = 0;
  let storedCfg = { mcpServers: { baseSrv: { command: 'npx' } } };
  const ctrl = createModalController({
    doc,
    bridge: {
      async readMcpConfig() { return { ok: true, uri: 'file:///mcp_config.json', config: JSON.parse(JSON.stringify(storedCfg)) }; },
      async writeMcpConfig(cfg) { storedCfg = JSON.parse(JSON.stringify(cfg)); return { ok: true }; },
      async refreshServers() { refreshCount += 1; return { ok: true }; },
      async fetchServerStates() { return { ok: true, states: [] }; },
    },
  });

  await ctrl.openModal('raw');
  const rawSaveBtn = doc.body.querySelector('[data-testid="agy-mcp-save-raw-btn"]');
  assert.ok(rawSaveBtn);
  await rawSaveBtn.click();
  assert.equal(refreshCount, 1, 'D-0024: clicking Save mcp_config.json & Refresh must invoke bridge.refreshServers()');

  await ctrl.openModal('servers');
  const smartInput = doc.body.querySelector('[data-testid="agy-mcp-smart-input"]');
  const smartFillBtn = doc.body.querySelector('[data-testid="agy-mcp-smart-fill-btn"]');
  smartInput.value = JSON.stringify({ mcpServers: { alpha: { url: 'https://a.example.com/mcp' }, beta: { url: 'https://b.example.com/mcp' } } });
  await smartFillBtn.click();
  const banner = doc.body.querySelector('.agy-mcp-status-banner');
  assert.equal(
    String(banner.textContent || '').includes('"undefined"'),
    false,
    'D-0024: Auto-Fill Form on multi-server JSON must never display "undefined"'
  );

  await ctrl.openModal('servers');
  const smartInput2 = doc.body.querySelector('[data-testid="agy-mcp-smart-input"]');
  const smartAddBtn = doc.body.querySelector('[data-testid="agy-mcp-smart-add-btn"]');
  smartInput2.value = JSON.stringify({ mcpServers: { s1: { url: 'https://1.example.com/mcp' }, s2: { url: 'https://2.example.com/mcp' } } });
  await smartAddBtn.click();
  assert.equal(refreshCount, 2, 'D-0024: Quick Auto-Add for multipleServers must also invoke bridge.refreshServers()');
  assert.ok(storedCfg.mcpServers.baseSrv && storedCfg.mcpServers.s1 && storedCfg.mcpServers.s2);
});

test('D-0025: openEditPopup and openOAuthConnectModal prevent duplicate backdrop creation on concurrent opens or close-during-await', async () => {
  const { createModalController, EDIT_POPUP_ID, OAUTH_MODAL_ID } = require('../src/modal-ui');
  function makeNode(tag) {
    return {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      value: '',
      style: {},
      children: [],
      attrs: new Map(),
      listeners: new Map(),
      classList: { add() {}, remove() {} },
      setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') this.id = String(v); },
      getAttribute(k) { return k === 'id' ? (this.id || null) : (this.attrs.get(k) ?? null); },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) { this.children.splice(i, 1); c.parentNode = null; } return c; },
      addEventListener(ev, fn) { this.listeners.set(ev, fn); },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (x) => {
          for (const c of x.children || []) {
            if (sel.startsWith('#') && c.id === sel.slice(1)) out.push(c);
            else if (sel.startsWith('.') && (c.className || '').split(/\s+/).includes(sel.slice(1))) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
  }
  const doc = {
    head: makeNode('head'),
    body: makeNode('body'),
    createElement: (t) => makeNode(t),
    getElementById(id) { return this.head.querySelector(`#${id}`) || this.body.querySelector(`#${id}`); },
  };
  const ctrl = createModalController({
    doc,
    bridge: {
      async readMcpConfig() {
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true, config: { mcpServers: { srv1: { url: 'https://example.com/mcp' } } } };
      },
      async fetchServerStates() {
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true, states: [{ serverName: 'srv1', status: 1, authUrl: 'https://example.com/auth' }] };
      },
    },
  });

  // Concurrent double openOAuthConnectModal -> must append ONLY ONE #agy-mcp-oauth-connect-backdrop
  await Promise.all([
    ctrl.openOAuthConnectModal('srv1', 'https://example.com/auth'),
    ctrl.openOAuthConnectModal('srv1', 'https://example.com/auth'),
  ]);
  assert.equal(
    doc.body.querySelectorAll(`#${OAUTH_MODAL_ID}`).length,
    1,
    'D-0025: concurrent openOAuthConnectModal calls must never append duplicate backdrops'
  );
  ctrl.closeOAuthConnectModal();
  assert.equal(doc.body.querySelectorAll(`#${OAUTH_MODAL_ID}`).length, 0);

  // Calling openEditPopup then immediately closeEditPopup BEFORE reloadData resolves -> must stay closed!
  const pendingPopup = ctrl.openEditPopup('srv1');
  ctrl.closeEditPopup();
  await pendingPopup;
  assert.equal(
    doc.body.querySelectorAll(`#${EDIT_POPUP_ID}`).length,
    0,
    'D-0025: closing EditPopup while async reloadData is in flight must cancel pending mount'
  );
});

test('D-0026: ensure_statusbar_patch preserves // inside templates, parses NUL-padded ASAR headers, and guards non-http(s)/scriptJail frames', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const patcher = require('../scripts/ensure_statusbar_patch');

  const tplUtils = [
    '"use strict";',
    '// removable comment line 1 padding budget for statusbar injection block in utils.js',
    '// removable comment line 2 padding budget for statusbar injection block in utils.js',
    '// removable comment line 3 padding budget for statusbar injection block in utils.js',
    '// removable comment line 4 padding budget for statusbar injection block in utils.js',
    '// removable comment line 5 padding budget for statusbar injection block in utils.js',
    '// removable comment line 6 padding budget for statusbar injection block in utils.js',
    '// removable comment line 7 padding budget for statusbar injection block in utils.js',
    '// removable comment line 8 padding budget for statusbar injection block in utils.js',
    'const keep = `line1',
    '// KEEP_THIS_SLASH_IN_TEMPLATE',
    '/* KEEP_THIS_BLOCK_IN_TEMPLATE */',
    'line2`;',
    '    void win.loadURL(url);',
    '',
  ].join('\n');
  const inBuf = Buffer.from(tplUtils, 'utf8');
  const outBuf = patcher.transformExactSize(inBuf, patcher.UTILS_ANCHOR_TARGET, patcher.UTILS_ANCHOR_REPLACEMENT);
  assert.equal(outBuf.length, inBuf.length);
  assert.ok(outBuf.toString('utf8').includes('// KEEP_THIS_SLASH_IN_TEMPLATE'), 'D-0026: template // line must be preserved');
  assert.ok(outBuf.toString('utf8').includes('/* KEEP_THIS_BLOCK_IN_TEMPLATE */'), 'D-0026: template /* */ line must be preserved');
  assert.ok(
    patcher.MAIN_ANCHOR_REPLACEMENT.includes('isScriptJailSession') || patcher.MAIN_ANCHOR_REPLACEMENT.includes('getURL'),
    'D-0026: MAIN_ANCHOR_REPLACEMENT must guard against scriptJail / non-http(s) frames'
  );

  const tmpAsar = path.join(os.tmpdir(), `agy-mcp-nul-asar-${process.pid}-${Date.now()}.asar`);
  try {
    const body = Buffer.from(`"use strict"; // ${patcher.PATCH_MARKER}\n`, 'utf8');
    const hdrRaw = Buffer.from(JSON.stringify({
      files: {
        dist: {
          files: {
            'utils.js': { size: body.length, offset: '0' },
            'main.js': { size: body.length, offset: String(body.length) },
            'preload.js': { size: body.length, offset: String(body.length * 2) },
          },
        },
      },
    }), 'utf8');
    const paddedSize = hdrRaw.length + 2;
    const aligned = Math.ceil(paddedSize / 4) * 4;
    const u8Size = 4 + aligned;
    const u4Size = 4 + u8Size;
    const pre = Buffer.alloc(8 + u4Size, 0);
    pre.writeUInt32LE(4, 0);
    pre.writeUInt32LE(u4Size, 4);
    pre.writeUInt32LE(u8Size, 8);
    pre.writeUInt32LE(paddedSize, 12);
    hdrRaw.copy(pre, 16);
    fs.writeFileSync(tmpAsar, Buffer.concat([pre, body, body, body]));
    assert.equal(patcher.isAsarPatchedFast(tmpAsar), true, 'D-0026: NUL-padded ASAR header must parse cleanly');
  } finally {
    try { fs.unlinkSync(tmpAsar); } catch {}
  }
});

test('D-0027: build.js handles trailing backslash parity & MODULE_ORDER completeness, install.js repairs orphan markers & lone CR, and .gitattributes exists', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const rootDir = path.join(__dirname, '..');
  const { stripCommentsAndEmptyLines } = require('../scripts/build');

  assert.equal(
    stripCommentsAndEmptyLines("'unclosed\\\\\n// strip-me-after-even-backslash\nconst ok = 1;").includes('strip-me-after-even-backslash'),
    false,
    'D-0027: line ending with even backslashes (\\\\) must not keep inSingle=true onto next comment line'
  );
  assert.equal(
    stripCommentsAndEmptyLines("'continued\\\n// keep-me-inside-string\n';").includes('// keep-me-inside-string'),
    true,
    'D-0027: line ending with odd backslashes (\\) must preserve next line inside string'
  );

  const buildPath = path.join(rootDir, 'scripts', 'build.js');
  const buildSrc = fs.readFileSync(buildPath, 'utf8').replace(/^#!.*\n/, '');
  const customReq = (spec) => {
    if (spec === 'fs') {
      return {
        ...fs,
        readdirSync: (dir, opts) => {
          const entries = fs.readdirSync(dir, opts);
          if (path.resolve(String(dir)) === path.resolve(path.join(rootDir, 'src'))) {
            return [
              ...entries,
              opts && opts.withFileTypes
                ? { name: 'orphan-unlisted-mcp.js', isDirectory: () => false, isFile: () => true }
                : 'orphan-unlisted-mcp.js',
            ];
          }
          return entries;
        },
        mkdirSync() {},
        writeFileSync() {},
      };
    }
    return require(spec);
  };
  const mod = { exports: {} };
  new vm.Script(buildSrc).runInContext(vm.createContext({
    require: customReq,
    module: mod,
    exports: mod.exports,
    __dirname: path.dirname(buildPath),
    __filename: buildPath,
    process,
    Buffer,
    console,
  }));
  assert.throws(
    () => mod.exports.buildBundle({ write: false }),
    /orphan-unlisted-mcp\.js|MODULE_ORDER/,
    'D-0027: buildBundle must fail fast when a src/*.js file is missing from MODULE_ORDER'
  );

  // D-0027: orphan BEGIN marker without END marker in mergeMcpManagerBlock + lone \r normalization + .gitattributes existence
  const brokenExisting = [
    'window.agyStatusBar = {};',
    '// === BEGIN_AGY_MCP_MANAGER_V1 ===',
    'const brokenHalf = 1;',
  ].join('\r');
  const repaired = mergeMcpManagerBlock(brokenExisting, 'const cleanMcp = 2;');
  assert.equal(repaired.split('BEGIN_AGY_MCP_MANAGER').length - 1, 1, 'D-0027: orphan BEGIN marker must be replaced cleanly without duplicate blocks');
  assert.equal(repaired.includes('brokenHalf'), false);
  assert.equal(fs.existsSync(path.join(rootDir, '.gitattributes')), true, 'D-0027: .gitattributes must exist');
});

test('D-0028: parseArgsInput unescapes quotes & preserves JSON empty args, UTF-8 Base64 works without deprecated escape(), and destroy() escapes CSS attribute selectors', () => {
  assert.deepEqual(
    parseArgsInput('--msg "hello \\"world\\" \\\\ ok"'),
    ['--msg', 'hello "world" \\ ok'],
    'D-0028: parseArgsInput must unescape \\" and \\\\ inside double-quoted tokens'
  );
  assert.deepEqual(
    parseArgsInput('["--prefix", ""]'),
    ['--prefix', ''],
    'D-0028: parseArgsInput must preserve intentional empty string elements in JSON arrays'
  );

  const utf8Basic = buildAuthHeaders({
    authMode: 'basic',
    basicUser: '관리자',
    basicPass: '비밀번호!@#',
  });
  const decodedBasic = extractAuthFromSpec({ headers: utf8Basic });
  assert.equal(decodedBasic.authMode, 'basic');
  assert.equal(decodedBasic.basicUser, '관리자');
  assert.equal(decodedBasic.basicPass, '비밀번호!@#');
});

test('D-0029, D-0030, D-0031: host-adapter-config decouples vendor RPC/domain constants, and GitFlow CI + documentation templates exist', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const rootDir = path.join(__dirname, '..');
  const { resolveHostAdapterConfig, DEFAULT_HOST_ADAPTER_CONFIG } = require('../src/host-adapter-config');
  assert.ok(DEFAULT_HOST_ADAPTER_CONFIG.rpcServicePrefix);

  const customCfg = resolveHostAdapterConfig({
    rpcServicePrefix: '/custom.mcp.v1.HostService',
    remoteHostDomains: ['remote.custom-mcp.example'],
    companionScripts: {
      statusbarUrl: 'https://cdn.custom-mcp.example/sb.js',
      koTranslatorUrl: 'https://cdn.custom-mcp.example/ko.js',
    },
  });

  const seenRpcPaths = [];
  const customWin = {
    location: { hostname: 'remote.custom-mcp.example' },
    __agyRemoteControlInstance: {
      destroyed: false,
      async proxyCommand(rpcPath) {
        seenRpcPaths.push(rpcPath);
        return { payload: new TextEncoder().encode(JSON.stringify({ states: [{ serverName: 'custom-s1', status: 2 }] })) };
      },
    },
  };
  const customBridge = createHostMcpBridge({ window: customWin, hostConfig: customCfg });
  const st = await customBridge.getMcpServerStates();
  assert.equal(st.length, 1);
  assert.equal(seenRpcPaths[0], '/custom.mcp.v1.HostService/GetMcpServerStates');

  const ciYml = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.ok(ciYml.includes('develop') && ciYml.includes('fix/**') && ciYml.includes('workflow_dispatch'), 'D-0030: ci.yml must cover GitFlow branches and workflow_dispatch');
  assert.equal(fs.existsSync(path.join(rootDir, 'docs', 'templates', 'README_TEMPLATE.md')), true, 'D-0031: README_TEMPLATE.md must exist');
  assert.equal(fs.existsSync(path.join(rootDir, 'docs', 'templates', 'RELEASE_NOTES_TEMPLATE.md')), true, 'D-0031: RELEASE_NOTES_TEMPLATE.md must exist');
  assert.equal(fs.existsSync(path.join(rootDir, 'docs', 'TEST_CASES.md')), true, 'D-0031: docs/TEST_CASES.md must exist');
});

test('D-0033 & D-0034: isRemoteHost blocks substring domain spoofing and TrustedTypes never registers global passthrough policies', async () => {
  const { resolveHostAdapterConfig } = require('../src/host-adapter-config');

  const defaultCfg = resolveHostAdapterConfig();
  assert.equal(defaultCfg.isRemoteHost('antigravity.google.com'), true);
  assert.equal(defaultCfg.isRemoteHost('r.antigravity.google.com'), true);
  assert.equal(
    defaultCfg.isRemoteHost('antigravity.google.com.evil.example'),
    false,
    'D-0033: suffix-appended attacker domain must NOT match remoteHostDomains'
  );
  assert.equal(
    defaultCfg.isRemoteHost('evil-antigravity.google.com'),
    false,
    'D-0033: hyphen-prefixed attacker domain without dot boundary must NOT match remoteHostDomains'
  );

  const dottedCfg = resolveHostAdapterConfig({ remoteHostDomains: ['.remote.custom-mcp.example.', ''] });
  assert.equal(dottedCfg.isRemoteHost('remote.custom-mcp.example'), true);
  assert.equal(dottedCfg.isRemoteHost('sub.remote.custom-mcp.example'), true);
  assert.equal(dottedCfg.isRemoteHost('remote.custom-mcp.example.evil.test'), false);
  assert.equal(dottedCfg.isRemoteHost('fakeremote.custom-mcp.example'), false);

  const forbiddenGlobalPolicies = new Set(['default', 'dompurify', 'angular', 'angular#unsafe-bypass', 'nextjs#bundler']);
  const TRUSTED_SCRIPT_BRAND = Symbol('TrustedScript');
  const TRUSTED_SCRIPT_URL_BRAND = Symbol('TrustedScriptURL');

  // 1) W3C-accurate strict TrustedTypes environment where ALL policies are denied (policy === null):
  // BOTH script.text AND script.src throw TypeError on plain strings!
  const attemptedPolicies = [];
  const strictWin = {
    location: { hostname: 'antigravity.google.com' },
    URL: {
      createObjectURL: () => 'blob:https://antigravity.google.com/mcp-sb-fallback',
      revokeObjectURL() {},
    },
    trustedTypes: {
      createPolicy(name) {
        attemptedPolicies.push(name);
        throw new TypeError(`Disallowed policy ${name}`);
      },
    },
    fetch: async () => ({ ok: false }),
  };
  const makeStrictScriptDoc = (onAppend) => ({
    head: { appendChild: onAppend },
    createElement(tag) {
      let _src = '';
      let _text = '';
      const listeners = {};
      return {
        tagName: tag,
        get src() { return _src; },
        set src(v) {
          if (!v || v[TRUSTED_SCRIPT_URL_BRAND] !== true) {
            throw new TypeError("Failed to set 'src' on 'HTMLScriptElement': This document requires 'TrustedScriptURL' assignment.");
          }
          _src = v.url;
        },
        get text() { return _text; },
        set text(v) {
          if (!v || v[TRUSTED_SCRIPT_BRAND] !== true) {
            throw new TypeError("Failed to set 'text' on 'HTMLScriptElement': This document requires 'TrustedScript' assignment.");
          }
          _text = v.code;
        },
        addEventListener(ev, fn) { listeners[ev] = fn; },
        _fire(ev) { if (listeners[ev]) listeners[ev](); },
      };
    },
    querySelector: () => null,
  });
  const strictDoc = makeStrictScriptDoc(() => {
    throw new Error('Should not append unbranded script');
  });
  const strictBridge = {
    async fetchHostInstalledPluginInfo() {
      return {
        resolved: true,
        hasStatusbar: true,
        hasMcpManager: true,
        hasKoTranslator: false,
        statusbarBlock: 'function mountStatusBar(){}',
      };
    },
  };
  const blockedRes = await ensureRemoteCompanionScripts(strictWin, strictDoc, strictBridge);
  assert.deepEqual(
    blockedRes.loaded,
    [],
    'D-0034: when TrustedTypes rejects all policies and sinks reject plain strings, loader must NOT fake success'
  );
  assert.equal(strictWin.__agyLoadingStatusBarCompanion, false, 'D-0034: loading flag must reset on failure');
  for (const p of attemptedPolicies) {
    assert.equal(forbiddenGlobalPolicies.has(p), false, `D-0034: getOrCreateTrustedTypesPolicy must never attempt global policy '${p}'`);
    assert.ok(p.startsWith('agy-mcp-') || p.startsWith('agy-companion-'), `D-0034: policy '${p}' must be plugin-scoped`);
  }

  // 2) Async CSP block on inline & blob script must fall back to remote allowed URL with branded TrustedScriptURL!
  const appendedUrls = [];
  const cspWin = {
    location: { hostname: 'antigravity.google.com' },
    URL: {
      createObjectURL: () => 'blob:https://antigravity.google.com/csp-blocked',
      revokeObjectURL() {},
    },
    trustedTypes: {
      createPolicy(name, rules) {
        if (name === 'agy-mcp-manager') {
          return {
            createHTML: (h) => rules.createHTML(h),
            createScript: (c) => ({ [TRUSTED_SCRIPT_BRAND]: true, code: rules.createScript(c) }),
            createScriptURL: (u) => ({ [TRUSTED_SCRIPT_URL_BRAND]: true, url: rules.createScriptURL(u) }),
          };
        }
        throw new TypeError(`Disallowed policy ${name}`);
      },
    },
  };
  const cspDoc = makeStrictScriptDoc((el) => {
    if (el.src) {
      appendedUrls.push(el.src);
      if (el.src.startsWith('blob:')) {
        Promise.resolve().then(() => el._fire('error'));
      } else {
        cspWin.agyStatusBar = { version: 'v32' };
        Promise.resolve().then(() => el._fire('load'));
      }
    }
  });
  const cspRes = await ensureRemoteCompanionScripts(cspWin, cspDoc, strictBridge);
  assert.deepEqual(cspRes.loaded, ['antigravity-statusbar'], 'D-0034: remote URL script fallback must succeed when inline & blob fail under CSP');
  assert.ok(appendedUrls.some((u) => u.startsWith('https://raw.githubusercontent.com/')), 'D-0034: remote companion script URL must be loaded');
});

test('D-0022, D-0026, D-0032 reopen: destroy() restores all host prototypes & iframe.src, avoids hardcoded csrf_token & duplicate onReady, and fixes RFC6455 Ping/fragmentation & lock ownership', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const net = require('node:net');
  const crypto = require('node:crypto');
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const patcherPath = path.join(__dirname, '..', 'scripts', 'ensure_statusbar_patch.js');
  const { configureTargetViaCdp } = require(patcherPath);

  // 1) D-0022: Prototype restoration on destroy(), dynamic csrfToken (no hardcoded 'csrf_token'), and single onReady() call
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  assert.equal(
    indexSrc.includes("'csrf_token'") || indexSrc.includes('"csrf_token"'),
    false,
    'D-0022: src/index.js must NOT hardcode literal csrfToken: "csrf_token"'
  );

  function HostRemoteControl() {}
  const origMethods = {};
  for (const mName of [
    'handleIframeMessage',
    'handleUrlChanged',
    'proxyCommand',
    'streamProxyCommand',
    'handlePortRequest',
    'managePolling',
    'shouldPoll',
    'loadInstances',
    'isDisconnected',
    'onIframeLoad',
    'onWindowOnline',
    'onWindowOffline',
    'isOffline',
    'isDirectIngressMode',
    'isTabHidden',
    'getSelectedInstance',
    'instanceInfos',
    'remoteConversationsInfos',
  ]) {
    origMethods[mName] =
      mName === 'proxyCommand'
        ? async function (rpcPath) {
            if (String(rpcPath).endsWith('/GetCustomizationStates')) {
              return { payload: new TextEncoder().encode(JSON.stringify({ states: [] })) };
            }
            if (String(rpcPath).endsWith('/ReadFile')) {
              return {
                payload: new TextEncoder().encode(
                  JSON.stringify({ contents: Buffer.from('function mountMcpManager(){}\n', 'utf8').toString('base64') })
                ),
              };
            }
            return { payload: new TextEncoder().encode('{}') };
          }
        : function () {
            return mName;
          };
    HostRemoteControl.prototype[mName] = origMethods[mName];
  }
  const rcInst = new HostRemoteControl();
  rcInst.localUserInfo = { selectedGeminiDir: '/virtual/.gemini' };
  rcInst.iframeSrc = () => 'https://antigravity.static.usercontent.goog/web/2.32.1/?iframe=true';

  const appendedInChildHead = [];
  const childWin = {
    navigator: { userAgent: 'Windows' },
    history: { replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
  };
  const childDoc = {
    head: {
      appendChild(el) {
        appendedInChildHead.push(el);
      },
    },
    open() {},
    write() {},
    close() {},
    createElement(tag) {
      return { tagName: tag, style: {}, setAttribute() {}, getAttribute: () => null };
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  childWin.document = childDoc;

  const iframeListeners = {};
  let promotedToBlank = false;
  let currentIframeAttrSrc = 'https://antigravity.static.usercontent.goog/web/2.32.1/?iframe=true';
  const remoteIframe = {
    nodeType: 1,
    tagName: 'IFRAME',
    src: currentIframeAttrSrc,
    get contentWindow() {
      if (!promotedToBlank) {
        throw new Error('SecurityError: Blocked a frame with origin "https://antigravity.google.com" from accessing a cross-origin frame.');
      }
      return childWin;
    },
    get contentDocument() {
      if (!promotedToBlank) {
        throw new Error('SecurityError: Blocked a frame with origin "https://antigravity.google.com" from accessing a cross-origin frame.');
      }
      return childDoc;
    },
    getAttribute(k) { return k === 'src' ? currentIframeAttrSrc : null; },
    setAttribute(k, v) {
      if (k === 'src') {
        currentIframeAttrSrc = String(v);
        if (v === 'about:blank') promotedToBlank = true;
      }
    },
    removeAttribute() {},
    addEventListener(ev, fn) { iframeListeners[ev] = fn; },
    removeEventListener(ev) { delete iframeListeners[ev]; },
  };
  const gaRcEl = {
    nodeType: 1,
    tagName: 'GA-REMOTE-CONTROL',
    querySelector: (s) => (s === 'iframe' ? remoteIframe : null),
    querySelectorAll: (s) => (s === 'iframe' ? [remoteIframe] : []),
  };
  const hostBody = {
    nodeType: 1,
    tagName: 'BODY',
    children: [gaRcEl],
    appendChild() {},
    querySelector: (s) => (s === 'ga-remote-control' ? gaRcEl : (s === 'ga-remote-control iframe' ? remoteIframe : null)),
    querySelectorAll: (s) => (s === 'ga-remote-control iframe' ? [remoteIframe] : []),
  };
  const hostHead = {
    children: [],
    appendChild(el) { this.children.push(el); },
  };
  const hostDoc = {
    readyState: 'complete',
    head: hostHead,
    body: hostBody,
    createElement(tag) {
      return {
        nodeType: 1,
        tagName: tag.toUpperCase(),
        style: {},
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k] ?? null; },
        removeAttribute(k) { delete this.attrs[k]; },
        appendChild() {},
        remove() {},
        querySelector: () => null,
        querySelectorAll: () => [],
      };
    },
    getElementById: () => null,
    querySelector: (s) => hostBody.querySelector(s),
    querySelectorAll: (s) => hostBody.querySelectorAll(s),
    addEventListener() {},
    removeEventListener() {},
  };
  const hostWin = {
    location: { hostname: 'antigravity.google.com', origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/' },
    __APP_CONFIG__: { csrfToken: 'live-dynamic-csrf-token' },
    __agyRemoteControlInstance: rcInst,
    document: hostDoc,
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
  };
  hostWin.parent = hostWin;
  childWin.parent = hostWin;

  const ctrl = mountMcpManager({ window: hostWin, document: hostDoc });
  await new Promise((r) => setTimeout(r, 40));
  // Before mainScript.onload fires, childWin.__APP_CONFIG__.csrfToken must carry the dynamic token (not 'csrf_token')
  assert.equal(childWin.__APP_CONFIG__?.csrfToken, 'live-dynamic-csrf-token', 'D-0022: promoted iframe must inherit dynamic host csrfToken');
  // Simulate mainScript.onload firing
  const mainScriptEl = appendedInChildHead.find((el) => String(el.src || '').endsWith('/main.js'));
  if (mainScriptEl && typeof mainScriptEl.onload === 'function') {
    mainScriptEl.onload();
  }

  ctrl.destroy();

  for (const [mName, origFn] of Object.entries(origMethods)) {
    assert.equal(
      HostRemoteControl.prototype[mName],
      origFn,
      `D-0022: destroy() must restore HostRemoteControl.prototype.${mName} to its exact original function`
    );
  }
  assert.equal(
    Object.prototype.hasOwnProperty.call(HostRemoteControl.prototype, '__agyMcpRcHooked'),
    false,
    'D-0022: destroy() must clean up __agyMcpRcHooked marker from prototype'
  );
  const iframeOwnSrcDesc = Object.getOwnPropertyDescriptor(remoteIframe, 'src');
  assert.equal(
    Boolean(iframeOwnSrcDesc && typeof iframeOwnSrcDesc.get === 'function'),
    false,
    'D-0022: destroy() must remove spoofed Object.defineProperty(iframe, "src") getter'
  );

  // 2) D-0032: RFC 6455 payload Ping -> Pong echo & fragmented Continuation frames
  const savedWs = globalThis.WebSocket;
  delete globalThis.WebSocket;
  let receivedPongPayload = null;
  const rawWsServer = net.createServer((socket) => {
    let upgraded = false;
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      if (!upgraded) {
        const txt = chunk.toString('utf8');
        if (!txt.includes('\r\n\r\n')) return;
        upgraded = true;
        const keyMatch = txt.match(/Sec-WebSocket-Key:\s*([^\r\n]+)/i);
        const accept = crypto
          .createHash('sha1')
          .update(keyMatch[1].trim() + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
          .digest('base64');
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
        return;
      }
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 6) {
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 8) return;
          len = buf.readUInt16BE(2);
          off = 4;
        }
        if (buf.length < off + 4 + len) return;
        const mask = buf.subarray(off, off + 4);
        const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len));
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
        buf = buf.subarray(off + 4 + len);

        if (opcode === 0x0a) {
          receivedPongPayload = payload.toString('utf8');
          const fullJson = Buffer.from(
            JSON.stringify({ id: 1, result: { result: { value: 'INJECTED_OK' } } }),
            'utf8'
          );
          const p1 = fullJson.subarray(0, 14);
          const p2 = fullJson.subarray(14);
          socket.write(Buffer.concat([Buffer.from([0x01, p1.length]), p1]));
          socket.write(Buffer.concat([Buffer.from([0x80, p2.length]), p2]));
        } else if (opcode === 0x01) {
          const pingData = Buffer.from('mcp-ping-payload', 'utf8');
          socket.write(Buffer.concat([Buffer.from([0x89, pingData.length]), pingData]));
        }
      }
    });
  });
  await new Promise((r) => rawWsServer.listen(0, '127.0.0.1', r));
  try {
    const port = rawWsServer.address().port;
    const evalResult = await configureTargetViaCdp(`ws://127.0.0.1:${port}/devtools/page/1`, 'void 0;', 'hash1', 1500);
    assert.equal(receivedPongPayload, 'mcp-ping-payload', 'D-0032: RFC 6455 client must echo non-empty Ping payload in Pong');
    assert.equal(evalResult, 'INJECTED_OK', 'D-0032: RFC 6455 client must reassemble fragmented Continuation frames');
  } finally {
    if (savedWs !== undefined) globalThis.WebSocket = savedWs;
    rawWsServer.close();
  }

  // 3) D-0026: Foreign lock protection in releaseLock & locked syncAppStorageCode preservation
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-lock-test-'));
  try {
    const agyDir = path.join(tmpHome, '.gemini', 'antigravity');
    const appDataDir = path.join(tmpHome, 'AppData', 'Roaming');
    const agyAppData = path.join(appDataDir, 'Antigravity');
    fs.mkdirSync(agyDir, { recursive: true });
    fs.mkdirSync(agyAppData, { recursive: true });
    fs.writeFileSync(path.join(agyDir, 'statusbar_autoinject.js'), '// mcp v1.4.18 code\n', 'utf8');
    fs.writeFileSync(
      path.join(agyAppData, 'app_storage.json'),
      JSON.stringify({ hostTheme: 'dark-pro', 'agy-statusbar-code': 'old' }),
      'utf8'
    );
    const lockFile = path.join(agyDir, 'statusbar_patch.lock');
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, token: 'foreign-token', startedAt: new Date().toISOString() }), 'utf8');

    const out = execFileSync(
      process.execPath,
      [
        '-e',
        `const p = require(${JSON.stringify(patcherPath)});
         if (typeof p.releaseLock === 'function') p.releaseLock();
         const lockSurvived = require('fs').existsSync(${JSON.stringify(lockFile)});
         const synced1 = typeof p.syncAppStorageCode === 'function' ? p.syncAppStorageCode() : false;
         const synced2 = typeof p.syncAppStorageCode === 'function' ? p.syncAppStorageCode() : true;
         console.log(JSON.stringify({ lockSurvived, synced1, synced2 }));`,
      ],
      {
        env: {
          ...process.env,
          USERPROFILE: tmpHome,
          HOME: tmpHome,
          APPDATA: appDataDir,
          LOCALAPPDATA: path.join(tmpHome, 'AppData', 'Local'),
        },
        encoding: 'utf8',
      }
    );
    const parsedOut = JSON.parse(out.trim());
    assert.equal(parsedOut.lockSurvived, true, 'D-0026: releaseLock() must NOT delete another live process lock');
    assert.equal(parsedOut.synced1, true, 'D-0026: syncAppStorageCode() updates when code differs');
    assert.equal(parsedOut.synced2, false, 'D-0026: syncAppStorageCode() no-ops when code matches');
    const updatedStorage = JSON.parse(fs.readFileSync(path.join(agyAppData, 'app_storage.json'), 'utf8'));
    assert.equal(updatedStorage.hostTheme, 'dark-pro', 'D-0026: syncAppStorageCode() preserves concurrent host keys');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
