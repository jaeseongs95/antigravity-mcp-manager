'use strict';

/**
 * Pure Electron ASAR Archive Transformation & Integrity-Verified Restoration (`scripts/lib/asar-patcher.js`).
 *
 * Guarantees (`Rev 6 §5.5 #1`, `5095348c-F3`, `MCP-TC-050`):
 * 1. Pure disk archive module: zero dependency on `app_storage.json` or `statusbar_autoinject.js`.
 * 2. Exact-size entry transformation (`0` byte offset drift across all archive entries).
 * 3. `patchAsarOnDisk(asarPath, backupJsonPath)` stores original header + 3 entry buffers +
 *    `originalAsarSha256` + `patchedHeaderSha256` in `asar_v5_backup.json` and replaces `app.asar`
 *    strictly via `fsyncSync` + `renameSync` (returns `ASAR_LOCKED` on `EBUSY`/`EPERM` with zero `copyFileSync`).
 * 4. `restoreAsarOnDisk(asarPath, backupJsonPath)` enforces 3-stage verification:
 *    - Check 1: Idempotent `ALREADY_ORIGINAL` if unpatched and SHA-256 matches `originalAsarSha256`.
 *    - Check 2: `RESTORE_BACKUP_MISSING` if backup file absent; `RESTORE_VERSION_MISMATCH` if
 *      current `app.asar` lacks V5 markers or its header SHA-256 differs from `patchedHeaderSha256`.
 *    - Check 3: Full reconstructed archive SHA-256 verified against `originalAsarSha256` prior to
 *      `fsyncSync` + `renameSync`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { stripPureCommentLinesLexical } = require('./js-lexer');
const { writeFileAtomicSync } = require('./file-lock');

const PATCH_MARKER = 'AGY_STATUSBAR_AUTOINJECT_V5';
const BLOCK_SIZE = 4 * 1024 * 1024;

const UTILS_ANCHOR_TARGET = '    void win.loadURL(url);';
const UTILS_ANCHOR_REPLACEMENT = [
  `    // ${PATCH_MARKER}`,
  '    const _injectAgyStatusBar = () => {',
  '        try {',
  '            if (win.isDestroyed() || win.webContents.isDestroyed() || !/^https?:/i.test(win.webContents.getURL())) return;',
  "            const _p = require('path').join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'statusbar_autoinject.js');",
  "            if (require('fs').existsSync(_p)) void win.webContents.executeJavaScript(require('fs').readFileSync(_p, 'utf8')).catch(() => {});",
  '        } catch (_e) {}',
  '    };',
  "    win.webContents.on('dom-ready', _injectAgyStatusBar);",
  "    win.webContents.on('did-finish-load', _injectAgyStatusBar);",
  '    void win.loadURL(url);',
].join('\n');

const MAIN_ANCHOR_TARGET = "electron_1.app.on('web-contents-created', (_event, contents) => {";
const MAIN_ANCHOR_REPLACEMENT = [
  "electron_1.app.on('web-contents-created', (_event, contents) => {",
  `    // ${PATCH_MARKER}`,
  "    if (contents.getType() === 'window' && !(typeof scriptJail_1 !== 'undefined' && scriptJail_1.isScriptJailSession && scriptJail_1.isScriptJailSession(contents.session))) {",
  '        const _injectAgyMain = () => {',
  '            try {',
  '                if (contents.isDestroyed() || !/^https?:/i.test(contents.getURL())) return;',
  "                const _p = require('path').join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'statusbar_autoinject.js');",
  "                if (require('fs').existsSync(_p)) void contents.executeJavaScript(require('fs').readFileSync(_p, 'utf8')).catch(() => {});",
  '            } catch (_e) {}',
  '        };',
  "        contents.on('dom-ready', _injectAgyMain);",
  "        contents.on('did-finish-load', _injectAgyMain);",
  '    }',
].join('\n');

const PRELOAD_ANCHOR_TARGET = "electron_1.contextBridge.exposeInMainWorld('wsl', wslAPI);";
const PRELOAD_ANCHOR_REPLACEMENT = [
  "electron_1.contextBridge.exposeInMainWorld('wsl', wslAPI);",
  `// ${PATCH_MARKER}`,
  "if (/^https?:$/i.test(globalThis.location?.protocol || '')) {",
  "    electron_1.ipcRenderer.invoke('storage:get-items').then((r) => {",
  "        if (r && r['agy-statusbar-code']) {",
  "            void electron_1.webFrame.executeJavaScript(r['agy-statusbar-code']).catch(() => {});",
  '        }',
  '    }).catch(() => {});',
  '}',
].join('\n');

function sha256HexBuf(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

function computeAsarIntegrity(buf) {
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK_SIZE) {
    blocks.push(sha256HexBuf(buf.subarray(i, Math.min(i + BLOCK_SIZE, buf.length))));
  }
  if (blocks.length === 0) {
    blocks.push(sha256HexBuf(Buffer.alloc(0)));
  }
  return {
    algorithm: 'SHA256',
    hash: sha256HexBuf(buf),
    blockSize: BLOCK_SIZE,
    blocks,
  };
}

/**
 * Replaces `anchorTarget` with `anchorReplacement` while keeping exact UTF-8 byte length.
 *
 * @param {Buffer} origBuf
 * @param {string} anchorTarget
 * @param {string} anchorReplacement
 * @returns {Buffer}
 */
function transformExactSize(origBuf, anchorTarget, anchorReplacement) {
  const origSize = origBuf.length;
  const origStr = origBuf.toString('utf8');
  const hasCrlf = origStr.includes('\r\n');
  const normalized = origStr.replace(/\r\n/g, '\n');

  const occ = normalized.split(anchorTarget).length - 1;
  if (occ !== 1) {
    throw new Error(`Expected single anchor occurrence, found ${occ}`);
  }

  const modified = normalized.replace(anchorTarget, anchorReplacement);
  const strippedLines = stripPureCommentLinesLexical(modified.split('\n'), PATCH_MARKER);

  let candidate = strippedLines.join(hasCrlf ? '\r\n' : '\n');
  const candBytes = Buffer.byteLength(candidate, 'utf8');
  if (candBytes > origSize) {
    throw new Error(`Transformed content exceeds original entry size (${candBytes} > ${origSize})`);
  }

  const diff = origSize - candBytes;
  if (diff > 0) {
    if (diff >= 3) {
      candidate += `//${' '.repeat(diff - 3)}\n`;
    } else {
      candidate += ' '.repeat(diff);
    }
  }

  const outBuf = Buffer.from(candidate, 'utf8');
  if (outBuf.length !== origSize) {
    throw new Error(`Exact byte size mismatch (${outBuf.length} !== ${origSize})`);
  }

  new vm.Script(outBuf.toString('utf8'));
  return outBuf;
}

/**
 * Fast descriptor-level check verifying whether `asarPath` already contains all 3 V5 markers.
 *
 * @param {string} asarPath
 * @returns {boolean}
 */
function isAsarPatchedFast(asarPath) {
  let fd = null;
  try {
    if (!asarPath || !fs.existsSync(asarPath)) return false;
    fd = fs.openSync(asarPath, 'r');
    const prefixBuf = Buffer.alloc(16);
    if (fs.readSync(fd, prefixBuf, 0, 16, 0) < 16) return false;

    const u4 = prefixBuf.readUInt32LE(4);
    const strSize = prefixBuf.readUInt32LE(12);
    if (strSize <= 0 || strSize > 16 * 1024 * 1024) return false;

    const headerBuf = Buffer.alloc(strSize);
    fs.readSync(fd, headerBuf, 0, strSize, 16);
    const header = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''));
    const dataOffset = 8 + u4;

    const distFiles = header?.files?.dist?.files;
    if (!distFiles) return false;

    const utilsNode = distFiles['utils.js'];
    const mainNode = distFiles['main.js'];
    const preloadNode = distFiles['preload.js'];
    if (!utilsNode || !mainNode || !preloadNode) return false;

    const readEntry = (node) => {
      const b = Buffer.alloc(node.size);
      fs.readSync(fd, b, 0, node.size, dataOffset + Number(node.offset));
      return b.toString('utf8');
    };

    const utilsStr = readEntry(utilsNode);
    const mainStr = readEntry(mainNode);
    const preloadStr = readEntry(preloadNode);

    return (
      utilsStr.includes(PATCH_MARKER) &&
      mainStr.includes(PATCH_MARKER) &&
      preloadStr.includes(PATCH_MARKER)
    );
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore
      }
    }
  }
}

function readAsarArchive(filePath) {
  const buf = fs.readFileSync(filePath);
  const u0 = buf.readUInt32LE(0);
  const u4 = buf.readUInt32LE(4);
  const u8 = buf.readUInt32LE(8);
  const strSize = buf.readUInt32LE(12);
  const dataOffset = 8 + u4;
  const headerSlice = buf.subarray(0, dataOffset);
  const headerJsonBuf = buf.subarray(16, 16 + strSize);
  const header = JSON.parse(headerJsonBuf.toString('utf8').replace(/\0+$/, ''));

  const fileMap = new Map();
  const extractNode = (node, relPath) => {
    if (node.files) {
      for (const [name, child] of Object.entries(node.files)) {
        extractNode(child, relPath ? `${relPath}/${name}` : name);
      }
    } else if (!node.unpacked && node.offset !== undefined && node.size !== undefined) {
      const start = dataOffset + Number(node.offset);
      fileMap.set(relPath, buf.subarray(start, start + node.size));
    }
  };
  extractNode(header, '');

  let appVersion = 'unknown';
  try {
    const pkgBuf = fileMap.get('package.json');
    if (pkgBuf) {
      const pkg = JSON.parse(pkgBuf.toString('utf8'));
      if (pkg && pkg.version) appVersion = String(pkg.version);
    }
  } catch {
    appVersion = 'unknown';
  }

  return {
    buf,
    u0,
    u4,
    u8,
    strSize,
    dataOffset,
    headerSlice,
    headerJsonBuf,
    header,
    fileMap,
    appVersion,
  };
}

function isFileLockError(err) {
  const code = String(err?.code || '').toUpperCase();
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}

function replaceAsarStrictAtomic(asarPath, nextAsarBuf) {
  const dir = path.dirname(asarPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${asarPath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  let fd = null;
  try {
    fd = fs.openSync(tmpPath, 'wx');
    fs.writeSync(fd, nextAsarBuf, 0, nextAsarBuf.length, 0);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmpPath, asarPath);
    return { ok: true };
  } catch (err) {
    if (isFileLockError(err)) {
      return {
        ok: false,
        status: 'ASAR_LOCKED',
        error: `app.asar is locked by a running host process (${err.code}); close Antigravity and retry.`,
      };
    }
    return {
      ok: false,
      status: 'ASAR_WRITE_FAILED',
      error: err?.message || String(err),
    };
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

function buildSerializedAsarBuffer(u0, headerObj, fileMap) {
  const chunks = [];
  let currentOffset = 0n;

  const rebuildNode = (node, relPath) => {
    if (node.files) {
      for (const [name, child] of Object.entries(node.files)) {
        rebuildNode(child, relPath ? `${relPath}/${name}` : name);
      }
    } else if (!node.unpacked && node.offset !== undefined && node.size !== undefined) {
      const data = fileMap.get(relPath);
      node.size = data.length;
      node.offset = currentOffset.toString();
      node.integrity = computeAsarIntegrity(data);
      chunks.push(data);
      currentOffset += BigInt(data.length);
    }
  };
  rebuildNode(headerObj, '');

  const newHeaderStrBuf = Buffer.from(JSON.stringify(headerObj), 'utf8');
  const newStrSize = newHeaderStrBuf.length;
  const alignedStrSize = Math.ceil(newStrSize / 4) * 4;
  const newU8 = 4 + alignedStrSize;
  const newU4 = 4 + newU8;
  const totalHeaderSize = 8 + newU4;

  const newHeaderBuf = Buffer.alloc(totalHeaderSize, 0);
  newHeaderBuf.writeUInt32LE(u0, 0);
  newHeaderBuf.writeUInt32LE(newU4, 4);
  newHeaderBuf.writeUInt32LE(newU8, 8);
  newHeaderBuf.writeUInt32LE(newStrSize, 12);
  newHeaderStrBuf.copy(newHeaderBuf, 16);

  return {
    headerBuf: newHeaderBuf,
    archiveBuf: Buffer.concat([newHeaderBuf, ...chunks]),
  };
}

/**
 * Applies exact-size V5 anchors to `asarPath` and writes reversible metadata to `backupJsonPath`.
 *
 * @param {string} asarPath
 * @param {string} backupJsonPath
 */
function patchAsarOnDisk(asarPath, backupJsonPath) {
  if (!asarPath || !fs.existsSync(asarPath)) {
    return {
      ok: true,
      status: 'SKIPPED_NO_ASAR',
      didPatch: false,
      didCreateBackup: false,
    };
  }

  if (isAsarPatchedFast(asarPath)) {
    let appVersion = 'unknown';
    try {
      appVersion = readAsarArchive(asarPath).appVersion;
    } catch {
      appVersion = 'unknown';
    }
    return {
      ok: true,
      status: 'ALREADY_PATCHED',
      didPatch: false,
      didCreateBackup: false,
      patchVersion: PATCH_MARKER,
      appVersion,
    };
  }

  let archive;
  try {
    archive = readAsarArchive(asarPath);
  } catch (err) {
    return {
      ok: false,
      status: 'ASAR_READ_FAILED',
      didPatch: false,
      didCreateBackup: false,
      error: err?.message || String(err),
    };
  }

  const utilsBuf = archive.fileMap.get('dist/utils.js');
  const mainBuf = archive.fileMap.get('dist/main.js');
  const preloadBuf = archive.fileMap.get('dist/preload.js');
  if (!utilsBuf || !mainBuf || !preloadBuf) {
    return {
      ok: false,
      status: 'FAILED_TARGET_FILES_MISSING',
      didPatch: false,
      didCreateBackup: false,
      appVersion: archive.appVersion,
      error: 'dist/utils.js, dist/main.js, or dist/preload.js missing in app.asar',
    };
  }

  const origPreloadOffset = archive.header?.files?.dist?.files?.['preload.js']?.offset;
  const originalAsarSha256 = sha256HexBuf(archive.buf);
  const originalHeaderSliceBase64 = Buffer.from(archive.headerSlice).toString('base64');
  const origEntriesBase64 = {
    'dist/utils.js': Buffer.from(utilsBuf).toString('base64'),
    'dist/main.js': Buffer.from(mainBuf).toString('base64'),
    'dist/preload.js': Buffer.from(preloadBuf).toString('base64'),
  };

  let patchedUtilsBuf;
  let patchedMainBuf;
  let patchedPreloadBuf;
  try {
    patchedUtilsBuf = transformExactSize(utilsBuf, UTILS_ANCHOR_TARGET, UTILS_ANCHOR_REPLACEMENT);
    patchedMainBuf = transformExactSize(mainBuf, MAIN_ANCHOR_TARGET, MAIN_ANCHOR_REPLACEMENT);
    patchedPreloadBuf = transformExactSize(preloadBuf, PRELOAD_ANCHOR_TARGET, PRELOAD_ANCHOR_REPLACEMENT);
  } catch (err) {
    return {
      ok: false,
      status: 'FAILED_PATTERN_OR_SIZE',
      didPatch: false,
      didCreateBackup: false,
      appVersion: archive.appVersion,
      error: err?.message || String(err),
    };
  }

  archive.fileMap.set('dist/utils.js', patchedUtilsBuf);
  archive.fileMap.set('dist/main.js', patchedMainBuf);
  archive.fileMap.set('dist/preload.js', patchedPreloadBuf);

  const clonedHeader = JSON.parse(JSON.stringify(archive.header));
  const { headerBuf: patchedHeaderBuf, archiveBuf: outBuf } = buildSerializedAsarBuffer(
    archive.u0,
    clonedHeader,
    archive.fileMap
  );

  const newPreloadOffset = clonedHeader?.files?.dist?.files?.['preload.js']?.offset;
  if (origPreloadOffset !== newPreloadOffset) {
    return {
      ok: false,
      status: 'FAILED_OFFSET_DRIFT',
      didPatch: false,
      didCreateBackup: false,
      appVersion: archive.appVersion,
      error: `preload.js offset drifted (${origPreloadOffset} -> ${newPreloadOffset})`,
    };
  }

  const patchedHeaderSha256 = sha256HexBuf(patchedHeaderBuf);
  const backupExistedBefore = Boolean(backupJsonPath && fs.existsSync(backupJsonPath));
  const prevBackupBytes = backupExistedBefore ? fs.readFileSync(backupJsonPath) : null;

  if (backupJsonPath) {
    const backupDoc = {
      schemaVersion: 1,
      patchMarker: PATCH_MARKER,
      appVersion: archive.appVersion,
      originalAsarSha256,
      patchedHeaderSha256,
      originalHeaderSliceBase64,
      entries: origEntriesBase64,
      createdAt: new Date().toISOString(),
    };
    try {
      writeFileAtomicSync(backupJsonPath, `${JSON.stringify(backupDoc, null, 2)}\n`);
    } catch (err) {
      return {
        ok: false,
        status: 'BACKUP_WRITE_FAILED',
        didPatch: false,
        didCreateBackup: false,
        error: err?.message || String(err),
      };
    }
  }

  const writeRes = replaceAsarStrictAtomic(asarPath, outBuf);
  if (!writeRes.ok) {
    if (backupJsonPath) {
      try {
        if (backupExistedBefore && prevBackupBytes) {
          writeFileAtomicSync(backupJsonPath, prevBackupBytes);
        } else if (!backupExistedBefore && fs.existsSync(backupJsonPath)) {
          fs.unlinkSync(backupJsonPath);
        }
      } catch {
        // Ignore rollback cleanup error
      }
    }
    return {
      ok: false,
      status: writeRes.status,
      didPatch: false,
      didCreateBackup: false,
      error: writeRes.error,
    };
  }

  return {
    ok: true,
    status: 'PATCHED',
    didPatch: true,
    didCreateBackup: Boolean(backupJsonPath && !backupExistedBefore),
    patchVersion: PATCH_MARKER,
    appVersion: archive.appVersion,
    originalAsarSha256,
    patchedHeaderSha256,
  };
}

/**
 * Restores `asarPath` to its exact pre-patch binary using 3-stage integrity verification.
 *
 * @param {string} asarPath
 * @param {string} backupJsonPath
 */
function restoreAsarOnDisk(asarPath, backupJsonPath) {
  if (!asarPath || !fs.existsSync(asarPath)) {
    return {
      ok: true,
      status: 'SKIPPED_NO_ASAR',
      didRestore: false,
    };
  }

  if (!backupJsonPath || !fs.existsSync(backupJsonPath)) {
    return {
      ok: false,
      status: 'RESTORE_BACKUP_MISSING',
      didRestore: false,
      error:
        'asar_v5_backup.json is missing; cannot verify original app.asar integrity (for legacy v1.5.0 installs, check app.asar.v*.orig manually).',
    };
  }

  let backup;
  try {
    backup = JSON.parse(fs.readFileSync(backupJsonPath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      status: 'RESTORE_BACKUP_CORRUPT',
      didRestore: false,
      error: `Failed to parse asar_v5_backup.json: ${err?.message || String(err)}`,
    };
  }

  if (
    !backup ||
    typeof backup.originalAsarSha256 !== 'string' ||
    typeof backup.patchedHeaderSha256 !== 'string' ||
    typeof backup.originalHeaderSliceBase64 !== 'string' ||
    !backup.entries
  ) {
    return {
      ok: false,
      status: 'RESTORE_BACKUP_CORRUPT',
      didRestore: false,
      error: 'asar_v5_backup.json is missing required integrity fields.',
    };
  }

  let currentArchive;
  try {
    currentArchive = readAsarArchive(asarPath);
  } catch (err) {
    return {
      ok: false,
      status: 'ASAR_READ_FAILED',
      didRestore: false,
      error: err?.message || String(err),
    };
  }

  const currentFullSha256 = sha256HexBuf(currentArchive.buf);
  const currentlyPatched = isAsarPatchedFast(asarPath);

  // Check 1: Idempotent no-op if already unpatched and identical to originalAsarSha256
  if (!currentlyPatched && currentFullSha256 === backup.originalAsarSha256) {
    return {
      ok: true,
      status: 'ALREADY_ORIGINAL',
      didRestore: false,
      originalAsarSha256: backup.originalAsarSha256,
    };
  }

  // Check 2: Verify V5 markers AND patched header SHA-256 match backup (prevents downgrading host updates)
  const currentHeaderSha256 = sha256HexBuf(currentArchive.headerSlice);
  if (!currentlyPatched || currentHeaderSha256 !== backup.patchedHeaderSha256) {
    return {
      ok: false,
      status: 'RESTORE_VERSION_MISMATCH',
      didRestore: false,
      error: 'Current app.asar does not match the recorded V5 patched header digest (host may have updated).',
    };
  }

  // Check 3: Reconstruct original archive and verify full SHA-256 BEFORE fsync + rename
  const origHeaderSlice = Buffer.from(backup.originalHeaderSliceBase64, 'base64');
  const payloadCopy = Buffer.from(currentArchive.buf.subarray(currentArchive.dataOffset));

  const distFiles = currentArchive.header?.files?.dist?.files || {};
  const entryDefs = [
    ['dist/utils.js', distFiles['utils.js']],
    ['dist/main.js', distFiles['main.js']],
    ['dist/preload.js', distFiles['preload.js']],
  ];

  for (let i = 0; i < entryDefs.length; i += 1) {
    const [relKey, node] = entryDefs[i];
    const encoded = backup.entries[relKey];
    if (!node || typeof encoded !== 'string') {
      return {
        ok: false,
        status: 'RESTORE_BACKUP_CORRUPT',
        didRestore: false,
        error: `Missing backup entry for ${relKey}`,
      };
    }
    const origEntryBuf = Buffer.from(encoded, 'base64');
    const offset = Number(node.offset);
    if (origEntryBuf.length !== Number(node.size) || offset + origEntryBuf.length > payloadCopy.length) {
      return {
        ok: false,
        status: 'RESTORE_VERSION_MISMATCH',
        didRestore: false,
        error: `Entry size/offset mismatch while restoring ${relKey}`,
      };
    }
    origEntryBuf.copy(payloadCopy, offset);
  }

  const candidateAsarBuf = Buffer.concat([origHeaderSlice, payloadCopy]);
  const candidateSha256 = sha256HexBuf(candidateAsarBuf);
  if (candidateSha256 !== backup.originalAsarSha256) {
    return {
      ok: false,
      status: 'RESTORE_DIGEST_MISMATCH',
      didRestore: false,
      error: `Reconstructed ASAR SHA-256 (${candidateSha256}) did not match expected original (${backup.originalAsarSha256}).`,
    };
  }

  const writeRes = replaceAsarStrictAtomic(asarPath, candidateAsarBuf);
  if (!writeRes.ok) {
    return {
      ok: false,
      status: writeRes.status,
      didRestore: false,
      error: writeRes.error,
    };
  }

  return {
    ok: true,
    status: 'RESTORED',
    didRestore: true,
    originalAsarSha256: candidateSha256,
  };
}

/**
 * Helper to create a minimal valid synthetic `app.asar` archive buffer for isolated tests.
 *
 * @param {Record<string, string | Buffer>} filesByRelPath
 * @returns {Buffer}
 */
function createSyntheticAsarBuffer(filesByRelPath) {
  const rootHeader = { files: {} };
  const fileMap = new Map();

  for (const [relPath, rawContent] of Object.entries(filesByRelPath)) {
    const clean = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = clean.split('/');
    let cursor = rootHeader;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const seg = parts[i];
      if (!cursor.files[seg]) cursor.files[seg] = { files: {} };
      cursor = cursor.files[seg];
    }
    const leafName = parts[parts.length - 1];
    const buf = Buffer.isBuffer(rawContent) ? Buffer.from(rawContent) : Buffer.from(String(rawContent), 'utf8');
    cursor.files[leafName] = { size: buf.length, offset: '0' };
    fileMap.set(clean, buf);
  }

  return buildSerializedAsarBuffer(4, rootHeader, fileMap).archiveBuf;
}

module.exports = {
  PATCH_MARKER,
  BLOCK_SIZE,
  UTILS_ANCHOR_TARGET,
  MAIN_ANCHOR_TARGET,
  PRELOAD_ANCHOR_TARGET,
  sha256HexBuf,
  computeAsarIntegrity,
  transformExactSize,
  isAsarPatchedFast,
  readAsarArchive,
  patchAsarOnDisk,
  restoreAsarOnDisk,
  createSyntheticAsarBuffer,
};
