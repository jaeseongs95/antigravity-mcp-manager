# Antigravity 커스텀 MCP 서버 매니저 (`antigravity-mcp-manager`)

[English Documentation (README.md)](./README.md)

**Google Antigravity 2.0 네이티브 데스크톱 앱** 및 **원격 제어 웹(`https://antigravity.google.com/r/...`)**의 좌측 **`Settings(설정)` -> `MCP Servers(MCP 서버)` 탭**과 **`Customizations(맞춤 설정)` -> `MCP Servers`** 화면에서 공식 카탈로그에 없는 **사용자 지정 MCP 서버**(원격 OAuth MCP 포털/서버 및 로컬 `Stdio` 명령 `npx`, `uvx`, `node`, `python`, `docker`)를 앱 재시작 없이 즉시 추가·OAuth 연결·수정·삭제·토글할 수 있는 확장 도구입니다.

---

## 주요 기능 (`v1.4.0`)

1. **전 세계 사용자를 위한 영어(English) 기본 UI + `ko-thought-translator` 한글 패치 자동 연동**
   - 기본 UI는 영어(`MCP Servers`, `Add Custom MCP Server`, `Connect <ServerName> ↗`, `Advanced OAuth Settings` 등)로 표시되며, `ko-thought-translator` 한글 번역 패치가 활성화되면 자동으로 자연스러운 한국어 UI로 변환됩니다.
2. **네이티브 앱 & 원격 웹 `Settings(설정)` 좌측 사이드바 `"MCP Servers"` 탭 완벽 통합 (프리징 없는 단일 래퍼 주입)**
   - `Settings(설정)` 모달 좌측 네비게이션의 `"Models(모델)"` / `"한글 번역"` 탭 바로 아래에 **`"MCP Servers"` (`settings-nav-item-McpManager`)** 탭을 추가합니다.
   - `MutationObserver` 자체 변경 필터링과 단일 주입 가드로 네이티브 설정창 프리징 없이 즉각 열리며, 원격 제어 웹(`ga-remote-control iframe`) 내부 설정창과 맞춤 설정 화면에도 자동으로 마운트됩니다.
3. **OAuth 중심 사용자 지정 MCP 서버 등록 & `completeMcpOAuth(serverName, code)` 정합성 보장**
   - MCP 포털/서버 URL만 입력하면 안티그래비티 호스트(`language_server.exe`)의 RFC 9728 / RFC 8414 OAuth Discovery를 통해 `authUrl`을 자동 감지하고 **`Connect <ServerName>` (`<서버이름> 연결`) 모달**을 띄웁니다.
   - 안티그래비티 프런트엔드 `/main.js`의 `lB().completeMcpOAuth(serverName, authorizationCode)` 2인자 문자열 시그니처와 정확히 일치하여 인가 코드(또는 콜백 URL) 제출 시 오류 없이 즉시 연결됩니다.
4. **원격 제어 웹(`https://antigravity.google.com/r/...`) 북마크바 원클릭 동시 로드**
   - 원격 웹에서 상단 북마크바(`커스텀바` 또는 `한글번역`)를 클릭하면 `antigravity-statusbar`, `antigravity-mcp-manager`, `ko-thought-translator`가 모두 자동으로 함께 로드됩니다.

---

## 설치 및 실행 방법

```bash
git clone https://github.com/jaeseongs95/antigravity-mcp-manager.git
cd antigravity-mcp-manager
npm test
npm run install-mcp-manager
```
