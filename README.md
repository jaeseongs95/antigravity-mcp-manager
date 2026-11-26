# Antigravity MCP Manager (`v4.3.0`)

[한국어 문서 (README.ko.md)](./README.ko.md)

A safe, vendor-independent **MCP Server Manager** built on the [**Extenra**](https://github.com/jaeseongs95/extenra) (`extenra`, formerly `antigravity-addons`) **`v3.3.0+`** API-First framework (`AddonManifest.v3` + `AddonContextV3`, minimal ISP `permissions`, 3-Tier host UI, zero runtime dependencies):
- **Antigravity Desktop (`ctx.env.surface === 'desktop'`)**:
  - **Customizations → MCP Servers Header Button**: Zero-DOM `ui.registerSectionAction({ target: 'customizations.mcp-servers.header' })` places an `MCP Manager` / `MCP 매니저` action button directly beside the native header icons (auto-reattaching across SPA navigation).
  - **Inline Desktop Settings Page**: `ui.registerSettingsPage` (no extra Desktop statusbar button) with live `~/.gemini/config/mcp_config.json` CRUD via `permissions.configBridge.scopes` + `ctx.configBridge`.
- **Antigravity Remote Web (`ctx.env.surface === 'remote-web'`)**:
  - **Customizations Header Action + Bottom-Right Status Item + Unified Remote Host Bridge**: Pair once in `Addons → Host Bridge` (`ag-bridge-v1:...`) to transparently route `ctx.configBridge` to your Desktop `mcp_config.json` with automatic reload on `host:remote-bridge-changed` — zero plugin-owned URL/token inputs or standalone remote servers.
  - **Offline Remote Draft (`ctx.storage`)**: 1-click public HTTPS modular `@require` Userscript (`antigravity-mcp-manager.user.js`, `@require https://github.com/jaeseongs95/extenra/releases/latest/download/antigravity-remote-host.lib.js`) with browser-local `ctx.storage` draft persistence (`remote-draft:v1`) + **Import JSON / Copy JSON / Download `mcp_config.json`**.

> **API-First 3-Tier Architecture · Extenra `v3.3.0` Alignment**: All UI runs strictly through host-managed `AddonContextV3` surfaces (`ui.registerSectionAction`, `ui.registerSettingsPage`, Remote-Web-scoped `ui.registerStatusItem`, `ui.registerCommand`, `ui.showToast`, `ui.openPanel`, `ui.openModal`, `ui.createStyleElementSafe`, `i18n.onDidChange`) using Extenra `v3.2.1+` `--ag-*` design tokens and custom rounded scrollbars.

## 3-Tier UI & Minimal Permissions
- **Declared `permissions` (Least Privilege)**:
  - `$schema`: `https://github.com/jaeseongs95/extenra/schemas/addon-manifest.v3.schema.json`
  - `permissions.ui`: `toasts`, `dialogs`, `overlays`, `commands`, `statusItems`, `sectionActions`, `settingsPages`, `canvas`
  - `permissions.storage`: `namespace: "antigravity-mcp-manager"`, `maxBytes: 262144`
  - `permissions.events`: `subscribe: ["host:remote-bridge-changed"]`
  - `permissions.configBridge.scopes`:
    - `antigravity:mcp-config` (`rw`, `262144` bytes) — sole canonical write target (`~/.gemini/config/mcp_config.json`)
    - `antigravity:plugin-mcp-configs` (`ro`, `262144` bytes) — read-only plugin MCP inventory
    - `antigravity:mcp-config-legacy` (`ro`, `262144` bytes) — read-only 1-time legacy import preview
  - **Strictly Omitted**: `net`, `dom`, `secrets`, `services`, `uiSlots` (`ctx.net === undefined`, `ctx.dom === undefined` at runtime).
- **Tier 1 (Zero-DOM Host Surfaces)**:
  - `ui.registerSectionAction`: Mounts `MCP Manager` / `MCP 매니저` on `customizations.mcp-servers.header` (Customizations → MCP Servers header bar) opening the Full Editor Modal, synced live with `ctx.i18n.onDidChange`.
  - `ui.registerSettingsPage`: Inline Desktop Settings Page (`id: "mcp-manager"`) and Remote Web Settings Page, with `ctx.i18n.getLocale()` default language (`ko` on Korean locale) and saved `ctx.storage` override.
  - `ui.registerStatusItem`: Registered on Remote Web (`surface === 'remote-web'`) only, showing live server count or `!` when Host Bridge is disconnected.
  - `ui.registerCommand`: `open-mcp-manager`, `open-mcp-panel`, `open-mcp-settings`.
  - `ui.showToast` / `ui.confirm`: Locale-aware compact notifications on toggle, copy, and download.
- **Tier 2 (Declarative Host Panel + `PlacementSpec`)**:
  - `ui.openPanel({ placement: { zone: 'drawer', side: 'right', width: 420 } })` using the 16 closed declarative primitives with `handle.update(nextTree, nextState)` ID-based in-place patching and automatic mobile bottom-sheet transition at `<= 640px`.
  - Quick enable/disable toggles, live server summary, Host Bridge pairing guidance, language switcher (`en`/`ko`), and 1-click launch into the Full Editor.
- **Tier 3 (Host Shadow DOM Canvas)**:
  - `ui.openModal({ placement: { zone: 'surface-center', surface: 'auto', width: 820, maxHeight: 720 } })` & inline Settings Page `render(canvasRoot)` mount `NativeMcpPanel` styled via `ctx.ui.createStyleElementSafe(buildNativePanelCss())` using Extenra `v3.2.1` `--ag-*` semantic tokens.
  - Full Global CRUD, authoritative on-disk SHA-256 CAS (CRLF-safe), masked secret preservation, Stdio confirmation gate, Declarative Smart Paste, Raw JSON CAS conflict recovery, Read-Only Plugin Clone-to-Global, Legacy import, and Remote Web JSON Import/Copy/Download.

## Architecture (SOLID & Vendor-Independent)
- `addon-manifest.json`: Extenra `AddonManifest.v3` (`$schema`, `schemaVersion: 3`, `apiVersion: 3`, `version: "4.2.0"`, `minHostVersion: "3.1.0"`).
- `src/adapters/antigravity/renderer/*.mjs` → `src/adapters/antigravity/addon-renderer.js`:
  - `host-config-store.mjs`: `ConfigStorePort` over `ctx.configBridge` with non-crashing `ERR_REMOTE_HOST_NOT_CONNECTED` handling.
  - `storage-draft-config-store.mjs`: `ConfigStorePort` over `ctx.storage` (`hasConfigBridge === false`) with UTF-8 SHA-256 CAS.
  - `host-runtime.mjs`: `AddonContextV3` capability adapter (`ctx.env.surface`, `ctx.env.layoutMode`, `ctx.env.capabilities.hasConfigBridge`, `ctx.env.capabilities.hasRemoteHostBridge`, `ctx.events`, `ctx.storage`, `ctx.i18n`, `ctx.theme`, `ctx.lifecycle`).
  - `addon-styles.mjs`: Extenra `v3.2.1` `--ag-*` tokenized CSS with thin custom scrollbars and `prefers-reduced-motion` support for `ctx.ui.createStyleElementSafe(...)`.
  - `native-mcp-panel.mjs`: Zero-unsafe-sink full CRUD panel compatible with both Chromium and `@extenra/sdk` `createTestHost`.
  - `mcp-v3-shell.mjs`: 3-Tier API-First coordinator with `ctx.lifecycle.signal` / `onDispose` cleanup.
- `scripts/build-renderer.mjs` & `scripts/build-userscript.mjs`: Zero-dependency deterministic builders (supporting Extenra `@namespace`, `@require`, and optional `#sha256=` SRI pinning).
- `src/core/**`: 100% vendor-independent pure ESM domain logic.

## Install, Register & Trust Approve (Antigravity Desktop via Extenra `v3.1.0+` / `v3.2.1`)
1. Upgrade [**Extenra**](https://github.com/jaeseongs95/extenra) to **`v3.2.1+`** (`extenra --upgrade`, backward-compatible alias `addon-host --upgrade`).
2. Close Antigravity Desktop and mirror this repository into `~/.gemini/config/plugins/antigravity-mcp-manager/` (excluding `.git` and `node_modules`).
3. Validate, register, approve SHA-256 trust pin, and verify:
   ```bash
   extenra --validate ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   extenra --register ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   extenra trust approve antigravity-mcp-manager
   extenra --doctor
   ```

## Remote Web Install (Extenra `v3.2.1` Public HTTPS `@require` Userscript)
1. Install Violentmonkey / Tampermonkey (Desktop) or Userscripts (iOS/iPadOS Safari), or use the Extenra 1-Click Hub.
2. Install `antigravity-mcp-manager.user.js` from the latest GitHub Release or build locally via `npm run build:userscript`.
3. Open `https://antigravity.google.com/` and launch MCP Manager from the bottom-right `MCP` statusbar item, Settings Page, or Quick Actions. To edit your live Desktop `mcp_config.json`, pair once in **Addons → Host Bridge**.

## Development & Tests
```bash
npm run build:renderer
npm run check:userscript
npm test
```
Runs unit, core-purity, `AddonManifest.v3` minimal-permission parity, `@extenra/sdk` `createTestHost({ surface: 'desktop' })` + `createTestHost({ surface: 'remote-web', remoteBridgeConnected: true | false })` parity (`NMCP-TC-037`–`NMCP-TC-041`), FS write-jail/CAS, HTTP security, EN/KO `I18N` parity, and real Headless Chromium/Edge CDP E2E tests (`NMCP-TC-001`–`NMCP-TC-041`) on Node 22+.
