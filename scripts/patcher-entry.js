'use strict';

/**
 * Patcher CLI & Companion-Safe Uninstall / Restore Orchestrator (`scripts/patcher-entry.js`).
 *
 * Supports:
 * - `--status`: Non-mutating JSON health report of ASAR V5 patch, backup, and deployed files.
 * - `--restore`: Explicit ASAR-only restoration (`restoreAsarOnDisk`) without deleting companion files (`Rev 6 F1`).
 * - `--uninstall`: Companion-aware two-branch uninstallation with bidirectional Stage 2 -> Stage 1
 *   ASAR reverse rollback (`patchAsarOnDisk` when `didRestoreAsarInThisRun === true`) (`Rev 6 F1` & `5095348c-F3`).
 * - `--worker` / default `hook` mode: Yields immediately if `LOCK_PATH` is held by a live installer/uninstaller,
 *   synchronizes `app_storage.json` under `APP_STORAGE_LOCK_PATH`, ensures V5 ASAR patch, and syncs live CDP.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { removeMcpManagerBlock } = require('../src/shared/marker-manifest');
const {
  createLockToken,
  isFileLockHeld,
  acquireFileLock,
  releaseFileLock,
  writeFileAtomicSync,
  captureFileSnapshots,
  restoreFileSnapshots,
  syncAppStorageCode,
  removeAppStorageCodeKey,
} = require('./lib/file-lock');
const {
  PATCH_MARKER,
  isAsarPatchedFast,
  patchAsarOnDisk,
  restoreAsarOnDisk,
} = require('./lib/asar-patcher');
const { injectViaCdpLive, destroyMcpManagerViaCdpLive } = require('./lib/cdp-injector');

const COMPANION_BUNDLE_FILENAMES = Object.freeze([
  'ko_thought_translator_autoinject.js',
  'ko_thought_autoinject.js',
  'statusbar_only_autoinject.js',
]);

/**
 * Resolves host paths from `overrides` or standard OS environment variables.
 *
 * @param {Record<string, string>} [overrides]
 */
function resolveHostPatchPaths(overrides = {}) {
  const homeDir = overrides.homeDir || process.env.USERPROFILE || process.env.HOME || os.homedir();
  const localAppData = overrides.localAppData || process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
  const appData = overrides.appData || process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
  const agyDir = overrides.agyDir || path.join(homeDir, '.gemini', 'antigravity');

  return {
    homeDir,
    agyDir,
    asarPath: overrides.asarPath || path.join(localAppData, 'Programs', 'antigravity', 'resources', 'app.asar'),
    asarBackupPath: overrides.asarBackupPath || path.join(agyDir, 'asar_v5_backup.json'),
    autoinjectPath: overrides.autoinjectPath || path.join(agyDir, 'statusbar_autoinject.js'),
    mcpAutoinjectPath: overrides.mcpAutoinjectPath || path.join(agyDir, 'mcp_manager_autoinject.js'),
    patcherScriptPath: overrides.patcherScriptPath || path.join(agyDir, 'ensure_statusbar_patch.js'),
    lockPath: overrides.lockPath || path.join(agyDir, 'statusbar_patch.lock'),
    appStorageLockPath: overrides.appStorageLockPath || path.join(agyDir, 'statusbar_app_storage.lock'),
    statusPath: overrides.statusPath || path.join(agyDir, 'statusbar_patch_status.json'),
    appStoragePath: overrides.appStoragePath || path.join(appData, 'Antigravity', 'app_storage.json'),
    devToolsPortFile: overrides.devToolsPortFile || path.join(appData, 'Antigravity', 'DevToolsActivePort'),
  };
}

/**
 * Determines whether any companion plugin (`antigravity-statusbar`, `ko-thought-translator`)
 * remains installed alongside MCP Manager (`Rev 6 §5.5 #2`).
 *
 * @param {string} agyDir
 * @param {string} existingAutoinjectContent
 */
function detectRemainingCompanions(agyDir, existingAutoinjectContent) {
  const remainingAutoinject = removeMcpManagerBlock(existingAutoinjectContent || '');
  let companionBundlePath = null;

  for (let i = 0; i < COMPANION_BUNDLE_FILENAMES.length; i += 1) {
    const candidate = path.join(agyDir, COMPANION_BUNDLE_FILENAMES[i]);
    if (fs.existsSync(candidate)) {
      companionBundlePath = candidate;
      break;
    }
  }

  const hasCompanionBundle = Boolean(companionBundlePath);
  const hasRemainingCompanions = remainingAutoinject.trim().length > 0 || hasCompanionBundle;

  return {
    remainingAutoinject,
    companionBundlePath,
    hasCompanionBundle,
    hasRemainingCompanions,
  };
}

/**
 * Inspects current patch/deployment status without mutating disk state.
 *
 * @param {ReturnType<typeof resolveHostPatchPaths>} [customPaths]
 */
function getPatchStatus(customPaths) {
  const paths = customPaths || resolveHostPatchPaths();
  const asarExists = fs.existsSync(paths.asarPath);
  const asarPatched = asarExists ? isAsarPatchedFast(paths.asarPath) : false;
  const backupExists = fs.existsSync(paths.asarBackupPath);
  const autoinjectExists = fs.existsSync(paths.autoinjectPath);
  const mcpAutoinjectExists = fs.existsSync(paths.mcpAutoinjectPath);
  const patcherExists = fs.existsSync(paths.patcherScriptPath);

  const existingAutoinject = autoinjectExists ? fs.readFileSync(paths.autoinjectPath, 'utf8') : '';
  const companionInfo = detectRemainingCompanions(paths.agyDir, existingAutoinject);

  return {
    ok: true,
    patchMarker: PATCH_MARKER,
    asarPath: paths.asarPath,
    asarExists,
    asarPatched,
    backupExists,
    autoinjectExists,
    mcpAutoinjectExists,
    patcherExists,
    hasRemainingCompanions: companionInfo.hasRemainingCompanions,
  };
}

/**
 * Dedicated `--restore` command: restores `app.asar` binary ONLY via 3-stage verification,
 * without deleting companion bundles or `app_storage.json` (`Rev 6 §5.5 #2`).
 *
 * @param {ReturnType<typeof resolveHostPatchPaths>} [customPaths]
 */
function runDedicatedAsarRestore(customPaths) {
  const paths = customPaths || resolveHostPatchPaths();
  const lockToken = createLockToken('restore');
  if (!acquireFileLock(paths.lockPath, lockToken)) {
    return {
      ok: false,
      status: 'LOCK_BUSY',
      error: 'Another patch/install operation is currently in progress.',
    };
  }
  try {
    return restoreAsarOnDisk(paths.asarPath, paths.asarBackupPath);
  } finally {
    releaseFileLock(paths.lockPath, lockToken);
  }
}

/**
 * Companion-preserving / sole-plugin transactional `--uninstall` (`Rev 6 F1` & `5095348c-F3`).
 *
 * @param {ReturnType<typeof resolveHostPatchPaths>} [customPaths]
 * @param {{
 *   skipCdp?: boolean,
 *   __injectStage2Failure?: () => void
 * }} [options]
 */
async function uninstallMcpManager(customPaths, options = {}) {
  const paths = customPaths || resolveHostPatchPaths();
  const lockToken = createLockToken('uninstall');
  if (!acquireFileLock(paths.lockPath, lockToken)) {
    return {
      ok: false,
      status: 'LOCK_BUSY',
      error: 'Another patch/install operation is currently in progress.',
    };
  }

  try {
    const existingAutoinject = fs.existsSync(paths.autoinjectPath)
      ? fs.readFileSync(paths.autoinjectPath, 'utf8')
      : '';
    const companionInfo = detectRemainingCompanions(paths.agyDir, existingAutoinject);

    // Branch A: Companion plugin(s) remain -> keep V5 app.asar, backup, and ensure_statusbar_patch.js!
    if (companionInfo.hasRemainingCompanions) {
      const effectiveRemainingCode =
        companionInfo.remainingAutoinject.trim().length > 0
          ? companionInfo.remainingAutoinject
          : companionInfo.companionBundlePath
            ? fs.readFileSync(companionInfo.companionBundlePath, 'utf8')
            : '';

      const snapshots = captureFileSnapshots([
        paths.autoinjectPath,
        paths.mcpAutoinjectPath,
        paths.appStoragePath,
      ]);

      try {
        writeFileAtomicSync(paths.autoinjectPath, effectiveRemainingCode);

        const syncRes = syncAppStorageCode({
          autoinjectPath: paths.autoinjectPath,
          appStoragePath: paths.appStoragePath,
          appStorageLockPath: paths.appStorageLockPath,
          codeOverride: effectiveRemainingCode,
        });
        if (!syncRes.ok) {
          throw new Error(syncRes.error || 'Failed to resync app_storage.json with remaining companions');
        }

        if (typeof options.__injectStage2Failure === 'function') {
          options.__injectStage2Failure();
        }

        if (fs.existsSync(paths.mcpAutoinjectPath)) {
          fs.unlinkSync(paths.mcpAutoinjectPath);
        }
      } catch (stage2Err) {
        restoreFileSnapshots(snapshots);
        return {
          ok: false,
          branch: 'COMPANIONS_REMAINING',
          stage: 'STAGE_2_COMPANION_RESYNC',
          rolledBack: true,
          error: stage2Err?.message || String(stage2Err),
        };
      }

      const cdpRes = options.skipCdp
        ? { attempted: false, skipped: true }
        : await destroyMcpManagerViaCdpLive(paths);

      return {
        ok: true,
        status: 'UNINSTALLED_MCP_ONLY',
        branch: 'COMPANIONS_REMAINING',
        preservedAsarPatch: true,
        preservedBackup: true,
        cdp: cdpRes,
      };
    }

    // Branch B: Sole plugin -> Stage 1 restore app.asar, Stage 2 remove deployed files + storage key
    let didRestoreAsarInThisRun = false;
    if (fs.existsSync(paths.asarPath) && isAsarPatchedFast(paths.asarPath)) {
      const restoreRes = restoreAsarOnDisk(paths.asarPath, paths.asarBackupPath);
      if (!restoreRes.ok) {
        return {
          ok: false,
          branch: 'SOLE_PLUGIN',
          stage: 'STAGE_1_ASAR_RESTORE',
          status: restoreRes.status,
          rolledBack: false,
          error: restoreRes.error,
        };
      }
      didRestoreAsarInThisRun = Boolean(restoreRes.didRestore);
    }

    const snapshots = captureFileSnapshots([
      paths.autoinjectPath,
      paths.mcpAutoinjectPath,
      paths.patcherScriptPath,
      paths.asarBackupPath,
      paths.appStoragePath,
    ]);

    try {
      const rmStorageRes = removeAppStorageCodeKey({
        appStoragePath: paths.appStoragePath,
        appStorageLockPath: paths.appStorageLockPath,
      });
      if (!rmStorageRes.ok) {
        throw new Error(rmStorageRes.error || 'Failed to remove agy-statusbar-code from app_storage.json');
      }

      if (typeof options.__injectStage2Failure === 'function') {
        options.__injectStage2Failure();
      }

      const filesToDelete = [
        paths.mcpAutoinjectPath,
        paths.autoinjectPath,
        paths.patcherScriptPath,
        paths.asarBackupPath,
      ];
      for (let i = 0; i < filesToDelete.length; i += 1) {
        if (fs.existsSync(filesToDelete[i])) {
          fs.unlinkSync(filesToDelete[i]);
        }
      }
    } catch (stage2Err) {
      // 1. Restore Stage 2 file snapshots (including asar_v5_backup.json and app_storage.json)
      restoreFileSnapshots(snapshots);
      // 2. Bidirectional reverse rollback: re-apply V5 ASAR patch if Stage 1 restored it in this run!
      let reversedAsarRestore = false;
      if (didRestoreAsarInThisRun) {
        const rePatch = patchAsarOnDisk(paths.asarPath, paths.asarBackupPath);
        reversedAsarRestore = Boolean(rePatch.ok);
      }
      return {
        ok: false,
        branch: 'SOLE_PLUGIN',
        stage: 'STAGE_2_CLEANUP',
        rolledBack: true,
        reversedAsarRestore,
        error: stage2Err?.message || String(stage2Err),
      };
    }

    const cdpRes = options.skipCdp
      ? { attempted: false, skipped: true }
      : await destroyMcpManagerViaCdpLive(paths);

    return {
      ok: true,
      status: 'UNINSTALLED_ALL',
      branch: 'SOLE_PLUGIN',
      didRestoreAsar: didRestoreAsarInThisRun,
      cdp: cdpRes,
    };
  } finally {
    releaseFileLock(paths.lockPath, lockToken);
  }
}

/**
 * Runs the fast-path `SessionStart` / `PreInvocation` hook or `--worker` cycle (`5095348c-F3`).
 *
 * @param {ReturnType<typeof resolveHostPatchPaths>} [customPaths]
 * @param {{ skipCdp?: boolean }} [options]
 */
async function runHookCycle(customPaths, options = {}) {
  const paths = customPaths || resolveHostPatchPaths();

  // Yield immediately if an active install/uninstall holds LOCK_PATH (`5095348c-F3`)
  if (isFileLockHeld(paths.lockPath)) {
    return { ok: true, status: 'YIELDED_LOCK_HELD' };
  }

  const syncRes = syncAppStorageCode({
    autoinjectPath: paths.autoinjectPath,
    appStoragePath: paths.appStoragePath,
    appStorageLockPath: paths.appStorageLockPath,
  });

  let asarResult = { ok: true, status: 'ALREADY_PATCHED' };
  if (fs.existsSync(paths.asarPath) && !isAsarPatchedFast(paths.asarPath)) {
    const lockToken = createLockToken('hook-patch');
    if (acquireFileLock(paths.lockPath, lockToken)) {
      try {
        asarResult = patchAsarOnDisk(paths.asarPath, paths.asarBackupPath);
        try {
          writeFileAtomicSync(
            paths.statusPath,
            `${JSON.stringify({ updatedAt: new Date().toISOString(), asarResult }, null, 2)}\n`
          );
        } catch {
          // Non-fatal status file write
        }
      } finally {
        releaseFileLock(paths.lockPath, lockToken);
      }
    } else {
      asarResult = { ok: true, status: 'YIELDED_LOCK_HELD' };
    }
  }

  const cdpResult = options.skipCdp
    ? { attempted: false, skipped: true }
    : await injectViaCdpLive(paths);

  return {
    ok: Boolean(asarResult.ok),
    status: asarResult.status,
    storageSynced: Boolean(syncRes.updated),
    asar: asarResult,
    cdp: cdpResult,
  };
}

/**
 * CLI entry dispatcher for `ensure_statusbar_patch.js`.
 *
 * @param {string[]} [argv]
 * @param {ReturnType<typeof resolveHostPatchPaths>} [customPaths]
 */
async function runCli(argv = process.argv.slice(2), customPaths = undefined) {
  const args = Array.isArray(argv) ? argv : [];
  const paths = customPaths || resolveHostPatchPaths();

  if (args.includes('--status')) {
    const st = getPatchStatus(paths);
    process.stdout.write(`${JSON.stringify(st, null, 2)}\n`);
    return { exitCode: 0, result: st };
  }

  if (args.includes('--restore')) {
    const res = runDedicatedAsarRestore(paths);
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    return { exitCode: res.ok ? 0 : 1, result: res };
  }

  if (args.includes('--uninstall')) {
    const res = await uninstallMcpManager(paths);
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    return { exitCode: res.ok ? 0 : 1, result: res };
  }

  const res = await runHookCycle(paths);
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  }
  return { exitCode: res.ok ? 0 : 1, result: res };
}

if (require.main === module) {
  runCli().then(
    ({ exitCode }) => {
      if (exitCode !== 0) process.exitCode = exitCode;
    },
    (err) => {
      process.stderr.write(`${err?.stack || err}\n`);
      process.exitCode = 1;
    }
  );
}

module.exports = {
  COMPANION_BUNDLE_FILENAMES,
  resolveHostPatchPaths,
  detectRemainingCompanions,
  getPatchStatus,
  runDedicatedAsarRestore,
  uninstallMcpManager,
  runHookCycle,
  runCli,
};
