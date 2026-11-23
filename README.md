# Antigravity MCP Manager (`v3.0.0`)

[한국어 문서 (README.ko.md)](./README.ko.md)

A safe, vendor-independent **MCP Server Manager** for **Antigravity 2.0 Native Desktop App**, built as a zero-dependency **`AddonManifest.v2`** (`trustLevel: "restricted"`, `capabilities: ["renderer"]`) plugin hosted by [`antigravity-native-addon-host`](https://github.com/jaeseongs95/antigravity-native-addon-host) (`v2.0.0+`) alongside an official **`AUX_PANE` UI Sidecar** (`plugin.json` + `sidecars/mcp_manager/sidecar.json`).

> **Zero `app.asar` Patching · Zero `mainHook` · Zero Trust Escalation**: `antigravity-mcp-manager` never patches, backs up, or touches `app.asar`, carries zero runtime npm dependencies, and requires **no `trust approve`**. All native desktop UI integration runs strictly inside `antigravity-native-addon-host` v2.0.0+'s Isolated World `998` under `trustLevel: "restricted"` using Option B2 Shadow DOM (`addonHost.mountSlot(slotId, { container })`), `addonHost.openModal`, slot-scoped `addonHost.injectStyle`, `addonHost.addManagedListener`, and automatic `translate="no"` / `data-addon-host-no-translate` / `data-agy-no-translate` isolation.

## Features
- **Settings Left-Sidebar & Customizations Integration (`AddonManifest.v2`, World `998`)**:
  - Mounts **MCP Manager** directly under **Browser** (or Korean **브라우저**) in Antigravity **Settings** (`settings-nav` declared `shadow: false` for native Tailwind class inheritance with 0px layout shift; `pane` mounted inside open Shadow DOM Option B2 with preserved top-right `✕` close control).
  - Mounts an **MCP Manager** (`MCP 매니저` in KO) Shadow DOM button in **Customizations → MCP Servers** right before the native `[]` / `+` action icons, opening a native `<dialog>.showModal()` overlay via `addonHost.openModal` (`PortalArbiter`-coordinated, titlebar safe `marginTop` & `zIndex` preserved, `← Back to Customizations`, `✕`, capture-phase IME-safe `Esc` focus-restoring close).
  - Runs the official **Antigravity Native Sidecar (`AUX_PANE`)** as the canonical MCP management backend, rendering an interactive EN/KO Native Sidecar launcher/guide panel inside the Settings/Customizations Shadow DOM slots by default, and automatically upgrading to an embedded live panel if a host loopback `SidecarBridge` URL is provided.
  - Cleanly unmounts all slots, modals, styles, and listeners immediately on `dispose()` when disabled or unregistered.
- **Built-In `EN | 한국어` Toggle**: Instant English/Korean switching across both the Native Sidecar UI and the Settings/Customizations Shadow DOM slots without iframe reload, persisted under the plugin's `storageNamespace` (`antigravity-mcp-manager:lang`, with automatic 1-time migration from v2.1's `agy-mcp-manager-lang`).
- **Single Canonical Write Scope**: Reads and writes only `~/.gemini/config/mcp_config.json` with mandatory SHA-256 CAS (`409 Conflict` protection), advisory file lock, private backups outside `plugins/` (`~/.gemini/config/.mcp-manager-backups/`), and same-filesystem atomic replace (`fsync` + `rename`).
- **Read-Only Plugin Inventory & Live Status**: Displays global and workspace `.agents/plugins/*/mcp_config.json` entries with plugin badges, collision warnings, safe server-side **Clone to Global**, and read-only loopback Language Server status (`GetMcpServerStates`, `GetAllPlugins`).
- **Declarative Smart Paste & Security First**: Parses `mcpServers` JSON and Streamable HTTP URLs, normalizes `serverUrl` → `url`, detects legacy `/sse` with an editable `mcp-remote` Stdio preview, blocks dangerous env keys and non-loopback cleartext credentials, enforces explicit Stdio confirmation (`428`), and fails closed on malformed JSON with Raw JSON recovery + backup restore.

## Architecture (SOLID & Vendor-Independent)
- `addon-manifest.json`: Declarative `AddonManifest.v2` contract (`schemaVersion: 2`, `trustLevel: "restricted"`, `compatibility: { hostProfile: "antigravity-desktop", minHostVersion: "2.0.0" }`, `capabilities: ["renderer"]`, 4 non-exclusive `addon-owned-slot` entries with Shadow DOM Option B2 declarations, `storageNamespace: "antigravity-mcp-manager"`, `ipcChannelPrefix: "mcp-manager:"`, `loadOrder: 60`).
- `src/adapters/antigravity/renderer/*.mjs` → `src/adapters/antigravity/addon-renderer.js`: SOLID SRP/OCP/LSP/ISP/DIP renderer modules (`host-runtime`, `addon-styles`, `settings-sidebar-mount`, `customizations-mount`, `mount-coordinator`) deterministically assembled by `scripts/build-renderer.mjs` with zero external dependencies and zero unsafe DOM sinks.
- `src/core/**`: 100% vendor-independent pure ESM domain logic (zero Node/DOM/Sidecar/host dependencies).
- `src/adapters/fs-config-store.mjs`, `src/adapters/antigravity/**`, `src/adapters/sidecar/http-app.mjs`, `sidecars/mcp_manager/**`: Write-jailed FS store, loopback-only LS inspector, hardened HTTP security middleware, and official `AUX_PANE` UI Sidecar.

## Install & Register (via `antigravity-native-addon-host` v2.0.0+)
1. Ensure [`antigravity-native-addon-host`](https://github.com/jaeseongs95/antigravity-native-addon-host) (`v2.0.0+`, e.g. `v2.1.0`) is installed on your Antigravity Desktop (`addon-host --install`).
2. Place this repository under `~/.gemini/config/plugins/antigravity-mcp-manager/` (zero runtime dependencies to install).
3. Validate and register `addon-manifest.json` with the shared addon host (runs immediately in `restricted` mode — no `trust approve` needed):
   ```bash
   addon-host --validate ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   addon-host --register ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   addon-host --status
   ```
4. Reload (`Ctrl + R`) or restart Antigravity Desktop and use **MCP Manager** from Antigravity's **Native Sidecar (`AUX_PANE`)**, **Settings → MCP Manager**, or **Customizations → MCP Servers → MCP Manager**.
5. To unregister cleanly anytime:
   ```bash
   addon-host --unregister antigravity-mcp-manager
   ```

## Migrating from v2.1.x / v1 Host
`v3.0.0` removes `scripts/install-settings-menu.mjs`, `scripts/electron-hook.cjs`, and the `@electron/asar` dependency completely:
1. Upgrade [`antigravity-native-addon-host`](https://github.com/jaeseongs95/antigravity-native-addon-host) to `v2.0.0+` (use `addon-host --install --replace-legacy` if migrating from v2.1.x direct `app.asar` patching).
2. Update `~/.gemini/config/plugins/antigravity-mcp-manager/` to `v3.0.0`, remove stale `node_modules/`, and re-run `addon-host --register ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json`.
3. Existing language preferences saved in `agy-mcp-manager-lang` are migrated automatically to `antigravity-mcp-manager:lang` on first open.

## Development & Tests
```bash
npm run build:renderer
npm test
```
Runs all 28 unit, core-purity, `AddonManifest.v2` contract/SOLID parity, filesystem write-jail/symlink-junction/CAS, Sidecar & Desktop HTTP security, EN/KO `I18N` parity, and real Headless Chromium/Edge CDP E2E tests (`NMCP-TC-001`–`NMCP-TC-028`, `NMCP-TC-015B`, `NMCP-TC-020B`, `NMCP-TC-020C`) on Node 22+.
