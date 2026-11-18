'use strict';

/**
 * Isolated Remote Control Runtime Lease & Companion Manifest Parser (`antigravity-mcp-manager`).
 *
 * Responsibilities:
 * 1. Closure/Map-isolated `RemoteControlComponent.prototype` method chaining with deterministic
 *    restoration on `release()` (zero shared `__agyOrig_*` or `__agyMcpRcHooked` property pollution).
 * 2. Preservation of active `onIframeLoad` suppression (`__agySuppressAutoIframeLoad` or
 *    `__agySuppressAutoIframeLoadCount > 0`) across co-loaded Remote Control companions.
 * 3. Angular 19 Ivy component discovery (`ng.getComponent`, `LView` BFS, `ɵgetLContext`, guarded probe).
 * 4. Canonical `statusbar_autoinject.js` anchored companion block parser.
 */

const { resolveHostAdapterConfig } = require('./host-adapter-config');

const RC_TAP_METHODS = Object.freeze([
  'handleIframeMessage',
  'handleUrlChanged',
  'proxyCommand',
  'streamProxyCommand',
  'handlePortRequest',
  'managePolling',
  'shouldPoll',
  'loadInstances',
  'isDisconnected',
  'onIframeLoad',
  'onWindowOnline',
  'onWindowOffline',
  'isOffline',
  'isDirectIngressMode',
  'isTabHidden',
  'getSelectedInstance',
  'instanceInfos',
  'remoteConversationsInfos',
]);

function isAutoIframeLoadSuppressed(rcInst) {
  return Boolean(
    rcInst &&
      (rcInst.__agySuppressAutoIframeLoad ||
        (typeof rcInst.__agySuppressAutoIframeLoadCount === 'number' && rcInst.__agySuppressAutoIframeLoadCount > 0))
  );
}

function isRcComponentInstance(obj) {
  return Boolean(
    obj &&
      typeof obj === 'object' &&
      !obj.destroyed &&
      (typeof obj.proxyCommand === 'function' ||
        typeof obj.onIframeLoad === 'function' ||
        typeof obj.handleIframeMessage === 'function')
  );
}

function extractRcFromAngularLContext(lCtx) {
  if (!lCtx || typeof lCtx !== 'object') return null;
  if (isRcComponentInstance(lCtx)) return lCtx;
  if (isRcComponentInstance(lCtx.component)) return lCtx.component;
  const lView = lCtx.lView;
  if (Array.isArray(lView)) {
    try {
      const tView = lView[1];
      const nodeIndex = typeof lCtx.nodeIndex === 'number' ? lCtx.nodeIndex : -1;
      const tNode = nodeIndex >= 0 && Array.isArray(tView?.data) ? tView.data[nodeIndex] : null;
      if (
        tNode &&
        typeof tNode.directiveStart === 'number' &&
        typeof tNode.componentOffset === 'number' &&
        tNode.componentOffset > -1
      ) {
        const comp = lView[tNode.directiveStart + tNode.componentOffset];
        if (isRcComponentInstance(comp)) return comp;
      }
    } catch {}
    for (let i = 0; i < Math.min(lView.length, 300); i++) {
      if (isRcComponentInstance(lView[i])) return lView[i];
    }
  }
  return null;
}

function searchAngularContextBfs(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  const direct = extractRcFromAngularLContext(ctx);
  if (direct) return direct;
  const visited = new Set();
  const queue = [ctx];
  let steps = 0;
  while (queue.length > 0 && steps < 400) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object' || visited.has(cur)) continue;
    visited.add(cur);
    steps += 1;
    const extracted = extractRcFromAngularLContext(cur);
    if (extracted) return extracted;
    if (Array.isArray(cur)) {
      const scanLen = Math.min(cur.length, 300);
      for (let i = 0; i < scanLen; i++) {
        if (isRcComponentInstance(cur[i])) return cur[i];
      }
      for (let i = 0; i < scanLen; i++) {
        const item = cur[i];
        if (item && typeof item === 'object' && (Array.isArray(item) || isRcComponentInstance(item.component))) {
          queue.push(item);
        }
      }
    } else {
      for (const k of ['component', 'lView', 'data', 'context', '_lView']) {
        if (cur[k] && typeof cur[k] === 'object') queue.push(cur[k]);
      }
    }
  }
  return null;
}

function findAnchoredMarkerSpan(srcText, beginRe, endRe) {
  beginRe.lastIndex = 0;
  const bMatch = beginRe.exec(srcText);
  if (!bMatch) return { start: -1, end: -1 };
  const start = bMatch.index;
  endRe.lastIndex = bMatch.index + bMatch[0].length;
  const eMatch = endRe.exec(srcText);
  if (!eMatch) return { start, end: -1 };
  let end = eMatch.index + eMatch[0].length;
  while (true) {
    const afterEnd = srcText.slice(end);
    const nlMatch = /^(?:\r?\n)+/.exec(afterEnd);
    if (!nlMatch) break;
    const nextLineIdx = end + nlMatch[0].length;
    endRe.lastIndex = nextLineIdx;
    const nextEnd = endRe.exec(srcText);
    if (nextEnd && nextEnd.index === nextLineIdx) {
      end = nextEnd.index + nextEnd[0].length;
    } else {
      break;
    }
  }
  return { start, end };
}

function parseAutoinjectCompanionManifest(bundleText, discoveredPluginNames) {
  const text = typeof bundleText === 'string' ? bundleText : '';
  const pluginNames = discoveredPluginNames instanceof Set ? discoveredPluginNames : new Set(discoveredPluginNames || []);

  const mcpBeginStr = ['BEGIN_AGY_MCP', 'MANAGER'].join('_');
  const mcpEndStr = ['END_AGY_MCP', 'MANAGER'].join('_');
  const koBeginStr = ['BEGIN_AGY_KO', 'THOUGHT_LOCALIZER'].join('_');
  const koEndStr = ['END_AGY_KO', 'THOUGHT_LOCALIZER'].join('_');

  const mcpBeginRe = new RegExp(`^(?:\\/\\/ === ${mcpBeginStr}(?:_V\\d+)? ===|\\/\\* === ${mcpBeginStr}(?:_V\\d+)? === \\*\\/)[ \\t]*\\r?$`, 'gm');
  const mcpEndRe = new RegExp(`^(?:\\/\\/ === ${mcpEndStr}(?:_V\\d+)? ===|\\/\\* === ${mcpEndStr}(?:_V\\d+)? === \\*\\/)[ \\t]*\\r?$`, 'gm');
  const koBeginRe = new RegExp(`^(?:\\/\\/ === ${koBeginStr}(?:_V\\d+)? ===|\\/\\* === ${koBeginStr}(?:_V\\d+)? === \\*\\/)[ \\t]*\\r?$`, 'gm');
  const koEndRe = new RegExp(`^(?:\\/\\/ === ${koEndStr}(?:_V\\d+)? ===|\\/\\* === ${koEndStr}(?:_V\\d+)? === \\*\\/)[ \\t]*\\r?$`, 'gm');

  const mcpSpan = findAnchoredMarkerSpan(text, mcpBeginRe, mcpEndRe);
  const koSpan = findAnchoredMarkerSpan(text, koBeginRe, koEndRe);

  const firstMarkerIdx = [mcpSpan.start, koSpan.start].filter((i) => i !== -1).sort((a, b) => a - b)[0] ?? text.length;
  const baseSegment = text.slice(0, firstMarkerIdx).trim();

  const sbFuncRe = new RegExp(`^[ \\t]*function ${['mount', 'StatusBar'].join('')}\\s*\\(`, 'm');
  const mcpFuncRe = new RegExp(`^[ \\t]*function ${['mount', 'McpManager'].join('')}\\s*\\(`, 'm');

  const isBaseStatusbar = sbFuncRe.test(baseSegment);
  const hasMcpMarker = (mcpSpan.start !== -1 && mcpSpan.end > mcpSpan.start) || (!isBaseStatusbar && mcpFuncRe.test(baseSegment));
  const hasKoMarker = koSpan.start !== -1 && koSpan.end > koSpan.start;

  const statusbarBlock = isBaseStatusbar ? baseSegment : '';
  const mcpBlock =
    mcpSpan.start !== -1 && mcpSpan.end > mcpSpan.start ? text.slice(mcpSpan.start, mcpSpan.end).trim() : '';
  const koBlock =
    koSpan.start !== -1 && koSpan.end > koSpan.start ? text.slice(koSpan.start, koSpan.end).trim() : '';

  return {
    hasStatusbar: isBaseStatusbar || pluginNames.has('antigravity-statusbar'),
    hasMcpManager: hasMcpMarker || pluginNames.has('antigravity-mcp-manager'),
    hasKoTranslator: hasKoMarker || pluginNames.has('ko-thought-translator'),
    statusbarBlock,
    mcpBlock,
    koBlock,
    statusbarCode: statusbarBlock,
    mcpManagerCode: mcpBlock,
    koTranslatorCode: koBlock,
  };
}

function acquireRemoteRuntimeLease({ hostConfig, defaultWin }) {
  const resolvedHostConfig = resolveHostAdapterConfig(hostConfig, defaultWin);
  const hookedPrototypes = new Map();
  const hookedInstances = new Map();
  let disposed = false;

  function tapPrototype(targetWin, proto) {
    if (!proto || proto === Object.prototype || disposed) return;
    const existing = hookedPrototypes.get(proto);
    if (existing) {
      existing.setTargetWin(targetWin);
      return;
    }

    let currentTargetWin = targetWin || defaultWin;
    let protoDisposed = false;
    const wrappedMethods = new Map();

    for (const mName of RC_TAP_METHODS) {
      if (typeof proto[mName] !== 'function') continue;
      const prevFn = proto[mName];
      const wrappedFn = function (ev) {
        if (protoDisposed || disposed) {
          return prevFn.apply(this, arguments);
        }
        if (mName === 'onIframeLoad' && isAutoIframeLoadSuppressed(this)) {
          return Promise.resolve();
        }
        if (currentTargetWin && this && !this.destroyed) {
          currentTargetWin.__agyRemoteControlInstance = this;
        }
        if (mName === 'handleIframeMessage' && ev && ev.data === '__agy_probe__') return;
        if (
          currentTargetWin?.__agyProbingRcInstance &&
          (mName === 'handleUrlChanged' || mName === 'onIframeLoad' || mName === 'onWindowOnline' || mName === 'loadInstances')
        ) {
          return;
        }
        return prevFn.apply(this, arguments);
      };
      proto[mName] = wrappedFn;
      wrappedMethods.set(mName, { prevFn, wrappedFn });
    }

    hookedPrototypes.set(proto, {
      setTargetWin(w) {
        if (w) currentTargetWin = w;
      },
      getOriginal(mName) {
        return wrappedMethods.get(mName)?.prevFn || null;
      },
      release() {
        protoDisposed = true;
        for (const [mName, entry] of wrappedMethods.entries()) {
          if (proto[mName] === entry.wrappedFn) {
            proto[mName] = entry.prevFn;
          }
        }
        wrappedMethods.clear();
      },
    });
  }

  function tapInstanceOwnMethods(rcInst) {
    if (!rcInst || typeof rcInst !== 'object' || disposed) return;
    if (!Object.prototype.hasOwnProperty.call(rcInst, 'onIframeLoad')) return;
    if (typeof rcInst.onIframeLoad !== 'function') return;
    if (hookedInstances.has(rcInst)) return;

    let instDisposed = false;
    const prevOnLoad = rcInst.onIframeLoad;
    const wrappedOnLoad = function () {
      if (instDisposed || disposed) {
        return prevOnLoad.apply(this, arguments);
      }
      if (isAutoIframeLoadSuppressed(this)) {
        return Promise.resolve();
      }
      return prevOnLoad.apply(this, arguments);
    };
    rcInst.onIframeLoad = wrappedOnLoad;
    hookedInstances.set(rcInst, {
      prevOnLoad,
      wrappedOnLoad,
      release() {
        instDisposed = true;
        if (rcInst.onIframeLoad === wrappedOnLoad) {
          rcInst.onIframeLoad = prevOnLoad;
        }
      },
    });
  }

  function tapTarget(targetWin, rcInst) {
    if (!rcInst || typeof rcInst !== 'object' || disposed) return;
    tapPrototype(targetWin, Object.getPrototypeOf(rcInst));
    tapInstanceOwnMethods(rcInst);
  }

  function invokeOriginalOnIframeLoad(rcInst) {
    if (!rcInst || typeof rcInst !== 'object') return undefined;
    const ownEntry = hookedInstances.get(rcInst);
    if (ownEntry && typeof ownEntry.prevOnLoad === 'function') {
      return ownEntry.prevOnLoad.call(rcInst);
    }
    const protoEntry = hookedPrototypes.get(Object.getPrototypeOf(rcInst));
    const protoOrig = protoEntry?.getOriginal('onIframeLoad');
    if (typeof protoOrig === 'function') {
      return protoOrig.call(rcInst);
    }
    if (typeof rcInst.onIframeLoad === 'function') {
      return rcInst.onIframeLoad.call(rcInst);
    }
    return undefined;
  }

  function resolveRemoteControlInstance(w) {
    const targetWin = w || defaultWin;
    if (!targetWin || disposed) return null;
    if (targetWin.__agyRemoteControlInstance && !targetWin.__agyRemoteControlInstance.destroyed) {
      tapTarget(targetWin, targetWin.__agyRemoteControlInstance);
      return targetWin.__agyRemoteControlInstance;
    }

    const wDoc = targetWin.document;
    const rcEl = wDoc?.querySelector?.('ga-remote-control') || null;
    const gaRootEl = wDoc?.querySelector?.('ga-root') || null;

    if (rcEl) {
      const ngFn = targetWin.ng && typeof targetWin.ng.getComponent === 'function' ? targetWin.ng.getComponent : null;
      if (ngFn) {
        try {
          const comp = ngFn(rcEl);
          if (isRcComponentInstance(comp)) {
            targetWin.__agyRemoteControlInstance = comp;
            tapPrototype(targetWin, Object.getPrototypeOf(comp));
            return comp;
          }
        } catch {}
      }
      const ctxKey = Object.keys(rcEl).find((k) => k.startsWith('__ngContext'));
      const found = searchAngularContextBfs(rcEl.__ngContext__ || (ctxKey ? rcEl[ctxKey] : null));
      if (found) {
        targetWin.__agyRemoteControlInstance = found;
        tapPrototype(targetWin, Object.getPrototypeOf(found));
        return found;
      }
    }

    if (gaRootEl) {
      const rootCtxKey = Object.keys(gaRootEl).find((k) => k.startsWith('__ngContext'));
      const foundFromRoot = searchAngularContextBfs(gaRootEl.__ngContext__ || (rootCtxKey ? gaRootEl[rootCtxKey] : null));
      if (foundFromRoot) {
        targetWin.__agyRemoteControlInstance = foundFromRoot;
        tapPrototype(targetWin, Object.getPrototypeOf(foundFromRoot));
        return foundFromRoot;
      }
    }

    const nsRoot = targetWin.default_GoogleAntigravity;
    if (nsRoot && typeof nsRoot === 'object') {
      const targetCandidates = [];
      if (rcEl) {
        targetCandidates.push(rcEl);
        if (rcEl.firstElementChild) targetCandidates.push(rcEl.firstElementChild);
        if (typeof rcEl.querySelector === 'function') {
          const innerContainer = rcEl.querySelector('.app-container, .iframe-panel, iframe');
          if (innerContainer && !targetCandidates.includes(innerContainer)) {
            targetCandidates.push(innerContainer);
          }
        }
      }
      if (gaRootEl) {
        targetCandidates.push(gaRootEl);
        if (gaRootEl.firstElementChild) targetCandidates.push(gaRootEl.firstElementChild);
      }

      for (const k of Object.keys(nsRoot)) {
        const mod = nsRoot[k];
        if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) continue;
        for (const targetEl of targetCandidates) {
          if (!targetEl) continue;
          try {
            if (typeof mod.getDebugNode === 'function') {
              const dbgNode = mod.getDebugNode(targetEl);
              const dbgComp = dbgNode?.componentInstance || dbgNode?.context;
              if (isRcComponentInstance(dbgComp)) {
                targetWin.__agyRemoteControlInstance = dbgComp;
                tapPrototype(targetWin, Object.getPrototypeOf(dbgComp));
                return dbgComp;
              }
              const foundFromDbg = searchAngularContextBfs(dbgComp || dbgNode);
              if (foundFromDbg) {
                targetWin.__agyRemoteControlInstance = foundFromDbg;
                tapPrototype(targetWin, Object.getPrototypeOf(foundFromDbg));
                return foundFromDbg;
              }
            }
            if (typeof mod.getComponent === 'function') {
              const comp = mod.getComponent(targetEl);
              if (isRcComponentInstance(comp)) {
                targetWin.__agyRemoteControlInstance = comp;
                tapPrototype(targetWin, Object.getPrototypeOf(comp));
                return comp;
              }
            }
            const getLCtx = mod['\u0275getLContext'] || mod.getLContext;
            if (typeof getLCtx === 'function') {
              const lCtx = getLCtx(targetEl);
              const foundFromLCtx = extractRcFromAngularLContext(lCtx) || searchAngularContextBfs(lCtx?.lView || lCtx);
              if (foundFromLCtx) {
                targetWin.__agyRemoteControlInstance = foundFromLCtx;
                tapPrototype(targetWin, Object.getPrototypeOf(foundFromLCtx));
                return foundFromLCtx;
              }
            }
          } catch {}
        }
        const RC = mod.RemoteControlComponent || (typeof mod.prototype?.proxyCommand === 'function' ? mod : null);
        if (RC && RC.prototype && typeof RC.prototype.proxyCommand === 'function') {
          tapPrototype(targetWin, RC.prototype);
        }
      }
    }

    targetWin.__agyProbingRcInstance = true;
    try {
      const BaseEvt = targetWin.Event || (typeof Event !== 'undefined' ? Event : null);
      if (!targetWin.__agyRemoteControlInstance && BaseEvt && typeof wDoc?.dispatchEvent === 'function') {
        wDoc.dispatchEvent(new BaseEvt('visibilitychange'));
      }
      if (!targetWin.__agyRemoteControlInstance && BaseEvt && typeof targetWin.dispatchEvent === 'function') {
        targetWin.dispatchEvent(new BaseEvt('online'));
      }
      if (!targetWin.__agyRemoteControlInstance && typeof targetWin.dispatchEvent === 'function') {
        const Evt = targetWin.MessageEvent || (typeof MessageEvent !== 'undefined' ? MessageEvent : null);
        if (Evt) {
          const iframeEl = rcEl?.querySelector?.('iframe') || wDoc?.querySelector?.('ga-remote-control iframe') || null;
          let iframeWin = null;
          try {
            iframeWin = iframeEl?.contentWindow || null;
          } catch {}
          const rawIframeSrc = iframeEl?.getAttribute?.('src') || iframeEl?.src || '';
          const candidateOrigins = [];
          const defaultRemoteOrigin = `https://${resolvedHostConfig.remoteHostDomains[0] || 'antigravity.google.com'}`;
          try {
            if (rawIframeSrc) {
              candidateOrigins.push(new URL(rawIframeSrc, targetWin.location?.href || defaultRemoteOrigin).origin);
            }
          } catch {}
          if (targetWin.location?.origin && !candidateOrigins.includes(targetWin.location.origin)) {
            candidateOrigins.push(targetWin.location.origin);
          }
          for (const cdnOrig of resolvedHostConfig.staticCdnOrigins) {
            if (cdnOrig && !candidateOrigins.includes(cdnOrig)) {
              candidateOrigins.push(cdnOrig);
            }
          }
          for (const orig of candidateOrigins) {
            if (targetWin.__agyRemoteControlInstance) break;
            targetWin.dispatchEvent(
              new Evt('message', {
                data: { type: 'URL_CHANGED', path: '' },
                origin: orig,
                source: iframeWin,
              })
            );
          }
          if (!targetWin.__agyRemoteControlInstance) {
            targetWin.dispatchEvent(new Evt('message', { data: '__agy_probe__' }));
          }
        }
      }
    } catch {} finally {
      targetWin.__agyProbingRcInstance = false;
    }

    return targetWin.__agyRemoteControlInstance && !targetWin.__agyRemoteControlInstance.destroyed
      ? targetWin.__agyRemoteControlInstance
      : null;
  }

  function release() {
    if (disposed) return;
    disposed = true;
    for (const [, rec] of hookedInstances.entries()) {
      try {
        rec.release();
      } catch {}
    }
    hookedInstances.clear();
    for (const [, rec] of hookedPrototypes.entries()) {
      try {
        rec.release();
      } catch {}
    }
    hookedPrototypes.clear();
    if (defaultWin) {
      try {
        delete defaultWin.__agyProbingRcInstance;
      } catch {}
    }
  }

  return {
    resolvedHostConfig,
    tapPrototype,
    tapTarget,
    invokeOriginalOnIframeLoad,
    resolveRemoteControlInstance,
    release,
  };
}

module.exports = {
  RC_TAP_METHODS,
  isAutoIframeLoadSuppressed,
  parseAutoinjectCompanionManifest,
  acquireRemoteRuntimeLease,
};
