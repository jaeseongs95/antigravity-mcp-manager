#!/usr/bin/env node
'use strict';

/**
 * Zero-dependency bundler that assembles the modular CommonJS sources in `src/`
 * into a single self-contained runtime script (`dist/mcp_manager_autoinject.js`)
 * suitable for Electron `webFrame.executeJavaScript`, CDP `Runtime.evaluate`,
 * and chaining into `~/.gemini/antigravity/statusbar_autoinject.js`.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const OUT_FILE = path.join(DIST_DIR, 'mcp_manager_autoinject.js');

const MODULE_ORDER = [
  'mcp-config-schema.js',
  'host-mcp-bridge.js',
  'modal-ui.js',
  'index.js',
];

function normalizeId(relPath) {
  return './' + relPath.replace(/\\/g, '/').replace(/\.js$/, '');
}

function buildBundle(options = {}) {
  const write = options.write !== false;
  const modulesCode = [];

  for (const rel of MODULE_ORDER) {
    const abs = path.join(SRC_DIR, rel);
    const id = normalizeId(rel);
    const dir = path.posix.dirname(id);
    const source = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');

    modulesCode.push(
      `  ${JSON.stringify(id)}: function(module, exports, __require) {\n` +
      `    const require = (spec) => __require(${JSON.stringify(dir)}, spec);\n` +
      source.split('\n').map((line) => (line ? `    ${line}` : '')).join('\n') +
      `\n  }`
    );
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const pkgVersion = pkg.version || '1.4.3';

  const header =
    `// ==UserScript==\n` +
    `// @name         Antigravity Custom MCP Server Manager\n` +
    `// @namespace    https://github.com/jaeseongs95/antigravity-mcp-manager\n` +
    `// @version      ${pkgVersion}\n` +
    `// @description  Add, edit, toggle, and manage custom Stdio & HTTP MCP servers (mcp_config.json) directly inside the Antigravity 2.0 native app and Remote Control web.\n` +
    `// @match        https://antigravity.google.com/*\n` +
    `// @match        https://*.antigravity.google.com/*\n` +
    `// @match        https://127.0.0.1/*\n` +
    `// @grant        none\n` +
    `// @run-at       document-idle\n` +
    `// ==/UserScript==\n`;

  const bundle =
    header +
    `(() => {\n` +
    `  'use strict';\n` +
    `  const __modules = {\n` +
    modulesCode.join(',\n') +
    `\n  };\n` +
    `  const __cache = {};\n` +
    `  function __resolve(baseDir, spec) {\n` +
    `    const cleanSpec = spec.replace(/\\.js$/, '');\n` +
    `    const parts = (baseDir + '/' + cleanSpec).split('/');\n` +
    `    const out = [];\n` +
    `    for (const p of parts) {\n` +
    `      if (!p || p === '.') continue;\n` +
    `      if (p === '..') out.pop();\n` +
    `      else out.push(p);\n` +
    `    }\n` +
    `    return './' + out.join('/');\n` +
    `  }\n` +
    `  function __require(baseDir, spec) {\n` +
    `    const id = __resolve(baseDir, spec);\n` +
    `    if (__cache[id]) return __cache[id].exports;\n` +
    `    const fn = __modules[id];\n` +
    `    if (!fn) throw new Error('Module not found: ' + id);\n` +
    `    const module = { exports: {} };\n` +
    `    __cache[id] = module;\n` +
    `    fn(module, module.exports, __require);\n` +
    `    return module.exports;\n` +
    `  }\n` +
    `  __require('.', './index');\n` +
    `})();\n`;

  new vm.Script(bundle, { filename: 'mcp_manager_autoinject.js' });

  if (write) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, bundle, 'utf8');
  }
  return { outFile: OUT_FILE, size: Buffer.byteLength(bundle, 'utf8'), bundle };
}

if (require.main === module) {
  const { outFile, size } = buildBundle();
  process.stdout.write(`Built ${outFile} (${size} bytes)\n`);
}

module.exports = { buildBundle, OUT_FILE, MODULE_ORDER };
