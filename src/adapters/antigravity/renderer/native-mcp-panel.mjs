/**
 * Native Shadow DOM MCP Manager CRUD Panel (`src/adapters/antigravity/renderer/native-mcp-panel.mjs`).
 *
 * SOLID Boundaries:
 * - SRP: Renders the full interactive MCP Manager UI (Global CRUD, Stdio confirmation gate,
 *   Declarative Smart Paste, Raw JSON with CAS conflict & backup restore, Read-Only Plugin
 *   list + Clone to Global, Legacy import, EN/KO switcher) inside Shadow DOM with ZERO
 *   unsafe DOM sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`).
 * - DIP: Consumes `McpManagerService` via `runtime.createConfigService()` (backed by
 *   `HostBridgeConfigStore`), remaining completely decoupled from Electron IPC or filesystem.
 */

export const NATIVE_PANEL_ATTR = 'data-agy-mcp-native-panel';

const NATIVE_PANEL_I18N = Object.freeze({
  en: Object.freeze({
    appTitle: 'MCP Manager',
    langAria: 'Language',
    loading: 'Loading…',
    bridgeConnected: 'Host Bridge Connected',
    refresh: 'Refresh',
    addServer: '+ Add Server',
    tabServers: 'Servers',
    tabRaw: 'Raw JSON',
    loadFailed: 'Failed to load MCP configuration.',
    saveFailed: 'Save failed.',
    cloneFailed: 'Clone failed.',
    importFailed: 'Import failed.',
    rawSaveFailed: 'Raw JSON save failed.',
    toggleFailed: 'Toggle failed.',
    deleteFailed: 'Delete failed.',
    restoreFailed: 'Restore failed.',
    conflictMessage: 'mcp_config.json changed on disk (Conflict). Reload latest before retrying.',
    reloadLatest: 'Reload Latest',
    confirmStdioTitle: (name) => `Confirm Local Stdio Command: ${name || ''}`,
    rawStdioPreviewName: 'mcp_config.json (Raw JSON)',
    rawStdioPreviewCmd: 'Contains Stdio command server(s)',
    confirmAndSave: 'Confirm & Save',
    cancel: 'Cancel',
    brokenJsonTitle: (loc) => `Broken mcp_config.json detected${loc}`,
    brokenJsonFallback: 'File cannot be parsed as JSON. Structured edits are blocked to prevent data loss.',
    restoreBackup: 'Restore Last Good Backup',
    smartPasteTitle: 'Declarative Smart Paste',
    smartPastePlaceholder: 'Paste mcpServers JSON or https://... Streamable HTTP URL (raw shell commands are rejected)',
    previewPaste: 'Preview Paste',
    loadIntoEditor: 'Load into Editor',
    useMcpRemoteTemplate: 'Use mcp-remote Stdio Template',
    hideQuickPaste: 'Hide',
    quickPasteBtn: 'Quick Paste JSON / URL',
    settingsSubtitle: 'Manage global MCP servers in ~/.gemini/config/mcp_config.json and inspect plugin servers.',
    kvKeyPlaceholder: 'KEY',
    kvValuePlaceholder: 'VALUE (masked)',
    remove: 'Remove',
    addKvItem: (label) => `+ Add ${label}`,
    editServerTitle: (name) => `Edit Server: ${name}`,
    addGlobalServerTitle: 'Add Global MCP Server',
    serverNameLabel: 'Server Name',
    transportLabel: 'Transport',
    transportHttpOption: 'Streamable HTTP (url)',
    transportStdioOption: 'Stdio (local command)',
    commandLabel: 'Command',
    argsLabel: 'Arguments (one per line)',
    envVarLabel: 'Environment Variable',
    endpointUrlLabel: 'Endpoint URL',
    httpHeaderLabel: 'HTTP Header',
    save: 'Save',
    legacyDetected: (count) => `Legacy config detected (${count} server(s))`,
    importNamed: (name) => `Import "${name}"`,
    dismiss: 'Dismiss',
    globalServersTitle: (count) => `Global MCP Servers (${count})`,
    pluginServersTitle: (count) => `Plugin MCP Servers (Read-Only · ${count})`,
    noGlobalServers: 'No global MCP servers configured yet.',
    statusDisabled: 'Disabled',
    statusReady: 'Ready',
    statusConfigured: 'Configured',
    toolsSuffix: (count) => ` · ${count} tools`,
    transportUnknown: 'unknown',
    enable: 'Enable',
    disable: 'Disable',
    edit: 'Edit',
    delete: 'Delete',
    pluginBadge: (name, disabled) => `Plugin · ${name}${disabled ? ' (Disabled)' : ''}`,
    collidesWithGlobal: (name) => `Collides with global "${name}"`,
    cloneToGlobal: 'Clone to Global',
    validateAndSaveRaw: 'Validate & Save Raw JSON',
  }),
  ko: Object.freeze({
    appTitle: 'MCP 매니저',
    langAria: '언어 선택',
    loading: '불러오는 중…',
    bridgeConnected: '호스트 브리지 연결됨',
    refresh: '새로고침',
    addServer: '+ 서버 추가',
    tabServers: '서버 목록',
    tabRaw: '원본 JSON',
    loadFailed: 'MCP 설정을 불러오지 못했습니다.',
    saveFailed: '저장에 실패했습니다.',
    cloneFailed: '복제에 실패했습니다.',
    importFailed: '가져오기에 실패했습니다.',
    rawSaveFailed: '원본 JSON 저장에 실패했습니다.',
    toggleFailed: '상태 변경에 실패했습니다.',
    deleteFailed: '삭제에 실패했습니다.',
    restoreFailed: '백업 복원에 실패했습니다.',
    conflictMessage: '디스크의 mcp_config.json이 변경되었습니다 (충돌). 최신 상태를 불러온 뒤 다시 시도하세요.',
    reloadLatest: '최신 상태 불러오기',
    confirmStdioTitle: (name) => `로컬 Stdio 명령 확인: ${name || ''}`,
    rawStdioPreviewName: 'mcp_config.json (원본 JSON)',
    rawStdioPreviewCmd: 'Stdio 명령어 서버가 포함되어 있습니다',
    confirmAndSave: '확인 후 저장',
    cancel: '취소',
    brokenJsonTitle: (loc) => `손상된 mcp_config.json 감지${loc}`,
    brokenJsonFallback: 'JSON 구문 오류가 있어 데이터 손실을 막기 위해 구조화 편집이 차단되었습니다.',
    restoreBackup: '마지막 정상 백업 복원',
    smartPasteTitle: '스마트 붙여넣기 (JSON / URL)',
    smartPastePlaceholder: 'mcpServers JSON 또는 https://... Streamable HTTP URL을 붙여넣으세요 (일반 셸 명령은 거부됨)',
    previewPaste: '미리보기',
    loadIntoEditor: '편집기로 불러오기',
    useMcpRemoteTemplate: 'mcp-remote Stdio 템플릿 사용',
    hideQuickPaste: '닫기',
    quickPasteBtn: 'JSON / URL 빠른 붙여넣기',
    settingsSubtitle: '~/.gemini/config/mcp_config.json의 전역 MCP 서버를 관리하고 플러그인 서버를 확인합니다.',
    kvKeyPlaceholder: '키 (KEY)',
    kvValuePlaceholder: '값 (마스킹됨)',
    remove: '제거',
    addKvItem: (label) => `+ ${label} 추가`,
    editServerTitle: (name) => `서버 편집: ${name}`,
    addGlobalServerTitle: '전역 MCP 서버 추가',
    serverNameLabel: '서버 이름',
    transportLabel: '전송 방식',
    transportHttpOption: 'Streamable HTTP (URL)',
    transportStdioOption: 'Stdio (로컬 명령어)',
    commandLabel: '명령어',
    argsLabel: '인자 (한 줄에 하나씩)',
    envVarLabel: '환경 변수',
    endpointUrlLabel: '엔드포인트 URL',
    httpHeaderLabel: 'HTTP 헤더',
    save: '저장',
    legacyDetected: (count) => `이전 설정 파일 감지됨 (서버 ${count}개)`,
    importNamed: (name) => `"${name}" 가져오기`,
    dismiss: '닫기',
    globalServersTitle: (count) => `전역 MCP 서버 (${count})`,
    pluginServersTitle: (count) => `플러그인 MCP 서버 (읽기 전용 · ${count})`,
    noGlobalServers: '등록된 전역 MCP 서버가 없습니다.',
    statusDisabled: '비활성화됨',
    statusReady: '준비됨',
    statusConfigured: '설정됨',
    toolsSuffix: (count) => ` · 도구 ${count}개`,
    transportUnknown: '알 수 없음',
    enable: '활성화',
    disable: '비활성화',
    edit: '편집',
    delete: '삭제',
    pluginBadge: (name, disabled) => `플러그인 · ${name}${disabled ? ' (비활성화됨)' : ''}`,
    collidesWithGlobal: (name) => `전역 "${name}"과 이름 충돌`,
    cloneToGlobal: '전역으로 복제',
    validateAndSaveRaw: '검증 후 원본 JSON 저장',
  }),
});

export function createNativeMcpPanel({
  runtime,
  service,
  surface = 'settings',
  onLangChange = () => {},
  doc = document,
}) {
  if (!service) {
    throw new Error('ERR_MISSING_MCP_MANAGER_SERVICE');
  }

  let disposed = false;
  let activeTab = 'servers';
  let snapshot = null;
  let bannerState = null;
  let legacyDismissed = false;
  let editorState = null;
  let pendingStdioConfirm = null;
  let pastePreview = null;
  let pasteInputDraft = '';
  let smartPasteOpen = false;
  let rawDraft = '';
  let rawDraftDirty = false;
  let snapshotRequestSeq = 0;
  let busy = false;

  function getLang() {
    const resolved =
      typeof runtime.resolveEffectiveLang === 'function'
        ? runtime.resolveEffectiveLang()
        : runtime.readSavedLang();
    return resolved === 'ko' ? 'ko' : 'en';
  }

  function t(key, ...args) {
    const lang = getLang();
    const dict = NATIVE_PANEL_I18N[lang] || NATIVE_PANEL_I18N.en;
    const entry = dict[key] !== undefined ? dict[key] : NATIVE_PANEL_I18N.en[key];
    return typeof entry === 'function' ? entry(...args) : entry;
  }

  function isImeComposing(event) {
    return Boolean(event && (event.isComposing === true || event.keyCode === 229));
  }

  function clearNode(node) {
    while (node && node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function el(tag, props, ...children) {
    const node = doc.createElement(tag);
    let deferredValue;
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'className') node.className = String(v);
        else if (k === 'value') deferredValue = String(v);
        else if (k === 'checked') node.checked = Boolean(v);
        else if (k === 'disabled') node.disabled = Boolean(v);
        else if (k === 'dataset' && typeof v === 'object') {
          for (const [dk, dv] of Object.entries(v)) {
            if (dv !== undefined && dv !== null) node.dataset[dk] = String(dv);
          }
        } else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else {
          node.setAttribute(k, v === true ? '' : String(v));
        }
      }
    }
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c !== null && c !== undefined && c !== false) {
            node.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
          }
        }
      } else {
        node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
      }
    }
    if (deferredValue !== undefined) {
      node.value = deferredValue;
    }
    return node;
  }

  const root = el('section', {
    [NATIVE_PANEL_ATTR]: 'true',
    'data-agy-mcp-surface': surface,
  });
  const shell = el('div', { className: 'mcp-shell' });
  const headerEl = el('header', { className: 'mcp-header' });
  const titleGroup = el('div', { className: 'mcp-title-group' });
  const titleEl = surface === 'settings' ? el('h1', { className: 'mcp-title' }) : null;
  const statusBadge = el('span', { className: 'mcp-badge mcp-badge-ok', dataset: { testid: 'bridge-status-badge' } });
  if (titleEl) titleGroup.appendChild(titleEl);
  titleGroup.appendChild(statusBadge);

  const actionsGroup = el('div', { className: 'mcp-header-actions' });
  const langSwitch = el('div', {
    className: 'mcp-lang-switch',
    role: 'group',
    dataset: { testid: 'lang-switch' },
  });
  const btnLangEn = el(
    'button',
    {
      type: 'button',
      className: 'mcp-lang-btn',
      'data-agy-mcp-lang-btn': 'en',
      onClick: (ev) => {
        ev.preventDefault();
        runtime.writeSavedLang('en');
        syncLang();
        onLangChange('en');
      },
    },
    'EN'
  );
  const btnLangKo = el(
    'button',
    {
      type: 'button',
      className: 'mcp-lang-btn',
      'data-agy-mcp-lang-btn': 'ko',
      onClick: (ev) => {
        ev.preventDefault();
        runtime.writeSavedLang('ko');
        syncLang();
        onLangChange('ko');
      },
    },
    '한국어'
  );
  langSwitch.appendChild(btnLangEn);
  langSwitch.appendChild(btnLangKo);

  const btnRefresh = el('button', {
    type: 'button',
    className: 'mcp-btn',
    dataset: { testid: 'btn-refresh' },
    onClick: () => void loadSnapshot(activeTab === 'raw'),
  });
  const btnAdd = el('button', {
    type: 'button',
    className: 'mcp-btn mcp-btn-primary',
    dataset: { testid: 'btn-add-server' },
    onClick: () => openEditorForServer(null),
  });
  actionsGroup.appendChild(langSwitch);
  actionsGroup.appendChild(btnRefresh);
  actionsGroup.appendChild(btnAdd);
  headerEl.appendChild(titleGroup);
  headerEl.appendChild(actionsGroup);

  const tabsEl = el('div', { className: 'mcp-tabs', role: 'tablist' });
  const tabServers = el('button', {
    type: 'button',
    className: 'mcp-tab',
    role: 'tab',
    dataset: { testid: 'tab-servers' },
    onClick: () => {
      activeTab = 'servers';
      pastePreview = null;
      scrubSensitiveState({ keepRawIfMalformed: true });
      renderAll();
    },
  });
  const tabRaw = el('button', {
    type: 'button',
    className: 'mcp-tab',
    role: 'tab',
    dataset: { testid: 'tab-raw' },
    onClick: () => {
      activeTab = 'raw';
      pastePreview = null;
      scrubSensitiveState({ keepRawIfMalformed: true });
      void loadSnapshot(true);
    },
  });
  tabsEl.appendChild(tabServers);
  tabsEl.appendChild(tabRaw);

  const bannerRegion = el('div', { className: 'mcp-banner-region' });
  const mainRegion = el('div', { className: 'mcp-main-region' });

  shell.appendChild(headerEl);
  shell.appendChild(tabsEl);
  shell.appendChild(bannerRegion);
  shell.appendChild(mainRegion);
  root.appendChild(shell);

  function scrubSensitiveState({ keepRawIfMalformed = false } = {}) {
    if (editorState) {
      editorState.envRows = [];
      editorState.headerRows = [];
      editorState = null;
    }
    pendingStdioConfirm = null;
    pasteInputDraft = '';
    if (!keepRawIfMalformed || !snapshot?.globalConfig?.malformed) {
      rawDraft = '';
      rawDraftDirty = false;
    }
  }

  function setBanner(kind, message, actions = []) {
    bannerState = { kind, message, actions };
    renderBanners();
  }

  function clearBanner() {
    bannerState = null;
    renderBanners();
  }

  function handleConflictBanner() {
    pendingStdioConfirm = null;
    bannerState = {
      kind: 'warn',
      message: t('conflictMessage'),
      actions: [
        {
          label: t('reloadLatest'),
          testid: 'btn-reload-latest',
          onClick: () => {
            clearBanner();
            void loadSnapshot(true);
          },
        },
      ],
    };
    renderAll();
  }

  function openEditorForServer(serverEntry = null) {
    pendingStdioConfirm = null;
    if (!serverEntry) {
      editorState = {
        mode: 'create',
        originalName: null,
        name: '',
        transport: 'streamable_http',
        url: '',
        command: '',
        argsText: '',
        envRows: [],
        headerRows: [],
        disabled: false,
      };
    } else {
      const spec = serverEntry.spec || {};
      const isStdio = spec.command !== undefined;
      editorState = {
        mode: 'edit',
        originalName: serverEntry.name,
        name: serverEntry.name,
        transport: isStdio ? 'stdio' : 'streamable_http',
        url: spec.url || spec.serverUrl || '',
        command: spec.command || '',
        argsText: Array.isArray(spec.args) ? spec.args.join('\n') : '',
        envRows: Object.entries(spec.env || {}).map(([k, v]) => ({ key: k, value: v })),
        headerRows: Object.entries(spec.headers || {}).map(([k, v]) => ({ key: k, value: v })),
        disabled: Boolean(serverEntry.disabled),
      };
    }
    activeTab = 'servers';
    renderAll();
  }

  function buildSpecFromEditor() {
    if (!editorState) return null;
    const spec = {};
    if (editorState.transport === 'stdio') {
      spec.command = editorState.command.trim();
      const args = editorState.argsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (args.length > 0) spec.args = args;
      const env = {};
      for (const row of editorState.envRows) {
        if (row.key.trim()) env[row.key.trim()] = row.value;
      }
      if (Object.keys(env).length > 0) spec.env = env;
    } else {
      spec.url = editorState.url.trim();
      const headers = {};
      for (const row of editorState.headerRows) {
        if (row.key.trim()) headers[row.key.trim()] = row.value;
      }
      if (Object.keys(headers).length > 0) spec.headers = headers;
    }
    if (editorState.disabled) spec.disabled = true;
    return spec;
  }

  async function loadSnapshot(includeRawText = activeTab === 'raw') {
    if (disposed) return;
    const seq = ++snapshotRequestSeq;
    busy = true;
    syncStaticLabels();
    try {
      const data = await service.getSnapshot({ includeRawText });
      if (disposed || seq !== snapshotRequestSeq) return;
      busy = false;
      if (!data || !data.ok) {
        setBanner('error', (data?.errors || [t('loadFailed')]).join(' '));
        syncStaticLabels();
        return;
      }
      snapshot = data;
      if (typeof data.globalConfig?.rawText === 'string' && (includeRawText || (!rawDraftDirty && !rawDraft))) {
        rawDraft = data.globalConfig.rawText;
        if (includeRawText) rawDraftDirty = false;
      }
      if (data.globalConfig?.malformed) {
        activeTab = 'raw';
      }
      syncStaticLabels();
      renderAll();
    } catch (err) {
      if (disposed || seq !== snapshotRequestSeq) return;
      busy = false;
      setBanner('error', err?.message || t('loadFailed'));
      syncStaticLabels();
    }
  }

  async function submitEditor(confirmStdio = false) {
    if (!editorState || !snapshot || disposed) return;
    const spec = buildSpecFromEditor();
    const payload = {
      name: editorState.name.trim(),
      originalName: editorState.originalName,
      spec,
      expectedSha256: snapshot.globalConfig.sha256,
      confirmStdio,
    };
    const data = await service.upsertServer(payload);
    if (disposed) return;
    if (data.code === 'CONFIRMATION_REQUIRED') {
      pendingStdioConfirm = {
        kind: 'upsert',
        payload,
        preview: data.confirmationPreview || { name: payload.name, command: spec.command, args: spec.args || [] },
      };
      renderAll();
      return;
    }
    if (data.code === 'CONFLICT') {
      handleConflictBanner();
      return;
    }
    if (!data.ok) {
      setBanner('error', (data.errors || [t('saveFailed')]).join(' '));
      return;
    }
    scrubSensitiveState({ keepRawIfMalformed: true });
    clearBanner();
    await loadSnapshot(activeTab === 'raw');
  }

  async function submitClonePlugin(ps, confirmStdio = false) {
    if (!snapshot || disposed) return;
    const targetName = `${ps.name}-copy`;
    const payload = {
      pluginId: ps.pluginId || null,
      pluginDir: ps.pluginDir,
      serverName: ps.name,
      targetName,
      expectedSha256: snapshot.globalConfig.sha256,
      confirmStdio,
    };
    const data = await service.clonePluginServer(payload);
    if (disposed) return;
    if (data.code === 'CONFIRMATION_REQUIRED') {
      pendingStdioConfirm = {
        kind: 'clone',
        payload,
        preview: data.confirmationPreview || { name: targetName, command: ps.spec?.command || '', args: ps.spec?.args || [] },
      };
      renderAll();
      return;
    }
    if (data.code === 'CONFLICT') {
      handleConflictBanner();
      return;
    }
    if (!data.ok) {
      setBanner('error', (data.errors || [t('cloneFailed')]).join(' '));
      return;
    }
    pendingStdioConfirm = null;
    clearBanner();
    await loadSnapshot(false);
  }

  async function submitImportLegacy(ls, confirmStdio = false) {
    if (!snapshot || disposed) return;
    const payload = {
      serverName: ls.name,
      expectedSha256: snapshot.globalConfig.sha256,
      confirmStdio,
    };
    const data = await service.importLegacyServer(payload);
    if (disposed) return;
    if (data.code === 'CONFIRMATION_REQUIRED') {
      pendingStdioConfirm = {
        kind: 'legacy',
        payload,
        preview: data.confirmationPreview || { name: ls.name, command: ls.spec?.command || '', args: ls.spec?.args || [] },
      };
      renderAll();
      return;
    }
    if (data.code === 'CONFLICT') {
      handleConflictBanner();
      return;
    }
    if (!data.ok) {
      setBanner('error', (data.errors || [t('importFailed')]).join(' '));
      return;
    }
    pendingStdioConfirm = null;
    clearBanner();
    await loadSnapshot(false);
  }

  async function submitRawJson(confirmStdio = false) {
    if (!snapshot || disposed) return;
    const payload = {
      rawText: rawDraft,
      expectedSha256: snapshot.globalConfig.sha256,
      confirmStdio,
    };
    const data = await service.saveRawJson(payload);
    if (disposed) return;
    if (data.code === 'CONFIRMATION_REQUIRED') {
      pendingStdioConfirm = {
        kind: 'raw',
        payload,
        preview: { name: t('rawStdioPreviewName'), command: t('rawStdioPreviewCmd'), args: [] },
      };
      renderAll();
      return;
    }
    if (data.code === 'CONFLICT') {
      handleConflictBanner();
      return;
    }
    if (!data.ok) {
      setBanner('error', (data.errors || [t('rawSaveFailed')]).join(' '));
      return;
    }
    pendingStdioConfirm = null;
    clearBanner();
    await loadSnapshot(true);
  }

  async function confirmPendingStdio() {
    if (!pendingStdioConfirm || disposed) return;
    const pending = pendingStdioConfirm;
    if (pending.kind === 'upsert') {
      await submitEditor(true);
    } else if (pending.kind === 'clone') {
      await submitClonePlugin(
        {
          pluginId: pending.payload.pluginId || null,
          pluginDir: pending.payload.pluginDir,
          name: pending.payload.serverName,
        },
        true
      );
    } else if (pending.kind === 'legacy') {
      await submitImportLegacy({ name: pending.payload.serverName }, true);
    } else if (pending.kind === 'raw') {
      await submitRawJson(true);
    }
  }

  async function handleToggleDisabled(server) {
    if (!snapshot || disposed) return;
    const data = await service.toggleServerDisabled({
      name: server.name,
      disabled: !server.disabled,
      expectedSha256: snapshot.globalConfig.sha256,
    });
    if (disposed) return;
    if (data.code === 'CONFLICT') {
      handleConflictBanner();
      return;
    }
    if (!data.ok) {
      setBanner('error', (data.errors || [t('toggleFailed')]).join(' '));
      return;
    }
    clearBanner();
    await loadSnapshot(false);
  }

  async function handleDelete(server) {
    if (!snapshot || disposed) return;
    const data = await service.deleteServer({
      name: server.name,
      expectedSha256: snapshot.globalConfig.sha256,
    });
    if (disposed) return;
    if (data.code === 'CONFLICT') {
      handleConflictBanner();
      return;
    }
    if (!data.ok) {
      setBanner('error', (data.errors || [t('deleteFailed')]).join(' '));
      return;
    }
    clearBanner();
    await loadSnapshot(false);
  }

  function renderStdioConfirmPanel() {
    if (!pendingStdioConfirm) return null;
    const p = pendingStdioConfirm.preview || {};
    return el(
      'div',
      { className: 'mcp-banner mcp-banner-warn', dataset: { testid: 'stdio-confirm-panel' } },
      el('strong', null, t('confirmStdioTitle', p.name)),
      el('div', { className: 'mcp-server-meta' }, `${p.command || ''} ${(p.args || []).join(' ')}`.trim()),
      el(
        'div',
        { className: 'mcp-banner-actions' },
        el(
          'button',
          {
            type: 'button',
            className: 'mcp-btn mcp-btn-primary mcp-btn-sm',
            dataset: { testid: 'btn-confirm-stdio' },
            onClick: () => void confirmPendingStdio(),
          },
          t('confirmAndSave')
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'mcp-btn mcp-btn-sm',
            dataset: { testid: 'btn-cancel-stdio' },
            onClick: () => {
              pendingStdioConfirm = null;
              renderAll();
            },
          },
          t('cancel')
        )
      )
    );
  }

  function renderBanners() {
    clearNode(bannerRegion);
    if (snapshot?.globalConfig?.malformed) {
      const err = snapshot.globalConfig.parseError;
      const loc = err?.line ? ` (line ${err.line}, col ${err.column || 1})` : '';
      const canRestore = typeof service.configStore?.restoreLastBackup === 'function';
      bannerRegion.appendChild(
        el(
          'div',
          { className: 'mcp-banner mcp-banner-error', role: 'alert', dataset: { testid: 'malformed-json-banner' } },
          el('strong', null, t('brokenJsonTitle', loc)),
          el('div', null, err?.message || t('brokenJsonFallback')),
          canRestore
            ? el(
                'div',
                { className: 'mcp-banner-actions' },
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'mcp-btn mcp-btn-sm',
                    dataset: { testid: 'btn-restore-backup' },
                    onClick: async () => {
                      const data = await service.restoreBackup({
                        expectedSha256: snapshot.globalConfig.sha256,
                      });
                      if (data.code === 'CONFLICT') handleConflictBanner();
                      else if (!data.ok) setBanner('error', (data.errors || [t('restoreFailed')]).join(' '));
                      else {
                        clearBanner();
                        await loadSnapshot(true);
                      }
                    },
                  },
                  t('restoreBackup')
                )
              )
            : null
        )
      );
    }

    if (bannerState) {
      bannerRegion.appendChild(
        el(
          'div',
          {
            className: `mcp-banner ${bannerState.kind === 'error' ? 'mcp-banner-error' : 'mcp-banner-warn'}`,
            role: 'alert',
            dataset: { testid: 'status-banner' },
          },
          el('div', null, bannerState.message),
          bannerState.actions?.length
            ? el(
                'div',
                { className: 'mcp-banner-actions' },
                bannerState.actions.map((a) =>
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'mcp-btn mcp-btn-sm',
                      dataset: a.testid ? { testid: a.testid } : undefined,
                      onClick: a.onClick,
                    },
                    a.label
                  )
                )
              )
            : null
        )
      );
    }
  }

  function renderSmartPasteCard() {
    const inputEl = el('textarea', {
      rows: '3',
      className: 'mcp-textarea',
      value: pasteInputDraft,
      placeholder: t('smartPastePlaceholder'),
      dataset: { testid: 'smart-paste-input' },
      onInput: (e) => {
        pasteInputDraft = e.target.value;
      },
      onKeydown: (e) => {
        if (isImeComposing(e)) return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          runPreview();
        }
      },
    });

    function runPreview() {
      pastePreview = service.previewSmartPaste(inputEl.value || pasteInputDraft);
      renderAll();
    }

    const previewNodes = [];
    if (pastePreview) {
      if (pastePreview.errors?.length) {
        previewNodes.push(el('div', { className: 'mcp-banner mcp-banner-error' }, pastePreview.errors.join(' ')));
      }
      for (const entry of pastePreview.entries || []) {
        previewNodes.push(
          el(
            'div',
            { className: 'mcp-card', dataset: { testid: 'paste-preview-entry' } },
            el(
              'div',
              { className: 'mcp-server-header' },
              el('span', { className: 'mcp-server-name' }, entry.name),
              el('span', { className: 'mcp-badge mcp-badge-muted' }, entry.transport || t('transportUnknown'))
            ),
            entry.warnings?.length ? el('div', { className: 'mcp-badge mcp-badge-warn' }, entry.warnings.join(' ')) : null,
            el(
              'div',
              { className: 'mcp-row-actions' },
              el(
                'button',
                {
                  type: 'button',
                  className: 'mcp-btn mcp-btn-primary mcp-btn-sm',
                  dataset: { testid: 'btn-load-paste-entry' },
                  onClick: () => {
                    openEditorForServer({ name: entry.name, spec: entry.spec, disabled: false });
                    editorState.mode = 'create';
                    editorState.originalName = null;
                    pastePreview = null;
                    renderAll();
                  },
                },
                t('loadIntoEditor')
              ),
              entry.mcpRemotePreview
                ? el(
                    'button',
                    {
                      type: 'button',
                      className: 'mcp-btn mcp-btn-sm',
                      onClick: () => {
                        openEditorForServer({ name: entry.name, spec: entry.mcpRemotePreview, disabled: false });
                        editorState.mode = 'create';
                        editorState.originalName = null;
                        pastePreview = null;
                        renderAll();
                      },
                    },
                    t('useMcpRemoteTemplate')
                  )
                : null
            )
          )
        );
      }
    }

    return el(
      'section',
      { className: 'mcp-card', dataset: { testid: 'smart-paste-card' } },
      el(
        'div',
        { className: 'mcp-server-header' },
        el('strong', null, t('smartPasteTitle')),
        el(
          'button',
          {
            type: 'button',
            className: 'mcp-btn mcp-btn-sm',
            onClick: () => {
              smartPasteOpen = false;
              pastePreview = null;
              renderAll();
            },
          },
          t('hideQuickPaste')
        )
      ),
      inputEl,
      el(
        'div',
        { className: 'mcp-row-actions' },
        el(
          'button',
          {
            type: 'button',
            className: 'mcp-btn mcp-btn-sm',
            dataset: { testid: 'btn-preview-paste' },
            onClick: runPreview,
          },
          t('previewPaste')
        )
      ),
      previewNodes
    );
  }

  function renderKvEditor(label, rows) {
    const container = el('div', { className: 'mcp-field' }, el('label', null, label));
    rows.forEach((row, idx) => {
      container.appendChild(
        el(
          'div',
          { className: 'mcp-kv-row' },
          el('input', {
            type: 'text',
            className: 'mcp-input',
            placeholder: t('kvKeyPlaceholder'),
            value: row.key,
            onInput: (e) => {
              row.key = e.target.value;
            },
          }),
          el('input', {
            type: 'password',
            className: 'mcp-input',
            autocomplete: 'off',
            placeholder: t('kvValuePlaceholder'),
            value: row.value,
            dataset: { secretInput: 'true' },
            onInput: (e) => {
              row.value = e.target.value;
            },
          }),
          el(
            'button',
            {
              type: 'button',
              className: 'mcp-btn mcp-btn-danger mcp-btn-sm',
              onClick: () => {
                rows.splice(idx, 1);
                renderAll();
              },
            },
            t('remove')
          )
        )
      );
    });
    container.appendChild(
      el(
        'button',
        {
          type: 'button',
          className: 'mcp-btn mcp-btn-sm',
          onClick: () => {
            rows.push({ key: '', value: '' });
            renderAll();
          },
        },
        t('addKvItem', label)
      )
    );
    return container;
  }

  function renderEditorCard() {
    if (!editorState) return null;
    const isStdio = editorState.transport === 'stdio';
    return el(
      'section',
      {
        className: 'mcp-card',
        dataset: { testid: 'server-editor-card' },
        onKeydown: (e) => {
          if (isImeComposing(e)) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            scrubSensitiveState({ keepRawIfMalformed: true });
            renderAll();
          }
        },
      },
      el(
        'strong',
        null,
        editorState.mode === 'edit' ? t('editServerTitle', editorState.originalName) : t('addGlobalServerTitle')
      ),
      el(
        'div',
        { className: 'mcp-field' },
        el('label', null, t('serverNameLabel')),
        el('input', {
          type: 'text',
          className: 'mcp-input',
          value: editorState.name,
          dataset: { testid: 'input-server-name' },
          onInput: (e) => {
            editorState.name = e.target.value;
          },
        })
      ),
      el(
        'div',
        { className: 'mcp-field' },
        el('label', null, t('transportLabel')),
        el(
          'select',
          {
            className: 'mcp-select',
            value: editorState.transport,
            dataset: { testid: 'select-transport' },
            onChange: (e) => {
              editorState.transport = e.target.value;
              pendingStdioConfirm = null;
              renderAll();
            },
          },
          el('option', { value: 'streamable_http', selected: !isStdio }, t('transportHttpOption')),
          el('option', { value: 'stdio', selected: isStdio }, t('transportStdioOption'))
        )
      ),
      isStdio
        ? [
            el(
              'div',
              { className: 'mcp-field' },
              el('label', null, t('commandLabel')),
              el('input', {
                type: 'text',
                className: 'mcp-input',
                value: editorState.command,
                placeholder: 'node / npx / uvx',
                dataset: { testid: 'input-stdio-command' },
                onInput: (e) => {
                  editorState.command = e.target.value;
                },
              })
            ),
            el(
              'div',
              { className: 'mcp-field' },
              el('label', null, t('argsLabel')),
              el('textarea', {
                rows: '3',
                className: 'mcp-textarea',
                value: editorState.argsText,
                dataset: { testid: 'input-stdio-args' },
                onInput: (e) => {
                  editorState.argsText = e.target.value;
                },
              })
            ),
            renderKvEditor(t('envVarLabel'), editorState.envRows),
          ]
        : [
            el(
              'div',
              { className: 'mcp-field' },
              el('label', null, t('endpointUrlLabel')),
              el('input', {
                type: 'text',
                className: 'mcp-input',
                value: editorState.url,
                placeholder: 'https://example.com/mcp',
                dataset: { testid: 'input-http-url' },
                onInput: (e) => {
                  editorState.url = e.target.value;
                },
              })
            ),
            renderKvEditor(t('httpHeaderLabel'), editorState.headerRows),
          ],
      pendingStdioConfirm?.kind === 'upsert' ? renderStdioConfirmPanel() : null,
      el(
        'div',
        { className: 'mcp-row-actions' },
        el(
          'button',
          {
            type: 'button',
            className: 'mcp-btn mcp-btn-primary',
            dataset: { testid: 'btn-save-server' },
            onClick: () => void submitEditor(false),
          },
          t('save')
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'mcp-btn',
            dataset: { testid: 'btn-cancel-editor' },
            onClick: () => {
              scrubSensitiveState({ keepRawIfMalformed: true });
              renderAll();
            },
          },
          t('cancel')
        )
      )
    );
  }

  function renderServersTab() {
    const nodes = [];
    if (pendingStdioConfirm && (pendingStdioConfirm.kind === 'clone' || pendingStdioConfirm.kind === 'legacy')) {
      nodes.push(renderStdioConfirmPanel());
    }

    if (snapshot?.legacyImport?.exists && !legacyDismissed) {
      nodes.push(
        el(
          'div',
          { className: 'mcp-banner mcp-banner-warn', dataset: { testid: 'legacy-import-banner' } },
          el('strong', null, t('legacyDetected', snapshot.legacyImport.servers.length)),
          el('div', { className: 'mcp-server-meta' }, snapshot.legacyImport.displayPath),
          el(
            'div',
            { className: 'mcp-banner-actions' },
            snapshot.legacyImport.servers.map((ls) =>
              el(
                'button',
                {
                  type: 'button',
                  className: 'mcp-btn mcp-btn-sm',
                  dataset: { testid: `btn-import-legacy-${ls.name}` },
                  onClick: () => void submitImportLegacy(ls, false),
                },
                t('importNamed', ls.name)
              )
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'mcp-btn mcp-btn-sm',
                onClick: () => {
                  legacyDismissed = true;
                  renderAll();
                },
              },
              t('dismiss')
            )
          )
        )
      );
    }

    if (editorState) {
      nodes.push(renderEditorCard());
    } else if (!snapshot?.globalConfig?.malformed) {
      if (!smartPasteOpen) {
        nodes.push(
          el(
            'div',
            { className: 'mcp-toolbar-row' },
            el('span', { className: 'mcp-subtitle' }, t('settingsSubtitle')),
            el(
              'button',
              {
                type: 'button',
                className: 'mcp-btn mcp-btn-sm',
                dataset: { testid: 'btn-toggle-smart-paste' },
                onClick: () => {
                  smartPasteOpen = true;
                  renderAll();
                },
              },
              t('quickPasteBtn')
            )
          )
        );
      } else {
        nodes.push(renderSmartPasteCard());
      }
    }

    const formatTransport = (tr) =>
      tr === 'streamable_http' ? 'HTTP' : tr === 'stdio' ? 'Stdio' : tr || t('transportUnknown');
    const globalServers = snapshot?.globalConfig?.servers || [];
    nodes.push(el('h2', { className: 'mcp-section-title' }, t('globalServersTitle', globalServers.length)));
    const globalList = el('div', { className: 'mcp-server-list' });
    for (const s of globalServers) {
      const rtStatus = s.disabled
        ? t('statusDisabled')
        : s.runtime?.status === 'MCP_SERVER_STATUS_READY'
          ? t('statusReady')
          : s.runtime?.status || t('statusConfigured');
      const badgeClass = s.disabled
        ? 'mcp-badge-muted'
        : s.runtime?.error
          ? 'mcp-badge-err'
          : s.runtime?.status === 'MCP_SERVER_STATUS_READY'
            ? 'mcp-badge-ok'
            : 'mcp-badge-muted';
      globalList.appendChild(
        el(
          'div',
          {
            className: `mcp-server-row${s.disabled ? ' mcp-row-disabled' : ''}`,
            dataset: { testid: `global-server-${s.name}` },
          },
          el(
            'div',
            { className: 'mcp-server-info' },
            el(
              'div',
              { className: 'mcp-server-header' },
              el('span', { className: 'mcp-server-name' }, s.name),
              el(
                'div',
                { className: 'mcp-server-badges' },
                el(
                  'span',
                  { className: `mcp-badge ${badgeClass}` },
                  `${rtStatus}${s.runtime?.toolCount ? t('toolsSuffix', s.runtime.toolCount) : ''}`
                ),
                el('span', { className: 'mcp-badge mcp-badge-muted' }, formatTransport(s.transport))
              )
            ),
            el('div', { className: 'mcp-server-meta' }, s.spec?.url || s.spec?.serverUrl || s.spec?.command || ''),
            s.runtime?.error ? el('div', { className: 'mcp-badge mcp-badge-err' }, s.runtime.error) : null
          ),
          el(
            'div',
            { className: 'mcp-row-actions mcp-server-row-actions' },
            el(
              'button',
              {
                type: 'button',
                className: 'mcp-btn mcp-btn-sm',
                dataset: { testid: `btn-toggle-${s.name}` },
                onClick: () => void handleToggleDisabled(s),
              },
              s.disabled ? t('enable') : t('disable')
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'mcp-btn mcp-btn-sm',
                dataset: { testid: `btn-edit-${s.name}` },
                onClick: () => openEditorForServer(s),
              },
              t('edit')
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'mcp-btn mcp-btn-danger mcp-btn-sm',
                dataset: { testid: `btn-delete-${s.name}` },
                onClick: () => void handleDelete(s),
              },
              t('delete')
            )
          )
        )
      );
    }
    if (globalServers.length === 0) {
      globalList.appendChild(el('div', { className: 'mcp-empty-row' }, t('noGlobalServers')));
    }
    nodes.push(globalList);

    const pluginServers = snapshot?.pluginServers || [];
    if (pluginServers.length > 0) {
      nodes.push(el('h2', { className: 'mcp-section-title' }, t('pluginServersTitle', pluginServers.length)));
      const pluginList = el('div', { className: 'mcp-server-list' });
      for (const ps of pluginServers) {
        const collision = (snapshot.collisions?.pluginCollisions || []).find(
          (c) => c.pluginDir === ps.pluginDir && c.serverName === ps.name
        );
        const safePluginKey = String(ps.pluginId || ps.pluginDir).replace(/[^a-zA-Z0-9_-]/g, '-');
        pluginList.appendChild(
          el(
            'div',
            { className: 'mcp-server-row', dataset: { testid: `plugin-server-${safePluginKey}-${ps.name}` } },
            el(
              'div',
              { className: 'mcp-server-info' },
              el(
                'div',
                { className: 'mcp-server-header' },
                el('span', { className: 'mcp-server-name' }, ps.name),
                el(
                  'div',
                  { className: 'mcp-server-badges' },
                  el('span', { className: 'mcp-badge mcp-badge-muted' }, t('pluginBadge', ps.pluginName, ps.pluginDisabled)),
                  collision ? el('span', { className: 'mcp-badge mcp-badge-warn' }, t('collidesWithGlobal', collision.globalName)) : null
                )
              ),
              el('div', { className: 'mcp-server-meta' }, ps.spec?.url || ps.spec?.serverUrl || ps.spec?.command || '')
            ),
            el(
              'div',
              { className: 'mcp-row-actions mcp-server-row-actions' },
              el(
                'button',
                {
                  type: 'button',
                  className: 'mcp-btn mcp-btn-sm',
                  dataset: { testid: `btn-clone-${safePluginKey}-${ps.name}` },
                  onClick: () => void submitClonePlugin(ps, false),
                },
                t('cloneToGlobal')
              )
            )
          )
        );
      }
      nodes.push(pluginList);
    }

    return nodes;
  }

  function renderRawTab() {
    const ta = el('textarea', {
      className: 'mcp-textarea mcp-mono',
      value: rawDraft,
      dataset: { testid: 'raw-json-textarea' },
      onInput: (e) => {
        rawDraft = e.target.value;
        rawDraftDirty = true;
      },
    });
    return [
      el(
        'section',
        { className: 'mcp-card' },
        el('strong', null, snapshot?.globalConfig?.displayPath || '~/.gemini/config/mcp_config.json'),
        ta,
        pendingStdioConfirm?.kind === 'raw' ? renderStdioConfirmPanel() : null,
        el(
          'div',
          { className: 'mcp-row-actions' },
          el(
            'button',
            {
              type: 'button',
              className: 'mcp-btn mcp-btn-primary',
              dataset: { testid: 'btn-save-raw' },
              onClick: () => void submitRawJson(false),
            },
            t('validateAndSaveRaw')
          )
        )
      ),
    ];
  }

  function syncStaticLabels() {
    const lang = getLang();
    root.setAttribute('data-agy-mcp-lang', lang);
    if (titleEl) titleEl.textContent = t('appTitle');
    statusBadge.textContent = busy && !snapshot ? t('loading') : t('bridgeConnected');
    langSwitch.setAttribute('aria-label', t('langAria'));
    btnLangEn.setAttribute('aria-pressed', lang === 'en' ? 'true' : 'false');
    btnLangKo.setAttribute('aria-pressed', lang === 'ko' ? 'true' : 'false');
    btnRefresh.textContent = t('refresh');
    btnAdd.textContent = t('addServer');
    tabServers.textContent = t('tabServers');
    tabRaw.textContent = t('tabRaw');
  }

  function renderAll() {
    if (disposed) return;
    tabServers.classList.toggle('active', activeTab === 'servers');
    tabServers.setAttribute('aria-selected', String(activeTab === 'servers'));
    tabRaw.classList.toggle('active', activeTab === 'raw');
    tabRaw.setAttribute('aria-selected', String(activeTab === 'raw'));
    renderBanners();
    clearNode(mainRegion);
    const content = activeTab === 'raw' ? renderRawTab() : renderServersTab();
    for (const node of content) {
      if (node) mainRegion.appendChild(node);
    }
  }

  function syncLang() {
    if (disposed) return;
    syncStaticLabels();
    renderAll();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scrubSensitiveState({ keepRawIfMalformed: false });
    clearNode(root);
  }

  syncStaticLabels();
  renderAll();
  void loadSnapshot(false);

  return Object.freeze({
    element: root,
    syncLang,
    refresh: () => loadSnapshot(activeTab === 'raw'),
    dispose,
  });
}
