/**
 * Local Filesystem `ConfigStorePort` with Write Jail, Ancestor Symlink/Junction Guard,
 * TOCTOU-Safe Advisory Lock, Mandatory SHA-256 CAS, Private Backup, and Same-FS Atomic Replace.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ERROR_CODES } from '../core/model.mjs';
import { sha256Hex } from '../core/sha256.mjs';

const LOCK_STALE_MS = 15000;
const RETRYABLE_RENAME_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
const SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms) {
  Atomics.wait(SLEEP_BUF, 0, 0, ms);
}

function assertCanonicalWriteTarget(globalConfigPath) {
  const resolved = path.resolve(globalConfigPath);
  const base = path.basename(resolved).toLowerCase();
  if (base !== 'mcp_config.json') {
    throw Object.assign(
      new Error(`Write jail violation: only mcp_config.json may be written (got "${base}").`),
      { code: ERROR_CODES.WRITE_JAIL_VIOLATION }
    );
  }
  const normalizedSlashes = resolved.replace(/\\/g, '/').toLowerCase();
  if (normalizedSlashes.includes('/plugins/')) {
    throw Object.assign(
      new Error('Write jail violation: plugin mcp_config.json files are strictly read-only.'),
      { code: ERROR_CODES.WRITE_JAIL_VIOLATION }
    );
  }
  return resolved;
}

/**
 * Checks that NEITHER the target file NOR its immediate config/parent directories
 * (up to `parentLevels`, default 2: e.g. `.gemini`, `.gemini/config`, `mcp_config.json`)
 * are symbolic links or Windows junctions, without false-positiving on OS-level root
 * symlinks such as macOS `/var -> /private/var` or `/tmp -> /private/tmp`.
 */
function verifyNoSymlinkInChain(targetPath, { createParent = false, parentLevels = 2 } = {}) {
  const resolved = path.resolve(targetPath);
  const chain = [];
  let cursor = resolved;
  for (let depth = 0; depth <= parentLevels; depth += 1) {
    chain.unshift(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  for (let i = 0; i < chain.length; i += 1) {
    const current = chain[i];
    const isLeaf = i === chain.length - 1;
    if (!fs.existsSync(current)) {
      if (!isLeaf && createParent) {
        fs.mkdirSync(current, { recursive: true });
      }
      continue;
    }
    const lst = fs.lstatSync(current);
    if (lst.isSymbolicLink()) {
      throw Object.assign(
        new Error(`Write jail violation: symbolic link / junction detected at "${current}".`),
        { code: ERROR_CODES.WRITE_JAIL_VIOLATION }
      );
    }
    if (isLeaf && !lst.isFile()) {
      throw Object.assign(
        new Error('Write jail violation: target path is not a regular file.'),
        { code: ERROR_CODES.WRITE_JAIL_VIOLATION }
      );
    }
  }
  return resolved;
}

function acquireLock(lockPath) {
  const payload = JSON.stringify({ pid: process.pid, createdAt: Date.now() });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, payload, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
      return true;
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        let st;
        try {
          st = fs.statSync(lockPath);
        } catch (statErr) {
          if (statErr && statErr.code === 'ENOENT') continue;
          throw statErr;
        }
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          // Atomic TOCTOU-safe stale lock reclaim: only one racer wins renameSync
          const tomb = `${lockPath}.stale.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
          try {
            fs.renameSync(lockPath, tomb);
            try { fs.unlinkSync(tomb); } catch {}
            continue;
          } catch (renErr) {
            if (renErr && renErr.code === 'ENOENT') continue;
            if (renErr && (renErr.code === 'EACCES' || renErr.code === 'EPERM')) throw renErr;
            return false;
          }
        }
        return false;
      }
      throw err;
    }
  }
  return false;
}

function releaseLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Ignore if already removed
  }
}

function atomicWriteSameFs(targetPath, content) {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(
    dir,
    `.${path.basename(targetPath)}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`
  );
  let fd = null;
  try {
    fd = fs.openSync(tmpPath, 'wx', 0o600);
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    let lastErr = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        fs.renameSync(tmpPath, targetPath);
        return;
      } catch (err) {
        lastErr = err;
        if (!RETRYABLE_RENAME_CODES.has(err?.code)) throw err;
        sleepSync(25 * (attempt + 1));
      }
    }
    throw lastErr;
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

function writePrivateBackup(backupDir, rawText) {
  if (!backupDir) return null;
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backupPath = path.join(backupDir, 'mcp_config.last-good.json');
  atomicWriteSameFs(backupPath, rawText);
  try {
    fs.chmodSync(backupPath, 0o600);
  } catch {
    // Windows ignores POSIX chmod
  }
  return backupPath;
}

function isPathInsideDir(childReal, parentReal) {
  const rel = path.relative(parentReal, childReal);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function createFsConfigStore({
  globalConfigPath,
  pluginRoots = [],
  legacyConfigPath = null,
  backupDir = null,
}) {
  const canonicalTarget = assertCanonicalWriteTarget(globalConfigPath);
  const lockPath = `${canonicalTarget}.lock`;

  async function readGlobalConfig() {
    verifyNoSymlinkInChain(canonicalTarget, { createParent: false });
    if (!fs.existsSync(canonicalTarget)) {
      return {
        exists: false,
        rawText: '',
        sha256: null,
        displayPath: canonicalTarget,
      };
    }
    const rawText = fs.readFileSync(canonicalTarget, 'utf8');
    return {
      exists: true,
      rawText,
      sha256: sha256Hex(rawText),
      displayPath: canonicalTarget,
    };
  }

  async function writeGlobalConfig({ rawText, expectedSha256 }) {
    if (expectedSha256 === undefined) {
      return {
        ok: false,
        code: ERROR_CODES.VALIDATION_ERROR,
        error: 'expectedSha256 is required (pass null only when creating a new file).',
      };
    }

    let safeTarget;
    try {
      safeTarget = verifyNoSymlinkInChain(canonicalTarget, { createParent: true });
    } catch (err) {
      return {
        ok: false,
        code: err?.code || ERROR_CODES.WRITE_JAIL_VIOLATION,
        error: err?.message || String(err),
      };
    }

    let locked = false;
    try {
      locked = acquireLock(lockPath);
    } catch (err) {
      return {
        ok: false,
        code: ERROR_CODES.IO_ERROR,
        error: err?.message || String(err),
      };
    }
    if (!locked) {
      return {
        ok: false,
        code: ERROR_CODES.LOCK_BUSY,
        error: 'Another save operation is currently holding mcp_config.json.lock.',
      };
    }

    try {
      const exists = fs.existsSync(safeTarget);
      const currentText = exists ? fs.readFileSync(safeTarget, 'utf8') : '';
      const currentSha = exists ? sha256Hex(currentText) : null;

      if (currentSha !== expectedSha256) {
        return {
          ok: false,
          code: ERROR_CODES.CONFLICT,
          error: 'mcp_config.json changed on disk before save could commit.',
          actualSha256: currentSha,
        };
      }

      if (exists && currentText.trim()) {
        try {
          JSON.parse(currentText);
          writePrivateBackup(backupDir, currentText);
        } catch {
          // Do not overwrite last-good backup with malformed JSON
        }
      }

      atomicWriteSameFs(safeTarget, String(rawText));
      return {
        ok: true,
        sha256: sha256Hex(String(rawText)),
      };
    } catch (err) {
      return {
        ok: false,
        code: err?.code || ERROR_CODES.IO_ERROR,
        error: err?.message || String(err),
      };
    } finally {
      releaseLock(lockPath);
    }
  }

  async function readPluginConfigs() {
    const results = [];
    const seenPaths = new Set();

    for (const root of pluginRoots) {
      if (!root || !fs.existsSync(root)) continue;
      let rootReal;
      let entries;
      try {
        rootReal = fs.realpathSync(root);
        entries = fs.readdirSync(rootReal, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginDir = entry.name;
        const pluginPath = path.join(rootReal, pluginDir);
        const mcpPath = path.join(pluginPath, 'mcp_config.json');
        if (!fs.existsSync(mcpPath)) continue;
        try {
          const pluginReal = fs.realpathSync(pluginPath);
          if (!isPathInsideDir(pluginReal, rootReal)) continue;
          const realMcp = fs.realpathSync(mcpPath);
          if (!isPathInsideDir(realMcp, pluginReal)) continue;
          if (seenPaths.has(realMcp)) continue;
          seenPaths.add(realMcp);

          let pluginName = pluginDir;
          const manifestPath = path.join(pluginReal, 'plugin.json');
          if (fs.existsSync(manifestPath)) {
            try {
              const realManifest = fs.realpathSync(manifestPath);
              if (isPathInsideDir(realManifest, pluginReal)) {
                const m = JSON.parse(fs.readFileSync(realManifest, 'utf8'));
                if (typeof m?.displayName === 'string' && m.displayName.trim()) pluginName = m.displayName.trim();
                else if (typeof m?.name === 'string' && m.name.trim()) pluginName = m.name.trim();
              }
            } catch {
              // Fall back to directory name
            }
          }
          const rawText = fs.readFileSync(realMcp, 'utf8');
          results.push({
            pluginName,
            pluginDir,
            rawText,
            displayPath: realMcp,
          });
        } catch {
          // Skip unreadable or escaped plugin config
        }
      }
    }
    return results.sort((a, b) => a.pluginDir.localeCompare(b.pluginDir));
  }

  async function readLegacyConfig() {
    if (!legacyConfigPath || !fs.existsSync(legacyConfigPath)) {
      return { exists: false, rawText: '', displayPath: legacyConfigPath || '' };
    }
    try {
      verifyNoSymlinkInChain(legacyConfigPath, { createParent: false });
      return {
        exists: true,
        rawText: fs.readFileSync(legacyConfigPath, 'utf8'),
        displayPath: legacyConfigPath,
      };
    } catch {
      return { exists: false, rawText: '', displayPath: legacyConfigPath };
    }
  }

  async function restoreLastBackup({ expectedSha256 } = {}) {
    if (expectedSha256 === undefined) {
      return { ok: false, code: ERROR_CODES.VALIDATION_ERROR, error: 'expectedSha256 is required for CAS-protected backup restore.' };
    }
    if (!backupDir) {
      return { ok: false, code: ERROR_CODES.NOT_FOUND, error: 'Backup directory is not configured.' };
    }
    const backupPath = path.join(backupDir, 'mcp_config.last-good.json');
    if (!fs.existsSync(backupPath)) {
      return { ok: false, code: ERROR_CODES.NOT_FOUND, error: 'No previous backup file found.' };
    }

    let backupText;
    try {
      backupText = fs.readFileSync(backupPath, 'utf8');
      JSON.parse(backupText);
    } catch (err) {
      return { ok: false, code: ERROR_CODES.MALFORMED_JSON, error: err?.message || 'Backup file is not valid JSON.' };
    }

    let safeTarget;
    try {
      safeTarget = verifyNoSymlinkInChain(canonicalTarget, { createParent: true });
    } catch (err) {
      return { ok: false, code: err?.code || ERROR_CODES.WRITE_JAIL_VIOLATION, error: err?.message || String(err) };
    }

    let locked = false;
    try {
      locked = acquireLock(lockPath);
    } catch (err) {
      return { ok: false, code: ERROR_CODES.IO_ERROR, error: err?.message || String(err) };
    }
    if (!locked) {
      return { ok: false, code: ERROR_CODES.LOCK_BUSY, error: 'Lock busy while restoring backup.' };
    }
    try {
      const exists = fs.existsSync(safeTarget);
      const currentText = exists ? fs.readFileSync(safeTarget, 'utf8') : '';
      const currentSha = exists ? sha256Hex(currentText) : null;
      if (currentSha !== expectedSha256) {
        return {
          ok: false,
          code: ERROR_CODES.CONFLICT,
          error: 'mcp_config.json changed on disk before backup restore could commit.',
          actualSha256: currentSha,
        };
      }
      atomicWriteSameFs(safeTarget, backupText);
      return { ok: true, sha256: sha256Hex(backupText) };
    } catch (err) {
      return { ok: false, code: err?.code || ERROR_CODES.IO_ERROR, error: err?.message || String(err) };
    } finally {
      releaseLock(lockPath);
    }
  }

  return {
    readGlobalConfig,
    writeGlobalConfig,
    readPluginConfigs,
    readLegacyConfig,
    restoreLastBackup,
  };
}
