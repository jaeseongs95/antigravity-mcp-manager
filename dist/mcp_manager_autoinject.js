// ==UserScript==
// @name         Antigravity Custom MCP Server Manager
// @namespace    https://github.com/jaeseongs95/antigravity-mcp-manager
// @version      2.0.0
// @description  Add, edit, toggle, and manage custom Stdio & HTTP MCP servers (mcp_config.json) directly inside the Antigravity 2.0 native app and Remote Control web.
// @match        https://antigravity.google.com/*
// @match        https://*.antigravity.google.com/*
// @match        https://127.0.0.1/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(() => {
  'use strict';
  const __modules = {
  "./core/disposable": function(module, exports, __require) {
    const require = (spec) => __require("./core", spec);
    'use strict';
    function toDisposable(target) {
      let disposed = false;
      return {
        get isDisposed() {
          return disposed;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          if (!target) return;
          if (typeof target === 'function') {
            target();
          } else if (typeof target.dispose === 'function') {
            target.dispose();
          }
        },
      };
    }
    class DisposableStore {
      constructor() {
        this._items = [];
        this._disposed = false;
      }
      get isDisposed() {
        return this._disposed;
      }
      get size() {
        return this._items.length;
      }
      add(item) {
        if (item === null || item === undefined) {
          return item;
        }
        const wrapped = toDisposable(item);
        if (this._disposed) {
          try {
            wrapped.dispose();
          } catch {
          }
          return item;
        }
        this._items.push(wrapped);
        return item;
      }
      dispose() {
        if (this._disposed) return;
        this._disposed = true;
        const snapshot = this._items.splice(0, this._items.length);
        for (let i = snapshot.length - 1; i >= 0; i--) {
          try {
            snapshot[i].dispose();
          } catch {
          }
        }
      }
    }
    module.exports = {
      toDisposable,
      DisposableStore,
    };
  },
  "./core/sha256": function(module, exports, __require) {
    const require = (spec) => __require("./core", spec);
    'use strict';
    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    function encodeUtf8Bytes(input) {
      if (input instanceof Uint8Array) return input;
      const str = typeof input === 'string' ? input : String(input ?? '');
      if (typeof TextEncoder === 'function') {
        return new TextEncoder().encode(str);
      }
      const out = [];
      for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
          const next = str.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
            i += 1;
          }
        }
        if (code < 0x80) {
          out.push(code);
        } else if (code < 0x800) {
          out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
          out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else {
          out.push(
            0xf0 | (code >> 18),
            0x80 | ((code >> 12) & 0x3f),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f)
          );
        }
      }
      return new Uint8Array(out);
    }
    function rotr(x, n) {
      return (x >>> n) | (x << (32 - n));
    }
    function sha256Hex(input) {
      const bytes = encodeUtf8Bytes(input);
      const bitLenHi = Math.floor(bytes.length / 0x20000000);
      const bitLenLo = (bytes.length << 3) >>> 0;
      const paddedLen = (((bytes.length + 9 + 63) >> 6) << 6);
      const padded = new Uint8Array(paddedLen);
      padded.set(bytes);
      padded[bytes.length] = 0x80;
      const view = new DataView(padded.buffer);
      view.setUint32(paddedLen - 8, bitLenHi, false);
      view.setUint32(paddedLen - 4, bitLenLo, false);
      let h0 = 0x6a09e667;
      let h1 = 0xbb67ae85;
      let h2 = 0x3c6ef372;
      let h3 = 0xa54ff53a;
      let h4 = 0x510e527f;
      let h5 = 0x9b05688c;
      let h6 = 0x1f83d9ab;
      let h7 = 0x5be0cd19;
      const w = new Uint32Array(64);
      for (let offset = 0; offset < paddedLen; offset += 64) {
        for (let i = 0; i < 16; i++) {
          w[i] = view.getUint32(offset + i * 4, false);
        }
        for (let i = 16; i < 64; i++) {
          const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
          const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;
        let f = h5;
        let g = h6;
        let h = h7;
        for (let i = 0; i < 64; i++) {
          const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
          const ch = (e & f) ^ (~e & g);
          const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
          const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
          const maj = (a & b) ^ (a & c) ^ (b & c);
          const temp2 = (S0 + maj) >>> 0;
          h = g;
          g = f;
          f = e;
          e = (d + temp1) >>> 0;
          d = c;
          c = b;
          b = a;
          a = (temp1 + temp2) >>> 0;
        }
        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
        h5 = (h5 + f) >>> 0;
        h6 = (h6 + g) >>> 0;
        h7 = (h7 + h) >>> 0;
      }
      return [h0, h1, h2, h3, h4, h5, h6, h7]
        .map((word) => word.toString(16).padStart(8, '0'))
        .join('');
    }
    module.exports = {
      encodeUtf8Bytes,
      sha256Hex,
    };
  },
  "./core/async-mutex": function(module, exports, __require) {
    const require = (spec) => __require("./core", spec);
    'use strict';
    class AsyncMutex {
      constructor() {
        this._tail = Promise.resolve();
        this._activeCount = 0;
        this._activeToken = null;
      }
      get isLocked() {
        return this._activeCount > 0;
      }
      get pendingCount() {
        return Math.max(0, this._activeCount - 1);
      }
      isCurrentToken(token) {
        return Boolean(token && this._activeToken !== null && token === this._activeToken);
      }
      assertHeld(token) {
        if (!this.isCurrentToken(token)) {
          throw new Error(
            'Invalid or expired AsyncMutex lock token: critical section helper called without active lockToken.'
          );
        }
      }
      runExclusive(task, opts) {
        if (typeof task !== 'function') {
          return Promise.reject(new TypeError('AsyncMutex.runExclusive requires a callback function.'));
        }
        if (opts && opts.parentToken && this.isCurrentToken(opts.parentToken)) {
          return Promise.reject(
            new Error('Re-entrant AsyncMutex deadlock prevented: runExclusive called with active parentToken.')
          );
        }
        this._activeCount += 1;
        const lockToken = Symbol('AsyncMutexLockToken');
        const run = async () => {
          this._activeToken = lockToken;
          try {
            return await task(lockToken);
          } finally {
            if (this._activeToken === lockToken) {
              this._activeToken = null;
            }
            this._activeCount -= 1;
          }
        };
        const scheduled = this._tail.then(run, run);
        this._tail = scheduled.then(
          () => undefined,
          () => undefined
        );
        return scheduled;
      }
    }
    module.exports = {
      AsyncMutex,
    };
  },
  "./core/ports": function(module, exports, __require) {
    const require = (spec) => __require("./core", spec);
    'use strict';
    const { sha256Hex } = require('./sha256');
    const CONFIG_READ_REASONS = Object.freeze({
      SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
      URI_UNRESOLVED: 'URI_UNRESOLVED',
      READ_FAILED: 'READ_FAILED',
      INVALID_JSON: 'INVALID_JSON',
    });
    const CONFIG_WRITE_REASONS = Object.freeze({
      CONFLICT: 'CONFLICT',
      SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
      URI_UNRESOLVED: 'URI_UNRESOLVED',
      READ_FAILED: 'READ_FAILED',
      WRITE_FAILED: 'WRITE_FAILED',
    });
    const DEFAULT_BRAND_PROFILE = Object.freeze({
      id: 'generic-mcp-host',
      displayName: 'MCP Host',
      configFileLabel: 'mcp_config.json',
      defaultConfigPathHint: 'mcp_config.json',
      settingsNavId: 'McpManager',
      settingsNavLabel: 'MCP Servers',
      i18nNoTranslateAttr: 'data-no-translate',
      trustedTypesPolicyNames: Object.freeze([]),
    });
    function normalizeAuthorizationCode(rawInput) {
      if (typeof rawInput !== 'string') return '';
      const trimmed = rawInput.trim();
      if (!trimmed) return '';
      if (/^https?:\/\//i.test(trimmed)) {
        try {
          const parsed = new URL(trimmed);
          const queryCode = parsed.searchParams.get('code');
          if (queryCode && queryCode.trim()) {
            return queryCode.trim();
          }
          if (parsed.hash && parsed.hash.length > 1) {
            const hashParams = new URLSearchParams(parsed.hash.slice(1));
            const hashCode = hashParams.get('code');
            if (hashCode && hashCode.trim()) {
              return hashCode.trim();
            }
          }
        } catch {}
      }
      const inlineMatch = /(?:[?&#]|^)code=([^&#\s]+)/i.exec(trimmed);
      if (inlineMatch && inlineMatch[1]) {
        try {
          return decodeURIComponent(inlineMatch[1]).trim();
        } catch {
          return inlineMatch[1].trim();
        }
      }
      return trimmed;
    }
    function normalizeConfigReadResult(raw) {
      if (!raw || typeof raw !== 'object') {
        return {
          ok: false,
          reason: CONFIG_READ_REASONS.SERVICE_UNAVAILABLE,
          error: 'ConfigRepositoryPort returned an invalid response.',
          uri: null,
          fsPath: null,
          rawText: null,
          digest: null,
        };
      }
      if (raw.ok === false) {
        const rawText = typeof raw.rawText === 'string' ? raw.rawText : null;
        const digest =
          typeof raw.digest === 'string' && raw.digest
            ? raw.digest
            : rawText !== null
              ? sha256Hex(rawText)
              : null;
        return {
          ok: false,
          reason: typeof raw.reason === 'string' && raw.reason ? raw.reason : CONFIG_READ_REASONS.READ_FAILED,
          error: typeof raw.error === 'string' && raw.error ? raw.error : 'Failed to read MCP configuration.',
          uri: typeof raw.uri === 'string' && raw.uri ? raw.uri : null,
          fsPath: typeof raw.fsPath === 'string' && raw.fsPath ? raw.fsPath : null,
          rawText,
          digest,
        };
      }
      const exists = raw.status === 'MISSING' ? false : Boolean(raw.exists !== false);
      if (!exists) {
        return {
          ok: true,
          status: 'MISSING',
          exists: false,
          uri: typeof raw.uri === 'string' ? raw.uri : '',
          fsPath: typeof raw.fsPath === 'string' ? raw.fsPath : '',
          rawText: '',
          digest: null,
        };
      }
      const rawText = typeof raw.rawText === 'string' ? raw.rawText : '';
      const digest = typeof raw.digest === 'string' && raw.digest ? raw.digest : sha256Hex(rawText);
      return {
        ok: true,
        status: 'FOUND',
        exists: true,
        uri: typeof raw.uri === 'string' ? raw.uri : '',
        fsPath: typeof raw.fsPath === 'string' ? raw.fsPath : '',
        rawText,
        digest,
      };
    }
    function resolveBrandProfile(profile = {}) {
      return Object.freeze({
        ...DEFAULT_BRAND_PROFILE,
        ...(profile && typeof profile === 'object' ? profile : {}),
      });
    }
    function createDefaultPorts(overrides = {}) {
      const runtimeOverride = overrides.mcpRuntime || overrides.runtimePort;
      return {
        brandProfile: resolveBrandProfile(overrides.brandProfile),
        configRepo: overrides.configRepo || {
          async resolveConfigUri() {
            return null;
          },
          async readConfig() {
            return {
              ok: false,
              reason: CONFIG_READ_REASONS.SERVICE_UNAVAILABLE,
              error: 'Configuration repository port is not connected to host RPC.',
              uri: null,
              fsPath: null,
              rawText: null,
              digest: null,
            };
          },
          async writeConfig() {
            return {
              ok: false,
              reason: CONFIG_WRITE_REASONS.SERVICE_UNAVAILABLE,
              persisted: false,
              error: 'Configuration repository port is not connected to host RPC.',
            };
          },
          async revealConfigInExplorer() {
            return { ok: false, error: 'File explorer integration is not available.' };
          },
        },
        mcpRuntime: runtimeOverride || {
          async listServerStates() {
            return { ok: true, servers: [], states: [] };
          },
          async refreshServers() {
            return { ok: true };
          },
          async toggleServer() {
            return { ok: true, supported: false };
          },
        },
        oauthBroker: overrides.oauthBroker || {
          async discoverOAuthMetadata() {
            return { ok: false, error: 'OAuth broker port is not connected.' };
          },
          async waitForAuthReadyOrUrl() {
            return null;
          },
          async openAuthorizationUrl() {
            return { ok: false, error: 'External authorization launcher is not connected.' };
          },
          async completeAuthorization() {
            return { ok: false, error: 'OAuth broker port is not connected.' };
          },
          async disconnectSession() {
            return { ok: false, error: 'OAuth broker port is not connected.' };
          },
        },
      };
    }
    module.exports = {
      CONFIG_READ_REASONS,
      CONFIG_WRITE_REASONS,
      DEFAULT_BRAND_PROFILE,
      normalizeAuthorizationCode,
      normalizeConfigReadResult,
      resolveBrandProfile,
      createDefaultPorts,
    };
  },
  "./core/security/url-policy": function(module, exports, __require) {
    const require = (spec) => __require("./core/security", spec);
    'use strict';
    const IPV4_LOOPBACK_RE = /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
    function normalizeHostname(rawHostname) {
      return String(rawHostname || '')
        .trim()
        .toLowerCase()
        .replace(/\.+$/, '');
    }
    function matchesAllowedDomain(hostname, allowedDomains) {
      const host = normalizeHostname(hostname);
      if (!host || !Array.isArray(allowedDomains) || allowedDomains.length === 0) return false;
      for (let i = 0; i < allowedDomains.length; i++) {
        const dom = normalizeHostname(allowedDomains[i]).replace(/^\.+/, '');
        if (!dom) continue;
        if (host === dom || host.endsWith(`.${dom}`)) {
          return true;
        }
      }
      return false;
    }
    function isLoopbackHostname(hostname) {
      const host = normalizeHostname(hostname);
      if (!host) return false;
      if (host === 'localhost' || host === '::1' || host === '[::1]' || host === '[0:0:0:0:0:0:0:1]') {
        return true;
      }
      return IPV4_LOOPBACK_RE.test(host);
    }
    function classifyHttpServerUrl(rawUrl) {
      if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
        return { ok: false, code: 'INVALID_SERVER_URL', error: 'Server URL must be a non-empty string.' };
      }
      let parsed;
      try {
        parsed = new URL(rawUrl.trim());
      } catch {
        return { ok: false, code: 'INVALID_SERVER_URL', error: `Invalid URL format: "${rawUrl.trim()}".` };
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return {
          ok: false,
          code: 'INVALID_SERVER_URL',
          error: `Unsupported URL scheme "${parsed.protocol}". Only https:// (or loopback http://) is supported.`,
        };
      }
      const loopback = isLoopbackHostname(parsed.hostname);
      const isInsecureRemoteHttp = parsed.protocol === 'http:' && !loopback;
      return {
        ok: true,
        parsed,
        href: parsed.href,
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        hasEmbeddedCredentials: Boolean(parsed.username || parsed.password),
        isLoopback: loopback,
        isInsecureRemoteHttp,
      };
    }
    function validateExternalAuthUrl(rawUrl) {
      if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
        const error = 'Authorization URL is empty.';
        return { ok: false, code: 'INVALID_AUTH_URL', reason: error, error };
      }
      let parsed;
      try {
        parsed = new URL(rawUrl.trim());
      } catch {
        const error = 'Authorization URL is malformed.';
        return { ok: false, code: 'INVALID_AUTH_URL', reason: error, error };
      }
      if (parsed.username || parsed.password) {
        const error = 'Authorization URL must not contain embedded userinfo credentials.';
        return {
          ok: false,
          code: 'AUTH_URL_CREDENTIALS_FORBIDDEN',
          reason: error,
          error,
        };
      }
      if (parsed.protocol === 'https:') {
        return { ok: true, href: parsed.href, normalizedUrl: parsed.href, parsed };
      }
      if (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)) {
        return { ok: true, href: parsed.href, normalizedUrl: parsed.href, parsed };
      }
      const error = `Blocked unsafe or non-loopback authorization URL scheme "${parsed.protocol}".`;
      return {
        ok: false,
        code: 'INSECURE_AUTH_URL',
        reason: error,
        error,
      };
    }
    function hasPathTraversal(inputPath) {
      if (typeof inputPath !== 'string' || !inputPath) return false;
      let cur = inputPath;
      for (let pass = 0; pass < 4; pass++) {
        if (cur.includes('\\')) return true;
        if (/(?:^|\/)\.\.(?:\/|$)/.test(cur) || cur.includes('..')) return true;
        if (/%2e/i.test(cur) || /%5c/i.test(cur)) {
          try {
            const next = decodeURIComponent(cur);
            if (next === cur) break;
            cur = next;
            continue;
          } catch {
            return true;
          }
        }
        try {
          const next = decodeURIComponent(cur);
          if (next === cur) break;
          cur = next;
        } catch {
          return true;
        }
      }
      if (cur.includes('\\') || /(?:^|\/)\.\.(?:\/|$)/.test(cur) || cur.includes('..')) {
        return true;
      }
      return false;
    }
    function isAllowedHttpsScriptUrl(rawUrl, policy = {}) {
      if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
      const trimmed = rawUrl.trim();
      if (hasPathTraversal(trimmed)) return false;
      const normalizedPolicy = Array.isArray(policy) ? { allowedDomains: policy } : (policy || {});
      let parsed;
      try {
        parsed = new URL(trimmed);
      } catch {
        return false;
      }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        return false;
      }
      if (hasPathTraversal(parsed.pathname)) {
        return false;
      }
      const exactList = Array.isArray(normalizedPolicy.extraExactUrls) ? normalizedPolicy.extraExactUrls : [];
      for (let i = 0; i < exactList.length; i++) {
        try {
          const exactParsed = new URL(String(exactList[i] || '').trim());
          if (
            exactParsed.protocol === 'https:' &&
            parsed.origin === exactParsed.origin &&
            parsed.pathname === exactParsed.pathname
          ) {
            return true;
          }
        } catch {}
      }
      const baseUrls = Array.isArray(normalizedPolicy.allowedBaseUrls) ? normalizedPolicy.allowedBaseUrls : [];
      for (let i = 0; i < baseUrls.length; i++) {
        try {
          const cleanBase = String(baseUrls[i] || '').trim().replace(/\/+$/, '');
          if (!cleanBase) continue;
          const baseParsed = new URL(`${cleanBase}/`);
          if (
            baseParsed.protocol === 'https:' &&
            parsed.origin === baseParsed.origin &&
            (parsed.pathname === baseParsed.pathname.replace(/\/$/, '') || parsed.pathname.startsWith(baseParsed.pathname))
          ) {
            return true;
          }
        } catch {}
      }
      const origins = Array.isArray(normalizedPolicy.allowedOrigins) ? normalizedPolicy.allowedOrigins : [];
      for (let i = 0; i < origins.length; i++) {
        try {
          const allowedOrig = new URL(String(origins[i] || '').trim()).origin;
          if (parsed.origin === allowedOrig) return true;
        } catch {}
      }
      if (matchesAllowedDomain(parsed.hostname, normalizedPolicy.allowedDomains)) {
        return true;
      }
      return false;
    }
    function resolveCdnAssetUrl(rawValue, options = {}) {
      if (typeof rawValue !== 'string') return null;
      const trimmed = rawValue.trim();
      if (!trimmed) return null;
      if (trimmed.includes('\\') || /%(?:2e|2f|5c|25(?:2e|2f|5c))/i.test(trimmed)) {
        return null;
      }
      const cleanCdnBase = String(options.cdnBaseUrl || '').trim().replace(/\/+$/, '');
      if (!cleanCdnBase) return null;
      const webSeg = String(options.allowedPathPrefix || '/web/').replace(/^\/+|\/+$/g, '') || 'web';
      const webMarkerRe = new RegExp(`\\/${webSeg}\\/.*$`);
      const cdnRoot = cleanCdnBase.replace(webMarkerRe, '');
      let cdnParsed;
      let rootUrl;
      try {
        cdnParsed = new URL(`${cleanCdnBase}/`);
        rootUrl = new URL(cdnRoot.endsWith('/') ? cdnRoot : `${cdnRoot}/`);
      } catch {
        return null;
      }
      if (cdnParsed.protocol !== 'https:' || rootUrl.protocol !== 'https:') {
        return null;
      }
      const cdnOrigin = cdnParsed.origin;
      const webPrefixSlash = `/${webSeg}/`;
      const effectiveRootPrefix =
        rootUrl.pathname !== '/'
          ? rootUrl.pathname
          : cdnParsed.pathname.startsWith(webPrefixSlash)
            ? webPrefixSlash
            : '/';
      if (/^(?:blob:|data:|javascript:|mailto:|tel:|about:|file:)/i.test(trimmed)) {
        return null;
      }
      const webBuildPathRe = new RegExp(`^\\/${webSeg}\\/[^/]+\\/`);
      const nestedWebBuildPathRe = new RegExp(`^\\/(?:[^/]+\\/)*${webSeg}\\/[^/]+\\/`);
      if (/^https?:\/\//i.test(trimmed)) {
        try {
          const parsed = new URL(trimmed);
          if (parsed.username || parsed.password) return null;
          if (
            parsed.protocol === 'https:' &&
            parsed.origin === cdnOrigin &&
            parsed.pathname.startsWith(effectiveRootPrefix) &&
            !hasPathTraversal(parsed.pathname)
          ) {
            return parsed.href;
          }
          if (options.hostOrigin) {
            const hOrig = new URL(String(options.hostOrigin)).origin;
            if (
              parsed.origin === hOrig &&
              webBuildPathRe.test(parsed.pathname) &&
              !hasPathTraversal(parsed.pathname)
            ) {
              return `${cdnRoot}${parsed.pathname}${parsed.search}${parsed.hash}`;
            }
          }
        } catch {}
        return null;
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('?')) {
        return null;
      }
      if (trimmed.startsWith(webPrefixSlash)) {
        try {
          const candidate = new URL(trimmed.slice(1), rootUrl);
          if (
            candidate.origin !== cdnOrigin ||
            !candidate.pathname.startsWith(rootUrl.pathname) ||
            !nestedWebBuildPathRe.test(candidate.pathname) ||
            hasPathTraversal(candidate.pathname)
          ) {
            return null;
          }
          return candidate.href;
        } catch {
          return null;
        }
      }
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
        try {
          const baseForRel = trimmed.startsWith('/')
            ? effectiveRootPrefix !== '/' && trimmed.startsWith(effectiveRootPrefix)
              ? new URL('/', cdnOrigin)
              : rootUrl
            : cdnParsed;
          const relInput = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
          const candidate = new URL(relInput, baseForRel);
          if (
            candidate.origin !== cdnOrigin ||
            !candidate.pathname.startsWith(effectiveRootPrefix) ||
            hasPathTraversal(candidate.pathname)
          ) {
            return null;
          }
          if (effectiveRootPrefix === '/' && cdnParsed.pathname !== '/' && !candidate.pathname.startsWith(cdnParsed.pathname)) {
            return null;
          }
          return candidate.href;
        } catch {
          return null;
        }
      }
      return null;
    }
    module.exports = {
      normalizeHostname,
      matchesAllowedDomain,
      isLoopbackHostname,
      classifyHttpServerUrl,
      validateExternalAuthUrl,
      hasPathTraversal,
      isAllowedHttpsScriptUrl,
      resolveCdnAssetUrl,
    };
  },
  "./core/schema/jsonc-codec": function(module, exports, __require) {
    const require = (spec) => __require("./core/schema", spec);
    'use strict';
    function isWsCharCode(code) {
      return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
    }
    function stripJsoncToValidJson(rawText) {
      const src = String(rawText ?? '');
      const len = src.length;
      const codes = new Uint16Array(len);
      let i = 0;
      let inString = false;
      let escaped = false;
      while (i < len) {
        const c = src.charCodeAt(i);
        const next = i + 1 < len ? src.charCodeAt(i + 1) : 0;
        if (inString) {
          codes[i] = c;
          if (escaped) {
            escaped = false;
          } else if (c === 0x5c /* \ */) {
            escaped = true;
          } else if (c === 0x22 /* " */) {
            inString = false;
          }
          i += 1;
          continue;
        }
        if (c === 0x22 /* " */) {
          inString = true;
          codes[i] = c;
          i += 1;
          continue;
        }
        if (c === 0x2f /* / */ && next === 0x2f /* / */) {
          codes[i] = 0x20;
          codes[i + 1] = 0x20;
          i += 2;
          while (i < len) {
            const cc = src.charCodeAt(i);
            if (cc === 0x0a || cc === 0x0d) break;
            codes[i] = 0x20;
            i += 1;
          }
          continue;
        }
        if (c === 0x2f /* / */ && next === 0x2a /* * */) {
          codes[i] = 0x20;
          codes[i + 1] = 0x20;
          i += 2;
          while (i < len) {
            const cc = src.charCodeAt(i);
            const nn = i + 1 < len ? src.charCodeAt(i + 1) : 0;
            if (cc === 0x2a /* * */ && nn === 0x2f /* / */) {
              codes[i] = 0x20;
              codes[i + 1] = 0x20;
              i += 2;
              break;
            }
            codes[i] = cc === 0x0a || cc === 0x0d ? cc : 0x20;
            i += 1;
          }
          continue;
        }
        codes[i] = c;
        i += 1;
      }
      inString = false;
      escaped = false;
      for (let idx = 0; idx < len; idx++) {
        const c = codes[idx];
        if (inString) {
          if (escaped) escaped = false;
          else if (c === 0x5c) escaped = true;
          else if (c === 0x22) inString = false;
          continue;
        }
        if (c === 0x22) {
          inString = true;
          continue;
        }
        if (c === 0x2c /* , */) {
          let look = idx + 1;
          while (look < len && isWsCharCode(codes[look])) {
            look += 1;
          }
          if (look < len && (codes[look] === 0x7d /* } */ || codes[look] === 0x5d /* ] */)) {
            codes[idx] = 0x20;
          }
        }
      }
      let out = '';
      const CHUNK = 8192;
      for (let offset = 0; offset < len; offset += CHUNK) {
        const slice = codes.subarray(offset, Math.min(offset + CHUNK, len));
        out += String.fromCharCode.apply(null, slice);
      }
      return out;
    }
    function parseJsonc(rawText) {
      if (typeof rawText !== 'string' || !rawText.trim()) {
        return { ok: false, error: 'Configuration text is empty.' };
      }
      try {
        const cleaned = stripJsoncToValidJson(rawText);
        return { ok: true, value: JSON.parse(cleaned) };
      } catch (err) {
        return { ok: false, error: `Invalid JSON/JSONC syntax: ${err && err.message ? err.message : String(err)}` };
      }
    }
    function tokenizeJsonSpans(cleanedJson) {
      const tokens = [];
      let i = 0;
      const len = cleanedJson.length;
      while (i < len) {
        const code = cleanedJson.charCodeAt(i);
        if (isWsCharCode(code)) {
          i += 1;
          continue;
        }
        const ch = cleanedJson[i];
        if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ':' || ch === ',') {
          tokens.push({ type: ch, start: i, end: i + 1, value: ch });
          i += 1;
          continue;
        }
        if (ch === '"') {
          const start = i;
          i += 1;
          let escaped = false;
          while (i < len) {
            const c = cleanedJson.charCodeAt(i);
            i += 1;
            if (escaped) {
              escaped = false;
            } else if (c === 0x5c) {
              escaped = true;
            } else if (c === 0x22) {
              break;
            }
          }
          const raw = cleanedJson.slice(start, i);
          tokens.push({ type: 'string', start, end: i, value: JSON.parse(raw) });
          continue;
        }
        const start = i;
        while (i < len) {
          const cc = cleanedJson.charCodeAt(i);
          if (
            isWsCharCode(cc) ||
            cc === 0x7b ||
            cc === 0x7d ||
            cc === 0x5b ||
            cc === 0x5d ||
            cc === 0x3a ||
            cc === 0x2c ||
            cc === 0x22
          ) {
            break;
          }
          i += 1;
        }
        tokens.push({ type: 'literal', start, end: i, value: cleanedJson.slice(start, i) });
      }
      return tokens;
    }
    function parseValueNode(tokens, startIdx) {
      const tok = tokens[startIdx];
      if (!tok) return null;
      if (tok.type === '{') {
        const props = [];
        let idx = startIdx + 1;
        while (idx < tokens.length && tokens[idx].type !== '}') {
          const keyTok = tokens[idx];
          if (!keyTok || keyTok.type !== 'string') break;
          idx += 1;
          if (tokens[idx] && tokens[idx].type === ':') idx += 1;
          const valRes = parseValueNode(tokens, idx);
          if (!valRes) break;
          idx = valRes.nextIdx;
          let commaPos = -1;
          if (tokens[idx] && tokens[idx].type === ',') {
            commaPos = tokens[idx].start;
            idx += 1;
          }
          props.push({
            key: keyTok.value,
            keyStart: keyTok.start,
            keyEnd: keyTok.end,
            valueNode: valRes.node,
            commaPos,
          });
        }
        const closeTok = tokens[idx];
        return {
          node: {
            type: 'object',
            start: tok.start,
            end: closeTok ? closeTok.end : tok.end,
            closeStart: closeTok ? closeTok.start : tok.end,
            props,
          },
          nextIdx: closeTok ? idx + 1 : idx,
        };
      }
      if (tok.type === '[') {
        let idx = startIdx + 1;
        const items = [];
        while (idx < tokens.length && tokens[idx].type !== ']') {
          const itemRes = parseValueNode(tokens, idx);
          if (!itemRes) break;
          items.push(itemRes.node);
          idx = itemRes.nextIdx;
          if (tokens[idx] && tokens[idx].type === ',') idx += 1;
        }
        const closeTok = tokens[idx];
        return {
          node: {
            type: 'array',
            start: tok.start,
            end: closeTok ? closeTok.end : tok.end,
            items,
          },
          nextIdx: closeTok ? idx + 1 : idx,
        };
      }
      return {
        node: { type: tok.type, start: tok.start, end: tok.end },
        nextIdx: startIdx + 1,
      };
    }
    function indentJsonLines(jsonStr, indentPrefix) {
      const lines = jsonStr.split('\n');
      return lines.map((line, idx) => (idx === 0 ? line : `${indentPrefix}${line}`)).join('\n');
    }
    function findOriginalTrailingComma(rawSrc, afterValueIdx, limitIdx) {
      let i = afterValueIdx;
      while (i < limitIdx) {
        const c = rawSrc.charCodeAt(i);
        const next = i + 1 < limitIdx ? rawSrc.charCodeAt(i + 1) : 0;
        if (isWsCharCode(c)) {
          i += 1;
          continue;
        }
        if (c === 0x2c /* , */) {
          return i;
        }
        if (c === 0x2f && next === 0x2f) {
          i += 2;
          while (i < limitIdx && rawSrc.charCodeAt(i) !== 0x0a && rawSrc.charCodeAt(i) !== 0x0d) {
            i += 1;
          }
          continue;
        }
        if (c === 0x2f && next === 0x2a) {
          i += 2;
          while (i < limitIdx) {
            if (rawSrc.charCodeAt(i) === 0x2a && i + 1 < limitIdx && rawSrc.charCodeAt(i + 1) === 0x2f) {
              i += 2;
              break;
            }
            i += 1;
          }
          continue;
        }
        break;
      }
      return -1;
    }
    function appendPropertyPreservingComments(current, containerObj, lastProp, propIndent, newPropText, closeIndent) {
      const valEnd = lastProp.valueNode.end;
      const closeStart = containerObj.closeStart;
      const existingTrailingComma = findOriginalTrailingComma(current, valEnd, closeStart);
      let beforeClose = closeStart;
      while (beforeClose > valEnd && (current.charCodeAt(beforeClose - 1) === 0x20 || current.charCodeAt(beforeClose - 1) === 0x09)) {
        beforeClose -= 1;
      }
      const hasNewlineBeforeClose =
        beforeClose > valEnd && (current.charCodeAt(beforeClose - 1) === 0x0a || current.charCodeAt(beforeClose - 1) === 0x0d);
      const prefixInsert = hasNewlineBeforeClose ? `${propIndent}${newPropText}\n${closeIndent}` : `\n${propIndent}${newPropText}\n${closeIndent}`;
      if (existingTrailingComma !== -1) {
        return current.slice(0, beforeClose) + prefixInsert + current.slice(closeStart);
      }
      return (
        current.slice(0, valEnd) +
        ',' +
        current.slice(valEnd, beforeClose) +
        prefixInsert +
        current.slice(closeStart)
      );
    }
    function applySingleJsoncMutation(currentText, mut) {
      if (!mut || typeof mut.name !== 'string' || !mut.name) {
        return currentText;
      }
      const current =
        typeof currentText === 'string' && currentText.trim()
          ? currentText.replace(/\r\n?/g, '\n')
          : '{\n  "mcpServers": {}\n}\n';
      const cleaned = stripJsoncToValidJson(current);
      const verifyParse = parseJsonc(current);
      if (!verifyParse.ok || !verifyParse.value || typeof verifyParse.value !== 'object' || Array.isArray(verifyParse.value)) {
        throw new Error(verifyParse.ok ? 'Root of mcp_config.json must be a JSON object.' : verifyParse.error);
      }
      const tokens = tokenizeJsonSpans(cleaned);
      const rootRes = parseValueNode(tokens, 0);
      if (!rootRes || rootRes.node.type !== 'object') {
        throw new Error('Root of mcp_config.json must be a JSON object.');
      }
      const rootNode = rootRes.node;
      const mcpProp = rootNode.props.find((p) => p.key === 'mcpServers');
      if (!mcpProp || mcpProp.valueNode.type !== 'object') {
        if (mut.op === 'delete') return current;
        const entryText = `"mcpServers": {\n    ${JSON.stringify(mut.name)}: ${indentJsonLines(JSON.stringify(mut.spec, null, 2), '    ')}\n  }`;
        if (rootNode.props.length === 0) {
          const innerRoot = current.slice(rootNode.start + 1, rootNode.closeStart);
          const hasRootComments = innerRoot.trim().length > 0;
          if (hasRootComments) {
            return `${current.slice(0, rootNode.closeStart)}  ${entryText}\n${current.slice(rootNode.closeStart)}`;
          }
          return `${current.slice(0, rootNode.start)}{\n  ${entryText}\n}${current.slice(rootNode.end)}`;
        }
        const lastRootProp = rootNode.props[rootNode.props.length - 1];
        return appendPropertyPreservingComments(current, rootNode, lastRootProp, '  ', entryText, '');
      }
      const serversObj = mcpProp.valueNode;
      const existingIdx = serversObj.props.findIndex((p) => p.key === mut.name);
      if (mut.op === 'set') {
        const formattedVal = indentJsonLines(JSON.stringify(mut.spec, null, 2), '    ');
        const newEntryProp = `${JSON.stringify(mut.name)}: ${formattedVal}`;
        if (existingIdx >= 0) {
          const targetProp = serversObj.props[existingIdx];
          return (
            current.slice(0, targetProp.valueNode.start) +
            formattedVal +
            current.slice(targetProp.valueNode.end)
          );
        }
        if (serversObj.props.length === 0) {
          const inner = current.slice(serversObj.start + 1, serversObj.closeStart);
          const hasCommentsInside = inner.trim().length > 0;
          if (hasCommentsInside) {
            return (
              current.slice(0, serversObj.closeStart) +
              `  ${newEntryProp}\n  ` +
              current.slice(serversObj.closeStart)
            );
          }
          return (
            current.slice(0, serversObj.start) +
            `{\n    ${newEntryProp}\n  }` +
            current.slice(serversObj.end)
          );
        }
        const lastProp = serversObj.props[serversObj.props.length - 1];
        return appendPropertyPreservingComments(current, serversObj, lastProp, '    ', newEntryProp, '  ');
      }
      if (mut.op === 'delete' && existingIdx >= 0) {
        const targetProp = serversObj.props[existingIdx];
        let removeStart = targetProp.keyStart;
        while (
          removeStart > serversObj.start + 1 &&
          (current.charCodeAt(removeStart - 1) === 0x20 || current.charCodeAt(removeStart - 1) === 0x09)
        ) {
          removeStart -= 1;
        }
        if (removeStart > serversObj.start + 1 && current.charCodeAt(removeStart - 1) === 0x0a) {
          removeStart -= 1;
        }
        let removeEnd = targetProp.valueNode.end;
        const ownComma = findOriginalTrailingComma(
          current,
          removeEnd,
          existingIdx + 1 < serversObj.props.length ? serversObj.props[existingIdx + 1].keyStart : serversObj.closeStart
        );
        if (ownComma !== -1) {
          removeEnd = ownComma + 1;
        } else if (existingIdx > 0 && existingIdx === serversObj.props.length - 1) {
          const prevProp = serversObj.props[existingIdx - 1];
          const prevComma = findOriginalTrailingComma(current, prevProp.valueNode.end, targetProp.keyStart);
          if (prevComma !== -1) {
            return (
              current.slice(0, prevComma) +
              current.slice(prevComma + 1, removeStart) +
              current.slice(removeEnd)
            );
          }
        }
        return current.slice(0, removeStart) + current.slice(removeEnd);
      }
      return current;
    }
    function applyJsoncServerMutations(rawText, mutations) {
      if (!Array.isArray(mutations) || mutations.length === 0) {
        const base =
          typeof rawText === 'string' && rawText.trim()
            ? rawText.replace(/\r\n?/g, '\n')
            : '{\n  "mcpServers": {}\n}\n';
        return base.endsWith('\n') ? base : `${base}\n`;
      }
      let current =
        typeof rawText === 'string' && rawText.trim()
          ? rawText.replace(/\r\n?/g, '\n')
          : '{\n  "mcpServers": {}\n}\n';
      for (let i = 0; i < mutations.length; i++) {
        current = applySingleJsoncMutation(current, mutations[i]);
      }
      return current.endsWith('\n') ? current : `${current}\n`;
    }
    module.exports = {
      stripJsoncToValidJson,
      parseJsonc,
      applySingleJsoncMutation,
      applyJsoncServerMutations,
    };
  },
  "./core/schema/presets": function(module, exports, __require) {
    const require = (spec) => __require("./core/schema", spec);
    'use strict';
    const QUICK_TEMPLATES = [
      {
        id: 'filesystem',
        label: '📁 Filesystem',
        transport: 'stdio',
        serverName: 'filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:/workspace'],
        env: {},
        description: 'Local directory read/write/search access via official MCP Filesystem server.',
      },
      {
        id: 'memory',
        label: '🧠 Memory',
        transport: 'stdio',
        serverName: 'memory',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: {},
        description: 'Persistent knowledge graph memory server.',
      },
      {
        id: 'fetch',
        label: '🌐 Fetch',
        transport: 'stdio',
        serverName: 'fetch',
        command: 'uvx',
        args: ['mcp-server-fetch'],
        env: {},
        description: 'Web page fetching and HTML-to-markdown conversion.',
      },
      {
        id: 'github',
        label: '🐙 GitHub',
        transport: 'stdio',
        serverName: 'github',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: '<YOUR_GITHUB_TOKEN>',
        },
        description: 'GitHub repository, issue, PR, and search integration.',
      },
      {
        id: 'postgres',
        label: '🐘 PostgreSQL',
        transport: 'stdio',
        serverName: 'postgres',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost:5432/mydb'],
        env: {},
        description: 'Read-only schema inspection and SQL query execution for PostgreSQL.',
      },
      {
        id: 'sqlite',
        label: '🗄️ SQLite',
        transport: 'stdio',
        serverName: 'sqlite',
        command: 'uvx',
        args: ['mcp-server-sqlite', '--db-path', 'D:/data/database.db'],
        env: {},
        description: 'SQLite database query and business insight memo server.',
      },
      {
        id: 'playwright',
        label: '🎭 Playwright',
        transport: 'stdio',
        serverName: 'playwright',
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest'],
        env: {},
        description: 'Browser automation via Playwright MCP server.',
      },
      {
        id: 'remote-http',
        label: '☁️ Remote HTTP',
        transport: 'http',
        serverName: 'remote-service',
        url: 'https://mcp.example.com/mcp',
        headers: {},
        description: 'Streamable HTTP remote MCP endpoint (MCP spec 2025-03-26).',
      },
    ];
    const KNOWN_UVX_PACKAGES = new Set([
      'mcp-server-fetch',
      'mcp-server-sqlite',
      'mcp-server-git',
      'mcp-server-time',
      'mcp-server-sentry',
    ]);
    function sanitizeServerName(raw) {
      if (!raw || typeof raw !== 'string') return '';
      const cleaned = raw
        .trim()
        .toLowerCase()
        .replace(/^@[^/]+\//, '')
        .replace(/@[0-9a-z._-]+$/i, '')
        .replace(/^(?:mcp-server-|server-|mcp-)/, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      return cleaned || '';
    }
    function deriveServerNameFromUrl(urlStr) {
      try {
        const u = new URL(urlStr);
        const hostParts = u.hostname.toLowerCase().split('.').filter(Boolean);
        const ignored = new Set(['www', 'mcp', 'api', 'server', 'com', 'org', 'net', 'io', 'dev', 'ai', 'app', 'co', 'kr']);
        const meaningfulHost = hostParts.filter((p) => !ignored.has(p));
        const pathParts = u.pathname
          .split('/')
          .map((p) => sanitizeServerName(p))
          .filter((p) => p && p !== 'mcp' && p !== 'sse' && p !== 'v1' && p !== 'v2');
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
          const suffix = pathParts[0] || (u.port ? `${u.port}` : 'local');
          return sanitizeServerName(`local-${suffix}`) || 'local-mcp';
        }
        if (meaningfulHost.length > 0 && pathParts.length > 0) {
          return sanitizeServerName(`${meaningfulHost[0]}-${pathParts[pathParts.length - 1]}`);
        }
        if (meaningfulHost.length > 0) {
          return sanitizeServerName(meaningfulHost.join('-'));
        }
        if (pathParts.length > 0) {
          return sanitizeServerName(pathParts[pathParts.length - 1]);
        }
        return sanitizeServerName(u.hostname) || 'remote-mcp';
      } catch {
        return 'remote-mcp';
      }
    }
    function deriveServerNameFromCommandAndArgs(command, args) {
      const list = Array.isArray(args) ? args : [];
      for (let i = list.length - 1; i >= 0; i--) {
        const token = String(list[i] || '').trim();
        if (!token || token.startsWith('-')) continue;
        if (/^https?:\/\//i.test(token)) {
          return deriveServerNameFromUrl(token);
        }
        if (token.startsWith('github:')) {
          const repoPart = token.slice('github:'.length).split('/').pop();
          const name = sanitizeServerName(repoPart);
          if (name) return name;
        }
        if (token.startsWith('@') || token.includes('mcp') || i === 0) {
          const base = token.replace(/\\/g, '/').split('/').pop().replace(/\.(?:js|mjs|cjs|py|ts)$/i, '');
          const name = sanitizeServerName(base);
          if (name) return name;
        }
      }
      return sanitizeServerName(command) || 'custom-mcp';
    }
    module.exports = {
      QUICK_TEMPLATES,
      KNOWN_UVX_PACKAGES,
      sanitizeServerName,
      deriveServerNameFromUrl,
      deriveServerNameFromCommandAndArgs,
    };
  },
  "./core/schema/auth-codec": function(module, exports, __require) {
    const require = (spec) => __require("./core/schema", spec);
    'use strict';
    const { classifyHttpServerUrl } = require('../security/url-policy');
    const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const SENSITIVE_QUERY_PARAM_RE =
      /^(?:access_token|id_token|refresh_token|auth_token|bearer|api_key|apikey|x_api_key|token|secret|client_secret|code|key|password|passwd|pwd|sig|signature)$/i;
    function toUtf8Bytes(str) {
      const input = String(str ?? '');
      if (typeof TextEncoder === 'function') {
        return new TextEncoder().encode(input);
      }
      const out = [];
      for (let i = 0; i < input.length; i++) {
        let code = input.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
          const next = input.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
            i += 1;
          }
        }
        if (code < 0x80) out.push(code);
        else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        else if (code < 0x10000) {
          out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else {
          out.push(
            0xf0 | (code >> 18),
            0x80 | ((code >> 12) & 0x3f),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f)
          );
        }
      }
      return new Uint8Array(out);
    }
    function fromUtf8Bytes(bytes) {
      if (typeof TextDecoder === 'function') {
        return new TextDecoder('utf-8').decode(bytes);
      }
      let out = '';
      let i = 0;
      while (i < bytes.length) {
        const b0 = bytes[i++];
        if (b0 < 0x80) {
          out += String.fromCharCode(b0);
        } else if ((b0 & 0xe0) === 0xc0 && i < bytes.length) {
          out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f));
        } else if ((b0 & 0xf0) === 0xe0 && i + 1 < bytes.length) {
          const b1 = bytes[i++];
          const b2 = bytes[i++];
          out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
        } else if (i + 2 < bytes.length) {
          const b1 = bytes[i++];
          const b2 = bytes[i++];
          const b3 = bytes[i++];
          const cp = (((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)) - 0x10000;
          out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        }
      }
      return out;
    }
    function encodeBytesToBase64(bytesInput) {
      const bytes = bytesInput instanceof Uint8Array ? bytesInput : new Uint8Array(bytesInput || 0);
      let out = '';
      for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const hasB1 = i + 1 < bytes.length;
        const hasB2 = i + 2 < bytes.length;
        const b1 = hasB1 ? bytes[i + 1] : 0;
        const b2 = hasB2 ? bytes[i + 2] : 0;
        const triplet = (b0 << 16) | (b1 << 8) | b2;
        out += BASE64_ALPHABET[(triplet >> 18) & 0x3f];
        out += BASE64_ALPHABET[(triplet >> 12) & 0x3f];
        out += hasB1 ? BASE64_ALPHABET[(triplet >> 6) & 0x3f] : '=';
        out += hasB2 ? BASE64_ALPHABET[triplet & 0x3f] : '=';
      }
      return out;
    }
    function decodeBase64ToBytes(b64) {
      const clean = String(b64 ?? '').replace(/[\r\n\s]/g, '');
      if (!clean || clean.length % 4 === 1) return null;
      const bytes = [];
      for (let i = 0; i < clean.length; i += 4) {
        const c0 = BASE64_ALPHABET.indexOf(clean[i]);
        const c1 = BASE64_ALPHABET.indexOf(clean[i + 1]);
        const ch2 = clean[i + 2];
        const ch3 = clean[i + 3];
        const c2 = ch2 === '=' || i + 2 >= clean.length ? -1 : BASE64_ALPHABET.indexOf(ch2);
        const c3 = ch3 === '=' || i + 3 >= clean.length ? -1 : BASE64_ALPHABET.indexOf(ch3);
        if (c0 < 0 || c1 < 0 || (ch2 && ch2 !== '=' && c2 < 0) || (ch3 && ch3 !== '=' && c3 < 0)) {
          return null;
        }
        const triplet = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
        bytes.push((triplet >> 16) & 0xff);
        if (c2 >= 0) bytes.push((triplet >> 8) & 0xff);
        if (c3 >= 0) bytes.push(triplet & 0xff);
      }
      return new Uint8Array(bytes);
    }
    function encodeBase64(str) {
      return encodeBytesToBase64(toUtf8Bytes(str));
    }
    function decodeBase64(b64) {
      try {
        const u8 = decodeBase64ToBytes(b64);
        if (!u8) return '';
        return fromUtf8Bytes(u8);
      } catch {
        return '';
      }
    }
    function mergeHeadersCaseInsensitive(...headerMaps) {
      const out = {};
      const lowerToKey = new Map();
      for (let m = 0; m < headerMaps.length; m++) {
        const map = headerMaps[m];
        if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
        for (const [rawKey, rawVal] of Object.entries(map)) {
          const key = String(rawKey || '').trim();
          if (!key || rawVal === undefined || rawVal === null) continue;
          const lower = key.toLowerCase();
          const prevKey = lowerToKey.get(lower);
          if (prevKey && prevKey !== key) {
            delete out[prevKey];
          }
          lowerToKey.set(lower, key);
          out[key] = String(rawVal);
        }
      }
      return out;
    }
    function parseKeyValueInput(raw, { caseInsensitiveKeys = false } = {}) {
      let rawPairs = [];
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        rawPairs = Object.entries(raw);
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return {};
        if (trimmed.startsWith('{')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              rawPairs = Object.entries(parsed);
            }
          } catch {}
        }
        if (rawPairs.length === 0) {
          const lines = trimmed.split(/\r?\n/);
          for (const line of lines) {
            const clean = line.trim();
            if (!clean || clean.startsWith('#')) continue;
            const eqIdx = clean.indexOf('=');
            const colonIdx = clean.indexOf(':');
            let sepIdx = -1;
            if (eqIdx !== -1 && (colonIdx === -1 || eqIdx < colonIdx)) {
              sepIdx = eqIdx;
            } else if (colonIdx !== -1) {
              sepIdx = colonIdx;
            }
            if (sepIdx > 0) {
              const key = clean.slice(0, sepIdx).trim();
              let val = clean.slice(sepIdx + 1).trim();
              if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
              }
              rawPairs.push([key, val]);
            }
          }
        }
      }
      const out = {};
      const lowerToKey = new Map();
      for (const [k, v] of rawPairs) {
        const key = String(k || '').trim();
        if (!key || v === undefined || v === null) continue;
        if (caseInsensitiveKeys) {
          const lower = key.toLowerCase();
          const prev = lowerToKey.get(lower);
          if (prev && prev !== key) delete out[prev];
          lowerToKey.set(lower, key);
        }
        out[key] = String(v);
      }
      return out;
    }
    function formatKeyValueForInput(obj, sep = '=') {
      if (!obj || typeof obj !== 'object') return '';
      const entries = Object.entries(obj);
      if (entries.length === 0) return '';
      return entries.map(([k, v]) => `${k}${sep}${v}`).join('\n');
    }
    function extractAuthFromSpec(spec) {
      const isHttp = Boolean(spec && typeof spec === 'object' && (spec.url || spec.serverUrl || spec.type === 'http'));
      const result = {
        authMode: isHttp ? 'oauth' : 'none',
        oauthClientMode: 'auto',
        oauthClientId: '',
        oauthClientSecret: '',
        oauthScopes: '',
        bearerToken: '',
        apiKeyHeader: 'X-API-Key',
        apiKeyValue: '',
        basicUser: '',
        basicPass: '',
        extraHeaders: {},
      };
      if (!spec || typeof spec !== 'object') return result;
      if (spec.oauth && typeof spec.oauth === 'object') {
        result.authMode = 'oauth';
        result.oauthClientId = typeof spec.oauth.clientId === 'string' ? spec.oauth.clientId : '';
        result.oauthClientSecret = typeof spec.oauth.clientSecret === 'string' ? spec.oauth.clientSecret : '';
        result.oauthScopes = Array.isArray(spec.oauth.scopes)
          ? spec.oauth.scopes.join(' ')
          : typeof spec.oauth.scopes === 'string'
            ? spec.oauth.scopes
            : '';
        if (result.oauthClientId || result.oauthClientSecret) {
          result.oauthClientMode = 'custom';
        }
      }
      if (spec.authMode === 'none' || spec.authMode === 'oauth' || spec.authMode === 'oauth_or_none') {
        result.authMode = spec.authMode;
      }
      const rawHeaders = spec.headers && typeof spec.headers === 'object' ? mergeHeadersCaseInsensitive(spec.headers) : {};
      const entries = Object.entries(rawHeaders);
      let matchedKey = null;
      if (spec.authMode === 'apiKey') {
        result.authMode = 'apiKey';
        const explicitHdr =
          typeof spec.apiKeyHeader === 'string' && spec.apiKeyHeader.trim() ? spec.apiKeyHeader.trim() : '';
        if (explicitHdr) {
          result.apiKeyHeader = explicitHdr;
          for (const [k, v] of entries) {
            if (k.toLowerCase() === explicitHdr.toLowerCase() && typeof v === 'string') {
              result.apiKeyHeader = k;
              result.apiKeyValue = v.trim();
              matchedKey = k;
              break;
            }
          }
        }
      }
      if (!matchedKey) {
        for (const [k, v] of entries) {
          if (k.toLowerCase() === 'authorization' && typeof v === 'string') {
            const trimmed = v.trim();
            const bearerMatch = /^Bearer\s+(.+)$/i.exec(trimmed);
            if (bearerMatch) {
              result.authMode = 'bearer';
              result.bearerToken = bearerMatch[1].trim();
              matchedKey = k;
              break;
            }
            const basicMatch = /^Basic\s+(.+)$/i.exec(trimmed);
            if (basicMatch) {
              const decoded = decodeBase64(basicMatch[1].trim());
              const colonIdx = decoded.indexOf(':');
              result.authMode = 'basic';
              if (colonIdx !== -1) {
                result.basicUser = decoded.slice(0, colonIdx);
                result.basicPass = decoded.slice(colonIdx + 1);
              } else {
                result.basicUser = decoded;
              }
              matchedKey = k;
              break;
            }
            result.authMode = 'apiKey';
            result.apiKeyHeader = k;
            result.apiKeyValue = trimmed;
            matchedKey = k;
            break;
          }
        }
      }
      if (!matchedKey) {
        for (const [k, v] of entries) {
          if (/^(?:x-api-key|api-key|x-auth-token|x-mcp-token|x-access-token)$/i.test(k) && typeof v === 'string') {
            result.authMode = 'apiKey';
            result.apiKeyHeader = k;
            result.apiKeyValue = v.trim();
            matchedKey = k;
            break;
          }
        }
      }
      if (!matchedKey && spec.authMode === 'apiKey') {
        const [k, v] = entries[0] || [];
        if (k && typeof v === 'string') {
          result.authMode = 'apiKey';
          result.apiKeyHeader = k;
          result.apiKeyValue = v.trim();
          matchedKey = k;
        }
      }
      for (const [k, v] of entries) {
        if (k !== matchedKey) {
          result.extraHeaders[k] = String(v);
        }
      }
      return result;
    }
    function buildAuthHeaders({
      authMode,
      mode: legacyMode,
      bearerToken,
      apiKeyHeader,
      apiKeyValue,
      basicUser,
      basicPass,
      baseHeaders,
    }) {
      const headers = baseHeaders && typeof baseHeaders === 'object' ? mergeHeadersCaseInsensitive(baseHeaders) : {};
      const rawMode = typeof authMode === 'string' && authMode ? authMode : legacyMode;
      const mode = typeof rawMode === 'string' ? rawMode.trim() : '';
      if (!mode) {
        return headers;
      }
      if (mode === 'none' || mode === 'oauth' || mode === 'oauth_or_none') {
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === 'authorization') delete headers[k];
        }
        return headers;
      }
      if (mode === 'bearer') {
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === 'authorization') delete headers[k];
        }
        const rawToken = typeof bearerToken === 'string' ? bearerToken.trim() : '';
        if (rawToken) {
          const cleanToken = rawToken.replace(/^Bearer\s+/i, '').trim();
          if (cleanToken) {
            headers.Authorization = `Bearer ${cleanToken}`;
          }
        }
        return headers;
      }
      if (mode === 'apiKey') {
        const hdrName = typeof apiKeyHeader === 'string' && apiKeyHeader.trim() ? apiKeyHeader.trim() : 'X-API-Key';
        const hdrLower = hdrName.toLowerCase();
        for (const k of Object.keys(headers)) {
          const kl = k.toLowerCase();
          if (kl === hdrLower || (hdrLower !== 'authorization' && kl === 'authorization')) {
            delete headers[k];
          }
        }
        const hdrVal = typeof apiKeyValue === 'string' ? apiKeyValue.trim() : '';
        if (hdrVal) {
          headers[hdrName] = hdrVal;
        }
        return headers;
      }
      if (mode === 'basic') {
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === 'authorization') delete headers[k];
        }
        const u = typeof basicUser === 'string' ? basicUser : '';
        const p = typeof basicPass === 'string' ? basicPass : '';
        if (u || p) {
          headers.Authorization = `Basic ${encodeBase64(`${u}:${p}`)}`;
        }
        return headers;
      }
      return headers;
    }
    function normalizeQuickAuthToken(rawAuth) {
      if (typeof rawAuth !== 'string' || !rawAuth.trim()) return null;
      const trimmed = rawAuth.trim();
      if (/^Bearer\s+(.+)$/i.test(trimmed)) {
        const tok = trimmed.replace(/^Bearer\s+/i, '').trim();
        return tok ? { headerKey: 'Authorization', headerValue: `Bearer ${tok}`, rawToken: tok } : null;
      }
      if (/^Basic\s+(.+)$/i.test(trimmed)) {
        return { headerKey: 'Authorization', headerValue: trimmed, rawToken: trimmed };
      }
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0 && /^[a-zA-Z0-9_-]+$/.test(trimmed.slice(0, colonIdx).trim())) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim();
        if (val) {
          return { headerKey: key, headerValue: val, rawToken: val };
        }
      }
      return {
        headerKey: 'Authorization',
        headerValue: `Bearer ${trimmed}`,
        rawToken: trimmed,
      };
    }
    function extractUrlAuthAndCleanUrl(rawUrlStr) {
      try {
        const u = new URL(rawUrlStr);
        const extractedHeaders = {};
        if (u.username || u.password) {
          const user = decodeURIComponent(u.username || '');
          const pass = decodeURIComponent(u.password || '');
          if (user && !pass) {
            extractedHeaders.Authorization = `Bearer ${user}`;
          } else if (user || pass) {
            extractedHeaders.Authorization = `Basic ${encodeBase64(`${user}:${pass}`)}`;
          }
          u.username = '';
          u.password = '';
        }
        for (const paramName of ['bearer', 'auth_token', 'access_token']) {
          if (u.searchParams.has(paramName)) {
            const val = u.searchParams.get(paramName);
            if (val && !extractedHeaders.Authorization) {
              extractedHeaders.Authorization = `Bearer ${val}`;
            }
            u.searchParams.delete(paramName);
          }
        }
        return { cleanUrl: u.toString(), extractedHeaders };
      } catch {
        return { cleanUrl: rawUrlStr, extractedHeaders: {} };
      }
    }
    function isEligibleForBatchHttpAuth(canonicalUrl) {
      const urlInfo = classifyHttpServerUrl(canonicalUrl);
      return Boolean(urlInfo.ok && !urlInfo.isInsecureRemoteHttp);
    }
    function redactSensitiveUrl(rawUrlStr) {
      if (typeof rawUrlStr !== 'string' || !rawUrlStr.trim()) return '';
      try {
        const u = new URL(rawUrlStr.trim());
        const hadUserInfo = Boolean(u.username || u.password);
        u.username = '';
        u.password = '';
        const qKeys = [];
        u.searchParams.forEach((_val, key) => {
          qKeys.push(key);
        });
        for (let i = 0; i < qKeys.length; i++) {
          const key = qKeys[i];
          if (SENSITIVE_QUERY_PARAM_RE.test(key)) {
            u.searchParams.set(key, '[REDACTED]');
          }
        }
        if (u.hash && u.hash.length > 1 && u.hash.includes('=')) {
          const hp = new URLSearchParams(u.hash.slice(1));
          let changed = false;
          const hKeys = [];
          hp.forEach((_val, key) => {
            hKeys.push(key);
          });
          for (let i = 0; i < hKeys.length; i++) {
            const key = hKeys[i];
            if (SENSITIVE_QUERY_PARAM_RE.test(key)) {
              hp.set(key, '[REDACTED]');
              changed = true;
            }
          }
          if (changed) {
            u.hash = `#${hp.toString()}`;
          }
        }
        let formatted = u.toString().replace(/%5BREDACTED%5D/gi, '[REDACTED]');
        if (hadUserInfo) {
          formatted = formatted.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)/, '$1***@');
        }
        return formatted;
      } catch {
        return redactSensitiveText(rawUrlStr);
      }
    }
    function redactSensitiveText(rawText) {
      if (typeof rawText !== 'string' || !rawText) return '';
      return rawText
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi, '$1 [REDACTED]')
        .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s:@]+(?::[^/\s@]*)?)@/g, '$1***@')
        .replace(
          /([?&#](?:access_token|id_token|refresh_token|auth_token|bearer|api_key|apikey|token|secret|client_secret|code|key|password)=)[^&#\s]+/gi,
          '$1[REDACTED]'
        );
    }
    module.exports = {
      SENSITIVE_QUERY_PARAM_RE,
      toUtf8Bytes,
      fromUtf8Bytes,
      encodeBytesToBase64,
      decodeBase64ToBytes,
      encodeBase64,
      decodeBase64,
      mergeHeadersCaseInsensitive,
      parseKeyValueInput,
      formatKeyValueForInput,
      formatKeyValueForEditor: formatKeyValueForInput,
      extractAuthFromSpec,
      buildAuthHeaders,
      normalizeQuickAuthToken,
      extractUrlAuthAndCleanUrl,
      isEligibleForBatchHttpAuth,
      redactSensitiveUrl,
      redactSensitiveText,
    };
  },
  "./core/schema/server-spec": function(module, exports, __require) {
    const require = (spec) => __require("./core/schema", spec);
    'use strict';
    const {
      deriveServerNameFromUrl,
      deriveServerNameFromCommandAndArgs,
    } = require('./presets');
    const {
      SENSITIVE_QUERY_PARAM_RE,
      mergeHeadersCaseInsensitive,
      parseKeyValueInput,
      buildAuthHeaders,
      extractUrlAuthAndCleanUrl,
    } = require('./auth-codec');
    const { parseJsonc } = require('./jsonc-codec');
    const {
      isLoopbackHostname,
      classifyHttpServerUrl,
    } = require('../security/url-policy');
    const DANGEROUS_ENV_KEYS = new Set([
      'LD_PRELOAD',
      'LD_LIBRARY_PATH',
      'LD_AUDIT',
      'DYLD_INSERT_LIBRARIES',
      'DYLD_LIBRARY_PATH',
      'DYLD_FRAMEWORK_PATH',
      'DYLD_FALLBACK_LIBRARY_PATH',
      'NODE_OPTIONS',
      'ELECTRON_RUN_AS_NODE',
      'ELECTRON_NO_ASAR',
      'PYTHONSTARTUP',
      'PYTHONPATH',
      'RUBYOPT',
      'PERL5OPT',
      'JAVA_TOOL_OPTIONS',
      'BASH_ENV',
      'ENV',
      'ZDOTDIR',
      'PROMPT_COMMAND',
    ]);
    let registeredSmartFallback = null;
    function registerSmartInputFallback(fn) {
      if (typeof fn === 'function') {
        registeredSmartFallback = fn;
      }
    }
    function isPlainObject(val) {
      return Boolean(val && typeof val === 'object' && !Array.isArray(val));
    }
    function isLoopbackHost(hostname) {
      return isLoopbackHostname(hostname);
    }
    function hasPathEnvOverride(envMap) {
      if (!envMap || typeof envMap !== 'object') return false;
      return Object.keys(envMap).some((k) => String(k || '').trim().toUpperCase() === 'PATH');
    }
    function validateSafeEnvMap(envMap, { confirmPathOverride = false } = {}) {
      if (!envMap || typeof envMap !== 'object') return { ok: true, warnings: [] };
      const blocked = [];
      let hasPathOverride = false;
      for (const rawKey of Object.keys(envMap)) {
        const upper = String(rawKey || '').trim().toUpperCase();
        if (!upper) continue;
        if (DANGEROUS_ENV_KEYS.has(upper)) {
          blocked.push(rawKey);
        } else if (upper === 'PATH') {
          hasPathOverride = true;
        }
      }
      if (blocked.length > 0) {
        return {
          ok: false,
          code: 'DANGEROUS_ENV_BLOCKED',
          blockedKeys: blocked,
          error: `Blocked unsafe environment variable(s): ${blocked.join(', ')}. Loader/runtime hijack variables are not permitted.`,
        };
      }
      if (hasPathOverride && !confirmPathOverride) {
        return {
          ok: false,
          code: 'PATH_OVERRIDE_CONFIRM_REQUIRED',
          requiresConfirmation: true,
          error: 'Overriding PATH in server environment can hijack executable lookup. Confirm explicitly to save.',
        };
      }
      return {
        ok: true,
        warnings: hasPathOverride ? ['PATH_OVERRIDE'] : [],
      };
    }
    function extractAndValidateTransport(spec) {
      if (!isPlainObject(spec)) {
        return {
          ok: false,
          code: 'INVALID_SERVER_SPEC',
          error: 'Server configuration must be a plain JSON object.',
        };
      }
      if (spec.command !== undefined && typeof spec.command !== 'string') {
        return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"command" must be a string when specified.' };
      }
      if (spec.url !== undefined && typeof spec.url !== 'string') {
        return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"url" must be a string when specified.' };
      }
      if (spec.serverUrl !== undefined && typeof spec.serverUrl !== 'string') {
        return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"serverUrl" must be a string when specified.' };
      }
      if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.some((a) => typeof a !== 'string'))) {
        return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"args" must be an array of strings when specified.' };
      }
      if (spec.env !== undefined && !isPlainObject(spec.env)) {
        return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"env" must be a plain JSON object when specified.' };
      }
      if (spec.headers !== undefined && !isPlainObject(spec.headers)) {
        return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"headers" must be a plain JSON object when specified.' };
      }
      if (spec.oauth !== undefined && !isPlainObject(spec.oauth)) {
        return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"oauth" must be a plain JSON object when specified.' };
      }
      const u1 = typeof spec.url === 'string' ? spec.url.trim() : '';
      const u2 = typeof spec.serverUrl === 'string' ? spec.serverUrl.trim() : '';
      if (u1 !== '' && u2 !== '' && u1 !== u2) {
        return {
          ok: false,
          code: 'CONFLICTING_SERVER_URLS',
          error: 'Conflicting non-empty "url" and "serverUrl" fields are not permitted (Split-URL blocked).',
        };
      }
      const canonicalUrl = u1 || u2;
      const command = typeof spec.command === 'string' ? spec.command.trim() : '';
      const hasCommand = command.length > 0;
      if (hasCommand && canonicalUrl !== '') {
        return {
          ok: false,
          code: 'AMBIGUOUS_TRANSPORT_SPEC',
          error: 'Ambiguous server configuration: "command" (stdio) and "url"/"serverUrl" (HTTP) cannot coexist.',
        };
      }
      if (!hasCommand && canonicalUrl === '') {
        return {
          ok: false,
          code: 'MISSING_TRANSPORT_SPEC',
          error: 'Server configuration must specify a non-empty "command" (stdio) or "url" (Streamable HTTP).',
        };
      }
      if (hasCommand) {
        return {
          ok: true,
          transport: 'stdio',
          command,
          canonicalUrl: '',
          urlKey: null,
          urlInfo: null,
        };
      }
      const urlInfo = classifyHttpServerUrl(canonicalUrl);
      if (!urlInfo.ok) {
        return {
          ok: false,
          code: urlInfo.code || 'INVALID_SERVER_URL',
          error: urlInfo.error,
        };
      }
      const urlKey = u1 === '' && u2 !== '' ? 'serverUrl' : 'url';
      return {
        ok: true,
        transport: 'http',
        command: '',
        canonicalUrl: urlInfo.href,
        rawCanonicalUrl: canonicalUrl,
        urlKey,
        urlInfo,
      };
    }
    function specCarriesHttpCredentials(spec, urlInfo) {
      if (urlInfo && urlInfo.hasEmbeddedCredentials) return true;
      if (urlInfo && urlInfo.parsed) {
        let hasQuerySecret = false;
        urlInfo.parsed.searchParams.forEach((val, key) => {
          if (val && SENSITIVE_QUERY_PARAM_RE.test(key)) {
            hasQuerySecret = true;
          }
        });
        if (hasQuerySecret) return true;
      }
      if (isPlainObject(spec.headers)) {
        for (const [k, v] of Object.entries(spec.headers)) {
          const cleanVal = String(v ?? '').trim();
          if (!cleanVal) continue;
          if (
            /^(?:authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|x-mcp-token|x-access-token)$/i.test(k) ||
            /(?:token|secret|key|auth|bearer|cookie|session|password)/i.test(k) ||
            /^(?:Bearer|Basic)\s+\S+/i.test(cleanVal)
          ) {
            return true;
          }
        }
      }
      if (
        spec.authMode === 'bearer' ||
        spec.authMode === 'apiKey' ||
        spec.authMode === 'basic' ||
        spec.authMode === 'oauth'
      ) {
        return true;
      }
      if (isPlainObject(spec.oauth) && (spec.oauth.clientId || spec.oauth.clientSecret)) {
        return true;
      }
      return false;
    }
    function assertServerSpecSecurity(spec, opts = {}) {
      const tr = extractAndValidateTransport(spec);
      if (!tr.ok) return tr;
      const envCheck = validateSafeEnvMap(spec.env, {
        confirmPathOverride: Boolean(opts.confirmPathOverride),
      });
      if (!envCheck.ok) return envCheck;
      const warnings = [...envCheck.warnings];
      if (tr.transport === 'http') {
        const hasCredentials = specCarriesHttpCredentials(spec, tr.urlInfo);
        if (tr.urlInfo.isInsecureRemoteHttp) {
          if (hasCredentials) {
            return {
              ok: false,
              code: 'INSECURE_HTTP_CREDENTIALS_BLOCKED',
              error:
                'Sending authentication credentials or OAuth tokens over non-loopback plaintext http:// is blocked. Use https:// or loopback (localhost / 127.0.0.1 / [::1]).',
            };
          }
          if (!opts.allowInsecureHttp) {
            return {
              ok: false,
              code: 'INSECURE_HTTP_CONFIRM_REQUIRED',
              requiresConfirmation: true,
              error:
                'Plaintext non-loopback http:// MCP URLs expose traffic without TLS. Use https:// or confirm insecure HTTP explicitly.',
            };
          }
          warnings.push('INSECURE_HTTP');
        }
      }
      const normalizedSpec = { ...spec };
      if (tr.transport === 'http') {
        delete normalizedSpec.command;
        delete normalizedSpec.url;
        delete normalizedSpec.serverUrl;
        normalizedSpec[tr.urlKey] = tr.rawCanonicalUrl;
        if (isPlainObject(normalizedSpec.headers)) {
          const mergedHdrs = mergeHeadersCaseInsensitive(normalizedSpec.headers);
          if (Object.keys(mergedHdrs).length > 0) {
            normalizedSpec.headers = mergedHdrs;
          } else {
            delete normalizedSpec.headers;
          }
        }
      } else {
        delete normalizedSpec.url;
        delete normalizedSpec.serverUrl;
        normalizedSpec.command = tr.command;
      }
      return {
        ok: true,
        transport: tr.transport,
        canonicalUrl: tr.canonicalUrl,
        urlKey: tr.urlKey,
        urlInfo: tr.urlInfo,
        spec: normalizedSpec,
        warnings,
      };
    }
    function validateHttpEndpointSecurity(cleanUrl, { hasCredentials, allowInsecureHttp }) {
      const urlInfo = classifyHttpServerUrl(cleanUrl);
      if (!urlInfo.ok) {
        return { ok: false, code: urlInfo.code, error: 'Remote MCP Server URL is not a valid HTTP/HTTPS URL.' };
      }
      if (urlInfo.isInsecureRemoteHttp) {
        if (hasCredentials || urlInfo.hasEmbeddedCredentials) {
          return {
            ok: false,
            code: 'INSECURE_HTTP_CREDENTIALS_BLOCKED',
            error:
              'Sending authentication credentials or OAuth tokens over non-loopback plaintext http:// is blocked. Use https:// or loopback (localhost / 127.0.0.1 / [::1]).',
          };
        }
        if (!allowInsecureHttp) {
          return {
            ok: false,
            code: 'INSECURE_HTTP_CONFIRM_REQUIRED',
            requiresConfirmation: true,
            error:
              'Plaintext non-loopback http:// MCP URLs expose traffic without TLS. Use https:// or confirm insecure HTTP explicitly.',
          };
        }
        return { ok: true, warnings: ['INSECURE_HTTP'] };
      }
      return { ok: true, warnings: [] };
    }
    function parseArgsInput(raw) {
      if (Array.isArray(raw)) {
        return raw.filter((x) => x !== null && x !== undefined).map((x) => String(x));
      }
      if (typeof raw !== 'string') return [];
      const trimmed = raw.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed.filter((x) => x !== null && x !== undefined).map((x) => String(x));
          }
        } catch {}
      }
      if (trimmed.includes('\n')) {
        return trimmed
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
      }
      const tokens = [];
      const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
      let match;
      while ((match = re.exec(trimmed)) !== null) {
        if (match[1] !== undefined) {
          tokens.push(match[1].replace(/\\(["\\])/g, '$1'));
        } else if (match[2] !== undefined) {
          tokens.push(match[2].replace(/\\(['\\])/g, '$1'));
        } else {
          tokens.push(match[3]);
        }
      }
      return tokens;
    }
    function formatArgsForInput(args) {
      if (!Array.isArray(args) || args.length === 0) return '';
      return args.join('\n');
    }
    function detectTransport(spec) {
      const tr = extractAndValidateTransport(spec);
      if (tr.ok) return tr.transport;
      if (spec && typeof spec === 'object') {
        if ((typeof spec.url === 'string' && spec.url.trim()) || (typeof spec.serverUrl === 'string' && spec.serverUrl.trim())) {
          return 'http';
        }
      }
      return 'stdio';
    }
    function validateAndBuildServerSpec(
      {
        serverName,
        description,
        transport,
        command,
        args,
        argsText,
        env,
        envText,
        cwd,
        urlKey,
        url,
        serverUrl,
        headers,
        headersText,
        authMode,
        oauth,
        oauthClientMode,
        oauthClientId,
        oauthClientSecret,
        oauthScopes,
        bearerToken,
        apiKeyHeader,
        apiKeyValue,
        basicUser,
        basicPass,
        disabled,
        confirmPathOverride = false,
        allowInsecureHttp = false,
        existingSpec,
      },
      externalExistingSpec
    ) {
      let effectiveConfirmPath = Boolean(confirmPathOverride);
      let effectiveAllowInsecureHttp = Boolean(allowInsecureHttp);
      let effectiveExternalExisting = externalExistingSpec;
      if (
        isPlainObject(externalExistingSpec) &&
        ('allowInsecureHttp' in externalExistingSpec ||
          'confirmPathOverride' in externalExistingSpec ||
          'existingSpec' in externalExistingSpec) &&
        !('command' in externalExistingSpec || 'url' in externalExistingSpec || 'serverUrl' in externalExistingSpec)
      ) {
        effectiveConfirmPath = Boolean(effectiveConfirmPath || externalExistingSpec.confirmPathOverride);
        effectiveAllowInsecureHttp = Boolean(effectiveAllowInsecureHttp || externalExistingSpec.allowInsecureHttp);
        effectiveExternalExisting = externalExistingSpec.existingSpec;
      }
      confirmPathOverride = effectiveConfirmPath;
      allowInsecureHttp = effectiveAllowInsecureHttp;
      const preU1 = typeof url === 'string' ? url.trim() : '';
      const preU2 = typeof serverUrl === 'string' ? serverUrl.trim() : '';
      if (preU1 && preU2 && preU1 !== preU2) {
        return {
          ok: false,
          code: 'CONFLICTING_SERVER_URLS',
          error: 'Conflicting non-empty "url" and "serverUrl" fields are not permitted (Split-URL blocked).',
        };
      }
      let cleanName = typeof serverName === 'string' ? serverName.trim() : '';
      const rawCmd = typeof command === 'string' ? command.trim() : '';
      const rawUrl = preU1 || preU2;
      const rawArgsStr =
        typeof args === 'string' ? args.trim() : typeof argsText === 'string' ? argsText.trim() : '';
      if (registeredSmartFallback) {
        if (/^https?:\/\/\S+$/i.test(cleanName) && !rawUrl) {
          return registeredSmartFallback(cleanName, bearerToken || apiKeyValue || '');
        }
        if (transport !== 'http' && !rawUrl) {
          if (/^https?:\/\/\S+$/i.test(rawCmd)) {
            const smart = registeredSmartFallback(rawCmd, bearerToken || apiKeyValue || '');
            if (smart.ok) {
              if (cleanName && /^[a-zA-Z0-9._-]+$/.test(cleanName)) smart.serverName = cleanName;
              return smart;
            }
          }
          if ((rawCmd === 'npx' || !rawCmd) && /^https?:\/\/\S+$/i.test(rawArgsStr)) {
            const smart = registeredSmartFallback(rawArgsStr, bearerToken || apiKeyValue || '');
            if (smart.ok) {
              if (cleanName && /^[a-zA-Z0-9._-]+$/.test(cleanName)) smart.serverName = cleanName;
              return smart;
            }
          }
          if (rawCmd.includes(' ') && !rawArgsStr) {
            const smart = registeredSmartFallback(rawCmd, bearerToken || apiKeyValue || '');
            if (smart.ok) {
              if (cleanName && /^[a-zA-Z0-9._-]+$/.test(cleanName)) smart.serverName = cleanName;
              return smart;
            }
          }
        }
      }
      if (!cleanName) {
        if (transport === 'http' || /^https?:\/\/.+/i.test(rawUrl)) {
          cleanName = deriveServerNameFromUrl(rawUrl);
        } else {
          const parsedArgsCandidate = parseArgsInput(args !== undefined ? args : argsText);
          cleanName = deriveServerNameFromCommandAndArgs(command, parsedArgsCandidate);
        }
      }
      if (!cleanName) {
        return { ok: false, error: 'Server name is required (e.g. "filesystem" or "my-mcp-server").' };
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(cleanName)) {
        return {
          ok: false,
          error: 'Server name may only contain letters, numbers, hyphens (-), underscores (_), and dots (.).',
        };
      }
      const resolvedExisting = existingSpec || effectiveExternalExisting;
      const base = isPlainObject(resolvedExisting) ? { ...resolvedExisting } : {};
      const usesServerUrlAlias = Boolean(
        urlKey === 'serverUrl' ||
          (preU1 === '' && preU2 !== '') ||
          (resolvedExisting &&
            typeof resolvedExisting.serverUrl === 'string' &&
            resolvedExisting.serverUrl.trim() &&
            !resolvedExisting.url)
      );
      delete base.command;
      delete base.args;
      delete base.env;
      delete base.url;
      delete base.serverUrl;
      delete base.headers;
      delete base.oauth;
      delete base.authMode;
      delete base.apiKeyHeader;
      delete base.description;
      delete base.disabled;
      if (cwd !== undefined) {
        delete base.cwd;
      }
      const cleanDesc = typeof description === 'string' ? description.trim() : '';
      if (transport === 'http') {
        if (rawCmd) {
          return {
            ok: false,
            code: 'AMBIGUOUS_TRANSPORT_SPEC',
            error: 'Ambiguous server configuration: "command" (stdio) and "url" (HTTP) cannot coexist.',
          };
        }
        if (!rawUrl) {
          return {
            ok: false,
            code: 'MISSING_TRANSPORT_SPEC',
            error: 'Remote MCP Server URL is required for Streamable HTTP transport.',
          };
        }
        if (!/^https?:\/\/.+/i.test(rawUrl)) {
          return {
            ok: false,
            code: 'INVALID_SERVER_URL',
            error: 'Remote MCP Server URL must start with https:// or http://.',
          };
        }
        const { cleanUrl, extractedHeaders } = extractUrlAuthAndCleanUrl(rawUrl);
        const manualHeaders = parseKeyValueInput(headers !== undefined ? headers : headersText, {
          caseInsensitiveKeys: true,
        });
        const effectiveAuthMode =
          extractedHeaders.Authorization &&
          (!authMode || authMode === 'oauth' || authMode === 'oauth_or_none' || authMode === 'none')
            ? ''
            : authMode;
        const combinedBaseHeaders = mergeHeadersCaseInsensitive(extractedHeaders, manualHeaders);
        const finalHeaders = buildAuthHeaders({
          authMode: effectiveAuthMode,
          bearerToken,
          apiKeyHeader,
          apiKeyValue,
          basicUser,
          basicPass,
          baseHeaders: combinedBaseHeaders,
        });
        const cId =
          typeof oauthClientId === 'string'
            ? oauthClientId.trim()
            : typeof oauth?.clientId === 'string'
              ? oauth.clientId.trim()
              : '';
        const cSec =
          typeof oauthClientSecret === 'string'
            ? oauthClientSecret.trim()
            : typeof oauth?.clientSecret === 'string'
              ? oauth.clientSecret.trim()
              : '';
        const cScopes =
          typeof oauthScopes === 'string'
            ? oauthScopes.trim()
            : Array.isArray(oauth?.scopes)
              ? oauth.scopes.join(' ').trim()
              : typeof oauth?.scopes === 'string'
                ? oauth.scopes.trim()
                : '';
        const hasExplicitFormCredentials =
          Object.keys(finalHeaders).length > 0 ||
          authMode === 'bearer' ||
          authMode === 'apiKey' ||
          authMode === 'basic' ||
          authMode === 'oauth' ||
          Boolean(cId || cSec);
        const httpSec = validateHttpEndpointSecurity(cleanUrl, {
          hasCredentials: hasExplicitFormCredentials,
          allowInsecureHttp,
        });
        if (!httpSec.ok) {
          return httpSec;
        }
        const spec = {
          ...base,
          [usesServerUrlAlias ? 'serverUrl' : 'url']: cleanUrl,
        };
        if (cleanDesc) {
          spec.description = cleanDesc;
        }
        if (Object.keys(finalHeaders).length > 0) {
          spec.headers = finalHeaders;
        }
        if ((authMode === 'none' || authMode === 'oauth_or_none') && !extractedHeaders.Authorization) {
          spec.authMode = authMode;
        } else if (authMode === 'apiKey') {
          spec.authMode = 'apiKey';
          const cleanHdr =
            typeof apiKeyHeader === 'string' && apiKeyHeader.trim() ? apiKeyHeader.trim() : 'X-API-Key';
          spec.apiKeyHeader = cleanHdr;
        }
        if (
          (authMode === 'oauth' || authMode === 'oauth_or_none' || !authMode) &&
          (oauthClientMode === 'custom' || cId || cSec || cScopes)
        ) {
          const oauthObj = {};
          if (oauthClientMode !== 'auto') {
            if (cId) oauthObj.clientId = cId;
            if (cSec) oauthObj.clientSecret = cSec;
          }
          if (cScopes) oauthObj.scopes = cScopes.split(/[\s,]+/).filter(Boolean);
          if (Object.keys(oauthObj).length > 0) {
            spec.oauth = oauthObj;
          }
        }
        if (disabled) {
          spec.disabled = true;
        }
        const finalGate = assertServerSpecSecurity(spec, {
          confirmPathOverride,
          allowInsecureHttp,
        });
        if (!finalGate.ok) {
          return finalGate;
        }
        return {
          ok: true,
          serverName: cleanName,
          spec: finalGate.spec,
          warnings: finalGate.warnings,
        };
      }
      if (rawUrl) {
        return {
          ok: false,
          code: 'AMBIGUOUS_TRANSPORT_SPEC',
          error: 'Ambiguous server configuration: "command" (stdio) and "url" (HTTP) cannot coexist.',
        };
      }
      if (!rawCmd) {
        return {
          ok: false,
          code: 'MISSING_TRANSPORT_SPEC',
          error: 'Executable command is required for Stdio transport (e.g. "npx", "node", "uvx").',
        };
      }
      const parsedArgs = parseArgsInput(args !== undefined ? args : argsText);
      const parsedEnv = parseKeyValueInput(env !== undefined ? env : envText);
      if (authMode === 'bearer' && typeof bearerToken === 'string' && bearerToken.trim()) {
        const cleanTok = bearerToken.trim().replace(/^Bearer\s+/i, '');
        if (cleanTok && !parsedEnv.MCP_AUTH_TOKEN) {
          parsedEnv.MCP_AUTH_TOKEN = cleanTok;
        }
      } else if (authMode === 'apiKey' && typeof apiKeyValue === 'string' && apiKeyValue.trim()) {
        const envKey =
          typeof apiKeyHeader === 'string' && apiKeyHeader.trim()
            ? apiKeyHeader.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
            : 'MCP_API_KEY';
        parsedEnv[envKey] = apiKeyValue.trim();
      }
      const cleanCwd = typeof cwd === 'string' ? cwd.trim() : '';
      const spec = {
        ...base,
        command: rawCmd,
      };
      if (cleanDesc) {
        spec.description = cleanDesc;
      }
      if (parsedArgs.length > 0) {
        spec.args = parsedArgs;
      }
      if (Object.keys(parsedEnv).length > 0) {
        spec.env = parsedEnv;
      }
      if (cleanCwd) {
        spec.cwd = cleanCwd;
      }
      if (disabled) {
        spec.disabled = true;
      }
      const finalGate = assertServerSpecSecurity(spec, {
        confirmPathOverride,
        allowInsecureHttp,
      });
      if (!finalGate.ok) {
        return finalGate;
      }
      return {
        ok: true,
        serverName: cleanName,
        spec: finalGate.spec,
        requiresConfirmation: true,
        warnings: finalGate.warnings,
      };
    }
    function normalizeMcpConfigObject(raw, options = {}) {
      let parsed = raw;
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) {
          return { ok: true, config: { mcpServers: {} } };
        }
        const jsoncRes = parseJsonc(trimmed);
        if (!jsoncRes.ok) {
          return { ok: false, error: jsoncRes.error };
        }
        parsed = jsoncRes.value;
      }
      if (!isPlainObject(parsed)) {
        return { ok: false, error: 'MCP config root must be a JSON object.' };
      }
      let serversMap = parsed.mcpServers;
      if (!isPlainObject(serversMap)) {
        const keys = Object.keys(parsed);
        const looksLikeDirectServerMap =
          keys.length > 0 &&
          keys.every(
            (k) =>
              isPlainObject(parsed[k]) &&
              ('command' in parsed[k] || 'url' in parsed[k] || 'serverUrl' in parsed[k])
          );
        if (looksLikeDirectServerMap) {
          serversMap = parsed;
          parsed = { mcpServers: { ...serversMap } };
        } else if (parsed.mcpServers === undefined) {
          parsed = { ...parsed, mcpServers: {} };
        } else {
          return {
            ok: false,
            error: '"mcpServers" must be a JSON object mapping server names to configurations.',
          };
        }
      } else {
        parsed = { ...parsed, mcpServers: { ...parsed.mcpServers } };
      }
      const enforceFullSecurity = Boolean(options.enforceSecurity || options.enforceEnvSecurity);
      const normalizedServers = {};
      for (const [name, rawSpec] of Object.entries(parsed.mcpServers)) {
        const tr = extractAndValidateTransport(rawSpec);
        if (!tr.ok) {
          return {
            ok: false,
            code: tr.code,
            error: `Server "${name}": ${tr.error}`,
          };
        }
        if (enforceFullSecurity) {
          const sec = assertServerSpecSecurity(rawSpec, {
            confirmPathOverride: Boolean(options.confirmPathOverride),
            allowInsecureHttp: Boolean(options.allowInsecureHttp),
          });
          if (!sec.ok) {
            return {
              ...sec,
              error: `Server "${name}": ${sec.error}`,
            };
          }
          normalizedServers[name] = sec.spec;
        } else {
          const cleaned = { ...rawSpec };
          if (tr.transport === 'http') {
            delete cleaned.command;
            delete cleaned.url;
            delete cleaned.serverUrl;
            cleaned[tr.urlKey] = tr.rawCanonicalUrl;
          } else {
            delete cleaned.url;
            delete cleaned.serverUrl;
          }
          normalizedServers[name] = cleaned;
        }
      }
      parsed.mcpServers = normalizedServers;
      return { ok: true, config: parsed };
    }
    module.exports = {
      DANGEROUS_ENV_KEYS,
      isPlainObject,
      isLoopbackHost,
      hasPathEnvOverride,
      validateSafeEnvMap,
      extractAndValidateTransport,
      assertServerSpecSecurity,
      validateHttpEndpointSecurity,
      registerSmartInputFallback,
      parseArgsInput,
      formatArgsForInput,
      formatArgsForEditor: formatArgsForInput,
      detectTransport,
      validateAndBuildServerSpec,
      normalizeMcpConfigObject,
    };
  },
  "./core/schema/smart-parser": function(module, exports, __require) {
    const require = (spec) => __require("./core/schema", spec);
    'use strict';
    const presets = require('./presets');
    const authCodec = require('./auth-codec');
    const serverSpec = require('./server-spec');
    const jsoncCodec = require('./jsonc-codec');
    const {
      KNOWN_UVX_PACKAGES,
      sanitizeServerName,
      deriveServerNameFromUrl,
      deriveServerNameFromCommandAndArgs,
    } = presets;
    const {
      mergeHeadersCaseInsensitive,
      parseKeyValueInput,
      normalizeQuickAuthToken,
      extractUrlAuthAndCleanUrl,
    } = authCodec;
    const {
      isPlainObject,
      registerSmartInputFallback,
      parseArgsInput,
      extractAndValidateTransport,
      assertServerSpecSecurity,
      validateAndBuildServerSpec,
      normalizeMcpConfigObject,
    } = serverSpec;
    const { parseJsonc } = jsoncCodec;
    function hasUnquotedShellChaining(raw) {
      const s = String(raw ?? '');
      let inSingle = false;
      let inDouble = false;
      let escaped = false;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        const next = i + 1 < s.length ? s[i + 1] : '';
        if (ch === '\r' || ch === '\n') {
          return true;
        }
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\' && !inSingle) {
          escaped = true;
          continue;
        }
        if (ch === "'" && !inDouble) {
          inSingle = !inSingle;
          continue;
        }
        if (ch === '"' && !inSingle) {
          inDouble = !inDouble;
          continue;
        }
        if (!inSingle && !inDouble) {
          if (ch === ';' || ch === '`' || ch === '|' || ch === '&' || ch === '>' || ch === '<') {
            return true;
          }
          if (ch === '$' && next === '(') {
            return true;
          }
        }
      }
      return false;
    }
    function computeRequiresConfirmation(res) {
      if (!res || !res.ok) return false;
      if (res.requiresConfirmation) return true;
      if (res.spec && typeof res.spec.command === 'string' && res.spec.command.trim()) {
        return true;
      }
      if (isPlainObject(res.multipleServers)) {
        for (const s of Object.values(res.multipleServers)) {
          if (s && typeof s.command === 'string' && s.command.trim()) {
            return true;
          }
        }
      }
      return false;
    }
    function finalizeAndVerifySmartResult(res, quickAuth, inlineHeaders = null, opts = {}) {
      if (!res || !res.ok) return res;
      const authHeaderPatch = quickAuth ? { [quickAuth.headerKey]: quickAuth.headerValue } : null;
      const hasInlineHeaders = isPlainObject(inlineHeaders) && Object.keys(inlineHeaders).length > 0;
      if (isPlainObject(res.multipleServers)) {
        const nextMulti = {};
        for (const [name, rawSpec] of Object.entries(res.multipleServers)) {
          const tr = extractAndValidateTransport(rawSpec);
          if (!tr.ok) return tr;
          const candidate = { ...rawSpec };
          if (tr.transport === 'http' && (hasInlineHeaders || authHeaderPatch)) {
            candidate.headers = mergeHeadersCaseInsensitive(candidate.headers, inlineHeaders, authHeaderPatch);
          } else if (tr.transport === 'stdio' && quickAuth) {
            const env = { ...(candidate.env || {}) };
            const placeholderKey = Object.keys(env).find((k) => /^<.*>$/.test(String(env[k] || '').trim()));
            if (placeholderKey) {
              env[placeholderKey] = quickAuth.rawToken;
            } else {
              env.MCP_AUTH_TOKEN = quickAuth.rawToken;
            }
            candidate.env = env;
          }
          const sec = assertServerSpecSecurity(candidate, {
            confirmPathOverride: Boolean(opts.confirmPathOverride),
            allowInsecureHttp: Boolean(opts.allowInsecureHttp),
          });
          if (!sec.ok) return sec;
          nextMulti[name] = sec.spec;
        }
        res.multipleServers = nextMulti;
        const firstKey = Object.keys(nextMulti)[0];
        if (firstKey) {
          res.serverName = firstKey;
          res.spec = nextMulti[firstKey];
        }
      } else if (isPlainObject(res.spec)) {
        const tr = extractAndValidateTransport(res.spec);
        if (!tr.ok) return tr;
        const candidate = { ...res.spec };
        if (tr.transport === 'http' && (hasInlineHeaders || authHeaderPatch)) {
          candidate.headers = mergeHeadersCaseInsensitive(candidate.headers, inlineHeaders, authHeaderPatch);
        } else if (tr.transport === 'stdio' && quickAuth) {
          const env = { ...(candidate.env || {}) };
          const placeholderKey = Object.keys(env).find((k) => /^<.*>$/.test(String(env[k] || '').trim()));
          if (placeholderKey) {
            env[placeholderKey] = quickAuth.rawToken;
          } else {
            env.MCP_AUTH_TOKEN = quickAuth.rawToken;
          }
          candidate.env = env;
        }
        const sec = assertServerSpecSecurity(candidate, {
          confirmPathOverride: Boolean(opts.confirmPathOverride),
          allowInsecureHttp: Boolean(opts.allowInsecureHttp),
        });
        if (!sec.ok) return sec;
        res.spec = sec.spec;
        res.warnings = sec.warnings;
      }
      res.requiresConfirmation = computeRequiresConfirmation(res);
      return res;
    }
    function parseSmartMcpInput(rawInput, optionalAuthToken = '', options = {}) {
      if (typeof rawInput !== 'string' || !rawInput.trim()) {
        return {
          ok: false,
          error: 'Please enter an MCP server URL, package name, command, or JSON snippet.',
        };
      }
      if (isPlainObject(optionalAuthToken)) {
        options = optionalAuthToken;
        optionalAuthToken = optionalAuthToken.quickAuthInput || optionalAuthToken.authToken || '';
      }
      const trimmed = rawInput.trim();
      const quickAuth = normalizeQuickAuthToken(optionalAuthToken);
      const secOpts = {
        confirmPathOverride: Boolean(options.confirmPathOverride),
        allowInsecureHttp: Boolean(options.allowInsecureHttp),
      };
      if (trimmed.startsWith('{')) {
        const parsedJsonc = parseJsonc(trimmed);
        if (!parsedJsonc.ok) {
          return { ok: false, error: parsedJsonc.error };
        }
        const obj = parsedJsonc.value;
        if (!isPlainObject(obj)) {
          return { ok: false, code: 'INVALID_SERVER_SPEC', error: 'MCP JSON snippet root must be an object.' };
        }
        const isDirectSingleServerCandidate =
          'url' in obj ||
          'serverUrl' in obj ||
          'command' in obj ||
          obj.type === 'http' ||
          obj.type === 'stdio';
        if (isDirectSingleServerCandidate) {
          const rawTr = extractAndValidateTransport(obj);
          if (!rawTr.ok) {
            return rawTr;
          }
          const isHttp = rawTr.transport === 'http';
          const serverName =
            sanitizeServerName(obj.name || obj.serverName) ||
            (isHttp
              ? deriveServerNameFromUrl(rawTr.canonicalUrl)
              : deriveServerNameFromCommandAndArgs(rawTr.command, obj.args));
          const built = validateAndBuildServerSpec({
            serverName,
            description: obj.description,
            transport: rawTr.transport,
            command: rawTr.transport === 'stdio' ? rawTr.command : undefined,
            args: obj.args,
            env: obj.env,
            cwd: obj.cwd,
            url: rawTr.urlKey === 'url' ? rawTr.rawCanonicalUrl : undefined,
            serverUrl: rawTr.urlKey === 'serverUrl' ? rawTr.rawCanonicalUrl : undefined,
            headers: obj.headers,
            oauth: obj.oauth,
            bearerToken: obj.bearerToken || obj.token || '',
            authMode: obj.bearerToken || obj.token ? 'bearer' : obj.authMode,
            apiKeyHeader: obj.apiKeyHeader,
            disabled: Boolean(obj.disabled),
            confirmPathOverride: secOpts.confirmPathOverride,
            allowInsecureHttp: secOpts.allowInsecureHttp,
          });
          return finalizeAndVerifySmartResult(built, quickAuth, null, secOpts);
        }
        const norm = normalizeMcpConfigObject(obj, {
          enforceSecurity: true,
          confirmPathOverride: secOpts.confirmPathOverride,
          allowInsecureHttp: secOpts.allowInsecureHttp,
        });
        if (!norm.ok) {
          return norm;
        }
        if (norm.config && isPlainObject(norm.config.mcpServers)) {
          const entries = Object.entries(norm.config.mcpServers);
          if (entries.length === 0) {
            return { ok: false, code: 'MISSING_TRANSPORT_SPEC', error: 'No MCP server entries found in JSON object.' };
          }
          const [firstName, firstSpec] = entries[0];
          return finalizeAndVerifySmartResult(
            {
              ok: true,
              serverName: firstName,
              spec: firstSpec,
              multipleServers: entries.length > 1 ? norm.config.mcpServers : null,
            },
            quickAuth,
            null,
            secOpts
          );
        }
        return { ok: false, error: 'Could not recognize MCP JSON snippet.' };
      }
      if (hasUnquotedShellChaining(trimmed)) {
        return {
          ok: false,
          code: 'SHELL_METACHAR_BLOCKED',
          error: 'Shell chaining or redirection operators (;, |, &, >, <, `, $(), or newlines) are not allowed in Quick Auto-Add.',
        };
      }
      if (/https?:\/\/\S+/i.test(trimmed) && /\s/.test(trimmed)) {
        const tokens = parseArgsInput(trimmed);
        const firstToken = String(tokens[0] || '');
        const isUrlOrCurlStart = /^https?:\/\/\S+$/i.test(firstToken) || /^curl(?:\.exe)?$/i.test(firstToken);
        const urlToken = tokens.find((t) => /^https?:\/\/\S+$/i.test(t));
        if (urlToken && isUrlOrCurlStart) {
          const rest = tokens.filter((t) => t !== urlToken && !/^curl(?:\.exe)?$/i.test(t));
          let inlineHeaders = {};
          for (let i = 0; i < rest.length; i++) {
            const tk = rest[i];
            if ((tk === '-H' || tk === '--header') && rest[i + 1]) {
              inlineHeaders = mergeHeadersCaseInsensitive(
                inlineHeaders,
                parseKeyValueInput(rest[i + 1], { caseInsensitiveKeys: true })
              );
              i++;
            } else if ((tk === '--token' || tk === '--bearer' || /^bearer$/i.test(tk)) && rest[i + 1]) {
              inlineHeaders = mergeHeadersCaseInsensitive(inlineHeaders, {
                Authorization: `Bearer ${rest[i + 1].replace(/^Bearer\s+/i, '')}`,
              });
              i++;
            } else if ((tk === '--api-key' || tk === '--apikey') && rest[i + 1]) {
              inlineHeaders = mergeHeadersCaseInsensitive(inlineHeaders, {
                'X-API-Key': rest[i + 1],
              });
              i++;
            } else if (rest.length === 1 && !tk.startsWith('-')) {
              const parsedAuth = normalizeQuickAuthToken(tk);
              if (parsedAuth) {
                inlineHeaders = mergeHeadersCaseInsensitive(inlineHeaders, {
                  [parsedAuth.headerKey]: parsedAuth.headerValue,
                });
              }
            }
          }
          const baseRes = parseSmartMcpInput(urlToken, '', secOpts);
          return finalizeAndVerifySmartResult(baseRes, quickAuth, inlineHeaders, secOpts);
        }
      }
      if (/^https?:\/\/\S+$/i.test(trimmed)) {
        try {
          const u = new URL(trimmed);
          const host = u.hostname.toLowerCase();
          if (host === 'github.com' || host === 'www.github.com') {
            const parts = u.pathname.split('/').filter(Boolean);
            const srcIdx = parts.indexOf('src');
            if (parts[0] === 'modelcontextprotocol' && parts[1] === 'servers' && srcIdx !== -1 && parts[srcIdx + 1]) {
              const subPkg = parts[srcIdx + 1];
              const pkgName = `@modelcontextprotocol/server-${subPkg}`;
              return finalizeAndVerifySmartResult(
                validateAndBuildServerSpec({
                  serverName: sanitizeServerName(subPkg) || 'mcp-server',
                  transport: 'stdio',
                  command: 'npx',
                  args: ['-y', pkgName],
                  confirmPathOverride: secOpts.confirmPathOverride,
                }),
                quickAuth,
                null,
                secOpts
              );
            }
            if (parts.length >= 2) {
              const owner = parts[0];
              const repo = parts[1].replace(/\.git$/i, '');
              return finalizeAndVerifySmartResult(
                validateAndBuildServerSpec({
                  serverName: sanitizeServerName(repo) || sanitizeServerName(owner) || 'github-mcp',
                  transport: 'stdio',
                  command: 'npx',
                  args: ['-y', `github:${owner}/${repo}`],
                  confirmPathOverride: secOpts.confirmPathOverride,
                }),
                quickAuth,
                null,
                secOpts
              );
            }
          }
          if ((host === 'npmjs.com' || host === 'www.npmjs.com') && u.pathname.startsWith('/package/')) {
            const pkgName = u.pathname.slice('/package/'.length).replace(/\/+$/, '');
            if (pkgName) {
              return finalizeAndVerifySmartResult(
                validateAndBuildServerSpec({
                  serverName: deriveServerNameFromCommandAndArgs('npx', [pkgName]),
                  transport: 'stdio',
                  command: 'npx',
                  args: ['-y', pkgName],
                  confirmPathOverride: secOpts.confirmPathOverride,
                }),
                quickAuth,
                null,
                secOpts
              );
            }
          }
          const { cleanUrl, extractedHeaders } = extractUrlAuthAndCleanUrl(trimmed);
          const serverName = deriveServerNameFromUrl(cleanUrl);
          const mergedInitialHeaders = mergeHeadersCaseInsensitive(
            extractedHeaders,
            quickAuth ? { [quickAuth.headerKey]: quickAuth.headerValue } : null
          );
          const built = validateAndBuildServerSpec({
            serverName,
            transport: 'http',
            url: cleanUrl,
            headers: mergedInitialHeaders,
            allowInsecureHttp: secOpts.allowInsecureHttp,
          });
          return finalizeAndVerifySmartResult(built, null, null, secOpts);
        } catch {
          return { ok: false, code: 'INVALID_SERVER_URL', error: 'Invalid URL format.' };
        }
      }
      if (/^(?:@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-._~]+|mcp-server-[a-z0-9-._~]+|[a-z0-9-._~]+-mcp(?:-server)?)(?:@[^\s]+)?$/i.test(trimmed)) {
        const barePkg = trimmed.replace(/@[^@/]+$/, '');
        const isUvx = KNOWN_UVX_PACKAGES.has(barePkg.toLowerCase());
        const command = isUvx ? 'uvx' : 'npx';
        const args = isUvx ? [trimmed] : ['-y', trimmed];
        return finalizeAndVerifySmartResult(
          validateAndBuildServerSpec({
            serverName: deriveServerNameFromCommandAndArgs(command, args),
            transport: 'stdio',
            command,
            args,
            confirmPathOverride: secOpts.confirmPathOverride,
          }),
          quickAuth,
          null,
          secOpts
        );
      }
      const tokens = parseArgsInput(trimmed);
      if (tokens.length > 0) {
        const command = tokens[0];
        const args = tokens.slice(1);
        const serverName = deriveServerNameFromCommandAndArgs(command, args);
        return finalizeAndVerifySmartResult(
          validateAndBuildServerSpec({
            serverName,
            transport: 'stdio',
            command,
            args,
            confirmPathOverride: secOpts.confirmPathOverride,
          }),
          quickAuth,
          null,
          secOpts
        );
      }
      return { ok: false, error: 'Could not recognize MCP server address or command.' };
    }
    registerSmartInputFallback(parseSmartMcpInput);
    module.exports = {
      ...presets,
      ...authCodec,
      ...serverSpec,
      ...jsoncCodec,
      hasUnquotedShellChaining,
      parseSmartMcpInput,
    };
  },
  "./core/mcp-manager-service": function(module, exports, __require) {
    const require = (spec) => __require("./core", spec);
    'use strict';
    const { DisposableStore, toDisposable } = require('./disposable');
    const { AsyncMutex } = require('./async-mutex');
    const { sha256Hex } = require('./sha256');
    const {
      CONFIG_READ_REASONS,
      CONFIG_WRITE_REASONS,
      normalizeAuthorizationCode,
      normalizeConfigReadResult,
      createDefaultPorts,
    } = require('./ports');
    const { validateExternalAuthUrl } = require('./security/url-policy');
    const {
      extractAndValidateTransport,
      assertServerSpecSecurity,
      normalizeMcpConfigObject,
    } = require('./schema/server-spec');
    const { applyJsoncServerMutations } = require('./schema/jsonc-codec');
    const {
      buildAuthHeaders,
      mergeHeadersCaseInsensitive,
      redactSensitiveText,
    } = require('./schema/auth-codec');
    const OAUTH_SESSION_STATES = Object.freeze({
      IDLE: 'IDLE',
      DISCOVERING_AUTH_URL: 'DISCOVERING_AUTH_URL',
      AWAITING_BROWSER_CALLBACK: 'AWAITING_BROWSER_CALLBACK',
      SUBMITTING_CODE: 'SUBMITTING_CODE',
      AUTHORIZED: 'AUTHORIZED',
      FAILED: 'FAILED',
      CANCELLED: 'CANCELLED',
    });
    function createEmptyEditorDraft() {
      return {
        serverName: '',
        originalName: '',
        description: '',
        transport: 'http',
        url: '',
        command: '',
        argsText: '',
        cwd: '',
        envText: '',
        headersText: '',
        authMode: 'oauth',
        oauthClientMode: 'auto',
        oauthClientId: '',
        oauthClientSecret: '',
        oauthScopes: '',
        bearerToken: '',
        apiKeyHeader: 'X-API-Key',
        apiKeyValue: '',
        basicUser: '',
        basicPass: '',
        applyAuthToAllHttp: false,
        confirmPathOverride: false,
        allowInsecureHttp: false,
        disabled: false,
      };
    }
    class McpManagerService {
      constructor(ports = {}) {
        const resolved = createDefaultPorts(ports);
        this._brandProfile = resolved.brandProfile;
        this._configRepo = resolved.configRepo;
        this._mcpRuntime = resolved.mcpRuntime;
        this._oauthBroker = resolved.oauthBroker;
        this._mutex = new AsyncMutex();
        this._disposables = new DisposableStore();
        this._listeners = new Set();
        this._oauthSessionSeq = 0;
        this._activeOAuthStore = null;
        this._state = {
          configStatus: 'IDLE',
          configError: null,
          configReason: null,
          configUri: null,
          configFsPath: null,
          configExists: false,
          configDigest: null,
          config: { mcpServers: {} },
          rawTextDraft: '',
          quickAddInput: '',
          quickAddAuthToken: '',
          pendingCommandConfirmation: null,
          conflictState: null,
          runtimeServers: [],
          editorFormDraft: createEmptyEditorDraft(),
          oauthCodeDraft: '',
          oauthSession: {
            state: OAUTH_SESSION_STATES.IDLE,
            serverName: '',
            authUrl: '',
            error: null,
            seq: 0,
          },
        };
      }
      get brandProfile() {
        return this._brandProfile;
      }
      get isDisposed() {
        return this._disposables.isDisposed;
      }
      getState() {
        return this._state;
      }
      getDraftState() {
        return this._state;
      }
      updateDraftState(patch) {
        if (!patch || typeof patch !== 'object') return this._state;
        const next = { ...this._state };
        if ('quickAddInput' in patch) {
          next.quickAddInput = typeof patch.quickAddInput === 'string' ? patch.quickAddInput : '';
        }
        if ('quickAddAuthToken' in patch) {
          next.quickAddAuthToken = typeof patch.quickAddAuthToken === 'string' ? patch.quickAddAuthToken : '';
        }
        if ('pendingCommandConfirmation' in patch) {
          next.pendingCommandConfirmation = patch.pendingCommandConfirmation || null;
        }
        if ('rawTextDraft' in patch) {
          next.rawTextDraft =
            patch.rawTextDraft === null || patch.rawTextDraft === undefined ? '' : String(patch.rawTextDraft);
        }
        if ('oauthCodeDraft' in patch) {
          next.oauthCodeDraft = typeof patch.oauthCodeDraft === 'string' ? patch.oauthCodeDraft : '';
        }
        if ('editorFormDraft' in patch) {
          next.editorFormDraft =
            patch.editorFormDraft && typeof patch.editorFormDraft === 'object'
              ? { ...patch.editorFormDraft }
              : createEmptyEditorDraft();
        }
        this._state = next;
        this._emit();
        return this._state;
      }
      subscribe(listener) {
        if (typeof listener !== 'function' || this.isDisposed) {
          return toDisposable(null);
        }
        this._listeners.add(listener);
        return this._disposables.add(() => {
          this._listeners.delete(listener);
        });
      }
      _emit() {
        if (this.isDisposed) return;
        const snap = this._state;
        for (const fn of Array.from(this._listeners)) {
          try {
            fn(snap);
          } catch {}
        }
      }
      registerDisposable(item) {
        return this._disposables.add(item);
      }
      updateEditorDraft(patch) {
        if (!patch || typeof patch !== 'object') return;
        this._state = {
          ...this._state,
          editorFormDraft: {
            ...this._state.editorFormDraft,
            ...patch,
          },
        };
        this._emit();
      }
      updateQuickAddDraft(patch) {
        if (!patch || typeof patch !== 'object') return;
        const next = { ...this._state };
        if ('quickAddInput' in patch) {
          next.quickAddInput = typeof patch.quickAddInput === 'string' ? patch.quickAddInput : '';
        }
        if ('quickAddAuthToken' in patch) {
          next.quickAddAuthToken = typeof patch.quickAddAuthToken === 'string' ? patch.quickAddAuthToken : '';
        }
        if ('pendingCommandConfirmation' in patch) {
          next.pendingCommandConfirmation = patch.pendingCommandConfirmation || null;
        }
        this._state = next;
        this._emit();
      }
      setRawTextDraft(rawText) {
        this._state = {
          ...this._state,
          rawTextDraft: typeof rawText === 'string' ? rawText : '',
        };
        this._emit();
      }
      setOAuthCodeDraft(code) {
        this._state = {
          ...this._state,
          oauthCodeDraft: typeof code === 'string' ? code : '',
        };
        this._emit();
      }
      clearSensitiveDrafts({ keepRawIfValid = false } = {}) {
        this._state = {
          ...this._state,
          quickAddInput: '',
          quickAddAuthToken: '',
          pendingCommandConfirmation: null,
          rawTextDraft: keepRawIfValid ? this._state.rawTextDraft : '',
          oauthCodeDraft: '',
          editorFormDraft: createEmptyEditorDraft(),
        };
        this._emit();
        return this._state;
      }
      async resolveMcpConfigUri() {
        if (typeof this._configRepo.resolveConfigUri === 'function') {
          return this._configRepo.resolveConfigUri();
        }
        return null;
      }
      async readMcpConfig() {
        const raw = await this._configRepo.readConfig();
        const repoRes = normalizeConfigReadResult(raw);
        if (!repoRes.ok) {
          this._state = {
            ...this._state,
            configStatus: 'ERROR',
            configReason: repoRes.reason,
            configError: redactSensitiveText(repoRes.error || 'Failed to read mcp_config.json.'),
            configUri: repoRes.uri || this._state.configUri,
            configFsPath: repoRes.fsPath || this._state.configFsPath,
            configDigest: repoRes.digest ?? this._state.configDigest,
          };
          this._emit();
          return {
            ...repoRes,
            code: repoRes.reason,
            config: null,
            servers: {},
          };
        }
        if (!repoRes.exists) {
          const emptyCfg = { mcpServers: {} };
          this._state = {
            ...this._state,
            configStatus: 'MISSING',
            configError: null,
            configReason: null,
            configUri: repoRes.uri || this._state.configUri,
            configFsPath: repoRes.fsPath || this._state.configFsPath,
            configExists: false,
            configDigest: null,
            config: emptyCfg,
            rawTextDraft: '{\n  "mcpServers": {}\n}\n',
            conflictState: null,
          };
          this._emit();
          return {
            ok: true,
            status: 'MISSING',
            exists: false,
            uri: repoRes.uri,
            fsPath: repoRes.fsPath,
            rawText: '',
            digest: null,
            config: emptyCfg,
            servers: emptyCfg.mcpServers,
          };
        }
        const exactRawText = repoRes.rawText;
        const exactDigest = repoRes.digest || sha256Hex(exactRawText);
        if (exactRawText.trim() === '') {
          const emptyCfg = { mcpServers: {} };
          this._state = {
            ...this._state,
            configStatus: 'FOUND',
            configError: null,
            configReason: null,
            configUri: repoRes.uri || this._state.configUri,
            configFsPath: repoRes.fsPath || this._state.configFsPath,
            configExists: true,
            configDigest: exactDigest,
            config: emptyCfg,
            rawTextDraft: exactRawText || '{\n  "mcpServers": {}\n}\n',
            conflictState: null,
          };
          this._emit();
          return {
            ok: true,
            status: 'FOUND',
            exists: true,
            uri: repoRes.uri,
            fsPath: repoRes.fsPath,
            rawText: exactRawText,
            digest: exactDigest,
            config: emptyCfg,
            servers: emptyCfg.mcpServers,
          };
        }
        const norm = normalizeMcpConfigObject(exactRawText);
        if (!norm.ok) {
          const cleanErr = redactSensitiveText(norm.error || 'Invalid JSON/JSONC in mcp_config.json.');
          this._state = {
            ...this._state,
            configStatus: 'ERROR',
            configReason: CONFIG_READ_REASONS.INVALID_JSON,
            configError: cleanErr,
            configUri: repoRes.uri || this._state.configUri,
            configFsPath: repoRes.fsPath || this._state.configFsPath,
            configExists: true,
            configDigest: exactDigest,
            rawTextDraft: exactRawText,
          };
          this._emit();
          return {
            ok: false,
            reason: CONFIG_READ_REASONS.INVALID_JSON,
            code: CONFIG_READ_REASONS.INVALID_JSON,
            validationCode: norm.code,
            exists: true,
            uri: repoRes.uri,
            fsPath: repoRes.fsPath,
            rawText: exactRawText,
            digest: exactDigest,
            config: null,
            servers: {},
            error: cleanErr,
          };
        }
        this._state = {
          ...this._state,
          configStatus: 'FOUND',
          configError: null,
          configReason: null,
          configUri: repoRes.uri || this._state.configUri,
          configFsPath: repoRes.fsPath || this._state.configFsPath,
          configExists: true,
          configDigest: exactDigest,
          config: norm.config,
          rawTextDraft: exactRawText,
          conflictState: null,
        };
        this._emit();
        return {
          ok: true,
          status: 'FOUND',
          exists: true,
          uri: repoRes.uri,
          fsPath: repoRes.fsPath,
          rawText: exactRawText,
          digest: exactDigest,
          config: norm.config,
          servers: norm.config.mcpServers || {},
        };
      }
      async _readMcpConfigUnlocked(lockToken) {
        this._mutex.assertHeld(lockToken);
        return this.readMcpConfig();
      }
      async _writeWithCasUnlocked(lockToken, { uri, rawText, expectedExists, expectedDigest }) {
        this._mutex.assertHeld(lockToken);
        const writeRes = await this._configRepo.writeConfig({
          uri,
          rawText,
          expectedExists,
          expectedDigest,
        });
        if (!writeRes || !writeRes.ok) {
          if (writeRes && writeRes.reason === CONFIG_WRITE_REASONS.CONFLICT) {
            this._state = {
              ...this._state,
              conflictState: {
                reason: CONFIG_WRITE_REASONS.CONFLICT,
                currentExists: Boolean(writeRes.currentExists),
                currentRawText: typeof writeRes.currentRawText === 'string' ? writeRes.currentRawText : null,
                currentDigest: writeRes.currentDigest || null,
              },
              configError: redactSensitiveText(
                writeRes.error || 'mcp_config.json was modified externally. Reload before saving to avoid overwriting changes.'
              ),
            };
            this._emit();
          }
          const reason = writeRes?.reason || CONFIG_WRITE_REASONS.WRITE_FAILED;
          return {
            ok: false,
            persisted: false,
            reason,
            code: reason,
            uri: writeRes?.uri || uri || '',
            currentExists: writeRes?.currentExists,
            currentRawText: writeRes?.currentRawText,
            currentDigest: writeRes?.currentDigest,
            error: redactSensitiveText(writeRes?.error || 'Failed to persist MCP configuration.'),
          };
        }
        const nextDigest = writeRes.digest || sha256Hex(rawText);
        const norm = rawText.trim() === '' ? { ok: true, config: { mcpServers: {} } } : normalizeMcpConfigObject(rawText);
        if (norm.ok) {
          this._state = {
            ...this._state,
            configStatus: 'FOUND',
            configError: null,
            configReason: null,
            configExists: true,
            configUri: writeRes.uri || uri || this._state.configUri,
            configFsPath: writeRes.fsPath || this._state.configFsPath,
            configDigest: nextDigest,
            config: norm.config,
            rawTextDraft: rawText,
            conflictState: null,
          };
          this._emit();
        }
        return {
          ...writeRes,
          ok: true,
          persisted: true,
          rawText,
          digest: nextDigest,
          config: norm.ok ? norm.config : undefined,
        };
      }
      async saveRawConfig(rawText, options = {}) {
        return this._mutex.runExclusive(async (lockToken) => {
          const text = typeof rawText === 'string' ? rawText : '';
          const norm = normalizeMcpConfigObject(text, {
            enforceSecurity: true,
            confirmPathOverride: Boolean(options.confirmPathOverride),
            allowInsecureHttp: Boolean(options.allowInsecureHttp),
          });
          if (!norm.ok) {
            return {
              ok: false,
              persisted: false,
              code: norm.code,
              requiresConfirmation: Boolean(norm.requiresConfirmation),
              error: norm.error,
            };
          }
          const current = await this._readMcpConfigUnlocked(lockToken);
          if (!current.ok && current.reason !== CONFIG_READ_REASONS.INVALID_JSON) {
            return {
              ok: false,
              persisted: false,
              reason: current.reason,
              error: current.error,
            };
          }
          const expectedExists = current.ok ? current.exists : Boolean(current.exists !== false);
          const expectedDigest = options.expectedDigest !== undefined ? options.expectedDigest : current.digest;
          const cleanLf = text.replace(/\r\n?/g, '\n');
          const normalizedOut = cleanLf.trim()
            ? (cleanLf.endsWith('\n') ? cleanLf : `${cleanLf}\n`)
            : `${JSON.stringify(norm.config, null, 2)}\n`;
          const writeRes = await this._writeWithCasUnlocked(lockToken, {
            uri: current.uri,
            rawText: normalizedOut,
            expectedExists,
            expectedDigest,
          });
          if (!writeRes.ok) return writeRes;
          await this._safeRefresh();
          return writeRes;
        });
      }
      async writeMcpConfig(rawOrConfigObj, options = {}) {
        if (typeof rawOrConfigObj === 'string') {
          return this.saveRawConfig(rawOrConfigObj, options);
        }
        return this._mutex.runExclusive(async (lockToken) => {
          const norm = normalizeMcpConfigObject(rawOrConfigObj, {
            enforceSecurity: true,
            confirmPathOverride: Boolean(options.confirmPathOverride),
            allowInsecureHttp: Boolean(options.allowInsecureHttp),
          });
          if (!norm.ok) {
            return {
              ok: false,
              persisted: false,
              code: norm.code,
              requiresConfirmation: Boolean(norm.requiresConfirmation),
              error: norm.error,
            };
          }
          const current = await this._readMcpConfigUnlocked(lockToken);
          if (!current.ok) {
            return {
              ok: false,
              persisted: false,
              reason: current.reason,
              error: current.error,
            };
          }
          const serialized = `${JSON.stringify(norm.config, null, 2)}\n`;
          const writeRes = await this._writeWithCasUnlocked(lockToken, {
            uri: current.uri,
            rawText: serialized,
            expectedExists: current.exists,
            expectedDigest: current.digest,
          });
          if (!writeRes.ok) return writeRes;
          await this._safeRefresh();
          return writeRes;
        });
      }
      async saveServerSpec({
        serverName,
        spec,
        previousServerName = null,
        applyAuthToAllHttp = false,
        sharedAuthHeaders = null,
        authInput = null,
        confirmPathOverride = false,
        allowInsecureHttp = false,
      }) {
        const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
        if (!cleanName) {
          return { ok: false, error: 'Server name is required.' };
        }
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
          return { ok: false, code: 'INVALID_SERVER_SPEC', error: 'Server specification must be an object.' };
        }
        const effectiveSharedHeaders =
          sharedAuthHeaders && typeof sharedAuthHeaders === 'object' && Object.keys(sharedAuthHeaders).length > 0
            ? sharedAuthHeaders
            : authInput && typeof authInput === 'object'
              ? buildAuthHeaders(authInput)
              : spec.headers && typeof spec.headers === 'object' && Object.keys(spec.headers).length > 0
                ? spec.headers
                : null;
        const primarySec = assertServerSpecSecurity(spec, {
          confirmPathOverride: Boolean(confirmPathOverride),
          allowInsecureHttp: Boolean(allowInsecureHttp),
        });
        if (!primarySec.ok) {
          return {
            ok: false,
            persisted: false,
            code: primarySec.code,
            requiresConfirmation: Boolean(primarySec.requiresConfirmation),
            error: primarySec.error,
          };
        }
        return this._mutex.runExclusive(async (lockToken) => {
          const current = await this._readMcpConfigUnlocked(lockToken);
          if (!current.ok) {
            return {
              ok: false,
              persisted: false,
              reason: current.reason,
              error: current.error,
            };
          }
          const mutations = [];
          const prevName = typeof previousServerName === 'string' ? previousServerName.trim() : '';
          if (prevName && prevName !== cleanName && current.config.mcpServers[prevName]) {
            mutations.push({ op: 'delete', name: prevName });
          }
          mutations.push({ op: 'set', name: cleanName, spec: { ...primarySec.spec } });
          const updatedSiblingServers = [];
          const skippedInsecureHttpServers = [];
          if (
            applyAuthToAllHttp &&
            effectiveSharedHeaders &&
            typeof effectiveSharedHeaders === 'object' &&
            Object.keys(effectiveSharedHeaders).length > 0
          ) {
            for (const [sibName, sibSpec] of Object.entries(current.config.mcpServers || {})) {
              if (sibName === cleanName || sibName === prevName) continue;
              const sibTr = extractAndValidateTransport(sibSpec);
              if (!sibTr.ok || sibTr.transport !== 'http') continue;
              if (sibTr.urlInfo.isInsecureRemoteHttp) {
                skippedInsecureHttpServers.push(sibName);
                continue;
              }
              const mergedCandidate = {
                ...sibSpec,
                headers: mergeHeadersCaseInsensitive(sibSpec.headers, effectiveSharedHeaders),
              };
              const sibSec = assertServerSpecSecurity(mergedCandidate, {
                confirmPathOverride: true,
                allowInsecureHttp: false,
              });
              if (!sibSec.ok) {
                return {
                  ok: false,
                  persisted: false,
                  code: sibSec.code,
                  error: `Sibling server "${sibName}": ${sibSec.error}`,
                };
              }
              mutations.push({ op: 'set', name: sibName, spec: sibSec.spec });
              updatedSiblingServers.push(sibName);
            }
          }
          const nextRawText = applyJsoncServerMutations(current.rawText, mutations);
          const writeRes = await this._writeWithCasUnlocked(lockToken, {
            uri: current.uri,
            rawText: nextRawText,
            expectedExists: current.exists,
            expectedDigest: current.digest,
          });
          if (!writeRes.ok) return writeRes;
          await this._safeRefresh(updatedSiblingServers.length > 0 ? undefined : cleanName);
          return {
            ...writeRes,
            ok: true,
            serverName: cleanName,
            updatedSiblingServers,
            skippedInsecureHttpServers,
          };
        });
      }
      async upsertCustomServer(serverName, spec, previousNameOrOptions = null) {
        const previousServerName =
          typeof previousNameOrOptions === 'string'
            ? previousNameOrOptions
            : previousNameOrOptions?.previousServerName || null;
        const confirmPathOverride =
          typeof previousNameOrOptions === 'object' && previousNameOrOptions !== null
            ? Boolean(previousNameOrOptions.confirmPathOverride)
            : false;
        const allowInsecureHttp =
          typeof previousNameOrOptions === 'object' && previousNameOrOptions !== null
            ? Boolean(previousNameOrOptions.allowInsecureHttp)
            : false;
        return this.saveServerSpec({
          serverName,
          spec,
          previousServerName,
          confirmPathOverride,
          allowInsecureHttp,
        });
      }
      async applyAuthToAllHttp(authHeaders, targetServerNames = null) {
        return this.applyAuthHeadersToServers(targetServerNames, authHeaders);
      }
      async applyAuthHeadersToServers(serverNames, authHeaders) {
        if (!authHeaders || typeof authHeaders !== 'object' || Object.keys(authHeaders).length === 0) {
          return { ok: true, persisted: true, updated: [], skippedInsecureHttpServers: [] };
        }
        return this._mutex.runExclusive(async (lockToken) => {
          const current = await this._readMcpConfigUnlocked(lockToken);
          if (!current.ok) {
            return { ok: false, persisted: false, reason: current.reason, error: current.error };
          }
          const targetSet = Array.isArray(serverNames) && serverNames.length > 0 ? new Set(serverNames) : null;
          const mutations = [];
          const updated = [];
          const skippedInsecureHttpServers = [];
          for (const [name, spec] of Object.entries(current.config.mcpServers || {})) {
            if (targetSet && !targetSet.has(name)) continue;
            const tr = extractAndValidateTransport(spec);
            if (!tr.ok || tr.transport !== 'http') continue;
            if (tr.urlInfo.isInsecureRemoteHttp) {
              skippedInsecureHttpServers.push(name);
              continue;
            }
            const candidate = {
              ...spec,
              headers: mergeHeadersCaseInsensitive(spec.headers, authHeaders),
            };
            const sec = assertServerSpecSecurity(candidate, {
              confirmPathOverride: true,
              allowInsecureHttp: false,
            });
            if (!sec.ok) {
              return {
                ok: false,
                persisted: false,
                code: sec.code,
                error: `Server "${name}": ${sec.error}`,
              };
            }
            mutations.push({ op: 'set', name, spec: sec.spec });
            updated.push(name);
          }
          if (mutations.length === 0) {
            return {
              ok: true,
              persisted: false,
              updated: [],
              skippedInsecureHttpServers,
            };
          }
          const nextRawText = applyJsoncServerMutations(current.rawText, mutations);
          const writeRes = await this._writeWithCasUnlocked(lockToken, {
            uri: current.uri,
            rawText: nextRawText,
            expectedExists: current.exists,
            expectedDigest: current.digest,
          });
          if (!writeRes.ok) return writeRes;
          await this._safeRefresh();
          return {
            ...writeRes,
            ok: true,
            updated,
            updatedCount: updated.length,
            skippedInsecureHttpServers,
          };
        });
      }
      async upsertMultipleServers(serversMap, options = {}) {
        if (!serversMap || typeof serversMap !== 'object' || Array.isArray(serversMap)) {
          return { ok: false, error: 'Servers map must be a valid object.' };
        }
        const validatedEntries = [];
        for (const [name, spec] of Object.entries(serversMap)) {
          const cleanName = String(name || '').trim();
          if (!cleanName) continue;
          const sec = assertServerSpecSecurity(spec, {
            confirmPathOverride: Boolean(options.confirmPathOverride),
            allowInsecureHttp: Boolean(options.allowInsecureHttp),
          });
          if (!sec.ok) {
            return {
              ok: false,
              persisted: false,
              code: sec.code,
              requiresConfirmation: Boolean(sec.requiresConfirmation),
              error: `Server "${cleanName}": ${sec.error}`,
            };
          }
          validatedEntries.push({ op: 'set', name: cleanName, spec: sec.spec });
        }
        return this._mutex.runExclusive(async (lockToken) => {
          const current = await this._readMcpConfigUnlocked(lockToken);
          if (!current.ok) {
            return {
              ok: false,
              persisted: false,
              reason: current.reason,
              error: current.error,
            };
          }
          const nextRawText = applyJsoncServerMutations(current.rawText, validatedEntries);
          const writeRes = await this._writeWithCasUnlocked(lockToken, {
            uri: current.uri,
            rawText: nextRawText,
            expectedExists: current.exists,
            expectedDigest: current.digest,
          });
          if (!writeRes.ok) return writeRes;
          await this._safeRefresh();
          return writeRes;
        });
      }
      async deleteServer(serverName) {
        return this.deleteCustomServer(serverName);
      }
      async deleteCustomServer(serverName) {
        const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
        if (!cleanName) {
          return { ok: false, error: 'Server name is required.' };
        }
        return this._mutex.runExclusive(async (lockToken) => {
          const current = await this._readMcpConfigUnlocked(lockToken);
          if (!current.ok) {
            return {
              ok: false,
              persisted: false,
              reason: current.reason,
              error: current.error,
            };
          }
          if (!(cleanName in (current.config.mcpServers || {}))) {
            return {
              ok: false,
              persisted: false,
              error: `Custom server "${cleanName}" was not found in mcp_config.json.`,
            };
          }
          const nextRawText = applyJsoncServerMutations(current.rawText, [{ op: 'delete', name: cleanName }]);
          const writeRes = await this._writeWithCasUnlocked(lockToken, {
            uri: current.uri,
            rawText: nextRawText,
            expectedExists: current.exists,
            expectedDigest: current.digest,
          });
          if (!writeRes.ok) return writeRes;
          await this._safeRefresh(cleanName);
          return { ...writeRes, ok: true, serverName: cleanName };
        });
      }
      async toggleServerEnabled(serverName, enabled) {
        const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
        if (!cleanName) {
          return { ok: false, error: 'Server name is required.' };
        }
        const targetEnabled = Boolean(enabled);
        return this._mutex.runExclusive(async (lockToken) => {
          const current = await this._readMcpConfigUnlocked(lockToken);
          if (!current.ok) {
            return {
              ok: false,
              persisted: false,
              reason: current.reason,
              error: current.error,
            };
          }
          const existingSpec = current.config.mcpServers?.[cleanName];
          let diskWriteDigest = null;
          if (existingSpec && typeof existingSpec === 'object') {
            const updatedSpec = { ...existingSpec };
            if (targetEnabled) {
              delete updatedSpec.disabled;
            } else {
              updatedSpec.disabled = true;
            }
            const nextRawText = applyJsoncServerMutations(current.rawText, [
              { op: 'set', name: cleanName, spec: updatedSpec },
            ]);
            const writeRes = await this._writeWithCasUnlocked(lockToken, {
              uri: current.uri,
              rawText: nextRawText,
              expectedExists: current.exists,
              expectedDigest: current.digest,
            });
            if (!writeRes.ok) {
              return writeRes;
            }
            diskWriteDigest = writeRes.digest;
          }
          if (typeof this._mcpRuntime.toggleServer === 'function') {
            let runtimeRes;
            try {
              runtimeRes = await this._mcpRuntime.toggleServer(cleanName, targetEnabled);
            } catch (err) {
              runtimeRes = {
                ok: false,
                error: err && err.message ? err.message : `Failed to toggle MCP server "${cleanName}".`,
              };
            }
            if (runtimeRes && runtimeRes.ok === false) {
              let reason = 'RUNTIME_SYNC_FAILED';
              let rolledBack = true;
              if (diskWriteDigest !== null) {
                const rb = await this._writeWithCasUnlocked(lockToken, {
                  uri: current.uri,
                  rawText: current.rawText,
                  expectedExists: true,
                  expectedDigest: diskWriteDigest,
                });
                if (rb && rb.ok) {
                  reason = 'RUNTIME_SYNC_FAILED';
                  rolledBack = true;
                } else if (rb && rb.reason === CONFIG_WRITE_REASONS.CONFLICT) {
                  reason = 'ROLLBACK_CONFLICT';
                  rolledBack = false;
                } else {
                  reason = 'ROLLBACK_FAILED';
                  rolledBack = false;
                }
              }
              const resynced = await this._readMcpConfigUnlocked(lockToken);
              await this.fetchServerStates();
              return {
                ok: false,
                reason,
                code: reason,
                rolledBack,
                currentRawText: resynced?.rawText ?? null,
                error: redactSensitiveText(
                  runtimeRes.error || `Runtime failed to toggle MCP server "${cleanName}".`
                ),
              };
            }
          }
          await this._safeRefresh(cleanName);
          return { ok: true, persisted: true, serverName: cleanName, enabled: targetEnabled };
        });
      }
      async toggleServerTool(serverName, toolName, enabled) {
        const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
        const cleanTool = typeof toolName === 'string' ? toolName.trim() : '';
        if (!cleanName || !cleanTool) {
          return { ok: false, error: 'Both serverName and toolName are required.' };
        }
        const targetEnabled = Boolean(enabled);
        return this._mutex.runExclusive(async (lockToken) => {
          const current = await this._readMcpConfigUnlocked(lockToken);
          if (!current.ok) {
            return {
              ok: false,
              persisted: false,
              reason: current.reason,
              error: current.error,
            };
          }
          const existingSpec = current.config.mcpServers?.[cleanName];
          if (!existingSpec || typeof existingSpec !== 'object') {
            return {
              ok: false,
              persisted: false,
              error: `Tool toggling via mcp_config.json is only supported for custom servers in mcp_config.json ("${cleanName}").`,
            };
          }
          const disabledSet = new Set(
            Array.isArray(existingSpec.disabledTools) ? existingSpec.disabledTools.map((t) => String(t)) : []
          );
          if (targetEnabled) {
            disabledSet.delete(cleanTool);
          } else {
            disabledSet.add(cleanTool);
          }
          const updatedSpec = { ...existingSpec };
          if (disabledSet.size > 0) {
            updatedSpec.disabledTools = Array.from(disabledSet);
          } else {
            delete updatedSpec.disabledTools;
          }
          const nextRawText = applyJsoncServerMutations(current.rawText, [
            { op: 'set', name: cleanName, spec: updatedSpec },
          ]);
          const writeRes = await this._writeWithCasUnlocked(lockToken, {
            uri: current.uri,
            rawText: nextRawText,
            expectedExists: current.exists,
            expectedDigest: current.digest,
          });
          if (!writeRes.ok) return writeRes;
          await this._safeRefresh(cleanName);
          return {
            ...writeRes,
            ok: true,
            serverName: cleanName,
            toolName: cleanTool,
            enabled: targetEnabled,
          };
        });
      }
      async fetchServerStates(opts = {}) {
        const res = await this._mcpRuntime.listServerStates(opts);
        const servers = Array.isArray(res)
          ? res
          : Array.isArray(res?.servers)
            ? res.servers
            : Array.isArray(res?.states)
              ? res.states
              : [];
        const ok = !res || res.ok !== false;
        this._state = {
          ...this._state,
          runtimeServers: servers,
        };
        this._emit();
        return {
          ok,
          servers,
          states: servers,
          error: res?.error ? redactSensitiveText(res.error) : undefined,
        };
      }
      async listRuntimeServerStates(opts = {}) {
        return this.fetchServerStates(opts);
      }
      async getMcpServerStates() {
        const res = await this.fetchServerStates();
        return res.servers;
      }
      async refreshServer(serverName) {
        return this._safeRefresh(serverName);
      }
      async refreshServers(serverName) {
        return this._safeRefresh(serverName);
      }
      async discoverOAuthMetadata(serverName, spec = {}) {
        const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
        if (!cleanName) {
          return { ok: false, error: 'Server name is required for OAuth discovery.' };
        }
        const specAuthUrl = String(spec?.oauth?.authUrl || spec?.oauth?.authorizationUrl || '').trim();
        if (specAuthUrl) {
          const check = validateExternalAuthUrl(specAuthUrl);
          if (!check.ok) {
            return { ok: false, code: check.code, error: check.error };
          }
          return { ok: true, authUrl: check.href };
        }
        if (typeof this._oauthBroker.discoverOAuthMetadata === 'function') {
          const disc = await this._oauthBroker.discoverOAuthMetadata(cleanName, spec);
          if (disc && disc.ok && disc.authUrl) {
            const check = validateExternalAuthUrl(disc.authUrl);
            if (!check.ok) {
              return { ok: false, code: check.code, error: check.error };
            }
            return { ok: true, authUrl: check.href };
          }
          return disc || { ok: false, error: 'No OAuth authorization URL advertised by server yet.' };
        }
        if (typeof this._oauthBroker.waitForAuthReadyOrUrl === 'function') {
          const st = await this._oauthBroker.waitForAuthReadyOrUrl(cleanName, 1200, { cancelled: false });
          if (st && st.authUrl) {
            const check = validateExternalAuthUrl(st.authUrl);
            if (!check.ok) {
              return { ok: false, code: check.code, error: check.error };
            }
            return { ok: true, authUrl: check.href };
          }
        }
        return { ok: false, error: 'No OAuth authorization URL advertised by server yet.' };
      }
      beginOAuthSession(serverName, initialAuthUrl = '') {
        this.cancelOAuthSession();
        const seq = ++this._oauthSessionSeq;
        const sessionStore = new DisposableStore();
        this._activeOAuthStore = sessionStore;
        this._disposables.add(sessionStore);
        const nextState = initialAuthUrl
          ? OAUTH_SESSION_STATES.AWAITING_BROWSER_CALLBACK
          : OAUTH_SESSION_STATES.DISCOVERING_AUTH_URL;
        this._state = {
          ...this._state,
          oauthCodeDraft: '',
          oauthSession: {
            state: nextState,
            serverName: String(serverName || '').trim(),
            authUrl: String(initialAuthUrl || '').trim(),
            error: null,
            seq,
          },
        };
        this._emit();
        return {
          seq,
          store: sessionStore,
          get cancelled() {
            return sessionStore.isDisposed;
          },
        };
      }
      cancelOAuthSession() {
        if (this._activeOAuthStore && !this._activeOAuthStore.isDisposed) {
          this._activeOAuthStore.dispose();
        }
        this._activeOAuthStore = null;
        if (
          this._state.oauthSession.state !== OAUTH_SESSION_STATES.IDLE &&
          this._state.oauthSession.state !== OAUTH_SESSION_STATES.AUTHORIZED
        ) {
          this._state = {
            ...this._state,
            oauthCodeDraft: '',
            oauthSession: {
              ...this._state.oauthSession,
              state: OAUTH_SESSION_STATES.CANCELLED,
            },
          };
          this._emit();
        }
      }
      async waitForServerOAuthOrReady(serverName, timeoutMs = 3000, sessionHandle = null) {
        if (typeof this._oauthBroker.waitForAuthReadyOrUrl !== 'function') {
          return null;
        }
        const signal = sessionHandle || {
          get cancelled() {
            return false;
          },
        };
        const st = await this._oauthBroker.waitForAuthReadyOrUrl(serverName, timeoutMs, signal);
        if (sessionHandle && !sessionHandle.cancelled && this._state.oauthSession.seq === sessionHandle.seq && st) {
          if (st.hasAuthToken) {
            this._state = {
              ...this._state,
              oauthSession: {
                ...this._state.oauthSession,
                state: OAUTH_SESSION_STATES.AUTHORIZED,
              },
            };
            this._emit();
          } else if (st.authUrl) {
            this._state = {
              ...this._state,
              oauthSession: {
                ...this._state.oauthSession,
                state: OAUTH_SESSION_STATES.AWAITING_BROWSER_CALLBACK,
                authUrl: st.authUrl,
              },
            };
            this._emit();
          }
        }
        return st;
      }
      async openAuthUrl(url) {
        const check = validateExternalAuthUrl(url);
        if (!check.ok) {
          return { ok: false, code: check.code, error: check.error };
        }
        const opener =
          typeof this._oauthBroker.openAuthorizationUrl === 'function'
            ? this._oauthBroker.openAuthorizationUrl.bind(this._oauthBroker)
            : typeof this._oauthBroker.openExternalUrl === 'function'
              ? this._oauthBroker.openExternalUrl.bind(this._oauthBroker)
              : null;
        if (!opener) {
          return { ok: false, error: 'External authorization launcher is not connected.' };
        }
        const res = await opener(check.href);
        if (typeof res === 'boolean') {
          return res ? { ok: true, href: check.href } : { ok: false, error: 'Failed to open authorization URL.' };
        }
        if (res && res.ok) {
          return { ok: true, href: check.href };
        }
        return { ok: false, error: res?.error || 'Failed to open authorization URL.' };
      }
      async completeOAuth(serverName, rawCodeOrCallbackUrl) {
        const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
        const code = normalizeAuthorizationCode(rawCodeOrCallbackUrl);
        if (!cleanName || !code) {
          return { ok: false, error: 'Server name and authorization code are required.' };
        }
        this._state = {
          ...this._state,
          oauthSession: {
            ...this._state.oauthSession,
            serverName: cleanName,
            state: OAUTH_SESSION_STATES.SUBMITTING_CODE,
            error: null,
          },
        };
        this._emit();
        const res = await this._oauthBroker.completeAuthorization(cleanName, code);
        if (res && res.ok) {
          this._state = {
            ...this._state,
            oauthCodeDraft: '',
            oauthSession: {
              ...this._state.oauthSession,
              serverName: cleanName,
              state: OAUTH_SESSION_STATES.AUTHORIZED,
              error: null,
            },
          };
          this._emit();
          await this._safeRefresh(cleanName);
          return res;
        }
        const errMsg = redactSensitiveText(res?.error || 'OAuth authorization completion failed.');
        this._state = {
          ...this._state,
          oauthSession: {
            ...this._state.oauthSession,
            serverName: cleanName,
            state: OAUTH_SESSION_STATES.FAILED,
            error: errMsg,
          },
        };
        this._emit();
        return { ok: false, error: errMsg };
      }
      async disconnectOAuth(serverName, account = '') {
        const cleanName = typeof serverName === 'string' ? serverName.trim() : '';
        if (!cleanName) {
          return { ok: false, error: 'Server name is required.' };
        }
        const res = await this._oauthBroker.disconnectSession(cleanName, typeof account === 'string' ? account : '');
        if (res && res.ok) {
          await this._safeRefresh(cleanName);
        }
        return res || { ok: false, error: 'OAuth disconnect failed.' };
      }
      async revealConfigInExplorer(uri) {
        if (typeof this._configRepo.revealConfigInExplorer === 'function') {
          return this._configRepo.revealConfigInExplorer(uri);
        }
        return { ok: false, error: 'File explorer reveal is not supported in this host.' };
      }
      async _safeRefresh(serverName) {
        let refreshRes = { ok: true };
        if (typeof this._mcpRuntime.refreshServers === 'function') {
          try {
            refreshRes =
              (await this._mcpRuntime.refreshServers(
                serverName ? { shallow: true, serverName } : { shallow: false }
              )) || { ok: true };
          } catch (err) {
            refreshRes = {
              ok: false,
              error: redactSensitiveText(err?.message || 'Failed to refresh MCP servers.'),
            };
          }
        }
        await this.fetchServerStates();
        return refreshRes;
      }
      dispose() {
        this.cancelOAuthSession();
        this.clearSensitiveDrafts();
        this._listeners.clear();
        this._disposables.dispose();
      }
    }
    module.exports = {
      OAUTH_SESSION_STATES,
      createEmptyEditorDraft,
      McpManagerService,
    };
  },
  "./security/trusted-types": function(module, exports, __require) {
    const require = (spec) => __require("./security", spec);
    'use strict';
    const FORBIDDEN_POLICY_NAMES = Object.freeze(
      new Set(['default', 'dompurify', 'angular', 'angular#unsafe-bypass'])
    );
    const VALID_NONCE_RE = /^[A-Za-z0-9+/_=-]{8,256}$/;
    const policyCacheByWindow = new WeakMap();
    function isNativeTrustedScriptURL(win, val) {
      if (!val || typeof val !== 'object') return false;
      if (typeof val.href === 'string') return false;
      try {
        if (win && typeof win.TrustedScriptURL === 'function' && val instanceof win.TrustedScriptURL) {
          return true;
        }
      } catch {
      }
      try {
        return Object.prototype.toString.call(val) === '[object TrustedScriptURL]';
      } catch {
        return false;
      }
    }
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
    function createScopedPolicyController(nativePolicy, policyName, isAllowedScriptUrl) {
      const inlineTokens = new Map();
      const blobUrlTokens = new Map();
      return Object.freeze({
        hasNativePolicy: Boolean(nativePolicy),
        policyName: policyName || null,
        issueScriptToken(code) {
          if (typeof code !== 'string') {
            throw new TypeError('Script code must be a string');
          }
          const token = Symbol('TrustedScriptOneShotToken');
          inlineTokens.set(token, code);
          return token;
        },
        revokeScriptToken(token) {
          inlineTokens.delete(token);
        },
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
        revokeBlobUrlToken(token) {
          blobUrlTokens.delete(token);
        },
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
  },
  "./shared/marker-manifest": function(module, exports, __require) {
    const require = (spec) => __require("./shared", spec);
    'use strict';
    const MCP_BEGIN_MARKER = '// === BEGIN_AGY_MCP_MANAGER_V1 ===';
    const MCP_END_MARKER = '// === END_AGY_MCP_MANAGER_V1 ===';
    const MCP_BEGIN_LINE_RE = /^[ \t]*\/\/ === BEGIN_AGY_MCP_MANAGER(?:_V\d+)? ===[ \t]*$/;
    const MCP_END_LINE_RE = /^[ \t]*\/\/ === END_AGY_MCP_MANAGER(?:_V\d+)? ===[ \t]*$/;
    const KO_BEGIN_LINE_RE = /^[ \t]*\/\/ === BEGIN_AGY_KO_THOUGHT_LOCALIZER(?:_V\d+)? ===[ \t]*$/;
    const KO_END_LINE_RE = /^[ \t]*\/\/ === END_AGY_KO_THOUGHT_LOCALIZER(?:_V\d+)? ===[ \t]*$/;
    function splitLinesWithOffsets(text) {
      const normalized = String(text ?? '').replace(/\r\n/g, '\n');
      const lines = [];
      let lineStart = 0;
      for (let i = 0; i <= normalized.length; i += 1) {
        if (i === normalized.length || normalized.charCodeAt(i) === 10) {
          const lineText = normalized.slice(lineStart, i);
          const lineEndWithNewline = i < normalized.length ? i + 1 : i;
          lines.push({
            text: lineText,
            start: lineStart,
            end: i,
            endWithNewline: lineEndWithNewline,
          });
          lineStart = i + 1;
        }
      }
      return { normalized, lines };
    }
    function parseAutoinjectCompanionManifest(content) {
      const { normalized, lines } = splitLinesWithOffsets(content);
      let mcpBeginIdx = -1;
      let mcpEndIdx = -1;
      let koBeginIdx = -1;
      let koEndIdx = -1;
      for (let i = 0; i < lines.length; i += 1) {
        const t = lines[i].text;
        if (mcpBeginIdx === -1 && MCP_BEGIN_LINE_RE.test(t)) {
          mcpBeginIdx = i;
          continue;
        }
        if (mcpBeginIdx !== -1 && mcpEndIdx === -1 && MCP_END_LINE_RE.test(t)) {
          mcpEndIdx = i;
          continue;
        }
        if (koBeginIdx === -1 && KO_BEGIN_LINE_RE.test(t)) {
          koBeginIdx = i;
          continue;
        }
        if (koBeginIdx !== -1 && koEndIdx === -1 && KO_END_LINE_RE.test(t)) {
          koEndIdx = i;
        }
      }
      let mcpRange = null;
      let hasOrphanMcpBegin = false;
      if (mcpBeginIdx !== -1) {
        if (mcpEndIdx !== -1 && mcpEndIdx > mcpBeginIdx) {
          mcpRange = {
            start: lines[mcpBeginIdx].start,
            end: lines[mcpEndIdx].endWithNewline,
          };
        } else {
          hasOrphanMcpBegin = true;
          const stopLineIdx = koBeginIdx > mcpBeginIdx ? koBeginIdx : -1;
          mcpRange = {
            start: lines[mcpBeginIdx].start,
            end: stopLineIdx !== -1 ? lines[stopLineIdx].start : normalized.length,
          };
        }
      }
      let koRange = null;
      if (koBeginIdx !== -1) {
        koRange = {
          start: lines[koBeginIdx].start,
          end: koEndIdx > koBeginIdx ? lines[koEndIdx].endWithNewline : normalized.length,
        };
      }
      const strippedWithoutMcpAndKo = removeRangeText(
        mcpRange ? removeRangeText(normalized, mcpRange.start, mcpRange.end) : normalized,
        0,
        0,
        true
      );
      const residualOutsideMcpAndKo = (() => {
        const intervals = [];
        if (mcpRange) intervals.push(mcpRange);
        if (koRange) intervals.push(koRange);
        intervals.sort((a, b) => a.start - b.start);
        let cursor = 0;
        let acc = '';
        for (const iv of intervals) {
          if (iv.start > cursor) {
            acc += normalized.slice(cursor, iv.start);
          }
          cursor = Math.max(cursor, iv.end);
        }
        if (cursor < normalized.length) {
          acc += normalized.slice(cursor);
        }
        return acc.trim();
      })();
      void strippedWithoutMcpAndKo;
      return {
        normalized,
        hasStatusbarCore: residualOutsideMcpAndKo.length > 0,
        hasMcpBlock: mcpBeginIdx !== -1 && mcpEndIdx > mcpBeginIdx,
        hasOrphanMcpBegin,
        hasKoBlock: koBeginIdx !== -1,
        mcpRange,
        koRange,
      };
    }
    function removeRangeText(str, start, end) {
      return str.slice(0, start) + str.slice(end);
    }
    function buildMarkedMcpBlock(bundleSource) {
      const cleanBody = String(bundleSource ?? '').replace(/\r\n/g, '\n').trim();
      return `${MCP_BEGIN_MARKER}\n${cleanBody}\n${MCP_END_MARKER}\n`;
    }
    function mergeMcpManagerBlock(existingContent, bundleSource) {
      const markedBlock = buildMarkedMcpBlock(bundleSource);
      const parsed = parseAutoinjectCompanionManifest(existingContent);
      const { normalized, mcpRange, koRange } = parsed;
      if (!normalized.trim()) {
        return markedBlock;
      }
      if (mcpRange) {
        const before = normalized.slice(0, mcpRange.start).replace(/[ \t]+$/g, '');
        const after = normalized.slice(mcpRange.end).replace(/^\n+/, '');
        const prefix = before ? (before.endsWith('\n') ? before : `${before}\n`) : '';
        const suffix = after ? `\n${after.replace(/\n*$/, '\n')}` : '';
        return `${prefix}${markedBlock}${suffix}`.replace(/\n{3,}/g, '\n\n');
      }
      if (koRange) {
        const beforeKo = normalized.slice(0, koRange.start).replace(/\s+$/, '');
        const fromKo = normalized.slice(koRange.start).replace(/\s+$/, '');
        const prefix = beforeKo ? `${beforeKo}\n\n` : '';
        return `${prefix}${markedBlock}\n${fromKo}\n`;
      }
      const trimmedExisting = normalized.replace(/\s+$/, '');
      return `${trimmedExisting}\n\n${markedBlock}`;
    }
    function removeMcpManagerBlock(existingContent) {
      const parsed = parseAutoinjectCompanionManifest(existingContent);
      const { normalized, mcpRange } = parsed;
      if (!mcpRange) {
        return normalized.trim() ? `${normalized.replace(/\s+$/, '')}\n` : '';
      }
      const before = normalized.slice(0, mcpRange.start).replace(/[ \t]+$/, '');
      const after = normalized.slice(mcpRange.end);
      const joined = `${before}\n${after}`.replace(/\n{3,}/g, '\n\n').trim();
      return joined ? `${joined}\n` : '';
    }
    module.exports = {
      MCP_BEGIN_MARKER,
      MCP_END_MARKER,
      parseAutoinjectCompanionManifest,
      buildMarkedMcpBlock,
      mergeMcpManagerBlock,
      removeMcpManagerBlock,
    };
  },
  "./shared/dom-disposables": function(module, exports, __require) {
    const require = (spec) => __require("./shared", spec);
    'use strict';
    const { toDisposable } = require('../core/disposable');
    function disposableTimeout(win, fn, ms) {
      const host = win && typeof win.setTimeout === 'function' ? win : globalThis;
      const setFn = host.setTimeout;
      const clearFn = host.clearTimeout;
      let active = true;
      const handle = setFn.call(
        host,
        () => {
          active = false;
          fn();
        },
        ms
      );
      if (handle && typeof handle === 'object' && typeof handle.unref === 'function') {
        handle.unref();
      }
      return toDisposable(() => {
        if (!active) return;
        active = false;
        if (typeof clearFn === 'function') {
          clearFn.call(host, handle);
        }
      });
    }
    function disposableInterval(win, fn, ms) {
      const host = win && typeof win.setInterval === 'function' ? win : globalThis;
      const setFn = host.setInterval;
      const clearFn = host.clearInterval;
      let active = true;
      const handle = setFn.call(host, () => {
        if (!active) return;
        fn();
      }, ms);
      if (handle && typeof handle === 'object' && typeof handle.unref === 'function') {
        handle.unref();
      }
      return toDisposable(() => {
        if (!active) return;
        active = false;
        if (typeof clearFn === 'function') {
          clearFn.call(host, handle);
        }
      });
    }
    function disposableEvent(target, type, listener, options) {
      if (!target || typeof target.addEventListener !== 'function') {
        return toDisposable(() => {});
      }
      target.addEventListener(type, listener, options);
      let removed = false;
      return toDisposable(() => {
        if (removed) return;
        removed = true;
        if (typeof target.removeEventListener === 'function') {
          target.removeEventListener(type, listener, options);
        }
      });
    }
    function disposableObserver(observer, target, options) {
      if (!observer) {
        return toDisposable(() => {});
      }
      if (target && typeof observer.observe === 'function') {
        observer.observe(target, options);
      }
      let disconnected = false;
      return toDisposable(() => {
        if (disconnected) return;
        disconnected = true;
        if (typeof observer.disconnect === 'function') {
          observer.disconnect();
        }
      });
    }
    function disposableMessagePort(port) {
      if (!port) {
        return toDisposable(() => {});
      }
      let closed = false;
      return toDisposable(() => {
        if (closed) return;
        closed = true;
        try {
          port.onmessage = null;
          port.onmessageerror = null;
        } catch {
        }
        if (typeof port.close === 'function') {
          port.close();
        }
      });
    }
    function disposableAbortController(win) {
      const Ctor =
        (win && typeof win.AbortController === 'function' ? win.AbortController : null) ||
        (typeof AbortController === 'function' ? AbortController : null);
      if (!Ctor) {
        return {
          controller: null,
          signal: undefined,
          dispose() {},
        };
      }
      const controller = new Ctor();
      let aborted = false;
      return {
        controller,
        signal: controller.signal,
        dispose() {
          if (aborted) return;
          aborted = true;
          controller.abort();
        },
      };
    }
    module.exports = {
      disposableTimeout,
      disposableInterval,
      disposableEvent,
      disposableObserver,
      disposableMessagePort,
      disposableAbortController,
    };
  },
  "./ui/design-tokens-styles": function(module, exports, __require) {
    const require = (spec) => __require("./ui", spec);
    'use strict';
    const { getScriptNonce } = require('../security/trusted-types');
    const DEFAULT_STYLE_ID = 'agy-mcp-manager-styles';
    const MODAL_CSS = `
:root {
  --mcp-bg-surface: #16181d;
  --mcp-bg-elevated: #1e222a;
  --mcp-bg-input: #111318;
  --mcp-border: rgba(255, 255, 255, 0.12);
  --mcp-border-strong: rgba(124, 156, 255, 0.45);
  --mcp-text-primary: #f3f5f8;
  --mcp-text-secondary: #a7b0c0;
  --mcp-accent: #5b8cff;
  --mcp-accent-hover: #739dff;
  --mcp-danger: #ef5350;
  --mcp-warning: #ffb74d;
  --mcp-success: #4caf50;
  --mcp-radius: 10px;
}
.agy-mcp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(8, 10, 14, 0.72);
  backdrop-filter: blur(4px);
  box-sizing: border-box;
}
.agy-mcp-dialog {
  width: min(860px, 100%);
  max-height: min(88vh, 860px);
  display: flex;
  flex-direction: column;
  background: var(--mcp-bg-surface);
  color: var(--mcp-text-primary);
  border: 1px solid var(--mcp-border);
  border-radius: var(--mcp-radius);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.45;
}
.agy-mcp-dialog-compact {
  width: min(560px, 100%);
}
.agy-mcp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--mcp-border);
  background: var(--mcp-bg-elevated);
}
.agy-mcp-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.agy-mcp-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--mcp-text-secondary);
}
.agy-mcp-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.agy-mcp-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 18px 0;
  border-bottom: 1px solid var(--mcp-border);
  background: var(--mcp-bg-surface);
}
.agy-mcp-tab-btn {
  padding: 8px 12px;
  min-height: 36px;
  background: transparent;
  color: var(--mcp-text-secondary);
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: color 120ms ease, border-color 120ms ease;
}
.agy-mcp-tab-btn[aria-selected="true"] {
  color: var(--mcp-text-primary);
  border-bottom-color: var(--mcp-accent);
}
.agy-mcp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.agy-mcp-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.agy-mcp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.agy-mcp-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--mcp-text-secondary);
}
.agy-mcp-input,
.agy-mcp-select,
.agy-mcp-textarea {
  width: 100%;
  min-height: 36px;
  padding: 7px 10px;
  box-sizing: border-box;
  background: var(--mcp-bg-input);
  color: var(--mcp-text-primary);
  border: 1px solid var(--mcp-border);
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
}
.agy-mcp-textarea {
  min-height: 88px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.agy-mcp-input:focus-visible,
.agy-mcp-select:focus-visible,
.agy-mcp-textarea:focus-visible,
.agy-mcp-btn:focus-visible,
.agy-mcp-tab-btn:focus-visible {
  outline: 2px solid var(--mcp-accent);
  outline-offset: 1px;
}
.agy-mcp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--mcp-border);
  background: var(--mcp-bg-elevated);
  color: var(--mcp-text-primary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.agy-mcp-btn:hover {
  border-color: var(--mcp-border-strong);
}
.agy-mcp-btn-primary {
  background: var(--mcp-accent);
  border-color: var(--mcp-accent);
  color: #ffffff;
}
.agy-mcp-btn-primary:hover {
  background: var(--mcp-accent-hover);
}
.agy-mcp-btn-danger {
  border-color: rgba(239, 83, 80, 0.5);
  color: #ff8a80;
}
.agy-mcp-card {
  padding: 12px 14px;
  border: 1px solid var(--mcp-border);
  border-radius: 8px;
  background: var(--mcp-bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agy-mcp-banner {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--mcp-border);
  font-size: 12px;
}
.agy-mcp-banner-error {
  border-color: rgba(239, 83, 80, 0.6);
  background: rgba(239, 83, 80, 0.12);
  color: #ffcdd2;
}
.agy-mcp-banner-warn {
  border-color: rgba(255, 183, 77, 0.6);
  background: rgba(255, 183, 77, 0.12);
  color: #ffe0b2;
}
.agy-mcp-banner-info {
  border-color: rgba(91, 140, 255, 0.5);
  background: rgba(91, 140, 255, 0.12);
  color: #dbe6ff;
}
.agy-mcp-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid var(--mcp-border);
  background: rgba(255, 255, 255, 0.05);
}
.agy-mcp-remote-launcher-btn {
  position: fixed;
  right: 16px;
  bottom: 40px;
  z-index: 2147482500;
  min-height: 34px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--mcp-border-strong);
  background: var(--mcp-bg-elevated);
  color: var(--mcp-text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}
@media (max-width: 640px) {
  .agy-mcp-backdrop {
    padding: 8px;
  }
  .agy-mcp-dialog {
    width: 100%;
    max-height: 94vh;
  }
  .agy-mcp-grid-2 {
    grid-template-columns: minmax(0, 1fr);
  }
  .agy-mcp-header,
  .agy-mcp-body {
    padding: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .agy-mcp-tab-btn,
  .agy-mcp-btn,
  .agy-mcp-backdrop,
  .agy-mcp-dialog {
    transition: none !important;
    animation: none !important;
  }
}
`;
    function ensureModalStyles(doc, styleId = DEFAULT_STYLE_ID) {
      if (!doc || typeof doc.createElement !== 'function') return null;
      const existing = typeof doc.getElementById === 'function' ? doc.getElementById(styleId) : null;
      if (existing) return existing;
      const styleEl = doc.createElement('style');
      styleEl.id = styleId;
      if (typeof styleEl.setAttribute === 'function') {
        styleEl.setAttribute('id', styleId);
      }
      const nonce = getScriptNonce(doc);
      if (nonce) {
        styleEl.nonce = nonce;
        if (typeof styleEl.setAttribute === 'function') {
          styleEl.setAttribute('nonce', nonce);
        }
      }
      styleEl.textContent = MODAL_CSS;
      const target = doc.head || doc.body || doc.documentElement;
      if (target && typeof target.appendChild === 'function') {
        target.appendChild(styleEl);
      }
      return styleEl;
    }
    function removeModalStyles(doc, styleId = DEFAULT_STYLE_ID) {
      if (!doc || typeof doc.getElementById !== 'function') return;
      const el = doc.getElementById(styleId);
      if (!el) return;
      if (typeof el.remove === 'function') {
        el.remove();
      } else if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
        el.parentNode.removeChild(el);
      }
    }
    function getStylesheetText() {
      return MODAL_CSS;
    }
    module.exports = {
      DEFAULT_STYLE_ID,
      MODAL_CSS,
      getStylesheetText,
      ensureModalStyles,
      removeModalStyles,
    };
  },
  "./ui/dom-kit": function(module, exports, __require) {
    const require = (spec) => __require("./ui", spec);
    'use strict';
    const { disposableEvent } = require('../shared/dom-disposables');
    const FOCUSABLE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']);
    function isImeComposing(event) {
      return Boolean(event && (event.isComposing === true || event.keyCode === 229));
    }
    function clearElement(el) {
      if (!el) return;
      while (el.firstChild && typeof el.removeChild === 'function') {
        el.removeChild(el.firstChild);
      }
      if (Array.isArray(el.children) && el.children.length > 0 && typeof el.replaceChildren === 'function') {
        el.replaceChildren();
      }
    }
    function h(doc, tag, props, ...children) {
      const el = doc.createElement(tag);
      if (props && typeof props === 'object') {
        const keys = Object.keys(props);
        for (let i = 0; i < keys.length; i += 1) {
          const key = keys[i];
          const val = props[key];
          if (val === undefined || val === null || val === false) continue;
          if (key === 'className' || key === 'class') {
            el.className = String(val);
            if (typeof el.setAttribute === 'function') {
              el.setAttribute('class', String(val));
            }
          } else if (key === 'text') {
            el.textContent = String(val);
          } else if (key === 'value') {
            el.value = String(val);
          } else if (key === 'checked') {
            el.checked = Boolean(val);
          } else if (key === 'disabled') {
            el.disabled = Boolean(val);
            if (val && typeof el.setAttribute === 'function') {
              el.setAttribute('disabled', 'disabled');
            }
          } else if (key === 'selected') {
            el.selected = Boolean(val);
          } else if (key === 'style' && typeof val === 'object') {
            if (el.style) {
              Object.assign(el.style, val);
            }
          } else if (key === 'dataset' && typeof val === 'object') {
            const dKeys = Object.keys(val);
            for (let j = 0; j < dKeys.length; j += 1) {
              const dk = dKeys[j];
              const dv = val[dk];
              if (dv === undefined || dv === null) continue;
              if (el.dataset) el.dataset[dk] = String(dv);
              if (typeof el.setAttribute === 'function') {
                const kebab = dk.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
                el.setAttribute(`data-${kebab}`, String(dv));
              }
            }
          } else if (key.startsWith('on') && typeof val === 'function') {
            const eventType = key.slice(2).toLowerCase();
            if (typeof el.addEventListener === 'function') {
              el.addEventListener(eventType, val);
            } else {
              el[key.toLowerCase()] = val;
            }
          } else if (typeof el.setAttribute === 'function') {
            if (key === 'id') el.id = String(val);
            if (key === 'type') el.type = String(val);
            if (key === 'name') el.name = String(val);
            if (key === 'placeholder') el.placeholder = String(val);
            if (key === 'role') el.role = String(val);
            el.setAttribute(key, val === true ? '' : String(val));
          } else {
            el[key] = val;
          }
        }
      }
      const appendChildItem = (item) => {
        if (item === null || item === undefined || item === false) return;
        if (Array.isArray(item)) {
          for (let i = 0; i < item.length; i += 1) {
            appendChildItem(item[i]);
          }
          return;
        }
        if (typeof item === 'string' || typeof item === 'number') {
          if (typeof doc.createTextNode === 'function') {
            el.appendChild(doc.createTextNode(String(item)));
          } else {
            el.textContent = `${el.textContent || ''}${item}`;
          }
          return;
        }
        if (typeof el.appendChild === 'function') {
          el.appendChild(item);
        }
      };
      for (let i = 0; i < children.length; i += 1) {
        appendChildItem(children[i]);
      }
      return el;
    }
    function getFocusableElements(root) {
      if (!root) return [];
      const results = [];
      const visit = (node) => {
        if (!node || node === root) {
        } else {
          const tag = String(node.tagName || '').toUpperCase();
          const hidden =
            node.disabled === true ||
            node.hidden === true ||
            (typeof node.getAttribute === 'function' && node.getAttribute('aria-hidden') === 'true') ||
            (node.style && (node.style.display === 'none' || node.style.visibility === 'hidden'));
          if (!hidden) {
            const tabIdxAttr = typeof node.getAttribute === 'function' ? node.getAttribute('tabindex') : null;
            const tabIdx = tabIdxAttr !== null && tabIdxAttr !== undefined ? Number(tabIdxAttr) : node.tabIndex;
            const isFocusableTag =
              FOCUSABLE_TAGS.has(tag) &&
              (tag !== 'A' || Boolean(node.href || (typeof node.getAttribute === 'function' && node.getAttribute('href'))));
            if ((isFocusableTag && tabIdx !== -1) || (typeof tabIdx === 'number' && !Number.isNaN(tabIdx) && tabIdx >= 0)) {
              if (typeof node.focus === 'function') {
                results.push(node);
              }
            }
          }
        }
        const kids = node.children || node.childNodes || [];
        for (let i = 0; i < kids.length; i += 1) {
          visit(kids[i]);
        }
      };
      visit(root);
      return results;
    }
    function isElementConnected(doc, el) {
      if (!el || typeof el.focus !== 'function') return false;
      if (el.isConnected === false) return false;
      if (doc && typeof doc.contains === 'function') {
        return doc.contains(el);
      }
      let cur = el;
      while (cur) {
        if (cur === doc || (doc && (cur === doc.body || cur === doc.documentElement))) {
          return true;
        }
        cur = cur.parentNode;
      }
      return Boolean(el.isConnected);
    }
    function restoreFocusSafely(doc, openerEl, getFallbackFocusTarget) {
      if (isElementConnected(doc, openerEl)) {
        try {
          openerEl.focus();
          return openerEl;
        } catch {
        }
      }
      if (typeof getFallbackFocusTarget === 'function') {
        const fallbackEl = getFallbackFocusTarget();
        if (isElementConnected(doc, fallbackEl)) {
          try {
            fallbackEl.focus();
            return fallbackEl;
          } catch {
          }
        }
      }
      const bodyTarget = doc && (doc.body || doc.documentElement);
      if (bodyTarget && typeof bodyTarget.focus === 'function') {
        try {
          bodyTarget.focus();
          return bodyTarget;
        } catch {
          return null;
        }
      }
      return null;
    }
    function installDialogKeyboardTrap(params) {
      const { doc, dialogEl, onEscape } = params;
      return disposableEvent(dialogEl, 'keydown', (event) => {
        if (!event || isImeComposing(event)) return;
        if (event.key === 'Escape') {
          if (typeof onEscape === 'function') {
            event.preventDefault?.();
            event.stopPropagation?.();
            onEscape(event);
          }
          return;
        }
        if (event.key !== 'Tab') return;
        const focusables = getFocusableElements(dialogEl);
        if (focusables.length === 0) {
          event.preventDefault?.();
          dialogEl.focus?.();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = doc ? doc.activeElement : null;
        if (event.shiftKey) {
          if (!active || active === first || !focusables.includes(active)) {
            event.preventDefault?.();
            last.focus();
          }
        } else if (!active || active === last || !focusables.includes(active)) {
          event.preventDefault?.();
          first.focus();
        }
      });
    }
    function preserveScrollTop(container, renderFn) {
      const prevScrollTop = container && typeof container.scrollTop === 'number' ? container.scrollTop : 0;
      renderFn();
      if (container && typeof prevScrollTop === 'number') {
        container.scrollTop = prevScrollTop;
      }
    }
    module.exports = {
      isImeComposing,
      clearElement,
      h,
      getFocusableElements,
      isElementConnected,
      restoreFocusSafely,
      installDialogKeyboardTrap,
      preserveScrollTop,
    };
  },
  "./ui/views/quick-add-bar": function(module, exports, __require) {
    const require = (spec) => __require("./ui/views", spec);
    'use strict';
    const { h, isImeComposing } = require('../dom-kit');
    const { redactSensitiveText } = require('../../core/schema/auth-codec');
    function renderQuickAddBar(props) {
      const {
        doc,
        draftState,
        onInputChange,
        onQuickAdd,
        onSmartFill,
        onConfirmPendingCommand,
        onCancelPendingCommand,
      } = props;
      const smartInputEl = h(doc, 'input', {
        type: 'text',
        className: 'agy-mcp-input',
        placeholder: 'Paste MCP URL, JSON snippet, npm/uvx package, or curl command...',
        value: draftState.quickAddInput || '',
        'aria-label': 'Quick Auto-Add MCP input',
        dataset: {
          testid: 'agy-mcp-smart-input',
          field: 'quickAddInput',
          agyNoTranslate: 'true',
        },
        onInput: (e) => {
          onInputChange(String(e?.target?.value ?? ''), String(authInputEl.value ?? ''));
        },
        onKeydown: (e) => {
          if (isImeComposing(e)) return;
          if (e && e.key === 'Enter') {
            e.preventDefault?.();
            onQuickAdd();
          }
        },
      });
      const authInputEl = h(doc, 'input', {
        type: 'password',
        className: 'agy-mcp-input',
        placeholder: 'Optional auth token / API key (Bearer, x-api-key:..., user:pass)',
        value: draftState.quickAddAuthToken || '',
        autocomplete: 'off',
        'aria-label': 'Optional Quick Add auth token',
        dataset: {
          testid: 'agy-mcp-smart-auth-input',
          field: 'quickAddAuthToken',
          agyNoTranslate: 'true',
        },
        onInput: (e) => {
          onInputChange(String(smartInputEl.value ?? ''), String(e?.target?.value ?? ''));
        },
        onKeydown: (e) => {
          if (isImeComposing(e)) return;
          if (e && e.key === 'Enter') {
            e.preventDefault?.();
            onQuickAdd();
          }
        },
      });
      const addBtn = h(
        doc,
        'button',
        {
          type: 'button',
          className: 'agy-mcp-btn agy-mcp-btn-primary',
          dataset: {
            testid: 'agy-mcp-smart-add-btn',
            agyNoTranslate: 'true',
          },
          onClick: () => onQuickAdd(),
        },
        'Auto-Add'
      );
      const fillBtn = h(
        doc,
        'button',
        {
          type: 'button',
          className: 'agy-mcp-btn',
          dataset: {
            testid: 'agy-mcp-smart-fill-btn',
            agyNoTranslate: 'true',
          },
          onClick: () => onSmartFill(),
        },
        'Fill Form'
      );
      const children = [
        h(
          doc,
          'div',
          { className: 'agy-mcp-grid-2' },
          h(doc, 'div', { className: 'agy-mcp-field' }, smartInputEl),
          h(doc, 'div', { className: 'agy-mcp-field' }, authInputEl)
        ),
        h(doc, 'div', { className: 'agy-mcp-row' }, addBtn, fillBtn),
      ];
      const pending = draftState.pendingCommandConfirmation;
      if (pending) {
        const entries = Array.isArray(pending.entries) ? pending.entries : [];
        const summaryLines = entries.map((entry) => {
          const spec = entry.spec || {};
          if (typeof spec.command === 'string' && spec.command.trim()) {
            const argsStr = Array.isArray(spec.args) ? spec.args.join(' ') : '';
            const envKeys = spec.env && typeof spec.env === 'object' ? Object.keys(spec.env) : [];
            const envNote = envKeys.length > 0 ? ` [env: ${envKeys.join(', ')}]` : '';
            return `${entry.serverName}: ${spec.command}${argsStr ? ` ${argsStr}` : ''}${envNote}`;
          }
          const endpoint = spec.url || spec.serverUrl || '';
          return `${entry.serverName}: ${redactSensitiveText(endpoint)}`;
        });
        const confirmPanel = h(
          doc,
          'div',
          {
            className: 'agy-mcp-banner agy-mcp-banner-warn',
            role: 'alert',
            dataset: {
              testid: 'agy-mcp-confirm-command-panel',
              agyNoTranslate: 'true',
            },
          },
          h(
            doc,
            'div',
            { style: { fontWeight: '600', marginBottom: '6px' } },
            pending.hasPathOverride
              ? 'Confirm Local Command & PATH Override Execution'
              : 'Confirm Local Stdio Command Execution'
          ),
          h(
            doc,
            'div',
            { style: { marginBottom: '8px', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' } },
            summaryLines.join('\n')
          ),
          h(
            doc,
            'div',
            { className: 'agy-mcp-row' },
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn agy-mcp-btn-primary',
                dataset: {
                  testid: 'agy-mcp-confirm-command-btn',
                  agyNoTranslate: 'true',
                },
                onClick: () => onConfirmPendingCommand(),
              },
              'Confirm & Add Command'
            ),
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn',
                dataset: {
                  testid: 'agy-mcp-cancel-command-btn',
                  agyNoTranslate: 'true',
                },
                onClick: () => onCancelPendingCommand(),
              },
              'Cancel'
            )
          )
        );
        children.push(confirmPanel);
      }
      return h(
        doc,
        'section',
        {
          className: 'agy-mcp-card',
          'aria-label': 'Quick Auto-Add MCP Server',
        },
        ...children
      );
    }
    module.exports = {
      renderQuickAddBar,
    };
  },
  "./ui/views/server-card-list": function(module, exports, __require) {
    const require = (spec) => __require("./ui/views", spec);
    'use strict';
    const { h, clearElement, preserveScrollTop } = require('../dom-kit');
    const { redactSensitiveUrl, redactSensitiveText } = require('../../core/schema/auth-codec');
    const { extractAndValidateTransport } = require('../../core/schema/server-spec');
    function renderServerCardList(props) {
      const {
        doc,
        container,
        servers,
        runtimeStates,
        onToggleServer,
        onEditServer,
        onDeleteServer,
        onRefreshServer,
        onOpenOAuthConnect,
        onDisconnectOAuth,
      } = props;
      const stateByName = new Map();
      if (Array.isArray(runtimeStates)) {
        for (let i = 0; i < runtimeStates.length; i += 1) {
          const st = runtimeStates[i];
          const name = String(st?.serverName || st?.name || '').trim();
          if (name) stateByName.set(name, st);
        }
      }
      const serverNames = Object.keys(servers || {});
      preserveScrollTop(container, () => {
        clearElement(container);
        if (serverNames.length === 0) {
          container.appendChild(
            h(
              doc,
              'div',
              {
                className: 'agy-mcp-card',
                dataset: { testid: 'agy-mcp-empty-state' },
              },
              'No custom MCP servers configured yet. Use Quick Auto-Add above or Add Server to create one.'
            )
          );
          return;
        }
        for (let i = 0; i < serverNames.length; i += 1) {
          const name = serverNames[i];
          const spec = servers[name] || {};
          const rt = stateByName.get(name) || null;
          const enabled = spec.disabled !== true;
          const transportCheck = extractAndValidateTransport(spec);
          let summaryText = '';
          let isHttp = false;
          if (transportCheck.ok) {
            if (transportCheck.transport === 'stdio') {
              const argsJoined = Array.isArray(spec.args) ? spec.args.join(' ') : '';
              summaryText = redactSensitiveText(`${transportCheck.command}${argsJoined ? ` ${argsJoined}` : ''}`);
            } else {
              isHttp = true;
              summaryText = redactSensitiveUrl(transportCheck.canonicalUrl);
            }
          } else {
            summaryText = `[Invalid spec: ${transportCheck.code}]`;
          }
          const statusLabel = rt?.status || (enabled ? 'enabled' : 'disabled');
          const tools = Array.isArray(rt?.tools) ? rt.tools : [];
          const hasOAuth = Boolean(spec.oauth && typeof spec.oauth === 'object') || Boolean(rt?.oauthConnected || rt?.requiresOAuth);
          const actionButtons = [
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn',
                'aria-pressed': enabled ? 'true' : 'false',
                dataset: {
                  testid: `agy-mcp-toggle-${name}`,
                  serverName: name,
                  agyNoTranslate: 'true',
                },
                onClick: () => onToggleServer(name, !enabled),
              },
              enabled ? 'Disable' : 'Enable'
            ),
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn',
                dataset: {
                  testid: `agy-mcp-edit-${name}`,
                  serverName: name,
                  agyNoTranslate: 'true',
                },
                onClick: () => onEditServer(name),
              },
              'Edit'
            ),
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn',
                dataset: {
                  testid: `agy-mcp-refresh-${name}`,
                  serverName: name,
                  agyNoTranslate: 'true',
                },
                onClick: () => onRefreshServer(name),
              },
              'Refresh'
            ),
          ];
          if (isHttp || hasOAuth) {
            actionButtons.push(
              h(
                doc,
                'button',
                {
                  type: 'button',
                  className: 'agy-mcp-btn',
                  dataset: {
                    testid: `agy-mcp-oauth-${name}`,
                    serverName: name,
                    agyNoTranslate: 'true',
                  },
                  onClick: () => onOpenOAuthConnect(name),
                },
                'OAuth Connect'
              )
            );
          }
          if (rt?.oauthConnected) {
            actionButtons.push(
              h(
                doc,
                'button',
                {
                  type: 'button',
                  className: 'agy-mcp-btn',
                  dataset: {
                    testid: `agy-mcp-oauth-disconnect-${name}`,
                    serverName: name,
                    agyNoTranslate: 'true',
                  },
                  onClick: () => onDisconnectOAuth(name),
                },
                'Disconnect OAuth'
              )
            );
          }
          actionButtons.push(
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn agy-mcp-btn-danger',
                dataset: {
                  testid: `agy-mcp-delete-${name}`,
                  serverName: name,
                  agyNoTranslate: 'true',
                },
                onClick: () => onDeleteServer(name),
              },
              'Delete'
            )
          );
          const cardChildren = [
            h(
              doc,
              'div',
              { className: 'agy-mcp-row', style: { justifyContent: 'space-between' } },
              h(
                doc,
                'div',
                { className: 'agy-mcp-row' },
                h(doc, 'strong', { dataset: { agyNoTranslate: 'true' } }, name),
                h(doc, 'span', { className: 'agy-mcp-chip', dataset: { agyNoTranslate: 'true' } }, String(statusLabel)),
                tools.length > 0
                  ? h(doc, 'span', { className: 'agy-mcp-chip' }, `${tools.length} tools`)
                  : null
              ),
              h(doc, 'div', { className: 'agy-mcp-row' }, ...actionButtons)
            ),
            h(
              doc,
              'div',
              {
                style: {
                  fontSize: '12px',
                  color: 'var(--mcp-text-secondary)',
                  fontFamily: 'ui-monospace, monospace',
                  wordBreak: 'break-all',
                },
                dataset: { testid: `agy-mcp-endpoint-${name}`, agyNoTranslate: 'true' },
              },
              summaryText
            ),
          ];
          if (spec.description) {
            cardChildren.push(
              h(doc, 'div', { style: { fontSize: '12px' } }, redactSensitiveText(String(spec.description)))
            );
          }
          container.appendChild(
            h(
              doc,
              'article',
              {
                className: 'agy-mcp-card',
                dataset: {
                  testid: `agy-mcp-server-card-${name}`,
                  serverName: name,
                },
              },
              ...cardChildren
            )
          );
        }
      });
    }
    module.exports = {
      renderServerCardList,
    };
  },
  "./ui/views/server-editor-form": function(module, exports, __require) {
    const require = (spec) => __require("./ui/views", spec);
    'use strict';
    const { h } = require('../dom-kit');
    const { QUICK_TEMPLATES } = require('../../core/schema/presets');
    const { extractAuthFromSpec, formatKeyValueOutput } = require('../../core/schema/auth-codec');
    const { extractAndValidateTransport } = require('../../core/schema/server-spec');
    function createEmptyEditorDraft() {
      return {
        originalServerName: '',
        serverName: '',
        description: '',
        transport: 'http',
        urlKey: 'serverUrl',
        url: '',
        headersText: '',
        command: '',
        argsText: '',
        cwd: '',
        envText: '',
        authMode: 'none',
        oauthClientMode: 'auto',
        oauthClientId: '',
        oauthClientSecret: '',
        oauthScopes: '',
        oauthCode: '',
        showAdvancedOAuth: false,
        bearerToken: '',
        apiKeyHeader: 'x-api-key',
        apiKeyValue: '',
        basicUser: '',
        basicPass: '',
        applyAuthToAllHttp: false,
        confirmPathOverride: false,
        allowInsecureHttp: false,
      };
    }
    function specToEditorFormDraft(serverName, spec) {
      const draft = createEmptyEditorDraft();
      draft.originalServerName = String(serverName || '');
      draft.serverName = String(serverName || '');
      if (!spec || typeof spec !== 'object') return draft;
      draft.description = typeof spec.description === 'string' ? spec.description : '';
      const tr = extractAndValidateTransport(spec);
      const auth = extractAuthFromSpec(spec);
      if (tr.ok && tr.transport === 'stdio') {
        draft.transport = 'stdio';
        draft.command = tr.command;
        draft.argsText = Array.isArray(spec.args) ? spec.args.join('\n') : '';
        draft.cwd = typeof spec.cwd === 'string' ? spec.cwd : '';
        draft.envText = formatKeyValueOutput(auth.remainingEnv);
      } else {
        draft.transport = 'http';
        draft.urlKey = tr.ok && tr.urlKey ? tr.urlKey : 'serverUrl';
        draft.url = tr.ok ? tr.canonicalUrl : String(spec.serverUrl || spec.url || '');
        draft.headersText = formatKeyValueOutput(auth.remainingHeaders);
      }
      draft.authMode = auth.authMode || 'none';
      draft.bearerToken = auth.bearerToken || '';
      draft.apiKeyHeader = auth.apiKeyHeader || 'x-api-key';
      draft.apiKeyValue = auth.apiKeyValue || '';
      draft.basicUser = auth.basicUser || '';
      draft.basicPass = auth.basicPass || '';
      draft.oauthClientMode = auth.oauthClientMode || 'auto';
      draft.oauthClientId = auth.oauthClientId || '';
      draft.oauthClientSecret = auth.oauthClientSecret || '';
      draft.oauthScopes = auth.oauthScopes || '';
      draft.showAdvancedOAuth = draft.oauthClientMode === 'manual' || Boolean(draft.oauthClientId || draft.oauthScopes);
      return draft;
    }
    function renderServerEditorForm(props) {
      const {
        doc,
        draft,
        isPopup = false,
        existingServerNames = [],
        onFieldChange,
        onSelectServerInPopup,
        onApplyTemplate,
        onOpenOAuthConnect,
        onSubmitOAuthCodeInline,
        onSave,
        onDelete,
      } = props;
      const update = (field, value, rerender = false) => {
        onFieldChange({ [field]: value, __rerender: rerender });
      };
      const sections = [];
      if (isPopup && existingServerNames.length > 0 && typeof onSelectServerInPopup === 'function') {
        sections.push(
          h(
            doc,
            'div',
            { className: 'agy-mcp-field' },
            h(doc, 'label', { className: 'agy-mcp-label' }, 'Select Server to Edit'),
            h(
              doc,
              'select',
              {
                className: 'agy-mcp-select',
                value: draft.originalServerName || draft.serverName,
                dataset: { field: 'popupServerSelect', testid: 'agy-mcp-popup-server-select' },
                onChange: (e) => onSelectServerInPopup(String(e?.target?.value ?? '')),
              },
              ...existingServerNames.map((name) =>
                h(doc, 'option', { value: name, selected: name === (draft.originalServerName || draft.serverName) }, name)
              )
            )
          )
        );
      }
      if (!isPopup) {
        sections.push(
          h(
            doc,
            'div',
            { className: 'agy-mcp-row' },
            ...QUICK_TEMPLATES.slice(0, 6).map((tpl) =>
              h(
                doc,
                'button',
                {
                  type: 'button',
                  className: 'agy-mcp-btn',
                  dataset: { testid: `agy-mcp-template-${tpl.id}`, agyNoTranslate: 'true' },
                  onClick: () => onApplyTemplate(tpl),
                },
                `+ ${tpl.label}`
              )
            )
          )
        );
      }
      sections.push(
        h(
          doc,
          'div',
          { className: 'agy-mcp-grid-2' },
          h(
            doc,
            'div',
            { className: 'agy-mcp-field' },
            h(doc, 'label', { className: 'agy-mcp-label' }, 'Server Name'),
            h(doc, 'input', {
              type: 'text',
              className: 'agy-mcp-input',
              placeholder: 'e.g. github-mcp',
              value: draft.serverName || '',
              dataset: { field: 'serverName', agyNoTranslate: 'true' },
              onInput: (e) => update('serverName', String(e?.target?.value ?? '')),
            })
          ),
          h(
            doc,
            'div',
            { className: 'agy-mcp-field' },
            h(doc, 'label', { className: 'agy-mcp-label' }, 'Transport'),
            h(
              doc,
              'select',
              {
                className: 'agy-mcp-select',
                value: draft.transport || 'http',
                dataset: { field: 'transport', agyNoTranslate: 'true' },
                onChange: (e) => update('transport', String(e?.target?.value ?? 'http'), true),
              },
              h(doc, 'option', { value: 'http', selected: draft.transport !== 'stdio' }, 'HTTP / Streamable SSE'),
              h(doc, 'option', { value: 'stdio', selected: draft.transport === 'stdio' }, 'Stdio (Local Command)')
            )
          )
        ),
        h(
          doc,
          'div',
          { className: 'agy-mcp-field' },
          h(doc, 'label', { className: 'agy-mcp-label' }, 'Description (optional)'),
          h(doc, 'input', {
            type: 'text',
            className: 'agy-mcp-input',
            value: draft.description || '',
            dataset: { field: 'description' },
            onInput: (e) => update('description', String(e?.target?.value ?? '')),
          })
        )
      );
      if (draft.transport === 'stdio') {
        sections.push(
          h(
            doc,
            'div',
            { className: 'agy-mcp-grid-2' },
            h(
              doc,
              'div',
              { className: 'agy-mcp-field' },
              h(doc, 'label', { className: 'agy-mcp-label' }, 'Command'),
              h(doc, 'input', {
                type: 'text',
                className: 'agy-mcp-input',
                placeholder: 'npx',
                value: draft.command || '',
                dataset: { field: 'command', agyNoTranslate: 'true' },
                onInput: (e) => update('command', String(e?.target?.value ?? '')),
              })
            ),
            h(
              doc,
              'div',
              { className: 'agy-mcp-field' },
              h(doc, 'label', { className: 'agy-mcp-label' }, 'Working Directory (cwd, optional)'),
              h(doc, 'input', {
                type: 'text',
                className: 'agy-mcp-input',
                value: draft.cwd || '',
                dataset: { field: 'cwd', agyNoTranslate: 'true' },
                onInput: (e) => update('cwd', String(e?.target?.value ?? '')),
              })
            )
          ),
          h(
            doc,
            'div',
            { className: 'agy-mcp-grid-2' },
            h(
              doc,
              'div',
              { className: 'agy-mcp-field' },
              h(doc, 'label', { className: 'agy-mcp-label' }, 'Arguments (one per line)'),
              h(doc, 'textarea', {
                className: 'agy-mcp-textarea',
                value: draft.argsText || '',
                dataset: { field: 'argsText', agyNoTranslate: 'true' },
                onInput: (e) => update('argsText', String(e?.target?.value ?? '')),
              })
            ),
            h(
              doc,
              'div',
              { className: 'agy-mcp-field' },
              h(doc, 'label', { className: 'agy-mcp-label' }, 'Environment Variables (KEY=VALUE)'),
              h(doc, 'textarea', {
                className: 'agy-mcp-textarea',
                value: draft.envText || '',
                dataset: { field: 'envText', agyNoTranslate: 'true' },
                onInput: (e) => update('envText', String(e?.target?.value ?? '')),
              })
            )
          ),
          h(
            doc,
            'label',
            { className: 'agy-mcp-row', style: { fontSize: '12px' } },
            h(doc, 'input', {
              type: 'checkbox',
              checked: Boolean(draft.confirmPathOverride),
              dataset: { field: 'confirmPathOverride' },
              onChange: (e) => update('confirmPathOverride', Boolean(e?.target?.checked)),
            }),
            'Allow custom PATH environment override (if specified above)'
          )
        );
      } else {
        sections.push(
          h(
            doc,
            'div',
            { className: 'agy-mcp-field' },
            h(doc, 'label', { className: 'agy-mcp-label' }, 'Server URL (HTTPS or loopback HTTP)'),
            h(doc, 'input', {
              type: 'url',
              className: 'agy-mcp-input',
              placeholder: 'https://mcp.example.com/mcp',
              value: draft.url || '',
              dataset: { field: 'url', agyNoTranslate: 'true' },
              onInput: (e) => update('url', String(e?.target?.value ?? '')),
            })
          ),
          h(
            doc,
            'div',
            { className: 'agy-mcp-field' },
            h(doc, 'label', { className: 'agy-mcp-label' }, 'Custom Headers (Header: Value)'),
            h(doc, 'textarea', {
              className: 'agy-mcp-textarea',
              value: draft.headersText || '',
              dataset: { field: 'headersText', agyNoTranslate: 'true' },
              onInput: (e) => update('headersText', String(e?.target?.value ?? '')),
            })
          ),
          h(
            doc,
            'label',
            { className: 'agy-mcp-row', style: { fontSize: '12px' } },
            h(doc, 'input', {
              type: 'checkbox',
              checked: Boolean(draft.allowInsecureHttp),
              dataset: { field: 'allowInsecureHttp' },
              onChange: (e) => update('allowInsecureHttp', Boolean(e?.target?.checked)),
            }),
            'Allow unencrypted non-loopback http:// endpoint (credentials still blocked)'
          )
        );
      }
      const authChildren = [
        h(
          doc,
          'div',
          { className: 'agy-mcp-field' },
          h(doc, 'label', { className: 'agy-mcp-label' }, 'Authentication Method'),
          h(
            doc,
            'select',
            {
              className: 'agy-mcp-select',
              value: draft.authMode || 'none',
              dataset: { field: 'authMode', agyNoTranslate: 'true' },
              onChange: (e) => update('authMode', String(e?.target?.value ?? 'none'), true),
            },
            h(doc, 'option', { value: 'none', selected: !draft.authMode || draft.authMode === 'none' }, 'None'),
            h(doc, 'option', { value: 'oauth', selected: draft.authMode === 'oauth' }, 'OAuth 2.0 / Browser Sign-In'),
            h(doc, 'option', { value: 'bearer', selected: draft.authMode === 'bearer' }, 'Bearer Token'),
            h(doc, 'option', { value: 'apiKey', selected: draft.authMode === 'apiKey' }, 'API Key Header / Env'),
            h(doc, 'option', { value: 'basic', selected: draft.authMode === 'basic' }, 'HTTP Basic Auth')
          )
        ),
      ];
      if (draft.authMode === 'bearer') {
        authChildren.push(
          h(
            doc,
            'div',
            { className: 'agy-mcp-field' },
            h(doc, 'label', { className: 'agy-mcp-label' }, 'Bearer Token'),
            h(doc, 'input', {
              type: 'password',
              className: 'agy-mcp-input',
              autocomplete: 'off',
              value: draft.bearerToken || '',
              dataset: { field: 'bearerToken', agyNoTranslate: 'true' },
              onInput: (e) => update('bearerToken', String(e?.target?.value ?? '')),
            })
          )
        );
      } else if (draft.authMode === 'apiKey') {
        authChildren.push(
          h(
            doc,
            'div',
            { className: 'agy-mcp-grid-2' },
            h(
              doc,
              'div',
              { className: 'agy-mcp-field' },
              h(doc, 'label', { className: 'agy-mcp-label' }, draft.transport === 'stdio' ? 'Env Variable Name' : 'Header Name'),
              h(doc, 'input', {
                type: 'text',
                className: 'agy-mcp-input',
                value: draft.apiKeyHeader || 'x-api-key',
                dataset: { field: 'apiKeyHeader', agyNoTranslate: 'true' },
                onInput: (e) => update('apiKeyHeader', String(e?.target?.value ?? '')),
              })
            ),
            h(
              doc,
              'div',
              { className: 'agy-mcp-field' },
              h(doc, 'label', { className: 'agy-mcp-label' }, 'API Key Value'),
              h(doc, 'input', {
                type: 'password',
                className: 'agy-mcp-input',
                autocomplete: 'off',
                value: draft.apiKeyValue || '',
                dataset: { field: 'apiKeyValue', agyNoTranslate: 'true' },
                onInput: (e) => update('apiKeyValue', String(e?.target?.value ?? '')),
              })
            )
          )
        );
      } else if (draft.authMode === 'basic') {
        authChildren.push(
          h(
            doc,
            'div',
            { className: 'agy-mcp-grid-2' },
            h(
              doc,
              'div',
              { className: 'agy-mcp-field' },
              h(doc, 'label', { className: 'agy-mcp-label' }, 'Username'),
              h(doc, 'input', {
                type: 'text',
                className: 'agy-mcp-input',
                value: draft.basicUser || '',
                dataset: { field: 'basicUser', agyNoTranslate: 'true' },
                onInput: (e) => update('basicUser', String(e?.target?.value ?? '')),
              })
            ),
            h(
              doc,
              'div',
              { className: 'agy-mcp-field' },
              h(doc, 'label', { className: 'agy-mcp-label' }, 'Password'),
              h(doc, 'input', {
                type: 'password',
                className: 'agy-mcp-input',
                autocomplete: 'off',
                value: draft.basicPass || '',
                dataset: { field: 'basicPass', agyNoTranslate: 'true' },
                onInput: (e) => update('basicPass', String(e?.target?.value ?? '')),
              })
            )
          )
        );
      } else if (draft.authMode === 'oauth') {
        authChildren.push(
          h(
            doc,
            'div',
            { className: 'agy-mcp-row' },
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn agy-mcp-btn-primary',
                dataset: { testid: 'agy-mcp-open-oauth-connect-btn', agyNoTranslate: 'true' },
                onClick: () => onOpenOAuthConnect(),
              },
              'Connect with Browser OAuth'
            ),
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn',
                dataset: { testid: 'agy-mcp-advanced-oauth-toggle', agyNoTranslate: 'true' },
                onClick: () => update('showAdvancedOAuth', !draft.showAdvancedOAuth, true),
              },
              draft.showAdvancedOAuth ? 'Hide Advanced OAuth' : 'Advanced OAuth Settings'
            )
          )
        );
        if (draft.showAdvancedOAuth) {
          authChildren.push(
            h(
              doc,
              'div',
              { className: 'agy-mcp-grid-2' },
              h(
                doc,
                'div',
                { className: 'agy-mcp-field' },
                h(doc, 'label', { className: 'agy-mcp-label' }, 'Client Registration Mode'),
                h(
                  doc,
                  'select',
                  {
                    className: 'agy-mcp-select',
                    value: draft.oauthClientMode || 'auto',
                    dataset: { field: 'oauthClientMode', agyNoTranslate: 'true' },
                    onChange: (e) => update('oauthClientMode', String(e?.target?.value ?? 'auto'), true),
                  },
                  h(doc, 'option', { value: 'auto', selected: draft.oauthClientMode !== 'manual' }, 'Dynamic / Automatic'),
                  h(doc, 'option', { value: 'manual', selected: draft.oauthClientMode === 'manual' }, 'Manual Client ID')
                )
              ),
              h(
                doc,
                'div',
                { className: 'agy-mcp-field' },
                h(doc, 'label', { className: 'agy-mcp-label' }, 'Scopes (space or comma separated)'),
                h(doc, 'input', {
                  type: 'text',
                  className: 'agy-mcp-input',
                  value: draft.oauthScopes || '',
                  dataset: { field: 'oauthScopes', agyNoTranslate: 'true' },
                  onInput: (e) => update('oauthScopes', String(e?.target?.value ?? '')),
                })
              )
            )
          );
          if (draft.oauthClientMode === 'manual') {
            authChildren.push(
              h(
                doc,
                'div',
                { className: 'agy-mcp-grid-2' },
                h(
                  doc,
                  'div',
                  { className: 'agy-mcp-field' },
                  h(doc, 'label', { className: 'agy-mcp-label' }, 'Client ID'),
                  h(doc, 'input', {
                    type: 'text',
                    className: 'agy-mcp-input',
                    value: draft.oauthClientId || '',
                    dataset: { field: 'oauthClientId', agyNoTranslate: 'true' },
                    onInput: (e) => update('oauthClientId', String(e?.target?.value ?? '')),
                  })
                ),
                h(
                  doc,
                  'div',
                  { className: 'agy-mcp-field' },
                  h(doc, 'label', { className: 'agy-mcp-label' }, 'Client Secret (optional)'),
                  h(doc, 'input', {
                    type: 'password',
                    className: 'agy-mcp-input',
                    autocomplete: 'off',
                    value: draft.oauthClientSecret || '',
                    dataset: { field: 'oauthClientSecret', agyNoTranslate: 'true' },
                    onInput: (e) => update('oauthClientSecret', String(e?.target?.value ?? '')),
                  })
                )
              )
            );
          }
          authChildren.push(
            h(
              doc,
              'div',
              { className: 'agy-mcp-row' },
              h(doc, 'input', {
                type: 'password',
                className: 'agy-mcp-input',
                style: { flex: '1 1 220px' },
                placeholder: 'Paste OAuth authorization code...',
                autocomplete: 'off',
                value: draft.oauthCode || '',
                dataset: { field: 'oauthCode', agyNoTranslate: 'true' },
                onInput: (e) => update('oauthCode', String(e?.target?.value ?? '')),
              }),
              h(
                doc,
                'button',
                {
                  type: 'button',
                  className: 'agy-mcp-btn',
                  dataset: { testid: 'agy-mcp-submit-oauth-btn', agyNoTranslate: 'true' },
                  onClick: () => onSubmitOAuthCodeInline(),
                },
                'Complete OAuth'
              )
            )
          );
        }
      }
      if (draft.transport !== 'stdio' && (draft.authMode === 'bearer' || draft.authMode === 'apiKey' || draft.authMode === 'basic')) {
        authChildren.push(
          h(
            doc,
            'label',
            { className: 'agy-mcp-row', style: { fontSize: '12px' } },
            h(doc, 'input', {
              type: 'checkbox',
              checked: Boolean(draft.applyAuthToAllHttp),
              dataset: { field: 'applyAuthToAllHttp' },
              onChange: (e) => update('applyAuthToAllHttp', Boolean(e?.target?.checked)),
            }),
            'Also apply these auth headers to all eligible HTTPS / loopback HTTP MCP servers'
          )
        );
      }
      sections.push(
        h(
          doc,
          'section',
          {
            className: 'agy-mcp-card',
            dataset: { testid: 'agy-mcp-auth-section' },
          },
          ...authChildren
        )
      );
      const footerRow = [
        h(
          doc,
          'button',
          {
            type: 'button',
            className: 'agy-mcp-btn agy-mcp-btn-primary',
            dataset: {
              testid: isPopup ? 'agy-mcp-popup-save-btn' : 'agy-mcp-form-save-btn',
              agyNoTranslate: 'true',
            },
            onClick: () => onSave(),
          },
          isPopup ? 'Save Changes' : 'Save Server'
        ),
      ];
      if (isPopup && typeof onDelete === 'function' && (draft.originalServerName || draft.serverName)) {
        footerRow.push(
          h(
            doc,
            'button',
            {
              type: 'button',
              className: 'agy-mcp-btn agy-mcp-btn-danger',
              dataset: { testid: 'agy-mcp-popup-delete-btn', agyNoTranslate: 'true' },
              onClick: () => onDelete(),
            },
            'Delete Server'
          )
        );
      }
      sections.push(h(doc, 'div', { className: 'agy-mcp-row' }, ...footerRow));
      return h(
        doc,
        'form',
        {
          className: 'agy-mcp-card',
          onSubmit: (e) => {
            e?.preventDefault?.();
            onSave();
          },
        },
        ...sections
      );
    }
    module.exports = {
      createEmptyEditorDraft,
      specToEditorFormDraft,
      renderServerEditorForm,
    };
  },
  "./ui/views/oauth-connect-dialog": function(module, exports, __require) {
    const require = (spec) => __require("./ui/views", spec);
    'use strict';
    const { h, isImeComposing } = require('../dom-kit');
    const { redactSensitiveUrl } = require('../../core/schema/auth-codec');
    const OAUTH_MODAL_ID = 'agy-mcp-oauth-connect-backdrop';
    function renderOAuthConnectDialog(props) {
      const {
        doc,
        serverName,
        authUrl,
        statusMessage,
        errorMessage,
        oauthModalCode,
        onCodeChange,
        onLaunchBrowser,
        onSubmitCode,
        onCancel,
      } = props;
      const titleId = 'agy-mcp-oauth-dialog-title';
      const descId = 'agy-mcp-oauth-dialog-desc';
      const dialogEl = h(
        doc,
        'div',
        {
          className: 'agy-mcp-dialog agy-mcp-dialog-compact',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': titleId,
          'aria-describedby': descId,
          tabindex: '-1',
          dataset: { testid: 'agy-mcp-oauth-connect-modal' },
        },
        h(
          doc,
          'div',
          { className: 'agy-mcp-header' },
          h(
            doc,
            'div',
            null,
            h(doc, 'h2', { id: titleId, className: 'agy-mcp-title', dataset: { agyNoTranslate: 'true' } }, `OAuth Sign-In: ${serverName}`),
            h(doc, 'p', { id: descId, className: 'agy-mcp-subtitle' }, 'Authorize access in your browser, or paste the authorization code below.')
          ),
          h(
            doc,
            'button',
            {
              type: 'button',
              className: 'agy-mcp-btn',
              'aria-label': 'Close OAuth dialog',
              dataset: { testid: 'agy-mcp-oauth-cancel-btn', agyNoTranslate: 'true' },
              onClick: () => onCancel(),
            },
            'Close'
          )
        ),
        h(
          doc,
          'div',
          { className: 'agy-mcp-body' },
          errorMessage
            ? h(doc, 'div', { className: 'agy-mcp-banner agy-mcp-banner-error', role: 'alert' }, errorMessage)
            : null,
          statusMessage
            ? h(doc, 'div', { className: 'agy-mcp-banner agy-mcp-banner-info', role: 'status', 'aria-live': 'polite' }, statusMessage)
            : null,
          authUrl
            ? h(
                doc,
                'div',
                {
                  style: {
                    fontSize: '12px',
                    color: 'var(--mcp-text-secondary)',
                    fontFamily: 'ui-monospace, monospace',
                    wordBreak: 'break-all',
                  },
                },
                redactSensitiveUrl(authUrl)
              )
            : null,
          h(
            doc,
            'div',
            { className: 'agy-mcp-row' },
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn agy-mcp-btn-primary',
                disabled: !authUrl,
                dataset: { testid: 'agy-mcp-oauth-launch-btn', agyNoTranslate: 'true' },
                onClick: () => onLaunchBrowser(),
              },
              'Open Sign-In Page'
            )
          ),
          h(
            doc,
            'div',
            { className: 'agy-mcp-field' },
            h(doc, 'label', { className: 'agy-mcp-label' }, 'Authorization Code (if redirected manually)'),
            h(doc, 'input', {
              type: 'password',
              className: 'agy-mcp-input',
              placeholder: 'Paste OAuth code...',
              autocomplete: 'off',
              value: oauthModalCode || '',
              dataset: { field: 'oauthModalCode', agyNoTranslate: 'true' },
              onInput: (e) => onCodeChange(String(e?.target?.value ?? '')),
              onKeydown: (e) => {
                if (isImeComposing(e)) return;
                if (e && e.key === 'Enter') {
                  e.preventDefault?.();
                  onSubmitCode();
                }
              },
            })
          ),
          h(
            doc,
            'div',
            { className: 'agy-mcp-row' },
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn agy-mcp-btn-primary',
                dataset: { testid: 'agy-mcp-submit-oauth-btn', agyNoTranslate: 'true' },
                onClick: () => onSubmitCode(),
              },
              'Complete Sign-In'
            )
          )
        )
      );
      const backdrop = h(
        doc,
        'div',
        {
          id: OAUTH_MODAL_ID,
          className: 'agy-mcp-backdrop',
          onClick: (e) => {
            if (e && e.target === backdrop) {
              onCancel();
            }
          },
        },
        dialogEl
      );
      return { backdrop, dialogEl };
    }
    module.exports = {
      OAUTH_MODAL_ID,
      renderOAuthConnectDialog,
    };
  },
  "./ui/views/raw-json-editor": function(module, exports, __require) {
    const require = (spec) => __require("./ui/views", spec);
    'use strict';
    const { h } = require('../dom-kit');
    function renderRawJsonEditor(props) {
      const {
        doc,
        rawText,
        configPathLabel,
        invalidJsonError,
        conflictState,
        onRawTextChange,
        onSaveRaw,
        onReloadDisk,
        onRevealInExplorer,
      } = props;
      const children = [];
      if (invalidJsonError) {
        children.push(
          h(
            doc,
            'div',
            {
              className: 'agy-mcp-banner agy-mcp-banner-error',
              role: 'alert',
              dataset: { testid: 'agy-mcp-invalid-json-banner' },
            },
            `Broken mcp_config.json detected (${invalidJsonError}). Edit the raw text below and click Save Raw Config to repair it.`
          )
        );
      }
      if (conflictState) {
        children.push(
          h(
            doc,
            'div',
            {
              className: 'agy-mcp-banner agy-mcp-banner-warn',
              role: 'alert',
              dataset: { testid: 'agy-mcp-conflict-banner' },
            },
            h(
              doc,
              'div',
              { style: { marginBottom: '6px' } },
              conflictState.error || 'mcp_config.json was modified externally on disk since you opened it.'
            ),
            h(
              doc,
              'div',
              { className: 'agy-mcp-row' },
              h(
                doc,
                'button',
                {
                  type: 'button',
                  className: 'agy-mcp-btn',
                  dataset: { testid: 'agy-mcp-reload-disk-btn', agyNoTranslate: 'true' },
                  onClick: () => onReloadDisk(),
                },
                'Reload Latest From Disk'
              )
            )
          )
        );
      }
      children.push(
        h(
          doc,
          'div',
          { className: 'agy-mcp-row', style: { justifyContent: 'space-between' } },
          h(
            doc,
            'span',
            {
              style: { fontSize: '12px', color: 'var(--mcp-text-secondary)', fontFamily: 'ui-monospace, monospace' },
              dataset: { agyNoTranslate: 'true' },
            },
            configPathLabel || 'mcp_config.json'
          ),
          h(
            doc,
            'div',
            { className: 'agy-mcp-row' },
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn',
                dataset: { testid: 'agy-mcp-reveal-config-btn', agyNoTranslate: 'true' },
                onClick: () => onRevealInExplorer(),
              },
              'Reveal File'
            ),
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn',
                dataset: { testid: 'agy-mcp-reload-raw-btn', agyNoTranslate: 'true' },
                onClick: () => onReloadDisk(),
              },
              'Reload'
            )
          )
        ),
        h(doc, 'textarea', {
          className: 'agy-mcp-textarea',
          style: { minHeight: '260px' },
          'aria-label': 'Raw mcp_config.json content',
          value: rawText ?? '',
          dataset: { field: 'rawJsonText', testid: 'agy-mcp-raw-textarea', agyNoTranslate: 'true' },
          onInput: (e) => onRawTextChange(String(e?.target?.value ?? '')),
        }),
        h(
          doc,
          'div',
          { className: 'agy-mcp-row' },
          h(
            doc,
            'button',
            {
              type: 'button',
              className: 'agy-mcp-btn agy-mcp-btn-primary',
              dataset: { testid: 'agy-mcp-save-raw-btn', agyNoTranslate: 'true' },
              onClick: () => onSaveRaw(),
            },
            'Save Raw Config'
          )
        )
      );
      return h(doc, 'section', { className: 'agy-mcp-card' }, ...children);
    }
    module.exports = {
      renderRawJsonEditor,
    };
  },
  "./ui/modal-controller": function(module, exports, __require) {
    const require = (spec) => __require("./ui", spec);
    'use strict';
    const { DisposableStore } = require('../core/disposable');
    const { parseSmartMcpInput } = require('../core/schema/smart-parser');
    const {
      hasPathEnvOverride,
      validateAndBuildServerSpec,
      extractAndValidateTransport,
    } = require('../core/schema/server-spec');
    const { sanitizeServerName } = require('../core/schema/presets');
    const { ensureModalStyles, removeModalStyles, DEFAULT_STYLE_ID } = require('./design-tokens-styles');
    const {
      h,
      clearElement,
      getFocusableElements,
      restoreFocusSafely,
      installDialogKeyboardTrap,
    } = require('./dom-kit');
    const { renderQuickAddBar } = require('./views/quick-add-bar');
    const { renderServerCardList } = require('./views/server-card-list');
    const {
      createEmptyEditorDraft,
      specToEditorFormDraft,
      renderServerEditorForm,
    } = require('./views/server-editor-form');
    const { OAUTH_MODAL_ID, renderOAuthConnectDialog } = require('./views/oauth-connect-dialog');
    const { renderRawJsonEditor } = require('./views/raw-json-editor');
    const { disposableTimeout } = require('../shared/dom-disposables');
    const MODAL_ID = 'agy-mcp-manager-modal-backdrop';
    const EDIT_POPUP_ID = 'agy-mcp-edit-popup-backdrop';
    const SETTINGS_PANE_ID = 'agy-mcp-settings-pane';
    function createModalController(options) {
      const win = options.win;
      const doc = options.doc;
      const service = options.service;
      const brandProfile = options.brandProfile || {};
      const ownsStyles = options.ownsStyles !== false;
      const rootStore = new DisposableStore();
      let modalStore = null;
      let popupStore = null;
      let oauthStore = null;
      let activeTab = 'servers';
      let statusBanner = null;
      let conflictState = null;
      let invalidJsonError = null;
      let cachedServers = {};
      let cachedRuntimeStates = [];
      let cachedConfigLabel = 'mcp_config.json';
      let modalOpenerEl = null;
      let popupOpenerEl = null;
      let oauthOpenerEl = null;
      let settingsContainerEl = null;
      let oauthOpenSeq = 0;
      let oauthViewState = null;
      const getFallbackFocusTarget = () => {
        const sel = brandProfile.fallbackFocusSelector;
        if (!sel || !doc || typeof doc.querySelector !== 'function') return null;
        try {
          return doc.querySelector(sel);
        } catch {
          return null;
        }
      };
      const applyRootContainerAttributes = (el) => {
        if (!el || typeof el.setAttribute !== 'function') return;
        el.setAttribute('translate', 'no');
        if (brandProfile.rootAttributes && typeof brandProfile.rootAttributes === 'object') {
          const entries = Object.entries(brandProfile.rootAttributes);
          for (let i = 0; i < entries.length; i += 1) {
            const [attrName, attrVal] = entries[i];
            if (attrVal !== undefined && attrVal !== null) {
              el.setAttribute(attrName, String(attrVal));
            }
          }
        }
      };
      const scrubSensitiveDomInputs = (rootEl) => {
        if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
        try {
          const inputs = rootEl.querySelectorAll('input, textarea');
          for (let i = 0; i < inputs.length; i += 1) {
            const el = inputs[i];
            const field = el?.dataset?.field || el?.getAttribute?.('data-field') || '';
            if (
              el?.type === 'password' ||
              field === 'quickAddInput' ||
              field === 'quickAddAuthToken' ||
              field === 'bearerToken' ||
              field === 'apiKeyValue' ||
              field === 'basicPass' ||
              field === 'oauthClientSecret' ||
              field === 'oauthCode' ||
              field === 'oauthModalCode' ||
              field === 'headersText' ||
              field === 'envText' ||
              field === 'rawJsonText' ||
              field === 'url'
            ) {
              el.value = '';
            }
          }
        } catch {
        }
      };
      const resetAllDraftsAndDomSecrets = (rootEl) => {
        scrubSensitiveDomInputs(rootEl);
        const d = service.clearSensitiveDrafts();
        d.editorFormDraft = createEmptyEditorDraft();
        conflictState = null;
      };
      const ensureEditorDraft = () => {
        const drafts = service.getDraftState();
        if (!drafts.editorFormDraft) {
          service.updateDraftState({ editorFormDraft: createEmptyEditorDraft() });
        }
        return service.getDraftState().editorFormDraft;
      };
      const syncDataFromService = async () => {
        const [cfgRes, rtRes] = await Promise.all([
          service.readMcpConfig(),
          service.listRuntimeServerStates(),
        ]);
        if (rtRes && rtRes.ok && Array.isArray(rtRes.states)) {
          cachedRuntimeStates = rtRes.states;
        }
        if (cfgRes.ok) {
          cachedServers = cfgRes.servers || {};
          cachedConfigLabel = cfgRes.fsPath || cfgRes.uri || 'mcp_config.json';
          invalidJsonError = null;
          const drafts = service.getDraftState();
          if (drafts.rawTextDraft === null || drafts.rawTextDraft === undefined || drafts.rawTextDraft === '') {
            service.updateDraftState({
              rawTextDraft: cfgRes.rawText || JSON.stringify({ mcpServers: cachedServers }, null, 2),
            });
          }
        } else if (cfgRes.code === 'INVALID_JSON') {
          invalidJsonError = cfgRes.error || 'Invalid JSON syntax';
          cachedConfigLabel = cfgRes.fsPath || cfgRes.uri || 'mcp_config.json';
          activeTab = 'raw';
        } else {
          statusBanner = {
            kind: 'error',
            text: cfgRes.error || `Failed to load MCP configuration (${cfgRes.code})`,
          };
        }
        rerenderMountedSurfaces();
        return cfgRes;
      };
      const handleQuickAdd = async () => {
        const drafts = service.getDraftState();
        const parsed = parseSmartMcpInput(drafts.quickAddInput || '', {
          quickAuthInput: drafts.quickAddAuthToken || '',
        });
        if (!parsed.ok) {
          statusBanner = { kind: 'error', text: parsed.error || 'Unable to parse input' };
          rerenderMountedSurfaces();
          return;
        }
        const entries = parsed.multipleServers
          ? Object.entries(parsed.multipleServers).map(([serverName, spec]) => ({ serverName, spec }))
          : [{ serverName: parsed.serverName, spec: parsed.spec }];
        let requiresCommandConfirm = false;
        let hasPathOverride = false;
        for (let i = 0; i < entries.length; i += 1) {
          const tr = extractAndValidateTransport(entries[i].spec);
          if (tr.ok && tr.transport === 'stdio') {
            requiresCommandConfirm = true;
          }
          if (hasPathEnvOverride(entries[i].spec?.env)) {
            requiresCommandConfirm = true;
            hasPathOverride = true;
          }
        }
        if (requiresCommandConfirm) {
          service.updateDraftState({
            pendingCommandConfirmation: {
              entries,
              hasPathOverride,
            },
          });
          statusBanner = {
            kind: 'warn',
            text: 'Review and confirm the local command specification before execution.',
          };
          rerenderMountedSurfaces();
          return;
        }
        await commitQuickAddEntries(entries, false);
      };
      const commitQuickAddEntries = async (entries, confirmPathOverride) => {
        for (let i = 0; i < entries.length; i += 1) {
          const { serverName, spec } = entries[i];
          const res = await service.saveServerSpec({
            serverName,
            spec,
            confirmPathOverride,
          });
          if (!res.ok) {
            if (res.code === 'CONFLICT') {
              conflictState = { error: res.error, currentRawText: res.currentRawText };
            }
            statusBanner = { kind: 'error', text: res.error || `Failed to save ${serverName}` };
            rerenderMountedSurfaces();
            return;
          }
        }
        service.updateDraftState({
          quickAddInput: '',
          quickAddAuthToken: '',
          pendingCommandConfirmation: null,
        });
        statusBanner = {
          kind: 'info',
          text:
            entries.length === 1
              ? `Added MCP server "${entries[0].serverName}".`
              : `Added ${entries.length} MCP servers.`,
        };
        await syncDataFromService();
      };
      const handleSmartFill = () => {
        const drafts = service.getDraftState();
        const parsed = parseSmartMcpInput(drafts.quickAddInput || '', {
          quickAuthInput: drafts.quickAddAuthToken || '',
        });
        if (!parsed.ok) {
          statusBanner = { kind: 'error', text: parsed.error || 'Unable to parse input' };
          rerenderMountedSurfaces();
          return;
        }
        const firstEntry = parsed.multipleServers
          ? Object.entries(parsed.multipleServers)[0]
          : [parsed.serverName, parsed.spec];
        if (!firstEntry) return;
        const nextDraft = specToEditorFormDraft(firstEntry[0], firstEntry[1]);
        nextDraft.originalServerName = '';
        service.updateDraftState({ editorFormDraft: nextDraft });
        activeTab = 'add';
        statusBanner = { kind: 'info', text: `Populated form for "${firstEntry[0]}". Review and click Save Server.` };
        rerenderMountedSurfaces();
      };
      const handleSaveEditorForm = async (closePopupAfterSave = false) => {
        const draft = ensureEditorDraft();
        const cleanName = sanitizeServerName(draft.serverName || '');
        if (!cleanName) {
          statusBanner = { kind: 'error', text: 'Server Name is required.' };
          rerenderMountedSurfaces();
          return;
        }
        const built = validateAndBuildServerSpec(
          {
            serverName: cleanName,
            transport: draft.transport,
            urlKey: draft.urlKey || 'serverUrl',
            url: draft.url,
            headersText: draft.headersText,
            command: draft.command,
            argsText: draft.argsText,
            cwd: draft.cwd,
            envText: draft.envText,
            description: draft.description,
            authMode: draft.authMode,
            bearerToken: draft.bearerToken,
            apiKeyHeader: draft.apiKeyHeader,
            apiKeyValue: draft.apiKeyValue,
            basicUser: draft.basicUser,
            basicPass: draft.basicPass,
            oauthClientMode: draft.oauthClientMode,
            oauthClientId: draft.oauthClientId,
            oauthClientSecret: draft.oauthClientSecret,
            oauthScopes: draft.oauthScopes,
          },
          {
            allowInsecureHttp: Boolean(draft.allowInsecureHttp),
            confirmPathOverride: Boolean(draft.confirmPathOverride),
          }
        );
        if (!built.ok) {
          statusBanner = { kind: 'error', text: built.error || 'Invalid server configuration' };
          rerenderMountedSurfaces();
          return;
        }
        const saveRes = await service.saveServerSpec({
          serverName: cleanName,
          previousServerName: draft.originalServerName || undefined,
          spec: built.spec,
          applyAuthToAllHttp: Boolean(draft.applyAuthToAllHttp),
          authInput: {
            authMode: draft.authMode,
            bearerToken: draft.bearerToken,
            apiKeyHeader: draft.apiKeyHeader,
            apiKeyValue: draft.apiKeyValue,
            basicUser: draft.basicUser,
            basicPass: draft.basicPass,
          },
          allowInsecureHttp: Boolean(draft.allowInsecureHttp),
          confirmPathOverride: Boolean(draft.confirmPathOverride),
        });
        if (!saveRes.ok) {
          if (saveRes.code === 'CONFLICT') {
            conflictState = { error: saveRes.error, currentRawText: saveRes.currentRawText };
          }
          statusBanner = { kind: 'error', text: saveRes.error || 'Failed to save server' };
          rerenderMountedSurfaces();
          return;
        }
        const skippedMsg =
          Array.isArray(saveRes.skippedInsecureHttpServers) && saveRes.skippedInsecureHttpServers.length > 0
            ? ` (Skipped non-loopback http:// servers: ${saveRes.skippedInsecureHttpServers.join(', ')})`
            : '';
        service.updateDraftState({ editorFormDraft: createEmptyEditorDraft() });
        statusBanner = { kind: 'info', text: `Saved MCP server "${cleanName}".${skippedMsg}` };
        activeTab = 'servers';
        if (closePopupAfterSave) {
          closeEditPopup();
        }
        await syncDataFromService();
      };
      const handleToggleServer = async (serverName, nextEnabled) => {
        const res = await service.toggleServerEnabled(serverName, nextEnabled);
        if (!res.ok) {
          if (res.code === 'CONFLICT' || res.code === 'ROLLBACK_CONFLICT') {
            conflictState = { error: res.error, currentRawText: res.currentRawText };
          }
          statusBanner = { kind: 'error', text: res.error || `Failed to toggle ${serverName}` };
          await syncDataFromService();
          return;
        }
        statusBanner = {
          kind: 'info',
          text: `${nextEnabled ? 'Enabled' : 'Disabled'} "${serverName}".`,
        };
        await syncDataFromService();
      };
      const handleDeleteServer = async (serverName, fromPopup = false) => {
        const res = await service.deleteServer(serverName);
        if (!res.ok) {
          if (res.code === 'CONFLICT') {
            conflictState = { error: res.error, currentRawText: res.currentRawText };
          }
          statusBanner = { kind: 'error', text: res.error || `Failed to delete ${serverName}` };
          rerenderMountedSurfaces();
          return;
        }
        statusBanner = { kind: 'info', text: `Deleted "${serverName}".` };
        if (fromPopup) {
          closeEditPopup();
        }
        await syncDataFromService();
      };
      const handleSaveRaw = async () => {
        const rawText = service.getDraftState().rawTextDraft ?? '';
        const res = await service.saveRawConfig(rawText);
        if (!res.ok) {
          if (res.code === 'CONFLICT') {
            conflictState = { error: res.error, currentRawText: res.currentRawText };
          }
          statusBanner = { kind: 'error', text: res.error || 'Failed to save raw configuration' };
          rerenderMountedSurfaces();
          return;
        }
        conflictState = null;
        invalidJsonError = null;
        service.updateDraftState({ rawTextDraft: res.rawText });
        statusBanner = { kind: 'info', text: 'Saved mcp_config.json and refreshed MCP servers.' };
        await syncDataFromService();
      };
      const buildMainContentNodes = (isEmbeddedSettings = false) => {
        const drafts = service.getDraftState();
        const editorDraft = ensureEditorDraft();
        const nodes = [];
        if (statusBanner) {
          const cls =
            statusBanner.kind === 'error'
              ? 'agy-mcp-banner agy-mcp-banner-error'
              : statusBanner.kind === 'warn'
                ? 'agy-mcp-banner agy-mcp-banner-warn'
                : 'agy-mcp-banner agy-mcp-banner-info';
          nodes.push(
            h(
              doc,
              'div',
              {
                className: cls,
                role: statusBanner.kind === 'error' || statusBanner.kind === 'warn' ? 'alert' : 'status',
                'aria-live': 'polite',
                dataset: { testid: 'agy-mcp-status-banner' },
              },
              statusBanner.text
            )
          );
        }
        if (isEmbeddedSettings) {
          nodes.push(
            h(
              doc,
              'div',
              { className: 'agy-mcp-row', style: { justifyContent: 'space-between' } },
              h(doc, 'h3', { className: 'agy-mcp-title', dataset: { agyNoTranslate: 'true' } }, 'Custom MCP Servers'),
              h(
                doc,
                'div',
                { className: 'agy-mcp-row' },
                h(
                  doc,
                  'button',
                  {
                    type: 'button',
                    className: 'agy-mcp-btn agy-mcp-btn-primary',
                    dataset: { testid: 'agy-mcp-settings-add-btn', agyNoTranslate: 'true' },
                    onClick: (e) => openModal({ initialTab: 'add', openerEl: e?.currentTarget || null }),
                  },
                  'Add Server'
                ),
                h(
                  doc,
                  'button',
                  {
                    type: 'button',
                    className: 'agy-mcp-btn',
                    dataset: { testid: 'agy-mcp-settings-edit-btn', agyNoTranslate: 'true' },
                    onClick: (e) => openEditPopup({ openerEl: e?.currentTarget || null }),
                  },
                  'Edit Servers'
                )
              )
            )
          );
        }
        if (activeTab === 'servers' || isEmbeddedSettings) {
          nodes.push(
            renderQuickAddBar({
              doc,
              draftState: drafts,
              onInputChange: (quickAddInput, quickAddAuthToken) => {
                service.updateDraftState({ quickAddInput, quickAddAuthToken });
              },
              onQuickAdd: () => {
                void handleQuickAdd();
              },
              onSmartFill: () => handleSmartFill(),
              onConfirmPendingCommand: () => {
                const pending = service.getDraftState().pendingCommandConfirmation;
                if (pending) {
                  void commitQuickAddEntries(pending.entries, Boolean(pending.hasPathOverride));
                }
              },
              onCancelPendingCommand: () => {
                service.updateDraftState({ pendingCommandConfirmation: null });
                statusBanner = null;
                rerenderMountedSurfaces();
              },
            })
          );
          const listContainer = h(doc, 'div', {
            style: { display: 'flex', flexDirection: 'column', gap: '10px' },
            dataset: { testid: 'agy-mcp-server-list' },
          });
          renderServerCardList({
            doc,
            container: listContainer,
            servers: cachedServers,
            runtimeStates: cachedRuntimeStates,
            onToggleServer: (name, enabled) => {
              void handleToggleServer(name, enabled);
            },
            onEditServer: (name) => {
              if (isEmbeddedSettings) {
                openEditPopup({ serverName: name });
              } else {
                service.updateDraftState({
                  editorFormDraft: specToEditorFormDraft(name, cachedServers[name]),
                });
                activeTab = 'add';
                rerenderMountedSurfaces();
              }
            },
            onDeleteServer: (name) => {
              void handleDeleteServer(name, false);
            },
            onRefreshServer: (name) => {
              void service.refreshServer(name).then(() => syncDataFromService());
            },
            onOpenOAuthConnect: (name) => {
              void openOAuthConnectModal(name);
            },
            onDisconnectOAuth: (name) => {
              void service.disconnectOAuth(name).then(() => syncDataFromService());
            },
          });
          nodes.push(listContainer);
        } else if (activeTab === 'add') {
          nodes.push(
            renderServerEditorForm({
              doc,
              draft: editorDraft,
              isPopup: false,
              onFieldChange: (patch) => {
                const shouldRerender = Boolean(patch.__rerender);
                const cleanPatch = { ...patch };
                delete cleanPatch.__rerender;
                service.updateDraftState({
                  editorFormDraft: { ...ensureEditorDraft(), ...cleanPatch },
                });
                if (shouldRerender) rerenderMountedSurfaces();
              },
              onApplyTemplate: (tpl) => {
                const nextDraft = specToEditorFormDraft(tpl.serverName, tpl.spec);
                nextDraft.originalServerName = '';
                service.updateDraftState({ editorFormDraft: nextDraft });
                rerenderMountedSurfaces();
              },
              onOpenOAuthConnect: () => {
                const targetName = sanitizeServerName(ensureEditorDraft().serverName || '');
                if (!targetName) {
                  statusBanner = { kind: 'error', text: 'Save or name the server first before starting OAuth.' };
                  rerenderMountedSurfaces();
                  return;
                }
                void openOAuthConnectModal(targetName);
              },
              onSubmitOAuthCodeInline: () => {
                const d = ensureEditorDraft();
                const targetName = sanitizeServerName(d.serverName || '');
                void service.completeOAuth(targetName, d.oauthCode).then((res) => {
                  if (!res.ok) {
                    statusBanner = { kind: 'error', text: res.error || 'OAuth code submission failed' };
                    rerenderMountedSurfaces();
                    return;
                  }
                  service.updateDraftState({
                    editorFormDraft: { ...ensureEditorDraft(), oauthCode: '' },
                  });
                  statusBanner = { kind: 'info', text: `Completed OAuth for "${targetName}".` };
                  void syncDataFromService();
                });
              },
              onSave: () => {
                void handleSaveEditorForm(false);
              },
            })
          );
        } else if (activeTab === 'raw') {
          nodes.push(
            renderRawJsonEditor({
              doc,
              rawText: drafts.rawTextDraft ?? '',
              configPathLabel: cachedConfigLabel,
              invalidJsonError,
              conflictState,
              onRawTextChange: (nextText) => {
                service.updateDraftState({ rawTextDraft: nextText });
              },
              onSaveRaw: () => {
                void handleSaveRaw();
              },
              onReloadDisk: () => {
                conflictState = null;
                service.updateDraftState({ rawTextDraft: null });
                void syncDataFromService();
              },
              onRevealInExplorer: () => {
                void service.revealConfigInExplorer().then((res) => {
                  if (!res || !res.ok) {
                    statusBanner = { kind: 'warn', text: res?.error || 'Explorer reveal unavailable in this host mode.' };
                    rerenderMountedSurfaces();
                  }
                });
              },
            })
          );
        }
        return nodes;
      };
      const renderMainModalDom = () => {
        if (!doc || typeof doc.getElementById !== 'function') return;
        const backdrop = doc.getElementById(MODAL_ID);
        if (!backdrop) return;
        const bodyEl = backdrop.querySelector?.('[data-testid="agy-mcp-modal-body"]') || backdrop._bodyEl;
        const tabsEl = backdrop.querySelector?.('[data-testid="agy-mcp-modal-tabs"]') || backdrop._tabsEl;
        if (tabsEl) {
          clearElement(tabsEl);
          const tabDefs = [
            { id: 'servers', label: 'Servers' },
            { id: 'add', label: 'Add / Edit Server' },
            { id: 'raw', label: 'Raw JSON' },
          ];
          for (let i = 0; i < tabDefs.length; i += 1) {
            const t = tabDefs[i];
            tabsEl.appendChild(
              h(
                doc,
                'button',
                {
                  type: 'button',
                  role: 'tab',
                  className: 'agy-mcp-tab-btn',
                  'aria-selected': activeTab === t.id ? 'true' : 'false',
                  dataset: { testid: `agy-mcp-tab-${t.id}`, agyNoTranslate: 'true' },
                  onClick: () => {
                    activeTab = t.id;
                    renderMainModalDom();
                  },
                },
                t.label
              )
            );
          }
        }
        if (bodyEl) {
          preserveOrRenderBody(bodyEl, buildMainContentNodes(false));
        }
      };
      const preserveOrRenderBody = (bodyEl, nextNodes) => {
        const prevScroll = typeof bodyEl.scrollTop === 'number' ? bodyEl.scrollTop : 0;
        clearElement(bodyEl);
        for (let i = 0; i < nextNodes.length; i += 1) {
          bodyEl.appendChild(nextNodes[i]);
        }
        if (typeof prevScroll === 'number') {
          bodyEl.scrollTop = prevScroll;
        }
      };
      const renderPopupDom = () => {
        if (!doc || typeof doc.getElementById !== 'function') return;
        const backdrop = doc.getElementById(EDIT_POPUP_ID);
        if (!backdrop) return;
        const bodyEl = backdrop._bodyEl || backdrop.querySelector?.('[data-testid="agy-mcp-popup-body"]');
        if (!bodyEl) return;
        const editorDraft = ensureEditorDraft();
        const names = Object.keys(cachedServers || {});
        clearElement(bodyEl);
        if (statusBanner) {
          bodyEl.appendChild(
            h(
              doc,
              'div',
              {
                className:
                  statusBanner.kind === 'error'
                    ? 'agy-mcp-banner agy-mcp-banner-error'
                    : 'agy-mcp-banner agy-mcp-banner-info',
                role: statusBanner.kind === 'error' ? 'alert' : 'status',
              },
              statusBanner.text
            )
          );
        }
        bodyEl.appendChild(
          renderServerEditorForm({
            doc,
            draft: editorDraft,
            isPopup: true,
            existingServerNames: names,
            onSelectServerInPopup: (selectedName) => {
              if (cachedServers[selectedName]) {
                service.updateDraftState({
                  editorFormDraft: specToEditorFormDraft(selectedName, cachedServers[selectedName]),
                });
                renderPopupDom();
              }
            },
            onFieldChange: (patch) => {
              const shouldRerender = Boolean(patch.__rerender);
              const cleanPatch = { ...patch };
              delete cleanPatch.__rerender;
              service.updateDraftState({
                editorFormDraft: { ...ensureEditorDraft(), ...cleanPatch },
              });
              if (shouldRerender) renderPopupDom();
            },
            onApplyTemplate: () => {},
            onOpenOAuthConnect: () => {
              const target = sanitizeServerName(ensureEditorDraft().serverName || '');
              if (target) void openOAuthConnectModal(target);
            },
            onSubmitOAuthCodeInline: () => {
              const d = ensureEditorDraft();
              const target = sanitizeServerName(d.serverName || '');
              void service.completeOAuth(target, d.oauthCode).then((res) => {
                statusBanner = res.ok
                  ? { kind: 'info', text: `Completed OAuth for "${target}".` }
                  : { kind: 'error', text: res.error || 'OAuth failed' };
                renderPopupDom();
              });
            },
            onSave: () => {
              void handleSaveEditorForm(true);
            },
            onDelete: () => {
              const target = ensureEditorDraft().originalServerName || ensureEditorDraft().serverName;
              if (target) void handleDeleteServer(target, true);
            },
          })
        );
      };
      const rerenderMountedSurfaces = () => {
        renderMainModalDom();
        renderPopupDom();
        if (settingsContainerEl && (settingsContainerEl.isConnected !== false)) {
          preserveOrRenderBody(settingsContainerEl, buildMainContentNodes(true));
        }
      };
      function openModal(openOpts = {}) {
        if (rootStore.isDisposed || !doc || !doc.body) return null;
        ensureModalStyles(doc, DEFAULT_STYLE_ID);
        if (openOpts.initialTab) {
          activeTab = openOpts.initialTab;
        }
        modalOpenerEl = openOpts.openerEl || doc.activeElement || null;
        const existing = typeof doc.getElementById === 'function' ? doc.getElementById(MODAL_ID) : null;
        if (existing) {
          applyRootContainerAttributes(existing);
          renderMainModalDom();
          void syncDataFromService();
          return existing;
        }
        if (modalStore) modalStore.dispose();
        modalStore = new DisposableStore();
        const titleId = 'agy-mcp-modal-title';
        const descId = 'agy-mcp-modal-desc';
        const tabsEl = h(doc, 'div', {
          className: 'agy-mcp-tabs',
          role: 'tablist',
          dataset: { testid: 'agy-mcp-modal-tabs' },
        });
        const bodyEl = h(doc, 'div', {
          className: 'agy-mcp-body',
          dataset: { testid: 'agy-mcp-modal-body' },
        });
        const dialogEl = h(
          doc,
          'div',
          {
            className: 'agy-mcp-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': titleId,
            'aria-describedby': descId,
            tabindex: '-1',
            dataset: { testid: 'agy-mcp-modal-dialog' },
          },
          h(
            doc,
            'div',
            { className: 'agy-mcp-header' },
            h(
              doc,
              'div',
              null,
              h(
                doc,
                'h2',
                { id: titleId, className: 'agy-mcp-title', dataset: { agyNoTranslate: 'true' } },
                `${brandProfile.productDisplayName || 'Custom'} MCP Server Manager`
              ),
              h(
                doc,
                'p',
                { id: descId, className: 'agy-mcp-subtitle' },
                'Manage Stdio & HTTP MCP servers in mcp_config.json'
              )
            ),
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn',
                'aria-label': 'Close MCP Server Manager',
                dataset: { testid: 'agy-mcp-close-btn', agyNoTranslate: 'true' },
                onClick: () => closeModal(),
              },
              'Close'
            )
          ),
          tabsEl,
          bodyEl
        );
        const backdrop = h(
          doc,
          'div',
          {
            id: MODAL_ID,
            className: 'agy-mcp-backdrop',
            onClick: (e) => {
              if (e && e.target === backdrop) {
                closeModal();
              }
            },
          },
          dialogEl
        );
        applyRootContainerAttributes(backdrop);
        backdrop._tabsEl = tabsEl;
        backdrop._bodyEl = bodyEl;
        modalStore.add(
          installDialogKeyboardTrap({
            doc,
            dialogEl,
            onEscape: () => closeModal(),
          })
        );
        doc.body.appendChild(backdrop);
        renderMainModalDom();
        const focusables = getFocusableElements(dialogEl);
        if (focusables.length > 0) {
          focusables[0].focus();
        } else {
          dialogEl.focus?.();
        }
        void syncDataFromService();
        return backdrop;
      }
      function closeModal() {
        const backdrop = doc && typeof doc.getElementById === 'function' ? doc.getElementById(MODAL_ID) : null;
        resetAllDraftsAndDomSecrets(backdrop);
        statusBanner = null;
        if (modalStore) {
          modalStore.dispose();
          modalStore = null;
        }
        if (backdrop) {
          if (typeof backdrop.remove === 'function') backdrop.remove();
          else if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }
        const opener = modalOpenerEl;
        modalOpenerEl = null;
        restoreFocusSafely(doc, opener, getFallbackFocusTarget);
      }
      function openEditPopup(popupOpts = {}) {
        if (rootStore.isDisposed || !doc || !doc.body) return null;
        ensureModalStyles(doc, DEFAULT_STYLE_ID);
        popupOpenerEl = popupOpts.openerEl || doc.activeElement || null;
        const existing = typeof doc.getElementById === 'function' ? doc.getElementById(EDIT_POPUP_ID) : null;
        if (existing) {
          closeEditPopup();
        }
        if (popupStore) popupStore.dispose();
        popupStore = new DisposableStore();
        const titleId = 'agy-mcp-edit-popup-title';
        const descId = 'agy-mcp-edit-popup-desc';
        const bodyEl = h(doc, 'div', {
          className: 'agy-mcp-body',
          dataset: { testid: 'agy-mcp-popup-body' },
        });
        const dialogEl = h(
          doc,
          'div',
          {
            className: 'agy-mcp-dialog agy-mcp-dialog-compact',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': titleId,
            'aria-describedby': descId,
            tabindex: '-1',
            dataset: { testid: 'agy-mcp-edit-popup' },
          },
          h(
            doc,
            'div',
            { className: 'agy-mcp-header' },
            h(
              doc,
              'div',
              null,
              h(doc, 'h2', { id: titleId, className: 'agy-mcp-title', dataset: { agyNoTranslate: 'true' } }, 'Edit MCP Server'),
              h(doc, 'p', { id: descId, className: 'agy-mcp-subtitle' }, 'Modify or remove an existing custom MCP server')
            ),
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn',
                'aria-label': 'Close Edit MCP Server popup',
                dataset: { testid: 'agy-mcp-popup-close-btn', agyNoTranslate: 'true' },
                onClick: () => closeEditPopup(),
              },
              'Close'
            )
          ),
          bodyEl
        );
        const backdrop = h(
          doc,
          'div',
          {
            id: EDIT_POPUP_ID,
            className: 'agy-mcp-backdrop',
            onClick: (e) => {
              if (e && e.target === backdrop) {
                closeEditPopup();
              }
            },
          },
          dialogEl
        );
        applyRootContainerAttributes(backdrop);
        backdrop._bodyEl = bodyEl;
        popupStore.add(
          installDialogKeyboardTrap({
            doc,
            dialogEl,
            onEscape: () => closeEditPopup(),
          })
        );
        doc.body.appendChild(backdrop);
        void syncDataFromService().then(() => {
          const names = Object.keys(cachedServers || {});
          const chosen = popupOpts.serverName && cachedServers[popupOpts.serverName]
            ? popupOpts.serverName
            : names[0] || '';
          service.updateDraftState({
            editorFormDraft: chosen
              ? specToEditorFormDraft(chosen, cachedServers[chosen])
              : createEmptyEditorDraft(),
          });
          renderPopupDom();
          const focusables = getFocusableElements(dialogEl);
          if (focusables.length > 0) focusables[0].focus();
        });
        return backdrop;
      }
      function closeEditPopup() {
        const backdrop = doc && typeof doc.getElementById === 'function' ? doc.getElementById(EDIT_POPUP_ID) : null;
        resetAllDraftsAndDomSecrets(backdrop);
        if (popupStore) {
          popupStore.dispose();
          popupStore = null;
        }
        if (backdrop) {
          if (typeof backdrop.remove === 'function') backdrop.remove();
          else if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }
        const opener = popupOpenerEl;
        popupOpenerEl = null;
        restoreFocusSafely(doc, opener, getFallbackFocusTarget);
      }
      async function openOAuthConnectModal(serverName, openerEl = null) {
        if (rootStore.isDisposed || !doc || !doc.body) return null;
        ensureModalStyles(doc, DEFAULT_STYLE_ID);
        const seq = ++oauthOpenSeq;
        if (oauthStore) {
          oauthStore.dispose();
          oauthStore = null;
        }
        const prevBackdrop = typeof doc.getElementById === 'function' ? doc.getElementById(OAUTH_MODAL_ID) : null;
        if (prevBackdrop) {
          if (typeof prevBackdrop.remove === 'function') prevBackdrop.remove();
          else if (prevBackdrop.parentNode) prevBackdrop.parentNode.removeChild(prevBackdrop);
        }
        oauthOpenerEl = openerEl || doc.activeElement || null;
        oauthStore = new DisposableStore();
        oauthViewState = {
          serverName,
          authUrl: null,
          statusMessage: 'Discovering OAuth authorization endpoint...',
          errorMessage: null,
        };
        const mountOrRefreshOAuthDom = () => {
          if (seq !== oauthOpenSeq || !oauthViewState || rootStore.isDisposed) return;
          const prev = typeof doc.getElementById === 'function' ? doc.getElementById(OAUTH_MODAL_ID) : null;
          if (prev) {
            if (typeof prev.remove === 'function') prev.remove();
            else if (prev.parentNode) prev.parentNode.removeChild(prev);
          }
          const rendered = renderOAuthConnectDialog({
            doc,
            serverName: oauthViewState.serverName,
            authUrl: oauthViewState.authUrl,
            statusMessage: oauthViewState.statusMessage,
            errorMessage: oauthViewState.errorMessage,
            oauthModalCode: service.getDraftState().oauthCodeDraft || '',
            onCodeChange: (code) => {
              service.updateDraftState({ oauthCodeDraft: code });
            },
            onLaunchBrowser: () => {
              if (!oauthViewState?.authUrl) return;
              void service.openAuthUrl(oauthViewState.authUrl).then((res) => {
                if (seq !== oauthOpenSeq || !oauthViewState) return;
                if (!res.ok) {
                  oauthViewState.errorMessage = res.error || 'Blocked unsafe authorization URL';
                  mountOrRefreshOAuthDom();
                } else {
                  oauthViewState.statusMessage = 'Browser opened. Waiting for OAuth completion...';
                  mountOrRefreshOAuthDom();
                }
              });
            },
            onSubmitCode: () => {
              const code = service.getDraftState().oauthCodeDraft || '';
              void service.completeOAuth(serverName, code).then((res) => {
                if (seq !== oauthOpenSeq || !oauthViewState) return;
                if (!res.ok) {
                  oauthViewState.errorMessage = res.error || 'Failed to complete OAuth';
                  mountOrRefreshOAuthDom();
                  return;
                }
                closeOAuthConnectModal();
                statusBanner = { kind: 'info', text: `OAuth connected for "${serverName}".` };
                void syncDataFromService();
              });
            },
            onCancel: () => closeOAuthConnectModal(),
          });
          applyRootContainerAttributes(rendered.backdrop);
          oauthStore.add(
            installDialogKeyboardTrap({
              doc,
              dialogEl: rendered.dialogEl,
              onEscape: () => closeOAuthConnectModal(),
            })
          );
          doc.body.appendChild(rendered.backdrop);
          const focusables = getFocusableElements(rendered.dialogEl);
          if (focusables.length > 0) focusables[0].focus();
        };
        mountOrRefreshOAuthDom();
        const spec = cachedServers[serverName] || {};
        const disc = await service.discoverOAuthMetadata(serverName, spec);
        if (seq !== oauthOpenSeq || !oauthViewState || rootStore.isDisposed) return null;
        if (disc && disc.ok && disc.authUrl) {
          oauthViewState.authUrl = disc.authUrl;
          oauthViewState.statusMessage = 'Authorization URL ready. Click Open Sign-In Page to continue.';
          oauthViewState.errorMessage = null;
        } else {
          oauthViewState.statusMessage = 'Paste the authorization code manually if you already signed in.';
          oauthViewState.errorMessage = disc?.error || null;
        }
        mountOrRefreshOAuthDom();
        const schedulePoll = () => {
          if (seq !== oauthOpenSeq || !oauthStore || oauthStore.isDisposed) return;
          oauthStore.add(
            disposableTimeout(
              win,
              async () => {
                if (seq !== oauthOpenSeq || !oauthStore || oauthStore.isDisposed) return;
                const rt = await service.listRuntimeServerStates();
                if (seq !== oauthOpenSeq || !oauthStore || oauthStore.isDisposed) return;
                if (rt.ok && Array.isArray(rt.states)) {
                  const found = rt.states.find((s) => (s?.serverName || s?.name) === serverName && s?.oauthConnected);
                  if (found) {
                    closeOAuthConnectModal();
                    statusBanner = { kind: 'info', text: `OAuth connected for "${serverName}".` };
                    void syncDataFromService();
                    return;
                  }
                }
                schedulePoll();
              },
              600
            )
          );
        };
        schedulePoll();
        return typeof doc.getElementById === 'function' ? doc.getElementById(OAUTH_MODAL_ID) : null;
      }
      function closeOAuthConnectModal() {
        oauthOpenSeq += 1;
        oauthViewState = null;
        const backdrop = doc && typeof doc.getElementById === 'function' ? doc.getElementById(OAUTH_MODAL_ID) : null;
        scrubSensitiveDomInputs(backdrop);
        service.updateDraftState({ oauthCodeDraft: '' });
        if (oauthStore) {
          oauthStore.dispose();
          oauthStore = null;
        }
        if (backdrop) {
          if (typeof backdrop.remove === 'function') backdrop.remove();
          else if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }
        const opener = oauthOpenerEl;
        oauthOpenerEl = null;
        restoreFocusSafely(doc, opener, getFallbackFocusTarget);
      }
      function renderSettingsPageContent(container) {
        if (!container || rootStore.isDisposed) return;
        ensureModalStyles(doc, DEFAULT_STYLE_ID);
        settingsContainerEl = container;
        container.id = container.id || SETTINGS_PANE_ID;
        applyRootContainerAttributes(container);
        preserveOrRenderBody(container, buildMainContentNodes(true));
        void syncDataFromService();
      }
      function onSettingsPaneHidden() {
        if (settingsContainerEl) {
          scrubSensitiveDomInputs(settingsContainerEl);
        }
        resetAllDraftsAndDomSecrets(settingsContainerEl);
        settingsContainerEl = null;
      }
      function isModalOpen() {
        return Boolean(doc && typeof doc.getElementById === 'function' && doc.getElementById(MODAL_ID));
      }
      rootStore.add({
        dispose() {
          closeOAuthConnectModal();
          closeEditPopup();
          closeModal();
          onSettingsPaneHidden();
          if (ownsStyles) {
            removeModalStyles(doc, DEFAULT_STYLE_ID);
          }
        },
      });
      return {
        openModal,
        closeModal,
        isModalOpen,
        openEditPopup,
        closeEditPopup,
        openOAuthConnectModal,
        closeOAuthConnectModal,
        renderSettingsPageContent,
        onSettingsPaneHidden,
        refreshView: syncDataFromService,
        dispose: () => rootStore.dispose(),
      };
    }
    module.exports = {
      MODAL_ID,
      EDIT_POPUP_ID,
      OAUTH_MODAL_ID,
      SETTINGS_PANE_ID,
      createModalController,
    };
  },
  "./adapters/antigravity/host-config": function(module, exports, __require) {
    const require = (spec) => __require("./adapters/antigravity", spec);
    'use strict';
    const { matchesAllowedDomain, isAllowedHttpsScriptUrl } = require('../../core/security/url-policy');
    const ANTIGRAVITY_BRAND_PROFILE = Object.freeze({
      productDisplayName: 'Antigravity',
      trustedTypesPolicyNames: Object.freeze(['agy-mcp-manager', 'agy-mcp-companion']),
      fallbackFocusSelector:
        '#agy-mcp-remote-launcher, [data-testid="settings-nav-item-McpManager"], [data-testid="add-mcp-button"]',
      cdnPathPrefix: '/web/',
      rootAttributes: Object.freeze({
        'data-agy-no-translate': 'true',
      }),
    });
    const DEFAULT_HOST_ADAPTER_CONFIG = Object.freeze({
      rpcServicePrefix: '/exa.language_server_pb.LanguageServerService',
      remoteCsrfToken: 'csrf_token',
      remoteHostDomains: Object.freeze(['antigravity.google.com']),
      staticCdnOrigins: Object.freeze(['https://antigravity.static.usercontent.goog']),
      cdnOrigin: 'https://www.gstatic.com/antigravity',
      cdnPathPrefix: '/web/',
      allowedScriptDomains: Object.freeze([
        'antigravity.google.com',
        'antigravity.static.usercontent.goog',
        'www.gstatic.com',
        'raw.githubusercontent.com',
      ]),
      trustedTypesPolicyNames: Object.freeze([
        'agy-mcp-manager',
        'agy-mcp-companion',
        () => `agy-companion-${Date.now()}`,
      ]),
      companionUrls: Object.freeze({
        statusbar:
          'https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/main/dist/statusbar_autoinject.js',
        mcpManager:
          'https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js',
        koTranslator:
          'https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/plugins/ko-thought-translator/scripts/ko_thought_autoinject.js',
      }),
    });
    function resolveHostAdapterConfig(overrides, win) {
      const winOverrides =
        win && win.__AGY_MCP_HOST_CONFIG__ && typeof win.__AGY_MCP_HOST_CONFIG__ === 'object'
          ? win.__AGY_MCP_HOST_CONFIG__
          : null;
      const src = {
        ...DEFAULT_HOST_ADAPTER_CONFIG,
        ...(winOverrides || {}),
        ...(overrides && typeof overrides === 'object' ? overrides : {}),
      };
      const remoteHostDomains = Array.isArray(src.remoteHostDomains)
        ? src.remoteHostDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
        : Array.from(DEFAULT_HOST_ADAPTER_CONFIG.remoteHostDomains);
      const allowedScriptDomains = Array.isArray(src.allowedScriptDomains)
        ? src.allowedScriptDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
        : Array.from(DEFAULT_HOST_ADAPTER_CONFIG.allowedScriptDomains);
      const staticCdnOrigins = Array.isArray(src.staticCdnOrigins)
        ? src.staticCdnOrigins.map((o) => String(o).trim()).filter(Boolean)
        : Array.from(DEFAULT_HOST_ADAPTER_CONFIG.staticCdnOrigins);
      const trustedTypesPolicyNames = Array.isArray(src.trustedTypesPolicyNames)
        ? src.trustedTypesPolicyNames.slice()
        : Array.from(DEFAULT_HOST_ADAPTER_CONFIG.trustedTypesPolicyNames);
      const companionUrls = {
        ...DEFAULT_HOST_ADAPTER_CONFIG.companionUrls,
        ...(src.companionUrls && typeof src.companionUrls === 'object' ? src.companionUrls : {}),
      };
      const isRemoteHost = (hostname) => {
        const clean = String(hostname || '').trim().toLowerCase();
        if (!clean) return false;
        return matchesAllowedDomain(clean, remoteHostDomains);
      };
      return Object.freeze({
        rpcServicePrefix: String(src.rpcServicePrefix || DEFAULT_HOST_ADAPTER_CONFIG.rpcServicePrefix).replace(/\/+$/, ''),
        remoteCsrfToken: String(src.remoteCsrfToken || ''),
        remoteHostDomains: Object.freeze(remoteHostDomains),
        staticCdnOrigins: Object.freeze(staticCdnOrigins),
        cdnOrigin: String(src.cdnOrigin || DEFAULT_HOST_ADAPTER_CONFIG.cdnOrigin).replace(/\/+$/, ''),
        cdnPathPrefix: String(src.cdnPathPrefix || DEFAULT_HOST_ADAPTER_CONFIG.cdnPathPrefix),
        allowedScriptDomains: Object.freeze(allowedScriptDomains),
        trustedTypesPolicyNames: Object.freeze(trustedTypesPolicyNames),
        companionUrls: Object.freeze(companionUrls),
        configUriOverride: typeof src.configUriOverride === 'string' ? src.configUriOverride : '',
        isRemoteHost,
      });
    }
    function buildAllowedScriptUrlValidator(hostCfg, win) {
      const domains = new Set(hostCfg.allowedScriptDomains || []);
      try {
        const currentHost = String(win?.location?.hostname || '').trim().toLowerCase();
        const currentProto = String(win?.location?.protocol || '').toLowerCase();
        if (currentHost && currentProto === 'https:' && currentHost !== 'localhost') {
          domains.add(currentHost);
        }
      } catch {
      }
      const allowedList = Array.from(domains);
      const allowedOrigins = Array.isArray(hostCfg.staticCdnOrigins) ? hostCfg.staticCdnOrigins : [];
      return (candidateUrl) =>
        isAllowedHttpsScriptUrl(candidateUrl, {
          allowedDomains: allowedList,
          allowedOrigins,
        });
    }
    module.exports = {
      ANTIGRAVITY_BRAND_PROFILE,
      DEFAULT_HOST_ADAPTER_CONFIG,
      resolveHostAdapterConfig,
      buildAllowedScriptUrlValidator,
    };
  },
  "./adapters/antigravity/react-fiber-gateway": function(module, exports, __require) {
    const require = (spec) => __require("./adapters/antigravity", spec);
    'use strict';
    const MAX_FIBER_NODES = 3500;
    const FAILED_SCAN_THROTTLE_MS = 10000;
    function isLanguageServerClientCandidate(obj) {
      if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return false;
      return (
        typeof obj.getMcpServerStates === 'function' ||
        typeof obj.refreshMcpServers === 'function' ||
        typeof obj.toggleMcpServer === 'function' ||
        (typeof obj.readFile === 'function' && typeof obj.writeFile === 'function')
      );
    }
    function extractFiberFromDomNode(domNode) {
      if (!domNode || typeof domNode !== 'object') return null;
      const keys = Object.keys(domNode);
      for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        if (
          k.startsWith('__reactFiber$') ||
          k.startsWith('__reactContainer$') ||
          k.startsWith('__reactInternalInstance$')
        ) {
          const val = domNode[k];
          if (val && typeof val === 'object') return val;
        }
      }
      return null;
    }
    function createReactFiberGateway(options) {
      const { win, doc } = options;
      const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now();
      let cachedService = null;
      let cachedConfigDir = '';
      let cachedElectronFeature = null;
      let lastFailedScanAt = -Infinity;
      const inspectValueBag = (val, depth = 0) => {
        if (!val || typeof val !== 'object' || depth > 3) return;
        if (!cachedService && isLanguageServerClientCandidate(val)) {
          cachedService = val;
        }
        if (typeof val.get === 'function' && !(val instanceof Map) && !(val instanceof WeakMap)) {
          try {
            if (!cachedService) {
              const lsSvc = val.get('languageServerService') || val.get('LanguageServerService');
              if (isLanguageServerClientCandidate(lsSvc)) cachedService = lsSvc;
            }
          } catch {
          }
          try {
            if (!cachedElectronFeature) {
              const ef = val.get('electronNativeFeature');
              if (ef && typeof ef === 'object') cachedElectronFeature = ef;
            }
          } catch {
          }
        }
        if (!cachedElectronFeature && val.electronNativeFeature && typeof val.electronNativeFeature === 'object') {
          cachedElectronFeature = val.electronNativeFeature;
        }
        if (!cachedConfigDir) {
          const dirCandidate = val.selectedConfigDir || val.selectedGeminiDir || val.geminiConfigDir;
          if (typeof dirCandidate === 'string' && dirCandidate.trim()) {
            cachedConfigDir = dirCandidate.trim();
          }
        }
        if (depth < 2) {
          const subKeys = ['client', 'service', 'languageServerService', 'languageServerClient', 'value', 'context'];
          for (let i = 0; i < subKeys.length; i += 1) {
            const sub = val[subKeys[i]];
            if (sub && typeof sub === 'object') {
              inspectValueBag(sub, depth + 1);
            }
          }
        }
      };
      const scanDocumentWindow = (targetWin, targetDoc) => {
        if (targetWin && isLanguageServerClientCandidate(targetWin.__agyCapturedLsClient)) {
          cachedService = targetWin.__agyCapturedLsClient;
        }
        if (targetWin && isLanguageServerClientCandidate(targetWin.__agyLanguageServerService)) {
          cachedService = targetWin.__agyLanguageServerService;
        }
        if (targetWin && targetWin.__agyElectronNativeFeature && !cachedElectronFeature) {
          cachedElectronFeature = targetWin.__agyElectronNativeFeature;
        }
        if (!targetDoc) return;
        const roots = [];
        if (typeof targetDoc.getElementById === 'function') {
          const r1 = targetDoc.getElementById('root');
          const r2 = targetDoc.getElementById('app');
          if (r1) roots.push(r1);
          if (r2) roots.push(r2);
        }
        if (targetDoc.body) roots.push(targetDoc.body);
        if (targetDoc.documentElement) roots.push(targetDoc.documentElement);
        const fiberQueue = [];
        const visitedFibers = new Set();
        for (let i = 0; i < roots.length; i += 1) {
          const rootEl = roots[i];
          const f = extractFiberFromDomNode(rootEl);
          if (f && !visitedFibers.has(f)) {
            visitedFibers.add(f);
            fiberQueue.push(f);
          }
          const kids = rootEl?.children || [];
          for (let k = 0; k < Math.min(kids.length, 24); k += 1) {
            const kf = extractFiberFromDomNode(kids[k]);
            if (kf && !visitedFibers.has(kf)) {
              visitedFibers.add(kf);
              fiberQueue.push(kf);
            }
          }
        }
        let visitedCount = 0;
        while (fiberQueue.length > 0 && visitedCount < MAX_FIBER_NODES) {
          const node = fiberQueue.shift();
          visitedCount += 1;
          inspectValueBag(node.memoizedProps, 0);
          inspectValueBag(node.pendingProps, 0);
          inspectValueBag(node.stateNode, 0);
          let memoState = node.memoizedState;
          let hookSteps = 0;
          while (memoState && typeof memoState === 'object' && hookSteps < 24) {
            inspectValueBag(memoState.memoizedState, 0);
            memoState = memoState.next;
            hookSteps += 1;
          }
          let dep = node.dependencies?.firstContext;
          let depSteps = 0;
          while (dep && typeof dep === 'object' && depSteps < 16) {
            inspectValueBag(dep.memoizedValue, 0);
            dep = dep.next;
            depSteps += 1;
          }
          if (cachedService && cachedConfigDir && cachedElectronFeature) {
            break;
          }
          if (node.child && !visitedFibers.has(node.child)) {
            visitedFibers.add(node.child);
            fiberQueue.push(node.child);
          }
          if (node.sibling && !visitedFibers.has(node.sibling)) {
            visitedFibers.add(node.sibling);
            fiberQueue.push(node.sibling);
          }
        }
      };
      function resolveSnapshot(force = false) {
        if (cachedService && !force) {
          return {
            service: cachedService,
            configDir: cachedConfigDir,
            electronNativeFeature: cachedElectronFeature,
          };
        }
        const now = nowFn();
        if (!force && !cachedService && now - lastFailedScanAt < FAILED_SCAN_THROTTLE_MS) {
          return {
            service: null,
            configDir: cachedConfigDir,
            electronNativeFeature: cachedElectronFeature,
          };
        }
        scanDocumentWindow(win, doc);
        if (!cachedService && doc && typeof doc.querySelector === 'function') {
          try {
            const promotedIframe = doc.querySelector('ga-remote-control iframe, iframe');
            const cw = promotedIframe?.contentWindow;
            const cd = promotedIframe?.contentDocument || cw?.document;
            if (cw) {
              scanDocumentWindow(cw, cd);
            }
          } catch {
          }
        }
        if (!cachedService) {
          lastFailedScanAt = now;
        }
        return {
          service: cachedService,
          configDir: cachedConfigDir,
          electronNativeFeature: cachedElectronFeature,
        };
      }
      function resetCache() {
        cachedService = null;
        cachedConfigDir = '';
        cachedElectronFeature = null;
        lastFailedScanAt = -Infinity;
      }
      return {
        resolveSnapshot,
        getLanguageServerService(force = false) {
          return resolveSnapshot(force).service;
        },
        getConfigDir(force = false) {
          return resolveSnapshot(force).configDir;
        },
        getElectronNativeFeature(force = false) {
          return resolveSnapshot(force).electronNativeFeature;
        },
        resetCache,
        dispose() {
          resetCache();
        },
      };
    }
    module.exports = {
      MAX_FIBER_NODES,
      FAILED_SCAN_THROTTLE_MS,
      isLanguageServerClientCandidate,
      createReactFiberGateway,
    };
  },
  "./adapters/antigravity/remote-control-lease": function(module, exports, __require) {
    const require = (spec) => __require("./adapters/antigravity", spec);
    'use strict';
    const RC_TAP_METHODS = Object.freeze([
      'ngOnInit',
      'ngAfterViewInit',
      'onIframeLoad',
      'proxyCommand',
      'connect',
      'reconnect',
      'disconnect',
      'sendToIframe',
      'handleIframeMessage',
      'markIframeReady',
      'updateIframeSrc',
      'iframeSrc',
      'resetIframe',
      'onSessionChange',
      'openExternalUrl',
      'fetchMcpStates',
      'refreshMcp',
      'ngOnDestroy',
    ]);
    const PROTO_REGISTRY_SYMBOL = Symbol.for('agy.remoteControlPrototypeRegistry.v2');
    function isRemoteControlComponentCandidate(inst) {
      if (!inst || typeof inst !== 'object') return false;
      return (
        typeof inst.proxyCommand === 'function' ||
        typeof inst.onIframeLoad === 'function' ||
        (typeof inst.iframeSrc === 'function' && ('iframeLoading' in inst || 'iframeUiReady' in inst))
      );
    }
    function resolveRemoteControlInstance(win, doc) {
      if (!win) return null;
      if (isRemoteControlComponentCandidate(win.__agyRemoteControlInstance)) {
        return win.__agyRemoteControlInstance;
      }
      const targetDoc = doc || win.document;
      if (!targetDoc || typeof targetDoc.querySelector !== 'function') return null;
      let hostEl = null;
      try {
        hostEl = targetDoc.querySelector('ga-remote-control');
      } catch {
        return null;
      }
      if (!hostEl) return null;
      try {
        const viaNgGet = win.ng?.getComponent?.(hostEl);
        if (isRemoteControlComponentCandidate(viaNgGet)) {
          win.__agyRemoteControlInstance = viaNgGet;
          return viaNgGet;
        }
      } catch {
      }
      try {
        const lCtx = win.ng?.ɵgetLContext?.(hostEl);
        if (lCtx && isRemoteControlComponentCandidate(lCtx.component)) {
          win.__agyRemoteControlInstance = lCtx.component;
          return lCtx.component;
        }
      } catch {
      }
      const rawCtx = hostEl.__ngContext__;
      if (rawCtx) {
        const visited = new Set();
        const queue = [rawCtx];
        let steps = 0;
        while (queue.length > 0 && steps < 120) {
          const item = queue.shift();
          steps += 1;
          if (!item || typeof item !== 'object' || visited.has(item)) continue;
          visited.add(item);
          if (isRemoteControlComponentCandidate(item)) {
            win.__agyRemoteControlInstance = item;
            return item;
          }
          if (Array.isArray(item)) {
            for (let i = 0; i < Math.min(item.length, 60); i += 1) {
              const el = item[i];
              if (el && typeof el === 'object') queue.push(el);
            }
          } else if (item.lView && Array.isArray(item.lView)) {
            queue.push(item.lView);
          }
        }
      }
      return null;
    }
    function incrementIframeSuppression(rcInst) {
      if (!rcInst || typeof rcInst !== 'object') return () => {};
      rcInst.__agySuppressAutoIframeLoadCount = (rcInst.__agySuppressAutoIframeLoadCount || 0) + 1;
      rcInst.__agySuppressAutoIframeLoad = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        decrementIframeSuppression(rcInst);
      };
    }
    function decrementIframeSuppression(rcInst) {
      if (!rcInst || typeof rcInst !== 'object') return;
      const next = Math.max(0, (rcInst.__agySuppressAutoIframeLoadCount || 1) - 1);
      if (next === 0) {
        delete rcInst.__agySuppressAutoIframeLoadCount;
        rcInst.__agySuppressAutoIframeLoad = false;
        delete rcInst.__agySuppressAutoIframeLoad;
      } else {
        rcInst.__agySuppressAutoIframeLoadCount = next;
        rcInst.__agySuppressAutoIframeLoad = true;
      }
    }
    function ensurePrototypeTapRegistry(proto) {
      let reg = proto[PROTO_REGISTRY_SYMBOL];
      if (reg) return reg;
      const originalDescriptors = new Map();
      const activeLeases = new Set();
      const installWrappers = () => {
        for (let i = 0; i < RC_TAP_METHODS.length; i += 1) {
          const method = RC_TAP_METHODS[i];
          if (originalDescriptors.has(method)) continue;
          const desc = Object.getOwnPropertyDescriptor(proto, method);
          const origFn = desc && typeof desc.value === 'function' ? desc.value : (typeof proto[method] === 'function' ? proto[method] : null);
          if (!origFn) continue;
          originalDescriptors.set(method, { desc: desc || null, origFn });
          const wrapped = function (...args) {
            for (const lease of activeLeases) {
              if (typeof lease.onMethodCall === 'function') {
                lease.onMethodCall(method, this, args);
              }
            }
            if (
              method === 'onIframeLoad' &&
              this &&
              (this.__agySuppressAutoIframeLoad === true || (this.__agySuppressAutoIframeLoadCount || 0) > 0)
            ) {
              return undefined;
            }
            return origFn.apply(this, args);
          };
          Object.defineProperty(proto, method, {
            value: wrapped,
            writable: desc ? Boolean(desc.writable) : true,
            configurable: true,
            enumerable: desc ? Boolean(desc.enumerable) : false,
          });
        }
      };
      const restoreOriginalsIfEmpty = () => {
        if (activeLeases.size > 0) return;
        for (const [method, saved] of originalDescriptors.entries()) {
          if (saved.desc) {
            Object.defineProperty(proto, method, saved.desc);
          } else {
            delete proto[method];
          }
        }
        originalDescriptors.clear();
        delete proto[PROTO_REGISTRY_SYMBOL];
      };
      reg = {
        originalDescriptors,
        activeLeases,
        addLease(leaseEntry) {
          if (activeLeases.size === 0) {
            installWrappers();
          }
          activeLeases.add(leaseEntry);
        },
        removeLease(leaseEntry) {
          activeLeases.delete(leaseEntry);
          restoreOriginalsIfEmpty();
        },
        invokeOriginal(method, receiver, args = []) {
          const saved = originalDescriptors.get(method);
          if (saved && typeof saved.origFn === 'function') {
            return saved.origFn.apply(receiver, args);
          }
          const fn = receiver && typeof receiver[method] === 'function' ? receiver[method] : null;
          return fn ? fn.apply(receiver, args) : undefined;
        },
      };
      Object.defineProperty(proto, PROTO_REGISTRY_SYMBOL, {
        value: reg,
        configurable: true,
        enumerable: false,
        writable: false,
      });
      return reg;
    }
    function acquireRemoteControlLease(options = {}) {
      const defaultWin = options.win || null;
      const defaultDoc = options.doc || defaultWin?.document || null;
      let released = false;
      let latestInstance = null;
      const attachedRegistries = new Set();
      const leaseEntry = {
        onMethodCall(method, inst) {
          if (released) return;
          if (inst && typeof inst === 'object') {
            latestInstance = inst;
            if (defaultWin) {
              defaultWin.__agyRemoteControlInstance = inst;
            }
            if (typeof options.onInstanceSeen === 'function') {
              options.onInstanceSeen(inst, method);
            }
          }
        },
      };
      function tapTarget(winArg, rcInstArg) {
        if (released) return null;
        const targetWin = winArg || defaultWin;
        const inst = rcInstArg || resolveRemoteControlInstance(targetWin, defaultDoc) || latestInstance;
        if (!inst || typeof inst !== 'object') return null;
        latestInstance = inst;
        if (targetWin) {
          targetWin.__agyRemoteControlInstance = inst;
        }
        const proto = Object.getPrototypeOf(inst);
        if (proto && proto !== Object.prototype) {
          const reg = ensurePrototypeTapRegistry(proto);
          reg.addLease(leaseEntry);
          attachedRegistries.add(reg);
        }
        return inst;
      }
      function invokeOriginalOnIframeLoad(rcInst) {
        const target = rcInst || latestInstance;
        if (!target) return undefined;
        const proto = Object.getPrototypeOf(target);
        const reg = proto ? proto[PROTO_REGISTRY_SYMBOL] : null;
        if (reg) {
          return reg.invokeOriginal('onIframeLoad', target, []);
        }
        if (typeof target.onIframeLoad === 'function') {
          return target.onIframeLoad();
        }
        return undefined;
      }
      function release() {
        if (released) return;
        released = true;
        for (const reg of attachedRegistries) {
          reg.removeLease(leaseEntry);
        }
        attachedRegistries.clear();
        latestInstance = null;
      }
      return {
        tapTarget,
        getInstance(winArg, docArg) {
          if (released) return null;
          return tapTarget(winArg || defaultWin, resolveRemoteControlInstance(winArg || defaultWin, docArg || defaultDoc));
        },
        invokeOriginalOnIframeLoad,
        release,
        dispose: release,
      };
    }
    module.exports = {
      RC_TAP_METHODS,
      isRemoteControlComponentCandidate,
      resolveRemoteControlInstance,
      incrementIframeSuppression,
      decrementIframeSuppression,
      acquireRemoteControlLease,
    };
  },
  "./adapters/antigravity/rpc-transport": function(module, exports, __require) {
    const require = (spec) => __require("./adapters/antigravity", spec);
    'use strict';
    function toCamelCaseMethod(pascalMethod) {
      const clean = String(pascalMethod || '').trim();
      if (!clean) return '';
      return clean.charAt(0).toLowerCase() + clean.slice(1);
    }
    function unwrapProxyCommandResponse(rawResponse, methodName) {
      if (rawResponse === undefined || rawResponse === null) {
        return { __fromProxyCommand: true };
      }
      if (typeof rawResponse === 'string') {
        const trimmed = rawResponse.trim();
        if (!trimmed) return { __fromProxyCommand: true };
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          const err = new Error(`Non-JSON RPC response from ${methodName}: ${trimmed.slice(0, 160)}`);
          if (/404\s+page\s+not\s+found|\bhttp\s*404\b/i.test(trimmed)) {
            err.status = 404;
          }
          throw err;
        }
        return unwrapProxyCommandResponse(parsed, methodName);
      }
      if (typeof rawResponse === 'object') {
        const httpStatus = Number(rawResponse.status ?? rawResponse.statusCode ?? rawResponse.httpStatus ?? 0);
        if (httpStatus >= 400) {
          const msg =
            rawResponse.error?.message ||
            rawResponse.message ||
            rawResponse.statusText ||
            `HTTP ${httpStatus} during ${methodName}`;
          const err = new Error(String(msg));
          err.status = httpStatus;
          if (rawResponse.error?.code) err.code = rawResponse.error.code;
          throw err;
        }
        if (rawResponse.error && typeof rawResponse.error === 'object') {
          const err = new Error(String(rawResponse.error.message || `RPC error in ${methodName}`));
          if (rawResponse.error.code) err.code = String(rawResponse.error.code);
          if (rawResponse.error.httpStatus) err.status = Number(rawResponse.error.httpStatus);
          throw err;
        }
        const body =
          rawResponse.body !== undefined
            ? rawResponse.body
            : rawResponse.data !== undefined && ('status' in rawResponse || 'headers' in rawResponse)
              ? rawResponse.data
              : rawResponse;
        if (typeof body === 'string') {
          return unwrapProxyCommandResponse(body, methodName);
        }
        if (body && typeof body === 'object' && !Array.isArray(body) && !(body instanceof Uint8Array)) {
          return { ...body, __fromProxyCommand: true };
        }
        return body;
      }
      return rawResponse;
    }
    function createRpcTransport(deps) {
      const { win, doc, hostConfig, fiberGateway, remoteLease } = deps;
      function isAvailable() {
        const svc = fiberGateway.getLanguageServerService();
        if (svc) return true;
        const rc = remoteLease.getInstance(win, doc);
        return Boolean(rc && typeof rc.proxyCommand === 'function');
      }
      async function callMethod(methodName, payload = {}, callOpts = {}) {
        const camel = toCamelCaseMethod(methodName);
        const svc = fiberGateway.getLanguageServerService();
        if (svc && typeof svc[camel] === 'function') {
          if (Array.isArray(callOpts.positionalArgs) && svc[camel].length >= callOpts.positionalArgs.length) {
            return await svc[camel](...callOpts.positionalArgs);
          }
          return await svc[camel](payload);
        }
        const rc = remoteLease.getInstance(win, doc);
        if (rc && typeof rc.proxyCommand === 'function') {
          const endpoint = `${hostConfig.rpcServicePrefix}/${methodName}`;
          const rawRes = await rc.proxyCommand(endpoint, payload);
          return unwrapProxyCommandResponse(rawRes, methodName);
        }
        const unavailableErr = new Error(`LanguageServerService.${methodName} is unavailable in current host session`);
        unavailableErr.code = 'SERVICE_UNAVAILABLE';
        throw unavailableErr;
      }
      async function fetchHostInstalledPluginInfo() {
        const detected = {
          hasStatusbar: false,
          hasMcpManager: true,
          hasKoTranslator: false,
          rawIds: [],
        };
        const methodsToTry = ['GetCustomizationStates', 'GetAllPlugins', 'GetAllSkills'];
        for (let i = 0; i < methodsToTry.length; i += 1) {
          try {
            const res = await callMethod(methodsToTry[i], {});
            const serialized = JSON.stringify(res || '').toLowerCase();
            if (serialized.includes('statusbar')) detected.hasStatusbar = true;
            if (serialized.includes('ko-thought-translator') || serialized.includes('ko_thought')) {
              detected.hasKoTranslator = true;
            }
          } catch {
          }
        }
        if (win && typeof win === 'object') {
          win.__agyHostInstalledPlugins = detected;
        }
        return detected;
      }
      return {
        isAvailable,
        callMethod,
        fetchHostInstalledPluginInfo,
      };
    }
    module.exports = {
      toCamelCaseMethod,
      unwrapProxyCommandResponse,
      createRpcTransport,
    };
  },
  "./adapters/antigravity/antigravity-ports-adapter": function(module, exports, __require) {
    const require = (spec) => __require("./adapters/antigravity", spec);
    'use strict';
    const { DisposableStore } = require('../../core/disposable');
    const { sha256Hex } = require('../../core/sha256');
    const { encodeBytesToBase64, decodeBase64ToBytes } = require('../../core/schema/auth-codec');
    const { validateExternalAuthUrl } = require('../../core/security/url-policy');
    const { disposableTimeout } = require('../../shared/dom-disposables');
    const TRANSPORT_OR_ROUTE_FAILURE_RE =
      /\bhttp\s*404\b|\bstatus(?:\s*code)?\s*[:=]?\s*404\b|^404\b|404\s+page\s+not\s+found|instance\s+not\s+found|service\s+not\s+found|method\s+not\s+found|\bunimplemented\b|econnrefused|etimedout|enetunreach|econnreset|failed\s+to\s+fetch|networkerror|socket\s+hang\s+up|\bdisconnected\b/i;
    const FILESYSTEM_MISSING_CODE_RE = /^(?:ENOENT|ERR_ENOENT|FileNotFound|EntryNotFound)$/i;
    const FILESYSTEM_MISSING_MSG_RE =
      /\bENOENT\b|FileNotFound|EntryNotFound|no\s+such\s+file\s+or\s+directory|The\s+system\s+cannot\s+find\s+the\s+(?:file|path)\s+specified|cannot\s+find\s+the\s+file|file\s+does\s+not\s+exist/i;
    function isMissingFileError(err) {
      if (!err) return false;
      const httpStatus = Number(err.status ?? err.statusCode ?? err.httpStatus ?? 0);
      if (httpStatus === 404 || httpStatus >= 500) {
        return false;
      }
      const msg = String(err.message ?? err ?? '');
      const code = String(err.code ?? '').trim();
      if (code === 'SERVICE_UNAVAILABLE' || TRANSPORT_OR_ROUTE_FAILURE_RE.test(msg)) {
        return false;
      }
      if (code && FILESYSTEM_MISSING_CODE_RE.test(code)) {
        return true;
      }
      return FILESYSTEM_MISSING_MSG_RE.test(msg);
    }
    function toFileUriFromFsPath(fsPath) {
      const raw = String(fsPath || '').trim();
      if (!raw) return '';
      if (raw.startsWith('file://')) return raw;
      const normalized = raw.replace(/\\/g, '/');
      if (/^[A-Za-z]:\//.test(normalized)) {
        return `file:///${normalized}`;
      }
      if (normalized.startsWith('/')) {
        return `file://${normalized}`;
      }
      return `file:///${normalized}`;
    }
    function toFsPathFromFileUri(uri) {
      const raw = String(uri || '').trim();
      if (!raw) return '';
      if (!raw.startsWith('file://')) return raw;
      try {
        const u = new URL(raw);
        let p = decodeURIComponent(u.pathname || '');
        if (/^\/[A-Za-z]:\//.test(p)) {
          p = p.slice(1);
        }
        return p;
      } catch {
        return raw.replace(/^file:\/\/\/?/, '');
      }
    }
    function normalizeConfigUriFromDir(dirOrPath) {
      const raw = String(dirOrPath || '').trim();
      if (!raw) return '';
      const slash = raw.replace(/\\/g, '/').replace(/\/+$/, '');
      if (slash.endsWith('/mcp_config.json')) {
        return toFileUriFromFsPath(slash);
      }
      if (slash.endsWith('/.gemini/config') || slash.endsWith('/config')) {
        return toFileUriFromFsPath(`${slash}/mcp_config.json`);
      }
      if (slash.endsWith('/.gemini')) {
        return toFileUriFromFsPath(`${slash}/config/mcp_config.json`);
      }
      const geminiIdx = slash.indexOf('/.gemini/');
      if (geminiIdx !== -1) {
        const geminiRoot = slash.slice(0, geminiIdx + '/.gemini'.length);
        return toFileUriFromFsPath(`${geminiRoot}/config/mcp_config.json`);
      }
      return toFileUriFromFsPath(`${slash}/.gemini/config/mcp_config.json`);
    }
    function decodeReadFileResponseToText(res) {
      if (typeof res === 'string') {
        return res;
      }
      const decoder = new TextDecoder('utf-8', { fatal: false });
      if (res instanceof Uint8Array || ArrayBuffer.isView(res)) {
        return decoder.decode(new Uint8Array(res.buffer, res.byteOffset, res.byteLength));
      }
      if (!res || typeof res !== 'object') {
        return '';
      }
      if (res.content instanceof Uint8Array || ArrayBuffer.isView(res.content)) {
        const view = res.content;
        return decoder.decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      }
      if (Array.isArray(res.content)) {
        return decoder.decode(Uint8Array.from(res.content));
      }
      if (typeof res.content === 'string') {
        if (res.content === '') return '';
        if (res.encoding === 'utf8' || res.encoding === 'utf-8') {
          return res.content;
        }
        if (res.encoding === 'base64' || res.__fromProxyCommand === true) {
          const bytes = decodeBase64ToBytes(res.content);
          if (bytes !== null) {
            return decoder.decode(bytes);
          }
          return res.content;
        }
        const trimmed = res.content.trimStart();
        if (
          trimmed.startsWith('{') ||
          trimmed.startsWith('[') ||
          trimmed.startsWith('//') ||
          trimmed.startsWith('/*')
        ) {
          return res.content;
        }
        const maybeBytes = decodeBase64ToBytes(res.content);
        if (maybeBytes !== null) {
          const strictDec = new TextDecoder('utf-8', { fatal: true });
          try {
            return strictDec.decode(maybeBytes);
          } catch {
            return res.content;
          }
        }
        return res.content;
      }
      if (typeof res.text === 'string') {
        return res.text;
      }
      return '';
    }
    function createAntigravityPortsAdapter(deps) {
      const { win, doc, hostConfig, fiberGateway, remoteLease, rpcTransport } = deps;
      const store = new DisposableStore();
      let cachedConfigUri = hostConfig.configUriOverride ? toFileUriFromFsPath(hostConfig.configUriOverride) : '';
      async function resolveMcpConfigUri() {
        if (cachedConfigUri) return cachedConfigUri;
        const fromFiberDir = fiberGateway.getConfigDir();
        if (fromFiberDir) {
          cachedConfigUri = normalizeConfigUriFromDir(fromFiberDir);
          if (cachedConfigUri) return cachedConfigUri;
        }
        try {
          const dirRes = await rpcTransport.callMethod('GetStandaloneDir', {});
          const dirStr = dirRes?.standaloneDir || dirRes?.dir || dirRes?.path || (typeof dirRes === 'string' ? dirRes : '');
          if (dirStr) {
            cachedConfigUri = normalizeConfigUriFromDir(dirStr);
            if (cachedConfigUri) return cachedConfigUri;
          }
        } catch {
        }
        try {
          const userRes = await rpcTransport.callMethod('GetLocalUserInfo', {});
          const homeDir = userRes?.homeDir || userRes?.userHome || userRes?.configDir || '';
          if (homeDir) {
            cachedConfigUri = normalizeConfigUriFromDir(homeDir);
            if (cachedConfigUri) return cachedConfigUri;
          }
        } catch {
        }
        try {
          const stRes = await rpcTransport.callMethod('GetMcpServerStates', {});
          const list = Array.isArray(stRes?.states) ? stRes.states : [];
          for (let i = 0; i < list.length; i += 1) {
            const hint = list[i]?.spec?.configPath || list[i]?.configPath || '';
            if (hint) {
              cachedConfigUri = normalizeConfigUriFromDir(hint);
              if (cachedConfigUri) return cachedConfigUri;
            }
          }
        } catch {
        }
        if (typeof process !== 'undefined' && process && process.env) {
          const envHome = process.env.USERPROFILE || process.env.HOME || '';
          if (envHome) {
            cachedConfigUri = normalizeConfigUriFromDir(envHome);
            if (cachedConfigUri) return cachedConfigUri;
          }
        }
        return '';
      }
      async function readRawAtUri(uri) {
        const fsPath = toFsPathFromFileUri(uri);
        try {
          const res = await rpcTransport.callMethod('ReadFile', {
            uri,
            path: fsPath,
            filePath: fsPath,
            absolutePath: fsPath,
          });
          const rawText = decodeReadFileResponseToText(res);
          return {
            ok: true,
            status: 'FOUND',
            exists: true,
            uri,
            fsPath,
            rawText,
            digest: sha256Hex(rawText),
          };
        } catch (err) {
          if (isMissingFileError(err)) {
            return {
              ok: true,
              status: 'MISSING',
              exists: false,
              uri,
              fsPath,
              rawText: '',
              digest: null,
            };
          }
          const isUnavailable = err?.code === 'SERVICE_UNAVAILABLE' || !rpcTransport.isAvailable();
          return {
            ok: false,
            reason: isUnavailable ? 'SERVICE_UNAVAILABLE' : 'READ_FAILED',
            uri,
            fsPath,
            rawText: null,
            digest: null,
            error: `Failed to read mcp_config.json: ${err?.message || String(err)}`,
          };
        }
      }
      const configRepo = {
        async readConfig() {
          if (!rpcTransport.isAvailable()) {
            return {
              ok: false,
              reason: 'SERVICE_UNAVAILABLE',
              uri: cachedConfigUri || null,
              fsPath: cachedConfigUri ? toFsPathFromFileUri(cachedConfigUri) : null,
              rawText: null,
              digest: null,
              error: 'Antigravity LanguageServerService is not available in this session.',
            };
          }
          const uri = await resolveMcpConfigUri();
          if (!uri) {
            return {
              ok: false,
              reason: 'URI_UNRESOLVED',
              uri: null,
              fsPath: null,
              rawText: null,
              digest: null,
              error: 'Unable to resolve ~/.gemini/config/mcp_config.json path from host.',
            };
          }
          return await readRawAtUri(uri);
        },
        async writeConfig(req) {
          if (!rpcTransport.isAvailable()) {
            return {
              ok: false,
              reason: 'SERVICE_UNAVAILABLE',
              uri: req?.uri || cachedConfigUri || null,
              error: 'Antigravity LanguageServerService is not available for writing.',
            };
          }
          const uri = req?.uri || (await resolveMcpConfigUri());
          if (!uri) {
            return {
              ok: false,
              reason: 'URI_UNRESOLVED',
              uri: null,
              error: 'Unable to resolve mcp_config.json URI for writing.',
            };
          }
          const preCheck = await readRawAtUri(uri);
          if (!preCheck.ok) {
            return {
              ok: false,
              reason: preCheck.reason,
              uri,
              error: preCheck.error,
            };
          }
          const expectedExists = Boolean(req.expectedExists);
          const expectedDigest = expectedExists ? String(req.expectedDigest ?? '') : null;
          if (preCheck.exists !== expectedExists || preCheck.digest !== expectedDigest) {
            return {
              ok: false,
              reason: 'CONFLICT',
              uri,
              error: 'mcp_config.json changed on disk before save; reload to avoid overwriting external edits.',
              currentExists: preCheck.exists,
              currentRawText: preCheck.rawText,
              currentDigest: preCheck.digest,
            };
          }
          const rawText = String(req.rawText ?? '');
          const utf8Bytes = new TextEncoder().encode(rawText);
          const fsPath = toFsPathFromFileUri(uri);
          const directSvc = fiberGateway.getLanguageServerService();
          try {
            if (directSvc && typeof directSvc.writeFile === 'function') {
              await directSvc.writeFile({ uri, path: fsPath, content: utf8Bytes, overwrite: true });
            } else {
              await rpcTransport.callMethod('WriteFile', {
                uri,
                path: fsPath,
                filePath: fsPath,
                content: encodeBytesToBase64(utf8Bytes),
                overwrite: true,
              });
            }
          } catch (err) {
            return {
              ok: false,
              reason: 'WRITE_FAILED',
              uri,
              error: `Failed to write mcp_config.json: ${err?.message || String(err)}`,
            };
          }
          return {
            ok: true,
            uri,
            fsPath,
            digest: sha256Hex(rawText),
          };
        },
        async revealConfigInExplorer(uriArg) {
          const uri = uriArg || (await resolveMcpConfigUri());
          if (!uri) {
            return { ok: false, error: 'Config URI is unresolved.' };
          }
          const ef = fiberGateway.getElectronNativeFeature();
          if (!ef || typeof ef.revealInFilePicker !== 'function') {
            return { ok: false, error: 'File picker reveal is only supported in the desktop app.' };
          }
          try {
            await ef.revealInFilePicker(uri);
            return { ok: true };
          } catch (err) {
            return { ok: false, error: err?.message || String(err) };
          }
        },
      };
      const extractAuthUrlFromState = (st) => {
        if (!st || typeof st !== 'object') return '';
        return String(
          st.authUrl ||
            st.authorizationUrl ||
            st.oauthUrl ||
            st.oauth?.authUrl ||
            st.oauth?.authorizationUrl ||
            ''
        ).trim();
      };
      const runtimePort = {
        async listServerStates() {
          try {
            const res = await rpcTransport.callMethod('GetMcpServerStates', {});
            const rawList = Array.isArray(res?.states) ? res.states : [];
            const states = rawList.map((item) => {
              if (!item || typeof item !== 'object') return item;
              const serverName = String(item.serverName || item.name || item.spec?.serverName || '').trim();
              return {
                ...item,
                serverName,
              };
            });
            return { ok: true, servers: states, states };
          } catch (err) {
            return {
              ok: false,
              servers: [],
              states: [],
              error: err?.message || String(err),
            };
          }
        },
        async refreshServers(opts = {}) {
          try {
            const cleanName = typeof opts === 'string' ? opts.trim() : String(opts?.serverName || '').trim();
            const payload = cleanName
              ? { shallow: Boolean(opts?.shallow), serverName: cleanName }
              : { shallow: false };
            await rpcTransport.callMethod('RefreshMcpServers', payload);
            return { ok: true };
          } catch (err) {
            return { ok: false, error: err?.message || String(err) };
          }
        },
        async refreshServer(serverName) {
          return runtimePort.refreshServers({ shallow: false, serverName });
        },
        async refreshAllServers() {
          return runtimePort.refreshServers({ shallow: false });
        },
        async toggleServer(serverName, enabled) {
          try {
            await rpcTransport.callMethod('ToggleMcpServer', {
              serverName: String(serverName || '').trim(),
              enabled: Boolean(enabled),
            });
            return { ok: true, supported: true };
          } catch (err) {
            return { ok: false, error: err?.message || String(err) };
          }
        },
        async toggleRuntimeServer(serverName, enabled) {
          return runtimePort.toggleServer(serverName, enabled);
        },
      };
      const oauthBroker = {
        async discoverOAuthMetadata(serverName) {
          const cleanName = String(serverName || '').trim();
          if (!cleanName) {
            return { ok: false, error: 'Server name is required for OAuth discovery.' };
          }
          const checkStatesOnce = async () => {
            const stRes = await runtimePort.listServerStates();
            if (!stRes.ok) return '';
            const match = stRes.states.find((s) => s?.serverName === cleanName);
            return extractAuthUrlFromState(match);
          };
          let foundUrl = await checkStatesOnce();
          if (!foundUrl) {
            await runtimePort.refreshServer(cleanName);
            foundUrl = await new Promise((resolve) => {
              if (store.isDisposed) {
                resolve('');
                return;
              }
              const timerDisp = disposableTimeout(
                win,
                async () => {
                  store.delete?.(timerDisp);
                  if (store.isDisposed) {
                    resolve('');
                    return;
                  }
                  resolve(await checkStatesOnce());
                },
                280
              );
              store.add(timerDisp);
            });
          }
          if (!foundUrl) {
            return {
              ok: false,
              error: 'No OAuth authorization URL advertised by server yet.',
            };
          }
          const check = validateExternalAuthUrl(foundUrl);
          if (!check.ok) {
            return {
              ok: false,
              error: check.reason || 'Server advertised an unsafe OAuth authorization URL.',
            };
          }
          return {
            ok: true,
            authUrl: check.normalizedUrl,
          };
        },
        async openExternalUrl(validatedUrl) {
          const check = validateExternalAuthUrl(validatedUrl);
          if (!check.ok) {
            return { ok: false, error: check.reason || 'Unsafe external URL rejected.' };
          }
          const safeUrl = check.normalizedUrl;
          const ef = fiberGateway.getElectronNativeFeature();
          if (ef && typeof ef.openExternal === 'function') {
            try {
              await ef.openExternal(safeUrl);
              return { ok: true };
            } catch {
            }
          }
          const rc = remoteLease.getInstance(win, doc);
          if (rc && typeof rc.openExternalUrl === 'function') {
            try {
              await rc.openExternalUrl(safeUrl);
              return { ok: true };
            } catch {
            }
          }
          if (win && typeof win.open === 'function') {
            win.open(safeUrl, '_blank', 'noopener,noreferrer');
            return { ok: true };
          }
          return { ok: false, error: 'No external browser opener available in this environment.' };
        },
        async openAuthorizationUrl(validatedUrl) {
          return oauthBroker.openExternalUrl(validatedUrl);
        },
        async waitForAuthReadyOrUrl(serverName, _timeoutMs = 1200, signal = null) {
          if (signal?.cancelled || store.isDisposed) return null;
          const cleanName = String(serverName || '').trim();
          const stRes = await runtimePort.listServerStates();
          if (stRes.ok) {
            const match = stRes.states.find((s) => s?.serverName === cleanName);
            if (match?.oauthConnected || match?.hasAuthToken) {
              return { hasAuthToken: true };
            }
            const url = extractAuthUrlFromState(match);
            if (url) {
              const chk = validateExternalAuthUrl(url);
              if (chk.ok) return { authUrl: chk.href };
            }
          }
          const disc = await oauthBroker.discoverOAuthMetadata(cleanName);
          if (signal?.cancelled || store.isDisposed) return null;
          if (disc && disc.ok && disc.authUrl) {
            return { authUrl: disc.authUrl };
          }
          return null;
        },
        async completeOAuth(serverName, authorizationCode) {
          const cleanName = String(serverName || '').trim();
          const cleanCode = String(authorizationCode || '').trim();
          try {
            await rpcTransport.callMethod(
              'CompleteMcpOAuth',
              { serverName: cleanName, authorizationCode: cleanCode, code: cleanCode },
              { positionalArgs: [cleanName, cleanCode] }
            );
            await runtimePort.refreshServer(cleanName);
            return { ok: true };
          } catch (err) {
            return { ok: false, error: err?.message || String(err) };
          }
        },
        async completeAuthorization(serverName, authorizationCode) {
          return oauthBroker.completeOAuth(serverName, authorizationCode);
        },
        async disconnectOAuth(serverName, account = '') {
          const cleanName = String(serverName || '').trim();
          const cleanAccount = String(account || '').trim();
          try {
            await rpcTransport.callMethod(
              'DisconnectMcpOAuth',
              { serverName: cleanName, account: cleanAccount },
              { positionalArgs: [cleanName, cleanAccount] }
            );
            await runtimePort.refreshServer(cleanName);
            return { ok: true };
          } catch (err) {
            return { ok: false, error: err?.message || String(err) };
          }
        },
        async disconnectSession(serverName, account = '') {
          return oauthBroker.disconnectOAuth(serverName, account);
        },
      };
      return {
        configRepo,
        mcpRuntime: runtimePort,
        runtimePort,
        oauthBroker,
        resolveMcpConfigUri,
        dispose: () => store.dispose(),
      };
    }
    module.exports = {
      isMissingFileError,
      toFileUriFromFsPath,
      toFsPathFromFileUri,
      normalizeConfigUriFromDir,
      decodeReadFileResponseToText,
      createAntigravityPortsAdapter,
    };
  },
  "./adapters/antigravity/companion-coordinator": function(module, exports, __require) {
    const require = (spec) => __require("./adapters/antigravity", spec);
    'use strict';
    const { DisposableStore } = require('../../core/disposable');
    const { getOrCreateTrustedTypesPolicy, getScriptNonce } = require('../../security/trusted-types');
    const { disposableTimeout } = require('../../shared/dom-disposables');
    const { buildAllowedScriptUrlValidator } = require('./host-config');
    const COMPANION_RETRY_DELAY_MS = 1500;
    const MAX_COMPANION_RETRIES = 4;
    function createCompanionCoordinator(deps) {
      const { win, doc, hostConfig, rpcTransport } = deps;
      const store = new DisposableStore();
      const injectedUrls = new Set();
      let retryCount = 0;
      let activeRetryDisp = null;
      const isAllowedScriptUrl = buildAllowedScriptUrlValidator(hostConfig, win);
      function isRemoteEnvironment() {
        if (!win || !doc) return false;
        try {
          if (typeof doc.querySelector === 'function' && doc.querySelector('ga-remote-control')) {
            return true;
          }
          const host = String(win.location?.hostname || '').toLowerCase();
          return hostConfig.isRemoteHost(host);
        } catch {
          return false;
        }
      }
      function injectApprovedCompanionScript(url, dataAttr) {
        if (store.isDisposed || !doc || typeof doc.createElement !== 'function') return false;
        const cleanUrl = String(url || '').trim();
        if (!cleanUrl || !isAllowedScriptUrl(cleanUrl)) return false;
        if (injectedUrls.has(cleanUrl)) return true;
        if (typeof doc.querySelector === 'function') {
          const existing = doc.querySelector(`script[data-agy-companion="${dataAttr}"]`);
          if (existing) {
            injectedUrls.add(cleanUrl);
            return true;
          }
        }
        const ttCtrl = getOrCreateTrustedTypesPolicy(win, {
          policyNames: hostConfig.trustedTypesPolicyNames,
          isAllowedScriptUrl,
        });
        let safeSrc;
        try {
          safeSrc = ttCtrl.toScriptURL(cleanUrl);
        } catch {
          return false;
        }
        const scriptEl = doc.createElement('script');
        const nonce = getScriptNonce(doc);
        if (nonce) {
          scriptEl.nonce = nonce;
          scriptEl.setAttribute?.('nonce', nonce);
        }
        scriptEl.async = true;
        scriptEl.setAttribute?.('data-agy-companion', dataAttr);
        scriptEl.src = safeSrc;
        const parent = doc.head || doc.body || doc.documentElement;
        if (!parent || typeof parent.appendChild !== 'function') return false;
        parent.appendChild(scriptEl);
        injectedUrls.add(cleanUrl);
        return true;
      }
      async function syncCompanionsOnce() {
        if (store.isDisposed || !isRemoteEnvironment()) return;
        let pluginInfo = win && win.__agyHostInstalledPlugins ? win.__agyHostInstalledPlugins : null;
        if (!pluginInfo && rpcTransport.isAvailable()) {
          pluginInfo = await rpcTransport.fetchHostInstalledPluginInfo();
        }
        if (store.isDisposed) return;
        if (!pluginInfo) {
          if (retryCount < MAX_COMPANION_RETRIES) {
            retryCount += 1;
            if (activeRetryDisp) activeRetryDisp.dispose();
            activeRetryDisp = disposableTimeout(
              win,
              () => {
                activeRetryDisp = null;
                void syncCompanionsOnce();
              },
              COMPANION_RETRY_DELAY_MS
            );
            store.add(activeRetryDisp);
          }
          return;
        }
        if (pluginInfo.hasStatusbar && !win.agyStatusBar && hostConfig.companionUrls?.statusbar) {
          injectApprovedCompanionScript(hostConfig.companionUrls.statusbar, 'statusbar');
        }
        if (
          pluginInfo.hasKoTranslator &&
          !win.agyKoThoughtTranslator &&
          !win.__agyKoLocalizerActive &&
          hostConfig.companionUrls?.koTranslator
        ) {
          injectApprovedCompanionScript(hostConfig.companionUrls.koTranslator, 'ko-thought-translator');
        }
      }
      function start() {
        if (store.isDisposed) return;
        void syncCompanionsOnce();
      }
      return {
        start,
        syncCompanionsOnce,
        injectApprovedCompanionScript,
        dispose() {
          if (activeRetryDisp) {
            activeRetryDisp.dispose();
            activeRetryDisp = null;
          }
          store.dispose();
        },
      };
    }
    module.exports = {
      COMPANION_RETRY_DELAY_MS,
      createCompanionCoordinator,
    };
  },
  "./adapters/antigravity/native-dom-integrator": function(module, exports, __require) {
    const require = (spec) => __require("./adapters/antigravity", spec);
    'use strict';
    const { DisposableStore } = require('../../core/disposable');
    const { ensureModalStyles, DEFAULT_STYLE_ID } = require('../../ui/design-tokens-styles');
    const { h } = require('../../ui/dom-kit');
    const { SETTINGS_PANE_ID } = require('../../ui/modal-controller');
    const { disposableTimeout, disposableEvent, disposableObserver } = require('../../shared/dom-disposables');
    const LEGACY_LOCALSTORAGE_BACKUP_KEY = 'agy-custom-mcp-config-backup-v1';
    const SETTINGS_NAV_TESTID = 'settings-nav-item-McpManager';
    const CUSTOMIZATIONS_EDIT_BTN_TESTID = 'agy-mcp-customizations-edit-btn';
    const REMOTE_LAUNCHER_ID = 'agy-mcp-remote-launcher';
    const RECONCILE_DEBOUNCE_MS = 25;
    function createNativeDomIntegrator(deps) {
      const { win, doc, hostConfig, modalController } = deps;
      const store = new DisposableStore();
      const injectedElements = new Set();
      const hiddenSiblingDisplays = new Map();
      let debounceDisp = null;
      let wasMcpSettingsPaneActive = false;
      function purgeLegacyLocalStorageBackup() {
        try {
          const ls = win && win.localStorage;
          if (ls && typeof ls.removeItem === 'function') {
            ls.removeItem(LEGACY_LOCALSTORAGE_BACKUP_KEY);
          }
        } catch {
        }
      }
      function registerInjected(el) {
        if (el) injectedElements.add(el);
        return el;
      }
      function restoreHiddenSettingsSiblings() {
        for (const [el, prevDisplay] of hiddenSiblingDisplays.entries()) {
          try {
            if (el && el.style) {
              el.style.display = prevDisplay;
            }
          } catch {
          }
        }
        hiddenSiblingDisplays.clear();
      }
      function deactivateMcpSettingsPane(targetDoc) {
        const pane =
          targetDoc && typeof targetDoc.getElementById === 'function'
            ? targetDoc.getElementById(SETTINGS_PANE_ID)
            : null;
        if (pane && pane.style) {
          pane.style.display = 'none';
        }
        const navBtn =
          targetDoc && typeof targetDoc.querySelector === 'function'
            ? targetDoc.querySelector(`[data-testid="${SETTINGS_NAV_TESTID}"]`)
            : null;
        if (navBtn && typeof navBtn.setAttribute === 'function') {
          navBtn.setAttribute('aria-selected', 'false');
        }
        restoreHiddenSettingsSiblings();
        if (wasMcpSettingsPaneActive) {
          wasMcpSettingsPaneActive = false;
          modalController.onSettingsPaneHidden();
        }
      }
      function activateMcpSettingsPane(targetDoc, navParent, navBtn) {
        ensureModalStyles(targetDoc, DEFAULT_STYLE_ID);
        const contentHost = findSettingsContentContainer(navParent);
        if (!contentHost) {
          modalController.openModal({ openerEl: navBtn });
          return;
        }
        const siblings = contentHost.children || [];
        for (let i = 0; i < siblings.length; i += 1) {
          const sib = siblings[i];
          if (sib && sib.id !== SETTINGS_PANE_ID) {
            if (!hiddenSiblingDisplays.has(sib)) {
              hiddenSiblingDisplays.set(sib, sib.style ? sib.style.display || '' : '');
            }
            if (sib.style) {
              sib.style.display = 'none';
            }
          }
        }
        let pane =
          typeof targetDoc.getElementById === 'function' ? targetDoc.getElementById(SETTINGS_PANE_ID) : null;
        if (!pane) {
          pane = registerInjected(
            h(targetDoc, 'div', {
              id: SETTINGS_PANE_ID,
              style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px' },
              dataset: { testid: SETTINGS_PANE_ID },
            })
          );
          contentHost.appendChild(pane);
        } else if (pane.style) {
          pane.style.display = 'flex';
        }
        if (navBtn && typeof navBtn.setAttribute === 'function') {
          navBtn.setAttribute('aria-selected', 'true');
        }
        wasMcpSettingsPaneActive = true;
        modalController.renderSettingsPageContent(pane);
      }
      function findSettingsContentContainer(navParent) {
        if (!navParent || !navParent.parentNode) return null;
        const wrapper = navParent.parentNode;
        const kids = wrapper.children || [];
        for (let i = 0; i < kids.length; i += 1) {
          if (kids[i] !== navParent) {
            return kids[i];
          }
        }
        return null;
      }
      function reconcileSettingsNav(targetDoc) {
        if (!targetDoc || typeof targetDoc.querySelectorAll !== 'function') return;
        let navItems;
        try {
          navItems = targetDoc.querySelectorAll('[data-testid^="settings-nav-item-"]');
        } catch {
          return;
        }
        if (!navItems || navItems.length === 0) {
          if (wasMcpSettingsPaneActive) {
            wasMcpSettingsPaneActive = false;
            restoreHiddenSettingsSiblings();
            modalController.onSettingsPaneHidden();
          }
          return;
        }
        let existingMcpNav = null;
        let anchorNav = null;
        for (let i = 0; i < navItems.length; i += 1) {
          const item = navItems[i];
          const tid = item?.dataset?.testid || item?.getAttribute?.('data-testid') || '';
          if (tid === SETTINGS_NAV_TESTID) {
            if (!existingMcpNav) {
              existingMcpNav = item;
            } else {
              item.remove?.();
            }
          } else if (!anchorNav) {
            anchorNav = item;
          }
        }
        if (!anchorNav || !anchorNav.parentNode) return;
        const navParent = anchorNav.parentNode;
        if (!navParent.__agyMcpTabLeaveBound) {
          navParent.__agyMcpTabLeaveBound = true;
          store.add(
            disposableEvent(navParent, 'click', (e) => {
              const target = e?.target;
              const clickedNav =
                target && typeof target.closest === 'function'
                  ? target.closest('[data-testid^="settings-nav-item-"]')
                  : target;
              const tid = clickedNav?.dataset?.testid || clickedNav?.getAttribute?.('data-testid') || '';
              if (tid && tid !== SETTINGS_NAV_TESTID && wasMcpSettingsPaneActive) {
                deactivateMcpSettingsPane(targetDoc);
              }
            })
          );
        }
        if (!existingMcpNav) {
          const navBtn = registerInjected(
            h(
              targetDoc,
              'button',
              {
                type: 'button',
                className: anchorNav.className || 'agy-mcp-btn',
                'aria-selected': 'false',
                dataset: {
                  testid: SETTINGS_NAV_TESTID,
                  agyNoTranslate: 'true',
                },
                onClick: (e) => {
                  e?.stopPropagation?.();
                  activateMcpSettingsPane(targetDoc, navParent, navBtn);
                },
              },
              'MCP Servers'
            )
          );
          navParent.appendChild(navBtn);
        }
      }
      function reconcileCustomizationsButtons(targetDoc) {
        if (!targetDoc || typeof targetDoc.querySelector !== 'function') return;
        let addMcpBtn = null;
        try {
          addMcpBtn = targetDoc.querySelector('[data-testid="add-mcp-button"]');
        } catch {
          return;
        }
        if (!addMcpBtn || !addMcpBtn.parentNode) return;
        const parent = addMcpBtn.parentNode;
        const existingEditBtn =
          typeof parent.querySelector === 'function'
            ? parent.querySelector(`[data-testid="${CUSTOMIZATIONS_EDIT_BTN_TESTID}"]`)
            : null;
        if (existingEditBtn) return;
        ensureModalStyles(targetDoc, DEFAULT_STYLE_ID);
        const editBtn = registerInjected(
          h(
            targetDoc,
            'button',
            {
              type: 'button',
              className: 'agy-mcp-btn',
              dataset: {
                testid: CUSTOMIZATIONS_EDIT_BTN_TESTID,
                agyNoTranslate: 'true',
              },
              onClick: (e) => {
                e?.stopPropagation?.();
                modalController.openEditPopup({ openerEl: editBtn });
              },
            },
            'Edit MCP Servers'
          )
        );
        parent.appendChild(editBtn);
      }
      function shouldShowRemoteLauncher() {
        if (!win || !doc) return false;
        try {
          if (typeof doc.querySelector === 'function' && doc.querySelector('ga-remote-control')) {
            return true;
          }
          const host = String(win.location?.hostname || '').toLowerCase();
          return hostConfig.isRemoteHost(host);
        } catch {
          return false;
        }
      }
      function reconcileRemoteLauncher() {
        if (!doc || !doc.body || !shouldShowRemoteLauncher()) return;
        const existing = typeof doc.getElementById === 'function' ? doc.getElementById(REMOTE_LAUNCHER_ID) : null;
        if (existing) {
          if (existing.parentNode !== doc.body) {
            doc.body.appendChild(existing);
          }
          return;
        }
        ensureModalStyles(doc, DEFAULT_STYLE_ID);
        const launcherBtn = registerInjected(
          h(
            doc,
            'button',
            {
              id: REMOTE_LAUNCHER_ID,
              type: 'button',
              className: 'agy-mcp-remote-launcher-btn',
              'aria-label': 'Open Custom MCP Server Manager',
              dataset: {
                testid: REMOTE_LAUNCHER_ID,
                agyNoTranslate: 'true',
              },
              onClick: (e) => {
                e?.stopPropagation?.();
                modalController.openModal({ openerEl: launcherBtn });
              },
            },
            'MCP Servers'
          )
        );
        doc.body.appendChild(launcherBtn);
      }
      function reconcileAll() {
        if (store.isDisposed) return;
        reconcileSettingsNav(doc);
        reconcileCustomizationsButtons(doc);
        reconcileRemoteLauncher();
        if (doc && typeof doc.querySelector === 'function') {
          try {
            const promotedIframe = doc.querySelector('ga-remote-control iframe');
            const childDoc = promotedIframe?.contentDocument || promotedIframe?.contentWindow?.document;
            if (childDoc && childDoc !== doc) {
              reconcileSettingsNav(childDoc);
              reconcileCustomizationsButtons(childDoc);
            }
          } catch {
          }
        }
      }
      function scheduleReconcile() {
        if (store.isDisposed) return;
        if (debounceDisp) return;
        debounceDisp = disposableTimeout(
          win,
          () => {
            debounceDisp = null;
            reconcileAll();
          },
          RECONCILE_DEBOUNCE_MS
        );
        store.add(debounceDisp);
      }
      function start() {
        if (store.isDisposed) return;
        purgeLegacyLocalStorageBackup();
        reconcileAll();
        const ObserverCtor =
          (win && typeof win.MutationObserver === 'function' ? win.MutationObserver : null) ||
          (typeof MutationObserver === 'function' ? MutationObserver : null);
        if (ObserverCtor && doc && (doc.body || doc.documentElement)) {
          const obs = new ObserverCtor(() => {
            scheduleReconcile();
          });
          store.add(
            disposableObserver(obs, doc.body || doc.documentElement, {
              childList: true,
              subtree: true,
            })
          );
        }
      }
      function restoreNativeDom() {
        if (debounceDisp) {
          debounceDisp.dispose();
          debounceDisp = null;
        }
        if (wasMcpSettingsPaneActive) {
          wasMcpSettingsPaneActive = false;
          modalController.onSettingsPaneHidden();
        }
        restoreHiddenSettingsSiblings();
        for (const el of injectedElements) {
          try {
            if (typeof el.remove === 'function') {
              el.remove();
            } else if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
              el.parentNode.removeChild(el);
            }
          } catch {
          }
        }
        injectedElements.clear();
      }
      store.add({ dispose: restoreNativeDom });
      return {
        start,
        reconcileAll,
        scheduleReconcile,
        purgeLegacyLocalStorageBackup,
        dispose: () => store.dispose(),
      };
    }
    module.exports = {
      LEGACY_LOCALSTORAGE_BACKUP_KEY,
      SETTINGS_NAV_TESTID,
      CUSTOMIZATIONS_EDIT_BTN_TESTID,
      REMOTE_LAUNCHER_ID,
      RECONCILE_DEBOUNCE_MS,
      createNativeDomIntegrator,
    };
  },
  "./adapters/antigravity/remote-workbench/child-asset-adapter": function(module, exports, __require) {
    const require = (spec) => __require("./adapters/antigravity/remote-workbench", spec);
    'use strict';
    const { resolveCdnAssetUrl } = require('../../../core/security/url-policy');
    const { isNativeTrustedScriptURL } = require('../../../security/trusted-types');
    function resolveWorkbenchAssetUrl(rawValue, cdnBaseUrl, hostOrigin, cdnPathPrefix = '/web/') {
      return resolveCdnAssetUrl(rawValue, {
        cdnBaseUrl,
        hostOrigin,
        allowedPathPrefix: cdnPathPrefix || '/web/',
      });
    }
    function installChildHistoryAdapter(cw, canonicalOriginUrl) {
      if (!cw || !cw.history) return;
      let expectedOrigin = '';
      try {
        expectedOrigin = new URL(canonicalOriginUrl).origin;
      } catch {
        return;
      }
      for (const methodName of ['replaceState', 'pushState']) {
        const origFn = cw.history[methodName];
        if (typeof origFn !== 'function' || origFn.__agyHistoryAdapted) continue;
        const adapted = function (state, unused, urlArg) {
          let nextUrl = urlArg;
          if (typeof urlArg === 'string' && urlArg.trim()) {
            try {
              const parsed = new URL(urlArg, canonicalOriginUrl);
              if (parsed.origin === expectedOrigin) {
                nextUrl = `${parsed.pathname}${parsed.search}${parsed.hash}`;
              }
            } catch {
            }
          }
          try {
            return origFn.call(this, state, unused, nextUrl);
          } catch {
            try {
              return origFn.call(this, state, unused);
            } catch {
              return undefined;
            }
          }
        };
        adapted.__agyHistoryAdapted = true;
        try {
          cw.history[methodName] = adapted;
        } catch {
        }
      }
    }
    function installChildAssetAdapter(params) {
      const {
        cw,
        cd,
        nonce,
        cdnBaseUrl,
        hostOrigin,
        hostConfig,
        ttPolicyCtrl,
        installWorkerConstructorAdapter,
      } = params;
      if (!cd || typeof cd.createElement !== 'function' || cd.__agyAssetAdapted) {
        return null;
      }
      cd.__agyAssetAdapted = true;
      const cdnPathPrefix = hostConfig?.cdnPathPrefix || '/web/';
      const rewriteAssetUrl = (raw) => {
        const str = String(raw ?? '');
        return resolveWorkbenchAssetUrl(str, cdnBaseUrl, hostOrigin, cdnPathPrefix) || str;
      };
      const toSafeScriptUrl = (raw) => {
        const mapped = rewriteAssetUrl(raw);
        if (!ttPolicyCtrl) return mapped;
        return ttPolicyCtrl.toScriptURL(mapped);
      };
      const wrapProtoUrlProp = (ProtoObj, propName, isScriptProp) => {
        if (!ProtoObj || ProtoObj.__agyPropAdapted) return null;
        const desc = Object.getOwnPropertyDescriptor(ProtoObj, propName);
        if (!desc || typeof desc.set !== 'function' || typeof desc.get !== 'function') return null;
        try {
          Object.defineProperty(ProtoObj, propName, {
            configurable: true,
            enumerable: desc.enumerable,
            get() {
              return desc.get.call(this);
            },
            set(val) {
              if (nonce && (isScriptProp || propName === 'href') && !this.nonce) {
                try {
                  this.nonce = nonce;
                } catch {
                }
              }
              if (isNativeTrustedScriptURL(cw, val)) {
                desc.set.call(this, val);
                return;
              }
              const rawStr = val && typeof val === 'object' && typeof val.href === 'string' ? val.href : val;
              const nextVal = isScriptProp ? toSafeScriptUrl(rawStr) : rewriteAssetUrl(rawStr);
              desc.set.call(this, nextVal);
            },
          });
          Object.defineProperty(ProtoObj, '__agyPropAdapted', {
            value: true,
            configurable: true,
          });
          return desc;
        } catch {
          return desc;
        }
      };
      const scriptSrcDesc = wrapProtoUrlProp(cw?.HTMLScriptElement?.prototype, 'src', true);
      wrapProtoUrlProp(cw?.HTMLImageElement?.prototype, 'src', false);
      wrapProtoUrlProp(cw?.HTMLSourceElement?.prototype, 'src', false);
      wrapProtoUrlProp(cw?.HTMLLinkElement?.prototype, 'href', false);
      if (
        cw?.Element?.prototype &&
        typeof cw.Element.prototype.setAttribute === 'function' &&
        !cw.Element.prototype.__agySetAttrAdapted
      ) {
        const origElemSetAttr = cw.Element.prototype.setAttribute;
        try {
          cw.Element.prototype.setAttribute = function (name, value) {
            const attrLower = String(name || '').toLowerCase();
            const tagUpper = String(this?.tagName || '').toUpperCase();
            if (attrLower === 'src' && tagUpper === 'SCRIPT') {
              if (nonce) {
                try {
                  this.nonce = nonce;
                  origElemSetAttr.call(this, 'nonce', nonce);
                } catch {
                }
              }
              if (isNativeTrustedScriptURL(cw, value)) {
                return origElemSetAttr.call(this, name, value);
              }
              const rawVal = value && typeof value === 'object' && typeof value.href === 'string' ? value.href : value;
              const safeVal = toSafeScriptUrl(rawVal);
              if (scriptSrcDesc && typeof scriptSrcDesc.set === 'function') {
                scriptSrcDesc.set.call(this, safeVal);
                return undefined;
              }
              return origElemSetAttr.call(this, name, safeVal);
            }
            if (attrLower === 'src' && (tagUpper === 'IMG' || tagUpper === 'SOURCE' || tagUpper === 'AUDIO' || tagUpper === 'VIDEO')) {
              const rawImg = value && typeof value === 'object' && typeof value.href === 'string' ? value.href : value;
              return origElemSetAttr.call(this, name, isNativeTrustedScriptURL(cw, value) ? value : rewriteAssetUrl(rawImg));
            }
            if (attrLower === 'href' && tagUpper === 'LINK') {
              if (nonce) {
                try {
                  this.nonce = nonce;
                  origElemSetAttr.call(this, 'nonce', nonce);
                } catch {
                }
              }
              const rawLink = value && typeof value === 'object' && typeof value.href === 'string' ? value.href : value;
              return origElemSetAttr.call(this, name, isNativeTrustedScriptURL(cw, value) ? value : rewriteAssetUrl(rawLink));
            }
            return origElemSetAttr.call(this, name, value);
          };
          Object.defineProperty(cw.Element.prototype, '__agySetAttrAdapted', {
            value: true,
            configurable: true,
          });
        } catch {
        }
      }
      const origCreateEl = cd.createElement.bind(cd);
      if (typeof installWorkerConstructorAdapter === 'function') {
        installWorkerConstructorAdapter(origCreateEl);
      }
      cd.createElement = function (tagName, options) {
        const el = options !== undefined ? origCreateEl(tagName, options) : origCreateEl(tagName);
        const lower = String(tagName || '').toLowerCase();
        if (el && nonce && (lower === 'script' || lower === 'style' || lower === 'link')) {
          try {
            el.nonce = nonce;
            el.setAttribute?.('nonce', nonce);
          } catch {
          }
        }
        const isNativeElem = Boolean(cw?.Element && el instanceof cw.Element);
        if (el && !isNativeElem) {
          if (typeof el.setAttribute === 'function' && !el.__agySyntheticSetAttrAdapted) {
            const origElSetAttr = el.setAttribute.bind(el);
            el.setAttribute = function (name, val) {
              const attrL = String(name || '').toLowerCase();
              if (attrL === 'src' && lower === 'script') {
                if (nonce) origElSetAttr('nonce', nonce);
                const safeVal = isNativeTrustedScriptURL(cw, val) ? val : toSafeScriptUrl(val);
                el.src = safeVal;
                return origElSetAttr(name, safeVal);
              }
              if (attrL === 'src' && (lower === 'img' || lower === 'source' || lower === 'audio' || lower === 'video')) {
                const mapped = isNativeTrustedScriptURL(cw, val) ? val : rewriteAssetUrl(val);
                el.src = mapped;
                return origElSetAttr(name, mapped);
              }
              if (attrL === 'href' && lower === 'link') {
                if (nonce) origElSetAttr('nonce', nonce);
                const mapped = isNativeTrustedScriptURL(cw, val) ? val : rewriteAssetUrl(val);
                el.href = mapped;
                return origElSetAttr(name, mapped);
              }
              return origElSetAttr(name, val);
            };
            el.__agySyntheticSetAttrAdapted = true;
          }
          if (lower === 'script' || lower === 'img' || lower === 'source' || lower === 'link') {
            const prop = lower === 'link' ? 'href' : 'src';
            let innerVal = el[prop] || '';
            try {
              Object.defineProperty(el, prop, {
                configurable: true,
                enumerable: true,
                get() {
                  return innerVal;
                },
                set(val) {
                  if (isNativeTrustedScriptURL(cw, val)) {
                    innerVal = val;
                    return;
                  }
                  const rawInner = val && typeof val === 'object' && typeof val.href === 'string' ? val.href : val;
                  innerVal = lower === 'script' ? toSafeScriptUrl(rawInner) : rewriteAssetUrl(rawInner);
                },
              });
            } catch {
            }
          }
        }
        return el;
      };
      return origCreateEl;
    }
    module.exports = {
      resolveWorkbenchAssetUrl,
      installChildHistoryAdapter,
      installChildAssetAdapter,
    };
  },
  "./adapters/antigravity/remote-workbench/cdn-worker-bridge": function(module, exports, __require) {
    const require = (spec) => __require("./adapters/antigravity/remote-workbench", spec);
    'use strict';
    const { isNativeTrustedScriptURL, getOrCreateTrustedTypesPolicy } = require('../../../security/trusted-types');
    const { resolveWorkbenchAssetUrl } = require('./child-asset-adapter');
    const MAX_NESTED_WORKER_DEPTH = 8;
    const WINDOW_RECEIVER_METHODS = new Set([
      'addEventListener',
      'removeEventListener',
      'dispatchEvent',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'atob',
      'btoa',
      'createImageBitmap',
      'structuredClone',
      'reportError',
      'getComputedStyle',
      'matchMedia',
      'fetch',
      'postMessage',
      'close',
      'importScripts',
    ]);
    function canDefineOwnPropertyOnScope(target, prop) {
      if (!target || (typeof target !== 'object' && typeof target !== 'function')) return false;
      const ownDesc = Object.getOwnPropertyDescriptor(target, prop);
      return (!ownDesc && Object.isExtensible(target)) || Boolean(ownDesc && ownDesc.configurable === true);
    }
    function installCdnWorkerAdapter(env) {
      const {
        cw,
        cd,
        origCreateEl,
        nonce,
        cdnBaseUrl,
        hostOrigin,
        hostConfig,
        isAllowedScriptUrl,
        ttPolicyCtrl,
        activeWorkerBridges,
      } = env;
      const cdnPathPrefix = hostConfig?.cdnPathPrefix || '/web/';
      function createCdnWorkerBridge(resolvedUrl, workerOptions, bridgeDepth = 0) {
        if (bridgeDepth > MAX_NESTED_WORKER_DEPTH) {
          throw new (cw.RangeError || RangeError)('Nested Worker bridge depth limit exceeded');
        }
        let terminated = false;
        let loaded = false;
        const pendingInbound = [];
        const listeners = { message: [], error: [], messageerror: [] };
        let onmessageHandler = null;
        let onerrorHandler = null;
        let onmessageerrorHandler = null;
        const channel = typeof cw.MessageChannel === 'function' ? new cw.MessageChannel() : null;
        const hostPort = channel ? channel.port1 : null;
        const workerPort = channel ? channel.port2 : null;
        let workerFrame = null;
        let wfw = null;
        let wfd = null;
        const dispatchHostEvent = (type, eventObj) => {
          if (terminated) return true;
          let canceled = false;
          const markCanceledIfPrevented = () => {
            if (eventObj && eventObj.defaultPrevented === true) {
              canceled = true;
            }
          };
          const direct =
            type === 'message'
              ? onmessageHandler
              : type === 'error'
                ? onerrorHandler
                : type === 'messageerror'
                  ? onmessageerrorHandler
                  : null;
          if (typeof direct === 'function') {
            const ret = direct.call(shim, eventObj);
            if (type === 'error' && ret === true && eventObj && typeof eventObj.preventDefault === 'function') {
              eventObj.preventDefault();
            }
            markCanceledIfPrevented();
          }
          const list = (listeners[type] || []).slice();
          for (let i = 0; i < list.length; i += 1) {
            const entry = list[i];
            if (typeof entry.fn === 'function') {
              entry.fn.call(shim, eventObj);
            } else if (entry.fn && typeof entry.fn.handleEvent === 'function') {
              entry.fn.handleEvent(eventObj);
            }
            markCanceledIfPrevented();
            if (entry.once) {
              const idx = listeners[type].indexOf(entry);
              if (idx >= 0) listeners[type].splice(idx, 1);
            }
          }
          return !canceled;
        };
        const createHostErrorEvent = (errInfo) => {
          const hasThrownProp = Boolean(errInfo && Object.prototype.hasOwnProperty.call(errInfo, 'error'));
          const errorVal = hasThrownProp ? errInfo.error : null;
          const message = String(errInfo?.message ?? (errorVal && errorVal.message ? errorVal.message : String(errorVal ?? 'Worker script error')));
          const initDict = {
            message,
            filename: resolvedUrl,
            lineno: Number(errInfo?.lineno || 0),
            colno: Number(errInfo?.colno || 0),
            error: errorVal,
            cancelable: true,
          };
          if (typeof cw.ErrorEvent === 'function') {
            try {
              return new cw.ErrorEvent('error', initDict);
            } catch {
            }
          }
          let prevented = false;
          return {
            type: 'error',
            ...initDict,
            get defaultPrevented() {
              return prevented;
            },
            preventDefault() {
              if (this.cancelable) prevented = true;
            },
          };
        };
        const emitHostError = (errInfo) => {
          if (terminated) return true;
          const ev = createHostErrorEvent(errInfo);
          return dispatchHostEvent('error', ev);
        };
        const emitHostMessage = (data, ports) => {
          if (terminated) return;
          const deliver = () => {
            if (terminated) return;
            let ev;
            if (typeof cw.MessageEvent === 'function') {
              try {
                ev = new cw.MessageEvent('message', { data, ports: ports || [] });
              } catch {
                ev = { type: 'message', data, ports: ports || [] };
              }
            } else {
              ev = { type: 'message', data, ports: ports || [] };
            }
            dispatchHostEvent('message', ev);
          };
          if (hostPort) {
            deliver();
          } else if (typeof queueMicrotask === 'function') {
            queueMicrotask(deliver);
          } else {
            Promise.resolve().then(deliver);
          }
        };
        const bridgeHandle = { terminate: () => terminateBridge() };
        const terminateBridge = () => {
          if (terminated) return;
          terminated = true;
          pendingInbound.length = 0;
          if (activeWorkerBridges && typeof activeWorkerBridges.delete === 'function') {
            activeWorkerBridges.delete(bridgeHandle);
          }
          if (hostPort) {
            try {
              hostPort.onmessage = null;
              hostPort.close();
            } catch {
            }
          }
          if (workerPort) {
            try {
              workerPort.onmessage = null;
              workerPort.close();
            } catch {
            }
          }
          if (wfw && typeof wfw.removeEventListener === 'function') {
            try {
              wfw.removeEventListener('error', onWfwErrorCapture, true);
            } catch {
            }
          }
          if (workerFrame) {
            try {
              if (typeof workerFrame.remove === 'function') {
                workerFrame.remove();
              } else if (workerFrame.parentNode && typeof workerFrame.parentNode.removeChild === 'function') {
                workerFrame.parentNode.removeChild(workerFrame);
              }
            } catch {
            }
            workerFrame = null;
          }
        };
        if (activeWorkerBridges && typeof activeWorkerBridges.add === 'function') {
          activeWorkerBridges.add(bridgeHandle);
        }
        const shim = {
          postMessage(msg, transfer) {
            if (terminated) return;
            if (hostPort) {
              if (transfer !== undefined) hostPort.postMessage(msg, transfer);
              else hostPort.postMessage(msg);
              return;
            }
            if (!loaded) {
              pendingInbound.push({ msg, transfer });
              return;
            }
            deliverToWorkerScope(msg, Array.isArray(transfer) ? transfer : []);
          },
          terminate: terminateBridge,
          addEventListener(type, fn, opts) {
            if (!fn || !listeners[type]) return;
            const once = Boolean(opts && typeof opts === 'object' && opts.once);
            if (!listeners[type].some((item) => item.fn === fn)) {
              listeners[type].push({ fn, once });
            }
          },
          removeEventListener(type, fn) {
            if (!listeners[type]) return;
            listeners[type] = listeners[type].filter((item) => item.fn !== fn);
          },
          dispatchEvent(ev) {
            if (!ev || !ev.type) return true;
            return dispatchHostEvent(ev.type, ev);
          },
        };
        Object.defineProperties(shim, {
          onmessage: {
            get: () => onmessageHandler,
            set: (fn) => {
              onmessageHandler = typeof fn === 'function' ? fn : null;
            },
            enumerable: true,
            configurable: true,
          },
          onerror: {
            get: () => onerrorHandler,
            set: (fn) => {
              onerrorHandler = typeof fn === 'function' ? fn : null;
            },
            enumerable: true,
            configurable: true,
          },
          onmessageerror: {
            get: () => onmessageerrorHandler,
            set: (fn) => {
              onmessageerrorHandler = typeof fn === 'function' ? fn : null;
            },
            enumerable: true,
            configurable: true,
          },
        });
        if (cw.Worker && cw.Worker.prototype) {
          try {
            Object.setPrototypeOf(shim, cw.Worker.prototype);
          } catch {
          }
        }
        const hostParent = cd.body || cd.documentElement;
        if (!hostParent || typeof hostParent.appendChild !== 'function') {
          terminateBridge();
          throw new TypeError('Unable to mount isolated CDN Worker helper frame');
        }
        workerFrame = origCreateEl('iframe');
        workerFrame.src = 'about:blank';
        workerFrame.setAttribute?.('aria-hidden', 'true');
        if (workerFrame.style) {
          workerFrame.style.cssText =
            'display:none;width:0;height:0;border:0;position:absolute;left:-9999px;visibility:hidden;';
        }
        hostParent.appendChild(workerFrame);
        wfw = workerFrame.contentWindow;
        wfd = workerFrame.contentDocument || wfw?.document;
        if (!wfw || !wfd) {
          terminateBridge();
          throw new TypeError('Failed to initialize isolated CDN Worker helper frame');
        }
        if (typeof wfd.open === 'function' && typeof wfd.close === 'function') {
          wfd.open();
          wfd.close();
        }
        const inheritedDocUrl = String(wfw.location?.href || 'about:blank');
        const wfwTtPolicyCtrl = getOrCreateTrustedTypesPolicy(wfw, {
          policyNames: hostConfig.trustedTypesPolicyNames,
          isAllowedScriptUrl,
        });
        const effectiveTtCtrl = wfwTtPolicyCtrl.hasNativePolicy ? wfwTtPolicyCtrl : (ttPolicyCtrl || wfwTtPolicyCtrl);
        let parsedWorkerUrl = null;
        let workerScriptDir = cdnBaseUrl;
        try {
          parsedWorkerUrl = new URL(resolvedUrl);
          workerScriptDir = new URL('.', resolvedUrl).href.replace(/\/+$/, '');
        } catch {
        }
        const workerLocationObj = parsedWorkerUrl
          ? Object.freeze({
              href: parsedWorkerUrl.href,
              origin: parsedWorkerUrl.origin,
              protocol: parsedWorkerUrl.protocol,
              host: parsedWorkerUrl.host,
              hostname: parsedWorkerUrl.hostname,
              port: parsedWorkerUrl.port,
              pathname: parsedWorkerUrl.pathname,
              search: parsedWorkerUrl.search,
              hash: parsedWorkerUrl.hash,
              toString() {
                return parsedWorkerUrl.href;
              },
              valueOf() {
                return parsedWorkerUrl.href;
              },
            })
          : wfw.location;
        const shouldReplaceUrlBase = (baseArg) => {
          if (baseArg === undefined || baseArg === null) return false;
          if (baseArg === wfw.location || baseArg === workerLocationObj) return true;
          const baseStr = String(baseArg);
          if (baseStr === 'about:blank') return true;
          if (inheritedDocUrl && inheritedDocUrl !== resolvedUrl && baseStr === inheritedDocUrl) {
            return true;
          }
          return false;
        };
        const OrigWfwURL = typeof wfw.URL === 'function' ? wfw.URL : URL;
        const ProxyCtor = wfw.Proxy || Proxy;
        if (typeof OrigWfwURL === 'function' && typeof ProxyCtor === 'function') {
          const AdaptedWfwURL = new ProxyCtor(OrigWfwURL, {
            construct(Target, args, newTarget) {
              if (args.length >= 2 && shouldReplaceUrlBase(args[1])) {
                const nextArgs = args.slice();
                nextArgs[1] = resolvedUrl;
                return Reflect.construct(Target, nextArgs, newTarget);
              }
              return Reflect.construct(Target, args, newTarget);
            },
            get(target, prop) {
              if ((prop === 'canParse' || prop === 'parse') && typeof target[prop] === 'function') {
                return function (urlInput, baseInput, ...rest) {
                  if (baseInput !== undefined && shouldReplaceUrlBase(baseInput)) {
                    return target[prop](urlInput, resolvedUrl, ...rest);
                  }
                  return baseInput !== undefined
                    ? target[prop](urlInput, baseInput, ...rest)
                    : target[prop](urlInput);
                };
              }
              const val = Reflect.get(target, prop, target);
              return typeof val === 'function' ? val.bind(target) : val;
            },
          });
          if (canDefineOwnPropertyOnScope(wfw, 'URL')) {
            Object.defineProperty(wfw, 'URL', {
              value: AdaptedWfwURL,
              writable: true,
              configurable: true,
              enumerable: false,
            });
          }
        }
        const rewriteWorkerAssetUrl = (rawArg) => {
          const rawStr = String(
            rawArg && typeof rawArg === 'object' && typeof rawArg.href === 'string'
              ? rawArg.href
              : (rawArg ?? '')
          ).trim();
          if (!rawStr) return rawStr;
          if (/^(?:https?:|blob:|data:|about:)/i.test(rawStr) || rawStr.startsWith('//')) {
            return rawStr;
          }
          const relBase = rawStr.startsWith('/') ? cdnBaseUrl : workerScriptDir;
          return resolveWorkbenchAssetUrl(rawStr, relBase, hostOrigin, cdnPathPrefix) || rawStr;
        };
        const resolveImportUrl = (rawArg) => {
          if (isNativeTrustedScriptURL(cw, rawArg) || isNativeTrustedScriptURL(wfw, rawArg)) {
            const str = String(rawArg).trim();
            if (isAllowedScriptUrl(str)) return str;
            throw new (wfw.TypeError || TypeError)('Untrusted importScripts URL rejected');
          }
          const rawImport = String(
            rawArg && typeof rawArg === 'object' && typeof rawArg.href === 'string'
              ? rawArg.href
              : (rawArg ?? '')
          ).trim();
          if (!rawImport) {
            throw new (wfw.TypeError || TypeError)('Empty importScripts URL rejected');
          }
          const candidate = resolveWorkbenchAssetUrl(rawImport, workerScriptDir, hostOrigin, cdnPathPrefix) || rawImport;
          if (!isAllowedScriptUrl(candidate)) {
            throw new (wfw.TypeError || TypeError)(`Untrusted importScripts URL rejected: ${rawImport}`);
          }
          return candidate;
        };
        const origXhrProto = wfw.XMLHttpRequest && wfw.XMLHttpRequest.prototype;
        const origXhrOpen = origXhrProto && typeof origXhrProto.open === 'function' ? origXhrProto.open : null;
        if (origXhrOpen) {
          origXhrProto.open = function (method, url, ...rest) {
            const rewrittenUrl =
              typeof url === 'string' || (url && typeof url.href === 'string')
                ? rewriteWorkerAssetUrl(url)
                : url;
            return origXhrOpen.call(this, method, rewrittenUrl, ...rest);
          };
        }
        const origWfwFetch = typeof wfw.fetch === 'function' ? wfw.fetch.bind(wfw) : null;
        if (origWfwFetch && canDefineOwnPropertyOnScope(wfw, 'fetch')) {
          Object.defineProperty(wfw, 'fetch', {
            value: (input, init) => {
              if (
                typeof input === 'string' ||
                (input && typeof input.href === 'string' && !(wfw.Request && input instanceof wfw.Request))
              ) {
                return origWfwFetch(rewriteWorkerAssetUrl(input), init);
              }
              return origWfwFetch(input, init);
            },
            writable: true,
            configurable: true,
            enumerable: true,
          });
        }
        if (typeof wfw.Request === 'function' && typeof ProxyCtor === 'function' && canDefineOwnPropertyOnScope(wfw, 'Request')) {
          const OrigWfwRequest = wfw.Request;
          Object.defineProperty(wfw, 'Request', {
            value: new ProxyCtor(OrigWfwRequest, {
              construct(Target, args, newTarget) {
                if (
                  args.length > 0 &&
                  (typeof args[0] === 'string' ||
                    (args[0] && typeof args[0].href === 'string' && !(args[0] instanceof Target)))
                ) {
                  const nextArgs = args.slice();
                  nextArgs[0] = rewriteWorkerAssetUrl(args[0]);
                  return Reflect.construct(Target, nextArgs, newTarget);
                }
                return Reflect.construct(Target, args, newTarget);
              },
            }),
            writable: true,
            configurable: true,
            enumerable: false,
          });
        }
        let workerSelfProxy = wfw;
        if (typeof ProxyCtor === 'function') {
          const boundMethodCache = new WeakMap();
          workerSelfProxy = new ProxyCtor(wfw, {
            get(target, prop) {
              if (prop === 'self' || prop === 'globalThis') return workerSelfProxy;
              if (prop === 'location') return workerLocationObj;
              if (prop === 'origin' && parsedWorkerUrl) return parsedWorkerUrl.origin;
              const val = Reflect.get(target, prop, target);
              if (typeof val === 'function' && prop !== 'eval' && typeof prop === 'string') {
                const shouldBindToTarget =
                  WINDOW_RECEIVER_METHODS.has(prop) || !('prototype' in val) || val.prototype === undefined;
                if (shouldBindToTarget) {
                  let bound = boundMethodCache.get(val);
                  if (!bound) {
                    bound = val.bind(target);
                    boundMethodCache.set(val, bound);
                  }
                  return bound;
                }
              }
              return val;
            },
            set(target, prop, value) {
              if (prop === 'location') return true;
              return Reflect.set(target, prop, value, target);
            },
            has(target, prop) {
              if (prop === Symbol.unscopables) return false;
              return (
                prop === 'location' ||
                prop === 'self' ||
                prop === 'globalThis' ||
                prop === 'origin' ||
                Reflect.has(target, prop)
              );
            },
          });
        }
        if (canDefineOwnPropertyOnScope(wfw, 'self')) {
          Object.defineProperty(wfw, 'self', {
            value: workerSelfProxy,
            writable: true,
            configurable: true,
            enumerable: true,
          });
        }
        if (canDefineOwnPropertyOnScope(wfw, 'globalThis')) {
          Object.defineProperty(wfw, 'globalThis', {
            value: workerSelfProxy,
            writable: true,
            configurable: true,
            enumerable: false,
          });
        }
        if (parsedWorkerUrl && canDefineOwnPropertyOnScope(wfw, 'origin')) {
          Object.defineProperty(wfw, 'origin', {
            value: parsedWorkerUrl.origin,
            writable: true,
            configurable: true,
            enumerable: true,
          });
        }
        if (canDefineOwnPropertyOnScope(wfw, 'location')) {
          Object.defineProperty(wfw, 'location', {
            value: workerLocationObj,
            writable: false,
            configurable: true,
            enumerable: true,
          });
        }
        const syncCaptureStack = [];
        const CAPTURE_HOOK_PROP = '__agyRecordSyncWorkerThrow';
        if (canDefineOwnPropertyOnScope(wfw, CAPTURE_HOOK_PROP)) {
          Object.defineProperty(wfw, CAPTURE_HOOK_PROP, {
            value: (thrownValue) => {
              if (syncCaptureStack.length > 0) {
                const top = syncCaptureStack[syncCaptureStack.length - 1];
                top.hasErr = true;
                top.error = thrownValue;
              }
            },
            writable: false,
            configurable: true,
            enumerable: false,
          });
        }
        const onWfwErrorCapture = (ev) => {
          if (terminated) return;
          if (syncCaptureStack.length > 0) {
            const top = syncCaptureStack[syncCaptureStack.length - 1];
            if (!top.hasErr) {
              top.hasErr = true;
              if (ev && 'error' in ev && (ev.error !== null || !ev.message)) {
                top.error = ev.error;
              } else {
                top.error = new (wfw.SyntaxError || SyntaxError)(ev?.message || 'Worker script error');
              }
            }
            ev?.preventDefault?.();
            ev?.stopImmediatePropagation?.();
            return;
          }
          const hasErrProp = Boolean(ev && 'error' in ev);
          emitHostError({
            message: ev?.message || 'Worker script error',
            lineno: ev?.lineno || 0,
            colno: ev?.colno || 0,
            error: hasErrProp ? ev.error : null,
          });
        };
        if (typeof wfw.addEventListener === 'function') {
          wfw.addEventListener('error', onWfwErrorCapture, true);
        }
        const isCspOrTrustedTypesBlockError = (err) => {
          if (!err) return false;
          const EvalErrCtor = wfw.EvalError || EvalError;
          if (err instanceof EvalErrCtor || err instanceof EvalError || err.name === 'EvalError') {
            return true;
          }
          const msg = String(err.message || '');
          return /TrustedScript|TrustedTypes|Content Security Policy|unsafe-eval|Refused to evaluate|requires 'TrustedScript'/i.test(
            msg
          );
        };
        let execSeq = 0;
        const runScopedClassicScript = (code, label, allowEvalFallback = true) => {
          const targetEl = wfd.head || wfd.body || wfd.documentElement;
          if (!targetEl) {
            throw new (wfw.Error || Error)('Worker helper document unavailable');
          }
          const execFlag = `__agyImpDone_${++execSeq}`;
          const markedCode =
            `try {\n` +
            `  with (self) {\n${code}\n}\n` +
            `} catch (__agyCaught) {\n` +
            `  ${CAPTURE_HOOK_PROP}(__agyCaught);\n` +
            `}\n` +
            `self[${JSON.stringify(execFlag)}] = 1;`;
          const frame = { hasErr: false, error: undefined };
          syncCaptureStack.push(frame);
          let executedSync = false;
          let sinkBlockErr = null;
          try {
            delete wfw[execFlag];
            const depEl = wfd.createElement('script');
            if (nonce) {
              depEl.nonce = nonce;
              depEl.setAttribute?.('nonce', nonce);
            }
            const scriptToken = effectiveTtCtrl.issueScriptToken(markedCode);
            try {
              depEl.text = effectiveTtCtrl.toScript(markedCode, scriptToken);
              targetEl.appendChild(depEl);
              executedSync = wfw[execFlag] === 1;
            } catch (sinkErr) {
              sinkBlockErr = sinkErr;
            } finally {
              effectiveTtCtrl.revokeScriptToken(scriptToken);
              delete wfw[execFlag];
            }
            if (frame.hasErr) {
              throw frame.error;
            }
            if (!executedSync && allowEvalFallback && typeof wfw.eval === 'function') {
              const evalToken = effectiveTtCtrl.issueScriptToken(markedCode);
              try {
                const evalPayload = effectiveTtCtrl.toScript(markedCode, evalToken);
                (0, wfw.eval)(evalPayload);
                executedSync = wfw[execFlag] === 1;
              } catch (evalErr) {
                sinkBlockErr = evalErr;
              } finally {
                effectiveTtCtrl.revokeScriptToken(evalToken);
                delete wfw[execFlag];
              }
              if (frame.hasErr) {
                throw frame.error;
              }
            }
          } finally {
            syncCaptureStack.pop();
          }
          if (!executedSync) {
            if (isCspOrTrustedTypesBlockError(sinkBlockErr) || !effectiveTtCtrl.hasNativePolicy) {
              const EvalErrCtor = wfw.EvalError || EvalError;
              throw new EvalErrCtor(
                `${label} blocked by Content Security Policy / TrustedTypes${sinkBlockErr?.message ? `: ${sinkBlockErr.message}` : ''}`
              );
            }
            if (sinkBlockErr) {
              throw sinkBlockErr;
            }
          }
          return { executedSync };
        };
        const loadImportedScriptSync = (safeImportUrl) => {
          if (typeof wfw.XMLHttpRequest !== 'function') {
            throw new (wfw.Error || Error)('importScripts requires synchronous XMLHttpRequest');
          }
          const xhr = new wfw.XMLHttpRequest();
          if (origXhrOpen) origXhrOpen.call(xhr, 'GET', safeImportUrl, false);
          else xhr.open('GET', safeImportUrl, false);
          xhr.send(null);
          if (xhr.status < 200 || xhr.status >= 300) {
            throw new (wfw.Error || Error)(`Failed to importScripts (${xhr.status}): ${safeImportUrl}`);
          }
          const code = String(xhr.responseText || '');
          const { executedSync } = runScopedClassicScript(code, 'importScripts', true);
          if (!executedSync) {
            throw new (wfw.EvalError || EvalError)(`importScripts blocked from synchronous execution: ${safeImportUrl}`);
          }
        };
        const workerScopeOrig =
          typeof wfw.Worker === 'function' ? wfw.Worker : (typeof cw.Worker === 'function' ? cw.Worker : null);
        if (workerScopeOrig && !workerScopeOrig.__agyWorkerAdapted && canDefineOwnPropertyOnScope(wfw, 'Worker')) {
          Object.defineProperty(wfw, 'Worker', {
            value: buildAdaptedWorkerCtor(workerScopeOrig, workerScriptDir, bridgeDepth + 1),
            configurable: true,
            writable: true,
          });
        }
        if (canDefineOwnPropertyOnScope(wfw, 'postMessage')) {
          Object.defineProperty(wfw, 'postMessage', {
            value: (msg, transfer) => {
              if (terminated) return;
              if (workerPort) {
                if (transfer !== undefined) workerPort.postMessage(msg, transfer);
                else workerPort.postMessage(msg);
                return;
              }
              emitHostMessage(msg, Array.isArray(transfer) ? transfer : []);
            },
            configurable: true,
            writable: true,
          });
        }
        if (canDefineOwnPropertyOnScope(wfw, 'close')) {
          Object.defineProperty(wfw, 'close', {
            value: terminateBridge,
            configurable: true,
            writable: true,
          });
        }
        if (canDefineOwnPropertyOnScope(wfw, 'importScripts')) {
          Object.defineProperty(wfw, 'importScripts', {
            value: (...urls) => {
              if (terminated) return;
              if (workerOptions && workerOptions.type === 'module') {
                throw new (wfw.TypeError || TypeError)("Module scripts don't support importScripts().");
              }
              const resolvedUrls = [];
              for (let i = 0; i < urls.length; i += 1) {
                resolvedUrls.push(resolveImportUrl(urls[i]));
              }
              for (let i = 0; i < resolvedUrls.length; i += 1) {
                loadImportedScriptSync(resolvedUrls[i]);
              }
            },
            configurable: true,
            writable: true,
          });
        }
        if (workerOptions && workerOptions.name !== undefined) {
          wfw.name = String(workerOptions.name);
        }
        const deliverToWorkerScope = (msg, ports) => {
          if (terminated || !wfw) return;
          let errReported = false;
          const reportScopeErr = (err) => {
            if (errReported || terminated) return;
            errReported = true;
            emitHostError({
              message: err && typeof err === 'object' && 'message' in err ? err.message : String(err),
              error: err,
            });
          };
          const ev =
            typeof wfw.MessageEvent === 'function'
              ? new wfw.MessageEvent('message', { data: msg, ports: ports || [] })
              : { type: 'message', data: msg, ports: ports || [] };
          const prevOnMsg = typeof wfw.onmessage === 'function' ? wfw.onmessage : null;
          let onMsgRan = false;
          let sentinel = null;
          if (prevOnMsg) {
            sentinel = function (eventArg) {
              onMsgRan = true;
              try {
                return prevOnMsg.call(workerSelfProxy, eventArg);
              } catch (err) {
                reportScopeErr(err);
                return undefined;
              }
            };
            try {
              wfw.onmessage = sentinel;
            } catch {
              sentinel = null;
            }
          }
          try {
            wfw.dispatchEvent?.(ev);
          } catch (err) {
            reportScopeErr(err);
          } finally {
            if (sentinel && wfw.onmessage === sentinel) {
              try {
                wfw.onmessage = prevOnMsg;
              } catch {
              }
            }
          }
          if (prevOnMsg && !onMsgRan) {
            try {
              prevOnMsg.call(workerSelfProxy, ev);
            } catch (err) {
              reportScopeErr(err);
            }
          }
        };
        const flushInboundQueueIfReady = () => {
          if (terminated || !loaded) return;
          if (workerPort) {
            workerPort.onmessage = (ev) => {
              deliverToWorkerScope(ev.data, ev.ports);
            };
            workerPort.start?.();
          }
          const queued = pendingInbound.splice(0, pendingInbound.length);
          for (let i = 0; i < queued.length; i += 1) {
            const item = queued[i];
            if (hostPort) {
              if (item.transfer !== undefined) hostPort.postMessage(item.msg, item.transfer);
              else hostPort.postMessage(item.msg);
            } else {
              deliverToWorkerScope(item.msg, Array.isArray(item.transfer) ? item.transfer : []);
            }
          }
        };
        if (hostPort && workerPort) {
          hostPort.onmessage = (ev) => {
            emitHostMessage(ev.data, ev.ports);
          };
          hostPort.start?.();
        }
        const loadViaExternalScriptElement = () => {
          if (terminated) return;
          const sc = wfd.createElement('script');
          if (nonce) {
            sc.nonce = nonce;
            sc.setAttribute?.('nonce', nonce);
          }
          if (workerOptions && workerOptions.type === 'module') {
            sc.type = 'module';
          }
          sc.src = effectiveTtCtrl.toScriptURL(resolvedUrl);
          sc.addEventListener?.(
            'load',
            () => {
              if (terminated) return;
              loaded = true;
              flushInboundQueueIfReady();
            },
            { once: true }
          );
          sc.addEventListener?.(
            'error',
            () => {
              emitHostError({ message: `Failed to load Worker script: ${resolvedUrl}`, error: null });
            },
            { once: true }
          );
          const frameTarget = wfd.head || wfd.body || wfd.documentElement;
          frameTarget.appendChild(sc);
        };
        const isModuleWorker = Boolean(workerOptions && workerOptions.type === 'module');
        if (!isModuleWorker && origWfwFetch) {
          Promise.resolve(origWfwFetch(resolvedUrl))
            .then(async (resp) => {
              if (terminated) return;
              if (!resp || resp.ok === false) {
                emitHostError({
                  message: `Failed to fetch worker script (${resp?.status ?? 'network'}): ${resolvedUrl}`,
                  error: null,
                });
                return;
              }
              const code = await resp.text();
              if (terminated) return;
              try {
                const { executedSync } = runScopedClassicScript(code, 'Worker', false);
                if (executedSync) {
                  loaded = true;
                  flushInboundQueueIfReady();
                  return;
                }
              } catch (err) {
                if (!isCspOrTrustedTypesBlockError(err)) {
                  emitHostError({
                    message: err && typeof err === 'object' && 'message' in err ? err.message : String(err),
                    error: err,
                  });
                  return;
                }
              }
              loadViaExternalScriptElement();
            })
            .catch(() => {
              loadViaExternalScriptElement();
            });
        } else {
          loadViaExternalScriptElement();
        }
        return shim;
      }
      function buildAdaptedWorkerCtor(OrigWorker, baseCdnDir, bridgeDepth) {
        const AdaptedWorker = function (scriptURL, options) {
          const isTrustedObj = isNativeTrustedScriptURL(cw, scriptURL);
          const rawStr = String(
            scriptURL && typeof scriptURL === 'object' && typeof scriptURL.href === 'string'
              ? scriptURL.href
              : (scriptURL ?? '')
          ).trim();
          if (rawStr.startsWith('blob:')) {
            if (hostOrigin && !rawStr.startsWith(`blob:${hostOrigin}/`)) {
              throw new TypeError('Cross-origin blob Worker URL rejected');
            }
            let safeBlob = scriptURL;
            if (!isTrustedObj && ttPolicyCtrl) {
              const blobToken = ttPolicyCtrl.issueBlobUrlToken(rawStr, hostOrigin || undefined);
              try {
                safeBlob = ttPolicyCtrl.toScriptURL(rawStr, blobToken);
              } finally {
                ttPolicyCtrl.revokeBlobUrlToken(blobToken);
              }
            }
            return options !== undefined ? new OrigWorker(safeBlob, options) : new OrigWorker(safeBlob);
          }
          const resolvedUrl = resolveWorkbenchAssetUrl(rawStr, baseCdnDir, hostOrigin, cdnPathPrefix) || rawStr;
          if (!isAllowedScriptUrl(resolvedUrl)) {
            throw new TypeError(`Untrusted Worker script URL rejected: ${rawStr}`);
          }
          let sameOriginWithPage = false;
          try {
            const pageOrigin =
              cw.location && cw.location.origin && cw.location.origin !== 'null'
                ? cw.location.origin
                : (hostOrigin ? new URL(String(hostOrigin)).origin : '');
            sameOriginWithPage = Boolean(pageOrigin && new URL(resolvedUrl).origin === pageOrigin);
          } catch {
            sameOriginWithPage = false;
          }
          if (sameOriginWithPage) {
            const safeDirect = isTrustedObj ? scriptURL : (ttPolicyCtrl ? ttPolicyCtrl.toScriptURL(resolvedUrl) : resolvedUrl);
            return options !== undefined ? new OrigWorker(safeDirect, options) : new OrigWorker(safeDirect);
          }
          return createCdnWorkerBridge(resolvedUrl, options, bridgeDepth);
        };
        AdaptedWorker.prototype = OrigWorker.prototype;
        try {
          Object.setPrototypeOf(AdaptedWorker, OrigWorker);
        } catch {
        }
        AdaptedWorker.__agyWorkerAdapted = true;
        return AdaptedWorker;
      }
      if (cw && typeof cw.Worker === 'function' && !cw.Worker.__agyWorkerAdapted) {
        const OrigWorker = cw.Worker;
        const AdaptedWorker = buildAdaptedWorkerCtor(OrigWorker, cdnBaseUrl, 0);
        if (canDefineOwnPropertyOnScope(cw, 'Worker')) {
          Object.defineProperty(cw, 'Worker', {
            value: AdaptedWorker,
            writable: true,
            configurable: true,
            enumerable: false,
          });
        }
      }
    }
    module.exports = {
      MAX_NESTED_WORKER_DEPTH,
      WINDOW_RECEIVER_METHODS,
      canDefineOwnPropertyOnScope,
      installCdnWorkerAdapter,
    };
  },
  "./adapters/antigravity/remote-workbench/frame-promoter-fsm": function(module, exports, __require) {
    const require = (spec) => __require("./adapters/antigravity/remote-workbench", spec);
    'use strict';
    const { DisposableStore } = require('../../../core/disposable');
    const { hasPathTraversal } = require('../../../core/security/url-policy');
    const { getOrCreateTrustedTypesPolicy, getScriptNonce } = require('../../../security/trusted-types');
    const { disposableTimeout, disposableEvent, disposableObserver } = require('../../../shared/dom-disposables');
    const { buildAllowedScriptUrlValidator } = require('../host-config');
    const { incrementIframeSuppression } = require('../remote-control-lease');
    const { installChildHistoryAdapter, installChildAssetAdapter } = require('./child-asset-adapter');
    const { installCdnWorkerAdapter } = require('./cdn-worker-bridge');
    const FRAME_PROMOTION_STATE = Object.freeze({
      IDLE: 'idle',
      PREFLIGHT: 'preflight',
      PROMOTING: 'promoting',
      READY: 'ready',
      PASSIVE_ATTACHED: 'passive_attached',
      ROLLED_BACK: 'rolled_back',
    });
    function inspectPromotionOwnership(iframe, version, win) {
      if (!iframe) return { canPromote: false, isCompanionOwned: false };
      if (iframe.__agyMcpPromoted === version || iframe.__agyMcpPromotionFailed) {
        return { canPromote: false, isCompanionOwned: false };
      }
      const winOwner = win ? win.__agyRemotePromotionOwner : undefined;
      if (
        iframe.__agyKoPromoted ||
        iframe.__agyPromoted ||
        (iframe.__agyRemotePromotionOwner &&
          iframe.__agyRemotePromotionOwner !== 'mcp-manager' &&
          iframe.__agyRemotePromotionState !== FRAME_PROMOTION_STATE.ROLLED_BACK) ||
        (winOwner && winOwner !== 'mcp-manager')
      ) {
        return { canPromote: false, isCompanionOwned: true };
      }
      return { canPromote: true, isCompanionOwned: false };
    }
    function attachPassiveCompanionHooks(win, iframe, onReady) {
      iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.PASSIVE_ATTACHED;
      let cleanupDec = () => {};
      try {
        const cw = iframe.contentWindow;
        if (cw) {
          if (cw.__agyCapturedLsClient && !win.__agyCapturedLsClient) {
            win.__agyCapturedLsClient = cw.__agyCapturedLsClient;
          }
          const hadOwn = Object.prototype.hasOwnProperty.call(cw, '__JETSKI_LS_CLIENT_DECORATOR__');
          const prevDec = cw.__JETSKI_LS_CLIENT_DECORATOR__;
          const passiveDec = function (client) {
            const decorated = typeof prevDec === 'function' ? prevDec(client) || client : client;
            if (decorated && typeof decorated === 'object') {
              win.__agyCapturedLsClient = decorated;
            }
            return decorated;
          };
          cw.__JETSKI_LS_CLIENT_DECORATOR__ = passiveDec;
          cleanupDec = () => {
            try {
              if (cw.__JETSKI_LS_CLIENT_DECORATOR__ === passiveDec) {
                if (hadOwn) cw.__JETSKI_LS_CLIENT_DECORATOR__ = prevDec;
                else delete cw.__JETSKI_LS_CLIENT_DECORATOR__;
              }
            } catch {
            }
          };
        }
      } catch {
      }
      if (typeof onReady === 'function') {
        onReady();
      }
      return {
        state: FRAME_PROMOTION_STATE.PASSIVE_ATTACHED,
        dispose() {
          cleanupDec();
        },
      };
    }
    function promoteCrossOriginRemoteIframe(params) {
      const {
        win,
        doc,
        iframe,
        hostConfig,
        remoteLease,
        onReady,
        version = '2.0.0',
      } = params;
      if (!win || !doc || !iframe) return { promoted: false, state: FRAME_PROMOTION_STATE.IDLE, dispose() {} };
      const ownership = inspectPromotionOwnership(iframe, version, win);
      if (!ownership.canPromote) {
        if (ownership.isCompanionOwned) {
          const passive = attachPassiveCompanionHooks(win, iframe, onReady);
          return { promoted: false, state: passive.state, dispose: passive.dispose };
        }
        return {
          promoted: false,
          state: iframe.__agyRemotePromotionState || FRAME_PROMOTION_STATE.IDLE,
          dispose() {},
        };
      }
      const rcInst = remoteLease && typeof remoteLease.getInstance === 'function'
        ? remoteLease.getInstance(win, doc)
        : null;
      const rawCandidate =
        iframe.getAttribute?.('src') ||
        iframe.src ||
        (rcInst && typeof rcInst.iframeSrc === 'function' ? String(rcInst.iframeSrc() || '') : '') ||
        '';
      const rawSrc = String(rawCandidate).match(/https?:\/\/[^\s"'<>)+]+/)?.[0] || String(rawCandidate);
      if (!rawSrc) {
        return { promoted: false, state: FRAME_PROMOTION_STATE.IDLE, dispose() {} };
      }
      iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.PREFLIGHT;
      let parsedUrl;
      try {
        parsedUrl = new URL(rawSrc, win.location?.href || 'https://localhost');
      } catch {
        iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
        return { promoted: false, state: FRAME_PROMOTION_STATE.ROLLED_BACK, dispose() {} };
      }
      if (
        parsedUrl.protocol !== 'https:' ||
        parsedUrl.username ||
        parsedUrl.password ||
        parsedUrl.searchParams.get('iframe') !== 'true'
      ) {
        iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
        return { promoted: false, state: FRAME_PROMOTION_STATE.ROLLED_BACK, dispose() {} };
      }
      const trustedStaticHosts = new Set();
      for (const staticOrig of hostConfig.staticCdnOrigins || []) {
        try {
          const su = new URL(String(staticOrig));
          if (su.protocol === 'https:') {
            trustedStaticHosts.add(su.hostname.toLowerCase());
          }
        } catch {
        }
      }
      let cdnOriginParsed = null;
      try {
        cdnOriginParsed = new URL(String(hostConfig.cdnOrigin || ''));
        if (cdnOriginParsed.protocol === 'https:') {
          trustedStaticHosts.add(cdnOriginParsed.hostname.toLowerCase());
        }
      } catch {
        cdnOriginParsed = null;
      }
      const candidateHost = parsedUrl.hostname.toLowerCase();
      if (!trustedStaticHosts.has(candidateHost) && !hostConfig.isRemoteHost(candidateHost)) {
        iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
        return { promoted: false, state: FRAME_PROMOTION_STATE.ROLLED_BACK, dispose() {} };
      }
      const cdnPathPrefix = `/${String(hostConfig.cdnPathPrefix || '/web/').replace(/^\/+|\/+$/g, '')}/`;
      const rawPathname = parsedUrl.pathname;
      const htmlMatch = rawPathname.match(/\/([^/]+)\.html?$/i);
      const htmlEntryStem = htmlMatch && htmlMatch[1].toLowerCase() !== 'index' ? htmlMatch[1] : '';
      const dirPathname = htmlMatch ? rawPathname.slice(0, -htmlMatch[0].length) : rawPathname.replace(/\/+$/, '');
      const prefixPos = dirPathname.indexOf(cdnPathPrefix);
      const basePath = (prefixPos >= 0 ? dirPathname.slice(prefixPos) : dirPathname).replace(/\/+$/, '');
      if (
        !basePath.startsWith(cdnPathPrefix) ||
        !basePath.slice(cdnPathPrefix.length) ||
        hasPathTraversal(dirPathname) ||
        /["'<>\\\s]/.test(dirPathname)
      ) {
        iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
        return { promoted: false, state: FRAME_PROMOTION_STATE.ROLLED_BACK, dispose() {} };
      }
      const afterPrefix = basePath.slice(cdnPathPrefix.length);
      const appVersion = afterPrefix.split('/')[0] || '2.33.0';
      const cdnBaseUrl =
        cdnOriginParsed && parsedUrl.origin === cdnOriginParsed.origin
          ? `${parsedUrl.origin}${dirPathname}`
          : `${hostConfig.cdnOrigin}${basePath}`;
      const isAllowedScriptUrl = buildAllowedScriptUrlValidator(hostConfig, win);
      const ttPolicyCtrl = getOrCreateTrustedTypesPolicy(win, {
        policyNames: hostConfig.trustedTypesPolicyNames,
        isAllowedScriptUrl,
      });
      const prismUrl = htmlEntryStem ? '' : `${cdnBaseUrl}/prism_bundle.js`;
      const mainUrl = `${cdnBaseUrl}/${htmlEntryStem || 'main'}.js`;
      let trustedPrismUrl = null;
      let trustedMainUrl;
      try {
        if (prismUrl) {
          trustedPrismUrl = ttPolicyCtrl.toScriptURL(prismUrl);
        }
        trustedMainUrl = ttPolicyCtrl.toScriptURL(mainUrl);
        const probeScript = doc.createElement?.('script');
        if (probeScript) {
          probeScript.src = trustedMainUrl;
        }
      } catch {
        iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
        iframe.__agyMcpPromotionFailed = true;
        return { promoted: false, state: FRAME_PROMOTION_STATE.ROLLED_BACK, dispose() {} };
      }
      const promotionStore = new DisposableStore();
      const activeWorkerBridges = new Set();
      iframe.__agyRemotePromotionOwner = 'mcp-manager';
      win.__agyRemotePromotionOwner = 'mcp-manager';
      iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.PROMOTING;
      iframe.__agyMcpPromoted = version;
      const releaseSuppression = incrementIframeSuppression(rcInst);
      const savedChildPath = String(
        new URLSearchParams(win.location?.search || '').get('p') ||
          rcInst?.lastSyncedChildPath ||
          rcInst?.initialChildPath ||
          ''
      ).replace(/^\/+/, '');
      if (savedChildPath && rcInst) {
        rcInst.initialChildPath = savedChildPath;
      }
      const buildInitialIframeHistoryUrl = () => {
        const baseQuery = parsedUrl.search ? parsedUrl.search.replace(/^\?/, '') : 'iframe=true';
        if (!savedChildPath) return `${basePath}/?${baseQuery}`;
        const qIdx = savedChildPath.indexOf('?');
        const subPath = qIdx >= 0 ? savedChildPath.slice(0, qIdx) : savedChildPath;
        const subQuery = qIdx >= 0 ? savedChildPath.slice(qIdx + 1) : '';
        const cleanSubPath = subPath.replace(/^\/+/, '');
        const fullPath = cleanSubPath ? `${basePath}/${cleanSubPath}` : `${basePath}/`;
        return subQuery ? `${fullPath}?${subQuery}&${baseQuery}` : `${fullPath}?${baseQuery}`;
      };
      const IframeCtor =
        win?.HTMLIFrameElement || (typeof HTMLIFrameElement !== 'undefined' ? HTMLIFrameElement : null);
      const origSrcDesc =
        IframeCtor && iframe instanceof IframeCtor && IframeCtor.prototype
          ? Object.getOwnPropertyDescriptor(IframeCtor.prototype, 'src')
          : null;
      const hostOrigin = win.location?.origin || parsedUrl.origin;
      const canonicalFrameUrl = `${hostOrigin}${basePath}/${parsedUrl.search || '?iframe=true'}`;
      let childWindowRef = null;
      let hadOwnChildDec = false;
      let prevChildDec = undefined;
      let wrappedChildDec = null;
      let capturedLsByThisPromotion = null;
      let rolledBack = false;
      let readyNotified = false;
      let fallbackTimerDisp = null;
      const cleanupWorkers = () => {
        for (const bridge of Array.from(activeWorkerBridges)) {
          try {
            bridge.terminate();
          } catch {
          }
        }
        activeWorkerBridges.clear();
      };
      const unspoofIframeSrcProperty = () => {
        try {
          delete iframe.src;
        } catch {
        }
      };
      const restoreDecoratorAndGlobals = () => {
        try {
          const targetCw = childWindowRef || iframe.contentWindow;
          if (targetCw) {
            if (wrappedChildDec && targetCw.__JETSKI_LS_CLIENT_DECORATOR__ === wrappedChildDec) {
              if (hadOwnChildDec) targetCw.__JETSKI_LS_CLIENT_DECORATOR__ = prevChildDec;
              else delete targetCw.__JETSKI_LS_CLIENT_DECORATOR__;
            }
            delete targetCw.__agyCapturedLsClient;
          }
          if (
            capturedLsByThisPromotion &&
            win.__agyCapturedLsClient === capturedLsByThisPromotion &&
            !win.agyStatusBar
          ) {
            delete win.__agyCapturedLsClient;
          }
        } catch {
        }
      };
      const setNativeIframeSrc = (targetSrc) => {
        if (origSrcDesc && typeof origSrcDesc.set === 'function') {
          origSrcDesc.set.call(iframe, targetSrc);
        } else {
          iframe.setAttribute?.('src', targetSrc);
          iframe.src = targetSrc;
        }
      };
      const rollbackToOriginalSrc = () => {
        if (rolledBack) return;
        rolledBack = true;
        if (fallbackTimerDisp) {
          fallbackTimerDisp.dispose();
          fallbackTimerDisp = null;
        }
        cleanupWorkers();
        releaseSuppression();
        restoreDecoratorAndGlobals();
        unspoofIframeSrcProperty();
        promotionStore.dispose();
        delete iframe.__agyMcpPromoted;
        delete iframe.__agyMcpRestorePromotion;
        if (iframe.__agyRemotePromotionOwner === 'mcp-manager') {
          delete iframe.__agyRemotePromotionOwner;
        }
        if (win.__agyRemotePromotionOwner === 'mcp-manager') {
          delete win.__agyRemotePromotionOwner;
        }
        iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
        iframe.__agyMcpPromotionFailed = true;
        try {
          setNativeIframeSrc(rawSrc);
        } catch {
        }
      };
      const cleanupPromotedIframeOnDestroy = () => {
        if (fallbackTimerDisp) {
          fallbackTimerDisp.dispose();
          fallbackTimerDisp = null;
        }
        cleanupWorkers();
        releaseSuppression();
        restoreDecoratorAndGlobals();
        unspoofIframeSrcProperty();
        promotionStore.dispose();
        if (iframe.__agyRemotePromotionOwner === 'mcp-manager') {
          delete iframe.__agyRemotePromotionOwner;
        }
        if (win.__agyRemotePromotionOwner === 'mcp-manager') {
          delete win.__agyRemotePromotionOwner;
        }
        delete iframe.__agyRemotePromotionState;
        delete iframe.__agyMcpPromoted;
        delete iframe.__agyMcpPromotionFailed;
        delete iframe.__agyMcpRestorePromotion;
      };
      const notifyReadyOnce = () => {
        if (readyNotified || rolledBack) return;
        readyNotified = true;
        iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.READY;
        if (typeof onReady === 'function') {
          onReady();
        }
      };
      const onBlankLoad = () => {
        try {
          const cw = iframe.contentWindow;
          const cd = iframe.contentDocument || cw?.document;
          if (!cw || !cd) {
            rollbackToOriginalSrc();
            return;
          }
          childWindowRef = cw;
          if (typeof cd.open === 'function' && typeof cd.close === 'function') {
            cd.open();
            cd.close();
          }
          const nonce = getScriptNonce(doc);
          const clearChildren = (parent) => {
            if (!parent) return;
            while (parent.firstChild && typeof parent.removeChild === 'function') {
              parent.removeChild(parent.firstChild);
            }
          };
          if (cd.documentElement && typeof cd.documentElement.setAttribute === 'function') {
            cd.documentElement.setAttribute('lang', 'en');
          }
          const rawTheme = parsedUrl.searchParams.get('hostTheme');
          const resolvedTheme =
            rawTheme === 'dark' || rawTheme === 'light'
              ? rawTheme
              : win.matchMedia?.('(prefers-color-scheme: dark)')?.matches
                ? 'dark'
                : 'light';
          if (cd.documentElement?.style) {
            cd.documentElement.style.colorScheme = resolvedTheme;
          }
          let headEl = cd.head;
          if (!headEl && typeof cd.createElement === 'function') {
            headEl = cd.createElement('head');
            cd.documentElement?.appendChild?.(headEl);
          }
          let bodyEl = cd.body;
          if (!bodyEl && typeof cd.createElement === 'function') {
            bodyEl = cd.createElement('body');
            cd.documentElement?.appendChild?.(bodyEl);
          }
          clearChildren(headEl);
          clearChildren(bodyEl);
          installChildHistoryAdapter(cw, canonicalFrameUrl);
          installChildAssetAdapter({
            cw,
            cd,
            nonce,
            cdnBaseUrl,
            hostOrigin,
            hostConfig,
            ttPolicyCtrl,
            installWorkerConstructorAdapter(origCreateEl) {
              installCdnWorkerAdapter({
                cw,
                cd,
                origCreateEl,
                nonce,
                cdnBaseUrl,
                hostOrigin,
                hostConfig,
                isAllowedScriptUrl,
                ttPolicyCtrl,
                activeWorkerBridges,
              });
            },
          });
          if (headEl && typeof headEl.appendChild === 'function' && typeof cd.createElement === 'function') {
            const metaCharset = cd.createElement('meta');
            metaCharset.setAttribute?.('charset', 'UTF-8');
            headEl.appendChild(metaCharset);
            const metaViewport = cd.createElement('meta');
            metaViewport.setAttribute?.('name', 'viewport');
            metaViewport.setAttribute?.(
              'content',
              'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover'
            );
            headEl.appendChild(metaViewport);
            for (const cssFile of ['jetbox.css', 'compiled_tailwind.css']) {
              const linkEl = cd.createElement('link');
              linkEl.setAttribute?.('rel', 'stylesheet');
              const href = `${cdnBaseUrl}/${cssFile}`;
              linkEl.setAttribute?.('href', href);
              linkEl.href = href;
              if (nonce) {
                linkEl.nonce = nonce;
                linkEl.setAttribute?.('nonce', nonce);
              }
              headEl.appendChild(linkEl);
            }
            const styleShell = cd.createElement('style');
            if (nonce) {
              styleShell.nonce = nonce;
              styleShell.setAttribute?.('nonce', nonce);
            }
            styleShell.textContent =
              'html,body,#root{height:100%;height:100dvh;max-height:100dvh;margin:0;overflow:hidden;background-color:transparent;overscroll-behavior:none;-webkit-text-size-adjust:100%;}';
            headEl.appendChild(styleShell);
          }
          if (bodyEl && typeof bodyEl.appendChild === 'function' && typeof cd.createElement === 'function') {
            const rootDiv = cd.createElement('div');
            rootDiv.id = 'root';
            rootDiv.setAttribute?.('id', 'root');
            bodyEl.appendChild(rootDiv);
          }
          hadOwnChildDec = Object.prototype.hasOwnProperty.call(cw, '__JETSKI_LS_CLIENT_DECORATOR__');
          prevChildDec = cw.__JETSKI_LS_CLIENT_DECORATOR__;
          wrappedChildDec = function (client) {
            const decorated = typeof prevChildDec === 'function' ? prevChildDec(client) || client : client;
            if (decorated && typeof decorated === 'object') {
              capturedLsByThisPromotion = decorated;
              cw.__agyCapturedLsClient = decorated;
              win.__agyCapturedLsClient = decorated;
            }
            return decorated;
          };
          cw.__JETSKI_LS_CLIENT_DECORATOR__ = wrappedChildDec;
          cw.history?.replaceState?.(null, '', buildInitialIframeHistoryUrl());
          try {
            Object.defineProperty(cd, 'referrer', {
              configurable: true,
              get: () => win.location?.href || '',
            });
          } catch {
          }
          const dynamicCsrfToken = String(
            win?.__APP_CONFIG__?.csrfToken || rcInst?.csrfToken || hostConfig.remoteCsrfToken || ''
          );
          cw.__APP_CONFIG__ = {
            productName: String(win?.__APP_CONFIG__?.productName || 'antigravity'),
            csrfToken: dynamicCsrfToken,
            appVersion,
            isRemoteControl: true,
          };
          const ua = cw.navigator?.userAgent || '';
          const platform =
            ua.indexOf('Windows') >= 0
              ? 'win32'
              : ua.indexOf('Macintosh') >= 0 || ua.indexOf('Mac OS') >= 0
                ? 'darwin'
                : 'linux';
          cw.process = cw.process || {
            env: { NODE_ENV: 'production' },
            platform,
            nextTick: (cb) => Promise.resolve().then(cb),
          };
          if (cw.AudioWorklet && cw.AudioWorklet.prototype) {
            cw.AudioWorklet.prototype.addModule = () => Promise.resolve();
          }
          if (cw.customElements && !cw.customElements.__agyGuarded) {
            const origDef = cw.customElements.define.bind(cw.customElements);
            cw.customElements.define = (name, ctor, opts) => {
              if (!cw.customElements.get(name)) origDef(name, ctor, opts);
            };
            cw.customElements.__agyGuarded = true;
          }
          if (typeof cw.addEventListener === 'function' && !cw.__agyMsgBufferInstalled) {
            cw.__agyMsgBufferInstalled = true;
            const msgListeners = new Set();
            const origAddEv = cw.addEventListener.bind(cw);
            const origRemoveEv = typeof cw.removeEventListener === 'function' ? cw.removeEventListener.bind(cw) : null;
            origAddEv('message', (ev) => {
              const msgType = String(ev?.data?.type || '');
              if (msgType === 'INITIAL_CONFIG' || msgType.endsWith('-v2') || (ev?.ports && ev.ports.length > 0)) {
                cw.__agyBufferedInitialConfigEvent = ev;
                if (msgListeners.size > 0) {
                  cw.__initialConfigReceived = true;
                }
              }
            });
            cw.addEventListener = function (type, listener, options) {
              if (type === 'message' && typeof listener === 'function') {
                msgListeners.add(listener);
                const res = origAddEv(type, listener, options);
                if (cw.__agyBufferedInitialConfigEvent && !cw.__initialConfigReceived) {
                  const bufferedEv = cw.__agyBufferedInitialConfigEvent;
                  cw.__initialConfigReceived = true;
                  Promise.resolve().then(() => {
                    listener.call(cw, bufferedEv);
                  });
                }
                return res;
              }
              return origAddEv(type, listener, options);
            };
            if (origRemoveEv) {
              cw.removeEventListener = function (type, listener, options) {
                if (type === 'message' && typeof listener === 'function') {
                  msgListeners.delete(listener);
                }
                return origRemoveEv(type, listener, options);
              };
            }
          }
          let prismScript = null;
          if (trustedPrismUrl) {
            prismScript = cd.createElement('script');
            if (nonce) {
              prismScript.nonce = nonce;
              prismScript.setAttribute?.('nonce', nonce);
            }
            prismScript.async = false;
            prismScript.src = trustedPrismUrl;
          }
          const mainScript = cd.createElement('script');
          if (nonce) {
            mainScript.nonce = nonce;
            mainScript.setAttribute?.('nonce', nonce);
          }
          mainScript.async = false;
          mainScript.src = trustedMainUrl;
          const markPromotedReady = () => {
            if (rcInst) {
              if (typeof rcInst.markIframeReady === 'function') {
                rcInst.markIframeReady();
              } else {
                rcInst.iframeLoading?.set?.(false);
                rcInst.iframeUiReady?.set?.(true);
              }
            }
            notifyReadyOnce();
          };
          const onMainScriptLoad = () => {
            releaseSuppression();
            cw.__agyMainBooted = true;
            if (savedChildPath && rcInst) rcInst.initialChildPath = savedChildPath;
            let loadRet = null;
            if (rcInst && remoteLease && !cw.__initialConfigReceived && !cw.__agyOnIframeLoadCalled) {
              cw.__agyOnIframeLoadCalled = true;
              loadRet = remoteLease.invokeOriginalOnIframeLoad(rcInst);
            }
            if (loadRet && typeof loadRet.then === 'function') {
              loadRet.then(markPromotedReady, markPromotedReady);
            } else {
              markPromotedReady();
            }
          };
          const onMainScriptError = () => {
            rollbackToOriginalSrc();
          };
          if (typeof mainScript.addEventListener === 'function') {
            promotionStore.add(disposableEvent(mainScript, 'load', onMainScriptLoad, { once: true }));
            promotionStore.add(disposableEvent(mainScript, 'error', onMainScriptError, { once: true }));
          } else {
            mainScript.onload = onMainScriptLoad;
            mainScript.onerror = onMainScriptError;
          }
          if (headEl && typeof headEl.appendChild === 'function') {
            if (prismScript) headEl.appendChild(prismScript);
            headEl.appendChild(mainScript);
          } else {
            rollbackToOriginalSrc();
          }
        } catch {
          rollbackToOriginalSrc();
        }
      };
      unspoofIframeSrcProperty();
      let blankLoadHandled = false;
      const triggerBlankLoadOnce = () => {
        if (blankLoadHandled || rolledBack) return;
        try {
          const cd = iframe.contentDocument || iframe.contentWindow?.document;
          const cw = iframe.contentWindow;
          if (!cd || !cw) return;
          blankLoadHandled = true;
        } catch {
          return;
        }
        if (fallbackTimerDisp) {
          fallbackTimerDisp.dispose();
          fallbackTimerDisp = null;
        }
        onBlankLoad();
      };
      promotionStore.add(disposableEvent(iframe, 'load', triggerBlankLoadOnce));
      try {
        setNativeIframeSrc('about:blank');
      } catch {
        rollbackToOriginalSrc();
        return { promoted: false, state: FRAME_PROMOTION_STATE.ROLLED_BACK, dispose() {} };
      }
      try {
        Object.defineProperty(iframe, 'src', {
          configurable: true,
          enumerable: true,
          get: () => rawSrc,
          set: (nextSrc) => {
            rolledBack = true;
            cleanupPromotedIframeOnDestroy();
            setNativeIframeSrc(nextSrc);
          },
        });
      } catch {
      }
      iframe.__agyMcpRestorePromotion = cleanupPromotedIframeOnDestroy;
      const isNativeDomIframe = Boolean(win.HTMLIFrameElement && iframe instanceof win.HTMLIFrameElement);
      fallbackTimerDisp = disposableTimeout(win, triggerBlankLoadOnce, isNativeDomIframe ? 120 : 20);
      promotionStore.add(fallbackTimerDisp);
      return {
        promoted: true,
        get state() {
          return iframe.__agyRemotePromotionState || FRAME_PROMOTION_STATE.PROMOTING;
        },
        dispose: cleanupPromotedIframeOnDestroy,
      };
    }
    function createRemoteFramePromoterCoordinator(deps) {
      const { win, doc, hostConfig, remoteLease, onPromotedReady, version = '2.0.0' } = deps;
      const store = new DisposableStore();
      const activePromotions = new Map();
      function checkAndPromote() {
        if (store.isDisposed || !doc || typeof doc.querySelector !== 'function') return;
        let iframe = null;
        try {
          iframe = doc.querySelector('ga-remote-control iframe');
        } catch {
          return;
        }
        if (!iframe || activePromotions.has(iframe)) return;
        const handle = promoteCrossOriginRemoteIframe({
          win,
          doc,
          iframe,
          hostConfig,
          remoteLease,
          onReady: onPromotedReady,
          version,
        });
        if (handle.promoted || handle.state === FRAME_PROMOTION_STATE.PASSIVE_ATTACHED) {
          activePromotions.set(iframe, handle);
        }
      }
      function start() {
        if (store.isDisposed) return;
        checkAndPromote();
        const ObserverCtor =
          (win && typeof win.MutationObserver === 'function' ? win.MutationObserver : null) ||
          (typeof MutationObserver === 'function' ? MutationObserver : null);
        if (ObserverCtor && doc && (doc.body || doc.documentElement)) {
          const obs = new ObserverCtor(() => checkAndPromote());
          store.add(
            disposableObserver(obs, doc.body || doc.documentElement, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['src'],
            })
          );
        }
      }
      store.add({
        dispose() {
          for (const handle of activePromotions.values()) {
            handle.dispose();
          }
          activePromotions.clear();
        },
      });
      return {
        start,
        checkAndPromote,
        dispose: () => store.dispose(),
      };
    }
    module.exports = {
      FRAME_PROMOTION_STATE,
      inspectPromotionOwnership,
      promoteCrossOriginRemoteIframe,
      createRemoteFramePromoterCoordinator,
    };
  },
  "./index": function(module, exports, __require) {
    const require = (spec) => __require(".", spec);
    'use strict';
    const { DisposableStore } = require('./core/disposable');
    const { McpManagerService } = require('./core/mcp-manager-service');
    const { createModalController, MODAL_ID, EDIT_POPUP_ID, OAUTH_MODAL_ID } = require('./ui/modal-controller');
    const { ensureModalStyles, removeModalStyles, DEFAULT_STYLE_ID } = require('./ui/design-tokens-styles');
    const { isImeComposing } = require('./ui/dom-kit');
    const { disposableEvent } = require('./shared/dom-disposables');
    const { ANTIGRAVITY_BRAND_PROFILE, resolveHostAdapterConfig } = require('./adapters/antigravity/host-config');
    const { createReactFiberGateway } = require('./adapters/antigravity/react-fiber-gateway');
    const { acquireRemoteControlLease } = require('./adapters/antigravity/remote-control-lease');
    const { createRpcTransport } = require('./adapters/antigravity/rpc-transport');
    const { createAntigravityPortsAdapter } = require('./adapters/antigravity/antigravity-ports-adapter');
    const { createCompanionCoordinator } = require('./adapters/antigravity/companion-coordinator');
    const { createNativeDomIntegrator } = require('./adapters/antigravity/native-dom-integrator');
    const { createRemoteFramePromoterCoordinator } = require('./adapters/antigravity/remote-workbench/frame-promoter-fsm');
    const MCP_MANAGER_VERSION = '2.0.0';
    function createMcpManagerApp(options = {}) {
      const win = options.win;
      const doc = options.doc || win?.document || null;
      const appStore = new DisposableStore();
      const hostConfig = resolveHostAdapterConfig(options.hostConfig, win);
      const brandProfile = {
        ...ANTIGRAVITY_BRAND_PROFILE,
        ...(options.brandProfile || {}),
      };
      const fiberGateway = createReactFiberGateway({ win, doc });
      appStore.add(fiberGateway);
      let promoterCoordinator = null;
      let domIntegrator = null;
      const remoteLease = acquireRemoteControlLease({
        win,
        doc,
        onInstanceSeen() {
          promoterCoordinator?.checkAndPromote();
        },
      });
      appStore.add(remoteLease);
      const rpcTransport = createRpcTransport({
        win,
        doc,
        hostConfig,
        fiberGateway,
        remoteLease,
      });
      const antigravityPorts = createAntigravityPortsAdapter({
        win,
        doc,
        hostConfig,
        fiberGateway,
        remoteLease,
        rpcTransport,
      });
      appStore.add(antigravityPorts);
      const service = new McpManagerService({
        configRepo: options.portsOverride?.configRepo || antigravityPorts.configRepo,
        runtimePort: options.portsOverride?.runtimePort || antigravityPorts.runtimePort,
        oauthBroker: options.portsOverride?.oauthBroker || antigravityPorts.oauthBroker,
      });
      appStore.add(service);
      const hasCompanionUsingSharedStyles = () => Boolean(win && win.__agyMcpSharedStylesPinned);
      const modalController = createModalController({
        win,
        doc,
        service,
        brandProfile,
        ownsStyles: !hasCompanionUsingSharedStyles(),
      });
      appStore.add(modalController);
      if (options.enableRemotePromotion !== false) {
        promoterCoordinator = createRemoteFramePromoterCoordinator({
          win,
          doc,
          hostConfig,
          remoteLease,
          version: MCP_MANAGER_VERSION,
          onPromotedReady() {
            fiberGateway.resetCache();
            domIntegrator?.reconcileAll();
          },
        });
        appStore.add(promoterCoordinator);
        promoterCoordinator.start();
      }
      if (options.enableCompanionLoader !== false) {
        const companionCoordinator = createCompanionCoordinator({
          win,
          doc,
          hostConfig,
          rpcTransport,
        });
        appStore.add(companionCoordinator);
        companionCoordinator.start();
      }
      if (options.enableDomIntegration !== false) {
        domIntegrator = createNativeDomIntegrator({
          win,
          doc,
          hostConfig,
          modalController,
        });
        appStore.add(domIntegrator);
        domIntegrator.start();
      }
      if (win && typeof win.addEventListener === 'function') {
        appStore.add(
          disposableEvent(win, 'keydown', (event) => {
            if (!event || isImeComposing(event)) return;
            if (
              event.ctrlKey &&
              event.altKey &&
              !event.shiftKey &&
              !event.metaKey &&
              String(event.key || '').toLowerCase() === 'm'
            ) {
              event.preventDefault?.();
              if (modalController.isModalOpen()) {
                modalController.closeModal();
              } else {
                modalController.openModal();
              }
            }
          })
        );
      }
      let destroyed = false;
      const controller = {
        version: MCP_MANAGER_VERSION,
        service,
        modalController,
        openModal: (opts) => modalController.openModal(opts),
        closeModal: () => modalController.closeModal(),
        isModalOpen: () => modalController.isModalOpen(),
        openEditPopup: (opts) => modalController.openEditPopup(opts),
        closeEditPopup: () => modalController.closeEditPopup(),
        openOAuthConnectModal: (serverName, openerEl) =>
          modalController.openOAuthConnectModal(serverName, openerEl),
        closeOAuthConnectModal: () => modalController.closeOAuthConnectModal(),
        reconcileDom: () => domIntegrator?.reconcileAll(),
        isDestroyed: () => destroyed || appStore.isDisposed,
        destroy() {
          if (destroyed) return;
          destroyed = true;
          appStore.dispose();
          if (!hasCompanionUsingSharedStyles()) {
            removeModalStyles(doc, DEFAULT_STYLE_ID);
          }
          if (win) {
            if (win.agyMcpManager === controller) {
              delete win.agyMcpManager;
            }
            if (win.__agyMountMcpManager === mountMcpManager) {
              delete win.__agyMountMcpManager;
            }
            try {
              delete win.__agyTrustedTypesPolicy;
            } catch {
            }
          }
        },
      };
      return controller;
    }
    function mountMcpManager(win, options = {}) {
      if (!win || !win.document) return null;
      try {
        delete win.__agyTrustedTypesPolicy;
      } catch {
      }
      win.__agyMountMcpManager = mountMcpManager;
      const existing = win.agyMcpManager;
      if (existing && typeof existing === 'object') {
        const stillAlive = typeof existing.isDestroyed === 'function' ? !existing.isDestroyed() : true;
        if (stillAlive && existing.version === MCP_MANAGER_VERSION && !options.forceRemount) {
          existing.reconcileDom?.();
          return existing;
        }
        if (typeof existing.destroy === 'function') {
          existing.destroy();
        }
      }
      ensureModalStyles(win.document, DEFAULT_STYLE_ID);
      const instance = createMcpManagerApp({
        ...options,
        win,
        doc: win.document,
      });
      win.agyMcpManager = instance;
      return instance;
    }
    if (typeof window !== 'undefined' && window && window.document) {
      window.__agyMountMcpManager = mountMcpManager;
      if (!window.__AGY_MCP_DISABLE_AUTOMOUNT__) {
        mountMcpManager(window);
      }
    }
    module.exports = {
      MCP_MANAGER_VERSION,
      MODAL_ID,
      EDIT_POPUP_ID,
      OAUTH_MODAL_ID,
      createMcpManagerApp,
      mountMcpManager,
    };
  }
  };
  const __cache = {};
  function __resolve(baseDir, spec) {
    const cleanSpec = spec.replace(/\.js$/, '');
    const parts = (baseDir + '/' + cleanSpec).split('/');
    const out = [];
    for (const p of parts) {
      if (!p || p === '.') continue;
      if (p === '..') out.pop();
      else out.push(p);
    }
    return './' + out.join('/');
  }
  function __require(baseDir, spec) {
    const id = __resolve(baseDir, spec);
    if (__cache[id]) return __cache[id].exports;
    const fn = __modules[id];
    if (!fn) throw new Error('Module not found: ' + id);
    const module = { exports: {} };
    __cache[id] = module;
    fn(module, module.exports, __require);
    return module.exports;
  }
  __require('.', './index');
})();
