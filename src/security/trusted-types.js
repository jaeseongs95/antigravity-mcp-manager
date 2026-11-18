'use strict';

/**
 * Browser Security Boundary — Scoped One-Shot TrustedTypes Policy & CSP Nonce Helper.
 *
 * Invariants:
 * 1. Vendor-neutral: candidate policy names and URL validator are injected by the caller.
 * 2. Shared ambient policy names ('default', 'dompurify', 'angular', 'angular#unsafe-bypass')
 *    are strictly forbidden and never created or hijacked.
 * 3. `createHTML` is NEVER defined (`undefined`) — zero TrustedHTML surface.
 * 4. Inline script and blob Worker URL creation require single-use capability tokens
 *    that are revoked immediately upon first consumption (replay throws TypeError).
 * 5. Failed policy creation per Window is negative-cached in a WeakMap so CSP violation
 *    reports are not spammed on repeated lookups.
 */

const FORBIDDEN_POLICY_NAMES = Object.freeze(
  new Set(['default', 'dompurify', 'angular', 'angular#unsafe-bypass'])
);

const VALID_NONCE_RE = /^[A-Za-z0-9+/_=-]{8,256}$/;

const policyCacheByWindow = new WeakMap();

/**
 * @param {any} win
 * @param {any} val
 * @returns {boolean}
 */
function isNativeTrustedScriptURL(win, val) {
  if (!val || typeof val !== 'object') return false;
  if (typeof val.href === 'string') return false;
  try {
    if (win && typeof win.TrustedScriptURL === 'function' && val instanceof win.TrustedScriptURL) {
      return true;
    }
  } catch {
    // Cross-realm check fallback below
  }
  try {
    return Object.prototype.toString.call(val) === '[object TrustedScriptURL]';
  } catch {
    return false;
  }
}

/**
 * @param {any} doc
 * @returns {string}
 */
function getScriptNonce(doc) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return '';
  let nodes;
  try {
    nodes = doc.querySelectorAll('script, style, link');
  } catch {
    return '';
  }
  if (!nodes) return '';
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i];
    const candidate = String(el?.nonce || el?.getAttribute?.('nonce') || '').trim();
    if (candidate && VALID_NONCE_RE.test(candidate)) {
      return candidate;
    }
  }
  return '';
}

/**
 * Creates a capability-scoped wrapper around an optional native TrustedTypePolicy.
 *
 * @param {any | null} nativePolicy
 * @param {string | null} policyName
 * @param {(url: string) => boolean} isAllowedScriptUrl
 */
function createScopedPolicyController(nativePolicy, policyName, isAllowedScriptUrl) {
  const inlineTokens = new Map();
  const blobUrlTokens = new Map();

  return Object.freeze({
    hasNativePolicy: Boolean(nativePolicy),
    policyName: policyName || null,

    /**
     * Issues a single-use capability token bound to exact `code`.
     * @param {string} code
     * @returns {symbol}
     */
    issueScriptToken(code) {
      if (typeof code !== 'string') {
        throw new TypeError('Script code must be a string');
      }
      const token = Symbol('TrustedScriptOneShotToken');
      inlineTokens.set(token, code);
      return token;
    },

    /**
     * Explicitly revokes an unconsumed script token.
     * @param {symbol} token
     */
    revokeScriptToken(token) {
      inlineTokens.delete(token);
    },

    /**
     * Consumes `token` and creates a TrustedScript (or returns `code` when TrustedTypes is absent).
     * Replaying a consumed token or omitting `token` throws TypeError.
     *
     * @param {string} code
     * @param {symbol} token
     * @returns {any}
     */
    toScript(code, token) {
      if (typeof token !== 'symbol' || !inlineTokens.has(token)) {
        throw new TypeError('TrustedScript creation requires an unconsumed one-shot token');
      }
      const expectedCode = inlineTokens.get(token);
      inlineTokens.delete(token);
      if (typeof code !== 'string' || code !== expectedCode) {
        throw new TypeError('TrustedScript token payload mismatch');
      }
      if (nativePolicy && typeof nativePolicy.createScript === 'function') {
        return nativePolicy.createScript(code);
      }
      return code;
    },

    /**
     * Issues a single-use capability token bound to an exact same-origin `blob:` URL.
     * @param {string} blobUrl
     * @param {string} [expectedOrigin]
     * @returns {symbol}
     */
    issueBlobUrlToken(blobUrl, expectedOrigin) {
      if (typeof blobUrl !== 'string' || !blobUrl.startsWith('blob:')) {
        throw new TypeError('Blob Worker URL must start with blob:');
      }
      if (expectedOrigin && !blobUrl.startsWith(`blob:${expectedOrigin}/`)) {
        throw new TypeError('Cross-origin blob Worker URL rejected');
      }
      const token = Symbol('TrustedBlobUrlOneShotToken');
      blobUrlTokens.set(token, blobUrl);
      return token;
    },

    /**
     * Explicitly revokes an unconsumed blob URL token.
     * @param {symbol} token
     */
    revokeBlobUrlToken(token) {
      blobUrlTokens.delete(token);
    },

    /**
     * Validates `url` against `isAllowedScriptUrl` (or consumes a one-shot `blob:` token)
     * and converts it via `nativePolicy.createScriptURL` when available.
     *
     * @param {string} url
     * @param {symbol} [blobToken]
     * @returns {any}
     */
    toScriptURL(url, blobToken) {
      const str = String(url ?? '').trim();
      if (!str) {
        throw new TypeError('Empty script URL rejected');
      }
      if (str.startsWith('blob:')) {
        if (typeof blobToken !== 'symbol' || !blobUrlTokens.has(blobToken)) {
          throw new TypeError('Blob TrustedScriptURL creation requires an unconsumed one-shot token');
        }
        const expectedBlob = blobUrlTokens.get(blobToken);
        blobUrlTokens.delete(blobToken);
        if (str !== expectedBlob) {
          throw new TypeError('Blob TrustedScriptURL token payload mismatch');
        }
        if (nativePolicy && typeof nativePolicy.createScriptURL === 'function') {
          return nativePolicy.createScriptURL(str);
        }
        return str;
      }

      if (!isAllowedScriptUrl(str)) {
        throw new TypeError(`Untrusted script URL rejected by policy: ${str}`);
      }
      if (nativePolicy && typeof nativePolicy.createScriptURL === 'function') {
        return nativePolicy.createScriptURL(str);
      }
      return str;
    },
  });
}

/**
 * Obtains or creates a scoped TrustedTypes controller for `win`.
 * Negative results (all candidate names rejected by CSP `trusted-types`) are cached
 * per `win` in a WeakMap to prevent repeated CSP violation spam.
 *
 * @param {any} win
 * @param {{
 *   policyNames?: Array<string | (() => string)>,
 *   isAllowedScriptUrl: (url: string) => boolean
 * }} options
 */
function getOrCreateTrustedTypesPolicy(win, options) {
  const isAllowedScriptUrl =
    options && typeof options.isAllowedScriptUrl === 'function'
      ? options.isAllowedScriptUrl
      : () => false;

  if (!win || (typeof win !== 'object' && typeof win !== 'function')) {
    return createScopedPolicyController(null, null, isAllowedScriptUrl);
  }

  const cached = policyCacheByWindow.get(win);
  if (cached) {
    return cached;
  }

  const tt = win.trustedTypes;
  if (!tt || typeof tt.createPolicy !== 'function') {
    const fallbackCtrl = createScopedPolicyController(null, null, isAllowedScriptUrl);
    policyCacheByWindow.set(win, fallbackCtrl);
    return fallbackCtrl;
  }

  const rawCandidates = Array.isArray(options?.policyNames) ? options.policyNames : [];
  let nativePolicy = null;
  let chosenName = null;

  let activeInlineAllowance = null;
  let activeBlobAllowance = null;

  const policySpec = {
    createScript(input) {
      const str = String(input ?? '');
      if (activeInlineAllowance !== null && str === activeInlineAllowance) {
        return str;
      }
      throw new TypeError('Unauthorized TrustedScript creation rejected');
    },
    createScriptURL(input) {
      const str = String(input ?? '').trim();
      if (str.startsWith('blob:')) {
        if (activeBlobAllowance !== null && str === activeBlobAllowance) {
          return str;
        }
        throw new TypeError('Unauthorized blob TrustedScriptURL creation rejected');
      }
      if (!isAllowedScriptUrl(str)) {
        throw new TypeError(`Untrusted script URL rejected: ${str}`);
      }
      return str;
    },
  };

  for (let i = 0; i < rawCandidates.length; i += 1) {
    const entry = rawCandidates[i];
    const candidateName = String(typeof entry === 'function' ? entry() : entry || '').trim();
    if (!candidateName || FORBIDDEN_POLICY_NAMES.has(candidateName.toLowerCase())) {
      continue;
    }
    try {
      const created = tt.createPolicy(candidateName, policySpec);
      if (created) {
        nativePolicy = {
          createScript(code) {
            activeInlineAllowance = code;
            try {
              return created.createScript(code);
            } finally {
              activeInlineAllowance = null;
            }
          },
          createScriptURL(url) {
            if (url.startsWith('blob:')) {
              activeBlobAllowance = url;
              try {
                return created.createScriptURL(url);
              } finally {
                activeBlobAllowance = null;
              }
            }
            return created.createScriptURL(url);
          },
        };
        chosenName = candidateName;
        break;
      }
    } catch {
      // Candidate rejected by CSP trusted-types directive; try next injected candidate
    }
  }

  const controller = createScopedPolicyController(nativePolicy, chosenName, isAllowedScriptUrl);
  policyCacheByWindow.set(win, controller);
  return controller;
}

module.exports = {
  FORBIDDEN_POLICY_NAMES,
  isNativeTrustedScriptURL,
  getScriptNonce,
  createScopedPolicyController,
  getOrCreateTrustedTypesPolicy,
};
