# Changelog

## 2.0.0 — Clean-Slate Native Plugin + UI Sidecar Redesign
- **Removed** all legacy `app.asar` binary patching, `statusbar_autoinject.js` companion bundling, `app_storage.json` hooks, React/Angular DOM scraping, and browser remote-control bookmarklet code (remote web control split to `antigravity-remote-plugin`).
- **Added** official Antigravity 2.0 Plugin manifest (`plugin.json`, `assets/logo.svg`) and `AUX_PANE` UI Sidecar (`sidecars/mcp_manager/sidecar.json`, `main.mjs`, `ui/*`).
- **Added** 100% vendor-independent pure ESM core (`src/core/*`): static validator, secret redactor, declarative smart paste parser, lossless fail-closed JSON/CAS document engine, collision detector, and `McpManagerService`.
- **Added** write-jailed atomic FS store (`src/adapters/fs-config-store.mjs`) with ancestor symlink/junction defense, private backup directory outside `plugins/` (`~/.gemini/config/.mcp-manager-backups/`), mandatory `expectedSha256` CAS, Antigravity 2.0 dialect/paths/loopback-only read-only LS inspector (`src/adapters/antigravity/*`), and hardened `POST`-only Sidecar HTTP middleware (`Host`/`Origin`/`Sec-Fetch-Site`, constant-time `x-sidecar-token`, 1 MiB body cap, strict CSP).
- **Added** cross-OS deterministic test suite (`NMCP-TC-001`–`NMCP-TC-020`, `NMCP-TC-015B` real `sidecars/mcp_manager/main.mjs` + `sidecar_sdk` boot, Windows junction defense, live DOM/IME/Clone-secret-preservation) and 3-OS GitHub Actions CI (`ubuntu-latest`, `windows-latest`, `macos-latest`).
- **Documented** v1.x legacy cleanup/migration and `v2.0.0` → `v1.4.18` rollback procedures in `README.md` and `README.ko.md`.
