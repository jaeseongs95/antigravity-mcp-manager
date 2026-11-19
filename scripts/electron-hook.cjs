/**
 * Antigravity Electron Main-Process Hook (`scripts/electron-hook.cjs`).
 *
 * Loaded via a minimal 1-line loader inside Antigravity's `dist/main.js`.
 * Starts the verified local loopback MCP Manager server once per Electron session
 * and injects `settings-menu-injector.js` into Antigravity windows so `MCP Manager`
 * appears natively under `Browser` in Antigravity's Settings left sidebar.
 */

'use strict';

if (globalThis.__AGY_MCP_MANAGER_HOOK_INSTALLED__) {
  module.exports = {};
  return;
}
globalThis.__AGY_MCP_MANAGER_HOOK_INSTALLED__ = true;

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let electronApp = null;
try {
  ({ app: electronApp } = require('electron'));
} catch {
  // Outside Electron runtime (e.g. static inspection)
}

const ROOT_DIR = path.resolve(__dirname, '..');
const DESKTOP_SERVER_PATH = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'desktop-server.mjs');
const INJECTOR_PATH = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'settings-menu-injector.js');

let serverPromise = null;
let serverHandle = null;

function ensureDesktopServer() {
  if (!serverPromise) {
    serverPromise = import(pathToFileURL(DESKTOP_SERVER_PATH).href)
      .then((mod) => mod.startDesktopMcpServer())
      .then((handle) => {
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

function attachToWebContents(contents) {
  if (!contents || typeof contents.getType !== 'function' || contents.getType() !== 'window') return;

  const inject = () => {
    if (contents.isDestroyed()) return;
    ensureDesktopServer()
      .then((handle) => {
        if (contents.isDestroyed() || !fs.existsSync(INJECTOR_PATH)) return;
        const injectorSrc = fs.readFileSync(INJECTOR_PATH, 'utf8');
        const payload = `window.__AGY_MCP_MANAGER_URL__ = ${JSON.stringify(handle.url)};\n${injectorSrc}`;
        return contents.executeJavaScript(payload).catch(() => {});
      })
      .catch(() => {});
  };

  contents.on('dom-ready', inject);
  contents.on('did-finish-load', inject);
}

if (electronApp && typeof electronApp.on === 'function') {
  electronApp.on('web-contents-created', (_event, contents) => {
    attachToWebContents(contents);
  });
  electronApp.on('will-quit', () => {
    if (serverHandle && typeof serverHandle.close === 'function') {
      void serverHandle.close();
    }
  });
}

module.exports = { ensureDesktopServer, attachToWebContents };
