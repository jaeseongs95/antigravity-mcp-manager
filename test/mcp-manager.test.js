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

test('extractAuthFromSpec, buildAuthHeaders, and parseSmartMcpInput support Bearer, API Key, Basic auth, and inline/URL tokens', () => {
  // 1. Bearer token via second parameter in parseSmartMcpInput
  const withTokenParam = parseSmartMcpInput('https://ledger-mcp.jaeseong.dev/mcp', 'my_secret_jwt_123');
  assert.equal(withTokenParam.ok, true);
  assert.equal(withTokenParam.serverName, 'ledger-mcp-jaeseong');
  assert.deepEqual(withTokenParam.spec, {
    url: 'https://ledger-mcp.jaeseong.dev/mcp',
    headers: { Authorization: 'Bearer my_secret_jwt_123' },
  });

  // 2. Inline Bearer token in URL input string
  const inlineBearer = parseSmartMcpInput('https://ledger-mcp.jaeseong.dev/mcp Bearer tok_xyz');
  assert.equal(inlineBearer.ok, true);
  assert.deepEqual(inlineBearer.spec.headers, { Authorization: 'Bearer tok_xyz' });

  // 3. URL userinfo token extraction (`https://tok_123@host/mcp`)
  const urlUserToken = parseSmartMcpInput('https://tok_123@ssh-approval-origin.jaeseong.dev/mcp');
  assert.equal(urlUserToken.ok, true);
  assert.equal(urlUserToken.spec.url, 'https://ssh-approval-origin.jaeseong.dev/mcp');
  assert.deepEqual(urlUserToken.spec.headers, { Authorization: 'Bearer tok_123' });

  // 4. extractAuthFromSpec defaults to 'oauth' for HTTP URL servers without static auth headers
  const defaultOAuth = extractAuthFromSpec({
    url: 'https://ledger-mcp.jaeseong.dev/mcp',
  });
  assert.equal(defaultOAuth.authMode, 'oauth');
  assert.equal(defaultOAuth.oauthClientMode, 'auto');

  // 5. validateAndBuildServerSpec builds custom OAuth client settings and strips stale Authorization when authMode='oauth'
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

  // 6. extractAuthFromSpec & buildAuthHeaders round-trip for Bearer and Basic
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

test('createHostMcpBridge supports OAuth completion/disconnection, spec.serverName normalization, and batch auth headers update', async () => {
  const files = new Map();
  const oauthCalls = [];
  const disconnectCalls = [];

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
            status: 3,
            error: 'calling "initialize": sending "initialize": Unauthorized',
            spec: { serverName: 'ledger-mcp-jaeseong', serverUrl: 'https://ledger-mcp.jaeseong.dev/mcp' },
          },
        ],
      };
    },
    async refreshMcpServers() {
      return {};
    },
    async completeMcpOAuth(req) {
      oauthCalls.push(req);
      return {};
    },
    async disconnectMcpOAuth(req) {
      disconnectCalls.push(req);
      return {};
    },
  };

  const bridge = createHostMcpBridge({ hostService: mockHostService });
  const statesRes = await bridge.fetchServerStates();
  assert.equal(statesRes.ok, true);
  assert.equal(statesRes.states[0].serverName, 'ledger-mcp-jaeseong');

  await bridge.upsertCustomServer('ledger-mcp-jaeseong', { url: 'https://ledger-mcp.jaeseong.dev/mcp' });
  await bridge.upsertCustomServer('ssh-test-origin-jaeseong', { url: 'https://ssh-test-origin.jaeseong.dev/mcp' });

  const batchRes = await bridge.applyAuthHeadersToServers(null, { Authorization: 'Bearer shared_tok_777' });
  assert.equal(batchRes.ok, true);
  assert.equal(batchRes.updatedCount, 2);

  const cfg = (await bridge.readMcpConfig()).config;
  assert.equal(cfg.mcpServers['ledger-mcp-jaeseong'].headers.Authorization, 'Bearer shared_tok_777');
  assert.equal(cfg.mcpServers['ssh-test-origin-jaeseong'].headers.Authorization, 'Bearer shared_tok_777');

  const oauthRes = await bridge.completeOAuth('ledger-mcp-jaeseong', 'code_abc');
  assert.equal(oauthRes.ok, true);
  assert.deepEqual(oauthCalls, [{ serverName: 'ledger-mcp-jaeseong', authorizationCode: 'code_abc' }]);

  const discRes = await bridge.disconnectOAuth('ledger-mcp-jaeseong');
  assert.equal(discRes.ok, true);
  assert.deepEqual(disconnectCalls, [{ serverName: 'ledger-mcp-jaeseong', account: '' }]);
});

test('buildBundle produces valid self-contained userscript bundle without statusbar registerAdapter', () => {
  const { buildBundle } = require('../scripts/build');
  const res = buildBundle();
  assert.ok(res.size > 5000);
  assert.ok(res.bundle.includes('Antigravity Custom MCP Server Manager'));
  assert.ok(res.bundle.includes('사용자 지정 MCP 서버 추가'));
  assert.ok(res.bundle.includes('고급 OAuth 설정'));
  assert.ok(res.bundle.includes('settings-nav-item-McpManager'));
  assert.ok(!res.bundle.includes('.registerAdapter('));
});

test('createModalController builds OAuth-first edit popup, OAuth connect modal, and Settings page content', async () => {
  const { createModalController } = require('../src/modal-ui');

  // Minimal DOM mock for modal-ui verification
  function makeEl(tag) {
    const el = {
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
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        child.parentElement = this;
        this.children.push(child);
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
        const fns = this.listeners.get('click') || [];
        for (const fn of fns) fn({ target: this, preventDefault() {}, stopPropagation() {} });
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (sel === '.flex.flex-col.gap-0\\.5' && cur.className === 'flex flex-col gap-0.5') return cur;
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
          if (sel.startsWith('#')) return node.id === sel.slice(1);
          if (sel === '.grow.w-full') return node.className === 'grow w-full';
          if (sel.startsWith('.')) return (node.className || '').split(/\s+/).includes(sel.slice(1));
          const mTagAttr = /^([a-z0-9_-]+)\[([^=\]]+)="([^"]+)"\]$/i.exec(sel);
          if (mTagAttr) {
            return node.tagName === mTagAttr[1].toUpperCase() && node.getAttribute(mTagAttr[2]) === mTagAttr[3];
          }
          const mAttr = /^\[([^=\]]+)="([^"]+)"\]$/.exec(sel);
          if (mAttr) return node.getAttribute(mAttr[1]) === mAttr[2];
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
    return el;
  }

  const doc = {
    head: makeEl('head'),
    body: makeEl('body'),
    createElement: (tag) => makeEl(tag),
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

  let openedUrl = '';
  const mockBridge = {
    async readMcpConfig() {
      return {
        uri: 'file:///C:/Users/TestUser/.gemini/config/mcp_config.json',
        rawText: '{"mcpServers":{"ledger-mcp-jaeseong":{"url":"https://ledger-mcp.jaeseong.dev/mcp"}}}',
        config: {
          mcpServers: {
            'ledger-mcp-jaeseong': { url: 'https://ledger-mcp.jaeseong.dev/mcp' },
          },
        },
      };
    },
    async fetchServerStates() {
      return {
        ok: true,
        states: [
          {
            serverName: 'ledger-mcp-jaeseong',
            status: 1,
            authUrl: 'https://ledger-mcp.jaeseong.dev/oauth/authorize?client_id=abc',
            spec: { serverName: 'ledger-mcp-jaeseong', serverUrl: 'https://ledger-mcp.jaeseong.dev/mcp' },
          },
        ],
      };
    },
    openAuthUrl(url) {
      openedUrl = url;
      return { ok: true };
    },
  };

  const modal = createModalController({ doc, bridge: mockBridge });

  // 1. Open Edit Popup -> verify OAuth is selected by default and options match ChatGPT UX
  await modal.openEditPopup('ledger-mcp-jaeseong', { focusAuth: true });
  assert.equal(modal.isEditPopupOpen(), true);
  const authSelect = doc.body.querySelector('[data-field="authMode"]');
  assert.ok(authSelect);
  assert.equal(authSelect.value, 'oauth');
  assert.deepEqual(
    authSelect.options.map((o) => o.value),
    ['oauth', 'none', 'oauth_or_none', 'bearer', 'apiKey', 'basic']
  );
  const advToggle = doc.body.querySelector('[data-testid="agy-mcp-advanced-oauth-toggle"]');
  assert.ok(advToggle);
  modal.closeEditPopup();
  assert.equal(modal.isEditPopupOpen(), false);

  // 2. Open OAuth Connect Modal (<서버이름> 연결 ↗)
  await modal.openOAuthConnectModal('test', 'https://example.com/oauth/authorize');
  assert.equal(modal.isOAuthConnectModalOpen(), true);
  const launchBtn = doc.body.querySelector('[data-testid="agy-mcp-oauth-launch-btn"]');
  assert.ok(launchBtn);
  assert.equal(launchBtn.textContent, 'test 연결 ↗');
  launchBtn.click();
  assert.equal(openedUrl, 'https://example.com/oauth/authorize');
  modal.closeOAuthConnectModal();
  assert.equal(modal.isOAuthConnectModalOpen(), false);

  // 3. Render Settings Page Content inside #agy-mcp-settings-pane
  const settingsPane = makeEl('div');
  settingsPane.id = 'agy-mcp-settings-pane';
  doc.body.appendChild(settingsPane);
  modal.renderSettingsPageContent(settingsPane);
  const addBtn = settingsPane.querySelector('[data-testid="agy-mcp-settings-add-btn"]');
  assert.ok(addBtn);
  assert.equal(addBtn.textContent, '+ 사용자 지정 MCP 서버 추가');

  // 4. Verify mountMcpManager injects "MCP 서버" tab into .settings-modal-container right below "한글 번역"
  const { mountMcpManager } = require('../src/index');
  const settingsModal = makeEl('div');
  settingsModal.className = 'settings-modal-container';
  const navGroup = makeEl('div');
  navGroup.className = 'flex flex-col gap-0.5';
  const modelsBtn = makeEl('button');
  modelsBtn.setAttribute('data-testid', 'settings-nav-item-Models');
  modelsBtn.textContent = '모델';
  const koBtn = makeEl('button');
  koBtn.setAttribute('data-testid', 'settings-nav-item-KoTranslator');
  koBtn.textContent = '한글 번역';
  navGroup.appendChild(modelsBtn);
  navGroup.appendChild(koBtn);

  const contentArea = makeEl('div');
  contentArea.className = 'grow w-full';
  const nativeGeneralPane = makeEl('div');
  nativeGeneralPane.id = 'native-general';
  contentArea.appendChild(nativeGeneralPane);

  settingsModal.appendChild(navGroup);
  settingsModal.appendChild(contentArea);
  doc.body.appendChild(settingsModal);

  const mockWin = {
    document: doc,
    addEventListener() {},
    removeEventListener() {},
  };
  const mgr = mountMcpManager({ window: mockWin, document: doc, bridge: mockBridge });
  assert.equal(mgr.version, 'v1.3.0');

  const mcpNavBtn = navGroup.querySelector('[data-testid="settings-nav-item-McpManager"]');
  assert.ok(mcpNavBtn);
  assert.equal(mcpNavBtn.children[0].textContent, 'MCP 서버');
  mcpNavBtn.click();

  const injectedPane = contentArea.querySelector('#agy-mcp-settings-pane');
  assert.ok(injectedPane);
  assert.equal(injectedPane.style.display, 'block');
  assert.equal(nativeGeneralPane.style.display, 'none');
});
