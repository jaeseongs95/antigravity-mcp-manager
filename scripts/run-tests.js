#!/usr/bin/env node
'use strict';

/**
 * Deterministic Cross-OS Recursive Test Runner (`scripts/run-tests.js`).
 *
 * Avoids shell glob quoting differences across Node 20.x on Linux, Windows, and macOS
 * by discovering `test/**\/*.test.js` directly in sorted lexicographic order and invoking
 * `process.execPath` with `--test`.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const TEST_ROOT = path.join(ROOT_DIR, 'test');

function collectTestFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function runAllTests(extraArgs = process.argv.slice(2)) {
  const testFiles = collectTestFiles(TEST_ROOT);
  if (testFiles.length === 0) {
    process.stderr.write(`No *.test.js files found under ${TEST_ROOT}\n`);
    return 1;
  }

  const res = spawnSync(process.execPath, ['--test', ...extraArgs, ...testFiles], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
  });

  if (res.error) {
    process.stderr.write(`${res.error.stack || res.error}\n`);
    return 1;
  }
  return typeof res.status === 'number' ? res.status : 1;
}

if (require.main === module) {
  process.exit(runAllTests());
}

module.exports = {
  collectTestFiles,
  runAllTests,
};
