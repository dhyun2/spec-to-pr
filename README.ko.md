# SpecToPR Lite

기획서, 단일 기능, Figma 화면, 레거시 프로젝트 중 하나를 받아 구현하고 **한국어 Draft PR**로 정리하는 가벼운 Codex·Claude Code 스킬입니다.

SpecToPR Lite는 서버, MCP, Run ID, 상태 머신, 데이터베이스를 사용하지 않습니다. 한 번 실행해 현재 변경 사항을 검증하고 PR을 만듭니다. 중단되면 다음 실행에서 현재 `git diff`를 다시 읽습니다.

## 네 가지 케이스

| 케이스    | 기준                         | UI 구현                                                        |
| --------- | ---------------------------- | -------------------------------------------------------------- |
| `brief`   | 기획서와 제공된 보조 자료    | OpenSpec 문서 작성·대조, 선택한 TDD 뒤 사내 디자인 시스템 우선 |
| `feature` | 한 가지 기능 요청            | OpenSpec 문서 작성·대조, 선택한 TDD·E2E·사용자 흐름 영상 1개   |
| `figma`   | Figma URL과 선택한 화면 상태 | 사내 디자인 시스템 우선                                        |
| `legacy`  | 지정한 레거시 기능·실행 화면 | 레거시 동작과 화면 기준으로 변환                               |

UI 화면은 Figma 또는 실행 중인 레거시 화면을 기준 이미지로 비교합니다. 기준 이미지가 없으면 점수를 추측하지 않고 Gap으로 남깁니다.

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

`brief`는 기획서 경로, `figma`는 Figma URL, `legacy`는 별도 레거시 프로젝트 경로가 필요합니다. `feature`는 요청만으로 시작할 수 있습니다. `brief`와 `feature`는 구현 전에 대상 프로젝트의 OpenSpec 변경 문서를 작성하고 자료와 대조합니다.

`brief`와 `feature`에는 `test: on | off`를 넣을 수 있으며 생략하면 `off`입니다. `on`이면 OpenSpec 수용 시나리오를 실패 테스트로 먼저 만든 뒤 구현·통과·리팩터링하는 TDD를 합니다. `off`면 이 변경을 위한 단위·통합 테스트를 만들거나 실행하지 않습니다. `feature`의 E2E·영상은 test와 별개로 유지됩니다.

## Draft PR 형식

PR에는 아래 내용만 포함합니다.

1. 한국어로 쓴 개발한 기능
2. Figma 또는 레거시 기준 화면의 일치율과 Diff
3. 실제 사용한 API의 method, path, 목적
4. 개발하지 못했거나 확인이 필요한 Gap
5. 실행한 검증 명령과 결과
6. `feature`일 때만 변경 기능 E2E와 사용자 흐름 영상 1개

일치율이 92% 미만이면 Diff를 보고 수정한 뒤 같은 기준으로 다시 비교합니다. 최초 비교를 포함해 최대 3회까지 시도하고, 세 번째도 미달하면 마지막 점수와 모든 Diff를 Gap에 남깁니다. 화면을 비교하지 못해도 Draft PR은 만들고, 해당 내용을 Gap으로 표시합니다.

## 화면 비교

스킬에 포함된 `compare-images.cjs`는 같은 크기의 PNG 두 장을 비교해 일치율과 Diff PNG를 만듭니다.

```bash
node /absolute/path/to/compare-images.cjs \
  --baseline spec-to-pr-evidence/checkout/baseline.png \
  --actual spec-to-pr-evidence/checkout/actual.png \
  --diff spec-to-pr-evidence/checkout/diff.png
```

생성된 화면 증빙은 `spec-to-pr-evidence/<변경명>/`에 커밋하고 Draft PR에서 연결합니다.

## GitLab Draft MR 사전 진단

GitLab remote에서는 구현 전에 remote, `glab` 인증, 프로젝트 접근, MR API 읽기 접근, 확인 가능한 Developer 이상 권한을 순서대로 읽기 전용 점검합니다. 준비가 안 됐으면 코드 변경을 시작하지 않고 해결 순서를 안내합니다. GitLab에는 Draft MR 생성 dry-run이 없으므로 실제 `glab mr create --draft` 또는 기존 Draft 갱신 성공과 MR URL 확인이 마지막 조건입니다.

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
- API·레거시를 전수 분석하는 런타임

PR 생성은 Codex·Claude Code의 GitHub/GitLab 연결 또는 `gh`/`glab`을 사용합니다. GitLab은 사전 진단이 통과해도 실제 Draft MR 생성·갱신이 성공해야 완료로 기록합니다.
