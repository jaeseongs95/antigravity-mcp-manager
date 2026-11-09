# Antigravity 커스텀 MCP 서버 매니저 (`antigravity-mcp-manager` `v1.4.14`)

**언어 (Languages):** **[English (README.md)](./README.md)** | **한국어 ([README.ko.md](./README.ko.md))**

**Google Antigravity 2.0 네이티브 데스크톱 앱** 및 **원격 제어 웹(`https://antigravity.google.com/r/...`)**의 **`Settings(설정)` -> `MCP Servers(MCP 서버)` 탭**과 **`Customizations(맞춤 설정)` -> `MCP Servers`** 화면에서 공식 카탈로그에 없는 **사용자 지정 MCP 서버**(원격 OAuth MCP 포털/서버 및 로컬 `Stdio` 명령 `npx`, `uvx`, `node`, `python`, `docker`, `deno`, `bun`, `pnpx`)를 앱 재시작 없이 즉시 추가·OAuth 인증·수정·삭제·토글할 수 있는 확장 도구입니다.

---

## 목차 (Table of Contents)

1. [개요 및 핵심 기능](#개요-및-핵심-기능)
2. [데스크톱 앱 설치 및 사용법 (로컬 PC)](#데스크톱-앱-설치-및-사용법-로컬-pc)
3. [원격 제어 웹(Remote Control) 북마클릿 & 유저스크립트 안내](#원격-제어-웹remote-control-북마클릿--유저스크립트-안내)
4. [실행 위치 및 단축키 안내](#실행-위치-및-단축키-안내)
5. [OAuth 및 커스텀 MCP 서버 등록 방법](#oauth-및-커스텀-mcp-서버-등록-방법)
6. [호스트 설치 맞춤형 동반 플러그인 자동 로드](#호스트-설치-맞춤형-동반-플러그인-자동-로드)
7. [저장소 구조](#저장소-구조)
8. [검증 및 테스트](#검증-및-테스트)

---

## 개요 및 핵심 기능

1. **네이티브 앱 & 원격 웹 `Settings(설정)` 좌측 사이드바 `"MCP Servers(MCP 서버)"` 탭 통합**
   - `Settings(설정)` 모달 좌측 사이드바의 `"Models(모델)"` / `"한글 번역"` 탭 바로 아래에 **`"MCP Servers"` (`settings-nav-item-McpManager`)** 전용 탭을 추가합니다.
   - 탭 클릭 시 설정창 내부에서 실시간 상태 알림 배너(`.agy-mcp-status-banner`), `⚡ 빠른 자동 추가(Quick Auto-Add)`, `+ 커스텀 MCP 서버 추가`, 서버별 `⚙️ 설정 수정`, `🔗 <서버이름> 연결 ↗`, 개별 도구(Tools) ON/OFF 토글, `{ } mcp_config.json 직접 편집`을 모두 바로 수행할 수 있습니다.
2. **OAuth 중심 사용자 지정 MCP 서버 등록 & 자동 `<서버이름> 연결 ↗` 모달**
   - 원격 MCP 포털/서버 URL만 입력하면 안티그래비티 호스트(`language_server.exe`)의 RFC 9728 / RFC 8414 OAuth Discovery(`/.well-known/oauth-protected-resource` 및 `/.well-known/oauth-authorization-server`)를 통해 `authUrl`을 자동 감지하고 즉시 **`Connect <ServerName>` (`<서버이름> 연결`) 모달**을 띄웁니다.
   - 브라우저 자동 콜백은 물론, 원격 환경에서 인가 코드(Authorization Code)나 콜백 URL 전체를 직접 붙여넣어 제출하는 수동 완료(`completeMcpOAuth(serverName, code)`)도 완벽히 지원합니다.
3. **스마트 자동 파서 (`⚡ Quick Auto-Add`)**
   - 원격 MCP URL 한 줄, `curl -H "Authorization: ..."` 명령어, `mcp_config.json` JSON 조각, 또는 로컬 `Stdio` 실행 명령어(`npx`, `uvx`, `node`, `python`, `docker`, `deno`, `bun`, `pnpx` 등 — URL 인자가 포함된 Stdio 명령 포함)를 붙여넣고 **`자동 추가 및 연결`** 또는 **`양식 자동 채우기`**를 누르면 형식을 자동으로 판별해 등록·프리필합니다.
4. **호스트 `mcp_config.json` 영구 저장을 검증하여 보장**
   - 기존 등록된 서버가 0개인 초기 설치 환경에서도 React Fiber `selectedGeminiDir`, `GetLocalUserInfo`(`homeDirUri`), `GetCustomizationStates` 폴백을 통해 `~/.gemini/config/mcp_config.json` 경로를 정확히 찾아 기록하며, 호스트 파일 쓰기 실패 시 거짓 성공을 반환하지 않고 정확한 오류 배너를 표시합니다.
5. **영어(English) 기본 UI + `ko-thought-translator` 한글 번역 패치 자동 연동**
   - 기본 UI는 깔끔한 영어로 제공되며, `ko-thought-translator` 한글 패치가 활성화되어 있으면 모든 버튼·모달·배너가 자연스러운 한국어로 자동 변환됩니다.
6. **단독 설치(1개) 및 다중 설치(2~3개) 완벽 호환**
   - 자체 패처(`scripts/ensure_statusbar_patch.js`)를 내장하여 `antigravity-mcp-manager` 단독 설치 시에도 데스크톱 앱과 원격 웹에서 독립적으로 작동하며, `antigravity-statusbar` 및 `ko-thought-translator`와 함께 설치된 경우에도 충돌 없이 결합됩니다.

---

## 데스크톱 앱 설치 및 사용법 (로컬 PC)

```bash
git clone https://github.com/jaeseongs95/antigravity-mcp-manager.git
cd antigravity-mcp-manager

# 1. 단위 테스트 및 번들 통합 회귀 테스트 실행 (16/16 통과)
npm test

# 2. dist/mcp_manager_autoinject.js 빌드, ~/.gemini/antigravity 설치, app.asar 패치 및 CDP 즉시 주입
npm run install-mcp-manager

# 3. ASAR 패치 및 실시간 CDP 주입 상태 확인
npm run status
```

---

## 원격 제어 웹(Remote Control) 북마클릿 & 유저스크립트 안내

외부 PC나 태블릿·스마트폰 브라우저(Chrome / Safari / Edge)에서 **`https://antigravity.google.com/r/...`** 원격 제어 웹으로 접속할 때는 로컬 PC의 Electron `preload.js`가 원격 브라우저에서 자동 실행되지 않습니다. 아래 **북마클릿(Bookmarklet)**을 북마크바에 한 번 등록해 두면 **클릭 한 번으로 커스텀 MCP 서버 매니저와 호스트에 설치된 동반 플러그인들을 원격 웹에서도 그대로 사용**할 수 있습니다.

### 방법 1: 원클릭 북마클릿 (모바일 및 데스크톱 크롬 권장)

아래 한 줄짜리 `javascript:` 코드를 복사하여 브라우저 북마크(즐겨찾기)의 **URL(주소)** 칸에 붙여넣으세요:

```javascript
javascript:(()=>{fetch('https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js?t='+Date.now()).then(r=>r.text()).then(c=>{const s=document.createElement('script'),n=document.querySelector('script[nonce]')?.nonce,p=window.trustedTypes?.createPolicy('agy-mcp-'+Date.now(),{createScript:x=>x});if(n)s.nonce=n;s.text=p?p.createScript(c):c;document.head.appendChild(s)})})();
```

#### 데스크톱 브라우저(Chrome / Edge / Brave) 북마크바 등록 및 실행 방법
1. 브라우저 상단 **북마크바(즐겨찾기 모음)**를 우클릭하고 **페이지 추가...**(또는 **북마크 추가**)를 클릭합니다(단축키: `Ctrl+Shift+O` 북마크 관리자).
2. **이름**에 `AGY MCP 매니저` (원하는 이름)를 입력합니다.
3. **URL** 칸에 위 `javascript:(()=>{...})();` 코드 전체를 붙여넣고 **저장**을 누릅니다.
4. Antigravity 원격 제어 웹(`https://antigravity.google.com/r/...`)에 접속한 뒤, 북마크바의 **`AGY MCP 매니저`** 버튼을 한 번 클릭합니다.
5. 즉시 `Settings(설정)` 모달의 `MCP 서버` 탭과 `Customizations`의 `+ 커스텀 MCP` 버튼이 활성화되며, 호스트 PC에 `antigravity-statusbar`나 `ko-thought-translator`가 설치되어 있다면 자동으로 함께 로드됩니다.

#### 모바일 크롬(Android / iOS) 북마크 등록 및 실행 방법
1. 모바일 크롬에서 아무 페이지나 북마크(⭐)한 뒤 **수정(Edit)**을 누릅니다.
2. **이름**을 `AGY MCP 매니저`로 바꾸고, **URL** 칸의 기존 주소를 지운 뒤 위 `javascript:(()=>{...})();` 코드를 붙여넣어 저장합니다.
3. 원격 제어 웹(`https://antigravity.google.com/r/...`) 화면이 열린 상태에서 **상단 주소창을 터치**하고 `AGY MCP 매니저`를 입력합니다.
4. 자동 완성 목록에 나타나는 **`⭐ AGY MCP 매니저`** 북마크 항목을 터치하면 현재 화면에서 즉시 북마클릿이 실행됩니다. *(모바일 크롬에서는 북마크 메뉴가 아니라 주소창 검색 제안에서 `javascript:` 북마크를 눌러야 현재 탭에서 실행됩니다.)*

### 방법 2: Tampermonkey / AdGuard 유저스크립트 자동 실행

`dist/mcp_manager_autoinject.js` 상단에는 `https://antigravity.google.com/*`에서 동작하는 `// ==UserScript==` 헤더가 기본 내장되어 있습니다.

1. Tampermonkey(또는 Violentmonkey / AdGuard 유저스크립트) 대시보드에서 **URL로부터 설치**를 엽니다.
2. 아래 주소를 입력하고 **설치**를 클릭하면, 앞으로 `https://antigravity.google.com/r/...`에 접속할 때마다 클릭 없이 자동으로 로드됩니다:
   ```text
   https://raw.githubusercontent.com/jaeseongs95/antigravity-mcp-manager/main/dist/mcp_manager_autoinject.js
   ```

---

## 실행 위치 및 단축키 안내

| 진입 경로 | 여는 방법 | 제공 기능 |
| :--- | :--- | :--- |
| **`Settings(설정)` 모달 -> `MCP Servers(MCP 서버)` 탭** | 좌측 하단 `Settings(⚙️)` 열기 -> 좌측 사이드바에서 **`MCP 서버`** 클릭 | 설정창 내부에서 `⚡ 빠른 자동 추가`, 서버 카드 목록, OAuth 연결, 도구(Tools) 개별 토글, `mcp_config.json` 원문 편집을 한눈에 수행합니다. |
| **`Customizations(맞춤 설정)` -> `MCP Servers` 섹션** | `Customizations` -> `MCP Servers` 이동 | 섹션 헤더의 **`+ 커스텀 MCP`** 버튼 및 각 서버 행 우측의 **`⚙️ 설정 수정`** / **`🔗 OAuth 연결`** 버튼을 제공합니다. |
| **독립 매니저 모달 (`Ctrl+Alt+M`)** | 화면 어디서나 **`Ctrl+Alt+M`** 입력 | 커스텀 MCP 서버 매니저 전체 모달을 즉시 띄웁니다(VS Code 기본 문제 패널 단축키인 `Ctrl+Shift+M`과 충돌하지 않도록 `Ctrl+Alt+M`을 사용합니다). |

---

## OAuth 및 커스텀 MCP 서버 등록 방법

1. **원격 OAuth MCP 서버 (`Server URL` + `OAuth`)**:
   - **`+ 커스텀 MCP 서버 추가`** 버튼을 클릭하거나 **`⚡ 빠른 자동 추가`** 입력창에 서버 URL을 붙여넣습니다.
   - 연결 방식을 **`서버 URL (원격 HTTP / SSE)`**로 두고 서버 이름과 URL을 입력한 뒤 인증 방식을 기본값인 **`OAuth`**로 유지합니다.
   - 서버에 별도 고정 `Client ID`, `Client Secret`, `기본 스코프(Scopes)`가 필요한 경우에만 하단 **`고급 OAuth 설정 >`** 아코디언을 열어 입력합니다.
   - **`저장 및 적용`**을 누르면 OAuth Discovery가 실행되며, **`<서버이름> 연결`** 모달이 자동으로 열립니다. **`<서버이름> 연결 ↗`** 버튼을 눌러 브라우저 인증을 완료하거나, 리다이렉트된 콜백 URL/인가 코드를 입력칸에 붙여넣어 즉시 연결할 수 있습니다.
2. **Bearer 토큰 / API Key 헤더 / Basic 인증 원격 서버**:
   - 연결 방식을 **`서버 URL`**로 선택하고 인증 방식에서 **`Bearer 토큰`**, **`API 키 헤더`**, **`Basic 인증`** 중 하나를 골라 토큰/키를 입력합니다.
3. **로컬 / 터널 `Stdio` MCP 서버 (`npx`, `uvx`, `node`, `python`, `docker`, `deno`, `bun`, `pnpx`)**:
   - 연결 방식을 **`로컬 / 터널 (Stdio 프로세스)`**로 전환하거나, **`⚡ 빠른 자동 추가`** 칸에 실행 명령어 전체를 붙여넣고 **`양식 자동 채우기`**를 클릭합니다.
   - 실행 명령어(Command), 인자(Args), 환경 변수(`KEY=VALUE`)를 확인한 뒤 **`저장 및 적용`**을 클릭합니다.

---

## 호스트 설치 맞춤형 동반 플러그인 자동 로드

원격 웹(`https://antigravity.google.com/r/...`)에서 `antigravity-mcp-manager` 북마클릿을 실행하면 `LanguageServerService`(`GetCustomizationStates` / `GetAllSkills` / `ReadFile`)를 통해 호스트 PC의 `~/.gemini/antigravity/statusbar_autoinject.js` 및 설치 목록을 먼저 확인합니다:

- **호스트에 `antigravity-mcp-manager` 1개만 단독 설치된 경우**: `antigravity-mcp-manager`만 로드하며, 설치하지 않은 다른 플러그인을 강제로 불러오지 않습니다.
- **호스트에 `antigravity-statusbar` 및/또는 `ko-thought-translator`가 함께 설치된 경우**: 호스트에 실제로 설치된 동반 플러그인만 자동으로 함께 로드합니다(다중 TrustedTypes 정책 및 Blob URL 폴백과 호스트 로컬 번들 오프라인 폴백 지원).

---

## 저장소 구조

```text
antigravity-mcp-manager/
├── src/
│   ├── index.js                   # Settings 사이드바 탭, Customizations 버튼 주입, Ctrl+Alt+M 및 동반 플러그인 로더
│   ├── host-mcp-bridge.js         # React Fiber & 원격 proxyCommand RPC 브릿지, OAuth Discovery 및 mcp_config.json 입출력
│   ├── modal-ui.js                # TrustedTypes 안전 모달 UI (서버 추가/수정, OAuth 연결, Settings 탭 화면, JSON 편집기)
│   └── mcp-config-schema.js       # 프리셋 템플릿, 스마트 자동 파서(URL/curl/JSON/Stdio), OAuth 및 설정 스키마 검증
├── dist/
│   └── mcp_manager_autoinject.js  # Electron / CDP / UserScript 겸용 단일 파일 런타임 번들 산출물
├── scripts/
│   ├── build.js                   # 무의존성 CommonJS 번들러 (src/ -> dist/mcp_manager_autoinject.js)
│   ├── ensure_statusbar_patch.js  # 오프셋 보존 ASAR 패처 + app_storage 동기화 + 실시간 CDP 주입기
│   └── install.js                 # 번들 빌드 후 ~/.gemini/antigravity 설치 및 패처 실행
├── test/
│   └── mcp-manager.test.js        # 개별 모듈 단위 테스트 + 런타임 번들 통합·회귀 테스트
├── README.md                      # 영문 안내 문서 (English)
├── README.ko.md                   # 국문 안내 문서 (Korean)
└── package.json
```

---

## 검증 및 테스트

```bash
# dist/mcp_manager_autoinject.js 빌드 및 16개 단위·통합 회귀 테스트 실행
npm test
```

## 라이선스

MIT
