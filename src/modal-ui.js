'use strict';

const {
  QUICK_TEMPLATES,
  parseSmartMcpInput,
  validateAndBuildServerSpec,
  formatArgsForEditor,
  formatKeyValueForEditor,
  normalizeMcpConfigObject,
} = require('./mcp-config-schema');

const MODAL_ID = 'agy-mcp-manager-modal-backdrop';
const STYLE_ID = 'agy-mcp-manager-styles';

function ensureModalStyles(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${MODAL_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483645;
      background: rgba(9, 11, 17, 0.72);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif;
      color: #e4e7ef;
      padding: 20px;
      box-sizing: border-box;
    }
    #${MODAL_ID} * {
      box-sizing: border-box;
    }
    .agy-mcp-dialog {
      width: min(860px, 96vw);
      max-height: min(760px, 90vh);
      background: #161821;
      border: 1px solid #2c3144;
      border-radius: 12px;
      box-shadow: 0 22px 60px rgba(0, 0, 0, 0.65);
      display: flex;
      flex-direction: column;
      overflow: hidden;
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
    return `HTTP ${spec.url || spec.serverUrl}`;
  }
  const cmd = spec.command || '';
  const args = Array.isArray(spec.args) ? spec.args.join(' ') : '';
  return `${cmd} ${args}`.trim() || '(empty command)';
}

function createModalController({ doc, bridge, onStateChanged }) {
  let activeTab = 'servers'; // 'servers' | 'editor' | 'raw'
  let editingForm = {
    originalName: '',
    serverName: '',
    transport: 'stdio',
    command: 'npx',
    argsText: '',
    envText: '',
    cwd: '',
    url: '',
    headersText: '',
    disabled: false,
  };
  let cachedConfig = { uri: '', rawText: '{\n  "mcpServers": {}\n}\n', config: { mcpServers: {} } };
  let cachedStates = [];
  let bannerState = { type: '', message: '' };

  function setBanner(type, message) {
    bannerState = { type, message };
    renderBanner();
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

  function populateFormFromSpec(serverName, spec) {
    const isHttp = Boolean(spec && (spec.url || spec.serverUrl || spec.type === 'http'));
    editingForm = {
      originalName: serverName || '',
      serverName: serverName || '',
      transport: isHttp ? 'http' : 'stdio',
      command: spec && spec.command ? spec.command : 'npx',
      argsText: formatArgsForEditor(spec && spec.args),
      envText: formatKeyValueForEditor(spec && spec.env, '='),
      cwd: spec && spec.cwd ? spec.cwd : '',
      url: (spec && (spec.url || spec.serverUrl)) || '',
      headersText: formatKeyValueForEditor(spec && spec.headers, ': '),
      disabled: Boolean(spec && spec.disabled),
    };
  }

  function resetForm() {
    populateFormFromSpec('', { command: 'npx', args: [], env: {} });
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
    input.style.flex = '1';
    input.style.minWidth = '240px';
    input.setAttribute('data-testid', 'agy-mcp-smart-input');
    input.placeholder = 'https://mcp.example.com/mcp, https://github.com/owner/repo, @playwright/mcp, or npx -y ...';

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
          await reloadData();
          setBanner('success', `Automatically added and connected "${parsed.serverName}".`);
        }
        input.value = '';
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
      populateFormFromSpec(parsed.serverName, parsed.spec);
      activeTab = 'editor';
      setBanner('info', `Auto-filled form for "${parsed.serverName}". Review or add env vars below, then click Save & Connect Server.`);
      renderModalContent();
    });

    row.appendChild(input);
    row.appendChild(autoConnectBtn);
    row.appendChild(fillFormBtn);
    box.appendChild(row);
    container.appendChild(box);
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
    btnGroup.appendChild(addBtn);
    topActions.appendChild(btnGroup);
    container.appendChild(topActions);

    const customMap = (cachedConfig.config && cachedConfig.config.mcpServers) || {};
    const stateByName = new Map();
    for (const st of cachedStates) {
      if (st && st.serverName) {
        stateByName.set(st.serverName, st);
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
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => {
          populateFormFromSpec(name, customSpec);
          activeTab = 'editor';
          renderModalContent();
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
        errBox.style.fontSize = '11.5px';
        errBox.style.color = '#fca5a5';
        errBox.textContent = `Error: ${runtimeState.error}`;
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
    nameInput.value = editingForm.serverName;
    nameInput.addEventListener('input', (e) => {
      editingForm.serverName = e.target.value;
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
    transSelect.value = editingForm.transport;
    transSelect.addEventListener('change', (e) => {
      editingForm.transport = e.target.value;
      renderBody();
    });
    transField.appendChild(transLabel);
    transField.appendChild(transSelect);
    grid.appendChild(transField);

    if (editingForm.transport === 'http') {
      const urlField = doc.createElement('div');
      urlField.className = 'agy-mcp-field full';
      const urlLabel = doc.createElement('label');
      urlLabel.className = 'agy-mcp-label';
      urlLabel.textContent = 'Remote MCP Server URL (http:// or https://)';
      const urlInput = doc.createElement('input');
      urlInput.className = 'agy-mcp-input';
      urlInput.setAttribute('data-field', 'url');
      urlInput.placeholder = 'https://mcp.example.com/mcp';
      urlInput.value = editingForm.url;
      urlInput.addEventListener('input', (e) => {
        editingForm.url = e.target.value;
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
      hdrArea.value = editingForm.headersText;
      hdrArea.addEventListener('input', (e) => {
        editingForm.headersText = e.target.value;
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
      cmdInput.value = editingForm.command;
      cmdInput.addEventListener('input', (e) => {
        editingForm.command = e.target.value;
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
      cwdInput.value = editingForm.cwd;
      cwdInput.addEventListener('input', (e) => {
        editingForm.cwd = e.target.value;
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
      argsArea.value = editingForm.argsText;
      argsArea.addEventListener('input', (e) => {
        editingForm.argsText = e.target.value;
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
      envArea.value = editingForm.envText;
      envArea.addEventListener('input', (e) => {
        editingForm.envText = e.target.value;
      });
      envField.appendChild(envLabel);
      envField.appendChild(envArea);
      grid.appendChild(envField);
    }

    container.appendChild(grid);

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
        const built = validateAndBuildServerSpec(editingForm);
        if (!built.ok) {
          setBanner('error', built.error);
          return;
        }
        setBanner('info', `Saving "${built.serverName}" to mcp_config.json...`);
        const res = await bridge.upsertCustomServer(built.serverName, built.spec, editingForm.originalName);
        if (res && res.ok === false) {
          setBanner('error', res.error || 'Failed to save server');
          return;
        }
        await reloadData();
        setBanner('success', `Saved and triggered reload for "${built.serverName}".`);
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
    reloadData,
    getCachedState: () => ({ config: cachedConfig.config, states: cachedStates }),
  };
}

module.exports = {
  MODAL_ID,
  STYLE_ID,
  ensureModalStyles,
  createModalController,
};
