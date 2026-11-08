# Antigravity Custom MCP Server Manager (`antigravity-mcp-manager` `v1.4.13`)

**Languages:** **English ([README.md](./README.md))** | **[한국어 (README.ko.md)](./README.ko.md)**

Add, edit, authenticate (`OAuth` / `Bearer` / `API Key` / `Basic`), toggle, and manage **Custom MCP Servers** (remote OAuth MCP portals/servers and local `Stdio` processes like `npx`, `uvx`, `node`, `python`, `docker`, `deno`, `bun`, `pnpx`) directly inside the **Google Antigravity 2.0 Native Desktop App** and **Remote Control Web (`https://antigravity.google.com/r/...`)** without restarting the app.

---

## Table of Contents

1. [Overview & Key Features](#overview--key-features)
2. [Desktop App Installation (Local PC)](#desktop-app-installation-local-pc)
3. [Remote Control Web Guide (Bookmarklet & UserScript)](#remote-control-web-guide-bookmarklet--userscript)
4. [UI Entry Points & Keyboard Shortcut](#ui-entry-points--keyboard-shortcut)
5. [OAuth & Custom MCP Server Configuration Guide](#oauth--custom-mcp-server-configuration-guide)
6. [Host-Aware Companion Plugin Auto-Loader](#host-aware-companion-plugin-auto-loader)
7. [Repository Structure](#repository-structure)
8. [Verification & Testing](#verification--testing)

---

## Overview & Key Features

- **Native & Remote Control Web `Settings` Sidebar `"MCP Servers"` Tab**:
  - Injects a dedicated **`"MCP Servers"` (`settings-nav-item-McpManager`)** tab into Antigravity's Settings modal (`.settings-modal-container`) right below the `"Models"` / `"KoTranslator"` tab—both in the native desktop app and inside Remote Control web (`ga-remote-control iframe`).
  - Clicking `"MCP Servers"` renders a full management dashboard inside the Settings modal with real-time status banners (`.agy-mcp-status-banner`), `⚡ Quick Auto-Add`, `+ Add Custom MCP Server`, `⚙️ Edit Server Settings`, `🔗 Connect <ServerName> ↗`, per-tool toggles, and `{ } Edit mcp_config.json`.
- **OAuth-First Custom MCP Registration & Auto `Connect <ServerName> ↗` Modal**:
  - Enter your remote MCP portal/server URL. Antigravity's `language_server.exe` runs RFC 9728 / RFC 8414 OAuth discovery (`/.well-known/oauth-protected-resource` & `/.well-known/oauth-authorization-server`).
  - As soon as `state.authUrl` is detected, `antigravity-mcp-manager` automatically opens the **`Connect <ServerName>` OAuth Connect Modal** (`Connect <ServerName> ↗` button) and supports both automatic browser callback and manual authorization code / callback URL submission (`completeMcpOAuth(serverName, code)`).
- **Smart Auto-Parser (`⚡ Quick Auto-Add`)**:
  - Paste a remote MCP URL, a `curl -H "Authorization: ..."` command, a full `mcp_config.json` snippet, or a local `Stdio` command (`npx`, `uvx`, `node`, `python`, `docker`, `deno`, `bun`, `pnpx`, etc.—including Stdio commands with URL arguments) and click **`Auto-Add & Connect`** or **`Auto-Fill Form`**.
- **Verified Host `mcp_config.json` Persistence**:
  - Resolves `~/.gemini/config/mcp_config.json` via live server states, React Fiber `selectedGeminiDir`, `GetLocalUserInfo` (`homeDirUri`), and `GetCustomizationStates` fallbacks so even fresh zero-server installations persist reliably via `LanguageServerService.writeFile`.
- **100% English Default UI + Automatic Korean Localization via `ko-thought-translator`**:
  - Ships with clean English UI defaults (`MCP Servers`, `Add Custom MCP Server`, `Connect <ServerName> ↗`, `Advanced OAuth Settings`, etc.) and automatically localizes into Korean when `ko-thought-translator` is active.
- **StandaloneZero-Offset `app.asar` Patcher & Host-Aware Remote Companion Loader**:
  - Includes its own `scripts/ensure_statusbar_patch.js` so it works standalone (1 plugin only) or alongside `antigravity-statusbar` and `ko-thought-translator` (2 or 3 plugins).

---

## Desktop App Installation (Local PC)

```bash
git clone https://github.com/jaeseongs95/antigravity-mcp-manager.git
cd antigravity-mcp-manager

# 1. Run unit & bundle integration tests (16/16 tests)
npm test

# 2. Build dist/mcp_manager_autoinject.js, install to ~/.gemini/antigravity, patch app.asar & live-inject via CDP
npm run install-mcp-manager

# 3. Check ASAR patch & live CDP injection status
npm run status
```

---

## Remote Control Web Guide (Bookmarklet & UserScript)

When accessing your Antigravity session remotely via **`https://antigravity.google.com/r/...`** on a desktop browser, tablet, or mobile phone (Chrome / Safari / Edge), local Electron `preload.js` files do not run on the remote client browser. You can activate `antigravity-mcp-manager` (plus any companion plugins installed on your host PC) with **one tap using a Bookmarklet** or **automatically using Tampermonkey / AdGuard**.

### Method 1: One-Tap Bookmarklet (Recommended for Mobile & Desktop Chrome)

Copy the single-line JavaScript code below and save it as the **URL** of a browser bookmark:

```javascript
javascript:(()=>{fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js?t='+Date.now()).then(r=>r.text()).then(c=>{const s=document.createElement('script'),n=document.querySelector('script[nonce]')?.nonce,p=window.trustedTypes?.createPolicy('agy-mcp-'+Date.now(),{createScript:x=>x});if(n)s.nonce=n;s.text=p?p.createScript(c):c;document.head.appendChild(s)})})();
```

#### How to Add & Run on Desktop Chrome / Edge / Brave
1. Press `Ctrl+Shift+O` (Bookmark Manager) or right-click your **Bookmarks Bar** and click **Add page...** (or **Add bookmark**).
2. Set **Name** to `AGY MCP Manager` (or any name you prefer).
3. Paste the `javascript:(()=>{...})();` code above into the **URL** field and click **Save**.
4. Open your Antigravity Remote Control web session (`https://antigravity.google.com/r/...`) and click the **`AGY MCP Manager`** bookmark once.
5. The `"MCP Servers"` tab in Settings and `+ Custom MCP` buttons in Customizations will immediately activate, and any companion plugins installed on your host PC (`antigravity-statusbar`, `ko-thought-translator`) will automatically load together.

#### How to Add & Run on Mobile Chrome (Android / iOS)
1. Bookmark any page in Mobile Chrome, then tap **Edit** on that bookmark.
2. Change the **Name** to `AGY MCP Manager` and replace the **URL** with the `javascript:(()=>{...})();` code above.
3. On your `https://antigravity.google.com/r/...` tab, tap the **address bar**, type `AGY MCP Manager`, and tap the bookmark entry that appears with the ⭐ icon. *(Note: On mobile Chrome, tapping a `javascript:` bookmarklet from the address bar suggestions executes it in the current tab.)*

### Method 2: Automatic UserScript (Tampermonkey / Violentmonkey / AdGuard)

`dist/mcp_manager_autoinject.js` includes a standard `// ==UserScript==` metadata block matching `https://antigravity.google.com/*`:

1. Open your UserScript manager dashboard (e.g., Tampermonkey -> **Utilities** -> **Install from URL**).
2. Enter the raw bundle URL:
   ```text
   https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js
   ```
3. Click **Install**. `antigravity-mcp-manager` and any host-installed companion plugins will now inject automatically whenever you open `https://antigravity.google.com/r/...`.

---

## UI Entry Points & Keyboard Shortcut

| Entry Point | How to Open | Features Available |
| :--- | :--- | :--- |
| **Settings Modal -> `"MCP Servers"` Tab** | Open Antigravity `Settings` (`⚙️`) -> Click **`MCP Servers`** (`MCP 서버`) in the left sidebar | Embedded management pane with `⚡ Quick Auto-Add`, server cards, OAuth connect, tool toggles, and raw JSON editor. |
| **Customizations -> `MCP Servers` Section** | Open `Customizations` -> `MCP Servers` | Click **`+ Custom MCP`** in the header or **`⚙️ Edit Settings`** / **`🔗 Connect OAuth`** on individual server rows. |
| **Standalone Manager Modal (`Ctrl+Alt+M`)** | Press **`Ctrl+Alt+M`** anywhere in the app | Opens the full standalone Custom MCP Server Manager modal directly (uses `Ctrl+Alt+M` so VS Code's native `Ctrl+Shift+M` Problems shortcut is preserved). |

---

## OAuth & Custom MCP Server Configuration Guide

1. **Remote OAuth MCP Server (`Server URL` + `OAuth`)**:
   - Click **`+ Add Custom MCP Server`** (or paste the URL into **`⚡ Quick Auto-Add`**).
   - Select **`Server URL`**, enter the Name and URL, and leave Authentication set to **`OAuth`** (default).
   - Optional: Expand **`Advanced OAuth Settings >`** if your server requires a static `Client ID`, `Client Secret`, or custom `Default Scopes`.
   - Click **`Save & Apply`**. When the **`Connect <ServerName>`** modal pops up, click **`Connect <ServerName> ↗`** to authenticate in your browser, or paste the callback URL / authorization code directly if using a remote browser.
2. **Remote Bearer / API Key / Basic Auth Server**:
   - Select **`Server URL`**, choose **`Bearer Token`**, **`API Key Header`**, or **`Basic Auth`**, and enter your token/credentials.
3. **Local / Tunnel `Stdio` MCP Server (`npx`, `uvx`, `node`, `python`, `docker`, `deno`, `bun`, `pnpx`)**:
   - Switch Connection to **`Local / Tunnel (Stdio)`** (or paste the full command into **`⚡ Quick Auto-Add`** and click **`Auto-Fill Form`**).
   - Configure Command, Arguments, and Environment Variables (`KEY=VALUE`), then click **`Save & Apply`**.

---

## Host-Aware Companion Plugin Auto-Loader

When you run the `antigravity-mcp-manager` bookmarklet on Remote Control web (`https://antigravity.google.com/r/...`), it inspects the host PC via `LanguageServerService` (`GetCustomizationStates` / `GetAllSkills` / `ReadFile` on `~/.gemini/antigravity/statusbar_autoinject.js`):

- **Standalone Host Installation (`antigravity-mcp-manager` only)**: Loads only `antigravity-mcp-manager` without pulling uninstalled scripts.
- **Multi-Plugin Host Installation (with `antigravity-statusbar` and/or `ko-thought-translator`)**: Automatically loads the companion plugins installed on your host PC (with TrustedTypes multi-policy + Blob URL fallback and offline host-bundle extraction).

---

## Repository Structure

```text
antigravity-mcp-manager/
├── src/
│   ├── index.js                   # Settings sidebar tab, Customizations button injection, Ctrl+Alt+M & companion loader
│   ├── host-mcp-bridge.js         # React Fiber & Remote proxyCommand RPC bridge, OAuth discovery & mcp_config.json I/O
│   ├── modal-ui.js                # Trusted-Types-safe modals (Add/Edit Server, OAuth Connect, Settings pane, Raw JSON)
│   └── mcp-config-schema.js       # Presets, Smart Auto-Parser (URL/curl/JSON/Stdio), OAuth & mcp_config.json schema
├── dist/
│   └── mcp_manager_autoinject.js  # Built single-file runtime bundle (with ==UserScript== header)
├── scripts/
│   ├── build.js                   # Zero-dependency CommonJS bundler (src/ -> dist/mcp_manager_autoinject.js)
│   ├── ensure_statusbar_patch.js  # Zero-offset ASAR patcher + app_storage sync + live CDP injector
│   └── install.js                 # Builds bundle, installs to ~/.gemini/antigravity & runs patcher
├── test/
│   └── mcp-manager.test.js        # Module unit tests + runtime bundle integration & regression tests
├── README.md                      # English documentation
├── README.ko.md                   # Korean documentation
└── package.json
```

---

## Verification & Testing

```bash
# Build dist/mcp_manager_autoinject.js and run all 16 unit + integration test suites
npm test
```

## License

MIT
