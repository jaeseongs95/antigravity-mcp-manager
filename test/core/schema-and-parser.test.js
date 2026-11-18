'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  stripJsoncToValidJson,
  parseJsonc,
  applyJsoncServerMutations,
} = require('../../src/core/schema/jsonc-codec');
const {
  encodeBase64,
  decodeBase64,
  mergeHeadersCaseInsensitive,
  redactSensitiveUrl,
  redactSensitiveText,
} = require('../../src/core/schema/auth-codec');
const {
  DANGEROUS_ENV_KEYS,
  extractAndValidateTransport,
  assertServerSpecSecurity,
  validateAndBuildServerSpec,
  normalizeMcpConfigObject,
} = require('../../src/core/schema/server-spec');
const {
  hasUnquotedShellChaining,
  parseSmartMcpInput,
} = require('../../src/core/schema/smart-parser');

test('MCP-TC-005 & 006: jsonc-codec preserves comments, handles UTF-16 surrogate pairs, and inserts commas before inline trailing comments', () => {
  const original = [
    '{',
    '  // Top-level comment with emoji 🚀 and URL https://not-a-comment.example.com',
    '  "mcpServers": {',
    '    "existing": {',
    '      "url": "https://mcp.example.com/sse", // inline trailing comment!',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');

  const parsed = parseJsonc(original);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.mcpServers.existing.url, 'https://mcp.example.com/sse');

  // Adding a second server must insert comma BEFORE `// inline trailing comment!` rather than inside the comment
  const mutated = applyJsoncServerMutations(original, [
    {
      op: 'set',
      name: 'added-server',
      spec: { url: 'https://second.example.com/mcp' },
    },
  ]);

  assert.equal(mutated.includes('// Top-level comment with emoji 🚀'), true);
  assert.equal(mutated.includes('// inline trailing comment!'), true);

  const reparsed = parseJsonc(mutated);
  assert.equal(reparsed.ok, true, `Mutated JSONC must remain valid: ${reparsed.error || ''}`);
  assert.equal(reparsed.value.mcpServers.existing.url, 'https://mcp.example.com/sse');
  assert.equal(reparsed.value.mcpServers['added-server'].url, 'https://second.example.com/mcp');

  // Stripping pure JSONC preserves UTF-16 string contents containing `/*` and `//`
  const stripped = stripJsoncToValidJson('{"a":"http://x/*not-comment*/","b":1,}');
  assert.deepEqual(JSON.parse(stripped), { a: 'http://x/*not-comment*/', b: 1 });
});

test('MCP-TC-007 & 008: auth-codec RFC 4648 UTF-8 Base64, case-insensitive header deduplication, and credential redaction', () => {
  const sample = 'user:비번🚀123!';
  const b64 = encodeBase64(sample);
  assert.equal(b64, Buffer.from(sample, 'utf8').toString('base64'));
  assert.equal(decodeBase64(b64), sample);

  // Case-insensitive header merge (5095348c-F4): `authorization` is replaced cleanly by `Authorization`
  const merged = mergeHeadersCaseInsensitive(
    { authorization: 'Bearer old-secret', 'x-custom': '1' },
    { Authorization: 'Bearer new-secret', 'X-Custom': '2' }
  );
  assert.deepEqual(Object.keys(merged), ['Authorization', 'X-Custom']);
  assert.equal(merged.Authorization, 'Bearer new-secret');
  assert.equal(merged['X-Custom'], '2');

  // Sensitive URL & text redaction
  const redactedUrl = redactSensitiveUrl('https://admin:supersecret@mcp.example.com/api?api_key=tok_999&safe=1');
  assert.equal(redactedUrl.includes('supersecret'), false);
  assert.equal(redactedUrl.includes('tok_999'), false);
  assert.equal(redactedUrl.includes('safe=1'), true);

  const redactedMsg = redactSensitiveText('Header Authorization: Bearer ghp_1234567890abcdef failed');
  assert.equal(redactedMsg.includes('ghp_1234567890abcdef'), false);
});

test('MCP-TC-009 & 010: extractAndValidateTransport blocks Split-URL, dual command+url, empty serverUrl, and non-string fields', () => {
  // Split-URL (`url` !== `serverUrl`)
  const splitRes = extractAndValidateTransport({
    url: 'https://safe.example.com/mcp',
    serverUrl: 'http://attacker.example.com/steal',
  });
  assert.equal(splitRes.ok, false);
  assert.equal(splitRes.code, 'CONFLICTING_SERVER_URLS');

  // Dual transport (`command` + `url`)
  const dualRes = extractAndValidateTransport({
    command: 'npx',
    args: ['-y', 'pkg'],
    url: 'https://safe.example.com/mcp',
  });
  assert.equal(dualRes.ok, false);
  assert.equal(dualRes.code, 'AMBIGUOUS_TRANSPORT_SPEC');

  // Empty `serverUrl: ""`
  const emptyRes = extractAndValidateTransport({ serverUrl: '   ' });
  assert.equal(emptyRes.ok, false);
  assert.equal(emptyRes.code, 'MISSING_TRANSPORT_SPEC');

  // Non-string `url` or `command`
  const badType = extractAndValidateTransport({ url: ['https://evil.example.com'] });
  assert.equal(badType.ok, false);
  assert.equal(badType.code, 'INVALID_SERVER_SPEC');
});

test('MCP-TC-011 & 012: 19 DANGEROUS_ENV_KEYS hard-blocked, PATH requires explicit confirmation, and cleartext HTTP credentials blocked', () => {
  assert.equal(DANGEROUS_ENV_KEYS.size, 19);

  for (const key of ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'BASH_ENV']) {
    const res = assertServerSpecSecurity({
      command: 'node',
      args: ['server.js'],
      env: { [key]: 'malicious' },
    });
    assert.equal(res.ok, false, `Expected ${key} to be blocked`);
    assert.equal(res.code, 'DANGEROUS_ENV_BLOCKED');
  }

  // apiKeyHeader synthesized into env key in stdio form must ALSO be caught post-merge (`Rev 6 §5.2 #2.1`)
  const postMergeHijack = validateAndBuildServerSpec({
    serverName: 'stdio-hijack',
    transport: 'stdio',
    command: 'node',
    args: ['srv.js'],
    authMode: 'apiKey',
    apiKeyHeader: 'NODE-OPTIONS',
    apiKeyValue: '--require=/tmp/evil.js',
  });
  assert.equal(postMergeHijack.ok, false);
  assert.equal(postMergeHijack.code, 'DANGEROUS_ENV_BLOCKED');

  // PATH override requires explicit confirmation
  const pathUnconfirmed = assertServerSpecSecurity({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: { PATH: '/custom/bin:/usr/bin' },
  });
  assert.equal(pathUnconfirmed.ok, false);
  assert.equal(pathUnconfirmed.code, 'PATH_OVERRIDE_CONFIRM_REQUIRED');
  assert.equal(pathUnconfirmed.requiresConfirmation, true);

  const pathConfirmed = assertServerSpecSecurity(
    {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: { PATH: '/custom/bin:/usr/bin' },
    },
    { confirmPathOverride: true }
  );
  assert.equal(pathConfirmed.ok, true);

  // Non-loopback plaintext HTTP with credentials -> hard blocked even when allowInsecureHttp=true
  const httpCredBlocked = assertServerSpecSecurity(
    {
      url: 'http://remote.example.com/mcp',
      headers: { Authorization: 'Bearer secret-tok' },
    },
    { allowInsecureHttp: true }
  );
  assert.equal(httpCredBlocked.ok, false);
  assert.equal(httpCredBlocked.code, 'INSECURE_HTTP_CREDENTIALS_BLOCKED');

  // Loopback HTTP with credentials -> allowed
  const loopbackOk = assertServerSpecSecurity({
    url: 'http://127.0.0.1:8787/mcp',
    headers: { Authorization: 'Bearer local-dev-tok' },
  });
  assert.equal(loopbackOk.ok, true);
});

test('MCP-TC-013 & 014: smart-parser enforces raw pre-check (Rev 6 F3), post-merge HTTP credential gate, multipleServers gate, and zero curl shell exemption', () => {
  // 1. Raw JSON snippet Split-URL pre-check before `obj.url || obj.serverUrl` projection (`Rev 6 F3`)
  const splitJson = parseSmartMcpInput(
    JSON.stringify({
      url: 'https://good.example.com/mcp',
      serverUrl: 'http://evil.example.com/mcp',
    })
  );
  assert.equal(splitJson.ok, false);
  assert.equal(splitJson.code, 'CONFLICTING_SERVER_URLS');

  // 2. Raw JSON snippet dual `command` + `url`
  const dualJson = parseSmartMcpInput(
    JSON.stringify({
      command: 'npx',
      url: 'https://good.example.com/mcp',
    })
  );
  assert.equal(dualJson.ok, false);
  assert.equal(dualJson.code, 'AMBIGUOUS_TRANSPORT_SPEC');

  // 3. Raw JSON snippet `{ "serverUrl": "" }`
  const emptyUrlJson = parseSmartMcpInput('{"serverUrl":""}');
  assert.equal(emptyUrlJson.ok, false);
  assert.equal(emptyUrlJson.code, 'MISSING_TRANSPORT_SPEC');

  // 4. `http://remote.example.com/mcp` + `quickAuthToken` -> `INSECURE_HTTP_CREDENTIALS_BLOCKED`
  const httpQuickAuth = parseSmartMcpInput('http://remote.example.com/mcp', 'sk-live-secret', {
    allowInsecureHttp: true,
  });
  assert.equal(httpQuickAuth.ok, false);
  assert.equal(httpQuickAuth.code, 'INSECURE_HTTP_CREDENTIALS_BLOCKED');

  // 5. `multipleServers` snippet carrying insecure HTTP + `quickAuthToken` -> blocked post-merge
  const multiInsecure = parseSmartMcpInput(
    JSON.stringify({
      mcpServers: {
        s1: { url: 'https://safe.example.com/mcp' },
        s2: { url: 'http://plaintext.example.com/mcp' },
      },
    }),
    'Bearer my-secret-token',
    { allowInsecureHttp: true }
  );
  assert.equal(multiInsecure.ok, false);
  assert.equal(multiInsecure.code, 'INSECURE_HTTP_CREDENTIALS_BLOCKED');

  // 6. Zero `curl` exemption for shell metacharacters (`;`, `|`, `&&`, `` ` ``, `$()`)
  assert.equal(hasUnquotedShellChaining('curl https://mcp.example.com/sse; calc.exe'), true);
  for (const payload of [
    'curl -H "Authorization: Bearer tok" https://mcp.example.com/sse | sh',
    'curl https://mcp.example.com/sse && whoami',
    'npx -y @modelcontextprotocol/server-memory $(id)',
    'uvx mcp-server-git `id`',
  ]) {
    const res = parseSmartMcpInput(payload);
    assert.equal(res.ok, false, `Expected shell chaining payload to be blocked: ${payload}`);
    assert.equal(res.code, 'SHELL_METACHAR_BLOCKED');
  }

  // 7. All stdio inputs (including `npx`/`uvx` package names and GitHub URLs) set `requiresConfirmation: true` (`MCP-TC-046`)
  const ghStdio = parseSmartMcpInput('https://github.com/modelcontextprotocol/servers/tree/main/src/memory');
  assert.equal(ghStdio.ok, true);
  assert.equal(ghStdio.spec.command, 'npx');
  assert.equal(ghStdio.requiresConfirmation, true);

  const uvxStdio = parseSmartMcpInput('mcp-server-git');
  assert.equal(uvxStdio.ok, true);
  assert.equal(uvxStdio.spec.command, 'uvx');
  assert.equal(uvxStdio.requiresConfirmation, true);

  // 8. `normalizeMcpConfigObject` with `enforceSecurity: true` blocks dangerous env inside raw config
  const rawBad = normalizeMcpConfigObject(
    JSON.stringify({
      mcpServers: {
        bad: { command: 'node', args: ['a.js'], env: { LD_PRELOAD: '/tmp/x.so' } },
      },
    }),
    { enforceSecurity: true }
  );
  assert.equal(rawBad.ok, false);
  assert.equal(rawBad.code, 'DANGEROUS_ENV_BLOCKED');
});
