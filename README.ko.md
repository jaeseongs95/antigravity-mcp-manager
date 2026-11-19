# Antigravity MCP Manager (`v3.0.0`)

[English Documentation (README.md)](./README.md)

**Antigravity 2.0 네이티브 데스크톱 앱**을 위한 벤더 독립형 MCP 서버 관리자입니다. 공용 네이티브 애드온 호스트([`antigravity-native-addon-host`](https://github.com/jaeseongs95/antigravity-native-addon-host) `v1.0.1+`)의 **`AddonManifest.v1`** 규격 플러그인과 공식 **`AUX_PANE` UI Sidecar**를 함께 제공합니다.

> **`app.asar` 직접 패치 0건 · 외부 런타임 의존성 0개 · 타 플러그인 비침범**: `antigravity-mcp-manager`는 `app.asar`를 직접 패치·백업하지 않으며 `@electron/asar` 의존성 없이 동작합니다. 모든 네이티브 UI 마운트·스타일·생명주기는 호스트의 `AddonManifest.v1` capability API(`addonHost.mountSlot`, `addonHost.injectStyle`, `addonHost.onDispose`, Isolated World `999`, 자동 `translate="no"` / `data-addon-host-owner`)로만 수행합니다.

## 주요 기능
- **Settings 좌측 사이드바 및 Customizations 화면 통합 (`AddonManifest.v1`)**:
  - **Settings** 좌측 사이드바 **Browser**(한국어 **브라우저**) 바로 아래에 0px 레이아웃 시프트로 **MCP Manager** 메뉴를 마운트하고 우상단 `✕` 닫기 버튼을 보존합니다.
  - **Customizations → MCP Servers** 헤더의 우측 아이콘(`[]`, `+`) 바로 앞에 **MCP Manager**(`MCP 매니저`) 버튼을 배치해 클릭 시 전체 화면 다이얼로그 오버레이(`← Customizations로 돌아가기`, `✕`, `Esc` 포커스 복원)를 엽니다.
  - 플러그인 비활성화 또는 등록 해제 시 `dispose()`로 모든 슬롯·스타일·리스너·로컬 루프백 서버를 즉시 정리합니다.
- **내장 `EN | 한국어` 전환**: iframe 새로고침 없이 즉시 한영 전환되며 `storageNamespace` 키(`antigravity-mcp-manager:lang`)에 저장됩니다(기존 v2.1의 `agy-mcp-manager-lang` 설정은 최초 실행 시 1회 자동 마이그레이션).
- **단일 정본 쓰기 경계**: `~/.gemini/config/mcp_config.json`만 원자적으로 읽기/쓰기합니다 (`baseSha256` CAS `409 Conflict`, 잠금, `plugins/` 외부 사설 백업 `~/.gemini/config/.mcp-manager-backups/`, symlink/junction 탈출 차단, 동일 FS `fsync`+`rename`).
- **플러그인 MCP 읽기 전용 현황 및 실시간 상태**: 전역/워크스페이스 `.agents/plugins/` 서버 현황, 충돌 경고, 서버 측 비밀값 보존 **전역으로 복제(Clone)**, 로컬 루프백 Language Server 실시간 상태를 제공합니다.
- **선언적 스마트 붙여넣기 및 보안 우선**: `mcpServers` JSON / Streamable HTTP URL 파싱, `serverUrl` → `url` 정규화, `/sse` 감지 시 `mcp-remote` Stdio 미리보기, 위험 환경변수·평문 자격증명 차단, Stdio 명시 확인(`428`), 파손 JSON fail-closed Raw 복구 및 백업 복원을 지원합니다.

## 설치 및 등록 (`antigravity-native-addon-host` v1.0.1+)
1. [`antigravity-native-addon-host`](https://github.com/jaeseongs95/antigravity-native-addon-host) (`v1.0.1+`)가 Antigravity Desktop에 설치되어 있어야 합니다(`addon-host --install`).
2. 본 저장소를 `~/.gemini/config/plugins/antigravity-mcp-manager/`에 배치합니다(별도 런타임 npm 의존성 없음).
3. 공용 애드온 호스트로 매니페스트를 검증하고 등록합니다:
   ```bash
   addon-host --validate ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   addon-host --register ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   ```
4. Antigravity 앱을 새로고침(`Ctrl + R`) 또는 재시작한 뒤 **Settings → MCP Manager** 또는 **Customizations → MCP Servers → MCP Manager**에서 사용합니다.
5. 등록 해제:
   ```bash
   addon-host --unregister antigravity-mcp-manager
   ```

## v2.1.x 사용자 전환 안내 (`app.asar` 직접 패치 제거)
`v3.0.0`에서는 `scripts/install-settings-menu.mjs`와 `@electron/asar` 의존성이 완전히 제거되었습니다.
1. 이전 `v2.1.x`에서 `npm run install:settings`를 사용했다면 공용 호스트 설치 시 기존 직접 패치를 정리합니다:
   ```bash
   addon-host --install --replace-legacy
   ```
2. `~/.gemini/config/plugins/antigravity-mcp-manager/`를 `v3.0.0`으로 갱신하고 불필요한 `node_modules/`를 제거한 뒤 `addon-host --register`로 등록합니다.
3. 기존 `agy-mcp-manager-lang` 언어 설정은 `antigravity-mcp-manager:lang`으로 자동 이전됩니다.

## 개발 및 시험 실행
```bash
npm run build:renderer
npm test
```
Node 22+ 환경에서 코어 순수성·`AddonManifest.v1` 계약/mainHook/SOLID 조립 일관성·FS 쓰기 감옥/CAS·Sidecar/Desktop HTTP 보안·한영 `I18N` 패리티·실 Headless Chromium/Edge CDP E2E 테스트 전체 28건(`NMCP-TC-001`~`NMCP-TC-027`, `NMCP-TC-015B`, `NMCP-TC-020B`, `NMCP-TC-020C`, `NMCP-TC-024B`)을 실행합니다.
