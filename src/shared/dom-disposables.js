'use strict';

/**
 * Window-Bound DOM, Timer, Observer, MessagePort, and AbortController Lifecycle Helpers.
 *
 * Keeps `src/core/disposable.js` 100% pure ECMAScript while binding all browser/host
 * timers and event subscriptions to explicit `DisposableStore` lifecycles.
 */

const { toDisposable } = require('../core/disposable');

/**
 * Schedules a one-shot timer bound to `win` and returns an `IDisposable` that cancels it.
 *
 * @param {any} win
 * @param {() => void} fn
 * @param {number} ms
 */
function disposableTimeout(win, fn, ms) {
  const host = win && typeof win.setTimeout === 'function' ? win : globalThis;
  const setFn = host.setTimeout;
  const clearFn = host.clearTimeout;
  let active = true;
  const handle = setFn.call(
    host,
    () => {
      active = false;
      fn();
    },
    ms
  );
  if (handle && typeof handle === 'object' && typeof handle.unref === 'function') {
    handle.unref();
  }
  return toDisposable(() => {
    if (!active) return;
    active = false;
    if (typeof clearFn === 'function') {
      clearFn.call(host, handle);
    }
  });
}

/**
 * Schedules a repeating interval bound to `win` and returns an `IDisposable` that clears it.
 *
 * @param {any} win
 * @param {() => void} fn
 * @param {number} ms
 */
function disposableInterval(win, fn, ms) {
  const host = win && typeof win.setInterval === 'function' ? win : globalThis;
  const setFn = host.setInterval;
  const clearFn = host.clearInterval;
  let active = true;
  const handle = setFn.call(host, () => {
    if (!active) return;
    fn();
  }, ms);
  if (handle && typeof handle === 'object' && typeof handle.unref === 'function') {
    handle.unref();
  }
  return toDisposable(() => {
    if (!active) return;
    active = false;
    if (typeof clearFn === 'function') {
      clearFn.call(host, handle);
    }
  });
}

/**
 * Registers an event listener on `target` and removes it on `dispose()`.
 *
 * @param {any} target
 * @param {string} type
 * @param {Function} listener
 * @param {boolean | AddEventListenerOptions} [options]
 */
function disposableEvent(target, type, listener, options) {
  if (!target || typeof target.addEventListener !== 'function') {
    return toDisposable(() => {});
  }
  target.addEventListener(type, listener, options);
  let removed = false;
  return toDisposable(() => {
    if (removed) return;
    removed = true;
    if (typeof target.removeEventListener === 'function') {
      target.removeEventListener(type, listener, options);
    }
  });
}

/**
 * Starts (optionally) and tracks a `MutationObserver` / `ResizeObserver` / `IntersectionObserver`.
 *
 * @param {any} observer
 * @param {any} [target]
 * @param {any} [options]
 */
function disposableObserver(observer, target, options) {
  if (!observer) {
    return toDisposable(() => {});
  }
  if (target && typeof observer.observe === 'function') {
    observer.observe(target, options);
  }
  let disconnected = false;
  return toDisposable(() => {
    if (disconnected) return;
    disconnected = true;
    if (typeof observer.disconnect === 'function') {
      observer.disconnect();
    }
  });
}

/**
 * Wraps a `MessagePort` so `dispose()` detaches handlers and calls `port.close()`.
 *
 * @param {any} port
 */
function disposableMessagePort(port) {
  if (!port) {
    return toDisposable(() => {});
  }
  let closed = false;
  return toDisposable(() => {
    if (closed) return;
    closed = true;
    try {
      port.onmessage = null;
      port.onmessageerror = null;
    } catch {
      // Ignore readonly mock port properties
    }
    if (typeof port.close === 'function') {
      port.close();
    }
  });
}

/**
 * Creates an `AbortController` bound to `win` (if available) that aborts on `dispose()`.
 *
 * @param {any} [win]
 */
function disposableAbortController(win) {
  const Ctor =
    (win && typeof win.AbortController === 'function' ? win.AbortController : null) ||
    (typeof AbortController === 'function' ? AbortController : null);
  if (!Ctor) {
    return {
      controller: null,
      signal: undefined,
      dispose() {},
    };
  }
  const controller = new Ctor();
  let aborted = false;
  return {
    controller,
    signal: controller.signal,
    dispose() {
      if (aborted) return;
      aborted = true;
      controller.abort();
    },
  };
}

module.exports = {
  disposableTimeout,
  disposableInterval,
  disposableEvent,
  disposableObserver,
  disposableMessagePort,
  disposableAbortController,
};
