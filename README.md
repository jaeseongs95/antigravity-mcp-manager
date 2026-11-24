# Antigravity MCP Manager (`v3.0.0`)

[한국어 문서 (README.ko.md)](./README.ko.md)

A safe, vendor-independent **MCP Server Manager** for **Antigravity 2.0 Native Desktop App**, built as a zero-dependency **`AddonManifest.v2`** (`trustLevel: "trusted"`, `capabilities: ["renderer"]`, Option A **Named-Scope Config Bridge**) plugin hosted by [`antigravity-native-addon-host`](https://github.com/jaeseongs95/antigravity-native-addon-host) (`v2.3.0+`).

> **Zero `app.asar` Patching · Zero `mainHook` · Zero `AUX_PANE` Sidecar · Zero Runtime Dependencies**: `antigravity-mcp-manager` never patches or touches `app.asar`, carries zero runtime npm dependencies, and removes the separate `AUX_PANE` sidecar pane (`플러그인 > MCP Manager`). All full-featured MCP CRUD runs directly inside **Settings → MCP Manager** and the **Customizations → MCP Manager** centered popup modal inside Isolated World `998` Shadow DOM via `antigravity-native-addon-host` `v2.3.0+`'s Option A **Named-Scope Config Bridge** (`trustLevel: "trusted"` + `trust-policy.json` SHA-256 pinning).

## Features
- **Native Shadow DOM CRUD in Settings & Customizations (`AddonManifest.v2`, World `998`)**:
  - Mounts **MCP Manager** directly under **Browser** (or Korean **브라우저**) in Antigravity **Settings** (`settings-nav` declared `shadow: false` for native Tailwind inheritance with 0px layout shift; `pane` mounted inside open Shadow DOM Option B2 with preserved top-right `✕` close control).
  - Mounts an **MCP Manager** (`MCP 매니저` in KO) Shadow DOM button in **Customizations → MCP Servers** right before the native `[]` / `+` action icons, opening a centered native `<dialog>.showModal()` popup via `addonHost.openModal` (`PortalArbiter`-coordinated, titlebar-safe `marginTop` & `zIndex`, `✕`, capture-phase IME-safe `Esc` focus restoration).
  - Powered directly by `antigravity-native-addon-host` `v2.3.0+` **Option A Named-Scope Config Bridge** with 3 least-privilege scopes:
    - `antigravity:mcp-config` (`rw`): `~/.gemini/config/mcp_config.json` (sole canonical write target)
    - `antigravity:plugin-mcp-configs` (`ro`): read-only plugin MCP inventory
    - `antigravity:mcp-config-legacy` (`ro`): read-only 1-time legacy import preview
  - Cleanly unmounts all slots, modals, styles, and listeners immediately on `dispose()` when disabled or unregistered.
- **Host Language Auto-Detection & `EN | 한국어` Toggle**: Automatically detects Korean vs English host UI on first load (with explicit user override persisted under `storageNamespace` key `antigravity-mcp-manager:lang`, including 1-time migration from v2.1's `agy-mcp-manager-lang`).
- **Single Canonical Write Scope & Authoritative CAS**: Reads and writes only `~/.gemini/config/mcp_config.json` with mandatory on-disk SHA-256 CAS (preserving exact disk digests across CRLF/non-canonical JSON files), advisory file lock, private backups outside `plugins/`, ancestor/backup symlink protection, and atomic replace.
- **Read-Only Plugin Inventory & Declarative Smart Paste**: Displays read-only plugin MCP entries with collision warnings and secret-preserving **Clone to Global**, parses `mcpServers` JSON and Streamable HTTP URLs, normalizes `serverUrl` → `url`, detects legacy `/sse` with an editable `mcp-remote` Stdio preview, enforces explicit Stdio confirmation, and fails closed on malformed JSON with Raw JSON CAS recovery.

## Architecture (SOLID & Vendor-Independent)
- `addon-manifest.json`: Declarative `AddonManifest.v2` contract (`schemaVersion: 2`, `trustLevel: "trusted"`, `compatibility: { hostProfile: "antigravity-desktop", minHostVersion: "2.3.0" }`, `capabilities: ["renderer"]`, `configBridge.scopes` for the 3 scopes above, 4 non-exclusive `addon-owned-slot` entries with Shadow DOM Option B2 declarations, `storageNamespace: "antigravity-mcp-manager"`, `ipcChannelPrefix: "mcp-manager:"`, `loadOrder: 60`).
- `src/adapters/antigravity/renderer/*.mjs` → `src/adapters/antigravity/addon-renderer.js`: SOLID modular renderer (`host-runtime`, `host-config-store`, `native-mcp-panel`, `addon-styles`, `settings-sidebar-mount`, `customizations-mount`, `mount-coordinator`) deterministically assembled by `scripts/build-renderer.mjs` with zero external dependencies and zero unsafe DOM sinks.
- `src/core/**`: 100% vendor-independent pure ESM domain logic (zero Node/DOM/Sidecar/host dependencies).
- `src/adapters/fs-config-store.mjs`, `src/adapters/antigravity/**`, `src/adapters/sidecar/http-app.mjs`, `src/ui/**`: Reusable write-jailed FS store, loopback-only LS inspector, hardened HTTP security middleware, and standalone loopback UI assets.

## Install, Register & Trust Approve (via `antigravity-native-addon-host` v2.3.0+)
1. Ensure [`antigravity-native-addon-host`](https://github.com/jaeseongs95/antigravity-native-addon-host) **`v2.3.0+`** is installed/upgraded on your Antigravity Desktop (`addon-host --install` or `addon-host --upgrade`).
2. Close Antigravity Desktop, then place this repository under `~/.gemini/config/plugins/antigravity-mcp-manager/` (excluding `.git` and `node_modules` — zero runtime dependencies).
3. Validate, register, approve SHA-256 trust pinning, and check host health:
   ```bash
   addon-host --validate ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   addon-host --register ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   addon-host trust approve antigravity-mcp-manager
   addon-host --doctor
   ```
   > **Note**: Whenever `src/adapters/antigravity/addon-renderer.js` changes after an update/rebuild, re-run `addon-host trust approve antigravity-mcp-manager` to refresh the SHA-256 pin in `~/.gemini/antigravity/trust-policy.json`.
4. Start Antigravity Desktop and open **Settings → MCP Manager** or **Customizations → MCP Servers → MCP Manager**.
5. To revoke trust or unregister cleanly anytime:
   ```bash
   addon-host trust revoke antigravity-mcp-manager
   addon-host --unregister antigravity-mcp-manager
   ```

## Migrating from v2.x / v1 Host
`v3.0.0` removes `sidecars/` (`AUX_PANE`), `scripts/install-settings-menu.mjs`, `scripts/electron-hook.cjs`, and `@electron/asar` completely:
1. Upgrade [`antigravity-native-addon-host`](https://github.com/jaeseongs95/antigravity-native-addon-host) to **`v2.3.0+`** (`addon-host --upgrade`, or `addon-host --install --replace-legacy` if migrating from v2.1.x direct `app.asar` patching).
2. Close Antigravity Desktop, mirror `v3.0.0` to `~/.gemini/config/plugins/antigravity-mcp-manager/` (removing any stale `node_modules/` and `sidecars/`), then run `addon-host --register ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json` followed by `addon-host trust approve antigravity-mcp-manager`.
3. Existing language preferences saved in `agy-mcp-manager-lang` are migrated automatically to `antigravity-mcp-manager:lang` on first open.

## Development & Tests
```bash
npm run build:renderer
npm test
```
Runs all 30 unit, core-purity, `AddonManifest.v2` contract/SOLID parity, Named-Scope Config Bridge (`rawText: null` on `status: 'ok'`, CRLF on-disk `sha256` CAS, `corrupt` recovery), filesystem write-jail/symlink-junction/CAS, HTTP security, EN/KO `I18N` parity, and real Headless Chromium/Edge CDP E2E tests (`NMCP-TC-001`–`NMCP-TC-032`) on Node 22+.
