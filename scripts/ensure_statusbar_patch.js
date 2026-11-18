#!/usr/bin/env node
'use strict';

/**
 * Repository CLI & Programmatic Entry Point delegating to `scripts/patcher-entry.js`.
 */

const patcherEntry = require('./patcher-entry');

if (require.main === module) {
  patcherEntry.runCli().then(
    ({ exitCode }) => {
      if (exitCode !== 0) process.exitCode = exitCode;
    },
    (err) => {
      process.stderr.write(`${err?.stack || err}\n`);
      process.exitCode = 1;
    }
  );
}

module.exports = patcherEntry;
