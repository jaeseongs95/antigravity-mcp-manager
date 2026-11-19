#!/usr/bin/env node
/**
 * Deterministic Cross-OS Recursive Test Runner (`scripts/run-tests.mjs`).
 * Discovers `test/**\/*.test.mjs` in sorted lexicographic order and runs `node --test`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const TEST_ROOT = path.join(ROOT_DIR, 'test');

export function collectTestFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      files.push(full);
    }
  }
  return files.sort();
}

export function runAllTests(extraArgs = process.argv.slice(2)) {
  const testFiles = collectTestFiles(TEST_ROOT);
  if (testFiles.length === 0) {
    process.stderr.write(`No *.test.mjs files found under ${TEST_ROOT}\n`);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runAllTests());
}
