# Antigravity 커스텀 MCP 서버 매니저 (`antigravity-mcp-manager`)

[English Documentation (README.md)](./README.md)

**Google Antigravity 2.0 네이티브 데스크톱 앱**의 기본 **`Customizations` -> `MCP Servers`** 및 **`Add MCP Server`** 화면 안에서 공식 스토어 카탈로그에 없는 **커스텀 MCP 서버**(로컬 `Stdio` 명령 `npx`, `uvx`, `node`, `python`, `docker` 및 원격 `Streamable HTTP` 서버)를 앱 재시작 없이 즉시 추가·수정·삭제·토글할 수 있는 확장 도구입니다.

---

## 주요 기능

1. **네이티브 `Customizations` -> `MCP Servers` 및 `Add MCP Server` 화면 통합**
   - 하단 상태바는 건드리지 않고, 안티그래비티 기본 `Customizations` -> `MCP Servers` 섹션(`[data-testid="add-mcp-button"]`), `Add MCP Server` 모달(`[data-testid="add-mcp-screen"]`), 그리고 각 서버 행(`[data-testid="mcp-server-row"]`)에 `+ Custom MCP`, `⚙️ Edit Settings` (`설정 수정`), `🔑 Authenticate` (`인증 설정`) 버튼을 주입합니다.
2. **커스텀 MCP 설정 및 인증 수정 전용 팝업창 (`⚙️ Edit Custom MCP Server & Authentication`)**
   - 네이티브 MCP 서버 목록이나 `Unauthorized` 오류 박스(`Fix with Agent` 옆)에서 `🔑 인증 설정` 또는 `⚙️ 설정 수정` 버튼을 누르면 즉시 전용 수정 팝업창이 열려 서버 주소·명령어·인증 정보를 바로 고치고 재연결할 수 있습니다.
3. **MCP 인증(Authentication) 완벽 지원 (`v1.2.0`)**
   - **Bearer 토큰 (`Authorization: Bearer <token>`)**, **API Key 헤더 (`X-API-Key` 등)**, **Basic 인증**, **네이티브 OAuth (`completeMcpOAuth` / `disconnectMcpOAuth`)**를 모두 지원합니다.
   - 여러 커스텀 HTTP 서버에 동일한 토큰을 한 번에 적용하는 **일괄 인증 적용(`Apply this authentication to all custom HTTP servers`)** 기능과 `⚡ 빠른 자동 추가` 바의 선택적 토큰 입력칸을 제공합니다.
4. **단축키 지원 (`Ctrl+Shift+M`)**
   - 언제든 `Ctrl+Shift+M`을 눌러 커스텀 MCP 서버 관리 모달을 열거나 닫을 수 있습니다.
5. **앱 재시작 없는 즉시 연결 (`refreshMcpServers`)**
   - `~/.gemini/config/mcp_config.json` 저장 직후 내부 Language Server RPC인 `refreshMcpServers({ shallow: false })`와 `getMcpServerStates()`를 호출해 앱을 껐다 켜지 않아도 즉시 MCP 서버 프로세스를 스폰하고 도구 목록을 불러옵니다.
6. **서버별 활성/비활성 및 개별 도구(`disabledTools`) 클릭 토글**
   - 서버 카드에서 각 도구(tool) 칩을 클릭하면 `disabledTools` 배열에 즉시 반영되어 특정 도구만 선택적으로 켜고 끌 수 있습니다.
7. **8종 원클릭 프리셋 템플릿 & Raw `mcp_config.json` 편집기**
   - Filesystem, Memory, Fetch, GitHub, PostgreSQL, SQLite, Playwright, Streamable HTTP 프리셋과 원시 JSON 편집기를 함께 제공합니다.

---

## 설치 및 실행 방법

```bash
git clone https://github.com/jaeseongs95/antigravity-mcp-manager.git
cd antigravity-mcp-manager
npm test
npm run install-mcp-manager
```
