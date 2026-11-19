/**
 * Host Capability Runtime Adapter (`src/adapters/antigravity/renderer/host-runtime.mjs`).
 *
 * SOLID Boundaries:
 * - SRP: Owns `addonHost` capability handle delegation, loopback URL validation,
 *   namespaced language storage (with 1-time migration from legacy v2.1 key),
 *   theme URL building, and origin/source-validated iframe `postMessage` checks.
 * - DIP: Renderer mount adapters depend on this narrow capability port rather than
 *   raw global `window.__ADDON_HOST_API__`, un-namespaced `localStorage`, or direct
 *   `<style>` DOM injection.
 */

export const SLOT_IDS = Object.freeze({
  SETTINGS_PANE: 'antigravity-mcp-manager.pane',
  SETTINGS_NAV: 'antigravity-mcp-manager.settings-nav',
  CUSTOMIZATIONS_BTN: 'antigravity-mcp-manager.customizations-btn',
  CUSTOMIZATIONS_OVERLAY: 'antigravity-mcp-manager.customizations-overlay',
});

export const FRAME_ATTR = 'data-agy-mcp-manager-frame';
export const LEGACY_LANG_STORAGE_KEY = 'agy-mcp-manager-lang';

export function isSafeLoopbackIframeUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && Boolean(parsed.port);
  } catch {
    return false;
  }
}

export function normalizedText(el) {
  return String(el?.textContent || '').trim().toLowerCase();
}

export function hasVisibleBg(el, win = window) {
  const bg = win.getComputedStyle(el)?.backgroundColor || '';
  return Boolean(bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent');
}

export function replaceLeafText(root, nextText, doc = document) {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let current = walker.nextNode();
  while (current) {
    if (current.nodeValue && current.nodeValue.trim()) {
      textNodes.push(current);
    }
    current = walker.nextNode();
  }
  if (textNodes.length > 0) {
    textNodes[0].nodeValue = nextText;
    for (let i = 1; i < textNodes.length; i += 1) {
      textNodes[i].nodeValue = '';
    }
  } else {
    root.textContent = nextText;
  }
}

export function sameFrameBaseAndTheme(currentSrc, nextSrc) {
  try {
    const a = new URL(currentSrc);
    const b = new URL(nextSrc);
    a.searchParams.delete('lang');
    b.searchParams.delete('lang');
    return a.toString() === b.toString();
  } catch {
    return currentSrc === nextSrc;
  }
}

export function assertAddonHostHandle(addonHost) {
  if (!addonHost || typeof addonHost !== 'object') {
    throw new Error('ERR_MISSING_ADDON_HOST_HANDLE');
  }
  for (const method of ['mountSlot', 'unmountSlot', 'injectStyle', 'removeStyle', 'onDispose']) {
    if (typeof addonHost[method] !== 'function') {
      throw new Error(`ERR_INVALID_ADDON_HOST_HANDLE:${method}`);
    }
  }
  return addonHost;
}

export function createHostRuntime({ addonHost, win = window, doc = document }) {
  const host = assertAddonHostHandle(addonHost);
  const pluginId = String(host.pluginId || 'antigravity-mcp-manager');
  const storageNamespace = String(host.storageNamespace || pluginId);
  const ipcChannelPrefix = host.ipcChannelPrefix ? String(host.ipcChannelPrefix) : 'mcp-manager:';
  const langStorageKey = `${storageNamespace}:lang`;

  function readSavedLang() {
    try {
      const storage = win.localStorage;
      if (!storage) return '';
      const namespaced = storage.getItem(langStorageKey);
      if (namespaced === 'ko' || namespaced === 'en') return namespaced;
      // One-time migration from legacy v2.1.0 un-namespaced key
      const legacy = storage.getItem(LEGACY_LANG_STORAGE_KEY);
      if (legacy === 'ko' || legacy === 'en') {
        try {
          storage.setItem(langStorageKey, legacy);
        } catch {
          // Ignore write errors during migration
        }
        return legacy;
      }
      return '';
    } catch {
      return '';
    }
  }

  function writeSavedLang(lang) {
    if (lang !== 'ko' && lang !== 'en') return false;
    try {
      win.localStorage?.setItem(langStorageKey, lang);
      return true;
    } catch {
      return false;
    }
  }

  function getServerUrl() {
    const raw = win.__AGY_MCP_MANAGER_URL__;
    return isSafeLoopbackIframeUrl(raw) ? raw : '';
  }

  function bindServerUrlListener(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = (nextUrl) => {
      callback(isSafeLoopbackIframeUrl(nextUrl) ? nextUrl : '');
    };
    win.__AGY_MCP_ON_SERVER_URL__ = handler;
    return () => {
      if (win.__AGY_MCP_ON_SERVER_URL__ === handler) {
        try {
          delete win.__AGY_MCP_ON_SERVER_URL__;
        } catch {
          win.__AGY_MCP_ON_SERVER_URL__ = undefined;
        }
      }
    };
  }

  function buildThemedIframeUrl(baseUrl, contentPane) {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('hostMode', 'settings');
      const savedLang = readSavedLang();
      if (savedLang) {
        url.searchParams.set('lang', savedLang);
      }
      const bodyCs = doc.body ? win.getComputedStyle(doc.body) : null;
      if (bodyCs?.fontFamily) {
        url.searchParams.set('hostFont', bodyCs.fontFamily);
      }
      if (bodyCs?.color) {
        url.searchParams.set('hostFg', bodyCs.color);
      }
      const paneBg = contentPane ? win.getComputedStyle(contentPane)?.backgroundColor : '';
      if (paneBg && paneBg !== 'rgba(0, 0, 0, 0)' && paneBg !== 'transparent') {
        url.searchParams.set('hostBg', paneBg);
      } else if (bodyCs?.backgroundColor && bodyCs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        url.searchParams.set('hostBg', bodyCs.backgroundColor);
      }
      return url.toString();
    } catch {
      return baseUrl;
    }
  }

  function isTrustedIframeMessage(ev, frames) {
    const baseUrl = getServerUrl();
    if (!baseUrl) return false;
    try {
      const expectedOrigin = new URL(baseUrl).origin;
      if (ev.origin !== expectedOrigin) return false;
    } catch {
      return false;
    }
    if (!Array.isArray(frames) || frames.length === 0) return false;
    return frames.some((frame) => frame && frame.contentWindow === ev.source);
  }

  return Object.freeze({
    pluginId,
    storageNamespace,
    ipcChannelPrefix,
    langStorageKey,
    readSavedLang,
    writeSavedLang,
    getServerUrl,
    bindServerUrlListener,
    buildThemedIframeUrl,
    isTrustedIframeMessage,
    mountSlot: (slotId, parentEl) => host.mountSlot(slotId, parentEl),
    unmountSlot: (slotId) => host.unmountSlot(slotId),
    injectStyle: (styleId, cssText) => host.injectStyle(styleId, cssText),
    removeStyle: (styleId) => host.removeStyle(styleId),
    onDispose: (fn) => host.onDispose(fn),
  });
}
