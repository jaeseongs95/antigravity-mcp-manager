'use strict';

/**
 * Server Connection, Authentication, Advanced OAuth, and Security Gate Form View.
 */

const { h } = require('../dom-kit');
const { QUICK_TEMPLATES } = require('../../core/schema/presets');
const { extractAuthFromSpec, formatKeyValueOutput } = require('../../core/schema/auth-codec');
const { extractAndValidateTransport } = require('../../core/schema/server-spec');

function createEmptyEditorDraft() {
  return {
    originalServerName: '',
    serverName: '',
    description: '',
    transport: 'http',
    urlKey: 'serverUrl',
    url: '',
    headersText: '',
    command: '',
    argsText: '',
    cwd: '',
    envText: '',
    authMode: 'none',
    oauthClientMode: 'auto',
    oauthClientId: '',
    oauthClientSecret: '',
    oauthScopes: '',
    oauthCode: '',
    showAdvancedOAuth: false,
    bearerToken: '',
    apiKeyHeader: 'x-api-key',
    apiKeyValue: '',
    basicUser: '',
    basicPass: '',
    applyAuthToAllHttp: false,
    confirmPathOverride: false,
    allowInsecureHttp: false,
  };
}

/**
 * Converts a stored server `spec` into a mutable form draft.
 *
 * @param {string} serverName
 * @param {Record<string, any>} spec
 */
function specToEditorFormDraft(serverName, spec) {
  const draft = createEmptyEditorDraft();
  draft.originalServerName = String(serverName || '');
  draft.serverName = String(serverName || '');
  if (!spec || typeof spec !== 'object') return draft;

  draft.description = typeof spec.description === 'string' ? spec.description : '';
  const tr = extractAndValidateTransport(spec);
  const auth = extractAuthFromSpec(spec);

  if (tr.ok && tr.transport === 'stdio') {
    draft.transport = 'stdio';
    draft.command = tr.command;
    draft.argsText = Array.isArray(spec.args) ? spec.args.join('\n') : '';
    draft.cwd = typeof spec.cwd === 'string' ? spec.cwd : '';
    draft.envText = formatKeyValueOutput(auth.remainingEnv);
  } else {
    draft.transport = 'http';
    draft.urlKey = tr.ok && tr.urlKey ? tr.urlKey : 'serverUrl';
    draft.url = tr.ok ? tr.canonicalUrl : String(spec.serverUrl || spec.url || '');
    draft.headersText = formatKeyValueOutput(auth.remainingHeaders);
  }

  draft.authMode = auth.authMode || 'none';
  draft.bearerToken = auth.bearerToken || '';
  draft.apiKeyHeader = auth.apiKeyHeader || 'x-api-key';
  draft.apiKeyValue = auth.apiKeyValue || '';
  draft.basicUser = auth.basicUser || '';
  draft.basicPass = auth.basicPass || '';
  draft.oauthClientMode = auth.oauthClientMode || 'auto';
  draft.oauthClientId = auth.oauthClientId || '';
  draft.oauthClientSecret = auth.oauthClientSecret || '';
  draft.oauthScopes = auth.oauthScopes || '';
  draft.showAdvancedOAuth = draft.oauthClientMode === 'manual' || Boolean(draft.oauthClientId || draft.oauthScopes);

  return draft;
}

/**
 * Renders the add/edit server form.
 *
 * @param {{
 *   doc: any,
 *   draft: Record<string, any>,
 *   isPopup?: boolean,
 *   existingServerNames?: string[],
 *   onFieldChange: (patch: Record<string, any>) => void,
 *   onSelectServerInPopup?: (serverName: string) => void,
 *   onApplyTemplate: (template: any) => void,
 *   onOpenOAuthConnect: () => void,
 *   onSubmitOAuthCodeInline: () => void,
 *   onSave: () => void,
 *   onDelete?: () => void
 * }} props
 */
function renderServerEditorForm(props) {
  const {
    doc,
    draft,
    isPopup = false,
    existingServerNames = [],
    onFieldChange,
    onSelectServerInPopup,
    onApplyTemplate,
    onOpenOAuthConnect,
    onSubmitOAuthCodeInline,
    onSave,
    onDelete,
  } = props;

  const update = (field, value, rerender = false) => {
    onFieldChange({ [field]: value, __rerender: rerender });
  };

  const sections = [];

  if (isPopup && existingServerNames.length > 0 && typeof onSelectServerInPopup === 'function') {
    sections.push(
      h(
        doc,
        'div',
        { className: 'agy-mcp-field' },
        h(doc, 'label', { className: 'agy-mcp-label' }, 'Select Server to Edit'),
        h(
          doc,
          'select',
          {
            className: 'agy-mcp-select',
            value: draft.originalServerName || draft.serverName,
            dataset: { field: 'popupServerSelect', testid: 'agy-mcp-popup-server-select' },
            onChange: (e) => onSelectServerInPopup(String(e?.target?.value ?? '')),
          },
          ...existingServerNames.map((name) =>
            h(doc, 'option', { value: name, selected: name === (draft.originalServerName || draft.serverName) }, name)
          )
        )
      )
    );
  }

  if (!isPopup) {
    sections.push(
      h(
        doc,
        'div',
        { className: 'agy-mcp-row' },
        ...QUICK_TEMPLATES.slice(0, 6).map((tpl) =>
          h(
            doc,
            'button',
            {
              type: 'button',
              className: 'agy-mcp-btn',
              dataset: { testid: `agy-mcp-template-${tpl.id}`, agyNoTranslate: 'true' },
              onClick: () => onApplyTemplate(tpl),
            },
            `+ ${tpl.label}`
          )
        )
      )
    );
  }

  sections.push(
    h(
      doc,
      'div',
      { className: 'agy-mcp-grid-2' },
      h(
        doc,
        'div',
        { className: 'agy-mcp-field' },
        h(doc, 'label', { className: 'agy-mcp-label' }, 'Server Name'),
        h(doc, 'input', {
          type: 'text',
          className: 'agy-mcp-input',
          placeholder: 'e.g. github-mcp',
          value: draft.serverName || '',
          dataset: { field: 'serverName', agyNoTranslate: 'true' },
          onInput: (e) => update('serverName', String(e?.target?.value ?? '')),
        })
      ),
      h(
        doc,
        'div',
        { className: 'agy-mcp-field' },
        h(doc, 'label', { className: 'agy-mcp-label' }, 'Transport'),
        h(
          doc,
          'select',
          {
            className: 'agy-mcp-select',
            value: draft.transport || 'http',
            dataset: { field: 'transport', agyNoTranslate: 'true' },
            onChange: (e) => update('transport', String(e?.target?.value ?? 'http'), true),
          },
          h(doc, 'option', { value: 'http', selected: draft.transport !== 'stdio' }, 'HTTP / Streamable SSE'),
          h(doc, 'option', { value: 'stdio', selected: draft.transport === 'stdio' }, 'Stdio (Local Command)')
        )
      )
    ),
    h(
      doc,
      'div',
      { className: 'agy-mcp-field' },
      h(doc, 'label', { className: 'agy-mcp-label' }, 'Description (optional)'),
      h(doc, 'input', {
        type: 'text',
        className: 'agy-mcp-input',
        value: draft.description || '',
        dataset: { field: 'description' },
        onInput: (e) => update('description', String(e?.target?.value ?? '')),
      })
    )
  );

  if (draft.transport === 'stdio') {
    sections.push(
      h(
        doc,
        'div',
        { className: 'agy-mcp-grid-2' },
        h(
          doc,
          'div',
          { className: 'agy-mcp-field' },
          h(doc, 'label', { className: 'agy-mcp-label' }, 'Command'),
          h(doc, 'input', {
            type: 'text',
            className: 'agy-mcp-input',
            placeholder: 'npx',
            value: draft.command || '',
            dataset: { field: 'command', agyNoTranslate: 'true' },
            onInput: (e) => update('command', String(e?.target?.value ?? '')),
          })
        ),
        h(
          doc,
          'div',
          { className: 'agy-mcp-field' },
          h(doc, 'label', { className: 'agy-mcp-label' }, 'Working Directory (cwd, optional)'),
          h(doc, 'input', {
            type: 'text',
            className: 'agy-mcp-input',
            value: draft.cwd || '',
            dataset: { field: 'cwd', agyNoTranslate: 'true' },
            onInput: (e) => update('cwd', String(e?.target?.value ?? '')),
          })
        )
      ),
      h(
        doc,
        'div',
        { className: 'agy-mcp-grid-2' },
        h(
          doc,
          'div',
          { className: 'agy-mcp-field' },
          h(doc, 'label', { className: 'agy-mcp-label' }, 'Arguments (one per line)'),
          h(doc, 'textarea', {
            className: 'agy-mcp-textarea',
            value: draft.argsText || '',
            dataset: { field: 'argsText', agyNoTranslate: 'true' },
            onInput: (e) => update('argsText', String(e?.target?.value ?? '')),
          })
        ),
        h(
          doc,
          'div',
          { className: 'agy-mcp-field' },
          h(doc, 'label', { className: 'agy-mcp-label' }, 'Environment Variables (KEY=VALUE)'),
          h(doc, 'textarea', {
            className: 'agy-mcp-textarea',
            value: draft.envText || '',
            dataset: { field: 'envText', agyNoTranslate: 'true' },
            onInput: (e) => update('envText', String(e?.target?.value ?? '')),
          })
        )
      ),
      h(
        doc,
        'label',
        { className: 'agy-mcp-row', style: { fontSize: '12px' } },
        h(doc, 'input', {
          type: 'checkbox',
          checked: Boolean(draft.confirmPathOverride),
          dataset: { field: 'confirmPathOverride' },
          onChange: (e) => update('confirmPathOverride', Boolean(e?.target?.checked)),
        }),
        'Allow custom PATH environment override (if specified above)'
      )
    );
  } else {
    sections.push(
      h(
        doc,
        'div',
        { className: 'agy-mcp-field' },
        h(doc, 'label', { className: 'agy-mcp-label' }, 'Server URL (HTTPS or loopback HTTP)'),
        h(doc, 'input', {
          type: 'url',
          className: 'agy-mcp-input',
          placeholder: 'https://mcp.example.com/mcp',
          value: draft.url || '',
          dataset: { field: 'url', agyNoTranslate: 'true' },
          onInput: (e) => update('url', String(e?.target?.value ?? '')),
        })
      ),
      h(
        doc,
        'div',
        { className: 'agy-mcp-field' },
        h(doc, 'label', { className: 'agy-mcp-label' }, 'Custom Headers (Header: Value)'),
        h(doc, 'textarea', {
          className: 'agy-mcp-textarea',
          value: draft.headersText || '',
          dataset: { field: 'headersText', agyNoTranslate: 'true' },
          onInput: (e) => update('headersText', String(e?.target?.value ?? '')),
        })
      ),
      h(
        doc,
        'label',
        { className: 'agy-mcp-row', style: { fontSize: '12px' } },
        h(doc, 'input', {
          type: 'checkbox',
          checked: Boolean(draft.allowInsecureHttp),
          dataset: { field: 'allowInsecureHttp' },
          onChange: (e) => update('allowInsecureHttp', Boolean(e?.target?.checked)),
        }),
        'Allow unencrypted non-loopback http:// endpoint (credentials still blocked)'
      )
    );
  }

  const authChildren = [
    h(
      doc,
      'div',
      { className: 'agy-mcp-field' },
      h(doc, 'label', { className: 'agy-mcp-label' }, 'Authentication Method'),
      h(
        doc,
        'select',
        {
          className: 'agy-mcp-select',
          value: draft.authMode || 'none',
          dataset: { field: 'authMode', agyNoTranslate: 'true' },
          onChange: (e) => update('authMode', String(e?.target?.value ?? 'none'), true),
        },
        h(doc, 'option', { value: 'none', selected: !draft.authMode || draft.authMode === 'none' }, 'None'),
        h(doc, 'option', { value: 'oauth', selected: draft.authMode === 'oauth' }, 'OAuth 2.0 / Browser Sign-In'),
        h(doc, 'option', { value: 'bearer', selected: draft.authMode === 'bearer' }, 'Bearer Token'),
        h(doc, 'option', { value: 'apiKey', selected: draft.authMode === 'apiKey' }, 'API Key Header / Env'),
        h(doc, 'option', { value: 'basic', selected: draft.authMode === 'basic' }, 'HTTP Basic Auth')
      )
    ),
  ];

  if (draft.authMode === 'bearer') {
    authChildren.push(
      h(
        doc,
        'div',
        { className: 'agy-mcp-field' },
        h(doc, 'label', { className: 'agy-mcp-label' }, 'Bearer Token'),
        h(doc, 'input', {
          type: 'password',
          className: 'agy-mcp-input',
          autocomplete: 'off',
          value: draft.bearerToken || '',
          dataset: { field: 'bearerToken', agyNoTranslate: 'true' },
          onInput: (e) => update('bearerToken', String(e?.target?.value ?? '')),
        })
      )
    );
  } else if (draft.authMode === 'apiKey') {
    authChildren.push(
      h(
        doc,
        'div',
        { className: 'agy-mcp-grid-2' },
        h(
          doc,
          'div',
          { className: 'agy-mcp-field' },
          h(doc, 'label', { className: 'agy-mcp-label' }, draft.transport === 'stdio' ? 'Env Variable Name' : 'Header Name'),
          h(doc, 'input', {
            type: 'text',
            className: 'agy-mcp-input',
            value: draft.apiKeyHeader || 'x-api-key',
            dataset: { field: 'apiKeyHeader', agyNoTranslate: 'true' },
            onInput: (e) => update('apiKeyHeader', String(e?.target?.value ?? '')),
          })
        ),
        h(
          doc,
          'div',
          { className: 'agy-mcp-field' },
          h(doc, 'label', { className: 'agy-mcp-label' }, 'API Key Value'),
          h(doc, 'input', {
            type: 'password',
            className: 'agy-mcp-input',
            autocomplete: 'off',
            value: draft.apiKeyValue || '',
            dataset: { field: 'apiKeyValue', agyNoTranslate: 'true' },
            onInput: (e) => update('apiKeyValue', String(e?.target?.value ?? '')),
          })
        )
      )
    );
  } else if (draft.authMode === 'basic') {
    authChildren.push(
      h(
        doc,
        'div',
        { className: 'agy-mcp-grid-2' },
        h(
          doc,
          'div',
          { className: 'agy-mcp-field' },
          h(doc, 'label', { className: 'agy-mcp-label' }, 'Username'),
          h(doc, 'input', {
            type: 'text',
            className: 'agy-mcp-input',
            value: draft.basicUser || '',
            dataset: { field: 'basicUser', agyNoTranslate: 'true' },
            onInput: (e) => update('basicUser', String(e?.target?.value ?? '')),
          })
        ),
        h(
          doc,
          'div',
          { className: 'agy-mcp-field' },
          h(doc, 'label', { className: 'agy-mcp-label' }, 'Password'),
          h(doc, 'input', {
            type: 'password',
            className: 'agy-mcp-input',
            autocomplete: 'off',
            value: draft.basicPass || '',
            dataset: { field: 'basicPass', agyNoTranslate: 'true' },
            onInput: (e) => update('basicPass', String(e?.target?.value ?? '')),
          })
        )
      )
    );
  } else if (draft.authMode === 'oauth') {
    authChildren.push(
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
            dataset: { testid: 'agy-mcp-open-oauth-connect-btn', agyNoTranslate: 'true' },
            onClick: () => onOpenOAuthConnect(),
          },
          'Connect with Browser OAuth'
        ),
        h(
          doc,
          'button',
          {
            type: 'button',
            className: 'agy-mcp-btn',
            dataset: { testid: 'agy-mcp-advanced-oauth-toggle', agyNoTranslate: 'true' },
            onClick: () => update('showAdvancedOAuth', !draft.showAdvancedOAuth, true),
          },
          draft.showAdvancedOAuth ? 'Hide Advanced OAuth' : 'Advanced OAuth Settings'
        )
      )
    );

    if (draft.showAdvancedOAuth) {
      authChildren.push(
        h(
          doc,
          'div',
          { className: 'agy-mcp-grid-2' },
          h(
            doc,
            'div',
            { className: 'agy-mcp-field' },
            h(doc, 'label', { className: 'agy-mcp-label' }, 'Client Registration Mode'),
            h(
              doc,
              'select',
              {
                className: 'agy-mcp-select',
                value: draft.oauthClientMode || 'auto',
                dataset: { field: 'oauthClientMode', agyNoTranslate: 'true' },
                onChange: (e) => update('oauthClientMode', String(e?.target?.value ?? 'auto'), true),
              },
              h(doc, 'option', { value: 'auto', selected: draft.oauthClientMode !== 'manual' }, 'Dynamic / Automatic'),
              h(doc, 'option', { value: 'manual', selected: draft.oauthClientMode === 'manual' }, 'Manual Client ID')
            )
          ),
          h(
            doc,
            'div',
            { className: 'agy-mcp-field' },
            h(doc, 'label', { className: 'agy-mcp-label' }, 'Scopes (space or comma separated)'),
            h(doc, 'input', {
              type: 'text',
              className: 'agy-mcp-input',
              value: draft.oauthScopes || '',
              dataset: { field: 'oauthScopes', agyNoTranslate: 'true' },
              onInput: (e) => update('oauthScopes', String(e?.target?.value ?? '')),
            })
          )
        )
      );
      if (draft.oauthClientMode === 'manual') {
        authChildren.push(
          h(
            doc,
            'div',
            { className: 'agy-mcp-grid-2' },
            h(
              doc,
              'div',
              { className: 'agy-mcp-field' },
              h(doc, 'label', { className: 'agy-mcp-label' }, 'Client ID'),
              h(doc, 'input', {
                type: 'text',
                className: 'agy-mcp-input',
                value: draft.oauthClientId || '',
                dataset: { field: 'oauthClientId', agyNoTranslate: 'true' },
                onInput: (e) => update('oauthClientId', String(e?.target?.value ?? '')),
              })
            ),
            h(
              doc,
              'div',
              { className: 'agy-mcp-field' },
              h(doc, 'label', { className: 'agy-mcp-label' }, 'Client Secret (optional)'),
              h(doc, 'input', {
                type: 'password',
                className: 'agy-mcp-input',
                autocomplete: 'off',
                value: draft.oauthClientSecret || '',
                dataset: { field: 'oauthClientSecret', agyNoTranslate: 'true' },
                onInput: (e) => update('oauthClientSecret', String(e?.target?.value ?? '')),
              })
            )
          )
        );
      }
      authChildren.push(
        h(
          doc,
          'div',
          { className: 'agy-mcp-row' },
          h(doc, 'input', {
            type: 'password',
            className: 'agy-mcp-input',
            style: { flex: '1 1 220px' },
            placeholder: 'Paste OAuth authorization code...',
            autocomplete: 'off',
            value: draft.oauthCode || '',
            dataset: { field: 'oauthCode', agyNoTranslate: 'true' },
            onInput: (e) => update('oauthCode', String(e?.target?.value ?? '')),
          }),
          h(
            doc,
            'button',
            {
              type: 'button',
              className: 'agy-mcp-btn',
              dataset: { testid: 'agy-mcp-submit-oauth-btn', agyNoTranslate: 'true' },
              onClick: () => onSubmitOAuthCodeInline(),
            },
            'Complete OAuth'
          )
        )
      );
    }
  }

  if (draft.transport !== 'stdio' && (draft.authMode === 'bearer' || draft.authMode === 'apiKey' || draft.authMode === 'basic')) {
    authChildren.push(
      h(
        doc,
        'label',
        { className: 'agy-mcp-row', style: { fontSize: '12px' } },
        h(doc, 'input', {
          type: 'checkbox',
          checked: Boolean(draft.applyAuthToAllHttp),
          dataset: { field: 'applyAuthToAllHttp' },
          onChange: (e) => update('applyAuthToAllHttp', Boolean(e?.target?.checked)),
        }),
        'Also apply these auth headers to all eligible HTTPS / loopback HTTP MCP servers'
      )
    );
  }

  sections.push(
    h(
      doc,
      'section',
      {
        className: 'agy-mcp-card',
        dataset: { testid: 'agy-mcp-auth-section' },
      },
      ...authChildren
    )
  );

  const footerRow = [
    h(
      doc,
      'button',
      {
        type: 'button',
        className: 'agy-mcp-btn agy-mcp-btn-primary',
        dataset: {
          testid: isPopup ? 'agy-mcp-popup-save-btn' : 'agy-mcp-form-save-btn',
          agyNoTranslate: 'true',
        },
        onClick: () => onSave(),
      },
      isPopup ? 'Save Changes' : 'Save Server'
    ),
  ];

  if (isPopup && typeof onDelete === 'function' && (draft.originalServerName || draft.serverName)) {
    footerRow.push(
      h(
        doc,
        'button',
        {
          type: 'button',
          className: 'agy-mcp-btn agy-mcp-btn-danger',
          dataset: { testid: 'agy-mcp-popup-delete-btn', agyNoTranslate: 'true' },
          onClick: () => onDelete(),
        },
        'Delete Server'
      )
    );
  }

  sections.push(h(doc, 'div', { className: 'agy-mcp-row' }, ...footerRow));

  return h(
    doc,
    'form',
    {
      className: 'agy-mcp-card',
      onSubmit: (e) => {
        e?.preventDefault?.();
        onSave();
      },
    },
    ...sections
  );
}

module.exports = {
  createEmptyEditorDraft,
  specToEditorFormDraft,
  renderServerEditorForm,
};
