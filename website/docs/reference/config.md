---
sidebar_position: 2
title: 설정 · CLI · 환경변수
---

# 설정 · CLI · 환경변수

## 제공 방식 설정

`mode`는 최종 결과와 필요한 검증을 정합니다. 입력 자료는 필요한 만큼 조합할 수 있습니다.

| 필드                        | 값                                                                  | 의미                                      |
| --------------------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| `mode`                      | `auto`, `brief`, `legacy`, `feature`, `figma`                       | 제공 방식과 검증 기준                     |
| `changeKind`                | `auto`, `feature`, `fix`, `refactor`, `migration`, `design`, `docs` | 변경 성격                                 |
| `publication`               | `draft`, `none`                                                     | 초안 발행 여부                            |
| `briefPath`                 | 프로젝트 상대 경로                                                  | 기획서 파일 하나                          |
| `legacyProjectRoot`         | 절대 경로                                                           | 별도의 읽기 전용 레거시 프로젝트          |
| `legacyNetworkEvidencePath` | 프로젝트 상대 HAR/JSON 경로                                         | 모호한 레거시 API를 확인할 실행 자료      |
| `figmaUrl`                  | URL                                                                 | Figma 파일 또는 노드                      |
| `docsPaths`                 | 프로젝트 상대 경로 배열                                             | 보조 문서, 최대 20개                      |
| `openApiPaths`              | 프로젝트 상대 경로 배열                                             | OpenAPI 문서, 최대 20개                   |
| `openApiUrls`               | HTTPS URL 배열                                                      | OpenAPI 또는 Swagger UI 주소, 최대 20개   |
| `guidancePaths`             | 프로젝트 상대 경로 배열                                             | 직접 지정할 프로젝트 지침, 최대 20개      |
| `discoveredGuidancePaths`   | 정규화한 프로젝트 상대 경로 배열                                    | 실행 엔진이 찾아 설정에 기록한 지침       |
| `skillHints`                | 설치된 스킬 이름 배열                                               | 적용 가능성을 확인할 선택 스킬, 최대 20개 |

### 방식별 필수 자료

- `brief`, `feature`: 기획서, Figma, OpenAPI
- `legacy`: 별도 `legacyProjectRoot`가 필요합니다. 기준 화면은 SpecToPR이 레거시를 실행해 만듭니다.
- `figma`: 고정된 모의 데이터 목록과 테스트 데이터
- `feature`: 위 자료에 `targetedFeatureE2E`와 `featureVideo`를 추가

접수 단계는 조회 시각과 원본 해시가 있는 `sourceProvenance`로 입력 자료를 고정합니다. 레거시 이관에서는 `legacyInventory`에 실제로 연결된 API만 적용 범위에 넣고, OpenAPI의 나머지 항목은 이관 대상으로 늘리지 않습니다. 계약 단계는 `visualTargets`와 예정된 레거시 이관 범위를, 구현 단계는 현재 검토 묶음의 레거시·API 검증 현황과 `performanceEvidence`를 담당합니다.

### 레거시 API 확인

`legacyInventory`에는 실제 HTTP 요청 후보, 환경별 `originRef`, 전송 방식과 호출 위치, 신뢰도를 기록합니다. 생성자와 로컬 파사드는 별도 API 작업으로 중복 등록하지 않습니다.

코드만으로 메서드와 경로를 하나로 확정할 수 없으면 `collect-legacy-network-evidence`를 요청합니다. `legacyNetworkEvidencePath`에는 최대 1 MB, 1,000개 요청의 표준 HAR 또는 요청 JSON만 받을 수 있습니다. 파일 해시와 `runtime-network-har` 탐지 방식도 함께 기록합니다. 자료를 `legacy-network-evidence`로 제출하면 새 실행을 만들지 않고 같은 실행의 접수 단계에서 이어갑니다.

### 화면 비교와 보고서

기준 화면과 결과 화면은 같은 경로·상태·화면 크기·기기 배율·테스트 데이터로 캡처합니다. 자료 제공자, ISO 형식의 촬영 시각, PNG 경로, 해시도 함께 기록합니다. 실행 엔진은 조건이나 해시가 다르면 시도 횟수를 소비하지 않고 비교를 거부하며, `compare-visuals`는 고정 일치율 92% 이상과 제외 영역 20% 이하를 요구합니다. 유효 비교 세 번은 자동으로 이어지고, 세 번째 실패는 실행을 `blocked`로 유지하며 실패 이미지를 포함한 진단 초안을 허용합니다.

보고서는 정상 결과와 차단 결과 모두 `pr-report-v2.1`의 15개 섹션을 JSON과 Markdown으로 만듭니다. 새 초안을 발행할 때는 레거시 어댑터 목록과 `legacyInventory` 해시가 현재 검토 묶음과 일치하는지도 확인합니다.

### 프로젝트 지침을 찾는 범위

실행 엔진은 하위 폴더를 재귀적으로 훑지 않고 프로젝트 루트를 기준으로 다음 후보만 확인합니다.

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/etc/folder-structure.md`

직접 지정한 경로는 반드시 존재해야 합니다. 자동 후보와 선택 스킬은 없으면 건너뜁니다. 입력 자료는 정규화한 프로젝트 루트 안의 1 MB 이하 일반 파일이어야 하며 역할별 최대 20개로 제한됩니다.

내용이 충돌하면 **현재 사용자 요청 → 직접 지정한 `guidancePaths` → 자동으로 찾은 프로젝트 지침 → 설치되어 있고 현재 작업에 맞는 스킬 → SpecToPR 기본값** 순서로 판단합니다. `skillHints`는 설치 여부와 적용 가능성을 확인할 스킬 이름이며, 스킬 본문이나 임의 파일 경로가 아닙니다.

## SDK 실행 명령

```bash
node packages/codex-sdk/dist/cli.js \
  --cwd /path/to/app \
  --mode feature \
  --change-kind feature \
  --prompt "저장 주소 선택 기능 추가" \
  --publish
```

| 옵션                     | 설명                                |
| ------------------------ | ----------------------------------- |
| `--cwd <path>`           | 대상 저장소, 필수                   |
| `--prompt <text>`        | 변경 요청/제약                      |
| `--mode <mode>`          | 제공 방식                           |
| `--change-kind <kind>`   | 변경 분류                           |
| `--brief <path>`         | 기획서 입력                         |
| `--legacy-project <p>`   | 별도 레거시 프로젝트 루트           |
| `--legacy-network <p>`   | 프로젝트 안의 제한된 HAR/JSON       |
| `--docs <path>`          | 반복 가능한 보조 문서 입력          |
| `--figma <url>`          | Figma 파일/노드 URL                 |
| `--openapi <path>`       | 반복 가능한 OpenAPI 입력            |
| `--openapi-url <url>`    | 반복 가능한 HTTPS OpenAPI URL       |
| `--guidance <path>`      | 반복 가능한 프로젝트 지침           |
| `--skill <name>`         | 반복 가능한 선택 스킬 이름          |
| `--publish`              | 준비되면 초안 PR/MR 발행            |
| `--no-publish`           | 구현·검토와 검증 자료까지만 생성    |
| `--resume <task-id>`     | 기존 Codex 작업 재개                |
| `--model <model>`        | 사용할 모델 지정                    |
| `--max-turns <n>`        | 작업 묶음별 최대 실행 횟수, 기본 12 |
| `--turn-timeout-seconds <n>` | 한 작업 차례가 이 시간을 넘으면 취소하고 재개 가능한 상태로 반환 |
| `--run-timeout-seconds <n>` | 전체 실행이 이 시간을 넘으면 취소하고 재개 가능한 상태로 반환 |
| `--usage-history <p>`    | 숫자 전용 사용량 보정 JSONL 경로    |
| `--no-usage-calibration` | 사용량 보정 읽기/쓰기 비활성화      |
| `--no-review-agents`     | 검토를 위임하지 않고 현재 작업 맥락에서 필수 검토 자료를 제출 |

`mode`를 생략하면 레거시 루트는 `legacy`, 기획서 경로는 `brief`, Figma URL은 `figma`, 나머지는 `auto`로 분류됩니다. 네 가지 명시적 제공 방식은 `--no-publish`가 없으면 초안 발행을 요청합니다.

SDK는 예상 작업량 등급의 기본 최대값을 사용량 상한으로 사용합니다. 사용자가 별도 숫자 한도를 지정하지 않으며, 사용량 보정도 이 상한을 바꾸지 않습니다. 계약 단계에서 작업 크기가 바뀌면 다음 경계부터 예상치와 전체 `requiredValidations`에 반영합니다.

작업 묶음 하나가 끝난 뒤 사용량이 80%를 넘으면 진행 상태를 저장하고 새 작업 맥락에서 이어갑니다. 상한에 도달하면 작업 크기와 관계없이 `split-required`를 반환하고 독립적으로 검증 가능한 범위로 나눕니다. 사용량을 알 수 없으면 `usage-unavailable`로 표시하지만 필수 검증은 그대로 유지합니다. 사용량 보정은 화면에 표시할 범위만 조정하며, 다른 상한으로 기록된 과거 표본은 제외합니다.

SDK 기본 시간 예산은 한 작업 차례 10분, 전체 실행 45분입니다. `turn-timeout` 또는 `run-timeout`이면 검증을 통과한 것으로 처리하지 않고, 현재 스레드와 마지막 지속 상태를 반환합니다. 같은 스레드를 재개해 차단 원인을 해결한 뒤 계속할 수 있습니다. `budget.elapsedMs`, `budget.actionTurns`, `budget.formatTurn`에서 실제 대기 구간을 확인할 수 있으며, 더 큰 시간 예산은 명시한 CLI 옵션으로만 허용됩니다.

`--resume <task-id>`는 작업 기록에서 최신 실행 ID를 복구한 뒤 `workflow_status`부터 호출합니다. `resumeContext`에 기록된 목표, 프로젝트 상대 검증 자료 경로, 제출 요약으로 기존 실행을 이어가며 접수나 실행 생성을 반복하지 않습니다.

## 환경변수

| 변수                                    | 기본/해석                             | 용도                            |
| --------------------------------------- | ------------------------------------- | ------------------------------- |
| `SPEC_TO_PR_DATA_DIR`                   | 호스트 플러그인 데이터 또는 임시 경로 | 실행 상태와 검증 자료 저장 위치 |
| `GITHUB_TOKEN` / `GH_TOKEN`             | 없으면 `gh auth token`                | GitHub API 인증                 |
| `GITLAB_TOKEN` / `GITLAB_PRIVATE_TOKEN` | 없으면 `glab auth token`              | GitLab API 인증                 |
| `SPEC_TO_PR_GIT_HOST`                   | 원격 저장소에서 감지                  | 자체 호스팅 GitHub/GitLab 지정  |
| `SPEC_TO_PR_API_BASE_URL`               | 호스트 기반 기본값                    | 자체 호스팅 API 주소            |
| `SPEC_TO_PR_WEB_BASE_URL`               | 호스트 기반 기본값                    | 검토 요청의 웹 주소 기준        |

SDK의 사용량 보정 파일은 기본적으로 대상 저장소 밖의 `~/.codex/spec-to-pr/usage-history.jsonl`에 둡니다. `mode`, 작업량, 숫자 사용량만 기록하며 프롬프트·코드·코드 차이·저장소 경로·도구 출력·최종 답변은 저장하지 않습니다.

보정에는 사용량을 완전히 확인할 수 있는 새 완료 실행만 사용합니다. 재개한 실행에서 원래 `mode`나 전체 사용량을 알 수 없으면 과거 기록을 읽거나 새 표본을 추가하지 않습니다. 기록을 읽고 쓰는 데 실패해도 실행은 계속되며 `usageCalibration`만 `unavailable`로 표시합니다. `--usage-history`로 위치를 바꾸거나 `--no-usage-calibration`으로 기능을 끌 수 있습니다.

`--usage-history`가 실제 경로나 심볼릭 링크로 대상 저장소 안을 가리키거나, 기존 기록 파일이 하드 링크라면 깨끗한 작업 트리를 오염시킬 수 있으므로 입력 단계에서 거부합니다. 상대 경로는 대상 `--cwd`를 기준으로 해석합니다.

프로그램에서 지정한 `outputSchema`의 적용 결과는 `outputFormatting`으로 확인합니다.

- `budget-skipped`, `usage-unavailable`: 작업 흐름은 끝났지만 최종 답변을 호출자 스키마에 맞추는 추가 실행은 하지 않음
- `failed`: 선택한 출력 형식 변환만 실패했으며, 원래 최종 답변과 검증 자료는 그대로 반환

출력 형식 변환에 실패하면 그 실행의 사용량을 알 수 없으므로 전체 사용량은 일부만 집계하고 보정 기록은 남기지 않습니다.

인증 토큰이 없으면 발행에 필요한 검증 자료를 충족할 수 없으므로 차단 사유를 반환합니다. 토큰 값은 로그나 보고서에 출력하지 않습니다.

## MCP 서버

Claude 플러그인의 로컬 표준 입출력 설정은 번들된 서버를 실행합니다.

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

Codex에서는 이름이 `mcp__spec_to_pr__*`로 정규화될 수 있습니다. 어느 호스트에서든 공개 도구는 같은 7개이며 계약 버전은 `2.0.0`입니다.

## 기본 통과 기준

- 일반 코드: 사용할 수 있는 형식 검사·린트, 타입 검사, 빌드, 관련 기능 테스트
- UI: 적용 가능한 화면·상호작용·접근성 자료와 디자인 검토
- 보안·성능: 변경 범위와 관련 있을 때만
- 관측 가능성: 명시적으로 요청한 경우에만
- 전체 테스트 조합, 보관·패키지·호스트 간 검증: 릴리스에서만

선택 검사에 해당 스크립트가 없으면 `not-applicable`로 표시합니다. 필수 검사를 실행하지 않았거나 건너뛰었거나 실패했다면 `passed`로 바꾸지 않습니다.
