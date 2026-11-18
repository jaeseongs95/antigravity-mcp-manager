'use strict';

/**
 * OAuth Connect Dialog View (`OAUTH_MODAL_ID`).
 *
 * Displays discovered authorization endpoint status, browser launch CTA, and manual
 * authorization code entry without leaking query parameters in cleartext.
 */

const { h, isImeComposing } = require('../dom-kit');
const { redactSensitiveUrl } = require('../../core/schema/auth-codec');

const OAUTH_MODAL_ID = 'agy-mcp-oauth-connect-backdrop';

/**
 * @param {{
 *   doc: any,
 *   serverName: string,
 *   authUrl: string | null,
 *   statusMessage: string,
 *   errorMessage: string | null,
 *   oauthModalCode: string,
 *   onCodeChange: (code: string) => void,
 *   onLaunchBrowser: () => void,
 *   onSubmitCode: () => void,
 *   onCancel: () => void
 * }} props
 */
function renderOAuthConnectDialog(props) {
  const {
    doc,
    serverName,
    authUrl,
    statusMessage,
    errorMessage,
    oauthModalCode,
    onCodeChange,
    onLaunchBrowser,
    onSubmitCode,
    onCancel,
  } = props;

  const titleId = 'agy-mcp-oauth-dialog-title';
  const descId = 'agy-mcp-oauth-dialog-desc';

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
      dataset: { testid: 'agy-mcp-oauth-connect-modal' },
    },
    h(
      doc,
      'div',
      { className: 'agy-mcp-header' },
      h(
        doc,
        'div',
        null,
        h(doc, 'h2', { id: titleId, className: 'agy-mcp-title', dataset: { agyNoTranslate: 'true' } }, `OAuth Sign-In: ${serverName}`),
        h(doc, 'p', { id: descId, className: 'agy-mcp-subtitle' }, 'Authorize access in your browser, or paste the authorization code below.')
      ),
      h(
        doc,
        'button',
        {
          type: 'button',
          className: 'agy-mcp-btn',
          'aria-label': 'Close OAuth dialog',
          dataset: { testid: 'agy-mcp-oauth-cancel-btn', agyNoTranslate: 'true' },
          onClick: () => onCancel(),
        },
        'Close'
      )
    ),
    h(
      doc,
      'div',
      { className: 'agy-mcp-body' },
      errorMessage
        ? h(doc, 'div', { className: 'agy-mcp-banner agy-mcp-banner-error', role: 'alert' }, errorMessage)
        : null,
      statusMessage
        ? h(doc, 'div', { className: 'agy-mcp-banner agy-mcp-banner-info', role: 'status', 'aria-live': 'polite' }, statusMessage)
        : null,
      authUrl
        ? h(
            doc,
            'div',
            {
              style: {
                fontSize: '12px',
                color: 'var(--mcp-text-secondary)',
                fontFamily: 'ui-monospace, monospace',
                wordBreak: 'break-all',
              },
            },
            redactSensitiveUrl(authUrl)
          )
        : null,
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
            disabled: !authUrl,
            dataset: { testid: 'agy-mcp-oauth-launch-btn', agyNoTranslate: 'true' },
            onClick: () => onLaunchBrowser(),
          },
          'Open Sign-In Page'
        )
      ),
      h(
        doc,
        'div',
        { className: 'agy-mcp-field' },
        h(doc, 'label', { className: 'agy-mcp-label' }, 'Authorization Code (if redirected manually)'),
        h(doc, 'input', {
          type: 'password',
          className: 'agy-mcp-input',
          placeholder: 'Paste OAuth code...',
          autocomplete: 'off',
          value: oauthModalCode || '',
          dataset: { field: 'oauthModalCode', agyNoTranslate: 'true' },
          onInput: (e) => onCodeChange(String(e?.target?.value ?? '')),
          onKeydown: (e) => {
            if (isImeComposing(e)) return;
            if (e && e.key === 'Enter') {
              e.preventDefault?.();
              onSubmitCode();
            }
          },
        })
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
            dataset: { testid: 'agy-mcp-submit-oauth-btn', agyNoTranslate: 'true' },
            onClick: () => onSubmitCode(),
          },
          'Complete Sign-In'
        )
      )
    )
  );

  const backdrop = h(
    doc,
    'div',
    {
      id: OAUTH_MODAL_ID,
      className: 'agy-mcp-backdrop',
      onClick: (e) => {
        if (e && e.target === backdrop) {
          onCancel();
        }
      },
    },
    dialogEl
  );

  return { backdrop, dialogEl };
}

module.exports = {
  OAUTH_MODAL_ID,
  renderOAuthConnectDialog,
};
