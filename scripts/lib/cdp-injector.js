'use strict';

/**
 * Local DevTools Protocol Page Discovery, Bundle Sync, and Unmount Helper (`scripts/lib/cdp-injector.js`).
 */

const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { createRfc6455WebSocketClient } = require('./rfc6455-ws');

function sha256Short(str) {
  return crypto.createHash('sha256').update(String(str || '')).digest('hex').slice(0, 16);
}

function readDevToolsEndpoint(devToolsPortFile) {
  try {
    if (!devToolsPortFile || !fs.existsSync(devToolsPortFile)) return null;
    const lines = fs.readFileSync(devToolsPortFile, 'utf8').trim().split(/\r?\n/);
    const port = parseInt(lines[0], 10);
    if (!port || Number.isNaN(port)) return null;
    const rawWsLine = (lines[1] || '').trim();
    const browserWsUrl = rawWsLine
      ? rawWsLine.startsWith('ws://') || rawWsLine.startsWith('wss://')
        ? rawWsLine
        : `ws://127.0.0.1:${port}${rawWsLine.startsWith('/') ? rawWsLine : `/${rawWsLine}`}`
      : null;
    return { port, browserWsUrl };
  } catch {
    return null;
  }
}

function httpGetJson(port, reqPath, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: reqPath, timeout: timeoutMs }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('HTTP timeout'));
    });
  });
}

function isEligiblePageTarget(target) {
  if (!target || target.type !== 'page') return false;
  const u = String(target.url || '');
  return (
    !u.startsWith('devtools://') &&
    !u.startsWith('chrome-devtools://') &&
    !u.startsWith('data:') &&
    !u.startsWith('about:')
  );
}

function evaluateOnPageWs(wsUrl, expression, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws = null;
    try {
      ws = createRfc6455WebSocketClient(wsUrl);
    } catch (err) {
      reject(err);
      return;
    }

    const done = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // Ignore
      }
      if (err) reject(err);
      else resolve(val);
    };

    const timer = setTimeout(() => {
      done(new Error('CDP page evaluation timeout'));
    }, timeoutMs);

    ws.onopen = () => {
      try {
        ws.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true },
          })
        );
      } catch (err) {
        done(err);
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data || ''));
        if (msg && msg.id === 1) {
          if (msg.error) {
            done(new Error(msg.error.message || 'CDP evaluation error'));
          } else if (msg.result?.exceptionDetails) {
            done(new Error(msg.result.exceptionDetails.text || 'CDP runtime exception'));
          } else {
            done(null, msg.result?.result?.value ?? null);
          }
        }
      } catch {
        // Ignore unrelated event messages
      }
    };

    ws.onerror = (err) => done(err);
    ws.onclose = () => done(new Error('CDP socket closed before response'));
  });
}

function evaluateAcrossBrowserTargets(browserWsUrl, expression, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    let closed = false;
    let nextId = 1;
    const pending = new Map();
    let ws = null;

    try {
      ws = createRfc6455WebSocketClient(browserWsUrl);
    } catch (err) {
      reject(err);
      return;
    }

    const finish = (err, val) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      for (const [, p] of pending) {
        p.reject(err || new Error('Browser CDP closed'));
      }
      pending.clear();
      try {
        ws.close();
      } catch {
        // Ignore
      }
      if (err) reject(err);
      else resolve(val);
    };

    const timer = setTimeout(() => finish(new Error('Browser CDP timeout')), timeoutMs);

    const sendCmd = (method, params = {}, sessionId = undefined) =>
      new Promise((res, rej) => {
        if (closed) {
          rej(new Error('Browser CDP closed'));
          return;
        }
        const id = nextId++;
        pending.set(id, { resolve: res, reject: rej });
        const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
        try {
          ws.send(JSON.stringify(payload));
        } catch (err) {
          pending.delete(id);
          rej(err);
        }
      });

    ws.onmessage = (ev) => {
      if (closed) return;
      try {
        const msg = JSON.parse(String(ev.data || ''));
        if (msg && typeof msg.id === 'number' && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || 'CDP command error'));
          else p.resolve(msg.result);
        }
      } catch {
        // Ignore event notifications
      }
    };

    ws.onerror = (err) => finish(err);
    ws.onclose = () => finish(new Error('Browser CDP closed early'));

    ws.onopen = async () => {
      try {
        const targetsRes = await sendCmd('Target.getTargets', {});
        const infos = Array.isArray(targetsRes?.targetInfos) ? targetsRes.targetInfos : [];
        const pages = infos.filter((t) => t && t.targetId && isEligiblePageTarget(t));
        const values = [];

        for (let i = 0; i < pages.length; i += 1) {
          let sessionId = null;
          try {
            const attached = await sendCmd('Target.attachToTarget', {
              targetId: pages[i].targetId,
              flatten: true,
            });
            sessionId = attached?.sessionId || null;
            if (!sessionId) continue;
            const evalRes = await sendCmd(
              'Runtime.evaluate',
              { expression, returnByValue: true },
              sessionId
            );
            if (!evalRes?.exceptionDetails) {
              values.push(evalRes?.result?.value ?? null);
            }
          } catch {
            // Continue other targets
          } finally {
            if (sessionId) {
              await sendCmd('Target.detachFromTarget', { sessionId }).catch(() => {});
            }
          }
        }
        finish(null, { pageTargetCount: pages.length, values });
      } catch (err) {
        finish(err);
      }
    };
  });
}

async function runExpressionOnLiveTargets(devToolsPortFile, expression) {
  const endpoint = readDevToolsEndpoint(devToolsPortFile);
  if (!endpoint || !endpoint.port) {
    return { attempted: false, reason: 'devtools_port_missing', updatedCount: 0 };
  }

  const { port } = endpoint;
  let { browserWsUrl } = endpoint;

  let pageTargets = [];
  try {
    const list = await httpGetJson(port, '/json/list', 1200);
    pageTargets = (Array.isArray(list) ? list : []).filter(
      (t) => t && t.webSocketDebuggerUrl && isEligiblePageTarget(t)
    );
  } catch {
    pageTargets = [];
  }

  if (pageTargets.length > 0) {
    const settled = await Promise.allSettled(
      pageTargets.map((t) => evaluateOnPageWs(t.webSocketDebuggerUrl, expression, 1800))
    );
    let updatedCount = 0;
    for (let i = 0; i < settled.length; i += 1) {
      if (settled[i].status === 'fulfilled' && settled[i].value) {
        updatedCount += 1;
      }
    }
    return {
      attempted: true,
      mode: 'http_json_list',
      pageTargetCount: pageTargets.length,
      updatedCount,
    };
  }

  if (!browserWsUrl) {
    try {
      const ver = await httpGetJson(port, '/json/version', 1000);
      if (ver && typeof ver.webSocketDebuggerUrl === 'string') {
        browserWsUrl = ver.webSocketDebuggerUrl;
      }
    } catch {
      browserWsUrl = null;
    }
  }

  if (browserWsUrl) {
    try {
      const res = await evaluateAcrossBrowserTargets(browserWsUrl, expression, 3500);
      return {
        attempted: true,
        mode: 'browser_ws',
        pageTargetCount: res.pageTargetCount,
        updatedCount: res.values.filter(Boolean).length,
      };
    } catch (err) {
      return {
        attempted: true,
        mode: 'browser_ws_failed',
        updatedCount: 0,
        error: err?.message || String(err),
      };
    }
  }

  return { attempted: true, mode: 'none', pageTargetCount: 0, updatedCount: 0 };
}

/**
 * Evaluates the combined `autoinjectPath` script across live Antigravity windows via CDP.
 *
 * @param {{ autoinjectPath: string, devToolsPortFile: string }} paths
 */
async function injectViaCdpLive(paths) {
  if (!paths?.autoinjectPath || !fs.existsSync(paths.autoinjectPath)) {
    return { attempted: false, reason: 'autoinject_script_missing', updatedCount: 0 };
  }
  const code = fs.readFileSync(paths.autoinjectPath, 'utf8');
  const hash = sha256Short(code);
  const expr = `(() => {
    if (window.agyMcpManager && window.__agyStatusBarHash === ${JSON.stringify(hash)}) {
      return 'ALREADY_ACTIVE';
    }
    ${code}
    window.__agyStatusBarHash = ${JSON.stringify(hash)};
    return 'INJECTED_OK';
  })()`;
  return await runExpressionOnLiveTargets(paths.devToolsPortFile, expr);
}

/**
 * Tears down ONLY `window.agyMcpManager` across live Antigravity windows via CDP (`--uninstall`),
 * leaving companion plugins (`agyStatusBar`, `ko-thought-translator`) intact.
 *
 * @param {{ devToolsPortFile: string }} paths
 */
async function destroyMcpManagerViaCdpLive(paths) {
  const expr = `(() => {
    if (window.agyMcpManager && typeof window.agyMcpManager.destroy === 'function') {
      window.agyMcpManager.destroy();
      delete window.__agyStatusBarHash;
      return 'DESTROYED_OK';
    }
    return '';
  })()`;
  return await runExpressionOnLiveTargets(paths?.devToolsPortFile, expr);
}

module.exports = {
  readDevToolsEndpoint,
  injectViaCdpLive,
  destroyMcpManagerViaCdpLive,
};
