# Antigravity Custom MCP Server Manager (`antigravity-mcp-manager`)

[한국어 문서 (README.ko.md)](./README.ko.md)

Add, edit, toggle, and manage **Custom MCP Servers** (local `Stdio` processes like `npx`, `uvx`, `node`, `python`, `docker` and remote `Streamable HTTP` endpoints) directly inside the **Google Antigravity 2.0 Native Desktop App** without restarting.

---

## Why This Exists

In Antigravity 2.0 Desktop, the built-in **Add MCP Server** screen (`Customizations` -> `MCP Servers`) only searches the official plugin catalog (`getAvailableCascadePlugins`).

However, Antigravity's internal Language Server and host bridge natively support `~/.gemini/config/mcp_config.json` and expose live RPC methods (`readFile`, `writeFile`, `getMcpServerStates`, `refreshMcpServers`, `toggleMcpServer`).

`antigravity-mcp-manager` integrates directly into Antigravity's native **Customizations -> MCP Servers** and **Add MCP Server** views (without cluttering the bottom status bar):
- **Native Customizations & Add MCP Screen Integration**: Automatically adds **+ Custom MCP**, **⚙️ Edit Custom MCP**, and per-server **🔑 Authenticate** / **⚙️ Edit Settings** buttons into Antigravity's native `[data-testid="add-mcp-button"]`, `[data-testid="add-mcp-screen"]`, and `[data-testid="mcp-server-row"]` items.
- **Dedicated Edit & Auth Popup (`⚙️ Edit Custom MCP Server & Authentication`)**: Click `⚙️ Edit Settings` or `🔑 Authenticate` on any server row (including right next to `Fix with Agent` on `Unauthorized` errors) to open a focused popup modal for editing server settings and configuring authentication.
- **Full MCP Authentication Support (`v1.2.0`)**:
  - **Bearer Token (`Authorization: Bearer <token>`)**, **API Key Header (`X-API-Key` or custom)**, **Basic Auth**, and **Native Host OAuth (`completeMcpOAuth` / `disconnectMcpOAuth`)**.
  - **Batch Authentication Apply**: Apply a single Bearer token or API Key header across all custom HTTP MCP servers in one click.
  - **Quick Auto-Add with Auth**: Enter a URL, GitHub/npm package, command, or JSON snippet along with an optional Bearer token / API Key in the `⚡ Quick Auto-Add` bar.
- **Keyboard Shortcut**: Press `Ctrl+Shift+M` (`Cmd+Shift+M` on macOS) anywhere in Antigravity to open the manager modal.
- **Zero-Restart Hot Reload**: Calls `refreshMcpServers({ shallow: false })` immediately after updating `mcp_config.json`.
- **Per-Tool Toggle (`disabledTools`)**: Click any tool chip on a custom server card to enable or disable individual MCP tools.
- **8 One-Click Quick Presets**: Filesystem, Memory, Fetch, GitHub, PostgreSQL, SQLite, Playwright, and Remote Streamable HTTP.
- **Raw `mcp_config.json` Editor**: Format, inspect, and directly edit `~/.gemini/config/mcp_config.json`.

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

- `src/mcp-config-schema.js`: Preset templates, `Stdio`/`HTTP` spec validation, and `mcp_config.json` normalization.
- `src/host-mcp-bridge.js`: React Fiber host service discovery and RPC calls (`readFile`, `writeFile`, `getMcpServerStates`, `refreshMcpServers`, `toggleMcpServer`).
- `src/modal-ui.js`: Trusted-Types-safe DOM modal (`Servers & Tools`, `+ Add / Edit Server`, `{ } Raw mcp_config.json`).
- `src/index.js`: Native `Customizations` / `Add MCP Server` screen button injection and `Ctrl+Shift+M` shortcut.
- `scripts/build.js`: Zero-dependency bundler generating `dist/mcp_manager_autoinject.js`.
- `scripts/install.js`: Idempotent installer and live CDP injector.
