/**
 * AddonManifest.v1 Main-Process Hook (`scripts/electron-hook.cjs`).
 *
 * Managed exclusively by `antigravity-native-addon-host` (`capabilities: ["mainHook", "renderer"]`).
 * Responsibilities (SRP / ISP / DIP):
 * - Owns the lifecycle of the verified local loopback MCP Manager server (`desktop-server.mjs`).
 * - Delivers the tokenized loopback URL strictly into Isolated World (`999`) ONLY for windows
 *   whose live URL passes `isAllowedRendererUrl(...)` (both before and after async server boot),
 *   preventing Main World (World 0) / `sessionStorage` token exposure.
 * - Attaches both newly created windows (`onWebContentsCreated`) and already-open windows when
 *   hot-activated on `Ctrl+R` (`activate` via `getExistingWebContents`), so hot-register + reload
 *   works without requiring an extra window creation.
 * - Cleans up `webContents` listeners, isolated-world URL state, `will-quit` handler, and the
 *   loopback HTTP server immediately on `dispose()`.
 * - NEVER touches `app.asar` and NEVER injects renderer UI scripts directly.
 */

'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEFAULT_ISOLATED_WORLD_ID = 999;
const DEFAULT_ALLOWED_PROTOCOLS = Object.freeze(['http:', 'https:']);
const DEFAULT_ALLOWED_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '::1', '[::1]']);
const ROOT_DIR = path.resolve(__dirname, '..');
const DESKTOP_SERVER_PATH = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'desktop-server.mjs');

function defaultStartDesktopServer() {
  return import(pathToFileURL(DESKTOP_SERVER_PATH).href).then((mod) => mod.startDesktopMcpServer());
}

function defaultGetExistingWebContents() {
  try {
    const electron = require('electron');
    if (electron && electron.webContents && typeof electron.webContents.getAllWebContents === 'function') {
      return electron.webContents.getAllWebContents();
    }
  } catch {
    // Outside Electron runtime (e.g. Node unit tests)
  }
  return [];
}

function isDefaultAllowedRendererUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    if (!DEFAULT_ALLOWED_PROTOCOLS.includes(parsed.protocol)) return false;
    return DEFAULT_ALLOWED_HOSTS.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function buildIsolatedUrlPushCode(urlOrNull) {
  const serialized = JSON.stringify(typeof urlOrNull === 'string' ? urlOrNull : null);
  return (
    '(function(){' +
    '"use strict";' +
    'var __u=' + serialized + ';' +
    'window.__AGY_MCP_MANAGER_URL__=__u;' +
    'if(typeof window.__AGY_MCP_ON_SERVER_URL__==="function"){' +
    'try{window.__AGY_MCP_ON_SERVER_URL__(__u);}catch(_e){}' +
    '}' +
    '})();'
  );
}

function execInIsolatedWorld(contents, worldId, code) {
  if (!contents || (typeof contents.isDestroyed === 'function' && contents.isDestroyed())) {
    return Promise.resolve();
  }
  if (typeof contents.executeJavaScriptInIsolatedWorld === 'function') {
    return Promise.resolve(contents.executeJavaScriptInIsolatedWorld(worldId, [{ code }], true)).catch(() => {});
  }
  if (typeof contents.executeJavaScript === 'function') {
    return Promise.resolve(contents.executeJavaScript(code, true)).catch(() => {});
  }
  return Promise.resolve();
}

function detachEventListener(emitter, eventName, listener) {
  if (!emitter || typeof listener !== 'function') return;
  if (typeof emitter.removeListener === 'function') {
    emitter.removeListener(eventName, listener);
  } else if (typeof emitter.off === 'function') {
    emitter.off(eventName, listener);
  }
}

function createMainHookController({
  startServer = defaultStartDesktopServer,
  getExistingWebContents = defaultGetExistingWebContents,
  isolatedWorldId = DEFAULT_ISOLATED_WORLD_ID,
} = {}) {
  let active = false;
  let activeCtx = null;
  let willQuitListener = null;
  let serverPromise = null;
  let serverHandle = null;
  const trackedContents = new Map();

  function ensureDesktopServer() {
    if (!active) {
      return Promise.reject(new Error('ERR_MAIN_HOOK_INACTIVE'));
    }
    if (!serverPromise) {
      serverPromise = Promise.resolve()
        .then(() => startServer())
        .then((handle) => {
          if (!active) {
            if (handle && typeof handle.close === 'function') {
              void Promise.resolve(handle.close()).catch(() => {});
            }
            serverPromise = null;
            return null;
          }
          serverHandle = handle;
          return handle;
        })
        .catch((err) => {
          serverPromise = null;
          throw err;
        });
    }
    return serverPromise;
  }

  function closeDesktopServer() {
    const handle = serverHandle;
    serverHandle = null;
    serverPromise = null;
    if (handle && typeof handle.close === 'function') {
      return Promise.resolve(handle.close()).catch(() => {});
    }
    return Promise.resolve();
  }

  function attachContents(contents, isAllowedRendererUrl, { pushImmediately = false } = {}) {
    if (!active || !contents) return;
    if (typeof contents.getType === 'function' && contents.getType() !== 'window') return;
    if (trackedContents.has(contents)) return;

    const allowCheckFn = typeof isAllowedRendererUrl === 'function' ? isAllowedRendererUrl : isDefaultAllowedRendererUrl;
    const checkAllowed = (wc) => {
      const liveUrl = typeof wc.getURL === 'function' ? wc.getURL() : '';
      return Boolean(allowCheckFn(liveUrl));
    };

    const pushServerUrl = () => {
      if (!active) return;
      if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) return;
      if (!checkAllowed(contents)) return;

      void ensureDesktopServer()
        .then((handle) => {
          if (!active || !handle || typeof handle.url !== 'string') return;
          if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) return;
          // Re-verify live renderer URL after async server startup (TOCTOU guard)
          if (!checkAllowed(contents)) return;
          return execInIsolatedWorld(contents, isolatedWorldId, buildIsolatedUrlPushCode(handle.url));
        })
        .catch(() => {});
    };

    const cleanupTracked = () => {
      const record = trackedContents.get(contents);
      if (!record) return;
      trackedContents.delete(contents);
      detachEventListener(contents, 'dom-ready', record.onDomReady);
      detachEventListener(contents, 'did-finish-load', record.onDidFinishLoad);
      detachEventListener(contents, 'destroyed', record.onDestroyed);
    };

    const record = {
      onDomReady: pushServerUrl,
      onDidFinishLoad: pushServerUrl,
      onDestroyed: cleanupTracked,
      checkAllowed,
    };
    trackedContents.set(contents, record);

    if (typeof contents.on === 'function') {
      contents.on('dom-ready', record.onDomReady);
      contents.on('did-finish-load', record.onDidFinishLoad);
      contents.on('destroyed', record.onDestroyed);
    }

    if (pushImmediately && checkAllowed(contents)) {
      pushServerUrl();
    }
  }

  function activate(ctx = {}) {
    if (active) return;
    active = true;
    activeCtx = {
      app: ctx.app || null,
      pluginId: ctx.pluginId || 'antigravity-mcp-manager',
      hostProfileId: ctx.hostProfileId || 'antigravity-desktop',
      hostVersion: ctx.hostVersion || '1.0.0',
      storageNamespace: ctx.storageNamespace || 'antigravity-mcp-manager',
      ipcChannelPrefix: ctx.ipcChannelPrefix || 'mcp-manager:',
    };

    if (activeCtx.app && typeof activeCtx.app.on === 'function') {
      willQuitListener = () => {
        void closeDesktopServer();
      };
      activeCtx.app.on('will-quit', willQuitListener);
    }

    // Hot-activation (e.g. --register followed by Ctrl+R on an already-open window):
    // attach all currently open window webContents and push loopback URL immediately.
    let existing = [];
    try {
      existing = getExistingWebContents() || [];
    } catch {
      existing = [];
    }
    for (const wc of existing) {
      attachContents(wc, isDefaultAllowedRendererUrl, { pushImmediately: true });
    }
  }

  function onWebContentsCreated({ contents, isAllowedRendererUrl } = {}) {
    if (typeof isAllowedRendererUrl !== 'function') return;
    attachContents(contents, isAllowedRendererUrl, { pushImmediately: false });
  }

  function dispose() {
    if (!active && trackedContents.size === 0 && !serverHandle && !serverPromise) {
      return Promise.resolve();
    }
    active = false;

    if (activeCtx && activeCtx.app && willQuitListener) {
      detachEventListener(activeCtx.app, 'will-quit', willQuitListener);
    }
    willQuitListener = null;
    activeCtx = null;

    const clearTasks = [];
    for (const [contents, record] of Array.from(trackedContents.entries())) {
      trackedContents.delete(contents);
      detachEventListener(contents, 'dom-ready', record.onDomReady);
      detachEventListener(contents, 'did-finish-load', record.onDidFinishLoad);
      detachEventListener(contents, 'destroyed', record.onDestroyed);
      if (
        contents &&
        (typeof contents.isDestroyed !== 'function' || !contents.isDestroyed()) &&
        record.checkAllowed(contents)
      ) {
        clearTasks.push(execInIsolatedWorld(contents, isolatedWorldId, buildIsolatedUrlPushCode(null)));
      }
    }

    clearTasks.push(closeDesktopServer());
    return Promise.all(clearTasks).then(() => undefined);
  }

  return Object.freeze({
    activate,
    onWebContentsCreated,
    dispose,
    ensureDesktopServer,
    isActive: () => active,
    getTrackedCount: () => trackedContents.size,
  });
}

const defaultController = createMainHookController();

module.exports = {
  DEFAULT_ISOLATED_WORLD_ID,
  isDefaultAllowedRendererUrl,
  buildIsolatedUrlPushCode,
  createMainHookController,
  activate: defaultController.activate,
  onWebContentsCreated: defaultController.onWebContentsCreated,
  dispose: defaultController.dispose,
  ensureDesktopServer: defaultController.ensureDesktopServer,
};
