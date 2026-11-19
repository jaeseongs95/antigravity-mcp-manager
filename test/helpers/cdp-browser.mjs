/**
 * Shared Headless Chromium/Edge CDP Test Harness (`test/helpers/cdp-browser.mjs`).
 *
 * SOLID Responsibility (SRP):
 * - Single source of truth for locating Chromium/Edge, allocating ephemeral CDP ports,
 *   capturing stderr on launch failure, connecting CDP WebSocket sessions (including OOPIF
 *   iframes), and simulating the exact `AddonManifest.v1` `addonHost` capability handle
 *   contract from `antigravity-native-addon-host`.
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
 * Builds an inline browser script that mirrors `antigravity-native-addon-host`'s
 * `createScopedHandle` contract (declared slot enforcement, `translate="no"`,
 * `data-agy-no-translate="true"`, `data-addon-host-owner`, owner-scoped styles,
 * and `dispose()` teardown) for real Chromium E2E tests.
 */
export function buildAddonHostHarnessScript(manifest) {
  const allowedSlotIds = (manifest.uiSlots || []).map((s) => s.slotId);
  const pluginId = manifest.pluginId;
  const storageNamespace = manifest.isolation?.storageNamespace || pluginId;
  const ipcChannelPrefix = manifest.isolation?.ipcChannelPrefix || null;

  return `(function(){
    'use strict';
    const pluginId = ${JSON.stringify(pluginId)};
    const allowedSlots = Object.create(null);
    for (const id of ${JSON.stringify(allowedSlotIds)}) allowedSlots[id] = true;
    const slotElements = Object.create(null);
    const styleElements = Object.create(null);
    const disposers = [];
    let disposed = false;

    function assertActive() {
      if (disposed) throw new Error('ERR_HANDLE_DISPOSED:' + pluginId);
    }

    const handle = Object.freeze({
      pluginId,
      hostVersion: '1.0.1',
      hostProfileId: 'antigravity-desktop',
      storageNamespace: ${JSON.stringify(storageNamespace)},
      ipcChannelPrefix: ${JSON.stringify(ipcChannelPrefix)},
      getNoTranslateSelector() {
        return '[data-addon-host-owner], [translate="no"], [data-agy-no-translate="true"]';
      },
      mountSlot(slotId, parentEl) {
        assertActive();
        if (!allowedSlots[slotId]) throw new Error('ERR_UNDECLARED_SLOT:' + slotId);
        let el = slotElements[slotId] || null;
        if (!el) {
          el = document.createElement('div');
          el.setAttribute('translate', 'no');
          el.setAttribute('data-agy-no-translate', 'true');
          el.setAttribute('data-addon-host-owner', pluginId);
          el.setAttribute('data-addon-host-slot', slotId);
          slotElements[slotId] = el;
        }
        const hostParent = parentEl || document.body;
        if (hostParent && el.parentNode !== hostParent) {
          hostParent.appendChild(el);
        }
        return el;
      },
      unmountSlot(slotId) {
        assertActive();
        const el = slotElements[slotId];
        if (!el) return false;
        if (el.parentNode) el.parentNode.removeChild(el);
        delete slotElements[slotId];
        return true;
      },
      injectStyle(styleId, cssText) {
        assertActive();
        const scopedKey = pluginId + ':' + styleId;
        let styleEl = styleElements[scopedKey] || null;
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.setAttribute('data-addon-host-owner', pluginId);
          styleEl.setAttribute('data-addon-host-style', scopedKey);
          styleElements[scopedKey] = styleEl;
          (document.head || document.documentElement || document.body).appendChild(styleEl);
        }
        styleEl.textContent = String(cssText || '');
        return styleEl;
      },
      removeStyle(styleId) {
        assertActive();
        const scopedKey = pluginId + ':' + styleId;
        const el = styleElements[scopedKey];
        if (!el) return false;
        if (el.parentNode) el.parentNode.removeChild(el);
        delete styleElements[scopedKey];
        return true;
      },
      listOwnedSlots() {
        return Object.keys(slotElements);
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
        for (const id of Object.keys(slotElements)) {
          const el = slotElements[id];
          if (el && el.parentNode) el.parentNode.removeChild(el);
          delete slotElements[id];
        }
        for (const key of Object.keys(styleElements)) {
          const el = styleElements[key];
          if (el && el.parentNode) el.parentNode.removeChild(el);
          delete styleElements[key];
        }
      },
    });
    window.__TEST_ADDON_HOST__ = handle;
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
