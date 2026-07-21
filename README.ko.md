# SpecToPR

기획서·Figma·API 전체 개발, 별도 레거시 프로젝트 이관, 기능 단위 E2E/영상, mock 기반 Figma 구현을 검증된 draft PR/MR까지 연결하는 플러그인입니다.

English version: [README.md](README.md)

> **개발 상태:** 이 브랜치는 패키지 `0.2.1` 위의 **Unreleased** 변경을 설명합니다. 새 버전을 배포하기 전에 CHANGELOG를 확인하세요.

## 네 가지 납품 모드

| 모드      | 입력                            | 검증                                      | 결과                  |
| --------- | ------------------------------- | ----------------------------------------- | --------------------- |
| `brief`   | 기획서/PDF/MD + Figma + OpenAPI | API/UI, Figma 일치율, API gap, Web Vitals | 15개 섹션 draft PR/MR |
| `legacy`  | 대상 + 별도 `legacyProjectRoot` | inventory/coverage, running legacy 비교   | migration draft PR/MR |
| `feature` | 한 기능의 동일한 전체 입력      | 전체 증거 + 기능 E2E와 영상 정확히 1개    | 영상 포함 draft PR/MR |
| `figma`   | Figma URL과 대상 저장소         | deterministic mock과 수치화된 Figma 비교  | 디자인 draft PR/MR    |

모드별 추가 증거가 필요 없는 가벼운 요청은 `auto`를 사용할 수 있습니다.

`brief`와 `feature`는 `briefPath`, `figmaUrl`, 로컬 `openApiPaths` 또는 HTTPS `openApiUrls`를 요구합니다. `legacy`는 별도 read-only `legacyProjectRoot`를 요구하며 source만으로 request method/path를 확정할 수 없을 때 프로젝트 내부 `legacyNetworkEvidencePath`를 추가할 수 있습니다. `figma`는 Figma와 mock 데이터만 사용합니다. `docsPaths`, `guidancePaths`, 선택적 `skillHints`는 독립적으로 조합됩니다.

`feature` 모드는 테스트 경로, 태그, 프로젝트 중 하나로 변경 기능을 고른 Playwright 명령 하나만 허용합니다. 명령 체이닝, 테스트 나열·0건 통과 옵션, 전체 프로젝트 E2E는 거부합니다. Strict JSON 결과에는 `status: passed`, 정확한 `selector`, 제출과 같은 `implementationContextId`, 양수 `testCount`만 있어야 합니다. 영상은 재생 시간이 0보다 큰 구조적으로 유효한 WebM/MP4 컨테이너 한 개이며 25 MB 이하여야 합니다. 다른 모드는 delivery profile이 명시적으로 요구하지 않는 한 기능 영상을 만들지 않습니다.

어떤 delivery profile이든 `figmaUrl`이 있으면 호스트에 이미 연결된 Figma 기능을 사용합니다. `provider: host-connected-figma`, ISO `capturedAt`, 같은 `fileUrl`, 비어 있지 않은 `nodeIds`, 명시적인 `manifestPath`, 실제 PNG 한 개 이상을 담은 `figma-bundle`을 정확히 한 번 제출합니다. Strict manifest는 동일한 출처 값과 PNG `visualPaths`를 반복합니다. Figma 전용 runtime microtool이나 polling은 추가하지 않습니다.

Intake는 조회 시각과 raw digest가 있는 `sourceProvenance`를 고정합니다. Brief/feature는 제공된 OpenAPI 전체 operation을 고정합니다. Legacy는 별도 프로젝트에서 실행한 bounded fetch/dynamic-fetch/HTTP-client/request-config/generated-client adapter 목록과 candidate confidence를 공개하고 API 후보를 파생하며, 선택 OpenAPI는 보강 자료로만 사용합니다. 프로젝트 내부 `legacyNetworkEvidencePath`는 표준 HAR JSON, `{requests:[{method,url}]}`, `[{method,url}]` 중 하나를 최대 1 MB·1,000 request까지 받고 digest와 `runtime-network-har` adapter를 inventory에 고정합니다. 후보가 0개여도 legacy API 섹션은 `not-applicable`이 아니라 adapter 목록과 inventory digest에 묶인 `complete`입니다. 모호한 method/path는 유일한 scoped OpenAPI/runtime 근거로만 해소하며 그렇지 않으면 Run ID를 보존한 durable intake blocker가 되고 downstream action·submission도 열리지 않습니다. Figma/running legacy baseline은 공통 `visualTargets`를 쓰고, actual capture는 target 상태·viewport·fixture와 provider·capture time·PNG digest를 반복합니다. `compare-visuals`는 target drift/digest mismatch를 거부하고 exact/review ratio, diff, overlay를 런타임 최소 98%, 정당한 mask 최대 20%, 비교 총 3회(최초 1회 + repair 최대 2회)로 계산합니다. Canonical `pr-report-v2.1` JSON/Markdown 15개 섹션은 `complete`, `not-run`, `blocked`, `not-applicable`을 명시합니다. 과거 v2.1은 읽을 수 있지만 새 발행에는 current adapter/digest 증거가 필요하며, blocked report는 stale packet/review/visual 주장을 제외합니다.

Runtime network evidence는 durable Run 생성 전에 로컬에서 검증합니다. HAR 원문의 header, cookie, body, query string은 intake artifact나 PR report에 복사하지 않고 프로젝트 상대 locator, raw digest, 정규화한 method/path, adapter만 남깁니다. Source에서 찾은 literal API URL도 inventory에 저장하기 전에 credential, query, fragment를 제거합니다. 발행 시 clean tree를 유지하도록 gitignore된 프로젝트 내부 evidence 디렉터리를 사용하세요.

## 경량화된 v2 표면

- **MCP tool 7개:** `workflow_info`, `workflow_start`, `workflow_advance`, `workflow_submit`, `workflow_status`, `workflow_publish`, `workflow_archive`
- **durable stage 8개:** intake, contracts, implementation, functional review, design review, report, publish, archive
- **skill 8개:** `spec-to-pr`, `doctor`, `intake-contracts`, `implement`, `review-functional`, `review-design`, `publish`, `archive-openspec`
- **독립 reviewer 2개:** `functional-reviewer`, UI 범위에만 적용되는 `design-reviewer`

API와 UI 구현은 하나의 context에서 진행합니다. API 기반 UI라면 물리적으로 서로 다른 비어 있지 않은 type, schema, wrapper, mock 파일과 `status: passed`인 JSON contract-test 결과를 안정적인 `implementationContextId`와 함께 `api-ready`로 먼저 제출하고, 최종 구현에도 같은 ID를 냅니다. Path, symlink, hard link alias는 별도 증거로 인정하지 않습니다. `apiReady: true` 주장만으로는 통과하지 않습니다. API/UI 구현 에이전트와 통합 lane을 따로 두지 않습니다. 구현 뒤 orchestrator가 `workflow_status` snapshot, contracts, diff, evidence path를 고정해 독립 reviewer에게 넘기며 reviewer는 workflow tool을 직접 호출하지 않습니다.

Intake 직후 `workflow_status`가 `XS`~`XL` 작업량, 예상 토큰 범위, 신뢰도, 근거, 80% checkpoint 기준과 authoritative required-validation 목록을 보여줍니다. 같은 status의 compact `resumeContext`에는 기록된 목표, 프로젝트 상대 evidence 경로, 제출 요약이 포함됩니다. Contracts에는 실제 관측값이 하나 이상인 숫자형 `workloadSignals`를 선택적으로 제출해 새 tool/stage 없이 추정치를 정교화할 수 있습니다. SDK는 첫 durable Run ID를 고정하고, 각 turn이 workflow action group 하나 뒤에 멈추도록 지시하며, 완료 경계마다 새 status를 요구해 실제 input+output token을 합산합니다. 80% 이상인 첫 경계에서는 compact 새 thread로 이어가고, 자동 hard limit에서는 작업 크기와 관계없이 필수 검증을 그대로 유지한 채 `split-required`로 멈춥니다. 사용자가 숫자 한도를 지정하는 기능은 없습니다. Usage가 없으면 `usage-unavailable`로 다음 action을 막습니다. 신규 완료 Run 이력은 숫자와 enum만 저장해 표시 범위만 보정하고, 자동 hard limit은 workload class 기본 최대값으로 고정됩니다. 과거에 다른 hard limit으로 기록된 표본은 보정에서도 제외합니다. Calibration history 기록은 직렬·원자적으로 처리되고, 크기와 보존 개수가 제한되며, 매 접근마다 다시 검증됩니다. Prompt, code, diff, path, tool output, final response는 저장하지 않으며 선택적 history I/O 실패가 workflow 성공을 뒤집지 않습니다.

발행은 draft GitHub PR 또는 GitLab MR을 생성·갱신하는 데서 끝납니다. Draft 흐름은 target이 아닌 `codex/*` source branch에서 의도한 변경만 commit하며, runtime은 clean tree와 target보다 한 개 이상 앞선 source commit을 요구합니다. GitHub media는 단 하나의 managed `spec-to-pr/evidence` branch에 run/packet/target/artifact 경로로 저장하고 upload commit SHA에 고정된 URL만 반환합니다. Run마다 branch를 만들거나 source branch에 media를 쓰지 않습니다. merge, approve, close, ready 전환은 하지 않습니다.

정상 발행은 `workflow_publish intent: ready`를 사용합니다. Required input/tool, policy, verification, publish precondition, budget split, unexpected failure가 Run을 막으면 redacted typed `blockerDetails`에 완료 작업, attempted recovery, 미실행 validation, exact unblock action을 남깁니다. Preflight가 유효하면 `intent: blocked-diagnostic` draft를 낼 수 있지만 계속 `status: blocked`입니다. `PUBLISH_NO_DELTA` 등 preflight가 안 되면 empty commit/issue fallback 없이 **local blocked report**를 반환합니다. Required browser proof가 없으면 `BROWSER_NOT_RUN`입니다. 복구는 같은 durable Run을 이어가며 같은 source/target의 **same draft PR**을 blocked에서 ready로 갱신합니다.

## 요구사항

- Node.js `>=22`
- Git
- Claude Code 또는 Codex
- 소스에서 빌드할 때만 `pnpm`
- 발행할 때 인증된 `gh`/`glab` 또는 지원 토큰
- Figma URL을 입력할 때 호스트에 연결된 Figma 기능
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
figmaUrl: https://www.figma.com/design/FILE/checkout?node-id=12-345
openApiUrls: [https://api.example.com/openapi.yaml]
API/UI, 화면 일치율, API gap, Web Vitals까지 검증해줘.
```

레거시 프로젝트 마이그레이션:

```text
/spec-to-pr /path/to/new-app
mode: legacy
legacyProjectRoot: /path/to/legacy-app
legacyNetworkEvidencePath: evidence/legacy-checkout.har # source가 모호할 때만 선택
레거시와 대상을 모두 실행하고 청구서 재시도 화면·동작을 대상 구조로 이관해.
running legacy 화면 대비 일치율까지 포함해 draft PR로 올려줘.
```

조합 가능한 source를 사용한 zero-to-100 사용자 기능:

```text
/spec-to-pr /path/to/app
mode: feature
briefPath: docs/checkout.md
figmaUrl: https://www.figma.com/design/FILE/checkout?node-id=12-345
openApiPaths: [docs/openapi.yaml]
docsPaths: [docs/business-rules.md, docs/error-cases.md]
guidancePaths: [docs/architecture/ARCHITECTURE.md, docs/etc/folder-structure.md]
skillHints: [react-best-practices, next-best-practices, design-system, api-generator]
API와 UI를 한 context에서 구현하고, checkout E2E 하나와 영상 하나를 검증한 뒤
project guidance와 적용한 선택 skill을 PR report에 남겨 draft PR로 발행해줘.
```

Figma 구현:

```text
/spec-to-pr /path/to/app
mode는 figma. 연결된 Figma 기능으로 https://www.figma.com/file/... 를 구현해줘.
deterministic mock을 쓰고 결과를 98% 기준으로 비교해 draft PR로 올려줘.
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

입력에는 `--brief`, `--figma`, 반복 가능한 `--openapi`/`--docs`, `--guidance`, `--skill`을 사용할 수 있습니다. `--publish`는 draft 발행을 요청하고 `--no-publish`는 구현·리뷰 증거까지만 진행합니다. `--max-turns`, `--usage-history`, `--no-usage-calibration`은 경계 실행과 숫자 전용 보정을 제어합니다.

`--resume <task-id>`는 최신 `workflow_status`와 `resumeContext`에서 기존 durable Run을 이어가며 intake를 반복하거나 중복 Run을 만들지 않습니다.

전체 계약은 [packages/codex-sdk/README.md](packages/codex-sdk/README.md)를 참고하세요.

## 검증 정책

일반 변경은 적용 가능한 format/lint, typecheck, build, 관련 기능 검사를 실행합니다. OpenSpec, architecture, targeted security, visual, accessibility, performance는 scope에 따라 적용하고 observability는 opt-in입니다. 선택 사항인 script가 없으면 not applicable이지만, 필수 증거가 없거나 비었거나 skip/실패했다면 blocked입니다.

전체 test matrix, archive integrity, package verification, cross-host manifest 검증은 release 전용입니다. 모든 feature/fix에 붙이지 않습니다.

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm plugin:validate
```

## 문서

유지되는 전체 가이드는 **https://dhyun2.github.io/spec-to-pr/** 에 있습니다. 결과부터 보여주는 퀵스타트에서 시작해 네 가지 delivery를 고르고, interactive Run pipeline에서 agent 역할과 실제 픽셀 검증까지 자연스럽게 이어집니다. Reference, troubleshooting과 Spec Kit/OpenSpec/Kiro/BMAD 공식 자료 비교는 별도로 유지합니다.

[네 가지 delivery 고르기](https://dhyun2.github.io/spec-to-pr/usage/) 또는 [기획서 → draft PR 사용법](https://dhyun2.github.io/spec-to-pr/usage/brief)에서 필수 입력, 복사 가능한 프롬프트, 진행 단계, blocker, 증거와 예상 draft PR을 확인할 수 있습니다.

[Run 파이프라인](https://dhyun2.github.io/spec-to-pr/concepts/pipeline)을 따라간 뒤 [agent 리뷰 소유권](https://dhyun2.github.io/spec-to-pr/concepts/reviews)과 [시각 검증](https://dhyun2.github.io/spec-to-pr/concepts/visual-verification)에서 정확한 `pngjs` RGBA 비교, threshold, mask, diff, overlay, provenance gate를 확인할 수 있습니다.

[비교와 채택 정책](https://dhyun2.github.io/spec-to-pr/concepts/comparison)에서 adopted, conditional, rejected orchestration pattern을 확인할 수 있습니다.

```bash
pnpm --dir website install
pnpm --dir website start
```

현재 구조 결정은 [ADR 035](docs/adr/035-use-coarse-workflow-facade-and-split-reviews.md), [ADR 036](docs/adr/036-use-delivery-profiles-not-mode-specific-pipelines.md), [ADR 037](docs/adr/037-use-boundary-budgeting-and-numeric-calibration.md), [ADR 038](docs/adr/038-harden-evidence-trust-and-unify-delivery-policy.md)에 정리되어 있습니다.
