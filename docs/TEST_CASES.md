# `antigravity-mcp-manager` Clean-Slate Test Case Specification (`v2.0.0` Native Plugin + UI Sidecar)

## 1. Core Purity & Domain Schema (`test/core/purity-and-schema.test.mjs`)

| ID | Verification Target | Pass Condition |
| :--- | :--- | :--- |
| `NMCP-TC-001` | `src/core/**` vendor & runtime purity | Zero imports/references to `node:fs`, `node:path`, `node:os`, `node:child_process`, `node:http`, `sidecar_sdk`, `window`, `document`, `antigravity`, `electron`, `react`, `angular`. |
| `NMCP-TC-002` | `sha256Hex` standard Web Crypto API & UTF-8 surrogate parity | Uses standard `globalThis.crypto.subtle.digest('SHA-256')` + `TextEncoder` (zero hand-rolled crypto) and matches `node:crypto` SHA-256 on empty string, ASCII, Korean multi-byte UTF-8, and astral emoji (`🚀`). |
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
| `NMCP-TC-011` | Write Jail & symlink/junction/dangling escape defense (`fs-config-store.mjs`) | Writes ONLY to canonical target `mcp_config.json`; hard-rejects `config.json`, `plugins/*/mcp_config.json`, legacy `~/.gemini/antigravity/mcp_config.json`, parent directory symlinks/Windows junctions (including dangling symlinks caught via direct `lstatSync`), and plugin symlink escapes outside plugin root. |
| `NMCP-TC-012` | Atomic write, advisory lock, private backup & restore | Same-FS temp file + `fsync` + atomic replace; rejects concurrent lock conflict, atomically reclaims stale lock, stores backups outside `plugins/` (`~/.gemini/config/.mcp-manager-backups/mcp_config.last-good.json`), blocks symlinked/junctioned `backupDir`/`backupPath` (`WRITE_JAIL_VIOLATION`), and enforces `expectedSha256` CAS on `restoreLastBackup`. |
| `NMCP-TC-013` | Antigravity dialect, paths, dynamic workspace `.agents/plugins/` & loopback-only LS inspector (`adapters/antigravity/*`) | Resolves `~/.gemini/config/mcp_config.json` (sole R/W), `plugins/*/mcp_config.json` (RO), dynamic `<workspace>/.agents/plugins/*/mcp_config.json` via `workspaceUris` (including clone with secret preservation), and `~/.gemini/antigravity/mcp_config.json` (RO); refuses non-loopback `ANTIGRAVITY_LS_ADDRESS` with 0 network calls; calls loopback `GetMcpServerStates` & `GetAllPlugins` with `x-codeium-csrf-token` and returns strictly redacted DTOs without leaking `ANTIGRAVITY_CSRF_TOKEN` or `env`/`headers`. |

## 4. Sidecar HTTP Security & Manifest Contract (`test/adapters/sidecar-http-security.test.mjs`)

| ID | Verification Target | Pass Condition |
| :--- | :--- | :--- |
| `NMCP-TC-014` | Official plugin & sidecar manifest contract | `plugin.json` contains only documented top-level fields + valid `assets/logo.svg`; `sidecars/mcp_manager/sidecar.json` declares `has_web_ui: true` and `SIDECAR_UI_ENTRYPOINT_AUX_PANE`; zero `SKILL.md` or `app.asar` patch artifacts exist. |
| `NMCP-TC-015` | Sidecar `POST`-only API, DNS-rebinding/CSRF/chunked-body-limit/fail-closed token middleware, CSP & zero `child_process` | `attachSidecarSecurityMiddleware` rejects non-loopback & userinfo `Host` (`403`), cross-origin / cross-port loopback / `null` `Origin` (`403`), `Sec-Fetch-Site: cross-site` and `same-site` (`403`), empty token fail-closed (`401`), unauthenticated `POST` (`401`), oversized `Content-Length` AND `Transfer-Encoding: chunked` >1 MiB bodies (`413`, race-free), and `GET /api/*` (`405`); maps `WRITE_JAIL_VIOLATION` (`403`), `CONFIRMATION_REQUIRED` (`428`), and `IO_ERROR` (`500`); sets strict `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`; zero `child_process` in runtime code. |
| `NMCP-TC-015B` | Real `sidecars/mcp_manager/main.mjs` + `sidecar_sdk` boot | Spawns actual `sidecars/mcp_manager/main.mjs` with host `sidecar_sdk/register_loader.js` on an isolated temp home; verifies `GET /`, `GET /styles.css`, `GET /app.js` (`200` + CSP + `nosniff`), `GET /preload.js` (`200`), `GET /api/snapshot` (`405`), bad `Host` (`403`), cross-port `Origin` (`403`), `Sec-Fetch-Site: same-site` (`403`), unauthenticated `POST` (`401`), `Transfer-Encoding: chunked` > 1 MiB (`413` without crash), authenticated same-origin `POST /api/snapshot` with dynamic `workspaceUris` (`200` + CSP + redacted DTO + workspace plugin discovery), Stdio `428`, and stale CAS `409`. Explicitly calls `t.skip()` on hosts without Antigravity Desktop `sidecar_sdk`. |
| `NMCP-TC-016` | Secret non-disclosure over HTTP | API responses mask `env`/`headers` by default and never echo `ANTIGRAVITY_CSRF_TOKEN` or Sidecar `process.env`; error responses redact credentials. |

## 5. AUX_PANE UI Safety & Accessibility (`test/ui/ui-safety-and-a11y.test.mjs`)

| ID | Verification Target | Pass Condition |
| :--- | :--- | :--- |
| `NMCP-TC-017` | Zero unsafe DOM sinks (`sidecars/mcp_manager/ui/**`) | Zero `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function` in UI JS; `index.html` loads only `/preload.js`, `/styles.css`, `/app.js` (zero external CDNs/fonts). |
| `NMCP-TC-018` | Theme tokens, narrow-pane responsiveness & reduced motion | `styles.css` binds host tokens (`--background`, `--foreground`, `--primary`, `--font-family`), supports `max-width: 420px`, and respects `prefers-reduced-motion: reduce`. |
| `NMCP-TC-019` / `NMCP-TC-020` / `NMCP-TC-020B` | Real Headless Chromium/Edge CDP E2E (runs on Node 22+ 3-OS CI & against real `main.mjs` + `sidecar_sdk` when installed; zero mock DOM) | Launches real system Chrome/Edge (`--headless=new`) over CDP against real `sidecars/mcp_manager/main.mjs` + `sidecar_sdk` (or loopback HTTP server + `attachSidecarSecurityMiddleware` on CI runners without Desktop): verifies zero CSP violations, zero JS exceptions, `styles.css` load, `serverUrl` card metadata, spoofed top-level / `file://` `postMessage` rejection, `smart-paste-input` Korean IME (`keyCode: 229`) `Ctrl+Enter` blocking, `type="password"` secret inputs + Cancel scrubbing, real `Clone to Global` (`pluginId`) secret preservation on disk, real `<input>` → `<section>` bubbling Korean IME `Escape` (`keyCode: 229` blocked vs `27` closes), real Raw JSON Stdio `428` confirmation gate, real `409 Conflict` banner, and real `MALFORMED_JSON` + CAS backup restore using deterministic `waitUntil` polling (`t.skip()` only if no Chromium/Edge binary exists). |
