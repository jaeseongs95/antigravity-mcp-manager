# Test Cases Specification (`antigravity-mcp-manager`)

**Languages:** **English** | **[한국어 섹션 바로가기](#테스트케이스-명세-국문)**

This document defines the pre-implementation test cases and verification oracles for `antigravity-mcp-manager`, executed via Node.js native test runner (`node --test test/mcp-manager.test.js`).

## Test Environment & Runner

- **Runner**: Node.js built-in `node:test` + `node:assert/strict` (`npm test` -> `node scripts/build.js && node --test test/mcp-manager.test.js`)
- **Target Boundary**: Public module exports (`src/*`, `scripts/*`) and compiled single-file bundle (`dist/mcp_manager_autoinject.js`) inside isolated `vm` / synthetic DOM / loopback WebSocket fixtures without modifying host global files.

## Test Case Matrix

| Case ID | Requirement / Defect ID | Level | Entry Point | Scenario & Input | Expected Oracle (Pass Condition) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `MCP-TC-001` | `D-0001` ~ `D-0016` | Unit / Integration | `createHostMcpBridge`, `createModalController`, `mountMcpManager`, `parseSmartMcpInput` | Verified baseline regressions (2-arg OAuth RPC, Settings sidebar tab exclusive highlight, persistence verification, `Ctrl+Alt+M` shortcut, companion loader) | All 16 verified baseline suites pass without regression. |
| `MCP-TC-017` | `D-0017`, `D-0027` | Unit | `mergeMcpManagerBlock`, `fetchHostInstalledPluginInfo` | Indented marker string literals inside `ko-thought-translator`, `(?:_V\d+)?` markers, CR-only line endings, and corrupted orphan `BEGIN` marker without `END` | Replaces or repairs blocks cleanly without truncating string literals or leaving duplicate orphan blocks; `.gitattributes` enforces LF. |
| `MCP-TC-018` | `D-0018` | Unit / Integration | `validateAndBuildServerSpec`, `createModalController` | Stdio server `description` preservation and HTTP server `headersText` editing | Preserves `description` on Stdio specs and round-trips custom HTTP headers in UI. |
| `MCP-TC-019` | `D-0019` | Unit | `bridge.openAuthUrl` | Non-`http(s):` URI schemes (`javascript:`, `file:`, `data:`, `ms-msdt:`) vs valid `https:`/`http:` URLs | Rejects non-`http(s):` URLs (`false`) without calling `window.open`. |
| `MCP-TC-020` | `D-0020` | Integration | `configureTargetViaCdp`, `injectViaCdpLive` | `Runtime.evaluate` exception handling, standalone 1-plugin `ALREADY_ACTIVE` guard, and Electron 35+ Browser CDP WS fallback | Rejects on `exceptionDetails`, avoids false `expectsKo`, and injects via Browser WS when `/json/list` is empty. |
| `MCP-TC-021` | `D-0021`, `D-0027` | Unit | `scripts/build.js` (`buildBundle`) | Multiline template literals after regexes AND string literals ending with even (`'a\\\\'`) vs odd trailing backslashes | Preserves template literal bodies and closes string literals with even trailing backslashes on the same line. |
| `MCP-TC-022` | `D-0022` | Integration | `controller.destroy()` | Calling `destroy()` while `MCP Servers` tab is active, with remote `iframe` and pending `DOMContentLoaded` listener | Restores native pane & `Models` tab highlight, removes styles, cleans up child `iframe`, and prevents zombie remounts. |
| `MCP-TC-023` | `D-0023` | Unit / Concurrency | `createHostMcpBridge` (`readMcpConfig`, `upsertCustomServer`, `toggleServerTool`, `toggleServerEnabled`) | 1) `svc.readFile` throws `EACCES` / RPC timeout / malformed JSON vs `ENOENT`; 2) Concurrent `Promise.all` calls to `toggleServerTool` / `upsertCustomServer` on slow `readFile`/`writeFile` | 1) Non-`ENOENT` read/parse error returns `{ ok: false, error }` and refuses to overwrite existing `mcp_config.json` with `{}`; 2) Serializes concurrent writes so zero updates are lost. |
| `MCP-TC-024` | `D-0024` | Integration | `createModalController` (Raw JSON `Save & Refresh`, Quick Auto-Add `multipleServers`, `Auto-Fill Form`) | 1) Saving Raw JSON or multi-server JSON via Quick Auto-Add; 2) Clicking `Auto-Fill Form` with multi-server JSON | 1) Calls `bridge.refreshServers()` after saving and merges against fresh config; 2) Prefills without `"undefined"` server name. |
| `MCP-TC-025` | `D-0025` | Concurrency | `openEditPopup`, `openOAuthConnectModal` | Rapid double-invocation while `reloadData()` is pending, closing before async resolution, and slow OAuth poll ticks | Renders at most one backdrop element per modal ID, cancels stale open requests on close, and prevents overlapping poll ticks. |
| `MCP-TC-026` | `D-0026` | Unit | `scripts/ensure_statusbar_patch.js` | `transformExactSize` with `//` and `/*` inside multiline strings/templates, NUL-padded ASAR JSON header, and `scriptJail`/`data:` URL guard | Preserves string literals, parses NUL-padded ASAR headers, and skips `scriptJail` / non-`http(s):` frames. |
| `MCP-TC-028` | `D-0028` | Unit | `parseArgsInput`, `encodeBase64`/`decodeBase64`, `destroy()`, `promoteCrossOriginRemoteIframe` | Escaped quotes (`"a \"b\" c"`), JSON empty arg (`["--prefix", ""]`), UTF-8 Basic Auth credentials, special chars in `data-agy-mcp-prev-nav` and `cdnBaseUrl` | Unescapes quoted args, preserves `""` in JSON arrays, encodes/decodes UTF-8 Base64 without `escape`/`unescape`, and escapes CSS selectors & HTML attributes. |
| `MCP-TC-029` | `D-0029`, `D-0033` | Unit | `src/host-adapter-config.js`, `createHostMcpBridge`, `mountMcpManager` | 1) Custom `hostConfig` overriding `rpcServicePrefix`, `remoteHostDomains`, `cdnOrigin`, and `companionScripts`; 2) Spoofed external hostnames (`antigravity.google.com.evil.example`, `evil-antigravity.google.com`) vs exact/dot-boundary subdomains | 1) Uses injected adapter configuration with zero hardcoded vendor coupling; 2) `isRemoteHost` strictly accepts only exact match (`host === d`) or dot-boundary subdomain (`host.endsWith('.' + d)`) and rejects substring spoofing (`false`). |
| `MCP-TC-030` | `D-0030`, `D-0031`, `D-0032` | Static / Integration | `.github/workflows/ci.yml`, `README.md`, `README.ko.md`, `docs/templates/*`, `ensure_statusbar_patch.js` | GitFlow CI branch triggers, documentation templates, formal tone, version parity, and Node.js 20 LTS (`globalThis.WebSocket === undefined`) RFC 6455 client | CI covers GitFlow branches + `workflow_dispatch`; templates and bilingual docs match `package.json`; live CDP injection succeeds without global `WebSocket`. |
| `MCP-TC-034` | `D-0034` | Unit | `ensureRemoteCompanionScripts`, `mountMcpManager` (`getOrCreateTrustedTypesPolicy`) | CSP environment recording all `trustedTypes.createPolicy` candidate names and rejecting policy creation to exercise Blob URL fallback | Never attempts global/framework policy names (`'default'`, `'dompurify'`, `'angular'`, `'angular#unsafe-bypass'`); uses only plugin-scoped `agy-mcp-*` / `agy-companion-*` names and falls back cleanly to `Blob` URL. |

---

## 테스트케이스 명세 (국문)

본 문서는 구현 및 결함 수정에 앞서 `antigravity-mcp-manager`의 공개 진입점별 검증 사례와 판정 기준(Oracle)을 정의합니다.

- **실행 명령**: `npm test` (`node scripts/build.js && node --test test/mcp-manager.test.js`)
- **격리 원칙**: 모든 시험은 메모리 내 가상 컨텍스트(`node:vm`), 합성 DOM, 로컬 루프백 픽스처에서만 수행하며 호스트 PC의 전역 경로를 수정하지 않습니다.
- **검증 범위**: 기존 검증 완료 항목(`D-0001`~`D-0016`), 이전 수정 보완 항목(`D-0017`~`D-0022`), 신규 등록 항목(`D-0023`~`D-0031`) 전건을 위 표의 `MCP-TC-001`~`MCP-TC-030` 케이스로 검증합니다.
