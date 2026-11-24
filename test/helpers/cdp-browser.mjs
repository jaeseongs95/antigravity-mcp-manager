/**
 * Shared Headless Chromium/Edge CDP Test Harness (`test/helpers/cdp-browser.mjs`).
 *
 * SOLID Responsibility (SRP):
 * - Single source of truth for locating Chromium/Edge, allocating ephemeral CDP ports,
 *   capturing stderr on launch failure, connecting CDP WebSocket sessions (including OOPIF
 *   iframes), and simulating the exact `AddonManifest.v2` `addonHost` capability handle
 *   contract from `antigravity-native-addon-host` v2.0.0 / v2.1.0 (`slot-manager.js`,
 *   `style-manager.js`, `modal-portal.js`, `kernel.js`).
 */

import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';

export function findChromiumBinary() {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/microsoft-edge',
          ];
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

export function getFreeTcpPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

export async function waitUntil(fn, timeoutMs = 8000, intervalMs = 40) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return Boolean(await fn());
}

/**
 * Builds an inline browser script that mirrors `antigravity-native-addon-host` v2.0.0/v2.1.0's
 * `kernel.js` + `slot-manager.js` + `style-manager.js` + `modal-portal.js` contract:
 * - Option B2 Shadow DOM slots (`shadow: true` by default in v2; `restricted` cannot downgrade)
 * - Strict `mountSlot(slotId, { container, shadow, tagName, fallbackToBody })` signature
 * - `translate="no"`, `data-addon-host-no-translate="true"`, `data-agy-no-translate="true"`
 * - Owner-scoped CSS validation & `scopeCssToOwner` with automatic ShadowRoot style routing
 * - Native `<dialog>.showModal()` `openModal(slotId, { shadow, onClose })` + `PortalArbiter`
 *   state counter + titlebar safe `marginTop` + `zIndex` + capture-phase IME-safe `Escape` LIFO
 * - `addManagedListener`, `onDispose`, and deterministic `dispose()` teardown
 */
export function buildAddonHostHarnessScript(manifest, harnessOpts = {}) {
  const schemaVersion = Number(manifest.schemaVersion || 2);
  const trustLevel = String(manifest.trustLevel || 'restricted');
  const pluginId = String(manifest.pluginId);
  const version = String(manifest.version || '0.0.0');
  const noTranslate = !manifest.isolation || manifest.isolation.noTranslate !== false;
  const enableSurfaceGeometry = Boolean(harnessOpts && harnessOpts.enableSurfaceGeometry);
  const uiSlots = (manifest.uiSlots || []).map((s) => ({
    slotId: s.slotId,
    slot: s.slot,
    shadow: s.slot === 'document-transform' ? false : typeof s.shadow === 'boolean' ? s.shadow : schemaVersion >= 2,
  }));

  return `(function(){
    'use strict';
    const pluginId = ${JSON.stringify(pluginId)};
    const version = ${JSON.stringify(version)};
    const trustLevel = ${JSON.stringify(trustLevel)};
    const schemaVersion = ${JSON.stringify(schemaVersion)};
    const noTranslate = ${JSON.stringify(noTranslate)};
    const enableSurfaceGeometry = ${JSON.stringify(enableSurfaceGeometry)};
    const slotDefs = Object.create(null);
    for (const def of ${JSON.stringify(uiSlots)}) slotDefs[def.slotId] = def;

    const mountedSlots = new Map();
    const styleRecords = new Map();
    const shadowRootsBySlot = new Map();
    const modalStack = [];
    const modalCalls = [];
    const managedListeners = [];
    const disposers = [];
    let modalSeq = 0;
    let disposed = false;
    let portalClaimActive = false;
    const portalTransitions = [];

    function assertActive() {
      if (disposed) throw new Error('ERR_HANDLE_DISPOSED:' + pluginId);
    }

    function applyNoTranslate(el) {
      if (!noTranslate) return;
      el.setAttribute('translate', 'no');
      el.setAttribute('data-addon-host-no-translate', 'true');
      el.setAttribute('data-agy-no-translate', 'true');
    }

    function validateOwnerCss(cssText) {
      if (typeof cssText !== 'string') throw new Error('ERR_CSS_NOT_STRING');
      if (/@import\\b|expression\\s*\\(|javascript\\s*:|@charset\\b|<\\s*\\/\\s*style/i.test(cssText)) {
        throw new Error('ERR_UNSAFE_CSS_CONSTRUCT');
      }
      if (/:\\s*has\\s*\\(/i.test(cssText)) {
        throw new Error('ERR_FORBIDDEN_CSS_NESTING');
      }
    }

    function scopeCssToOwner(cssText) {
      const ownerPrefix = '[data-addon-host-owner="' + pluginId.replace(/"/g, '\\\\"') + '"]';
      const clean = String(cssText || '').replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ');
      return clean.replace(/([^{}]+)\\{([^{}]*)\\}/g, (_m, prelude, body) => {
        const trimmedPrelude = prelude.trim();
        if (trimmedPrelude.startsWith('@')) return prelude + '{' + body + '}';
        const scoped = prelude
          .split(',')
          .map((sel) => {
            const t = sel.trim();
            if (!t) return '';
            if (t.startsWith(':host')) return t;
            if (
              t === ownerPrefix ||
              t.startsWith(ownerPrefix + ' ') ||
              t.startsWith(ownerPrefix + '>') ||
              t.startsWith(ownerPrefix + '.') ||
              t.startsWith(ownerPrefix + '#') ||
              t.startsWith(ownerPrefix + ':') ||
              t.startsWith(ownerPrefix + '[')
            ) {
              return t;
            }
            if (/^(?:html|body|:root)(?![a-z0-9_-])/i.test(t)) {
              return t.replace(/^(?:html|body|:root)(?![a-z0-9_-])/i, ownerPrefix);
            }
            return ownerPrefix + ' ' + t;
          })
          .filter(Boolean)
          .join(', ');
        return scoped + ' {' + body + '}';
      });
    }

    function upsertStyleEl(parentNode, existingEl, styleId, scope, finalCss) {
      if (!parentNode || typeof parentNode.appendChild !== 'function') return null;
      let el = existingEl;
      if (!el || !el.parentNode) {
        el = document.createElement('style');
        el.setAttribute('data-addon-host-owner', pluginId);
        el.setAttribute('data-addon-host-style', pluginId + ':' + styleId);
        el.setAttribute('data-addon-host-style-scope', scope);
        parentNode.appendChild(el);
      }
      el.textContent = finalCss;
      return el;
    }

    function removeHeadStyle(rec) {
      if (rec && rec.headEl && rec.headEl.parentNode) {
        rec.headEl.parentNode.removeChild(rec.headEl);
      }
      if (rec) rec.headEl = null;
    }

    function registerShadowRoot(slotId, shadowRoot) {
      if (!shadowRoot) return;
      let set = shadowRootsBySlot.get(slotId);
      if (!set) {
        set = new Set();
        shadowRootsBySlot.set(slotId, set);
      }
      set.add(shadowRoot);
      for (const rec of styleRecords.values()) {
        if (rec.slotId && rec.slotId !== slotId) continue;
        const el = upsertStyleEl(shadowRoot, rec.shadowEls.get(shadowRoot), rec.styleId, rec.scope, rec.finalCss);
        if (el) rec.shadowEls.set(shadowRoot, el);
        if (rec.slotId === slotId && rec.headEl) {
          removeHeadStyle(rec);
        }
      }
    }

    function unregisterShadowRoot(slotId, shadowRoot) {
      const set = shadowRootsBySlot.get(slotId);
      if (!set) return;
      set.delete(shadowRoot);
      for (const rec of styleRecords.values()) {
        const el = rec.shadowEls.get(shadowRoot);
        if (el && el.parentNode) el.parentNode.removeChild(el);
        rec.shadowEls.delete(shadowRoot);
      }
      if (set.size === 0) shadowRootsBySlot.delete(slotId);
    }

    function resolveUseShadow(slotDef, opts) {
      if (slotDef.slot === 'document-transform') return false;
      if (opts && typeof opts.shadow === 'boolean' && (opts.shadow === true || trustLevel === 'trusted' || !slotDef.shadow)) {
        return opts.shadow;
      }
      return Boolean(slotDef.shadow);
    }

    function notifyPortalState() {
      const nextActive = modalStack.length > 0;
      if (nextActive === portalClaimActive) return;
      portalClaimActive = nextActive;
      portalTransitions.push(nextActive);
    }

    function closeModalEntry(entry) {
      const idx = modalStack.indexOf(entry);
      if (idx === -1) return false;
      entry.closing = true;
      modalStack.splice(idx, 1);
      if (entry.shadowRoot) unregisterShadowRoot(entry.slotId, entry.shadowRoot);
      if (typeof entry.onResizeCleanup === 'function') {
        try { entry.onResizeCleanup(); } catch {}
        entry.onResizeCleanup = null;
      }
      try {
        if (typeof entry.el.close === 'function' && entry.el.open) entry.el.close();
      } catch {}
      if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
      if (entry.prevFocus && typeof entry.prevFocus.focus === 'function') {
        try { entry.prevFocus.focus(); } catch {}
      }
      if (typeof entry.onClose === 'function') {
        try { entry.onClose(); } catch {}
      }
      notifyPortalState();
      return true;
    }

    function computeSurfaceBounds(surfaceIdOrOpts) {
      const vw = Number(window.innerWidth) || 0;
      const vh = Number(window.innerHeight) || 0;
      const requested =
        typeof surfaceIdOrOpts === 'string' && surfaceIdOrOpts.trim()
          ? surfaceIdOrOpts.trim()
          : surfaceIdOrOpts && typeof surfaceIdOrOpts.surface === 'string' && surfaceIdOrOpts.surface.trim()
            ? surfaceIdOrOpts.surface.trim()
            : 'auto';
      let left = 0;
      let top = 36;
      let right = vw;
      let bottom = vh;
      let matched = false;
      let source = 'viewport';
      let surfaceId = requested === 'auto' || requested === 'active' ? 'viewport' : requested;

      if (requested === 'customizations-page' || requested === 'auto') {
        const directEl = document.querySelector('[data-testid="customizations-view"]');
        const rect = directEl ? directEl.getBoundingClientRect() : null;
        if (rect && rect.width > 0 && rect.height > 0) {
          left = Math.max(0, rect.left);
          top = Math.max(36, rect.top);
          right = Math.min(vw, rect.right);
          bottom = Math.min(vh, rect.bottom);
          matched = true;
          source = 'selector';
          surfaceId = 'customizations-page';
        } else {
          const leftChrome = document.querySelector('[data-testid="sidebar"], [data-testid="left-sidebar"], aside, nav');
          const lr = leftChrome ? leftChrome.getBoundingClientRect() : null;
          if (lr && lr.width > 0 && lr.left <= 12 && lr.right < vw * 0.65) {
            left = lr.right;
            matched = true;
            source = 'chrome-subtracted';
            surfaceId = 'customizations-page';
          }
        }
      }

      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      return Object.freeze({
        surfaceId,
        requestedSurfaceId: requested,
        matched,
        source,
        left,
        top,
        right,
        bottom,
        width,
        height,
        centerX: left + width / 2,
        centerY: top + height / 2,
        insetLeft: left,
        insetTop: top,
        insetRight: Math.max(0, vw - right),
        insetBottom: Math.max(0, vh - bottom),
        viewport: Object.freeze({ width: vw, height: vh }),
      });
    }

    window.addEventListener(
      'keydown',
      (ev) => {
        if (!ev || ev.key !== 'Escape' || modalStack.length === 0) return;
        if (ev.isComposing || ev.keyCode === 229 || ev.defaultPrevented) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        closeModalEntry(modalStack[modalStack.length - 1]);
      },
      true
    );

    const handle = Object.freeze({
      pluginId,
      version,
      trustLevel,
      schemaVersion,
      sourceSchemaVersion: schemaVersion,
      hasSettingsBridge: false,
      mountSlot(slotId, opts) {
        assertActive();
        const slotDef = slotDefs[slotId];
        if (!slotDef) throw new Error('ERR_UNDECLARED_SLOT:' + pluginId + ':' + slotId);
        const options = opts && typeof opts === 'object' ? opts : {};
        const existing = mountedSlots.get(slotId);
        if (existing && existing.hostEl) {
          if (existing.hostEl.isConnected) return existing.rootEl;
          if (existing.shadowRoot) unregisterShadowRoot(slotId, existing.shadowRoot);
          mountedSlots.delete(slotId);
        }
        const container = options.container || (options.fallbackToBody ? document.body : null);
        if (!container || typeof container.appendChild !== 'function') return null;

        const useShadow = resolveUseShadow(slotDef, options);
        const hostEl = document.createElement('div');
        hostEl.setAttribute('data-addon-host-owner', pluginId);
        hostEl.setAttribute('data-addon-host-slot', slotId);
        hostEl.setAttribute('data-addon-host-slot-kind', slotDef.slot);
        applyNoTranslate(hostEl);
        container.appendChild(hostEl);

        let rootEl = hostEl;
        let shadowRoot = null;
        if (useShadow && typeof hostEl.attachShadow === 'function') {
          shadowRoot = hostEl.attachShadow({ mode: 'open' });
          const inner = document.createElement('div');
          inner.className = 'addon-host-slot-root';
          inner.setAttribute('data-addon-host-owner', pluginId);
          inner.setAttribute('data-addon-host-slot', slotId);
          shadowRoot.appendChild(inner);
          rootEl = inner;
          registerShadowRoot(slotId, shadowRoot);
        }

        mountedSlots.set(slotId, { hostEl, rootEl, shadowRoot, slotDef });
        return rootEl;
      },
      unmountSlot(slotId) {
        assertActive();
        const rec = mountedSlots.get(slotId);
        if (!rec) return false;
        if (rec.shadowRoot) unregisterShadowRoot(slotId, rec.shadowRoot);
        if (rec.hostEl && rec.hostEl.parentNode) rec.hostEl.parentNode.removeChild(rec.hostEl);
        mountedSlots.delete(slotId);
        return true;
      },
      injectStyle(styleId, cssText, opts) {
        assertActive();
        const options = opts && typeof opts === 'object' ? opts : {};
        const scope = options.scope ? String(options.scope) : 'owner';
        if (scope === 'global' && trustLevel !== 'trusted') {
          throw new Error('ERR_RESTRICTED_GLOBAL_CSS_FORBIDDEN');
        }
        validateOwnerCss(cssText);
        const slotId = typeof options.slotId === 'string' && options.slotId ? options.slotId : null;
        const finalCss = scope === 'global' ? String(cssText) : scopeCssToOwner(cssText);
        let rec = styleRecords.get(styleId);
        if (!rec) {
          rec = { styleId, scope, slotId, finalCss, headEl: null, shadowEls: new Map() };
          styleRecords.set(styleId, rec);
        } else {
          rec.scope = scope;
          rec.slotId = slotId;
          rec.finalCss = finalCss;
        }
        const specificSet = slotId ? shadowRootsBySlot.get(slotId) : null;
        if (specificSet && specificSet.size > 0) {
          removeHeadStyle(rec);
          let firstEl = null;
          for (const sr of specificSet) {
            const el = upsertStyleEl(sr, rec.shadowEls.get(sr), styleId, scope, finalCss);
            if (el) {
              rec.shadowEls.set(sr, el);
              if (!firstEl) firstEl = el;
            }
          }
          return firstEl;
        }
        const head = document.head || document.documentElement || document.body;
        rec.headEl = upsertStyleEl(head, rec.headEl, styleId, scope, finalCss);
        for (const [sId, srSet] of shadowRootsBySlot.entries()) {
          if (slotId && slotId !== sId) continue;
          for (const sr of srSet) {
            const el = upsertStyleEl(sr, rec.shadowEls.get(sr), styleId, scope, finalCss);
            if (el) rec.shadowEls.set(sr, el);
          }
        }
        return rec.headEl;
      },
      removeStyle(styleId) {
        assertActive();
        const rec = styleRecords.get(styleId);
        if (!rec) return false;
        removeHeadStyle(rec);
        for (const el of rec.shadowEls.values()) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        }
        styleRecords.delete(styleId);
        return true;
      },
      openModal(slotId, opts) {
        assertActive();
        const slotDef = slotDefs[slotId];
        if (!slotDef) throw new Error('ERR_UNDECLARED_SLOT:' + pluginId + ':' + slotId);
        if (slotDef.slot !== 'modal' && slotDef.slot !== 'overlay') {
          throw new Error('ERR_INVALID_MODAL_SLOT_KIND:' + slotDef.slot);
        }
        const options = opts && typeof opts === 'object' ? opts : {};
        modalCalls.push({
          slotId,
          surface: typeof options.surface === 'string' ? options.surface : null,
          align: typeof options.align === 'string' ? options.align : null,
        });
        const prevFocus = document.activeElement || null;
        const dlg = document.createElement('dialog');
        dlg.setAttribute('data-addon-host-modal-dialog', '1');
        dlg.setAttribute('data-addon-host-owner', pluginId);
        dlg.setAttribute('data-addon-host-slot', slotId);
        dlg.setAttribute('role', 'dialog');
        dlg.setAttribute('aria-modal', 'true');
        applyNoTranslate(dlg);
        dlg.style.marginTop = 'max(env(titlebar-area-height, 36px), 36px)';
        dlg.style.zIndex = String(2147483000 + modalStack.length + 1);

        const useShadow = resolveUseShadow(slotDef, options);
        let bodyEl = dlg;
        let shadowRoot = null;
        if (useShadow) {
          const wrap = document.createElement('div');
          wrap.className = 'addon-host-modal-shadow-host';
          wrap.setAttribute('data-addon-host-owner', pluginId);
          wrap.setAttribute('data-addon-host-slot', slotId);
          dlg.appendChild(wrap);
          shadowRoot = wrap.attachShadow({ mode: 'open' });
          const inner = document.createElement('div');
          inner.className = 'addon-host-slot-root';
          inner.setAttribute('data-addon-host-owner', pluginId);
          inner.setAttribute('data-addon-host-slot', slotId);
          shadowRoot.appendChild(inner);
          bodyEl = inner;
          registerShadowRoot(slotId, shadowRoot);
        }

        (document.body || document.documentElement).appendChild(dlg);
        const requestedSurface =
          typeof options.surface === 'string' && options.surface.trim()
            ? options.surface.trim()
            : options.align === 'surface'
              ? 'auto'
              : null;
        const applySurfaceBounds = (targetSurface) => {
          if (!enableSurfaceGeometry) return null;
          const bounds = computeSurfaceBounds(targetSurface || 'auto');
          if (bounds && dlg.style) {
            dlg.setAttribute('data-addon-host-modal-surface', bounds.surfaceId);
            if (bounds.viewport && bounds.viewport.width > 0 && bounds.viewport.height > 0) {
              dlg.style.position = 'fixed';
              dlg.style.inset = '';
              dlg.style.left = bounds.insetLeft + 'px';
              dlg.style.top = bounds.insetTop + 'px';
              dlg.style.right = bounds.insetRight + 'px';
              dlg.style.bottom = bounds.insetBottom + 'px';
              dlg.style.margin = 'auto';
              dlg.style.maxWidth = Math.max(120, Math.floor(bounds.width - 24)) + 'px';
              dlg.style.maxHeight = Math.max(120, Math.floor(bounds.height - 24)) + 'px';
            }
          }
          return bounds;
        };
        const entry = {
          id: 'modal-' + (++modalSeq),
          slotId,
          el: dlg,
          bodyEl,
          shadowRoot,
          prevFocus,
          surfaceTarget: requestedSurface,
          onResizeCleanup: null,
          onClose: options.onClose || null,
        };
        if (enableSurfaceGeometry && requestedSurface) {
          applySurfaceBounds(requestedSurface);
          const handleResize = () => {
            if (entry.closing || !modalStack.includes(entry)) return;
            applySurfaceBounds(entry.surfaceTarget);
          };
          window.addEventListener('resize', handleResize);
          entry.onResizeCleanup = () => window.removeEventListener('resize', handleResize);
        }
        dlg.addEventListener('cancel', (ev) => {
          if (ev.cancelable) ev.preventDefault();
          closeModalEntry(modalStack[modalStack.length - 1]);
        });
        dlg.addEventListener('close', () => {
          closeModalEntry(entry);
        });
        modalStack.push(entry);
        if (typeof dlg.showModal === 'function') {
          try { dlg.showModal(); } catch {}
        }
        notifyPortalState();
        const modalHandle = {
          id: entry.id,
          element: dlg,
          bodyEl,
          close: () => closeModalEntry(entry),
        };
        if (enableSurfaceGeometry) {
          modalHandle.reposition = (nextSurface) => {
            if (entry.closing || !modalStack.includes(entry)) return null;
            if (typeof nextSurface === 'string' && nextSurface.trim()) {
              entry.surfaceTarget = nextSurface.trim();
            } else if (!entry.surfaceTarget) {
              entry.surfaceTarget = 'auto';
            }
            return applySurfaceBounds(entry.surfaceTarget);
          };
        }
        return Object.freeze(modalHandle);
      },
      ...(enableSurfaceGeometry
        ? {
            getSurfaceBounds(surfaceIdOrOpts) {
              assertActive();
              return computeSurfaceBounds(surfaceIdOrOpts);
            },
            getActiveSurface() {
              assertActive();
              return computeSurfaceBounds('auto');
            },
            listSurfaces() {
              assertActive();
              return Object.freeze(['settings-pane', 'customizations-page', 'automation-page', 'workspace', 'viewport']);
            },
          }
        : {}),
      addManagedListener(target, type, listener, opts) {
        assertActive();
        if (!target || typeof target.addEventListener !== 'function') return () => {};
        target.addEventListener(type, listener, opts);
        let active = true;
        const detach = () => {
          if (!active) return;
          active = false;
          try { target.removeEventListener(type, listener, opts); } catch {}
        };
        managedListeners.push(detach);
        return detach;
      },
      onDispose(fn) {
        assertActive();
        if (typeof fn === 'function') disposers.push(fn);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const fn of disposers.splice(0)) {
          try { fn(); } catch {}
        }
        for (const detach of managedListeners.splice(0)) {
          try { detach(); } catch {}
        }
        for (const entry of modalStack.slice()) {
          closeModalEntry(entry);
        }
        for (const [slotId, rec] of Array.from(mountedSlots.entries())) {
          if (rec.shadowRoot) unregisterShadowRoot(slotId, rec.shadowRoot);
          if (rec.hostEl && rec.hostEl.parentNode) rec.hostEl.parentNode.removeChild(rec.hostEl);
          mountedSlots.delete(slotId);
        }
        for (const [styleId, rec] of Array.from(styleRecords.entries())) {
          removeHeadStyle(rec);
          for (const el of rec.shadowEls.values()) {
            if (el && el.parentNode) el.parentNode.removeChild(el);
          }
          styleRecords.delete(styleId);
        }
      },
    });

    window.__TEST_ADDON_HOST__ = handle;
    window.__TEST_ADDON_HOST_DIAG__ = {
      getPortalTransitions: () => portalTransitions.slice(),
      getPortalActive: () => portalClaimActive,
      getOpenModalCount: () => modalStack.length,
      getModalCalls: () => modalCalls.slice(),
    };
  })();`;
}

export async function launchCdpSession({
  browserBin,
  profileDir,
  iframeOrigin = null,
  startupTimeoutMs = 30000,
}) {
  const cdpPort = await getFreeTcpPort();
  const stderrChunks = [];
  const browser = spawn(
    browserBin,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  browser.stderr?.on('data', (chunk) => {
    if (stderrChunks.length < 20) stderrChunks.push(String(chunk));
  });

  let ws = null;
  const close = async () => {
    if (ws) {
      try {
        ws.close();
      } catch {}
      ws = null;
    }
    try {
      browser.kill();
    } catch {}
    await new Promise((resolve) => {
      if (browser.exitCode !== null) return resolve();
      const timer = setTimeout(resolve, 3000);
      browser.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  try {
    let wsUrl = null;
    await waitUntil(
      async () => {
        if (browser.exitCode !== null) return true;
        try {
          const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
          if (res.ok) {
            const targets = await res.json();
            const page = targets.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
            if (page) {
              wsUrl = page.webSocketDebuggerUrl;
              return true;
            }
          }
        } catch {}
        return false;
      },
      startupTimeoutMs,
      100
    );

    if (!wsUrl) {
      const stderrText = stderrChunks.join('').trim().slice(0, 600);
      throw new Error(
        `Headless browser did not expose CDP target on port ${cdpPort} (exitCode=${browser.exitCode}): ${stderrText || 'no stderr'}`
      );
    }

    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    let seq = 0;
    const pending = new Map();
    const exceptions = [];
    let iframeSessionId = null;
    let iframeContextId = null;

    const cdp = (method, params = {}, sessionId = undefined) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      });

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Target.attachedToTarget') {
        const info = msg.params?.targetInfo;
        const sid = msg.params?.sessionId;
        if (sid && info && (info.type === 'iframe' || (iframeOrigin && String(info.url || '').startsWith(iframeOrigin)))) {
          iframeSessionId = sid;
          void cdp('Runtime.enable', {}, sid).catch(() => {});
        }
      } else if (msg.method === 'Runtime.executionContextCreated') {
        const ctx = msg.params?.context;
        if (iframeOrigin && ctx && ctx.origin === iframeOrigin && ctx.auxData?.isDefault) {
          iframeContextId = ctx.id;
        }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        exceptions.push(msg.params?.exceptionDetails?.text || 'Uncaught exception');
      }
    });

    const evalMain = async (expression) => {
      const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
      return res.result?.value;
    };

    const evalIframe = async (expression) => {
      if (iframeSessionId) {
        const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, iframeSessionId);
        if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
        return res.result?.value;
      }
      const res = await cdp('Runtime.evaluate', {
        contextId: iframeContextId,
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
      return res.result?.value;
    };

    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

    return {
      cdp,
      evalMain,
      evalIframe,
      hasIframe: () => Boolean(iframeSessionId || iframeContextId),
      exceptions,
      close,
    };
  } catch (err) {
    await close();
    throw err;
  }
}
