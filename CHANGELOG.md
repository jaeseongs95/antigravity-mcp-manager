# Changelog

## 2.1.0 — Native Settings Left-Sidebar Menu Integration
- **Added** `src/adapters/antigravity/desktop-server.mjs`: standalone loopback HTTP server reusing 100% of verified `v2.0.0` core (`McpManagerService`), write-jailed FS store, and hardened HTTP security middleware (`127.0.0.1:0` + 256-bit random session token).
- **Added** `src/adapters/antigravity/settings-menu-injector.js`: zero-unsafe-DOM-sink renderer injector that inserts a native-styled **MCP Manager** item directly below **Browser** in Antigravity 2.0's Settings left sidebar and toggles the embedded UI iframe cleanly without destroying native React nodes.
- **Added** `scripts/electron-hook.cjs` & `scripts/install-settings-menu.mjs` (`--install` / `--uninstall` / `--status`) using official `@electron/asar` with an independent marker (`AGY_MCP_MANAGER_SETTINGS_V2`), automatic backup preservation, and zero coupling to `statusbar_autoinject.js`.
- **Added** real Chromium CDP E2E (`NMCP-TC-021`) and real `@electron/asar` install/idempotency/uninstall round-trip test (`NMCP-TC-022`), plus R7 non-blocking hardening (`fs-config-store.mjs` `acquireLock` error code preservation, `ls-inspector.mjs` query/hash URL guard, `README.md` Korean link).

## 2.0.0 — Clean-Slate Native Plugin + UI Sidecar Redesign
- **Removed** all legacy `app.asar` binary patching, `statusbar_autoinject.js` companion bundling, `app_storage.json` hooks, React/Angular DOM scraping, and browser remote-control bookmarklet code (remote web control split to `antigravity-remote-plugin`).
- **Added** official Antigravity 2.0 Plugin manifest (`plugin.json`, `assets/logo.svg`) and `AUX_PANE` UI Sidecar (`sidecars/mcp_manager/sidecar.json`, `main.mjs`, `ui/*`).
- **Added** 100% vendor-independent pure ESM core (`src/core/*`): static validator, secret redactor, declarative smart paste parser, lossless fail-closed JSON/CAS document engine, collision detector, and `McpManagerService`.
- **Added** write-jailed atomic FS store (`src/adapters/fs-config-store.mjs`) with ancestor symlink/junction defense, private backup directory outside `plugins/` (`~/.gemini/config/.mcp-manager-backups/`), mandatory `expectedSha256` CAS, Antigravity 2.0 dialect/paths/loopback-only read-only LS inspector (`src/adapters/antigravity/*`), and hardened `POST`-only Sidecar HTTP middleware (`Host`/`Origin`/`Sec-Fetch-Site`, constant-time `x-sidecar-token`, 1 MiB body cap, strict CSP).
- **Added** cross-OS deterministic test suite (`NMCP-TC-001`–`NMCP-TC-020`, `NMCP-TC-015B` real `sidecars/mcp_manager/main.mjs` + `sidecar_sdk` boot, Windows junction defense, live DOM/IME/Clone-secret-preservation) and 3-OS GitHub Actions CI (`ubuntu-latest`, `windows-latest`, `macos-latest`).
- **Documented** v1.x legacy cleanup/migration and `v2.0.0` → `v1.4.18` rollback procedures in `README.md` and `README.ko.md`.
