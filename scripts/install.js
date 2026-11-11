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

const MCP_BEGIN_RE = /^(?:\/\/ === BEGIN_AGY_MCP_MANAGER(?:_V1)? ===|\/\* === BEGIN_AGY_MCP_MANAGER(?:_V1)? === \*\/)[ \t]*$/gm;
const MCP_END_RE = /^(?:\/\/ === END_AGY_MCP_MANAGER(?:_V1)? ===|\/\* === END_AGY_MCP_MANAGER(?:_V1)? === \*\/)[ \t]*$/gm;
const KO_BEGIN_RE = /^(?:\/\/ === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 ===|\/\* === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V2 === \*\/)[ \t]*$/gm;

function findAnchoredSpan(text, beginRe, endRe) {
  beginRe.lastIndex = 0;
  const bMatch = beginRe.exec(text);
  if (!bMatch) return null;
  const start = bMatch.index;
  endRe.lastIndex = bMatch.index + bMatch[0].length;
  const eMatch = endRe.exec(text);
  if (!eMatch) return null;
  let end = eMatch.index + eMatch[0].length;
  while (true) {
    const after = text.slice(end);
    const nl = /^\n+/.exec(after);
    if (!nl) break;
    const nextIdx = end + nl[0].length;
    endRe.lastIndex = nextIdx;
    const nextEnd = endRe.exec(text);
    if (nextEnd && nextEnd.index === nextIdx) {
      end = nextEnd.index + nextEnd[0].length;
    } else {
      break;
    }
  }
  return { start, end };
}

function mergeMcpManagerBlock(existingContent, mcpBundleText) {
  const cleanMcp = mcpBundleText.replace(/\r\n/g, '\n').trim();
  const wrappedBlock = `${MCP_BEGIN}\n${cleanMcp}\n${MCP_END}`;

  let text = (existingContent || '').replace(/\r\n/g, '\n');

  // Remove any previous column-0 anchored MCP_MANAGER block(s)
  let mcpSpan = findAnchoredSpan(text, MCP_BEGIN_RE, MCP_END_RE);
  while (mcpSpan) {
    const before = text.slice(0, mcpSpan.start).trimEnd();
    const after = text.slice(mcpSpan.end).trimStart();
    text = before && after ? `${before}\n\n${after}` : (before || after);
    mcpSpan = findAnchoredSpan(text, MCP_BEGIN_RE, MCP_END_RE);
  }

  // Insert before column-0 anchored KO_BEGIN if present so ko-thought-translator's baseCode preservation keeps MCP Manager too
  KO_BEGIN_RE.lastIndex = 0;
  const koMatch = KO_BEGIN_RE.exec(text);
  if (koMatch) {
    const beforeKo = text.slice(0, koMatch.index).trimEnd();
    const fromKo = text.slice(koMatch.index).trimStart();
    if (!beforeKo) {
      return `${wrappedBlock}\n\n${fromKo}\n`;
    }
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
    if (workerRes.stderr) {
      process.stderr.write(workerRes.stderr);
    }
    if (workerRes.error) {
      process.stderr.write(String(workerRes.error.message || workerRes.error) + '\n');
    }
    const statusRes = spawnSync(process.execPath, [TARGET_PATCHER, '--status'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (statusRes.stdout) {
      process.stdout.write(statusRes.stdout);
    }
    if (statusRes.stderr) {
      process.stderr.write(statusRes.stderr);
    }
    return typeof workerRes.status === 'number' ? workerRes.status : 1;
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
