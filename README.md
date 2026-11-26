# Antigravity MCP Manager (`v4.0.0`)

[한국어 문서 (README.ko.md)](./README.ko.md)

A safe, vendor-independent **MCP Server Manager** built on the [`antigravity-addons`](https://github.com/jaeseongs95/antigravity-addons) **`v3.0.0+`** API-First framework (`AddonManifest.v3` + `AddonContextV3`, minimal ISP `permissions`, 3-Tier host UI, zero runtime dependencies):
- **Antigravity Desktop (`ctx.env.surface === 'desktop'`)**: Live `~/.gemini/config/mcp_config.json` CRUD via `permissions.configBridge.scopes` + `ctx.configBridge` (gated on `ctx.env.capabilities.hasConfigBridge`).
- **Antigravity Remote Web (`ctx.env.surface === 'remote-web'`)**: 1-click public HTTPS modular `@require` Userscript (`antigravity-mcp-manager.user.js`) with browser-local `ctx.storage` draft persistence (`remote-draft:v1`) + **Import JSON / Copy JSON / Download `mcp_config.json`**.

> **API-First 3-Tier Architecture · Zero Manual DOM Placement**: `v4.0.0` removes all legacy v2 host DOM scraping, manual coordinate math, `uiSlots`, `settingsBridge`, `hostProfileId` checks, and `window.localStorage` calls. All UI runs strictly through host-managed `AddonContextV3` surfaces (`ui.registerStatusItem`, `ui.registerSettingsPage`, `ui.registerCommand`, `ui.showToast`, `ui.openPanel`, `ui.openModal`, `ui.createStyleElementSafe`).

## 3-Tier UI & Minimal Permissions
- **Declared `permissions` (Least Privilege)**:
  - `permissions.ui`: `toasts`, `dialogs`, `overlays`, `commands`, `statusItems`, `settingsPages`, `canvas`
  - `permissions.storage`: `namespace: "antigravity-mcp-manager"`, `maxBytes: 262144`
  - `permissions.configBridge.scopes`:
    - `antigravity:mcp-config` (`rw`, `262144` bytes) — sole canonical write target (`~/.gemini/config/mcp_config.json`)
    - `antigravity:plugin-mcp-configs` (`ro`, `262144` bytes) — read-only plugin MCP inventory
    - `antigravity:mcp-config-legacy` (`ro`, `262144` bytes) — read-only 1-time legacy import preview
  - **Strictly Omitted**: `net`, `dom`, `events`, `services`, `uiSlots` (`ctx.net === undefined`, `ctx.dom === undefined` at runtime).
- **Tier 1 (Zero-DOM Host Surfaces)**:
  - `ui.registerStatusItem`: Statusbar `MCP` button with live server-count badge and tooltip.
  - `ui.registerSettingsPage`: Unified Desktop + Remote Web Settings Page (`id: "mcp-manager"`).
  - `ui.registerCommand`: `open-mcp-manager`, `open-mcp-panel`, `open-mcp-settings`.
  - `ui.showToast` / `ui.confirm`: Non-intrusive notifications on toggle, copy, and download.
- **Tier 2 (Declarative Host Panel + `PlacementSpec`)**:
  - `ui.openPanel({ placement: { zone: 'drawer', side: 'right', width: 420 } })` using the 16 closed declarative primitives with `handle.update(nextTree, nextState)` ID-based in-place patching and automatic mobile bottom-sheet transition at `<= 640px`.
  - Quick enable/disable toggles, live server summary, language switcher (`en`/`ko`), and 1-click launch into the Full Editor.
- **Tier 3 (Host Shadow DOM Canvas)**:
  - `ui.openModal({ placement: { zone: 'surface-center', surface: 'auto', width: 820, maxHeight: 720 } })` & Settings Page `render(canvasRoot)` mount `NativeMcpPanel` styled via `ctx.ui.createStyleElementSafe(buildNativePanelCss())` using `--ag-*` semantic theme tokens.
  - Full Global CRUD, authoritative on-disk SHA-256 CAS (CRLF-safe), masked secret preservation, Stdio confirmation gate, Declarative Smart Paste, Raw JSON CAS conflict recovery, Read-Only Plugin Clone-to-Global, Legacy import, and Remote Web JSON Import/Copy/Download.

## Architecture (SOLID & Vendor-Independent)
- `addon-manifest.json`: `AddonManifest.v3` (`schemaVersion: 3`, `apiVersion: 3`, `version: "4.0.0"`, `minHostVersion: "3.0.0"`).
- `src/adapters/antigravity/renderer/*.mjs` → `src/adapters/antigravity/addon-renderer.js`:
  - `host-config-store.mjs`: `ConfigStorePort` over `ctx.configBridge` (`hasConfigBridge === true`).
  - `storage-draft-config-store.mjs`: `ConfigStorePort` over `ctx.storage` (`hasConfigBridge === false`) with UTF-8 SHA-256 CAS.
  - `host-runtime.mjs`: `AddonContextV3` capability adapter (`ctx.env.surface`, `ctx.env.layoutMode`, `ctx.env.capabilities.hasConfigBridge`, `ctx.storage`, `ctx.i18n`, `ctx.theme`, `ctx.lifecycle`).
  - `addon-styles.mjs`: `--ag-*` tokenized CSS for `ctx.ui.createStyleElementSafe(...)`.
  - `native-mcp-panel.mjs`: Zero-unsafe-sink full CRUD panel compatible with both Chromium and `@antigravity-addons/sdk` `createTestHost`.
  - `mcp-v3-shell.mjs`: 3-Tier API-First coordinator with `ctx.lifecycle.signal` / `onDispose` cleanup.
- `scripts/build-renderer.mjs` & `scripts/build-userscript.mjs`: Zero-dependency deterministic builders.
- `src/core/**`: 100% vendor-independent pure ESM domain logic.

## Install, Register & Trust Approve (Antigravity Desktop via `antigravity-addons` `v3.0.0+`)
1. Upgrade [`antigravity-addons`](https://github.com/jaeseongs95/antigravity-addons) to **`v3.0.0+`** (`addon-host --upgrade`).
2. Close Antigravity Desktop and mirror this repository into `~/.gemini/config/plugins/antigravity-mcp-manager/` (excluding `.git` and `node_modules`).
3. Validate, register, approve SHA-256 trust pin, and verify:
   ```bash
   addon-host --validate ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   addon-host --register ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   addon-host trust approve antigravity-mcp-manager
   addon-host --doctor
   ```

## Remote Web Install (`antigravity-addons v3.0.0+` Public HTTPS `@require` Userscript)
1. Install Violentmonkey / Tampermonkey (Desktop) or Userscripts (iOS/iPadOS Safari).
2. Install `antigravity-mcp-manager.user.js` from the latest GitHub Release or build locally via `npm run build:userscript`.
3. Open `https://antigravity.google.com/` and launch MCP Manager from the statusbar item, Settings Page, or Quick Actions.

## Development & Tests
```bash
npm run build:renderer
npm run check:userscript
npm test
```
Runs unit, core-purity, `AddonManifest.v3` minimal-permission parity, `@antigravity-addons/sdk` `createTestHost({ surface: 'desktop' })` + `createTestHost({ surface: 'remote-web' })` parity (`NMCP-TC-037`, `NMCP-TC-038`), FS write-jail/CAS, HTTP security, EN/KO `I18N` parity, and real Headless Chromium/Edge CDP E2E tests (`NMCP-TC-001`–`NMCP-TC-038`) on Node 22+.
