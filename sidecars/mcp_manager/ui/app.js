/**
 * Antigravity 2.0 AUX_PANE MCP Manager UI (`sidecars/mcp_manager/ui/app.js`).
 *
 * Security & UX Invariants:
 * 1. ZERO unsafe DOM sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`).
 * 2. All API requests use `POST` via `x-sidecar-token`.
 * 3. Secret inputs default to `type="password"` and scrub on close/cancel/beforeunload.
 * 4. Clone-to-Global uses `/api/clone-plugin` and Legacy Import uses `/api/import-legacy`
 *    directly (NEVER sends masked `'••••••••'` secrets into `/api/upsert`).
 * 5. Raw JSON save requires explicit user confirmation when Stdio commands exist (no hardcoded bypass).
 * 6. Korean/CJK IME guard (`e.isComposing || e.keyCode === 229`) on Enter/Escape handlers.
 * 7. Validates `event.source === window.parent` on postMessage workspace updates.
 */

(function () {
  'use strict';

  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token') || '';
  const isSettingsMode = urlParams.get('hostMode') === 'settings';
  (() => {
    const hostFont = urlParams.get('hostFont');
    if (hostFont && /^[a-zA-Z0-9\s,'"._-]{1,240}$/.test(hostFont)) {
      document.documentElement.style.setProperty('--font-family', hostFont);
    }
    const safeColor = (v) => typeof v === 'string' && /^(?:#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]+\))$/.test(v.trim());
    const hostBg = urlParams.get('hostBg');
    if (safeColor(hostBg)) document.documentElement.style.setProperty('--background', hostBg.trim());
    const hostFg = urlParams.get('hostFg');
    if (safeColor(hostFg)) document.documentElement.style.setProperty('--foreground', hostFg.trim());
    if (isSettingsMode && document.body) {
      document.body.classList.add('host-settings-mode');
    }
  })();
  const LANG_STORAGE_KEY = 'agy-mcp-manager-lang';
  const I18N = {
    en: {
      appTitle: 'MCP Manager',
      langAria: 'Language',
      connecting: 'Connecting…',
      lsConnected: 'LS Connected',
      offlineConfigOnly: 'Offline (Config Only)',
      refresh: 'Refresh',
      addServer: '+ Add Server',
      tabServers: 'Servers',
      tabRaw: 'Raw JSON',
      networkFailed: 'Network request failed',
      loadFailed: 'Failed to load MCP configuration',
      saveFailed: 'Save failed',
      cloneFailed: 'Clone failed',
      importFailed: 'Import failed',
      rawSaveFailed: 'Raw JSON save failed',
      toggleFailed: 'Toggle failed',
      deleteFailed: 'Delete failed',
      restoreFailed: 'Restore failed',
      conflictMessage: 'mcp_config.json changed on disk (409 Conflict). Reload before retrying.',
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
      settingsSubtitle: 'Manage global MCP servers in mcp_config.json and inspect plugin servers.',
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
    },
    ko: {
      appTitle: 'MCP 매니저',
      langAria: '언어 선택',
      connecting: '연결 중…',
      lsConnected: 'LS 연결됨',
      offlineConfigOnly: '오프라인 (설정 전용)',
      refresh: '새로고침',
      addServer: '+ 서버 추가',
      tabServers: '서버 목록',
      tabRaw: '원본 JSON',
      networkFailed: '네트워크 요청에 실패했습니다.',
      loadFailed: 'MCP 설정을 불러오지 못했습니다.',
      saveFailed: '저장에 실패했습니다.',
      cloneFailed: '복제에 실패했습니다.',
      importFailed: '가져오기에 실패했습니다.',
      rawSaveFailed: '원본 JSON 저장에 실패했습니다.',
      toggleFailed: '상태 변경에 실패했습니다.',
      deleteFailed: '삭제에 실패했습니다.',
      restoreFailed: '백업 복원에 실패했습니다.',
      conflictMessage: '디스크의 mcp_config.json이 변경되었습니다 (409 충돌). 최신 상태를 불러온 뒤 다시 시도하세요.',
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
      settingsSubtitle: 'mcp_config.json의 전역 MCP 서버를 관리하고 플러그인 서버를 확인합니다.',
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
    },
  };

  function resolveInitialLang() {
    const queryLang = urlParams.get('lang');
    if (queryLang === 'ko' || queryLang === 'en') {
      try {
        window.localStorage?.setItem(LANG_STORAGE_KEY, queryLang);
      } catch {
        // Ignore storage errors
      }
      return queryLang;
    }
    try {
      const saved = window.localStorage?.getItem(LANG_STORAGE_KEY);
      if (saved === 'ko' || saved === 'en') return saved;
    } catch {
      // Ignore storage errors
    }
    return 'en';
  }

  let currentLang = resolveInitialLang();

  function t(key, ...args) {
    const dict = I18N[currentLang] || I18N.en;
    const entry = dict[key] !== undefined ? dict[key] : I18N.en[key];
    return typeof entry === 'function' ? entry(...args) : entry;
  }

  let workspaceUris = [];
  let activeTab = 'servers';
  let snapshot = null;
  let bannerState = null;
  let legacyDismissed = false;
  let editorState = null;
  let pendingStdioConfirm = null; // { kind: 'upsert'|'clone'|'legacy'|'raw', payload, preview }
  let pastePreview = null;
  let pasteInputDraft = '';
  let smartPasteOpen = !isSettingsMode;
  let rawDraft = '';
  let rawDraftDirty = false;
  let snapshotRequestSeq = 0;

  const appTitleEl = document.getElementById('app-title');
  const mainRegion = document.getElementById('main-region');
  const bannerRegion = document.getElementById('banner-region');
  const runtimeBadge = document.getElementById('runtime-badge');
  const tabServers = document.getElementById('tab-servers');
  const tabRaw = document.getElementById('tab-raw');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnAdd = document.getElementById('btn-add');
  const btnLangEn = document.getElementById('btn-lang-en');
  const btnLangKo = document.getElementById('btn-lang-ko');
  const langSwitchEl = document.querySelector('[data-testid="lang-switch"]');

  function syncRuntimeBadge() {
    if (!snapshot) {
      runtimeBadge.textContent = t('connecting');
      runtimeBadge.className = 'badge badge-muted';
      return;
    }
    if (isSettingsMode && !snapshot.runtimeAvailable) {
      runtimeBadge.textContent = '';
      runtimeBadge.style.display = 'none';
    } else {
      runtimeBadge.style.display = '';
      runtimeBadge.textContent = snapshot.runtimeAvailable ? t('lsConnected') : t('offlineConfigOnly');
      runtimeBadge.className = `badge ${snapshot.runtimeAvailable ? 'badge-ok' : 'badge-muted'}`;
    }
  }

  function applyStaticTranslations() {
    document.documentElement.lang = currentLang;
    document.title = t('appTitle');
    if (appTitleEl) appTitleEl.textContent = t('appTitle');
    if (langSwitchEl) langSwitchEl.setAttribute('aria-label', t('langAria'));
    if (btnRefresh) btnRefresh.textContent = t('refresh');
    if (btnAdd) btnAdd.textContent = t('addServer');
    if (tabServers) tabServers.textContent = t('tabServers');
    if (tabRaw) tabRaw.textContent = t('tabRaw');
    if (btnLangEn) {
      btnLangEn.classList.toggle('active', currentLang === 'en');
      btnLangEn.setAttribute('aria-pressed', String(currentLang === 'en'));
    }
    if (btnLangKo) {
      btnLangKo.classList.toggle('active', currentLang === 'ko');
      btnLangKo.setAttribute('aria-pressed', String(currentLang === 'ko'));
    }
    syncRuntimeBadge();
  }

  function setLanguage(nextLang) {
    if (nextLang !== 'en' && nextLang !== 'ko') return;
    currentLang = nextLang;
    try {
      window.localStorage?.setItem(LANG_STORAGE_KEY, nextLang);
    } catch {
      // Ignore storage errors
    }
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ type: 'agy-mcp-lang-change', lang: nextLang }, '*');
      } catch {
        // Ignore cross-origin postMessage errors
      }
    }
    applyStaticTranslations();
    renderAll();
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
    const node = document.createElement(tag);
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
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
          }
        }
      } else {
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      }
    }
    if (deferredValue !== undefined) {
      node.value = deferredValue;
    }
    return node;
  }

  async function apiPost(route, payload = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-sidecar-token'] = token;
    try {
      const res = await fetch(route, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const raw = await res.json().catch(() => ({ ok: false, errors: [`HTTP ${res.status}`] }));
      const data = raw && typeof raw === 'object' ? raw : { ok: false, errors: [`HTTP ${res.status}`] };
      if (!data.ok && !Array.isArray(data.errors) && typeof data.error === 'string') {
        data.errors = [data.error];
      }
      return { status: res.status, data };
    } catch (err) {
      return {
        status: 0,
        data: { ok: false, errors: [err?.message || t('networkFailed')] },
      };
    }
  }

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
        { label: t('reloadLatest'), onClick: () => { clearBanner(); void loadSnapshot(true); } },
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
    const seq = ++snapshotRequestSeq;
    const { data } = await apiPost('/api/snapshot', {
      workspaceUris,
      includeRawText,
    });
    if (seq !== snapshotRequestSeq) return;
    if (!data || !data.ok) {
      setBanner('error', (data?.errors || [t('loadFailed')]).join(' '));
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
    syncRuntimeBadge();
    renderAll();
  }

  async function submitEditor(confirmStdio = false) {
    if (!editorState || !snapshot) return;
    const spec = buildSpecFromEditor();
    const payload = {
      name: editorState.name.trim(),
      originalName: editorState.originalName,
      spec,
      expectedSha256: snapshot.globalConfig.sha256,
      confirmStdio,
    };
    const { status, data } = await apiPost('/api/upsert', payload);
    if (status === 428 || data.code === 'CONFIRMATION_REQUIRED') {
      pendingStdioConfirm = {
        kind: 'upsert',
        payload,
        preview: data.confirmationPreview || { name: payload.name, command: spec.command, args: spec.args || [] },
      };
      renderAll();
      return;
    }
    if (status === 409 || data.code === 'CONFLICT') {
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
    if (!snapshot) return;
    const targetName = `${ps.name}-copy`;
    const payload = {
      pluginId: ps.pluginId || null,
      pluginDir: ps.pluginDir,
      serverName: ps.name,
      targetName,
      workspaceUris,
      expectedSha256: snapshot.globalConfig.sha256,
      confirmStdio,
    };
    const { status, data } = await apiPost('/api/clone-plugin', payload);
    if (status === 428 || data.code === 'CONFIRMATION_REQUIRED') {
      pendingStdioConfirm = {
        kind: 'clone',
        payload,
        preview: data.confirmationPreview || { name: targetName, command: ps.spec?.command || '', args: ps.spec?.args || [] },
      };
      renderAll();
      return;
    }
    if (status === 409 || data.code === 'CONFLICT') {
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
    if (!snapshot) return;
    const payload = {
      serverName: ls.name,
      expectedSha256: snapshot.globalConfig.sha256,
      confirmStdio,
    };
    const { status, data } = await apiPost('/api/import-legacy', payload);
    if (status === 428 || data.code === 'CONFIRMATION_REQUIRED') {
      pendingStdioConfirm = {
        kind: 'legacy',
        payload,
        preview: data.confirmationPreview || { name: ls.name, command: ls.spec?.command || '', args: ls.spec?.args || [] },
      };
      renderAll();
      return;
    }
    if (status === 409 || data.code === 'CONFLICT') {
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
    if (!snapshot) return;
    const payload = {
      rawText: rawDraft,
      expectedSha256: snapshot.globalConfig.sha256,
      confirmStdio,
    };
    const { status, data } = await apiPost('/api/save-raw', payload);
    if (status === 428 || data.code === 'CONFIRMATION_REQUIRED') {
      pendingStdioConfirm = {
        kind: 'raw',
        payload,
        preview: { name: t('rawStdioPreviewName'), command: t('rawStdioPreviewCmd'), args: [] },
      };
      renderAll();
      return;
    }
    if (status === 409 || data.code === 'CONFLICT') {
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
    if (!pendingStdioConfirm) return;
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
    const { status, data } = await apiPost('/api/toggle-disabled', {
      name: server.name,
      disabled: !server.disabled,
      expectedSha256: snapshot.globalConfig.sha256,
    });
    if (status === 409 || data.code === 'CONFLICT') {
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
    const { status, data } = await apiPost('/api/delete', {
      name: server.name,
      expectedSha256: snapshot.globalConfig.sha256,
    });
    if (status === 409 || data.code === 'CONFLICT') {
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
      { className: 'banner banner-warn', dataset: { testid: 'stdio-confirm-panel' } },
      el('strong', null, t('confirmStdioTitle', p.name)),
      el('div', { className: 'server-meta' }, `${p.command || ''} ${(p.args || []).join(' ')}`.trim()),
      el(
        'div',
        { className: 'banner-actions' },
        el('button', {
          type: 'button',
          className: 'btn btn-primary btn-sm',
          dataset: { testid: 'btn-confirm-stdio' },
          onClick: () => void confirmPendingStdio(),
        }, t('confirmAndSave')),
        el('button', {
          type: 'button',
          className: 'btn btn-sm',
          dataset: { testid: 'btn-cancel-stdio' },
          onClick: () => { pendingStdioConfirm = null; renderAll(); },
        }, t('cancel'))
      )
    );
  }

  function renderBanners() {
    clearNode(bannerRegion);
    if (snapshot?.globalConfig?.malformed) {
      const err = snapshot.globalConfig.parseError;
      const loc = err?.line ? ` (line ${err.line}, col ${err.column || 1})` : '';
      bannerRegion.appendChild(
        el(
          'div',
          { className: 'banner banner-error', role: 'alert', dataset: { testid: 'malformed-json-banner' } },
          el('strong', null, t('brokenJsonTitle', loc)),
          el('div', null, err?.message || t('brokenJsonFallback')),
          el(
            'div',
            { className: 'banner-actions' },
            el('button', {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              dataset: { testid: 'btn-restore-backup' },
              onClick: async () => {
                const { status, data } = await apiPost('/api/restore-backup', {
                  expectedSha256: snapshot.globalConfig.sha256,
                });
                if (status === 409 || data.code === 'CONFLICT') handleConflictBanner();
                else if (!data.ok) setBanner('error', (data.errors || [t('restoreFailed')]).join(' '));
                else { clearBanner(); await loadSnapshot(true); }
              },
            }, t('restoreBackup'))
          )
        )
      );
    }

    if (bannerState) {
      bannerRegion.appendChild(
        el(
          'div',
          {
            className: `banner ${bannerState.kind === 'error' ? 'banner-error' : 'banner-warn'}`,
            role: 'alert',
            dataset: { testid: 'status-banner' },
          },
          el('div', null, bannerState.message),
          bannerState.actions?.length
            ? el(
                'div',
                { className: 'banner-actions' },
                bannerState.actions.map((a) =>
                  el('button', { type: 'button', className: 'btn btn-sm', onClick: a.onClick }, a.label)
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
      value: pasteInputDraft,
      placeholder: t('smartPastePlaceholder'),
      dataset: { testid: 'smart-paste-input' },
      onInput: (e) => { pasteInputDraft = e.target.value; },
      onKeydown: (e) => {
        if (isImeComposing(e)) return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          void runPreview();
        }
      },
    });

    async function runPreview() {
      const { data } = await apiPost('/api/preview-paste', { rawInput: inputEl.value || pasteInputDraft });
      pastePreview = data;
      renderAll();
    }

    const previewNodes = [];
    if (pastePreview) {
      if (pastePreview.errors?.length) {
        previewNodes.push(el('div', { className: 'banner banner-error' }, pastePreview.errors.join(' ')));
      }
      for (const entry of pastePreview.entries || []) {
        previewNodes.push(
          el(
            'div',
            { className: 'card', dataset: { testid: 'paste-preview-entry' } },
            el('div', { className: 'server-header' },
              el('span', { className: 'server-name' }, entry.name),
              el('span', { className: 'badge badge-muted' }, entry.transport || t('transportUnknown'))
            ),
            entry.warnings?.length ? el('div', { className: 'badge badge-warn' }, entry.warnings.join(' ')) : null,
            el(
              'div',
              { className: 'row-actions' },
              el('button', {
                type: 'button',
                className: 'btn btn-primary btn-sm',
                onClick: () => {
                  openEditorForServer({ name: entry.name, spec: entry.spec, disabled: false });
                  editorState.mode = 'create';
                  editorState.originalName = null;
                  pastePreview = null;
                  renderAll();
                },
              }, t('loadIntoEditor')),
              entry.mcpRemotePreview
                ? el('button', {
                    type: 'button',
                    className: 'btn btn-secondary btn-sm',
                    onClick: () => {
                      openEditorForServer({ name: entry.name, spec: entry.mcpRemotePreview, disabled: false });
                      editorState.mode = 'create';
                      editorState.originalName = null;
                      pastePreview = null;
                      renderAll();
                    },
                  }, t('useMcpRemoteTemplate'))
                : null
            )
          )
        );
      }
    }

    return el(
      'section',
      { className: 'card' },
      el('div', { className: 'server-header' },
        el('strong', null, t('smartPasteTitle')),
        isSettingsMode
          ? el('button', {
              type: 'button',
              className: 'btn btn-sm',
              onClick: () => { smartPasteOpen = false; pastePreview = null; renderAll(); },
            }, t('hideQuickPaste'))
          : null
      ),
      inputEl,
      el(
        'div',
        { className: 'row-actions' },
        el('button', { type: 'button', className: 'btn btn-secondary btn-sm', dataset: { testid: 'btn-preview-paste' }, onClick: runPreview }, t('previewPaste'))
      ),
      previewNodes
    );
  }

  function renderKvEditor(label, rows, onChange) {
    const container = el('div', { className: 'field' }, el('label', null, label));
    rows.forEach((row, idx) => {
      container.appendChild(
        el(
          'div',
          { className: 'kv-row' },
          el('input', {
            type: 'text',
            placeholder: t('kvKeyPlaceholder'),
            value: row.key,
            onInput: (e) => { row.key = e.target.value; onChange(); },
          }),
          el('input', {
            type: 'password',
            autocomplete: 'off',
            placeholder: t('kvValuePlaceholder'),
            value: row.value,
            dataset: { secretInput: 'true' },
            onInput: (e) => { row.value = e.target.value; onChange(); },
          }),
          el('button', {
            type: 'button',
            className: 'btn btn-danger btn-sm',
            onClick: () => { rows.splice(idx, 1); renderAll(); },
          }, t('remove'))
        )
      );
    });
    container.appendChild(
      el('button', {
        type: 'button',
        className: 'btn btn-secondary btn-sm',
        onClick: () => { rows.push({ key: '', value: '' }); renderAll(); },
      }, t('addKvItem', label))
    );
    return container;
  }

  function renderEditorCard() {
    if (!editorState) return null;
    const isStdio = editorState.transport === 'stdio';
    return el(
      'section',
      {
        className: 'card',
        dataset: { testid: 'server-editor-card' },
        onKeydown: (e) => {
          if (isImeComposing(e)) return;
          if (e.key === 'Escape') {
            scrubSensitiveState({ keepRawIfMalformed: true });
            renderAll();
          }
        },
      },
      el('strong', null, editorState.mode === 'edit' ? t('editServerTitle', editorState.originalName) : t('addGlobalServerTitle')),
      el('div', { className: 'field' },
        el('label', null, t('serverNameLabel')),
        el('input', {
          type: 'text',
          value: editorState.name,
          dataset: { testid: 'input-server-name' },
          onInput: (e) => { editorState.name = e.target.value; },
        })
      ),
      el('div', { className: 'field' },
        el('label', null, t('transportLabel')),
        el(
          'select',
          {
            value: editorState.transport,
            onChange: (e) => { editorState.transport = e.target.value; pendingStdioConfirm = null; renderAll(); },
          },
          el('option', { value: 'streamable_http', selected: !isStdio }, t('transportHttpOption')),
          el('option', { value: 'stdio', selected: isStdio }, t('transportStdioOption'))
        )
      ),
      isStdio
        ? [
            el('div', { className: 'field' },
              el('label', null, t('commandLabel')),
              el('input', { type: 'text', value: editorState.command, placeholder: 'node / npx / uvx', onInput: (e) => { editorState.command = e.target.value; } })
            ),
            el('div', { className: 'field' },
              el('label', null, t('argsLabel')),
              el('textarea', { rows: '3', value: editorState.argsText, onInput: (e) => { editorState.argsText = e.target.value; } })
            ),
            renderKvEditor(t('envVarLabel'), editorState.envRows, () => {}),
          ]
        : [
            el('div', { className: 'field' },
              el('label', null, t('endpointUrlLabel')),
              el('input', { type: 'text', value: editorState.url, placeholder: 'https://example.com/mcp', onInput: (e) => { editorState.url = e.target.value; } })
            ),
            renderKvEditor(t('httpHeaderLabel'), editorState.headerRows, () => {}),
          ],
      pendingStdioConfirm?.kind === 'upsert' ? renderStdioConfirmPanel() : null,
      el(
        'div',
        { className: 'row-actions' },
        el('button', { type: 'button', className: 'btn btn-primary', dataset: { testid: 'btn-save-server' }, onClick: () => void submitEditor(false) }, t('save')),
        el('button', { type: 'button', className: 'btn', onClick: () => { scrubSensitiveState({ keepRawIfMalformed: true }); renderAll(); } }, t('cancel'))
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
          { className: 'banner banner-warn', dataset: { testid: 'legacy-import-banner' } },
          el('strong', null, t('legacyDetected', snapshot.legacyImport.servers.length)),
          el('div', { className: 'server-meta' }, snapshot.legacyImport.displayPath),
          el(
            'div',
            { className: 'banner-actions' },
            snapshot.legacyImport.servers.map((ls) =>
              el('button', {
                type: 'button',
                className: 'btn btn-sm',
                dataset: { testid: `btn-import-legacy-${ls.name}` },
                onClick: () => void submitImportLegacy(ls, false),
              }, t('importNamed', ls.name))
            ),
            el('button', { type: 'button', className: 'btn btn-sm', onClick: () => { legacyDismissed = true; renderAll(); } }, t('dismiss'))
          )
        )
      );
    }

    if (editorState) {
      nodes.push(renderEditorCard());
    } else if (!snapshot?.globalConfig?.malformed) {
      if (isSettingsMode && !smartPasteOpen) {
        nodes.push(
          el(
            'div',
            { className: 'settings-toolbar-row' },
            el('span', { className: 'settings-subtitle' }, t('settingsSubtitle')),
            el('button', {
              type: 'button',
              className: 'btn btn-sm',
              dataset: { testid: 'btn-toggle-smart-paste' },
              onClick: () => { smartPasteOpen = true; renderAll(); },
            }, t('quickPasteBtn'))
          )
        );
      } else {
        nodes.push(renderSmartPasteCard());
      }
    }

    const formatTransport = (tr) => (tr === 'streamable_http' ? 'HTTP' : tr === 'stdio' ? 'Stdio' : tr || t('transportUnknown'));
    nodes.push(el('h2', { className: 'section-title' }, t('globalServersTitle', snapshot?.globalConfig?.servers?.length || 0)));
    const globalList = el('div', { className: 'server-list' });
    for (const s of snapshot?.globalConfig?.servers || []) {
      const rtStatus = s.disabled
        ? t('statusDisabled')
        : s.runtime?.status === 'MCP_SERVER_STATUS_READY'
          ? t('statusReady')
          : s.runtime?.status || t('statusConfigured');
      const badgeClass = s.disabled ? 'badge-muted' : s.runtime?.error ? 'badge-err' : s.runtime?.status === 'MCP_SERVER_STATUS_READY' ? 'badge-ok' : 'badge-muted';
      globalList.appendChild(
        el(
          'div',
          { className: `card${s.disabled ? ' card-disabled' : ''}`, dataset: { testid: `global-server-${s.name}` } },
          el(
            'div',
            { className: 'server-info' },
            el('div', { className: 'server-header' },
              el('span', { className: 'server-name' }, s.name),
              el('div', { className: 'server-badges' },
                el('span', { className: `badge ${badgeClass}` }, `${rtStatus}${s.runtime?.toolCount ? t('toolsSuffix', s.runtime.toolCount) : ''}`),
                el('span', { className: 'badge badge-muted' }, formatTransport(s.transport))
              )
            ),
            el('div', { className: 'server-meta' }, s.spec?.url || s.spec?.serverUrl || s.spec?.command || ''),
            s.runtime?.error ? el('div', { className: 'badge badge-err' }, s.runtime.error) : null
          ),
          el('div', { className: 'row-actions server-row-actions' },
            el('button', { type: 'button', className: 'btn btn-sm', onClick: () => void handleToggleDisabled(s) }, s.disabled ? t('enable') : t('disable')),
            el('button', { type: 'button', className: 'btn btn-sm', onClick: () => openEditorForServer(s) }, t('edit')),
            el('button', { type: 'button', className: 'btn btn-danger btn-sm', onClick: () => void handleDelete(s) }, t('delete'))
          )
        )
      );
    }
    if ((snapshot?.globalConfig?.servers || []).length === 0) {
      globalList.appendChild(el('div', { className: 'card' }, t('noGlobalServers')));
    }
    nodes.push(globalList);

    if ((snapshot?.pluginServers || []).length > 0) {
      nodes.push(el('h2', { className: 'section-title' }, t('pluginServersTitle', snapshot.pluginServers.length)));
      const pluginList = el('div', { className: 'server-list' });
      for (const ps of snapshot.pluginServers) {
        const collision = (snapshot.collisions?.pluginCollisions || []).find(
          (c) => c.pluginDir === ps.pluginDir && c.serverName === ps.name
        );
        const safePluginKey = String(ps.pluginId || ps.pluginDir).replace(/[^a-zA-Z0-9_-]/g, '-');
        pluginList.appendChild(
          el(
            'div',
            { className: 'card', dataset: { testid: `plugin-server-${safePluginKey}-${ps.name}` } },
            el(
              'div',
              { className: 'server-info' },
              el('div', { className: 'server-header' },
                el('span', { className: 'server-name' }, ps.name),
                el('div', { className: 'server-badges' },
                  el('span', { className: 'badge badge-muted' }, t('pluginBadge', ps.pluginName, ps.pluginDisabled)),
                  collision ? el('span', { className: 'badge badge-warn' }, t('collidesWithGlobal', collision.globalName)) : null
                )
              ),
              el('div', { className: 'server-meta' }, ps.spec?.url || ps.spec?.serverUrl || ps.spec?.command || '')
            ),
            el('div', { className: 'row-actions server-row-actions' },
              el('button', {
                type: 'button',
                className: 'btn btn-sm',
                dataset: { testid: `btn-clone-${safePluginKey}-${ps.name}` },
                onClick: () => void submitClonePlugin(ps, false),
              }, t('cloneToGlobal'))
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
      className: 'mono',
      value: rawDraft,
      dataset: { testid: 'raw-json-textarea' },
      onInput: (e) => { rawDraft = e.target.value; rawDraftDirty = true; },
    });
    return [
      el(
        'section',
        { className: 'card' },
        el('strong', null, snapshot?.globalConfig?.displayPath || '~/.gemini/config/mcp_config.json'),
        ta,
        pendingStdioConfirm?.kind === 'raw' ? renderStdioConfirmPanel() : null,
        el(
          'div',
          { className: 'row-actions' },
          el('button', {
            type: 'button',
            className: 'btn btn-primary',
            dataset: { testid: 'btn-save-raw' },
            onClick: () => void submitRawJson(false),
          }, t('validateAndSaveRaw'))
        )
      ),
    ];
  }

  function renderAll() {
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

  tabServers.addEventListener('click', () => {
    activeTab = 'servers';
    pastePreview = null;
    scrubSensitiveState({ keepRawIfMalformed: true });
    renderAll();
  });
  tabRaw.addEventListener('click', () => {
    activeTab = 'raw';
    pastePreview = null;
    scrubSensitiveState({ keepRawIfMalformed: true });
    void loadSnapshot(true);
  });
  btnRefresh.addEventListener('click', () => void loadSnapshot(activeTab === 'raw'));
  btnAdd.addEventListener('click', () => openEditorForServer(null));
  if (btnLangEn) btnLangEn.addEventListener('click', () => setLanguage('en'));
  if (btnLangKo) btnLangKo.addEventListener('click', () => setLanguage('ko'));

  function isTrustedParentOrigin(origin) {
    if (!origin || origin === 'null') return false;
    if (origin === window.location.origin) return true;
    return /^(?:vscode-webview|vscode-file|antigravity|app):/i.test(origin);
  }

  window.addEventListener('message', (event) => {
    if (!window.parent || window.parent === window || event.source !== window.parent) return;
    if (!isTrustedParentOrigin(event.origin)) return;
    if (event.data?.type === 'workspace-change' && Array.isArray(event.data.payload?.workspaceUris)) {
      workspaceUris = [...event.data.payload.workspaceUris];
      // Preserve in-progress Raw JSON draft when workspace changes
      void loadSnapshot(false);
    }
  });

  window.addEventListener('beforeunload', () => scrubSensitiveState({ keepRawIfMalformed: false }));

  async function init() {
    applyStaticTranslations();
    // Race preload getWorkspaceUris() against a short timeout: real sidecar_sdk/preload.js
    // never resolves getWorkspaceUris() until the host sends a workspace-change postMessage.
    // Subsequent workspace-change events are handled exclusively by the strict message listener above.
    if (window.sidecar && typeof window.sidecar.getWorkspaceUris === 'function') {
      try {
        const initialUris = await Promise.race([
          window.sidecar.getWorkspaceUris(),
          new Promise((resolve) => setTimeout(() => resolve(null), 100)),
        ]);
        if (Array.isArray(initialUris)) workspaceUris = [...initialUris];
      } catch {
        // Ignore if preload does not provide workspace list yet
      }
    }
    await loadSnapshot(false);
  }

  void init();
})();
