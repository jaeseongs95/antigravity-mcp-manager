/**
 * Host Capability Runtime Adapter (`src/adapters/antigravity/renderer/host-runtime.mjs`).
 *
 * SOLID Boundaries:
 * - SRP: Owns `AddonManifest.v2` `addonHost` capability handle delegation (Shadow DOM
 *   Option B2 `mountSlot({ container })`, `openModal`, slot-scoped `injectStyle`,
 *   `addManagedListener`), loopback URL validation, namespaced language storage (with
 *   1-time migration from legacy v2.1 key), theme URL building, origin/source-validated
 *   iframe `postMessage` checks, and the zero-`innerHTML` EN/KO Native Sidecar launcher view.
 * - DIP: Renderer mount adapters depend on this narrow capability port rather than
 *   raw global `window.__ADDON_HOST_API__`, un-namespaced `localStorage`, or direct
 *   `<style>` DOM injection.
 */

import { McpManagerService } from '../../../core/manager-service.mjs';
import { createHostBridgeConfigStore, resolveHostConfigBridge } from './host-config-store.mjs';

export const SLOT_IDS = Object.freeze({
  SETTINGS_PANE: 'antigravity-mcp-manager.pane',
  SETTINGS_NAV: 'antigravity-mcp-manager.settings-nav',
  CUSTOMIZATIONS_BTN: 'antigravity-mcp-manager.customizations-btn',
  CUSTOMIZATIONS_OVERLAY: 'antigravity-mcp-manager.customizations-overlay',
});

export const FRAME_ATTR = 'data-agy-mcp-manager-frame';
export const LAUNCHER_ATTR = 'data-agy-mcp-sidecar-launcher';
export const LEGACY_LANG_STORAGE_KEY = 'agy-mcp-manager-lang';

const KO_HOST_UI_MARKERS = Object.freeze(
  new Set([
    'mcp 서버',
    '설정',
    '일반',
    '브라우저',
    '애플리케이션',
    '단축키',
    '알림',
    '모델',
    '사용자 정의',
    '맞춤 설정',
    '커스터마이징',
  ])
);
const EN_HOST_UI_MARKERS = Object.freeze(
  new Set([
    'mcp servers',
    'settings',
    'general',
    'browser',
    'application',
    'shortcuts',
    'notifications',
    'models',
    'customizations',
  ])
);

const LAUNCHER_COPY = Object.freeze({
  en: Object.freeze({
    title: 'MCP Manager',
    badge: 'AddonManifest.v2 · Restricted',
    status: 'Awaiting Host Config Bridge',
    lead: 'Running in Antigravity Native Addon Host v2+ Shadow DOM isolation (AUX_PANE sidecar removed). Direct editing inside Settings & Customizations popup activates automatically once the host exposes Named-Scope Config Bridge or loopback URL.',
    stepsHeading: 'How this panel connects',
    steps: Object.freeze([
      'All MCP edits target ~/.gemini/config/mcp_config.json atomically with CAS conflict guards and secret redaction.',
      'Upgrade antigravity-native-addon-host to a version supporting Named-Scope Config Bridge (Option A) for direct in-Settings & popup management.',
      'This view switches automatically to the live MCP Manager UI as soon as the host bridge or loopback URL is provided.',
    ]),
    configLabel: 'Config File',
    configPath: '~/.gemini/config/mcp_config.json',
    surfaceSettings: 'Settings Integration',
    surfaceCustomizations: 'Customizations Popup',
  }),
  ko: Object.freeze({
    title: 'MCP 매니저',
    badge: 'AddonManifest.v2 · Restricted',
    status: '호스트 설정 브리지 대기 중',
    lead: 'Antigravity Native Addon Host v2+ Shadow DOM 격리 모드로 실행 중입니다(AUX_PANE 사이드카 제거 완료). 호스트가 Named-Scope Config Bridge 또는 loopback URL을 제공하면 설정 화면과 Customizations 팝업에서 즉시 실시간 편집이 활성화됩니다.',
    stepsHeading: '연동 안내',
    steps: Object.freeze([
      '모든 MCP 설정 변경은 CAS 충돌 방지 및 시크릿 마스킹과 함께 ~/.gemini/config/mcp_config.json에 원자적으로 저장됩니다.',
      '설정 화면과 팝업에서 바로 편집하려면 Named-Scope Config Bridge(안 A)를 지원하는 antigravity-native-addon-host 버전을 적용하세요.',
      '호스트 브리지 또는 loopback URL이 연결되면 이 화면이 자동으로 실제 MCP 매니저 UI로 전환됩니다.',
    ]),
    configLabel: '설정 파일',
    configPath: '~/.gemini/config/mcp_config.json',
    surfaceSettings: 'Settings 통합',
    surfaceCustomizations: 'Customizations 팝업',
  }),
});

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

export function detectHostLang(doc = document) {
  try {
    if (doc && typeof doc.querySelectorAll === 'function') {
      const nodes = doc.querySelectorAll('h1, h2, h3, h4, button, span, div, a, li');
      let hasEnMarker = false;
      for (const el of nodes) {
        if (!el || (el.children && el.children.length > 2)) continue;
        if (
          typeof el.closest === 'function' &&
          (el.closest('[data-addon-host-owner="antigravity-mcp-manager"]') ||
            el.closest('[data-agy-mcp-manager-nav="true"]'))
        ) {
          continue;
        }
        const txt = normalizedText(el);
        if (!txt || txt.length > 32) continue;
        const baseTxt = txt.replace(/[\s(]*\d+[\s)]*$/, '').trim();
        if (KO_HOST_UI_MARKERS.has(baseTxt)) return 'ko';
        if (EN_HOST_UI_MARKERS.has(baseTxt)) hasEnMarker = true;
      }
      if (hasEnMarker) return 'en';
    }
    const docLang = String(doc?.documentElement?.lang || '').trim().toLowerCase();
    if (docLang === 'ko' || docLang.startsWith('ko-')) return 'ko';
  } catch {
    // Fall back safely to English if host DOM is unavailable
  }
  return 'en';
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

export function getSlotHostElement(rootEl) {
  if (!rootEl) return null;
  const root = typeof rootEl.getRootNode === 'function' ? rootEl.getRootNode() : null;
  return root && root.host ? root.host : rootEl;
}

export function assertAddonHostHandle(addonHost) {
  if (!addonHost || typeof addonHost !== 'object') {
    throw new Error('ERR_MISSING_ADDON_HOST_HANDLE');
  }
  for (const method of ['mountSlot', 'unmountSlot', 'injectStyle', 'removeStyle', 'openModal', 'onDispose']) {
    if (typeof addonHost[method] !== 'function') {
      throw new Error(`ERR_INVALID_ADDON_HOST_HANDLE:${method}`);
    }
  }
  return addonHost;
}

export function createSidecarLauncherView({ runtime, surface = 'settings', onLangChange = () => {}, doc = document }) {
  const container = doc.createElement('section');
  container.setAttribute(LAUNCHER_ATTR, 'true');
  container.setAttribute('data-agy-mcp-surface', surface);

  const card = doc.createElement('div');
  card.setAttribute('data-agy-mcp-launcher-card', 'true');

  const header = doc.createElement('header');
  header.setAttribute('data-agy-mcp-launcher-header', 'true');

  const titleWrap = doc.createElement('div');
  titleWrap.setAttribute('data-agy-mcp-launcher-title-wrap', 'true');

  const titleEl = doc.createElement('h2');
  titleEl.setAttribute('data-agy-mcp-launcher-title', 'true');

  const badgeEl = doc.createElement('span');
  badgeEl.setAttribute('data-agy-mcp-launcher-badge', 'true');

  titleWrap.appendChild(titleEl);
  titleWrap.appendChild(badgeEl);

  const langGroup = doc.createElement('div');
  langGroup.setAttribute('data-agy-mcp-lang-switch', 'true');
  langGroup.setAttribute('role', 'group');
  langGroup.setAttribute('aria-label', 'Language');

  const enBtn = doc.createElement('button');
  enBtn.type = 'button';
  enBtn.setAttribute('data-agy-mcp-lang-btn', 'en');
  enBtn.textContent = 'EN';

  const koBtn = doc.createElement('button');
  koBtn.type = 'button';
  koBtn.setAttribute('data-agy-mcp-lang-btn', 'ko');
  koBtn.textContent = '한국어';

  const handleLangClick = (lang) => (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    runtime.writeSavedLang(lang);
    syncLang();
    onLangChange(lang);
  };
  enBtn.addEventListener('click', handleLangClick('en'));
  koBtn.addEventListener('click', handleLangClick('ko'));

  langGroup.appendChild(enBtn);
  langGroup.appendChild(koBtn);

  header.appendChild(titleWrap);
  header.appendChild(langGroup);

  const metaRow = doc.createElement('div');
  metaRow.setAttribute('data-agy-mcp-launcher-meta', 'true');

  const statusPill = doc.createElement('span');
  statusPill.setAttribute('data-agy-mcp-launcher-status', 'true');

  const surfaceTag = doc.createElement('span');
  surfaceTag.setAttribute('data-agy-mcp-launcher-surface', 'true');

  metaRow.appendChild(statusPill);
  metaRow.appendChild(surfaceTag);

  const leadEl = doc.createElement('p');
  leadEl.setAttribute('data-agy-mcp-launcher-lead', 'true');

  const stepsTitle = doc.createElement('h3');
  stepsTitle.setAttribute('data-agy-mcp-launcher-steps-title', 'true');

  const stepsList = doc.createElement('ol');
  stepsList.setAttribute('data-agy-mcp-launcher-steps', 'true');
  const stepItems = [doc.createElement('li'), doc.createElement('li'), doc.createElement('li')];
  for (const li of stepItems) {
    stepsList.appendChild(li);
  }

  const footer = doc.createElement('div');
  footer.setAttribute('data-agy-mcp-launcher-footer', 'true');

  const configLabelEl = doc.createElement('span');
  configLabelEl.setAttribute('data-agy-mcp-launcher-config-label', 'true');

  const configPathEl = doc.createElement('code');
  configPathEl.setAttribute('data-agy-mcp-launcher-config-path', 'true');

  footer.appendChild(configLabelEl);
  footer.appendChild(configPathEl);

  card.appendChild(header);
  card.appendChild(metaRow);
  card.appendChild(leadEl);
  card.appendChild(stepsTitle);
  card.appendChild(stepsList);
  card.appendChild(footer);
  container.appendChild(card);

  function syncLang() {
    const lang = (typeof runtime.resolveEffectiveLang === 'function' ? runtime.resolveEffectiveLang() : runtime.readSavedLang()) === 'ko' ? 'ko' : 'en';
    const copy = LAUNCHER_COPY[lang];
    container.setAttribute('data-agy-mcp-lang', lang);
    titleEl.textContent = copy.title;
    badgeEl.textContent = copy.badge;
    statusPill.textContent = copy.status;
    surfaceTag.textContent = surface === 'customizations' ? copy.surfaceCustomizations : copy.surfaceSettings;
    leadEl.textContent = copy.lead;
    stepsTitle.textContent = copy.stepsHeading;
    for (let i = 0; i < stepItems.length; i += 1) {
      stepItems[i].textContent = copy.steps[i] || '';
    }
    configLabelEl.textContent = copy.configLabel;
    configPathEl.textContent = copy.configPath;
    enBtn.setAttribute('aria-pressed', lang === 'en' ? 'true' : 'false');
    koBtn.setAttribute('aria-pressed', lang === 'ko' ? 'true' : 'false');
  }

  syncLang();

  return Object.freeze({
    element: container,
    syncLang,
  });
}

export function createHostRuntime({ addonHost, win = window, doc = document }) {
  const host = assertAddonHostHandle(addonHost);
  const pluginId = String(host.pluginId || 'antigravity-mcp-manager');
  const trustLevel = String(host.trustLevel || 'restricted');
  const schemaVersion = Number(host.schemaVersion || 2);
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

  function resolveEffectiveLang() {
    const saved = readSavedLang();
    if (saved === 'ko' || saved === 'en') return saved;
    return detectHostLang(doc);
  }

  function hasConfigBridge() {
    return Boolean(resolveHostConfigBridge(host));
  }

  function createConfigService() {
    const bridge = resolveHostConfigBridge(host);
    if (!bridge) return null;
    const configStore = createHostBridgeConfigStore(bridge);
    return new McpManagerService({ configStore });
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
      const effectiveLang = resolveEffectiveLang();
      if (effectiveLang) {
        url.searchParams.set('lang', effectiveLang);
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

  function mountSlot(slotId, containerOrOpts) {
    const opts =
      containerOrOpts && typeof containerOrOpts === 'object' && containerOrOpts.nodeType === 1
        ? { container: containerOrOpts }
        : containerOrOpts || {};
    return host.mountSlot(slotId, opts);
  }

  function injectStyle(styleId, cssText, opts) {
    return opts ? host.injectStyle(styleId, cssText, opts) : host.injectStyle(styleId, cssText);
  }

  function addManagedListener(target, type, listener, opts) {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    if (typeof host.addManagedListener === 'function') {
      const detach = host.addManagedListener(target, type, listener, opts);
      return typeof detach === 'function' ? detach : () => {};
    }
    target.addEventListener(type, listener, opts);
    let active = true;
    const detach = () => {
      if (!active) return;
      active = false;
      try {
        target.removeEventListener(type, listener, opts);
      } catch {
        // Ignore teardown errors
      }
    };
    host.onDispose(detach);
    return detach;
  }

  return Object.freeze({
    pluginId,
    trustLevel,
    schemaVersion,
    storageNamespace,
    ipcChannelPrefix,
    langStorageKey,
    readSavedLang,
    writeSavedLang,
    resolveEffectiveLang,
    hasConfigBridge,
    createConfigService,
    getServerUrl,
    bindServerUrlListener,
    buildThemedIframeUrl,
    isTrustedIframeMessage,
    getSlotHostElement,
    mountSlot,
    unmountSlot: (slotId) => host.unmountSlot(slotId),
    openModal: (slotId, opts) => host.openModal(slotId, opts || {}),
    injectStyle,
    removeStyle: (styleId) => host.removeStyle(styleId),
    addManagedListener,
    onDispose: (fn) => host.onDispose(fn),
  });
}
