# SpecToPR

기획서, 레거시 변경 요청, 사용자 기능, Figma 디자인을 검증된 구현과 draft PR/MR까지 연결하는 증거 기반 Claude Code / Codex 플러그인입니다.

English version: [README.md](README.md)

## 네 가지 납품 모드

| 모드      | 입력                        | 검증                                                 | 결과                             |
| --------- | --------------------------- | ---------------------------------------------------- | -------------------------------- |
| `brief`   | 기획서/명세와 대상 저장소   | 수용 조건, 계약, 구현, 관련 검사                     | 증거가 포함된 draft PR/MR        |
| `legacy`  | 저장소와 구체적인 변경 요청 | 요청 범위의 현재 동작 baseline과 영향받은 회귀 범위  | 증거가 포함된 draft PR/MR        |
| `feature` | 사용자에게 보이는 기능 요청 | 변경 기능만 고른 E2E와 정확히 한 개의 `.webm`/`.mp4` | 영상 링크가 포함된 draft PR/MR   |
| `figma`   | Figma URL과 대상 저장소     | 실제 Figma context, 구현, 시각·상호작용 증거         | 디자인 구현, 요청 시 draft PR/MR |

모드별 추가 증거가 필요 없는 가벼운 요청은 `auto`를 사용할 수 있습니다.

`feature` 모드는 테스트 경로, 태그, 프로젝트 중 하나로 변경 기능을 고른 Playwright 명령 하나만 허용합니다. 명령 체이닝, 테스트 나열·0건 통과 옵션, 전체 프로젝트 E2E는 거부합니다. Strict JSON 결과에는 `status: passed`, 정확한 `selector`, 제출과 같은 `implementationContextId`, 양수 `testCount`만 있어야 합니다. 영상은 재생 시간이 0보다 큰 구조적으로 유효한 WebM/MP4 컨테이너 한 개이며 25 MB 이하여야 합니다. 다른 모드는 delivery profile이 명시적으로 요구하지 않는 한 기능 영상을 만들지 않습니다.

`figma` 모드는 호스트에 이미 연결된 Figma 기능을 사용합니다. `provider: host-connected-figma`, ISO `capturedAt`, 같은 `fileUrl`, 비어 있지 않은 `nodeIds`, 명시적인 `manifestPath`, 실제 PNG 한 개 이상을 담은 `figma-bundle`을 정확히 한 번 제출합니다. Strict manifest는 동일한 출처 값과 PNG `visualPaths`를 반복합니다. Figma 전용 runtime microtool이나 polling은 추가하지 않습니다.

## 경량화된 v2 표면

- **MCP tool 7개:** `workflow_info`, `workflow_start`, `workflow_advance`, `workflow_submit`, `workflow_status`, `workflow_publish`, `workflow_archive`
- **durable stage 8개:** intake, contracts, implementation, functional review, design review, report, publish, archive
- **skill 9개:** `spec-to-pr`, `doctor`, `intake-contracts`, `implement`, `review-functional`, `review-design`, `publish`, `archive-openspec`, `prepare-release`
- **독립 reviewer 2개:** `functional-reviewer`, UI 범위에만 적용되는 `design-reviewer`

API와 UI 구현은 하나의 context에서 진행합니다. API 기반 UI라면 물리적으로 서로 다른 비어 있지 않은 type, schema, wrapper, mock 파일과 `status: passed`인 JSON contract-test 결과를 안정적인 `implementationContextId`와 함께 `api-ready`로 먼저 제출하고, 최종 구현에도 같은 ID를 냅니다. Path, symlink, hard link alias는 별도 증거로 인정하지 않습니다. `apiReady: true` 주장만으로는 통과하지 않습니다. API/UI 구현 에이전트와 통합 lane을 따로 두지 않습니다. 구현 뒤 orchestrator가 `workflow_status` snapshot, contracts, diff, evidence path를 고정해 독립 reviewer에게 넘기며 reviewer는 workflow tool을 직접 호출하지 않습니다.

발행은 draft GitHub PR 또는 GitLab MR을 생성·갱신하는 데서 끝납니다. Draft 흐름은 target이 아닌 `codex/*` source branch에서 의도한 변경만 commit하며, runtime은 clean tree와 target보다 한 개 이상 앞선 source commit을 요구합니다. merge, approve, close, ready 전환은 하지 않습니다.

## 요구사항

- Node.js `>=22`
- Git
- Claude Code 또는 Codex
- 소스에서 빌드할 때만 `pnpm`
- 발행할 때 인증된 `gh`/`glab` 또는 지원 토큰
- Figma 모드에서만 호스트에 연결된 Figma 기능
- 사용자 기능 모드에서만 영상 녹화를 지원하는 브라우저 테스트 환경

## 설치

Claude Code:

```text
/plugin marketplace add dhyun2/spec-to-pr
/plugin install spec-to-pr@spec-to-pr
```

Codex:

```bash
codex plugin marketplace add https://github.com/dhyun2/spec-to-pr --ref main
codex plugin add spec-to-pr@spec-to-pr
```

설치 후 호스트를 재시작하고 Doctor를 실행합니다.

```text
/spec-to-pr:doctor
```

로컬 개발:

```bash
git clone https://github.com/dhyun2/spec-to-pr.git
cd spec-to-pr
corepack enable
pnpm install
pnpm build
pnpm plugin:validate
```

## 사용 예시

기획서에서 draft PR까지:

```text
/spec-to-pr /path/to/app
mode는 brief, 기획서는 docs/checkout.md야. 구현하고 검증해서 draft PR로 올려줘.
```

레거시 저장소의 특정 변경:

```text
/spec-to-pr /path/to/legacy-app
mode는 legacy. 청구서 재시도 동작만 바꿔줘. 현재 동작을 먼저 증거로 남기고,
영향받은 검사만 실행한 다음 draft PR로 올려줘. 제품 전체를 조사하거나 이관하지 마.
```

사용자 기능 + 제한된 E2E 증거:

```text
/spec-to-pr /path/to/app
mode는 feature. 저장 주소 선택 기능을 추가해줘. 이 기능의 E2E만 실행하고
영상은 정확히 하나만 녹화해서 draft PR에 링크해줘.
```

Figma 구현:

```text
/spec-to-pr /path/to/app
mode는 figma. 연결된 Figma 기능으로 https://www.figma.com/file/... 를 구현해줘.
URL만 근거로 삼거나 polling하지 말고 실제 Figma evidence를 제출해줘.
```

## Codex SDK runner

CI와 내부 자동화에서는 SDK runner를 사용할 수 있습니다.

```bash
pnpm --dir packages/codex-sdk install
pnpm --dir packages/codex-sdk build
node packages/codex-sdk/dist/cli.js \
  --cwd /path/to/app \
  --mode feature \
  --change-kind feature \
  --prompt "저장 주소 선택 기능 추가" \
  --publish
```

입력에는 `--brief`, `--figma`, `--openapi`, `--docs`를 사용할 수 있습니다. `--publish`는 draft 발행을 요청하고 `--no-publish`는 구현·리뷰 증거까지만 진행합니다.

전체 계약은 [packages/codex-sdk/README.md](packages/codex-sdk/README.md)를 참고하세요.

## 검증 정책

일반 변경은 적용 가능한 format/lint, typecheck, build, 관련 기능 검사를 실행합니다. OpenSpec, architecture, targeted security, visual, accessibility, performance는 scope에 따라 적용하고 observability는 opt-in입니다. 선택 사항인 script가 없으면 not applicable이지만, 필수 증거가 없거나 비었거나 skip/실패했다면 blocked입니다.

전체 test matrix, hardening, package verification, cross-host manifest 검증은 release 전용입니다. 모든 feature/fix에 붙이지 않습니다.

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm plugin:validate
```

## 문서

유지되는 전체 가이드는 **https://dhyun2.github.io/spec-to-pr/** 에 있습니다. 사전 준비, 설치, 네 가지 모드, v2 pipeline, skill, 설정, 트러블슈팅을 다룹니다.

```bash
pnpm --dir website install
pnpm --dir website start
```

현재 구조 결정은 [ADR 035](docs/adr/035-use-coarse-workflow-facade-and-split-reviews.md)와 [ADR 036](docs/adr/036-use-delivery-profiles-not-mode-specific-pipelines.md)에 정리되어 있습니다.
