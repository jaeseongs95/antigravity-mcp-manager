'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sha256Hex } = require('../../src/core/sha256');
const { McpManagerService } = require('../../src/core/mcp-manager-service');
const {
  createInMemoryConfigRepo,
  createFakeMcpRuntime,
  createFakeOAuthBroker,
} = require('../helpers/dom-and-rpc-fakes');

test('MCP-TC-023 & 5095348c-F4: readMcpConfig preserves 0-byte FOUND vs MISSING vs INVALID_JSON rawTextDraft recovery', async () => {
  // 1. 0-byte `mcp_config.json` (`""`) on disk -> `status: 'FOUND', exists: true, digest: sha256Hex('')`
  const zeroByteRepo = createInMemoryConfigRepo({ exists: true, rawText: '' });
  const svcZero = new McpManagerService({ configRepo: zeroByteRepo });
  const zeroRes = await svcZero.readMcpConfig();
  assert.equal(zeroRes.ok, true);
  assert.equal(zeroRes.status, 'FOUND');
  assert.equal(zeroRes.exists, true);
  assert.equal(zeroRes.rawText, '');
  assert.equal(zeroRes.digest, sha256Hex(''));

  // Saving a server onto a 0-byte existing file uses `expectedExists: true, expectedDigest: sha256Hex('')` cleanly
  const saveOnZero = await svcZero.saveServerSpec({
    serverName: 'first-server',
    spec: { url: 'https://mcp.example.com/sse' },
  });
  assert.equal(saveOnZero.ok, true);
  assert.equal(zeroByteRepo.state.writeCalls[0].expectedExists, true);
  assert.equal(zeroByteRepo.state.writeCalls[0].expectedDigest, sha256Hex(''));

  // 2. `MISSING` (`exists: false`) -> `status: 'MISSING', exists: false, digest: null`
  const missingRepo = createInMemoryConfigRepo({ exists: false });
  const svcMissing = new McpManagerService({ configRepo: missingRepo });
  const missRes = await svcMissing.readMcpConfig();
  assert.equal(missRes.ok, true);
  assert.equal(missRes.status, 'MISSING');
  assert.equal(missRes.exists, false);
  assert.equal(missRes.digest, null);

  // 3. `INVALID_JSON` -> preserves broken on-disk `rawText` in `rawTextDraft` and `digest` for recovery (`MCP-TC-024`)
  const brokenText = '{\n  "mcpServers": {\n    "broken": { "url": \n';
  const brokenRepo = createInMemoryConfigRepo({ exists: true, rawText: brokenText });
  const svcBroken = new McpManagerService({ configRepo: brokenRepo });
  const brokenRes = await svcBroken.readMcpConfig();
  assert.equal(brokenRes.ok, false);
  assert.equal(brokenRes.code, 'INVALID_JSON');
  assert.equal(brokenRes.rawText, brokenText);
  assert.equal(svcBroken.getDraftState().rawTextDraft, brokenText);

  // Repairing via `saveRawConfig` succeeds with exact CAS digest of the broken file
  const repairedRes = await svcBroken.saveRawConfig(
    JSON.stringify({ mcpServers: { fixed: { url: 'https://mcp.example.com/ok' } } }, null, 2)
  );
  assert.equal(repairedRes.ok, true);
  assert.equal(brokenRepo.state.writeCalls[0].expectedDigest, sha256Hex(brokenText));
});

test('MCP-TC-023: CAS CONFLICT aborts write when disk changes between read and write', async () => {
  const initialJson = JSON.stringify({ mcpServers: { s1: { url: 'https://one.example.com/mcp' } } }, null, 2);
  const externalJson = JSON.stringify({ mcpServers: { ext: { url: 'https://ext.example.com/mcp' } } }, null, 2);

  const repo = createInMemoryConfigRepo({
    exists: true,
    rawText: initialJson,
    onBeforeWrite(_req, repoState, callNum) {
      if (callNum === 1) {
        repoState.rawText = externalJson;
      }
    },
  });
  const svc = new McpManagerService({ configRepo: repo });
  const res = await svc.saveServerSpec({
    serverName: 's2',
    spec: { url: 'https://two.example.com/mcp' },
  });

  assert.equal(res.ok, false);
  assert.equal(res.reason, 'CONFLICT');
  assert.equal(res.code, 'CONFLICT');
  assert.equal(repo.state.rawText, externalJson, 'External edit must NOT be overwritten');
});

test('MCP-TC-023: toggleServerEnabled handles RUNTIME_SYNC_FAILED, ROLLBACK_CONFLICT, and ROLLBACK_FAILED with immediate disk+runtime resync', async () => {
  const baseText = JSON.stringify(
    { mcpServers: { alpha: { url: 'https://alpha.example.com/mcp' } } },
    null,
    2
  );

  // Branch A: Runtime fails -> clean rollback (`RUNTIME_SYNC_FAILED`, `rolledBack: true`)
  {
    const repo = createInMemoryConfigRepo({ exists: true, rawText: baseText });
    const runtime = createFakeMcpRuntime([{ serverName: 'alpha', enabled: true, status: 'CONNECTED' }]);
    runtime.state.toggleHandler = async () => ({ ok: false, error: 'Host daemon rejected toggle' });

    const svc = new McpManagerService({ configRepo: repo, mcpRuntime: runtime });
    const res = await svc.toggleServerEnabled('alpha', false);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'RUNTIME_SYNC_FAILED');
    assert.equal(res.rolledBack, true);
    assert.equal(repo.state.rawText, baseText, 'Disk config rolled back to original text');
    assert.equal(svc.getState().config.mcpServers.alpha.disabled, undefined);
  }

  // Branch B: Runtime fails + external edit occurs before rollback (`ROLLBACK_CONFLICT`, `rolledBack: false`) + resyncs external state
  {
    const thirdPartyText = JSON.stringify(
      { mcpServers: { alpha: { url: 'https://alpha.example.com/mcp', disabled: true }, beta: { url: 'https://beta.example.com/mcp' } } },
      null,
      2
    );
    const repo = createInMemoryConfigRepo({
      exists: true,
      rawText: baseText,
      onBeforeWrite(_req, repoState, callNum) {
        if (callNum === 2) {
          repoState.rawText = thirdPartyText;
        }
      },
    });
    const runtime = createFakeMcpRuntime([{ serverName: 'alpha', enabled: true }]);
    runtime.state.toggleHandler = async () => ({ ok: false, error: 'Toggle RPC timeout' });

    const svc = new McpManagerService({ configRepo: repo, mcpRuntime: runtime });
    const res = await svc.toggleServerEnabled('alpha', false);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'ROLLBACK_CONFLICT');
    assert.equal(res.rolledBack, false);
    assert.equal(Boolean(svc.getState().config.mcpServers.beta), true, 'Immediate resync loaded external beta server');
  }

  // Branch C: Runtime fails + rollback write throws I/O error (`ROLLBACK_FAILED`, `rolledBack: false`) + resyncs
  {
    const repo = createInMemoryConfigRepo({
      exists: true,
      rawText: baseText,
      onBeforeWrite(_req, repoState, callNum) {
        if (callNum === 2) {
          repoState.writeError = { reason: 'WRITE_FAILED', error: 'Disk full during rollback' };
        }
      },
    });
    const runtime = createFakeMcpRuntime([{ serverName: 'alpha', enabled: true }]);
    runtime.state.toggleHandler = async () => ({ ok: false, error: 'Toggle failed' });

    const svc = new McpManagerService({ configRepo: repo, mcpRuntime: runtime });
    const res = await svc.toggleServerEnabled('alpha', false);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'ROLLBACK_FAILED');
    assert.equal(res.rolledBack, false);
    assert.equal(svc.getState().config.mcpServers.alpha.disabled, true, 'Resynced actual persisted state on disk');
  }
});

test('MCP-TC-023 & Rev 6 F5: applyAuthToAllHttp commits in a single mutex + single writeConfig CAS call, skipping non-loopback http:// and deduplicating headers', async () => {
  const initialConfig = [
    '{',
    '  // Preserve user comment',
    '  "mcpServers": {',
    '    "https-sibling": {',
    '      "url": "https://sib1.example.com/mcp",',
    '      "headers": { "authorization": "Bearer stale-token" }',
    '    },',
    '    "loopback-sibling": {',
    '      "url": "http://127.0.0.1:8123/mcp"',
    '    },',
    '    "cleartext-remote": {',
    '      "url": "http://insecure.example.com/mcp"',
    '    },',
    '    "stdio-sibling": {',
    '      "command": "npx",',
    '      "args": ["-y", "@modelcontextprotocol/server-memory"]',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');

  const repo = createInMemoryConfigRepo({ exists: true, rawText: initialConfig });
  const runtime = createFakeMcpRuntime();
  const svc = new McpManagerService({ configRepo: repo, mcpRuntime: runtime });

  const saveRes = await svc.saveServerSpec({
    serverName: 'primary-https',
    spec: {
      url: 'https://primary.example.com/mcp',
      headers: { Authorization: 'Bearer unified-secret' },
    },
    applyAuthToAllHttp: true,
    sharedAuthHeaders: { Authorization: 'Bearer unified-secret' },
  });

  assert.equal(saveRes.ok, true);
  assert.equal(repo.state.writeCalls.length, 1, 'Must commit primary + all eligible siblings in ONE writeConfig CAS call');
  assert.equal(runtime.state.refreshCalls.length, 1, 'Must call refreshServers ONCE');
  assert.deepEqual(saveRes.updatedSiblingServers.sort(), ['https-sibling', 'loopback-sibling']);
  assert.deepEqual(saveRes.skippedInsecureHttpServers, ['cleartext-remote']);
  assert.equal(repo.state.rawText.includes('// Preserve user comment'), true);

  const reread = await svc.readMcpConfig();
  assert.equal(reread.ok, true);
  // Lowercase `authorization` was deduplicated to single `Authorization` (`5095348c-F4`)
  assert.deepEqual(Object.keys(reread.servers['https-sibling'].headers), ['Authorization']);
  assert.equal(reread.servers['https-sibling'].headers.Authorization, 'Bearer unified-secret');
  assert.equal(reread.servers['loopback-sibling'].headers.Authorization, 'Bearer unified-secret');
  assert.equal(reread.servers['cleartext-remote'].headers, undefined, 'Non-loopback http:// must NEVER receive credentials');
});

test('MCP-TC-019 & MCP-TC-045: openAuthUrl blocks unsafe schemes/credentials in core and clearSensitiveDrafts scrubs all draft secrets', async () => {
  const oauthBroker = createFakeOAuthBroker();
  const svc = new McpManagerService({ oauthBroker });

  for (const badUrl of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'http://remote-oauth.example.com/authorize',
    'https://user:secret@auth.example.com/authorize',
    'http://admin:pw@127.0.0.1:8080/callback',
  ]) {
    const res = await svc.openAuthUrl(badUrl);
    assert.equal(res.ok, false, `Expected ${badUrl} to be blocked in core before OAuthBrokerPort`);
  }
  assert.equal(oauthBroker.state.openUrlCalls.length, 0, 'OAuthBrokerPort must NEVER be called for unsafe URLs');

  // Valid HTTPS & credential-free loopback HTTP succeed
  const okHttps = await svc.openAuthUrl('https://accounts.example.com/o/oauth2/v2/auth?client_id=abc');
  assert.equal(okHttps.ok, true);
  const okLoopback = await svc.openAuthUrl('http://127.0.0.1:54321/oauth/authorize');
  assert.equal(okLoopback.ok, true);
  assert.equal(oauthBroker.state.openUrlCalls.length, 2);

  // Draft scrubbing
  svc.updateDraftState({
    quickAddInput: 'https://secret.example.com/mcp',
    quickAddAuthToken: 'Bearer top-secret',
    pendingCommandConfirmation: { entries: [{ serverName: 'x', spec: { command: 'npx' } }] },
    rawTextDraft: '{"secret":true}',
    oauthCodeDraft: 'code_12345',
    editorFormDraft: {
      ...svc.getDraftState().editorFormDraft,
      bearerToken: 'tok_abc',
      apiKeyValue: 'key_xyz',
      basicPass: 'pw_123',
      oauthClientSecret: 'csec_999',
      headersText: 'Authorization: Bearer tok',
      envText: 'API_KEY=secret',
    },
  });

  svc.clearSensitiveDrafts();
  const d = svc.getDraftState();
  assert.equal(d.quickAddInput, '');
  assert.equal(d.quickAddAuthToken, '');
  assert.equal(d.pendingCommandConfirmation, null);
  assert.equal(d.rawTextDraft, '');
  assert.equal(d.oauthCodeDraft, '');
  assert.equal(d.editorFormDraft.bearerToken, '');
  assert.equal(d.editorFormDraft.apiKeyValue, '');
  assert.equal(d.editorFormDraft.basicPass, '');
  assert.equal(d.editorFormDraft.oauthClientSecret, '');
  assert.equal(d.editorFormDraft.headersText, '');
  assert.equal(d.editorFormDraft.envText, '');
});
