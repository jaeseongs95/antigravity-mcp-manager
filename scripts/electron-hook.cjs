/**
 * AddonManifest.v1 Main-Process Hook (`scripts/electron-hook.cjs`).
 *
 * Managed exclusively by `antigravity-native-addon-host` (`capabilities: ["mainHook", "renderer"]`).
 * Responsibilities (SRP / ISP / DIP):
 * - Owns the lifecycle of the verified local loopback MCP Manager server (`desktop-server.mjs`).
 * - Delivers the tokenized loopback URL strictly into Isolated World (`999`) ONLY for windows
 *   whose live URL passes `isAllowedRendererUrl(...)` (both before and after async server boot),
 *   preventing Main World (World 0) / `sessionStorage` token exposure.
 * - Cleans up `webContents` listeners, isolated-world URL state, `will-quit` handler, and the
 *   loopback HTTP server immediately on `dispose()`.
 * - NEVER touches `app.asar` and NEVER injects renderer UI scripts directly.
 */

'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEFAULT_ISOLATED_WORLD_ID = 999;
const ROOT_DIR = path.resolve(__dirname, '..');
const DESKTOP_SERVER_PATH = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'desktop-server.mjs');

function defaultStartDesktopServer() {
  return import(pathToFileURL(DESKTOP_SERVER_PATH).href).then((mod) => mod.startDesktopMcpServer());
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
  }

  function onWebContentsCreated({ contents, isAllowedRendererUrl } = {}) {
    if (!active || !contents) return;
    if (typeof contents.getType === 'function' && contents.getType() !== 'window') return;
    if (trackedContents.has(contents)) return;

    const checkAllowed = (wc) => {
      if (typeof isAllowedRendererUrl !== 'function') return false;
      const liveUrl = typeof wc.getURL === 'function' ? wc.getURL() : '';
      return Boolean(isAllowedRendererUrl(liveUrl));
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
  buildIsolatedUrlPushCode,
  createMainHookController,
  activate: defaultController.activate,
  onWebContentsCreated: defaultController.onWebContentsCreated,
  dispose: defaultController.dispose,
  ensureDesktopServer: defaultController.ensureDesktopServer,
};
