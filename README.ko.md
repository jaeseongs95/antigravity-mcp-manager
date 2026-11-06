# Antigravity 커스텀 MCP 서버 매니저 (`antigravity-mcp-manager`)

[English Documentation (README.md)](./README.md)

**Google Antigravity 2.0 네이티브 데스크톱 앱**의 기본 **`Customizations` -> `MCP Servers`** 및 **`Add MCP Server`** 화면 안에서 공식 스토어 카탈로그에 없는 **커스텀 MCP 서버**(로컬 `Stdio` 명령 `npx`, `uvx`, `node`, `python`, `docker` 및 원격 `Streamable HTTP` 서버)를 앱 재시작 없이 즉시 추가·수정·삭제·토글할 수 있는 확장 도구입니다.

---

## 주요 기능

1. **네이티브 `Customizations` -> `MCP Servers` 및 `Add MCP Server` 화면 통합**
   - 하단 상태바는 건드리지 않고, 안티그래비티 기본 `Customizations` -> `MCP Servers` 섹션(`[data-testid="add-mcp-button"]`)과 `Add MCP Server` 모달(`[data-testid="add-mcp-screen"]`) 안에 `+ Custom MCP` / `+ Add Custom MCP Server` 버튼을 자연스럽게 주입합니다.
2. **단축키 지원 (`Ctrl+Shift+M`)**
   - 언제든 `Ctrl+Shift+M`을 눌러 커스텀 MCP 서버 관리 모달을 열거나 닫을 수 있습니다.
3. **앱 재시작 없는 즉시 연결 (`refreshMcpServers`)**
   - `~/.gemini/config/mcp_config.json` 저장 직후 내부 Language Server RPC인 `refreshMcpServers({ shallow: false })`와 `getMcpServerStates()`를 호출해 앱을 껐다 켜지 않아도 즉시 MCP 서버 프로세스를 스폰하고 도구 목록을 불러옵니다.
4. **서버별 활성/비활성 및 개별 도구(`disabledTools`) 클릭 토글**
   - 서버 카드에서 각 도구(tool) 칩을 클릭하면 `disabledTools` 배열에 즉시 반영되어 특정 도구만 선택적으로 켜고 끌 수 있습니다.
5. **8종 원클릭 프리셋 템플릿 & Raw `mcp_config.json` 편집기**
   - Filesystem, Memory, Fetch, GitHub, PostgreSQL, SQLite, Playwright, Streamable HTTP 프리셋과 원시 JSON 편집기를 함께 제공합니다.

---

## 설치 및 실행 방법

```bash
git clone https://github.com/jaeseongs95/antigravity-mcp-manager.git
cd antigravity-mcp-manager
npm test
npm run install-mcp-manager
```
