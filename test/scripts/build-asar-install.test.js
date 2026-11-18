'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { stripCommentsAndEmptyLines } = require('../../scripts/lib/js-lexer');
const {
  createLockToken,
  acquireFileLock,
  releaseFileLock,
} = require('../../scripts/lib/file-lock');
const {
  UTILS_ANCHOR_TARGET,
  MAIN_ANCHOR_TARGET,
  PRELOAD_ANCHOR_TARGET,
  sha256HexBuf,
  isAsarPatchedFast,
  patchAsarOnDisk,
  restoreAsarOnDisk,
  createSyntheticAsarBuffer,
} = require('../../scripts/lib/asar-patcher');
const { createRfc6455WebSocketClient } = require('../../scripts/lib/rfc6455-ws');
const { buildAllBundles, PATCHER_OUT_FILE } = require('../../scripts/build');
const {
  resolveHostPatchPaths,
  runHookCycle,
  runDedicatedAsarRestore,
  uninstallMcpManager,
} = require('../../scripts/patcher-entry');
const { installMcpManager } = require('../../scripts/install');
const { createTestTempDir } = require('../helpers/dom-and-rpc-fakes');

function createPaddedAnchorFile(anchorLine) {
  const paddingComments = Array.from(
    { length: 45 },
    (_, idx) => `// Synthetic comment padding line ${idx} keeping ample slack bytes for exact-size V5 ASAR injection`
  ).join('\n');
  return `'use strict';\n${paddingComments}\nfunction boot() {\n${anchorLine}\n}\n`;
}

function buildIsolatedHostFixture(tempDir) {
  const homeDir = path.join(tempDir, 'home');
  const localAppData = path.join(tempDir, 'LocalAppData');
  const appData = path.join(tempDir, 'RoamingAppData');
  const paths = resolveHostPatchPaths({ homeDir, localAppData, appData });

  fs.mkdirSync(path.dirname(paths.asarPath), { recursive: true });
  fs.mkdirSync(paths.agyDir, { recursive: true });
  fs.mkdirSync(path.dirname(paths.appStoragePath), { recursive: true });

  const syntheticAsar = createSyntheticAsarBuffer({
    'package.json': JSON.stringify({ name: 'antigravity-mock', version: '2.0.0-test' }, null, 2),
    'dist/utils.js': createPaddedAnchorFile(UTILS_ANCHOR_TARGET),
    'dist/main.js': createPaddedAnchorFile(`${MAIN_ANCHOR_TARGET}\n});`),
    'dist/preload.js': createPaddedAnchorFile(PRELOAD_ANCHOR_TARGET),
  });

  fs.writeFileSync(paths.asarPath, syntheticAsar);
  fs.writeFileSync(paths.appStoragePath, JSON.stringify({ theme: 'dark' }, null, 2));

  return {
    paths,
    originalAsarSha256: sha256HexBuf(syntheticAsar),
  };
}

test('MCP-TC-021 & 047 (5095348c-F1): Dual bundler preserves template literals/backslashes and dist/ensure_statusbar_patch.js works BOTH as CLI (--status) and side-effect-free require() library', () => {
  // 1. Lexer preserves multiline templates after regex and escaped trailing backslashes
  const tricky = [
    'const re = /abc/g;',
    'const tpl = `line1 // keep inside template',
    'line2 /* keep */`;',
    'const oddEsc = "ends with literal backslash \\\\"; // strip trailing comment',
  ].join('\n');
  const stripped = stripCommentsAndEmptyLines(tricky);
  assert.equal(stripped.includes('line1 // keep inside template'), true);
  assert.equal(stripped.includes('strip trailing comment'), false);

  // 2. Build both bundles in memory & verify standalone patcher bundle on disk
  const built = buildAllBundles({ write: true });
  assert.ok(built.runtime.size > 10000);
  assert.ok(built.patcher.size > 5000);
  assert.equal(fs.existsSync(PATCHER_OUT_FILE), true);

  // Requiring `dist/ensure_statusbar_patch.js` as a library MUST NOT auto-execute CLI side effects!
  delete require.cache[require.resolve(PATCHER_OUT_FILE)];
  const patcherLib = require(PATCHER_OUT_FILE);
  assert.equal(typeof patcherLib.getPatchStatus, 'function');
  assert.equal(typeof patcherLib.uninstallMcpManager, 'function');
  assert.equal(typeof patcherLib.runDedicatedAsarRestore, 'function');

  // Direct CLI execution (`node dist/ensure_statusbar_patch.js --status`) MUST execute `require.main === module` and exit 0!
  const tmp = createTestTempDir('cli-status');
  try {
    const { paths } = buildIsolatedHostFixture(tmp.dir);
    const cliRun = spawnSync(process.execPath, [PATCHER_OUT_FILE, '--status'], {
      env: {
        ...process.env,
        USERPROFILE: paths.homeDir,
        HOME: paths.homeDir,
        LOCALAPPDATA: path.join(tmp.dir, 'LocalAppData'),
        APPDATA: path.join(tmp.dir, 'RoamingAppData'),
      },
      encoding: 'utf8',
    });
    assert.equal(cliRun.status, 0, `Expected exit 0, stderr: ${cliRun.stderr}`);
    const parsedOut = JSON.parse(cliRun.stdout);
    assert.equal(parsedOut.ok, true);
    assert.equal(parsedOut.asarExists, true);
    assert.equal(parsedOut.asarPatched, false);
  } finally {
    tmp.cleanup();
  }
});

test('MCP-TC-026 & 050 (Rev 6 F1 & 5095348c-F3): Companion-preserving --uninstall, sole --uninstall, bidirectional Stage 2 -> Stage 1 ASAR reverse rollback, and 3-check --restore', async () => {
  // Case 1: Stage 2 failure during fresh `installMcpManager` -> reverses Stage 1 ASAR patch AND deletes newly created `asar_v5_backup.json`!
  {
    const tmp = createTestTempDir('install-rb');
    try {
      const { paths, originalAsarSha256 } = buildIsolatedHostFixture(tmp.dir);
      const failInstall = await installMcpManager(paths, {
        runtimeBundleSource: 'window.agyMcpManager = { version: "2.0.0" };',
        patcherBundleSource: '// standalone patcher',
        skipCdp: true,
        __injectStage2Failure() {
          throw new Error('Simulated Stage 2 disk error');
        },
      });
      assert.equal(failInstall.ok, false);
      assert.equal(failInstall.rolledBack, true);
      assert.equal(failInstall.reversedAsarPatch, true);
      assert.equal(sha256HexBuf(fs.readFileSync(paths.asarPath)), originalAsarSha256);
      assert.equal(fs.existsSync(paths.asarBackupPath), false, 'Newly created backup deleted on fresh install rollback');
      assert.equal(fs.existsSync(paths.mcpAutoinjectPath), false);
    } finally {
      tmp.cleanup();
    }
  }

  // Case 2: Companion-remaining `--uninstall` -> preserves V5 `app.asar`, `asar_v5_backup.json`, `ensure_statusbar_patch.js`, and re-syncs companion `app_storage.json`!
  {
    const tmp = createTestTempDir('companion-uninstall');
    try {
      const { paths } = buildIsolatedHostFixture(tmp.dir);
      const companionCode = 'window.agyStatusBar = { alive: true };\n';
      fs.writeFileSync(paths.autoinjectPath, companionCode, 'utf8');

      const inst = await installMcpManager(paths, {
        runtimeBundleSource: 'window.agyMcpManager = { version: "2.0.0" };',
        patcherBundleSource: '// standalone patcher',
        skipCdp: true,
      });
      assert.equal(inst.ok, true);
      assert.equal(isAsarPatchedFast(paths.asarPath), true);

      const uninst = await uninstallMcpManager(paths, { skipCdp: true });
      assert.equal(uninst.ok, true);
      assert.equal(uninst.branch, 'COMPANIONS_REMAINING');
      assert.equal(isAsarPatchedFast(paths.asarPath), true, 'Shared V5 ASAR patch preserved for companion');
      assert.equal(fs.existsSync(paths.asarBackupPath), true, 'Backup preserved for companion');
      assert.equal(fs.existsSync(paths.patcherScriptPath), true, 'Patcher preserved for companion');
      assert.equal(fs.existsSync(paths.mcpAutoinjectPath), false, 'MCP bundle deleted');

      const remainingAuto = fs.readFileSync(paths.autoinjectPath, 'utf8');
      assert.equal(remainingAuto.includes('window.agyStatusBar'), true);
      assert.equal(remainingAuto.includes('window.agyMcpManager'), false);

      const storageAfter = JSON.parse(fs.readFileSync(paths.appStoragePath, 'utf8'));
      assert.equal(storageAfter['agy-statusbar-code'].includes('window.agyStatusBar'), true);
      assert.equal(storageAfter['agy-statusbar-code'].includes('window.agyMcpManager'), false);
    } finally {
      tmp.cleanup();
    }
  }

  // Case 3: Sole-plugin `--uninstall` Stage 2 failure -> reverse-rollbacks Stage 1 ASAR restore via `patchAsarOnDisk`, then clean sole `--uninstall` restores exact original SHA-256!
  {
    const tmp = createTestTempDir('sole-uninstall');
    try {
      const { paths, originalAsarSha256 } = buildIsolatedHostFixture(tmp.dir);
      const inst = await installMcpManager(paths, {
        runtimeBundleSource: 'window.agyMcpManager = { version: "2.0.0" };',
        patcherBundleSource: '// standalone patcher',
        skipCdp: true,
      });
      assert.equal(inst.ok, true);

      // Inject Stage 2 failure during sole `--uninstall` -> must re-apply V5 ASAR patch so system stays consistent!
      const failedUninst = await uninstallMcpManager(paths, {
        skipCdp: true,
        __injectStage2Failure() {
          throw new Error('Simulated Stage 2 sole uninstall failure');
        },
      });
      assert.equal(failedUninst.ok, false);
      assert.equal(failedUninst.rolledBack, true);
      assert.equal(failedUninst.reversedAsarRestore, true);
      assert.equal(isAsarPatchedFast(paths.asarPath), true, 'ASAR re-patched after Stage 2 uninstall failure');
      assert.equal(fs.existsSync(paths.asarBackupPath), true);

      // Hook cycle yields immediately when `LOCK_PATH` is held by another operation (`5095348c-F3`)
      const activeTok = createLockToken('concurrent-install');
      assert.equal(acquireFileLock(paths.lockPath, activeTok), true);
      // Foreign token cannot release lock
      assert.equal(releaseFileLock(paths.lockPath, 'forged-token'), false);
      const hookYield = await runHookCycle(paths, { skipCdp: true });
      assert.equal(hookYield.status, 'YIELDED_LOCK_HELD');
      assert.equal(releaseFileLock(paths.lockPath, activeTok), true);

      // Clean sole `--uninstall` succeeds and restores byte-identical `app.asar`!
      const cleanUninst = await uninstallMcpManager(paths, { skipCdp: true });
      assert.equal(cleanUninst.ok, true);
      assert.equal(cleanUninst.branch, 'SOLE_PLUGIN');
      assert.equal(sha256HexBuf(fs.readFileSync(paths.asarPath)), originalAsarSha256);
      assert.equal(fs.existsSync(paths.mcpAutoinjectPath), false);
      assert.equal(fs.existsSync(paths.autoinjectPath), false);
      assert.equal(fs.existsSync(paths.patcherScriptPath), false);
      assert.equal(fs.existsSync(paths.asarBackupPath), false);
      const storageClean = JSON.parse(fs.readFileSync(paths.appStoragePath, 'utf8'));
      assert.equal('agy-statusbar-code' in storageClean, false);
    } finally {
      tmp.cleanup();
    }
  }

  // Case 4: Dedicated `--restore` 3-check pre-verification (`RESTORE_BACKUP_MISSING`, `RESTORE_VERSION_MISMATCH`, `ALREADY_ORIGINAL`, and `ASAR_LOCKED` with zero `copyFileSync`)
  {
    const tmp = createTestTempDir('dedicated-restore');
    try {
      const { paths, originalAsarSha256 } = buildIsolatedHostFixture(tmp.dir);

      // Missing backup -> `RESTORE_BACKUP_MISSING`
      const noBackupRes = runDedicatedAsarRestore(paths);
      assert.equal(noBackupRes.ok, false);
      assert.equal(noBackupRes.status, 'RESTORE_BACKUP_MISSING');

      // Patch cleanly, then restore via dedicated `--restore` (keeps companion files untouched!)
      fs.writeFileSync(paths.autoinjectPath, 'window.agyStatusBar = {};\n', 'utf8');
      assert.equal(patchAsarOnDisk(paths.asarPath, paths.asarBackupPath).ok, true);

      const dedicatedRes = runDedicatedAsarRestore(paths);
      assert.equal(dedicatedRes.ok, true);
      assert.equal(dedicatedRes.status, 'RESTORED');
      assert.equal(sha256HexBuf(fs.readFileSync(paths.asarPath)), originalAsarSha256);
      assert.equal(fs.existsSync(paths.autoinjectPath), true, '--restore must NOT delete companion files');

      // Calling `--restore` again when already original -> `ALREADY_ORIGINAL`
      const idempRes = runDedicatedAsarRestore(paths);
      assert.equal(idempRes.ok, true);
      assert.equal(idempRes.status, 'ALREADY_ORIGINAL');

      // Upgraded/different `app.asar` version -> `RESTORE_VERSION_MISMATCH`
      const upgradedAsar = createSyntheticAsarBuffer({
        'package.json': JSON.stringify({ name: 'antigravity-mock', version: '3.0.0-upgraded' }, null, 2),
        'dist/utils.js': createPaddedAnchorFile(UTILS_ANCHOR_TARGET),
        'dist/main.js': createPaddedAnchorFile(`${MAIN_ANCHOR_TARGET}\n});`),
        'dist/preload.js': createPaddedAnchorFile(PRELOAD_ANCHOR_TARGET),
      });
      fs.writeFileSync(paths.asarPath, upgradedAsar);
      const mismatchRes = restoreAsarOnDisk(paths.asarPath, paths.asarBackupPath);
      assert.equal(mismatchRes.ok, false);
      assert.equal(mismatchRes.status, 'RESTORE_VERSION_MISMATCH');

      // Simulated `EBUSY` on `app.asar` `fs.renameSync` -> returns `ASAR_LOCKED` with ZERO `fs.copyFileSync` calls and rolls back fresh backup!
      const origRename = fs.renameSync;
      const origCopy = fs.copyFileSync;
      let copyCalled = false;
      const freshBackupPath = path.join(tmp.dir, 'fresh-backup.json');
      fs.renameSync = (src, dest) => {
        if (dest === paths.asarPath) {
          const err = new Error('EBUSY: resource busy or locked');
          err.code = 'EBUSY';
          throw err;
        }
        return origRename(src, dest);
      };
      fs.copyFileSync = () => {
        copyCalled = true;
      };
      try {
        const lockedRes = patchAsarOnDisk(paths.asarPath, freshBackupPath);
        assert.equal(lockedRes.ok, false);
        assert.equal(lockedRes.status, 'ASAR_LOCKED');
        assert.equal(copyCalled, false, 'copyFileSync must NEVER be called on locked app.asar');
        assert.equal(fs.existsSync(freshBackupPath), false, 'Fresh backup must be rolled back when app.asar is locked');
      } finally {
        fs.renameSync = origRename;
        fs.copyFileSync = origCopy;
      }
    } finally {
      tmp.cleanup();
    }
  }
});

test('MCP-TC-030 & 035: RFC 6455 WebSocket client echoes Ping in Pong, reassembles fragmented frames, and flushes Close cleanly', async () => {
  let receivedPongPayload = null;
  let receivedClientText = null;

  const server = net.createServer((socket) => {
    let upgraded = false;
    let buf = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n');
        if (end === -1) return;
        const reqStr = buf.subarray(0, end).toString('utf8');
        buf = buf.subarray(end + 4);
        const keyMatch = reqStr.match(/Sec-WebSocket-Key:\s*(\S+)/i);
        const accept = crypto
          .createHash('sha1')
          .update(`${keyMatch[1]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest('base64');
        socket.write(
          [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${accept}`,
            '\r\n',
          ].join('\r\n')
        );
        upgraded = true;

        // Send Ping (`0x89`) + fragmented text (`0x01` "hel" + `0x80` "lo-ws")
        const pingPayload = Buffer.from('hb1');
        const pingFrame = Buffer.concat([Buffer.from([0x89, pingPayload.length]), pingPayload]);
        const frag1 = Buffer.concat([Buffer.from([0x01, 3]), Buffer.from('hel')]);
        const frag2 = Buffer.concat([Buffer.from([0x80, 5]), Buffer.from('lo-ws')]);
        socket.write(Buffer.concat([pingFrame, frag1, frag2]));
        return;
      }

      // Parse masked client frames
      while (buf.length >= 2) {
        const b0 = buf[0];
        const b1 = buf[1];
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        const len = b1 & 0x7f;
        const maskOffset = 2;
        const payloadOffset = maskOffset + (masked ? 4 : 0);
        if (buf.length < payloadOffset + len) break;
        const payload = Buffer.from(buf.subarray(payloadOffset, payloadOffset + len));
        if (masked) {
          const mask = buf.subarray(maskOffset, maskOffset + 4);
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
        }
        buf = buf.subarray(payloadOffset + len);

        if (opcode === 0x0a) {
          receivedPongPayload = payload.toString('utf8');
        } else if (opcode === 0x01) {
          receivedClientText = payload.toString('utf8');
          // Send Close frame (`0x88`)
          socket.write(Buffer.from([0x88, 0x02, 0x03, 0xe8]));
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const serverMsg = await new Promise((resolve, reject) => {
      const ws = createRfc6455WebSocketClient(`ws://127.0.0.1:${port}/devtools/page/1`);
      ws.onerror = (err) => reject(err);
      ws.onmessage = (ev) => {
        ws.send('ack-from-client');
        resolve(ev.data);
      };
    });

    await new Promise((r) => setTimeout(r, 40));
    assert.equal(serverMsg, 'hello-ws');
    assert.equal(receivedPongPayload, 'hb1');
    assert.equal(receivedClientText, 'ack-from-client');
  } finally {
    server.close();
  }
});
