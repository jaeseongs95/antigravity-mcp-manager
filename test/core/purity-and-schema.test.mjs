import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { sha256Hex } from '../../src/core/sha256.mjs';
import { validateServerName, validateServerSpec } from '../../src/core/validator.mjs';
import { REDACTED_MASK, redactErrorMessage, redactServerSpec, redactUrl } from '../../src/core/secret-redactor.mjs';
import { parseDeclarativeInput } from '../../src/core/input-parser.mjs';
import { detectCollisions } from '../../src/core/collision-detector.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_DIR = path.resolve(__dirname, '../../src/core');

test('NMCP-TC-001: src/core/** is 100% vendor-independent and free of Node/DOM/Sidecar/host imports', () => {
  const files = fs.readdirSync(CORE_DIR).filter((f) => f.endsWith('.mjs')).sort();
  assert.equal(files.length, 9);

  const bannedImportRe = /from\s+['"](?:node:|sidecar_sdk|electron)/i;
  const bannedVendorRe = /\b(?:antigravity|sidecar_sdk|electron|__reactFiber|__ngContext__|child_process)\b/i;
  const bannedDomGlobalRe = /(?<![./-])\b(?:window|document)\b(?!-)/;

  for (const file of files) {
    const src = fs.readFileSync(path.join(CORE_DIR, file), 'utf8');
    // Strip block & line comments for pure code inspection
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.equal(bannedImportRe.test(codeOnly), false, `Banned runtime import in src/core/${file}`);
    assert.equal(bannedVendorRe.test(codeOnly), false, `Banned vendor/host identifier in src/core/${file}`);
    assert.equal(bannedDomGlobalRe.test(codeOnly), false, `Banned DOM global in src/core/${file}`);
  }
});

test('NMCP-TC-002: sha256Hex matches Node crypto FIPS 180-4 across ASCII, Korean UTF-8, and emoji surrogate pairs', () => {
  const samples = ['', 'abc', '한글 MCP 설정 🚀\n{"mcpServers":{}}'];
  for (const s of samples) {
    const expected = crypto.createHash('sha256').update(s, 'utf8').digest('hex');
    assert.equal(sha256Hex(s), expected);
  }
});

test('NMCP-TC-003: validator enforces Stdio & Streamable HTTP invariants, blocks dangerous env, prototype keys, and cleartext HTTP auth', () => {
  assert.equal(validateServerName('my-mcp_1.0').ok, true);
  assert.equal(validateServerName('__proto__').ok, false);
  assert.equal(validateServerName('constructor').ok, false);
  assert.equal(validateServerName('  bad  ').ok, false);

  // Dual transport rejected
  const dual = validateServerSpec({ command: 'node', url: 'https://mcp.example.com/mcp' });
  assert.equal(dual.ok, false);

  // Dangerous env key hard-blocked
  const badEnv = validateServerSpec({ command: 'node', args: ['srv.js'], env: { NODE_OPTIONS: '--require evil.js' } });
  assert.equal(badEnv.ok, false);

  // PATH triggers warning + requiresStdioConfirmation
  const pathEnv = validateServerSpec({ command: 'node', args: ['srv.js'], env: { PATH: '/usr/bin' } });
  assert.equal(pathEnv.ok, true);
  assert.equal(pathEnv.requiresStdioConfirmation, true);
  assert.ok(pathEnv.warnings.length >= 1);

  // Cleartext http:// with Authorization header on non-loopback blocked
  const badHttp = validateServerSpec({
    url: 'http://api.example.com/mcp',
    headers: { Authorization: 'Bearer secret123' },
  });
  assert.equal(badHttp.ok, false);

  // Loopback http:// with Authorization allowed
  const loopbackHttp = validateServerSpec({
    url: 'http://127.0.0.1:8080/mcp',
    headers: { Authorization: 'Bearer local-dev' },
  });
  assert.equal(loopbackHttp.ok, true);

  // Embedded credentials in URL blocked
  const embeddedCred = validateServerSpec({ url: 'https://user:pass@mcp.example.com/mcp' });
  assert.equal(embeddedCred.ok, false);

  // Case-insensitive duplicate headers rejected
  const dupHeader = validateServerSpec({
    url: 'https://mcp.example.com/mcp',
    headers: { Authorization: 'Bearer a', authorization: 'Bearer b' },
  });
  assert.equal(dupHeader.ok, false);
});

test('NMCP-TC-004: secret-redactor masks env, headers, URL credentials, and error tokens', () => {
  const redacted = redactServerSpec({
    url: 'https://user:secret@mcp.example.com/mcp?api_key=abc123&mode=read',
    headers: { Authorization: 'Bearer top-secret' },
    env: { DB_PASS: 'hunter2', EMPTY: '' },
  });
  assert.equal(redacted.headers.Authorization, REDACTED_MASK);
  assert.equal(redacted.env.DB_PASS, REDACTED_MASK);
  assert.equal(redacted.env.EMPTY, '');
  assert.equal(redacted.url.includes('secret'), false);
  assert.equal(redacted.url.includes('abc123'), false);
  assert.equal(redactUrl('https://mcp.example.com/mcp?token=xyz').includes('xyz'), false);
  assert.equal(redactErrorMessage('Failed with Bearer sk-live-9999').includes('sk-live-9999'), false);
});

test('NMCP-TC-005: declarative Smart Paste parses JSON/URL, normalizes serverUrl, warns on legacy /sse, and rejects raw shell strings', () => {
  // Raw shell string rejected
  const shellRes = parseDeclarativeInput('npx -y @modelcontextprotocol/server-memory');
  assert.equal(shellRes.ok, false);
  assert.equal(shellRes.sourceKind, 'rejected_shell');

  // Streamable HTTP URL
  const urlRes = parseDeclarativeInput('https://mcp.example.com/mcp');
  assert.equal(urlRes.ok, true);
  assert.equal(urlRes.entries.length, 1);
  assert.equal(urlRes.entries[0].spec.url, 'https://mcp.example.com/mcp');
  assert.equal(urlRes.entries[0].legacySseDetected, false);

  // Legacy SSE URL detected with editable mcp-remote preview
  const sseRes = parseDeclarativeInput('https://legacy.example.com/sse');
  assert.equal(sseRes.ok, true);
  assert.equal(sseRes.entries[0].legacySseDetected, true);
  assert.deepEqual(sseRes.entries[0].mcpRemotePreview, {
    command: 'npx',
    args: ['-y', 'mcp-remote', 'https://legacy.example.com/sse'],
  });

  // serverUrl normalized to url in mcpServers map
  const jsonRes = parseDeclarativeInput(JSON.stringify({
    mcpServers: {
      docs: { serverUrl: 'https://docs.example.com/mcp' },
    },
  }));
  assert.equal(jsonRes.ok, true);
  assert.equal(jsonRes.entries[0].name, 'docs');
  assert.equal(jsonRes.entries[0].spec.url, 'https://docs.example.com/mcp');
  assert.equal(jsonRes.entries[0].spec.serverUrl, undefined);
});

test('NMCP-TC-006: collision-detector flags case-insensitive global duplicates and global-vs-plugin collisions', () => {
  const res = detectCollisions(
    ['GitHub', 'github', 'linear'],
    [{ name: 'Linear', pluginName: 'Linear Official', pluginDir: 'linear' }]
  );
  assert.equal(res.globalCaseDuplicates.length, 1);
  assert.equal(res.pluginCollisions.length, 1);
  assert.equal(res.pluginCollisions[0].globalName, 'linear');
  assert.equal(res.pluginCollisions[0].pluginDir, 'linear');
});
