#!/usr/bin/env node
/**
 * Zero-Dependency Deterministic Renderer Assembler (`scripts/build-renderer.mjs`).
 *
 * Assembles the modular SOLID renderer sources (`src/adapters/antigravity/renderer/*.mjs`)
 * into the single browser-executable `AddonManifest.v3` entry script
 * (`src/adapters/antigravity/addon-renderer.js`) executed by `antigravity-addons` v3.0.0+
 * (Desktop & Remote Web) inside `(function(addonHost){ ... })(__addonHandle)`.
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
  'storage-draft-config-store.mjs',
  'host-runtime.mjs',
  'native-mcp-panel.mjs',
  'addon-styles.mjs',
  'mcp-v3-shell.mjs',
]);

function stripModuleSyntax(sourceText) {
  const normalized = sourceText.replace(/\r\n/g, '\n');
  const withoutImports = normalized.replace(/^\s*import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*\n?/gm, '');
  const withoutReExports = withoutImports.replace(/^\s*export\s*\{[^}]*\};?\s*\n?/gm, '');
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
    ' * AUTO-GENERATED AddonManifest.v3 Renderer Entry (`src/adapters/antigravity/addon-renderer.js`).',
    ' * Source of truth: `src/adapters/antigravity/renderer/*.mjs` (run `npm run build:renderer`).',
    ' *',
    ' * Executed by `antigravity-addons` v3.0.0+ (Desktop & Remote Web) as',
    ' * `(function(addonHost){ ... })(__addonHandle)` with `AddonContextV3` (`apiVersion: 3`).',
    ' * ZERO unsafe DOM sinks, ZERO direct DOM scraping, 100% 3-Tier API-First.',
    ' */',
    '',
    '(function (addonHost) {',
    "  'use strict';",
    '',
    '  if (!addonHost || addonHost.apiVersion !== 3 || !addonHost.ui || !addonHost.storage || !addonHost.lifecycle) {',
    '    return;',
    '  }',
    '',
    sections.join('\n\n'),
    '',
    '  // --- composition root (AddonContextV3 API-First) ---',
    '  const doc = typeof document !== "undefined" ? document : null;',
    '  const win = typeof window !== "undefined" ? window : null;',
    '  const runtime = createHostRuntime({ ctx: addonHost, doc });',
    '  const shell = createMcpV3Shell({ runtime, doc, win });',
    '  shell.start();',
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
