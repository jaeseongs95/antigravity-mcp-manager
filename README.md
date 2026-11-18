# Antigravity Custom MCP Server Manager (`antigravity-mcp-manager` `v2.0.0`)

**Languages:** **English ([README.md](./README.md))** | **[한국어 (README.ko.md)](./README.ko.md)**

Add, edit, authenticate (`OAuth` / `Bearer` / `API Key` / `Basic`), toggle, and manage **Custom MCP Servers** (HTTPS / loopback HTTP Streamable MCP servers and local `Stdio` processes like `npx`, `uvx`, `node`, `python`, `docker`, `deno`, `bun`, `pnpx`) directly inside the **Google Antigravity 2.0 Native Desktop App** and **Remote Control Web (`https://antigravity.google.com/r/...`)** without restarting the app.

---

## Table of Contents

1. [Overview & v2.0.0 Architecture Highlights](#overview--v200-architecture-highlights)
2. [Desktop App Installation, Uninstall & ASAR Restore](#desktop-app-installation-uninstall--asar-restore)
3. [Remote Control Web Guide (Bookmarklet & UserScript)](#remote-control-web-guide-bookmarklet--userscript)
4. [UI Entry Points & Keyboard Shortcut](#ui-entry-points--keyboard-shortcut)
5. [Security & Persistence Guarantees](#security--persistence-guarantees)
6. [Repository Structure](#repository-structure)
7. [Verification & Testing](#verification--testing)

---

## Overview & v2.0.0 Architecture Highlights

- **Hexagonal (Ports & Adapters) Architecture (`v2.0.0`)**:
  - **`src/core/**` (Zero Host/DOM/Timer/Vendor Globals)**: Pure ECMAScript domain service (`McpManagerService`), `Promise.all`-safe FIFO `AsyncMutex`, UTF-16 JSONC span editor (`jsonc-codec.js`), canonical single-URL & security schema validators, pure UTF-8 SHA-256, and LIFO `DisposableStore`.
  - **`src/ui/**` (Host-Neutral Accessible UI)**: Safe declarative DOM kit (`h()`, zero `innerHTML`/`document.write`), ARIA focus trap with injected fallback focus target, scroll position preservation, and Korean Hangul IME composition protection (`isComposing` / `229`).
  - **`src/adapters/antigravity/**` (Isolated Host Adapter)**: Bounded React Fiber gateway, reference-counted Angular 19 `RemoteControlComponent` prototype lease, Connect-JSON `proxyCommand` RPC transport, 6-state Remote Workbench Frame Promoter FSM (`base-uri 'self'` & `require-trusted-types-for 'script'` compliant), and WebIDL-aligned CDN Worker bridge.
- **Companion-Safe Multi-Plugin Coexistence**:
  - Works standalone or alongside `antigravity-statusbar` and `ko-thought-translator` with anchored marker manifests (`BEGIN_AGY_MCP_MANAGER_V1` .. `END_AGY_MCP_MANAGER_V1`), `PASSIVE_ATTACHED` frame coordination, and external `#agy-mcp-remote-launcher` placement outside `.agy-ctx-statusbar`.

---

## Desktop App Installation, Uninstall & ASAR Restore

```bash
git clone https://github.com/jaeseongs95/antigravity-mcp-manager.git
cd antigravity-mcp-manager

# 1. Build runtime + standalone patcher bundles and run all 11 test suites (unit, integration & Chromium E2E)
npm test

# 2. Install to ~/.gemini/antigravity, apply V5 ASAR patch (saving asar_v5_backup.json) & sync via CDP
npm run install-mcp-manager

# 3. Inspect non-mutating patch & companion status
npm run status

# 4. Uninstall MCP Manager (preserves companion plugins if installed; restores app.asar if sole plugin)
npm run uninstall-mcp-manager

# 5. Explicit ASAR-only binary restoration (verifies originalAsarSha256 & patchedHeaderSha256 without deleting companion files)
npm run restore-asar
```

> **Legacy `v1.5.0` Backup Note**: Starting in `v2.0.0`, `install` records original entry buffers and full-archive SHA-256 digests in `~/.gemini/antigravity/asar_v5_backup.json` for 3-stage verified restoration. If `app.asar` was previously patched by `v1.5.0` without `asar_v5_backup.json`, `--restore` safely halts with `RESTORE_BACKUP_MISSING`; in that legacy case, restore from your `app.asar.v*.orig` file in the Antigravity `resources/` directory before running `v2.0.0` install.

---

## Remote Control Web Guide (Bookmarklet & UserScript)

When accessing your Antigravity session remotely via **`https://antigravity.google.com/r/...`**, copy the single-line Bookmarklet below as the **URL** of a browser bookmark:

```javascript
javascript:(()=>{fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js?t='+Date.now()).then(r=>{if(!r.ok)throw new Error(r.status);return r.text()}).then(c=>{const s=document.createElement('script'),n=[...document.querySelectorAll('script,style,link')].map(x=>x.nonce||x.getAttribute('nonce')).find(Boolean),t=window.trustedTypes;let p=null;if(t?.createPolicy){for(const k of['agy-mcp-bm','agy-mcp-'+Date.now()])try{let u=1;p=t.createPolicy(k,{createScript:x=>{if(!u)throw new TypeError();u=0;return x}});break}catch{}}if(t&&!p)return;if(n){s.nonce=n;s.setAttribute('nonce',n)}s.text=p?p.createScript(c):c;document.head.appendChild(s)})})();
```

Or install `https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js` directly in Tampermonkey / Violentmonkey / AdGuard (`// ==UserScript==` header included).

---

## UI Entry Points & Keyboard Shortcut

| Entry Point | How to Open | Features Available |
| :--- | :--- | :--- |
| **Settings Modal -> `"MCP Servers"` Tab** | Open Antigravity `Settings` -> Click **`MCP Servers`** (`settings-nav-item-McpManager`) | Embedded dashboard with Quick Auto-Add, server cards, OAuth connect, and edit popup; automatically scrubs sensitive drafts when switching tabs. |
| **Customizations -> `MCP Servers` Section** | Open `Customizations` -> `MCP Servers` | Click **`Edit MCP Servers`** next to `+ Add MCP` to modify or delete custom servers. |
| **Remote Host Floating Launcher (`#agy-mcp-remote-launcher`)** | Click **`MCP Servers`** button on `https://antigravity.google.com/r/...` | Opens the standalone manager modal on desktop and mobile browsers without modifying `.agy-ctx-statusbar`. |
| **Keyboard Shortcut (`Ctrl+Alt+M`)** | Press **`Ctrl+Alt+M`** anywhere | Toggles the standalone Custom MCP Server Manager modal (preserving VS Code's `Ctrl+Shift+M`). |

---

## Security & Persistence Guarantees

1. **All-Stdio & `PATH` Confirmation Gate**: Every local command specification (`command`, `npx`/`uvx` package/GitHub URL, or multi-server JSON containing `command`) and `PATH` override in Quick Auto-Add displays the decomposed `command`, `args`, and `env` keys for explicit user confirmation prior to saving or launching.
2. **Canonical Single-URL & Cleartext Credential Blocking**: Conflicting `url`/`serverUrl` (Split-URL) and mixed `command`+`url` specs are rejected immediately; credentials and batch HTTP auth (`applyAuthToAllHttp`) are blocked on non-loopback `http://` endpoints; legacy `localStorage` plaintext backups are purged on startup.
3. **SHA-256 CAS & Strict `ENOENT` Separation**: Pre-write SHA-256 verification blocks accidental overwrites (`CONFLICT`), preserves JSONC comments, preserves 0-byte `mcp_config.json` files for recovery, and never mistakes HTTP `404` / `"Instance not found"` transport errors for missing files.
4. **Scoped One-Shot `TrustedTypes`**: Uses dedicated non-shared policy names with zero `createHTML` surface, single-use capability tokens, and per-`Window` `WeakMap` negative caching.

---

## Repository Structure

```text
antigravity-mcp-manager/
├── src/
│   ├── core/                      # Pure ECMAScript domain, ports, AsyncMutex, SHA-256, JSONC & security schema
│   ├── security/                  # Scoped one-shot TrustedTypes policy & CSP nonce helper
│   ├── shared/                    # Anchored companion marker manifest & Window-bound DOM disposables
│   ├── ui/                        # Safe DOM kit, responsive tokens, modal controller & 5 modular views
│   ├── adapters/antigravity/      # Fiber gateway, RemoteControl lease, RPC, ports adapter & Remote Workbench FSM
│   └── index.js                   # Composition Root (window.agyMcpManager, version: '2.0.0')
├── scripts/
│   ├── lib/                       # js-lexer, file-lock, pure asar-patcher, rfc6455-ws & cdp-injector
│   ├── patcher-entry.js           # Standalone patcher CLI (--status, --restore, --uninstall, hook)
│   ├── build.js                   # Dual bundler -> dist/mcp_manager_autoinject.js & dist/ensure_statusbar_patch.js
│   ├── install.js                 # Two-stage transactional installer/uninstaller with bidirectional ASAR rollback
│   └── run-tests.js               # Cross-OS recursive Node test runner
├── dist/                          # Built self-contained runtime & patcher bundles
├── docs/TEST_CASES.md             # Bilingual specification of MCP-TC-001 through MCP-TC-050
└── test/                          # 11 layered unit, security, adapter, UI, script & live Chromium E2E suites
```

---

## Verification & Testing

```bash
npm test
```

## License

MIT License — see [LICENSE](./LICENSE).
