# Antigravity MCP Manager (`v2.1.0`)

[English Documentation (README.md)](./README.md)

**Antigravity 2.0 네이티브 데스크톱 앱**을 위한 벤더 독립형 MCP 서버 관리자입니다. 공식 **Plugin + `AUX_PANE` UI Sidecar** 구조와 함께, 검증된 `v2.0.0` 코어·로컬 보안 서버를 그대로 재사용하는 **Settings 좌측 사이드바(`Browser` 아래) `MCP Manager` 직접 메뉴 연동**을 제공합니다.

> **안전 분리 구조**: `statusbar_autoinject.js` 편승, React/Angular 내부 상태 스크래핑, LLM 호출형 설정 쓰기 도구를 일절 사용하지 않습니다. Settings 사이드바 연동 시에도 공식 `@electron/asar` 기반 독립 마커와 `.orig` 원본 백업 보존으로 안전하게 설치·제거할 수 있습니다. (웹 원격 제어 지원은 별도 프로젝트 `antigravity-remote-plugin`으로 분리되었습니다.)

## 주요 기능
- **Settings 좌측 사이드바 통합 및 내장 `EN | 한국어` 전환**: Antigravity Settings의 **Browser**(한국어 **브라우저**) 바로 아래에 0px 레이아웃 시프트로 자연스럽게 붙으며, 우상단 `X` 닫기 버튼과 호스트 폰트/테마를 유지하고 UI 내장 한영 전환(재시작 후에도 유지)을 제공합니다.
- **단일 정본 쓰기 경계**: `~/.gemini/config/mcp_config.json`만 원자적으로 읽기/쓰기합니다 (필수 `baseSha256` CAS `409 Conflict` 감지, 잠금, `plugins/` 외부의 사설 백업 `~/.gemini/config/.mcp-manager-backups/`·복원, 상위 경로 symlink/junction 탈출 차단, 동일 파일시스템 `fsync`+`rename`).
- **플러그인 MCP 읽기 전용 현황**: `~/.gemini/config/plugins/*/mcp_config.json` 및 워크스페이스 `.agents/plugins/` 서버를 플러그인 비활성화 상태·이름 충돌 경고와 함께 표시하며, 마스킹된 비밀값 유실 없이 서버 측에서 **전역으로 복사(Clone)**를 지원합니다.
- **읽기 전용 실시간 상태 조회**: 루프백 로컬 Language Server(`GetMcpServerStates`, `GetAllPlugins`)에서 연결 상태·도구 수·레드액션된 오류 요약을 표시합니다.
- **선언적 스마트 붙여넣기**: `mcpServers` JSON 조각 및 Streamable HTTP URL 파싱, 레거시 `serverUrl` → `url` 정규화, 레거시 `/sse` 감지 시 편집 가능한 `mcp-remote` Stdio 템플릿 미리보기(원시 셸 문자열 실행 차단).
- **보안 및 깨진 JSON 복구**: 위험 환경변수(`NODE_OPTIONS`, `LD_PRELOAD` 등) 및 비-루프백 평문 `http://` 인증 헤더·민감 쿼리 토큰 차단, Stdio 저장 전(Raw JSON 저장 포함) 명시적 확인, 비밀 입력 기본 마스킹, 파손 JSON fail-closed Raw 복구 및 직전 정상 백업 복원.

## 설치 및 사용 (Antigravity 2.0 네이티브 앱)
1. 본 저장소를 `~/.gemini/config/plugins/antigravity-mcp-manager/`에 배치하고 `npm ci --omit=dev`를 실행합니다.
2. **Settings 좌측 사이드바 직접 메뉴 활성화 (권장 UX)**:
   - 공식 `@electron/asar`를 사용해 독립 1줄 로더 훅을 설치합니다(원본 `app.asar.*.orig` 백업 보존, `statusbar_autoinject.js` 미접촉):
     ```bash
     npm run install:settings
     ```
   - Antigravity 앱을 재시작한 뒤 **Settings → MCP Manager (`Browser` 바로 아래)** 에서 바로 사용할 수 있습니다.
   - 제거는 `npm run uninstall:settings`로 언제든 깔끔하게 되돌릴 수 있습니다.
3. **공식 플러그인 관리**: Antigravity **Customizations** 화면에서 활성화/비활성화할 수 있습니다.

## v1.x 사용자 정리 및 전환(Migration)
기존 `v1.x`(`mcp_manager_autoinject.js` 주입 방식)가 설치되어 있었다면 `v2.0.0` 활성화 전에 아래 정리 절차를 먼저 수행합니다.
1. `v1.x` 체크아웃이 남아 있다면 `node scripts/install.js --uninstall`을 실행합니다.
2. 또는 `~/.gemini/antigravity/mcp_manager_autoinject.js`를 삭제하고, `~/.gemini/antigravity/statusbar_autoinject.js` 및 `~/.gemini/antigravity/app_storage.json`에 남아 있는 `MCP_MANAGER` 주입 블록을 제거합니다.
3. 기존 `~/.gemini/antigravity/mcp_config.json`은 자동으로 수정되지 않습니다. v2.0.0 UI의 **Legacy Import** 미리보기로 필요한 서버만 `~/.gemini/config/mcp_config.json`에 복사할 수 있습니다.

## 롤백 절차 (`v2.0.0` → `v1.4.18`)
1. Antigravity **Customizations** 또는 `agy plugin disable antigravity-mcp-manager`로 플러그인을 비활성화한 뒤 `~/.gemini/config/plugins/antigravity-mcp-manager/` 폴더를 삭제합니다.
2. `~/.gemini/config/mcp_config.json`을 직전 정상 상태로 되돌려야 하면 `~/.gemini/config/.mcp-manager-backups/mcp_config.last-good.json` 파일을 복사해 복원합니다.
3. 구버전 `v1.4.18`이 꼭 필요한 경우 별도 경로에 `v1.4.18` 태그를 체크아웃하여 해당 버전의 README 절차에 따라 설치합니다.

## 시험 실행
```bash
npm test
```
Node 22+ 환경에서 코어 순수성·FS 쓰기 감옥/symlink·junction 방어/CAS·Sidecar 및 Desktop HTTP 보안·`@electron/asar` 설치/복원·한영 `I18N` 키 패리티·실 Headless Chromium/Edge CDP UI 안전성 테스트 전체 26건(`NMCP-TC-001`~`NMCP-TC-026`, `NMCP-TC-015B`, `NMCP-TC-020B`, `NMCP-TC-020C`)을 실행합니다.
