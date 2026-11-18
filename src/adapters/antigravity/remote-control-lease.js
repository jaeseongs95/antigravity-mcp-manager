'use strict';

/**
 * Angular 19 `RemoteControlComponent` Isolated Prototype Lease & Suppression Ref-Counter.
 *
 * Invariants:
 * 1. Multiple concurrent leases (or companion plugins) share a reference-counted tap registry
 *    on each prototype so releasing one lease never strips active companion subscribers,
 *    while releasing the final lease restores all 18 prototype methods to their exact originals.
 * 2. `__agySuppressAutoIframeLoadCount` is strictly reference-counted (`MCP-TC-030`).
 */

const RC_TAP_METHODS = Object.freeze([
  'ngOnInit',
  'ngAfterViewInit',
  'onIframeLoad',
  'proxyCommand',
  'connect',
  'reconnect',
  'disconnect',
  'sendToIframe',
  'handleIframeMessage',
  'markIframeReady',
  'updateIframeSrc',
  'iframeSrc',
  'resetIframe',
  'onSessionChange',
  'openExternalUrl',
  'fetchMcpStates',
  'refreshMcp',
  'ngOnDestroy',
]);

const PROTO_REGISTRY_SYMBOL = Symbol.for('agy.remoteControlPrototypeRegistry.v2');

function isRemoteControlComponentCandidate(inst) {
  if (!inst || typeof inst !== 'object') return false;
  return (
    typeof inst.proxyCommand === 'function' ||
    typeof inst.onIframeLoad === 'function' ||
    (typeof inst.iframeSrc === 'function' && ('iframeLoading' in inst || 'iframeUiReady' in inst))
  );
}

/**
 * Discovers the active Angular 19 `RemoteControlComponent` instance from `win` / `doc`.
 *
 * @param {any} win
 * @param {any} [doc]
 */
function resolveRemoteControlInstance(win, doc) {
  if (!win) return null;
  if (isRemoteControlComponentCandidate(win.__agyRemoteControlInstance)) {
    return win.__agyRemoteControlInstance;
  }

  const targetDoc = doc || win.document;
  if (!targetDoc || typeof targetDoc.querySelector !== 'function') return null;

  let hostEl = null;
  try {
    hostEl = targetDoc.querySelector('ga-remote-control');
  } catch {
    return null;
  }
  if (!hostEl) return null;

  try {
    const viaNgGet = win.ng?.getComponent?.(hostEl);
    if (isRemoteControlComponentCandidate(viaNgGet)) {
      win.__agyRemoteControlInstance = viaNgGet;
      return viaNgGet;
    }
  } catch {
    // Continue to Ivy LView context inspection
  }

  try {
    const lCtx = win.ng?.ɵgetLContext?.(hostEl);
    if (lCtx && isRemoteControlComponentCandidate(lCtx.component)) {
      win.__agyRemoteControlInstance = lCtx.component;
      return lCtx.component;
    }
  } catch {
    // Continue to __ngContext__ scan
  }

  const rawCtx = hostEl.__ngContext__;
  if (rawCtx) {
    const visited = new Set();
    const queue = [rawCtx];
    let steps = 0;
    while (queue.length > 0 && steps < 120) {
      const item = queue.shift();
      steps += 1;
      if (!item || typeof item !== 'object' || visited.has(item)) continue;
      visited.add(item);

      if (isRemoteControlComponentCandidate(item)) {
        win.__agyRemoteControlInstance = item;
        return item;
      }
      if (Array.isArray(item)) {
        for (let i = 0; i < Math.min(item.length, 60); i += 1) {
          const el = item[i];
          if (el && typeof el === 'object') queue.push(el);
        }
      } else if (item.lView && Array.isArray(item.lView)) {
        queue.push(item.lView);
      }
    }
  }

  return null;
}

/**
 * Increments the shared auto-iframe-load suppression counter on `rcInst`.
 *
 * @param {any} rcInst
 */
function incrementIframeSuppression(rcInst) {
  if (!rcInst || typeof rcInst !== 'object') return () => {};
  rcInst.__agySuppressAutoIframeLoadCount = (rcInst.__agySuppressAutoIframeLoadCount || 0) + 1;
  rcInst.__agySuppressAutoIframeLoad = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    decrementIframeSuppression(rcInst);
  };
}

/**
 * Decrements the shared auto-iframe-load suppression counter on `rcInst`.
 *
 * @param {any} rcInst
 */
function decrementIframeSuppression(rcInst) {
  if (!rcInst || typeof rcInst !== 'object') return;
  const next = Math.max(0, (rcInst.__agySuppressAutoIframeLoadCount || 1) - 1);
  if (next === 0) {
    delete rcInst.__agySuppressAutoIframeLoadCount;
    rcInst.__agySuppressAutoIframeLoad = false;
    delete rcInst.__agySuppressAutoIframeLoad;
  } else {
    rcInst.__agySuppressAutoIframeLoadCount = next;
    rcInst.__agySuppressAutoIframeLoad = true;
  }
}

function ensurePrototypeTapRegistry(proto) {
  let reg = proto[PROTO_REGISTRY_SYMBOL];
  if (reg) return reg;

  const originalDescriptors = new Map();
  const activeLeases = new Set();

  const installWrappers = () => {
    for (let i = 0; i < RC_TAP_METHODS.length; i += 1) {
      const method = RC_TAP_METHODS[i];
      if (originalDescriptors.has(method)) continue;
      const desc = Object.getOwnPropertyDescriptor(proto, method);
      const origFn = desc && typeof desc.value === 'function' ? desc.value : (typeof proto[method] === 'function' ? proto[method] : null);
      if (!origFn) continue;

      originalDescriptors.set(method, { desc: desc || null, origFn });

      const wrapped = function (...args) {
        for (const lease of activeLeases) {
          if (typeof lease.onMethodCall === 'function') {
            lease.onMethodCall(method, this, args);
          }
        }
        if (
          method === 'onIframeLoad' &&
          this &&
          (this.__agySuppressAutoIframeLoad === true || (this.__agySuppressAutoIframeLoadCount || 0) > 0)
        ) {
          return undefined;
        }
        return origFn.apply(this, args);
      };

      Object.defineProperty(proto, method, {
        value: wrapped,
        writable: desc ? Boolean(desc.writable) : true,
        configurable: true,
        enumerable: desc ? Boolean(desc.enumerable) : false,
      });
    }
  };

  const restoreOriginalsIfEmpty = () => {
    if (activeLeases.size > 0) return;
    for (const [method, saved] of originalDescriptors.entries()) {
      if (saved.desc) {
        Object.defineProperty(proto, method, saved.desc);
      } else {
        delete proto[method];
      }
    }
    originalDescriptors.clear();
    delete proto[PROTO_REGISTRY_SYMBOL];
  };

  reg = {
    originalDescriptors,
    activeLeases,
    addLease(leaseEntry) {
      if (activeLeases.size === 0) {
        installWrappers();
      }
      activeLeases.add(leaseEntry);
    },
    removeLease(leaseEntry) {
      activeLeases.delete(leaseEntry);
      restoreOriginalsIfEmpty();
    },
    invokeOriginal(method, receiver, args = []) {
      const saved = originalDescriptors.get(method);
      if (saved && typeof saved.origFn === 'function') {
        return saved.origFn.apply(receiver, args);
      }
      const fn = receiver && typeof receiver[method] === 'function' ? receiver[method] : null;
      return fn ? fn.apply(receiver, args) : undefined;
    },
  };

  Object.defineProperty(proto, PROTO_REGISTRY_SYMBOL, {
    value: reg,
    configurable: true,
    enumerable: false,
    writable: false,
  });

  return reg;
}

/**
 * Acquires an isolated prototype tap lease for `RemoteControlComponent`.
 *
 * @param {{
 *   win?: any,
 *   doc?: any,
 *   onInstanceSeen?: (rcInst: any, method: string) => void
 * }} [options]
 */
function acquireRemoteControlLease(options = {}) {
  const defaultWin = options.win || null;
  const defaultDoc = options.doc || defaultWin?.document || null;
  let released = false;
  let latestInstance = null;
  const attachedRegistries = new Set();

  const leaseEntry = {
    onMethodCall(method, inst) {
      if (released) return;
      if (inst && typeof inst === 'object') {
        latestInstance = inst;
        if (defaultWin) {
          defaultWin.__agyRemoteControlInstance = inst;
        }
        if (typeof options.onInstanceSeen === 'function') {
          options.onInstanceSeen(inst, method);
        }
      }
    },
  };

  function tapTarget(winArg, rcInstArg) {
    if (released) return null;
    const targetWin = winArg || defaultWin;
    const inst = rcInstArg || resolveRemoteControlInstance(targetWin, defaultDoc) || latestInstance;
    if (!inst || typeof inst !== 'object') return null;

    latestInstance = inst;
    if (targetWin) {
      targetWin.__agyRemoteControlInstance = inst;
    }

    const proto = Object.getPrototypeOf(inst);
    if (proto && proto !== Object.prototype) {
      const reg = ensurePrototypeTapRegistry(proto);
      reg.addLease(leaseEntry);
      attachedRegistries.add(reg);
    }
    return inst;
  }

  function invokeOriginalOnIframeLoad(rcInst) {
    const target = rcInst || latestInstance;
    if (!target) return undefined;
    const proto = Object.getPrototypeOf(target);
    const reg = proto ? proto[PROTO_REGISTRY_SYMBOL] : null;
    if (reg) {
      return reg.invokeOriginal('onIframeLoad', target, []);
    }
    if (typeof target.onIframeLoad === 'function') {
      return target.onIframeLoad();
    }
    return undefined;
  }

  function release() {
    if (released) return;
    released = true;
    for (const reg of attachedRegistries) {
      reg.removeLease(leaseEntry);
    }
    attachedRegistries.clear();
    latestInstance = null;
  }

  return {
    tapTarget,
    getInstance(winArg, docArg) {
      if (released) return null;
      return tapTarget(winArg || defaultWin, resolveRemoteControlInstance(winArg || defaultWin, docArg || defaultDoc));
    },
    invokeOriginalOnIframeLoad,
    release,
    dispose: release,
  };
}

module.exports = {
  RC_TAP_METHODS,
  isRemoteControlComponentCandidate,
  resolveRemoteControlInstance,
  incrementIframeSuppression,
  decrementIframeSuppression,
  acquireRemoteControlLease,
};
