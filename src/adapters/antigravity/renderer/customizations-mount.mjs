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
import { createNativeMcpPanel } from './native-mcp-panel.mjs';

const CUSTOMIZATIONS_BTN_ATTR = 'data-agy-mcp-customizations-btn';
const CUSTOMIZATIONS_OVERLAY_ATTR = 'data-agy-mcp-customizations-overlay';
const CUSTOMIZATIONS_TOPBAR_ATTR = 'data-agy-mcp-customizations-topbar';
const CUSTOMIZATIONS_TITLE_ATTR = 'data-agy-mcp-customizations-title';
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
  let modalTitleEl = null;
  let modalCloseBtnEl = null;
  let modalContentEl = null;
  let modalFrameEl = null;
  let modalLauncherView = null;
  let modalNativePanel = null;

  function resolveLang() {
    return (typeof runtime.resolveEffectiveLang === 'function' ? runtime.resolveEffectiveLang() : runtime.readSavedLang()) === 'ko'
      ? 'ko'
      : 'en';
  }

  function getButtonLabel() {
    return resolveLang() === 'ko' ? 'MCP 매니저' : 'MCP Manager';
  }

  function getCloseAriaLabel() {
    return resolveLang() === 'ko' ? 'MCP 매니저 닫기' : 'Close MCP Manager';
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

  function hasMatchingMcpLabelDescendant(el) {
    const descendants = el.querySelectorAll('h1, h2, h3, h4, span, div, button, p');
    for (const child of descendants) {
      if (child === el || isInsideOwnSlot(child) || child.hasAttribute(CUSTOMIZATIONS_BTN_ATTR)) continue;
      if (isMcpServersLabel(normalizedText(child))) return true;
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
      // Pick the innermost label node; never match an outer wrapper that wraps the collapse <button>
      if (hasMatchingMcpLabelDescendant(el)) continue;
      if (el.tagName !== 'BUTTON' && el.querySelector('button')) continue;

      const leftAnchor = el.closest?.('button') || el;
      const anchorRect = leftAnchor.getBoundingClientRect?.() || null;
      const hasAnchorBox = Boolean(anchorRect && anchorRect.width > 0 && anchorRect.height > 0);
      const anchorCenterY = hasAnchorBox ? (anchorRect.top + anchorRect.bottom) / 2 : 0;

      let row = leftAnchor.parentElement;
      for (let depth = 0; depth < 5 && row && row !== doc.body; depth += 1) {
        const rightButtons = Array.from(row.querySelectorAll('button')).filter((b) => {
          if (b === leftAnchor || b.hasAttribute(CUSTOMIZATIONS_BTN_ATTR) || isInsideOwnSlot(b)) return false;
          if (b.contains(leftAnchor) || leftAnchor.contains(b)) return false;
          if (isMcpServersLabel(normalizedText(b))) return false;
          if (hasAnchorBox) {
            const bRect = b.getBoundingClientRect?.();
            if (!bRect || bRect.width <= 0 || bRect.height <= 0) return false;
            const bCenterY = (bRect.top + bRect.bottom) / 2;
            const maxRowDelta = Math.max(anchorRect.height, bRect.height, 28);
            if (Math.abs(bCenterY - anchorCenterY) > maxRowDelta) return false;
            if (bRect.left < anchorRect.right - 2) return false;
          }
          return true;
        });

        if (rightButtons.length >= 1) {
          rightButtons.sort((a, b) => {
            const ar = a.getBoundingClientRect?.();
            const br = b.getBoundingClientRect?.();
            return (ar?.left || 0) - (br?.left || 0);
          });
          // Anchor into the rightmost action group (e.g. [] and + icon cluster) so a separate chevron button is never chosen
          const rightmostBtn = rightButtons[rightButtons.length - 1];
          const actionContainer = rightmostBtn.parentElement || row;
          const firstActionButton =
            rightButtons.find((b) => b.parentElement === actionContainer) || rightmostBtn;
          return {
            row,
            actionContainer,
            firstActionButton,
            alignRightInRow: actionContainer === row,
          };
        }
        row = row.parentElement;
      }

      const fallbackRow = leftAnchor.parentElement;
      if (fallbackRow && fallbackRow !== doc.body) {
        return { row: fallbackRow, actionContainer: fallbackRow, firstActionButton: null, alignRightInRow: true };
      }
    }
    return null;
  }

  function syncLabels() {
    const label = getButtonLabel();
    if (btnEl) btnEl.textContent = label;
    if (modalTitleEl) modalTitleEl.textContent = label;
    if (modalCloseBtnEl) modalCloseBtnEl.setAttribute('aria-label', getCloseAriaLabel());
    if (activeModalHandle?.element) activeModalHandle.element.setAttribute('aria-label', label);
    if (modalNativePanel) modalNativePanel.syncLang();
    if (modalLauncherView) modalLauncherView.syncLang();
  }

  function clearModalRefs() {
    if (modalNativePanel) {
      modalNativePanel.dispose();
    }
    activeModalHandle = null;
    modalTitleEl = null;
    modalCloseBtnEl = null;
    modalContentEl = null;
    modalFrameEl = null;
    modalLauncherView = null;
    modalNativePanel = null;
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

    if (typeof runtime.hasConfigBridge === 'function' && runtime.hasConfigBridge()) {
      if (modalFrameEl && modalFrameEl.parentNode) modalFrameEl.parentNode.removeChild(modalFrameEl);
      modalFrameEl = null;
      if (modalLauncherView && modalLauncherView.element.parentNode) {
        modalLauncherView.element.parentNode.removeChild(modalLauncherView.element);
      }
      modalLauncherView = null;

      if (!modalNativePanel || modalNativePanel.element.parentNode !== modalContentEl) {
        if (modalNativePanel) modalNativePanel.dispose();
        while (modalContentEl.firstChild) modalContentEl.removeChild(modalContentEl.firstChild);
        const service = runtime.createConfigService();
        modalNativePanel = createNativeMcpPanel({ runtime, service, surface: 'customizations', onLangChange, doc });
        modalContentEl.appendChild(modalNativePanel.element);
      } else {
        modalNativePanel.syncLang();
      }
      return;
    }

    if (modalNativePanel) {
      modalNativePanel.dispose();
      modalNativePanel = null;
    }

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
      if (typeof activeModalHandle.reposition === 'function') {
        activeModalHandle.reposition('customizations-page');
      }
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
      surface: 'customizations-page',
      onClose: handleModalClosed,
    });
    if (!modalHandle || !modalHandle.bodyEl) return;

    activeModalHandle = modalHandle;
    const dlg = modalHandle.element;
    if (dlg) {
      dlg.setAttribute(CUSTOMIZATIONS_OVERLAY_ATTR, 'true');
      dlg.setAttribute('aria-label', getButtonLabel());
      // Centered popup modal window:
      // - On antigravity-addons v2.4.0+, preserve host-managed surface insets (`left`/`top`/`right`/`bottom`, `margin: auto`)
      //   and dynamic resize-tracked `maxWidth`/`maxHeight` when `data-addon-host-modal-surface` is active.
      // - On legacy Host v2.3.0, preserve titlebar safe inset (`marginTop`/`top`) and viewport-clamped centering.
      if (dlg.style) {
        const hostManagedSurface = Boolean(dlg.getAttribute?.('data-addon-host-modal-surface'));
        dlg.style.boxSizing = 'border-box';
        if (hostManagedSurface) {
          dlg.style.width = '820px';
          dlg.style.height = '660px';
        } else {
          dlg.style.width = 'min(820px, calc(100vw - 48px))';
          dlg.style.maxWidth = 'calc(100vw - 48px)';
          dlg.style.height = 'min(660px, calc(100vh - 88px))';
          dlg.style.maxHeight = 'calc(100vh - 88px)';
          if (dlg.style.margin !== 'auto') {
            dlg.style.marginLeft = 'auto';
            dlg.style.marginRight = 'auto';
          }
        }
        dlg.style.padding = '0';
        dlg.style.border = '1px solid rgba(128, 128, 128, 0.28)';
        dlg.style.borderRadius = '14px';
        dlg.style.boxShadow = '0 24px 64px rgba(0, 0, 0, 0.52), 0 0 0 100vmax rgba(0, 0, 0, 0.45)';
        dlg.style.background = hostBg;
        dlg.style.color = hostFg;
        dlg.style.fontFamily = hostFont;
        dlg.style.overflow = 'hidden';
      }
      // Dismiss popup cleanly when clicking the dimmed backdrop outside the dialog bounds
      dlg.addEventListener('click', (ev) => {
        if (ev.target !== dlg) return;
        const rect = dlg.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        const outside =
          ev.clientX < rect.left ||
          ev.clientX > rect.right ||
          ev.clientY < rect.top ||
          ev.clientY > rect.bottom;
        if (outside) {
          closeOverlay();
        }
      });
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

    const titleEl = doc.createElement('h2');
    titleEl.setAttribute(CUSTOMIZATIONS_TITLE_ATTR, 'true');
    titleEl.textContent = getButtonLabel();

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute(CUSTOMIZATIONS_CLOSE_ATTR, 'true');
    closeBtn.setAttribute('aria-label', getCloseAriaLabel());
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      closeOverlay();
    });

    topBar.appendChild(titleEl);
    topBar.appendChild(closeBtn);

    const content = doc.createElement('div');
    content.setAttribute(CUSTOMIZATIONS_CONTENT_ATTR, 'true');

    bodyRoot.appendChild(topBar);
    bodyRoot.appendChild(content);

    modalTitleEl = titleEl;
    modalCloseBtnEl = closeBtn;
    modalContentEl = content;
    renderModalContent();
    syncLabels();
  }

  function ensureMount() {
    const found = findCustomizationsMcpHeader();
    if (!found) return;
    const { actionContainer, firstActionButton, alignRightInRow } = found;

    if (btnHostEl && btnHostEl.isConnected && btnHostEl.parentElement === actionContainer) {
      if (firstActionButton && firstActionButton.parentElement === actionContainer && btnHostEl.nextElementSibling !== firstActionButton) {
        actionContainer.insertBefore(btnHostEl, firstActionButton);
      }
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
      btnHost.style.flexShrink = '0';
      btnHost.style.marginLeft = alignRightInRow ? 'auto' : '';
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
