# Antigravity MCP Manager (`v3.0.0`)

[한국어 문서 (README.ko.md)](./README.ko.md)

A safe, vendor-independent **MCP Server Manager** for **Antigravity 2.0 Native Desktop App**, built as a zero-dependency **`AddonManifest.v1`** plugin hosted by [`antigravity-native-addon-host`](https://github.com/jaeseongs95/antigravity-native-addon-host) (`v1.0.1+`) alongside an official **`AUX_PANE` UI Sidecar** (`plugin.json` + `sidecars/mcp_manager/sidecar.json`).

> **Zero `app.asar` Patching & Strict Plugin Isolation**: `antigravity-mcp-manager` never patches, backs up, or touches `app.asar` and carries zero runtime npm dependencies. All native desktop integration runs through `antigravity-native-addon-host`'s `AddonManifest.v1` contract (`addonHost.mountSlot`, `addonHost.injectStyle`, `addonHost.onDispose`, Isolated World `999` execution, and automatic `translate="no"` / `data-addon-host-owner` isolation).

## Features
- **Settings Left-Sidebar & Customizations Integration (`AddonManifest.v1`)**:
  - Mounts **MCP Manager** directly under **Browser** (or Korean **브라우저**) in Antigravity **Settings** with 0px layout shift and preserved top-right `✕` close control.
  - Mounts an **MCP Manager** (`MCP 매니저` in KO) button in **Customizations → MCP Servers** right before the native `[]` / `+` action icons, opening a full-pane dialog overlay (`← Back to Customizations`, `✕`, `Esc` focus-restoring close).
  - Cleanly unmounts all slots, styles, listeners, and the local loopback server immediately on `dispose()` when disabled or unregistered.
- **Built-In `EN | 한국어` Toggle**: Instant English/Korean switching inside the UI without iframe reload, persisted under the plugin's `storageNamespace` (`antigravity-mcp-manager:lang`, with automatic 1-time migration from v2.1's `agy-mcp-manager-lang`).
- **Single Canonical Write Scope**: Reads and writes only `~/.gemini/config/mcp_config.json` with mandatory SHA-256 CAS (`409 Conflict` protection), advisory file lock, private backups outside `plugins/` (`~/.gemini/config/.mcp-manager-backups/`), and same-filesystem atomic replace (`fsync` + `rename`).
- **Read-Only Plugin Inventory & Live Status**: Displays global and workspace `.agents/plugins/*/mcp_config.json` entries with plugin badges, collision warnings, safe server-side **Clone to Global**, and read-only loopback Language Server status (`GetMcpServerStates`, `GetAllPlugins`).
- **Declarative Smart Paste & Security First**: Parses `mcpServers` JSON and Streamable HTTP URLs, normalizes `serverUrl` → `url`, detects legacy `/sse` with an editable `mcp-remote` Stdio preview, blocks dangerous env keys and non-loopback cleartext credentials, enforces explicit Stdio confirmation (`428`), and fails closed on malformed JSON with Raw JSON recovery + backup restore.

## Architecture (SOLID & Vendor-Independent)
- `addon-manifest.json`: Declarative `AddonManifest.v1` contract (`capabilities: ["mainHook", "renderer"]`, 4 non-exclusive `addon-owned-slot` entries, `storageNamespace: "antigravity-mcp-manager"`, `ipcChannelPrefix: "mcp-manager:"`, `loadOrder: 60`).
- `scripts/electron-hook.cjs`: `AddonManifest.v1` `mainHook` (`activate`, `onWebContentsCreated`, `dispose`) managing `desktop-server.mjs` and pushing the tokenized loopback URL strictly into Isolated World `999` after re-verifying `isAllowedRendererUrl(contents.getURL())`.
- `src/adapters/antigravity/renderer/*.mjs` → `src/adapters/antigravity/addon-renderer.js`: SOLID SRP/OCP/LSP/ISP/DIP renderer modules (`host-runtime`, `addon-styles`, `settings-sidebar-mount`, `customizations-mount`, `mount-coordinator`) deterministically assembled by `scripts/build-renderer.mjs` with zero external dependencies and zero unsafe DOM sinks.
- `src/core/**`: 100% vendor-independent pure ESM domain logic (zero Node/DOM/Sidecar/host dependencies).
- `src/adapters/fs-config-store.mjs`, `src/adapters/antigravity/**`, `src/adapters/sidecar/http-app.mjs`, `sidecars/mcp_manager/**`: Write-jailed FS store, loopback-only LS inspector, hardened HTTP security middleware, and official `AUX_PANE` UI Sidecar.

## Install & Register (via `antigravity-native-addon-host` v1.0.1+)
1. Ensure [`antigravity-native-addon-host`](https://github.com/jaeseongs95/antigravity-native-addon-host) (`v1.0.1+`) is installed on your Antigravity Desktop (`addon-host --install`).
2. Place this repository under `~/.gemini/config/plugins/antigravity-mcp-manager/` (zero runtime dependencies to install).
3. Validate and register `addon-manifest.json` with the shared addon host:
   ```bash
   addon-host --validate ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   addon-host --register ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   ```
4. Reload (`Ctrl + R`) or restart Antigravity Desktop and use **Settings → MCP Manager** or **Customizations → MCP Servers → MCP Manager**.
5. To unregister cleanly anytime:
   ```bash
   addon-host --unregister antigravity-mcp-manager
   ```

## Migrating from v2.1.x (Direct `app.asar` Hook Removal)
`v3.0.0` removes `scripts/install-settings-menu.mjs` and the `@electron/asar` dependency completely:
1. If you previously ran `npm run install:settings` in `v2.1.x`, remove the legacy direct patch via `antigravity-native-addon-host`:
   ```bash
   addon-host --install --replace-legacy
   ```
2. Update `~/.gemini/config/plugins/antigravity-mcp-manager/` to `v3.0.0`, remove stale `node_modules/`, and run `addon-host --register`.
3. Existing language preferences saved in `agy-mcp-manager-lang` are migrated automatically to `antigravity-mcp-manager:lang` on first open.

## Development & Tests
```bash
npm run build:renderer
npm test
```
Runs all 28 unit, core-purity, `AddonManifest.v1` contract/mainHook/SOLID parity, filesystem write-jail/symlink-junction/CAS, Sidecar & Desktop HTTP security, EN/KO `I18N` parity, and real Headless Chromium/Edge CDP E2E tests (`NMCP-TC-001`–`NMCP-TC-027`, `NMCP-TC-015B`, `NMCP-TC-020B`, `NMCP-TC-020C`, `NMCP-TC-024B`) on Node 22+.
