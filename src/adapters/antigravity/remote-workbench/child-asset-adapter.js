'use strict';

/**
 * Promoted Remote Workbench Child History & Dynamic CDN Asset Adapter.
 *
 * Rewrites relative / host-origin workbench asset URLs to the validated CDN path prefix
 * (`resolveCdnAssetUrl`) and attaches host CSP `nonce` + `TrustedScriptURL` to `<script>` sinks.
 */

const { resolveCdnAssetUrl } = require('../../../core/security/url-policy');
const { isNativeTrustedScriptURL } = require('../../../security/trusted-types');

/**
 * Resolves a relative, root-relative, or host-origin workbench asset URL to `cdnBaseUrl`
 * while enforcing parameterized `cdnPathPrefix` and traversal checks (`MCP-TC-040`).
 *
 * @param {string} rawValue
 * @param {string} cdnBaseUrl
 * @param {string} hostOrigin
 * @param {string} cdnPathPrefix
 * @returns {string | null}
 */
function resolveWorkbenchAssetUrl(rawValue, cdnBaseUrl, hostOrigin, cdnPathPrefix = '/web/') {
  return resolveCdnAssetUrl(rawValue, {
    cdnBaseUrl,
    hostOrigin,
    allowedPathPrefix: cdnPathPrefix || '/web/',
  });
}

/**
 * Installs `history.pushState` / `history.replaceState` virtual URL normalization on `cw`.
 *
 * @param {any} cw
 * @param {string} canonicalOriginUrl
 */
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
          // Keep original urlArg
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
      // Ignore readonly history implementations
    }
  }
}

/**
 * Installs dynamic `<script>`, `<link>`, `<img>`, `<source>`, and `Worker` asset adapters on `cw`/`cd`.
 *
 * @param {{
 *   cw: any,
 *   cd: any,
 *   nonce: string,
 *   cdnBaseUrl: string,
 *   hostOrigin: string,
 *   hostConfig: any,
 *   ttPolicyCtrl: any,
 *   installWorkerConstructorAdapter?: (origCreateEl: Function) => void
 * }} params
 */
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
              // Ignore
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
              // Ignore
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
              // Ignore
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
      // Ignore readonly Element.prototype in synthetic DOMs
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
        // Ignore
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
          // Ignore non-configurable synthetic properties
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
