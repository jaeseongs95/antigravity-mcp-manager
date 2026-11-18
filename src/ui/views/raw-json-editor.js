'use strict';

/**
 * Raw JSON / JSONC Configuration Editor View.
 *
 * Supports `INVALID_JSON` broken-file recovery (`rawTextDraft` preservation) and
 * `CONFLICT` external modification banner with one-click reload from disk.
 */

const { h } = require('../dom-kit');

/**
 * @param {{
 *   doc: any,
 *   rawText: string,
 *   configPathLabel: string,
 *   invalidJsonError: string | null,
 *   conflictState: { error?: string, currentRawText?: string } | null,
 *   onRawTextChange: (nextText: string) => void,
 *   onSaveRaw: () => void,
 *   onReloadDisk: () => void,
 *   onRevealInExplorer: () => void
 * }} props
 */
function renderRawJsonEditor(props) {
  const {
    doc,
    rawText,
    configPathLabel,
    invalidJsonError,
    conflictState,
    onRawTextChange,
    onSaveRaw,
    onReloadDisk,
    onRevealInExplorer,
  } = props;

  const children = [];

  if (invalidJsonError) {
    children.push(
      h(
        doc,
        'div',
        {
          className: 'agy-mcp-banner agy-mcp-banner-error',
          role: 'alert',
          dataset: { testid: 'agy-mcp-invalid-json-banner' },
        },
        `Broken mcp_config.json detected (${invalidJsonError}). Edit the raw text below and click Save Raw Config to repair it.`
      )
    );
  }

  if (conflictState) {
    children.push(
      h(
        doc,
        'div',
        {
          className: 'agy-mcp-banner agy-mcp-banner-warn',
          role: 'alert',
          dataset: { testid: 'agy-mcp-conflict-banner' },
        },
        h(
          doc,
          'div',
          { style: { marginBottom: '6px' } },
          conflictState.error || 'mcp_config.json was modified externally on disk since you opened it.'
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
              className: 'agy-mcp-btn',
              dataset: { testid: 'agy-mcp-reload-disk-btn', agyNoTranslate: 'true' },
              onClick: () => onReloadDisk(),
            },
            'Reload Latest From Disk'
          )
        )
      )
    );
  }

  children.push(
    h(
      doc,
      'div',
      { className: 'agy-mcp-row', style: { justifyContent: 'space-between' } },
      h(
        doc,
        'span',
        {
          style: { fontSize: '12px', color: 'var(--mcp-text-secondary)', fontFamily: 'ui-monospace, monospace' },
          dataset: { agyNoTranslate: 'true' },
        },
        configPathLabel || 'mcp_config.json'
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
            className: 'agy-mcp-btn',
            dataset: { testid: 'agy-mcp-reveal-config-btn', agyNoTranslate: 'true' },
            onClick: () => onRevealInExplorer(),
          },
          'Reveal File'
        ),
        h(
          doc,
          'button',
          {
            type: 'button',
            className: 'agy-mcp-btn',
            dataset: { testid: 'agy-mcp-reload-raw-btn', agyNoTranslate: 'true' },
            onClick: () => onReloadDisk(),
          },
          'Reload'
        )
      )
    ),
    h(doc, 'textarea', {
      className: 'agy-mcp-textarea',
      style: { minHeight: '260px' },
      'aria-label': 'Raw mcp_config.json content',
      value: rawText ?? '',
      dataset: { field: 'rawJsonText', testid: 'agy-mcp-raw-textarea', agyNoTranslate: 'true' },
      onInput: (e) => onRawTextChange(String(e?.target?.value ?? '')),
    }),
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
          dataset: { testid: 'agy-mcp-save-raw-btn', agyNoTranslate: 'true' },
          onClick: () => onSaveRaw(),
        },
        'Save Raw Config'
      )
    )
  );

  return h(doc, 'section', { className: 'agy-mcp-card' }, ...children);
}

module.exports = {
  renderRawJsonEditor,
};
