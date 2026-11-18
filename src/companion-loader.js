'use strict';

/**
 * Strict CSP / TrustedTypes Companion Script Loader (`antigravity-mcp-manager`).
 *
 * Enforces:
 * - Plugin-scoped policy names (`agy-mcp-manager*`, `agy-companion-*` only; `createHTML === undefined`).
 * - HTTPS + path allowlist for external script URLs (including CDN chunks/workers) and one-shot token revocation.
 * - Cryptographic CSP nonce propagation across IDL `.nonce` and `nonce` attribute.
 * - Cross-plugin `<script data-agy-companion="...">` duplicate guard and retry-aware host discovery.
 */

const { resolveHostAdapterConfig } = require('./host-adapter-config');

const OFFICIAL_COMPANION_URLS = Object.freeze([
  'https://raw.githubusercontent.com/jaeseongs95/antigravity-statusbar/main/dist/statusbar_autoinject.js',
  'https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js',
  'https://raw.githubusercontent.com/jaeseongs95/antigravity-ko-translator/main/plugins/ko-thought-translator/scripts/ko_thought_autoinject.js',
]);

const strictPolicyControllers = typeof WeakMap === 'function' ? new WeakMap() : null;

function isAllowedMcpScriptUrl(rawUrl, resolvedHostCfg) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname.includes('..')) {
    return false;
  }
  const candidateUrls = [
    ...OFFICIAL_COMPANION_URLS,
    ...Object.values(resolvedHostCfg?.companionScripts || {}),
  ];
  for (const cand of candidateUrls) {
    if (!cand) continue;
    try {
      const cu = new URL(String(cand));
      if (cu.protocol === 'https:' && parsed.origin === cu.origin && parsed.pathname === cu.pathname) {
        return true;
      }
    } catch {}
  }
  if (/\.(?:m|c)?js$/i.test(parsed.pathname) && /\/web\/[^/]+\//.test(parsed.pathname)) {
    const cdnBase = String(resolvedHostCfg?.cdnOrigin || 'https://www.gstatic.com/antigravity').replace(/\/+$/, '');
    try {
      const cdnUrl = new URL(cdnBase);
      if (
        cdnUrl.protocol === 'https:' &&
        parsed.origin === cdnUrl.origin &&
        (cdnUrl.pathname === '/' || parsed.pathname.startsWith(`${cdnUrl.pathname}/`))
      ) {
        return true;
      }
    } catch {}
    for (const staticOrig of resolvedHostCfg?.staticCdnOrigins || []) {
      try {
        const su = new URL(String(staticOrig));
        if (su.protocol === 'https:' && parsed.origin === su.origin) {
          return true;
        }
      } catch {}
    }
    if (resolvedHostCfg?.isRemoteHost?.(parsed.hostname)) {
      return true;
    }
  }
  return false;
}

function getOrCreateTrustedTypesPolicy(win, resolvedHostCfg) {
  if (!win || typeof win !== 'object') return null;
  if (strictPolicyControllers && strictPolicyControllers.has(win)) {
    const existing = strictPolicyControllers.get(win);
    existing.updateHostConfig(resolvedHostCfg);
    return existing;
  }
  let latestHostCfg = resolvedHostCfg || resolveHostAdapterConfig(null, win);
  const allowedInlineScripts = new Set();
  const allowedBlobUrls = new Set();
  const ttSupported = Boolean(win.trustedTypes && typeof win.trustedTypes.createPolicy === 'function');
  let policy = null;
  if (ttSupported) {
    for (const pName of ['agy-mcp-manager', 'agy-mcp-companion', 'agy-companion-' + Date.now()]) {
      try {
        const created = win.trustedTypes.createPolicy(pName, {
          createScript: (x) => {
            const code = String(x ?? '');
            if (allowedInlineScripts.has(code)) return code;
            throw new TypeError('Untrusted inline script rejected by TrustedTypes policy');
          },
          createScriptURL: (x) => {
            const raw = String(x ?? '');
            if (raw.startsWith('blob:')) {
              if (allowedBlobUrls.has(raw)) return raw;
              throw new TypeError('Untrusted blob script URL rejected by TrustedTypes policy');
            }
            if (isAllowedMcpScriptUrl(raw, latestHostCfg)) {
              return raw;
            }
            throw new TypeError('Untrusted script URL rejected by TrustedTypes policy');
          },
        });
        if (created) {
          policy = created;
          break;
        }
      } catch {}
    }
  }
  const ctrl = {
    hasNativePolicy: Boolean(policy),
    updateHostConfig(nextCfg) {
      if (nextCfg) latestHostCfg = nextCfg;
    },
    allowInline(code) {
      allowedInlineScripts.add(String(code ?? ''));
    },
    revokeInline(code) {
      allowedInlineScripts.delete(String(code ?? ''));
    },
    allowBlob(blobUrl) {
      allowedBlobUrls.add(String(blobUrl ?? ''));
    },
    revokeBlob(blobUrl) {
      allowedBlobUrls.delete(String(blobUrl ?? ''));
    },
    toScript(code) {
      if (policy && typeof policy.createScript === 'function') {
        return policy.createScript(code);
      }
      if (ttSupported) {
        throw new TypeError('TrustedTypes policy creation blocked by CSP');
      }
      if (!allowedInlineScripts.has(String(code ?? ''))) {
        throw new TypeError('Untrusted inline script rejected');
      }
      return code;
    },
    toScriptURL(rawUrl) {
      if (policy && typeof policy.createScriptURL === 'function') {
        return policy.createScriptURL(rawUrl);
      }
      if (ttSupported) {
        throw new TypeError('TrustedTypes policy creation blocked by CSP');
      }
      const raw = String(rawUrl ?? '');
      if (raw.startsWith('blob:')) {
        if (allowedBlobUrls.has(raw)) return raw;
        throw new TypeError('Untrusted blob script URL rejected');
      }
      if (isAllowedMcpScriptUrl(raw, latestHostCfg)) {
        return raw;
      }
      throw new TypeError('Untrusted script URL rejected');
    },
  };
  if (policy && strictPolicyControllers) {
    strictPolicyControllers.set(win, ctrl);
  }
  return ctrl;
}

function disposeTrustedTypesPolicy(win) {
  if (win && strictPolicyControllers) {
    strictPolicyControllers.delete(win);
  }
}

function getScriptNonce(doc) {
  if (!doc) return '';
  const nonceEl = doc.querySelector?.('script[nonce]');
  if (nonceEl) {
    const n = nonceEl.nonce || nonceEl.getAttribute?.('nonce') || '';
    if (n) return n;
  }
  const scripts = doc.querySelectorAll?.('script') || [];
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    const n = s && (s.nonce || s.getAttribute?.('nonce') || '');
    if (n) return n;
  }
  return '';
}

function ensureRemoteCompanionScripts(win, doc, bridge, hostConfig, onUpdate) {
  try {
    let isChildFrame = false;
    try {
      isChildFrame = Boolean(win && win.parent && win.parent !== win);
    } catch {}
    if (isChildFrame) return Promise.resolve({ loaded: [] });

    const resolvedHostCfg = resolveHostAdapterConfig(hostConfig || bridge?.hostConfig, win);
    const isRemoteWeb =
      resolvedHostCfg.isRemoteHost(win?.location?.hostname) ||
      Boolean(doc?.querySelector?.('ga-remote-control'));
    if (!isRemoteWeb || !doc?.head) return Promise.resolve({ loaded: [] });

    const hasExistingCompanionTag = (companionId) => {
      try {
        if (!companionId || typeof doc.querySelector !== 'function') return false;
        const el = doc.querySelector(`script[data-agy-companion="${companionId}"]`);
        return Boolean(
          el &&
            String(el.tagName || '').toUpperCase() === 'SCRIPT' &&
            typeof el.getAttribute === 'function' &&
            el.getAttribute('data-agy-companion') === companionId
        );
      } catch {
        return false;
      }
    };

    const appendScriptSrcAsync = (rawUrl, policyCtrl, companionId, onDoneCleanup) =>
      new Promise((resolve) => {
        let s = null;
        try {
          s = doc.createElement('script');
          if (companionId) s.setAttribute?.('data-agy-companion', companionId);
          const nonce = getScriptNonce(doc);
          if (nonce) {
            s.nonce = nonce;
            s.setAttribute?.('nonce', nonce);
          }
          s.src = policyCtrl ? policyCtrl.toScriptURL(rawUrl) : rawUrl;
          if (typeof s.addEventListener !== 'function') {
            doc.head.appendChild(s);
            if (typeof onDoneCleanup === 'function') onDoneCleanup();
            resolve(true);
            return;
          }
          let settled = false;
          const setTimeoutFn =
            typeof win.setTimeout === 'function'
              ? win.setTimeout.bind(win)
              : (typeof setTimeout === 'function' ? setTimeout : null);
          const clearTimeoutFn =
            typeof win.clearTimeout === 'function'
              ? win.clearTimeout.bind(win)
              : (typeof clearTimeout === 'function' ? clearTimeout : null);
          let timer = null;
          const finish = (ok) => {
            if (settled) return;
            settled = true;
            if (!ok && s) {
              try {
                if (typeof s.remove === 'function') s.remove();
                else if (s.parentNode) s.parentNode.removeChild(s);
              } catch {}
            }
            if (timer && clearTimeoutFn) {
              try { clearTimeoutFn(timer); } catch {}
            }
            if (typeof onDoneCleanup === 'function') {
              try { onDoneCleanup(); } catch {}
            }
            resolve(ok);
          };
          s.addEventListener('load', () => finish(true), { once: true });
          s.addEventListener('error', () => finish(false), { once: true });
          if (setTimeoutFn) {
            timer = setTimeoutFn(() => finish(false), 4000);
            if (timer && typeof timer.unref === 'function') timer.unref();
          }
          doc.head.appendChild(s);
        } catch {
          if (s) {
            try {
              if (typeof s.remove === 'function') s.remove();
              else if (s.parentNode) s.parentNode.removeChild(s);
            } catch {}
          }
          if (typeof onDoneCleanup === 'function') {
            try { onDoneCleanup(); } catch {}
          }
          resolve(false);
        }
      });

    const injectCompanionCodeOrUrl = async (code, url, policyCtrl, companionId, checkLoaded) => {
      const isLoaded = typeof checkLoaded === 'function' ? checkLoaded : () => false;
      if (code && doc.head) {
        let inlineEl = null;
        try {
          inlineEl = doc.createElement('script');
          if (companionId) inlineEl.setAttribute?.('data-agy-companion', companionId);
          const nonce = getScriptNonce(doc);
          if (nonce) {
            inlineEl.nonce = nonce;
            inlineEl.setAttribute?.('nonce', nonce);
          }
          policyCtrl?.allowInline(code);
          try {
            inlineEl.text = policyCtrl ? policyCtrl.toScript(code) : code;
            doc.head.appendChild(inlineEl);
          } finally {
            policyCtrl?.revokeInline(code);
          }
          if (isLoaded() || typeof inlineEl.addEventListener !== 'function') {
            return true;
          }
          try {
            if (typeof inlineEl.remove === 'function') inlineEl.remove();
            else if (inlineEl.parentNode) inlineEl.parentNode.removeChild(inlineEl);
          } catch {}
        } catch {
          if (inlineEl) {
            try {
              if (typeof inlineEl.remove === 'function') inlineEl.remove();
              else if (inlineEl.parentNode) inlineEl.parentNode.removeChild(inlineEl);
            } catch {}
          }
        }

        try {
          const BlobCtor = win.Blob || (typeof Blob === 'function' ? Blob : null);
          const UrlApi = win.URL || (typeof URL !== 'undefined' ? URL : null);
          if (BlobCtor && UrlApi && typeof UrlApi.createObjectURL === 'function') {
            const blobUrl = UrlApi.createObjectURL(new BlobCtor([code], { type: 'text/javascript' }));
            policyCtrl?.allowBlob(blobUrl);
            const cleanupBlob = () => {
              policyCtrl?.revokeBlob(blobUrl);
              try {
                if (typeof UrlApi.revokeObjectURL === 'function') {
                  UrlApi.revokeObjectURL(blobUrl);
                }
              } catch {}
            };
            const blobOk = await appendScriptSrcAsync(blobUrl, policyCtrl, companionId, cleanupBlob);
            if (blobOk && (isLoaded() || typeof doc.createElement('script')?.addEventListener !== 'function')) {
              return true;
            }
          }
        } catch {}
      }

      if (url && doc.head) {
        const sep = url.includes('?') ? '&' : '?';
        const remoteUrl = `${url}${sep}t=${Date.now()}`;
        const remoteOk = await appendScriptSrcAsync(remoteUrl, policyCtrl, companionId, null);
        if (remoteOk) {
          return true;
        }
      }
      return false;
    };

    const setFlagGroup = (keys, val) => {
      for (const k of keys) {
        win[k] = val;
      }
    };

    const injectRemoteOrHostFallback = async (companionId, flagKeys, url, hostCodeFallback, checkLoaded) => {
      const keys = Array.isArray(flagKeys) ? flagKeys : [flagKeys];
      if (keys.some((k) => Boolean(win[k])) || hasExistingCompanionTag(companionId)) return false;
      setFlagGroup(keys, true);
      const policyCtrl = getOrCreateTrustedTypesPolicy(win, resolvedHostCfg);
      try {
        if (hostCodeFallback) {
          const ok = await injectCompanionCodeOrUrl(hostCodeFallback, url, policyCtrl, companionId, checkLoaded);
          if (!ok) setFlagGroup(keys, false);
          return ok;
        }
        if (typeof win.fetch === 'function' && url) {
          const sep = url.includes('?') ? '&' : '?';
          const r = await Promise.resolve(win.fetch(`${url}${sep}t=${Date.now()}`)).catch(() => null);
          const code = r && r.ok && typeof r.text === 'function' ? await r.text() : '';
          if (code) {
            const ok = await injectCompanionCodeOrUrl(code, url, policyCtrl, companionId, checkLoaded);
            if (!ok) setFlagGroup(keys, false);
            return ok;
          }
        }
        if (url) {
          const ok = await injectCompanionCodeOrUrl('', url, policyCtrl, companionId, checkLoaded);
          if (!ok) setFlagGroup(keys, false);
          return ok;
        }
      } catch {}
      setFlagGroup(keys, false);
      return false;
    };

    let attempts = 0;
    const tryLoadCompanions = async () => {
      attempts += 1;
      const info =
        bridge && typeof bridge.fetchHostInstalledPluginInfo === 'function'
          ? await bridge.fetchHostInstalledPluginInfo()
          : (win.__agyHostInstalledPlugins && typeof win.__agyHostInstalledPlugins === 'object'
              ? { resolved: true, ...win.__agyHostInstalledPlugins }
              : null);
      const loaded = [];
      if (!info || info.resolved === false) {
        if (attempts < 5) {
          const setTimeoutFn = typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : (typeof setTimeout === 'function' ? setTimeout : null);
          if (setTimeoutFn) {
            const t = setTimeoutFn(
              () =>
                Promise.resolve(tryLoadCompanions()).then(
                  (retryRes) => {
                    if (typeof onUpdate === 'function') onUpdate(retryRes, attempts >= 5);
                    return retryRes;
                  },
                  () => ({ loaded: [], hostInfo: null })
                ),
              1500
            );
            if (t && typeof t.unref === 'function') t.unref();
          }
          return { loaded, hostInfo: info };
        }
        if (!info) return { loaded, hostInfo: null };
      }

      if (info.hasStatusbar && !win.agyStatusBar && !win.__agyKoFetchingStatusBar) {
        const ok = await injectRemoteOrHostFallback(
          'statusbar',
          ['__agyLoadingStatusBarCompanion'],
          resolvedHostCfg.companionScripts.statusbarUrl,
          info.statusbarBlock || info.statusbarCode || '',
          () => Boolean(win.agyStatusBar)
        );
        if (ok) loaded.push('antigravity-statusbar');
      }
      if (info.hasKoTranslator && !win.__agyKoLocalizerActive && !win.__agyKoThoughtCleanup) {
        const ok = await injectRemoteOrHostFallback(
          'ko-thought-translator',
          ['__agyLoadingKoThoughtCompanion', '__agyLoadingKoTranslatorCompanion'],
          resolvedHostCfg.companionScripts.koTranslatorUrl,
          info.koBlock || info.koTranslatorCode || '',
          () => Boolean(win.__agyKoLocalizerActive || win.__agyKoThoughtCleanup)
        );
        if (ok) loaded.push('ko-thought-translator');
      }
      return { loaded, hostInfo: info };
    };

    return tryLoadCompanions().catch(() => ({ loaded: [] }));
  } catch {
    return Promise.resolve({ loaded: [] });
  }
}

module.exports = {
  OFFICIAL_COMPANION_URLS,
  isAllowedMcpScriptUrl,
  getOrCreateTrustedTypesPolicy,
  disposeTrustedTypesPolicy,
  getScriptNonce,
  ensureRemoteCompanionScripts,
};
