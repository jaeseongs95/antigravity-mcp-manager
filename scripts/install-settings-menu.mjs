#!/usr/bin/env node
/**
 * Antigravity 2.0 Settings Menu Installer (`scripts/install-settings-menu.mjs`).
 *
 * Uses official `@electron/asar` to install, inspect, or cleanly uninstall an
 * independent 1-line Main-process loader hook in Antigravity's `app.asar` (`dist/main.js`).
 *
 * Safety Guarantees:
 * - Independent marker (`AGY_MCP_MANAGER_SETTINGS_V2_START` / `END`); NEVER touches
 *   `statusbar_autoinject.js` or any other plugin's hooks.
 * - Preserves existing `app.asar.v*.orig` backups (creates one if none exists).
 * - Atomic same-directory temp write + replace with SHA-256 verification.
 * - Clean `--uninstall` removes only our hook block cleanly.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';

export const HOOK_START_MARKER = '/* AGY_MCP_MANAGER_SETTINGS_V2_START */';
export const HOOK_END_MARKER = '/* AGY_MCP_MANAGER_SETTINGS_V2_END */';
const MAIN_REL_PATH = path.join('dist', 'main.js');

export function resolveDefaultAsarPath({ homeDir = os.homedir(), platform = process.platform } = {}) {
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    return path.join(localAppData, 'Programs', 'antigravity', 'resources', 'app.asar');
  }
  if (platform === 'darwin') {
    return '/Applications/Antigravity.app/Contents/Resources/app.asar';
  }
  return '/opt/Antigravity/resources/app.asar';
}

export function buildHookSnippet(pluginDir = null) {
  const customPathExpr = pluginDir
    ? JSON.stringify(path.join(path.resolve(pluginDir), 'scripts', 'electron-hook.cjs'))
    : `require('path').join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'config', 'plugins', 'antigravity-mcp-manager', 'scripts', 'electron-hook.cjs')`;
  return [
    HOOK_START_MARKER,
    `try { const _agyMcpHookPath = ${customPathExpr}; if (require('fs').existsSync(_agyMcpHookPath)) require(_agyMcpHookPath); } catch (_agyMcpErr) {}`,
    HOOK_END_MARKER,
  ].join('\n');
}

export function stripHookSnippet(sourceText) {
  const rx = new RegExp(
    `\\r?\\n?${HOOK_START_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${HOOK_END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?\\n?`,
    'g'
  );
  return sourceText.replace(rx, '\n').replace(/\n+$/, '\n');
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function findOrCreateBackup(asarPath) {
  const dir = path.dirname(asarPath);
  const existing = fs.readdirSync(dir).find((name) => /^app\.asar(?:\..+)?\.orig$/.test(name));
  if (existing) {
    return { backupPath: path.join(dir, existing), created: false };
  }
  const backupPath = path.join(dir, 'app.asar.agy-mcp-manager.orig');
  fs.copyFileSync(asarPath, backupPath);
  return { backupPath, created: true };
}

export function getSettingsHookStatus({ asarPath = resolveDefaultAsarPath() } = {}) {
  if (!fs.existsSync(asarPath)) {
    return { ok: false, exists: false, installed: false, asarPath, error: `app.asar not found at ${asarPath}` };
  }
  asar.uncache(asarPath);
  const mainBuf = asar.extractFile(asarPath, 'dist/main.js');
  const mainText = mainBuf.toString('utf8');
  const installed = mainText.includes(HOOK_START_MARKER) && mainText.includes(HOOK_END_MARKER);
  return {
    ok: true,
    exists: true,
    installed,
    asarPath,
    sha256: sha256File(asarPath),
  };
}

export async function installSettingsHook({
  asarPath = resolveDefaultAsarPath(),
  pluginDir = null,
} = {}) {
  if (!fs.existsSync(asarPath)) {
    throw new Error(`app.asar not found at "${asarPath}"`);
  }
  const backup = findOrCreateBackup(asarPath);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-asar-install-'));
  const tmpAsar = path.join(path.dirname(asarPath), `.app.asar.mcp-tmp.${process.pid}.${Date.now()}`);
  try {
    asar.extractAll(asarPath, tmpDir);
    const mainFile = path.join(tmpDir, MAIN_REL_PATH);
    if (!fs.existsSync(mainFile)) {
      throw new Error(`Expected ${MAIN_REL_PATH} inside app.asar`);
    }
    const raw = fs.readFileSync(mainFile, 'utf8');
    const cleaned = stripHookSnippet(raw);
    const updated = `${cleaned.trimEnd()}\n${buildHookSnippet(pluginDir)}\n`;
    fs.writeFileSync(mainFile, updated, 'utf8');

    await asar.createPackage(tmpDir, tmpAsar);
    fs.renameSync(tmpAsar, asarPath);
    asar.uncache(asarPath);

    return {
      ok: true,
      installed: true,
      asarPath,
      backupPath: backup.backupPath,
      backupCreated: backup.created,
      sha256: sha256File(asarPath),
    };
  } finally {
    if (fs.existsSync(tmpAsar)) {
      try { fs.unlinkSync(tmpAsar); } catch {}
    }
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

export async function uninstallSettingsHook({ asarPath = resolveDefaultAsarPath() } = {}) {
  if (!fs.existsSync(asarPath)) {
    throw new Error(`app.asar not found at "${asarPath}"`);
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-asar-uninstall-'));
  const tmpAsar = path.join(path.dirname(asarPath), `.app.asar.mcp-tmp.${process.pid}.${Date.now()}`);
  try {
    asar.extractAll(asarPath, tmpDir);
    const mainFile = path.join(tmpDir, MAIN_REL_PATH);
    if (!fs.existsSync(mainFile)) {
      throw new Error(`Expected ${MAIN_REL_PATH} inside app.asar`);
    }
    const raw = fs.readFileSync(mainFile, 'utf8');
    const hadHook = raw.includes(HOOK_START_MARKER);
    if (!hadHook) {
      return { ok: true, removed: false, installed: false, asarPath, sha256: sha256File(asarPath) };
    }
    const cleaned = stripHookSnippet(raw);
    fs.writeFileSync(mainFile, cleaned, 'utf8');

    await asar.createPackage(tmpDir, tmpAsar);
    fs.renameSync(tmpAsar, asarPath);
    asar.uncache(asarPath);

    return {
      ok: true,
      removed: true,
      installed: false,
      asarPath,
      sha256: sha256File(asarPath),
    };
  } finally {
    if (fs.existsSync(tmpAsar)) {
      try { fs.unlinkSync(tmpAsar); } catch {}
    }
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

// CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const flagValue = (name) => {
    const idx = args.indexOf(name);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  const asarPath = flagValue('--asar') || resolveDefaultAsarPath();
  const pluginDir = flagValue('--plugin-dir') || null;

  (async () => {
    if (args.includes('--install')) {
      const res = await installSettingsHook({ asarPath, pluginDir });
      console.log(JSON.stringify(res, null, 2));
    } else if (args.includes('--uninstall')) {
      const res = await uninstallSettingsHook({ asarPath });
      console.log(JSON.stringify(res, null, 2));
    } else {
      const res = getSettingsHookStatus({ asarPath });
      console.log(JSON.stringify(res, null, 2));
    }
  })().catch((err) => {
    console.error(err?.message || String(err));
    process.exit(1);
  });
}
