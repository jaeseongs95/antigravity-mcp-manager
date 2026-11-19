# `antigravity-mcp-manager` Clean-Slate Test Case Specification (`v2.0.0` Native Plugin + UI Sidecar)

## 1. Core Purity & Domain Schema (`test/core/purity-and-schema.test.mjs`)

| ID | Verification Target | Pass Condition |
| :--- | :--- | :--- |
| `NMCP-TC-001` | `src/core/**` vendor & runtime purity | Zero imports/references to `node:fs`, `node:path`, `node:os`, `node:child_process`, `node:http`, `sidecar_sdk`, `window`, `document`, `antigravity`, `electron`, `react`, `angular`. |
| `NMCP-TC-002` | `sha256Hex` FIPS 180-4 & UTF-8 surrogate parity | Matches `node:crypto` SHA-256 on empty string, ASCII, Korean multi-byte UTF-8, and astral emoji (`🚀`). |
| `NMCP-TC-003` | Static transport & schema validation (`validator.mjs`) | Validates Stdio (`command`, `args[]`, `env{}`) and Streamable HTTP (`url`/`serverUrl`, `headers{}`); rejects dual `command`+`url`, empty command/url, non-http(s) schemes, prototype-pollution keys (`__proto__`, `constructor`, `prototype`), and flags dangerous `env` keys (`NODE_OPTIONS`, `LD_PRELOAD`, `PATH`, etc.) and non-loopback plaintext `http://` credentials. |
| `NMCP-TC-004` | Secret redaction (`secret-redactor.mjs`) | Masks `env` and `headers` values and URL embedded credentials in redacted views/logs while preserving non-secret structural metadata. |
| `NMCP-TC-005` | Declarative Smart Paste (`input-parser.mjs`) | Parses `mcpServers` map, single named entry, raw server spec, and Streamable HTTP URL; normalizes legacy `serverUrl` → `url`; detects legacy `/sse` URLs with explicit warning + editable `mcp-remote` Stdio preview (never auto-executes or silently rewrites). Rejects raw shell strings safely. |
| `NMCP-TC-006` | Collision detector (`collision-detector.mjs`) | Detects exact and case-insensitive server key collisions within global scope and between global and read-only plugin inventories. |

## 2. Lossless Document Engine & Manager Service (`test/core/document-and-service.test.mjs`)

| ID | Verification Target | Pass Condition |
| :--- | :--- | :--- |
| `NMCP-TC-007` | Lossless unknown-key preservation (`document-engine.mjs`) | Adding, updating, toggling `disabled`, or deleting one server preserves unknown top-level keys, unknown per-server keys (including `disabledTools` and future host keys), and untouched sibling servers verbatim. |
| `NMCP-TC-008` | Fail-closed malformed JSON recovery | Corrupted JSON on disk returns `MALFORMED_JSON` with error position/message, blocks structured mutations (never coerces to `{ mcpServers: {} }`), and allows explicit valid Raw JSON repair. |
| `NMCP-TC-009` | Optimistic concurrency (`baseSha256` CAS) | Stale `baseSha256` fails with `CONFLICT` (`409`) without mutating disk state; re-reading fresh digest allows save. |
| `NMCP-TC-010` | `ManagerService` end-to-end use cases | Covers CRUD, native `disabled` toggle, read-only plugin inventory + Clone-to-Global, read-only legacy 1-time import preview (zero mutation of legacy source), and Stdio confirmation gate enforcement. |

## 3. FS Config Store & Antigravity Adapter (`test/adapters/fs-store-and-antigravity.test.mjs`)

| ID | Verification Target | Pass Condition |
| :--- | :--- | :--- |
| `NMCP-TC-011` | Write Jail & symlink escape defense (`fs-config-store.mjs`) | Writes ONLY to canonical target `mcp_config.json`; hard-rejects `config.json`, `plugins/*/mcp_config.json`, legacy paths, and symlinks resolving outside canonical target directory. |
| `NMCP-TC-012` | Atomic write, advisory lock, private backup & restore | Same-FS temp file + `fsync` + atomic replace; rejects concurrent lock conflict; creates private backup before overwrite and restores last good backup on request. |
| `NMCP-TC-013` | Antigravity dialect, paths & read-only LS inspector (`adapters/antigravity/*`) | Resolves `~/.gemini/config/mcp_config.json` (sole R/W), `plugins/*/mcp_config.json` (RO), and `~/.gemini/antigravity/mcp_config.json` (RO); calls `GetMcpServerStates` & `GetAllPlugins` with `x-codeium-csrf-token` and returns strictly redacted DTOs without leaking `ANTIGRAVITY_CSRF_TOKEN` or `env`/`headers`. |

## 4. Sidecar HTTP Security & Manifest Contract (`test/adapters/sidecar-http-security.test.mjs`)

| ID | Verification Target | Pass Condition |
| :--- | :--- | :--- |
| `NMCP-TC-014` | Official plugin & sidecar manifest contract | `plugin.json` contains only documented top-level fields + valid `assets/logo.svg`; `sidecars/mcp_manager/sidecar.json` declares `has_web_ui: true` and `SIDECAR_UI_ENTRYPOINT_AUX_PANE`; zero `SKILL.md` or `app.asar` patch artifacts exist. |
| `NMCP-TC-015` | Sidecar `POST`-only API, token enforcement, CSP & zero `child_process` | All `/api/*` routes reject `GET` (`405`) and unauthenticated `POST` (`401`); authenticated `POST` succeeds with `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`; `src/adapters/sidecar/**` and `sidecars/**` contain zero `child_process` imports/calls. |
| `NMCP-TC-016` | Secret non-disclosure over HTTP | API responses mask `env`/`headers` by default and never echo `ANTIGRAVITY_CSRF_TOKEN` or Sidecar `process.env`; error responses redact credentials. |

## 5. AUX_PANE UI Safety & Accessibility (`test/ui/ui-safety-and-a11y.test.mjs`)

| ID | Verification Target | Pass Condition |
| :--- | :--- | :--- |
| `NMCP-TC-017` | Zero unsafe DOM sinks (`sidecars/mcp_manager/ui/**`) | Zero `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function` in UI JS; `index.html` loads only `/preload.js`, `/styles.css`, `/app.js` (zero external CDNs/fonts). |
| `NMCP-TC-018` | Theme tokens, narrow-pane responsiveness & reduced motion | `styles.css` binds host tokens (`--background`, `--foreground`, `--primary`, `--font-family`), supports `max-width: 420px`, and respects `prefers-reduced-motion: reduce`. |
| `NMCP-TC-019` | Korean IME guard & secret input masking | `app.js` guards `isComposing || keyCode === 229` on Enter/Escape, uses `type="password"` for secret inputs, and clears draft secrets on cancel/close. |
| `NMCP-TC-020` | Broken-JSON recovery & CAS `409` conflict UX | UI renders explicit Raw JSON recovery banner on `MALFORMED_JSON` and explicit Reload/Retry banner on `409 CONFLICT` without silent overwrite. |
