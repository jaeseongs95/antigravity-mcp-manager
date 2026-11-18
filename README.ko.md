# Antigravity 커스텀 MCP 서버 매니저 (`antigravity-mcp-manager` `v2.0.0`)

**언어 (Languages):** **[English (README.md)](./README.md)** | **한국어 ([README.ko.md](./README.ko.md))**

**Google Antigravity 2.0 네이티브 데스크톱 앱** 및 **원격 제어 웹(`https://antigravity.google.com/r/...`)**에서 공식 카탈로그에 없는 **사용자 지정 MCP 서버**(HTTPS / 루프백 HTTP Streamable MCP 서버 및 `npx`, `uvx`, `node`, `python`, `docker`, `deno`, `bun`, `pnpx` 등 로컬 `Stdio` 프로세스)를 앱 재시작 없이 안전하게 추가·OAuth 인증·수정·삭제·토글할 수 있는 확장 도구입니다.

---

## 목차 (Table of Contents)

1. [개요 및 v2.0.0 아키텍처 핵심 변경점](#개요-및-v200-아키텍처-핵심-변경점)
2. [데스크톱 앱 설치, 제거 및 ASAR 원복 안내](#데스크톱-앱-설치-제거-및-asar-원복-안내)
3. [원격 제어 웹 북마클릿 & 유저스크립트 안내](#원격-제어-웹-북마클릿--유저스크립트-안내)
4. [실행 위치 및 단축키 안내](#실행-위치-및-단축키-안내)
5. [보안 및 설정 무결성 보장](#보안-및-설정-무결성-보장)
6. [저장소 구조](#저장소-구조)
7. [검증 및 테스트](#검증-및-테스트)

---

## 개요 및 v2.0.0 아키텍처 핵심 변경점

- **육각형(Ports & Adapters) 아키텍처 전면 재설계 (`v2.0.0`)**:
  - **`src/core/**` (호스트·DOM·타이머·벤더 전역 참조 0건)**: 순수 ECMAScript 도메인 서비스(`McpManagerService`), `Promise.all` 안전 FIFO `AsyncMutex`, UTF-16 고정 JSONC 스팬 편집기(`jsonc-codec.js`), 단일 정규 URL 및 보안 스키마 검증기, 순수 UTF-8 SHA-256, LIFO `DisposableStore`로 구성됩니다.
  - **`src/ui/**` (벤더 중립 안전 UI)**: 선언형 안전 DOM 빌더(`h()`, `innerHTML`/`document.write` 0건), 주입형 폴백 초점 복귀를 지원하는 ARIA 포커스 트랩, 스크롤 위치 보존, 한국어 한글 IME 조합 보호(`isComposing` / `229`)를 제공합니다.
  - **`src/adapters/antigravity/**` (호스트 어댑터 격리)**: 상한 제한 React Fiber 탐색기, 참조 카운트 기반 Angular 19 `RemoteControlComponent` 리스, Connect-JSON `proxyCommand` 전송기, 6-상태 원격 워크벤치 승격 FSM(`base-uri 'self'` 및 `require-trusted-types-for 'script'` 준수), WebIDL 표준 정합 CDN Worker 브릿지를 캡슐화합니다.
- **다중 동반 플러그인 무간섭 공존**:
  - 줄 시작 앵커 마커(`BEGIN_AGY_MCP_MANAGER_V1` .. `END_AGY_MCP_MANAGER_V1`), `PASSIVE_ATTACHED` 수동 결합, `.agy-ctx-statusbar` 외부의 독립 런처(`#agy-mcp-remote-launcher`)로 `antigravity-statusbar` 및 `ko-thought-translator`와 충돌 없이 공존합니다.

---

## 데스크톱 앱 설치, 제거 및 ASAR 원복 안내

```bash
git clone https://github.com/jaeseongs95/antigravity-mcp-manager.git
cd antigravity-mcp-manager

# 1. 런타임 + 자립형 패처 번들 빌드 및 11개 계층별 단위·통합·실브라우저 Chromium E2E 스위트 실행
npm test

# 2. ~/.gemini/antigravity 설치, V5 ASAR 패치(asar_v5_backup.json 기록) 및 실시간 CDP 반영
npm run install-mcp-manager

# 3. 비변이 패치 및 동반 플러그인 상태 점검
npm run status

# 4. MCP 매니저 제거 (동반 플러그인 잔존 시 공유 ASAR 패치 보존, 단독 설치 시 app.asar 완전 원복)
npm run uninstall-mcp-manager

# 5. 전용 ASAR 바이너리 원복 (동반 파일 삭제 없이 originalAsarSha256 및 patchedHeaderSha256 3중 검증 후 원복)
npm run restore-asar
```

> **구버전(`v1.5.0`) 백업 유의사항**: `v2.0.0`부터는 `install` 시 원본 엔트리 버퍼와 전체 아카이브 SHA-256 해시를 `~/.gemini/antigravity/asar_v5_backup.json`에 기록하여 3중 무결성 검증 후 원복합니다. 만약 `asar_v5_backup.json` 없이 `v1.5.0` 이하 패처로 패치된 상태라면 `--restore`는 임의 파일 덮어쓰기를 막기 위해 `RESTORE_BACKUP_MISSING`으로 안전 중단되므로, 이 경우 Antigravity `resources/` 폴더의 기존 `app.asar.v*.orig` 백업본으로 먼저 수동 복원한 뒤 `v2.0.0`을 설치하세요.

---

## 원격 제어 웹 북마클릿 & 유저스크립트 안내

원격 제어 웹(**`https://antigravity.google.com/r/...`**) 접속 시 아래 한 줄 북마클릿 코드를 브라우저 북마크의 **URL** 칸에 저장해 실행하세요:

```javascript
javascript:(()=>{fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js?t='+Date.now()).then(r=>{if(!r.ok)throw new Error(r.status);return r.text()}).then(c=>{const s=document.createElement('script'),n=[...document.querySelectorAll('script,style,link')].map(x=>x.nonce||x.getAttribute('nonce')).find(Boolean),t=window.trustedTypes;let p=null;if(t?.createPolicy){for(const k of['agy-mcp-bm','agy-mcp-'+Date.now()])try{let u=1;p=t.createPolicy(k,{createScript:x=>{if(!u)throw new TypeError();u=0;return x}});break}catch{}}if(t&&!p)return;if(n){s.nonce=n;s.setAttribute('nonce',n)}s.text=p?p.createScript(c):c;document.head.appendChild(s)})})();
```

또는 Tampermonkey / Violentmonkey / AdGuard 유저스크립트에 `https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js` 주소를 등록해 자동 실행할 수 있습니다.

---

## 실행 위치 및 단축키 안내

| 진입 경로 | 여는 방법 | 제공 기능 |
| :--- | :--- | :--- |
| **`Settings(설정)` 모달 -> `MCP Servers` 탭** | Antigravity `Settings` 열기 -> 좌측 **`MCP Servers`** (`settings-nav-item-McpManager`) 클릭 | 빠른 자동 추가, 서버 카드 목록, OAuth 연결, 편집 팝업을 제공하며 다른 설정 탭으로 이탈 시 입력 중인 민감 초안을 자동 소거합니다. |
| **`Customizations` -> `MCP Servers` 섹션** | `Customizations` -> `MCP Servers` 이동 | `+ Add MCP` 옆의 **`Edit MCP Servers`** 버튼으로 기존 서버를 즉시 수정·삭제합니다. |
| **원격 호스트 상단 런처 (`#agy-mcp-remote-launcher`)** | `https://antigravity.google.com/r/...` 우측 **`MCP Servers`** 버튼 클릭 | `.agy-ctx-statusbar`에 개입하지 않고 데스크톱·모바일 브라우저에서 독립 모달을 엽니다. |
| **단축키 (`Ctrl+Alt+M`)** | 화면 어디서나 **`Ctrl+Alt+M`** 입력 | 독립 커스텀 MCP 서버 매니저 모달을 여닫습니다(VS Code 기본 `Ctrl+Shift+M` 보존). |

---

## 보안 및 설정 무결성 보장

1. **전 `Stdio` 명령 및 `PATH` 확인 게이트**: 빠른 추가(Quick Auto-Add)에서 모든 로컬 명령 스펙(`command`, `npx`/`uvx` 패키지·GitHub URL, 다중 서버 JSON 내 `command`)과 `PATH` 재정의는 분해된 `command`·`args`·`env` 키를 먼저 표시하고 사용자 확인 후에만 저장·기동합니다.
2. **단일 정규 URL 강제 및 평문 HTTP 자격증명 차단**: 서로 다른 `url`/`serverUrl`(Split-URL) 및 `command`+`url` 혼합 스펙을 즉시 거부하며, 비루프백 평문 `http://` 엔드포인트에는 자격증명 저장 및 일괄 병합(`applyAuthToAllHttp`)을 원천 차단하고 레거시 `localStorage` 평문 백업을 기동 시 즉시 삭제합니다.
3. **SHA-256 CAS 및 엄격한 `ENOENT` 분리**: 쓰기 직전 SHA-256 재검증으로 외부 편집 덮어쓰기(`CONFLICT`)를 방지하고 JSONC 주석과 0바이트 `mcp_config.json` 복구 흐름을 보존하며, HTTP `404` / `"Instance not found"` 전송 오류를 파일 미존재로 오인하지 않습니다.
4. **일회용 범위 제한 `TrustedTypes`**: 공용 정책 이름을 절대 침범하지 않고 `createHTML` 미정의, 일회용 토큰 즉시 폐기, `Window`별 `WeakMap` 부정 캐시를 적용합니다.

---

## 저장소 구조

```text
antigravity-mcp-manager/
├── src/
│   ├── core/                      # 순수 ECMAScript 도메인, 포트, AsyncMutex, SHA-256, JSONC 및 보안 스키마
│   ├── security/                  # 일회용 범위 제한 TrustedTypes 정책 및 CSP 논스 헬퍼
│   ├── shared/                    # 줄 시작 앵커 마커 매니페스트 및 Window 바인딩 DOM 수명 래퍼
│   ├── ui/                        # 안전 DOM 빌더, 반응형 스타일 토큰, 모달 컨트롤러 및 5개 모듈형 뷰
│   ├── adapters/antigravity/      # Fiber 게이트웨이, RemoteControl 리스, RPC, 포트 어댑터 및 원격 워크벤치 FSM
│   └── index.js                   # 조립 루트 (window.agyMcpManager, version: '2.0.0')
├── scripts/
│   ├── lib/                       # js-lexer, file-lock, 순수 asar-patcher, rfc6455-ws 및 cdp-injector
│   ├── patcher-entry.js           # 자립형 패처 CLI (--status, --restore, --uninstall, hook)
│   ├── build.js                   # 이중 번들러 -> dist/mcp_manager_autoinject.js & dist/ensure_statusbar_patch.js
│   ├── install.js                 # 양방향 ASAR 역롤백을 갖춘 2단계 트랜잭션 설치/제거기
│   └── run-tests.js               # 3-OS 호환 재귀 Node 테스트 실행기
├── dist/                          # 단일 파일 런타임 및 자립형 패처 번들 산출물
├── docs/TEST_CASES.md             # MCP-TC-001 ~ MCP-TC-050 한/영 사전 테스트케이스 명세서
└── test/                          # 11개 계층별 단위·보안·어댑터·UI·스크립트·실브라우저 Chromium E2E 스위트
```

---

## 검증 및 테스트

```bash
npm test
```

## 라이선스

MIT License — [LICENSE](./LICENSE) 참조.
