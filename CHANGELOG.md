# Changelog

## 2.0.0 — Clean-Slate Native Plugin + UI Sidecar Redesign
- **Removed** all legacy `app.asar` binary patching, `statusbar_autoinject.js` companion bundling, `app_storage.json` hooks, React/Angular DOM scraping, and browser remote-control bookmarklet code (remote web control split to `antigravity-remote-plugin`).
- **Added** official Antigravity 2.0 Plugin manifest (`plugin.json`, `assets/logo.svg`) and `AUX_PANE` UI Sidecar (`sidecars/mcp_manager/sidecar.json`, `main.mjs`, `ui/*`).
- **Added** 100% vendor-independent pure ESM core (`src/core/*`): static validator, secret redactor, declarative smart paste parser, lossless fail-closed JSON/CAS document engine, collision detector, and `McpManagerService`.
- **Added** write-jailed atomic FS store (`src/adapters/fs-config-store.mjs`), Antigravity 2.0 dialect/paths/read-only LS inspector (`src/adapters/antigravity/*`), and `POST`-only token-enforced strict-CSP Sidecar HTTP adapter (`src/adapters/sidecar/http-app.mjs`).
- **Added** cross-OS deterministic test suite (`NMCP-TC-001`–`NMCP-TC-020`) and 3-OS GitHub Actions CI (`ubuntu-latest`, `windows-latest`, `macos-latest`).
