#!/usr/bin/env node
/**
 * Zero-Dependency Deterministic Renderer Assembler (`scripts/build-renderer.mjs`).
 *
 * Assembles the modular SOLID renderer sources (`src/adapters/antigravity/renderer/*.mjs`)
 * into the single browser-executable `AddonManifest.v2` entry script
 * (`src/adapters/antigravity/addon-renderer.js`) executed by `antigravity-native-addon-host`
 * (`v2.0.0+`) inside `(function(addonHost){ ... })(__addonHandle)` in Isolated World `998`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const CORE_SRC_DIR = path.join(ROOT_DIR, 'src', 'core');
const RENDERER_SRC_DIR = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'renderer');
export const RENDERER_OUTPUT_PATH = path.join(ROOT_DIR, 'src', 'adapters', 'antigravity', 'addon-renderer.js');

export const CORE_MODULE_ORDER = Object.freeze([
  'model.mjs',
  'sha256.mjs',
  'ports.mjs',
  'secret-redactor.mjs',
  'collision-detector.mjs',
  'validator.mjs',
  'document-engine.mjs',
  'input-parser.mjs',
  'manager-service.mjs',
]);

export const MODULE_ORDER = Object.freeze([
  'host-config-store.mjs',
  'host-runtime.mjs',
  'native-mcp-panel.mjs',
  'addon-styles.mjs',
  'settings-sidebar-mount.mjs',
  'customizations-mount.mjs',
  'mount-coordinator.mjs',
]);

function stripModuleSyntax(sourceText) {
  const normalized = sourceText.replace(/\r\n/g, '\n');
  // Remove single-line and multi-line relative ESM imports between our internal modules
  const withoutImports = normalized.replace(/^\s*import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*\n?/gm, '');
  // Remove bare re-export blocks such as `export { isLegacySseUrl };`
  const withoutReExports = withoutImports.replace(/^\s*export\s*\{[^}]*\};?\s*\n?/gm, '');
  // Convert `export const|let|var|function|async function|class` to local declarations inside the IIFE
  return withoutReExports.replace(/^\s*export\s+(?=(?:const|let|var|async\s+function|function|class)\b)/gm, '').trim();
}

export function assembleRendererSource() {
  const formatSection = (label, fullPath) => {
    const raw = fs.readFileSync(fullPath, 'utf8');
    const body = stripModuleSyntax(raw);
    return `  // --- module: ${label} ---\n${body
      .split('\n')
      .map((line) => (line.length > 0 ? `  ${line}` : ''))
      .join('\n')}`;
  };

  const sections = [
    ...CORE_MODULE_ORDER.map((fileName) => formatSection(`core/${fileName}`, path.join(CORE_SRC_DIR, fileName))),
    ...MODULE_ORDER.map((fileName) => formatSection(fileName, path.join(RENDERER_SRC_DIR, fileName))),
  ];

  return [
    '/**',
    ' * AUTO-GENERATED AddonManifest.v2 Renderer Entry (`src/adapters/antigravity/addon-renderer.js`).',
    ' * Source of truth: `src/adapters/antigravity/renderer/*.mjs` (run `npm run build:renderer`).',
    ' *',
    ' * Executed by `antigravity-native-addon-host` v2.0.0+ in Isolated World `998` as',
    ' * `(function(addonHost){ ... })(__addonHandle)` under `trustLevel: "restricted"`.',
    ' * ZERO unsafe DOM sinks, ZERO direct `app.asar` hooks, 100% owner/Shadow DOM scoped APIs.',
    ' */',
    '',
    '(function (addonHost) {',
    "  'use strict';",
    '',
    '  if (!addonHost || typeof addonHost.mountSlot !== "function" || typeof addonHost.openModal !== "function") {',
    '    return;',
    '  }',
    '',
    sections.join('\n\n'),
    '',
    '  // --- composition root ---',
    '  const runtime = createHostRuntime({ addonHost, win: window, doc: document });',
    '  let coordinator = null;',
    '  const onLangChange = () => {',
    '    if (coordinator) coordinator.syncAllLabels();',
    '  };',
    '  coordinator = createMountCoordinator({',
    '    runtime,',
    '    adapters: [',
    '      createSettingsSidebarMount({ runtime, onLangChange, win: window, doc: document }),',
    '      createCustomizationsMount({ runtime, onLangChange, win: window, doc: document }),',
    '    ],',
    '    win: window,',
    '    doc: document,',
    '  });',
    '  coordinator.start();',
    '})(typeof addonHost !== "undefined" ? addonHost : undefined);',
    '',
  ].join('\n');
}

export function buildRendererFile() {
  const source = assembleRendererSource();
  fs.writeFileSync(RENDERER_OUTPUT_PATH, source, 'utf8');
  return { outputPath: RENDERER_OUTPUT_PATH, bytes: Buffer.byteLength(source, 'utf8') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildRendererFile();
  process.stdout.write(`Built ${path.relative(ROOT_DIR, result.outputPath)} (${result.bytes} bytes)\n`);
}
