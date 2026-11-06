# Antigravity 커스텀 MCP 서버 매니저 (`antigravity-mcp-manager`)

[English Documentation (README.md)](./README.md)

**Google Antigravity 2.0 네이티브 데스크톱 앱**의 좌측 **`설정(Settings)` -> `MCP 서버` 탭** 및 기본 **`Customizations` -> `MCP Servers`** 화면에서 공식 카탈로그에 없는 **사용자 지정 MCP 서버**(원격 OAuth MCP 포털/서버 및 로컬 `Stdio` 명령 `npx`, `uvx`, `node`, `python`, `docker`)를 앱 재시작 없이 즉시 추가·OAuth 연결·수정·삭제·토글할 수 있는 확장 도구입니다.

---

## 주요 기능 (`v1.3.0`)

1. **안티그래비티 `설정(Settings)` 좌측 사이드바 `"MCP 서버"` 탭 통합**
   - `설정(Settings)` 모달 좌측 네비게이션의 `"한글 번역"` 탭 바로 아래에 **`"MCP 서버"` (`settings-nav-item-McpManager`)** 탭을 추가합니다.
   - `"MCP 서버"` 탭을 클릭하면 우측 패널에서 전체 MCP 서버 상태 조회, 빠른 자동 추가(`Quick Auto-Add`), `+ 사용자 지정 MCP 서버 추가`, `⚙️ 서버 설정 수정`, `🔗 OAuth 연결 ↗`, `{ } mcp_config.json 편집`을 한 화면에서 관리할 수 있습니다.
2. **OAuth 중심 사용자 지정 MCP 서버 등록 & 자동 `<서버이름> 연결 ↗` 모달**
   - 수동 토큰 입력을 강요하지 않고, MCP 포털/서버 URL만 입력하면 안티그래비티 호스트(`language_server.exe`)의 RFC 9728 / RFC 8414 OAuth Discovery(`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`)를 통해 `authUrl`을 자동 감지합니다.
   - OAuth가 필요한 서버는 저장 직후 **`<서버이름> 연결` 모달 (`<서버이름> 연결 ↗` 버튼)**이 자동으로 열려 브라우저 OAuth 로그인으로 즉시 연결됩니다.
3. **ChatGPT 스타일 `사용자 지정 MCP 서버 추가` / `설정 수정` 팝업창**
   - **이름 (`Server Name`)** 및 **설명 (`선택 사항`)**
   - **연결 (`Connection`)**: `[ 서버 URL | 로컬 / 터널 (Stdio) ]` 세그먼트 토글 (기본값 `서버 URL`)
   - **인증 (`Authentication`)**: **`OAuth` (기본값)**, **`인증 없음`**, **`OAuth 또는 인증 없음`**, 그리고 필요 시 선택 가능한 Bearer Token / API Key / Basic Auth
   - **고급 OAuth 설정 (`Advanced OAuth Settings`) >**: 자동 감지(동적 클라이언트 등록) 또는 직접 입력(`Client ID`, `Client Secret`, 기본 권한 범위 `Scopes`) 지원
4. **네이티브 `Customizations` -> `MCP Servers` 및 `Add MCP Server` 화면 통합**
   - 하단 상태바는 건드리지 않고, 각 서버 행(`[data-testid="mcp-server-row"]`)과 `Unauthorized` 오류 박스(`Fix with Agent` 옆)에 `🔗 OAuth 연결 / 인증` 및 `⚙️ 설정 수정` 버튼을 주입합니다.
5. **단축키(`Ctrl+Shift+M`) 및 앱 재시작 없는 즉시 반영(`refreshMcpServers`)**
   - 언제든 `Ctrl+Shift+M`으로 관리 모달을 열 수 있으며, `mcp_config.json` 저장 즉시 `refreshMcpServers({ shallow: false })`를 호출해 재시작 없이 반영됩니다.

---

## 설치 및 실행 방법

```bash
git clone https://github.com/jaeseongs95/antigravity-mcp-manager.git
cd antigravity-mcp-manager
npm test
npm run install-mcp-manager
```
