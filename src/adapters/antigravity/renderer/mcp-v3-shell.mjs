/**
 * AddonContextV3 3-Tier API-First UI Shell (`src/adapters/antigravity/renderer/mcp-v3-shell.mjs`).
 *
 * SOLID Boundaries:
 * - SRP: Connects Antigravity MCP Manager exclusively through `AddonContextV3` 3-Tier host APIs:
 *   - Tier 1 (Zero-DOM): `registerStatusItem`, `registerSettingsPage`, `registerCommand`, `showToast`, `confirm`
 *   - Tier 2 (Declarative Host Panel): `openPanel` with 16 closed schema primitives + `handle.update(nextTree, nextState)`
 *     ID-based in-place patching and host-managed mobile bottom-sheet auto-switching (`<=640px`)
 *   - Tier 3 (Host Shadow Canvas): `openModal` + Settings Page `render(canvasRoot)` mounting `NativeMcpPanel`
 *     styled with `ctx.ui.createStyleElementSafe(buildNativePanelCss())`
 * - Zero manual DOM queries, zero coordinate math, zero `hostProfileId` checks, clean `AbortSignal` / `onDispose`.
 */

import { buildNativePanelCss } from './addon-styles.mjs';
import { createNativeMcpPanel } from './native-mcp-panel.mjs';
import { STORAGE_DRAFT_KEY } from './storage-draft-config-store.mjs';
import { LANG_STORAGE_KEY } from './host-runtime.mjs';

export const V3_IDS = Object.freeze({
  STATUS_ITEM: 'mcp-manager',
  SETTINGS_PAGE: 'mcp-manager',
  CMD_OPEN_MANAGER: 'open-mcp-manager',
  CMD_OPEN_PANEL: 'open-mcp-panel',
  CMD_OPEN_SETTINGS: 'open-mcp-settings',
});

const SHELL_I18N = Object.freeze({
  en: Object.freeze({
    title: 'MCP Manager',
    panelTitle: 'MCP Manager · Quick Overview',
    statusLabel: 'MCP',
    statusTooltip: (mode, count) =>
      mode === 'host-bridge'
        ? `MCP Manager (Desktop Config Bridge · ${count} servers)`
        : `MCP Manager (Remote Draft · ${count} servers)`,
    cmdOpenManager: 'Open MCP Manager',
    cmdOpenPanel: 'Open MCP Quick Panel',
    cmdOpenSettings: 'Open MCP Manager Settings',
    modeHostBridge: 'Desktop Config Bridge',
    modeRemoteDraft: 'Remote Draft (ctx.storage)',
    summaryHeading: 'Configured MCP Servers',
    summaryLine: (globalCount, enabledCount, pluginCount) =>
      `Global: ${globalCount} (${enabledCount} active) · Plugins: ${pluginCount}`,
    malformedAlert: 'Broken mcp_config.json detected. Open Full Editor -> Raw JSON to repair safely.',
    loadErrorAlert: 'Failed to load MCP configuration.',
    quickListTitle: 'Global Servers',
    noServersItem: 'No global MCP servers configured yet.',
    enableAction: 'Enable',
    disableAction: 'Disable',
    languageLabel: 'Language',
    openEditorBtn: 'Open Full Editor',
    openSettingsBtn: 'Settings Page',
    refreshBtn: 'Refresh',
    toggledToast: (name, disabled) =>
      disabled ? `Disabled "${name}".` : `Enabled "${name}".`,
    conflictToast: 'Config changed externally (CAS conflict). Reloaded latest snapshot.',
    toggleFailedToast: 'Failed to toggle MCP server.',
  }),
  ko: Object.freeze({
    title: 'MCP 매니저',
    panelTitle: 'MCP 매니저 · 빠른 요약',
    statusLabel: 'MCP',
    statusTooltip: (mode, count) =>
      mode === 'host-bridge'
        ? `MCP 매니저 (데스크톱 Config Bridge · 서버 ${count}개)`
        : `MCP 매니저 (원격 초안 · 서버 ${count}개)`,
    cmdOpenManager: 'MCP 매니저 열기',
    cmdOpenPanel: 'MCP 빠른 패널 열기',
    cmdOpenSettings: 'MCP 매니저 설정 열기',
    modeHostBridge: '데스크톱 Config Bridge',
    modeRemoteDraft: '원격 초안 (ctx.storage)',
    summaryHeading: '등록된 MCP 서버',
    summaryLine: (globalCount, enabledCount, pluginCount) =>
      `전역: ${globalCount}개 (활성 ${enabledCount}개) · 플러그인: ${pluginCount}개`,
    malformedAlert: '손상된 mcp_config.json이 감지되었습니다. 전체 편집기의 원본 JSON 탭에서 안전하게 복구하세요.',
    loadErrorAlert: 'MCP 설정을 불러오지 못했습니다.',
    quickListTitle: '전역 서버 목록',
    noServersItem: '등록된 전역 MCP 서버가 없습니다.',
    enableAction: '활성화',
    disableAction: '비활성화',
    languageLabel: '언어',
    openEditorBtn: '전체 편집기 열기',
    openSettingsBtn: '설정 페이지',
    refreshBtn: '새로고침',
    toggledToast: (name, disabled) =>
      disabled ? `"${name}" 서버를 비활성화했습니다.` : `"${name}" 서버를 활성화했습니다.`,
    conflictToast: '외부에서 설정이 변경되었습니다(CAS 충돌). 최신 상태를 다시 불러왔습니다.',
    toggleFailedToast: 'MCP 서버 상태 변경에 실패했습니다.',
  }),
});

export function buildQuickPanelSchema({ snapshot, mode, surface, lang, errorMessage = '' }) {
  const dict = SHELL_I18N[lang === 'ko' ? 'ko' : 'en'];
  const globalServers = snapshot?.globalConfig?.servers || [];
  const enabledCount = globalServers.filter((s) => !s.disabled).length;
  const pluginCount = (snapshot?.pluginServers || []).length;
  const malformed = Boolean(snapshot?.globalConfig?.malformed);

  const serverItems =
    globalServers.length > 0
      ? globalServers.map((s) => ({
          id: `srv-${s.name}`,
          label: `${s.name} · ${s.disabled ? dict.disableAction : s.transport === 'stdio' ? 'Stdio' : 'HTTP'}`,
          actionId: 'toggle-server',
          actionLabel: s.disabled ? dict.enableAction : dict.disableAction,
          payload: { name: s.name, disabled: !s.disabled },
        }))
      : [{ id: 'empty-global', label: dict.noServersItem }];

  const tree = {
    type: 'stack',
    id: 'mcp-quick-root',
    children: [
      {
        type: 'row',
        id: 'mcp-quick-badges',
        children: [
          {
            type: 'badge',
            id: 'mcp-mode-badge',
            text: mode === 'host-bridge' ? dict.modeHostBridge : dict.modeRemoteDraft,
            variant: mode === 'host-bridge' ? 'success' : 'default',
          },
          {
            type: 'badge',
            id: 'mcp-surface-badge',
            text: surface,
          },
        ],
      },
      {
        type: 'alert',
        id: 'mcp-malformed-alert',
        variant: 'danger',
        text: dict.malformedAlert,
        visibleWhen: { field: 'malformed', eq: true },
      },
      {
        type: 'alert',
        id: 'mcp-error-alert',
        variant: 'warning',
        text: errorMessage || dict.loadErrorAlert,
        visibleWhen: { field: 'hasError', eq: true },
      },
      {
        type: 'section',
        id: 'mcp-summary-section',
        title: dict.summaryHeading,
        children: [
          {
            type: 'text',
            id: 'mcp-summary-text',
            text: dict.summaryLine(globalServers.length, enabledCount, pluginCount),
          },
          {
            type: 'list',
            id: 'mcp-server-list',
            items: serverItems,
          },
        ],
      },
      {
        type: 'divider',
        id: 'mcp-quick-divider',
      },
      {
        type: 'select',
        id: 'mcp-lang-select',
        label: dict.languageLabel,
        field: 'lang',
        options: [
          { value: 'en', label: 'English' },
          { value: 'ko', label: '한국어' },
        ],
      },
      {
        type: 'row',
        id: 'mcp-quick-actions',
        children: [
          {
            type: 'button',
            id: 'mcp-btn-open-editor',
            label: dict.openEditorBtn,
            variant: 'primary',
            actionId: 'open-full-editor',
          },
          {
            type: 'button',
            id: 'mcp-btn-refresh',
            label: dict.refreshBtn,
            actionId: 'refresh',
          },
        ],
      },
    ],
  };

  const state = {
    lang: lang === 'ko' ? 'ko' : 'en',
    mode,
    surface,
    serverCount: globalServers.length,
    enabledCount,
    pluginCount,
    malformed,
    hasError: Boolean(errorMessage),
  };

  return { tree, state };
}

export function createMcpV3Shell({
  runtime,
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null,
}) {
  const mode = runtime.getConfigStoreMode();
  const surface = runtime.getSurface();
  const service = runtime.createConfigService();

  let disposed = false;
  let latestSnapshot = null;
  let latestError = '';
  let statusItemHandle = null;
  let settingsPageHandle = null;
  let quickPanelHandle = null;
  let fullModalHandle = null;
  let fullModalPanel = null;
  let settingsCanvasPanel = null;
  const commandHandles = [];
  const unsubscribers = [];

  function getLang() {
    return runtime.resolveEffectiveLang() === 'ko' ? 'ko' : 'en';
  }

  function dict() {
    return SHELL_I18N[getLang()];
  }

  function syncStatusItem() {
    if (!statusItemHandle || disposed) return;
    const count = latestSnapshot?.globalConfig?.servers?.length ?? 0;
    const d = dict();
    try {
      statusItemHandle.update({
        label: d.statusLabel,
        tooltip: d.statusTooltip(mode, count),
        badge: latestSnapshot ? String(count) : null,
      });
    } catch {
      // Ignore updates during disposal
    }
  }

  function syncQuickPanel() {
    if (!quickPanelHandle || disposed) return;
    const { tree, state } = buildQuickPanelSchema({
      snapshot: latestSnapshot,
      mode,
      surface,
      lang: getLang(),
      errorMessage: latestError,
    });
    try {
      quickPanelHandle.update(tree, state);
    } catch {
      // Panel may already be closed
    }
  }

  function syncAllUi() {
    if (disposed) return;
    syncStatusItem();
    syncQuickPanel();
    if (fullModalPanel) fullModalPanel.syncLang();
    if (settingsCanvasPanel) settingsCanvasPanel.syncLang();
  }

  async function refreshSnapshot() {
    if (disposed) return null;
    try {
      const snap = await service.getSnapshot({ includeRawText: false });
      if (disposed) return null;
      if (snap && snap.ok) {
        latestSnapshot = snap;
        latestError = '';
      } else {
        latestError = (snap?.errors || [dict().loadErrorAlert]).join(' ');
      }
    } catch (err) {
      if (disposed) return null;
      latestError = err?.message || dict().loadErrorAlert;
    }
    syncStatusItem();
    syncQuickPanel();
    return latestSnapshot;
  }

  async function handleQuickToggle(payload) {
    if (!payload || !payload.name || disposed) return;
    if (!latestSnapshot) {
      await refreshSnapshot();
      if (!latestSnapshot || disposed) return;
    }
    try {
      const res = await service.toggleServerDisabled({
        name: payload.name,
        disabled: Boolean(payload.disabled),
        expectedSha256: latestSnapshot.globalConfig.sha256,
      });
      if (disposed) return;
      if (res.code === 'CONFLICT') {
        runtime.showToast({ message: dict().conflictToast, variant: 'warning' });
        await refreshSnapshot();
        return;
      }
      if (!res.ok) {
        runtime.showToast({ message: (res.errors || [dict().toggleFailedToast]).join(' '), variant: 'error' });
        return;
      }
      runtime.showToast({ message: dict().toggledToast(payload.name, Boolean(payload.disabled)), variant: 'success' });
      await refreshSnapshot();
      if (fullModalPanel) void fullModalPanel.refresh();
      if (settingsCanvasPanel) void settingsCanvasPanel.refresh();
    } catch (err) {
      if (!disposed) {
        runtime.showToast({ message: err?.message || dict().toggleFailedToast, variant: 'error' });
      }
    }
  }

  function mountNativePanelInCanvas(canvasRoot, overlayHandle, panelSurface) {
    if (!canvasRoot || disposed) return null;
    const styleEl = runtime.createStyleElementSafe(buildNativePanelCss());
    if (styleEl && typeof canvasRoot.appendChild === 'function') {
      canvasRoot.appendChild(styleEl);
    }
    const panel = createNativeMcpPanel({
      runtime,
      service,
      mode,
      surface: panelSurface,
      doc,
      win,
      onLangChange: () => syncAllUi(),
      onSnapshotChange: (snap) => {
        latestSnapshot = snap;
        latestError = '';
        syncStatusItem();
        syncQuickPanel();
      },
    });
    canvasRoot.appendChild(panel.element);
    return panel;
  }

  function openFullModal() {
    if (disposed) return null;
    if (fullModalHandle) {
      try {
        fullModalHandle.close();
      } catch {}
      fullModalHandle = null;
    }
    if (fullModalPanel) {
      fullModalPanel.dispose();
      fullModalPanel = null;
    }

    const handle = runtime.openModal({
      title: dict().title,
      placement: {
        zone: 'surface-center',
        surface: 'auto',
        width: 820,
        maxHeight: 720,
      },
      onClose: () => {
        if (fullModalPanel) {
          fullModalPanel.dispose();
          fullModalPanel = null;
        }
        fullModalHandle = null;
      },
    });
    fullModalHandle = handle;
    if (handle && handle.bodyEl) {
      fullModalPanel = mountNativePanelInCanvas(handle.bodyEl, handle, 'customizations');
    }
    return handle;
  }

  function openQuickPanel(anchorEl = null) {
    if (disposed) return null;
    if (quickPanelHandle) {
      try {
        quickPanelHandle.close();
      } catch {}
      quickPanelHandle = null;
    }

    const { tree, state } = buildQuickPanelSchema({
      snapshot: latestSnapshot,
      mode,
      surface,
      lang: getLang(),
      errorMessage: latestError,
    });

    const placement = {
      zone: 'drawer',
      side: 'right',
      width: 420,
      ...(anchorEl ? { anchorEl } : {}),
    };

    const handle = runtime.openPanel({
      title: dict().panelTitle,
      placement,
      tree,
      state,
      onChange: (ev) => {
        if (ev && ev.field === 'lang' && (ev.value === 'en' || ev.value === 'ko')) {
          runtime.writeSavedLang(ev.value);
          syncAllUi();
        }
      },
      onAction: (ev) => {
        if (!ev) return;
        if (ev.actionId === 'open-full-editor') {
          if (quickPanelHandle) {
            try {
              quickPanelHandle.close();
            } catch {}
          }
          openFullModal();
        } else if (ev.actionId === 'refresh') {
          void refreshSnapshot();
        } else if (ev.actionId === 'toggle-server') {
          void handleQuickToggle(ev.payload);
        }
      },
      onClose: () => {
        quickPanelHandle = null;
      },
    });
    quickPanelHandle = handle;
    void refreshSnapshot();
    return handle;
  }

  function openSettingsPage() {
    if (disposed || !settingsPageHandle) return null;
    return settingsPageHandle.open();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const unsub of unsubscribers.splice(0)) {
      try {
        unsub();
      } catch {}
    }
    for (const cmd of commandHandles.splice(0)) {
      try {
        if (typeof cmd.dispose === 'function') cmd.dispose();
        else if (typeof cmd.unregister === 'function') cmd.unregister();
      } catch {}
    }
    if (quickPanelHandle) {
      try {
        quickPanelHandle.close();
      } catch {}
      quickPanelHandle = null;
    }
    if (fullModalHandle) {
      try {
        fullModalHandle.close();
      } catch {}
      fullModalHandle = null;
    }
    if (fullModalPanel) {
      fullModalPanel.dispose();
      fullModalPanel = null;
    }
    if (settingsCanvasPanel) {
      settingsCanvasPanel.dispose();
      settingsCanvasPanel = null;
    }
    if (statusItemHandle) {
      try {
        statusItemHandle.dispose();
      } catch {}
      statusItemHandle = null;
    }
    if (settingsPageHandle) {
      try {
        settingsPageHandle.dispose();
      } catch {}
      settingsPageHandle = null;
    }
  }

  function start() {
    if (disposed) return;
    const d = dict();

    statusItemHandle = runtime.registerStatusItem({
      id: V3_IDS.STATUS_ITEM,
      label: d.statusLabel,
      tooltip: d.statusTooltip(mode, 0),
      align: 'right',
      priority: 60,
      onClick: (ev) => {
        openQuickPanel(ev?.anchorEl || null);
      },
    });

    settingsPageHandle = runtime.registerSettingsPage({
      id: V3_IDS.SETTINGS_PAGE,
      title: d.title,
      order: 60,
      width: 820,
      render: (canvasRoot, handle) => {
        if (settingsCanvasPanel) {
          settingsCanvasPanel.dispose();
          settingsCanvasPanel = null;
        }
        settingsCanvasPanel = mountNativePanelInCanvas(canvasRoot, handle, 'settings');
      },
      onClose: () => {
        if (settingsCanvasPanel) {
          settingsCanvasPanel.dispose();
          settingsCanvasPanel = null;
        }
      },
    });

    commandHandles.push(
      runtime.registerCommand(V3_IDS.CMD_OPEN_MANAGER, {
        label: d.cmdOpenManager,
        run: () => openFullModal(),
      }),
      runtime.registerCommand(V3_IDS.CMD_OPEN_PANEL, {
        label: d.cmdOpenPanel,
        run: () => openQuickPanel(),
      }),
      runtime.registerCommand(V3_IDS.CMD_OPEN_SETTINGS, {
        label: d.cmdOpenSettings,
        run: () => openSettingsPage(),
      })
    );

    unsubscribers.push(
      runtime.onStorageChange((ev) => {
        if (!ev || disposed) return;
        if (ev.key === LANG_STORAGE_KEY) {
          syncAllUi();
        } else if (ev.key === STORAGE_DRAFT_KEY) {
          void refreshSnapshot();
        }
      }),
      runtime.onThemeChange(() => {
        syncQuickPanel();
      })
    );

    if (runtime.signal && typeof runtime.signal.addEventListener === 'function') {
      const onAbort = () => dispose();
      runtime.signal.addEventListener('abort', onAbort, { once: true });
      unsubscribers.push(() => {
        try {
          runtime.signal.removeEventListener('abort', onAbort);
        } catch {}
      });
    }
    runtime.onDispose(() => dispose());

    void runtime.loadSavedLang().then(() => {
      if (!disposed) syncAllUi();
    });
    void refreshSnapshot();
  }

  return Object.freeze({
    start,
    openQuickPanel,
    openFullModal,
    openSettingsPage,
    refreshSnapshot,
    getQuickPanelHandle: () => quickPanelHandle,
    getFullModalHandle: () => fullModalHandle,
    dispose,
  });
}
