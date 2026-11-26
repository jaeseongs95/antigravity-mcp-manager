#!/usr/bin/env node
/**
 * Zero-Dependency Modular Public HTTPS Userscript Builder (`scripts/build-userscript.mjs`).
 *
 * Emits `antigravity-addons` v3.0.0-compatible modular `@require` Userscript artifacts:
 * - `antigravity-mcp-manager.user.js`
 * - `antigravity-mcp-manager.meta.js`
 * - `build-manifest.json`
 *
 * Guarantees:
 * - Zero external npm dependencies (Node 22+ built-ins only) so 3-OS CI passes standalone.
 * - Matches `antigravity-addons v3.0.0` `addon-host --build-addon-userscript` contract
 *   (`schemaVersion: 3`, `apiVersion: 3`, Remote-Web-sanitized `permissions` stripping
 *   desktop-only `configBridge`/`localLoopback`, fail-closed `trustLevel: "restricted"`,
 *   `@require .../antigravity-remote-host.lib.js`, `@inject-into content`, `GM_*` grants).
 * - `--check` verifies syntax (`vm.Script`), zero unsafe DOM/eval sinks, renderer bundle parity,
 *   and byte-exact determinism across two independent temp builds.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { assembleRendererSource } from './build-renderer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DEFAULT_OUT_DIR = path.join(ROOT_DIR, 'dist', 'userscript');
export const DEFAULT_HOST_LIB_URL =
  'https://github.com/jaeseongs95/antigravity-addons/releases/latest/download/antigravity-remote-host.lib.js';
export const DEFAULT_UPDATE_BASE_URL =
  'https://github.com/jaeseongs95/antigravity-mcp-manager/releases/latest/download';
export const REMOTE_WEB_PROFILE = Object.freeze({
  id: 'antigravity-remote-web',
  displayName: 'Antigravity Remote Web',
  allowedOrigins: Object.freeze(['https://antigravity.google.com']),
});
export const USERSCRIPT_GRANTS = Object.freeze(['GM_getValue', 'GM_setValue', 'GM_deleteValue']);

const FORBIDDEN_SINK_PATTERNS = Object.freeze([
  /\.innerHTML\b/,
  /\.outerHTML\b/,
  /\.insertAdjacentHTML\b/,
  /\.setHTMLUnsafe\b/,
  /\.srcdoc\b/,
  /\bdocument\.(?:write|writeln)\s*\(/,
  /\.(?:createContextualFragment|parseFromString)\s*\(/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bnew\s+(?:Shared)?Worker\s*\(/,
]);

function toLf(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function sha256Hex(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

function normalizeHttpsUrl(rawUrl, errPrefix) {
  const value = String(rawUrl || '').trim();
  if (!value) throw new Error(`${errPrefix}:EMPTY`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${errPrefix}:${rawUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${errPrefix}_MUST_BE_HTTPS:${rawUrl}`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${errPrefix}_UNSAFE:${rawUrl}`);
  }
  return parsed.href.replace(/\/+$/, '');
}

function serializeSafeInlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function sanitizeRemotePermissions(rawPerms, finalTrustLevel) {
  if (!rawPerms || typeof rawPerms !== 'object') return null;
  const out = {};
  if (rawPerms.ui && typeof rawPerms.ui === 'object') out.ui = rawPerms.ui;
  if (rawPerms.storage && typeof rawPerms.storage === 'object') out.storage = rawPerms.storage;
  if (rawPerms.events && typeof rawPerms.events === 'object') out.events = rawPerms.events;
  if (rawPerms.services && typeof rawPerms.services === 'object') out.services = rawPerms.services;
  if (rawPerms.net && typeof rawPerms.net === 'object') {
    out.net = {
      httpsHosts: Array.isArray(rawPerms.net.httpsHosts) ? rawPerms.net.httpsHosts.slice() : [],
      localLoopback: [],
    };
  }
  if (rawPerms.dom && typeof rawPerms.dom === 'object') {
    out.dom = {
      anchors: Array.isArray(rawPerms.dom.anchors) ? rawPerms.dom.anchors.slice() : [],
      documentTransform: Boolean(rawPerms.dom.documentTransform && finalTrustLevel === 'trusted'),
    };
  }
  return out;
}

export function verifyUserscriptSafety(code) {
  const violations = [];
  const source = toLf(code);
  try {
    new vm.Script(source, { filename: 'antigravity-mcp-manager.user.js' });
  } catch (err) {
    violations.push(`SYNTAX_ERROR:${err?.message || String(err)}`);
  }
  const codeWithoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const rx of FORBIDDEN_SINK_PATTERNS) {
    if (rx.test(codeWithoutComments)) {
      violations.push(`FORBIDDEN_SINK:${rx}`);
    }
  }
  return { ok: violations.length === 0, violations };
}

export function buildUserscriptArtifacts({
  manifestPath = path.join(ROOT_DIR, 'addon-manifest.json'),
  pluginDir = ROOT_DIR,
  outDir = DEFAULT_OUT_DIR,
  hostLibUrl = DEFAULT_HOST_LIB_URL,
  updateBaseUrl = DEFAULT_UPDATE_BASE_URL,
  namespace = 'https://github.com/jaeseongs95/antigravity-addons',
} = {}) {
  const absManifest = path.resolve(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(absManifest, 'utf8'));
  if (manifest.schemaVersion !== 3) {
    throw new Error(`ERR_UNSUPPORTED_SCHEMA_VERSION:${manifest.schemaVersion}`);
  }
  const relRenderer = manifest.entry?.rendererScript;
  if (typeof relRenderer !== 'string' || !relRenderer) {
    throw new Error('ERR_MISSING_RENDERER_SCRIPT');
  }
  const resolvedPluginDir = path.resolve(pluginDir);
  const absRenderer = path.resolve(resolvedPluginDir, relRenderer);
  const relCheck = path.relative(resolvedPluginDir, absRenderer);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    throw new Error(`ERR_RENDERER_OUTSIDE_PLUGIN_DIR:${relRenderer}`);
  }

  const rendererBuf = fs.readFileSync(absRenderer);
  const rendererSha256 = sha256Hex(rendererBuf);
  const rendererSource = toLf(rendererBuf.toString('utf8'));

  const safeHostLibUrl = normalizeHttpsUrl(hostLibUrl, 'ERR_INVALID_HOST_LIB_URL');
  const safeUpdateBaseUrl = updateBaseUrl ? normalizeHttpsUrl(updateBaseUrl, 'ERR_INVALID_UPDATE_BASE_URL') : null;

  const pluginId = String(manifest.pluginId);
  const displayName = String(manifest.displayName || pluginId).replace(/[\r\n]+/g, ' ').trim();
  const version = String(manifest.version || '1.0.0').replace(/[\r\n]+/g, ' ').trim();
  const userscriptFile = `${pluginId}.user.js`;
  const metaFile = `${pluginId}.meta.js`;

  // Fail closed on unpinned public Userscript builds matching antigravity-addons v3.0.0 build-remote.js
  const finalTrustLevel = 'restricted';
  const remotePermissions = sanitizeRemotePermissions(manifest.permissions, finalTrustLevel);

  const pluginMeta = {
    schemaVersion: 3,
    apiVersion: 3,
    sourceSchemaVersion: 3,
    pluginId,
    displayName,
    version,
    trustLevel: finalTrustLevel,
    capabilities: ['renderer'],
    skippedCapabilities: (manifest.capabilities || []).filter((c) => c !== 'renderer'),
    hasDocumentTransformSlot: false,
    hasSettingsBridge: false,
    hasConfigBridge: false,
    configScopes: [],
    uiSlots: Array.isArray(manifest.uiSlots) ? manifest.uiSlots : [],
    isolation: manifest.isolation || {},
    ...(remotePermissions ? { permissions: remotePermissions } : {}),
  };

  const metaLines = [
    '// ==UserScript==',
    `// @name         ${displayName} (${REMOTE_WEB_PROFILE.displayName})`,
    `// @namespace    ${namespace}`,
    `// @version      ${version}`,
    `// @description  Modular AddonManifest.v3 Remote Web Userscript for ${displayName}`,
    ...REMOTE_WEB_PROFILE.allowedOrigins.map((origin) => `// @match        ${origin}/*`),
    '// @run-at       document-idle',
    '// @inject-into  content',
    `// @require      ${safeHostLibUrl}`,
    ...USERSCRIPT_GRANTS.map((grant) => `// @grant        ${grant}`),
  ];
  if (safeUpdateBaseUrl) {
    metaLines.push(`// @updateURL    ${safeUpdateBaseUrl}/${metaFile}`);
    metaLines.push(`// @downloadURL  ${safeUpdateBaseUrl}/${userscriptFile}`);
  }
  metaLines.push('// ==/UserScript==', '');
  const metaSource = metaLines.join('\n');

  const addonLiteral = `{
    pluginMeta: ${serializeSafeInlineJson(pluginMeta)},
    settingsSpec: null,
    initialSettingsSnapshot: null,
    rendererSha256: ${serializeSafeInlineJson(rendererSha256)},
    run: function(addonHost) {
      'use strict';
${rendererSource}
    }
  }`;

  const bodySource = `'use strict';
(function() {
  var rt = typeof globalThis !== 'undefined' ? globalThis.__addonHostRemoteRuntime : null;
  if (!rt || typeof rt.registerAddon !== 'function' || typeof rt.bootRemoteWebHost !== 'function') {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[addon-host-remote] @require host library missing for ${pluginId}');
    }
    return;
  }
  rt.registerAddon(${addonLiteral});
  Promise.resolve(rt.bootRemoteWebHost())
    .then(function(res) {
      if (res && res.ok === false && typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[addon-host-remote] boot skipped (${pluginId}):', res.reason || 'UNKNOWN', res.error || '');
      }
    })
    .catch(function(err) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[addon-host-remote] boot failed (${pluginId}):', err && err.message ? err.message : String(err));
      }
    });
})();
`;

  const userscriptSource = `${metaSource}${bodySource}`;
  const safety = verifyUserscriptSafety(userscriptSource);
  if (!safety.ok) {
    throw new Error(`ERR_USERSCRIPT_SAFETY_FAILED:${JSON.stringify(safety.violations)}`);
  }

  const targetDir = path.resolve(outDir);
  fs.mkdirSync(targetDir, { recursive: true });
  const userscriptPath = path.join(targetDir, userscriptFile);
  const metaPath = path.join(targetDir, metaFile);
  fs.writeFileSync(userscriptPath, userscriptSource, 'utf8');
  fs.writeFileSync(metaPath, metaSource, 'utf8');

  const fileNames = [metaFile, userscriptFile].sort();
  const fileHashes = {};
  const rootHasher = crypto.createHash('sha256');
  for (const name of fileNames) {
    const digest = sha256Hex(fs.readFileSync(path.join(targetDir, name)));
    fileHashes[name] = digest;
    rootHasher.update(`${name}\0${digest}\n`, 'utf8');
  }
  const buildSha256 = rootHasher.digest('hex');
  const buildSha8 = buildSha256.slice(0, 8);

  const buildManifest = {
    schemaVersion: 1,
    mode: 'modular-addon-userscript',
    profileId: REMOTE_WEB_PROFILE.id,
    pluginId,
    version,
    rendererSha256,
    hostLibUrl: safeHostLibUrl,
    updateBaseUrl: safeUpdateBaseUrl,
    connectHosts: [],
    grantXhr: false,
    buildSha8,
    buildSha256,
    userscriptFile,
    metaFile,
    files: fileHashes,
  };
  const buildManifestPath = path.join(targetDir, 'build-manifest.json');
  fs.writeFileSync(buildManifestPath, `${JSON.stringify(buildManifest, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    buildManifest,
    userscriptPath,
    metaPath,
    buildManifestPath,
  };
}

function parseCliArgs(argv) {
  const opts = {
    check: false,
    outDir: DEFAULT_OUT_DIR,
    hostLibUrl: DEFAULT_HOST_LIB_URL,
    updateBaseUrl: DEFAULT_UPDATE_BASE_URL,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      opts.check = true;
    } else if (arg === '--out-dir' && argv[i + 1]) {
      opts.outDir = argv[++i];
    } else if (arg === '--host-lib-url' && argv[i + 1]) {
      opts.hostLibUrl = argv[++i];
    } else if (arg === '--update-base-url' && argv[i + 1]) {
      opts.updateBaseUrl = argv[++i];
    }
  }
  return opts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseCliArgs(process.argv.slice(2));
  const actualRenderer = fs.readFileSync(path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'addon-renderer.js'), 'utf8');
  if (actualRenderer !== assembleRendererSource()) {
    process.stderr.write('addon-renderer.js is out of sync with renderer/*.mjs. Run `npm run build:renderer` first.\n');
    process.exit(1);
  }

  if (opts.check) {
    const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-us-a-'));
    const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-us-b-'));
    try {
      const a = buildUserscriptArtifacts({ outDir: tmpA, hostLibUrl: opts.hostLibUrl, updateBaseUrl: opts.updateBaseUrl });
      const b = buildUserscriptArtifacts({ outDir: tmpB, hostLibUrl: opts.hostLibUrl, updateBaseUrl: opts.updateBaseUrl });
      if (a.buildManifest.buildSha256 !== b.buildManifest.buildSha256) {
        process.stderr.write('Non-deterministic Userscript build detected.\n');
        process.exit(1);
      }
      process.stdout.write(
        `OK deterministic modular Userscript (${a.buildManifest.userscriptFile}, sha8=${a.buildManifest.buildSha8}, rendererSha256=${a.buildManifest.rendererSha256.slice(0, 12)}...)\n`
      );
    } finally {
      fs.rmSync(tmpA, { recursive: true, force: true });
      fs.rmSync(tmpB, { recursive: true, force: true });
    }
  } else {
    const res = buildUserscriptArtifacts({ outDir: opts.outDir, hostLibUrl: opts.hostLibUrl, updateBaseUrl: opts.updateBaseUrl });
    process.stdout.write(
      `Built ${path.relative(ROOT_DIR, res.userscriptPath)} & ${path.relative(ROOT_DIR, res.metaPath)} (sha8=${res.buildManifest.buildSha8})\n`
    );
  }
}
