'use strict';

/**
 * Configured MCP Server Card List View.
 *
 * Uses `redactSensitiveUrl` / `redactSensitiveText` so inline credentials, query tokens,
 * and header secrets are never rendered in cleartext on cards, and preserves scrollTop.
 */

const { h, clearElement, preserveScrollTop } = require('../dom-kit');
const { redactSensitiveUrl, redactSensitiveText } = require('../../core/schema/auth-codec');
const { extractAndValidateTransport } = require('../../core/schema/server-spec');

/**
 * Renders server cards inside `container` while preserving scroll position.
 *
 * @param {{
 *   doc: any,
 *   container: any,
 *   servers: Record<string, any>,
 *   runtimeStates: any[],
 *   onToggleServer: (serverName: string, nextEnabled: boolean) => void,
 *   onEditServer: (serverName: string) => void,
 *   onDeleteServer: (serverName: string) => void,
 *   onRefreshServer: (serverName: string) => void,
 *   onOpenOAuthConnect: (serverName: string) => void,
 *   onDisconnectOAuth: (serverName: string) => void
 * }} props
 */
function renderServerCardList(props) {
  const {
    doc,
    container,
    servers,
    runtimeStates,
    onToggleServer,
    onEditServer,
    onDeleteServer,
    onRefreshServer,
    onOpenOAuthConnect,
    onDisconnectOAuth,
  } = props;

  const stateByName = new Map();
  if (Array.isArray(runtimeStates)) {
    for (let i = 0; i < runtimeStates.length; i += 1) {
      const st = runtimeStates[i];
      const name = String(st?.serverName || st?.name || '').trim();
      if (name) stateByName.set(name, st);
    }
  }

  const serverNames = Object.keys(servers || {});

  preserveScrollTop(container, () => {
    clearElement(container);

    if (serverNames.length === 0) {
      container.appendChild(
        h(
          doc,
          'div',
          {
            className: 'agy-mcp-card',
            dataset: { testid: 'agy-mcp-empty-state' },
          },
          'No custom MCP servers configured yet. Use Quick Auto-Add above or Add Server to create one.'
        )
      );
      return;
    }

    for (let i = 0; i < serverNames.length; i += 1) {
      const name = serverNames[i];
      const spec = servers[name] || {};
      const rt = stateByName.get(name) || null;
      const enabled = spec.disabled !== true;

      const transportCheck = extractAndValidateTransport(spec);
      let summaryText = '';
      let isHttp = false;
      if (transportCheck.ok) {
        if (transportCheck.transport === 'stdio') {
          const argsJoined = Array.isArray(spec.args) ? spec.args.join(' ') : '';
          summaryText = redactSensitiveText(`${transportCheck.command}${argsJoined ? ` ${argsJoined}` : ''}`);
        } else {
          isHttp = true;
          summaryText = redactSensitiveUrl(transportCheck.canonicalUrl);
        }
      } else {
        summaryText = `[Invalid spec: ${transportCheck.code}]`;
      }

      const statusLabel = rt?.status || (enabled ? 'enabled' : 'disabled');
      const tools = Array.isArray(rt?.tools) ? rt.tools : [];
      const hasOAuth = Boolean(spec.oauth && typeof spec.oauth === 'object') || Boolean(rt?.oauthConnected || rt?.requiresOAuth);

      const actionButtons = [
        h(
          doc,
          'button',
          {
            type: 'button',
            className: 'agy-mcp-btn',
            'aria-pressed': enabled ? 'true' : 'false',
            dataset: {
              testid: `agy-mcp-toggle-${name}`,
              serverName: name,
              agyNoTranslate: 'true',
            },
            onClick: () => onToggleServer(name, !enabled),
          },
          enabled ? 'Disable' : 'Enable'
        ),
        h(
          doc,
          'button',
          {
            type: 'button',
            className: 'agy-mcp-btn',
            dataset: {
              testid: `agy-mcp-edit-${name}`,
              serverName: name,
              agyNoTranslate: 'true',
            },
            onClick: () => onEditServer(name),
          },
          'Edit'
        ),
        h(
          doc,
          'button',
          {
            type: 'button',
            className: 'agy-mcp-btn',
            dataset: {
              testid: `agy-mcp-refresh-${name}`,
              serverName: name,
              agyNoTranslate: 'true',
            },
            onClick: () => onRefreshServer(name),
          },
          'Refresh'
        ),
      ];

      if (isHttp || hasOAuth) {
        actionButtons.push(
          h(
            doc,
            'button',
            {
              type: 'button',
              className: 'agy-mcp-btn',
              dataset: {
                testid: `agy-mcp-oauth-${name}`,
                serverName: name,
                agyNoTranslate: 'true',
              },
              onClick: () => onOpenOAuthConnect(name),
            },
            'OAuth Connect'
          )
        );
      }

      if (rt?.oauthConnected) {
        actionButtons.push(
          h(
            doc,
            'button',
            {
              type: 'button',
              className: 'agy-mcp-btn',
              dataset: {
                testid: `agy-mcp-oauth-disconnect-${name}`,
                serverName: name,
                agyNoTranslate: 'true',
              },
              onClick: () => onDisconnectOAuth(name),
            },
            'Disconnect OAuth'
          )
        );
      }

      actionButtons.push(
        h(
          doc,
          'button',
          {
            type: 'button',
            className: 'agy-mcp-btn agy-mcp-btn-danger',
            dataset: {
              testid: `agy-mcp-delete-${name}`,
              serverName: name,
              agyNoTranslate: 'true',
            },
            onClick: () => onDeleteServer(name),
          },
          'Delete'
        )
      );

      const cardChildren = [
        h(
          doc,
          'div',
          { className: 'agy-mcp-row', style: { justifyContent: 'space-between' } },
          h(
            doc,
            'div',
            { className: 'agy-mcp-row' },
            h(doc, 'strong', { dataset: { agyNoTranslate: 'true' } }, name),
            h(doc, 'span', { className: 'agy-mcp-chip', dataset: { agyNoTranslate: 'true' } }, String(statusLabel)),
            tools.length > 0
              ? h(doc, 'span', { className: 'agy-mcp-chip' }, `${tools.length} tools`)
              : null
          ),
          h(doc, 'div', { className: 'agy-mcp-row' }, ...actionButtons)
        ),
        h(
          doc,
          'div',
          {
            style: {
              fontSize: '12px',
              color: 'var(--mcp-text-secondary)',
              fontFamily: 'ui-monospace, monospace',
              wordBreak: 'break-all',
            },
            dataset: { testid: `agy-mcp-endpoint-${name}`, agyNoTranslate: 'true' },
          },
          summaryText
        ),
      ];

      if (spec.description) {
        cardChildren.push(
          h(doc, 'div', { style: { fontSize: '12px' } }, redactSensitiveText(String(spec.description)))
        );
      }

      container.appendChild(
        h(
          doc,
          'article',
          {
            className: 'agy-mcp-card',
            dataset: {
              testid: `agy-mcp-server-card-${name}`,
              serverName: name,
            },
          },
          ...cardChildren
        )
      );
    }
  });
}

module.exports = {
  renderServerCardList,
};
