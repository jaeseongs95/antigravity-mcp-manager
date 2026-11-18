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
  assert.equal(readmeEn.includes('31/31'), false, 'D-0021: stale 31/31 test count must be updated in README.md');
  assert.equal(readmeKo.includes('31/31'), false, 'D-0021: stale 31/31 test count must be updated in README.ko.md');
  assert.ok(readmeEn.includes('36/36'), 'D-0021: README.md must state 36/36 tests');
  assert.ok(readmeKo.includes('36/36'), 'D-0021: README.ko.md must state 36/36 tests');
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

test('Round-2 audit reopen (D-0022, D-0026, D-0032, D-0034): cross-polluted TrustedTypes guard & zero cd.write HTML sink, multi-iframe rcProto refcount & __agyCapturedLsClient cleanup, RFC6455 close/interleaving, and lock release race', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const net = require('node:net');
  const crypto = require('node:crypto');
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const patcherPath = path.join(__dirname, '..', 'scripts', 'ensure_statusbar_patch.js');
  const { configureTargetViaCdp } = require(patcherPath);

  // 1) D-0034 & D-0022: Cross-polluted partial __agyTrustedTypesPolicy (missing createHTML), strict cd.write throw, 2 concurrent remote iframes sharing HostRemoteControl.prototype, and __agyCapturedLsClient cleanup
  function MultiRemoteControl() {}
  const origOnIframeLoad = function () { return 'orig-on-iframe-load'; };
  MultiRemoteControl.prototype.onIframeLoad = origOnIframeLoad;
  MultiRemoteControl.prototype.proxyCommand = async () => ({ payload: new TextEncoder().encode('{}') });
  MultiRemoteControl.prototype.iframeSrc = () => 'https://antigravity.static.usercontent.goog/web/2.32.1/?iframe=true';

  const rcInstShared = new MultiRemoteControl();

  function makePromotableIframe(idSuffix, hostWinRef) {
    let isBlank = false;
    let attrSrc = `https://antigravity.static.usercontent.goog/web/2.32.1/?iframe=true&slot=${idSuffix}`;
    const headChildren = [];
    const bodyChildren = [];
    const cWin = {
      navigator: { userAgent: 'Windows' },
      history: { replaceState() {} },
      addEventListener() {},
      removeEventListener() {},
      parent: hostWinRef,
    };
    const cDoc = {
      documentElement: { setAttribute() {} },
      head: {
        firstChild: null,
        removeChild() {},
        appendChild(el) { headChildren.push(el); return el; },
      },
      body: {
        firstChild: null,
        removeChild() {},
        appendChild(el) { bodyChildren.push(el); return el; },
      },
      open() {
        throw new TypeError('D-0034: cd.open() / cd.write() TrustedHTML sink must NOT be used for static shell');
      },
      write() {
        throw new TypeError("Failed to execute 'write' on 'Document': This document requires 'TrustedHTML' assignment.");
      },
      close() {},
      createElement(tag) {
        let _src = '';
        return {
          nodeType: 1,
          tagName: String(tag).toUpperCase(),
          style: {},
          attrs: {},
          setAttribute(k, v) { this.attrs[k] = String(v); },
          getAttribute(k) { return this.attrs[k] ?? null; },
          appendChild() {},
          get src() { return _src; },
          set src(v) {
            if (String(tag).toLowerCase() === 'script' && (typeof v !== 'object' || !v.__ttUrl)) {
              throw new TypeError("This document requires 'TrustedScriptURL' assignment.");
            }
            _src = typeof v === 'object' ? v.__ttUrl : String(v);
          },
        };
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    cWin.document = cDoc;

    const ifr = {
      nodeType: 1,
      tagName: 'IFRAME',
      src: attrSrc,
      _headChildren: headChildren,
      _bodyChildren: bodyChildren,
      _cWin: cWin,
      get contentWindow() {
        if (!isBlank) throw new Error('Cross-origin');
        return cWin;
      },
      get contentDocument() {
        if (!isBlank) throw new Error('Cross-origin');
        return cDoc;
      },
      getAttribute(k) { return k === 'src' ? attrSrc : null; },
      setAttribute(k, v) {
        if (k === 'src') {
          attrSrc = String(v);
          if (v === 'about:blank') isBlank = true;
        }
      },
      removeAttribute() {},
      addEventListener() {},
      removeEventListener() {},
    };
    return ifr;
  }

  const hostWin = {
    location: { hostname: 'antigravity.google.com', origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/' },
    __APP_CONFIG__: { csrfToken: 'tok-round2' },
    __agyRemoteControlInstance: rcInstShared,
    // Pre-polluted partial TrustedTypes policy (missing createHTML!) left by an external/older companion
    __agyTrustedTypesPolicy: {
      createScript: (s) => ({ __ttScript: String(s) }),
      createScriptURL: (u) => ({ __ttUrl: String(u) }),
    },
    trustedTypes: {
      createPolicy(name, rules) {
        return {
          name,
          createHTML: typeof rules.createHTML === 'function' ? (s) => ({ __ttHtml: String(rules.createHTML(s)) }) : undefined,
          createScript: typeof rules.createScript === 'function' ? (s) => ({ __ttScript: String(rules.createScript(s)) }) : undefined,
          createScriptURL: typeof rules.createScriptURL === 'function' ? (u) => ({ __ttUrl: String(rules.createScriptURL(u)) }) : undefined,
        };
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
  };
  hostWin.parent = hostWin;

  const ifr1 = makePromotableIframe('1', hostWin);
  const ifr2 = makePromotableIframe('2', hostWin);
  const gaRc = {
    nodeType: 1,
    tagName: 'GA-REMOTE-CONTROL',
    querySelector: (s) => (s === 'iframe' ? ifr1 : null),
    querySelectorAll: (s) => (s === 'iframe' ? [ifr1, ifr2] : []),
  };
  const hostDoc = {
    readyState: 'complete',
    head: { children: [], appendChild(el) { this.children.push(el); } },
    body: {
      nodeType: 1,
      tagName: 'BODY',
      children: [gaRc],
      appendChild() {},
      querySelector: (s) => (s === 'ga-remote-control' ? gaRc : (s === 'ga-remote-control iframe' ? ifr1 : null)),
      querySelectorAll: (s) => (s === 'ga-remote-control iframe' ? [ifr1, ifr2] : []),
    },
    createElement(tag) {
      return {
        nodeType: 1,
        tagName: String(tag).toUpperCase(),
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
    querySelector: (s) => (s === 'ga-remote-control' ? gaRc : (s === 'ga-remote-control iframe' ? ifr1 : null)),
    querySelectorAll: (s) => (s === 'ga-remote-control iframe' ? [ifr1, ifr2] : []),
    addEventListener() {},
    removeEventListener() {},
  };
  hostWin.document = hostDoc;

  let capturedRound2Rules = null;
  hostWin.trustedTypes = {
    createPolicy(name, rules) {
      capturedRound2Rules = rules;
      return {
        name,
        createHTML: typeof rules.createHTML === 'function' ? (s) => ({ __ttHtml: String(rules.createHTML(s)) }) : undefined,
        createScript: typeof rules.createScript === 'function' ? (s) => ({ __ttScript: String(rules.createScript(s)) }) : undefined,
        createScriptURL: typeof rules.createScriptURL === 'function' ? (u) => ({ __ttUrl: String(rules.createScriptURL(u)) }) : undefined,
      };
    },
  };

  const ctrl = mountMcpManager({ window: hostWin, document: hostDoc });
  await new Promise((r) => setTimeout(r, 45));

  assert.ok(capturedRound2Rules, 'D-0034: own strict TrustedTypes policy must be created instead of trusting pre-polluted global');
  assert.equal(
    typeof capturedRound2Rules.createHTML,
    'undefined',
    'D-0034: TrustedTypes policy must NOT expose a passthrough createHTML callback'
  );
  assert.ok(
    ifr1._bodyChildren.some((el) => el.id === 'root') && ifr2._bodyChildren.some((el) => el.id === 'root'),
    'D-0034: both promoted iframes must mount #root via DOM createElement without calling cd.write()'
  );

  // Trigger LS client decorator inside ifr1 to populate hostWin.__agyCapturedLsClient
  assert.equal(typeof ifr1._cWin.__JETSKI_LS_CLIENT_DECORATOR__, 'function');
  const fakeDecoratedClient = { marker: 'ls-client-1' };
  ifr1._cWin.__JETSKI_LS_CLIENT_DECORATOR__(fakeDecoratedClient);
  assert.equal(hostWin.__agyCapturedLsClient, fakeDecoratedClient);

  // D-0022 multi-iframe refcount: restoring ONLY ifr1 while ifr2 is still promoted must NOT clobber shared rcProto.onIframeLoad wrapper!
  assert.equal(typeof ifr1.__agyMcpRestorePromotion, 'function');
  ifr1.__agyMcpRestorePromotion();
  rcInstShared.__agySuppressAutoIframeLoad = true;
  const suppressedRes = await MultiRemoteControl.prototype.onIframeLoad.call(rcInstShared);
  assert.equal(
    suppressedRes,
    undefined,
    'D-0022: restoring 1 of 2 promoted iframes must keep shared MultiRemoteControl.prototype.onIframeLoad suppression wrapper alive for remaining active iframe'
  );

  // Full destroy() must restore MultiRemoteControl.prototype.onIframeLoad AND delete __agyCapturedLsClient
  ctrl.destroy();
  assert.equal(
    MultiRemoteControl.prototype.onIframeLoad,
    origOnIframeLoad,
    'D-0022: destroy() must restore MultiRemoteControl.prototype.onIframeLoad after all promoted iframes are cleaned up'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(hostWin, '__agyCapturedLsClient'),
    false,
    'D-0022: destroy() must clean up window.__agyCapturedLsClient'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(ifr1._cWin, '__agyCapturedLsClient'),
    false,
    'D-0022: destroy() must clean up childWindow.__agyCapturedLsClient'
  );

  // 2) D-0032: Close frame delivery, fast reject on server 0x08 Close, and RFC6455 §5.4 fragmentation interleaving error
  const savedGlobalWs = globalThis.WebSocket;
  delete globalThis.WebSocket;
  try {
    let sawClientClose = false;
    const srvClose = net.createServer((socket) => {
      let upgraded = false;
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        if (!upgraded) {
          const txt = chunk.toString('utf8');
          if (!txt.includes('\r\n\r\n')) return;
          upgraded = true;
          const key = txt.match(/Sec-WebSocket-Key:\s*([^\r\n]+)/i)[1].trim();
          const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
          socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
          return;
        }
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 6) {
          const op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f;
          let off = 2;
          if (len === 126) {
            if (buf.length < 8) return;
            len = buf.readUInt16BE(2);
            off = 4;
          }
          if (buf.length < off + 4 + len) return;
          buf = buf.subarray(off + 4 + len);
          if (op === 0x01) {
            const rep = Buffer.from(JSON.stringify({ id: 1, result: { result: { value: 'INJECTED_OK' } } }), 'utf8');
            socket.write(Buffer.concat([Buffer.from([0x81, rep.length]), rep]));
          } else if (op === 0x08) {
            sawClientClose = true;
            socket.end();
          }
        }
      });
    });
    await new Promise((r) => srvClose.listen(0, '127.0.0.1', r));
    try {
      const val = await configureTargetViaCdp(`ws://127.0.0.1:${srvClose.address().port}/devtools/page/1`, 'void 0;', 'h1', 1500);
      assert.equal(val, 'INJECTED_OK');
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(sawClientClose, true, 'D-0032: client.close() must deliver Close frame before socket teardown');
    } finally {
      srvClose.close();
    }

    const srvServerClose = net.createServer((socket) => {
      let upgraded = false;
      let sentClose = false;
      socket.on('data', (chunk) => {
        if (!upgraded) {
          const txt = chunk.toString('utf8');
          if (!txt.includes('\r\n\r\n')) return;
          upgraded = true;
          const key = txt.match(/Sec-WebSocket-Key:\s*([^\r\n]+)/i)[1].trim();
          const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
          socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
          return;
        }
        if (sentClose) return;
        sentClose = true;
        socket.end(Buffer.from([0x88, 0x00]));
      });
    });
    await new Promise((r) => srvServerClose.listen(0, '127.0.0.1', r));
    try {
      const t0 = Date.now();
      await assert.rejects(
        () => configureTargetViaCdp(`ws://127.0.0.1:${srvServerClose.address().port}/devtools/page/1`, 'void 0;', 'h1', 2000),
        /closed|WebSocket/i
      );
      assert.ok(Date.now() - t0 < 600, 'D-0032: server 0x08 Close must reject promptly without hanging until timeout');
    } finally {
      srvServerClose.close();
    }

    const srvInterleaved = net.createServer((socket) => {
      let upgraded = false;
      let sentBad = false;
      socket.on('data', (chunk) => {
        if (!upgraded) {
          const txt = chunk.toString('utf8');
          if (!txt.includes('\r\n\r\n')) return;
          upgraded = true;
          const key = txt.match(/Sec-WebSocket-Key:\s*([^\r\n]+)/i)[1].trim();
          const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
          socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
          return;
        }
        if (sentBad) return;
        sentBad = true;
        const f1 = Buffer.from('{"id":1,', 'utf8');
        const f2 = Buffer.from(JSON.stringify({ id: 1, result: { result: { value: 'INJECTED_OK' } } }), 'utf8');
        socket.write(Buffer.concat([Buffer.from([0x01, f1.length]), f1]));
        socket.write(Buffer.concat([Buffer.from([0x81, f2.length]), f2]));
      });
    });
    await new Promise((r) => srvInterleaved.listen(0, '127.0.0.1', r));
    try {
      await assert.rejects(
        () => configureTargetViaCdp(`ws://127.0.0.1:${srvInterleaved.address().port}/devtools/page/1`, 'void 0;', 'h1', 1500),
        /fragment|interleaved|protocol|WebSocket/i
      );
    } finally {
      srvInterleaved.close();
    }
  } finally {
    if (savedGlobalWs !== undefined) globalThis.WebSocket = savedGlobalWs;
  }

  // 3) D-0026: Stale-lock takeover race inside releaseLock()
  const raceHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-relrace-'));
  try {
    const agyDir = path.join(raceHome, '.gemini', 'antigravity');
    const lockFile = path.join(agyDir, 'statusbar_patch.lock');
    const raceOut = execFileSync(
      process.execPath,
      [
        '-e',
        `const fs = require('fs');
         const p = require(${JSON.stringify(patcherPath)});
         const acquired = p.acquireLock();
         const origRead = fs.readFileSync.bind(fs);
         let injected = false;
         fs.readFileSync = function(targetPath, ...rest) {
           const res = origRead(targetPath, ...rest);
           if (!injected && String(targetPath) === ${JSON.stringify(lockFile)}) {
             injected = true;
             fs.writeFileSync(${JSON.stringify(lockFile)}, JSON.stringify({ pid: 99999, token: 'mcp-process-b-token', startedAt: new Date().toISOString() }), 'utf8');
           }
           return res;
         };
         const released = p.releaseLock();
         fs.readFileSync = origRead;
         const existsAfter = fs.existsSync(${JSON.stringify(lockFile)});
         const survivingToken = existsAfter ? JSON.parse(origRead(${JSON.stringify(lockFile)}, 'utf8')).token : null;
         console.log(JSON.stringify({ acquired, released, existsAfter, survivingToken }));`,
      ],
      {
        env: { ...process.env, USERPROFILE: raceHome, HOME: raceHome },
        encoding: 'utf8',
      }
    );
    const raceRes = JSON.parse(raceOut.trim());
    assert.equal(raceRes.acquired, true);
    assert.equal(raceRes.released, false, 'D-0026: releaseLock must return false when lock token changed before rename');
    assert.equal(raceRes.existsAfter, true, 'D-0026: Process B new lock must survive');
    assert.equal(raceRes.survivingToken, 'mcp-process-b-token');
  } finally {
    fs.rmSync(raceHome, { recursive: true, force: true });
  }
});

test('MCP-TC-036 Round-3 audit reopen (D-0022, D-0034): strict allowlist TrustedTypes policy, https/origin validation on iframe promotion, continuous __agySuppressAutoIframeLoad until mainScript.onload, and policy global cleanup', async () => {
  // 1) D-0034: Strict TrustedTypes policy must omit createHTML and reject arbitrary scripts, non-HTTPS schemes, untrusted hosts, and forged blobs
  let capturedRules = null;
  const inlineStatusCode = 'window.agyStatusBar = { version: "v32" };';
  const strictHostWin = {
    location: { protocol: 'https:', hostname: 'antigravity.google.com', origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/' },
    trustedTypes: {
      createPolicy(name, rules) {
        capturedRules = rules;
        return {
          name,
          createScript: (c) => ({ __brand: 'script', val: rules.createScript(c) }),
          createScriptURL: (u) => ({ __brand: 'url', val: rules.createScriptURL(u) }),
        };
      },
    },
  };
  strictHostWin.parent = strictHostWin;
  const strictHostDoc = {
    head: {
      appendChild(el) {
        if (el.text && el.text.__brand === 'script') {
          strictHostWin.agyStatusBar = { version: 'v32' };
        }
        return el;
      },
    },
    createElement(tag) {
      return { tagName: tag.toUpperCase() };
    },
    querySelector: () => null,
  };
  await ensureRemoteCompanionScripts(strictHostWin, strictHostDoc, {
    async fetchHostInstalledPluginInfo() {
      return {
        resolved: true,
        hasStatusbar: true,
        hasMcpManager: true,
        hasKoTranslator: false,
        statusbarBlock: inlineStatusCode,
      };
    },
  });
  assert.ok(capturedRules, 'D-0034: companion loader must register plugin-scoped TrustedTypes policy');
  assert.equal(typeof capturedRules.createHTML, 'undefined', 'D-0034: createHTML must NOT exist on TrustedTypes policy');
  assert.throws(() => capturedRules.createScript('evil()'), TypeError, 'D-0034: unapproved inline code must throw TypeError');
  assert.throws(() => capturedRules.createScript(inlineStatusCode), TypeError, 'D-0034: replayed one-shot inline code must throw TypeError');
  assert.throws(() => capturedRules.createScriptURL('javascript:alert(1)'), TypeError, 'D-0034: javascript: URL must throw TypeError');
  assert.throws(() => capturedRules.createScriptURL('http://www.gstatic.com/antigravity/web/2.32.1/main.js'), TypeError, 'D-0034: plaintext http: URL must throw TypeError');
  assert.throws(() => capturedRules.createScriptURL('https://evil.example/pwn.js'), TypeError, 'D-0034: untrusted external domain must throw TypeError');
  assert.throws(() => capturedRules.createScriptURL('blob:https://antigravity.google.com/forged'), TypeError, 'D-0034: forged blob: URL must throw TypeError');
  assert.equal(
    capturedRules.createScriptURL('https://www.gstatic.com/antigravity/web/2.32.1/prism_bundle.js'),
    'https://www.gstatic.com/antigravity/web/2.32.1/prism_bundle.js',
    'D-0034: allowlisted official CDN bundle URL must be accepted'
  );
  assert.equal(
    capturedRules.createScriptURL('https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/main/dist/statusbar_autoinject.js?t=99'),
    'https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/main/dist/statusbar_autoinject.js?t=99',
    'D-0034: allowlisted official companion URL must be accepted'
  );

  // 2) D-0034 & D-0022: Reject http:// and untrusted https://evil.example in promoteCrossOriginRemoteIframe,
  // AND hold rcInst.__agySuppressAutoIframeLoad === true continuously until mainScript.onload fires!
  function GuardedRemoteControl() {}
  let nativeOnIframeLoadCount = 0;
  GuardedRemoteControl.prototype.onIframeLoad = function () {
    nativeOnIframeLoadCount += 1;
    return 'native-loaded';
  };
  GuardedRemoteControl.prototype.proxyCommand = async () => ({ payload: new TextEncoder().encode('{}') });

  function buildIframeFixture(initialSrc, hostWinRef) {
    let isBlank = false;
    let attrSrc = initialSrc;
    const headAppended = [];
    const loadHandlers = [];
    const cWin = {
      navigator: { userAgent: 'Windows' },
      history: { replaceState() {} },
      addEventListener() {},
      removeEventListener() {},
      parent: hostWinRef,
    };
    const cDoc = {
      documentElement: { setAttribute() {} },
      head: {
        firstChild: null,
        removeChild() {},
        appendChild(el) { headAppended.push(el); return el; },
      },
      body: {
        firstChild: null,
        removeChild() {},
        appendChild(el) { return el; },
      },
      createElement(tag) {
        return {
          nodeType: 1,
          tagName: String(tag).toUpperCase(),
          style: {},
          attrs: {},
          setAttribute(k, v) { this.attrs[k] = String(v); },
          getAttribute(k) { return this.attrs[k] ?? null; },
          appendChild() {},
        };
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    cWin.document = cDoc;
    return {
      nodeType: 1,
      tagName: 'IFRAME',
      src: attrSrc,
      _headAppended: headAppended,
      _fireBlankLoad() {
        for (const fn of [...loadHandlers]) fn();
      },
      get contentWindow() {
        if (!isBlank) throw new Error('Cross-origin');
        return cWin;
      },
      get contentDocument() {
        if (!isBlank) throw new Error('Cross-origin');
        return cDoc;
      },
      getAttribute(k) { return k === 'src' ? attrSrc : null; },
      setAttribute(k, v) {
        if (k === 'src') {
          attrSrc = String(v);
          if (v === 'about:blank') isBlank = true;
        }
      },
      removeAttribute() {},
      addEventListener(ev, fn) { if (ev === 'load') loadHandlers.push(fn); },
      removeEventListener() {},
    };
  }

  const rcInst = new GuardedRemoteControl();
  const win2 = {
    location: { protocol: 'https:', hostname: 'antigravity.google.com', origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/' },
    __APP_CONFIG__: { csrfToken: 'tok-r3' },
    __agyRemoteControlInstance: rcInst,
    __agyTrustedTypesPolicy: { legacy: true },
    __agyTrustedHtmlPolicy: { legacy: true },
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
  };
  win2.parent = win2;

  const httpIframe = buildIframeFixture('http://antigravity.static.usercontent.goog/web/2.32.1/?iframe=true', win2);
  const evilIframe = buildIframeFixture('https://evil.example/web/2.32.1/?iframe=true', win2);
  const validIframe = buildIframeFixture('https://antigravity.static.usercontent.goog/web/2.32.1/?iframe=true', win2);
  const allIframes = [httpIframe, evilIframe, validIframe];
  const gaRc2 = {
    nodeType: 1,
    tagName: 'GA-REMOTE-CONTROL',
    querySelector: (s) => (s === 'iframe' ? validIframe : null),
    querySelectorAll: (s) => (s === 'iframe' ? allIframes : []),
  };
  const doc2 = {
    readyState: 'complete',
    head: { children: [], appendChild(el) { this.children.push(el); } },
    body: {
      nodeType: 1,
      tagName: 'BODY',
      children: [gaRc2],
      appendChild() {},
      querySelector: (s) => (s === 'ga-remote-control' ? gaRc2 : (s === 'ga-remote-control iframe' ? validIframe : null)),
      querySelectorAll: (s) => (s === 'ga-remote-control iframe' ? allIframes : []),
    },
    createElement(tag) {
      return {
        nodeType: 1,
        tagName: String(tag).toUpperCase(),
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
    querySelector: (s) => (s === 'ga-remote-control' ? gaRc2 : (s === 'ga-remote-control iframe' ? validIframe : null)),
    querySelectorAll: (s) => (s === 'ga-remote-control iframe' ? allIframes : []),
    addEventListener() {},
    removeEventListener() {},
  };
  win2.document = doc2;

  const ctrl2 = mountMcpManager({ window: win2, document: doc2 });
  await new Promise((r) => setTimeout(r, 25));
  validIframe._fireBlankLoad();

  assert.equal(httpIframe.__agyMcpPromoted, undefined, 'D-0034: plaintext http:// iframe must NOT be promoted');
  assert.equal(evilIframe.__agyMcpPromoted, undefined, 'D-0034: untrusted https://evil.example iframe must NOT be promoted');
  assert.equal(evilIframe._headAppended.length, 0, 'D-0034: zero scripts may be loaded from untrusted external origin');

  const mainScriptEl = validIframe._headAppended.find((el) => String(el.src || '').endsWith('/main.js'));
  assert.ok(mainScriptEl, 'D-0022: valid official iframe must append main.js');
  // CRITICAL D-0022 assertion: BEFORE mainScript.onload fires, suppression MUST still be active!
  assert.equal(
    rcInst.__agySuppressAutoIframeLoad,
    true,
    'D-0022: __agySuppressAutoIframeLoad must remain true after about:blank & onBlankLoad while mainScript is still loading'
  );
  await GuardedRemoteControl.prototype.onIframeLoad.call(rcInst);
  assert.equal(
    nativeOnIframeLoadCount,
    0,
    'D-0022: delayed native onIframeLoad before mainScript.onload must be suppressed so MessagePort is not prematurely consumed'
  );

  // Now fire mainScript.onload -> suppression must release and native onIframeLoad must run once
  mainScriptEl.onload();
  assert.equal(rcInst.__agySuppressAutoIframeLoad, false, 'D-0022: __agySuppressAutoIframeLoad must clear once mainScript.onload fires');
  assert.equal(nativeOnIframeLoadCount, 1, 'D-0022: native onIframeLoad must run once after main.js boots');

  ctrl2.destroy();
  assert.equal(
    Object.prototype.hasOwnProperty.call(win2, '__agyTrustedTypesPolicy'),
    false,
    'D-0022: destroy() must delete residual window.__agyTrustedTypesPolicy when companion is inactive'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(win2, '__agyTrustedHtmlPolicy'),
    false,
    'D-0022: destroy() must delete residual window.__agyTrustedHtmlPolicy when companion is inactive'
  );
});

test('D-0035 (MCP-TC-037): Remote Control bookmarklet black-screen regressions (cross-plugin onIframeLoad clobber, premature companionCheckDone, ?hostTheme=dark&iframe=true, csrfToken fallback, and onerror rollback)', async () => {
  // 1) Cross-plugin RC.prototype.onIframeLoad clobbering reproduction:
  // statusbar hooks RC.prototype first (setting __agyOrig_onIframeLoad = nativeOnIframeLoad),
  // ko-thought-translator installs __agySuppressAutoIframeLoad wrapper on RC.prototype.onIframeLoad and sets __agySuppressAutoIframeLoad = true,
  // then mcp-manager resolveRemoteControlInstance hooks RC.prototype -> MUST NOT overwrite ko's suppression wrapper!
  let prematureNativeLoadCount = 0;
  function CrossPluginRemoteControl() {}
  CrossPluginRemoteControl.prototype.proxyCommand = async () => ({ payload: new Uint8Array(0) });
  CrossPluginRemoteControl.prototype.onIframeLoad = async function () {
    prematureNativeLoadCount += 1;
    return 'CONSUMED_MESSAGE_PORT_TOO_EARLY';
  };
  // Simulate statusbar having saved native onIframeLoad under __agyOrig_onIframeLoad
  CrossPluginRemoteControl.prototype.__agyOrig_onIframeLoad = CrossPluginRemoteControl.prototype.onIframeLoad;
  // Simulate ko-thought-translator wrapping onIframeLoad with suppression guard during about:blank transition
  const sbWrapped = CrossPluginRemoteControl.prototype.onIframeLoad;
  CrossPluginRemoteControl.prototype.onIframeLoad = function (...args) {
    if (this && this.__agySuppressAutoIframeLoad) return Promise.resolve();
    return sbWrapped.apply(this, args);
  };
  const sharedRcInst = new CrossPluginRemoteControl();
  sharedRcInst.__agySuppressAutoIframeLoad = true;

  const crossWin = {
    location: { hostname: 'antigravity.google.com', origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/r/547d3ff8-v2' },
    __agyRemoteControlInstance: sharedRcInst,
  };
  const crossBridge = createHostMcpBridge({ window: crossWin });
  crossBridge.resolveRemoteControlInstance(crossWin);
  await CrossPluginRemoteControl.prototype.onIframeLoad.call(sharedRcInst);
  assert.equal(
    prematureNativeLoadCount,
    0,
    'D-0035: mcp-manager hookRemoteControlPrototype must NOT clobber active __agySuppressAutoIframeLoad guard via shared __agyOrig_onIframeLoad'
  );
  crossBridge.dispose();

  // 2) Premature companionCheckDone=true when first fetchHostInstalledPluginInfo returns { resolved: false, hasKoTranslator: true }
  // OR when statusbar set window.__agyLoadingKoTranslatorCompanion = true -> must NOT trigger promoteCrossOriginRemoteIframe!
  let blankPromotedWhenKoPresent = false;
  const koInstalledIframe = {
    nodeType: 1,
    tagName: 'IFRAME',
    src: 'https://antigravity.static.usercontent.goog/web/2.32.1/?iframe=true',
    get contentWindow() { throw new Error('Cross-origin'); },
    get contentDocument() { throw new Error('Cross-origin'); },
    getAttribute: (k) => (k === 'src' ? 'https://antigravity.static.usercontent.goog/web/2.32.1/?iframe=true' : null),
    setAttribute(k, v) { if (k === 'src' && v === 'about:blank') blankPromotedWhenKoPresent = true; },
    addEventListener() {},
    removeEventListener() {},
  };
  const koGaRc = {
    nodeType: 1,
    tagName: 'GA-REMOTE-CONTROL',
    querySelector: (s) => (s === 'iframe' ? koInstalledIframe : null),
    querySelectorAll: (s) => (s === 'iframe' ? [koInstalledIframe] : []),
  };
  const koDoc = {
    readyState: 'complete',
    head: { appendChild() {} },
    body: {
      nodeType: 1,
      tagName: 'BODY',
      appendChild() {},
      querySelector: (s) => (s === 'ga-remote-control' ? koGaRc : (s === 'ga-remote-control iframe' ? koInstalledIframe : null)),
      querySelectorAll: (s) => (s === 'ga-remote-control iframe' ? [koInstalledIframe] : []),
    },
    createElement: (t) => ({ nodeType: 1, tagName: t.toUpperCase(), style: {}, setAttribute() {}, getAttribute: () => null, removeAttribute() {}, appendChild() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [] }),
    getElementById: () => null,
    querySelector: (s) => (s === 'ga-remote-control' ? koGaRc : (s === 'ga-remote-control iframe' ? koInstalledIframe : null)),
    querySelectorAll: (s) => (s === 'ga-remote-control iframe' ? [koInstalledIframe] : []),
    addEventListener() {},
    removeEventListener() {},
  };
  const koWin = {
    location: { hostname: 'antigravity.google.com', origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/r/547d3ff8-v2' },
    __agyRemoteControlInstance: {
      destroyed: false,
      onIframeLoad: async () => {},
      iframeSrc: () => 'https://antigravity.static.usercontent.goog/web/2.32.1/?iframe=true',
    },
    document: koDoc,
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => ({ unref() {} }),
    clearTimeout() {},
    MutationObserver: class { observe() {} disconnect() {} },
  };
  koWin.parent = koWin;
  const unresolvedKoBridge = {
    resolveRemoteControlInstance: () => koWin.__agyRemoteControlInstance,
    async fetchHostInstalledPluginInfo() {
      return {
        resolved: false,
        hasStatusbar: true,
        hasMcpManager: true,
        hasKoTranslator: true,
        statusbarBlock: '',
        mcpBlock: '',
        koBlock: '',
      };
    },
    async readMcpConfig() { return { ok: true, config: { mcpServers: {} } }; },
    async fetchServerStates() { return { ok: true, states: [] }; },
  };
  const koCtrl = mountMcpManager({ window: koWin, document: koDoc, bridge: unresolvedKoBridge });
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(
    blankPromotedWhenKoPresent,
    false,
    'D-0035: mcp-manager must NOT promote iframe to about:blank when fetchHostInstalledPluginInfo indicates hasKoTranslator or is still unresolved'
  );
  koCtrl.destroy();

  // 3) Standalone Angular Remote Host (window.__APP_CONFIG__ === undefined, ?hostTheme=dark&iframe=true, async onIframeLoad, and onerror rollback)
  const originalRemoteSrc = 'https://antigravity.static.usercontent.goog/web/2.32.1/?hostTheme=dark&iframe=true';
  let standaloneAttrSrc = originalRemoteSrc;
  let standaloneBlank = false;
  const standaloneHead = [];
  const standaloneListeners = {};
  const standaloneChildWin = {
    navigator: { userAgent: 'Windows' },
    history: { replaceState() {} },
    addEventListener(type, fn) {
      standaloneListeners[type] = standaloneListeners[type] || [];
      standaloneListeners[type].push(fn);
    },
    removeEventListener() {},
  };
  const standaloneChildDoc = {
    documentElement: { style: {}, setAttribute() {} },
    head: { firstChild: null, removeChild() {}, appendChild(el) { standaloneHead.push(el); return el; } },
    body: { firstChild: null, removeChild() {}, appendChild(el) { return el; } },
    createElement: (t) => ({ nodeType: 1, tagName: t.toUpperCase(), style: {}, setAttribute() {}, getAttribute: () => null, appendChild() {} }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  standaloneChildWin.document = standaloneChildDoc;

  const standaloneIframe = {
    nodeType: 1,
    tagName: 'IFRAME',
    src: originalRemoteSrc,
    get contentWindow() {
      if (!standaloneBlank) throw new Error('Cross-origin');
      return standaloneChildWin;
    },
    get contentDocument() {
      if (!standaloneBlank) throw new Error('Cross-origin');
      return standaloneChildDoc;
    },
    getAttribute: (k) => (k === 'src' ? standaloneAttrSrc : null),
    setAttribute(k, v) {
      if (k === 'src') {
        standaloneAttrSrc = String(v);
        standaloneBlank = v === 'about:blank';
      }
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const standaloneGaRc = {
    nodeType: 1,
    tagName: 'GA-REMOTE-CONTROL',
    querySelector: (s) => (s === 'iframe' ? standaloneIframe : null),
    querySelectorAll: (s) => (s === 'iframe' ? [standaloneIframe] : []),
  };
  const standaloneDoc = {
    readyState: 'complete',
    head: { appendChild() {} },
    body: {
      nodeType: 1,
      tagName: 'BODY',
      appendChild() {},
      querySelector: (s) => (s === 'ga-remote-control' ? standaloneGaRc : (s === 'ga-remote-control iframe' ? standaloneIframe : null)),
      querySelectorAll: (s) => (s === 'ga-remote-control iframe' ? [standaloneIframe] : []),
    },
    createElement: (t) => ({ nodeType: 1, tagName: t.toUpperCase(), style: {}, setAttribute() {}, getAttribute: () => null, removeAttribute() {}, appendChild() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [] }),
    getElementById: () => null,
    querySelector: (s) => (s === 'ga-remote-control' ? standaloneGaRc : (s === 'ga-remote-control iframe' ? standaloneIframe : null)),
    querySelectorAll: (s) => (s === 'ga-remote-control iframe' ? [standaloneIframe] : []),
    addEventListener() {},
    removeEventListener() {},
  };
  // Notice: Angular remote host has NO window.__APP_CONFIG__!
  const standaloneWin = {
    location: { hostname: 'antigravity.google.com', origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/r/547d3ff8-v2' },
    __agyRemoteControlInstance: {
      destroyed: false,
      onIframeLoad: async () => {},
      iframeSrc: () => originalRemoteSrc,
    },
    document: standaloneDoc,
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
  };
  standaloneWin.parent = standaloneWin;
  standaloneChildWin.parent = standaloneWin;

  const standaloneBridge = {
    resolveRemoteControlInstance: () => standaloneWin.__agyRemoteControlInstance,
    async fetchHostInstalledPluginInfo() {
      return { resolved: true, hasStatusbar: false, hasMcpManager: true, hasKoTranslator: false };
    },
    async readMcpConfig() { return { ok: true, config: { mcpServers: {} } }; },
    async fetchServerStates() { return { ok: true, states: [] }; },
  };
  const standaloneCtrl = mountMcpManager({ window: standaloneWin, document: standaloneDoc, bridge: standaloneBridge });
  await new Promise((r) => setTimeout(r, 45));

  assert.equal(standaloneBlank, true, 'D-0035: ?hostTheme=dark&iframe=true query ordering in v2.32.1 must be accepted and promoted');
  assert.ok(
    typeof standaloneChildWin.__APP_CONFIG__?.csrfToken === 'string' && standaloneChildWin.__APP_CONFIG__.csrfToken.length > 0,
    'D-0035: promoted iframe on Angular remote host (without window.__APP_CONFIG__) must still receive a non-empty csrfToken'
  );

  // Simulate mainScript.onerror -> must roll back iframe to originalRemoteSrc instead of leaving black about:blank!
  const standaloneMain = standaloneHead.find((el) => String(el.src || '').endsWith('/main.js'));
  assert.ok(standaloneMain, 'D-0035: main.js script must be appended');
  standaloneMain.onerror();
  assert.equal(
    standaloneIframe.src,
    originalRemoteSrc,
    'D-0035: mainScript.onerror must roll back iframe.src to original remote URL so user is never stranded on a black about:blank screen'
  );
  standaloneCtrl.destroy();
});

test('MCP-TC-038 (D-0013, D-0022, D-0034, D-0035): Real Headless Chromium E2E test on https://antigravity.google.com/r/...-v2 (live CSP promotion, HTTP 500 onerror rollback, and strict trusted-types preflight preservation)', async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const https = require('node:https');
  const crypto = require('node:crypto');
  const { spawn } = require('node:child_process');
  const { createRfc6455WebSocketClient } = require('../scripts/ensure_statusbar_patch');

  const chromeCandidates = [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const chromeBin = chromeCandidates.find((p) => fs.existsSync(p));
  if (!chromeBin) {
    t.skip('No local Chromium/Edge binary found for real-browser E2E test');
    return;
  }

  const derLen = (n) => {
    if (n < 0x80) return Buffer.from([n]);
    const hex = n.toString(16).padStart(n > 0xff ? 4 : 2, '0');
    const bytes = Buffer.from(hex, 'hex');
    return Buffer.concat([Buffer.from([0x80 | bytes.length]), bytes]);
  };
  const derTlv = (tag, body) => Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
  const generateSelfSignedTls = () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const algId = derTlv(0x30, Buffer.from('06082a8648ce3d040302', 'hex'));
    const ver = Buffer.from('a003020102', 'hex');
    const serialBytes = crypto.randomBytes(8);
    serialBytes[0] = (serialBytes[0] & 0x7f) | 0x01;
    const serial = derTlv(0x02, serialBytes);
    const cnAttr = derTlv(0x30, Buffer.concat([Buffer.from('0603550403', 'hex'), derTlv(0x0c, Buffer.from('localhost', 'utf8'))]));
    const name = derTlv(0x30, derTlv(0x31, cnAttr));
    const validity = derTlv(
      0x30,
      Buffer.concat([
        derTlv(0x17, Buffer.from('250101000000Z', 'ascii')),
        derTlv(0x18, Buffer.from('20500101000000Z', 'ascii')),
      ])
    );
    const spki = publicKey.export({ type: 'spki', format: 'der' });
    const tbs = derTlv(0x30, Buffer.concat([ver, serial, algId, name, validity, name, spki]));
    const sig = crypto.sign('sha256', tbs, privateKey);
    const certDer = derTlv(0x30, Buffer.concat([tbs, algId, derTlv(0x03, Buffer.concat([Buffer.from([0x00]), sig]))]));
    const cert = `-----BEGIN CERTIFICATE-----\n${certDer.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
    const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
    return { key, cert };
  };

  const tlsOpts = generateSelfSignedTls();
  const builtBundle = fs.readFileSync(path.join(__dirname, '..', 'dist', 'mcp_manager_autoinject.js'), 'utf8');
  const readmeMd = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const bmMatch = readmeMd.match(/javascript:\(\(\)=>\{[^\r\n]+\}\)\(\);/);
  assert.ok(bmMatch, 'MCP-TC-038: README.md must contain valid single-line bookmarklet');
  const bookmarkletExpr = bmMatch[0].slice('javascript:'.length);

  const fetchUpstreamBuffer = async (url) => {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Upstream asset fetch failed (${resp.status}) for ${url}`);
    }
    return {
      buf: Buffer.from(await resp.arrayBuffer()),
      contentType: resp.headers.get('content-type') || 'application/octet-stream',
    };
  };

  let realIframeHtml;
  let realMainJs;
  let realPrismJs;
  let realJetboxCss;
  let realTailwindCss;
  try {
    [realIframeHtml, realMainJs, realPrismJs, realJetboxCss, realTailwindCss] = await Promise.all([
      fetchUpstreamBuffer('https://antigravity.static.usercontent.goog/web/2.33.0/?hostTheme=dark&iframe=true'),
      fetchUpstreamBuffer('https://www.gstatic.com/antigravity/web/2.33.0/main.js'),
      fetchUpstreamBuffer('https://www.gstatic.com/antigravity/web/2.33.0/prism_bundle.js'),
      fetchUpstreamBuffer('https://www.gstatic.com/antigravity/web/2.33.0/jetbox.css'),
      fetchUpstreamBuffer('https://www.gstatic.com/antigravity/web/2.33.0/compiled_tailwind.css'),
    ]);
  } catch (netErr) {
    throw new Error(`MCP-TC-038 requires real upstream Antigravity 2.33.0 assets: ${netErr?.message || netErr}`);
  }
  assert.ok(realMainJs.buf.length > 10_000_000, 'MCP-TC-038: main.js must be the real >10MB Antigravity 2.33.0 bundle');
  assert.ok(realPrismJs.buf.length > 100_000, 'MCP-TC-038: prism_bundle.js must be the real >100KB Antigravity 2.33.0 bundle');

  const hostNonce = 'b1AUrWAFdP4IYpRGDrEzag';
  const iframeNonce = 'jJgu3ijJjeWjBiu4jYPUZg';
  const normalizedRealIframeHtml = realIframeHtml.buf
    .toString('utf8')
    .replace(/nonce="[^"]*"/g, `nonce="${iframeNonce}"`);
  const upstreamAssetCache = new Map();
  const cdnReqs = [];
  let forceCdnMain500 = false;
  let crossOriginBootNotifications = 0;

  const hostServer = https.createServer(tlsOpts, (req, res) => {
    const u = new URL(req.url, 'https://antigravity.google.com');
    if (u.pathname === '/_/GoogleAntigravity/cspreport') {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Verbatim observed Content-Security-Policy headers from live https://antigravity.google.com/r/...-v2
    const cspHeaders = [
      `script-src 'report-sample' 'nonce-${hostNonce}' 'unsafe-inline';object-src 'none';base-uri 'self';report-uri /_/GoogleAntigravity/cspreport;worker-src 'self'`,
      "require-trusted-types-for 'script';report-uri /_/GoogleAntigravity/cspreport",
    ];
    if (u.pathname.includes('strict-tt-block-all')) {
      cspHeaders.push('trusted-types ogb-qtm#html');
    } else if (u.pathname.includes('strict-tt-preflight')) {
      cspHeaders.push('trusted-types ogb-qtm#html agy-mcp-bm');
    }
    res.setHeader('Content-Security-Policy', cspHeaders);
    res.end(`<!doctype html><html><head>
      <script nonce="${hostNonce}">
        window.__e2eCspViolations = [];
        window.__e2eErrors = [];
        window.__e2ePortSessions = [];
        window.__e2ePortUnaryPaths = [];
        window.__e2eAboutBlankLoads = 0;
        document.addEventListener('securitypolicyviolation', (e) => {
          window.__e2eCspViolations.push(e.violatedDirective + ':' + e.blockedURI);
        });
        window.addEventListener('error', (e) => { window.__e2eErrors.push(String(e.message || e)); });
        window.addEventListener('unhandledrejection', (e) => { window.__e2eErrors.push(String(e.reason || e)); });
      </script>
    </head><body style="background:#0d0d0d;color:#fff;margin:0">
      <ga-remote-control>
        <div class="app-container">
          <iframe src="https://antigravity.static.usercontent.goog/web/2.33.0/?hostTheme=dark&iframe=true" style="width:100%;height:720px;border:0"></iframe>
        </div>
      </ga-remote-control>
      <script nonce="${hostNonce}">
        class RemoteControlComponent {
          constructor(iframeEl) {
            this.destroyed = false;
            this.hubFrame = { nativeElement: iframeEl };
            this.proxyPortSessionCounter = 0;
            this.proxyPort = null;
            this.proxyPortSessionId = undefined;
            this.iframeLoading = { set() {} };
            this.iframeUiReady = { set() {} };
            this.localUserInfo = { selectedGeminiDir: '/home/user/.gemini' };
          }
          selectedInstanceUuid() { return 'inst-mcp-0001'; }
          iframeSrc() { return 'https://antigravity.static.usercontent.goog/web/2.33.0/?hostTheme=dark&iframe=true'; }
          async initXChannelServer() { await Promise.resolve(); }
          async handlePortRequest(msg) {
            if (!msg || typeof msg !== 'object' || msg.sessionId !== this.proxyPortSessionId) return;
            if (msg.kind === 'stream') {
              (window.__e2ePortStreamPaths = window.__e2ePortStreamPaths || []).push(String(msg.path || ''));
              if (String(msg.path || '').endsWith('/JetboxSubscribeToState')) {
                // Connect-RPC 5-byte frame: JetboxSubscribeToStateResponse { app_state: { agent_onboarding_completed: 2 }, user_config: {} }
                this.proxyPort?.postMessage({
                  sessionId: msg.sessionId,
                  id: msg.id,
                  kind: 'data',
                  chunk: new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x06, 0x12, 0x02, 0x28, 0x02, 0x1a, 0x00]),
                  headers: { 'content-type': 'application/connect+proto' }
                });
              }
              return;
            }
            if (msg.kind === 'unary') {
              window.__e2ePortUnaryPaths.push(String(msg.path || ''));
              try {
                const res = await this.proxyCommand(msg.path, 'POST', msg.headers || {}, msg.body);
                this.proxyPort?.postMessage({
                  sessionId: msg.sessionId,
                  id: msg.id,
                  kind: 'data',
                  chunk: res.payload,
                  headers: { 'content-type': 'application/json' }
                });
              } catch (err) {
                this.proxyPort?.postMessage({
                  sessionId: msg.sessionId,
                  id: msg.id,
                  kind: 'error',
                  code: 13,
                  message: String(err?.message || err)
                });
              }
            }
          }
          async onIframeLoad() {
            const c = this.hubFrame.nativeElement;
            await this.initXChannelServer();
            const d = window.location.origin;
            const f = (new URL(c.src)).origin;
            if (this.proxyPort) { this.proxyPort.close(); }
            const m = new MessageChannel();
            this.proxyPort = m.port1;
            this.proxyPortSessionId = 'rc-' + (++this.proxyPortSessionCounter);
            window.__e2ePortSessions.push(this.proxyPortSessionId);
            this.proxyPort.onmessage = (ev) => { this.handlePortRequest(ev.data); };
            c.contentWindow.postMessage({
              type: 'INITIAL_CONFIG',
              parentOrigin: d,
              instanceId: this.selectedInstanceUuid(),
              initialPath: '/',
              remoteControlVersion: 'v2',
              messagePortEnabled: true,
              portSessionId: this.proxyPortSessionId
            }, f, [m.port2]);
          }
          async proxyCommand(rpcPath) {
            const enc = (obj) => ({ payload: new TextEncoder().encode(JSON.stringify(obj)) });
            if (rpcPath.endsWith('/HasAuthToken')) return enc({ hasToken: true });
            if (rpcPath.endsWith('/GetAuthStatus')) return enc({ authResult: { hasValidAuth: true } });
            if (rpcPath.endsWith('/GetServerConfiguration')) {
              return enc({ config: { appDataDir: 'antigravity', sandboxAvailable: false, sidecars: { enabled: false, allowAll: false } } });
            }
            if (rpcPath.endsWith('/GetMendelFlags')) {
              return enc({ experimentConfig: { experiments: [] } });
            }
            if (rpcPath.endsWith('/GetCustomizationStates')) {
              return enc({ states: [{ path: '/home/user/.gemini/config/plugins/antigravity-mcp-manager/SKILL.md' }] });
            }
            if (rpcPath.endsWith('/GetAllPlugins')) return enc({ plugins: [] });
            if (rpcPath.endsWith('/GetAllSkills')) return enc({ skills: [] });
            if (rpcPath.endsWith('/GetMcpServerStates')) {
              return enc({ states: [{ serverName: 'demo-srv', status: 'MCP_SERVER_STATUS_READY', tools: [] }] });
            }
            if (rpcPath.endsWith('/GetLocalUserInfo')) return enc({ homeDirUri: 'file:///home/user', username: 'e2e' });
            if (rpcPath.endsWith('/GetUserStatus')) {
              return enc({ userStatus: { name: 'E2E User', email: 'e2e@example.com' } });
            }
            if (rpcPath.endsWith('/GetAllCascadeTrajectories')) {
              return enc({ trajectorySummaries: {} });
            }
            if (rpcPath.endsWith('/ReadFile')) {
              if (String(arguments[3] ? new TextDecoder().decode(arguments[3]) : '').includes('mcp_config.json')) {
                return enc({ content: btoa(JSON.stringify({ mcpServers: { 'demo-srv': { command: 'npx', args: ['-y', 'demo'] } } })) });
              }
              return enc({ content: btoa('function mountMcpManager(){}\\n') });
            }
            return enc({});
          }
        }
        const ifr = document.querySelector('ga-remote-control iframe');
        const rcInst = new RemoteControlComponent(ifr);
        window.__agyRemoteControlInstance = rcInst;
        ifr.addEventListener('load', () => {
          try {
            if (ifr.contentWindow && ifr.contentWindow.location.href === 'about:blank') {
              window.__e2eAboutBlankLoads += 1;
            }
          } catch {}
          rcInst.onIframeLoad();
        });
      </script>
    </body></html>`);
  });

  const cdnServer = https.createServer(tlsOpts, async (req, res) => {
    const u = new URL(req.url, 'https://localhost');
    const hostHdr = String(req.headers.host || '');
    cdnReqs.push(`${hostHdr}${u.pathname}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'no-store');

    if (u.pathname.endsWith('/mcp_manager_autoinject.js')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(builtBundle);
      return;
    }
    if (u.pathname.endsWith('/__e2e_dyn_chunk.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.end('window.__e2eChunkLoaded = true;');
      return;
    }
    if (u.pathname.endsWith('/__e2e_setattr_chunk.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.end('window.__e2eSetAttrChunkLoaded = true;');
      return;
    }
    if (u.pathname.endsWith('/__e2e_worker.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.end('self.postMessage("CDN_WORKER_READY");');
      return;
    }
    if (u.pathname.endsWith('/__e2e_pixel.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#0f0"/></svg>');
      return;
    }
    if (u.pathname.endsWith('/main.js')) {
      if (forceCdnMain500 && hostHdr.includes('www.gstatic.com')) {
        res.statusCode = 500;
        res.end('Simulated CDN error');
        return;
      }
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.end(realMainJs.buf);
      return;
    }
    if (u.pathname.endsWith('/prism_bundle.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.end(realPrismJs.buf);
      return;
    }
    if (u.pathname.endsWith('/jetbox.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.end(realJetboxCss.buf);
      return;
    }
    if (u.pathname.endsWith('/compiled_tailwind.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.end(realTailwindCss.buf);
      return;
    }
    if (hostHdr.includes('www.gstatic.com') || /\.(?:js|mjs|css|wasm|svg|png|woff2?|ttf|json)$/i.test(u.pathname)) {
      const cleanPath = u.pathname.startsWith('/antigravity/') ? u.pathname : `/antigravity${u.pathname}`;
      const upstreamUrl = `https://www.gstatic.com${cleanPath}${u.search}`;
      try {
        if (!upstreamAssetCache.has(upstreamUrl)) {
          upstreamAssetCache.set(upstreamUrl, await fetchUpstreamBuffer(upstreamUrl));
        }
        const cached = upstreamAssetCache.get(upstreamUrl);
        res.setHeader('Content-Type', cached.contentType);
        res.end(cached.buf);
        return;
      } catch {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
    }

    crossOriginBootNotifications += 1;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Verbatim observed Content-Security-Policy headers from live https://antigravity.static.usercontent.goog/web/2.33.0/
    res.setHeader('Content-Security-Policy', [
      `script-src 'nonce-${iframeNonce}' 'report-sample' 'strict-dynamic' 'unsafe-eval' 'unsafe-inline' http: https:; object-src 'none'; report-uri https://csp.withgoogle.com/csp/jetski-devs; base-uri 'none'`,
      "require-trusted-types-for 'script'; report-uri https://csp.withgoogle.com/csp/jetski-devs",
    ]);
    res.end(normalizedRealIframeHtml);
  });

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-chrome-'));
  let chromeProc = null;
  let cdpWs = null;
  try {
    hostServer.keepAliveTimeout = 60000;
    hostServer.headersTimeout = 65000;
    cdnServer.keepAliveTimeout = 60000;
    cdnServer.headersTimeout = 65000;
    await new Promise((r) => hostServer.listen(0, '127.0.0.1', r));
    await new Promise((r) => cdnServer.listen(0, '127.0.0.1', r));
    hostServer.unref();
    cdnServer.unref();
    const hostPort = hostServer.address().port;
    const cdnPort = cdnServer.address().port;

    const wsUrlPromise = new Promise((resolve, reject) => {
      const chromeEnv = { ...process.env };
      delete chromeEnv.DBUS_SESSION_BUS_ADDRESS;
      chromeProc = spawn(
        chromeBin,
        [
          '--headless=new',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--password-store=basic',
          '--use-mock-keychain',
          '--no-first-run',
          '--no-default-browser-check',
          '--ignore-certificate-errors',
          '--remote-debugging-port=0',
          `--user-data-dir=${profileDir}`,
          `--host-resolver-rules=MAP antigravity.google.com 127.0.0.1:${hostPort},MAP antigravity.static.usercontent.goog 127.0.0.1:${cdnPort},MAP www.gstatic.com 127.0.0.1:${cdnPort},MAP raw.githubusercontent.com 127.0.0.1:${cdnPort}`,
          'about:blank',
        ],
        { stdio: ['ignore', 'ignore', 'pipe'], env: chromeEnv }
      );
      let stderrBuf = '';
      const timer = setTimeout(() => reject(new Error(`Chrome startup timeout: ${stderrBuf}`)), 25000);
      chromeProc.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString('utf8');
        const m = stderrBuf.match(/DevTools listening on (ws:\/\/[^\r\n]+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1].trim());
        }
      });
      chromeProc.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Chrome exited early (${code}): ${stderrBuf}`));
      });
    });

    const browserWsUrl = await wsUrlPromise;
    cdpWs = createRfc6455WebSocketClient(browserWsUrl);
    let msgId = 0;
    const pending = new Map();
    const netEvents = [];
    const reqUrls = new Map();
    cdpWs.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (msg.method === 'Network.requestWillBeSent') {
        reqUrls.set(msg.params?.requestId, msg.params?.request?.url || '');
      } else if (msg.method === 'Network.loadingFailed') {
        const u = reqUrls.get(msg.params?.requestId) || '';
        if (u.includes('__e2e_') || u.includes('gstatic.com')) {
          netEvents.push(`FAIL:${u}:${msg.params?.errorText}:${msg.params?.blockedReason || ''}`);
        }
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    await new Promise((res, rej) => {
      cdpWs.onopen = res;
      cdpWs.onerror = rej;
    });

    const sendCdp = (method, params = {}, sessionId = undefined) =>
      new Promise((resolve, reject) => {
        const id = ++msgId;
        pending.set(id, { resolve, reject });
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        cdpWs.send(JSON.stringify(payload));
      });

    const { targetInfos } = await sendCdp('Target.getTargets');
    const pageTarget = targetInfos.find((ti) => ti.type === 'page');
    assert.ok(pageTarget, 'MCP-TC-038: page target must exist');
    const { sessionId } = await sendCdp('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
    await sendCdp('Page.enable', {}, sessionId);
    await sendCdp('Runtime.enable', {}, sessionId);
    await sendCdp('Network.enable', {}, sessionId);

    // === Scenario A: Real 12.35MB Antigravity 2.33.0 workbench + verbatim live CSP promotion via README.md bookmarklet ===
    forceCdnMain500 = false;
    await sendCdp('Page.navigate', { url: 'https://antigravity.google.com/r/547d3ff8-7d19-415f-a68a-9bbf28c06f5f-v2' }, sessionId);
    for (let i = 0; i < 80; i++) {
      const r = await sendCdp('Runtime.evaluate', { expression: 'window.__e2ePortUnaryPaths?.length || 0', returnByValue: true }, sessionId);
      if (r?.result?.value >= 1) break;
      await new Promise((res) => setTimeout(res, 60));
    }
    const unaryBeforePromo = (
      await sendCdp('Runtime.evaluate', { expression: 'window.__e2ePortUnaryPaths?.length || 0', returnByValue: true }, sessionId)
    )?.result?.value || 0;
    assert.ok(unaryBeforePromo >= 1, 'MCP-TC-038(A): real cross-origin 2.33.0 workbench must boot and send RPCs before bookmarklet click');

    const bmEvalA = await sendCdp('Runtime.evaluate', { expression: bookmarkletExpr, returnByValue: true }, sessionId);
    assert.equal(bmEvalA.exceptionDetails, undefined, 'MCP-TC-038(A): bookmarklet must not throw');

    let snapA = null;
    for (let i = 0; i < 200; i++) {
      const r = await sendCdp(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const ifr = document.querySelector('ga-remote-control iframe');
            let rootChildCount = 0;
            let rootTextLen = 0;
            let hasChildMgr = false;
            let colorScheme = '';
            let csrf = '';
            let initConfigRecv = false;
            let cwHref = '';
            try {
              const cd = ifr?.contentDocument;
              const cw = ifr?.contentWindow;
              if (cw && cd && !cw.__e2eListenersAttached) {
                cw.__e2eListenersAttached = true;
                cd.addEventListener('securitypolicyviolation', (ev) => {
                  window.__e2eCspViolations.push('child:' + ev.violatedDirective + ':' + ev.blockedURI);
                });
                cw.addEventListener('error', (ev) => {
                  window.__e2eErrors.push('child:' + String(ev.message || ev));
                });
                cw.addEventListener('unhandledrejection', (ev) => {
                  window.__e2eErrors.push('child-rej:' + String(ev.reason || ev));
                });
              }
              const rootEl = cd?.getElementById('root');
              rootChildCount = rootEl ? rootEl.childElementCount : 0;
              rootTextLen = rootEl ? (rootEl.innerHTML || '').length : 0;
              hasChildMgr = Boolean(cw?.agyMcpManager);
              colorScheme = cd?.documentElement?.style?.colorScheme || '';
              csrf = cw?.__APP_CONFIG__?.csrfToken || '';
              initConfigRecv = Boolean(cw?.__initialConfigReceived);
              cwHref = cw?.location?.href || '';
            } catch {}
            return {
              hasHostMgr: Boolean(window.agyMcpManager),
              hasChildMgr,
              hasRemoteLauncher: Boolean(document.getElementById('agy-mcp-remote-launcher')),
              rootChildCount,
              rootTextLen,
              colorScheme,
              csrfLen: csrf.length,
              initConfigRecv,
              cwHref,
              promotionState: ifr?.__agyRemotePromotionState || '',
              portSessions: window.__e2ePortSessions || [],
              unaryCount: window.__e2ePortUnaryPaths?.length || 0,
              unaryPaths: (window.__e2ePortUnaryPaths || []).slice(-15),
              streamPaths: (window.__e2ePortStreamPaths || []).slice(-10),
              cspViolations: window.__e2eCspViolations || [],
              errors: window.__e2eErrors || []
            };
          })()`,
          returnByValue: true,
        },
        sessionId
      );
      snapA = r?.result?.value;
      if (
        snapA &&
        snapA.hasHostMgr &&
        snapA.hasChildMgr &&
        snapA.rootChildCount > 0 &&
        snapA.initConfigRecv
      ) {
        break;
      }
      await new Promise((res) => setTimeout(res, 80));
    }
    assert.ok(snapA, 'MCP-TC-038(A): snapshot must exist');
    assert.deepEqual(snapA.cspViolations, [], `MCP-TC-038(A): zero CSP/TrustedTypes violations in real Chromium, got=${JSON.stringify(snapA)}`);
    assert.deepEqual(snapA.errors, [], `MCP-TC-038(A): zero uncaught errors in real 12.35MB 2.33.0 workbench, got=${JSON.stringify(snapA)}`);
    assert.equal(snapA.hasChildMgr, true, 'MCP-TC-038(A): mcp-manager must mount inside promoted real 2.33.0 workbench window');
    assert.ok(snapA.rootChildCount > 0 && snapA.rootTextLen > 100, `MCP-TC-038(A): real 12.35MB 2.33.0 React 19 workbench must render into #root (no black screen), snapA=${JSON.stringify(snapA)}`);
    assert.equal(snapA.initConfigRecv, true, 'MCP-TC-038(A): real 2.33.0 XChannelTransport must receive INITIAL_CONFIG and sync History');
    assert.ok(snapA.unaryCount > unaryBeforePromo, 'MCP-TC-038(A): promoted real 2.33.0 workbench must exchange -v2 MessagePort unary RPCs');
    assert.equal(snapA.cwHref.startsWith('https://antigravity.google.com/web/2.33.0/'), true, 'MCP-TC-038(A): cd.open();cd.close(); must promote child URL from about:blank to https:// origin');
    assert.equal(snapA.promotionState, 'ready', 'MCP-TC-038(A): frame promoter FSM must reach ready state');
    assert.equal(snapA.hasRemoteLauncher, true, 'MCP-TC-038(A): non-invasive #agy-mcp-remote-launcher must render on remote host page');
    assert.equal(snapA.colorScheme, 'dark', 'MCP-TC-038(A): promoted iframe must apply ?hostTheme=dark colorScheme');
    assert.ok(snapA.csrfLen > 0, 'MCP-TC-038(A): promoted iframe must receive non-empty csrfToken');

    // Deterministic event-driven verification of dynamic script.src, setAttribute('src'), and new Image().src adapters
    const adapterResA = (
      await sendCdp(
        'Runtime.evaluate',
        {
          expression: `(async () => {
            const ifr = document.querySelector('ga-remote-control iframe');
            const cd = ifr.contentDocument;
            const cw = ifr.contentWindow;
            const childCsp = [];
            cd.addEventListener('securitypolicyviolation', (e) => {
              childCsp.push(e.violatedDirective + ':' + e.blockedURI + ':' + (e.sample || ''));
            });
            let s1FinalSrc = '';
            let s1Nonce = '';
            let s2FinalSrc = '';
            const p1 = new Promise((resolve) => {
              const s1 = cd.createElement('script');
              s1.onload = () => resolve(Boolean(cw.__e2eChunkLoaded));
              s1.onerror = () => resolve(false);
              s1.src = './__e2e_dyn_chunk.js';
              s1FinalSrc = s1.src;
              s1Nonce = s1.nonce || s1.getAttribute('nonce') || '';
              cd.head.appendChild(s1);
            });
            const p2 = new Promise((resolve) => {
              const s2 = cd.createElement('script');
              s2.onload = () => resolve(Boolean(cw.__e2eSetAttrChunkLoaded));
              s2.onerror = () => resolve(false);
              s2.setAttribute('src', './__e2e_setattr_chunk.js');
              s2FinalSrc = s2.src;
              cd.head.appendChild(s2);
            });
            const p3 = new Promise((resolve) => {
              const img = new cw.Image();
              img.onload = () => resolve(img.src);
              img.onerror = () => resolve('');
              img.src = './__e2e_pixel.svg';
            });
            const [chunkLoaded, setAttrChunkLoaded, imgLoadedSrc] = await Promise.all([p1, p2, p3]);
            return {
              chunkLoaded,
              setAttrChunkLoaded,
              imgLoadedSrc,
              s1FinalSrc,
              s1NonceLen: s1Nonce.length,
              s2FinalSrc,
              childCsp,
              cspViolations: window.__e2eCspViolations || [],
              errors: window.__e2eErrors || []
            };
          })()`,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId
      )
    )?.result?.value;
    assert.deepEqual(adapterResA?.cspViolations, [], `MCP-TC-038(A): zero parent CSP violations during dynamic asset loads: ${JSON.stringify(adapterResA)}`);
    assert.deepEqual(adapterResA?.childCsp, [], `MCP-TC-038(A): zero child CSP violations during dynamic asset loads: ${JSON.stringify(adapterResA)}`);
    assert.deepEqual(adapterResA?.errors, [], `MCP-TC-038(A): zero runtime errors during dynamic asset loads: ${JSON.stringify(adapterResA)}`);
    assert.equal(adapterResA?.chunkLoaded, true, `MCP-TC-038(A): dynamic relative script.src must resolve to CDN with CSP nonce and TrustedScriptURL: ${JSON.stringify({ adapterResA, netEvents, cdnReqs: cdnReqs.slice(-25) })}`);
    assert.equal(adapterResA?.setAttrChunkLoaded, true, `MCP-TC-038(A): Element.prototype.setAttribute("src", ...) on script must resolve to CDN with CSP nonce and TrustedScriptURL: ${JSON.stringify(adapterResA)}`);
    assert.equal(adapterResA?.imgLoadedSrc, 'https://www.gstatic.com/antigravity/web/2.33.0/__e2e_pixel.svg', 'MCP-TC-038(A): new Image().src relative path must rewrite to CDN');

    // Open real Antigravity 2.33.0 Settings screen (?settingsOpen=true) inside promoted child & verify real settings-nav-item-McpManager tab + host reconnect!
    await sendCdp(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const cw = document.querySelector('ga-remote-control iframe')?.contentWindow;
          if (cw) {
            cw.history.pushState(null, '', '/web/2.33.0/?settingsOpen=true');
            cw.dispatchEvent(new cw.PopStateEvent('popstate'));
          }
        })()`,
        returnByValue: true,
      },
      sessionId
    );
    let hasRealSettingsMcpTab = false;
    for (let i = 0; i < 40; i++) {
      const r = await sendCdp(
        'Runtime.evaluate',
        {
          expression: 'Boolean(document.querySelector("ga-remote-control iframe")?.contentDocument?.querySelector(\'button[data-testid="settings-nav-item-McpManager"]\'))',
          returnByValue: true,
        },
        sessionId
      );
      if (r?.result?.value === true) {
        hasRealSettingsMcpTab = true;
        break;
      }
      await new Promise((res) => setTimeout(res, 60));
    }

    const modalCheckA = (
      await sendCdp(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const ifr = document.querySelector('ga-remote-control iframe');
            const cd = ifr.contentDocument;
            ifr.contentWindow.agyMcpManager.openModal();
            const childModalOpen = Boolean(cd.getElementById('agy-mcp-manager-modal-backdrop'));
            ifr.contentWindow.agyMcpManager.closeModal();
            // Now test [BLOCKING 5]: host reconnect assigning a new URL to ifr.src!
            const reconnectUrl = 'https://antigravity.static.usercontent.goog/web/2.33.0/?hostTheme=dark&iframe=true&reconnect=1';
            ifr.src = reconnectUrl;
            return {
              childModalOpen,
              ifrSrcAfterReconnect: ifr.src,
              promotedAfterReconnect: ifr.__agyMcpPromoted,
              ownerAfterReconnect: ifr.__agyRemotePromotionOwner
            };
          })()`,
          returnByValue: true,
        },
        sessionId
      )
    )?.result?.value;
    assert.equal(hasRealSettingsMcpTab, true, 'MCP-TC-038(A): real Antigravity 2.33.0 Settings modal must mount settings-nav-item-McpManager tab');
    assert.equal(modalCheckA?.childModalOpen, true, 'MCP-TC-038(A): MCP Manager modal must open cleanly inside promoted 2.33.0 workbench');
    assert.equal(
      modalCheckA?.ifrSrcAfterReconnect,
      'https://antigravity.static.usercontent.goog/web/2.33.0/?hostTheme=dark&iframe=true&reconnect=1',
      'MCP-TC-038(A): host reconnect assignment to iframe.src must immediately remove spoofed canonicalFrameUrl getter'
    );
    assert.equal(modalCheckA?.promotedAfterReconnect, undefined, 'MCP-TC-038(A): host reconnect must clear __agyMcpPromoted');
    assert.equal(modalCheckA?.ownerAfterReconnect, undefined, 'MCP-TC-038(A): host reconnect must clear __agyRemotePromotionOwner');

    // === Scenario B: CDN main.js HTTP 500 failure -> automatic rollback to real cross-origin 2.33.0 workbench (zero black screen) ===
    forceCdnMain500 = true;
    const prevCrossOriginBoots = crossOriginBootNotifications;
    await sendCdp('Page.navigate', { url: 'https://antigravity.google.com/r/rollback-test-v2' }, sessionId);
    for (let i = 0; i < 80; i++) {
      const r = await sendCdp('Runtime.evaluate', { expression: 'window.__e2ePortUnaryPaths?.length || 0', returnByValue: true }, sessionId);
      if (r?.result?.value >= 1) break;
      await new Promise((res) => setTimeout(res, 60));
    }
    const sessionsBeforeRollback = (
      await sendCdp('Runtime.evaluate', { expression: 'window.__e2ePortSessions?.length || 0', returnByValue: true }, sessionId)
    )?.result?.value || 0;
    await sendCdp('Runtime.evaluate', { expression: bookmarkletExpr, returnByValue: true }, sessionId);

    let snapB = null;
    for (let i = 0; i < 100; i++) {
      const r = await sendCdp(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const ifr = document.querySelector('ga-remote-control iframe');
            let isStillBlankSameOrigin = false;
            try {
              isStillBlankSameOrigin = ifr?.contentWindow?.location?.href === 'about:blank';
            } catch {
              isStillBlankSameOrigin = false;
            }
            return {
              hasHostMgr: Boolean(window.agyMcpManager),
              portSessionsCount: window.__e2ePortSessions?.length || 0,
              unaryCount: window.__e2ePortUnaryPaths?.length || 0,
              isStillBlankSameOrigin,
              promotionState: ifr?.__agyRemotePromotionState || '',
              promotionFailedFlag: Boolean(ifr?.__agyMcpPromotionFailed)
            };
          })()`,
          returnByValue: true,
        },
        sessionId
      );
      snapB = r?.result?.value;
      if (snapB && snapB.promotionFailedFlag && snapB.portSessionsCount > sessionsBeforeRollback && !snapB.isStillBlankSameOrigin) break;
      await new Promise((res) => setTimeout(res, 80));
    }
    assert.equal(snapB?.promotionFailedFlag, true, 'MCP-TC-038(B): failed promotion must mark __agyMcpPromotionFailed to prevent retry flicker');
    assert.equal(snapB?.promotionState, 'rolled_back', 'MCP-TC-038(B): frame promoter FSM must transition to rolled_back on error');
    assert.equal(snapB?.isStillBlankSameOrigin, false, 'MCP-TC-038(B): iframe must NOT stay on about:blank after main.js failure');
    assert.ok(
      snapB?.portSessionsCount > sessionsBeforeRollback && crossOriginBootNotifications >= prevCrossOriginBoots + 2,
      'MCP-TC-038(B): rolled-back real cross-origin 2.33.0 workbench must reload and reconnect -v2 MessagePort'
    );

    // === Scenario C1: Strict trusted-types ogb-qtm#html blocking ALL custom policies -> bookmarklet exits cleanly via bookmarkletExpr (ZERO CDP bundle bypass) ===
    forceCdnMain500 = false;
    await sendCdp('Page.navigate', { url: 'https://antigravity.google.com/r/strict-tt-block-all-v2' }, sessionId);
    for (let i = 0; i < 80; i++) {
      const r = await sendCdp('Runtime.evaluate', { expression: 'window.__e2ePortUnaryPaths?.length || 0', returnByValue: true }, sessionId);
      if (r?.result?.value >= 1) break;
      await new Promise((res) => setTimeout(res, 60));
    }
    const bmEvalC1 = await sendCdp('Runtime.evaluate', { expression: bookmarkletExpr, returnByValue: true }, sessionId);
    assert.equal(bmEvalC1.exceptionDetails, undefined, 'MCP-TC-038(C1): bookmarkletExpr must not throw synchronously');
    await new Promise((res) => setTimeout(res, 400));
    const snapC1 = (
      await sendCdp(
        'Runtime.evaluate',
        {
          expression: `({
            aboutBlankLoads: window.__e2eAboutBlankLoads || 0,
            cspViolations: window.__e2eCspViolations || [],
            errors: window.__e2eErrors || []
          })`,
          returnByValue: true,
        },
        sessionId
      )
    )?.result?.value;
    assert.equal(snapC1?.aboutBlankLoads, 0, 'MCP-TC-038(C1): live cross-origin workbench must remain untouched when all custom policies are blocked');
    assert.deepEqual(
      (snapC1?.cspViolations || []).filter((v) => !v.startsWith('trusted-types:trusted-types-policy')),
      [],
      'MCP-TC-038(C1): bookmarklet must trigger ZERO sink/script-src violations (never assigning raw string to script.text)'
    );
    assert.deepEqual(snapC1?.errors, [], 'MCP-TC-038(C1): zero uncaught TypeError or rejection when policy creation fails');

    // === Scenario C2: trusted-types ogb-qtm#html agy-mcp-bm (bookmarklet bootstrap allowed, agy-mcp-manager ScriptURL blocked) -> ONLY bookmarkletExpr used, preflight preserves iframe & #agy-mcp-remote-launcher / Ctrl+Alt+M work ===
    await sendCdp('Page.navigate', { url: 'https://antigravity.google.com/r/strict-tt-preflight-v2' }, sessionId);
    for (let i = 0; i < 80; i++) {
      const r = await sendCdp('Runtime.evaluate', { expression: 'window.__e2ePortUnaryPaths?.length || 0', returnByValue: true }, sessionId);
      if (r?.result?.value >= 1) break;
      await new Promise((res) => setTimeout(res, 60));
    }
    const bmEvalC2 = await sendCdp('Runtime.evaluate', { expression: bookmarkletExpr, returnByValue: true }, sessionId);
    assert.equal(bmEvalC2.exceptionDetails, undefined, 'MCP-TC-038(C2): bookmarkletExpr must execute without CDP bundle bypass');
    let snapC2 = null;
    for (let i = 0; i < 60; i++) {
      const r = await sendCdp('Runtime.evaluate', { expression: 'Boolean(document.getElementById("agy-mcp-remote-launcher"))', returnByValue: true }, sessionId);
      if (r?.result?.value === true) break;
      await new Promise((res) => setTimeout(res, 60));
    }
    snapC2 = (
      await sendCdp(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const launcher = document.getElementById('agy-mcp-remote-launcher');
            const insideStatusbar = Boolean(launcher && launcher.closest('.agy-ctx-statusbar'));
            launcher?.click();
            const modalOpenedByLauncher = Boolean(document.getElementById('agy-mcp-manager-modal-backdrop'));
            window.agyMcpManager?.closeModal();
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, altKey: true, bubbles: true }));
            return {
              aboutBlankLoads: window.__e2eAboutBlankLoads || 0,
              cspViolations: window.__e2eCspViolations || [],
              errors: window.__e2eErrors || [],
              hasLauncher: Boolean(launcher),
              insideStatusbar,
              modalOpenedByLauncher,
              modalOpen: Boolean(document.getElementById('agy-mcp-manager-modal-backdrop'))
            };
          })()`,
          returnByValue: true,
        },
        sessionId
      )
    )?.result?.value;
    assert.equal(snapC2?.aboutBlankLoads, 0, 'MCP-TC-038(C2): preflight TrustedScriptURL check must abort BEFORE navigating iframe to about:blank when policy creation is blocked');
    assert.deepEqual(
      (snapC2?.cspViolations || []).filter((v) => !v.startsWith('trusted-types:trusted-types-policy')),
      [],
      'MCP-TC-038(C2): zero sink/script-src CSP violations during preflight abort via real bookmarklet'
    );
    assert.deepEqual(snapC2?.errors, [], 'MCP-TC-038(C2): zero uncaught errors during preflight abort via real bookmarklet');
    assert.equal(snapC2?.hasLauncher, true, 'MCP-TC-038(C2): #agy-mcp-remote-launcher must render on strict-CSP remote host page via real bookmarklet');
    assert.equal(snapC2?.insideStatusbar, false, 'MCP-TC-038(C2): #agy-mcp-remote-launcher must NEVER be placed inside .agy-ctx-statusbar');
    assert.equal(snapC2?.modalOpenedByLauncher, true, 'MCP-TC-038(C2): clicking #agy-mcp-remote-launcher must open the standalone MCP Server Manager modal for mobile/touch users');
    assert.equal(snapC2?.modalOpen, true, 'MCP-TC-038(C2): Ctrl+Alt+M must also open the full MCP Server Manager modal on the parent host page');
  } finally {
    try { cdpWs?.close(); } catch {}
    try { chromeProc?.kill(); } catch {}
    try { hostServer.closeAllConnections?.(); } catch {}
    try { cdnServer.closeAllConnections?.(); } catch {}
    await new Promise((r) => hostServer.close(() => r()));
    await new Promise((r) => cdnServer.close(() => r()));
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
});

test('MCP-TC-039: v1.5.0 redesigned SOLID modules (remote-runtime lease chaining, companion-loader chunk allowlist & tag guard, remote-frame-promoter FSM ownership, and __agyMountMcpManager handoff)', async () => {
  const {
    acquireRemoteRuntimeLease,
    isAutoIframeLoadSuppressed,
  } = require('../src/remote-runtime');
  const { isAllowedMcpScriptUrl } = require('../src/companion-loader');
  const { resolveHostAdapterConfig } = require('../src/host-adapter-config');
  const {
    FRAME_PROMOTION_STATE,
    canAcquirePromotionOwnership,
    resolveRelativeToCdnUrl,
    promoteCrossOriginRemoteIframe,
  } = require('../src/remote-frame-promoter');
  const { REMOTE_LAUNCHER_ID } = require('../src/native-dom-integrator');

  // 1) Isolated lease chaining & reference-counted suppression check
  function SharedRc() {}
  let baseProxyCalls = 0;
  let baseLoadCalls = 0;
  const origProxy = async function () {
    baseProxyCalls += 1;
    return { payload: new Uint8Array(0) };
  };
  const origLoad = async function () {
    baseLoadCalls += 1;
    return 'loaded';
  };
  SharedRc.prototype.proxyCommand = origProxy;
  SharedRc.prototype.onIframeLoad = origLoad;

  const inst = new SharedRc();
  const winLease = { __agyRemoteControlInstance: inst };
  const leaseA = acquireRemoteRuntimeLease({ defaultWin: winLease });
  const leaseB = acquireRemoteRuntimeLease({ defaultWin: winLease });
  leaseA.resolveRemoteControlInstance(winLease);
  leaseB.resolveRemoteControlInstance(winLease);

  inst.__agySuppressAutoIframeLoadCount = 1;
  assert.equal(isAutoIframeLoadSuppressed(inst), true, 'MCP-TC-039: numeric __agySuppressAutoIframeLoadCount > 0 must suppress onIframeLoad');
  await SharedRc.prototype.onIframeLoad.call(inst);
  assert.equal(baseLoadCalls, 0, 'MCP-TC-039: suppressed onIframeLoad must not invoke native method');
  delete inst.__agySuppressAutoIframeLoadCount;
  await SharedRc.prototype.proxyCommand.call(inst, '/test');
  assert.equal(baseProxyCalls, 1);

  const savedWrappedLoad = SharedRc.prototype.onIframeLoad;
  leaseB.release();
  leaseA.release();
  assert.equal(SharedRc.prototype.proxyCommand, origProxy, 'MCP-TC-039: releasing chained leases must restore exact original prototype method');
  assert.equal(SharedRc.prototype.onIframeLoad, origLoad, 'MCP-TC-039: releasing chained leases must restore exact original onIframeLoad');
  // [BLOCKING 6] Retained reference to wrapped onIframeLoad MUST pass through after release() even if suppression count > 0!
  inst.__agySuppressAutoIframeLoadCount = 1;
  await savedWrappedLoad.call(inst);
  assert.equal(baseLoadCalls, 1, 'MCP-TC-039: disposed lease wrapper reference must pass through immediately (isOff checked first)');
  delete inst.__agySuppressAutoIframeLoadCount;

  // [BLOCKING 2] Canonical __agyHostInstalledPlugins & parseAutoinjectCompanionManifest schema parity
  const { parseAutoinjectCompanionManifest } = require('../src/remote-runtime');
  const sampleBundle = [
    'function mountStatusBar() {}',
    '// === BEGIN_AGY_MCP_MANAGER_V1 ===',
    'function mountMcpManager() {}',
    '// === END_AGY_MCP_MANAGER_V1 ===',
    '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
    'window.__ko = 1;',
    '// === END_AGY_KO_THOUGHT_LOCALIZER_V2 ===',
  ].join('\n');
  const parsedManifest = parseAutoinjectCompanionManifest(sampleBundle);
  assert.equal(parsedManifest.statusbarBlock, 'function mountStatusBar() {}');
  assert.equal(parsedManifest.statusbarCode, parsedManifest.statusbarBlock);
  assert.equal(parsedManifest.mcpManagerCode, parsedManifest.mcpBlock);
  assert.equal(parsedManifest.koTranslatorCode, parsedManifest.koBlock);
  assert.ok(parsedManifest.mcpBlock.includes('mountMcpManager'));
  assert.ok(parsedManifest.koBlock.includes('window.__ko = 1;'));

  // [BLOCKING 3] getOrCreateTrustedTypesPolicy must throw TypeError (never raw string) when createPolicy is blocked
  const { getOrCreateTrustedTypesPolicy } = require('../src/companion-loader');
  const blockedTtWin = {
    trustedTypes: {
      createPolicy() {
        throw new TypeError('Blocked by CSP trusted-types');
      },
    },
  };
  const blockedCtrl = getOrCreateTrustedTypesPolicy(blockedTtWin);
  blockedCtrl.allowInline('1+1');
  assert.throws(() => blockedCtrl.toScript('1+1'), TypeError, 'MCP-TC-039: toScript must throw TypeError when policy creation was denied');
  assert.throws(
    () => blockedCtrl.toScriptURL('https://www.gstatic.com/antigravity/web/2.33.0/main.js'),
    TypeError,
    'MCP-TC-039: toScriptURL must throw TypeError when policy creation was denied'
  );

  // [BLOCKING 4, 5, 6] Worker Blob adapter, IMG/LINK/setAttribute CDN rewrite, reconnect iframe.src un-spoofing, and zero __agyMcpOrigOnIframeLoad mutation
  const workerCalls = [];
  const createdBlobs = [];
  let blobSeq = 0;
  const childAdapterWin = {
    location: { href: 'about:blank', search: '?hostTheme=dark&iframe=true' },
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    history: { replaceState() {}, pushState() {} },
    Blob: class {
      constructor(parts) {
        this.text = parts.join('');
        createdBlobs.push(this.text);
      }
    },
    URL: {
      createObjectURL() { return `blob:https://antigravity.google.com/id-${++blobSeq}`; },
      revokeObjectURL() {},
    },
    Worker: function MockWorker(u, opts) {
      workerCalls.push({ u: String(u), opts });
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
  };
  const makeChildNode = (t) => ({
    tagName: String(t).toUpperCase(),
    style: {},
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild() {},
    removeChild() {},
  });
  const childAdapterDoc = {
    documentElement: makeChildNode('html'),
    head: makeChildNode('head'),
    body: makeChildNode('body'),
    open() {},
    close() {},
    createElement: (t) => makeChildNode(t),
  };
  childAdapterWin.document = childAdapterDoc;
  let mockIframeBlank = false;
  let mockIframeAttrSrc = 'https://antigravity.static.usercontent.goog/web/2.33.0/?hostTheme=dark&iframe=true';
  const mockReconnectIframe = {
    src: mockIframeAttrSrc,
    get contentWindow() {
      if (!mockIframeBlank) throw new Error('Cross-origin');
      return childAdapterWin;
    },
    get contentDocument() {
      if (!mockIframeBlank) throw new Error('Cross-origin');
      return childAdapterDoc;
    },
    getAttribute: (k) => (k === 'src' ? mockIframeAttrSrc : null),
    setAttribute(k, v) {
      if (k === 'src') {
        mockIframeAttrSrc = String(v);
        if (v === 'about:blank') mockIframeBlank = true;
      }
    },
    addEventListener(ev, fn) {
      if (ev === 'load') this._onLoad = fn;
    },
    removeEventListener() {},
  };
  class CleanProtoRc {
    onIframeLoad() { return Promise.resolve(); }
    iframeSrc() { return mockIframeAttrSrc; }
  }
  const cleanRcInst = new CleanProtoRc();
  const hostAdapterWin = {
    location: { protocol: 'https:', hostname: 'antigravity.google.com', origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/r/x-v2' },
    __agyRemoteControlInstance: cleanRcInst,
    setTimeout,
    clearTimeout,
  };
  const hostAdapterDoc = {
    querySelector: (s) => (s === 'script[nonce]' ? { nonce: 'n-test' } : null),
    querySelectorAll: () => [],
    createElement: (t) => makeChildNode(t),
  };
  const startedPromo = promoteCrossOriginRemoteIframe(hostAdapterWin, hostAdapterDoc, mockReconnectIframe, null, null, MCP_MANAGER_VERSION);
  assert.equal(startedPromo, true);
  assert.equal(Object.prototype.hasOwnProperty.call(CleanProtoRc.prototype, '__agyMcpOrigOnIframeLoad'), false, 'MCP-TC-039: zero __agyMcpOrigOnIframeLoad mutation on RC.prototype');
  assert.equal(Object.prototype.hasOwnProperty.call(cleanRcInst, '__agyMcpOrigOnIframeLoad'), false, 'MCP-TC-039: zero __agyMcpOrigOnIframeLoad mutation on rcInst');
  mockReconnectIframe._onLoad();

  new childAdapterWin.Worker('./worker-editor.js');
  new childAdapterWin.Worker('/web/2.33.0/worker-mod.mjs', { type: 'module' });
  assert.equal(workerCalls.length, 2, 'MCP-TC-039: Worker adapter must instantiate same-origin Blob workers');
  assert.ok(createdBlobs[0].includes('importScripts("https://www.gstatic.com/antigravity/web/2.33.0/worker-editor.js")'));
  assert.ok(createdBlobs[1].includes('import "https://www.gstatic.com/antigravity/web/2.33.0/worker-mod.mjs"'));
  assert.throws(() => new childAdapterWin.Worker('https://evil.example/pwn.js'), TypeError, 'MCP-TC-039: untrusted Worker URL must throw TypeError');

  const synthImg = childAdapterDoc.createElement('img');
  synthImg.setAttribute('src', './icons/logo.svg');
  assert.equal(synthImg.src, 'https://www.gstatic.com/antigravity/web/2.33.0/icons/logo.svg');

  const nextSessionSrc = 'https://antigravity.static.usercontent.goog/web/2.33.0/?hostTheme=dark&iframe=true&reconnected=2';
  mockReconnectIframe.src = nextSessionSrc;
  assert.equal(mockReconnectIframe.src, nextSessionSrc, 'MCP-TC-039: assigning iframe.src on reconnect must un-spoof canonicalFrameUrl getter');
  assert.equal(mockReconnectIframe.__agyMcpPromoted, undefined, 'MCP-TC-039: reconnect must clear __agyMcpPromoted');

  // 2) Dynamic CDN chunk allowlist & path traversal rejection in companion-loader
  const defaultCfg = resolveHostAdapterConfig();
  assert.equal(
    isAllowedMcpScriptUrl('https://www.gstatic.com/antigravity/web/2.33.0/chunk-router-abc123.js', defaultCfg),
    true,
    'MCP-TC-039: dynamic CDN chunk .js under /web/<ver>/ must be allowed'
  );
  assert.equal(
    isAllowedMcpScriptUrl('https://www.gstatic.com/antigravity/web/2.33.0/../evil.js', defaultCfg),
    false,
    'MCP-TC-039: path traversal must be rejected'
  );
  assert.equal(
    resolveRelativeToCdnUrl('./chunk-1.js', 'https://www.gstatic.com/antigravity/web/2.33.0'),
    'https://www.gstatic.com/antigravity/web/2.33.0/chunk-1.js'
  );
  assert.equal(
    resolveRelativeToCdnUrl('/web/2.33.0/assets/worker.js', 'https://www.gstatic.com/antigravity/web/2.33.0'),
    'https://www.gstatic.com/antigravity/web/2.33.0/assets/worker.js'
  );

  // 3) Frame promoter FSM mutual exclusion when companion already promoted the iframe
  const koOwnedIframe = { __agyKoPromoted: '1.3.0' };
  assert.equal(canAcquirePromotionOwnership(koOwnedIframe, MCP_MANAGER_VERSION), false);
  const promoRes = promoteCrossOriginRemoteIframe({}, {}, koOwnedIframe, null, null, MCP_MANAGER_VERSION);
  assert.equal(promoRes, false, 'MCP-TC-039: promoter must yield when __agyKoPromoted is set');
  assert.equal(
    koOwnedIframe.__agyRemotePromotionState,
    FRAME_PROMOTION_STATE.PASSIVE_ATTACHED,
    'MCP-TC-039: yielding to companion promotion must record PASSIVE_ATTACHED state'
  );

  // 4) __agyMountMcpManager companion handoff & #agy-mcp-remote-launcher clean teardown
  const makeMiniEl = (tag) => ({
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    style: {},
    attrs: new Map(),
    children: [],
    listeners: new Map(),
    parentNode: null,
    parentElement: null,
    setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') this.id = String(v); },
    getAttribute(k) { return k === 'id' ? (this.id || null) : (this.attrs.get(k) ?? null); },
    hasAttribute(k) { return k === 'id' ? Boolean(this.id) : this.attrs.has(k); },
    removeAttribute(k) { this.attrs.delete(k); },
    appendChild(c) { c.parentNode = this; c.parentElement = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) { this.children.splice(i, 1); c.parentNode = null; c.parentElement = null; } return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener(ev, fn) { this.listeners.set(ev, fn); },
    removeEventListener(ev) { this.listeners.delete(ev); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const ch of n.children || []) {
          if (sel === 'ga-remote-control' && ch.tagName === 'GA-REMOTE-CONTROL') out.push(ch);
          else if (sel.startsWith('#') && ch.id === sel.slice(1)) out.push(ch);
          else if (sel === '[data-agy-custom-mcp-btn]' && ch.hasAttribute('data-agy-custom-mcp-btn')) out.push(ch);
          walk(ch);
        }
      };
      walk(this);
      return out;
    },
  });
  const makeMiniDoc = () => ({
    readyState: 'complete',
    head: makeMiniEl('head'),
    body: makeMiniEl('body'),
    createElement: (t) => makeMiniEl(t),
    getElementById(id) { return this.head.querySelector(`#${id}`) || this.body.querySelector(`#${id}`); },
    querySelector(sel) { return this.head.querySelector(sel) || this.body.querySelector(sel); },
    querySelectorAll(sel) { return [...this.head.querySelectorAll(sel), ...this.body.querySelectorAll(sel)]; },
    addEventListener() {},
    removeEventListener() {},
  });

  const parentDoc = makeMiniDoc();
  parentDoc.body.appendChild(makeMiniEl('ga-remote-control'));
  const parentWin = {
    location: { hostname: 'antigravity.google.com', origin: 'https://antigravity.google.com', href: 'https://antigravity.google.com/r/test-v2' },
    document: parentDoc,
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
  };
  parentWin.parent = parentWin;

  const childDoc = makeMiniDoc();
  const childWin = {
    document: childDoc,
    parent: parentWin,
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
  };

  const handoffCtrl = mountMcpManager({
    window: parentWin,
    document: parentDoc,
    bridge: {
      async readMcpConfig() { return { ok: true, config: { mcpServers: {} } }; },
      async fetchServerStates() { return { ok: true, states: [] }; },
    },
  });

  assert.ok(parentDoc.getElementById(REMOTE_LAUNCHER_ID), 'MCP-TC-039: #agy-mcp-remote-launcher must mount on remote host page');
  assert.equal(typeof parentWin.__agyMountMcpManager, 'function', 'MCP-TC-039: parent window must expose __agyMountMcpManager handoff');
  const childCtrl = parentWin.__agyMountMcpManager(childWin, childDoc);
  assert.ok(childCtrl && childWin.agyMcpManager === childCtrl, 'MCP-TC-039: __agyMountMcpManager must mount child workbench instance');

  handoffCtrl.destroy();
  assert.equal(parentDoc.getElementById(REMOTE_LAUNCHER_ID), null, 'MCP-TC-039: destroy() must remove #agy-mcp-remote-launcher');
  assert.equal(parentWin.__agyMountMcpManager, undefined, 'MCP-TC-039: destroy() must remove window.__agyMountMcpManager');
});
