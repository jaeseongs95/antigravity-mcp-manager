'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  matchesAllowedDomain,
  isLoopbackHostname,
  validateExternalAuthUrl,
  isAllowedHttpsScriptUrl,
  resolveCdnAssetUrl,
} = require('../../src/core/security/url-policy');
const {
  FORBIDDEN_POLICY_NAMES,
  getScriptNonce,
  getOrCreateTrustedTypesPolicy,
} = require('../../src/security/trusted-types');
const { ensureModalStyles, DEFAULT_STYLE_ID } = require('../../src/ui/design-tokens-styles');
const { createSyntheticDomEnv } = require('../helpers/dom-and-rpc-fakes');

test('MCP-TC-029: matchesAllowedDomain and isAllowedHttpsScriptUrl enforce strict HTTPS and dot-subdomain boundaries', () => {
  const allowed = ['antigravity.google.com', 'gstatic.com'];

  assert.equal(matchesAllowedDomain('antigravity.google.com', allowed), true);
  assert.equal(matchesAllowedDomain('sub.antigravity.google.com', allowed), true);
  assert.equal(matchesAllowedDomain('www.gstatic.com', allowed), true);

  // Substring / suffix / prefix spoofing rejected
  assert.equal(matchesAllowedDomain('evilantigravity.google.com', allowed), false);
  assert.equal(matchesAllowedDomain('evil-antigravity.google.com', allowed), false);
  assert.equal(matchesAllowedDomain('antigravity.google.com.evil.example', allowed), false);

  const policy = {
    allowedDomains: allowed,
    extraExactUrls: ['https://cdn.trusted.example/exact/bundle.js'],
  };
  assert.equal(isAllowedHttpsScriptUrl('https://www.gstatic.com/_/boq/js/main.js', policy), true);
  assert.equal(isAllowedHttpsScriptUrl('https://cdn.trusted.example/exact/bundle.js?v=1', policy), true);
  assert.equal(isAllowedHttpsScriptUrl('http://www.gstatic.com/_/boq/js/main.js', policy), false);
  assert.equal(isAllowedHttpsScriptUrl('https://user:pw@www.gstatic.com/main.js', policy), false);
  assert.equal(isAllowedHttpsScriptUrl('https://www.gstatic.com/_/boq/%2e%2e/evil.js', policy), false);
  assert.equal(isAllowedHttpsScriptUrl('https://cdn.trusted.example/exact/other.js', policy), false);

  // Loopback & external auth URL checks
  assert.equal(isLoopbackHostname('localhost'), true);
  assert.equal(isLoopbackHostname('127.0.0.1'), true);
  assert.equal(isLoopbackHostname('127.255.0.9'), true);
  assert.equal(isLoopbackHostname('[::1]'), true);
  assert.equal(isLoopbackHostname('192.168.1.1'), false);
  assert.equal(validateExternalAuthUrl('http://user:pass@localhost:3000/cb').ok, false);
});

test('MCP-TC-040: resolveCdnAssetUrl enforces parameterized allowedPathPrefix and rejects %2e%2e, %252e%252e, and backslash escapes', () => {
  const opts = {
    cdnBaseUrl: 'https://www.gstatic.com/_/boq-chrome-jetski/web/build_20261118/out/vs/code/browser/workbench',
    hostOrigin: 'https://antigravity.google.com',
    allowedPathPrefix: '/web/',
  };

  // Safe relative paths confined inside `/_/boq-chrome-jetski/web/build_20261118/`
  assert.equal(
    resolveCdnAssetUrl('./workerMain.js', opts),
    'https://www.gstatic.com/_/boq-chrome-jetski/web/build_20261118/out/vs/code/browser/workbench/workerMain.js'
  );
  assert.equal(
    resolveCdnAssetUrl('./sub/../shared/chunk.js', opts),
    'https://www.gstatic.com/_/boq-chrome-jetski/web/build_20261118/out/vs/code/browser/workbench/shared/chunk.js'
  );
  assert.equal(
    resolveCdnAssetUrl('../../../base/worker/workerMain.js', opts),
    'https://www.gstatic.com/_/boq-chrome-jetski/web/build_20261118/out/vs/base/worker/workerMain.js'
  );
  assert.equal(
    resolveCdnAssetUrl('https://antigravity.google.com/web/build_20261118/workbench.js', opts),
    'https://www.gstatic.com/_/boq-chrome-jetski/web/build_20261118/workbench.js'
  );

  // Parameterized custom prefix (`/assets-v2/`) works without hardcoded `/web/`
  assert.equal(
    resolveCdnAssetUrl('/assets-v2/r42/app.js', {
      cdnBaseUrl: 'https://cdn.example.org/prod/assets-v2/r42/core',
      hostOrigin: 'https://portal.example.org',
      allowedPathPrefix: '/assets-v2/',
    }),
    'https://cdn.example.org/prod/assets-v2/r42/app.js'
  );

  // Encoded traversal, backslash, escaping above root prefix, scheme-relative, and data/javascript URLs -> `null`
  for (const malicious of [
    '%2e%2e/secret.js',
    '%252e%252e/secret.js',
    '..\\secret.js',
    '../../../../../../../../../../evil/escape.js',
    '//evil.example.com/payload.js',
    'javascript:alert(1)',
    'data:text/javascript,alert(1)',
    'http://www.gstatic.com/_/boq-chrome-jetski/web/build_20261118/workbench.js',
  ]) {
    assert.equal(resolveCdnAssetUrl(malicious, opts), null, `Expected "${malicious}" to be rejected as null`);
  }
});

test('MCP-TC-034, 036 & 040: TrustedTypes policy is vendor-neutral, forbids default/angular, defines no createHTML, enforces one-shot tokens, negative-caches per Window, and propagates CSP nonce', () => {
  assert.equal(FORBIDDEN_POLICY_NAMES.has('default'), true);
  assert.equal(FORBIDDEN_POLICY_NAMES.has('dompurify'), true);
  assert.equal(FORBIDDEN_POLICY_NAMES.has('angular'), true);
  assert.equal(FORBIDDEN_POLICY_NAMES.has('angular#unsafe-bypass'), true);

  // 1. Forbidden policy names are skipped; `createHTML` is undefined; one-shot tokens revoke on first use
  const attemptedNames = [];
  let capturedSpec = null;
  const mockWin = {
    trustedTypes: {
      createPolicy(name, spec) {
        attemptedNames.push(name);
        capturedSpec = spec;
        return {
          name,
          createScript: (s) => ({ __trustedScript: spec.createScript(s) }),
          createScriptURL: (u) => ({ __trustedScriptURL: spec.createScriptURL(u) }),
        };
      },
    },
  };

  const ctrl = getOrCreateTrustedTypesPolicy(mockWin, {
    policyNames: ['default', 'angular', () => 'custom-scoped-policy'],
    isAllowedScriptUrl: (u) => u.startsWith('https://cdn.example.com/'),
  });

  assert.deepEqual(attemptedNames, ['custom-scoped-policy']);
  assert.equal(ctrl.hasNativePolicy, true);
  assert.equal(ctrl.policyName, 'custom-scoped-policy');
  assert.equal(capturedSpec.createHTML, undefined, 'createHTML must NEVER be defined');

  // Direct call to underlying spec without capability token must throw TypeError
  assert.throws(() => capturedSpec.createScript('alert(1)'), TypeError);
  assert.throws(() => capturedSpec.createScriptURL('blob:https://app.example.com/123'), TypeError);

  // One-shot inline script token succeeds once and throws TypeError on replay or payload mismatch
  const scriptTok = ctrl.issueScriptToken('console.log(1);');
  const trustedScript = ctrl.toScript('console.log(1);', scriptTok);
  assert.deepEqual(trustedScript, { __trustedScript: 'console.log(1);' });
  assert.throws(() => ctrl.toScript('console.log(1);', scriptTok), TypeError);

  const mismatchTok = ctrl.issueScriptToken('const a = 1;');
  assert.throws(() => ctrl.toScript('const a = 2;', mismatchTok), TypeError);

  // One-shot blob URL token enforces same-origin and revokes on first consumption
  assert.throws(
    () => ctrl.issueBlobUrlToken('blob:https://evil.example.com/uuid', 'https://app.example.com'),
    TypeError
  );
  const blobUrl = 'blob:https://app.example.com/uuid-1';
  const blobTok = ctrl.issueBlobUrlToken(blobUrl, 'https://app.example.com');
  assert.deepEqual(ctrl.toScriptURL(blobUrl, blobTok), { __trustedScriptURL: blobUrl });
  assert.throws(() => ctrl.toScriptURL(blobUrl, blobTok), TypeError);

  // Allowed vs untrusted external script URLs
  assert.deepEqual(ctrl.toScriptURL('https://cdn.example.com/worker.js'), {
    __trustedScriptURL: 'https://cdn.example.com/worker.js',
  });
  assert.throws(() => ctrl.toScriptURL('https://evil.example.com/worker.js'), TypeError);

  // 2. Negative WeakMap cache when CSP denies all candidate policy names
  let denyCalls = 0;
  const deniedWin = {
    trustedTypes: {
      createPolicy() {
        denyCalls += 1;
        throw new TypeError('Refused to create a TrustedTypePolicy');
      },
    },
  };
  const d1 = getOrCreateTrustedTypesPolicy(deniedWin, {
    policyNames: ['p1', 'p2'],
    isAllowedScriptUrl: () => true,
  });
  const d2 = getOrCreateTrustedTypesPolicy(deniedWin, {
    policyNames: ['p1', 'p2'],
    isAllowedScriptUrl: () => true,
  });
  assert.equal(d1.hasNativePolicy, false);
  assert.equal(d1, d2);
  assert.equal(denyCalls, 2, 'Denied Window must be cached in WeakMap and never re-probed');

  // 3. CSP nonce discovery and propagation onto `<style id="agy-mcp-manager-styles">`
  const { doc } = createSyntheticDomEnv();
  const hostScript = doc.createElement('script');
  hostScript.setAttribute('nonce', 'CSP_NONCE_AbCdEf123456==');
  doc.head.appendChild(hostScript);

  assert.equal(getScriptNonce(doc), 'CSP_NONCE_AbCdEf123456==');
  ensureModalStyles(doc, DEFAULT_STYLE_ID);
  const styleEl = doc.getElementById(DEFAULT_STYLE_ID);
  assert.ok(styleEl);
  assert.equal(styleEl.getAttribute('nonce'), 'CSP_NONCE_AbCdEf123456==');
});
