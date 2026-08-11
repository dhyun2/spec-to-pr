# 변경 이력

## 1.0.5 - 2026-08-11

### 수정

- 레거시 source inventory가 정확한 이관 경로는 유지하면서 local import graph를 읽기 전용으로 추적하고, supporting dependency·실제 navigation·Kakao/Swiper wrapper를 수집합니다. 해석 실패는 구현을 멈추지 않고 Gap으로 남깁니다.
- schema v4 `routeChecks`는 전체 E2E 대신 실제 fixture, 최종 URL, 구체적인 selector/text 기대값, API 필요 여부·인증 결과, console/network 진단 여부와 관련 오류, 대표 클릭 전환을 검증합니다. 빈 화면·loading·오류·임의 파라미터·전체 viewport뿐인 핵심 영역은 픽셀이 같아도 통과하지 않습니다.
- 레거시 화면 계약 보존과 Vue 3 구현 현대화를 분리했습니다. 대상 저장소가 요구하는 `<script setup lang="ts">`, Pinia, Vue Router 4 규격과 Options API·mixin·Vuex/Event Bus 호환층 잔존을 `targetCodeProfile`로 검증합니다.
- 레거시 PR은 핵심 Gap을 상단에 두고 라우트 동작, 좌우 이미지와 Diff, Vue 3 규격만 간결하게 표시하며 빈 Gap·제외 표와 반복 로그를 생략합니다.

## 1.0.4 - 2026-08-10

### 수정

- 레거시 PR 증빙은 중복된 요약형 `화면 비교` 표를 제거하고, 경로·상태별 레거시와 Vue 3 이미지를 좌우 두 열로 표시한 뒤 Diff 링크를 바로 아래에 생성합니다.
- Computer Use가 호스트에 없거나 필요한 PNG를 만들 수 없어 Browser/Playwright를 쓴 경우 provider·인증 상태·사유를 한 번 공개하되, 동일 조건의 이미지와 기능 검증이 있으면 fallback 자체를 Gap으로 만들지 않습니다.
- SpecToPR 1.0.3의 `browser-or-playwright-with-gap` manifest도 계속 읽으며, 새 manifest는 `browser-or-playwright-when-unavailable` 정책을 사용합니다.

## 1.0.3 - 2026-08-10

### 수정

- legacy 화면 캡처는 호스트에 Computer Use가 있으면 이미 로그인된 실제 앱을 조작하는 방식을 우선하도록 고정했습니다. 비교만을 위해 독립 Browser/Playwright를 먼저 띄우지 않습니다.
- `legacy-visual-manifest.json` schema v3는 기준·이관 이미지별 capture provider, 인증 상태, 시각을 기록합니다. Browser/Playwright fallback에는 사유가 필수이며 PR 화면 비교 표와 Open Gap에 표시됩니다.
- 기존 schema v2 증빙은 읽을 수 있지만 capture provider가 없어 `NOT VERIFIED` Gap으로 정직하게 표시합니다. 쿠키·토큰 값은 어떤 증빙에도 기록하지 않습니다.

## 1.0.2 - 2026-08-10

### 수정

- 레거시 source에서 router, asset URL, CSS selector·breakpoint, Kakao Map·Swiper·native bridge 표식을 읽기 전용으로 추출하는 `legacy-source-inventory.cjs`를 추가했습니다.
- `legacy-visual-manifest.json` v2는 발견한 asset·selector·breakpoint·runtime 항목을 대상 파일·CSS·실제 SDK 코드에 1:1로 연결해야 합니다. 누락·승인 없는 대체·glyph/emoji·문자/CSS 아이콘·mock placeholder는 `NOT VERIFIED` Gap입니다.
- 레거시 router의 경로가 화면 매트릭스에서 빠지면, 기본 화면 하나의 높은 픽셀 점수로는 검증을 통과할 수 없게 했습니다.
- 플러그인 GitLab 발행 실패와 `glab`/`gh` fallback 결과를 manifest 및 PR 본문의 `발행 상태`에 함께 기록하도록 했습니다. fallback 성공이 원래 발행 실패를 숨기지 않습니다.

## 1.0.1 - 2026-08-10

### 수정

- 레거시 이관을 재디자인이 아닌 보존 이관으로 고정했습니다. 명시적 승인 없이는 레거시 DOM class, CSS, sprite·이미지 자산, 사용자 컨트롤을 유지하고 Vue 3 진입점만 변환합니다.
- 레거시 router에서 발견한 모든 사용자 노출 route·state가 화면 비교 또는 사유·영향·리뷰어 결정을 갖춘 제외에 1:1로 연결되도록 `legacy-visual-manifest.json`과 `legacy-visual-evidence.cjs`를 추가했습니다.
- 기준·이관 결과·Diff 이미지를 stage 여부까지 확인하고 GitHub/GitLab raw 이미지 링크를 포함한 PR 섹션을 생성합니다. 로컬 경로나 Diff 한 장만 남기는 증빙을 방지했습니다.
- 전체 화면 외 핵심 UI 영역 비교를 추가해 빈 배경·지도 영역이 일치율을 부풀려 통과 처리하는 문제를 막았습니다.
- 하나의 범용 PR 본문을 Legacy migration, Brief delivery, Feature flow, Figma UI 네 템플릿으로 분리했습니다.
- API·binding·인증·증빙 분석 실패와 GitLab 발행 준비 실패는 안전한 구현을 멈추지 않고 Gap으로 남기도록 정리했습니다. `skipped`·`waived`는 통과로 표시하지 않습니다.
- Codex/Claude provider를 섞지 않는 fast/build/expert 모델 라우팅 규칙과 pinned/custom 동작을 문서화했습니다.

## 1.0.0 - 2026-08-10

### 변경

- SpecToPR를 네 가지 개발 케이스를 위한 단일 스킬로 단순화했습니다.
- MCP 서버, Run 저장, 상태 머신, 별도 리뷰어, SDK, 맞춤 발행기를 제거했습니다.
- `brief`, `feature`, `figma`, `legacy` 모두 하나의 한국어 Draft PR 형식을 사용합니다.
- 화면 비교가 필요한 경우에만 PNG 비교 도구로 일치율과 Diff 이미지를 생성합니다.
- 기준 화면이 없으면 Gap으로 남깁니다. 일치율이 92%보다 낮으면 같은 조건으로 최대 3회까지 수정·재비교하고, 세 번째도 미달하면 Gap으로 남깁니다.
- `feature`는 요청한 UI 흐름을 구현한 뒤 변경 기능 E2E와 사용자 흐름 영상 한 개를 PR 증빙으로 남깁니다.
- `brief`와 `feature`는 각각 기획서 또는 기능 요청·제공된 API 문서·Figma를 OpenSpec 변경 문서로 정리하고, 자료와 대조·보완한 뒤 구현합니다.
- `brief`와 `feature`의 `test: on | off`를 추가했습니다. 생략·`off`는 단위·통합 테스트를 만들거나 실행하지 않고, `on`은 OpenSpec 수용 시나리오 기반 TDD를 적용합니다. `feature`의 E2E·영상 증빙은 유지합니다.
- GitLab remote는 구현 전 `glab` 인증·프로젝트 접근·MR API·가능한 권한을 읽기 전용으로 점검하고, 막히면 설정 가이드를 안내합니다. 실제 Draft MR 생성 성공만 완료로 기록합니다.

### 포함하지 않는 기능

- 작업 상태 저장 및 자동 재개
- 모델 라우팅과 토큰 예산 관리
- 독립 리뷰어·성능 측정 의무, 모든 케이스에 영상을 강제하는 규칙
- OpenSpec 아카이브와 플러그인 내부 PR 발행기
