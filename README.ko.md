# Antigravity MCP Manager (`v3.0.0`)

[English Documentation (README.md)](./README.md)

**Antigravity 2.0 네이티브 데스크톱 앱**을 위한 벤더 독립형 MCP 서버 관리자입니다. 공용 네이티브 애드온 호스트([`antigravity-native-addon-host`](https://github.com/jaeseongs95/antigravity-native-addon-host) `v2.3.0+`)의 **`AddonManifest.v2`** (`trustLevel: "trusted"`, `capabilities: ["renderer"]`, Option A **Named-Scope Config Bridge**) 기반으로 동작하며, 별도의 `AUX_PANE` 사이드카 없이 설정 화면과 Customizations 팝업에서 즉시 전체 CRUD를 수행합니다.

> **`app.asar` 직접 패치 0건 · `mainHook` 미사용 · `AUX_PANE` 사이드카 제거 · 외부 런타임 의존성 0개**: `antigravity-mcp-manager`는 `app.asar`를 직접 패치·백업하지 않으며 `@electron/asar` 의존성 없이 동작합니다. 모든 네이티브 UI 및 MCP 설정 관리는 `antigravity-native-addon-host` `v2.3.0+`의 Isolated World `998` Shadow DOM과 Option A **Named-Scope Config Bridge**(`trustLevel: "trusted"` + `trust-policy.json` SHA-256 피닝)로만 수행합니다.

## 주요 기능
- **Settings 좌측 사이드바 및 Customizations 중앙 팝업 네이티브 Shadow DOM CRUD (`AddonManifest.v2`, World `998`)**:
  - 별도 **플러그인 > MCP Manager** (`AUX_PANE`) 사이드카를 제거하고, **Settings → MCP Manager**와 **Customizations → MCP Servers → MCP 매니저** 중앙 팝업 모달 내부에서 바로 전체 MCP 서버 조회·추가·수정·비활성화·삭제·복제·Raw JSON 복구를 수행합니다.
  - **Settings** 좌측 사이드바 **Browser**(한국어 **브라우저**) 바로 아래에 0px 레이아웃 시프트로 **MCP Manager** 메뉴를 마운트하고(`settings-nav`는 네이티브 Tailwind 상속을 위해 `shadow: false`), 우측 `pane`은 Shadow DOM Option B2로 격리하며 우상단 `✕` 닫기 버튼을 보존합니다.
  - **Customizations → MCP Servers** 헤더 우측 아이콘(`[]`, `+`) 바로 앞에 Shadow DOM **MCP Manager**(`MCP 매니저`) 버튼을 배치해 클릭 시 호스트 `addonHost.openModal` 기반 중앙 `<dialog>.showModal()` 팝업(`PortalArbiter` 연동, 타이틀바 안전 `marginTop`·`zIndex` 보존, `✕`, IME 안전 캡처 단계 `Esc` 포커스 복원)을 엽니다.
  - `antigravity-native-addon-host` `v2.3.0+` **Option A Named-Scope Config Bridge**의 최소 권한 3개 스코프만 선언·사용합니다:
    - `antigravity:mcp-config` (`rw`): `~/.gemini/config/mcp_config.json` (단일 정본 쓰기 대상)
    - `antigravity:plugin-mcp-configs` (`ro`): 플러그인 MCP 읽기 전용 현황
    - `antigravity:mcp-config-legacy` (`ro`): 레거시 설정 1회 가져오기 미리보기(읽기 전용)
  - 플러그인 비활성화 또는 등록 해제 시 `dispose()`로 모든 슬롯·모달·스타일·리스너를 즉시 정리합니다.
- **호스트 언어 자동 감지 및 `EN | 한국어` 전환**: 최초 진입 시 Antigravity 호스트 UI 언어(한국어/영어)를 자동 감지하며, 사용자가 직접 전환한 언어는 `storageNamespace` 키(`antigravity-mcp-manager:lang`)에 저장됩니다(기존 v2.1의 `agy-mcp-manager-lang`은 최초 실행 시 1회 자동 이전).
- **단일 정본 쓰기 경계 및 디스크 원본 SHA-256 CAS**: `~/.gemini/config/mcp_config.json`만 원자적으로 읽기/쓰기하며, CRLF·비정규 들여쓰기 파일에서도 호스트가 반환한 디스크 원본 `sha256`을 그대로 보존해 `ERR_CONFIG_CAS_CONFLICT` 없이 안전하게 갱신합니다(잠금, `plugins/` 외부 사설 백업, 상위·백업 경로 심볼릭 링크 차단 포함).
- **플러그인 MCP 읽기 전용 현황 및 선언적 스마트 붙여넣기**: 플러그인 서버 현황, 충돌 경고, 비밀값 보존 **전역으로 복제(Clone)**, `mcpServers` JSON / Streamable HTTP URL 파싱, `serverUrl` → `url` 정규화, `/sse` 감지 시 `mcp-remote` Stdio 미리보기, 위험 환경변수·평문 자격증명 차단, Stdio 명시 확인, 파손 JSON fail-closed Raw JSON 복구를 지원합니다.

## 설치, 등록 및 신뢰 승인 (`antigravity-native-addon-host` v2.3.0+)
1. [`antigravity-native-addon-host`](https://github.com/jaeseongs95/antigravity-native-addon-host) **`v2.3.0+`**가 Antigravity Desktop에 설치·업그레이드되어 있어야 합니다(`addon-host --install` 또는 `addon-host --upgrade`).
2. Antigravity Desktop을 종료한 뒤 본 저장소를 `~/.gemini/config/plugins/antigravity-mcp-manager/`에 배치합니다(`.git`, `node_modules` 제외 — 외부 런타임 의존성 없음).
3. 공용 애드온 호스트로 매니페스트 검증 → 등록 → SHA-256 신뢰 승인(`trust approve`) → 상태 진단을 순서대로 실행합니다:
   ```bash
   addon-host --validate ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   addon-host --register ~/.gemini/config/plugins/antigravity-mcp-manager/addon-manifest.json
   addon-host trust approve antigravity-mcp-manager
   addon-host --doctor
   ```
   > **안내**: 업데이트나 재빌드로 `src/adapters/antigravity/addon-renderer.js`가 변경되면 `~/.gemini/antigravity/trust-policy.json`의 SHA-256 피닝을 갱신하기 위해 `addon-host trust approve antigravity-mcp-manager`를 다시 실행해야 합니다.
4. Antigravity Desktop을 시작한 뒤 **Settings → MCP Manager** 또는 **Customizations → MCP Servers → MCP 매니저**에서 사용합니다.
5. 신뢰 해제 및 등록 해제:
   ```bash
   addon-host trust revoke antigravity-mcp-manager
   addon-host --unregister antigravity-mcp-manager
   ```

## v2.x / v1 호스트 사용자 전환 안내
`v3.0.0`에서는 `sidecars/`(`AUX_PANE`), `scripts/install-settings-menu.mjs`, `scripts/electron-hook.cjs`, `@electron/asar` 의존성이 완전히 제거되었습니다.
1. [`antigravity-native-addon-host`](https://github.com/jaeseongs95/antigravity-native-addon-host)를 **`v2.3.0+`**로 업그레이드합니다(`addon-host --upgrade`, 이전 `v2.1.x`의 직접 `app.asar` 패치가 남아 있다면 `addon-host --install --replace-legacy` 사용).
2. Antigravity Desktop을 종료하고 `~/.gemini/config/plugins/antigravity-mcp-manager/`를 `v3.0.0`으로 미러링(기존 `node_modules/`, `sidecars/` 제거)한 뒤 `addon-host --register` 및 `addon-host trust approve antigravity-mcp-manager`를 실행합니다.
3. 기존 `agy-mcp-manager-lang` 언어 설정은 `antigravity-mcp-manager:lang`으로 자동 이전됩니다.

## 개발 및 시험 실행
```bash
npm run build:renderer
npm test
```
Node 22+ 환경에서 코어 순수성·`AddonManifest.v2` 계약/SOLID 조립 일관성·Named-Scope Config Bridge(`status: 'ok'` 시 `rawText: null` + CRLF 디스크 원본 `sha256` CAS + `corrupt` 복구)·FS 쓰기 감옥/CAS·HTTP 보안·한영 `I18N` 패리티·실 Headless Chromium/Edge CDP E2E 테스트 전체 30건(`NMCP-TC-001`~`NMCP-TC-032`)을 실행합니다.
