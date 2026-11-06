#!/usr/bin/env node
'use strict';

/**
 * Installer for Antigravity Custom MCP Server Manager.
 *
 * 1. Builds `dist/mcp_manager_autoinject.js`
 * 2. Copies standalone bundle to `~/.gemini/antigravity/mcp_manager_autoinject.js`
 * 3. Chains the marked `AGY_MCP_MANAGER_V1` block into `~/.gemini/antigravity/statusbar_autoinject.js`
 *    (before `BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2` if present, preserving both Statusbar and KO localizer)
 * 4. Executes `ensure_statusbar_patch.js --worker` (or direct CDP injection fallback) so active Antigravity
 *    windows immediately load the MCP Manager without restarting.
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildBundle } = require('./build');

const HOME_DIR = process.env.USERPROFILE || process.env.HOME || os.homedir();
const AGY_DIR = path.join(HOME_DIR, '.gemini', 'antigravity');
const TARGET_STANDALONE = path.join(AGY_DIR, 'mcp_manager_autoinject.js');
const TARGET_AUTOINJECT = path.join(AGY_DIR, 'statusbar_autoinject.js');
const TARGET_PATCHER = path.join(AGY_DIR, 'ensure_statusbar_patch.js');
const SRC_PATCHER = path.join(__dirname, 'ensure_statusbar_patch.js');

const MCP_BEGIN = '// === BEGIN_AGY_MCP_MANAGER_V1 ===';
const MCP_END = '// === END_AGY_MCP_MANAGER_V1 ===';
const KO_BEGIN = '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===';

function mergeMcpManagerBlock(existingContent, mcpBundleText) {
  const cleanMcp = mcpBundleText.replace(/\r\n/g, '\n').trim();
  const wrappedBlock = `${MCP_BEGIN}\n${cleanMcp}\n${MCP_END}`;

  let text = (existingContent || '').replace(/\r\n/g, '\n');

  // Remove any previous MCP_MANAGER block
  const bIdx = text.indexOf(MCP_BEGIN);
  const eIdx = text.indexOf(MCP_END);
  if (bIdx !== -1 && eIdx !== -1 && eIdx > bIdx) {
    text = (text.slice(0, bIdx).trimEnd() + '\n\n' + text.slice(eIdx + MCP_END.length).trimStart()).trim();
  }

  // Insert before KO_BEGIN if present so ko-thought-translator's baseCode preservation keeps MCP Manager too
  const koIdx = text.indexOf(KO_BEGIN);
  if (koIdx !== -1) {
    const beforeKo = text.slice(0, koIdx).trimEnd();
    const fromKo = text.slice(koIdx).trimStart();
    return `${beforeKo}\n\n${wrappedBlock}\n\n${fromKo}\n`;
  }

  if (!text.trim()) {
    return `${wrappedBlock}\n`;
  }
  return `${text.trimEnd()}\n\n${wrappedBlock}\n`;
}

function install() {
  const { bundle } = buildBundle();
  fs.mkdirSync(AGY_DIR, { recursive: true });
  fs.writeFileSync(TARGET_STANDALONE, bundle, 'utf8');

  const existing = fs.existsSync(TARGET_AUTOINJECT)
    ? fs.readFileSync(TARGET_AUTOINJECT, 'utf8')
    : '';
  const merged = mergeMcpManagerBlock(existing, bundle);
  fs.writeFileSync(TARGET_AUTOINJECT, merged, 'utf8');

  if (fs.existsSync(SRC_PATCHER)) {
    fs.copyFileSync(SRC_PATCHER, TARGET_PATCHER);
  }

  if (fs.existsSync(TARGET_PATCHER)) {
    const workerRes = spawnSync(process.execPath, [TARGET_PATCHER, '--worker'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const statusRes = spawnSync(process.execPath, [TARGET_PATCHER, '--status'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (statusRes.stdout) {
      process.stdout.write(statusRes.stdout);
    }
    return workerRes.status || 0;
  }

  process.stdout.write(`Installed MCP Manager bundle to ${TARGET_STANDALONE} and ${TARGET_AUTOINJECT}\n`);
  return 0;
}

if (require.main === module) {
  const code = install();
  process.exit(code);
}

module.exports = {
  MCP_BEGIN,
  MCP_END,
  mergeMcpManagerBlock,
  install,
};
