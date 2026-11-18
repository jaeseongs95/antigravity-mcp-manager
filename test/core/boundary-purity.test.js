'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { tokenizeJsSource } = require('../../scripts/lib/js-lexer');
const { DisposableStore, toDisposable } = require('../../src/core/disposable');
const { AsyncMutex } = require('../../src/core/async-mutex');
const { sha256Hex } = require('../../src/core/sha256');

const CORE_DIR = path.resolve(__dirname, '../../src/core');

function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out.sort();
}

const BANNED_HOST_GLOBALS = new Set([
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'MutationObserver',
  'HTMLElement',
  'Element',
  'Node',
  'CustomEvent',
  'MessageChannel',
  'Worker',
  'Blob',
  'trustedTypes',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'process',
  'Buffer',
  '__dirname',
  '__filename',
  'btoa',
  'atob',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
]);

const BANNED_VENDOR_REGEX =
  /antigravity|(?<![a-z])agy(?![a-z])|gstatic|githubusercontent|exafunction|jetski|__reactFiber|__ngContext__|electron/i;

// OS process-loader hijacking environment variable names mandated in `DANGEROUS_ENV_KEYS` (`MCP-TC-011`)
const ALLOWED_OS_SECURITY_ENV_LITERALS = new Set([
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  "'ELECTRON_RUN_AS_NODE'",
  '"ELECTRON_RUN_AS_NODE"',
  "'ELECTRON_NO_ASAR'",
  '"ELECTRON_NO_ASAR"',
]);

test('MCP-TC-001: src/core/** is 100% free of browser/DOM/Node/timer globals and vendor strings', () => {
  const coreFiles = collectJsFiles(CORE_DIR);
  assert.equal(coreFiles.length, 11, 'Expected all 11 core modules under src/core/');

  for (const filePath of coreFiles) {
    const rel = path.relative(CORE_DIR, filePath).replace(/\\/g, '/');
    const source = fs.readFileSync(filePath, 'utf8');
    const tokens = tokenizeJsSource(source);

    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      const prevNonWs = (() => {
        for (let j = i - 1; j >= 0; j--) {
          if (tokens[j].type !== 'whitespace' && tokens[j].type !== 'comment') return tokens[j];
        }
        return null;
      })();

      if (tk.type === 'identifier') {
        const isPropertyAccess = Boolean(
          tk.prevWasDot || (prevNonWs && (prevNonWs.value === '.' || prevNonWs.value === '?.'))
        );
        if (!isPropertyAccess && BANNED_HOST_GLOBALS.has(tk.value)) {
          assert.fail(`Banned host/runtime identifier "${tk.value}" found in src/core/${rel}`);
        }
        if (BANNED_VENDOR_REGEX.test(tk.value)) {
          assert.fail(`Banned vendor identifier "${tk.value}" found in src/core/${rel}`);
        }
      } else if (tk.type === 'string' || tk.type === 'template') {
        if (!ALLOWED_OS_SECURITY_ENV_LITERALS.has(tk.value) && BANNED_VENDOR_REGEX.test(tk.value)) {
          assert.fail(`Banned vendor string literal ${tk.value} found in src/core/${rel}`);
        }
      }

      // Check require('node:...') or Node built-in modules
      if (
        tk.type === 'identifier' &&
        tk.value === 'require' &&
        tokens[i + 1]?.value === '(' &&
        tokens[i + 2]?.type === 'string'
      ) {
        const rawSpec = tokens[i + 2].value;
        const spec = /^['"]/.test(rawSpec) ? rawSpec.slice(1, -1) : rawSpec;
        assert.equal(
          spec.startsWith('.'),
          true,
          `src/core/${rel} must only require relative core modules, got "${spec}"`
        );
      }
    }
  }
});

test('MCP-TC-002: DisposableStore disposes in strict LIFO order, isolates errors, and immediately disposes late additions', () => {
  const order = [];
  const store = new DisposableStore();

  store.add(() => order.push('first'));
  store.add(
    toDisposable(() => {
      order.push('second-throws');
      throw new Error('boom during dispose');
    })
  );
  store.add({
    dispose() {
      order.push('third');
    },
  });

  assert.equal(store.isDisposed, false);
  store.dispose();
  assert.equal(store.isDisposed, true);
  assert.deepEqual(order, ['third', 'second-throws', 'first']);

  // Calling dispose() again is idempotent
  store.dispose();
  assert.deepEqual(order, ['third', 'second-throws', 'first']);

  // Late addition to an already-disposed store is disposed immediately
  let lateDisposed = false;
  store.add(() => {
    lateDisposed = true;
  });
  assert.equal(lateDisposed, true);
});

test('MCP-TC-003: AsyncMutex enforces FIFO order under Promise.all, guards lockToken, and rejects nested re-entrant deadlocks', async () => {
  const mutex = new AsyncMutex();
  const trace = [];

  const p1 = mutex.runExclusive(async (token) => {
    trace.push('start-1');
    assert.doesNotThrow(() => mutex.assertHeld(token));
    await new Promise((r) => setTimeout(r, 20));
    trace.push('end-1');
    return 'r1';
  });

  const p2 = mutex.runExclusive(async (token) => {
    trace.push('start-2');
    assert.doesNotThrow(() => mutex.assertHeld(token));
    await new Promise((r) => setTimeout(r, 5));
    trace.push('end-2');
    return 'r2';
  });

  const p3 = mutex.runExclusive(async () => {
    trace.push('start-3');
    trace.push('end-3');
    return 'r3';
  });

  const results = await Promise.all([p1, p2, p3]);
  assert.deepEqual(results, ['r1', 'r2', 'r3']);
  assert.deepEqual(trace, ['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);

  // Forged token must be rejected
  assert.throws(() => mutex.assertHeld(Symbol('forged')), /Invalid or expired AsyncMutex lock token/i);

  // Nested re-entrant acquisition passing `parentToken` must reject immediately without deadlocking
  await mutex.runExclusive(async (outerToken) => {
    await assert.rejects(
      () => mutex.runExclusive(async () => {}, { parentToken: outerToken }),
      /Re-entrant AsyncMutex deadlock/i
    );
  });
});

test('MCP-TC-004: sha256Hex matches FIPS 180-4 and multi-byte UTF-8 surrogate pair digests', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  );
  // Multi-byte Korean + UTF-16 astral surrogate pair (`🚀`)
  const nodeCrypto = require('node:crypto');
  const sample = '한글 MCP 설정 🚀\n{"mcpServers":{}}';
  const expected = nodeCrypto.createHash('sha256').update(sample, 'utf8').digest('hex');
  assert.equal(sha256Hex(sample), expected);
});
