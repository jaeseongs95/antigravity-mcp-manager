# Changelog

All notable changes to `antigravity-mcp-manager` are documented in this file.

## [2.0.0] - 2026-11-18

### Changed (Full Hexagonal Architecture Redesign)
- **Vendor-Independent Core (`src/core/**`)**: Extracted pure ECMAScript domain, schema, security URL policy, UTF-16 JSONC span editor, `Promise.all`-safe FIFO `AsyncMutex` (`lockToken`), `DisposableStore`, and `McpManagerService` with **zero** browser/DOM/timer/vendor globals (`MCP-TC-001`–`MCP-TC-022`).
- **Host-Neutral Safe UI (`src/ui/**`)**: Rebuilt modal, edit popup, OAuth connect dialog, and Settings pane with declarative safe DOM builder (`h()`), zero `innerHTML`/`document.write` sinks, injected fallback focus restoration, scroll preservation, and Korean Hangul IME composition guards (`MCP-TC-043`–`MCP-TC-047`).
- **Antigravity Host Adapter (`src/adapters/antigravity/**`)**: Isolated React Fiber scanning, reference-counted Angular 19 `RemoteControlComponent` prototype leasing, Connect-JSON `proxyCommand` RPC transport, raw-text `ConfigRepositoryPort` (preserving 0-byte `mcp_config.json` `FOUND` and strictly separating Go/OS `ENOENT` from HTTP `404`), and companion script coordination.

### Security & Reliability
- **SHA-256 Compare-And-Swap (`CONFLICT`) & Compensating Rollback**: Prevents lost updates when `mcp_config.json` is edited externally, preserves comments via UTF-16 JSONC span mutations, and handles `RUNTIME_SYNC_FAILED` / `ROLLBACK_CONFLICT` / `ROLLBACK_FAILED` deterministically.
- **Canonical Single-URL Validation & All-Stdio Confirmation Gate**: Rejects conflicting `url`/`serverUrl` Split-URL specs and dual `command`+`url` specs, blocks credentials on non-loopback `http://` endpoints across all 4 entry points (including post-merge `smart-parser` and single-CAS `applyAuthToAllHttp`), requires explicit confirmation before saving/launching any `stdio`/`command` or `PATH` override in Quick Auto-Add, purges legacy cleartext `localStorage['agy-custom-mcp-config-backup-v1']`, and scrubs sensitive drafts on modal close and Settings tab departure.
- **Standards-Compliant Remote Workbench & CDN Worker Bridge**: Removed `<base>` injection (`base-uri 'self'` CSP safe), implemented prototype-inheritance-aware WebIDL `[Replaceable]` `self`/`globalThis`/`origin` guards, bound WebIDL Window receiver methods via `WeakMap` cache while preserving constructors/namespaces, added `URL.canParse` / `URL.parse` base rewriting, and replaced global error flags with `syncCaptureStack` preserving nested `importScripts` recovery, falsy `throw` values (`0`, `''`, `false`, `null`, `undefined`), `EvalError` normalization, and cancelable `ErrorEvent` dispatch (`D-0022`, `D-0035`, `AUDIT-M1`–`M6`).
- **Companion-Preserving `--uninstall`, Dedicated `--restore`, & Bidirectional ASAR Reverse Rollback**: Split monolithic scripts into `scripts/lib/*` and standalone `dist/ensure_statusbar_patch.js`, preserving `antigravity-statusbar` and `ko-thought-translator` on `--uninstall` when companions remain, or performing 3-check ASAR restoration with symmetric Stage 2 -> Stage 1 ASAR reverse rollback on sole uninstall (`D-0013`, `D-0034`, `MCP-TC-050`).

## [1.5.0] - 2026-11-17
- Initial modular split of remote frame promoter FSM and non-invasive remote host launcher (`5938b75`).
