/**
 * Shared Headless Chromium/Edge CDP Test Harness (`test/helpers/cdp-browser.mjs`).
 *
 * SOLID Responsibility (SRP):
 * - Single source of truth for locating Chromium/Edge, allocating ephemeral CDP ports,
 *   capturing stderr on launch failure, connecting CDP WebSocket sessions, and simulating
 *   Extenra (`extenra`, v3.3.1) `AddonManifest.v3` + `AddonContextV3` browser host runtime contract
 *   (3-Tier UI, `PlacementSpec` + mobile `<=640px` sheet, 17-primitive declarative schema incl. `segmented` +
 *   `handle.update`, `ctx.storage`, `ctx.configBridge`, `ctx.lifecycle.signal`, and minimal-permission
 *   ISP namespace gating).
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
 * Builds an inline browser script that mirrors Extenra (`extenra`, v3.3.1) `AddonContextV3`:
 * - Minimal ISP namespaces: `net` and `dom` omitted when undeclared; `configBridge` omitted on remote-web
 * - Tier 1: `showToast`, `confirm`, `prompt`, `registerCommand`, `registerStatusItem`, `registerSectionAction`, `registerSettingsPage`
 * - Tier 2: `openPanel` / `openPopup` / `openModal` with 17-primitive declarative schema renderer (incl. `segmented`),
 *   `handle.update(nextTree, nextState)` ID-based patching, and responsive mobile `<=640px` bottom-sheet
 * - Tier 3: ShadowRoot canvas `bodyEl` + `createStyleElementSafe` + `--ag-*` tokens
 * - `storage` (KV + `onDidChange`), `theme`, `i18n`, `events`, `services`, `lifecycle.signal` / `onDispose`
 */
export function buildAddonContextV3HarnessScript(manifest, opts = {}) {
  const surface = opts.surface === 'remote-web' ? 'remote-web' : 'desktop';
  const locale = String(opts.locale || 'en-US');
  const themeMode = opts.themeMode === 'light' ? 'light' : 'dark';
  const pluginId = String(manifest.pluginId);
  const displayName = String(manifest.displayName || pluginId);
  const version = String(manifest.version || '4.0.0');
  const trustLevel = surface === 'remote-web' ? 'restricted' : String(manifest.trustLevel || 'restricted');
  const cbScopes =
    surface === 'desktop' && trustLevel === 'trusted' && Array.isArray(manifest.permissions?.configBridge?.scopes)
      ? manifest.permissions.configBridge.scopes
      : [];

  return `(function(){
    'use strict';
    const pluginId = ${JSON.stringify(pluginId)};
    const displayName = ${JSON.stringify(displayName)};
    const version = ${JSON.stringify(version)};
    const surface = ${JSON.stringify(surface)};
    const trustLevel = ${JSON.stringify(trustLevel)};
    const locale = ${JSON.stringify(locale)};
    const themeMode = ${JSON.stringify(themeMode)};
    const cbScopes = ${JSON.stringify(cbScopes)};

    const abortController = new AbortController();
    const disposers = [];
    const managedListeners = [];
    const statusItems = new Map();
    const sectionActions = new Map();
    const settingsPages = new Map();
    const commands = new Map();
    const toasts = [];
    const activeOverlays = new Set();
    const storageMap = new Map();
    const storageListeners = new Set();
    const themeListeners = new Set();
    const localeListeners = new Set();
    const escapeStack = [];
    let disposed = false;
    let overlaySeq = 0;

    function assertActive() {
      if (disposed) throw new Error('ERR_HANDLE_DISPOSED:' + pluginId);
    }

    function detectLayoutMode() {
      const w = Number(window.innerWidth) || 1280;
      if (w > 0 && w <= 640) return 'mobile';
      if (w > 0 && w <= 1024) return 'compact';
      return 'desktop';
    }

    function computePlacement(kind, spec = {}) {
      const vw = Number(window.innerWidth) || 1280;
      const vh = Number(window.innerHeight) || 800;
      const bp = Number(spec.mobileBreakpointPx) || 640;
      const isMobileSheet = !spec.disableMobileSheet && vw > 0 && vw <= bp;
      const zone = isMobileSheet ? 'sheet' : (spec.zone || (kind === 'panel' ? 'drawer' : kind === 'modal' ? 'surface-center' : 'anchor'));
      if (isMobileSheet) {
        return { zone: 'sheet', isMobileSheet: true, left: 0, top: Math.round(vh * 0.25), width: vw, height: Math.round(vh * 0.75) };
      }
      if (zone === 'drawer') {
        const width = Math.min(Number(spec.width) || 420, vw - 24);
        const side = spec.side === 'left' ? 'left' : 'right';
        return { zone: 'drawer', side, isMobileSheet: false, left: side === 'left' ? 0 : vw - width, top: 36, width, height: vh - 36 };
      }
      const width = Math.min(Number(spec.width) || 720, vw - 32);
      const height = Math.min(Number(spec.maxHeight || spec.height) || 680, vh - 60);
      return {
        zone: 'surface-center',
        isMobileSheet: false,
        left: Math.round((vw - width) / 2),
        top: Math.max(36, Math.round((vh - height) / 2)),
        width,
        height,
      };
    }

    function evalCondition(cond, state) {
      if (!cond || typeof cond !== 'object') return true;
      const val = cond.field ? state[cond.field] : undefined;
      if ('eq' in cond) return val === cond.eq;
      if ('neq' in cond) return val !== cond.neq;
      if ('truthy' in cond) return Boolean(val) === Boolean(cond.truthy);
      return true;
    }

    function renderSchemaTree(container, tree, state, onChange, onAction, idMap) {
      while (container.firstChild) container.removeChild(container.firstChild);
      idMap.clear();
      const buildNode = (node) => {
        if (!node || typeof node !== 'object') return null;
        let el;
        if (node.type === 'stack' || node.type === 'row' || node.type === 'section') {
          el = document.createElement('div');
          el.className = 'ag-' + node.type;
          if (node.type === 'section' && node.title) {
            const h = document.createElement('div');
            h.className = 'ag-section-title';
            h.textContent = node.title;
            el.appendChild(h);
          }
          for (const child of node.children || []) {
            const cEl = buildNode(child);
            if (cEl) el.appendChild(cEl);
          }
        } else if (node.type === 'heading' || node.type === 'text' || node.type === 'badge' || node.type === 'alert') {
          el = document.createElement('div');
          el.className = 'ag-' + node.type;
          el.textContent = String(node.text ?? node.label ?? '');
          if (node.variant) el.setAttribute('data-variant', node.variant);
        } else if (node.type === 'divider') {
          el = document.createElement('hr');
        } else if (node.type === 'button') {
          el = document.createElement('button');
          el.type = 'button';
          el.className = 'ag-btn';
          el.textContent = String(node.label ?? node.text ?? 'Action');
          el.addEventListener('click', () => onAction && onAction({ actionId: node.actionId, payload: node.payload, state: { ...state } }));
        } else if (node.type === 'segmented') {
          el = document.createElement('div');
          el.className = 'ag-segmented';
          el.setAttribute('role', 'group');
          el.setAttribute('data-ag-segmented', '1');
          if (node.label) el.setAttribute('aria-label', String(node.label));
          const currentVal = node.field && state[node.field] !== undefined ? String(state[node.field]) : '';
          for (const opt of node.options || []) {
            const optVal = typeof opt === 'object' ? String(opt.value) : String(opt);
            const optLabel = typeof opt === 'object' ? String(opt.label || opt.value) : String(opt);
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = optLabel;
            b.setAttribute('data-value', optVal);
            b.setAttribute('aria-pressed', optVal === currentVal ? 'true' : 'false');
            if (node.disabled) b.disabled = true;
            b.addEventListener('click', (ev) => {
              if (node.disabled || (ev && ev.isTrusted === false)) return;
              if (node.field) state[node.field] = optVal;
              if (onChange) onChange({ field: node.field, value: optVal, state: { ...state } });
            });
            el.appendChild(b);
          }
        } else if (node.type === 'select') {
          el = document.createElement('div');
          const sel = document.createElement('select');
          for (const opt of node.options || []) {
            const o = document.createElement('option');
            o.value = typeof opt === 'object' ? opt.value : String(opt);
            o.textContent = typeof opt === 'object' ? (opt.label || opt.value) : String(opt);
            sel.appendChild(o);
          }
          if (node.field && state[node.field] !== undefined) sel.value = String(state[node.field]);
          sel.addEventListener('change', () => {
            if (node.field) state[node.field] = sel.value;
            if (onChange) onChange({ field: node.field, value: sel.value, state: { ...state } });
          });
          el.appendChild(sel);
        } else if (node.type === 'list') {
          el = document.createElement('ul');
          el.className = 'ag-list';
          for (const item of node.items || []) {
            const li = document.createElement('li');
            const span = document.createElement('span');
            span.textContent = typeof item === 'object' ? (item.label || item.text || '') : String(item);
            li.appendChild(span);
            if (item && typeof item === 'object' && item.actionId) {
              const b = document.createElement('button');
              b.type = 'button';
              b.textContent = item.actionLabel || 'Open';
              b.setAttribute('data-ag-list-action', item.id || item.actionId);
              b.addEventListener('click', () => onAction && onAction({ actionId: item.actionId, payload: item.payload, state: { ...state } }));
              li.appendChild(b);
            }
            el.appendChild(li);
          }
        } else {
          el = document.createElement('div');
        }
        if (node.id) {
          el.setAttribute('data-ag-node-id', node.id);
          idMap.set(node.id, el);
        }
        if (node.visibleWhen && !evalCondition(node.visibleWhen, state)) {
          el.hidden = true;
          el.setAttribute('hidden', 'true');
        }
        return el;
      };
      const rootEl = buildNode(tree);
      if (rootEl) container.appendChild(rootEl);
    }

    function openOverlay(kind, opts = {}) {
      assertActive();
      const isModal = kind === 'modal';
      const el = document.createElement(isModal ? 'dialog' : 'div');
      el.setAttribute('data-addon-host-v3-overlay', kind);
      el.setAttribute('data-addon-host-owner', pluginId);
      el.setAttribute('translate', 'no');
      el.setAttribute('role', 'dialog');
      if (isModal) el.setAttribute('aria-modal', 'true');
      el.style.padding = '0';
      el.style.border = 'none';
      el.style.background = 'transparent';
      el.style.position = 'fixed';
      el.style.margin = '0';

      const shadowHost = isModal ? document.createElement('div') : el;
      if (isModal) el.appendChild(shadowHost);
      const sr = shadowHost.attachShadow({ mode: 'open' });

      const shell = document.createElement('div');
      shell.className = 'ag-ui-shell';
      shell.style.background = themeMode === 'light' ? '#ffffff' : '#161b24';
      shell.style.color = themeMode === 'light' ? '#111827' : '#f0f6fc';
      shell.style.border = '1px solid rgba(148,163,184,0.28)';
      shell.style.borderRadius = '10px';
      shell.style.display = 'flex';
      shell.style.flexDirection = 'column';
      shell.style.height = '100%';
      shell.style.overflow = 'hidden';

      const header = document.createElement('div');
      header.className = 'ag-ui-header';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'ag-ui-title';
      titleSpan.textContent = opts.title || '';
      const badge = document.createElement('span');
      badge.className = 'ag-ui-attribution';
      badge.textContent = displayName;
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'ag-ui-close';
      closeBtn.textContent = '×';
      header.appendChild(titleSpan);
      header.appendChild(badge);
      header.appendChild(closeBtn);

      const body = document.createElement('div');
      body.className = 'ag-ui-body';
      body.style.flex = '1 1 auto';
      body.style.overflow = 'auto';
      body.style.padding = '12px';

      shell.appendChild(header);
      shell.appendChild(body);
      sr.appendChild(shell);

      let closed = false;
      let curState = opts.state ? { ...opts.state } : {};
      let curTree = opts.tree || null;
      const idMap = new Map();

      const applyPlacement = () => {
        const p = computePlacement(kind, opts.placement || {});
        el.setAttribute('data-addon-host-zone', p.zone);
        el.style.left = p.left + 'px';
        el.style.top = p.top + 'px';
        el.style.width = p.width + 'px';
        el.style.height = p.height + 'px';
        return p;
      };

      const close = () => {
        if (closed) return false;
        closed = true;
        activeOverlays.delete(close);
        const idx = escapeStack.indexOf(close);
        if (idx !== -1) escapeStack.splice(idx, 1);
        window.removeEventListener('resize', applyPlacement);
        try { if (isModal && el.open) el.close(); } catch {}
        if (el.parentNode) el.parentNode.removeChild(el);
        if (typeof opts.onClose === 'function') opts.onClose();
        return true;
      };
      closeBtn.addEventListener('click', close);
      if (isModal) {
        el.addEventListener('cancel', (ev) => { ev.preventDefault(); close(); });
      }
      window.addEventListener('resize', applyPlacement);

      if (curTree) {
        renderSchemaTree(body, curTree, curState, opts.onChange, opts.onAction, idMap);
      }
      document.body.appendChild(el);
      if (isModal && typeof el.showModal === 'function') {
        try { el.showModal(); } catch {}
      }
      applyPlacement();
      activeOverlays.add(close);
      escapeStack.push(close);
      overlaySeq += 1;

      return Object.freeze({
        kind,
        element: el,
        bodyEl: curTree ? null : body,
        attributionBadge: badge,
        getPlacement: () => computePlacement(kind, opts.placement || {}),
        reposition: () => applyPlacement(),
        update(nextTree, nextState) {
          if (!curTree) throw new Error('ERR_OVERLAY_NOT_SCHEMA_DRIVEN');
          if (nextTree) curTree = nextTree;
          if (nextState) curState = { ...curState, ...nextState };
          renderSchemaTree(body, curTree, curState, opts.onChange, opts.onAction, idMap);
          applyPlacement();
        },
        getState: () => ({ ...curState }),
        getElementById: (nodeId) => idMap.get(nodeId) || null,
        close,
      });
    }

    window.addEventListener('keydown', (ev) => {
      if (!ev || ev.key !== 'Escape' || escapeStack.length === 0) return;
      if (ev.isComposing || ev.keyCode === 229 || ev.defaultPrevented) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      escapeStack[escapeStack.length - 1]();
    }, true);

    const storage = Object.freeze({
      get: async (k) => (storageMap.has(k) ? JSON.parse(JSON.stringify(storageMap.get(k))) : undefined),
      set: async (k, v) => {
        assertActive();
        const oldValue = storageMap.has(k) ? storageMap.get(k) : undefined;
        const cloned = JSON.parse(JSON.stringify(v));
        storageMap.set(k, cloned);
        for (const fn of Array.from(storageListeners)) {
          try { fn({ key: k, oldValue, newValue: cloned }); } catch {}
        }
        return true;
      },
      delete: async (k) => {
        assertActive();
        const oldValue = storageMap.get(k);
        const ok = storageMap.delete(k);
        if (ok) {
          for (const fn of Array.from(storageListeners)) {
            try { fn({ key: k, oldValue, newValue: undefined }); } catch {}
          }
        }
        return ok;
      },
      keys: async () => Array.from(storageMap.keys()),
      clear: async () => { storageMap.clear(); },
      onDidChange: (cb) => {
        storageListeners.add(cb);
        return () => storageListeners.delete(cb);
      },
    });

    const ui = Object.freeze({
      showToast: (opts) => {
        const rec = typeof opts === 'string' ? { message: opts, variant: 'info' } : { ...opts };
        toasts.push(rec);
        return { id: 'toast-' + toasts.length, dismiss() {} };
      },
      confirm: async () => true,
      prompt: async () => null,
      registerCommand: (commandId, spec) => {
        assertActive();
        commands.set(commandId, spec);
        const unregister = () => commands.delete(commandId);
        return Object.freeze({ unregister, dispose: unregister });
      },
      listCommands: () => Array.from(commands.entries()).map(([actionId, s]) => ({ pluginId, actionId, label: s.label || actionId })),
      invokeCommand: (_pid, commandId, ...args) => commands.get(commandId)?.run?.(...args),
      registerStatusItem: (spec) => {
        assertActive();
        const rec = { ...spec };
        statusItems.set(spec.id, rec);
        return Object.freeze({
          id: spec.id,
          update: (patch) => Object.assign(rec, patch),
          dispose: () => statusItems.delete(spec.id),
        });
      },
      registerSectionAction: (spec) => {
        assertActive();
        const rec = { ...spec };
        sectionActions.set(spec.id, rec);
        return Object.freeze({
          id: spec.id,
          target: spec.target,
          update: (patch) => Object.assign(rec, patch),
          dispose: () => sectionActions.delete(spec.id),
        });
      },
      registerSettingsPage: (spec) => {
        assertActive();
        let activeHandle = null;
        const open = () => {
          if (activeHandle) activeHandle.close();
          activeHandle = openOverlay('modal', {
            title: spec.title,
            placement: { zone: 'surface-center', width: spec.width || 720 },
            onClose: () => {
              activeHandle = null;
              if (typeof spec.onClose === 'function') spec.onClose();
            },
          });
          if (typeof spec.render === 'function' && activeHandle.bodyEl) {
            spec.render(activeHandle.bodyEl, activeHandle);
          }
          return activeHandle;
        };
        settingsPages.set(spec.id, { spec, open });
        return Object.freeze({
          id: spec.id,
          open,
          update() {},
          dispose: () => {
            if (activeHandle) activeHandle.close();
            settingsPages.delete(spec.id);
          },
        });
      },
      openPopup: (opts) => openOverlay('popup', opts),
      openModal: (opts) => openOverlay('modal', opts),
      openPanel: (opts) => openOverlay('panel', opts),
      createStyleElementSafe: (cssText) => {
        if (/@import\\b|expression\\s*\\(|javascript\\s*:|<\\s*\\/\\s*style/i.test(cssText)) {
          throw new Error('ERR_UNSAFE_CSS_CONSTRUCT');
        }
        const styleEl = document.createElement('style');
        styleEl.setAttribute('data-addon-host-owner', pluginId);
        styleEl.textContent = String(cssText);
        return styleEl;
      },
      mountCanvas: () => { throw new Error('ERR_NOT_USED'); },
      injectStyle: () => null,
      removeStyle: () => false,
      getSurfaceBounds: () => ({ width: window.innerWidth, height: window.innerHeight }),
      getActiveSurface: () => ({ surfaceId: 'viewport' }),
      listSurfaces: () => Object.freeze(['viewport']),
    });

    const lifecycle = Object.freeze({
      signal: abortController.signal,
      onDispose: (fn) => { if (typeof fn === 'function') disposers.push(fn); },
      addManagedListener: (target, type, fn, listenerOpts) => {
        target.addEventListener(type, fn, listenerOpts);
        const detach = () => target.removeEventListener(type, fn, listenerOpts);
        managedListeners.push(detach);
        return detach;
      },
      runSafe: (fn) => fn(),
      dispose() {
        if (disposed) return;
        disposed = true;
        abortController.abort();
        for (const fn of disposers.splice(0)) { try { fn(); } catch {} }
        for (const d of managedListeners.splice(0)) { try { d(); } catch {} }
        for (const close of Array.from(activeOverlays)) { try { close(); } catch {} }
        activeOverlays.clear();
        statusItems.clear();
        sectionActions.clear();
        settingsPages.clear();
        commands.clear();
      },
    });

    const configBridgeObj =
      cbScopes.length > 0 && window.__TEST_V3_CONFIG_BRIDGE__
        ? Object.freeze({
            scopes: Object.freeze(cbScopes.map((s) => Object.freeze({ ...s }))),
            read: (scopeId) => window.__TEST_V3_CONFIG_BRIDGE__.read(scopeId),
            write: (scopeId, payload, writeOpts) => window.__TEST_V3_CONFIG_BRIDGE__.write(scopeId, payload, writeOpts),
          })
        : undefined;

    const ctx = Object.freeze({
      apiVersion: 3,
      meta: Object.freeze({ pluginId, displayName, version, trustLevel, sourceSchemaVersion: 3 }),
      env: Object.freeze({
        surface,
        get layoutMode() { return detectLayoutMode(); },
        capabilities: Object.freeze({
          hasLocalLoopback: false,
          hasNetHttps: false,
          hasConfigBridge: Boolean(configBridgeObj),
          hasSettingsBridge: false,
          hasDocumentTransform: false,
        }),
      }),
      theme: Object.freeze({
        getMode: () => themeMode,
        getTokens: () => Object.freeze({}),
        getTokenCss: () => '',
        onDidChange: (cb) => { themeListeners.add(cb); return () => themeListeners.delete(cb); },
      }),
      i18n: Object.freeze({
        getLocale: () => locale,
        t: (k) => k,
        onDidChange: (cb) => { localeListeners.add(cb); return () => localeListeners.delete(cb); },
      }),
      ui,
      storage,
      events: Object.freeze({ on: () => () => {}, once: () => () => {}, emit: () => 0 }),
      services: Object.freeze({ provide: () => ({ name: '', dispose() {} }), has: () => false, list: () => [], call: () => undefined }),
      lifecycle,
      ...(configBridgeObj ? { configBridge: configBridgeObj } : {}),
    });

    window.__TEST_ADDON_CTX_V3__ = ctx;
    window.__TEST_V3_DIAG__ = {
      getStatusItems: () => Array.from(statusItems.values()),
      clickStatusItem: (id) => statusItems.get(id)?.onClick?.({ pluginId, itemId: id, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, anchorEl: null }),
      getSectionActions: () => Array.from(sectionActions.values()),
      clickSectionAction: (id) => sectionActions.get(id)?.onClick?.({ pluginId, actionId: id, target: sectionActions.get(id)?.target || '', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, anchorEl: null }),
      getSettingsPages: () => Array.from(settingsPages.keys()),
      openSettingsPage: (id) => settingsPages.get(id)?.open?.(),
      getCommands: () => Array.from(commands.keys()),
      runCommand: (id) => commands.get(id)?.run?.(),
      getToasts: () => toasts.slice(),
      getStorageSnapshot: () => Object.fromEntries(storageMap.entries()),
      dispose: () => lifecycle.dispose(),
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
