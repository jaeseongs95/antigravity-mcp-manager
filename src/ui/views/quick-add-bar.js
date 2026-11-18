'use strict';

/**
 * Quick Auto-Add Bar + Mandatory Stdio/Command & PATH Confirmation Gate View.
 *
 * Every `stdio` / `command` specification (including `npx`/`uvx`, GitHub/npm package names,
 * and `multipleServers` entries containing `command`) and any `PATH` override MUST display
 * the decomposed `command` / `args` / `env` confirmation panel before execution/persistence.
 */

const { h, isImeComposing } = require('../dom-kit');
const { redactSensitiveText } = require('../../core/schema/auth-codec');

/**
 * @param {{
 *   doc: any,
 *   draftState: {
 *     quickAddInput: string,
 *     quickAddAuthToken: string,
 *     pendingCommandConfirmation: any | null
 *   },
 *   onInputChange: (nextInput: string, nextAuthToken: string) => void,
 *   onQuickAdd: () => void,
 *   onSmartFill: () => void,
 *   onConfirmPendingCommand: () => void,
 *   onCancelPendingCommand: () => void
 * }} props
 */
function renderQuickAddBar(props) {
  const {
    doc,
    draftState,
    onInputChange,
    onQuickAdd,
    onSmartFill,
    onConfirmPendingCommand,
    onCancelPendingCommand,
  } = props;

  const smartInputEl = h(doc, 'input', {
    type: 'text',
    className: 'agy-mcp-input',
    placeholder: 'Paste MCP URL, JSON snippet, npm/uvx package, or curl command...',
    value: draftState.quickAddInput || '',
    'aria-label': 'Quick Auto-Add MCP input',
    dataset: {
      testid: 'agy-mcp-smart-input',
      field: 'quickAddInput',
      agyNoTranslate: 'true',
    },
    onInput: (e) => {
      onInputChange(String(e?.target?.value ?? ''), String(authInputEl.value ?? ''));
    },
    onKeydown: (e) => {
      if (isImeComposing(e)) return;
      if (e && e.key === 'Enter') {
        e.preventDefault?.();
        onQuickAdd();
      }
    },
  });

  const authInputEl = h(doc, 'input', {
    type: 'password',
    className: 'agy-mcp-input',
    placeholder: 'Optional auth token / API key (Bearer, x-api-key:..., user:pass)',
    value: draftState.quickAddAuthToken || '',
    autocomplete: 'off',
    'aria-label': 'Optional Quick Add auth token',
    dataset: {
      testid: 'agy-mcp-smart-auth-input',
      field: 'quickAddAuthToken',
      agyNoTranslate: 'true',
    },
    onInput: (e) => {
      onInputChange(String(smartInputEl.value ?? ''), String(e?.target?.value ?? ''));
    },
    onKeydown: (e) => {
      if (isImeComposing(e)) return;
      if (e && e.key === 'Enter') {
        e.preventDefault?.();
        onQuickAdd();
      }
    },
  });

  const addBtn = h(
    doc,
    'button',
    {
      type: 'button',
      className: 'agy-mcp-btn agy-mcp-btn-primary',
      dataset: {
        testid: 'agy-mcp-smart-add-btn',
        agyNoTranslate: 'true',
      },
      onClick: () => onQuickAdd(),
    },
    'Auto-Add'
  );

  const fillBtn = h(
    doc,
    'button',
    {
      type: 'button',
      className: 'agy-mcp-btn',
      dataset: {
        testid: 'agy-mcp-smart-fill-btn',
        agyNoTranslate: 'true',
      },
      onClick: () => onSmartFill(),
    },
    'Fill Form'
  );

  const children = [
    h(
      doc,
      'div',
      { className: 'agy-mcp-grid-2' },
      h(doc, 'div', { className: 'agy-mcp-field' }, smartInputEl),
      h(doc, 'div', { className: 'agy-mcp-field' }, authInputEl)
    ),
    h(doc, 'div', { className: 'agy-mcp-row' }, addBtn, fillBtn),
  ];

  const pending = draftState.pendingCommandConfirmation;
  if (pending) {
    const entries = Array.isArray(pending.entries) ? pending.entries : [];
    const summaryLines = entries.map((entry) => {
      const spec = entry.spec || {};
      if (typeof spec.command === 'string' && spec.command.trim()) {
        const argsStr = Array.isArray(spec.args) ? spec.args.join(' ') : '';
        const envKeys = spec.env && typeof spec.env === 'object' ? Object.keys(spec.env) : [];
        const envNote = envKeys.length > 0 ? ` [env: ${envKeys.join(', ')}]` : '';
        return `${entry.serverName}: ${spec.command}${argsStr ? ` ${argsStr}` : ''}${envNote}`;
      }
      const endpoint = spec.url || spec.serverUrl || '';
      return `${entry.serverName}: ${redactSensitiveText(endpoint)}`;
    });

    const confirmPanel = h(
      doc,
      'div',
      {
        className: 'agy-mcp-banner agy-mcp-banner-warn',
        role: 'alert',
        dataset: {
          testid: 'agy-mcp-confirm-command-panel',
          agyNoTranslate: 'true',
        },
      },
      h(
        doc,
        'div',
        { style: { fontWeight: '600', marginBottom: '6px' } },
        pending.hasPathOverride
          ? 'Confirm Local Command & PATH Override Execution'
          : 'Confirm Local Stdio Command Execution'
      ),
      h(
        doc,
        'div',
        { style: { marginBottom: '8px', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' } },
        summaryLines.join('\n')
      ),
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
            dataset: {
              testid: 'agy-mcp-confirm-command-btn',
              agyNoTranslate: 'true',
            },
            onClick: () => onConfirmPendingCommand(),
          },
          'Confirm & Add Command'
        ),
        h(
          doc,
          'button',
          {
            type: 'button',
            className: 'agy-mcp-btn',
            dataset: {
              testid: 'agy-mcp-cancel-command-btn',
              agyNoTranslate: 'true',
            },
            onClick: () => onCancelPendingCommand(),
          },
          'Cancel'
        )
      )
    );
    children.push(confirmPanel);
  }

  return h(
    doc,
    'section',
    {
      className: 'agy-mcp-card',
      'aria-label': 'Quick Auto-Add MCP Server',
    },
    ...children
  );
}

module.exports = {
  renderQuickAddBar,
};
