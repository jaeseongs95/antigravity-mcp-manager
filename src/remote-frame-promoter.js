'use strict';

/**
 * Finite State Machine for Remote Control Cross-Origin Frame Adaptation (`antigravity-mcp-manager`).
 *
 * State transitions:
 *   idle -> preflight -> promoting -> ready | passive_attached | rolled_back
 */

const { resolveHostAdapterConfig } = require('./host-adapter-config');
const { acquireRemoteRuntimeLease } = require('./remote-runtime');
const {
  isAllowedMcpScriptUrl,
  getOrCreateTrustedTypesPolicy,
  getScriptNonce,
} = require('./companion-loader');

const FRAME_PROMOTION_STATE = Object.freeze({
  IDLE: 'idle',
  PREFLIGHT: 'preflight',
  PROMOTING: 'promoting',
  READY: 'ready',
  PASSIVE_ATTACHED: 'passive_attached',
  ROLLED_BACK: 'rolled_back',
});

function canAcquirePromotionOwnership(iframe, version) {
  if (!iframe) return false;
  if (
    iframe.__agyMcpPromoted === version ||
    iframe.__agyMcpPromotionFailed ||
    iframe.__agyKoPromoted ||
    iframe.__agyPromoted
  ) {
    return false;
  }
  if (
    iframe.__agyRemotePromotionOwner &&
    iframe.__agyRemotePromotionOwner !== 'mcp-manager' &&
    iframe.__agyRemotePromotionState !== FRAME_PROMOTION_STATE.ROLLED_BACK
  ) {
    return false;
  }
  return true;
}

function resolveRelativeToCdnUrl(rawValue, cdnBaseUrl, hostOrigin) {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  const cleanCdnBase = String(cdnBaseUrl || '').replace(/\/+$/, '');
  if (!cleanCdnBase) return null;
  const cdnRoot = cleanCdnBase.replace(/\/web\/[^/]+$/, '');

  if (/^(?:blob:|data:|javascript:|mailto:|tel:|about:)/i.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    if (hostOrigin) {
      try {
        const parsed = new URL(trimmed);
        const hOrig = new URL(String(hostOrigin)).origin;
        if (parsed.origin === hOrig && /^\/web\/[^/]+\//.test(parsed.pathname) && !parsed.pathname.includes('..')) {
          return `${cdnRoot}${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
      } catch {}
    }
    return null;
  }
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('?') || trimmed.includes('..')) {
    return null;
  }
  if (trimmed.startsWith('/web/')) {
    return `${cdnRoot}${trimmed}`;
  }
  if (trimmed.startsWith('/')) {
    return `${cleanCdnBase}${trimmed}`;
  }
  if (trimmed.startsWith('./')) {
    return `${cleanCdnBase}/${trimmed.slice(2)}`;
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return `${cleanCdnBase}/${trimmed}`;
  }
  return null;
}

function installChildHistoryAdapter(cw, originUrl) {
  if (!cw || !cw.history) return;
  for (const methodName of ['replaceState', 'pushState']) {
    const origFn = cw.history[methodName];
    if (typeof origFn !== 'function' || origFn.__agyHistoryAdapted) continue;
    const adapted = function (state, unused, urlArg) {
      let nextUrl = urlArg;
      if (typeof urlArg === 'string' && urlArg.trim()) {
        try {
          const parsed = new URL(urlArg, originUrl);
          if (parsed.origin === new URL(originUrl).origin) {
            nextUrl = `${parsed.pathname}${parsed.search}${parsed.hash}`;
          }
        } catch {}
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
    } catch {}
  }
}

function installChildAssetAdapter(cw, cd, nonce, cdnBaseUrl, hostOrigin, resolvedHostCfg, ttPolicyCtrl) {
  if (!cd || typeof cd.createElement !== 'function' || cd.__agyAssetAdapted) return;
  cd.__agyAssetAdapted = true;

  const rewriteAssetUrl = (raw) => resolveRelativeToCdnUrl(String(raw ?? ''), cdnBaseUrl, hostOrigin) || String(raw ?? '');
  const toSafeScriptUrl = (raw) => {
    const mapped = rewriteAssetUrl(raw);
    if (!ttPolicyCtrl) return mapped;
    try {
      return ttPolicyCtrl.toScriptURL(mapped);
    } catch {
      return mapped;
    }
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
            } catch {}
          }
          if (val && typeof val === 'object') {
            desc.set.call(this, val);
            return;
          }
          const nextVal = isScriptProp ? toSafeScriptUrl(val) : rewriteAssetUrl(val);
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

  if (cw?.Element?.prototype && typeof cw.Element.prototype.setAttribute === 'function' && !cw.Element.prototype.__agySetAttrAdapted) {
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
            } catch {}
          }
          if (value && typeof value === 'object') {
            return origElemSetAttr.call(this, name, value);
          }
          const safeVal = toSafeScriptUrl(value);
          if (scriptSrcDesc && typeof scriptSrcDesc.set === 'function') {
            scriptSrcDesc.set.call(this, safeVal);
            return undefined;
          }
          return origElemSetAttr.call(this, name, safeVal);
        }
        if (attrLower === 'src' && (tagUpper === 'IMG' || tagUpper === 'SOURCE' || tagUpper === 'AUDIO' || tagUpper === 'VIDEO')) {
          return origElemSetAttr.call(this, name, value && typeof value === 'object' ? value : rewriteAssetUrl(value));
        }
        if (attrLower === 'href' && tagUpper === 'LINK') {
          if (nonce) {
            try {
              this.nonce = nonce;
              origElemSetAttr.call(this, 'nonce', nonce);
            } catch {}
          }
          return origElemSetAttr.call(this, name, value && typeof value === 'object' ? value : rewriteAssetUrl(value));
        }
        return origElemSetAttr.call(this, name, value);
      };
      Object.defineProperty(cw.Element.prototype, '__agySetAttrAdapted', {
        value: true,
        configurable: true,
      });
    } catch {}
  }

  if (cw && typeof cw.Worker === 'function' && !cw.Worker.__agyWorkerAdapted) {
    const OrigWorker = cw.Worker;
    const AdaptedWorker = function (scriptURL, options) {
      if (scriptURL && typeof scriptURL === 'object') {
        return options !== undefined ? new OrigWorker(scriptURL, options) : new OrigWorker(scriptURL);
      }
      const rawStr = String(scriptURL ?? '').trim();
      if (rawStr.startsWith('blob:')) {
        if (hostOrigin && !rawStr.startsWith(`blob:${hostOrigin}/`)) {
          throw new TypeError('Cross-origin blob Worker URL rejected');
        }
        let safeBlob = scriptURL;
        if (ttPolicyCtrl) {
          ttPolicyCtrl.allowBlob(rawStr);
          safeBlob = ttPolicyCtrl.toScriptURL(rawStr);
        }
        return options !== undefined ? new OrigWorker(safeBlob, options) : new OrigWorker(safeBlob);
      }
      const resolvedUrl = resolveRelativeToCdnUrl(rawStr, cdnBaseUrl, hostOrigin) || rawStr;
      if (!isAllowedMcpScriptUrl(resolvedUrl, resolvedHostCfg)) {
        throw new TypeError('Untrusted Worker script URL rejected');
      }
      const BlobCtor = cw.Blob || (typeof Blob === 'function' ? Blob : null);
      const UrlApi = cw.URL || (typeof URL !== 'undefined' ? URL : null);
      if (BlobCtor && UrlApi && typeof UrlApi.createObjectURL === 'function') {
        const bootCode =
          options && options.type === 'module'
            ? `import ${JSON.stringify(resolvedUrl)};\n`
            : `importScripts(${JSON.stringify(resolvedUrl)});\n`;
        const blobUrl = UrlApi.createObjectURL(new BlobCtor([bootCode], { type: 'text/javascript' }));
        ttPolicyCtrl?.allowBlob(blobUrl);
        const safeBlobUrl = ttPolicyCtrl ? ttPolicyCtrl.toScriptURL(blobUrl) : blobUrl;
        let worker;
        try {
          worker = options !== undefined ? new OrigWorker(safeBlobUrl, options) : new OrigWorker(safeBlobUrl);
        } catch (err) {
          ttPolicyCtrl?.revokeBlob(blobUrl);
          try { UrlApi.revokeObjectURL?.(blobUrl); } catch {}
          throw err;
        }
        const setTimer = typeof cw.setTimeout === 'function' ? cw.setTimeout.bind(cw) : (typeof setTimeout === 'function' ? setTimeout : null);
        if (setTimer) {
          const t = setTimer(() => {
            ttPolicyCtrl?.revokeBlob(blobUrl);
            try { UrlApi.revokeObjectURL?.(blobUrl); } catch {}
          }, 5000);
          if (t && typeof t.unref === 'function') t.unref();
        }
        return worker;
      }
      const safeDirect = ttPolicyCtrl ? ttPolicyCtrl.toScriptURL(resolvedUrl) : resolvedUrl;
      return options !== undefined ? new OrigWorker(safeDirect, options) : new OrigWorker(safeDirect);
    };
    AdaptedWorker.prototype = OrigWorker.prototype;
    try {
      Object.setPrototypeOf(AdaptedWorker, OrigWorker);
    } catch {}
    AdaptedWorker.__agyWorkerAdapted = true;
    try {
      cw.Worker = AdaptedWorker;
    } catch {}
  }

  const origCreateEl = cd.createElement.bind(cd);
  cd.createElement = function (tagName, options) {
    const el = options !== undefined ? origCreateEl(tagName, options) : origCreateEl(tagName);
    const lower = String(tagName || '').toLowerCase();
    if (el && nonce && (lower === 'script' || lower === 'style' || lower === 'link')) {
      try {
        el.nonce = nonce;
        el.setAttribute?.('nonce', nonce);
      } catch {}
    }
    const isNativeElem = Boolean(cw?.Element && el instanceof cw.Element);
    if (el && !isNativeElem) {
      if (typeof el.setAttribute === 'function' && !el.__agySyntheticSetAttrAdapted) {
        const origElSetAttr = el.setAttribute.bind(el);
        el.setAttribute = function (name, val) {
          const attrL = String(name || '').toLowerCase();
          if (attrL === 'src' && lower === 'script') {
            if (nonce) origElSetAttr('nonce', nonce);
            const safeVal = val && typeof val === 'object' ? val : toSafeScriptUrl(val);
            el.src = safeVal;
            return origElSetAttr(name, safeVal);
          }
          if (attrL === 'src' && (lower === 'img' || lower === 'source' || lower === 'audio' || lower === 'video')) {
            const mapped = val && typeof val === 'object' ? val : rewriteAssetUrl(val);
            el.src = mapped;
            return origElSetAttr(name, mapped);
          }
          if (attrL === 'href' && lower === 'link') {
            if (nonce) origElSetAttr('nonce', nonce);
            const mapped = val && typeof val === 'object' ? val : rewriteAssetUrl(val);
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
              if (val && typeof val === 'object') {
                innerVal = val;
                return;
              }
              innerVal = lower === 'script' ? toSafeScriptUrl(val) : rewriteAssetUrl(val);
            },
          });
        } catch {}
      }
    }
    return el;
  };
}

function promoteCrossOriginRemoteIframe(win, doc, iframe, bridge, onReady, version = 'v1.5.0') {
  if (!win || !doc || !iframe) return false;
  if (!canAcquirePromotionOwnership(iframe, version)) {
    if (iframe.__agyKoPromoted || iframe.__agyPromoted) {
      iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.PASSIVE_ATTACHED;
    }
    return false;
  }

  const rcInst =
    (bridge && typeof bridge.resolveRemoteControlInstance === 'function'
      ? bridge.resolveRemoteControlInstance(win)
      : null) ||
    win.__agyRemoteControlInstance ||
    null;
  if (!rcInst) return false;

  const rawCandidate =
    iframe.getAttribute?.('src') ||
    iframe.src ||
    (typeof rcInst.iframeSrc === 'function' ? String(rcInst.iframeSrc() || '') : '') ||
    '';
  const rawSrc = String(rawCandidate).match(/https?:\/\/[^\s"'<>)+]+/)?.[0] || String(rawCandidate);
  if (!rawSrc) return false;

  let parsedUrl;
  try {
    parsedUrl = new URL(rawSrc, win.location?.href || 'https://antigravity.google.com');
  } catch {
    return false;
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    return false;
  }
  if (parsedUrl.searchParams.get('iframe') !== 'true') {
    return false;
  }

  const resolvedHostCfg = resolveHostAdapterConfig(bridge?.hostConfig, win);
  const trustedStaticHosts = new Set();
  for (const staticOrig of resolvedHostCfg.staticCdnOrigins || []) {
    try {
      const su = new URL(String(staticOrig));
      if (su.protocol === 'https:') {
        trustedStaticHosts.add(su.hostname.toLowerCase());
      }
    } catch {}
  }
  const candidateHost = parsedUrl.hostname.toLowerCase();
  if (!trustedStaticHosts.has(candidateHost) && !resolvedHostCfg.isRemoteHost(candidateHost)) {
    return false;
  }

  const basePath = parsedUrl.pathname.replace(/^\/antigravity/, '').replace(/\/+$/, '');
  if (basePath.includes('..') || /["'<>\\\s]/.test(basePath)) {
    return false;
  }
  const verMatch = basePath.match(/\/web\/([^/]+)/);
  const appVersion = verMatch ? verMatch[1] : '2.33.0';
  const cdnOrigin = String(resolvedHostCfg.cdnOrigin || 'https://www.gstatic.com/antigravity').replace(/\/+$/, '');
  const cdnBaseUrl = `${cdnOrigin}${basePath}`;

  iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.PREFLIGHT;
  const ttPolicyCtrl = getOrCreateTrustedTypesPolicy(win, resolvedHostCfg);
  const prismUrl = `${cdnBaseUrl}/prism_bundle.js`;
  const mainUrl = `${cdnBaseUrl}/main.js`;
  let trustedPrismUrl = prismUrl;
  let trustedMainUrl = mainUrl;
  try {
    trustedPrismUrl = ttPolicyCtrl ? ttPolicyCtrl.toScriptURL(prismUrl) : prismUrl;
    trustedMainUrl = ttPolicyCtrl ? ttPolicyCtrl.toScriptURL(mainUrl) : mainUrl;
    const probeScript = doc.createElement?.('script');
    if (probeScript) {
      probeScript.src = trustedMainUrl;
    }
  } catch {
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.IDLE;
    return false;
  }

  iframe.__agyRemotePromotionOwner = 'mcp-manager';
  iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.PROMOTING;
  iframe.__agyMcpPromoted = version;

  const savedChildPath = String(
    new URLSearchParams(win.location?.search || '').get('p') ||
      rcInst.lastSyncedChildPath ||
      rcInst.initialChildPath ||
      ''
  ).replace(/^\/+/, '');
  if (savedChildPath) {
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

  const IframeCtor = win?.HTMLIFrameElement || (typeof HTMLIFrameElement !== 'undefined' ? HTMLIFrameElement : null);
  const origSrcDesc =
    IframeCtor && iframe instanceof IframeCtor && IframeCtor.prototype
      ? Object.getOwnPropertyDescriptor(IframeCtor.prototype, 'src')
      : null;
  const hostOrigin = win.location?.origin || 'https://antigravity.google.com';
  const canonicalFrameUrl = `${hostOrigin}${basePath}/${parsedUrl.search || '?iframe=true'}`;

  const ownsRuntimeLease = !(bridge && bridge.runtimeLease && typeof bridge.runtimeLease.tapTarget === 'function');
  const activeLease = ownsRuntimeLease
    ? acquireRemoteRuntimeLease({ hostConfig: resolvedHostCfg, defaultWin: win })
    : bridge.runtimeLease;
  activeLease.tapTarget(win, rcInst);

  rcInst.__agySuppressAutoIframeLoadCount = (rcInst.__agySuppressAutoIframeLoadCount || 0) + 1;
  rcInst.__agySuppressAutoIframeLoad = true;
  let suppressionActiveForToken = true;
  let leaseReleasedForToken = false;

  let childWindowRef = null;
  let hadOwnChildDec = false;
  let prevChildDec = undefined;
  let wrappedChildDec = null;
  let capturedLsByThisPromotion = null;

  const endSuppressionForThisPromotion = () => {
    if (!suppressionActiveForToken) return;
    suppressionActiveForToken = false;
    const nextCount = Math.max(0, (rcInst.__agySuppressAutoIframeLoadCount || 1) - 1);
    if (nextCount === 0) {
      delete rcInst.__agySuppressAutoIframeLoadCount;
      rcInst.__agySuppressAutoIframeLoad = false;
    } else {
      rcInst.__agySuppressAutoIframeLoadCount = nextCount;
      rcInst.__agySuppressAutoIframeLoad = true;
    }
  };

  const releaseRcHooks = () => {
    try {
      endSuppressionForThisPromotion();
      if (!(rcInst.__agySuppressAutoIframeLoadCount > 0) && rcInst.__agySuppressAutoIframeLoad === false) {
        delete rcInst.__agySuppressAutoIframeLoad;
      }
      if (ownsRuntimeLease && !leaseReleasedForToken) {
        leaseReleasedForToken = true;
        activeLease.release();
      }
    } catch {}
  };

  let rolledBack = false;
  let fallbackTimer = null;
  const clearFallbackTimer = () => {
    if (!fallbackTimer) return;
    const clr = typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
    try { clr(fallbackTimer); } catch {}
    fallbackTimer = null;
  };

  const rollbackToOriginalSrc = () => {
    if (rolledBack) return;
    rolledBack = true;
    clearFallbackTimer();
    releaseRcHooks();
    try {
      if (typeof iframe.removeEventListener === 'function') {
        iframe.removeEventListener('load', triggerBlankLoadOnce);
      }
    } catch {}
    try {
      delete iframe.src;
    } catch {}
    delete iframe.__agyMcpPromoted;
    delete iframe.__agyMcpRestorePromotion;
    if (iframe.__agyRemotePromotionOwner === 'mcp-manager') {
      delete iframe.__agyRemotePromotionOwner;
    }
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.ROLLED_BACK;
    iframe.__agyMcpPromotionFailed = true;
    try {
      if (origSrcDesc && typeof origSrcDesc.set === 'function') {
        origSrcDesc.set.call(iframe, rawSrc);
      } else {
        iframe.setAttribute?.('src', rawSrc);
        iframe.src = rawSrc;
      }
    } catch {
      try {
        iframe.setAttribute?.('src', rawSrc);
        iframe.src = rawSrc;
      } catch {}
    }
  };

  let readyNotified = false;
  const notifyReadyOnce = () => {
    if (readyNotified) return;
    readyNotified = true;
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.READY;
    if (typeof onReady === 'function') onReady();
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

      // WHATWG HTML §8.4 zero-argument Document.open/close promotes child URL from about:blank
      // to parent https:// origin URL without invoking any TrustedHTML sink (zero cd.write calls).
      if (typeof cd.open === 'function' && typeof cd.close === 'function') {
        try {
          cd.open();
          cd.close();
        } catch {}
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
      installChildAssetAdapter(cw, cd, nonce, cdnBaseUrl, hostOrigin, resolvedHostCfg, ttPolicyCtrl);

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

      try {
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
      } catch {}

      try {
        cw.history?.replaceState?.(null, '', buildInitialIframeHistoryUrl());
      } catch {}
      try {
        Object.defineProperty(cd, 'referrer', {
          configurable: true,
          get: () => win.location?.href || '',
        });
      } catch {}

      cw.__APP_CONFIG__ = {
        productName: 'antigravity',
        csrfToken: String(win?.__APP_CONFIG__?.csrfToken || rcInst?.csrfToken || resolvedHostCfg.remoteCsrfToken || ''),
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

      const msgListeners = new Set();
      try {
        if (typeof cw.addEventListener === 'function' && !cw.__agyMsgBufferInstalled) {
          cw.__agyMsgBufferInstalled = true;
          const origAddEv = cw.addEventListener.bind(cw);
          const origRemoveEv = typeof cw.removeEventListener === 'function' ? cw.removeEventListener.bind(cw) : null;
          origAddEv('message', (ev) => {
            if (ev && ev.data && ev.data.type === 'INITIAL_CONFIG') {
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
                  try {
                    listener.call(cw, bufferedEv);
                  } catch {}
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
      } catch {}

      const prismScript = cd.createElement('script');
      if (nonce) {
        prismScript.nonce = nonce;
        prismScript.setAttribute?.('nonce', nonce);
      }
      prismScript.async = false;
      prismScript.src = trustedPrismUrl;

      const mainScript = cd.createElement('script');
      if (nonce) {
        mainScript.nonce = nonce;
        mainScript.setAttribute?.('nonce', nonce);
      }
      mainScript.async = false;
      mainScript.src = trustedMainUrl;

      const markPromotedReady = () => {
        try {
          if (typeof rcInst.markIframeReady === 'function') {
            rcInst.markIframeReady();
          } else {
            rcInst.iframeLoading?.set?.(false);
            rcInst.iframeUiReady?.set?.(true);
          }
        } catch {}
        notifyReadyOnce();
      };

      mainScript.onload = () => {
        endSuppressionForThisPromotion();
        cw.__agyMainBooted = true;
        if (savedChildPath) rcInst.initialChildPath = savedChildPath;
        let loadRet = null;
        if (!cw.__initialConfigReceived && !cw.__agyOnIframeLoadCalled) {
          cw.__agyOnIframeLoadCalled = true;
          try {
            loadRet = activeLease.invokeOriginalOnIframeLoad(rcInst);
          } catch {}
        }
        if (loadRet && typeof loadRet.then === 'function') {
          loadRet.then(markPromotedReady, markPromotedReady);
        } else {
          markPromotedReady();
        }
      };
      mainScript.onerror = () => {
        rollbackToOriginalSrc();
      };

      if (headEl && typeof headEl.appendChild === 'function') {
        headEl.appendChild(prismScript);
        headEl.appendChild(mainScript);
      } else {
        rollbackToOriginalSrc();
      }
    } catch {
      rollbackToOriginalSrc();
    }
  };

  try {
    delete iframe.src;
  } catch {}
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
    clearFallbackTimer();
    onBlankLoad();
  };
  if (typeof iframe.addEventListener === 'function') {
    iframe.addEventListener('load', triggerBlankLoadOnce, { once: true });
  }
  try {
    if (origSrcDesc && typeof origSrcDesc.set === 'function') {
      origSrcDesc.set.call(iframe, 'about:blank');
    } else {
      iframe.setAttribute?.('src', 'about:blank');
      iframe.src = 'about:blank';
    }
  } catch {
    releaseRcHooks();
    delete iframe.__agyMcpPromoted;
    if (iframe.__agyRemotePromotionOwner === 'mcp-manager') {
      delete iframe.__agyRemotePromotionOwner;
    }
    iframe.__agyRemotePromotionState = FRAME_PROMOTION_STATE.IDLE;
    return false;
  }
  const cleanupPromotedIframeState = () => {
    clearFallbackTimer();
    releaseRcHooks();
    try {
      let targetCw = childWindowRef;
      if (!targetCw) {
        try {
          targetCw = iframe.contentWindow;
        } catch {}
      }
      if (targetCw) {
        if (wrappedChildDec && targetCw.__JETSKI_LS_CLIENT_DECORATOR__ === wrappedChildDec) {
          if (hadOwnChildDec) targetCw.__JETSKI_LS_CLIENT_DECORATOR__ = prevChildDec;
          else delete targetCw.__JETSKI_LS_CLIENT_DECORATOR__;
        }
        delete targetCw.__agyCapturedLsClient;
      }
      if (capturedLsByThisPromotion && win.__agyCapturedLsClient === capturedLsByThisPromotion && !win.agyStatusBar) {
        delete win.__agyCapturedLsClient;
      }
    } catch {}
    try {
      if (typeof iframe.removeEventListener === 'function') {
        iframe.removeEventListener('load', triggerBlankLoadOnce);
      }
    } catch {}
    try {
      delete iframe.src;
    } catch {}
    if (iframe.__agyRemotePromotionOwner === 'mcp-manager') {
      delete iframe.__agyRemotePromotionOwner;
    }
    delete iframe.__agyRemotePromotionState;
    delete iframe.__agyMcpPromoted;
    delete iframe.__agyMcpPromotionFailed;
    delete iframe.__agyMcpRestorePromotion;
  };

  try {
    Object.defineProperty(iframe, 'src', {
      configurable: true,
      enumerable: true,
      get: () => canonicalFrameUrl,
      set: (v) => {
        rolledBack = true;
        cleanupPromotedIframeState();
        if (origSrcDesc && typeof origSrcDesc.set === 'function') {
          origSrcDesc.set.call(iframe, v);
        } else {
          iframe.setAttribute?.('src', v);
          iframe.src = v;
        }
      },
    });
  } catch {}

  iframe.__agyMcpRestorePromotion = cleanupPromotedIframeState;

  const setTimer = typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : (typeof setTimeout === 'function' ? setTimeout : null);
  const isNativeDomIframe = Boolean(win.HTMLIFrameElement && iframe instanceof win.HTMLIFrameElement);
  if (setTimer) {
    fallbackTimer = setTimer(triggerBlankLoadOnce, isNativeDomIframe ? 120 : 20);
    if (fallbackTimer && typeof fallbackTimer.unref === 'function') {
      fallbackTimer.unref();
    }
  } else {
    triggerBlankLoadOnce();
  }
  return true;
}

module.exports = {
  FRAME_PROMOTION_STATE,
  canAcquirePromotionOwnership,
  resolveRelativeToCdnUrl,
  promoteCrossOriginRemoteIframe,
};
