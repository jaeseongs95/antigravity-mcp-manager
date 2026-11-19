# Antigravity MCP Manager (`v2.0.0`)

A safe, vendor-independent **MCP Server Manager** packaged as an official **Antigravity 2.0 Native Plugin + `AUX_PANE` UI Sidecar** (`plugin.json` + `sidecars/mcp_manager/sidecar.json`).

> **Zero Binary Patching**: No `app.asar` modification, no `statusbar_autoinject.js` piggybacking, no React/Angular internal DOM scraping, and no LLM-callable config write tools.

## Features
- **Single Canonical Write Scope**: Reads and writes only `~/.gemini/config/mcp_config.json` with SHA-256 CAS (`409 Conflict` protection), advisory file lock, private backup/restore, and same-filesystem atomic replace (`fsync` + `rename`).
- **Read-Only Plugin Inventory**: Displays `plugins/*/mcp_config.json` (global & workspace `.agents/plugins/`) with plugin badges, global name-collision warnings, and safe **Clone to Global**.
- **Live Read-Only Status**: Queries Antigravity's local Language Server (`GetMcpServerStates`, `GetAllPlugins`) for live readiness badges, tool counts, and redacted error summaries.
- **Declarative Smart Paste**: Parses `mcpServers` JSON snippets and Streamable HTTP `https://` URLs, normalizes legacy `serverUrl` → `url`, and detects legacy `/sse` endpoints with an editable `mcp-remote` Stdio preview.
- **Security & Recovery First**: Hard-blocks dangerous environment overrides (`NODE_OPTIONS`, `LD_PRELOAD`, etc.) and cleartext `http://` auth headers on non-loopback hosts, requires explicit confirmation before saving Stdio commands, masks secret inputs by default, and fails closed on malformed JSON with Raw JSON recovery + last-good backup restore.

## Architecture
- `src/core/**`: 100% vendor-independent pure ESM domain logic (zero `node:fs`, `child_process`, `sidecar_sdk`, Antigravity, or DOM dependencies).
- `src/adapters/fs-config-store.mjs`: Write-jailed atomic filesystem store (`mcp_config.json` only).
- `src/adapters/antigravity/**`: Antigravity 2.0 dialect, path resolver, and read-only LS inspector.
- `src/adapters/sidecar/http-app.mjs`: Hardened `sidecar_sdk` adapter (`POST`-only `/api/*` with `x-sidecar-token`, strict CSP, `Cache-Control: no-store`, zero `child_process`).
- `sidecars/mcp_manager/**`: Official `SIDECAR_UI_ENTRYPOINT_AUX_PANE` web UI synced to Antigravity's native Light/Dark theme tokens.

## Install & Usage (Antigravity 2.0 Native App)
1. Place this repository under `~/.gemini/config/plugins/antigravity-mcp-manager/`.
2. Open **MCP Manager** from the conversation header **`+`** menu to toggle it in the Auxiliary Side Pane.
3. Enable, disable, or uninstall cleanly anytime from Antigravity **Customizations** or `agy plugin disable antigravity-mcp-manager`.

## Development & Tests
```bash
npm test
```
Runs all unit, core-purity, filesystem write-jail/CAS, Sidecar HTTP security, and UI safety tests (`NMCP-TC-001`–`NMCP-TC-020`) with zero external dependencies on Node 20+.
