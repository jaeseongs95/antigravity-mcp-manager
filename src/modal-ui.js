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
const OAUTH_MODAL_ID = 'agy-mcp-oauth-connect-backdrop';
const STYLE_ID = 'agy-mcp-manager-styles';

function isAuthErrorText(errText) {
  if (!errText || typeof errText !== 'string') return false;
  return /unauthorized|401|403|forbidden|authentication|unauthenticated|invalid[_\s-]?token|missing.*authorization|bearer|api[_\s-]?key|oauth/i.test(
    errText
  );
}

const MODAL_STYLE_CSS = `
    #${MODAL_ID}, #${EDIT_POPUP_ID}, #${OAUTH_MODAL_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483645;
      background: rgba(9, 11, 17, 0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif;
      font-variant-numeric: tabular-nums;
      color: #e4e7ef;
      padding: 20px;
      box-sizing: border-box;
    }
    #${EDIT_POPUP_ID} {
      z-index: 2147483646;
    }
    #${OAUTH_MODAL_ID} {
      z-index: 2147483647;
    }
    #${MODAL_ID} *, #${EDIT_POPUP_ID} *, #${OAUTH_MODAL_ID} *, #agy-mcp-settings-pane * {
      box-sizing: border-box;
    }
    .agy-mcp-dialog {
      width: min(860px, 96vw);
      max-height: min(800px, 92vh);
      background: #161821;
      border: 1px solid #2c3144;
      border-radius: 14px;
      box-shadow: 0 22px 60px rgba(0, 0, 0, 0.65);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      contain: layout style;
    }
    .agy-mcp-dialog.popup {
      width: min(640px, 95vw);
      max-height: min(780px, 92vh);
      border-color: #3b425e;
    }
    .agy-mcp-dialog.oauth-connect {
      width: min(440px, 94vw);
      background: #181a24;
      border: 1px solid #32384e;
      border-radius: 20px;
      padding: 26px 24px 22px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 14px;
      position: relative;
    }
    .agy-mcp-oauth-icons {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-top: 4px;
    }
    .agy-mcp-oauth-icon-box {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: 700;
      background: #232738;
      border: 1px solid #383f58;
      color: #f8fafc;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    }
    .agy-mcp-oauth-icon-box.brand {
      background: linear-gradient(135deg, #4f46e5, #3730a3);
      border-color: #6366f1;
    }
    .agy-mcp-oauth-dots {
      color: #64748b;
      font-size: 18px;
      letter-spacing: 2px;
      font-weight: 700;
    }
    .agy-mcp-oauth-title {
      font-size: 20px;
      font-weight: 700;
      color: #f8fafc;
      margin: 2px 0 0 0;
    }
    .agy-mcp-oauth-desc {
      font-size: 12.5px;
      line-height: 1.55;
      color: #94a3b8;
      text-align: left;
      background: rgba(255, 255, 255, 0.025);
      border: 1px solid rgba(148, 163, 184, 0.14);
      border-radius: 10px;
      padding: 12px 14px;
      width: 100%;
    }
    .agy-mcp-oauth-full-btn {
      width: 100%;
      padding: 11px 16px;
      border-radius: 999px;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.14s ease;
    }
    .agy-mcp-oauth-full-btn.launch {
      background: #4f46e5;
      border-color: #6366f1;
      color: #ffffff;
    }
    .agy-mcp-oauth-full-btn.launch:hover {
      background: #4338ca;
    }
    .agy-mcp-oauth-full-btn.cancel {
      background: #25293a;
      border-color: #383f58;
      color: #e2e8f0;
    }
    .agy-mcp-oauth-full-btn.cancel:hover {
      background: #2f354a;
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
      border-radius: 7px;
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
      border-radius: 10px;
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
      border-radius: 6px;
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
      font-size: 12.5px;
      font-weight: 600;
      color: #e2e8f0;
    }
    .agy-mcp-hint {
      font-size: 11.5px;
      color: #8b95b0;
      line-height: 1.45;
    }
    .agy-mcp-input, .agy-mcp-textarea, .agy-mcp-select {
      width: 100%;
      background: #12151f;
      border: 1px solid #2d3348;
      border-radius: 8px;
      padding: 8px 11px;
      color: #f1f5f9;
      font-size: 12.5px;
      font-family: inherit;
    }
    .agy-mcp-textarea {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      min-height: 70px;
      resize: vertical;
    }
    .agy-mcp-input:focus, .agy-mcp-textarea:focus, .agy-mcp-select:focus {
      outline: none;
      border-color: #6366f1;
    }
    .agy-mcp-segmented {
      display: inline-flex;
      align-items: center;
      background: #11141d;
      border: 1px solid #2b3147;
      border-radius: 999px;
      padding: 2px;
      gap: 2px;
    }
    .agy-mcp-seg-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 11.5px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 999px;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .agy-mcp-seg-btn.active {
      background: #272d42;
      color: #f8fafc;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    }
    .agy-mcp-adv-oauth-card {
      background: #191d2b;
      border: 1px solid #2d344d;
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .agy-mcp-adv-oauth-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      cursor: pointer;
      user-select: none;
    }
    .agy-mcp-risk-notice {
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.28);
      border-radius: 10px;
      padding: 10px 13px;
      font-size: 11.5px;
      color: #fcd34d;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      line-height: 1.45;
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
      background: rgba(99, 102, 241, 0.18);
      border-color: rgba(99, 102, 241, 0.48);
      color: #c7d2fe;
    }
    .agy-mcp-btn.auth:hover {
      background: rgba(99, 102, 241, 0.3);
      border-color: rgba(99, 102, 241, 0.7);
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
      background: rgba(99, 102, 241, 0.18);
      border-color: rgba(99, 102, 241, 0.48);
      color: #c7d2fe;
    }
    .agy-mcp-inline-row-btn.auth:hover {
      background: rgba(99, 102, 241, 0.32);
      border-color: rgba(99, 102, 241, 0.75);
    }
    .agy-mcp-auth-box {
      background: rgba(99, 102, 241, 0.06);
      border: 1px solid rgba(99, 102, 241, 0.28);
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
  `.replace(/\s+/g, ' ').trim();

function ensureModalStyles(doc) {
  if (!doc || !doc.head) return;
  let style = doc.getElementById(STYLE_ID);
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    doc.head.appendChild(style);
  }
  if (style.textContent !== MODAL_STYLE_CSS) {
    style.textContent = MODAL_STYLE_CSS;
  }
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

function formatSpecPreview(spec, runtimeState) {
  if (!spec || typeof spec !== 'object') return '(managed by plugin)';
  if (spec.url || spec.serverUrl) {
    const hasCustomAuthHdr = Boolean(
      spec.headers &&
      Object.keys(spec.headers).some((k) =>
        /^(?:authorization|x-api-key|api-key|x-auth-token|x-mcp-token|x-access-token)$/i.test(k)
      )
    );
    const hasOAuth = Boolean(runtimeState?.hasAuthToken || runtimeState?.authUrl || spec.oauth);
    const suffix = runtimeState?.hasAuthToken
      ? '  [🔗 OAuth Connected]'
      : hasCustomAuthHdr
      ? '  [🔑 Auth Header Configured]'
      : hasOAuth
      ? '  [🔗 OAuth]'
      : '';
    return `HTTP ${spec.url || spec.serverUrl}${suffix}`;
  }
  const cmd = spec.command || '';
  const args = Array.isArray(spec.args) ? spec.args.join(' ') : '';
  return `${cmd} ${args}`.trim() || '(empty command)';
}

function createDefaultFormState() {
  return {
    originalName: '',
    serverName: '',
    description: '',
    transport: 'http',
    command: 'npx',
    argsText: '',
    envText: '',
    cwd: '',
    url: '',
    headersText: '',
    authMode: 'oauth',
    oauthClientMode: 'auto',
    oauthClientId: '',
    oauthClientSecret: '',
    oauthScopes: '',
    advancedOAuthOpen: false,
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
  let oauthPollTimer = null;

  function setBanner(type, message) {
    bannerState = { type, message };
    renderBanner();
  }

  function setPopupBanner(type, message) {
    popupBannerState = { type, message };
    renderPopupBanner();
  }

  function renderBanner() {
    const roots = [doc.getElementById(MODAL_ID), doc.getElementById('agy-mcp-settings-pane')].filter(Boolean);
    for (const root of roots) {
      const banner = root.querySelector('.agy-mcp-status-banner');
      if (!banner) continue;
      banner.className = 'agy-mcp-status-banner';
      if (bannerState.type && bannerState.message) {
        banner.classList.add(bannerState.type);
        banner.textContent = bannerState.message;
      } else {
        banner.textContent = '';
      }
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

  function refreshEmbeddedSettingsPaneIfVisible() {
    const pane = doc.getElementById('agy-mcp-settings-pane');
    if (pane && pane.style.display !== 'none') {
      renderSettingsPageContent(pane);
    }
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
      refreshEmbeddedSettingsPaneIfVisible();
    } catch (err) {
      setBanner('error', `Failed to load MCP configuration: ${err.message || err}`);
    }
  }

  function buildFormStateFromSpec(serverName, spec, options = {}) {
    const runtimeState = findRuntimeState(serverName);
    const effectiveSpec = spec || runtimeState?.spec || {};
    const hasExplicitCmd = Boolean(effectiveSpec && typeof effectiveSpec.command === 'string' && effectiveSpec.command.trim());
    const hasExplicitUrl = Boolean(effectiveSpec && (effectiveSpec.url || effectiveSpec.serverUrl || effectiveSpec.type === 'http'));
    const isHttp = hasExplicitUrl || (!hasExplicitCmd && !serverName);
    const extractedAuth = extractAuthFromSpec(isHttp ? { ...effectiveSpec, url: effectiveSpec.url || effectiveSpec.serverUrl || 'https://example.com/mcp' } : effectiveSpec);
    const authMode = extractedAuth.authMode || (isHttp ? 'oauth' : 'none');

    return {
      originalName: options.isPrefill ? '' : (serverName || ''),
      serverName: serverName || '',
      description: (effectiveSpec && typeof effectiveSpec.description === 'string') ? effectiveSpec.description : '',
      transport: isHttp ? 'http' : 'stdio',
      command: effectiveSpec && effectiveSpec.command ? effectiveSpec.command : 'npx',
      argsText: formatArgsForEditor(effectiveSpec && effectiveSpec.args),
      envText: formatKeyValueForEditor(effectiveSpec && effectiveSpec.env, '='),
      cwd: effectiveSpec && effectiveSpec.cwd ? effectiveSpec.cwd : '',
      url: (effectiveSpec && (effectiveSpec.url || effectiveSpec.serverUrl)) || '',
      headersText: formatKeyValueForEditor(
        (authMode === 'none' || authMode === 'oauth' || authMode === 'oauth_or_none')
          ? extractedAuth.extraHeaders
          : extractedAuth.extraHeaders,
        ': '
      ),
      authMode,
      oauthClientMode: extractedAuth.oauthClientMode || 'auto',
      oauthClientId: extractedAuth.oauthClientId || '',
      oauthClientSecret: extractedAuth.oauthClientSecret || '',
      oauthScopes: extractedAuth.oauthScopes || '',
      advancedOAuthOpen: Boolean(extractedAuth.oauthClientId || extractedAuth.oauthClientSecret || options.focusAuth),
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

  function closeOAuthConnectModal() {
    if (oauthPollTimer) {
      clearInterval(oauthPollTimer);
      oauthPollTimer = null;
    }
    const backdrop = doc.getElementById(OAUTH_MODAL_ID);
    if (backdrop && backdrop.parentNode) {
      backdrop.parentNode.removeChild(backdrop);
    }
  }

  function isOAuthConnectModalOpen() {
    return Boolean(doc.getElementById(OAUTH_MODAL_ID));
  }

  async function openOAuthConnectModal(serverName, initialAuthUrl = '') {
    ensureModalStyles(doc);
    closeOAuthConnectModal();
    await reloadData();

    let st = findRuntimeState(serverName);
    if (!initialAuthUrl && (!st || (!st.authUrl && !st.hasAuthToken)) && typeof bridge.waitForServerOAuthOrReady === 'function') {
      st = await bridge.waitForServerOAuthOrReady(serverName, 2500);
      await reloadData();
    }
    const authUrl = initialAuthUrl || st?.authUrl || '';

    const backdrop = doc.createElement('div');
    backdrop.id = OAUTH_MODAL_ID;
    backdrop.setAttribute('data-testid', 'agy-mcp-oauth-connect-modal');
    backdrop.setAttribute('data-agy-custom-mcp-btn', 'oauth-modal');
    backdrop.setAttribute('data-agy-no-translate', 'true');
    backdrop.setAttribute('translate', 'no');
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeOAuthConnectModal();
    });

    const dialog = doc.createElement('div');
    dialog.className = 'agy-mcp-dialog oauth-connect';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', `Connect ${serverName}`);

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'agy-mcp-close-btn';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '14px';
    closeBtn.style.right = '14px';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => closeOAuthConnectModal());
    dialog.appendChild(closeBtn);

    const iconsRow = doc.createElement('div');
    iconsRow.className = 'agy-mcp-oauth-icons';
    const brandIcon = doc.createElement('div');
    brandIcon.className = 'agy-mcp-oauth-icon-box brand';
    brandIcon.textContent = 'A';
    const dots = doc.createElement('span');
    dots.className = 'agy-mcp-oauth-dots';
    dots.textContent = '•••';
    const mcpIcon = doc.createElement('div');
    mcpIcon.className = 'agy-mcp-oauth-icon-box';
    mcpIcon.textContent = '🔗';
    iconsRow.appendChild(brandIcon);
    iconsRow.appendChild(dots);
    iconsRow.appendChild(mcpIcon);
    dialog.appendChild(iconsRow);

    const titleEl = doc.createElement('h2');
    titleEl.className = 'agy-mcp-oauth-title';
    titleEl.textContent = `Connect ${serverName}`;
    dialog.appendChild(titleEl);

    const descEl = doc.createElement('div');
    descEl.className = 'agy-mcp-oauth-desc';
    descEl.textContent =
      `Antigravity uses browser OAuth authentication to interact with the "${serverName}" MCP server. Click Connect below to sign in and authorize access in your browser.`;
    dialog.appendChild(descEl);

    const statusLine = doc.createElement('div');
    statusLine.className = 'agy-mcp-hint';
    statusLine.style.color = authUrl ? '#a5b4fc' : '#fcd34d';
    statusLine.textContent = authUrl
      ? 'OAuth authorization URL is ready.'
      : 'Checking OAuth authorization URL from host...';
    dialog.appendChild(statusLine);

    const codeSection = doc.createElement('div');
    codeSection.style.display = 'flex';
    codeSection.style.width = '100%';
    codeSection.style.flexDirection = 'column';
    codeSection.style.gap = '6px';

    const codeInputRow = doc.createElement('div');
    codeInputRow.style.display = 'flex';
    codeInputRow.style.gap = '6px';
    codeInputRow.style.width = '100%';

    const codeInput = doc.createElement('input');
    codeInput.type = 'text';
    codeInput.className = 'agy-mcp-input';
    codeInput.style.flex = '1';
    codeInput.setAttribute('data-field', 'oauthModalCode');
    codeInput.placeholder = 'Paste authorization code here if shown in browser (optional)';

    const codeSubmitBtn = doc.createElement('button');
    codeSubmitBtn.type = 'button';
    codeSubmitBtn.className = 'agy-mcp-btn primary';
    codeSubmitBtn.textContent = 'Submit Code';
    codeSubmitBtn.addEventListener('click', async () => {
      const code = codeInput.value.trim();
      if (!code) return;
      statusLine.style.color = '#93c5fd';
      statusLine.textContent = 'Submitting OAuth authorization code...';
      const res = await bridge.completeOAuth(serverName, code);
      if (!res || !res.ok) {
        statusLine.style.color = '#fca5a5';
        statusLine.textContent = (res && res.error) || 'Failed to submit OAuth authorization code.';
        return;
      }
      await reloadData();
      closeOAuthConnectModal();
      setBanner('success', `OAuth authentication and connection completed for "${serverName}".`);
      if (isOpen()) renderModalContent();
      if (isEditPopupOpen()) renderEditPopupBody();
    });

    codeInputRow.appendChild(codeInput);
    codeInputRow.appendChild(codeSubmitBtn);
    codeSection.appendChild(codeInputRow);
    dialog.appendChild(codeSection);

    const launchBtn = doc.createElement('button');
    launchBtn.type = 'button';
    launchBtn.className = 'agy-mcp-oauth-full-btn launch';
    launchBtn.setAttribute('data-testid', 'agy-mcp-oauth-launch-btn');
    launchBtn.textContent = `Connect ${serverName} ↗`;
    launchBtn.addEventListener('click', async () => {
      let targetUrl = authUrl;
      if (!targetUrl && typeof bridge.waitForServerOAuthOrReady === 'function') {
        statusLine.textContent = 'Requesting OAuth session from host...';
        await bridge.refreshServers(serverName);
        const refreshedState = await bridge.waitForServerOAuthOrReady(serverName, 3500);
        targetUrl = refreshedState?.authUrl || '';
      }
      if (targetUrl) {
        bridge.openAuthUrl(targetUrl);
        statusLine.style.color = '#6ee7b7';
        statusLine.textContent = 'Opened OAuth authorization window in your browser. It will connect automatically once signed in.';
        codeSection.style.display = 'flex';
        if (oauthPollTimer) clearInterval(oauthPollTimer);
        let ticks = 0;
        oauthPollTimer = setInterval(async () => {
          ticks++;
          if (ticks > 60 || !isOAuthConnectModalOpen()) {
            clearInterval(oauthPollTimer);
            oauthPollTimer = null;
            return;
          }
          await reloadData();
          const cur = findRuntimeState(serverName);
          if (cur && (cur.hasAuthToken || cur.status === 2)) {
            clearInterval(oauthPollTimer);
            oauthPollTimer = null;
            closeOAuthConnectModal();
            setBanner('success', `OAuth authentication and connection completed for "${serverName}".`);
            if (isOpen()) renderModalContent();
            if (isEditPopupOpen()) renderEditPopupBody();
          }
        }, 1200);
      } else {
        statusLine.style.color = '#fca5a5';
        statusLine.textContent =
          'Could not retrieve OAuth authorization URL (authUrl) from host. Verify that the server URL supports OAuth Discovery (/.well-known/oauth-authorization-server).';
      }
    });
    dialog.appendChild(launchBtn);

    const cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'agy-mcp-oauth-full-btn cancel';
    cancelBtn.setAttribute('data-testid', 'agy-mcp-oauth-cancel-btn');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => closeOAuthConnectModal());
    dialog.appendChild(cancelBtn);

    backdrop.appendChild(dialog);
    doc.body.appendChild(backdrop);
  }

  function renderSmartAutoAddBar(container) {
    const box = doc.createElement('div');
    box.className = 'agy-mcp-card';
    box.style.background = 'rgba(79, 70, 229, 0.09)';
    box.style.borderColor = 'rgba(99, 102, 241, 0.38)';

    const label = doc.createElement('div');
    label.className = 'agy-mcp-label';
    label.textContent = '⚡ Quick Auto-Add (Enter MCP Portal / Server URL, GitHub/npm Address, Command, or JSON):';
    box.appendChild(label);

    const row = doc.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.style.flexWrap = 'wrap';

    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'agy-mcp-input';
    input.style.flex = '1';
    input.style.minWidth = '240px';
    input.setAttribute('data-testid', 'agy-mcp-smart-input');
    input.placeholder = 'https://example.com/mcp (OAuth auto-discovered), https://github.com/owner/repo, or npx -y ...';

    async function handleQuickConnect() {
      const parsed = parseSmartMcpInput(input.value);
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
          let st = null;
          if ((parsed.spec?.url || parsed.spec?.serverUrl) && typeof bridge.waitForServerOAuthOrReady === 'function') {
            st = await bridge.waitForServerOAuthOrReady(parsed.serverName, 3000);
          }
          await reloadData();
          st = st || findRuntimeState(parsed.serverName);
          if (st && st.authUrl && !st.hasAuthToken) {
            setBanner('info', `OAuth authentication detected for "${parsed.serverName}". Complete sign-in in the connection dialog.`);
            openOAuthConnectModal(parsed.serverName, st.authUrl);
          } else {
            setBanner('success', `Automatically added and connected "${parsed.serverName}".`);
          }
        }
        input.value = '';
        activeTab = 'servers';
        if (isOpen()) renderModalContent();
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
      const parsed = parseSmartMcpInput(input.value);
      if (!parsed.ok) {
        setBanner('error', parsed.error);
        return;
      }
      populateFormFromSpec(parsed.serverName, parsed.spec, { isPrefill: true });
      activeTab = 'editor';
      setBanner('info', `Auto-filled form for "${parsed.serverName}". Review OAuth / connection settings below.`);
      if (isOpen()) {
        renderModalContent();
      } else {
        openEditPopup(parsed.serverName, { prefillSpec: parsed.spec, isPrefill: true });
        setPopupBanner('info', `Auto-filled form for "${parsed.serverName}". Review OAuth / connection settings below.`);
      }
    });

    row.appendChild(input);
    row.appendChild(autoConnectBtn);
    row.appendChild(fillFormBtn);
    box.appendChild(row);
    container.appendChild(box);
  }

  function renderAuthFieldsSection(container, formObj, runtimeState, reRenderFn, bannerFn) {
    const authBox = doc.createElement('div');
    authBox.className = 'agy-mcp-auth-box';
    authBox.setAttribute('data-testid', 'agy-mcp-auth-section');

    const authField = doc.createElement('div');
    authField.className = 'agy-mcp-field full';

    const titleEl = doc.createElement('label');
    titleEl.className = 'agy-mcp-label';
    titleEl.textContent = 'Authentication';
    authField.appendChild(titleEl);

    const modeSelect = doc.createElement('select');
    modeSelect.className = 'agy-mcp-select';
    modeSelect.setAttribute('data-field', 'authMode');
    const authOptions = [
      { value: 'oauth', label: 'OAuth' },
      { value: 'none', label: 'No Authentication' },
      { value: 'oauth_or_none', label: 'OAuth or No Authentication' },
      { value: 'bearer', label: 'Bearer Token (Authorization: Bearer <token>)' },
      { value: 'apiKey', label: 'API Key Header (X-API-Key or Custom Header)' },
      { value: 'basic', label: 'Basic Auth (Username & Password)' },
    ];
    for (const opt of authOptions) {
      const o = doc.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      modeSelect.appendChild(o);
    }
    modeSelect.value = formObj.authMode || (formObj.transport === 'http' ? 'oauth' : 'none');
    modeSelect.addEventListener('change', (e) => {
      formObj.authMode = e.target.value;
      reRenderFn();
    });
    authField.appendChild(modeSelect);
    authBox.appendChild(authField);

    if (formObj.authMode === 'oauth' || formObj.authMode === 'oauth_or_none') {
      const authUrl = runtimeState?.authUrl || '';
      const hasToken = Boolean(runtimeState?.hasAuthToken);
      const activeServerName = formObj.serverName || formObj.originalName;

      // Instant OAuth Connect bar if server is already registered or has authUrl
      if (authUrl || hasToken || activeServerName) {
        const quickOAuthBar = doc.createElement('div');
        quickOAuthBar.style.display = 'flex';
        quickOAuthBar.style.alignItems = 'center';
        quickOAuthBar.style.justifyContent = 'space-between';
        quickOAuthBar.style.flexWrap = 'wrap';
        quickOAuthBar.style.gap = '8px';
        quickOAuthBar.style.padding = '8px 11px';
        quickOAuthBar.style.borderRadius = '8px';
        quickOAuthBar.style.background = hasToken ? 'rgba(16, 185, 129, 0.12)' : 'rgba(79, 70, 229, 0.14)';
        quickOAuthBar.style.border = hasToken
          ? '1px solid rgba(16, 185, 129, 0.35)'
          : '1px solid rgba(99, 102, 241, 0.38)';

        const statusTxt = doc.createElement('span');
        statusTxt.style.fontSize = '12px';
        statusTxt.style.color = hasToken ? '#6ee7b7' : '#c7d2fe';
        statusTxt.textContent = hasToken
          ? `● OAuth Connected (${activeServerName})`
          : authUrl
          ? `🔗 OAuth Ready — Sign in to "${activeServerName}" in your browser.`
          : 'Automatically detects MCP portal OAuth settings and opens the sign-in window after saving.';
        quickOAuthBar.appendChild(statusTxt);

        const btnWrap = doc.createElement('div');
        btnWrap.style.display = 'flex';
        btnWrap.style.gap = '6px';

        if (activeServerName && !hasToken) {
          const connectBtn = doc.createElement('button');
          connectBtn.type = 'button';
          connectBtn.className = 'agy-mcp-btn primary';
          connectBtn.setAttribute('data-testid', 'agy-mcp-open-oauth-connect-btn');
          connectBtn.textContent = `Connect ${activeServerName} ↗`;
          connectBtn.addEventListener('click', () => {
            openOAuthConnectModal(activeServerName, authUrl);
          });
          btnWrap.appendChild(connectBtn);
        }

        if (hasToken && activeServerName) {
          const signOutBtn = doc.createElement('button');
          signOutBtn.type = 'button';
          signOutBtn.className = 'agy-mcp-btn danger';
          signOutBtn.textContent = 'Disconnect OAuth';
          signOutBtn.addEventListener('click', async () => {
            const res = await bridge.disconnectOAuth(activeServerName);
            if (!res || !res.ok) {
              bannerFn('error', (res && res.error) || 'Failed to disconnect OAuth.');
              return;
            }
            await reloadData();
            bannerFn('info', `Disconnected OAuth for "${activeServerName}".`);
            reRenderFn();
          });
          btnWrap.appendChild(signOutBtn);
        }

        quickOAuthBar.appendChild(btnWrap);
        authBox.appendChild(quickOAuthBar);
      }

      // Collapsible "Advanced OAuth Settings" card matching ChatGPT's UI
      const advCard = doc.createElement('div');
      advCard.className = 'agy-mcp-adv-oauth-card';

      const advHeader = doc.createElement('div');
      advHeader.className = 'agy-mcp-adv-oauth-header';
      advHeader.setAttribute('data-testid', 'agy-mcp-advanced-oauth-toggle');

      const advLeft = doc.createElement('div');
      advLeft.style.display = 'flex';
      advLeft.style.flexDirection = 'column';
      advLeft.style.gap = '3px';

      const advTitle = doc.createElement('div');
      advTitle.className = 'agy-mcp-label';
      advTitle.textContent = 'Advanced OAuth Settings';

      const advSub = doc.createElement('div');
      advSub.className = 'agy-mcp-hint';
      advSub.textContent =
        'Review auto-detected OAuth settings or enter custom credentials, select client configuration mode, and set default scopes.';

      advLeft.appendChild(advTitle);
      advLeft.appendChild(advSub);

      const advArrow = doc.createElement('span');
      advArrow.style.fontSize = '16px';
      advArrow.style.color = '#94a3b8';
      advArrow.textContent = formObj.advancedOAuthOpen ? '⌄' : '›';

      advHeader.appendChild(advLeft);
      advHeader.appendChild(advArrow);
      advHeader.addEventListener('click', () => {
        formObj.advancedOAuthOpen = !formObj.advancedOAuthOpen;
        reRenderFn();
      });
      advCard.appendChild(advHeader);

      if (formObj.advancedOAuthOpen) {
        const advBody = doc.createElement('div');
        advBody.style.display = 'flex';
        advBody.style.flexDirection = 'column';
        advBody.style.gap = '10px';
        advBody.style.paddingTop = '8px';
        advBody.style.borderTop = '1px solid #2b324a';

        const clientModeField = doc.createElement('div');
        clientModeField.className = 'agy-mcp-field';
        const cmLbl = doc.createElement('label');
        cmLbl.className = 'agy-mcp-label';
        cmLbl.textContent = 'Client Configuration';
        const cmSelect = doc.createElement('select');
        cmSelect.className = 'agy-mcp-select';
        cmSelect.setAttribute('data-field', 'oauthClientMode');
        const optAuto = doc.createElement('option');
        optAuto.value = 'auto';
        optAuto.textContent = 'Automatic Discovery & Dynamic Client Registration';
        const optCustom = doc.createElement('option');
        optCustom.value = 'custom';
        optCustom.textContent = 'Custom Client ID & Secret';
        cmSelect.appendChild(optAuto);
        cmSelect.appendChild(optCustom);
        cmSelect.value = formObj.oauthClientMode || 'auto';
        cmSelect.addEventListener('change', (e) => {
          formObj.oauthClientMode = e.target.value;
          reRenderFn();
        });
        clientModeField.appendChild(cmLbl);
        clientModeField.appendChild(cmSelect);
        advBody.appendChild(clientModeField);

        if (formObj.oauthClientMode === 'custom') {
          const grid = doc.createElement('div');
          grid.className = 'agy-mcp-form-grid';

          const cidField = doc.createElement('div');
          cidField.className = 'agy-mcp-field';
          const cidLbl = doc.createElement('label');
          cidLbl.className = 'agy-mcp-label';
          cidLbl.textContent = 'Client ID';
          const cidInput = doc.createElement('input');
          cidInput.className = 'agy-mcp-input';
          cidInput.setAttribute('data-field', 'oauthClientId');
          cidInput.placeholder = 'OAuth Client ID';
          cidInput.value = formObj.oauthClientId || '';
          cidInput.addEventListener('input', (e) => {
            formObj.oauthClientId = e.target.value;
          });
          cidField.appendChild(cidLbl);
          cidField.appendChild(cidInput);

          const csecField = doc.createElement('div');
          csecField.className = 'agy-mcp-field';
          const csecLbl = doc.createElement('label');
          csecLbl.className = 'agy-mcp-label';
          csecLbl.textContent = 'Client Secret (Optional)';
          const csecInput = doc.createElement('input');
          csecInput.type = 'password';
          csecInput.className = 'agy-mcp-input';
          csecInput.setAttribute('data-field', 'oauthClientSecret');
          csecInput.placeholder = 'OAuth Client Secret (optional)';
          csecInput.value = formObj.oauthClientSecret || '';
          csecInput.addEventListener('input', (e) => {
            formObj.oauthClientSecret = e.target.value;
          });
          csecField.appendChild(csecLbl);
          csecField.appendChild(csecInput);

          grid.appendChild(cidField);
          grid.appendChild(csecField);
          advBody.appendChild(grid);
        }

        const scopeField = doc.createElement('div');
        scopeField.className = 'agy-mcp-field';
        const scopeLbl = doc.createElement('label');
        scopeLbl.className = 'agy-mcp-label';
        scopeLbl.textContent = 'Default Scopes (Optional)';
        const scopeInput = doc.createElement('input');
        scopeInput.className = 'agy-mcp-input';
        scopeInput.setAttribute('data-field', 'oauthScopes');
        scopeInput.placeholder = 'Auto-detected (e.g. openid profile mcp:tools)';
        scopeInput.value = formObj.oauthScopes || '';
        scopeInput.addEventListener('input', (e) => {
          formObj.oauthScopes = e.target.value;
        });
        scopeField.appendChild(scopeLbl);
        scopeField.appendChild(scopeInput);
        advBody.appendChild(scopeField);

        // Manual authorization code fallback row
        const manualCodeRow = doc.createElement('div');
        manualCodeRow.style.display = 'flex';
        manualCodeRow.style.gap = '6px';
        manualCodeRow.style.alignItems = 'center';

        const codeInput = doc.createElement('input');
        codeInput.type = 'text';
        codeInput.className = 'agy-mcp-input';
        codeInput.style.flex = '1';
        codeInput.setAttribute('data-field', 'oauthCode');
        codeInput.placeholder = 'Enter authorization code manually (optional)...';
        codeInput.value = formObj.oauthCode || '';
        codeInput.addEventListener('input', (e) => {
          formObj.oauthCode = e.target.value;
        });

        const submitCodeBtn = doc.createElement('button');
        submitCodeBtn.type = 'button';
        submitCodeBtn.className = 'agy-mcp-btn';
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

        manualCodeRow.appendChild(codeInput);
        manualCodeRow.appendChild(submitCodeBtn);
        advBody.appendChild(manualCodeRow);

        advCard.appendChild(advBody);
      }

      authBox.appendChild(advCard);
    } else if (formObj.authMode === 'bearer') {
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
    }

    // Batch apply checkbox when multiple custom HTTP servers exist and custom header auth is selected
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

    // 1. Name
    const nameField = doc.createElement('div');
    nameField.className = 'agy-mcp-field full';
    const nameLabel = doc.createElement('label');
    nameLabel.className = 'agy-mcp-label';
    nameLabel.textContent = 'Name';
    const nameInput = doc.createElement('input');
    nameInput.className = 'agy-mcp-input';
    nameInput.setAttribute('data-field', 'serverName');
    nameInput.placeholder = 'Custom tool name (auto-generated from Server URL if left blank)';
    nameInput.value = formObj.serverName;
    nameInput.addEventListener('input', (e) => {
      formObj.serverName = e.target.value;
    });
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    grid.appendChild(nameField);

    // 2. Description (Optional)
    const descField = doc.createElement('div');
    descField.className = 'agy-mcp-field full';
    const descLabel = doc.createElement('label');
    descLabel.className = 'agy-mcp-label';
    descLabel.textContent = 'Description (Optional)';
    const descInput = doc.createElement('input');
    descInput.className = 'agy-mcp-input';
    descInput.setAttribute('data-field', 'description');
    descInput.placeholder = 'Briefly describe what this server does';
    descInput.value = formObj.description || '';
    descInput.addEventListener('input', (e) => {
      formObj.description = e.target.value;
    });
    descField.appendChild(descLabel);
    descField.appendChild(descInput);
    grid.appendChild(descField);

    // 3. Connection header + Segmented toggle (Connection: Server URL | Local / Tunnel (Stdio))
    const connHeaderField = doc.createElement('div');
    connHeaderField.className = 'agy-mcp-field full';
    const connTopRow = doc.createElement('div');
    connTopRow.style.display = 'flex';
    connTopRow.style.alignItems = 'center';
    connTopRow.style.justifyContent = 'space-between';
    connTopRow.style.gap = '10px';

    const connLabel = doc.createElement('label');
    connLabel.className = 'agy-mcp-label';
    connLabel.textContent = 'Connection';

    const segWrap = doc.createElement('div');
    segWrap.className = 'agy-mcp-segmented';

    const segHttpBtn = doc.createElement('button');
    segHttpBtn.type = 'button';
    segHttpBtn.className = `agy-mcp-seg-btn${formObj.transport === 'http' ? ' active' : ''}`;
    segHttpBtn.textContent = 'Server URL';
    segHttpBtn.addEventListener('click', () => {
      formObj.transport = 'http';
      if (!formObj.authMode || formObj.authMode === 'none') {
        formObj.authMode = 'oauth';
      }
      reRenderFn();
    });

    const segStdioBtn = doc.createElement('button');
    segStdioBtn.type = 'button';
    segStdioBtn.className = `agy-mcp-seg-btn${formObj.transport === 'stdio' ? ' active' : ''}`;
    segStdioBtn.textContent = 'Local / Tunnel (Stdio)';
    segStdioBtn.addEventListener('click', () => {
      formObj.transport = 'stdio';
      reRenderFn();
    });

    segWrap.appendChild(segHttpBtn);
    segWrap.appendChild(segStdioBtn);

    // Keep hidden/accessible select for [data-field="transport"] programmatic compatibility
    const transSelect = doc.createElement('select');
    transSelect.className = 'agy-mcp-select';
    transSelect.style.display = 'none';
    transSelect.setAttribute('data-field', 'transport');
    const optHttp = doc.createElement('option');
    optHttp.value = 'http';
    optHttp.textContent = 'Streamable HTTP / Remote URL';
    const optStdio = doc.createElement('option');
    optStdio.value = 'stdio';
    optStdio.textContent = 'Stdio (Local Process: npx / uvx / node / python / docker)';
    transSelect.appendChild(optHttp);
    transSelect.appendChild(optStdio);
    transSelect.value = formObj.transport;
    transSelect.addEventListener('change', (e) => {
      formObj.transport = e.target.value;
      reRenderFn();
    });

    connTopRow.appendChild(connLabel);
    connTopRow.appendChild(segWrap);
    connHeaderField.appendChild(connTopRow);
    connHeaderField.appendChild(transSelect);

    if (formObj.transport === 'http') {
      const urlInput = doc.createElement('input');
      urlInput.className = 'agy-mcp-input';
      urlInput.setAttribute('data-field', 'url');
      urlInput.placeholder = 'https://example.com/mcp';
      urlInput.value = formObj.url;
      urlInput.addEventListener('input', (e) => {
        formObj.url = e.target.value;
      });
      connHeaderField.appendChild(urlInput);
      grid.appendChild(connHeaderField);
    } else {
      grid.appendChild(connHeaderField);

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

    let st = null;
    if (
      formObj.transport === 'http' &&
      (formObj.authMode === 'oauth' || formObj.authMode === 'oauth_or_none') &&
      typeof bridge.waitForServerOAuthOrReady === 'function'
    ) {
      st = await bridge.waitForServerOAuthOrReady(built.serverName, 3000);
    }

    await reloadData();
    st = st || findRuntimeState(built.serverName);

    if (
      formObj.transport === 'http' &&
      (formObj.authMode === 'oauth' || formObj.authMode === 'oauth_or_none') &&
      st &&
      st.authUrl &&
      !st.hasAuthToken
    ) {
      bannerFn('info', `OAuth sign-in window is ready for "${built.serverName}".`);
      openOAuthConnectModal(built.serverName, st.authUrl);
    } else {
      bannerFn('success', `Saved and triggered reload for "${built.serverName}".`);
    }

    return { ok: true, serverName: built.serverName, spec: built.spec, runtimeState: st };
  }

  function renderServerCardsList(container, customBannerFn = setBanner) {
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
      empty.textContent = 'No custom MCP servers configured yet. Click "+ Add Custom MCP Server" to register a remote OAuth MCP portal or local Stdio server.';
      container.appendChild(empty);
      return;
    }

    for (const name of allServerNames) {
      const customSpec = customMap[name] || null;
      const runtimeState = stateByName.get(name) || null;
      const isCustom = Boolean(customSpec);
      const isDisabled = Boolean((customSpec && customSpec.disabled) || (runtimeState && runtimeState.status === 4));
      const pill = statusPillInfo(runtimeState ? runtimeState.status : 0, isDisabled);
      const hasOAuthUrl = Boolean(runtimeState?.authUrl && !runtimeState?.hasAuthToken);
      const needsAuth = Boolean(hasOAuthUrl || (runtimeState && isAuthErrorText(runtimeState.error)));

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

      if (hasOAuthUrl) {
        const oauthConnectBtn = doc.createElement('button');
        oauthConnectBtn.type = 'button';
        oauthConnectBtn.className = 'agy-mcp-btn primary';
        oauthConnectBtn.setAttribute('data-testid', `agy-mcp-oauth-connect-btn-${name}`);
        oauthConnectBtn.textContent = `🔗 Connect ${name} ↗`;
        oauthConnectBtn.addEventListener('click', () => {
          openOAuthConnectModal(name, runtimeState.authUrl);
        });
        actionsRow.appendChild(oauthConnectBtn);
      }

      if (isCustom || needsAuth) {
        const authBtn = doc.createElement('button');
        authBtn.type = 'button';
        authBtn.className = `agy-mcp-btn${needsAuth ? ' auth' : ''}`;
        authBtn.setAttribute('data-testid', `agy-mcp-auth-btn-${name}`);
        authBtn.textContent = hasOAuthUrl ? '⚙️ OAuth Settings' : '🔑 Authenticate';
        authBtn.addEventListener('click', () => {
          if (hasOAuthUrl) {
            openOAuthConnectModal(name, runtimeState.authUrl);
          } else {
            openEditPopup(name, { focusAuth: true });
          }
        });
        actionsRow.appendChild(authBtn);
      }

      const toggleBtn = doc.createElement('button');
      toggleBtn.className = 'agy-mcp-btn';
      toggleBtn.textContent = isDisabled ? 'Enable' : 'Disable';
      toggleBtn.addEventListener('click', async () => {
        try {
          const res = await bridge.toggleServerEnabled(name, isDisabled);
          if (res && res.ok === false) {
            customBannerFn('error', res.error || `Failed to toggle "${name}".`);
            return;
          }
          await reloadData();
          customBannerFn('success', `Server "${name}" ${isDisabled ? 'enabled' : 'disabled'}.`);
          if (isOpen()) renderBody();
        } catch (err) {
          customBannerFn('error', `Failed to toggle "${name}": ${err.message || err}`);
        }
      });
      actionsRow.appendChild(toggleBtn);

      const restartBtn = doc.createElement('button');
      restartBtn.className = 'agy-mcp-btn';
      restartBtn.textContent = '↻ Restart';
      restartBtn.addEventListener('click', async () => {
        try {
          customBannerFn('info', `Restarting "${name}"...`);
          const res = await bridge.refreshServers(name);
          if (res && res.ok === false) {
            customBannerFn('error', res.error || `Failed to restart "${name}".`);
            return;
          }
          await reloadData();
          customBannerFn('success', `Restarted "${name}".`);
          if (isOpen()) renderBody();
        } catch (err) {
          customBannerFn('error', `Failed to restart "${name}": ${err.message || err}`);
        }
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
            const res = await bridge.deleteCustomServer(name);
            if (res && res.ok === false) {
              customBannerFn('error', res.error || `Failed to delete "${name}".`);
              return;
            }
            await reloadData();
            customBannerFn('success', `Removed custom server "${name}".`);
            if (isOpen()) renderBody();
          } catch (err) {
            customBannerFn('error', `Failed to delete "${name}": ${err.message || err}`);
          }
        });
        actionsRow.appendChild(delBtn);
      }

      topRow.appendChild(actionsRow);
      card.appendChild(topRow);

      const preview = doc.createElement('div');
      preview.className = 'agy-mcp-cmd-preview';
      preview.textContent = formatSpecPreview(customSpec || (runtimeState && runtimeState.spec), runtimeState);
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
          fixAuthBtn.textContent = hasOAuthUrl ? `🔗 Connect ${name} ↗` : '⚙️ Edit Settings / Connect OAuth';
          fixAuthBtn.addEventListener('click', () => {
            if (hasOAuthUrl) {
              openOAuthConnectModal(name, runtimeState.authUrl);
            } else {
              openEditPopup(name, { focusAuth: true });
            }
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
                const res = await bridge.toggleServerTool(name, toolName, isToolDisabled);
                if (res && res.ok === false) {
                  customBannerFn('error', res.error || `Failed to toggle tool "${toolName}".`);
                  return;
                }
                await reloadData();
                customBannerFn('success', `Tool "${toolName}" on "${name}" ${isToolDisabled ? 'enabled' : 'disabled'}.`);
                if (isOpen()) renderBody();
              } catch (err) {
                customBannerFn('error', `Failed to toggle tool: ${err.message || err}`);
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

    renderServerCardsList(container, setBanner);
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
          originalName: '',
          serverName: tpl.serverName,
          description: tpl.description || '',
          transport: tpl.transport,
          command: tpl.command || 'npx',
          argsText: formatArgsForEditor(tpl.args || []),
          envText: formatKeyValueForEditor(tpl.env || {}, '='),
          cwd: tpl.cwd || '',
          url: tpl.url || '',
          headersText: formatKeyValueForEditor(tpl.headers || {}, ': '),
          authMode: tpl.transport === 'http' ? 'oauth' : 'none',
          disabled: false,
        };
        setBanner('info', `Loaded preset "${tpl.label}".`);
        renderBody();
      });
      tplBar.appendChild(btn);
    }
    templateSection.appendChild(tplBar);
    container.appendChild(templateSection);

    const runtimeState = findRuntimeState(editingForm.serverName || editingForm.originalName);
    renderServerConnectionFields(container, editingForm, renderBody);
    renderAuthFieldsSection(container, editingForm, runtimeState, renderBody, setBanner);

    const riskBox = doc.createElement('div');
    riskBox.className = 'agy-mcp-risk-notice';
    riskBox.textContent =
      '⚠️ Custom MCP servers carry risks. Only connect to MCP servers you trust.';
    container.appendChild(riskBox);

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
    const prevScrollTop = typeof body.scrollTop === 'number' ? body.scrollTop : 0;
    const useFrag = typeof body.replaceChildren === 'function' && typeof doc.createDocumentFragment === 'function';
    const target = useFrag ? doc.createDocumentFragment() : body;
    if (!useFrag) {
      while (body.firstChild) body.removeChild(body.firstChild);
    }

    if (activeTab === 'servers') {
      renderServersTab(target);
    } else if (activeTab === 'editor') {
      renderEditorTab(target);
    } else {
      renderRawTab(target);
    }

    if (useFrag) {
      body.replaceChildren(target);
    }
    if (typeof body.scrollTop === 'number') {
      body.scrollTop = prevScrollTop;
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
    const prevScrollTop = typeof body.scrollTop === 'number' ? body.scrollTop : 0;
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
    newOpt.textContent = '+ Add Custom MCP Server (New Custom MCP Server)';
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

    renderServerConnectionFields(body, popupForm, renderEditPopupBody);
    renderAuthFieldsSection(body, popupForm, runtimeState, renderEditPopupBody, setPopupBanner);

    const riskBox = doc.createElement('div');
    riskBox.className = 'agy-mcp-risk-notice';
    riskBox.textContent =
      '⚠️ Custom MCP servers carry risks. Only connect to MCP servers you trust.';
    body.appendChild(riskBox);

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
          const res = await bridge.deleteCustomServer(popupForm.originalName);
          if (res && res.ok === false) {
            setPopupBanner('error', res.error || `Failed to delete "${popupForm.originalName}".`);
            return;
          }
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
    saveBtn.textContent = popupForm.originalName ? 'Save & Reconnect' : 'Create & Connect';
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
    if (typeof body.scrollTop === 'number') {
      body.scrollTop = prevScrollTop;
    }
  }

  async function openEditPopup(serverName = '', options = {}) {
    ensureModalStyles(doc);
    popupBannerState = { type: '', message: '' };
    await reloadData();

    const customMap = (cachedConfig.config && cachedConfig.config.mcpServers) || {};
    const customNames = Object.keys(customMap);
    const targetName = serverName !== undefined && serverName !== null && serverName !== ''
      ? serverName
      : (options.createNew ? '' : (customNames[0] || ''));
    const targetSpec = options.prefillSpec || (targetName ? customMap[targetName] : null);
    popupForm = buildFormStateFromSpec(targetName, targetSpec, options);

    let backdrop = doc.getElementById(EDIT_POPUP_ID);
    if (!backdrop) {
      backdrop = doc.createElement('div');
      backdrop.id = EDIT_POPUP_ID;
      backdrop.setAttribute('data-testid', 'agy-mcp-edit-popup');
      backdrop.setAttribute('data-agy-custom-mcp-btn', 'edit-popup');
      backdrop.setAttribute('data-agy-no-translate', 'true');
      backdrop.setAttribute('translate', 'no');
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeEditPopup();
      });

      const dialog = doc.createElement('div');
      dialog.className = 'agy-mcp-dialog popup';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', 'Add or Edit Custom MCP Server');

      const header = doc.createElement('div');
      header.className = 'agy-mcp-header';
      const titleWrap = doc.createElement('div');
      titleWrap.className = 'agy-mcp-title-wrap';
      const title = doc.createElement('h2');
      title.className = 'agy-mcp-title';
      title.textContent = targetName ? '⚙️ Edit Custom MCP Server Settings' : 'Add Custom MCP Server';
      const badge = doc.createElement('span');
      badge.className = 'agy-mcp-badge';
      badge.textContent = 'OAuth & Custom MCP';
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

  // Render full Settings page content when user selects "MCP 서버" tab inside native Settings modal (.settings-modal-container)
  function renderSettingsPageContent(container) {
    if (!container) return;
    ensureModalStyles(doc);
    const prevScrollTop = typeof container.scrollTop === 'number' ? container.scrollTop : 0;
    const useFrag = typeof container.replaceChildren === 'function' && typeof doc.createDocumentFragment === 'function';
    if (!useFrag) {
      while (container.firstChild) container.removeChild(container.firstChild);
    }

    const wrapper = doc.createElement('div');
    wrapper.className = 'p-6 flex flex-col gap-5 w-full max-w-2xl mx-auto';
    wrapper.style.padding = '24px';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '18px';
    wrapper.style.maxWidth = '720px';
    wrapper.style.margin = '0 auto';

    const pageHdr = doc.createElement('div');
    pageHdr.style.display = 'flex';
    pageHdr.style.alignItems = 'flex-start';
    pageHdr.style.justifyContent = 'space-between';
    pageHdr.style.gap = '12px';
    pageHdr.style.flexWrap = 'wrap';

    const titleCol = doc.createElement('div');
    titleCol.style.display = 'flex';
    titleCol.style.flexDirection = 'column';
    titleCol.style.gap = '4px';

    const h2 = doc.createElement('h2');
    h2.style.fontSize = '20px';
    h2.style.fontWeight = '600';
    h2.style.margin = '0';
    h2.style.color = '#f8fafc';
    h2.textContent = 'MCP Servers';

    const sub = doc.createElement('div');
    sub.style.fontSize = '13px';
    sub.style.color = '#94a3b8';
    sub.textContent = 'Register, authenticate, and manage remote OAuth MCP portals and local (Stdio) custom MCP servers.';

    titleCol.appendChild(h2);
    titleCol.appendChild(sub);
    pageHdr.appendChild(titleCol);

    const hdrActions = doc.createElement('div');
    hdrActions.style.display = 'flex';
    hdrActions.style.gap = '8px';
    hdrActions.style.flexWrap = 'wrap';

    const addPopupBtn = doc.createElement('button');
    addPopupBtn.type = 'button';
    addPopupBtn.className = 'agy-mcp-btn primary';
    addPopupBtn.setAttribute('data-testid', 'agy-mcp-settings-add-btn');
    addPopupBtn.textContent = '+ Add Custom MCP Server';
    addPopupBtn.addEventListener('click', () => {
      openEditPopup('', { createNew: true });
    });

    const editPopupBtn = doc.createElement('button');
    editPopupBtn.type = 'button';
    editPopupBtn.className = 'agy-mcp-btn';
    editPopupBtn.setAttribute('data-testid', 'agy-mcp-settings-edit-btn');
    editPopupBtn.textContent = '⚙️ Edit Server Settings';
    editPopupBtn.addEventListener('click', () => {
      openEditPopup();
    });

    const rawModalBtn = doc.createElement('button');
    rawModalBtn.type = 'button';
    rawModalBtn.className = 'agy-mcp-btn';
    rawModalBtn.textContent = '{ } Edit mcp_config.json';
    rawModalBtn.addEventListener('click', () => {
      openModal('raw');
    });

    const refreshBtn = doc.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'agy-mcp-btn';
    refreshBtn.textContent = '↻ Refresh';
    refreshBtn.addEventListener('click', async () => {
      await bridge.refreshServers();
      await reloadData();
    });

    hdrActions.appendChild(addPopupBtn);
    hdrActions.appendChild(editPopupBtn);
    hdrActions.appendChild(rawModalBtn);
    hdrActions.appendChild(refreshBtn);
    pageHdr.appendChild(hdrActions);
    wrapper.appendChild(pageHdr);

    const statusBanner = doc.createElement('div');
    statusBanner.className = 'agy-mcp-status-banner';
    if (bannerState.type && bannerState.message) {
      statusBanner.classList.add(bannerState.type);
      statusBanner.textContent = bannerState.message;
    }
    wrapper.appendChild(statusBanner);

    renderSmartAutoAddBar(wrapper);
    renderServerCardsList(wrapper, setBanner);

    if (useFrag) {
      container.replaceChildren(wrapper);
    } else {
      container.appendChild(wrapper);
    }
    if (typeof container.scrollTop === 'number') {
      container.scrollTop = prevScrollTop;
    }
  }

  async function openModal(initialTab = 'servers') {
    ensureModalStyles(doc);
    activeTab = initialTab;
    bannerState = { type: '', message: '' };

    let backdrop = doc.getElementById(MODAL_ID);
    if (!backdrop) {
      backdrop = doc.createElement('div');
      backdrop.id = MODAL_ID;
      backdrop.setAttribute('data-agy-custom-mcp-btn', 'main-modal');
      backdrop.setAttribute('data-agy-no-translate', 'true');
      backdrop.setAttribute('translate', 'no');
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
    openOAuthConnectModal,
    closeOAuthConnectModal,
    isOAuthConnectModalOpen,
    renderSettingsPageContent,
    reloadData,
    getCachedState: () => ({ config: cachedConfig.config, states: cachedStates }),
  };
}

module.exports = {
  MODAL_ID,
  EDIT_POPUP_ID,
  OAUTH_MODAL_ID,
  STYLE_ID,
  isAuthErrorText,
  ensureModalStyles,
  createModalController,
};
