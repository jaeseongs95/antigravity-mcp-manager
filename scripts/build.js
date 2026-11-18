#!/usr/bin/env node
'use strict';

/**
 * Dual Zero-Dependency Bundler (`scripts/build.js`):
 * 1. `dist/mcp_manager_autoinject.js` — Single-file browser/Electron/bookmarklet runtime bundle
 *    with strict completeness check across all `src/**\/*.js` modules.
 * 2. `dist/ensure_statusbar_patch.js` — Standalone zero-external-file Node CLI & library bundle
 *    preserving `require.main === module` semantics (`5095348c-F1`) for `~/.gemini/antigravity/`.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripCommentsAndEmptyLines } = require('./lib/js-lexer');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const OUT_FILE = path.join(DIST_DIR, 'mcp_manager_autoinject.js');
const PATCHER_OUT_FILE = path.join(DIST_DIR, 'ensure_statusbar_patch.js');

const MODULE_ORDER = [
  'core/disposable.js',
  'core/sha256.js',
  'core/async-mutex.js',
  'core/ports.js',
  'core/security/url-policy.js',
  'core/schema/jsonc-codec.js',
  'core/schema/presets.js',
  'core/schema/auth-codec.js',
  'core/schema/server-spec.js',
  'core/schema/smart-parser.js',
  'core/mcp-manager-service.js',
  'security/trusted-types.js',
  'shared/marker-manifest.js',
  'shared/dom-disposables.js',
  'ui/design-tokens-styles.js',
  'ui/dom-kit.js',
  'ui/views/quick-add-bar.js',
  'ui/views/server-card-list.js',
  'ui/views/server-editor-form.js',
  'ui/views/oauth-connect-dialog.js',
  'ui/views/raw-json-editor.js',
  'ui/modal-controller.js',
  'adapters/antigravity/host-config.js',
  'adapters/antigravity/react-fiber-gateway.js',
  'adapters/antigravity/remote-control-lease.js',
  'adapters/antigravity/rpc-transport.js',
  'adapters/antigravity/antigravity-ports-adapter.js',
  'adapters/antigravity/companion-coordinator.js',
  'adapters/antigravity/native-dom-integrator.js',
  'adapters/antigravity/remote-workbench/child-asset-adapter.js',
  'adapters/antigravity/remote-workbench/cdn-worker-bridge.js',
  'adapters/antigravity/remote-workbench/frame-promoter-fsm.js',
  'index.js',
];

const PATCHER_MODULE_ORDER = [
  'src/shared/marker-manifest.js',
  'scripts/lib/js-lexer.js',
  'scripts/lib/file-lock.js',
  'scripts/lib/asar-patcher.js',
  'scripts/lib/rfc6455-ws.js',
  'scripts/lib/cdp-injector.js',
  'scripts/patcher-entry.js',
];

function collectSrcJsFiles(dir, prefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const isDir = typeof entry === 'object' && entry !== null ? entry.isDirectory() : false;
    const name = typeof entry === 'object' && entry !== null ? entry.name : String(entry);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (isDir) {
      files.push(...collectSrcJsFiles(path.join(dir, name), rel));
    } else if (name.endsWith('.js')) {
      files.push(rel);
    }
  }
  return files.sort();
}

function normalizeId(relPath) {
  return `./${relPath.replace(/\\/g, '/').replace(/\.js$/, '')}`;
}

function stripShebang(source) {
  return String(source || '').replace(/^#![^\n]*\n/, '');
}

/**
 * Builds `dist/mcp_manager_autoinject.js`.
 *
 * @param {{ write?: boolean, verifySrcCompleteness?: boolean }} [options]
 */
function buildBundle(options = {}) {
  const write = options.write !== false;
  const verifySrcCompleteness = options.verifySrcCompleteness !== false;

  if (verifySrcCompleteness && typeof fs.readdirSync === 'function') {
    const discovered = collectSrcJsFiles(SRC_DIR);
    const orderedSet = new Set(MODULE_ORDER);
    const missing = discovered.filter((f) => !orderedSet.has(f));
    if (missing.length > 0) {
      throw new Error(`MODULE_ORDER is missing src/**/*.js file(s): ${missing.join(', ')}`);
    }
  }

  const modulesCode = [];
  for (let i = 0; i < MODULE_ORDER.length; i += 1) {
    const rel = MODULE_ORDER[i];
    const abs = path.join(SRC_DIR, rel);
    const id = normalizeId(rel);
    const dir = path.posix.dirname(id);
    const source = stripShebang(fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'));

    modulesCode.push(
      `  ${JSON.stringify(id)}: function(module, exports, __require) {\n` +
        `    const require = (spec) => __require(${JSON.stringify(dir)}, spec);\n` +
        stripCommentsAndEmptyLines(source) +
        `\n  }`
    );
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const pkgVersion = pkg.version || '2.0.0';

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

/**
 * Builds standalone `dist/ensure_statusbar_patch.js` (`5095348c-F1`).
 *
 * When executed directly via `node dist/ensure_statusbar_patch.js`, `localRequire.main`
 * equals the synthetic `entryModule` so `require.main === module` is `true` inside
 * `patcher-entry.js`. When imported via `require('./dist/ensure_statusbar_patch.js')`,
 * `localRequire.main` points to the outer `require.main` so CLI does NOT auto-run.
 *
 * @param {{ write?: boolean }} [options]
 */
function buildPatcherBundle(options = {}) {
  const write = options.write !== false;
  const modulesCode = [];

  for (let i = 0; i < PATCHER_MODULE_ORDER.length; i += 1) {
    const rel = PATCHER_MODULE_ORDER[i];
    const abs = path.join(ROOT_DIR, rel);
    const id = normalizeId(rel);
    const dir = path.posix.dirname(id);
    const source = stripShebang(fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'));

    modulesCode.push(
      `  ${JSON.stringify(id)}: function(module, exports, require) {\n` +
        stripCommentsAndEmptyLines(source) +
        `\n  }`
    );
  }

  const entryId = './scripts/patcher-entry';
  const bundle =
    `#!/usr/bin/env node\n` +
    `'use strict';\n` +
    `((outerModule, outerRequire) => {\n` +
    `  const __modules = {\n` +
    modulesCode.join(',\n') +
    `\n  };\n` +
    `  const __cache = {};\n` +
    `  const __entryModule = { exports: {} };\n` +
    `  const __localMain = outerRequire.main === outerModule ? __entryModule : outerRequire.main;\n` +
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
    `  function __makeScopedRequire(baseDir) {\n` +
    `    const localRequire = (spec) => {\n` +
    `      if (!spec.startsWith('.')) return outerRequire(spec);\n` +
    `      return __loadModule(__resolve(baseDir, spec));\n` +
    `    };\n` +
    `    localRequire.main = __localMain;\n` +
    `    return localRequire;\n` +
    `  }\n` +
    `  function __loadModule(id) {\n` +
    `    if (__cache[id]) return __cache[id].exports;\n` +
    `    const fn = __modules[id];\n` +
    `    if (!fn) throw new Error('Patcher module not found: ' + id);\n` +
    `    const mod = id === ${JSON.stringify(entryId)} ? __entryModule : { exports: {} };\n` +
    `    __cache[id] = mod;\n` +
    `    const lastSlash = id.lastIndexOf('/');\n` +
    `    const dir = lastSlash > 0 ? id.slice(0, lastSlash) : '.';\n` +
    `    fn(mod, mod.exports, __makeScopedRequire(dir));\n` +
    `    return mod.exports;\n` +
    `  }\n` +
    `  outerModule.exports = __loadModule(${JSON.stringify(entryId)});\n` +
    `})(module, require);\n`;

  new vm.Script(stripShebang(bundle), { filename: 'ensure_statusbar_patch.js' });

  if (write) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
    fs.writeFileSync(PATCHER_OUT_FILE, bundle, 'utf8');
  }
  return { outFile: PATCHER_OUT_FILE, size: Buffer.byteLength(bundle, 'utf8'), bundle };
}

function buildAllBundles(options = {}) {
  const runtime = buildBundle(options);
  const patcher = buildPatcherBundle(options);
  return { runtime, patcher };
}

if (require.main === module) {
  const { runtime, patcher } = buildAllBundles();
  process.stdout.write(
    `Built ${runtime.outFile} (${runtime.size} bytes)\n` +
      `Built ${patcher.outFile} (${patcher.size} bytes)\n`
  );
}

module.exports = {
  OUT_FILE,
  PATCHER_OUT_FILE,
  MODULE_ORDER,
  PATCHER_MODULE_ORDER,
  collectSrcJsFiles,
  stripCommentsAndEmptyLines,
  buildBundle,
  buildPatcherBundle,
  buildAllBundles,
};
