'use strict';

/**
 * Host-Neutral Modal, Edit Popup, OAuth Dialog, and Embedded Settings Pane Controller.
 *
 * Invariants:
 * 1. Depends ONLY on `McpManagerService` (`src/core/mcp-manager-service.js`), injected
 *    `HostBrandProfile`, and `src/ui/**` + `src/shared/dom-disposables.js`.
 * 2. Scrubs all in-memory and live DOM secret inputs on modal/popup close, Settings tab
 *    departure (`onSettingsPaneHidden`), and `dispose()`.
 * 3. Enforces the Quick Auto-Add confirmation gate for ALL `stdio`/`command` specifications
 *    (including `npx`/`uvx`, GitHub/npm packages, and `multipleServers` with `command`)
 *    and `PATH` environment overrides before persistence or launch.
 */

const { DisposableStore } = require('../core/disposable');
const { parseSmartMcpInput } = require('../core/schema/smart-parser');
const {
  hasPathEnvOverride,
  validateAndBuildServerSpec,
  extractAndValidateTransport,
} = require('../core/schema/server-spec');
const { sanitizeServerName } = require('../core/schema/presets');
const { ensureModalStyles, removeModalStyles, DEFAULT_STYLE_ID } = require('./design-tokens-styles');
const {
  h,
  clearElement,
  getFocusableElements,
  restoreFocusSafely,
  installDialogKeyboardTrap,
} = require('./dom-kit');
const { renderQuickAddBar } = require('./views/quick-add-bar');
const { renderServerCardList } = require('./views/server-card-list');
const {
  createEmptyEditorDraft,
  specToEditorFormDraft,
  renderServerEditorForm,
} = require('./views/server-editor-form');
const { OAUTH_MODAL_ID, renderOAuthConnectDialog } = require('./views/oauth-connect-dialog');
const { renderRawJsonEditor } = require('./views/raw-json-editor');
const { disposableTimeout } = require('../shared/dom-disposables');

const MODAL_ID = 'agy-mcp-manager-modal-backdrop';
const EDIT_POPUP_ID = 'agy-mcp-edit-popup-backdrop';
const SETTINGS_PANE_ID = 'agy-mcp-settings-pane';

/**
 * @param {{
 *   win: any,
 *   doc: any,
 *   service: any,
 *   brandProfile?: {
 *     productDisplayName?: string,
 *     fallbackFocusSelector?: string
 *   },
 *   ownsStyles?: boolean
 * }} options
 */
function createModalController(options) {
  const win = options.win;
  const doc = options.doc;
  const service = options.service;
  const brandProfile = options.brandProfile || {};
  const ownsStyles = options.ownsStyles !== false;

  const rootStore = new DisposableStore();
  let modalStore = null;
  let popupStore = null;
  let oauthStore = null;

  let activeTab = 'servers';
  let statusBanner = null;
  let conflictState = null;
  let invalidJsonError = null;
  let cachedServers = {};
  let cachedRuntimeStates = [];
  let cachedConfigLabel = 'mcp_config.json';

  let modalOpenerEl = null;
  let popupOpenerEl = null;
  let oauthOpenerEl = null;
  let settingsContainerEl = null;

  let oauthOpenSeq = 0;
  let oauthViewState = null;

  const getFallbackFocusTarget = () => {
    const sel = brandProfile.fallbackFocusSelector;
    if (!sel || !doc || typeof doc.querySelector !== 'function') return null;
    try {
      return doc.querySelector(sel);
    } catch {
      return null;
    }
  };

  const applyRootContainerAttributes = (el) => {
    if (!el || typeof el.setAttribute !== 'function') return;
    el.setAttribute('translate', 'no');
    if (brandProfile.rootAttributes && typeof brandProfile.rootAttributes === 'object') {
      const entries = Object.entries(brandProfile.rootAttributes);
      for (let i = 0; i < entries.length; i += 1) {
        const [attrName, attrVal] = entries[i];
        if (attrVal !== undefined && attrVal !== null) {
          el.setAttribute(attrName, String(attrVal));
        }
      }
    }
  };

  const scrubSensitiveDomInputs = (rootEl) => {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
    try {
      const inputs = rootEl.querySelectorAll('input, textarea');
      for (let i = 0; i < inputs.length; i += 1) {
        const el = inputs[i];
        const field = el?.dataset?.field || el?.getAttribute?.('data-field') || '';
        if (
          el?.type === 'password' ||
          field === 'quickAddInput' ||
          field === 'quickAddAuthToken' ||
          field === 'bearerToken' ||
          field === 'apiKeyValue' ||
          field === 'basicPass' ||
          field === 'oauthClientSecret' ||
          field === 'oauthCode' ||
          field === 'oauthModalCode' ||
          field === 'headersText' ||
          field === 'envText' ||
          field === 'rawJsonText' ||
          field === 'url'
        ) {
          el.value = '';
        }
      }
    } catch {
      // Ignore synthetic DOM limitations
    }
  };

  const resetAllDraftsAndDomSecrets = (rootEl) => {
    scrubSensitiveDomInputs(rootEl);
    const d = service.clearSensitiveDrafts();
    d.editorFormDraft = createEmptyEditorDraft();
    conflictState = null;
  };

  const ensureEditorDraft = () => {
    const drafts = service.getDraftState();
    if (!drafts.editorFormDraft) {
      service.updateDraftState({ editorFormDraft: createEmptyEditorDraft() });
    }
    return service.getDraftState().editorFormDraft;
  };

  const syncDataFromService = async () => {
    const [cfgRes, rtRes] = await Promise.all([
      service.readMcpConfig(),
      service.listRuntimeServerStates(),
    ]);
    if (rtRes && rtRes.ok && Array.isArray(rtRes.states)) {
      cachedRuntimeStates = rtRes.states;
    }
    if (cfgRes.ok) {
      cachedServers = cfgRes.servers || {};
      cachedConfigLabel = cfgRes.fsPath || cfgRes.uri || 'mcp_config.json';
      invalidJsonError = null;
      const drafts = service.getDraftState();
      if (drafts.rawTextDraft === null || drafts.rawTextDraft === undefined || drafts.rawTextDraft === '') {
        service.updateDraftState({
          rawTextDraft: cfgRes.rawText || JSON.stringify({ mcpServers: cachedServers }, null, 2),
        });
      }
    } else if (cfgRes.code === 'INVALID_JSON') {
      invalidJsonError = cfgRes.error || 'Invalid JSON syntax';
      cachedConfigLabel = cfgRes.fsPath || cfgRes.uri || 'mcp_config.json';
      activeTab = 'raw';
    } else {
      statusBanner = {
        kind: 'error',
        text: cfgRes.error || `Failed to load MCP configuration (${cfgRes.code})`,
      };
    }
    rerenderMountedSurfaces();
    return cfgRes;
  };

  const handleQuickAdd = async () => {
    const drafts = service.getDraftState();
    const parsed = parseSmartMcpInput(drafts.quickAddInput || '', {
      quickAuthInput: drafts.quickAddAuthToken || '',
    });
    if (!parsed.ok) {
      statusBanner = { kind: 'error', text: parsed.error || 'Unable to parse input' };
      rerenderMountedSurfaces();
      return;
    }

    const entries = parsed.multipleServers
      ? Object.entries(parsed.multipleServers).map(([serverName, spec]) => ({ serverName, spec }))
      : [{ serverName: parsed.serverName, spec: parsed.spec }];

    let requiresCommandConfirm = false;
    let hasPathOverride = false;
    for (let i = 0; i < entries.length; i += 1) {
      const tr = extractAndValidateTransport(entries[i].spec);
      if (tr.ok && tr.transport === 'stdio') {
        requiresCommandConfirm = true;
      }
      if (hasPathEnvOverride(entries[i].spec?.env)) {
        requiresCommandConfirm = true;
        hasPathOverride = true;
      }
    }

    if (requiresCommandConfirm) {
      service.updateDraftState({
        pendingCommandConfirmation: {
          entries,
          hasPathOverride,
        },
      });
      statusBanner = {
        kind: 'warn',
        text: 'Review and confirm the local command specification before execution.',
      };
      rerenderMountedSurfaces();
      return;
    }

    await commitQuickAddEntries(entries, false);
  };

  const commitQuickAddEntries = async (entries, confirmPathOverride) => {
    for (let i = 0; i < entries.length; i += 1) {
      const { serverName, spec } = entries[i];
      const res = await service.saveServerSpec({
        serverName,
        spec,
        confirmPathOverride,
      });
      if (!res.ok) {
        if (res.code === 'CONFLICT') {
          conflictState = { error: res.error, currentRawText: res.currentRawText };
        }
        statusBanner = { kind: 'error', text: res.error || `Failed to save ${serverName}` };
        rerenderMountedSurfaces();
        return;
      }
    }
    service.updateDraftState({
      quickAddInput: '',
      quickAddAuthToken: '',
      pendingCommandConfirmation: null,
    });
    statusBanner = {
      kind: 'info',
      text:
        entries.length === 1
          ? `Added MCP server "${entries[0].serverName}".`
          : `Added ${entries.length} MCP servers.`,
    };
    await syncDataFromService();
  };

  const handleSmartFill = () => {
    const drafts = service.getDraftState();
    const parsed = parseSmartMcpInput(drafts.quickAddInput || '', {
      quickAuthInput: drafts.quickAddAuthToken || '',
    });
    if (!parsed.ok) {
      statusBanner = { kind: 'error', text: parsed.error || 'Unable to parse input' };
      rerenderMountedSurfaces();
      return;
    }
    const firstEntry = parsed.multipleServers
      ? Object.entries(parsed.multipleServers)[0]
      : [parsed.serverName, parsed.spec];
    if (!firstEntry) return;
    const nextDraft = specToEditorFormDraft(firstEntry[0], firstEntry[1]);
    nextDraft.originalServerName = '';
    service.updateDraftState({ editorFormDraft: nextDraft });
    activeTab = 'add';
    statusBanner = { kind: 'info', text: `Populated form for "${firstEntry[0]}". Review and click Save Server.` };
    rerenderMountedSurfaces();
  };

  const handleSaveEditorForm = async (closePopupAfterSave = false) => {
    const draft = ensureEditorDraft();
    const cleanName = sanitizeServerName(draft.serverName || '');
    if (!cleanName) {
      statusBanner = { kind: 'error', text: 'Server Name is required.' };
      rerenderMountedSurfaces();
      return;
    }

    const built = validateAndBuildServerSpec(
      {
        serverName: cleanName,
        transport: draft.transport,
        urlKey: draft.urlKey || 'serverUrl',
        url: draft.url,
        headersText: draft.headersText,
        command: draft.command,
        argsText: draft.argsText,
        cwd: draft.cwd,
        envText: draft.envText,
        description: draft.description,
        authMode: draft.authMode,
        bearerToken: draft.bearerToken,
        apiKeyHeader: draft.apiKeyHeader,
        apiKeyValue: draft.apiKeyValue,
        basicUser: draft.basicUser,
        basicPass: draft.basicPass,
        oauthClientMode: draft.oauthClientMode,
        oauthClientId: draft.oauthClientId,
        oauthClientSecret: draft.oauthClientSecret,
        oauthScopes: draft.oauthScopes,
      },
      {
        allowInsecureHttp: Boolean(draft.allowInsecureHttp),
        confirmPathOverride: Boolean(draft.confirmPathOverride),
      }
    );

    if (!built.ok) {
      statusBanner = { kind: 'error', text: built.error || 'Invalid server configuration' };
      rerenderMountedSurfaces();
      return;
    }

    const saveRes = await service.saveServerSpec({
      serverName: cleanName,
      previousServerName: draft.originalServerName || undefined,
      spec: built.spec,
      applyAuthToAllHttp: Boolean(draft.applyAuthToAllHttp),
      authInput: {
        authMode: draft.authMode,
        bearerToken: draft.bearerToken,
        apiKeyHeader: draft.apiKeyHeader,
        apiKeyValue: draft.apiKeyValue,
        basicUser: draft.basicUser,
        basicPass: draft.basicPass,
      },
      allowInsecureHttp: Boolean(draft.allowInsecureHttp),
      confirmPathOverride: Boolean(draft.confirmPathOverride),
    });

    if (!saveRes.ok) {
      if (saveRes.code === 'CONFLICT') {
        conflictState = { error: saveRes.error, currentRawText: saveRes.currentRawText };
      }
      statusBanner = { kind: 'error', text: saveRes.error || 'Failed to save server' };
      rerenderMountedSurfaces();
      return;
    }

    const skippedMsg =
      Array.isArray(saveRes.skippedInsecureHttpServers) && saveRes.skippedInsecureHttpServers.length > 0
        ? ` (Skipped non-loopback http:// servers: ${saveRes.skippedInsecureHttpServers.join(', ')})`
        : '';

    service.updateDraftState({ editorFormDraft: createEmptyEditorDraft() });
    statusBanner = { kind: 'info', text: `Saved MCP server "${cleanName}".${skippedMsg}` };
    activeTab = 'servers';

    if (closePopupAfterSave) {
      closeEditPopup();
    }
    await syncDataFromService();
  };

  const handleToggleServer = async (serverName, nextEnabled) => {
    const res = await service.toggleServerEnabled(serverName, nextEnabled);
    if (!res.ok) {
      if (res.code === 'CONFLICT' || res.code === 'ROLLBACK_CONFLICT') {
        conflictState = { error: res.error, currentRawText: res.currentRawText };
      }
      statusBanner = { kind: 'error', text: res.error || `Failed to toggle ${serverName}` };
      await syncDataFromService();
      return;
    }
    statusBanner = {
      kind: 'info',
      text: `${nextEnabled ? 'Enabled' : 'Disabled'} "${serverName}".`,
    };
    await syncDataFromService();
  };

  const handleDeleteServer = async (serverName, fromPopup = false) => {
    const res = await service.deleteServer(serverName);
    if (!res.ok) {
      if (res.code === 'CONFLICT') {
        conflictState = { error: res.error, currentRawText: res.currentRawText };
      }
      statusBanner = { kind: 'error', text: res.error || `Failed to delete ${serverName}` };
      rerenderMountedSurfaces();
      return;
    }
    statusBanner = { kind: 'info', text: `Deleted "${serverName}".` };
    if (fromPopup) {
      closeEditPopup();
    }
    await syncDataFromService();
  };

  const handleSaveRaw = async () => {
    const rawText = service.getDraftState().rawTextDraft ?? '';
    const res = await service.saveRawConfig(rawText);
    if (!res.ok) {
      if (res.code === 'CONFLICT') {
        conflictState = { error: res.error, currentRawText: res.currentRawText };
      }
      statusBanner = { kind: 'error', text: res.error || 'Failed to save raw configuration' };
      rerenderMountedSurfaces();
      return;
    }
    conflictState = null;
    invalidJsonError = null;
    service.updateDraftState({ rawTextDraft: res.rawText });
    statusBanner = { kind: 'info', text: 'Saved mcp_config.json and refreshed MCP servers.' };
    await syncDataFromService();
  };

  const buildMainContentNodes = (isEmbeddedSettings = false) => {
    const drafts = service.getDraftState();
    const editorDraft = ensureEditorDraft();
    const nodes = [];

    if (statusBanner) {
      const cls =
        statusBanner.kind === 'error'
          ? 'agy-mcp-banner agy-mcp-banner-error'
          : statusBanner.kind === 'warn'
            ? 'agy-mcp-banner agy-mcp-banner-warn'
            : 'agy-mcp-banner agy-mcp-banner-info';
      nodes.push(
        h(
          doc,
          'div',
          {
            className: cls,
            role: statusBanner.kind === 'error' || statusBanner.kind === 'warn' ? 'alert' : 'status',
            'aria-live': 'polite',
            dataset: { testid: 'agy-mcp-status-banner' },
          },
          statusBanner.text
        )
      );
    }

    if (isEmbeddedSettings) {
      nodes.push(
        h(
          doc,
          'div',
          { className: 'agy-mcp-row', style: { justifyContent: 'space-between' } },
          h(doc, 'h3', { className: 'agy-mcp-title', dataset: { agyNoTranslate: 'true' } }, 'Custom MCP Servers'),
          h(
            doc,
            'div',
            { className: 'agy-mcp-row' },
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn agy-mcp-btn-primary',
                dataset: { testid: 'agy-mcp-settings-add-btn', agyNoTranslate: 'true' },
                onClick: (e) => openModal({ initialTab: 'add', openerEl: e?.currentTarget || null }),
              },
              'Add Server'
            ),
            h(
              doc,
              'button',
              {
                type: 'button',
                className: 'agy-mcp-btn',
                dataset: { testid: 'agy-mcp-settings-edit-btn', agyNoTranslate: 'true' },
                onClick: (e) => openEditPopup({ openerEl: e?.currentTarget || null }),
              },
              'Edit Servers'
            )
          )
        )
      );
    }

    if (activeTab === 'servers' || isEmbeddedSettings) {
      nodes.push(
        renderQuickAddBar({
          doc,
          draftState: drafts,
          onInputChange: (quickAddInput, quickAddAuthToken) => {
            service.updateDraftState({ quickAddInput, quickAddAuthToken });
          },
          onQuickAdd: () => {
            void handleQuickAdd();
          },
          onSmartFill: () => handleSmartFill(),
          onConfirmPendingCommand: () => {
            const pending = service.getDraftState().pendingCommandConfirmation;
            if (pending) {
              void commitQuickAddEntries(pending.entries, Boolean(pending.hasPathOverride));
            }
          },
          onCancelPendingCommand: () => {
            service.updateDraftState({ pendingCommandConfirmation: null });
            statusBanner = null;
            rerenderMountedSurfaces();
          },
        })
      );

      const listContainer = h(doc, 'div', {
        style: { display: 'flex', flexDirection: 'column', gap: '10px' },
        dataset: { testid: 'agy-mcp-server-list' },
      });
      renderServerCardList({
        doc,
        container: listContainer,
        servers: cachedServers,
        runtimeStates: cachedRuntimeStates,
        onToggleServer: (name, enabled) => {
          void handleToggleServer(name, enabled);
        },
        onEditServer: (name) => {
          if (isEmbeddedSettings) {
            openEditPopup({ serverName: name });
          } else {
            service.updateDraftState({
              editorFormDraft: specToEditorFormDraft(name, cachedServers[name]),
            });
            activeTab = 'add';
            rerenderMountedSurfaces();
          }
        },
        onDeleteServer: (name) => {
          void handleDeleteServer(name, false);
        },
        onRefreshServer: (name) => {
          void service.refreshServer(name).then(() => syncDataFromService());
        },
        onOpenOAuthConnect: (name) => {
          void openOAuthConnectModal(name);
        },
        onDisconnectOAuth: (name) => {
          void service.disconnectOAuth(name).then(() => syncDataFromService());
        },
      });
      nodes.push(listContainer);
    } else if (activeTab === 'add') {
      nodes.push(
        renderServerEditorForm({
          doc,
          draft: editorDraft,
          isPopup: false,
          onFieldChange: (patch) => {
            const shouldRerender = Boolean(patch.__rerender);
            const cleanPatch = { ...patch };
            delete cleanPatch.__rerender;
            service.updateDraftState({
              editorFormDraft: { ...ensureEditorDraft(), ...cleanPatch },
            });
            if (shouldRerender) rerenderMountedSurfaces();
          },
          onApplyTemplate: (tpl) => {
            const nextDraft = specToEditorFormDraft(tpl.serverName, tpl.spec);
            nextDraft.originalServerName = '';
            service.updateDraftState({ editorFormDraft: nextDraft });
            rerenderMountedSurfaces();
          },
          onOpenOAuthConnect: () => {
            const targetName = sanitizeServerName(ensureEditorDraft().serverName || '');
            if (!targetName) {
              statusBanner = { kind: 'error', text: 'Save or name the server first before starting OAuth.' };
              rerenderMountedSurfaces();
              return;
            }
            void openOAuthConnectModal(targetName);
          },
          onSubmitOAuthCodeInline: () => {
            const d = ensureEditorDraft();
            const targetName = sanitizeServerName(d.serverName || '');
            void service.completeOAuth(targetName, d.oauthCode).then((res) => {
              if (!res.ok) {
                statusBanner = { kind: 'error', text: res.error || 'OAuth code submission failed' };
                rerenderMountedSurfaces();
                return;
              }
              service.updateDraftState({
                editorFormDraft: { ...ensureEditorDraft(), oauthCode: '' },
              });
              statusBanner = { kind: 'info', text: `Completed OAuth for "${targetName}".` };
              void syncDataFromService();
            });
          },
          onSave: () => {
            void handleSaveEditorForm(false);
          },
        })
      );
    } else if (activeTab === 'raw') {
      nodes.push(
        renderRawJsonEditor({
          doc,
          rawText: drafts.rawTextDraft ?? '',
          configPathLabel: cachedConfigLabel,
          invalidJsonError,
          conflictState,
          onRawTextChange: (nextText) => {
            service.updateDraftState({ rawTextDraft: nextText });
          },
          onSaveRaw: () => {
            void handleSaveRaw();
          },
          onReloadDisk: () => {
            conflictState = null;
            service.updateDraftState({ rawTextDraft: null });
            void syncDataFromService();
          },
          onRevealInExplorer: () => {
            void service.revealConfigInExplorer().then((res) => {
              if (!res || !res.ok) {
                statusBanner = { kind: 'warn', text: res?.error || 'Explorer reveal unavailable in this host mode.' };
                rerenderMountedSurfaces();
              }
            });
          },
        })
      );
    }

    return nodes;
  };

  const renderMainModalDom = () => {
    if (!doc || typeof doc.getElementById !== 'function') return;
    const backdrop = doc.getElementById(MODAL_ID);
    if (!backdrop) return;
    const bodyEl = backdrop.querySelector?.('[data-testid="agy-mcp-modal-body"]') || backdrop._bodyEl;
    const tabsEl = backdrop.querySelector?.('[data-testid="agy-mcp-modal-tabs"]') || backdrop._tabsEl;
    if (tabsEl) {
      clearElement(tabsEl);
      const tabDefs = [
        { id: 'servers', label: 'Servers' },
        { id: 'add', label: 'Add / Edit Server' },
        { id: 'raw', label: 'Raw JSON' },
      ];
      for (let i = 0; i < tabDefs.length; i += 1) {
        const t = tabDefs[i];
        tabsEl.appendChild(
          h(
            doc,
            'button',
            {
              type: 'button',
              role: 'tab',
              className: 'agy-mcp-tab-btn',
              'aria-selected': activeTab === t.id ? 'true' : 'false',
              dataset: { testid: `agy-mcp-tab-${t.id}`, agyNoTranslate: 'true' },
              onClick: () => {
                activeTab = t.id;
                renderMainModalDom();
              },
            },
            t.label
          )
        );
      }
    }
    if (bodyEl) {
      preserveOrRenderBody(bodyEl, buildMainContentNodes(false));
    }
  };

  const preserveOrRenderBody = (bodyEl, nextNodes) => {
    const prevScroll = typeof bodyEl.scrollTop === 'number' ? bodyEl.scrollTop : 0;
    clearElement(bodyEl);
    for (let i = 0; i < nextNodes.length; i += 1) {
      bodyEl.appendChild(nextNodes[i]);
    }
    if (typeof prevScroll === 'number') {
      bodyEl.scrollTop = prevScroll;
    }
  };

  const renderPopupDom = () => {
    if (!doc || typeof doc.getElementById !== 'function') return;
    const backdrop = doc.getElementById(EDIT_POPUP_ID);
    if (!backdrop) return;
    const bodyEl = backdrop._bodyEl || backdrop.querySelector?.('[data-testid="agy-mcp-popup-body"]');
    if (!bodyEl) return;
    const editorDraft = ensureEditorDraft();
    const names = Object.keys(cachedServers || {});
    clearElement(bodyEl);
    if (statusBanner) {
      bodyEl.appendChild(
        h(
          doc,
          'div',
          {
            className:
              statusBanner.kind === 'error'
                ? 'agy-mcp-banner agy-mcp-banner-error'
                : 'agy-mcp-banner agy-mcp-banner-info',
            role: statusBanner.kind === 'error' ? 'alert' : 'status',
          },
          statusBanner.text
        )
      );
    }
    bodyEl.appendChild(
      renderServerEditorForm({
        doc,
        draft: editorDraft,
        isPopup: true,
        existingServerNames: names,
        onSelectServerInPopup: (selectedName) => {
          if (cachedServers[selectedName]) {
            service.updateDraftState({
              editorFormDraft: specToEditorFormDraft(selectedName, cachedServers[selectedName]),
            });
            renderPopupDom();
          }
        },
        onFieldChange: (patch) => {
          const shouldRerender = Boolean(patch.__rerender);
          const cleanPatch = { ...patch };
          delete cleanPatch.__rerender;
          service.updateDraftState({
            editorFormDraft: { ...ensureEditorDraft(), ...cleanPatch },
          });
          if (shouldRerender) renderPopupDom();
        },
        onApplyTemplate: () => {},
        onOpenOAuthConnect: () => {
          const target = sanitizeServerName(ensureEditorDraft().serverName || '');
          if (target) void openOAuthConnectModal(target);
        },
        onSubmitOAuthCodeInline: () => {
          const d = ensureEditorDraft();
          const target = sanitizeServerName(d.serverName || '');
          void service.completeOAuth(target, d.oauthCode).then((res) => {
            statusBanner = res.ok
              ? { kind: 'info', text: `Completed OAuth for "${target}".` }
              : { kind: 'error', text: res.error || 'OAuth failed' };
            renderPopupDom();
          });
        },
        onSave: () => {
          void handleSaveEditorForm(true);
        },
        onDelete: () => {
          const target = ensureEditorDraft().originalServerName || ensureEditorDraft().serverName;
          if (target) void handleDeleteServer(target, true);
        },
      })
    );
  };

  const rerenderMountedSurfaces = () => {
    renderMainModalDom();
    renderPopupDom();
    if (settingsContainerEl && (settingsContainerEl.isConnected !== false)) {
      preserveOrRenderBody(settingsContainerEl, buildMainContentNodes(true));
    }
  };

  function openModal(openOpts = {}) {
    if (rootStore.isDisposed || !doc || !doc.body) return null;
    ensureModalStyles(doc, DEFAULT_STYLE_ID);
    if (openOpts.initialTab) {
      activeTab = openOpts.initialTab;
    }
    modalOpenerEl = openOpts.openerEl || doc.activeElement || null;

    const existing = typeof doc.getElementById === 'function' ? doc.getElementById(MODAL_ID) : null;
    if (existing) {
      applyRootContainerAttributes(existing);
      renderMainModalDom();
      void syncDataFromService();
      return existing;
    }

    if (modalStore) modalStore.dispose();
    modalStore = new DisposableStore();

    const titleId = 'agy-mcp-modal-title';
    const descId = 'agy-mcp-modal-desc';
    const tabsEl = h(doc, 'div', {
      className: 'agy-mcp-tabs',
      role: 'tablist',
      dataset: { testid: 'agy-mcp-modal-tabs' },
    });
    const bodyEl = h(doc, 'div', {
      className: 'agy-mcp-body',
      dataset: { testid: 'agy-mcp-modal-body' },
    });

    const dialogEl = h(
      doc,
      'div',
      {
        className: 'agy-mcp-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        'aria-describedby': descId,
        tabindex: '-1',
        dataset: { testid: 'agy-mcp-modal-dialog' },
      },
      h(
        doc,
        'div',
        { className: 'agy-mcp-header' },
        h(
          doc,
          'div',
          null,
          h(
            doc,
            'h2',
            { id: titleId, className: 'agy-mcp-title', dataset: { agyNoTranslate: 'true' } },
            `${brandProfile.productDisplayName || 'Custom'} MCP Server Manager`
          ),
          h(
            doc,
            'p',
            { id: descId, className: 'agy-mcp-subtitle' },
            'Manage Stdio & HTTP MCP servers in mcp_config.json'
          )
        ),
        h(
          doc,
          'button',
          {
            type: 'button',
            className: 'agy-mcp-btn',
            'aria-label': 'Close MCP Server Manager',
            dataset: { testid: 'agy-mcp-close-btn', agyNoTranslate: 'true' },
            onClick: () => closeModal(),
          },
          'Close'
        )
      ),
      tabsEl,
      bodyEl
    );

    const backdrop = h(
      doc,
      'div',
      {
        id: MODAL_ID,
        className: 'agy-mcp-backdrop',
        onClick: (e) => {
          if (e && e.target === backdrop) {
            closeModal();
          }
        },
      },
      dialogEl
    );
    applyRootContainerAttributes(backdrop);
    backdrop._tabsEl = tabsEl;
    backdrop._bodyEl = bodyEl;

    modalStore.add(
      installDialogKeyboardTrap({
        doc,
        dialogEl,
        onEscape: () => closeModal(),
      })
    );

    doc.body.appendChild(backdrop);
    renderMainModalDom();

    const focusables = getFocusableElements(dialogEl);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      dialogEl.focus?.();
    }

    void syncDataFromService();
    return backdrop;
  }

  function closeModal() {
    const backdrop = doc && typeof doc.getElementById === 'function' ? doc.getElementById(MODAL_ID) : null;
    resetAllDraftsAndDomSecrets(backdrop);
    statusBanner = null;
    if (modalStore) {
      modalStore.dispose();
      modalStore = null;
    }
    if (backdrop) {
      if (typeof backdrop.remove === 'function') backdrop.remove();
      else if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }
    const opener = modalOpenerEl;
    modalOpenerEl = null;
    restoreFocusSafely(doc, opener, getFallbackFocusTarget);
  }

  function openEditPopup(popupOpts = {}) {
    if (rootStore.isDisposed || !doc || !doc.body) return null;
    ensureModalStyles(doc, DEFAULT_STYLE_ID);
    popupOpenerEl = popupOpts.openerEl || doc.activeElement || null;

    const existing = typeof doc.getElementById === 'function' ? doc.getElementById(EDIT_POPUP_ID) : null;
    if (existing) {
      closeEditPopup();
    }

    if (popupStore) popupStore.dispose();
    popupStore = new DisposableStore();

    const titleId = 'agy-mcp-edit-popup-title';
    const descId = 'agy-mcp-edit-popup-desc';
    const bodyEl = h(doc, 'div', {
      className: 'agy-mcp-body',
      dataset: { testid: 'agy-mcp-popup-body' },
    });

    const dialogEl = h(
      doc,
      'div',
      {
        className: 'agy-mcp-dialog agy-mcp-dialog-compact',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        'aria-describedby': descId,
        tabindex: '-1',
        dataset: { testid: 'agy-mcp-edit-popup' },
      },
      h(
        doc,
        'div',
        { className: 'agy-mcp-header' },
        h(
          doc,
          'div',
          null,
          h(doc, 'h2', { id: titleId, className: 'agy-mcp-title', dataset: { agyNoTranslate: 'true' } }, 'Edit MCP Server'),
          h(doc, 'p', { id: descId, className: 'agy-mcp-subtitle' }, 'Modify or remove an existing custom MCP server')
        ),
        h(
          doc,
          'button',
          {
            type: 'button',
            className: 'agy-mcp-btn',
            'aria-label': 'Close Edit MCP Server popup',
            dataset: { testid: 'agy-mcp-popup-close-btn', agyNoTranslate: 'true' },
            onClick: () => closeEditPopup(),
          },
          'Close'
        )
      ),
      bodyEl
    );

    const backdrop = h(
      doc,
      'div',
      {
        id: EDIT_POPUP_ID,
        className: 'agy-mcp-backdrop',
        onClick: (e) => {
          if (e && e.target === backdrop) {
            closeEditPopup();
          }
        },
      },
      dialogEl
    );
    applyRootContainerAttributes(backdrop);
    backdrop._bodyEl = bodyEl;

    popupStore.add(
      installDialogKeyboardTrap({
        doc,
        dialogEl,
        onEscape: () => closeEditPopup(),
      })
    );

    doc.body.appendChild(backdrop);

    void syncDataFromService().then(() => {
      const names = Object.keys(cachedServers || {});
      const chosen = popupOpts.serverName && cachedServers[popupOpts.serverName]
        ? popupOpts.serverName
        : names[0] || '';
      service.updateDraftState({
        editorFormDraft: chosen
          ? specToEditorFormDraft(chosen, cachedServers[chosen])
          : createEmptyEditorDraft(),
      });
      renderPopupDom();
      const focusables = getFocusableElements(dialogEl);
      if (focusables.length > 0) focusables[0].focus();
    });

    return backdrop;
  }

  function closeEditPopup() {
    const backdrop = doc && typeof doc.getElementById === 'function' ? doc.getElementById(EDIT_POPUP_ID) : null;
    resetAllDraftsAndDomSecrets(backdrop);
    if (popupStore) {
      popupStore.dispose();
      popupStore = null;
    }
    if (backdrop) {
      if (typeof backdrop.remove === 'function') backdrop.remove();
      else if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }
    const opener = popupOpenerEl;
    popupOpenerEl = null;
    restoreFocusSafely(doc, opener, getFallbackFocusTarget);
  }

  async function openOAuthConnectModal(serverName, openerEl = null) {
    if (rootStore.isDisposed || !doc || !doc.body) return null;
    ensureModalStyles(doc, DEFAULT_STYLE_ID);
    const seq = ++oauthOpenSeq;

    if (oauthStore) {
      oauthStore.dispose();
      oauthStore = null;
    }
    const prevBackdrop = typeof doc.getElementById === 'function' ? doc.getElementById(OAUTH_MODAL_ID) : null;
    if (prevBackdrop) {
      if (typeof prevBackdrop.remove === 'function') prevBackdrop.remove();
      else if (prevBackdrop.parentNode) prevBackdrop.parentNode.removeChild(prevBackdrop);
    }

    oauthOpenerEl = openerEl || doc.activeElement || null;
    oauthStore = new DisposableStore();
    oauthViewState = {
      serverName,
      authUrl: null,
      statusMessage: 'Discovering OAuth authorization endpoint...',
      errorMessage: null,
    };

    const mountOrRefreshOAuthDom = () => {
      if (seq !== oauthOpenSeq || !oauthViewState || rootStore.isDisposed) return;
      const prev = typeof doc.getElementById === 'function' ? doc.getElementById(OAUTH_MODAL_ID) : null;
      if (prev) {
        if (typeof prev.remove === 'function') prev.remove();
        else if (prev.parentNode) prev.parentNode.removeChild(prev);
      }
      const rendered = renderOAuthConnectDialog({
        doc,
        serverName: oauthViewState.serverName,
        authUrl: oauthViewState.authUrl,
        statusMessage: oauthViewState.statusMessage,
        errorMessage: oauthViewState.errorMessage,
        oauthModalCode: service.getDraftState().oauthCodeDraft || '',
        onCodeChange: (code) => {
          service.updateDraftState({ oauthCodeDraft: code });
        },
        onLaunchBrowser: () => {
          if (!oauthViewState?.authUrl) return;
          void service.openAuthUrl(oauthViewState.authUrl).then((res) => {
            if (seq !== oauthOpenSeq || !oauthViewState) return;
            if (!res.ok) {
              oauthViewState.errorMessage = res.error || 'Blocked unsafe authorization URL';
              mountOrRefreshOAuthDom();
            } else {
              oauthViewState.statusMessage = 'Browser opened. Waiting for OAuth completion...';
              mountOrRefreshOAuthDom();
            }
          });
        },
        onSubmitCode: () => {
          const code = service.getDraftState().oauthCodeDraft || '';
          void service.completeOAuth(serverName, code).then((res) => {
            if (seq !== oauthOpenSeq || !oauthViewState) return;
            if (!res.ok) {
              oauthViewState.errorMessage = res.error || 'Failed to complete OAuth';
              mountOrRefreshOAuthDom();
              return;
            }
            closeOAuthConnectModal();
            statusBanner = { kind: 'info', text: `OAuth connected for "${serverName}".` };
            void syncDataFromService();
          });
        },
        onCancel: () => closeOAuthConnectModal(),
      });
      applyRootContainerAttributes(rendered.backdrop);

      oauthStore.add(
        installDialogKeyboardTrap({
          doc,
          dialogEl: rendered.dialogEl,
          onEscape: () => closeOAuthConnectModal(),
        })
      );
      doc.body.appendChild(rendered.backdrop);
      const focusables = getFocusableElements(rendered.dialogEl);
      if (focusables.length > 0) focusables[0].focus();
    };

    mountOrRefreshOAuthDom();

    const spec = cachedServers[serverName] || {};
    const disc = await service.discoverOAuthMetadata(serverName, spec);
    if (seq !== oauthOpenSeq || !oauthViewState || rootStore.isDisposed) return null;

    if (disc && disc.ok && disc.authUrl) {
      oauthViewState.authUrl = disc.authUrl;
      oauthViewState.statusMessage = 'Authorization URL ready. Click Open Sign-In Page to continue.';
      oauthViewState.errorMessage = null;
    } else {
      oauthViewState.statusMessage = 'Paste the authorization code manually if you already signed in.';
      oauthViewState.errorMessage = disc?.error || null;
    }
    mountOrRefreshOAuthDom();

    const schedulePoll = () => {
      if (seq !== oauthOpenSeq || !oauthStore || oauthStore.isDisposed) return;
      oauthStore.add(
        disposableTimeout(
          win,
          async () => {
            if (seq !== oauthOpenSeq || !oauthStore || oauthStore.isDisposed) return;
            const rt = await service.listRuntimeServerStates();
            if (seq !== oauthOpenSeq || !oauthStore || oauthStore.isDisposed) return;
            if (rt.ok && Array.isArray(rt.states)) {
              const found = rt.states.find((s) => (s?.serverName || s?.name) === serverName && s?.oauthConnected);
              if (found) {
                closeOAuthConnectModal();
                statusBanner = { kind: 'info', text: `OAuth connected for "${serverName}".` };
                void syncDataFromService();
                return;
              }
            }
            schedulePoll();
          },
          600
        )
      );
    };
    schedulePoll();

    return typeof doc.getElementById === 'function' ? doc.getElementById(OAUTH_MODAL_ID) : null;
  }

  function closeOAuthConnectModal() {
    oauthOpenSeq += 1;
    oauthViewState = null;
    const backdrop = doc && typeof doc.getElementById === 'function' ? doc.getElementById(OAUTH_MODAL_ID) : null;
    scrubSensitiveDomInputs(backdrop);
    service.updateDraftState({ oauthCodeDraft: '' });
    if (oauthStore) {
      oauthStore.dispose();
      oauthStore = null;
    }
    if (backdrop) {
      if (typeof backdrop.remove === 'function') backdrop.remove();
      else if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }
    const opener = oauthOpenerEl;
    oauthOpenerEl = null;
    restoreFocusSafely(doc, opener, getFallbackFocusTarget);
  }

  function renderSettingsPageContent(container) {
    if (!container || rootStore.isDisposed) return;
    ensureModalStyles(doc, DEFAULT_STYLE_ID);
    settingsContainerEl = container;
    container.id = container.id || SETTINGS_PANE_ID;
    applyRootContainerAttributes(container);
    preserveOrRenderBody(container, buildMainContentNodes(true));
    void syncDataFromService();
  }

  function onSettingsPaneHidden() {
    if (settingsContainerEl) {
      scrubSensitiveDomInputs(settingsContainerEl);
    }
    resetAllDraftsAndDomSecrets(settingsContainerEl);
    settingsContainerEl = null;
  }

  function isModalOpen() {
    return Boolean(doc && typeof doc.getElementById === 'function' && doc.getElementById(MODAL_ID));
  }

  rootStore.add({
    dispose() {
      closeOAuthConnectModal();
      closeEditPopup();
      closeModal();
      onSettingsPaneHidden();
      if (ownsStyles) {
        removeModalStyles(doc, DEFAULT_STYLE_ID);
      }
    },
  });

  return {
    openModal,
    closeModal,
    isModalOpen,
    openEditPopup,
    closeEditPopup,
    openOAuthConnectModal,
    closeOAuthConnectModal,
    renderSettingsPageContent,
    onSettingsPaneHidden,
    refreshView: syncDataFromService,
    dispose: () => rootStore.dispose(),
  };
}

module.exports = {
  MODAL_ID,
  EDIT_POPUP_ID,
  OAUTH_MODAL_ID,
  SETTINGS_PANE_ID,
  createModalController,
};
