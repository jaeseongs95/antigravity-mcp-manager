'use strict';

/**
 * Atomic File Lock, File Snapshot/Restore, and `app_storage.json` Synchronizer (`5095348c-F3`).
 *
 * Key Guarantees:
 * 1. `acquireFileLock` uses exclusive `wx` creation with stale-PID verification before displacement.
 * 2. `syncAppStorageCode` acquires `appStorageLockPath` FIRST, then re-reads `autoinjectPath`
 *    (or uses explicit `codeOverride`) and `appStoragePath` inside the critical section before
 *    writing via `fsyncSync` + `renameSync` (never `copyFileSync` on lock errors).
 * 3. `isFileLockHeld` allows `hook` mode to yield immediately when `statusbar_patch.lock` is
 *    held by a concurrent `install` / `--uninstall` transaction.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_LOCK_STALE_MS = 60000;
const DEFAULT_STORAGE_LOCK_STALE_MS = 15000;
const STORAGE_CODE_KEY = 'agy-statusbar-code';

function createLockToken(prefix = 'lock') {
  return `${prefix}:${process.pid}:${crypto.randomBytes(8).toString('hex')}`;
}

function isProcessAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

function writeLockPayloadExclusive(lockPath, token) {
  const fd = fs.openSync(lockPath, 'wx');
  try {
    const payload = JSON.stringify({
      pid: process.pid,
      token,
      startedAt: new Date().toISOString(),
    });
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function isLockRecordStale(lockPath, staleMs) {
  const stat = fs.statSync(lockPath);
  const ageMs = Date.now() - stat.mtimeMs;
  let ownerPid = 0;
  try {
    const info = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    ownerPid = Number(info?.pid || 0);
  } catch {
    ownerPid = 0;
  }
  const ownerAlive = ownerPid > 0 && isProcessAlive(ownerPid);
  return (
    (ownerPid > 0 && !ownerAlive) ||
    (!ownerAlive && ageMs > staleMs) ||
    ageMs > staleMs * 10
  );
}

/**
 * Checks non-destructively whether `lockPath` is currently held by a non-stale live owner.
 *
 * @param {string} lockPath
 * @param {number} [staleMs]
 * @returns {boolean}
 */
function isFileLockHeld(lockPath, staleMs = DEFAULT_LOCK_STALE_MS) {
  try {
    if (!fs.existsSync(lockPath)) return false;
    return !isLockRecordStale(lockPath, staleMs);
  } catch {
    return false;
  }
}

function restoreDisplacedLockFile(relTmp, lockPath) {
  try {
    fs.linkSync(relTmp, lockPath);
    try {
      fs.unlinkSync(relTmp);
    } catch {
      // Ignore
    }
    return;
  } catch {
    // Fallback to rename if hardlink unsupported
  }
  try {
    if (!fs.existsSync(lockPath)) {
      fs.renameSync(relTmp, lockPath);
      return;
    }
  } catch {
    // Ignore
  }
  try {
    fs.unlinkSync(relTmp);
  } catch {
    // Ignore
  }
}

/**
 * Acquires an atomic lock file at `lockPath` with `token`.
 *
 * @param {string} lockPath
 * @param {string} token
 * @param {number} [staleMs]
 * @returns {boolean}
 */
function acquireFileLock(lockPath, token, staleMs = DEFAULT_LOCK_STALE_MS) {
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    try {
      writeLockPayloadExclusive(lockPath, token);
      return true;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') return false;
    }

    if (!isLockRecordStale(lockPath, staleMs)) {
      return false;
    }

    const staleTmp = `${lockPath}.stale.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.renameSync(lockPath, staleTmp);
    } catch {
      return false;
    }

    try {
      if (!isLockRecordStale(staleTmp, staleMs)) {
        restoreDisplacedLockFile(staleTmp, lockPath);
        return false;
      }
    } catch {
      // Proceed to remove broken stale lock
    }

    try {
      fs.unlinkSync(staleTmp);
    } catch {
      // Ignore
    }
    writeLockPayloadExclusive(lockPath, token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Releases `lockPath` only if its stored token still matches `token`.
 *
 * @param {string} lockPath
 * @param {string} token
 * @returns {boolean}
 */
function releaseFileLock(lockPath, token) {
  try {
    if (!fs.existsSync(lockPath)) return false;
    const lockInfo = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (!lockInfo || lockInfo.token !== token) {
      return false;
    }
    const relTmp = `${lockPath}.rel.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.renameSync(lockPath, relTmp);
    } catch {
      return false;
    }
    let movedInfo = null;
    try {
      movedInfo = JSON.parse(fs.readFileSync(relTmp, 'utf8'));
    } catch {
      movedInfo = null;
    }
    if (!movedInfo || movedInfo.token !== token) {
      restoreDisplacedLockFile(relTmp, lockPath);
      return false;
    }
    try {
      fs.unlinkSync(relTmp);
    } catch {
      // Ignore
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes `bufferOrString` atomically to `targetPath` via same-directory temp file + `fsyncSync` + `renameSync`.
 * Never falls back to non-atomic `copyFileSync`.
 *
 * @param {string} targetPath
 * @param {Buffer | string} content
 */
function writeFileAtomicSync(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  let fd = null;
  try {
    fd = fs.openSync(tmpPath, 'wx');
    if (Buffer.isBuffer(content)) {
      fs.writeSync(fd, content, 0, content.length, 0);
    } else {
      const buf = Buffer.from(String(content), 'utf8');
      fs.writeSync(fd, buf, 0, buf.length, 0);
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmpPath, targetPath);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore
      }
    }
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore
      }
    }
  }
}

/**
 * Captures byte-accurate snapshots of `filePaths` for transactional Stage 2 rollback.
 *
 * @param {string[]} filePaths
 */
function captureFileSnapshots(filePaths) {
  const snapshots = [];
  for (let i = 0; i < filePaths.length; i += 1) {
    const filePath = filePaths[i];
    if (fs.existsSync(filePath)) {
      snapshots.push({
        filePath,
        existed: true,
        bytes: fs.readFileSync(filePath),
      });
    } else {
      snapshots.push({
        filePath,
        existed: false,
        bytes: null,
      });
    }
  }
  return snapshots;
}

/**
 * Restores all captured file snapshots to their exact pre-transaction state.
 *
 * @param {Array<{ filePath: string, existed: boolean, bytes: Buffer | null }>} snapshots
 */
function restoreFileSnapshots(snapshots) {
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const snap = snapshots[i];
    if (snap.existed && snap.bytes) {
      writeFileAtomicSync(snap.filePath, snap.bytes);
    } else if (!snap.existed && fs.existsSync(snap.filePath)) {
      fs.unlinkSync(snap.filePath);
    }
  }
}

/**
 * Lock-first synchronization of `app_storage.json['agy-statusbar-code']` (`5095348c-F3`).
 * Acquires `appStorageLockPath` BEFORE reading `autoinjectPath` and `appStoragePath`.
 *
 * @param {{
 *   autoinjectPath: string,
 *   appStoragePath: string,
 *   appStorageLockPath: string,
 *   codeOverride?: string,
 *   storageKey?: string,
 *   staleMs?: number
 * }} params
 * @returns {{ ok: boolean, updated: boolean, skippedMissing?: boolean, error?: string }}
 */
function syncAppStorageCode(params) {
  const {
    autoinjectPath,
    appStoragePath,
    appStorageLockPath,
    codeOverride,
    storageKey = STORAGE_CODE_KEY,
    staleMs = DEFAULT_STORAGE_LOCK_STALE_MS,
  } = params;

  const lockToken = createLockToken('app-storage');
  if (!acquireFileLock(appStorageLockPath, lockToken, staleMs)) {
    return { ok: false, updated: false, error: 'APP_STORAGE_LOCK_BUSY' };
  }

  try {
    if (!fs.existsSync(appStoragePath)) {
      return { ok: true, updated: false, skippedMissing: true };
    }
    const desiredCode =
      typeof codeOverride === 'string'
        ? codeOverride
        : fs.existsSync(autoinjectPath)
          ? fs.readFileSync(autoinjectPath, 'utf8')
          : null;

    if (desiredCode === null) {
      return { ok: true, updated: false, skippedMissing: true };
    }

    const rawStorage = fs.readFileSync(appStoragePath, 'utf8');
    const parsed = JSON.parse(rawStorage);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, updated: false, error: 'APP_STORAGE_INVALID_OBJECT' };
    }
    if (parsed[storageKey] === desiredCode) {
      return { ok: true, updated: false };
    }

    parsed[storageKey] = desiredCode;
    writeFileAtomicSync(appStoragePath, `${JSON.stringify(parsed, null, 2)}\n`);
    return { ok: true, updated: true };
  } catch (err) {
    return { ok: false, updated: false, error: err?.message || String(err) };
  } finally {
    releaseFileLock(appStorageLockPath, lockToken);
  }
}

/**
 * Atomically removes `storageKey` (`'agy-statusbar-code'`) from `app_storage.json` while preserving
 * all other user storage keys (`Rev 6 F1` sole-plugin `--uninstall`).
 *
 * @param {{
 *   appStoragePath: string,
 *   appStorageLockPath: string,
 *   storageKey?: string,
 *   staleMs?: number
 * }} params
 */
function removeAppStorageCodeKey(params) {
  const {
    appStoragePath,
    appStorageLockPath,
    storageKey = STORAGE_CODE_KEY,
    staleMs = DEFAULT_STORAGE_LOCK_STALE_MS,
  } = params;

  const lockToken = createLockToken('app-storage-rm');
  if (!acquireFileLock(appStorageLockPath, lockToken, staleMs)) {
    return { ok: false, updated: false, error: 'APP_STORAGE_LOCK_BUSY' };
  }

  try {
    if (!fs.existsSync(appStoragePath)) {
      return { ok: true, updated: false, skippedMissing: true };
    }
    const rawStorage = fs.readFileSync(appStoragePath, 'utf8');
    const parsed = JSON.parse(rawStorage);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, updated: false, error: 'APP_STORAGE_INVALID_OBJECT' };
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, storageKey)) {
      return { ok: true, updated: false };
    }
    delete parsed[storageKey];
    writeFileAtomicSync(appStoragePath, `${JSON.stringify(parsed, null, 2)}\n`);
    return { ok: true, updated: true };
  } catch (err) {
    return { ok: false, updated: false, error: err?.message || String(err) };
  } finally {
    releaseFileLock(appStorageLockPath, lockToken);
  }
}

module.exports = {
  DEFAULT_LOCK_STALE_MS,
  DEFAULT_STORAGE_LOCK_STALE_MS,
  STORAGE_CODE_KEY,
  createLockToken,
  isProcessAlive,
  isFileLockHeld,
  acquireFileLock,
  releaseFileLock,
  writeFileAtomicSync,
  captureFileSnapshots,
  restoreFileSnapshots,
  syncAppStorageCode,
  removeAppStorageCodeKey,
};
