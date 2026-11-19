# `antigravity-mcp-manager` Clean-Slate Test Case Specification (`v2.0.0` Native Plugin + UI Sidecar)

## 1. Core Purity & Domain Schema (`test/core/purity-and-schema.test.mjs`)

| ID | Verification Target | Pass Condition |
| :--- | :--- | :--- |
| `NMCP-TC-001` | `src/core/**` vendor & runtime purity | Zero imports/references to `node:fs`, `node:path`, `node:os`, `node:child_process`, `node:http`, `sidecar_sdk`, `window`, `document`, `antigravity`, `electron`, `react`, `angular`. |
| `NMCP-TC-002` | `sha256Hex` FIPS 180-4 & UTF-8 surrogate parity | Matches `node:crypto` SHA-256 on empty string, ASCII, Korean multi-byte UTF-8, and astral emoji (`🚀`). |
| `NMCP-TC-003` | Static transport & schema validation (`validator.mjs`) | Validates Stdio (`command`, `args[]`, `env{}`) and Streamable HTTP (`url`/`serverUrl`, `headers{}`); rejects dual `command`+`url`, empty command/url, non-http(s) schemes, prototype-pollution keys (`__proto__`, `constructor`, `prototype`), and flags dangerous `env` keys (`NODE_OPTIONS`, `LD_PRELOAD`, `PATH`, etc.) and non-loopback plaintext `http://` credentials or sensitive query params. |
| `NMCP-TC-004` | Secret redaction (`secret-redactor.mjs`) | Masks `env` and `headers` values and URL embedded credentials in redacted views/logs while preserving non-secret structural metadata. |
| `NMCP-TC-005` | Declarative Smart Paste (`input-parser.mjs`) | Parses `mcpServers` map, single named entry, raw server spec, and Streamable HTTP URL; normalizes legacy `serverUrl` → `url`; detects legacy `/sse` URLs with explicit warning + editable `mcp-remote` Stdio preview (never auto-executes or silently rewrites). Rejects raw shell strings safely. |
| `NMCP-TC-006` | Collision detector (`collision-detector.mjs`) | Detects exact and case-insensitive server key collisions within global scope and between global and read-only plugin inventories. |

## 2. Lossless Document Engine & Manager Service (`test/core/document-and-service.test.mjs`)

| ID | Verification Target | Pass Condition |
| :--- | :--- | :--- |
| `NMCP-TC-007` | Lossless unknown-key preservation (`document-engine.mjs`) | Adding, updating, toggling `disabled`, or deleting one server preserves unknown top-level keys, unknown per-server keys (including `disabledTools` and future host keys), and untouched sibling servers verbatim. |
| `NMCP-TC-008` | Fail-closed malformed JSON recovery | Corrupted JSON on disk returns `MALFORMED_JSON` with error position/message, blocks structured mutations (never coerces to `{ mcpServers: {} }`), and allows explicit valid Raw JSON repair. |
| `NMCP-TC-009` | Optimistic concurrency (`baseSha256` CAS) | Missing `expectedSha256` fails with `VALIDATION_ERROR`, stale `expectedSha256` fails with `CONFLICT` (`409`) without mutating disk state; re-reading fresh digest allows save. |
| `NMCP-TC-010` | `ManagerService` end-to-end use cases | Covers CRUD, exact-name create collision (`COLLISION`), URL query secret preservation on masked edit, native `disabled` toggle, read-only plugin inventory + `runtime.plugins` disabled mapping + server-side Clone-to-Global, read-only legacy 1-time import preview (zero mutation of legacy source), and Stdio confirmation gate enforcement. |

## 3. FS Config Store & Antigravity Adapter (`test/adapters/fs-store-and-antigravity.test.mjs`)

| ID | Verification Target | Pass Condition |
| :--- | :--- | :--- |
| `NMCP-TC-011` | Write Jail & symlink/junction escape defense (`fs-config-store.mjs`) | Writes ONLY to canonical target `mcp_config.json`; hard-rejects `config.json`, `plugins/*/mcp_config.json`, legacy paths, ancestor directory symlinks/Windows junctions escaping canonical root (zero skips on Windows), and plugin symlink escapes outside plugin root. |
| `NMCP-TC-012` | Atomic write, advisory lock, private backup & restore | Same-FS temp file + `fsync` + atomic replace; rejects concurrent lock conflict, atomically reclaims stale lock, stores backups outside `plugins/` (`~/.gemini/config/.mcp-manager-backups/`), and enforces `expectedSha256` CAS on `restoreLastBackup`. |
| `NMCP-TC-013` | Antigravity dialect, paths & loopback-only LS inspector (`adapters/antigravity/*`) | Resolves `~/.gemini/config/mcp_config.json` (sole R/W), `plugins/*/mcp_config.json` (RO), and `~/.gemini/antigravity/mcp_config.json` (RO); refuses non-loopback `ANTIGRAVITY_LS_ADDRESS` with 0 network calls; calls loopback `GetMcpServerStates` & `GetAllPlugins` with `x-codeium-csrf-token` and returns strictly redacted DTOs without leaking `ANTIGRAVITY_CSRF_TOKEN` or `env`/`headers`. |

## 4. Sidecar HTTP Security & Manifest Contract (`test/adapters/sidecar-http-security.test.mjs`)

| ID | Verification Target | Pass Condition |
| :--- | :--- | :--- |
| `NMCP-TC-014` | Official plugin & sidecar manifest contract | `plugin.json` contains only documented top-level fields + valid `assets/logo.svg`; `sidecars/mcp_manager/sidecar.json` declares `has_web_ui: true` and `SIDECAR_UI_ENTRYPOINT_AUX_PANE`; zero `SKILL.md` or `app.asar` patch artifacts exist. |
| `NMCP-TC-015` | Sidecar `POST`-only API, DNS-rebinding/CSRF/body-limit middleware, CSP & zero `child_process` | `attachSidecarSecurityMiddleware` rejects non-loopback `Host` (`403`), cross-origin `Origin`/`Sec-Fetch-Site` (`403`), oversized >1 MiB bodies (`413`), `GET /api/*` (`405`), and unauthenticated `POST` (`401`); maps `CONFIRMATION_REQUIRED` (`428`) and `IO_ERROR` (`500`); sets strict `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`; zero `child_process` in runtime code. |
| `NMCP-TC-015B` | Real `sidecars/mcp_manager/main.mjs` + `sidecar_sdk` boot | Spawns actual `sidecars/mcp_manager/main.mjs` with host `sidecar_sdk/register_loader.js` on an isolated temp home, verifies real `GET /`, unauthenticated `401`, cross-origin `403`, and authenticated `POST /api/snapshot` `200` with CSP + redacted DTO (gracefully skipped only on CI runners without Antigravity Desktop installed). |
| `NMCP-TC-016` | Secret non-disclosure over HTTP | API responses mask `env`/`headers` by default and never echo `ANTIGRAVITY_CSRF_TOKEN` or Sidecar `process.env`; error responses redact credentials. |

## 5. AUX_PANE UI Safety & Accessibility (`test/ui/ui-safety-and-a11y.test.mjs`)

| ID | Verification Target | Pass Condition |
| :--- | :--- | :--- |
| `NMCP-TC-017` | Zero unsafe DOM sinks (`sidecars/mcp_manager/ui/**`) | Zero `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function` in UI JS; `index.html` loads only `/preload.js`, `/styles.css`, `/app.js` (zero external CDNs/fonts). |
| `NMCP-TC-018` | Theme tokens, narrow-pane responsiveness & reduced motion | `styles.css` binds host tokens (`--background`, `--foreground`, `--primary`, `--font-family`), supports `max-width: 420px`, and respects `prefers-reduced-motion: reduce`. |
| `NMCP-TC-019` | Live DOM execution: Clone secret preservation, Korean IME guard, Raw Stdio confirm & secret masking | Executes `sidecars/mcp_manager/ui/app.js` against a live loopback HTTP server: verifies `Clone to Global` calls `/api/clone-plugin` and preserves full plugin secrets on disk (never `'••••••••'`), Korean IME `isComposing`/`keyCode === 229` blocks premature submit, Raw JSON Stdio save triggers `428` confirm gate, `type="password"` masks secrets, and `message` listener checks `event.source === window.parent`. |
| `NMCP-TC-020` | Live DOM execution: Broken-JSON recovery & CAS `409` conflict UX | Executes `app.js` against a live loopback HTTP server: verifies `409 CONFLICT` surfaces an explicit conflict banner without silent overwrite, and `MALFORMED_JSON` surfaces Raw JSON recovery + CAS-protected `Restore Last Good Backup`. |
