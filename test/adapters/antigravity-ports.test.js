'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sha256Hex } = require('../../src/core/sha256');
const { encodeBase64 } = require('../../src/core/schema/auth-codec');
const {
  isMissingFileError,
  decodeReadFileResponseToText,
  createAntigravityPortsAdapter,
} = require('../../src/adapters/antigravity/antigravity-ports-adapter');
const { createSyntheticDomEnv } = require('../helpers/dom-and-rpc-fakes');

function createPortsHarness(rpcHandler, overrides = {}) {
  const { win, doc } = createSyntheticDomEnv();
  const calls = [];
  const rpcTransport = {
    isAvailable: () => overrides.available !== false,
    async callMethod(method, payload, opts) {
      calls.push({ method, payload, opts });
      return rpcHandler(method, payload, opts, calls.length);
    },
  };
  const revealedUris = [];
  const fiberGateway = {
    getConfigDir: () => overrides.configDir || '/home/tester/.gemini',
    getLanguageServerService: () => overrides.directLs || null,
    getElectronNativeFeature: () =>
      overrides.electronFeature !== undefined
        ? overrides.electronFeature
        : {
            async revealInFilePicker(uri) {
              revealedUris.push(uri);
            },
          },
  };
  const remoteLease = {
    getInstance: () => null,
  };
  const adapter = createAntigravityPortsAdapter({
    win,
    doc,
    hostConfig: overrides.hostConfig || {},
    fiberGateway,
    remoteLease,
    rpcTransport,
  });
  return { win, doc, adapter, calls, revealedUris };
}

test('MCP-TC-023: isMissingFileError strictly separates Go/Node OS ENOENT from HTTP 404, Instance not found, and network errors', () => {
  // Genuine OS / Go / Node missing-file errors -> `true`
  assert.equal(isMissingFileError({ code: 'ENOENT', message: 'ENOENT: no such file or directory' }), true);
  assert.equal(isMissingFileError({ code: 'FileNotFound', message: 'Entry not found' }), true);
  assert.equal(isMissingFileError(new Error('open /home/user/.gemini/config/mcp_config.json: no such file or directory')), true);
  assert.equal(
    isMissingFileError(new Error('open C:\\Users\\dev\\.gemini\\config\\mcp_config.json: The system cannot find the file specified.')),
    true
  );
  assert.equal(
    isMissingFileError(new Error('open C:\\Users\\dev\\.gemini\\config\\mcp_config.json: The system cannot find the path specified.')),
    true
  );

  // HTTP 404, routing errors, unimplemented, and transport failures -> `false`
  assert.equal(isMissingFileError(Object.assign(new Error('Not Found'), { status: 404 })), false);
  assert.equal(isMissingFileError(new Error('HTTP 404: 404 page not found')), false);
  assert.equal(isMissingFileError(new Error('Instance not found for session id')), false);
  assert.equal(isMissingFileError(new Error('Service not found: exa.language_server_pb.LanguageServerService')), false);
  assert.equal(isMissingFileError(new Error('Method not found: ReadFile')), false);
  assert.equal(isMissingFileError(new Error('unimplemented: unknown method')), false);
  assert.equal(isMissingFileError(new Error('Failed to fetch')), false);
  assert.equal(isMissingFileError({ code: 'SERVICE_UNAVAILABLE', message: 'Disconnected' }), false);
});

test('MCP-TC-023 & 5095348c-F4: Antigravity ConfigRepositoryPort preserves Proto3 0-byte FOUND, blocks HTTP 404 writes, enforces pre-write SHA-256 CAS, and supports revealConfigInExplorer', async () => {
  // 1. Proto3 `{}` empty response for 0-byte file -> `status: 'FOUND', exists: true, rawText: '', digest: sha256Hex('')`
  assert.equal(decodeReadFileResponseToText({}), '');
  assert.equal(
    decodeReadFileResponseToText({ content: encodeBase64('{"mcpServers":{}}'), __fromProxyCommand: true }),
    '{"mcpServers":{}}'
  );

  const zeroHarness = createPortsHarness(async (method) => {
    if (method === 'ReadFile') return {}; // Proto3 Connect-JSON 0-byte `bytes content = 1`
    return {};
  });
  const zeroRead = await zeroHarness.adapter.configRepo.readConfig();
  assert.equal(zeroRead.ok, true);
  assert.equal(zeroRead.status, 'FOUND');
  assert.equal(zeroRead.exists, true);
  assert.equal(zeroRead.rawText, '');
  assert.equal(zeroRead.digest, sha256Hex(''));

  // 2. HTTP 404 / "Instance not found" during `readConfig` or `writeConfig` pre-check -> `READ_FAILED` (NEVER `MISSING` or overwrite!)
  const http404Harness = createPortsHarness(async (method) => {
    if (method === 'ReadFile') {
      const err = new Error('Instance not found');
      err.status = 404;
      throw err;
    }
    throw new Error(`Unexpected RPC call: ${method}`);
  });
  const read404 = await http404Harness.adapter.configRepo.readConfig();
  assert.equal(read404.ok, false);
  assert.equal(read404.reason, 'READ_FAILED');

  const write404 = await http404Harness.adapter.configRepo.writeConfig({
    rawText: '{"mcpServers":{}}\n',
    expectedExists: false,
    expectedDigest: null,
  });
  assert.equal(write404.ok, false);
  assert.equal(write404.reason, 'READ_FAILED');
  assert.equal(
    http404Harness.calls.some((c) => c.method === 'WriteFile'),
    false,
    'WriteFile must NEVER be called when ReadFile pre-check fails with HTTP 404'
  );

  // 3. Pre-write SHA-256 CAS conflict detection vs clean write + `revealConfigInExplorer`
  let diskContent = '{"mcpServers":{"old":{"url":"https://old.example.com/mcp"}}}\n';
  const casHarness = createPortsHarness(async (method, payload) => {
    if (method === 'ReadFile') {
      return { content: encodeBase64(diskContent), encoding: 'base64' };
    }
    if (method === 'WriteFile') {
      diskContent = Buffer.from(payload.content, 'base64').toString('utf8');
      return {};
    }
    return {};
  });

  const conflictWrite = await casHarness.adapter.configRepo.writeConfig({
    rawText: '{"mcpServers":{}}\n',
    expectedExists: true,
    expectedDigest: sha256Hex('stale-content'),
  });
  assert.equal(conflictWrite.ok, false);
  assert.equal(conflictWrite.reason, 'CONFLICT');
  assert.equal(casHarness.calls.some((c) => c.method === 'WriteFile'), false);

  const validWrite = await casHarness.adapter.configRepo.writeConfig({
    rawText: '{"mcpServers":{"new":{"url":"https://new.example.com/mcp"}}}\n',
    expectedExists: true,
    expectedDigest: sha256Hex(diskContent),
  });
  assert.equal(validWrite.ok, true);
  assert.equal(diskContent, '{"mcpServers":{"new":{"url":"https://new.example.com/mcp"}}}\n');

  const revealRes = await casHarness.adapter.configRepo.revealConfigInExplorer();
  assert.equal(revealRes.ok, true);
  assert.equal(casHarness.revealedUris.length, 1);
  assert.equal(casHarness.revealedUris[0].endsWith('/.gemini/config/mcp_config.json'), true);
});

test('MCP-TC-001 & MCP-TC-025: OAuthBrokerPort uses 2-arg positional fallback and cancels 280ms discovery timer on dispose()', async () => {
  let statePollCount = 0;
  const harness = createPortsHarness(async (method) => {
    if (method === 'GetMcpServerStates') {
      statePollCount += 1;
      return { states: [] };
    }
    if (method === 'RefreshMcpServers') return {};
    if (method === 'CompleteMcpOAuth') return {};
    return {};
  });

  const completeRes = await harness.adapter.oauthBroker.completeAuthorization('notion-mcp', 'auth_code_777');
  assert.equal(completeRes.ok, true);
  const completeCall = harness.calls.find((c) => c.method === 'CompleteMcpOAuth');
  assert.deepEqual(completeCall.opts.positionalArgs, ['notion-mcp', 'auth_code_777']);

  // Start `discoverOAuthMetadata` (schedules 280ms poll) and immediately dispose adapter before 280ms elapses
  const pendingDiscovery = harness.adapter.oauthBroker.discoverOAuthMetadata('notion-mcp');
  await new Promise((r) => setTimeout(r, 20));
  const pollsBeforeDispose = statePollCount;
  harness.adapter.dispose();

  await new Promise((r) => setTimeout(r, 340));
  assert.equal(statePollCount, pollsBeforeDispose, '280ms OAuth timer must be cancelled immediately upon dispose()');
  void pendingDiscovery;
});
