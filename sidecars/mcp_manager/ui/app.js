/**
 * Antigravity 2.0 AUX_PANE MCP Manager UI (`sidecars/mcp_manager/ui/app.js`).
 *
 * Security & UX Invariants:
 * 1. ZERO unsafe DOM sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`).
 * 2. All API requests use `POST` via `x-sidecar-token` (from URL query / `preload.js`).
 * 3. Secret inputs (`env` / `headers` values) default to `type="password"` and scrub on close/cancel.
 * 4. Korean/CJK IME guard (`e.isComposing || e.keyCode === 229`) on Enter/Escape handlers.
 * 5. Explicit fail-closed Raw JSON recovery on `MALFORMED_JSON` and Reload/Retry banner on `409 CONFLICT`.
 */

(function () {
  'use strict';

  const token = new URLSearchParams(window.location.search).get('token') || '';
  let workspaceUris = [];
  let activeTab = 'servers';
  let snapshot = null;
  let bannerState = null;
  let legacyDismissed = false;
  let editorState = null;
  let pendingStdioConfirm = null;
  let pastePreview = null;
  let rawDraft = '';

  const mainRegion = document.getElementById('main-region');
  const bannerRegion = document.getElementById('banner-region');
  const runtimeBadge = document.getElementById('runtime-badge');
  const tabServers = document.getElementById('tab-servers');
  const tabRaw = document.getElementById('tab-raw');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnAdd = document.getElementById('btn-add');

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
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'className') node.className = String(v);
        else if (k === 'value') node.value = String(v);
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
    return node;
  }

  async function apiPost(route, payload = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-sidecar-token'] = token;
    const res = await fetch(route, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({ ok: false, errors: [`HTTP ${res.status}`] }));
    return { status: res.status, data };
  }

  function scrubEditorSecrets() {
    if (editorState) {
      editorState.envRows = [];
      editorState.headerRows = [];
      editorState = null;
    }
    pendingStdioConfirm = null;
  }

  function setBanner(kind, message, actions = []) {
    bannerState = { kind, message, actions };
    renderBanners();
  }

  function clearBanner() {
    bannerState = null;
    renderBanners();
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
    const { data } = await apiPost('/api/snapshot', {
      workspaceUris,
      includeRawText,
    });
    if (!data || !data.ok) {
      setBanner('error', (data?.errors || ['Failed to load MCP configuration']).join(' '));
      return;
    }
    snapshot = data;
    if (typeof data.globalConfig?.rawText === 'string') {
      rawDraft = data.globalConfig.rawText;
    }
    if (data.globalConfig?.malformed) {
      activeTab = 'raw';
    }
    runtimeBadge.textContent = data.runtimeAvailable ? 'LS Connected' : 'Offline (Config Only)';
    runtimeBadge.className = `badge ${data.runtimeAvailable ? 'badge-ok' : 'badge-muted'}`;
    renderAll();
  }

  async function submitEditor(confirmStdio = false) {
    if (!editorState || !snapshot) return;
    const spec = buildSpecFromEditor();
    const { status, data } = await apiPost('/api/upsert', {
      name: editorState.name.trim(),
      originalName: editorState.originalName,
      spec,
      expectedSha256: snapshot.globalConfig.sha256,
      confirmStdio,
    });
    if (data.code === 'CONFIRMATION_REQUIRED') {
      pendingStdioConfirm = data.confirmationPreview || { name: editorState.name, command: spec.command, args: spec.args || [] };
      renderAll();
      return;
    }
    if (status === 409 || data.code === 'CONFLICT') {
      setBanner('warn', 'mcp_config.json changed on disk (409 Conflict). Reload before retrying.', [
        { label: 'Reload Latest', onClick: () => { clearBanner(); void loadSnapshot(true); } },
      ]);
      return;
    }
    if (!data.ok) {
      setBanner('error', (data.errors || ['Save failed']).join(' '));
      return;
    }
    scrubEditorSecrets();
    clearBanner();
    await loadSnapshot(activeTab === 'raw');
  }

  async function handleToggleDisabled(server) {
    const { status, data } = await apiPost('/api/toggle-disabled', {
      name: server.name,
      disabled: !server.disabled,
      expectedSha256: snapshot.globalConfig.sha256,
    });
    if (status === 409 || data.code === 'CONFLICT') {
      setBanner('warn', 'mcp_config.json changed on disk (409 Conflict). Reload before retrying.', [
        { label: 'Reload Latest', onClick: () => { clearBanner(); void loadSnapshot(true); } },
      ]);
      return;
    }
    if (!data.ok) {
      setBanner('error', (data.errors || ['Toggle failed']).join(' '));
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
      setBanner('warn', 'mcp_config.json changed on disk (409 Conflict). Reload before retrying.', [
        { label: 'Reload Latest', onClick: () => { clearBanner(); void loadSnapshot(true); } },
      ]);
      return;
    }
    if (!data.ok) {
      setBanner('error', (data.errors || ['Delete failed']).join(' '));
      return;
    }
    clearBanner();
    await loadSnapshot(false);
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
          el('strong', null, `Broken mcp_config.json detected${loc}`),
          el('div', null, err?.message || 'File cannot be parsed as JSON. Structured edits are blocked to prevent data loss.'),
          el(
            'div',
            { className: 'banner-actions' },
            el('button', {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              dataset: { testid: 'btn-restore-backup' },
              onClick: async () => {
                const { data } = await apiPost('/api/restore-backup', {});
                if (!data.ok) setBanner('error', (data.errors || ['Restore failed']).join(' '));
                else { clearBanner(); await loadSnapshot(true); }
              },
            }, 'Restore Last Good Backup')
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
    let pasteInputVal = '';
    const inputEl = el('textarea', {
      rows: '3',
      placeholder: 'Paste mcpServers JSON or https://... Streamable HTTP URL (raw shell commands are rejected)',
      dataset: { testid: 'smart-paste-input' },
      onInput: (e) => { pasteInputVal = e.target.value; },
      onKeydown: (e) => {
        if (isImeComposing(e)) return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          void runPreview();
        }
      },
    });

    async function runPreview() {
      const { data } = await apiPost('/api/preview-paste', { rawInput: inputEl.value || pasteInputVal });
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
              el('span', { className: 'badge badge-muted' }, entry.transport || 'unknown')
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
              }, 'Load into Editor'),
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
                  }, 'Use mcp-remote Stdio Template')
                : null
            )
          )
        );
      }
    }

    return el(
      'section',
      { className: 'card' },
      el('strong', null, 'Declarative Smart Paste'),
      inputEl,
      el(
        'div',
        { className: 'row-actions' },
        el('button', { type: 'button', className: 'btn btn-secondary btn-sm', dataset: { testid: 'btn-preview-paste' }, onClick: runPreview }, 'Preview Paste')
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
            placeholder: 'KEY',
            value: row.key,
            onInput: (e) => { row.key = e.target.value; onChange(); },
          }),
          el('input', {
            type: 'password',
            autocomplete: 'off',
            placeholder: 'VALUE (masked)',
            value: row.value,
            dataset: { secretInput: 'true' },
            onInput: (e) => { row.value = e.target.value; onChange(); },
          }),
          el('button', {
            type: 'button',
            className: 'btn btn-danger btn-sm',
            onClick: () => { rows.splice(idx, 1); renderAll(); },
          }, 'Remove')
        )
      );
    });
    container.appendChild(
      el('button', {
        type: 'button',
        className: 'btn btn-secondary btn-sm',
        onClick: () => { rows.push({ key: '', value: '' }); renderAll(); },
      }, `+ Add ${label}`)
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
            scrubEditorSecrets();
            renderAll();
          }
        },
      },
      el('strong', null, editorState.mode === 'edit' ? `Edit Server: ${editorState.originalName}` : 'Add Global MCP Server'),
      el('div', { className: 'field' },
        el('label', null, 'Server Name'),
        el('input', {
          type: 'text',
          value: editorState.name,
          dataset: { testid: 'input-server-name' },
          onInput: (e) => { editorState.name = e.target.value; },
        })
      ),
      el('div', { className: 'field' },
        el('label', null, 'Transport'),
        el(
          'select',
          {
            value: editorState.transport,
            onChange: (e) => { editorState.transport = e.target.value; pendingStdioConfirm = null; renderAll(); },
          },
          el('option', { value: 'streamable_http', selected: !isStdio }, 'Streamable HTTP (url)'),
          el('option', { value: 'stdio', selected: isStdio }, 'Stdio (local command)')
        )
      ),
      isStdio
        ? [
            el('div', { className: 'field' },
              el('label', null, 'Command'),
              el('input', { type: 'text', value: editorState.command, placeholder: 'node / npx / uvx', onInput: (e) => { editorState.command = e.target.value; } })
            ),
            el('div', { className: 'field' },
              el('label', null, 'Arguments (one per line)'),
              el('textarea', { rows: '3', value: editorState.argsText, onInput: (e) => { editorState.argsText = e.target.value; } })
            ),
            renderKvEditor('Environment Variable', editorState.envRows, () => {}),
          ]
        : [
            el('div', { className: 'field' },
              el('label', null, 'Endpoint URL'),
              el('input', { type: 'text', value: editorState.url, placeholder: 'https://example.com/mcp', onInput: (e) => { editorState.url = e.target.value; } })
            ),
            renderKvEditor('HTTP Header', editorState.headerRows, () => {}),
          ],
      pendingStdioConfirm
        ? el(
            'div',
            { className: 'banner banner-warn', dataset: { testid: 'stdio-confirm-panel' } },
            el('strong', null, 'Confirm Local Command Execution Spec'),
            el('div', { className: 'server-meta' }, `${pendingStdioConfirm.command} ${(pendingStdioConfirm.args || []).join(' ')}`),
            el(
              'div',
              { className: 'banner-actions' },
              el('button', { type: 'button', className: 'btn btn-primary btn-sm', dataset: { testid: 'btn-confirm-stdio' }, onClick: () => submitEditor(true) }, 'Confirm & Save Stdio'),
              el('button', { type: 'button', className: 'btn btn-sm', onClick: () => { pendingStdioConfirm = null; renderAll(); } }, 'Back')
            )
          )
        : null,
      el(
        'div',
        { className: 'row-actions' },
        el('button', { type: 'button', className: 'btn btn-primary', dataset: { testid: 'btn-save-server' }, onClick: () => submitEditor(false) }, 'Save'),
        el('button', { type: 'button', className: 'btn', onClick: () => { scrubEditorSecrets(); renderAll(); } }, 'Cancel')
      )
    );
  }

  function renderServersTab() {
    const nodes = [];
    if (snapshot?.legacyImport?.exists && !legacyDismissed) {
      nodes.push(
        el(
          'div',
          { className: 'banner banner-warn', dataset: { testid: 'legacy-import-banner' } },
          el('strong', null, `Legacy config detected (${snapshot.legacyImport.servers.length} server(s))`),
          el('div', { className: 'server-meta' }, snapshot.legacyImport.displayPath),
          el(
            'div',
            { className: 'banner-actions' },
            snapshot.legacyImport.servers.map((ls) =>
              el('button', {
                type: 'button',
                className: 'btn btn-sm',
                onClick: async () => {
                  const { data } = await apiPost('/api/import-legacy', {
                    serverName: ls.name,
                    expectedSha256: snapshot.globalConfig.sha256,
                    confirmStdio: false,
                  });
                  if (data.code === 'CONFIRMATION_REQUIRED') {
                    openEditorForServer({ name: ls.name, spec: ls.spec, disabled: false });
                    editorState.mode = 'create';
                    editorState.originalName = null;
                    pendingStdioConfirm = data.confirmationPreview;
                    renderAll();
                  } else if (!data.ok) {
                    setBanner('error', (data.errors || ['Import failed']).join(' '));
                  } else {
                    await loadSnapshot(false);
                  }
                },
              }, `Import "${ls.name}"`)
            ),
            el('button', { type: 'button', className: 'btn btn-sm', onClick: () => { legacyDismissed = true; renderAll(); } }, 'Dismiss')
          )
        )
      );
    }

    if (editorState) {
      nodes.push(renderEditorCard());
    } else if (!snapshot?.globalConfig?.malformed) {
      nodes.push(renderSmartPasteCard());
    }

    nodes.push(el('h2', { className: 'section-title' }, `Global MCP Servers (${snapshot?.globalConfig?.servers?.length || 0})`));
    const globalList = el('div', { className: 'server-list' });
    for (const s of snapshot?.globalConfig?.servers || []) {
      const rtStatus = s.disabled ? 'Disabled' : s.runtime?.status || 'Configured';
      const badgeClass = s.disabled ? 'badge-muted' : s.runtime?.error ? 'badge-err' : s.runtime?.status === 'MCP_SERVER_STATUS_READY' ? 'badge-ok' : 'badge-muted';
      globalList.appendChild(
        el(
          'div',
          { className: 'card', dataset: { testid: `global-server-${s.name}` } },
          el('div', { className: 'server-header' },
            el('span', { className: 'server-name' }, s.name),
            el('div', { className: 'row-actions' },
              el('span', { className: `badge ${badgeClass}` }, `${rtStatus}${s.runtime?.toolCount ? ` · ${s.runtime.toolCount} tools` : ''}`),
              el('span', { className: 'badge badge-muted' }, s.transport || 'unknown')
            )
          ),
          el('div', { className: 'server-meta' }, s.spec?.url || s.spec?.command || ''),
          s.runtime?.error ? el('div', { className: 'badge badge-err' }, s.runtime.error) : null,
          el('div', { className: 'row-actions' },
            el('button', { type: 'button', className: 'btn btn-sm', onClick: () => handleToggleDisabled(s) }, s.disabled ? 'Enable' : 'Disable'),
            el('button', { type: 'button', className: 'btn btn-sm', onClick: () => openEditorForServer(s) }, 'Edit'),
            el('button', { type: 'button', className: 'btn btn-danger btn-sm', onClick: () => handleDelete(s) }, 'Delete')
          )
        )
      );
    }
    if ((snapshot?.globalConfig?.servers || []).length === 0) {
      globalList.appendChild(el('div', { className: 'card' }, 'No global MCP servers configured yet.'));
    }
    nodes.push(globalList);

    if ((snapshot?.pluginServers || []).length > 0) {
      nodes.push(el('h2', { className: 'section-title' }, `Plugin MCP Servers (Read-Only · ${snapshot.pluginServers.length})`));
      const pluginList = el('div', { className: 'server-list' });
      for (const ps of snapshot.pluginServers) {
        const collision = (snapshot.collisions?.pluginCollisions || []).find(
          (c) => c.pluginDir === ps.pluginDir && c.serverName === ps.name
        );
        pluginList.appendChild(
          el(
            'div',
            { className: 'card', dataset: { testid: `plugin-server-${ps.pluginDir}-${ps.name}` } },
            el('div', { className: 'server-header' },
              el('span', { className: 'server-name' }, ps.name),
              el('div', { className: 'row-actions' },
                el('span', { className: 'badge badge-muted' }, `Plugin: ${ps.pluginName}`),
                collision ? el('span', { className: 'badge badge-warn' }, `Collides with global "${collision.globalName}"`) : null
              )
            ),
            el('div', { className: 'server-meta' }, ps.spec?.url || ps.spec?.command || ''),
            el('div', { className: 'row-actions' },
              el('button', {
                type: 'button',
                className: 'btn btn-sm',
                onClick: () => {
                  openEditorForServer({ name: `${ps.name}-copy`, spec: ps.spec, disabled: false });
                  editorState.mode = 'create';
                  editorState.originalName = null;
                  renderAll();
                },
              }, 'Clone to Global')
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
      onInput: (e) => { rawDraft = e.target.value; },
    });
    return [
      el(
        'section',
        { className: 'card' },
        el('strong', null, snapshot?.globalConfig?.displayPath || '~/.gemini/config/mcp_config.json'),
        ta,
        el(
          'div',
          { className: 'row-actions' },
          el('button', {
            type: 'button',
            className: 'btn btn-primary',
            dataset: { testid: 'btn-save-raw' },
            onClick: async () => {
              const { status, data } = await apiPost('/api/save-raw', {
                rawText: rawDraft,
                expectedSha256: snapshot?.globalConfig?.sha256,
                confirmStdio: true,
              });
              if (status === 409 || data.code === 'CONFLICT') {
                setBanner('warn', 'mcp_config.json changed on disk (409 Conflict). Reload before retrying.', [
                  { label: 'Reload Latest', onClick: () => { clearBanner(); void loadSnapshot(true); } },
                ]);
              } else if (!data.ok) {
                setBanner('error', (data.errors || ['Raw JSON save failed']).join(' '));
              } else {
                clearBanner();
                await loadSnapshot(true);
              }
            },
          }, 'Validate & Save Raw JSON')
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
    renderAll();
  });
  tabRaw.addEventListener('click', () => {
    activeTab = 'raw';
    void loadSnapshot(true);
  });
  btnRefresh.addEventListener('click', () => void loadSnapshot(activeTab === 'raw'));
  btnAdd.addEventListener('click', () => openEditorForServer(null));

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'workspace-change' && Array.isArray(event.data.payload?.workspaceUris)) {
      workspaceUris = [...event.data.payload.workspaceUris];
      void loadSnapshot(activeTab === 'raw');
    }
  });

  window.addEventListener('beforeunload', () => scrubEditorSecrets());

  void loadSnapshot(false);
})();
