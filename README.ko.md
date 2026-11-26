# Antigravity MCP Manager (`v4.3.0`)

[English Documentation (README.md)](./README.md)

[**Extenra**](https://github.com/jaeseongs95/extenra)(`extenra`, 구 `antigravity-addons`) **`v3.3.0+`** API-First 프레임워크(`AddonManifest.v3` + `AddonContextV3`, 최소 권한 ISP `permissions`, 3-Tier 호스트 UI, 외부 런타임 의존성 0개) 기반의 벤더 독립형 **MCP 서버 관리자**입니다.
- **Antigravity Desktop (`ctx.env.surface === 'desktop'`)**:
  - **맞춤 설정 → `MCP 서버` 헤더 버튼**: Zero-DOM `ui.registerSectionAction({ target: 'customizations.mcp-servers.header' })`로 `MCP 서버` 헤더 우측 아이콘 영역에 `MCP 매니저` 버튼을 호스트가 자동 부착·유지합니다.
  - **인라인 설정 페이지**: 데스크톱 Settings 우측 본문에 인라인으로 마운트되는 설정 페이지(`ui.registerSettingsPage`, 데스크톱 상태바 중복 버튼 미등록)와 `permissions.configBridge.scopes` + `ctx.configBridge`를 통해 `~/.gemini/config/mcp_config.json`을 실시간 CRUD 합니다.
- **Antigravity Remote Web (`ctx.env.surface === 'remote-web'`)**:
  - **맞춤 설정 헤더 버튼 + 우측 하단 상태바 + 통합 원격 호스트 브리지**: 원격 웹 우측 하단 **Addons → Host Bridge** 탭에서 1줄 페어링 코드(`ag-bridge-v1:...`)로 한 번만 연결하면, 플러그인 내 별도 URL/토큰 입력 UI나 독자 서버 없이 `ctx.configBridge`가 데스크톱 실제 `mcp_config.json`으로 실시간 라우팅되며 `host:remote-bridge-changed` 이벤트로 자동 재조회됩니다.
  - **오프라인 원격 초안 (`ctx.storage`)**: 공개 HTTPS 모듈형 `@require` Userscript(`antigravity-mcp-manager.user.js`, `@require https://github.com/jaeseongs95/extenra/releases/latest/download/antigravity-remote-host.lib.js`)로 동작하며 `ctx.storage`(`remote-draft:v1`) 브라우저 초안 저장과 **JSON 가져오기 / 복사 / `mcp_config.json` 다운로드**를 지원합니다.

> **API-First 3-Tier 구조 · Extenra `v3.3.0` 정합성**: 모든 UI는 호스트 관리 `AddonContextV3` 표면(`ui.registerSectionAction`, `ui.registerSettingsPage`, Remote Web 전용 `ui.registerStatusItem`, `ui.registerCommand`, `ui.showToast`, `ui.openPanel`, `ui.openModal`, `ui.createStyleElementSafe`, `i18n.onDidChange`)만 사용하며, Extenra `v3.2.1+` `--ag-*` 디자인 토큰과 커스텀 스크롤바를 적용했습니다.

## 3-Tier UI 및 최소 권한 설계
- **최소 권한 `permissions` 선언**:
  - `$schema`: `https://github.com/jaeseongs95/extenra/schemas/addon-manifest.v3.schema.json`
  - `permissions.ui`: `toasts`, `dialogs`, `overlays`, `commands`, `statusItems`, `sectionActions`, `settingsPages`, `canvas`
  - `permissions.storage`: `namespace: "antigravity-mcp-manager"`, `maxBytes: 262144`
  - `permissions.events`: `subscribe: ["host:remote-bridge-changed"]`
  - `permissions.configBridge.scopes`:
    - `antigravity:mcp-config` (`rw`, `262144` bytes): `~/.gemini/config/mcp_config.json` (단일 정본 쓰기 대상)
    - `antigravity:plugin-mcp-configs` (`ro`, `262144` bytes): 플러그인 MCP 읽기 전용 현황
    - `antigravity:mcp-config-legacy` (`ro`, `262144` bytes): 레거시 설정 1회 가져오기 미리보기
  - **미선언(런타임 생략)**: `net`, `dom`, `secrets`, `services`, `uiSlots` (런타임에서 `ctx.net === undefined`, `ctx.dom === undefined`).
- **Tier 1 (Zero-DOM 호스트 표면)**:
  - `ui.registerSectionAction`: `customizations.mcp-servers.header`(맞춤 설정 → `MCP 서버` 헤더 우측)에 `MCP 매니저` 버튼을 등록해 클릭 시 전체 편집기 모달을 열고, `ctx.i18n.onDidChange`로 호스트 전역 언어 전환과 실시간 동기화합니다.
  - `ui.registerSettingsPage`: Desktop 인라인 Settings 페이지 + Remote Web 공용 설정 페이지(`id: "mcp-manager"`). 최초 실행 언어는 `ctx.i18n.getLocale()`(한국어 환경 `ko`)을 따르며 `ctx.storage` 사용자 선택이 우선합니다.
  - `ui.registerStatusItem`: Remote Web(`surface === 'remote-web'`)에서만 등록하여 우측 하단 진입점과 서버 수/미연결(`!`) 배지를 제공합니다.
  - `ui.registerCommand`: `open-mcp-manager`, `open-mcp-panel`, `open-mcp-settings`.
  - `ui.showToast` / `ui.confirm`: Extenra `v3.2.1` 로캘 인식 컴팩트 알림.
- **Tier 2 (선언형 호스트 패널 + `PlacementSpec`)**:
  - `ui.openPanel({ placement: { zone: 'drawer', side: 'right', width: 420 } })` + 16종 폐쇄형 프리미티브 + `handle.update(nextTree, nextState)` ID 기반 인플레이스 패치 및 `<= 640px` 모바일 바텀시트 자동 전환.
  - 빠른 서버 활성/비활성 토글, 전역/플러그인 서버 요약, Host Bridge 미연결 안내, 언어 선택(`en`/`ko`), 전체 편집기 열기.
- **Tier 3 (호스트 관리 Shadow DOM 캔버스)**:
  - `ui.openModal({ placement: { zone: 'surface-center', surface: 'auto', width: 820, maxHeight: 720 } })` 및 인라인 설정 페이지 `render(canvasRoot)`에서 `ctx.ui.createStyleElementSafe(buildNativePanelCss())` (Extenra `v3.2.1` `--ag-*` 시맨틱 토큰)와 함께 `NativeMcpPanel`을 마운트합니다.
  - 전역 CRUD, 디스크 원본 SHA-256 CAS(CRLF 호환), 비밀값 마스킹 보존, Stdio 확인 게이트, 스마트 붙여넣기, Raw JSON 충돌 복구, 플러그인 전역 복제, 레거시 가져오기, 원격 웹 JSON 가져오기/복사/다운로드를 모두 지원합니다.

## 설치, 등록 및 신뢰 승인 (Extenra `v3.1.0+` / `v3.2.1`)
1. [**Extenra**](https://github.com/jaeseongs95/extenra)를 **`v3.2.1+`**로 업그레이드합니다(`extenra --upgrade`, 하위 호환 별칭 `addon-host --upgrade`).
2. Antigravity Desktop을 종료한 뒤 본 저장소를 `~/.gemini/config/plugins/antigravity-mcp-manager/`에 배치합니다(`.git`, `node_modules` 제외).
3. 매니페스트 검증 → 등록 → SHA-256 신뢰 승인 → 진단을 실행합니다:
   ```bash
   extenra --validate ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   extenra --register ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   extenra trust approve antigravity-mcp-manager
   extenra --doctor
   ```

## 원격 웹 설치 (Extenra `v3.2.1` 공개 HTTPS `@require` Userscript)
1. Violentmonkey / Tampermonkey(데스크톱) 또는 Userscripts(iOS/iPadOS Safari)를 설치하거나 Extenra 1-Click Hub를 사용합니다.
2. 최신 GitHub Release의 `antigravity-mcp-manager.user.js`를 설치하거나 `npm run build:userscript`로 로컬 빌드합니다.
3. `https://antigravity.google.com/`에서 우측 하단 `MCP` 버튼·설정 페이지·빠른 실행 명령으로 사용합니다. 데스크톱 실제 `mcp_config.json`을 실시간 편집하려면 **Addons → Host Bridge** 탭에서 한 번만 페어링하세요.

## v3.x 사용자 전환 안내
`v4.x`는 Extenra `AddonManifest.v3` (`minHostVersion: "3.1.0"`) 전용 릴리즈입니다. 업그레이드 전 Extenra `v3.2.1+`로 호스트를 먼저 업그레이드하고, 플러그인 파일 반영 후 `extenra trust approve antigravity-mcp-manager`를 재실행해 SHA-256 핀을 갱신하세요.

## 개발 및 시험 실행
```bash
npm run build:renderer
npm run check:userscript
npm test
```
Node 22+ 환경에서 코어 순수성, `AddonManifest.v3` 최소 권한 계약, `@extenra/sdk` `createTestHost({ surface: 'desktop' })` + `createTestHost({ surface: 'remote-web', remoteBridgeConnected: true | false })` 패리티 테스트(`NMCP-TC-037`~`NMCP-TC-041`), FS 쓰기 감옥/CAS, HTTP 보안, 한영 `I18N` 패리티, 실 Headless Chromium/Edge CDP E2E 테스트(`NMCP-TC-001`~`NMCP-TC-041`)를 실행합니다.
