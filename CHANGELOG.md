# 변경 이력

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
