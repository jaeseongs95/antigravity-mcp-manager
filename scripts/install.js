#!/usr/bin/env node
'use strict';

/**
 * Transactional Installer & Companion-Aware Uninstaller (`scripts/install.js`).
 *
 * Guarantees (`Rev 6 F1` & `5095348c-F3`):
 * 1. Two-stage atomic `installMcpManager`:
 *    - Stage 1: Applies exact-size V5 ASAR transformation (`patchAsarOnDisk`), recording
 *      `didPatchAsarInThisRun` and `didCreateAsarBackupInThisRun` (aborts immediately on failure).
 *    - Stage 2: Snapshots target files, writes `mcp_manager_autoinject.js`, companion-merged
 *      `statusbar_autoinject.js`, standalone `ensure_statusbar_patch.js`, and synchronizes
 *      `app_storage.json['agy-statusbar-code']` under `APP_STORAGE_LOCK_PATH`.
 *    - Stage 2 failure rollback order (`5095348c-F3`):
 *      (a) Restore Stage 2 file snapshots ->
 *      (b) If `didPatchAsarInThisRun === true`, call `restoreAsarOnDisk` ->
 *      (c) Only if `didCreateAsarBackupInThisRun === true`, delete newly created `asar_v5_backup.json`.
 * 2. `--uninstall` delegates to `uninstallMcpManager` (`patcher-entry.js`), preserving companion
 *    plugins when present or performing bidirectional ASAR reverse-rollback on sole uninstall.
 * 3. `--restore` delegates to `runDedicatedAsarRestore` (`patcher-entry.js`).
 */

const fs = require('fs');
const path = require('path');
const { mergeMcpManagerBlock } = require('../src/shared/marker-manifest');
const {
  createLockToken,
  acquireFileLock,
  releaseFileLock,
  writeFileAtomicSync,
  captureFileSnapshots,
  restoreFileSnapshots,
  syncAppStorageCode,
} = require('./lib/file-lock');
const { patchAsarOnDisk, restoreAsarOnDisk } = require('./lib/asar-patcher');
const { injectViaCdpLive } = require('./lib/cdp-injector');
const {
  resolveHostPatchPaths,
  getPatchStatus,
  runDedicatedAsarRestore,
  uninstallMcpManager,
} = require('./patcher-entry');
const { buildAllBundles, OUT_FILE, PATCHER_OUT_FILE } = require('./build');

/**
 * Runs transactional installation of MCP Server Manager (`v2.0.0`).
 *
 * @param {ReturnType<typeof resolveHostPatchPaths>} [customPaths]
 * @param {{
 *   runtimeBundleSource?: string,
 *   patcherBundleSource?: string,
 *   skipBuildIfPresent?: boolean,
 *   skipCdp?: boolean,
 *   __injectStage2Failure?: () => void
 * }} [options]
 */
async function installMcpManager(customPaths, options = {}) {
  const paths = customPaths || resolveHostPatchPaths();

  let runtimeBundle = options.runtimeBundleSource || '';
  let patcherBundle = options.patcherBundleSource || '';

  if (!runtimeBundle || !patcherBundle) {
    if (options.skipBuildIfPresent && fs.existsSync(OUT_FILE) && fs.existsSync(PATCHER_OUT_FILE)) {
      runtimeBundle = runtimeBundle || fs.readFileSync(OUT_FILE, 'utf8');
      patcherBundle = patcherBundle || fs.readFileSync(PATCHER_OUT_FILE, 'utf8');
    } else {
      const built = buildAllBundles({ write: false });
      runtimeBundle = runtimeBundle || built.runtime.bundle;
      patcherBundle = patcherBundle || built.patcher.bundle;
    }
  }

  const lockToken = createLockToken('install');
  if (!acquireFileLock(paths.lockPath, lockToken)) {
    return {
      ok: false,
      stage: 'LOCK',
      status: 'LOCK_BUSY',
      error: 'Another patch/install operation is currently holding statusbar_patch.lock.',
    };
  }

  try {
    fs.mkdirSync(paths.agyDir, { recursive: true });

    // Stage 1: ASAR V5 transformation
    const patchRes = patchAsarOnDisk(paths.asarPath, paths.asarBackupPath);
    if (!patchRes.ok) {
      return {
        ok: false,
        stage: 'STAGE_1_ASAR_PATCH',
        status: patchRes.status,
        rolledBack: false,
        error: patchRes.error || `ASAR patch failed (${patchRes.status})`,
      };
    }

    const didPatchAsarInThisRun = Boolean(patchRes.didPatch);
    const didCreateAsarBackupInThisRun = Boolean(patchRes.didCreateBackup);

    // Stage 2: Deploy bundles + companion-merged statusbar_autoinject.js + app_storage.json
    const snapshots = captureFileSnapshots([
      paths.mcpAutoinjectPath,
      paths.autoinjectPath,
      paths.patcherScriptPath,
      paths.appStoragePath,
    ]);

    try {
      const existingAutoinject = fs.existsSync(paths.autoinjectPath)
        ? fs.readFileSync(paths.autoinjectPath, 'utf8')
        : '';
      const mergedAutoinject = mergeMcpManagerBlock(existingAutoinject, runtimeBundle);

      writeFileAtomicSync(paths.mcpAutoinjectPath, runtimeBundle);
      writeFileAtomicSync(paths.autoinjectPath, mergedAutoinject);
      writeFileAtomicSync(paths.patcherScriptPath, patcherBundle);

      const syncRes = syncAppStorageCode({
        autoinjectPath: paths.autoinjectPath,
        appStoragePath: paths.appStoragePath,
        appStorageLockPath: paths.appStorageLockPath,
        codeOverride: mergedAutoinject,
      });
      if (!syncRes.ok) {
        throw new Error(syncRes.error || 'Failed to synchronize app_storage.json');
      }

      if (typeof options.__injectStage2Failure === 'function') {
        options.__injectStage2Failure();
      }
    } catch (stage2Err) {
      // Exact 5095348c-F3 rollback order:
      // 1) Restore Stage 2 file snapshots
      restoreFileSnapshots(snapshots);

      // 2) If Stage 1 patched app.asar in this run, restore app.asar using backup
      let reversedAsarPatch = false;
      if (didPatchAsarInThisRun) {
        const rev = restoreAsarOnDisk(paths.asarPath, paths.asarBackupPath);
        reversedAsarPatch = Boolean(rev.ok);
      }

      // 3) Only if Stage 1 newly created asar_v5_backup.json in this run, unlink it
      if (didCreateAsarBackupInThisRun && fs.existsSync(paths.asarBackupPath)) {
        try {
          fs.unlinkSync(paths.asarBackupPath);
        } catch {
          // Ignore
        }
      }

      return {
        ok: false,
        stage: 'STAGE_2_DEPLOY',
        status: 'STAGE_2_ROLLED_BACK',
        rolledBack: true,
        reversedAsarPatch,
        error: stage2Err?.message || String(stage2Err),
      };
    }

    // Stage 3: Live CDP evaluation after Stages 1 & 2 have durably committed
    const cdpRes = options.skipCdp
      ? { attempted: false, skipped: true }
      : await injectViaCdpLive(paths);

    return {
      ok: true,
      status: 'INSTALLED',
      asar: patchRes,
      cdp: cdpRes,
      deployedFiles: {
        mcpAutoinjectPath: paths.mcpAutoinjectPath,
        autoinjectPath: paths.autoinjectPath,
        patcherScriptPath: paths.patcherScriptPath,
      },
    };
  } finally {
    releaseFileLock(paths.lockPath, lockToken);
  }
}

async function runInstallCli(argv = process.argv.slice(2), customPaths = undefined) {
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

  const res = await installMcpManager(paths, { skipBuildIfPresent: false });
  process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  return { exitCode: res.ok ? 0 : 1, result: res };
}

if (require.main === module) {
  runInstallCli().then(
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
  installMcpManager,
  uninstallMcpManager,
  runDedicatedAsarRestore,
  runInstallCli,
  resolveHostPatchPaths,
};
