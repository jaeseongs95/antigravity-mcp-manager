'use strict';

const { resolveHostAdapterConfig } = require('./host-adapter-config');
const schema = require('./mcp-config-schema');
const { createHostMcpBridge } = require('./host-mcp-bridge');
const {
  MODAL_ID,
  EDIT_POPUP_ID,
  OAUTH_MODAL_ID,
  ensureModalStyles,
  createModalController,
} = require('./modal-ui');

const MCP_MANAGER_VERSION = 'v1.4.18';
const NATIVE_BTN_ATTR = 'data-agy-custom-mcp-btn';

function escAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isCompleteTrustedTypesPolicy(p) {
  return Boolean(
    p &&
      typeof p.createHTML === 'function' &&
      typeof p.createScript === 'function' &&
      typeof p.createScriptURL === 'function'
  );
}

function getOrCreateTrustedTypesPolicy(win, requiredMethod) {
  if (!win) return null;
  const existingCandidates = [win.__agyTrustedTypesPolicy, win.__agyTrustedHtmlPolicy].filter(Boolean);
  for (const cand of existingCandidates) {
    if (isCompleteTrustedTypesPolicy(cand)) {
      try {
        win.__agyTrustedTypesPolicy = cand;
        win.__agyTrustedHtmlPolicy = cand;
      } catch (_e) {}
      return cand;
    }
  }
  if (win.trustedTypes && typeof win.trustedTypes.createPolicy === 'function') {
    for (const pName of ['agy-mcp-manager', 'agy-mcp-companion', 'agy-companion-' + Date.now()]) {
      try {
        const policy = win.trustedTypes.createPolicy(pName, {
          createHTML: (x) => String(x ?? ''),
          createScript: (x) => String(x ?? ''),
          createScriptURL: (x) => String(x ?? ''),
        });
        if (policy) {
          try {
            win.__agyTrustedTypesPolicy = policy;
            win.__agyTrustedHtmlPolicy = policy;
          } catch (_e) {}
          return policy;
        }
      } catch (_e) {}
    }
  }
  if (requiredMethod) {
    for (const cand of existingCandidates) {
      if (typeof cand[requiredMethod] === 'function') return cand;
    }
  }
  return null;
}

function extractServerNameFromRow(row) {
  if (!row || typeof row.querySelector !== 'function') return '';
  const fixBtn = row.querySelector('[data-testid="mcp-server-fix-with-agent"]');
  if (fixBtn) {
    const aria = fixBtn.getAttribute('aria-label') || '';
    const m = /^Fix with Agent:\s*(.+)$/i.exec(aria.trim());
    if (m && m[1]) return m[1].trim();
  }
  const buttons = row.querySelectorAll('button[aria-label]');
  for (let i = 0; i < buttons.length; i++) {
    const aria = buttons[i].getAttribute('aria-label') || '';
    const m = /^More actions for\s+(.+)$/i.exec(aria.trim());
    if (m && m[1]) return m[1].trim();
  }
  const topLine = row.firstElementChild;
  const leftGroup = topLine && topLine.firstElementChild ? topLine.firstElementChild : row;
  const nameSpan = leftGroup.querySelector('span');
  if (nameSpan) {
    const fromTitle = (nameSpan.getAttribute('title') || '').trim();
    if (fromTitle && !/blocked by organization/i.test(fromTitle)) {
      return fromTitle;
    }
    const fromText = (nameSpan.textContent || '').trim();
    if (fromText) return fromText;
  }
  return '';
}

function cleanupLegacyStatusBarArtifacts(win, doc) {
  try {
    if (win && win.agyStatusBar && typeof win.agyStatusBar.unregisterAdapter === 'function') {
      win.agyStatusBar.unregisterAdapter('mcp-manager');
    }
    if (win && win.__agyCustomStatusBarAdapters && typeof win.__agyCustomStatusBarAdapters.delete === 'function') {
      win.__agyCustomStatusBarAdapters.delete('mcp-manager');
    }
    if (doc && typeof doc.querySelectorAll === 'function') {
      doc
        .querySelectorAll(
          `[data-agy-adapter-id="mcp-manager"], [data-testid="agy-statusbar-mcp-btn"], [${NATIVE_BTN_ATTR}="beside-edit-btn"]`
        )
        .forEach((el) => {
          try {
            if (typeof el.remove === 'function') {
              el.remove();
            } else if (el.parentNode) {
              el.parentNode.removeChild(el);
            }
          } catch (_e) {
            // ignore
          }
        });
    }
  } catch (_err) {
    // ignore
  }
}

function isOwnMcpNode(node) {
  let cur = node && node.nodeType !== 1 ? (node.parentElement || node.parentNode) : node;
  while (cur && cur.nodeType === 1) {
    if (
      cur.id === MODAL_ID ||
      cur.id === EDIT_POPUP_ID ||
      cur.id === OAUTH_MODAL_ID ||
      cur.id === 'agy-mcp-settings-pane' ||
      cur.id === 'agy-ko-settings-pane' ||
      cur.id === 'agy-ctx-debug-modal' ||
      cur.id === 'agy-ctx-statusbar-style' ||
      cur.id === 'agy-mcp-manager-styles' ||
      (typeof cur.className === 'string' &&
        (cur.className.includes('agy-ctx-statusbar') || cur.className.includes('agy-ctx-menu'))) ||
      (typeof cur.hasAttribute === 'function' &&
        (cur.hasAttribute(NATIVE_BTN_ATTR) ||
          cur.hasAttribute('data-agy-no-translate') ||
          cur.hasAttribute('data-ko-translated') ||
          cur.hasAttribute('data-agy-ko-translated')))
    ) {
      return true;
    }
    cur = cur.parentElement || cur.parentNode;
  }
  return false;
}

function nodeTouchesMcpAnchors(node) {
  if (!node || node.nodeType !== 1) return false;
  const tag = String(node.tagName || '').toUpperCase();
  if (tag === 'GA-REMOTE-CONTROL' || tag === 'IFRAME') return true;
  const cls = typeof node.className === 'string' ? node.className : '';
  if (cls.includes('settings-modal-container')) return true;
  const tid = typeof node.getAttribute === 'function' ? node.getAttribute('data-testid') : '';
  if (
    tid === 'add-mcp-button' ||
    tid === 'add-mcp-screen' ||
    tid === 'mcp-server-row' ||
    tid === 'mcp-server-fix-with-agent' ||
    (tid && tid.startsWith('settings-nav-item-'))
  ) {
    return true;
  }
  if (typeof node.querySelector === 'function') {
    try {
      if (
        node.querySelector(
          '.settings-modal-container, [data-testid="add-mcp-button"], [data-testid="add-mcp-screen"], [data-testid="mcp-server-row"], [data-testid="mcp-server-fix-with-agent"], [data-testid^="settings-nav-item-"], ga-remote-control, iframe'
        )
      ) {
        return true;
      }
    } catch {}
  }
  return false;
}

function isRelevantMutationList(mutations) {
  if (!Array.isArray(mutations) || mutations.length === 0) return true;
  for (let i = 0; i < mutations.length; i++) {
    const m = mutations[i];
    if (!m) continue;
    if (isOwnMcpNode(m.target)) continue;
    const added = m.addedNodes;
    if (!added || added.length === 0) {
      if (!m.removedNodes) return true;
      if (nodeTouchesMcpAnchors(m.target)) return true;
      continue;
    }
    for (let j = 0; j < added.length; j++) {
      const n = added[j];
      if (!n || isOwnMcpNode(n)) continue;
      if (!n.nodeType || nodeTouchesMcpAnchors(n) || nodeTouchesMcpAnchors(m.target)) return true;
    }
  }
  return false;
}

function ensureRemoteCompanionScripts(win, doc, bridge, hostConfig) {
  try {
    let isChildFrame = false;
    try {
      isChildFrame = Boolean(win && win.parent && win.parent !== win);
    } catch (_e) {}
    if (isChildFrame) return Promise.resolve({ loaded: [] });

    const resolvedHostCfg = resolveHostAdapterConfig(hostConfig || bridge?.hostConfig, win);
    const isRemoteWeb =
      resolvedHostCfg.isRemoteHost(win?.location?.hostname) ||
      Boolean(doc?.querySelector?.('ga-remote-control'));
    if (!isRemoteWeb || !doc?.head) return Promise.resolve({ loaded: [] });

    const getNonce = () => {
      const nonceEl = doc.querySelector?.('script[nonce]');
      return nonceEl ? nonceEl.nonce || nonceEl.getAttribute?.('nonce') || '' : '';
    };

    const appendScriptSrcAsync = (rawUrl, policy, onDoneCleanup) =>
      new Promise((resolve) => {
        try {
          const s = doc.createElement('script');
          const nonce = getNonce();
          if (nonce) s.nonce = nonce;
          s.src = policy && typeof policy.createScriptURL === 'function' ? policy.createScriptURL(rawUrl) : rawUrl;
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
            if (timer && clearTimeoutFn) {
              try { clearTimeoutFn(timer); } catch (_e) {}
            }
            if (typeof onDoneCleanup === 'function') {
              try { onDoneCleanup(); } catch (_e) {}
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
        } catch (_e) {
          if (typeof onDoneCleanup === 'function') {
            try { onDoneCleanup(); } catch (_e2) {}
          }
          resolve(false);
        }
      });

    const injectCompanionCodeOrUrl = async (code, url, policy, checkLoaded) => {
      const isLoaded = typeof checkLoaded === 'function' ? checkLoaded : () => false;
      if (code && doc.head) {
        try {
          const s = doc.createElement('script');
          const nonce = getNonce();
          if (nonce) s.nonce = nonce;
          s.text = policy && typeof policy.createScript === 'function' ? policy.createScript(code) : code;
          doc.head.appendChild(s);
          if (isLoaded() || typeof s.addEventListener !== 'function') {
            return true;
          }
        } catch (_e) {}

        try {
          const BlobCtor = win.Blob || (typeof Blob === 'function' ? Blob : null);
          const UrlApi = win.URL || (typeof URL !== 'undefined' ? URL : null);
          if (BlobCtor && UrlApi && typeof UrlApi.createObjectURL === 'function') {
            const blobUrl = UrlApi.createObjectURL(new BlobCtor([code], { type: 'text/javascript' }));
            const cleanupBlob = () => {
              try {
                if (typeof UrlApi.revokeObjectURL === 'function') {
                  UrlApi.revokeObjectURL(blobUrl);
                }
              } catch (_e3) {}
            };
            const blobOk = await appendScriptSrcAsync(blobUrl, policy, cleanupBlob);
            if (blobOk && (isLoaded() || typeof doc.createElement('script')?.addEventListener !== 'function')) {
              return true;
            }
          }
        } catch (_e2) {}
      }

      if (url && doc.head) {
        const sep = url.includes('?') ? '&' : '?';
        const remoteUrl = `${url}${sep}t=${Date.now()}`;
        const remoteOk = await appendScriptSrcAsync(remoteUrl, policy, null);
        if (remoteOk) {
          return true;
        }
      }
      return false;
    };

    const injectRemoteOrHostFallback = async (flagKey, url, hostCodeFallback, checkLoaded) => {
      if (win[flagKey]) return false;
      win[flagKey] = true;
      const policy = getOrCreateTrustedTypesPolicy(win);
      try {
        if (hostCodeFallback) {
          const ok = await injectCompanionCodeOrUrl(hostCodeFallback, url, policy, checkLoaded);
          if (!ok) win[flagKey] = false;
          return ok;
        }
        if (typeof win.fetch === 'function' && url) {
          const sep = url.includes('?') ? '&' : '?';
          const r = await Promise.resolve(win.fetch(`${url}${sep}t=${Date.now()}`)).catch(() => null);
          const code = r && r.ok && typeof r.text === 'function' ? await r.text() : '';
          if (code) {
            const ok = await injectCompanionCodeOrUrl(code, url, policy, checkLoaded);
            if (!ok) win[flagKey] = false;
            return ok;
          }
        }
        if (url) {
          const ok = await injectCompanionCodeOrUrl('', url, policy, checkLoaded);
          if (!ok) win[flagKey] = false;
          return ok;
        }
      } catch (_e) {}
      win[flagKey] = false;
      return false;
    };

    let attempts = 0;
    const tryLoadCompanions = async () => {
      attempts += 1;
      const info =
        bridge && typeof bridge.fetchHostInstalledPluginInfo === 'function'
          ? await bridge.fetchHostInstalledPluginInfo()
          : null;
      const loaded = [];
      if (!info || info.resolved === false) {
        if (attempts < 5) {
          const setTimeoutFn = typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : (typeof setTimeout === 'function' ? setTimeout : null);
          if (setTimeoutFn) {
            const t = setTimeoutFn(tryLoadCompanions, 1500);
            if (t && typeof t.unref === 'function') t.unref();
          }
          return { loaded };
        }
        if (!info) return { loaded };
      }

      if (info.hasStatusbar && !win.agyStatusBar) {
        const ok = await injectRemoteOrHostFallback(
          '__agyLoadingStatusBarCompanion',
          resolvedHostCfg.companionScripts.statusbarUrl,
          info.statusbarBlock,
          () => Boolean(win.agyStatusBar)
        );
        if (ok) loaded.push('antigravity-statusbar');
      }
      if (info.hasKoTranslator && !win.__agyKoLocalizerActive && !win.__agyKoThoughtCleanup) {
        const ok = await injectRemoteOrHostFallback(
          '__agyLoadingKoThoughtCompanion',
          resolvedHostCfg.companionScripts.koTranslatorUrl,
          info.koBlock,
          () => Boolean(win.__agyKoLocalizerActive || win.__agyKoThoughtCleanup)
        );
        if (ok) loaded.push('ko-thought-translator');
      }
      return { loaded, hostInfo: info };
    };

    return tryLoadCompanions().catch(() => ({ loaded: [] }));
  } catch (_e) {
    return Promise.resolve({ loaded: [] });
  }
}

function promoteCrossOriginRemoteIframe(win, doc, iframe, bridge, onReady) {
  if (!win || !doc || !iframe) return false;
  if (iframe.__agyMcpPromoted === MCP_MANAGER_VERSION || iframe.__agyKoPromoted) return false;

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
  if (!rawSrc || !rawSrc.includes('?iframe=true')) return false;

  let parsedUrl;
  try {
    parsedUrl = new URL(rawSrc, win.location?.href || 'https://antigravity.google.com');
  } catch (_e) {
    return false;
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return false;
  }

  const basePath = parsedUrl.pathname.replace(/^\/antigravity/, '').replace(/\/+$/, '');
  const verMatch = basePath.match(/\/web\/([^/]+)/);
  const appVersion = verMatch ? verMatch[1] : '2.29.0';
  const cdnOrigin =
    parsedUrl.hostname === 'antigravity.static.usercontent.goog' || parsedUrl.origin === win.location?.origin
      ? 'https://www.gstatic.com/antigravity'
      : parsedUrl.origin;
  const cdnBaseUrl = `${cdnOrigin}${basePath}`;

  iframe.__agyMcpPromoted = MCP_MANAGER_VERSION;
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
    if (!savedChildPath) return `${basePath}/?iframe=true`;
    const qIdx = savedChildPath.indexOf('?');
    const subPath = qIdx >= 0 ? savedChildPath.slice(0, qIdx) : savedChildPath;
    const subQuery = qIdx >= 0 ? savedChildPath.slice(qIdx + 1) : '';
    const cleanSubPath = subPath.replace(/^\/+/, '');
    const fullPath = cleanSubPath ? `${basePath}/${cleanSubPath}` : `${basePath}/`;
    return subQuery ? `${fullPath}?${subQuery}&iframe=true` : `${fullPath}?iframe=true`;
  };

  const origSrcDesc =
    typeof HTMLIFrameElement !== 'undefined'
      ? Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')
      : null;
  const spoofedSrc = `${win.location?.origin || 'https://antigravity.google.com'}${basePath}/?iframe=true`;

  const promotionToken = {};
  const rcProto = Object.getPrototypeOf(rcInst);
  const hadOwnInstOnIframeLoad = Object.prototype.hasOwnProperty.call(rcInst, 'onIframeLoad');
  if (rcProto && typeof rcProto.onIframeLoad === 'function') {
    if (!rcProto.__agyOrigOnIframeLoad) {
      rcProto.__agyOrigOnIframeLoad = rcProto.onIframeLoad;
      rcProto.onIframeLoad = function (...args) {
        if (this.__agySuppressAutoIframeLoad) return Promise.resolve();
        return rcProto.__agyOrigOnIframeLoad.apply(this, args);
      };
    }
    if (!(rcProto.__agyMcpActivePromotions instanceof Set)) {
      rcProto.__agyMcpActivePromotions = new Set();
    }
    rcProto.__agyMcpActivePromotions.add(promotionToken);
  }
  if (hadOwnInstOnIframeLoad && typeof rcInst.onIframeLoad === 'function') {
    if (!rcInst.__agyOrigOnIframeLoad) {
      rcInst.__agyOrigOnIframeLoad = rcInst.onIframeLoad;
      rcInst.onIframeLoad = function (...args) {
        if (this.__agySuppressAutoIframeLoad) return Promise.resolve();
        return this.__agyOrigOnIframeLoad.apply(this, args);
      };
    }
    if (!(rcInst.__agyMcpActivePromotions instanceof Set)) {
      rcInst.__agyMcpActivePromotions = new Set();
    }
    rcInst.__agyMcpActivePromotions.add(promotionToken);
  }
  rcInst.__agySuppressAutoIframeLoad = true;
  let childWindowRef = null;
  let hadOwnChildDec = false;
  let prevChildDec = undefined;
  let wrappedChildDec = null;
  let capturedLsByThisPromotion = null;

  const releaseRcHooks = () => {
    try {
      if (rcProto && rcProto.__agyMcpActivePromotions instanceof Set) {
        rcProto.__agyMcpActivePromotions.delete(promotionToken);
        if (rcProto.__agyMcpActivePromotions.size === 0) {
          if (rcProto.__agyOrigOnIframeLoad) {
            rcProto.onIframeLoad = rcProto.__agyOrigOnIframeLoad;
            delete rcProto.__agyOrigOnIframeLoad;
          }
          delete rcProto.__agyMcpActivePromotions;
        }
      }
      if (rcInst.__agyMcpActivePromotions instanceof Set) {
        rcInst.__agyMcpActivePromotions.delete(promotionToken);
        if (rcInst.__agyMcpActivePromotions.size === 0) {
          if (rcInst.__agyOrigOnIframeLoad) {
            rcInst.onIframeLoad = rcInst.__agyOrigOnIframeLoad;
            delete rcInst.__agyOrigOnIframeLoad;
          } else if (!hadOwnInstOnIframeLoad) {
            delete rcInst.onIframeLoad;
          }
          delete rcInst.__agyMcpActivePromotions;
        }
      }
      if (
        !(rcProto?.__agyMcpActivePromotions?.size > 0) &&
        !(rcInst.__agyMcpActivePromotions?.size > 0)
      ) {
        delete rcInst.__agySuppressAutoIframeLoad;
      }
    } catch (_e) {}
  };

  let readyNotified = false;
  const notifyReadyOnce = () => {
    if (readyNotified) return;
    readyNotified = true;
    if (typeof onReady === 'function') onReady();
  };

  const onBlankLoad = () => {
    try {
      const cw = iframe.contentWindow;
      const cd = iframe.contentDocument || cw?.document;
      if (!cw || !cd) return;
      childWindowRef = cw;

      const nonce = doc.querySelector?.('script[nonce]')?.nonce || '';
      const ttPolicy = getOrCreateTrustedTypesPolicy(win, 'createScriptURL');
      const clearChildren = (parent) => {
        if (!parent) return;
        while (parent.firstChild && typeof parent.removeChild === 'function') {
          parent.removeChild(parent.firstChild);
        }
      };
      if (cd.documentElement && typeof cd.documentElement.setAttribute === 'function') {
        cd.documentElement.setAttribute('lang', 'en');
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
      } catch (_e) {}

      try {
        cw.history?.replaceState?.(null, '', buildInitialIframeHistoryUrl());
      } catch (_e) {}
      try {
        Object.defineProperty(cd, 'referrer', {
          configurable: true,
          get: () => win.location?.href || '',
        });
      } catch (_e) {}

      cw.__APP_CONFIG__ = {
        productName: 'antigravity',
        csrfToken: String(win?.__APP_CONFIG__?.csrfToken || rcInst?.csrfToken || ''),
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
                  } catch (_e) {}
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
      } catch (_e) {}

      const prismScript = cd.createElement('script');
      if (nonce) prismScript.nonce = nonce;
      prismScript.async = false;
      const prismUrl = `${cdnBaseUrl}/prism_bundle.js`;
      prismScript.src =
        ttPolicy && typeof ttPolicy.createScriptURL === 'function' ? ttPolicy.createScriptURL(prismUrl) : prismUrl;

      const mainScript = cd.createElement('script');
      if (nonce) mainScript.nonce = nonce;
      mainScript.async = false;
      const mainUrl = `${cdnBaseUrl}/main.js`;
      mainScript.src =
        ttPolicy && typeof ttPolicy.createScriptURL === 'function' ? ttPolicy.createScriptURL(mainUrl) : mainUrl;

      mainScript.onload = () => {
        rcInst.__agySuppressAutoIframeLoad = false;
        cw.__agyMainBooted = true;
        if (savedChildPath) rcInst.initialChildPath = savedChildPath;
        const origLoad =
          rcInst.__agyOrigOnIframeLoad ||
          rcProto?.__agyOrigOnIframeLoad ||
          rcInst.onIframeLoad;
        if (typeof origLoad === 'function' && !cw.__initialConfigReceived && !cw.__agyOnIframeLoadCalled) {
          cw.__agyOnIframeLoadCalled = true;
          try {
            origLoad.call(rcInst);
          } catch (_e) {}
        }
        try {
          if (typeof rcInst.markIframeReady === 'function') {
            rcInst.markIframeReady();
          } else {
            rcInst.iframeLoading?.set?.(false);
            rcInst.iframeUiReady?.set?.(true);
          }
        } catch (_e) {}
        notifyReadyOnce();
      };
      mainScript.onerror = () => {
        rcInst.__agySuppressAutoIframeLoad = false;
        releaseRcHooks();
        delete iframe.__agyMcpPromoted;
      };

      if (headEl && typeof headEl.appendChild === 'function') {
        headEl.appendChild(prismScript);
        headEl.appendChild(mainScript);
      }
      rcInst.__agySuppressAutoIframeLoad = false;
    } catch (_e) {
      rcInst.__agySuppressAutoIframeLoad = false;
      releaseRcHooks();
      delete iframe.__agyMcpPromoted;
    }
  };

  try {
    delete iframe.src;
  } catch (_e) {}
  let blankLoadHandled = false;
  const triggerBlankLoadOnce = () => {
    if (blankLoadHandled) return;
    try {
      const cd = iframe.contentDocument || iframe.contentWindow?.document;
      const cw = iframe.contentWindow;
      if (!cd || !cw) return;
      blankLoadHandled = true;
    } catch (_e) {
      return;
    }
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
  } finally {
    rcInst.__agySuppressAutoIframeLoad = false;
  }
  try {
    Object.defineProperty(iframe, 'src', {
      configurable: true,
      enumerable: true,
      get: () => spoofedSrc,
      set: (v) => {
        if (origSrcDesc && typeof origSrcDesc.set === 'function') {
          origSrcDesc.set.call(iframe, v);
        }
      },
    });
  } catch (_e) {}
  iframe.__agyMcpRestorePromotion = () => {
    releaseRcHooks();
    try {
      let targetCw = childWindowRef;
      if (!targetCw) {
        try {
          targetCw = iframe.contentWindow;
        } catch (_e2) {}
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
    } catch (_e) {}
    try {
      if (typeof iframe.removeEventListener === 'function') {
        iframe.removeEventListener('load', triggerBlankLoadOnce);
      }
    } catch (_e) {}
    try {
      delete iframe.src;
    } catch (_e) {}
    delete iframe.__agyMcpPromoted;
    delete iframe.__agyMcpRestorePromotion;
  };
  const setTimer = typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : (typeof setTimeout === 'function' ? setTimeout : null);
  if (setTimer) {
    setTimer(triggerBlankLoadOnce, 25);
  } else {
    triggerBlankLoadOnce();
  }
  return true;
}

function mountMcpManager(env = {}) {
  const win = env.window || (typeof window !== 'undefined' ? window : null);
  const doc = env.document || (win && win.document ? win.document : null);
  if (!win || !doc || !doc.body) return null;

  // Ensure no statusbar buttons/adapters remain from any prior version
  cleanupLegacyStatusBarArtifacts(win, doc);

  if (win.agyMcpManager && win.agyMcpManager.version === MCP_MANAGER_VERSION) {
    if (typeof win.agyMcpManager.__rebindIfBodyReplaced === 'function') {
      win.agyMcpManager.__rebindIfBodyReplaced();
    }
    return win.agyMcpManager;
  }
  if (win.agyMcpManager && typeof win.agyMcpManager.destroy === 'function') {
    try {
      win.agyMcpManager.destroy();
    } catch (_e) {
      // ignore cleanup error
    }
  }

  ensureModalStyles(doc);

  const resolvedHostCfg = resolveHostAdapterConfig(env.hostConfig || env.bridge?.hostConfig, win);
  const bridge = env.bridge || createHostMcpBridge({ window: win, document: doc, hostConfig: resolvedHostCfg });
  const modal = createModalController({
    doc,
    bridge,
  });

  async function handleServerAuthenticateAction(serverName) {
    if (!serverName) {
      modal.openEditPopup('', { focusAuth: true });
      return;
    }
    try {
      const statesRes = await bridge.fetchServerStates();
      const states = Array.isArray(statesRes)
        ? statesRes
        : (statesRes && Array.isArray(statesRes.states) ? statesRes.states : []);
      const matched = states.find(
        (s) => s && (s.serverName === serverName || s.spec?.serverName === serverName)
      );
      if (matched && matched.authUrl) {
        modal.openOAuthConnectModal(serverName, matched.authUrl);
        return;
      }
    } catch (_e) {
      // fallback to edit popup
    }
    modal.openEditPopup(serverName, { focusAuth: true });
  }

  // Inject "MCP Servers" sidebar tab inside Antigravity's Settings modal (.settings-modal-container),
  // matching the exact DOM wrapper structure of native nav items & KoTranslator without ever re-appending.
  function ensureNativeSettingsModalIntegration() {
    if (!doc.body) return;
    const settingsModal = doc.querySelector('.settings-modal-container');
    if (!settingsModal) return;

    const modelsNavBtn = settingsModal.querySelector('button[data-testid="settings-nav-item-Models"]');
    if (!modelsNavBtn) return;

    const navGroup =
      modelsNavBtn.closest('.flex.flex-col.gap-0\\.5') ||
      modelsNavBtn.parentElement?.parentElement ||
      modelsNavBtn.parentElement;
    if (!navGroup) return;

    const setNavBtnActiveVisual = (btnEl, isActive) => {
      if (!btnEl) return;
      const sp = btnEl.querySelector?.('span');
      if (isActive) {
        btnEl.classList?.add?.('bg-sidebar-secondary');
        if (sp) {
          sp.classList?.remove?.('text-secondary-foreground');
          sp.classList?.add?.('text-foreground', 'font-medium');
        }
      } else {
        btnEl.classList?.remove?.('bg-sidebar-secondary');
        if (sp) {
          sp.classList?.remove?.('text-foreground', 'font-medium');
          sp.classList?.add?.('text-secondary-foreground');
        }
      }
    };

    const syncExclusiveNavHighlight = (activeTestId) => {
      const allNavBtns = settingsModal.querySelectorAll('button[data-testid^="settings-nav-item-"]');
      allNavBtns.forEach((b) => {
        const tid = b.getAttribute?.('data-testid') || '';
        setNavBtnActiveVisual(b, tid === activeTestId);
      });
    };

    // IMPORTANT: If button already exists in settingsModal, DO NOT move or re-append it!
    // Re-appending inside MutationObserver causes an infinite microtask loop that freezes the app.
    let mcpNavBtn = settingsModal.querySelector('button[data-testid="settings-nav-item-McpManager"]');
    if (!mcpNavBtn) {
      const navWrap = doc.createElement('div');
      navWrap.className = 'relative group/nav-item mx-2 agy-mcp-settings-root';
      navWrap.setAttribute(NATIVE_BTN_ATTR, 'settings-nav-wrap');

      mcpNavBtn = doc.createElement('button');
      mcpNavBtn.type = 'button';
      mcpNavBtn.setAttribute('data-testid', 'settings-nav-item-McpManager');
      mcpNavBtn.setAttribute(NATIVE_BTN_ATTR, 'settings-nav-item');
      mcpNavBtn.className =
        'flex items-center gap-1.5 w-full px-2 py-1 rounded-lg cursor-pointer border-none text-left transition-all outline-none hover:bg-sidebar-muted';

      const labelSpan = doc.createElement('span');
      labelSpan.className =
        'text-sm transition-colors select-none truncate flex-1 text-secondary-foreground group-hover/nav-item:text-foreground';
      labelSpan.textContent = 'MCP Servers';
      mcpNavBtn.appendChild(labelSpan);
      navWrap.appendChild(mcpNavBtn);

      const koNavBtn = settingsModal.querySelector('button[data-testid="settings-nav-item-KoTranslator"]');
      const koWrap = koNavBtn ? (koNavBtn.parentElement !== navGroup ? koNavBtn.parentElement : koNavBtn) : null;
      if (koWrap && koWrap.parentElement === navGroup && koWrap.nextSibling) {
        navGroup.insertBefore(navWrap, koWrap.nextSibling);
      } else {
        navGroup.appendChild(navWrap);
      }

      const activateMcpPane = () => {
        const contentContainer = settingsModal.querySelector('.grow.w-full');
        if (!contentContainer) return;

        const existingPane = contentContainer.querySelector('#agy-mcp-settings-pane');
        const alreadyActive = Boolean(existingPane && existingPane.style.display !== 'none');
        if (!alreadyActive) {
          let prevTid = '';
          const allNavBtns = settingsModal.querySelectorAll('button[data-testid^="settings-nav-item-"]');
          allNavBtns.forEach((b) => {
            const tid = b.getAttribute?.('data-testid') || '';
            if (
              tid &&
              tid !== 'settings-nav-item-McpManager' &&
              tid !== 'settings-nav-item-KoTranslator' &&
              b.classList?.contains?.('bg-sidebar-secondary')
            ) {
              prevTid = tid;
            }
          });
          const fallbackTid = settingsModal.getAttribute?.('data-agy-mcp-prev-nav') || 'settings-nav-item-Models';
          settingsModal.setAttribute('data-agy-mcp-prev-nav', prevTid || fallbackTid);
        }

        // Hide other panes (preserving native display in `data-agy-prev-display` compatible with KoTranslator)
        Array.from(contentContainer.children).forEach((child) => {
          if (child.id === 'agy-mcp-settings-pane') return;
          if (child.id === 'agy-ko-settings-pane') {
            child.style.display = 'none';
            return;
          }
          if (child.getAttribute('data-agy-prev-display') === null) {
            child.setAttribute('data-agy-prev-display', child.style.display || '');
          }
          child.style.display = 'none';
        });

        let pane = existingPane;
        if (!pane) {
          pane = doc.createElement('div');
          pane.id = 'agy-mcp-settings-pane';
          pane.setAttribute(NATIVE_BTN_ATTR, 'settings-pane');
          pane.setAttribute('data-agy-no-translate', 'true');
          pane.setAttribute('translate', 'no');
          pane.className = 'w-full bg-transparent h-full overflow-y-auto px-6 py-5 select-none';
          contentContainer.appendChild(pane);
        }
        pane.style.display = 'block';
        modal.renderSettingsPageContent(pane);
        void modal.reloadData();

        // Exclusively highlight "MCP Servers" and clear highlight on all other nav tabs (e.g., "Models", "KoTranslator")
        syncExclusiveNavHighlight('settings-nav-item-McpManager');
      };

      mcpNavBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        activateMcpPane();
      });
    }

    if (!settingsModal.hasAttribute('data-agy-mcp-nav-bound')) {
      settingsModal.setAttribute('data-agy-mcp-nav-bound', 'true');
      const navClickHandler = (e) => {
        const btn = e.target && typeof e.target.closest === 'function'
          ? e.target.closest('button[data-testid^="settings-nav-item-"]')
          : null;
        if (!btn) return;
        const testId = btn.getAttribute('data-testid') || '';
        if (testId === 'settings-nav-item-McpManager') return;

        if (testId && testId !== 'settings-nav-item-KoTranslator') {
          settingsModal.setAttribute('data-agy-mcp-prev-nav', testId);
        }

        const contentContainer = settingsModal.querySelector('.grow.w-full');
        if (!contentContainer) return;

        const pane = contentContainer.querySelector('#agy-mcp-settings-pane');
        const wasMcpPaneVisible = Boolean(pane && pane.style.display !== 'none');
        if (pane) {
          pane.style.display = 'none';
          pane.removeAttribute('data-agy-prev-display');
        }

        // Exclusively highlight the clicked tab (whether native like "Models" or "KoTranslator")
        // and clear highlight on all other tabs so two tabs never look pressed simultaneously
        syncExclusiveNavHighlight(testId);

        // Restore native children if switching from MCP pane to a native tab (not KoTranslator)
        if (wasMcpPaneVisible && testId !== 'settings-nav-item-KoTranslator') {
          Array.from(contentContainer.children).forEach((child) => {
            if (child.id !== 'agy-mcp-settings-pane' && child.id !== 'agy-ko-settings-pane') {
              const prev = child.getAttribute('data-agy-prev-display');
              if (prev !== null) {
                child.style.display = prev;
                child.removeAttribute('data-agy-prev-display');
              } else {
                child.style.display = '';
              }
            }
          });
        }
      };
      settingsModal.__agyMcpNavClickHandler = navClickHandler;
      settingsModal.addEventListener('click', navClickHandler, true);
    }
  }

  // Inject "+ Add Custom MCP Server", "⚙️ Edit Custom MCP Settings", and "🔗 OAuth / Auth Settings" controls into Customizations / MCP views
  function buildQuickActionToolbar() {
    const wrap = doc.createElement('div');
    wrap.setAttribute(NATIVE_BTN_ATTR, 'empty-mcp-note');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.flexWrap = 'wrap';
    wrap.style.gap = '8px';
    wrap.style.paddingLeft = '12px';
    wrap.style.marginTop = '6px';
    wrap.style.marginBottom = '6px';

    const addCustomBtn = doc.createElement('button');
    addCustomBtn.type = 'button';
    addCustomBtn.className = 'agy-mcp-injected-native-btn';
    addCustomBtn.style.marginLeft = '0';
    addCustomBtn.textContent = '+ Add Custom MCP Server';
    addCustomBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      modal.openEditPopup('', { createNew: true });
    });

    const editCustomBtn = doc.createElement('button');
    editCustomBtn.type = 'button';
    editCustomBtn.className = 'agy-mcp-btn';
    editCustomBtn.setAttribute(NATIVE_BTN_ATTR, 'toolbar-edit-popup-btn');
    editCustomBtn.textContent = '⚙️ Edit Custom MCP Settings';
    editCustomBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      modal.openEditPopup();
    });

    const authCustomBtn = doc.createElement('button');
    authCustomBtn.type = 'button';
    authCustomBtn.className = 'agy-mcp-btn auth';
    authCustomBtn.setAttribute(NATIVE_BTN_ATTR, 'toolbar-auth-popup-btn');
    authCustomBtn.textContent = '🔗 OAuth / Auth Settings';
    authCustomBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      modal.openEditPopup('', { focusAuth: true });
    });

    const rawBtn = doc.createElement('button');
    rawBtn.type = 'button';
    rawBtn.className = 'agy-mcp-btn';
    rawBtn.textContent = '{ } Edit mcp_config.json';
    rawBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      modal.openModal('raw');
    });

    wrap.appendChild(addCustomBtn);
    wrap.appendChild(editCustomBtn);
    wrap.appendChild(authCustomBtn);
    wrap.appendChild(rawBtn);
    return wrap;
  }

  let isChildFrame = false;
  try {
    isChildFrame = Boolean(win && win.parent && win.parent !== win);
  } catch (_e) {}

  const isRemoteHostPage =
    !isChildFrame &&
    (resolvedHostCfg.isRemoteHost(win?.location?.hostname) ||
      Boolean(doc?.querySelector?.('ga-remote-control'))) &&
    Boolean(doc?.head);
  let companionCheckDone = !(isRemoteHostPage && bridge && typeof bridge.fetchHostInstalledPluginInfo === 'function');
  let hostHasKoTranslator = false;
  let destroyed = false;
  const boundRemoteIframes = new Set();

  function ensureRemoteIframeMounted() {
    if (destroyed) return false;
    const rawList = doc.querySelectorAll ? Array.from(doc.querySelectorAll('ga-remote-control iframe')) : [];
    const singleFallback = rawList.length === 0 ? doc.querySelector?.('ga-remote-control iframe') : null;
    const iframes = singleFallback ? [singleFallback] : rawList;
    if (iframes.length === 0) return false;

    let anyMounted = false;
    for (const iframe of iframes) {
      if (!iframe) continue;
      if (!iframe.__agyMcpLoadBound && typeof iframe.addEventListener === 'function') {
        const onIframeLoad = () => {
          if (destroyed) return;
          ensureRemoteIframeMounted();
        };
        iframe.__agyMcpLoadBound = true;
        iframe.__agyMcpLoadHandler = onIframeLoad;
        boundRemoteIframes.add(iframe);
        iframe.addEventListener('load', onIframeLoad);
      }
      try {
        const iframeWin = iframe.contentWindow;
        const iframeDoc = iframe.contentDocument || iframeWin?.document;
        if (iframeWin && iframeDoc && iframeDoc.body) {
          if (!iframeWin.agyMcpManager || iframeWin.agyMcpManager.version !== MCP_MANAGER_VERSION) {
            mountMcpManager({
              window: iframeWin,
              document: iframeDoc,
              bridge,
              hostConfig: resolvedHostCfg,
            });
          } else if (typeof iframeWin.agyMcpManager.__rebindIfBodyReplaced === 'function') {
            iframeWin.agyMcpManager.__rebindIfBodyReplaced();
          }
          anyMounted = true;
        }
      } catch (_e) {
        // Cross-origin iframe: wait until companion check finishes so we never race with ko-thought-translator
        if (
          companionCheckDone &&
          !hostHasKoTranslator &&
          !win.__agyKoLocalizerActive &&
          !win.__agyLoadingKoThoughtCompanion &&
          !win.__agyKoThoughtCleanup
        ) {
          promoteCrossOriginRemoteIframe(win, doc, iframe, bridge, () => {
            if (!destroyed) ensureRemoteIframeMounted();
          });
        }
      }
    }
    return anyMounted;
  }

  if (!isChildFrame) {
    ensureRemoteCompanionScripts(win, doc, bridge, resolvedHostCfg)
      .then((res) => {
        if (destroyed) return;
        if (
          res?.hostInfo?.hasKoTranslator ||
          (Array.isArray(res?.loaded) && res.loaded.includes('ko-thought-translator'))
        ) {
          hostHasKoTranslator = true;
        }
        companionCheckDone = true;
        ensureRemoteIframeMounted();
      })
      .catch(() => {
        if (destroyed) return;
        companionCheckDone = true;
        ensureRemoteIframeMounted();
      });
  }

  let remoteIframePollTimer = null;
  if (doc.querySelector?.('ga-remote-control') && !ensureRemoteIframeMounted()) {
    let pollCount = 0;
    const setTimer = typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : (typeof setTimeout === 'function' ? setTimeout : null);
    const pollIframe = () => {
      remoteIframePollTimer = null;
      if (destroyed) return;
      pollCount += 1;
      ensureRemoteIframeMounted();
      if (pollCount >= 12 || !setTimer || destroyed) return;
      remoteIframePollTimer = setTimer(pollIframe, 1000);
      if (remoteIframePollTimer && typeof remoteIframePollTimer.unref === 'function') {
        remoteIframePollTimer.unref();
      }
    };
    if (setTimer) {
      remoteIframePollTimer = setTimer(pollIframe, 500);
      if (remoteIframePollTimer && typeof remoteIframePollTimer.unref === 'function') {
        remoteIframePollTimer.unref();
      }
    }
  }

  function injectIntoNativeMcpScreens() {
    if (destroyed || !doc.body) return;

    // Support Remote Control web (`https://antigravity.google.com/r/...`) inner workbench iframe
    ensureRemoteIframeMounted();

    // 0) Settings Modal ("MCP Servers" tab right below "Models" / "KoTranslator")
    ensureNativeSettingsModalIntegration();

    // A) Next to native [data-testid="add-mcp-button"] in Customizations -> MCP Servers header
    const addMcpBtns = doc.querySelectorAll('[data-testid="add-mcp-button"]');
    addMcpBtns.forEach((nativeBtn) => {
      const parent = nativeBtn.parentElement;
      if (!parent) return;
      const legacyBesideEdit = parent.querySelector(`[${NATIVE_BTN_ATTR}="beside-edit-btn"]`);
      if (legacyBesideEdit) {
        if (typeof legacyBesideEdit.remove === 'function') {
          legacyBesideEdit.remove();
        } else if (legacyBesideEdit.parentNode) {
          legacyBesideEdit.parentNode.removeChild(legacyBesideEdit);
        }
      }
      if (!parent.querySelector(`[${NATIVE_BTN_ATTR}="beside-add-btn"]`)) {
        const customBtn = doc.createElement('button');
        customBtn.type = 'button';
        customBtn.className = 'agy-mcp-injected-native-btn';
        customBtn.setAttribute(NATIVE_BTN_ATTR, 'beside-add-btn');
        customBtn.textContent = '+ Custom MCP';
        customBtn.title = 'Add or manage custom MCP servers in ~/.gemini/config/mcp_config.json';
        customBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          modal.openEditPopup('', { createNew: true });
        });
        parent.insertBefore(customBtn, nativeBtn);
      }
    });

    // B) Inside native [data-testid="add-mcp-screen"] ("Add MCP Server" modal / screen)
    const addMcpScreens = doc.querySelectorAll('[data-testid="add-mcp-screen"]');
    addMcpScreens.forEach((screen) => {
      if (screen.querySelector(`[${NATIVE_BTN_ATTR}="inside-add-screen"]`)) return;
      const headerRow = screen.firstElementChild;
      if (!headerRow) return;

      const banner = doc.createElement('div');
      banner.setAttribute(NATIVE_BTN_ATTR, 'inside-add-screen');
      banner.style.display = 'flex';
      banner.style.alignItems = 'center';
      banner.style.justifyContent = 'space-between';
      banner.style.flexWrap = 'wrap';
      banner.style.gap = '10px';
      banner.style.margin = '4px 0 8px 0';
      banner.style.padding = '8px 12px';
      banner.style.borderRadius = '8px';
      banner.style.background = 'rgba(79, 70, 229, 0.12)';
      banner.style.border = '1px solid rgba(99, 102, 241, 0.32)';
      banner.style.fontSize = '12px';

      const desc = doc.createElement('span');
      desc.textContent = 'Custom MCP Servers (OAuth Server URL or Local/Tunnel Stdio):';

      const btnGroup = doc.createElement('div');
      btnGroup.style.display = 'flex';
      btnGroup.style.gap = '6px';
      btnGroup.style.flexWrap = 'wrap';

      const openEditorBtn = doc.createElement('button');
      openEditorBtn.type = 'button';
      openEditorBtn.className = 'agy-mcp-injected-native-btn';
      openEditorBtn.style.marginLeft = '0';
      openEditorBtn.textContent = '+ Add Custom MCP Server';
      openEditorBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modal.openEditPopup('', { createNew: true });
      });

      const editAuthBtn = doc.createElement('button');
      editAuthBtn.type = 'button';
      editAuthBtn.className = 'agy-mcp-btn';
      editAuthBtn.textContent = '⚙️ Edit Custom MCP Settings';
      editAuthBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modal.openEditPopup();
      });

      const manageBtn = doc.createElement('button');
      manageBtn.type = 'button';
      manageBtn.className = 'agy-mcp-btn';
      manageBtn.textContent = 'Manage Servers';
      manageBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modal.openModal('servers');
      });

      btnGroup.appendChild(openEditorBtn);
      btnGroup.appendChild(editAuthBtn);
      btnGroup.appendChild(manageBtn);
      banner.appendChild(desc);
      banner.appendChild(btnGroup);

      if (headerRow.nextSibling) {
        screen.insertBefore(banner, headerRow.nextSibling);
      } else {
        screen.appendChild(banner);
      }
    });

    // C) Next to the "No MCP servers yet." empty note OR above the [data-testid="mcp-server-row"] list
    const firstServerRow = doc.querySelector('[data-testid="mcp-server-row"]');
    if (firstServerRow && firstServerRow.parentElement && firstServerRow.parentElement.parentElement) {
      const listContainer = firstServerRow.parentElement;
      const sectionBody = listContainer.parentElement;
      const existingToolbar = sectionBody.querySelector(`[${NATIVE_BTN_ATTR}="empty-mcp-note"]`);
      if (!existingToolbar) {
        sectionBody.insertBefore(buildQuickActionToolbar(), listContainer);
      }
    } else if (addMcpBtns.length > 0 || addMcpScreens.length > 0) {
      const scopeRoots = [];
      addMcpBtns.forEach((btn) => {
        const root = btn.closest?.('[data-testid="add-mcp-screen"]') || btn.parentElement?.parentElement || btn.parentElement;
        if (root && !scopeRoots.includes(root)) scopeRoots.push(root);
      });
      addMcpScreens.forEach((scr) => {
        if (scr && !scopeRoots.includes(scr)) scopeRoots.push(scr);
      });
      const paragraphs = scopeRoots.length > 0
        ? scopeRoots.flatMap((r) => Array.from(r.querySelectorAll ? r.querySelectorAll('p') : []))
        : Array.from(doc.querySelectorAll('p'));
      paragraphs.forEach((p) => {
        if (
          p.textContent &&
          (p.textContent.includes('No MCP servers yet.') || p.textContent.includes('등록된 MCP 서버가 없습니다')) &&
          p.parentElement &&
          !p.parentElement.querySelector(`[${NATIVE_BTN_ATTR}="empty-mcp-note"]`)
        ) {
          p.parentElement.appendChild(buildQuickActionToolbar());
        }
      });
    }

    // D) Inside each native [data-testid="mcp-server-row"] item: inject "⚙️ Edit Settings" and "🔗 Connect OAuth / Auth" buttons
    const rows = doc.querySelectorAll('[data-testid="mcp-server-row"]');
    rows.forEach((row) => {
      const serverName = extractServerNameFromRow(row);
      if (!serverName) return;

      // D1) Top title/badge line of the row
      const topLine = row.firstElementChild;
      const leftGroup = topLine && topLine.firstElementChild ? topLine.firstElementChild : null;
      if (leftGroup && !leftGroup.querySelector(`[${NATIVE_BTN_ATTR}="row-edit-btn"]`)) {
        const editRowBtn = doc.createElement('button');
        editRowBtn.type = 'button';
        editRowBtn.className = 'agy-mcp-inline-row-btn';
        editRowBtn.setAttribute(NATIVE_BTN_ATTR, 'row-edit-btn');
        editRowBtn.setAttribute('data-mcp-server', serverName);
        editRowBtn.textContent = '⚙️ Edit Settings';
        editRowBtn.title = `Edit settings and OAuth authentication for "${serverName}"`;
        editRowBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          modal.openEditPopup(serverName);
        });

        const authRowBtn = doc.createElement('button');
        authRowBtn.type = 'button';
        authRowBtn.className = 'agy-mcp-inline-row-btn auth';
        authRowBtn.setAttribute(NATIVE_BTN_ATTR, 'row-auth-btn');
        authRowBtn.setAttribute('data-mcp-server', serverName);
        authRowBtn.textContent = '🔗 Connect OAuth / Auth';
        authRowBtn.title = `Open OAuth connection dialog or configure authentication for "${serverName}"`;
        authRowBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleServerAuthenticateAction(serverName);
        });

        leftGroup.appendChild(editRowBtn);
        leftGroup.appendChild(authRowBtn);
      }

      // D2) Next to [data-testid="mcp-server-fix-with-agent"] inside error boxes (e.g. "Unauthorized")
      const fixBtn = row.querySelector('[data-testid="mcp-server-fix-with-agent"]');
      if (fixBtn && fixBtn.parentElement && !fixBtn.parentElement.querySelector(`[${NATIVE_BTN_ATTR}="fix-auth-btn"]`)) {
        const btnWrap = doc.createElement('div');
        btnWrap.style.display = 'inline-flex';
        btnWrap.style.alignItems = 'center';
        btnWrap.style.gap = '6px';
        btnWrap.setAttribute(NATIVE_BTN_ATTR, 'fix-actions-wrap');

        const fixAuthBtn = doc.createElement('button');
        fixAuthBtn.type = 'button';
        fixAuthBtn.className = 'agy-mcp-inline-row-btn auth';
        fixAuthBtn.setAttribute(NATIVE_BTN_ATTR, 'fix-auth-btn');
        fixAuthBtn.setAttribute('data-mcp-server', serverName);
        fixAuthBtn.textContent = '🔗 Connect OAuth / Auth';
        fixAuthBtn.title = `Connect OAuth or configure authentication for "${serverName}"`;
        fixAuthBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleServerAuthenticateAction(serverName);
        });

        const fixEditBtn = doc.createElement('button');
        fixEditBtn.type = 'button';
        fixEditBtn.className = 'agy-mcp-inline-row-btn';
        fixEditBtn.setAttribute(NATIVE_BTN_ATTR, 'fix-edit-btn');
        fixEditBtn.setAttribute('data-mcp-server', serverName);
        fixEditBtn.textContent = '⚙️ Edit Settings';
        fixEditBtn.title = `Edit settings for "${serverName}"`;
        fixEditBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          modal.openEditPopup(serverName);
        });

        btnWrap.appendChild(fixAuthBtn);
        btnWrap.appendChild(fixEditBtn);
        fixBtn.parentElement.insertBefore(btnWrap, fixBtn);
      }
    });
  }

  injectIntoNativeMcpScreens();

  let observer = null;
  let observedBody = null;
  let injectTimer = null;
  function attachBodyObserver() {
    if (!doc.body || typeof win.MutationObserver !== 'function') return;
    if (observer && observedBody === doc.body) return;
    if (observer) {
      try {
        observer.disconnect();
      } catch (_e) {}
    }
    observer = new win.MutationObserver((mutations) => {
      if (!isRelevantMutationList(mutations)) return;
      if (injectTimer) return;
      const setTimer = typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
      injectTimer = setTimer(() => {
        injectTimer = null;
        injectIntoNativeMcpScreens();
      }, 25);
    });
    observedBody = doc.body;
    observer.observe(doc.body, { childList: true, subtree: true });
  }
  attachBodyObserver();

  function rebindIfBodyReplaced() {
    const bodyReplaced = Boolean(doc.body && observedBody !== doc.body);
    const styleMissing = Boolean(
      doc.head && typeof doc.getElementById === 'function' && !doc.getElementById('agy-mcp-manager-styles')
    );
    if (!bodyReplaced && !styleMissing) return false;
    ensureModalStyles(doc);
    attachBodyObserver();
    injectIntoNativeMcpScreens();
    return true;
  }

  // Keyboard shortcut: Ctrl+Alt+M to open/toggle modal, Escape to close
  function onKeyDown(e) {
    if (!e) return;
    if (e.key === 'Escape') {
      if (modal.isOAuthConnectModalOpen()) {
        modal.closeOAuthConnectModal();
        return;
      }
      if (modal.isEditPopupOpen()) {
        modal.closeEditPopup();
        return;
      }
      if (modal.isOpen()) {
        modal.closeModal();
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'm') {
      e.preventDefault();
      if (modal.isOpen()) {
        modal.closeModal();
      } else {
        modal.openModal('servers');
      }
    }
  }
  win.addEventListener('keydown', onKeyDown);

  const controller = {
    version: MCP_MANAGER_VERSION,
    openModal: (tab) => modal.openModal(tab),
    closeModal: () => modal.closeModal(),
    isOpen: () => modal.isOpen(),
    openEditPopup: (serverName, options) => modal.openEditPopup(serverName, options),
    closeEditPopup: () => modal.closeEditPopup(),
    isEditPopupOpen: () => modal.isEditPopupOpen(),
    openOAuthConnectModal: (serverName, authUrl, options) => modal.openOAuthConnectModal(serverName, authUrl, options),
    closeOAuthConnectModal: () => modal.closeOAuthConnectModal(),
    isOAuthConnectModalOpen: () => modal.isOAuthConnectModalOpen(),
    renderSettingsPageContent: (container) => modal.renderSettingsPageContent(container),
    injectIntoNativeMcpScreens,
    __rebindIfBodyReplaced: rebindIfBodyReplaced,
    reload: () => modal.reloadData(),
    bridge,
    schema,
    destroy() {
      destroyed = true;
      if (win.__agyMcpDomReadyHandler) {
        if (typeof doc.removeEventListener === 'function') {
          doc.removeEventListener('DOMContentLoaded', win.__agyMcpDomReadyHandler);
        }
        delete win.__agyMcpDomReadyHandler;
      }
      if (injectTimer) {
        const clr = typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
        clr(injectTimer);
        injectTimer = null;
      }
      if (remoteIframePollTimer) {
        const clr = typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
        clr(remoteIframePollTimer);
        remoteIframePollTimer = null;
      }
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      win.removeEventListener('keydown', onKeyDown);
      modal.closeOAuthConnectModal();
      modal.closeEditPopup();
      modal.closeModal();
      cleanupLegacyStatusBarArtifacts(win, doc);
      const settingsModals = doc.querySelectorAll ? doc.querySelectorAll('.settings-modal-container') : [];
      Array.from(settingsModals).forEach((sm) => {
        const contentContainer = sm.querySelector ? sm.querySelector('.grow.w-full') : null;
        const pane = contentContainer && contentContainer.querySelector ? contentContainer.querySelector('#agy-mcp-settings-pane') : null;
        const wasVisible = Boolean(pane && pane.style && pane.style.display !== 'none');
        if (wasVisible && contentContainer && contentContainer.children) {
          Array.from(contentContainer.children).forEach((child) => {
            if (child.id !== 'agy-mcp-settings-pane' && child.id !== 'agy-ko-settings-pane') {
              const prev = child.getAttribute ? child.getAttribute('data-agy-prev-display') : null;
              if (prev !== null) {
                child.style.display = prev;
                if (typeof child.removeAttribute === 'function') child.removeAttribute('data-agy-prev-display');
              } else {
                child.style.display = '';
              }
            }
          });
          const prevNavTid =
            (typeof sm.getAttribute === 'function' && sm.getAttribute('data-agy-mcp-prev-nav')) ||
            'settings-nav-item-Models';
          const navCandidates = sm.querySelectorAll
            ? Array.from(sm.querySelectorAll('button[data-testid^="settings-nav-item-"]'))
            : [];
          const restoreBtn =
            navCandidates.find((b) => (b.getAttribute ? b.getAttribute('data-testid') : '') === prevNavTid) ||
            navCandidates.find(
              (b) => (b.getAttribute ? b.getAttribute('data-testid') : '') === 'settings-nav-item-Models'
            ) ||
            (sm.querySelector ? sm.querySelector('button[data-testid="settings-nav-item-Models"]') : null);
          if (restoreBtn) {
            restoreBtn.classList?.add?.('bg-sidebar-secondary');
            const sp = restoreBtn.querySelector ? restoreBtn.querySelector('span') : null;
            if (sp) {
              sp.classList?.remove?.('text-secondary-foreground');
              sp.classList?.add?.('text-foreground', 'font-medium');
            }
          }
        }
        if (sm.__agyMcpNavClickHandler && typeof sm.removeEventListener === 'function') {
          sm.removeEventListener('click', sm.__agyMcpNavClickHandler, true);
          delete sm.__agyMcpNavClickHandler;
        }
        if (typeof sm.removeAttribute === 'function') {
          sm.removeAttribute('data-agy-mcp-nav-bound');
          sm.removeAttribute('data-agy-mcp-prev-nav');
        }
      });
      doc.querySelectorAll(`[${NATIVE_BTN_ATTR}]`).forEach((el) => {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      const styleEl = doc.getElementById ? doc.getElementById('agy-mcp-manager-styles') : null;
      if (styleEl) {
        if (typeof styleEl.remove === 'function') styleEl.remove();
        else if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      }
      const iframesToClean = new Set(boundRemoteIframes);
      boundRemoteIframes.clear();
      if (doc.querySelectorAll) {
        doc.querySelectorAll('ga-remote-control iframe').forEach((ifr) => {
          if (ifr) iframesToClean.add(ifr);
        });
      }
      iframesToClean.forEach((ifr) => {
        try {
          if (typeof ifr.__agyMcpRestorePromotion === 'function') {
            ifr.__agyMcpRestorePromotion();
          }
        } catch {}
        try {
          if (ifr.__agyMcpLoadHandler && typeof ifr.removeEventListener === 'function') {
            ifr.removeEventListener('load', ifr.__agyMcpLoadHandler);
          }
          delete ifr.__agyMcpLoadHandler;
          delete ifr.__agyMcpLoadBound;
        } catch {}
        try {
          const childMgr = ifr?.contentWindow?.agyMcpManager;
          if (childMgr && childMgr !== controller && typeof childMgr.destroy === 'function') {
            childMgr.destroy();
          }
        } catch {}
      });
      if (bridge && typeof bridge.dispose === 'function') {
        try {
          bridge.dispose();
        } catch {}
      }
      try {
        delete win.__agyLoadingStatusBarCompanion;
        delete win.__agyLoadingKoThoughtCompanion;
        delete win.__agyProbingRcInstance;
        if (!win.agyStatusBar) {
          delete win.__agyCapturedLsClient;
        }
      } catch {}
      if (win.agyMcpManager === controller) {
        delete win.agyMcpManager;
        delete win.__agyMcpManagerActive;
      }
    },
  };

  win.agyMcpManager = controller;
  win.__agyMcpManagerActive = MCP_MANAGER_VERSION;
  return controller;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (window.__agyMcpDomReadyHandler && typeof document.removeEventListener === 'function') {
    document.removeEventListener('DOMContentLoaded', window.__agyMcpDomReadyHandler);
    delete window.__agyMcpDomReadyHandler;
  }
  if (document.readyState === 'loading') {
    const onDomReady = () => {
      if (window.__agyMcpDomReadyHandler === onDomReady) {
        delete window.__agyMcpDomReadyHandler;
      }
      mountMcpManager();
    };
    window.__agyMcpDomReadyHandler = onDomReady;
    document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
  } else {
    mountMcpManager();
  }
}

module.exports = {
  MCP_MANAGER_VERSION,
  mountMcpManager,
  ensureRemoteCompanionScripts,
  cleanupLegacyStatusBarArtifacts,
  isOwnMcpNode,
  isRelevantMutationList,
  schema,
  createHostMcpBridge,
  createModalController,
};
