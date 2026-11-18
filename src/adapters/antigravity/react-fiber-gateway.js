'use strict';

/**
 * Bounded React Fiber Gateway for Antigravity Desktop / Promoted Workbench.
 *
 * Traverses at most `MAX_FIBER_NODES` (3,500) per scan with a 10-second negative-scan
 * throttle so large React trees never stall UI responsiveness.
 */

const MAX_FIBER_NODES = 3500;
const FAILED_SCAN_THROTTLE_MS = 10000;

function isLanguageServerClientCandidate(obj) {
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return false;
  return (
    typeof obj.getMcpServerStates === 'function' ||
    typeof obj.refreshMcpServers === 'function' ||
    typeof obj.toggleMcpServer === 'function' ||
    (typeof obj.readFile === 'function' && typeof obj.writeFile === 'function')
  );
}

function extractFiberFromDomNode(domNode) {
  if (!domNode || typeof domNode !== 'object') return null;
  const keys = Object.keys(domNode);
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    if (
      k.startsWith('__reactFiber$') ||
      k.startsWith('__reactContainer$') ||
      k.startsWith('__reactInternalInstance$')
    ) {
      const val = domNode[k];
      if (val && typeof val === 'object') return val;
    }
  }
  return null;
}

/**
 * Creates a bounded React Fiber gateway bound to `win` and `doc`.
 *
 * @param {{ win: any, doc: any, nowFn?: () => number }} options
 */
function createReactFiberGateway(options) {
  const { win, doc } = options;
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now();

  let cachedService = null;
  let cachedConfigDir = '';
  let cachedElectronFeature = null;
  let lastFailedScanAt = -Infinity;

  const inspectValueBag = (val, depth = 0) => {
    if (!val || typeof val !== 'object' || depth > 3) return;

    if (!cachedService && isLanguageServerClientCandidate(val)) {
      cachedService = val;
    }

    if (typeof val.get === 'function' && !(val instanceof Map) && !(val instanceof WeakMap)) {
      try {
        if (!cachedService) {
          const lsSvc = val.get('languageServerService') || val.get('LanguageServerService');
          if (isLanguageServerClientCandidate(lsSvc)) cachedService = lsSvc;
        }
      } catch {
        // Ignore DI container lookup misses
      }
      try {
        if (!cachedElectronFeature) {
          const ef = val.get('electronNativeFeature');
          if (ef && typeof ef === 'object') cachedElectronFeature = ef;
        }
      } catch {
        // Ignore DI container lookup misses
      }
    }

    if (!cachedElectronFeature && val.electronNativeFeature && typeof val.electronNativeFeature === 'object') {
      cachedElectronFeature = val.electronNativeFeature;
    }

    if (!cachedConfigDir) {
      const dirCandidate = val.selectedConfigDir || val.selectedGeminiDir || val.geminiConfigDir;
      if (typeof dirCandidate === 'string' && dirCandidate.trim()) {
        cachedConfigDir = dirCandidate.trim();
      }
    }

    if (depth < 2) {
      const subKeys = ['client', 'service', 'languageServerService', 'languageServerClient', 'value', 'context'];
      for (let i = 0; i < subKeys.length; i += 1) {
        const sub = val[subKeys[i]];
        if (sub && typeof sub === 'object') {
          inspectValueBag(sub, depth + 1);
        }
      }
    }
  };

  const scanDocumentWindow = (targetWin, targetDoc) => {
    if (targetWin && isLanguageServerClientCandidate(targetWin.__agyCapturedLsClient)) {
      cachedService = targetWin.__agyCapturedLsClient;
    }
    if (targetWin && isLanguageServerClientCandidate(targetWin.__agyLanguageServerService)) {
      cachedService = targetWin.__agyLanguageServerService;
    }
    if (targetWin && targetWin.__agyElectronNativeFeature && !cachedElectronFeature) {
      cachedElectronFeature = targetWin.__agyElectronNativeFeature;
    }

    if (!targetDoc) return;
    const roots = [];
    if (typeof targetDoc.getElementById === 'function') {
      const r1 = targetDoc.getElementById('root');
      const r2 = targetDoc.getElementById('app');
      if (r1) roots.push(r1);
      if (r2) roots.push(r2);
    }
    if (targetDoc.body) roots.push(targetDoc.body);
    if (targetDoc.documentElement) roots.push(targetDoc.documentElement);

    const fiberQueue = [];
    const visitedFibers = new Set();

    for (let i = 0; i < roots.length; i += 1) {
      const rootEl = roots[i];
      const f = extractFiberFromDomNode(rootEl);
      if (f && !visitedFibers.has(f)) {
        visitedFibers.add(f);
        fiberQueue.push(f);
      }
      const kids = rootEl?.children || [];
      for (let k = 0; k < Math.min(kids.length, 24); k += 1) {
        const kf = extractFiberFromDomNode(kids[k]);
        if (kf && !visitedFibers.has(kf)) {
          visitedFibers.add(kf);
          fiberQueue.push(kf);
        }
      }
    }

    let visitedCount = 0;
    while (fiberQueue.length > 0 && visitedCount < MAX_FIBER_NODES) {
      const node = fiberQueue.shift();
      visitedCount += 1;

      inspectValueBag(node.memoizedProps, 0);
      inspectValueBag(node.pendingProps, 0);
      inspectValueBag(node.stateNode, 0);

      let memoState = node.memoizedState;
      let hookSteps = 0;
      while (memoState && typeof memoState === 'object' && hookSteps < 24) {
        inspectValueBag(memoState.memoizedState, 0);
        memoState = memoState.next;
        hookSteps += 1;
      }

      let dep = node.dependencies?.firstContext;
      let depSteps = 0;
      while (dep && typeof dep === 'object' && depSteps < 16) {
        inspectValueBag(dep.memoizedValue, 0);
        dep = dep.next;
        depSteps += 1;
      }

      if (cachedService && cachedConfigDir && cachedElectronFeature) {
        break;
      }

      if (node.child && !visitedFibers.has(node.child)) {
        visitedFibers.add(node.child);
        fiberQueue.push(node.child);
      }
      if (node.sibling && !visitedFibers.has(node.sibling)) {
        visitedFibers.add(node.sibling);
        fiberQueue.push(node.sibling);
      }
    }
  };

  function resolveSnapshot(force = false) {
    if (cachedService && !force) {
      return {
        service: cachedService,
        configDir: cachedConfigDir,
        electronNativeFeature: cachedElectronFeature,
      };
    }

    const now = nowFn();
    if (!force && !cachedService && now - lastFailedScanAt < FAILED_SCAN_THROTTLE_MS) {
      return {
        service: null,
        configDir: cachedConfigDir,
        electronNativeFeature: cachedElectronFeature,
      };
    }

    scanDocumentWindow(win, doc);

    if (!cachedService && doc && typeof doc.querySelector === 'function') {
      try {
        const promotedIframe = doc.querySelector('ga-remote-control iframe, iframe');
        const cw = promotedIframe?.contentWindow;
        const cd = promotedIframe?.contentDocument || cw?.document;
        if (cw) {
          scanDocumentWindow(cw, cd);
        }
      } catch {
        // Cross-origin iframe before promotion — ignore
      }
    }

    if (!cachedService) {
      lastFailedScanAt = now;
    }

    return {
      service: cachedService,
      configDir: cachedConfigDir,
      electronNativeFeature: cachedElectronFeature,
    };
  }

  function resetCache() {
    cachedService = null;
    cachedConfigDir = '';
    cachedElectronFeature = null;
    lastFailedScanAt = -Infinity;
  }

  return {
    resolveSnapshot,
    getLanguageServerService(force = false) {
      return resolveSnapshot(force).service;
    },
    getConfigDir(force = false) {
      return resolveSnapshot(force).configDir;
    },
    getElectronNativeFeature(force = false) {
      return resolveSnapshot(force).electronNativeFeature;
    },
    resetCache,
    dispose() {
      resetCache();
    },
  };
}

module.exports = {
  MAX_FIBER_NODES,
  FAILED_SCAN_THROTTLE_MS,
  isLanguageServerClientCandidate,
  createReactFiberGateway,
};
