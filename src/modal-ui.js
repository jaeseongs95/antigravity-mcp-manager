'use strict';

const {
  QUICK_TEMPLATES,
  extractAuthFromSpec,
  buildAuthHeaders,
  parseSmartMcpInput,
  validateAndBuildServerSpec,
  formatArgsForEditor,
  formatKeyValueForEditor,
  normalizeMcpConfigObject,
} = require('./mcp-config-schema');

const MODAL_ID = 'agy-mcp-manager-modal-backdrop';
const EDIT_POPUP_ID = 'agy-mcp-edit-popup-backdrop';
const STYLE_ID = 'agy-mcp-manager-styles';

function isAuthErrorText(errText) {
  if (!errText || typeof errText !== 'string') return false;
  return /unauthorized|401|403|forbidden|authentication|unauthenticated|invalid[_\s-]?token|missing.*authorization|bearer|api[_\s-]?key/i.test(
    errText
  );
}

function ensureModalStyles(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${MODAL_ID}, #${EDIT_POPUP_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483645;
      background: rgba(9, 11, 17, 0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif;
      color: #e4e7ef;
      padding: 20px;
      box-sizing: border-box;
    }
    #${EDIT_POPUP_ID} {
      z-index: 2147483646;
    }
    #${MODAL_ID} *, #${EDIT_POPUP_ID} * {
      box-sizing: border-box;
    }
    .agy-mcp-dialog {
      width: min(860px, 96vw);
      max-height: min(780px, 92vh);
      background: #161821;
      border: 1px solid #2c3144;
      border-radius: 12px;
      box-shadow: 0 22px 60px rgba(0, 0, 0, 0.65);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .agy-mcp-dialog.popup {
      width: min(680px, 95vw);
      max-height: min(740px, 90vh);
      border-color: #3b425e;
    }
    .agy-mcp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      background: #1c1f2b;
      border-bottom: 1px solid #282d3f;
    }
    .agy-mcp-title-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .agy-mcp-title {
      font-size: 15px;
      font-weight: 600;
      color: #f3f5fa;
      margin: 0;
    }
    .agy-mcp-badge {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(99, 102, 241, 0.18);
      color: #a5b4fc;
      border: 1px solid rgba(99, 102, 241, 0.35);
    }
    .agy-mcp-close-btn {
      background: transparent;
      border: 1px solid transparent;
      color: #9aa2b8;
      font-size: 16px;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .agy-mcp-close-btn:hover {
      background: #272b3b;
      color: #ffffff;
    }
    .agy-mcp-tabs {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 18px;
      background: #191c26;
      border-bottom: 1px solid #262a3b;
    }
    .agy-mcp-tab {
      background: transparent;
      border: 1px solid transparent;
      color: #9aa2b8;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .agy-mcp-tab:hover {
      color: #e4e7ef;
      background: rgba(255, 255, 255, 0.04);
    }
    .agy-mcp-tab.active {
      color: #ffffff;
      background: #272c3f;
      border-color: #3b425e;
    }
    .agy-mcp-tab-spacer {
      flex: 1;
    }
    .agy-mcp-status-banner {
      padding: 8px 18px;
      font-size: 12px;
      border-bottom: 1px solid #262a3b;
      display: none;
    }
    .agy-mcp-status-banner.info {
      display: block;
      background: rgba(59, 130, 246, 0.14);
      color: #93c5fd;
    }
    .agy-mcp-status-banner.success {
      display: block;
      background: rgba(16, 185, 129, 0.14);
      color: #6ee7b7;
    }
    .agy-mcp-status-banner.error {
      display: block;
      background: rgba(239, 68, 68, 0.16);
      color: #fca5a5;
    }
    .agy-mcp-body {
      padding: 16px 18px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .agy-mcp-btn {
      background: #262b3d;
      color: #e4e7ef;
      border: 1px solid #383f58;
      border-radius: 6px;
      padding: 6px 11px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .agy-mcp-btn:hover {
      background: #30374f;
      border-color: #4a5373;
    }
    .agy-mcp-btn.primary {
      background: #4f46e5;
      border-color: #6366f1;
      color: #ffffff;
    }
    .agy-mcp-btn.primary:hover {
      background: #4338ca;
    }
    .agy-mcp-btn.danger {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.4);
      color: #fca5a5;
    }
    .agy-mcp-btn.danger:hover {
      background: rgba(239, 68, 68, 0.28);
    }
    .agy-mcp-card {
      background: #1d202d;
      border: 1px solid #2b3042;
      border-radius: 8px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .agy-mcp-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .agy-mcp-card-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .agy-mcp-server-name {
      font-size: 13.5px;
      font-weight: 600;
      color: #f3f5fa;
    }
    .agy-mcp-pill {
      font-size: 10.5px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .agy-mcp-pill.ready {
      background: rgba(16, 185, 129, 0.18);
      color: #6ee7b7;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .agy-mcp-pill.pending {
      background: rgba(245, 158, 11, 0.18);
      color: #fcd34d;
      border: 1px solid rgba(245, 158, 11, 0.35);
    }
    .agy-mcp-pill.error {
      background: rgba(239, 68, 68, 0.18);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.35);
    }
    .agy-mcp-pill.disabled {
      background: rgba(148, 163, 184, 0.15);
      color: #94a3b8;
      border: 1px solid rgba(148, 163, 184, 0.3);
    }
    .agy-mcp-pill.source-custom {
      background: rgba(99, 102, 241, 0.18);
      color: #c7d2fe;
      border: 1px solid rgba(99, 102, 241, 0.35);
    }
    .agy-mcp-pill.source-plugin {
      background: rgba(14, 165, 233, 0.15);
      color: #7dd3fc;
      border: 1px solid rgba(14, 165, 233, 0.3);
    }
    .agy-mcp-cmd-preview {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11.5px;
      color: #9aa2b8;
      background: #141722;
      padding: 5px 8px;
      border-radius: 5px;
      border: 1px solid #232838;
      word-break: break-all;
    }
    .agy-mcp-tools-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 2px;
    }
    .agy-mcp-tool-chip {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 4px;
      background: #252a3b;
      color: #cbd5e1;
      border: 1px solid #353c54;
      cursor: pointer;
    }
    .agy-mcp-tool-chip.disabled {
      opacity: 0.48;
      text-decoration: line-through;
      background: #191c27;
    }
    .agy-mcp-form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .agy-mcp-field {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .agy-mcp-field.full {
      grid-column: 1 / -1;
    }
    .agy-mcp-label {
      font-size: 12px;
      font-weight: 500;
      color: #cbd5e1;
    }
    .agy-mcp-hint {
      font-size: 11px;
      color: #828ca6;
    }
    .agy-mcp-input, .agy-mcp-textarea, .agy-mcp-select {
      width: 100%;
      background: #12151f;
      border: 1px solid #2d3348;
      border-radius: 6px;
      padding: 7px 10px;
      color: #f1f5f9;
      font-size: 12.5px;
      font-family: inherit;
    }
    .agy-mcp-textarea {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      min-height: 74px;
      resize: vertical;
    }
    .agy-mcp-input:focus, .agy-mcp-textarea:focus, .agy-mcp-select:focus {
      outline: none;
      border-color: #6366f1;
    }
    .agy-mcp-templates-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .agy-mcp-template-chip {
      font-size: 11.5px;
      padding: 4px 9px;
      border-radius: 6px;
      background: #212638;
      border: 1px solid #323954;
      color: #d5dcf0;
      cursor: pointer;
    }
    .agy-mcp-template-chip:hover {
      background: #2b324a;
      border-color: #4f5980;
    }
    .agy-mcp-injected-native-btn {
      margin-left: 8px;
      background: #4f46e5;
      color: #ffffff;
      border: 1px solid #6366f1;
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .agy-mcp-injected-native-btn:hover {
      background: #4338ca;
    }
    .agy-mcp-btn.auth {
      background: rgba(245, 158, 11, 0.16);
      border-color: rgba(245, 158, 11, 0.45);
      color: #fde68a;
    }
    .agy-mcp-btn.auth:hover {
      background: rgba(245, 158, 11, 0.28);
      border-color: rgba(245, 158, 11, 0.65);
    }
    .agy-mcp-inline-row-btn {
      background: #252a3d;
      color: #e2e8f0;
      border: 1px solid #3b425e;
      border-radius: 5px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      line-height: 1.4;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .agy-mcp-inline-row-btn:hover {
      background: #323954;
      border-color: #525d82;
      color: #ffffff;
    }
    .agy-mcp-inline-row-btn.auth {
      background: rgba(245, 158, 11, 0.16);
      border-color: rgba(245, 158, 11, 0.45);
      color: #fde68a;
    }
    .agy-mcp-inline-row-btn.auth:hover {
      background: rgba(245, 158, 11, 0.28);
      border-color: rgba(245, 158, 11, 0.7);
    }
    .agy-mcp-auth-box {
      background: rgba(99, 102, 241, 0.07);
      border: 1px solid rgba(99, 102, 241, 0.32);
      border-radius: 8px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
  `;
  doc.head.appendChild(style);
}

function statusPillInfo(statusCode, isDisabled) {
  if (isDisabled || statusCode === 4) {
    return { label: 'DISABLED', cls: 'disabled' };
  }
  if (statusCode === 2) {
    return { label: 'READY', cls: 'ready' };
  }
  if (statusCode === 1) {
    return { label: 'PENDING', cls: 'pending' };
  }
  if (statusCode === 3) {
    return { label: 'ERROR', cls: 'error' };
  }
  return { label: 'CONFIGURED', cls: 'pending' };
}

function formatSpecPreview(spec) {
  if (!spec || typeof spec !== 'object') return '(managed by plugin)';
  if (spec.url || spec.serverUrl) {
    const hasAuth = Boolean(
      spec.headers &&
      Object.keys(spec.headers).some((k) =>
        /^(?:authorization|x-api-key|api-key|x-auth-token|x-mcp-token|x-access-token)$/i.test(k)
      )
    );
    return `HTTP ${spec.url || spec.serverUrl}${hasAuth ? '  [🔑 Auth Header Configured]' : ''}`;
  }
  const cmd = spec.command || '';
  const args = Array.isArray(spec.args) ? spec.args.join(' ') : '';
  return `${cmd} ${args}`.trim() || '(empty command)';
}

function createDefaultFormState() {
  return {
    originalName: '',
    serverName: '',
    transport: 'stdio',
    command: 'npx',
    argsText: '',
    envText: '',
    cwd: '',
    url: '',
    headersText: '',
    authMode: 'none',
    bearerToken: '',
    apiKeyHeader: 'X-API-Key',
    apiKeyValue: '',
    basicUser: '',
    basicPass: '',
    oauthCode: '',
    showSecret: false,
    applyAuthToAllHttp: false,
    disabled: false,
  };
}

function createModalController({ doc, bridge, onStateChanged }) {
  let activeTab = 'servers'; // 'servers' | 'editor' | 'raw'
  let editingForm = createDefaultFormState();
  let popupForm = createDefaultFormState();
  let cachedConfig = { uri: '', rawText: '{\n  "mcpServers": {}\n}\n', config: { mcpServers: {} } };
  let cachedStates = [];
  let bannerState = { type: '', message: '' };
  let popupBannerState = { type: '', message: '' };

  function setBanner(type, message) {
    bannerState = { type, message };
    renderBanner();
  }

  function setPopupBanner(type, message) {
    popupBannerState = { type, message };
    renderPopupBanner();
  }

  function renderBanner() {
    const backdrop = doc.getElementById(MODAL_ID);
    if (!backdrop) return;
    const banner = backdrop.querySelector('.agy-mcp-status-banner');
    if (!banner) return;
    banner.className = 'agy-mcp-status-banner';
    if (bannerState.type && bannerState.message) {
      banner.classList.add(bannerState.type);
      banner.textContent = bannerState.message;
    } else {
      banner.textContent = '';
    }
  }

  function renderPopupBanner() {
    const backdrop = doc.getElementById(EDIT_POPUP_ID);
    if (!backdrop) return;
    const banner = backdrop.querySelector('.agy-mcp-status-banner');
    if (!banner) return;
    banner.className = 'agy-mcp-status-banner';
    if (popupBannerState.type && popupBannerState.message) {
      banner.classList.add(popupBannerState.type);
      banner.textContent = popupBannerState.message;
    } else {
      banner.textContent = '';
    }
  }

  function findRuntimeState(serverName) {
    if (!serverName) return null;
    return (
      cachedStates.find(
        (st) => st && (st.serverName === serverName || st.spec?.serverName === serverName)
      ) || null
    );
  }

  async function reloadData() {
    try {
      const [cfgResult, statesResult] = await Promise.all([
        bridge.readMcpConfig(),
        bridge.fetchServerStates(),
      ]);
      cachedConfig = cfgResult && cfgResult.config ? cfgResult : { uri: '', config: { mcpServers: {} } };
      const statesList = Array.isArray(statesResult)
        ? statesResult
        : (statesResult && Array.isArray(statesResult.states) ? statesResult.states : []);
      cachedStates = statesList;
      if (typeof onStateChanged === 'function') {
        onStateChanged({ config: cachedConfig.config, states: cachedStates });
      }
    } catch (err) {
      setBanner('error', `Failed to load MCP configuration: ${err.message || err}`);
    }
  }

  function buildFormStateFromSpec(serverName, spec, options = {}) {
    const runtimeState = findRuntimeState(serverName);
    const effectiveSpec = spec || runtimeState?.spec || {};
    const isHttp = Boolean(
      effectiveSpec && (effectiveSpec.url || effectiveSpec.serverUrl || effectiveSpec.type === 'http')
    );
    const extractedAuth = extractAuthFromSpec(effectiveSpec);
    let authMode = extractedAuth.authMode;
    if (authMode === 'none') {
      if (runtimeState?.authUrl && !runtimeState?.hasAuthToken) {
        authMode = 'oauth';
      } else if (
        isHttp &&
        (options.focusAuth || isAuthErrorText(runtimeState?.error))
      ) {
        authMode = 'bearer';
      }
    }
    return {
      originalName: serverName || '',
      serverName: serverName || '',
      transport: isHttp ? 'http' : 'stdio',
      command: effectiveSpec && effectiveSpec.command ? effectiveSpec.command : 'npx',
      argsText: formatArgsForEditor(effectiveSpec && effectiveSpec.args),
      envText: formatKeyValueForEditor(effectiveSpec && effectiveSpec.env, '='),
      cwd: effectiveSpec && effectiveSpec.cwd ? effectiveSpec.cwd : '',
      url: (effectiveSpec && (effectiveSpec.url || effectiveSpec.serverUrl)) || '',
      headersText: formatKeyValueForEditor(
        authMode === 'none' ? (effectiveSpec && effectiveSpec.headers) : extractedAuth.extraHeaders,
        ': '
      ),
      authMode,
      bearerToken: extractedAuth.bearerToken,
      apiKeyHeader: extractedAuth.apiKeyHeader || 'X-API-Key',
      apiKeyValue: extractedAuth.apiKeyValue,
      basicUser: extractedAuth.basicUser,
      basicPass: extractedAuth.basicPass,
      oauthCode: '',
      showSecret: false,
      applyAuthToAllHttp: false,
      disabled: Boolean(effectiveSpec && effectiveSpec.disabled),
    };
  }

  function populateFormFromSpec(serverName, spec, options = {}) {
    editingForm = buildFormStateFromSpec(serverName, spec, options);
  }

  function resetForm() {
    editingForm = createDefaultFormState();
  }

  function renderSmartAutoAddBar(container) {
    const box = doc.createElement('div');
    box.className = 'agy-mcp-card';
    box.style.background = 'rgba(79, 70, 229, 0.09)';
    box.style.borderColor = 'rgba(99, 102, 241, 0.38)';

    const label = doc.createElement('div');
    label.className = 'agy-mcp-label';
    label.textContent = '⚡ Quick Auto-Add (Enter MCP Server URL, GitHub/npm Address, Command, or JSON):';
    box.appendChild(label);

    const row = doc.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.style.flexWrap = 'wrap';

    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'agy-mcp-input';
    input.style.flex = '2';
    input.style.minWidth = '220px';
    input.setAttribute('data-testid', 'agy-mcp-smart-input');
    input.placeholder = 'https://mcp.example.com/mcp, https://github.com/owner/repo, @playwright/mcp, or npx -y ...';

    const tokenInput = doc.createElement('input');
    tokenInput.type = 'password';
    tokenInput.className = 'agy-mcp-input';
    tokenInput.style.flex = '1';
    tokenInput.style.minWidth = '170px';
    tokenInput.setAttribute('data-testid', 'agy-mcp-smart-token-input');
    tokenInput.placeholder = '🔑 Optional Bearer Token / API Key';

    async function handleQuickConnect() {
      const parsed = parseSmartMcpInput(input.value, tokenInput.value);
      if (!parsed.ok) {
        setBanner('error', parsed.error);
        return;
      }
      try {
        if (parsed.multipleServers) {
          const names = Object.keys(parsed.multipleServers);
          setBanner('info', `Saving ${names.length} MCP servers (${names.join(', ')})...`);
          const nextServers = {
            ...((cachedConfig.config && cachedConfig.config.mcpServers) || {}),
            ...parsed.multipleServers,
          };
          const writeRes = await bridge.writeMcpConfig({
            ...(cachedConfig.config || {}),
            mcpServers: nextServers,
          });
          if (writeRes && writeRes.ok === false) {
            setBanner('error', writeRes.error);
            return;
          }
          await reloadData();
          setBanner('success', `Automatically configured and connected ${names.length} servers: ${names.join(', ')}.`);
        } else {
          setBanner('info', `Auto-configuring "${parsed.serverName}"...`);
          const res = await bridge.upsertCustomServer(parsed.serverName, parsed.spec);
          if (res && res.ok === false) {
            setBanner('error', res.error);
            return;
          }
          await reloadData();
          const st = findRuntimeState(parsed.serverName);
          if (st && (isAuthErrorText(st.error) || (st.authUrl && !st.hasAuthToken))) {
            setBanner(
              'info',
              `Added "${parsed.serverName}", which requires authentication. Enter your token or complete OAuth below.`
            );
            openEditPopup(parsed.serverName, { focusAuth: true });
          } else {
            setBanner('success', `Automatically added and connected "${parsed.serverName}".`);
          }
        }
        input.value = '';
        tokenInput.value = '';
        activeTab = 'servers';
        renderModalContent();
      } catch (err) {
        setBanner('error', err.message || String(err));
      }
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleQuickConnect();
      }
    });
    tokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleQuickConnect();
      }
    });

    const autoConnectBtn = doc.createElement('button');
    autoConnectBtn.type = 'button';
    autoConnectBtn.className = 'agy-mcp-btn primary';
    autoConnectBtn.setAttribute('data-testid', 'agy-mcp-smart-add-btn');
    autoConnectBtn.textContent = 'Auto-Add & Connect';
    autoConnectBtn.addEventListener('click', handleQuickConnect);

    const fillFormBtn = doc.createElement('button');
    fillFormBtn.type = 'button';
    fillFormBtn.className = 'agy-mcp-btn';
    fillFormBtn.setAttribute('data-testid', 'agy-mcp-smart-fill-btn');
    fillFormBtn.textContent = 'Auto-Fill Form';
    fillFormBtn.addEventListener('click', () => {
      const parsed = parseSmartMcpInput(input.value, tokenInput.value);
      if (!parsed.ok) {
        setBanner('error', parsed.error);
        return;
      }
      populateFormFromSpec(parsed.serverName, parsed.spec);
      activeTab = 'editor';
      setBanner('info', `Auto-filled form for "${parsed.serverName}". Review settings or authentication below, then click Save & Connect Server.`);
      renderModalContent();
    });

    row.appendChild(input);
    row.appendChild(tokenInput);
    row.appendChild(autoConnectBtn);
    row.appendChild(fillFormBtn);
    box.appendChild(row);
    container.appendChild(box);
  }

  function renderAuthFieldsSection(container, formObj, runtimeState, reRenderFn, bannerFn) {
    const authBox = doc.createElement('div');
    authBox.className = 'agy-mcp-auth-box';
    authBox.setAttribute('data-testid', 'agy-mcp-auth-section');

    const topRow = doc.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.alignItems = 'center';
    topRow.style.justifyContent = 'space-between';
    topRow.style.gap = '10px';
    topRow.style.flexWrap = 'wrap';

    const titleEl = doc.createElement('div');
    titleEl.className = 'agy-mcp-label';
    titleEl.style.color = '#e0e7ff';
    titleEl.textContent = '🔐 Authentication Settings (Bearer Token / API Key / Basic / OAuth)';
    topRow.appendChild(titleEl);

    const modeSelect = doc.createElement('select');
    modeSelect.className = 'agy-mcp-select';
    modeSelect.style.width = 'auto';
    modeSelect.style.minWidth = '260px';
    modeSelect.setAttribute('data-field', 'authMode');
    const authOptions = [
      { value: 'none', label: 'None (No authentication)' },
      { value: 'bearer', label: 'Bearer Token (Authorization: Bearer <token>)' },
      { value: 'apiKey', label: 'API Key Header (X-API-Key or Custom Header)' },
      { value: 'basic', label: 'Basic Auth (Username & Password)' },
      { value: 'oauth', label: 'Native OAuth / Browser Sign-In' },
    ];
    for (const opt of authOptions) {
      const o = doc.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      modeSelect.appendChild(o);
    }
    modeSelect.value = formObj.authMode || 'none';
    modeSelect.addEventListener('change', (e) => {
      formObj.authMode = e.target.value;
      reRenderFn();
    });
    topRow.appendChild(modeSelect);
    authBox.appendChild(topRow);

    if (formObj.authMode === 'bearer') {
      const field = doc.createElement('div');
      field.className = 'agy-mcp-field';
      const lbl = doc.createElement('label');
      lbl.className = 'agy-mcp-label';
      lbl.textContent =
        formObj.transport === 'http'
          ? 'Bearer Token (Automatically sets "Authorization: Bearer <token>" header)'
          : 'Auth Token (Automatically sets MCP_AUTH_TOKEN environment variable)';
      const inputRow = doc.createElement('div');
      inputRow.style.display = 'flex';
      inputRow.style.gap = '6px';

      const tokInput = doc.createElement('input');
      tokInput.type = formObj.showSecret ? 'text' : 'password';
      tokInput.className = 'agy-mcp-input';
      tokInput.style.flex = '1';
      tokInput.setAttribute('data-field', 'bearerToken');
      tokInput.placeholder = 'Paste Bearer token here (e.g. eyJhbGci... or mcp_secret_...)';
      tokInput.value = formObj.bearerToken || '';
      tokInput.addEventListener('input', (e) => {
        formObj.bearerToken = e.target.value;
      });

      const toggleVisBtn = doc.createElement('button');
      toggleVisBtn.type = 'button';
      toggleVisBtn.className = 'agy-mcp-btn';
      toggleVisBtn.textContent = formObj.showSecret ? 'Hide' : 'Show';
      toggleVisBtn.addEventListener('click', () => {
        formObj.showSecret = !formObj.showSecret;
        tokInput.type = formObj.showSecret ? 'text' : 'password';
        toggleVisBtn.textContent = formObj.showSecret ? 'Hide' : 'Show';
      });

      inputRow.appendChild(tokInput);
      inputRow.appendChild(toggleVisBtn);
      field.appendChild(lbl);
      field.appendChild(inputRow);
      authBox.appendChild(field);
    } else if (formObj.authMode === 'apiKey') {
      const grid = doc.createElement('div');
      grid.className = 'agy-mcp-form-grid';

      const hdrNameField = doc.createElement('div');
      hdrNameField.className = 'agy-mcp-field';
      const hdrNameLbl = doc.createElement('label');
      hdrNameLbl.className = 'agy-mcp-label';
      hdrNameLbl.textContent = 'Auth Header / Env Key Name';
      const hdrNameInput = doc.createElement('input');
      hdrNameInput.className = 'agy-mcp-input';
      hdrNameInput.setAttribute('data-field', 'apiKeyHeader');
      hdrNameInput.placeholder = 'X-API-Key or Authorization';
      hdrNameInput.value = formObj.apiKeyHeader || 'X-API-Key';
      hdrNameInput.addEventListener('input', (e) => {
        formObj.apiKeyHeader = e.target.value;
      });
      hdrNameField.appendChild(hdrNameLbl);
      hdrNameField.appendChild(hdrNameInput);

      const hdrValField = doc.createElement('div');
      hdrValField.className = 'agy-mcp-field';
      const hdrValLbl = doc.createElement('label');
      hdrValLbl.className = 'agy-mcp-label';
      hdrValLbl.textContent = 'API Key / Secret Value';
      const valRow = doc.createElement('div');
      valRow.style.display = 'flex';
      valRow.style.gap = '6px';
      const hdrValInput = doc.createElement('input');
      hdrValInput.type = formObj.showSecret ? 'text' : 'password';
      hdrValInput.className = 'agy-mcp-input';
      hdrValInput.style.flex = '1';
      hdrValInput.setAttribute('data-field', 'apiKeyValue');
      hdrValInput.placeholder = 'Enter API key value...';
      hdrValInput.value = formObj.apiKeyValue || '';
      hdrValInput.addEventListener('input', (e) => {
        formObj.apiKeyValue = e.target.value;
      });
      const toggleVisBtn = doc.createElement('button');
      toggleVisBtn.type = 'button';
      toggleVisBtn.className = 'agy-mcp-btn';
      toggleVisBtn.textContent = formObj.showSecret ? 'Hide' : 'Show';
      toggleVisBtn.addEventListener('click', () => {
        formObj.showSecret = !formObj.showSecret;
        hdrValInput.type = formObj.showSecret ? 'text' : 'password';
        toggleVisBtn.textContent = formObj.showSecret ? 'Hide' : 'Show';
      });
      valRow.appendChild(hdrValInput);
      valRow.appendChild(toggleVisBtn);
      hdrValField.appendChild(hdrValLbl);
      hdrValField.appendChild(valRow);

      grid.appendChild(hdrNameField);
      grid.appendChild(hdrValField);
      authBox.appendChild(grid);
    } else if (formObj.authMode === 'basic') {
      const grid = doc.createElement('div');
      grid.className = 'agy-mcp-form-grid';

      const uField = doc.createElement('div');
      uField.className = 'agy-mcp-field';
      const uLbl = doc.createElement('label');
      uLbl.className = 'agy-mcp-label';
      uLbl.textContent = 'Username';
      const uInput = doc.createElement('input');
      uInput.className = 'agy-mcp-input';
      uInput.setAttribute('data-field', 'basicUser');
      uInput.placeholder = 'Username';
      uInput.value = formObj.basicUser || '';
      uInput.addEventListener('input', (e) => {
        formObj.basicUser = e.target.value;
      });
      uField.appendChild(uLbl);
      uField.appendChild(uInput);

      const pField = doc.createElement('div');
      pField.className = 'agy-mcp-field';
      const pLbl = doc.createElement('label');
      pLbl.className = 'agy-mcp-label';
      pLbl.textContent = 'Password';
      const pInput = doc.createElement('input');
      pInput.type = formObj.showSecret ? 'text' : 'password';
      pInput.className = 'agy-mcp-input';
      pInput.setAttribute('data-field', 'basicPass');
      pInput.placeholder = 'Password';
      pInput.value = formObj.basicPass || '';
      pInput.addEventListener('input', (e) => {
        formObj.basicPass = e.target.value;
      });
      pField.appendChild(pLbl);
      pField.appendChild(pInput);

      grid.appendChild(uField);
      grid.appendChild(pField);
      authBox.appendChild(grid);
    } else if (formObj.authMode === 'oauth') {
      const oauthWrap = doc.createElement('div');
      oauthWrap.style.display = 'flex';
      oauthWrap.style.flexDirection = 'column';
      oauthWrap.style.gap = '8px';

      const authUrl = runtimeState?.authUrl || '';
      const hasToken = Boolean(runtimeState?.hasAuthToken);

      const statusNote = doc.createElement('div');
      statusNote.className = 'agy-mcp-hint';
      statusNote.textContent = hasToken
        ? 'OAuth status: Authenticated token is active on host.'
        : authUrl
        ? 'OAuth URL provided by server. Click "Open Auth URL in Browser", sign in, and paste the authorization code below.'
        : 'If this remote MCP server uses Bearer tokens instead of dynamic OAuth registration, switch Authentication Type to "Bearer Token".';
      oauthWrap.appendChild(statusNote);

      const oauthActions = doc.createElement('div');
      oauthActions.style.display = 'flex';
      oauthActions.style.gap = '8px';
      oauthActions.style.alignItems = 'center';
      oauthActions.style.flexWrap = 'wrap';

      if (authUrl) {
        const openBrowserBtn = doc.createElement('button');
        openBrowserBtn.type = 'button';
        openBrowserBtn.className = 'agy-mcp-btn auth';
        openBrowserBtn.textContent = '🌐 Open Auth URL in Browser';
        openBrowserBtn.addEventListener('click', () => {
          bridge.openAuthUrl(authUrl);
          bannerFn('info', 'Opened OAuth authorization page in browser. Paste the resulting code below.');
        });
        oauthActions.appendChild(openBrowserBtn);
      }

      const codeInput = doc.createElement('input');
      codeInput.type = 'text';
      codeInput.className = 'agy-mcp-input';
      codeInput.style.flex = '1';
      codeInput.style.minWidth = '200px';
      codeInput.setAttribute('data-field', 'oauthCode');
      codeInput.placeholder = 'Enter authorization code...';
      codeInput.value = formObj.oauthCode || '';
      codeInput.addEventListener('input', (e) => {
        formObj.oauthCode = e.target.value;
      });
      oauthActions.appendChild(codeInput);

      const submitCodeBtn = doc.createElement('button');
      submitCodeBtn.type = 'button';
      submitCodeBtn.className = 'agy-mcp-btn primary';
      submitCodeBtn.setAttribute('data-testid', 'agy-mcp-submit-oauth-btn');
      submitCodeBtn.textContent = 'Submit Auth Code';
      submitCodeBtn.addEventListener('click', async () => {
        const targetServer = formObj.serverName || formObj.originalName;
        if (!targetServer) {
          bannerFn('error', 'Save the server first or enter a Server Name before submitting an OAuth code.');
          return;
        }
        const res = await bridge.completeOAuth(targetServer, formObj.oauthCode);
        if (!res || !res.ok) {
          bannerFn('error', (res && res.error) || 'Failed to complete OAuth.');
          return;
        }
        formObj.oauthCode = '';
        await reloadData();
        bannerFn('success', `OAuth authentication completed for "${targetServer}".`);
        reRenderFn();
      });
      oauthActions.appendChild(submitCodeBtn);

      if (hasToken) {
        const signOutBtn = doc.createElement('button');
        signOutBtn.type = 'button';
        signOutBtn.className = 'agy-mcp-btn danger';
        signOutBtn.textContent = 'Disconnect OAuth';
        signOutBtn.addEventListener('click', async () => {
          const targetServer = formObj.serverName || formObj.originalName;
          const res = await bridge.disconnectOAuth(targetServer);
          if (!res || !res.ok) {
            bannerFn('error', (res && res.error) || 'Failed to disconnect OAuth.');
            return;
          }
          await reloadData();
          bannerFn('info', `Disconnected OAuth session for "${targetServer}".`);
          reRenderFn();
        });
        oauthActions.appendChild(signOutBtn);
      }

      oauthWrap.appendChild(oauthActions);
      authBox.appendChild(oauthWrap);
    }

    // Batch apply checkbox when multiple custom HTTP servers exist
    const customServers = (cachedConfig.config && cachedConfig.config.mcpServers) || {};
    const httpServerNames = Object.keys(customServers).filter((k) =>
      Boolean(customServers[k]?.url || customServers[k]?.serverUrl)
    );
    if (
      formObj.transport === 'http' &&
      (formObj.authMode === 'bearer' || formObj.authMode === 'apiKey' || formObj.authMode === 'basic') &&
      httpServerNames.length > 1
    ) {
      const batchLabel = doc.createElement('label');
      batchLabel.style.display = 'inline-flex';
      batchLabel.style.alignItems = 'center';
      batchLabel.style.gap = '6px';
      batchLabel.style.fontSize = '11.5px';
      batchLabel.style.color = '#c7d2fe';
      batchLabel.style.cursor = 'pointer';

      const batchChk = doc.createElement('input');
      batchChk.type = 'checkbox';
      batchChk.setAttribute('data-field', 'applyAuthToAllHttp');
      batchChk.checked = Boolean(formObj.applyAuthToAllHttp);
      batchChk.addEventListener('change', (e) => {
        formObj.applyAuthToAllHttp = e.target.checked;
      });

      const batchSpan = doc.createElement('span');
      batchSpan.textContent = `Apply this authentication to all ${httpServerNames.length} custom HTTP servers (${httpServerNames.join(', ')})`;
      batchLabel.appendChild(batchChk);
      batchLabel.appendChild(batchSpan);
      authBox.appendChild(batchLabel);
    }

    container.appendChild(authBox);
  }

  function renderServerConnectionFields(container, formObj, reRenderFn) {
    const grid = doc.createElement('div');
    grid.className = 'agy-mcp-form-grid';

    // Server Name
    const nameField = doc.createElement('div');
    nameField.className = 'agy-mcp-field';
    const nameLabel = doc.createElement('label');
    nameLabel.className = 'agy-mcp-label';
    nameLabel.textContent = 'Server Name (Optional — auto-filled from URL/Command)';
    const nameInput = doc.createElement('input');
    nameInput.className = 'agy-mcp-input';
    nameInput.setAttribute('data-field', 'serverName');
    nameInput.placeholder = 'Auto-detected if left blank (e.g. filesystem, github)';
    nameInput.value = formObj.serverName;
    nameInput.addEventListener('input', (e) => {
      formObj.serverName = e.target.value;
    });
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    grid.appendChild(nameField);

    // Transport
    const transField = doc.createElement('div');
    transField.className = 'agy-mcp-field';
    const transLabel = doc.createElement('label');
    transLabel.className = 'agy-mcp-label';
    transLabel.textContent = 'Transport Type';
    const transSelect = doc.createElement('select');
    transSelect.className = 'agy-mcp-select';
    transSelect.setAttribute('data-field', 'transport');
    const optStdio = doc.createElement('option');
    optStdio.value = 'stdio';
    optStdio.textContent = 'Stdio (Local Process: npx / uvx / node / python / docker)';
    const optHttp = doc.createElement('option');
    optHttp.value = 'http';
    optHttp.textContent = 'Streamable HTTP / Remote URL';
    transSelect.appendChild(optStdio);
    transSelect.appendChild(optHttp);
    transSelect.value = formObj.transport;
    transSelect.addEventListener('change', (e) => {
      formObj.transport = e.target.value;
      reRenderFn();
    });
    transField.appendChild(transLabel);
    transField.appendChild(transSelect);
    grid.appendChild(transField);

    if (formObj.transport === 'http') {
      const urlField = doc.createElement('div');
      urlField.className = 'agy-mcp-field full';
      const urlLabel = doc.createElement('label');
      urlLabel.className = 'agy-mcp-label';
      urlLabel.textContent = 'Remote MCP Server URL (http:// or https://)';
      const urlInput = doc.createElement('input');
      urlInput.className = 'agy-mcp-input';
      urlInput.setAttribute('data-field', 'url');
      urlInput.placeholder = 'https://mcp.example.com/mcp';
      urlInput.value = formObj.url;
      urlInput.addEventListener('input', (e) => {
        formObj.url = e.target.value;
      });
      urlField.appendChild(urlLabel);
      urlField.appendChild(urlInput);
      grid.appendChild(urlField);

      const hdrField = doc.createElement('div');
      hdrField.className = 'agy-mcp-field full';
      const hdrLabel = doc.createElement('label');
      hdrLabel.className = 'agy-mcp-label';
      hdrLabel.textContent = 'HTTP Headers (One "Header: Value" per line or JSON object)';
      const hdrArea = doc.createElement('textarea');
      hdrArea.className = 'agy-mcp-textarea';
      hdrArea.setAttribute('data-field', 'headersText');
      hdrArea.placeholder = 'Authorization: Bearer <TOKEN>';
      hdrArea.value = formObj.headersText;
      hdrArea.addEventListener('input', (e) => {
        formObj.headersText = e.target.value;
      });
      hdrField.appendChild(hdrLabel);
      hdrField.appendChild(hdrArea);
      grid.appendChild(hdrField);
    } else {
      const cmdField = doc.createElement('div');
      cmdField.className = 'agy-mcp-field';
      const cmdLabel = doc.createElement('label');
      cmdLabel.className = 'agy-mcp-label';
      cmdLabel.textContent = 'Command Executable';
      const cmdInput = doc.createElement('input');
      cmdInput.className = 'agy-mcp-input';
      cmdInput.setAttribute('data-field', 'command');
      cmdInput.placeholder = 'npx, uvx, node, python, docker...';
      cmdInput.value = formObj.command;
      cmdInput.addEventListener('input', (e) => {
        formObj.command = e.target.value;
      });
      cmdField.appendChild(cmdLabel);
      cmdField.appendChild(cmdInput);
      grid.appendChild(cmdField);

      const cwdField = doc.createElement('div');
      cwdField.className = 'agy-mcp-field';
      const cwdLabel = doc.createElement('label');
      cwdLabel.className = 'agy-mcp-label';
      cwdLabel.textContent = 'Working Directory (cwd, optional)';
      const cwdInput = doc.createElement('input');
      cwdInput.className = 'agy-mcp-input';
      cwdInput.setAttribute('data-field', 'cwd');
      cwdInput.placeholder = 'e.g. D:/projects/my-server';
      cwdInput.value = formObj.cwd;
      cwdInput.addEventListener('input', (e) => {
        formObj.cwd = e.target.value;
      });
      cwdField.appendChild(cwdLabel);
      cwdField.appendChild(cwdInput);
      grid.appendChild(cwdField);

      const argsField = doc.createElement('div');
      argsField.className = 'agy-mcp-field full';
      const argsLabel = doc.createElement('label');
      argsLabel.className = 'agy-mcp-label';
      argsLabel.textContent = 'Arguments (One argument per line, or JSON array ["arg1", "arg2"])';
      const argsArea = doc.createElement('textarea');
      argsArea.className = 'agy-mcp-textarea';
      argsArea.setAttribute('data-field', 'argsText');
      argsArea.placeholder = '-y\n@modelcontextprotocol/server-filesystem\nD:/workspace';
      argsArea.value = formObj.argsText;
      argsArea.addEventListener('input', (e) => {
        formObj.argsText = e.target.value;
      });
      argsField.appendChild(argsLabel);
      argsField.appendChild(argsArea);
      grid.appendChild(argsField);

      const envField = doc.createElement('div');
      envField.className = 'agy-mcp-field full';
      const envLabel = doc.createElement('label');
      envLabel.className = 'agy-mcp-label';
      envLabel.textContent = 'Environment Variables (One KEY=VALUE per line, or JSON object)';
      const envArea = doc.createElement('textarea');
      envArea.className = 'agy-mcp-textarea';
      envArea.setAttribute('data-field', 'envText');
      envArea.placeholder = 'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx\nNODE_ENV=production';
      envArea.value = formObj.envText;
      envArea.addEventListener('input', (e) => {
        formObj.envText = e.target.value;
      });
      envField.appendChild(envLabel);
      envField.appendChild(envArea);
      grid.appendChild(envField);
    }

    container.appendChild(grid);
  }

  async function saveServerForm(formObj, bannerFn) {
    const built = validateAndBuildServerSpec(formObj);
    if (!built.ok) {
      bannerFn('error', built.error);
      return { ok: false, error: built.error };
    }
    bannerFn('info', `Saving "${built.serverName}" to mcp_config.json...`);
    const res = await bridge.upsertCustomServer(built.serverName, built.spec, formObj.originalName);
    if (res && res.ok === false) {
      bannerFn('error', res.error || 'Failed to save server');
      return res;
    }

    if (formObj.applyAuthToAllHttp && formObj.transport === 'http') {
      const authHeadersOnly = buildAuthHeaders({
        authMode: formObj.authMode,
        bearerToken: formObj.bearerToken,
        apiKeyHeader: formObj.apiKeyHeader,
        apiKeyValue: formObj.apiKeyValue,
        basicUser: formObj.basicUser,
        basicPass: formObj.basicPass,
        baseHeaders: {},
      });
      if (Object.keys(authHeadersOnly).length > 0 && typeof bridge.applyAuthHeadersToServers === 'function') {
        await bridge.applyAuthHeadersToServers(null, authHeadersOnly);
      }
    }

    await reloadData();
    bannerFn('success', `Saved and triggered reload for "${built.serverName}".`);
    return { ok: true, serverName: built.serverName, spec: built.spec };
  }

  function renderServersTab(container) {
    renderSmartAutoAddBar(container);

    const topActions = doc.createElement('div');
    topActions.style.display = 'flex';
    topActions.style.justifyContent = 'space-between';
    topActions.style.alignItems = 'center';
    topActions.style.flexWrap = 'wrap';
    topActions.style.gap = '8px';

    const summary = doc.createElement('div');
    summary.style.fontSize = '12.5px';
    summary.style.color = '#9aa2b8';
    const customNames = Object.keys((cachedConfig.config && cachedConfig.config.mcpServers) || {});
    summary.textContent = `Custom Servers: ${customNames.length} | Active Runtime States: ${cachedStates.length}`;
    topActions.appendChild(summary);

    const btnGroup = doc.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.gap = '6px';
    btnGroup.style.flexWrap = 'wrap';

    const refreshBtn = doc.createElement('button');
    refreshBtn.className = 'agy-mcp-btn';
    refreshBtn.textContent = '↻ Refresh All Servers';
    refreshBtn.addEventListener('click', async () => {
      setBanner('info', 'Refreshing MCP servers...');
      await bridge.refreshServers();
      await reloadData();
      setBanner('success', 'MCP servers refreshed.');
      renderBody();
    });

    const editPopupBtn = doc.createElement('button');
    editPopupBtn.className = 'agy-mcp-btn';
    editPopupBtn.setAttribute('data-testid', 'agy-mcp-open-edit-popup-btn');
    editPopupBtn.textContent = '⚙️ Edit Custom MCP Settings';
    editPopupBtn.addEventListener('click', () => {
      openEditPopup(customNames[0] || '');
    });

    const addBtn = doc.createElement('button');
    addBtn.className = 'agy-mcp-btn primary';
    addBtn.setAttribute('data-testid', 'agy-mcp-open-add-tab');
    addBtn.textContent = '+ Add Custom MCP Server';
    addBtn.addEventListener('click', () => {
      resetForm();
      activeTab = 'editor';
      renderModalContent();
    });

    btnGroup.appendChild(refreshBtn);
    btnGroup.appendChild(editPopupBtn);
    btnGroup.appendChild(addBtn);
    topActions.appendChild(btnGroup);
    container.appendChild(topActions);

    const customMap = (cachedConfig.config && cachedConfig.config.mcpServers) || {};
    const stateByName = new Map();
    for (const st of cachedStates) {
      const sName = st && (st.serverName || st.spec?.serverName);
      if (sName) {
        stateByName.set(sName, st);
      }
    }

    const allServerNames = Array.from(
      new Set([...Object.keys(customMap), ...Array.from(stateByName.keys())])
    );

    if (allServerNames.length === 0) {
      const empty = doc.createElement('div');
      empty.className = 'agy-mcp-card';
      empty.style.textAlign = 'center';
      empty.style.padding = '28px 16px';
      empty.style.color = '#9aa2b8';
      empty.textContent = 'No custom MCP servers configured yet. Click "+ Add Custom MCP Server" to register a local Stdio or remote HTTP MCP server.';
      container.appendChild(empty);
      return;
    }

    for (const name of allServerNames) {
      const customSpec = customMap[name] || null;
      const runtimeState = stateByName.get(name) || null;
      const isCustom = Boolean(customSpec);
      const isDisabled = Boolean((customSpec && customSpec.disabled) || (runtimeState && runtimeState.status === 4));
      const pill = statusPillInfo(runtimeState ? runtimeState.status : 0, isDisabled);
      const needsAuth = Boolean(
        (runtimeState && isAuthErrorText(runtimeState.error)) ||
        (runtimeState?.authUrl && !runtimeState?.hasAuthToken)
      );

      const card = doc.createElement('div');
      card.className = 'agy-mcp-card';
      card.setAttribute('data-mcp-server-card', name);

      const topRow = doc.createElement('div');
      topRow.className = 'agy-mcp-card-top';

      const titleRow = doc.createElement('div');
      titleRow.className = 'agy-mcp-card-title-row';

      const nameEl = doc.createElement('span');
      nameEl.className = 'agy-mcp-server-name';
      nameEl.textContent = name;
      titleRow.appendChild(nameEl);

      const statusBadge = doc.createElement('span');
      statusBadge.className = `agy-mcp-pill ${pill.cls}`;
      statusBadge.textContent = pill.label;
      titleRow.appendChild(statusBadge);

      const sourceBadge = doc.createElement('span');
      sourceBadge.className = `agy-mcp-pill ${isCustom ? 'source-custom' : 'source-plugin'}`;
      sourceBadge.textContent = isCustom ? 'Custom' : 'Plugin';
      titleRow.appendChild(sourceBadge);

      topRow.appendChild(titleRow);

      const actionsRow = doc.createElement('div');
      actionsRow.style.display = 'flex';
      actionsRow.style.gap = '6px';
      actionsRow.style.flexWrap = 'wrap';

      if (isCustom || needsAuth) {
        const authBtn = doc.createElement('button');
        authBtn.type = 'button';
        authBtn.className = `agy-mcp-btn${needsAuth ? ' auth' : ''}`;
        authBtn.setAttribute('data-testid', `agy-mcp-auth-btn-${name}`);
        authBtn.textContent = '🔑 Authenticate';
        authBtn.addEventListener('click', () => {
          openEditPopup(name, { focusAuth: true });
        });
        actionsRow.appendChild(authBtn);
      }

      const toggleBtn = doc.createElement('button');
      toggleBtn.className = 'agy-mcp-btn';
      toggleBtn.textContent = isDisabled ? 'Enable' : 'Disable';
      toggleBtn.addEventListener('click', async () => {
        try {
          await bridge.toggleServerEnabled(name, isDisabled);
          await reloadData();
          setBanner('success', `Server "${name}" ${isDisabled ? 'enabled' : 'disabled'}.`);
          renderBody();
        } catch (err) {
          setBanner('error', `Failed to toggle "${name}": ${err.message || err}`);
        }
      });
      actionsRow.appendChild(toggleBtn);

      const restartBtn = doc.createElement('button');
      restartBtn.className = 'agy-mcp-btn';
      restartBtn.textContent = '↻ Restart';
      restartBtn.addEventListener('click', async () => {
        setBanner('info', `Restarting "${name}"...`);
        await bridge.refreshServers(name);
        await reloadData();
        setBanner('success', `Restarted "${name}".`);
        renderBody();
      });
      actionsRow.appendChild(restartBtn);

      if (isCustom) {
        const editBtn = doc.createElement('button');
        editBtn.className = 'agy-mcp-btn';
        editBtn.setAttribute('data-testid', `agy-mcp-edit-btn-${name}`);
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => {
          openEditPopup(name);
        });
        actionsRow.appendChild(editBtn);

        const delBtn = doc.createElement('button');
        delBtn.className = 'agy-mcp-btn danger';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', async () => {
          try {
            await bridge.deleteCustomServer(name);
            await reloadData();
            setBanner('success', `Removed custom server "${name}".`);
            renderBody();
          } catch (err) {
            setBanner('error', `Failed to delete "${name}": ${err.message || err}`);
          }
        });
        actionsRow.appendChild(delBtn);
      }

      topRow.appendChild(actionsRow);
      card.appendChild(topRow);

      const preview = doc.createElement('div');
      preview.className = 'agy-mcp-cmd-preview';
      preview.textContent = formatSpecPreview(customSpec || (runtimeState && runtimeState.spec));
      card.appendChild(preview);

      if (runtimeState && runtimeState.error) {
        const errBox = doc.createElement('div');
        errBox.style.display = 'flex';
        errBox.style.alignItems = 'center';
        errBox.style.justifyContent = 'space-between';
        errBox.style.gap = '8px';
        errBox.style.flexWrap = 'wrap';
        errBox.style.fontSize = '11.5px';
        errBox.style.color = '#fca5a5';

        const errMsg = doc.createElement('span');
        errMsg.textContent = `Error: ${runtimeState.error}`;
        errBox.appendChild(errMsg);

        if (needsAuth || isCustom) {
          const fixAuthBtn = doc.createElement('button');
          fixAuthBtn.type = 'button';
          fixAuthBtn.className = 'agy-mcp-inline-row-btn auth';
          fixAuthBtn.textContent = '🔑 Configure Auth / Edit Settings';
          fixAuthBtn.addEventListener('click', () => {
            openEditPopup(name, { focusAuth: true });
          });
          errBox.appendChild(fixAuthBtn);
        }
        card.appendChild(errBox);
      }

      const tools = (runtimeState && Array.isArray(runtimeState.tools)) ? runtimeState.tools : [];
      const disabledToolsSet = new Set(
        (customSpec && Array.isArray(customSpec.disabledTools)) ? customSpec.disabledTools : []
      );

      if (tools.length > 0) {
        const toolsHeader = doc.createElement('div');
        toolsHeader.style.fontSize = '11px';
        toolsHeader.style.color = '#8b95b0';
        toolsHeader.textContent = `Tools (${tools.length}) ${isCustom ? '— click a tool chip to enable/disable it in mcp_config.json' : ''}:`;
        card.appendChild(toolsHeader);

        const toolsWrap = doc.createElement('div');
        toolsWrap.className = 'agy-mcp-tools-wrap';

        for (const t of tools) {
          const toolName = t && (t.name || t.toolName);
          if (!toolName) continue;
          const isToolDisabled = disabledToolsSet.has(toolName);
          const chip = doc.createElement('button');
          chip.type = 'button';
          chip.className = `agy-mcp-tool-chip${isToolDisabled ? ' disabled' : ''}`;
          chip.textContent = toolName;
          chip.title = (t && t.description) ? t.description : toolName;
          if (isCustom) {
            chip.addEventListener('click', async () => {
              try {
                await bridge.toggleServerTool(name, toolName, isToolDisabled);
                await reloadData();
                setBanner('success', `Tool "${toolName}" on "${name}" ${isToolDisabled ? 'enabled' : 'disabled'}.`);
                renderBody();
              } catch (err) {
                setBanner('error', `Failed to toggle tool: ${err.message || err}`);
              }
            });
          }
          toolsWrap.appendChild(chip);
        }
        card.appendChild(toolsWrap);
      }

      container.appendChild(card);
    }
  }

  function renderEditorTab(container) {
    renderSmartAutoAddBar(container);

    const templateSection = doc.createElement('div');
    templateSection.className = 'agy-mcp-field';
    const tplLabel = doc.createElement('div');
    tplLabel.className = 'agy-mcp-label';
    tplLabel.textContent = 'Quick Preset Templates (Click to prefill):';
    templateSection.appendChild(tplLabel);

    const tplBar = doc.createElement('div');
    tplBar.className = 'agy-mcp-templates-bar';
    for (const tpl of QUICK_TEMPLATES) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'agy-mcp-template-chip';
      btn.setAttribute('data-template-id', tpl.id);
      btn.textContent = tpl.label;
      btn.title = tpl.description;
      btn.addEventListener('click', () => {
        editingForm = {
          ...createDefaultFormState(),
          originalName: editingForm.originalName,
          serverName: tpl.serverName,
          transport: tpl.transport,
          command: tpl.command || 'npx',
          argsText: formatArgsForEditor(tpl.args || []),
          envText: formatKeyValueForEditor(tpl.env || {}, '='),
          cwd: tpl.cwd || '',
          url: tpl.url || '',
          headersText: formatKeyValueForEditor(tpl.headers || {}, ': '),
          disabled: false,
        };
        setBanner('info', `Loaded preset "${tpl.label}". Review placeholders before saving.`);
        renderBody();
      });
      tplBar.appendChild(btn);
    }
    templateSection.appendChild(tplBar);
    container.appendChild(templateSection);

    const runtimeState = findRuntimeState(editingForm.serverName || editingForm.originalName);
    renderServerConnectionFields(container, editingForm, renderBody);
    renderAuthFieldsSection(container, editingForm, runtimeState, renderBody, setBanner);

    const footerRow = doc.createElement('div');
    footerRow.style.display = 'flex';
    footerRow.style.justifyContent = 'space-between';
    footerRow.style.alignItems = 'center';
    footerRow.style.marginTop = '6px';

    const chkLabel = doc.createElement('label');
    chkLabel.style.display = 'inline-flex';
    chkLabel.style.alignItems = 'center';
    chkLabel.style.gap = '6px';
    chkLabel.style.fontSize = '12px';
    chkLabel.style.cursor = 'pointer';
    const chk = doc.createElement('input');
    chk.type = 'checkbox';
    chk.checked = Boolean(editingForm.disabled);
    chk.addEventListener('change', (e) => {
      editingForm.disabled = e.target.checked;
    });
    const chkText = doc.createElement('span');
    chkText.textContent = 'Save as disabled initially';
    chkLabel.appendChild(chk);
    chkLabel.appendChild(chkText);
    footerRow.appendChild(chkLabel);

    const actionBtns = doc.createElement('div');
    actionBtns.style.display = 'flex';
    actionBtns.style.gap = '8px';

    const cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'agy-mcp-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      activeTab = 'servers';
      renderModalContent();
    });

    const saveBtn = doc.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'agy-mcp-btn primary';
    saveBtn.setAttribute('data-testid', 'agy-mcp-save-server-btn');
    saveBtn.textContent = 'Save & Connect Server';
    saveBtn.addEventListener('click', async () => {
      try {
        const res = await saveServerForm(editingForm, setBanner);
        if (!res.ok) return;
        activeTab = 'servers';
        renderModalContent();
      } catch (err) {
        setBanner('error', err.message || String(err));
      }
    });

    actionBtns.appendChild(cancelBtn);
    actionBtns.appendChild(saveBtn);
    footerRow.appendChild(actionBtns);
    container.appendChild(footerRow);
  }

  function renderRawTab(container) {
    const pathBar = doc.createElement('div');
    pathBar.style.display = 'flex';
    pathBar.style.justifyContent = 'space-between';
    pathBar.style.alignItems = 'center';
    pathBar.style.gap = '8px';
    pathBar.style.flexWrap = 'wrap';

    const uriCode = doc.createElement('code');
    uriCode.style.fontSize = '11.5px';
    uriCode.style.color = '#a5b4fc';
    uriCode.textContent = cachedConfig.uri || 'file://~/.gemini/config/mcp_config.json';
    pathBar.appendChild(uriCode);

    const pathBtns = doc.createElement('div');
    pathBtns.style.display = 'flex';
    pathBtns.style.gap = '6px';

    const revealBtn = doc.createElement('button');
    revealBtn.type = 'button';
    revealBtn.className = 'agy-mcp-btn';
    revealBtn.textContent = 'Open in Explorer';
    revealBtn.addEventListener('click', async () => {
      await bridge.revealConfigInExplorer();
    });
    pathBtns.appendChild(revealBtn);
    pathBar.appendChild(pathBtns);
    container.appendChild(pathBar);

    const editorArea = doc.createElement('textarea');
    editorArea.className = 'agy-mcp-textarea';
    editorArea.setAttribute('data-testid', 'agy-mcp-raw-json-textarea');
    editorArea.style.minHeight = '320px';
    editorArea.value = JSON.stringify(cachedConfig.config, null, 2) + '\n';
    container.appendChild(editorArea);

    const actionRow = doc.createElement('div');
    actionRow.style.display = 'flex';
    actionRow.style.justifyContent = 'flex-end';
    actionRow.style.gap = '8px';

    const formatBtn = doc.createElement('button');
    formatBtn.type = 'button';
    formatBtn.className = 'agy-mcp-btn';
    formatBtn.textContent = 'Format JSON';
    formatBtn.addEventListener('click', () => {
      const norm = normalizeMcpConfigObject(editorArea.value);
      if (!norm.ok) {
        setBanner('error', norm.error);
        return;
      }
      editorArea.value = JSON.stringify(norm.config, null, 2) + '\n';
      setBanner('info', 'Formatted JSON.');
    });

    const saveRawBtn = doc.createElement('button');
    saveRawBtn.type = 'button';
    saveRawBtn.className = 'agy-mcp-btn primary';
    saveRawBtn.setAttribute('data-testid', 'agy-mcp-save-raw-btn');
    saveRawBtn.textContent = 'Save mcp_config.json & Refresh';
    saveRawBtn.addEventListener('click', async () => {
      const norm = normalizeMcpConfigObject(editorArea.value);
      if (!norm.ok) {
        setBanner('error', norm.error);
        return;
      }
      const res = await bridge.writeMcpConfig(norm.config);
      if (res && res.ok === false) {
        setBanner('error', res.error);
        return;
      }
      await reloadData();
      setBanner('success', 'Saved mcp_config.json and refreshed MCP servers.');
      renderBody();
    });

    actionRow.appendChild(formatBtn);
    actionRow.appendChild(saveRawBtn);
    container.appendChild(actionRow);
  }

  function renderBody() {
    const backdrop = doc.getElementById(MODAL_ID);
    if (!backdrop) return;
    const body = backdrop.querySelector('.agy-mcp-body');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    if (activeTab === 'servers') {
      renderServersTab(body);
    } else if (activeTab === 'editor') {
      renderEditorTab(body);
    } else {
      renderRawTab(body);
    }
  }

  function renderModalContent() {
    const backdrop = doc.getElementById(MODAL_ID);
    if (!backdrop) return;
    const tabs = backdrop.querySelectorAll('.agy-mcp-tab');
    tabs.forEach((tab) => {
      if (tab.getAttribute('data-tab') === activeTab) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
    renderBanner();
    renderBody();
  }

  function renderEditPopupBody() {
    const backdrop = doc.getElementById(EDIT_POPUP_ID);
    if (!backdrop) return;
    const body = backdrop.querySelector('.agy-mcp-body');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    const customMap = (cachedConfig.config && cachedConfig.config.mcpServers) || {};
    const customNames = Object.keys(customMap);
    const activeName = popupForm.originalName || popupForm.serverName;
    const runtimeState = findRuntimeState(activeName);

    // Server selector bar at top of popup
    const selectorCard = doc.createElement('div');
    selectorCard.className = 'agy-mcp-card';
    selectorCard.style.background = '#191d2b';

    const selectorRow = doc.createElement('div');
    selectorRow.style.display = 'flex';
    selectorRow.style.alignItems = 'center';
    selectorRow.style.justifyContent = 'space-between';
    selectorRow.style.gap = '10px';
    selectorRow.style.flexWrap = 'wrap';

    const selLabel = doc.createElement('label');
    selLabel.className = 'agy-mcp-label';
    selLabel.textContent = 'Select Custom MCP Server to Edit:';
    selectorRow.appendChild(selLabel);

    const sel = doc.createElement('select');
    sel.className = 'agy-mcp-select';
    sel.style.flex = '1';
    sel.style.minWidth = '220px';
    sel.setAttribute('data-field', 'popupServerSelect');

    const newOpt = doc.createElement('option');
    newOpt.value = '';
    newOpt.textContent = '+ New Custom MCP Server';
    sel.appendChild(newOpt);

    const allCandidateNames = Array.from(new Set([...customNames, ...(activeName ? [activeName] : [])]));
    for (const sName of allCandidateNames) {
      const opt = doc.createElement('option');
      opt.value = sName;
      opt.textContent = sName;
      sel.appendChild(opt);
    }
    sel.value = activeName || '';
    sel.addEventListener('change', (e) => {
      const chosen = e.target.value;
      if (!chosen) {
        popupForm = createDefaultFormState();
      } else {
        popupForm = buildFormStateFromSpec(chosen, customMap[chosen]);
      }
      popupBannerState = { type: '', message: '' };
      renderPopupBanner();
      renderEditPopupBody();
    });
    selectorRow.appendChild(sel);
    selectorCard.appendChild(selectorRow);

    if (runtimeState) {
      const stRow = doc.createElement('div');
      stRow.style.display = 'flex';
      stRow.style.alignItems = 'center';
      stRow.style.gap = '8px';
      stRow.style.flexWrap = 'wrap';
      stRow.style.fontSize = '11.5px';

      const pill = statusPillInfo(runtimeState.status, Boolean(popupForm.disabled));
      const badge = doc.createElement('span');
      badge.className = `agy-mcp-pill ${pill.cls}`;
      badge.textContent = pill.label;
      stRow.appendChild(badge);

      if (runtimeState.error) {
        const errSpan = doc.createElement('span');
        errSpan.style.color = '#fca5a5';
        errSpan.textContent = `Error: ${runtimeState.error}`;
        stRow.appendChild(errSpan);
      } else if (runtimeState.status === 2) {
        const okSpan = doc.createElement('span');
        okSpan.style.color = '#6ee7b7';
        okSpan.textContent = `Connected (${Array.isArray(runtimeState.tools) ? runtimeState.tools.length : 0} tools available)`;
        stRow.appendChild(okSpan);
      }
      selectorCard.appendChild(stRow);
    }

    body.appendChild(selectorCard);

    // Put Authentication section right at the top when editing/authenticating
    renderAuthFieldsSection(body, popupForm, runtimeState, renderEditPopupBody, setPopupBanner);
    renderServerConnectionFields(body, popupForm, renderEditPopupBody);

    const footerRow = doc.createElement('div');
    footerRow.style.display = 'flex';
    footerRow.style.justifyContent = 'space-between';
    footerRow.style.alignItems = 'center';
    footerRow.style.gap = '10px';
    footerRow.style.flexWrap = 'wrap';
    footerRow.style.marginTop = '6px';

    const leftControls = doc.createElement('div');
    leftControls.style.display = 'flex';
    leftControls.style.alignItems = 'center';
    leftControls.style.gap = '10px';

    const chkLabel = doc.createElement('label');
    chkLabel.style.display = 'inline-flex';
    chkLabel.style.alignItems = 'center';
    chkLabel.style.gap = '6px';
    chkLabel.style.fontSize = '12px';
    chkLabel.style.cursor = 'pointer';
    const chk = doc.createElement('input');
    chk.type = 'checkbox';
    chk.checked = Boolean(popupForm.disabled);
    chk.addEventListener('change', (e) => {
      popupForm.disabled = e.target.checked;
    });
    const chkText = doc.createElement('span');
    chkText.textContent = 'Save as disabled initially';
    chkLabel.appendChild(chk);
    chkLabel.appendChild(chkText);
    leftControls.appendChild(chkLabel);

    if (popupForm.originalName && customMap[popupForm.originalName]) {
      const delBtn = doc.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'agy-mcp-btn danger';
      delBtn.setAttribute('data-testid', 'agy-mcp-popup-delete-btn');
      delBtn.textContent = 'Delete Server';
      delBtn.addEventListener('click', async () => {
        try {
          await bridge.deleteCustomServer(popupForm.originalName);
          await reloadData();
          if (isOpen()) renderModalContent();
          const remaining = Object.keys((cachedConfig.config && cachedConfig.config.mcpServers) || {});
          if (remaining.length > 0) {
            popupForm = buildFormStateFromSpec(remaining[0], cachedConfig.config.mcpServers[remaining[0]]);
            setPopupBanner('success', 'Deleted custom server.');
            renderEditPopupBody();
          } else {
            closeEditPopup();
          }
        } catch (err) {
          setPopupBanner('error', err.message || String(err));
        }
      });
      leftControls.appendChild(delBtn);
    }

    footerRow.appendChild(leftControls);

    const rightBtns = doc.createElement('div');
    rightBtns.style.display = 'flex';
    rightBtns.style.gap = '8px';

    const openFullBtn = doc.createElement('button');
    openFullBtn.type = 'button';
    openFullBtn.className = 'agy-mcp-btn';
    openFullBtn.textContent = 'Open Full Manager';
    openFullBtn.addEventListener('click', () => {
      closeEditPopup();
      openModal('servers');
    });

    const cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'agy-mcp-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => closeEditPopup());

    const saveBtn = doc.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'agy-mcp-btn primary';
    saveBtn.setAttribute('data-testid', 'agy-mcp-popup-save-btn');
    saveBtn.textContent = 'Save & Reconnect';
    saveBtn.addEventListener('click', async () => {
      try {
        const res = await saveServerForm(popupForm, setPopupBanner);
        if (!res.ok) return;
        popupForm = buildFormStateFromSpec(res.serverName, res.spec);
        renderEditPopupBody();
        if (isOpen()) renderModalContent();
      } catch (err) {
        setPopupBanner('error', err.message || String(err));
      }
    });

    rightBtns.appendChild(openFullBtn);
    rightBtns.appendChild(cancelBtn);
    rightBtns.appendChild(saveBtn);
    footerRow.appendChild(rightBtns);
    body.appendChild(footerRow);
  }

  async function openEditPopup(serverName = '', options = {}) {
    ensureModalStyles(doc);
    popupBannerState = { type: '', message: '' };
    await reloadData();

    const customMap = (cachedConfig.config && cachedConfig.config.mcpServers) || {};
    const customNames = Object.keys(customMap);
    const targetName = serverName || customNames[0] || '';
    const targetSpec = targetName ? customMap[targetName] : null;
    popupForm = buildFormStateFromSpec(targetName, targetSpec, options);

    let backdrop = doc.getElementById(EDIT_POPUP_ID);
    if (!backdrop) {
      backdrop = doc.createElement('div');
      backdrop.id = EDIT_POPUP_ID;
      backdrop.setAttribute('data-testid', 'agy-mcp-edit-popup');
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeEditPopup();
      });

      const dialog = doc.createElement('div');
      dialog.className = 'agy-mcp-dialog popup';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', 'Edit Custom MCP Server & Authentication');

      const header = doc.createElement('div');
      header.className = 'agy-mcp-header';
      const titleWrap = doc.createElement('div');
      titleWrap.className = 'agy-mcp-title-wrap';
      const title = doc.createElement('h2');
      title.className = 'agy-mcp-title';
      title.textContent = '⚙️ Edit Custom MCP Server & Authentication';
      const badge = doc.createElement('span');
      badge.className = 'agy-mcp-badge';
      badge.textContent = 'Custom Config';
      titleWrap.appendChild(title);
      titleWrap.appendChild(badge);

      const closeBtn = doc.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'agy-mcp-close-btn';
      closeBtn.setAttribute('aria-label', 'Close Edit Popup');
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => closeEditPopup());

      header.appendChild(titleWrap);
      header.appendChild(closeBtn);
      dialog.appendChild(header);

      const banner = doc.createElement('div');
      banner.className = 'agy-mcp-status-banner';
      dialog.appendChild(banner);

      const body = doc.createElement('div');
      body.className = 'agy-mcp-body';
      dialog.appendChild(body);

      backdrop.appendChild(dialog);
      doc.body.appendChild(backdrop);
    }

    renderPopupBanner();
    renderEditPopupBody();
  }

  function closeEditPopup() {
    const backdrop = doc.getElementById(EDIT_POPUP_ID);
    if (backdrop && backdrop.parentNode) {
      backdrop.parentNode.removeChild(backdrop);
    }
  }

  function isEditPopupOpen() {
    return Boolean(doc.getElementById(EDIT_POPUP_ID));
  }

  async function openModal(initialTab = 'servers') {
    ensureModalStyles(doc);
    activeTab = initialTab;
    bannerState = { type: '', message: '' };

    let backdrop = doc.getElementById(MODAL_ID);
    if (!backdrop) {
      backdrop = doc.createElement('div');
      backdrop.id = MODAL_ID;
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });

      const dialog = doc.createElement('div');
      dialog.className = 'agy-mcp-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', 'Antigravity Custom MCP Server Manager');

      // Header
      const header = doc.createElement('div');
      header.className = 'agy-mcp-header';
      const titleWrap = doc.createElement('div');
      titleWrap.className = 'agy-mcp-title-wrap';
      const title = doc.createElement('h2');
      title.className = 'agy-mcp-title';
      title.textContent = '🔌 Antigravity Custom MCP Server Manager';
      const badge = doc.createElement('span');
      badge.className = 'agy-mcp-badge';
      badge.textContent = 'Native RPC Bridge';
      titleWrap.appendChild(title);
      titleWrap.appendChild(badge);

      const closeBtn = doc.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'agy-mcp-close-btn';
      closeBtn.setAttribute('aria-label', 'Close MCP Manager');
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => closeModal());

      header.appendChild(titleWrap);
      header.appendChild(closeBtn);
      dialog.appendChild(header);

      // Tabs
      const tabsBar = doc.createElement('div');
      tabsBar.className = 'agy-mcp-tabs';
      const tabDefs = [
        { id: 'servers', label: 'Servers & Tools' },
        { id: 'editor', label: '+ Add / Edit Server' },
        { id: 'raw', label: '{ } Raw mcp_config.json' },
      ];
      for (const td of tabDefs) {
        const tBtn = doc.createElement('button');
        tBtn.type = 'button';
        tBtn.className = 'agy-mcp-tab';
        tBtn.setAttribute('data-tab', td.id);
        tBtn.textContent = td.label;
        tBtn.addEventListener('click', () => {
          if (td.id === 'editor' && !editingForm.serverName) {
            resetForm();
          }
          activeTab = td.id;
          renderModalContent();
        });
        tabsBar.appendChild(tBtn);
      }
      dialog.appendChild(tabsBar);

      // Banner
      const banner = doc.createElement('div');
      banner.className = 'agy-mcp-status-banner';
      dialog.appendChild(banner);

      // Body
      const body = doc.createElement('div');
      body.className = 'agy-mcp-body';
      dialog.appendChild(body);

      backdrop.appendChild(dialog);
      doc.body.appendChild(backdrop);
    }

    renderModalContent();
    await reloadData();
    renderModalContent();
  }

  function closeModal() {
    const backdrop = doc.getElementById(MODAL_ID);
    if (backdrop && backdrop.parentNode) {
      backdrop.parentNode.removeChild(backdrop);
    }
  }

  function isOpen() {
    return Boolean(doc.getElementById(MODAL_ID));
  }

  return {
    openModal,
    closeModal,
    isOpen,
    openEditPopup,
    closeEditPopup,
    isEditPopupOpen,
    reloadData,
    getCachedState: () => ({ config: cachedConfig.config, states: cachedStates }),
  };
}

module.exports = {
  MODAL_ID,
  EDIT_POPUP_ID,
  STYLE_ID,
  isAuthErrorText,
  ensureModalStyles,
  createModalController,
};
