'use strict';

/**
 * Promise.all-safe FIFO asynchronous mutual exclusion lock with explicit lockToken ownership.
 * Invariant (CS-INV-02, Rev 6 §5.1):
 * - Queues concurrent external callers (`Promise.all`) in strict FIFO arrival order without throwing.
 * - Issues a unique `lockToken` per acquisition so internal `_*Unlocked(lockToken)` helpers can verify ownership.
 * - Rejects immediately only when `opts?.parentToken` matches the currently active `lockToken` (preventing nested self-deadlock).
 * - Never stalls subsequent queued callers when an earlier task throws synchronously or rejects.
 * // ceiling: single-key FIFO mutex per service instance; sufficient for interactive config mutations (<50 ops/sec).
 */
class AsyncMutex {
  constructor() {
    this._tail = Promise.resolve();
    this._activeCount = 0;
    this._activeToken = null;
  }

  get isLocked() {
    return this._activeCount > 0;
  }

  get pendingCount() {
    return Math.max(0, this._activeCount - 1);
  }

  /**
   * Returns true iff `token` is the active lock token currently executing inside `runExclusive`.
   * @param {symbol | null | undefined} token
   * @returns {boolean}
   */
  isCurrentToken(token) {
    return Boolean(token && this._activeToken !== null && token === this._activeToken);
  }

  /**
   * Throws an Error if `token` is not the currently active lock token.
   * @param {symbol | null | undefined} token
   */
  assertHeld(token) {
    if (!this.isCurrentToken(token)) {
      throw new Error(
        'Invalid or expired AsyncMutex lock token: critical section helper called without active lockToken.'
      );
    }
  }

  /**
   * @template T
   * @param {(lockToken: symbol) => Promise<T> | T} task
   * @param {{ parentToken?: symbol | null }} [opts]
   * @returns {Promise<T>}
   */
  runExclusive(task, opts) {
    if (typeof task !== 'function') {
      return Promise.reject(new TypeError('AsyncMutex.runExclusive requires a callback function.'));
    }
    if (opts && opts.parentToken && this.isCurrentToken(opts.parentToken)) {
      return Promise.reject(
        new Error('Re-entrant AsyncMutex deadlock prevented: runExclusive called with active parentToken.')
      );
    }

    this._activeCount += 1;
    const lockToken = Symbol('AsyncMutexLockToken');

    const run = async () => {
      this._activeToken = lockToken;
      try {
        return await task(lockToken);
      } finally {
        if (this._activeToken === lockToken) {
          this._activeToken = null;
        }
        this._activeCount -= 1;
      }
    };

    const scheduled = this._tail.then(run, run);
    this._tail = scheduled.then(
      () => undefined,
      () => undefined
    );
    return scheduled;
  }
}

module.exports = {
  AsyncMutex,
};
