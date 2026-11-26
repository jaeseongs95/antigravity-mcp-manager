# Antigravity MCP Manager (`v4.0.0`)

[English Documentation (README.md)](./README.md)

[`antigravity-addons`](https://github.com/jaeseongs95/antigravity-addons) **`v3.0.0+`** API-First 프레임워크(`AddonManifest.v3` + `AddonContextV3`, 최소 권한 ISP `permissions`, 3-Tier 호스트 UI, 외부 런타임 의존성 0개) 기반의 벤더 독립형 **MCP 서버 관리자**입니다.
- **Antigravity Desktop (`ctx.env.surface === 'desktop'`)**: `ctx.env.capabilities.hasConfigBridge` 분기와 `permissions.configBridge.scopes` + `ctx.configBridge`를 통해 `~/.gemini/config/mcp_config.json`을 실시간 CRUD 합니다.
- **Antigravity Remote Web (`ctx.env.surface === 'remote-web'`)**: 공개 HTTPS 모듈형 `@require` Userscript(`antigravity-mcp-manager.user.js`)로 동작하며, `ctx.storage`(`remote-draft:v1`) 브라우저 초안 저장과 **JSON 가져오기 / 복사 / `mcp_config.json` 다운로드**를 지원합니다.

> **API-First 3-Tier 구조 · 수동 DOM 배치 제거**: `v4.0.0`에서는 기존 v2의 호스트 DOM 탐색·수동 좌표 계산·`uiSlots`·`settingsBridge`·`hostProfileId` 분기·`window.localStorage` 직접 접근을 모두 제거하고 `AddonContextV3` 표준 API(`ui.registerStatusItem`, `ui.registerSettingsPage`, `ui.registerCommand`, `ui.showToast`, `ui.openPanel`, `ui.openModal`, `ui.createStyleElementSafe`)만 사용합니다.

## 3-Tier UI 및 최소 권한 설계
- **최소 권한 `permissions` 선언**:
  - `permissions.ui`: `toasts`, `dialogs`, `overlays`, `commands`, `statusItems`, `settingsPages`, `canvas`
  - `permissions.storage`: `namespace: "antigravity-mcp-manager"`, `maxBytes: 262144`
  - `permissions.configBridge.scopes`:
    - `antigravity:mcp-config` (`rw`, `262144` bytes): `~/.gemini/config/mcp_config.json` (단일 정본 쓰기 대상)
    - `antigravity:plugin-mcp-configs` (`ro`, `262144` bytes): 플러그인 MCP 읽기 전용 현황
    - `antigravity:mcp-config-legacy` (`ro`, `262144` bytes): 레거시 설정 1회 가져오기 미리보기
  - **미선언(런타임 생략)**: `net`, `dom`, `events`, `services`, `uiSlots` (런타임에서 `ctx.net === undefined`, `ctx.dom === undefined`).
- **Tier 1 (Zero-DOM 호스트 표면)**:
  - `ui.registerStatusItem`: 상태바 `MCP` 버튼 및 실시간 서버 수 배지·툴팁.
  - `ui.registerSettingsPage`: Desktop + Remote Web 공용 통합 설정 페이지(`id: "mcp-manager"`).
  - `ui.registerCommand`: `open-mcp-manager`, `open-mcp-panel`, `open-mcp-settings`.
  - `ui.showToast` / `ui.confirm`: 토글·복사·다운로드 피드백 알림.
- **Tier 2 (선언형 호스트 패널 + `PlacementSpec`)**:
  - `ui.openPanel({ placement: { zone: 'drawer', side: 'right', width: 420 } })` + 16종 폐쇄형 프리미티브 + `handle.update(nextTree, nextState)` ID 기반 인플레이스 패치 및 `<= 640px` 모바일 바텀시트 자동 전환.
  - 빠른 서버 활성/비활성 토글, 전역/플러그인 서버 요약, 언어 선택(`en`/`ko`), 전체 편집기 열기.
- **Tier 3 (호스트 관리 Shadow DOM 캔버스)**:
  - `ui.openModal({ placement: { zone: 'surface-center', surface: 'auto', width: 820, maxHeight: 720 } })` 및 설정 페이지 `render(canvasRoot)`에서 `ctx.ui.createStyleElementSafe(buildNativePanelCss())` (`--ag-*` 시맨틱 토큰)와 함께 `NativeMcpPanel`을 마운트합니다.
  - 전역 CRUD, 디스크 원본 SHA-256 CAS(CRLF 호환), 비밀값 마스킹 보존, Stdio 확인 게이트, 스마트 붙여넣기, Raw JSON 충돌 복구, 플러그인 전역 복제, 레거시 가져오기, 원격 웹 JSON 가져오기/복사/다운로드를 모두 지원합니다.

## 설치, 등록 및 신뢰 승인 (`antigravity-addons` `v3.0.0+`)
1. [`antigravity-addons`](https://github.com/jaeseongs95/antigravity-addons)를 **`v3.0.0+`**로 업그레이드합니다(`addon-host --upgrade`).
2. Antigravity Desktop을 종료한 뒤 본 저장소를 `~/.gemini/config/plugins/antigravity-mcp-manager/`에 배치합니다(`.git`, `node_modules` 제외).
3. 매니페스트 검증 → 등록 → SHA-256 신뢰 승인 → 진단을 실행합니다:
   ```bash
   addon-host --validate ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   addon-host --register ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   addon-host trust approve antigravity-mcp-manager
   addon-host --doctor
   ```

## 원격 웹 설치 (`antigravity-addons v3.0.0+` 공개 HTTPS `@require` Userscript)
1. Violentmonkey / Tampermonkey(데스크톱) 또는 Userscripts(iOS/iPadOS Safari)를 설치합니다.
2. 최신 GitHub Release의 `antigravity-mcp-manager.user.js`를 설치하거나 `npm run build:userscript`로 로컬 빌드합니다.
3. `https://antigravity.google.com/`에서 상태바 `MCP` 버튼·설정 페이지·빠른 실행 명령으로 사용합니다.

## v3.x 사용자 전환 안내
`v4.0.0`은 `AddonManifest.v3` (`minHostVersion: "3.0.0"`) 전용 메이저 릴리즈입니다. 업그레이드 전 `antigravity-addons v3.0.0+`로 호스트를 먼저 업그레이드하고, 플러그인 파일 반영 후 `addon-host trust approve antigravity-mcp-manager`를 재실행해 SHA-256 핀을 갱신하세요.

## 개발 및 시험 실행
```bash
npm run build:renderer
npm run check:userscript
npm test
```
Node 22+ 환경에서 코어 순수성, `AddonManifest.v3` 최소 권한 계약, `@antigravity-addons/sdk` `createTestHost({ surface: 'desktop' })` + `createTestHost({ surface: 'remote-web' })` 패리티 테스트(`NMCP-TC-037`, `NMCP-TC-038`), FS 쓰기 감옥/CAS, HTTP 보안, 한영 `I18N` 패리티, 실 Headless Chromium/Edge CDP E2E 테스트(`NMCP-TC-001`~`NMCP-TC-038`)를 실행합니다.
