---
sidebar_position: 2
title: 설정 · CLI · 환경변수
---

# 설정 · CLI · 환경변수

## Delivery profile

Mode는 납품·증거 동작을 정하고 source는 독립적으로 조합됩니다.

| 필드                        | 값                                                                  | 의미                                           |
| --------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| `mode`                      | `auto`, `brief`, `legacy`, `feature`, `figma`                       | delivery/evidence profile                      |
| `changeKind`                | `auto`, `feature`, `fix`, `refactor`, `migration`, `design`, `docs` | 변경 성격                                      |
| `publication`               | `draft`, `none`                                                     | draft 발행 여부                                |
| `briefPath`                 | project-relative path                                               | 단일 brief source                              |
| `legacyProjectRoot`         | absolute directory                                                  | 별도 read-only legacy source                   |
| `legacyNetworkEvidencePath` | project-relative HAR/JSON                                           | 모호한 legacy API를 해소하는 선택 runtime 증거 |
| `figmaUrl`                  | URL                                                                 | 단일 Figma source                              |
| `docsPaths`                 | project-relative path 배열                                          | 보조 문서, 최대 20개                           |
| `openApiPaths`              | project-relative path 배열                                          | OpenAPI 문서, 최대 20개                        |
| `openApiUrls`               | HTTPS URL 배열                                                      | OpenAPI/Swagger UI URL, 최대 20개              |
| `guidancePaths`             | project-relative path 배열                                          | 명시적 project guidance, 최대 20개             |
| `discoveredGuidancePaths`   | 정규화된 project-relative path 배열                                 | runtime이 발견해 profile에 기록한 guidance     |
| `skillHints`                | 설치 skill 이름 배열                                                | 선택적 가용성 확인, 최대 20개                  |

`brief`/`feature`는 brief + Figma + OpenAPI를, `legacy`는 별도 `legacyProjectRoot`와 running legacy baseline을, `figma`는 deterministic mock manifest/fixture를 요구합니다. Feature만 `targetedFeatureE2E`/`featureVideo`를 추가합니다. Intake는 조회 시각이 있는 `sourceProvenance`와 OpenAPI 전체 operation을 고정합니다. Legacy inventory는 semantic terminal API candidate, environment `originRef`, transport/callsite, confidence를 기록하며 생성자와 로컬 facade는 operation으로 중복 등록하지 않습니다. 선택 `legacyNetworkEvidencePath`는 표준 HAR/request JSON을 1 MB·1,000 request로 제한하고 digest와 `runtime-network-har` adapter를 고정합니다. 유일하게 해소되지 않은 method/path는 `collect-legacy-network-evidence` action과 `legacy-network-evidence` submission으로 같은 Run에서 보강합니다. Contracts는 `visualTargets`와 legacy planned coverage를, implementation은 current-packet legacy/API coverage와 `performanceEvidence`를 담당합니다. Visual capture는 target route/state/viewport/device scale/fixture, provider, ISO capture time, PNG path, digest를 반복하며 runtime이 target drift·digest mismatch를 거부하고 최소 98%·mask 최대 20% `compare-visuals`를 계산합니다. Report는 ready/blocked 15-section JSON/Markdown을 만들고, 새 발행은 legacy adapter 목록과 inventory digest를 검증합니다.

### Bounded guidance discovery

Runtime은 재귀 scan 없이 다음 root-relative 후보만 확인합니다.

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/etc/folder-structure.md`

명시적 path는 반드시 존재해야 합니다. 자동 후보와 선택 skill이 없으면 무시합니다. Source는 canonical project root 안의 1 MB 이하 regular file이어야 하며 역할별 최대 20개로 제한됩니다.

충돌 시 precedence는 다음 표현 그대로 적용합니다: current user request → explicit `guidancePaths` → automatically discovered project guidance → applicable installed skills → SpecToPR defaults. `skillHints`는 availability와 applicability를 확인하는 이름이며 skill 본문이나 임의 파일 경로가 아닙니다.

## SDK runner CLI

```bash
node packages/codex-sdk/dist/cli.js \
  --cwd /path/to/app \
  --mode feature \
  --change-kind feature \
  --prompt "저장 주소 선택 기능 추가" \
  --publish
```

| Option                   | 설명                             |
| ------------------------ | -------------------------------- |
| `--cwd <path>`           | 대상 저장소, 필수                |
| `--prompt <text>`        | 변경 요청/제약                   |
| `--mode <mode>`          | delivery mode                    |
| `--change-kind <kind>`   | 변경 분류                        |
| `--brief <path>`         | brief/spec 입력                  |
| `--legacy-project <p>`   | 별도 legacy project root         |
| `--legacy-network <p>`   | project-local bounded HAR/JSON   |
| `--docs <path>`          | 반복 가능한 보조 문서 입력       |
| `--figma <url>`          | Figma file/node URL              |
| `--openapi <path>`       | 반복 가능한 OpenAPI 입력         |
| `--openapi-url <url>`    | 반복 가능한 HTTPS OpenAPI URL    |
| `--guidance <path>`      | 반복 가능한 명시적 guidance      |
| `--skill <name>`         | 반복 가능한 선택 skill hint      |
| `--publish`              | 준비되면 draft PR/MR 발행        |
| `--no-publish`           | 구현·리뷰 evidence까지만         |
| `--resume <task-id>`     | 기존 Codex task 재개             |
| `--model <model>`        | model override                   |
| `--max-turns <n>`        | action-group turn 상한, 기본 12  |
| `--usage-history <p>`    | 숫자 전용 calibration JSONL 경로 |
| `--no-usage-calibration` | usage 보정 읽기/쓰기 비활성화    |
| `--no-review-agents`     | 독립 reviewer instruction 생략   |

Mode를 생략하면 legacy root는 `legacy`, brief path는 `brief`, Figma URL은 `figma`, 나머지는 `auto`로 분류됩니다. 네 명시적 delivery mode 모두 `--no-publish`가 없으면 draft publication을 요청합니다.

SDK가 workload class 기본 최대값을 자동 hard limit으로 사용합니다. 사용자가 숫자 한도를 지정하지 않고 calibration도 이 limit을 바꾸지 않습니다. Contracts에서 size가 바뀌면 SDK가 runtime estimate와 전체 `requiredValidations`를 다음 경계부터 반영합니다. 완료된 action turn 뒤 80%를 넘으면 compact checkpoint로 fresh thread를 시작합니다. Hard limit이면 크기와 관계없이 `split-required`를 반환하고 독립적으로 검증 가능한 범위로 나눕니다. Usage가 없으면 `usage-unavailable`이며 required validation은 유지됩니다. Calibration은 표시 범위만 보정하고 과거에 다른 hard limit으로 기록된 표본은 제외합니다.

`--resume <task-id>`는 task history의 최신 run ID를 복구해 `workflow_status`부터 호출합니다. `resumeContext`의 목표, 프로젝트 상대 evidence 경로, 제출 요약으로 기존 Run을 이어가며 intake나 Run 생성을 반복하지 않습니다.

## 환경변수

| 변수                                    | 기본/해석                       | 용도                               |
| --------------------------------------- | ------------------------------- | ---------------------------------- |
| `SPEC_TO_PR_DATA_DIR`                   | host plugin data 또는 temp 경로 | durable Run/evidence 저장 위치     |
| `GITHUB_TOKEN` / `GH_TOKEN`             | 없으면 `gh auth token`          | GitHub API 인증                    |
| `GITLAB_TOKEN` / `GITLAB_PRIVATE_TOKEN` | 없으면 `glab auth token`        | GitLab API 인증                    |
| `SPEC_TO_PR_GIT_HOST`                   | remote에서 감지                 | self-hosted GitHub/GitLab override |
| `SPEC_TO_PR_API_BASE_URL`               | host 기반 기본값                | self-hosted API endpoint           |
| `SPEC_TO_PR_WEB_BASE_URL`               | host 기반 기본값                | review request URL base            |

SDK calibration 기본 파일은 대상 저장소 밖의 `~/.codex/spec-to-pr/usage-history.jsonl`입니다. mode/workload와 숫자 counter만 기록하며 prompt, code, diff, repository path, tool output, final response는 기록하지 않습니다. Complete usage가 있는 신규 비재개 완료 실행만 보정 표본이 됩니다. 원 mode와 whole-Run usage를 이 invocation만으로 알 수 없는 resume은 mode별 history를 읽지 않고 tail 기록도 `skipped` 처리합니다. History I/O는 best-effort이며 실패하면 결과의 `usageCalibration` 진단만 `unavailable`로 바뀝니다. `--usage-history`로 위치를 바꾸거나 `--no-usage-calibration`으로 완전히 끌 수 있습니다.

활성화된 `--usage-history`가 실제 경로 또는 symlink alias로 대상 저장소 내부를 가리키거나 기존 history 파일이 hard link라면 publication clean tree를 오염시킬 수 있어 입력 단계에서 거부합니다. 상대 경로는 target `--cwd` 기준으로 해석됩니다.

Programmatic `outputSchema`의 적용 여부는 `outputFormatting`으로 확인합니다. `budget-skipped`나 `usage-unavailable`이면 terminal workflow는 끝났지만 final response에 caller schema를 적용하는 추가 turn은 실행하지 않은 상태입니다. `failed`이면 선택적 formatting turn만 실패한 것이며, 완료된 workflow의 원래 terminal response와 evidence는 그대로 반환됩니다. 실패한 formatting turn의 usage는 알 수 없으므로 aggregate usage는 partial이고 calibration 기록은 건너뜁니다.

토큰이 없으면 required publish evidence를 만족할 수 없으므로 publication이 blocker를 보고합니다. 토큰 값을 로그나 report에 출력하지 않습니다.

## MCP server

Claude plugin의 local stdio 설정은 번들된 server를 실행합니다.

```json
{
  "mcpServers": {
    "spec_to_pr": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js"],
      "env": {
        "SPEC_TO_PR_DATA_DIR": "${CLAUDE_PLUGIN_DATA}"
      }
    }
  }
}
```

Codex에서는 이름이 `mcp__spec_to_pr__*`로 정규화될 수 있습니다. 어느 호스트든 public tool은 동일한 7개이고 contract version은 `2.0.0`입니다.

## Gate 기본 정책

- normal code: available format/lint, typecheck, build, focused functional test
- UI: applicable visual/interaction/accessibility evidence와 design review
- targeted security/performance: scope가 해당될 때만
- observability: opt-in
- full matrix, archive/package/cross-host validation: release-only

선택 script가 없으면 not applicable입니다. 필수 check를 실행하지 않았거나 skip/실패했다면 passed로 바꾸지 않습니다.
