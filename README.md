# Antigravity Custom MCP Server Manager (`antigravity-mcp-manager`)

[한국어 문서 (README.ko.md)](./README.ko.md)

Add, edit, authenticate (OAuth / Bearer / API Key / Basic), toggle, and manage **Custom MCP Servers** (remote OAuth MCP portals/servers and local `Stdio` processes like `npx`, `uvx`, `node`, `python`, `docker`) directly inside the **Google Antigravity 2.0 Native Desktop App** and **Remote Control Web (`https://antigravity.google.com/r/...`)** without restarting.

---

## Key Features (`v1.4.0`)

- **100% English Default UI + Automatic Korean Localization via `ko-thought-translator`**:
  - Built with clean English UI defaults (`MCP Servers`, `Add Custom MCP Server`, `Connect <ServerName> ↗`, `Advanced OAuth Settings`, etc.) for global users, and seamlessly localizes into Korean when the `ko-thought-translator` patch is active.
- **Native & Remote Control Web `Settings` Sidebar `"MCP Servers"` Tab**:
  - Injects a dedicated **`"MCP Servers"` (`settings-nav-item-McpManager`)** tab into Antigravity's Settings modal (`.settings-modal-container`) right below the `"Models"` / `"KoTranslator"` tab, both in the native desktop app and inside Remote Control web (`ga-remote-control iframe`).
  - Clicking `"MCP Servers"` renders a full management page inside the Settings modal with `⚡ Quick Auto-Add`, `+ Add Custom MCP Server`, `⚙️ Edit Server Settings`, `🔗 Connect <ServerName> ↗`, and `{ } Edit mcp_config.json`.
- **OAuth-First Custom MCP Registration & Auto `Connect <ServerName> ↗` Modal**:
  - Simply enter your MCP portal/server URL. Antigravity's Language Server automatically runs RFC 9728 / RFC 8414 OAuth discovery (`/.well-known/oauth-protected-resource` & `/.well-known/oauth-authorization-server`).
  - As soon as `state.authUrl` is detected, `antigravity-mcp-manager` automatically opens the **`Connect <ServerName>` OAuth Connect Modal** (`Connect <ServerName> ↗` button) and supports both automatic browser callback and manual authorization code submission (`completeMcpOAuth(serverName, code)`).
- **ChatGPT-Style `Add Custom MCP Server` / `Edit Custom MCP Server Settings` Modal**:
  - **Name** & **Description (Optional)**
  - **Connection**: `[ Server URL | Local / Tunnel (Stdio) ]` segmented toggle (defaults to `Server URL`)
  - **Authentication**: Defaults to **`OAuth`**, with **`No Authentication`**, **`OAuth or No Authentication`**, plus optional Bearer Token, API Key Header, and Basic Auth.
  - **Advanced OAuth Settings >**: Collapsible accordion supporting Automatic Discovery & Dynamic Client Registration or Custom `Client ID`, `Client Secret`, and `Default Scopes`.
- **Native & Remote Web Customizations (`MCP Servers`) Integration + One-Click Bookmarklet Chaining**:
  - Injects `+ Custom MCP`, `⚙️ Edit Settings`, and per-server `🔗 Connect OAuth / Auth` buttons into `[data-testid="add-mcp-button"]`, `[data-testid="add-mcp-screen"]`, and `[data-testid="mcp-server-row"]`.
  - Automatically loads alongside `antigravity-statusbar` and `ko-thought-translator` when clicking your Remote Control bookmarklet on `https://antigravity.google.com/r/...`.

---

## Quick Start

```bash
git clone https://github.com/jaeseongs95/antigravity-mcp-manager.git
cd antigravity-mcp-manager
npm test
npm run install-mcp-manager
```

### Remote Control Web Bookmarklet (`https://antigravity.google.com/r/...`)

```javascript
javascript:(()=>{fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js?t='+Date.now()).then(r=>r.text()).then(c=>{const s=document.createElement('script'),n=document.querySelector('script[nonce]')?.nonce,p=window.trustedTypes?.createPolicy('agy-mcp-'+Date.now(),{createScript:x=>x});if(n)s.nonce=n;s.text=p?p.createScript(c):c;document.head.appendChild(s)})})();
```

---

## Project Structure

- `src/mcp-config-schema.js`: Preset templates, `Stdio`/`HTTP` & `OAuth` spec validation, and `mcp_config.json` normalization.
- `src/host-mcp-bridge.js`: React Fiber & Remote Control (`proxyCommand`) host service discovery, OAuth discovery polling (`waitForServerOAuthOrReady`), and RPC calls (`readFile`, `writeFile`, `getMcpServerStates`, `refreshMcpServers`, `toggleMcpServer`, `completeMcpOAuth(serverName, code)`, `disconnectMcpOAuth(serverName, account)`).
- `src/modal-ui.js`: Trusted-Types-safe DOM modals (`Add / Edit Custom MCP Server`, `Connect <ServerName>` OAuth Connect Modal, Settings pane renderer, and Raw JSON editor).
- `src/index.js`: Native & Remote iframe Settings modal `"MCP Servers"` sidebar tab integration, `Customizations` / `Add MCP Server` screen button injection, and `Ctrl+Shift+M` shortcut.
- `scripts/build.js`: Zero-dependency bundler generating `dist/mcp_manager_autoinject.js`.
- `scripts/install.js`: Idempotent installer and live CDP injector.
