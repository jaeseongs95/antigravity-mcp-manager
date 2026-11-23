/**
 * Customizations Screen Mount Adapter (`src/adapters/antigravity/renderer/customizations-mount.mjs`).
 *
 * SOLID Boundaries:
 * - SRP: Detects Antigravity's Customizations (`MCP Servers` / `MCP 서버`) header,
 *   mounts the trigger button (`custom` slot, Shadow DOM Option B2) immediately before
 *   right-hand action icons, and opens/closes the full-pane modal overlay via
 *   `AddonManifest.v2` `runtime.openModal(slotId, { shadow: true, onClose })` (preserving
 *   host `marginTop`/`zIndex` & `PortalArbiter` LIFO `Escape` / focus restoration), rendering
 *   either the live loopback `<iframe>` or the EN/KO Native Sidecar launcher panel.
 * - LSP / ISP: Implements the exact same Mount Adapter contract as `settings-sidebar-mount.mjs`.
 */

import {
  FRAME_ATTR,
  SLOT_IDS,
  createSidecarLauncherView,
  normalizedText,
  sameFrameBaseAndTheme,
} from './host-runtime.mjs';

const CUSTOMIZATIONS_BTN_ATTR = 'data-agy-mcp-customizations-btn';
const CUSTOMIZATIONS_OVERLAY_ATTR = 'data-agy-mcp-customizations-overlay';
const CUSTOMIZATIONS_TOPBAR_ATTR = 'data-agy-mcp-customizations-topbar';
const CUSTOMIZATIONS_BACK_ATTR = 'data-agy-mcp-customizations-back';
const CUSTOMIZATIONS_CLOSE_ATTR = 'data-agy-mcp-customizations-close';
const CUSTOMIZATIONS_CONTENT_ATTR = 'data-agy-mcp-customizations-content';

const CUSTOMIZATIONS_PAGE_MARKERS = [
  'customizations',
  'skills & rules',
  'custom agents',
  '사용자 정의',
  '맞춤 설정',
  '커스터마이징',
  '스킬 및 규칙',
  '사용자 지정 에이전트',
  '커스텀 에이전트',
];
const MCP_SERVERS_SECTION_LABELS = ['mcp servers', 'mcp 서버'];

function isCustomizationsMarker(txt) {
  return CUSTOMIZATIONS_PAGE_MARKERS.some(
    (marker) => txt === marker || (txt.startsWith(marker) && /^[\s(]*\d*[\s)]*$/.test(txt.slice(marker.length)))
  );
}

function isMcpServersLabel(txt) {
  return MCP_SERVERS_SECTION_LABELS.some(
    (label) => txt === label || (txt.startsWith(label) && /^[\s(]*\d+[\s)]*$/.test(txt.slice(label.length)))
  );
}

export function createCustomizationsMount({ runtime, onLangChange = () => {}, win = window, doc = document }) {
  let lastTriggerBtn = null;
  let btnHostEl = null;
  let btnRootEl = null;
  let btnEl = null;
  let activeModalHandle = null;
  let modalBackBtnEl = null;
  let modalContentEl = null;
  let modalFrameEl = null;
  let modalLauncherView = null;

  function getButtonLabel() {
    return runtime.readSavedLang() === 'ko' ? 'MCP 매니저' : 'MCP Manager';
  }

  function getBackLabel() {
    return runtime.readSavedLang() === 'ko' ? '← Customizations로 돌아가기' : '← Back to Customizations';
  }

  function isInsideOwnSlot(el) {
    if (!el || typeof el.closest !== 'function') return false;
    return Boolean(
      el.closest(`[${CUSTOMIZATIONS_OVERLAY_ATTR}="true"]`) ||
        el.closest('[data-addon-host-modal-dialog="1"]') ||
        el.closest(`[data-addon-host-slot="${SLOT_IDS.CUSTOMIZATIONS_BTN}"]`)
    );
  }

  function isCustomizationsPageVisible() {
    const candidates = doc.querySelectorAll('h1, h2, h3, h4, div, span, button');
    for (const el of candidates) {
      if (el.children.length > 2) continue;
      if (isInsideOwnSlot(el)) continue;
      if (isCustomizationsMarker(normalizedText(el))) {
        const rect = el.getBoundingClientRect?.();
        if (!rect || (rect.width > 0 && rect.height > 0)) return true;
      }
    }
    return false;
  }

  function findCustomizationsMcpHeader() {
    if (!isCustomizationsPageVisible()) return null;
    const candidates = doc.querySelectorAll('h1, h2, h3, h4, span, div, button, p');
    for (const el of candidates) {
      if (el.children.length > 2) continue;
      if (isInsideOwnSlot(el)) continue;
      if (el.hasAttribute(CUSTOMIZATIONS_BTN_ATTR)) continue;
      if (!isMcpServersLabel(normalizedText(el))) continue;

      let row = el.parentElement;
      for (let depth = 0; depth < 4 && row && row !== doc.body; depth += 1) {
        const buttons = Array.from(row.querySelectorAll('button')).filter(
          (b) => !b.hasAttribute(CUSTOMIZATIONS_BTN_ATTR) && !isInsideOwnSlot(b) && !b.contains(el)
        );
        if (buttons.length >= 1) {
          const actionContainer = buttons[0].parentElement || row;
          return { row, actionContainer, firstActionButton: buttons[0] };
        }
        row = row.parentElement;
      }

      const fallbackRow = el.parentElement;
      if (fallbackRow && fallbackRow !== doc.body) {
        return { row: fallbackRow, actionContainer: fallbackRow, firstActionButton: null };
      }
    }
    return null;
  }

  function syncLabels() {
    if (btnEl) btnEl.textContent = getButtonLabel();
    if (modalBackBtnEl) modalBackBtnEl.textContent = getBackLabel();
    if (modalLauncherView) modalLauncherView.syncLang();
  }

  function clearModalRefs() {
    activeModalHandle = null;
    modalBackBtnEl = null;
    modalContentEl = null;
    modalFrameEl = null;
    modalLauncherView = null;
  }

  function handleModalClosed() {
    clearModalRefs();
    if (lastTriggerBtn && lastTriggerBtn.isConnected && typeof lastTriggerBtn.focus === 'function') {
      try {
        lastTriggerBtn.focus();
      } catch {
        // Ignore focus restoration errors
      }
    }
  }

  function closeOverlay() {
    const handle = activeModalHandle;
    if (!handle) return;
    clearModalRefs();
    try {
      handle.close();
    } catch {
      // Ignore if host already closed modal
    }
  }

  function renderModalContent() {
    if (!modalContentEl) return;
    const baseUrl = runtime.getServerUrl();
    if (baseUrl) {
      if (modalLauncherView && modalLauncherView.element.parentNode) {
        modalLauncherView.element.parentNode.removeChild(modalLauncherView.element);
      }
      modalLauncherView = null;

      const themedUrl = runtime.buildThemedIframeUrl(baseUrl, doc.body);
      if (!modalFrameEl || modalFrameEl.parentNode !== modalContentEl) {
        while (modalContentEl.firstChild) modalContentEl.removeChild(modalContentEl.firstChild);
        modalFrameEl = doc.createElement('iframe');
        modalFrameEl.setAttribute(FRAME_ATTR, 'true');
        modalFrameEl.setAttribute('data-agy-mcp-customizations-frame', 'true');
        modalFrameEl.setAttribute('title', 'MCP Manager');
        modalFrameEl.src = themedUrl;
        modalContentEl.appendChild(modalFrameEl);
      } else if (!sameFrameBaseAndTheme(modalFrameEl.src, themedUrl)) {
        modalFrameEl.src = themedUrl;
      }
      return;
    }

    if (modalFrameEl && modalFrameEl.parentNode) {
      modalFrameEl.parentNode.removeChild(modalFrameEl);
    }
    modalFrameEl = null;

    if (!modalLauncherView || modalLauncherView.element.parentNode !== modalContentEl) {
      while (modalContentEl.firstChild) modalContentEl.removeChild(modalContentEl.firstChild);
      modalLauncherView = createSidecarLauncherView({ runtime, surface: 'customizations', onLangChange, doc });
      modalContentEl.appendChild(modalLauncherView.element);
    } else {
      modalLauncherView.syncLang();
    }
  }

  function openOverlay(triggerBtn) {
    if (!doc.body) return;
    lastTriggerBtn = triggerBtn || btnEl || null;

    if (activeModalHandle && activeModalHandle.element && activeModalHandle.element.isConnected) {
      renderModalContent();
      syncLabels();
      return;
    }

    const bodyCs = win.getComputedStyle(doc.body);
    const bodyBg = bodyCs?.backgroundColor || '';
    const hostBg = bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent' ? bodyBg : '#0d0e11';
    const hostFg = bodyCs?.color || '#e5e7eb';
    const hostFont = bodyCs?.fontFamily || 'sans-serif';

    const modalHandle = runtime.openModal(SLOT_IDS.CUSTOMIZATIONS_OVERLAY, {
      shadow: true,
      onClose: handleModalClosed,
    });
    if (!modalHandle || !modalHandle.bodyEl) return;

    activeModalHandle = modalHandle;
    const dlg = modalHandle.element;
    if (dlg) {
      dlg.setAttribute(CUSTOMIZATIONS_OVERLAY_ATTR, 'true');
      dlg.setAttribute('aria-label', 'MCP Manager');
      // Preserve host-managed `marginTop` (titlebar safe inset) and `zIndex`!
      if (dlg.style) {
        dlg.style.width = '100vw';
        dlg.style.maxWidth = '100vw';
        dlg.style.height = 'calc(100vh - max(env(titlebar-area-height, 36px), 36px))';
        dlg.style.maxHeight = 'calc(100vh - max(env(titlebar-area-height, 36px), 36px))';
        dlg.style.marginLeft = '0';
        dlg.style.marginRight = '0';
        dlg.style.marginBottom = '0';
        dlg.style.padding = '0';
        dlg.style.border = '0';
        dlg.style.background = hostBg;
        dlg.style.color = hostFg;
        dlg.style.fontFamily = hostFont;
        dlg.style.overflow = 'hidden';
      }
    }

    const shadowHost = runtime.getSlotHostElement(modalHandle.bodyEl);
    if (shadowHost && shadowHost !== dlg && shadowHost.style) {
      shadowHost.style.width = '100%';
      shadowHost.style.height = '100%';
      shadowHost.style.display = 'flex';
      shadowHost.style.flexDirection = 'column';
    }

    const bodyRoot = modalHandle.bodyEl;
    while (bodyRoot.firstChild) bodyRoot.removeChild(bodyRoot.firstChild);

    const topBar = doc.createElement('div');
    topBar.setAttribute(CUSTOMIZATIONS_TOPBAR_ATTR, 'true');

    const backBtn = doc.createElement('button');
    backBtn.type = 'button';
    backBtn.setAttribute(CUSTOMIZATIONS_BACK_ATTR, 'true');
    backBtn.textContent = getBackLabel();
    backBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      closeOverlay();
    });

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute(CUSTOMIZATIONS_CLOSE_ATTR, 'true');
    closeBtn.setAttribute('aria-label', 'Close MCP Manager');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      closeOverlay();
    });

    topBar.appendChild(backBtn);
    topBar.appendChild(closeBtn);

    const content = doc.createElement('div');
    content.setAttribute(CUSTOMIZATIONS_CONTENT_ATTR, 'true');

    bodyRoot.appendChild(topBar);
    bodyRoot.appendChild(content);

    modalBackBtnEl = backBtn;
    modalContentEl = content;
    renderModalContent();
    syncLabels();
  }

  function ensureMount() {
    const found = findCustomizationsMcpHeader();
    if (!found) return;
    const { row, actionContainer, firstActionButton } = found;

    if (btnHostEl && btnHostEl.isConnected && row.contains(btnHostEl)) {
      if (activeModalHandle && activeModalHandle.element && activeModalHandle.element.isConnected) {
        renderModalContent();
      }
      return;
    }

    const btnRoot = runtime.mountSlot(SLOT_IDS.CUSTOMIZATIONS_BTN, { container: actionContainer });
    if (!btnRoot) return;
    const btnHost = runtime.getSlotHostElement(btnRoot);
    if (btnHost && btnHost.style) {
      btnHost.style.display = 'inline-flex';
      btnHost.style.alignItems = 'center';
    }
    while (btnRoot.firstChild) btnRoot.removeChild(btnRoot.firstChild);

    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.setAttribute(CUSTOMIZATIONS_BTN_ATTR, 'true');
    btn.textContent = getButtonLabel();
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openOverlay(btn);
    });

    btnRoot.appendChild(btn);
    btnHostEl = btnHost;
    btnRootEl = btnRoot;
    btnEl = btn;

    if (firstActionButton && firstActionButton.parentElement === actionContainer && firstActionButton !== btnHost) {
      actionContainer.insertBefore(btnHost, firstActionButton);
    }
  }

  function handleKeydown(ev) {
    // Host ModalPortal handles capture-phase Escape LIFO; keep fallback only if not already handled
    if (ev.key !== 'Escape' || ev.defaultPrevented || ev.isComposing || ev.keyCode === 229) return;
    if (activeModalHandle && activeModalHandle.element && activeModalHandle.element.isConnected) {
      ev.preventDefault();
      closeOverlay();
    }
  }

  function getFrames() {
    return modalFrameEl && modalFrameEl.isConnected ? [modalFrameEl] : [];
  }

  function dispose() {
    lastTriggerBtn = null;
    closeOverlay();
    btnHostEl = null;
    btnRootEl = null;
    btnEl = null;
    try {
      runtime.unmountSlot(SLOT_IDS.CUSTOMIZATIONS_BTN);
    } catch {
      // Ignore if host already unmounted
    }
  }

  return Object.freeze({
    id: 'customizations',
    ensureMount,
    syncLabels,
    getFrames,
    handleKeydown,
    dispose,
  });
}
