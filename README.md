# Antigravity Custom MCP Server Manager (`antigravity-mcp-manager`)

[한국어 문서 (README.ko.md)](./README.ko.md)

Add, edit, authenticate (OAuth / Bearer / API Key / Basic), toggle, and manage **Custom MCP Servers** (remote OAuth MCP portals/servers and local `Stdio` processes like `npx`, `uvx`, `node`, `python`, `docker`) directly inside the **Google Antigravity 2.0 Native Desktop App** without restarting.

---

## Key Features (`v1.3.0`)

- **Native `Settings` Sidebar `"MCP 서버"` Tab Integration**:
  - Injects a dedicated **`"MCP 서버"` (`settings-nav-item-McpManager`)** tab into Antigravity's native Settings modal (`.settings-modal-container`) right below the `"한글 번역"` (`KoTranslator`) / `"Models"` tab.
  - Clicking `"MCP 서버"` renders a full management page inside the Settings modal with `⚡ Quick Auto-Add`, `+ 사용자 지정 MCP 서버 추가`, `⚙️ 서버 설정 수정`, `🔗 OAuth 연결 ↗`, and `{ } mcp_config.json 편집`.
- **OAuth-First Custom MCP Registration & Auto `<ServerName> 연결 ↗` Modal**:
  - Simply enter your MCP portal/server URL. Antigravity's internal Language Server automatically runs RFC 9728 / RFC 8414 OAuth discovery (`/.well-known/oauth-protected-resource` & `/.well-known/oauth-authorization-server`).
  - As soon as `state.authUrl` is detected, `antigravity-mcp-manager` automatically opens the **`<ServerName> 연결` OAuth Connect Modal** (`<ServerName> 연결 ↗` button) to launch browser OAuth login and polls until connected.
- **ChatGPT-Style `사용자 지정 MCP 서버 추가` / `설정 수정` Modal**:
  - **이름 (`Server Name`)** & **설명 (`선택 사항` / `Description`)**
  - **연결 (`Connection`)**: `[ 서버 URL | 로컬 / 터널 (Stdio) ]` segmented toggle (defaults to `서버 URL`)
  - **인증 (`Authentication`)**: Defaults to **`OAuth`**, with **`인증 없음 (No Authentication)`**, **`OAuth 또는 인증 없음`**, plus optional Bearer Token, API Key Header, and Basic Auth.
  - **고급 OAuth 설정 (`Advanced OAuth Settings`) >**: Collapsible accordion supporting Automatic Discovery / Dynamic Registration or Custom `Client ID`, `Client Secret`, and `Scopes`.
- **Native Customizations & Add MCP Screen Integration**:
  - Keeps the bottom status bar completely untouched while adding `+ 커스텀 MCP`, `⚙️ 설정 수정`, and per-server `🔗 OAuth 연결 / 인증` buttons inside `[data-testid="add-mcp-button"]`, `[data-testid="add-mcp-screen"]`, and `[data-testid="mcp-server-row"]`.
- **Zero-Restart Hot Reload & Per-Tool Toggle (`disabledTools`)**:
  - Calls `refreshMcpServers({ shallow: false })` immediately after saving `~/.gemini/config/mcp_config.json`.

---

## Quick Start

```bash
git clone https://github.com/jaeseongs95/antigravity-mcp-manager.git
cd antigravity-mcp-manager
npm test
npm run install-mcp-manager
```

---

## Project Structure

- `src/mcp-config-schema.js`: Preset templates, `Stdio`/`HTTP` & `OAuth` spec validation, and `mcp_config.json` normalization.
- `src/host-mcp-bridge.js`: React Fiber host service discovery, OAuth discovery polling (`waitForServerOAuthOrReady`), and RPC calls (`readFile`, `writeFile`, `getMcpServerStates`, `refreshMcpServers`, `toggleMcpServer`, `completeMcpOAuth`, `disconnectMcpOAuth`).
- `src/modal-ui.js`: Trusted-Types-safe DOM modals (`사용자 지정 MCP 서버 추가 / 설정 수정`, `<ServerName> 연결` OAuth Connect Modal, Settings pane renderer, and Raw JSON editor).
- `src/index.js`: Native Settings modal `"MCP 서버"` sidebar tab integration, `Customizations` / `Add MCP Server` screen button injection, and `Ctrl+Shift+M` shortcut.
- `scripts/build.js`: Zero-dependency bundler generating `dist/mcp_manager_autoinject.js`.
- `scripts/install.js`: Idempotent installer and live CDP injector.
