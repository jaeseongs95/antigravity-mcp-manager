/**
 * Customizations Screen Mount Adapter (`src/adapters/antigravity/renderer/customizations-mount.mjs`).
 *
 * SOLID Boundaries:
 * - SRP: Detects Antigravity's Customizations (`MCP Servers` / `MCP 서버`) header,
 *   mounts the trigger button (`custom` slot) immediately before right-hand action icons
 *   and opens/closes the full-pane `role="dialog"` overlay (`overlay` slot) with live
 *   EN/KO label sync, Back/Close/Escape handling, and focus restoration.
 * - LSP / ISP: Implements the exact same Mount Adapter contract as `settings-sidebar-mount.mjs`.
 */

import { FRAME_ATTR, SLOT_IDS, normalizedText, sameFrameBaseAndTheme } from './host-runtime.mjs';

const CUSTOMIZATIONS_BTN_ATTR = 'data-agy-mcp-customizations-btn';
const CUSTOMIZATIONS_OVERLAY_ATTR = 'data-agy-mcp-customizations-overlay';
const CUSTOMIZATIONS_TOPBAR_ATTR = 'data-agy-mcp-customizations-topbar';
const CUSTOMIZATIONS_BACK_ATTR = 'data-agy-mcp-customizations-back';
const CUSTOMIZATIONS_CLOSE_ATTR = 'data-agy-mcp-customizations-close';

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

export function createCustomizationsMount({ runtime, win = window, doc = document }) {
  let lastTriggerBtn = null;

  function getButtonLabel() {
    return runtime.readSavedLang() === 'ko' ? 'MCP 매니저' : 'MCP Manager';
  }

  function getBackLabel() {
    return runtime.readSavedLang() === 'ko' ? '← Customizations로 돌아가기' : '← Back to Customizations';
  }

  function isCustomizationsPageVisible() {
    const candidates = doc.querySelectorAll('h1, h2, h3, h4, div, span, button');
    for (const el of candidates) {
      if (el.children.length > 2) continue;
      if (el.closest?.(`[${CUSTOMIZATIONS_OVERLAY_ATTR}="true"]`)) continue;
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
      if (el.closest?.(`[${CUSTOMIZATIONS_OVERLAY_ATTR}="true"]`)) continue;
      if (el.hasAttribute(CUSTOMIZATIONS_BTN_ATTR)) continue;
      if (!isMcpServersLabel(normalizedText(el))) continue;

      let row = el.parentElement;
      for (let depth = 0; depth < 4 && row && row !== doc.body; depth += 1) {
        const buttons = Array.from(row.querySelectorAll('button')).filter(
          (b) => !b.hasAttribute(CUSTOMIZATIONS_BTN_ATTR) && !b.contains(el)
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
    const btn = doc.querySelector(`[${CUSTOMIZATIONS_BTN_ATTR}="true"]`);
    if (btn) btn.textContent = getButtonLabel();
    const backBtn = doc.querySelector(`[${CUSTOMIZATIONS_BACK_ATTR}="true"]`);
    if (backBtn) backBtn.textContent = getBackLabel();
  }

  function closeOverlay() {
    const overlay = doc.querySelector(`[data-addon-host-slot="${SLOT_IDS.CUSTOMIZATIONS_OVERLAY}"]`);
    if (overlay) {
      overlay.setAttribute('data-agy-mcp-hidden', 'true');
      overlay.style.display = 'none';
    }
    if (lastTriggerBtn && typeof lastTriggerBtn.focus === 'function') {
      try {
        lastTriggerBtn.focus();
      } catch {
        // Ignore focus restoration errors
      }
    }
  }

  function openOverlay(triggerBtn) {
    const baseUrl = runtime.getServerUrl();
    if (!baseUrl || !doc.body) return;
    lastTriggerBtn = triggerBtn || null;

    const bodyCs = win.getComputedStyle(doc.body);
    const bodyBg = bodyCs?.backgroundColor || '';
    const hostBg = bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent' ? bodyBg : '#0d0e11';
    const hostFg = bodyCs?.color || '#e5e7eb';
    const hostFont = bodyCs?.fontFamily || 'sans-serif';
    const themedUrl = runtime.buildThemedIframeUrl(baseUrl, doc.body);

    const overlay = runtime.mountSlot(SLOT_IDS.CUSTOMIZATIONS_OVERLAY, doc.body);
    overlay.setAttribute(CUSTOMIZATIONS_OVERLAY_ATTR, 'true');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'MCP Manager');
    overlay.style.background = hostBg;
    overlay.style.color = hostFg;
    overlay.style.fontFamily = hostFont;

    let frame = overlay.querySelector(`[${FRAME_ATTR}="true"]`);
    if (!frame) {
      while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

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

      frame = doc.createElement('iframe');
      frame.setAttribute(FRAME_ATTR, 'true');
      frame.setAttribute('data-agy-mcp-customizations-frame', 'true');
      frame.setAttribute('title', 'MCP Manager');
      frame.src = themedUrl;

      overlay.appendChild(topBar);
      overlay.appendChild(frame);
    } else if (!sameFrameBaseAndTheme(frame.src, themedUrl)) {
      frame.src = themedUrl;
    }

    syncLabels();
    overlay.removeAttribute('data-agy-mcp-hidden');
    overlay.style.display = 'flex';
  }

  function ensureMount() {
    const baseUrl = runtime.getServerUrl();
    if (!baseUrl) return;

    const found = findCustomizationsMcpHeader();
    if (!found) return;
    const { row, actionContainer, firstActionButton } = found;

    if (row.querySelector(`[${CUSTOMIZATIONS_BTN_ATTR}="true"]`)) {
      return;
    }

    const btnSlot = runtime.mountSlot(SLOT_IDS.CUSTOMIZATIONS_BTN, actionContainer);
    while (btnSlot.firstChild) btnSlot.removeChild(btnSlot.firstChild);

    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.setAttribute(CUSTOMIZATIONS_BTN_ATTR, 'true');
    btn.textContent = getButtonLabel();
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openOverlay(btn);
    });

    btnSlot.appendChild(btn);

    if (firstActionButton && firstActionButton.parentElement === actionContainer && firstActionButton !== btnSlot) {
      actionContainer.insertBefore(btnSlot, firstActionButton);
    }
  }

  function handleKeydown(ev) {
    if (ev.key !== 'Escape') return;
    const overlay = doc.querySelector(`[data-addon-host-slot="${SLOT_IDS.CUSTOMIZATIONS_OVERLAY}"]`);
    if (overlay && overlay.style.display !== 'none' && overlay.getAttribute('data-agy-mcp-hidden') !== 'true') {
      ev.preventDefault();
      closeOverlay();
    }
  }

  function getFrames() {
    const overlay = doc.querySelector(`[data-addon-host-slot="${SLOT_IDS.CUSTOMIZATIONS_OVERLAY}"]`);
    const frame = overlay?.querySelector(`[${FRAME_ATTR}="true"]`);
    return frame ? [frame] : [];
  }

  function dispose() {
    lastTriggerBtn = null;
    try {
      runtime.unmountSlot(SLOT_IDS.CUSTOMIZATIONS_OVERLAY);
    } catch {
      // Ignore if host already unmounted
    }
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
