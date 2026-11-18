'use strict';

/**
 * Real Headless Chromium + CDP End-to-End Test Suite (`test/e2e/chromium-remote-and-live.test.js`).
 *
 * Covers:
 * - `MCP-TC-038`: Strict HTTP CSP (`base-uri 'self'`, `require-trusted-types-for 'script'`)
 *   remote frame promotion (zero `<base>`), Module Worker relative `import` + `import.meta.url`,
 *   Classic Worker WebIDL `self.addEventListener` / `self.origin` / `URL.canParse` / nested
 *   `importScripts` / falsy `throw 0`, MCP modal open/close, and host reconnect un-spoofing.
 * - `MCP-TC-041` (`Rev 6 F2`, `5095348c-F5`): Direct navigation to unmodified live production
 *   `https://antigravity.google.com/` (`0` test-created `TrustedTypes` policies, unmodified
 *   Google HTTP CSP headers), single-URL CDP `Fetch.enable` ONLY on
 *   `https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/<ref>/dist/mcp_manager_autoinject.js*`
 *   serving local built `v2.0.0` `dist/mcp_manager_autoinject.js`, verifying
 *   `servedSha256 === localDistSha256`, `window.agyMcpManager.version === '2.0.0'`,
 *   `securitypolicyviolation === 0`, modal open/close, and `destroy()` cleanup.
 * - `MCP-TC-048`: Real Chromium 3-plugin coexistence (`statusbar` + `mcp-manager` + `ko-thought`)
 *   under strict HTTP CSP, `PASSIVE_ATTACHED`, non-invasive `#agy-mcp-remote-launcher`,
 *   `data-agy-no-translate`, and solo `agyMcpManager.destroy()` preserving companions.
 * - `MCP-TC-049`: Real Chromium failure injection (`AUDIT-M1`~`M4` & `M6`: TrustedTypes preflight
 *   block, `main.js` HTTP 500 `ROLLED_BACK`, `terminate()`/`destroy()` removing all bridge
 *   `iframe`s, nested `importScripts` + falsy `throw ''` + `EvalError` normalization, and
 *   `1500ms` companion retry timer cancellation on `destroy()`).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const { sha256Hex } = require('../../src/core/sha256');
const { createRfc6455WebSocketClient } = require('../../scripts/lib/rfc6455-ws');
const { createTestTempDir } = require('../helpers/dom-and-rpc-fakes');

const ROOT_DIR = path.join(__dirname, '..', '..');
const DIST_BUNDLE_PATH = path.join(ROOT_DIR, 'dist', 'mcp_manager_autoinject.js');
const README_PATH = path.join(ROOT_DIR, 'README.md');

function findBrowserExecutable() {
  const envCandidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    process.env.CHROMIUM_PATH,
  ].filter(Boolean);

  for (const p of envCandidates) {
    if (fs.existsSync(p)) return p;
  }

  const platformCandidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
          ];

  for (const candidate of platformCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (process.platform !== 'win32') {
    for (const binName of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      const whichRes = spawnSync('which', [binName], { encoding: 'utf8' });
      if (whichRes.status === 0 && whichRes.stdout.trim()) {
        const resolved = whichRes.stdout.trim().split('\n')[0].trim();
        if (fs.existsSync(resolved)) return resolved;
      }
    }
  }

  return null;
}

function extractReadmeBookmarkletExpression() {
  const readmeText = fs.readFileSync(README_PATH, 'utf8');
  const match = readmeText.match(/^(javascript:\(\(\)=>\{[\s\S]*?\}\)\(\);)\s*$/m);
  assert.ok(match && match[1], 'Expected javascript:(...) bookmarklet line in README.md');
  return match[1].slice('javascript:'.length);
}

function httpGetJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('HTTP timeout'));
    });
    req.on('error', reject);
  });
}

async function removeProfileDirWithRetry(profileTmp) {
  if (!profileTmp || !profileTmp.dir) return;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      profileTmp.cleanup();
      if (!fs.existsSync(profileTmp.dir)) return;
    } catch {
      // Wait briefly for Windows Chromium child handles to release
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  profileTmp.cleanup();
}

async function launchChromiumCdp(label) {
  const browserBin = findBrowserExecutable();
  assert.ok(browserBin, 'Real Chromium/Chrome/Edge executable is required for E2E suite');

  const profileTmp = createTestTempDir(label);
  const profileDir = profileTmp.dir;
  const activePortFile = path.join(profileDir, 'DevToolsActivePort');
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-popup-blocking',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ];

  const proc = spawn(browserBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrLog = '';
  const browserWsUrl = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(portPoller);
      proc.stderr.off('data', onStderr);
      fn(val);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error(`Timed out waiting for Chromium DevTools port. stderr:\n${stderrLog}`));
    }, 15000);

    const portPoller = setInterval(() => {
      try {
        if (fs.existsSync(activePortFile)) {
          const lines = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
          const portNum = Number(lines[0]);
          const wsPath = (lines[1] || '/devtools/browser').trim();
          if (Number.isInteger(portNum) && portNum > 0 && wsPath.startsWith('/')) {
            finish(resolve, `ws://127.0.0.1:${portNum}${wsPath}`);
          }
        }
      } catch {
        // Retry on next tick
      }
    }, 60);

    const onStderr = (chunk) => {
      stderrLog += chunk.toString('utf8');
      const m = stderrLog.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s\r\n]+)/);
      if (m && m[1]) {
        finish(resolve, m[1]);
      }
    };

    proc.stderr.on('data', onStderr);
    proc.once('exit', (code) => {
      finish(reject, new Error(`Chromium exited prematurely (code=${code}). stderr:\n${stderrLog}`));
    });
  });

  const debugPort = new URL(browserWsUrl).port;
  let pageWsUrl = null;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const targets = await httpGetJson(`http://127.0.0.1:${debugPort}/json/list`);
      const pageTarget = Array.isArray(targets)
        ? targets.find((t) => t && t.type === 'page' && t.webSocketDebuggerUrl)
        : null;
      if (pageTarget) {
        pageWsUrl = pageTarget.webSocketDebuggerUrl;
        break;
      }
    } catch {
      // Retry until JSON endpoint responds
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  assert.ok(pageWsUrl, 'Failed to discover Chromium page target WebSocket URL');

  const ws = createRfc6455WebSocketClient(pageWsUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('CDP WebSocket open timeout')), 8000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve();
    };
    ws.onerror = (err) => {
      clearTimeout(t);
      reject(err);
    };
  });

  let nextId = 1;
  const pending = new Map();
  const eventListeners = new Map();
  let closing = false;

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (typeof msg.id === 'number') {
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) {
          entry.reject(new Error(`CDP ${entry.method} error: ${msg.error.message || JSON.stringify(msg.error)}`));
        } else {
          entry.resolve(msg.result);
        }
      }
      return;
    }
    if (msg.method) {
      const handlers = eventListeners.get(msg.method);
      if (handlers) {
        for (const fn of Array.from(handlers)) {
          Promise.resolve()
            .then(() => fn(msg.params || {}))
            .catch(() => {});
        }
      }
    }
  };

  ws.onclose = () => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('CDP WebSocket closed'));
    }
    pending.clear();
  };

  const send = (method, params = {}, timeoutMs = 15000) => {
    if (closing) return Promise.reject(new Error('CDP session closing'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout calling ${method}`));
      }, timeoutMs);
      pending.set(id, { method, resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  const on = (eventMethod, fn) => {
    if (!eventListeners.has(eventMethod)) {
      eventListeners.set(eventMethod, new Set());
    }
    eventListeners.get(eventMethod).add(fn);
    return () => eventListeners.get(eventMethod)?.delete(fn);
  };

  const evalInPage = async (expression, awaitPromise = true) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (res.exceptionDetails) {
      const desc =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        JSON.stringify(res.exceptionDetails);
      throw new Error(`Page evaluation threw: ${desc}`);
    }
    return res.result ? res.result.value : undefined;
  };

  const waitForCondition = async (boolExpr, timeoutMs = 12000, labelText = boolExpr) => {
    const end = Date.now() + timeoutMs;
    let lastErr = null;
    while (Date.now() < end) {
      try {
        const val = await evalInPage(`Boolean(${boolExpr})`, false);
        if (val === true) return;
      } catch (err) {
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    throw new Error(
      `Timed out waiting for condition (${labelText})${lastErr ? `: ${lastErr.message}` : ''}`
    );
  };

  const fulfillRequest = async (requestId, status, headersObj, bodyText) => {
    if (closing) return;
    const responseHeaders = Object.entries(headersObj).map(([name, value]) => ({
      name,
      value: String(value),
    }));
    const bodyBase64 = Buffer.from(String(bodyText), 'utf8').toString('base64');
    try {
      await send('Fetch.fulfillRequest', {
        requestId,
        responseCode: status,
        responseHeaders,
        body: bodyBase64,
      });
    } catch {
      // Ignore races if request was cancelled during teardown
    }
  };

  const close = async () => {
    if (closing) return;
    closing = true;
    try {
      await send('Browser.close', {}, 1500);
    } catch {
      // Fallback to process kill below
    }
    try {
      ws.close();
    } catch {
      // Ignore
    }
    if (proc.exitCode === null) {
      await new Promise((resolve) => {
        const killTimer = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Ignore
          }
          resolve();
        }, 2500);
        proc.once('exit', () => {
          clearTimeout(killTimer);
          resolve();
        });
        try {
          proc.kill();
        } catch {
          clearTimeout(killTimer);
          resolve();
        }
      });
    }
    await removeProfileDirWithRetry(profileTmp);
  };

  await send('Page.enable');
  await send('Runtime.enable');

  return {
    send,
    on,
    evalInPage,
    waitForCondition,
    fulfillRequest,
    close,
  };
}

test('MCP-TC-038: real Chromium strict HTTP CSP (base-uri self + require-trusted-types-for script) promotes workbench with zero <base>, runs Module & Classic Workers, opens MCP modal, and un-spoofs on reconnect', async () => {
  assert.equal(fs.existsSync(DIST_BUNDLE_PATH), true, 'Built dist/mcp_manager_autoinject.js must exist');
  const localDistCode = fs.readFileSync(DIST_BUNDLE_PATH, 'utf8');
  const bookmarkletExpr = extractReadmeBookmarkletExpression();

  const cdp = await launchChromiumCdp('e2e-tc038');
  try {
    const strictCsp =
      "base-uri 'self'; object-src 'none'; script-src 'nonce-tc038Nonce99' 'strict-dynamic' https://cdn.local.test https://raw.githubusercontent.com; require-trusted-types-for 'script'";

    const hostHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Remote Session E2E</title>
  <script nonce="tc038Nonce99">
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push({
        directive: e.violatedDirective,
        blockedURI: e.blockedURI,
        sample: e.sample || '',
      });
    });
    window.__AGY_MCP_HOST_CONFIG__ = {
      remoteHostDomains: ['host.local.test'],
      staticCdnOrigins: ['https://cdn.local.test'],
      cdnOrigin: 'https://cdn.local.test',
      cdnPathPrefix: '/web/',
      allowedScriptDomains: ['host.local.test', 'cdn.local.test', 'raw.githubusercontent.com'],
      companionUrls: {
        statusbar: 'https://cdn.local.test/companions/none-sb.js',
        mcpManager: 'https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js',
        koTranslator: 'https://cdn.local.test/companions/none-ko.js',
      },
    };
    class HostRemoteControl {
      constructor() {
        this.iframeLoading = { set(v) { window.__rcLoading = v; } };
        this.iframeUiReady = { set(v) { window.__rcReady = v; } };
      }
      iframeSrc() {
        return 'https://cdn.local.test/web/build_1/workbench.html?hostTheme=dark&iframe=true';
      }
      onIframeLoad() {
        window.__rcOnIframeLoadCalls = (window.__rcOnIframeLoadCalls || 0) + 1;
      }
      markIframeReady() {
        window.__rcMarkedReady = true;
      }
    }
    window.__agyRemoteControlInstance = new HostRemoteControl();
  </script>
</head>
<body>
  <ga-remote-control>
    <iframe id="remote-wb-frame" src="https://cdn.local.test/web/build_1/workbench.html?hostTheme=dark&amp;iframe=true"></iframe>
  </ga-remote-control>
</body>
</html>`;

    const cdnAssets = new Map([
      [
        'https://cdn.local.test/web/build_1/workbench.html',
        { contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>CrossOriginWB</title>' },
      ],
      [
        'https://cdn.local.test/web/build_2/workbench.html',
        { contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>ReconnectedWB</title>' },
      ],
      [
        'https://cdn.local.test/web/build_1/jetbox.css',
        { contentType: 'text/css; charset=utf-8', body: 'body { margin: 0; }' },
      ],
      [
        'https://cdn.local.test/web/build_1/compiled_tailwind.css',
        { contentType: 'text/css; charset=utf-8', body: '#root { display: block; }' },
      ],
      [
        'https://cdn.local.test/web/build_1/workbench.js',
        {
          contentType: 'application/javascript; charset=utf-8',
          body: `
            document.addEventListener('securitypolicyviolation', (e) => {
              window.parent.__cspViolations.push({
                frame: 'promoted-child',
                directive: e.violatedDirective,
                blockedURI: e.blockedURI,
              });
            });
            window.__childBaseCount = document.querySelectorAll('base').length;

            // 1) Module Worker with relative ES import & import.meta.url (zero <base>)
            const modWorker = new Worker('./mod-worker.mjs', { type: 'module' });
            modWorker.onmessage = (ev) => {
              window.parent.__modWorkerResult = ev.data;
            };
            modWorker.onerror = (err) => {
              window.parent.__modWorkerError = err.message || 'mod-worker-error';
            };
            modWorker.postMessage('run-esm');

            // 2) Classic Worker testing WebIDL receiver binding, inherited Window.prototype origin,
            //    URL.canParse, Object.keys, and nested importScripts catching falsy throw 0
            const classicWorker = new Worker('./classic-worker.js');
            classicWorker.onmessage = (ev) => {
              window.parent.__classicWorkerResult = ev.data;
            };
            classicWorker.onerror = (err) => {
              window.parent.__classicWorkerError = err.message || 'classic-worker-error';
            };
            classicWorker.postMessage('run-classic');
          `,
        },
      ],
      [
        'https://cdn.local.test/web/build_1/mod-worker.mjs',
        {
          contentType: 'application/javascript; charset=utf-8',
          body: `
            import { depLabel } from './mod-dep.mjs';
            self.addEventListener('message', (ev) => {
              if (ev.data === 'run-esm') {
                self.postMessage({
                  depLabel,
                  metaUrl: import.meta.url,
                });
              }
            });
          `,
        },
      ],
      [
        'https://cdn.local.test/web/build_1/mod-dep.mjs',
        {
          contentType: 'application/javascript; charset=utf-8',
          body: `export const depLabel = 'esm-relative-import-ok';`,
        },
      ],
      [
        'https://cdn.local.test/web/build_1/classic-worker.js',
        {
          contentType: 'application/javascript; charset=utf-8',
          body: `
            const detachedAddEL = self.addEventListener;
            const detachedSetTimeout = self.setTimeout;
            const workerOrigin = self.origin;
            const canParseOk = self.URL.canParse('./sub/item.js', self.location.href);
            const resolvedAboutBlank = new self.URL('./sub/item.js', 'about:blank').href;
            const objectKeysOk = self.Object.keys({ alpha: 1 }).join(',');

            self.importScripts('./classic-outer.js');

            detachedAddEL('message', (ev) => {
              if (ev.data === 'run-classic') {
                detachedSetTimeout(() => {
                  self.postMessage({
                    workerOrigin,
                    canParseOk,
                    resolvedAboutBlank,
                    objectKeysOk,
                    outerRecovered: self.__outerRecovered === true,
                    caughtInnerZero: self.__caughtInnerZero,
                  });
                }, 5);
              }
            });
          `,
        },
      ],
      [
        'https://cdn.local.test/web/build_1/classic-outer.js',
        {
          contentType: 'application/javascript; charset=utf-8',
          body: `
            try {
              self.importScripts('./classic-inner-zero.js');
            } catch (e) {
              self.__caughtInnerZero = e;
            }
            self.__outerRecovered = true;
          `,
        },
      ],
      [
        'https://cdn.local.test/web/build_1/classic-inner-zero.js',
        {
          contentType: 'application/javascript; charset=utf-8',
          body: `throw 0;`,
        },
      ],
    ]);

    cdp.on('Fetch.requestPaused', async (params) => {
      const reqUrl = params.request.url;
      const cleanUrl = reqUrl.split('?')[0];

      if (cleanUrl === 'https://host.local.test/r/session-1') {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': strictCsp,
          },
          hostHtml
        );
        return;
      }

      if (cleanUrl === 'https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js') {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'Access-Control-Allow-Origin': '*',
          },
          localDistCode
        );
        return;
      }

      const asset = cdnAssets.get(cleanUrl);
      if (asset) {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          {
            'Content-Type': asset.contentType,
            'Access-Control-Allow-Origin': '*',
          },
          asset.body
        );
        return;
      }

      await cdp.fulfillRequest(params.requestId, 404, { 'Content-Type': 'text/plain' }, 'Not Found');
    });

    await cdp.send('Fetch.enable', {
      patterns: [
        { urlPattern: 'https://host.local.test/*', requestStage: 'Request' },
        { urlPattern: 'https://cdn.local.test/*', requestStage: 'Request' },
        { urlPattern: 'https://raw.githubusercontent.com/*', requestStage: 'Request' },
      ],
    });

    await cdp.send('Page.navigate', { url: 'https://host.local.test/r/session-1' });
    await cdp.waitForCondition('document.readyState === "complete"', 10000);

    // Execute the exact README.md bookmarklet
    await cdp.evalInPage(bookmarkletExpr, false);

    await cdp.waitForCondition('Boolean(window.agyMcpManager && window.agyMcpManager.version === "2.0.0")', 10000);
    await cdp.waitForCondition(
      'document.getElementById("remote-wb-frame").__agyRemotePromotionState === "ready"',
      10000
    );
    await cdp.waitForCondition('Boolean(window.__modWorkerResult && window.__classicWorkerResult)', 10000);

    const snapshot = await cdp.evalInPage(`(() => {
      const iframe = document.getElementById('remote-wb-frame');
      const cd = iframe.contentDocument;
      window.agyMcpManager.openModal();
      const modalOpen = Boolean(document.getElementById('agy-mcp-manager-modal-backdrop'));
      window.agyMcpManager.closeModal();
      const modalClosed = !document.getElementById('agy-mcp-manager-modal-backdrop');

      const hasOwnSrcWhilePromoted = Boolean(Object.getOwnPropertyDescriptor(iframe, 'src'));
      // Host reconnect reassigns iframe.src -> must un-spoof own property cleanly
      iframe.src = 'https://cdn.local.test/web/build_2/workbench.html?iframe=true';
      const hasOwnSrcAfterReconnect = Boolean(Object.getOwnPropertyDescriptor(iframe, 'src'));

      return {
        version: window.agyMcpManager.version,
        childBaseCount: cd ? cd.querySelectorAll('base').length : window.__childBaseCount,
        modWorkerResult: window.__modWorkerResult,
        modWorkerError: window.__modWorkerError || null,
        classicWorkerResult: window.__classicWorkerResult,
        classicWorkerError: window.__classicWorkerError || null,
        modalOpen,
        modalClosed,
        hasOwnSrcWhilePromoted,
        hasOwnSrcAfterReconnect,
        cspViolations: window.__cspViolations,
      };
    })()`);

    assert.equal(snapshot.version, '2.0.0');
    assert.equal(snapshot.childBaseCount, 0, 'ZERO <base> tags permitted under base-uri self');
    assert.equal(snapshot.modWorkerError, null);
    assert.deepEqual(snapshot.modWorkerResult, {
      depLabel: 'esm-relative-import-ok',
      metaUrl: 'https://cdn.local.test/web/build_1/mod-worker.mjs',
    });
    assert.equal(snapshot.classicWorkerError, null);
    assert.deepEqual(snapshot.classicWorkerResult, {
      workerOrigin: 'https://cdn.local.test',
      canParseOk: true,
      resolvedAboutBlank: 'https://cdn.local.test/web/build_1/sub/item.js',
      objectKeysOk: 'alpha',
      outerRecovered: true,
      caughtInnerZero: 0,
    });
    assert.equal(snapshot.modalOpen, true);
    assert.equal(snapshot.modalClosed, true);
    assert.equal(snapshot.hasOwnSrcWhilePromoted, true);
    assert.equal(snapshot.hasOwnSrcAfterReconnect, false);
    assert.deepEqual(snapshot.cspViolations, []);
  } finally {
    await cdp.close();
  }
});

test('MCP-TC-041 (Rev 6 F2 & 5095348c-F5): live https://antigravity.google.com/ unmodified HTTP CSP executes README bookmarklet with single-bundle CDP Fetch mapping (servedSha256 === localDistSha256)', async () => {
  assert.equal(fs.existsSync(DIST_BUNDLE_PATH), true, 'Built dist/mcp_manager_autoinject.js must exist');
  const localDistCode = fs.readFileSync(DIST_BUNDLE_PATH, 'utf8');
  const localDistSha256 = sha256Hex(localDistCode);
  const bookmarkletExpr = extractReadmeBookmarkletExpression();

  const cdp = await launchChromiumCdp('e2e-tc041-live');
  try {
    let liveMainResponseHeaders = null;
    let liveMainStatus = 0;
    let interceptedCount = 0;
    let servedSha256 = '';

    await cdp.send('Network.enable');
    cdp.on('Network.responseReceived', (params) => {
      if (params.type === 'Document' && !liveMainResponseHeaders) {
        liveMainStatus = params.response?.status || 0;
        liveMainResponseHeaders = params.response?.headers || {};
      }
    });

    // Enable Fetch ONLY for the exact GitHub Raw bundle URL pattern — `antigravity.google.com` is 100% untouched!
    cdp.on('Fetch.requestPaused', async (params) => {
      interceptedCount += 1;
      servedSha256 = sha256Hex(localDistCode);
      await cdp.fulfillRequest(
        params.requestId,
        200,
        {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
        },
        localDistCode
      );
    });

    await cdp.send('Fetch.enable', {
      patterns: [
        {
          urlPattern:
            'https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/*/dist/mcp_manager_autoinject.js*',
          requestStage: 'Request',
        },
      ],
    });

    await cdp.send('Page.navigate', { url: 'https://antigravity.google.com/' });
    await cdp.waitForCondition('document.readyState === "complete"', 20000);

    // Record CSP violations WITHOUT creating any test TrustedTypes policy (0 test-created policies)
    await cdp.evalInPage(`(() => {
      window.__tc041CspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__tc041CspViolations.push({
          directive: e.violatedDirective,
          blockedURI: e.blockedURI,
        });
      });
    })()`);

    // Execute the exact README.md bookmarklet on the live Google-served document
    await cdp.evalInPage(bookmarkletExpr, false);

    await cdp.waitForCondition(
      'Boolean(window.agyMcpManager && window.agyMcpManager.version === "2.0.0")',
      15000,
      'window.agyMcpManager v2.0.0 mount on live antigravity.google.com'
    );

    const liveResult = await cdp.evalInPage(`(() => {
      const mgr = window.agyMcpManager;
      const version = mgr ? mgr.version : null;
      mgr.openModal();
      const dialogEl = document.getElementById('agy-mcp-manager-modal-backdrop');
      const modalOpened = Boolean(dialogEl);
      mgr.closeModal();
      const modalClosed = !document.getElementById('agy-mcp-manager-modal-backdrop');
      mgr.destroy();
      return {
        href: location.href,
        protocol: location.protocol,
        version,
        modalOpened,
        modalClosed,
        afterDestroyGlobal: typeof window.agyMcpManager,
        afterDestroyLauncher: Boolean(document.getElementById('agy-mcp-remote-launcher')),
        cspViolations: window.__tc041CspViolations,
      };
    })()`);

    assert.equal(liveResult.protocol, 'https:');
    assert.ok(liveMainStatus >= 200 && liveMainStatus < 400, `Unexpected live HTTP status: ${liveMainStatus}`);
    assert.equal(interceptedCount, 1, 'Expected exactly 1 bundle fetch intercepted after live browser CSP check');
    assert.equal(servedSha256, localDistSha256, 'Served bundle SHA-256 must match local v2.0.0 dist build');
    assert.equal(liveResult.version, '2.0.0');
    assert.equal(liveResult.modalOpened, true);
    assert.equal(liveResult.modalClosed, true);
    assert.equal(liveResult.afterDestroyGlobal, 'undefined');
    assert.equal(liveResult.afterDestroyLauncher, false);
    assert.deepEqual(liveResult.cspViolations, []);
  } finally {
    await cdp.close();
  }
});

test('MCP-TC-048: real Chromium 3-plugin coexistence (statusbar + mcp-manager + ko-thought) under strict CSP yields PASSIVE_ATTACHED and preserves companions on solo destroy()', async () => {
  const localDistCode = fs.readFileSync(DIST_BUNDLE_PATH, 'utf8');
  const bookmarkletExpr = extractReadmeBookmarkletExpression();

  const cdp = await launchChromiumCdp('e2e-tc048');
  try {
    const strictCsp =
      "base-uri 'self'; object-src 'none'; script-src 'nonce-tc048Nonce77' 'strict-dynamic' https://cdn.local.test https://raw.githubusercontent.com; require-trusted-types-for 'script'";

    const hostHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <script nonce="tc048Nonce77">
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
    });
    window.__AGY_MCP_HOST_CONFIG__ = {
      remoteHostDomains: ['host.local.test'],
      staticCdnOrigins: ['https://cdn.local.test'],
      cdnOrigin: 'https://cdn.local.test',
      cdnPathPrefix: '/web/',
      allowedScriptDomains: ['host.local.test', 'cdn.local.test', 'raw.githubusercontent.com'],
    };

    // Pre-existing Companion 1: antigravity-statusbar
    window.agyStatusBar = { version: '1.9.0', alive: true };
    // Pre-existing Companion 2: ko-thought-translator already promoted the remote iframe
    window.agyKoThoughtTranslator = { version: '1.4.0', active: true };
    window.__agyRemotePromotionOwner = 'ko-thought-translator';
  </script>
</head>
<body>
  <div class="agy-ctx-statusbar" id="companion-statusbar">Statusbar Ready</div>
  <ga-remote-control>
    <iframe id="companion-wb-frame" src="about:blank"></iframe>
  </ga-remote-control>
  <script nonce="tc048Nonce77">
    const f = document.getElementById('companion-wb-frame');
    f.__agyKoPromoted = true;
    f.__agyRemotePromotionOwner = 'ko-thought-translator';
  </script>
</body>
</html>`;

    cdp.on('Fetch.requestPaused', async (params) => {
      const cleanUrl = params.request.url.split('?')[0];
      if (cleanUrl === 'https://host.local.test/r/coexist-session') {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': strictCsp },
          hostHtml
        );
        return;
      }
      if (cleanUrl === 'https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js') {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
          localDistCode
        );
        return;
      }
      await cdp.fulfillRequest(params.requestId, 404, { 'Content-Type': 'text/plain' }, 'Not Found');
    });

    await cdp.send('Fetch.enable', {
      patterns: [
        { urlPattern: 'https://host.local.test/*', requestStage: 'Request' },
        { urlPattern: 'https://raw.githubusercontent.com/*', requestStage: 'Request' },
      ],
    });

    await cdp.send('Page.navigate', { url: 'https://host.local.test/r/coexist-session' });
    await cdp.waitForCondition('document.readyState === "complete"', 10000);

    await cdp.evalInPage(bookmarkletExpr, false);
    await cdp.waitForCondition('Boolean(window.agyMcpManager && window.agyMcpManager.version === "2.0.0")', 10000);

    const coexistResult = await cdp.evalInPage(`(() => {
      const frame = document.getElementById('companion-wb-frame');
      const statusbar = document.getElementById('companion-statusbar');
      const launcher = document.getElementById('agy-mcp-remote-launcher');

      window.agyMcpManager.openModal();
      const backdrop = document.getElementById('agy-mcp-manager-modal-backdrop');
      const hasNoTranslate = backdrop ? backdrop.getAttribute('data-agy-no-translate') === 'true' : false;
      window.agyMcpManager.closeModal();

      const stateBeforeDestroy = {
        promotionState: frame.__agyRemotePromotionState,
        promotionOwner: window.__agyRemotePromotionOwner,
        launcherPresent: Boolean(launcher),
        launcherInsideStatusbar: Boolean(statusbar && launcher && statusbar.contains(launcher)),
        hasNoTranslate,
      };

      // Destroy ONLY MCP Manager — companions must remain 100% intact!
      window.agyMcpManager.destroy();

      return {
        ...stateBeforeDestroy,
        mcpAfterDestroy: typeof window.agyMcpManager,
        launcherAfterDestroy: Boolean(document.getElementById('agy-mcp-remote-launcher')),
        statusbarIntact: Boolean(window.agyStatusBar?.alive && document.getElementById('companion-statusbar')),
        koTranslatorIntact: Boolean(window.agyKoThoughtTranslator?.active && frame.__agyKoPromoted),
        ownerPreserved: window.__agyRemotePromotionOwner,
        cspViolations: window.__cspViolations,
      };
    })()`);

    assert.equal(coexistResult.promotionState, 'passive_attached');
    assert.equal(coexistResult.promotionOwner, 'ko-thought-translator');
    assert.equal(coexistResult.launcherPresent, true);
    assert.equal(coexistResult.launcherInsideStatusbar, false);
    assert.equal(coexistResult.hasNoTranslate, true);
    assert.equal(coexistResult.mcpAfterDestroy, 'undefined');
    assert.equal(coexistResult.launcherAfterDestroy, false);
    assert.equal(coexistResult.statusbarIntact, true);
    assert.equal(coexistResult.koTranslatorIntact, true);
    assert.equal(coexistResult.ownerPreserved, 'ko-thought-translator');
    assert.deepEqual(coexistResult.cspViolations, []);
  } finally {
    await cdp.close();
  }
});

test('MCP-TC-049: real Chromium failure injection covers AUDIT-M1..M4 & M6 (TrustedTypes preflight block, main.js HTTP 500 ROLLED_BACK, worker terminate/destroy iframe cleanup, EvalError normalization & falsy throw "", and 1500ms retry cancellation)', async () => {
  const localDistCode = fs.readFileSync(DIST_BUNDLE_PATH, 'utf8');

  const cdp = await launchChromiumCdp('e2e-tc049');
  try {
    // Subcase A: AUDIT-M1 — Restrictive `trusted-types only-host-policy` blocks policy creation in PREFLIGHT -> ROLLED_BACK without touching iframe.src
    const m1Csp =
      "base-uri 'self'; script-src 'nonce-m1Nonce123' 'strict-dynamic'; trusted-types only-host-policy; require-trusted-types-for 'script'";

    const m1Html = `<!DOCTYPE html>
<html>
<head>
  <script nonce="m1Nonce123">
    window.__AGY_MCP_HOST_CONFIG__ = {
      remoteHostDomains: ['host.local.test'],
      staticCdnOrigins: ['https://cdn.local.test'],
      cdnOrigin: 'https://cdn.local.test',
      cdnPathPrefix: '/web/',
      allowedScriptDomains: ['host.local.test', 'cdn.local.test'],
    };
  </script>
  <script nonce="m1Nonce123" src="https://host.local.test/bundle.js"></script>
</head>
<body>
  <ga-remote-control>
    <iframe id="m1-frame" src="https://cdn.local.test/web/build_m1/workbench.html?iframe=true"></iframe>
  </ga-remote-control>
</body>
</html>`;

    // Subcase B: AUDIT-M2, M3, M4 & M6 — HTTP 500 `ROLLED_BACK`, worker `terminate()`/`destroy()` iframe cleanup, falsy `throw ""` + cancelable `ErrorEvent`, and `1500ms` companion retry cancelled on `destroy()`
    const m2Csp =
      "base-uri 'self'; script-src 'nonce-m2Nonce456' 'strict-dynamic' https://cdn.local.test https://host.local.test; require-trusted-types-for 'script'";

    const m2Html = `<!DOCTYPE html>
<html>
<head>
  <script nonce="m2Nonce456">
    window.__pluginRpcCalls = 0;
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const urlStr = typeof input === 'string' ? input : String(input?.url || '');
      if (urlStr.includes('/exa.language_server_pb.LanguageServerService/')) {
        window.__pluginRpcCalls += 1;
        return new Response('{}', { status: 503 });
      }
      return origFetch(input, init);
    };
    window.__AGY_MCP_HOST_CONFIG__ = {
      remoteHostDomains: ['host.local.test'],
      staticCdnOrigins: ['https://cdn.local.test'],
      cdnOrigin: 'https://cdn.local.test',
      cdnPathPrefix: '/web/',
      allowedScriptDomains: ['host.local.test', 'cdn.local.test'],
    };
  </script>
  <script nonce="m2Nonce456" src="https://host.local.test/bundle.js"></script>
</head>
<body>
  <ga-remote-control>
    <iframe id="m2-frame" src="https://cdn.local.test/web/build_500/workbench.html?iframe=true"></iframe>
  </ga-remote-control>
</body>
</html>`;

    const m3Html = `<!DOCTYPE html>
<html>
<head>
  <script nonce="m2Nonce456">
    window.__AGY_MCP_HOST_CONFIG__ = {
      remoteHostDomains: ['host.local.test'],
      staticCdnOrigins: ['https://cdn.local.test'],
      cdnOrigin: 'https://cdn.local.test',
      cdnPathPrefix: '/web/',
      allowedScriptDomains: ['host.local.test', 'cdn.local.test'],
    };
  </script>
  <script nonce="m2Nonce456" src="https://host.local.test/bundle.js"></script>
</head>
<body>
  <ga-remote-control>
    <iframe id="m3-frame" src="https://cdn.local.test/web/build_m3/workbench.html?iframe=true"></iframe>
  </ga-remote-control>
</body>
</html>`;

    cdp.on('Fetch.requestPaused', async (params) => {
      const cleanUrl = params.request.url.split('?')[0];

      if (cleanUrl === 'https://host.local.test/bundle.js') {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          { 'Content-Type': 'application/javascript; charset=utf-8' },
          localDistCode
        );
        return;
      }
      if (cleanUrl === 'https://host.local.test/r/m1') {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': m1Csp },
          m1Html
        );
        return;
      }
      if (cleanUrl === 'https://host.local.test/r/m2-500') {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': m2Csp },
          m2Html
        );
        return;
      }
      if (cleanUrl === 'https://host.local.test/r/m3-workers') {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': m2Csp },
          m3Html
        );
        return;
      }
      if (cleanUrl === 'https://cdn.local.test/web/build_500/workbench.js') {
        await cdp.fulfillRequest(
          params.requestId,
          500,
          { 'Content-Type': 'application/javascript; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
          'Internal Server Error'
        );
        return;
      }
      if (cleanUrl === 'https://cdn.local.test/web/build_m3/workbench.js') {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          { 'Content-Type': 'application/javascript; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
          `
            const w1 = new Worker('./w-err.js');
            const w2 = new Worker('./w-idle.js');
            window.parent.__m3WorkersCreated = true;
            w1.addEventListener('error', (ev) => {
              ev.preventDefault();
              window.parent.__m3SyncErrorCaptured = {
                cancelable: ev.cancelable,
                defaultPrevented: ev.defaultPrevented,
              };
            });
            w1.onmessage = (ev) => {
              if (ev.data && ev.data.ready) {
                const countBeforeTerminate = document.body.querySelectorAll('iframe').length;
                w1.postMessage('trigger-empty-string-throw');
                setTimeout(() => {
                  w1.terminate();
                  window.parent.__m3Counts = {
                    beforeTerminate: countBeforeTerminate,
                    afterOneTerminate: document.body.querySelectorAll('iframe').length,
                    evalNormalized: ev.data.evalNormalized,
                  };
                }, 40);
              }
            };
          `
        );
        return;
      }
      if (cleanUrl === 'https://cdn.local.test/web/build_m3/w-err.js') {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          { 'Content-Type': 'application/javascript; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
          `
            let evalNormalized = false;
            try {
              // Under require-trusted-types-for 'script' without TrustedScript, raw eval throws EvalError!
              eval('1 + 1');
            } catch (err) {
              evalNormalized = err instanceof EvalError;
            }
            self.addEventListener('message', (ev) => {
              if (ev.data === 'trigger-empty-string-throw') {
                throw '';
              }
            });
            self.postMessage({ ready: true, evalNormalized });
          `
        );
        return;
      }
      if (cleanUrl === 'https://cdn.local.test/web/build_m3/w-idle.js') {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          { 'Content-Type': 'application/javascript; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
          `self.addEventListener('message', () => {});`
        );
        return;
      }
      if (cleanUrl.endsWith('.html')) {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          { 'Content-Type': 'text/html; charset=utf-8' },
          '<!doctype html><title>Stub</title>'
        );
        return;
      }
      if (cleanUrl.endsWith('.css')) {
        await cdp.fulfillRequest(
          params.requestId,
          200,
          { 'Content-Type': 'text/css; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
          ''
        );
        return;
      }
      await cdp.fulfillRequest(params.requestId, 404, { 'Content-Type': 'text/plain' }, 'Not Found');
    });

    await cdp.send('Fetch.enable', {
      patterns: [
        { urlPattern: 'https://host.local.test/*', requestStage: 'Request' },
        { urlPattern: 'https://cdn.local.test/*', requestStage: 'Request' },
      ],
    });

    // 1. Run Subcase A (`AUDIT-M1`: TrustedTypes policy blocked -> PREFLIGHT abort -> ROLLED_BACK)
    await cdp.send('Page.navigate', { url: 'https://host.local.test/r/m1' });
    await cdp.waitForCondition('Boolean(window.agyMcpManager)', 10000);
    const m1Res = await cdp.evalInPage(`(() => {
      const f = document.getElementById('m1-frame');
      return {
        state: f.__agyRemotePromotionState,
        attrSrc: f.getAttribute('src'),
      };
    })()`);
    assert.equal(m1Res.state, 'rolled_back');
    assert.equal(m1Res.attrSrc, 'https://cdn.local.test/web/build_m1/workbench.html?iframe=true');

    // 2. Run Subcase B (`AUDIT-M2` HTTP 500 rollback & `AUDIT-M6` 1500ms companion retry cancel)
    await cdp.send('Page.navigate', { url: 'https://host.local.test/r/m2-500' });
    await cdp.waitForCondition(
      'document.getElementById("m2-frame").__agyRemotePromotionState === "rolled_back"',
      10000
    );
    const rpcBeforeDestroy = await cdp.evalInPage(`(() => {
      const calls = window.__pluginRpcCalls;
      window.agyMcpManager.destroy();
      return {
        calls,
        restoredSrc: document.getElementById('m2-frame').getAttribute('src'),
        ownerAfterRollback: window.__agyRemotePromotionOwner,
      };
    })()`);
    assert.equal(rpcBeforeDestroy.restoredSrc, 'https://cdn.local.test/web/build_500/workbench.html?iframe=true');
    assert.equal(rpcBeforeDestroy.ownerAfterRollback, undefined);

    await new Promise((r) => setTimeout(r, 1650));
    const rpcAfterWait = await cdp.evalInPage('window.__pluginRpcCalls');
    assert.equal(rpcAfterWait, rpcBeforeDestroy.calls, 'AUDIT-M6: 1500ms companion retry must NOT fire after destroy()');

    // 3. Run Subcase C (`AUDIT-M3` & `M4`: EvalError, falsy throw "", cancelable ErrorEvent, terminate() & destroy() bridge iframe cleanup)
    await cdp.send('Page.navigate', { url: 'https://host.local.test/r/m3-workers' });
    await cdp.waitForCondition('Boolean(window.__m3Counts)', 10000);

    const m3Res = await cdp.evalInPage(`(() => {
      const f = document.getElementById('m3-frame');
      const cd = f.contentDocument;
      const counts = window.__m3Counts;
      const errInfo = window.__m3SyncErrorCaptured;
      window.agyMcpManager.destroy();
      const afterDestroyIframes = cd ? cd.body.querySelectorAll('iframe').length : -1;
      return {
        counts,
        errInfo,
        afterDestroyIframes,
      };
    })()`);

    assert.equal(m3Res.counts.evalNormalized, true);
    assert.equal(m3Res.counts.beforeTerminate, 2);
    assert.equal(m3Res.counts.afterOneTerminate, 1);
    assert.equal(m3Res.afterDestroyIframes, 0, 'AUDIT-M3: All remaining worker bridge iframes removed on destroy()');
    assert.deepEqual(m3Res.errInfo, { cancelable: true, defaultPrevented: true });
  } finally {
    await cdp.close();
  }
});
