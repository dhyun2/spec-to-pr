# SpecToPR Lite

기획서, 단일 기능, Figma 화면, 레거시 프로젝트 중 하나를 받아 구현하고 **한국어 Draft PR**로 정리하는 Codex·Claude Code 스킬입니다.

SpecToPR Lite는 서버, MCP, Run ID, 상태 머신, 데이터베이스를 사용하지 않습니다. 한 번 실행해 현재 변경 사항을 검증하고 PR을 만듭니다. 중단되면 다음 실행에서 현재 `git diff`를 다시 읽습니다.

## 네 가지 케이스

| 케이스    | 기준                         | UI 구현                                                        |
| --------- | ---------------------------- | -------------------------------------------------------------- |
| `brief`   | 기획서와 제공된 보조 자료    | OpenSpec 문서 작성·대조, 선택한 TDD 뒤 사내 디자인 시스템 우선 |
| `feature` | 한 가지 기능 요청            | OpenSpec 문서 작성·대조, 선택한 TDD·E2E·사용자 흐름 영상 1개   |
| `figma`   | Figma URL과 선택한 화면 상태 | 사내 디자인 시스템 우선                                        |
| `legacy`  | 지정한 레거시 기능·실행 화면 | 레거시 DOM·CSS·자산·컨트롤을 보존해 Vue 3 진입점만 변환        |

UI 작업은 케이스와 관계없이 화면 비교를 시도합니다. 기준 화면이 없거나 캡처할 수 없으면 점수를 추측하지 않고 Gap으로 남깁니다. `skipped`, `waived`, `not run`은 통과가 아닙니다.

## 설치

### Codex

```bash
codex plugin marketplace add https://github.com/dhyun2/spec-to-pr --ref main
codex plugin add spec-to-pr@spec-to-pr
```

### Claude Code

```text
/plugin marketplace add dhyun2/spec-to-pr
/plugin install spec-to-pr@spec-to-pr
```

## 사용

새 작업에서 다음 정보를 알려 주세요.

```text
case: figma
projectRoot: /absolute/path/to/project
request: 결제 수단 선택 화면을 구현해줘
source: https://www.figma.com/design/FILE/checkout?node-id=12-345
targetBranch: main
```

`brief`는 기획서 경로, `figma`는 Figma URL, `legacy`는 별도 레거시 프로젝트 경로와 정확한 `targetPaths`가 필요합니다. `feature`는 요청만으로 시작할 수 있습니다. OpenSpec은 사용자가 준비할 전제 조건이 아니며, `brief`·`feature`에서 유용할 때만 에이전트가 준비합니다.

`brief`와 `feature`에는 `test: on | off`를 넣을 수 있으며 생략하면 `off`입니다. `on`이면 OpenSpec 수용 시나리오를 실패 테스트로 먼저 만든 뒤 구현·통과·리팩터링하는 TDD를 합니다. `off`면 이 변경을 위한 단위·통합 테스트를 만들거나 실행하지 않습니다. `feature`의 E2E·영상은 test와 별개로 유지됩니다.

## Draft PR 형식

PR은 case별 템플릿 하나를 사용하며, 리뷰어 판단에 필요한 내용만 포함합니다.

| case      | PR에서 우선 보이는 내용                                            |
| --------- | ------------------------------------------------------------------ |
| `legacy`  | 원본→대상, 이관 범위, 전체 화면 매트릭스와 기준·이관·Diff, API Gap |
| `brief`   | 요구사항 충족표, 제외 범위, 화면 비교                              |
| `feature` | 사용자 흐름 영상, 변경 전후 동작, 회귀 검증, 화면 비교             |
| `figma`   | Figma 상태 매핑, 상태별 일치율, 디자인·접근성 검증                 |

내부 로그·실행 식별자·빈 체크리스트·토큰·쿠키는 본문에 넣지 않습니다. 일치율이 92% 미만이면 Diff를 보고 수정한 뒤 같은 기준으로 다시 비교합니다. 최초 비교를 포함해 최대 3회까지 시도하고, 세 번째도 미달하면 마지막 점수와 모든 Diff를 Gap에 남깁니다. 화면을 비교하지 못해도 Draft PR은 만들 수 있지만 `VERIFIED`로 표시하지 않습니다.

## 화면 비교

스킬에 포함된 `compare-images.cjs`는 같은 크기의 PNG 두 장을 비교해 일치율과 Diff PNG를 만듭니다.

```bash
node /absolute/path/to/compare-images.cjs \
  --baseline spec-to-pr-evidence/checkout/baseline.png \
  --actual spec-to-pr-evidence/checkout/actual.png \
  --diff spec-to-pr-evidence/checkout/diff.png
```

생성된 화면 증빙은 `spec-to-pr-evidence/<변경명>/`에 커밋·push하고 Draft PR에서 실제 이미지 링크로 표시합니다.

## 레거시 이관은 재디자인이 아닙니다

`legacy`는 사용자가 명시적으로 재디자인을 승인하지 않는 한 디자인 시스템을 적용하지 않습니다. 기존 템플릿·클래스·CSS·sprite/이미지 자산·검색/필터/지도 컨트롤·사용자 동작을 보존하고 Vue 3 문법과 대상 앱 진입점만 바꿉니다.

레거시 화면은 호스트에 Computer Use가 있으면 이를 우선 사용해 이미 로그인된 실제 앱의 모든 route·state를 순회하며 캡처합니다. Computer Use가 없거나 같은 조건의 PNG를 만들 수 없을 때만 Browser/Playwright를 fallback으로 사용하며, provider·인증 상태·시각·사유를 `legacy-visual-manifest.json`과 PR에 기록한 Open Gap으로 남깁니다. 쿠키·토큰 값은 저장하지 않습니다.

레거시 라우터에서 발견한 모든 사용자 노출 route와 대표 상태를 `legacy-visual-manifest.json`에 인벤토리로 기록합니다. 먼저 `legacy-source-inventory.cjs`가 원본 asset URL, CSS selector·breakpoint, Kakao Map·Swiper·bridge 표식을 수집하고, 각각 대상 파일·CSS·실제 runtime code에 1:1 mapping돼야 합니다. 각 화면 항목은 다음 중 하나여야 합니다.

1. 같은 fixture·viewport·DPR의 기준/이관/Diff 이미지로 비교됨
2. 이유·영향·리뷰어 결정을 갖춘 명시적 제외

기본 화면 한 장의 높은 점수는 전체 이관 통과가 아닙니다. `legacy-visual-evidence.cjs`는 전체 화면 외에 검색·필터·목록·지도 조작 같은 핵심 UI 영역과 source inventory mapping을 비교하고, 이미지를 stage했는지 확인해 PR용 Markdown을 생성합니다. Unicode glyph/emoji, 문자·CSS 아이콘, mock/placeholder 지도 대체는 Gap입니다.

플러그인 GitLab API가 TLS·인증·권한 오류로 실패하고 `glab`/`gh` fallback으로 Draft를 만들면, 실패 원인·fallback 방법·MR URL을 manifest `publishing`에 기록하고 PR 본문을 다시 갱신합니다.

## GitLab Draft MR 사전 진단

GitLab remote에서는 remote, `glab` 인증, 프로젝트 접근, MR API 읽기 접근, 확인 가능한 Developer 이상 권한을 순서대로 읽기 전용 점검합니다. 준비가 안 됐으면 발행 Gap으로 기록하고 안전한 구현은 계속합니다. GitLab에는 Draft MR 생성 dry-run이 없으므로 실제 `glab mr create --draft` 또는 기존 Draft 갱신 성공과 MR URL 확인이 마지막 조건입니다.

```bash
node /absolute/path/to/check-gitlab-mr.cjs \
  --project-root /absolute/path/to/project \
  --remote origin
```

자세한 설정과 실패 해결은 [GitLab MR 사전 진단 가이드](https://dhyun2.github.io/spec-to-pr/getting-started/gitlab)를 참고하세요.

## 의도적으로 하지 않는 일

- 작업 상태 저장 또는 자동 재개
- 별도 리뷰어와 단계별 상태 전이
- `figma`·`legacy`의 OpenSpec 문서화·TDD 강제
- 모든 케이스에 영상·성능 증빙 강제
- 자체 GitHub/GitLab 게시 서버
- API·레거시를 자동으로 추측해 완전 분석하는 런타임

PR 생성은 Codex·Claude Code의 GitHub/GitLab 연결 또는 `gh`/`glab`을 사용합니다. GitLab은 사전 진단이 통과해도 실제 Draft MR 생성·갱신이 성공해야 완료로 기록합니다.
