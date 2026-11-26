/**
 * AddonContextV3 Runtime Adapter (`src/adapters/antigravity/renderer/host-runtime.mjs`).
 *
 * SOLID Boundaries:
 * - SRP: Validates `AddonContextV3` (`apiVersion === 3`), branches strictly on abstract
 *   `ctx.env.surface` / `ctx.env.layoutMode` / `ctx.env.capabilities.hasConfigBridge` (zero
 *   `hostProfileId`, zero raw DOM scraping, zero `window.localStorage`), manages `ctx.storage`
 *   language persistence, and exposes a narrow capability facade to UI adapters.
 * - DIP: `mcp-v3-shell.mjs` and `native-mcp-panel.mjs` depend on this capability port rather
 *   than host internals.
 */

import { McpManagerService } from '../../../core/manager-service.mjs';
import { createHostBridgeConfigStore, resolveHostConfigBridge } from './host-config-store.mjs';
import { STORAGE_DRAFT_KEY, createStorageDraftConfigStore } from './storage-draft-config-store.mjs';

export const LANG_STORAGE_KEY = 'lang';

export function normalizeLangCode(raw) {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'ko' || val.startsWith('ko-') || val.startsWith('ko_')) return 'ko';
  if (val === 'en' || val.startsWith('en-') || val.startsWith('en_')) return 'en';
  return '';
}

export function assertAddonContextV3(ctx) {
  if (!ctx || typeof ctx !== 'object') {
    throw new Error('ERR_MISSING_ADDON_CONTEXT_V3');
  }
  if (ctx.apiVersion !== 3) {
    throw new Error(`ERR_UNSUPPORTED_ADDON_API_VERSION:${String(ctx.apiVersion)}`);
  }
  for (const ns of ['meta', 'env', 'ui', 'storage', 'i18n', 'theme', 'lifecycle']) {
    if (!ctx[ns] || typeof ctx[ns] !== 'object') {
      throw new Error(`ERR_INVALID_ADDON_CONTEXT_V3:${ns}`);
    }
  }
  for (const fn of ['openPanel', 'openModal', 'registerSettingsPage', 'registerStatusItem', 'registerCommand', 'showToast', 'confirm']) {
    if (typeof ctx.ui[fn] !== 'function') {
      throw new Error(`ERR_INVALID_ADDON_CONTEXT_V3:ui.${fn}`);
    }
  }
  for (const fn of ['get', 'set', 'onDidChange']) {
    if (typeof ctx.storage[fn] !== 'function') {
      throw new Error(`ERR_INVALID_ADDON_CONTEXT_V3:storage.${fn}`);
    }
  }
  if (typeof ctx.lifecycle.onDispose !== 'function') {
    throw new Error('ERR_INVALID_ADDON_CONTEXT_V3:lifecycle.onDispose');
  }
  return ctx;
}

export function createHostRuntime({ ctx, doc = typeof document !== 'undefined' ? document : null }) {
  const v3 = assertAddonContextV3(ctx);
  const pluginId = String(v3.meta.pluginId || 'antigravity-mcp-manager');
  const displayName = String(v3.meta.displayName || 'Antigravity MCP Manager');
  const version = String(v3.meta.version || '4.0.1');
  const trustLevel = String(v3.meta.trustLevel || 'restricted');
  const surface = v3.env.surface === 'remote-web' ? 'remote-web' : 'desktop';

  let savedLang = '';

  function detectDefaultLang() {
    try {
      const locale = typeof v3.i18n.getLocale === 'function' ? v3.i18n.getLocale() : 'en';
      return normalizeLangCode(locale) || 'en';
    } catch {
      return 'en';
    }
  }

  function readSavedLang() {
    return savedLang;
  }

  function resolveEffectiveLang() {
    if (savedLang === 'ko' || savedLang === 'en') return savedLang;
    return detectDefaultLang();
  }

  async function loadSavedLang() {
    try {
      const stored = await v3.storage.get(LANG_STORAGE_KEY);
      savedLang = normalizeLangCode(stored);
    } catch {
      // Ignore storage read errors; fall back to host locale
    }
    return resolveEffectiveLang();
  }

  function writeSavedLang(lang) {
    const norm = normalizeLangCode(lang);
    if (!norm) return false;
    savedLang = norm;
    try {
      Promise.resolve(v3.storage.set(LANG_STORAGE_KEY, norm)).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  function getSurface() {
    return surface;
  }

  function getLayoutMode() {
    return String(v3.env.layoutMode || 'desktop');
  }

  function hasConfigBridge() {
    return Boolean(resolveHostConfigBridge(v3));
  }

  function getConfigStoreMode() {
    return hasConfigBridge() ? 'host-bridge' : 'remote-draft';
  }

  function createConfigService() {
    if (hasConfigBridge()) {
      const configStore = createHostBridgeConfigStore(v3);
      return new McpManagerService({ configStore });
    }
    const configStore = createStorageDraftConfigStore(v3.storage, { key: STORAGE_DRAFT_KEY });
    return new McpManagerService({ configStore });
  }

  function createStyleElementSafe(cssText) {
    if (typeof v3.ui.createStyleElementSafe === 'function') {
      return v3.ui.createStyleElementSafe(cssText);
    }
    if (!doc || typeof doc.createElement !== 'function') return null;
    const styleEl = doc.createElement('style');
    styleEl.textContent = String(cssText || '');
    return styleEl;
  }

  function showToast(opts) {
    try {
      return v3.ui.showToast(opts);
    } catch {
      return { id: '', dismiss() {} };
    }
  }

  async function confirm(opts) {
    try {
      return Boolean(await v3.ui.confirm(opts));
    } catch {
      return true;
    }
  }

  function onStorageChange(cb) {
    if (typeof cb !== 'function') return () => {};
    return v3.storage.onDidChange((ev) => {
      if (ev && ev.key === LANG_STORAGE_KEY) {
        savedLang = normalizeLangCode(ev.newValue);
      }
      cb(ev);
    });
  }

  function onThemeChange(cb) {
    if (typeof cb !== 'function' || typeof v3.theme.onDidChange !== 'function') return () => {};
    return v3.theme.onDidChange(cb);
  }

  return Object.freeze({
    apiVersion: 3,
    pluginId,
    displayName,
    version,
    trustLevel,
    getSurface,
    getLayoutMode,
    hasConfigBridge,
    getConfigStoreMode,
    createConfigService,
    readSavedLang,
    loadSavedLang,
    writeSavedLang,
    resolveEffectiveLang,
    showToast,
    confirm,
    registerCommand: (commandId, spec) => v3.ui.registerCommand(commandId, spec),
    registerStatusItem: (spec) => v3.ui.registerStatusItem(spec),
    registerSettingsPage: (spec) => v3.ui.registerSettingsPage(spec),
    openPanel: (opts) => v3.ui.openPanel(opts),
    openModal: (opts) => v3.ui.openModal(opts),
    openPopup: (opts) => v3.ui.openPopup(opts),
    createStyleElementSafe,
    getThemeMode: () => (typeof v3.theme.getMode === 'function' ? v3.theme.getMode() : 'dark'),
    onThemeChange,
    onStorageChange,
    signal: v3.lifecycle.signal || null,
    onDispose: (fn) => v3.lifecycle.onDispose(fn),
    addManagedListener: (target, type, listener, opts) =>
      typeof v3.lifecycle.addManagedListener === 'function'
        ? v3.lifecycle.addManagedListener(target, type, listener, opts)
        : () => {},
    runSafe: (fn) => (typeof v3.lifecycle.runSafe === 'function' ? v3.lifecycle.runSafe(fn) : fn()),
  });
}
