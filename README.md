# Antigravity MCP Manager (`v2.0.0`)

A safe, vendor-independent **MCP Server Manager** packaged as an official **Antigravity 2.0 Native Plugin + `AUX_PANE` UI Sidecar** (`plugin.json` + `sidecars/mcp_manager/sidecar.json`).

> **Zero Binary Patching**: No `app.asar` modification, no `statusbar_autoinject.js` piggybacking, no React/Angular internal DOM scraping, and no LLM-callable config write tools.

## Features
- **Single Canonical Write Scope**: Reads and writes only `~/.gemini/config/mcp_config.json` with mandatory SHA-256 CAS (`409 Conflict` protection), advisory file lock, private backups stored outside `plugins/` (`~/.gemini/config/.mcp-manager-backups/`), and same-filesystem atomic replace (`fsync` + `rename`).
- **Read-Only Plugin Inventory**: Displays `plugins/*/mcp_config.json` (global & workspace `.agents/plugins/`) with plugin badges, plugin disabled status, global name-collision warnings, and safe **Clone to Global** (preserving full secrets server-side without exposing masked values).
- **Live Read-Only Status**: Queries Antigravity's local loopback Language Server (`GetMcpServerStates`, `GetAllPlugins`) for live readiness badges, tool counts, and redacted error summaries.
- **Declarative Smart Paste**: Parses `mcpServers` JSON snippets and Streamable HTTP `https://` URLs, normalizes legacy `serverUrl` → `url`, and detects legacy `/sse` endpoints with an editable `mcp-remote` Stdio preview.
- **Security & Recovery First**: Hard-blocks dangerous environment overrides (`NODE_OPTIONS`, `LD_PRELOAD`, etc.) and cleartext `http://` auth headers or sensitive query tokens on non-loopback hosts, requires explicit confirmation before saving Stdio commands (including Raw JSON saves), masks secret inputs by default, and fails closed on malformed JSON with Raw JSON recovery + last-good backup restore.

## Architecture
- `src/core/**`: 100% vendor-independent pure ESM domain logic (zero `node:fs`, `child_process`, `sidecar_sdk`, Antigravity, or DOM dependencies).
- `src/adapters/fs-config-store.mjs`: Write-jailed atomic filesystem store (`mcp_config.json` only) with ancestor symlink/junction escape defense.
- `src/adapters/antigravity/**`: Antigravity 2.0 dialect, path resolver, and loopback-only read-only LS inspector.
- `src/adapters/sidecar/http-app.mjs`: Hardened `sidecar_sdk` adapter (`POST`-only `/api/*`, loopback `Host`/`Origin`/`Sec-Fetch-Site` check, constant-time `x-sidecar-token`, 1 MiB body limit, strict CSP, `Cache-Control: no-store`, zero `child_process`).
- `sidecars/mcp_manager/**`: Official `SIDECAR_UI_ENTRYPOINT_AUX_PANE` web UI synced to Antigravity's native Light/Dark theme tokens.

## Install & Usage (Antigravity 2.0 Native App)
1. Place this repository under `~/.gemini/config/plugins/antigravity-mcp-manager/`.
2. Open **MCP Manager** from the conversation header **`+`** menu to toggle it in the Auxiliary Side Pane.
3. Enable, disable, or uninstall cleanly anytime from Antigravity **Customizations** or `agy plugin disable antigravity-mcp-manager`.

## Migrating from v1.x (Legacy Cleanup)
If you previously installed `v1.x` (which injected `mcp_manager_autoinject.js`), clean up the legacy hooks before enabling `v2.0.0`:
1. If you still have a `v1.x` checkout, run `node scripts/install.js --uninstall`.
2. Or manually delete `~/.gemini/antigravity/mcp_manager_autoinject.js` and remove any `MCP_MANAGER_VERSION` / `MCP_MANAGER` injected block from `~/.gemini/antigravity/statusbar_autoinject.js` and `~/.gemini/antigravity/app_storage.json`.
3. Existing `~/.gemini/antigravity/mcp_config.json` entries are never mutated automatically; use the **Legacy Import** preview in the v2.0.0 UI to copy desired entries into `~/.gemini/config/mcp_config.json`.

## Rollback (`v2.0.0` → `v1.4.18`)
1. Disable or remove `~/.gemini/config/plugins/antigravity-mcp-manager/` (e.g., `agy plugin disable antigravity-mcp-manager` and delete the plugin folder).
2. If you need to restore the last good `~/.gemini/config/mcp_config.json`, copy `~/.gemini/config/.mcp-manager-backups/mcp_config.last-good.json` back to `~/.gemini/config/mcp_config.json`.
3. If you specifically require legacy `v1.4.18`, check out tag `v1.4.18` separately and follow its README instructions.

## Development & Tests
```bash
npm test
```
Runs all unit, core-purity, filesystem write-jail/symlink-junction/CAS, Sidecar HTTP security (including real `sidecars/mcp_manager/main.mjs` + `sidecar_sdk` boot when Antigravity Desktop is installed), and live DOM/IME UI safety tests (`NMCP-TC-001`–`NMCP-TC-020`, `NMCP-TC-015B`) with zero external dependencies on Node 20+.
