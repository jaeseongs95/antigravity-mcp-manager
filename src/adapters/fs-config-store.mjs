/**
 * Local Filesystem `ConfigStorePort` with Write Jail, Symlink Guard,
 * Advisory Lock, SHA-256 CAS, Private Backup, and Same-FS Atomic Replace.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ERROR_CODES } from '../core/model.mjs';
import { sha256Hex } from '../core/sha256.mjs';

const LOCK_STALE_MS = 15000;
const RETRYABLE_RENAME_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Bounded short spin for Windows antivirus/watcher transient handle release
  }
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

function verifySymlinkSafety(targetPath) {
  const parentDir = path.dirname(targetPath);
  fs.mkdirSync(parentDir, { recursive: true });
  const parentReal = fs.realpathSync(parentDir);

  if (fs.existsSync(targetPath)) {
    const lst = fs.lstatSync(targetPath);
    if (lst.isSymbolicLink()) {
      const targetReal = fs.realpathSync(targetPath);
      const targetDirReal = path.dirname(targetReal);
      if (targetDirReal !== parentReal) {
        throw Object.assign(
          new Error('Write jail violation: symlink escapes canonical config directory.'),
          { code: ERROR_CODES.WRITE_JAIL_VIOLATION }
        );
      }
      throw Object.assign(
        new Error('Write jail violation: refusing to overwrite symbolic link target directly.'),
        { code: ERROR_CODES.WRITE_JAIL_VIOLATION }
      );
    }
    if (!lst.isFile()) {
      throw Object.assign(
        new Error('Write jail violation: target path is not a regular file.'),
        { code: ERROR_CODES.WRITE_JAIL_VIOLATION }
      );
    }
  }
  return path.join(parentReal, path.basename(targetPath));
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
        try {
          const st = fs.statSync(lockPath);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {
          continue;
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

export function createFsConfigStore({
  globalConfigPath,
  pluginRoots = [],
  legacyConfigPath = null,
  backupDir = null,
}) {
  const canonicalTarget = assertCanonicalWriteTarget(globalConfigPath);
  const lockPath = `${canonicalTarget}.lock`;

  async function readGlobalConfig() {
    if (!fs.existsSync(canonicalTarget)) {
      return {
        exists: false,
        rawText: '',
        sha256: null,
        displayPath: canonicalTarget,
      };
    }
    const lst = fs.lstatSync(canonicalTarget);
    if (lst.isSymbolicLink() || !lst.isFile()) {
      throw Object.assign(
        new Error('Refusing to read non-regular or symlinked mcp_config.json.'),
        { code: ERROR_CODES.WRITE_JAIL_VIOLATION }
      );
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
    let safeTarget;
    try {
      safeTarget = verifySymlinkSafety(canonicalTarget);
    } catch (err) {
      return {
        ok: false,
        code: err?.code || ERROR_CODES.WRITE_JAIL_VIOLATION,
        error: err?.message || String(err),
      };
    }

    if (!acquireLock(lockPath)) {
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

      if (expectedSha256 !== undefined && currentSha !== expectedSha256) {
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
      let entries;
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginDir = entry.name;
        const pluginPath = path.join(root, pluginDir);
        const mcpPath = path.join(pluginPath, 'mcp_config.json');
        if (!fs.existsSync(mcpPath)) continue;
        try {
          const realMcp = fs.realpathSync(mcpPath);
          if (seenPaths.has(realMcp)) continue;
          seenPaths.add(realMcp);

          let pluginName = pluginDir;
          const manifestPath = path.join(pluginPath, 'plugin.json');
          if (fs.existsSync(manifestPath)) {
            try {
              const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              if (typeof m?.displayName === 'string' && m.displayName.trim()) pluginName = m.displayName.trim();
              else if (typeof m?.name === 'string' && m.name.trim()) pluginName = m.name.trim();
            } catch {
              // Fall back to directory name
            }
          }
          const rawText = fs.readFileSync(mcpPath, 'utf8');
          results.push({
            pluginName,
            pluginDir,
            rawText,
            displayPath: mcpPath,
          });
        } catch {
          // Skip unreadable plugin config
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
      const lst = fs.lstatSync(legacyConfigPath);
      if (lst.isSymbolicLink() || !lst.isFile()) {
        return { exists: false, rawText: '', displayPath: legacyConfigPath };
      }
      return {
        exists: true,
        rawText: fs.readFileSync(legacyConfigPath, 'utf8'),
        displayPath: legacyConfigPath,
      };
    } catch {
      return { exists: false, rawText: '', displayPath: legacyConfigPath };
    }
  }

  async function restoreLastBackup() {
    if (!backupDir) {
      return { ok: false, code: ERROR_CODES.NOT_FOUND, error: 'Backup directory is not configured.' };
    }
    const backupPath = path.join(backupDir, 'mcp_config.last-good.json');
    if (!fs.existsSync(backupPath)) {
      return { ok: false, code: ERROR_CODES.NOT_FOUND, error: 'No previous backup file found.' };
    }
    const backupText = fs.readFileSync(backupPath, 'utf8');
    try {
      JSON.parse(backupText);
    } catch {
      return { ok: false, code: ERROR_CODES.MALFORMED_JSON, error: 'Backup file is not valid JSON.' };
    }
    const safeTarget = verifySymlinkSafety(canonicalTarget);
    if (!acquireLock(lockPath)) {
      return { ok: false, code: ERROR_CODES.LOCK_BUSY, error: 'Lock busy while restoring backup.' };
    }
    try {
      atomicWriteSameFs(safeTarget, backupText);
      return { ok: true, sha256: sha256Hex(backupText) };
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
