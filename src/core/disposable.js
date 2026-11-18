'use strict';

/**
 * Wraps a teardown callback into an idempotent disposable handle.
 * @param {(() => void) | { dispose?: () => void } | null | undefined} target
 * @returns {{ dispose: () => void, readonly isDisposed: boolean }}
 */
function toDisposable(target) {
  let disposed = false;
  return {
    get isDisposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!target) return;
      if (typeof target === 'function') {
        target();
      } else if (typeof target.dispose === 'function') {
        target.dispose();
      }
    },
  };
}

/**
 * Deterministic LIFO resource lifecycle container.
 * Invariant (CS-INV-01):
 * - Disposes registered resources in strict reverse registration order (LIFO).
 * - Repeat `dispose()` calls are idempotent no-ops.
 * - Registering a resource on an already-disposed store disposes it synchronously immediately.
 */
class DisposableStore {
  constructor() {
    this._items = [];
    this._disposed = false;
  }

  get isDisposed() {
    return this._disposed;
  }

  get size() {
    return this._items.length;
  }

  /**
   * @template T
   * @param {T} item
   * @returns {T}
   */
  add(item) {
    if (item === null || item === undefined) {
      return item;
    }
    const wrapped = toDisposable(item);
    if (this._disposed) {
      try {
        wrapped.dispose();
      } catch {
        // Swallow late-disposal error to uphold deterministic post-dispose cleanup.
      }
      return item;
    }
    this._items.push(wrapped);
    return item;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    const snapshot = this._items.splice(0, this._items.length);
    for (let i = snapshot.length - 1; i >= 0; i--) {
      try {
        snapshot[i].dispose();
      } catch {
        // Continue disposing remaining resources so one failure never leaks earlier handles.
      }
    }
  }
}

module.exports = {
  toDisposable,
  DisposableStore,
};
