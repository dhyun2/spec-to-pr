---
sidebar_position: 1
title: 공개 스킬 8개
---

# 스킬 레퍼런스

현재 저장소는 공개 마켓플레이스 스킬 **8개**를 제공합니다. 릴리스 준비 작업은 유지보수용이므로 사용자 실행에 포함되는 공개 스킬 수에는 넣지 않습니다.

| 공개 스킬                                             | 언제 사용하나         | 핵심 역할                                       |
| ----------------------------------------------------- | --------------------- | ----------------------------------------------- |
| `/spec-to-pr` (`spec-to-pr`)                          | 전체 작업 흐름 실행   | 한 가지 제공 방식과 공개 도구 7개만 사용        |
| `/spec-to-pr:doctor` (`doctor`)                       | 설치와 계약 진단      | `workflow_info`가 v2 공개 규격과 맞는지 확인    |
| `/spec-to-pr:intake-contracts` (`intake-contracts`)   | 입력 자료와 계약 준비 | 실제 근거와 `workloadSignals`로 예상치 보정     |
| `/spec-to-pr:implement` (`implement`)                 | 계약에 따른 구현      | 한 맥락에서 API와 UI를 구현하고 필수 검사 유지  |
| `/spec-to-pr:review-functional` (`review-functional`) | 기능 독립 검토        | 요구사항과 필수 기능 검증의 통과 여부 판정      |
| `/spec-to-pr:review-design` (`review-design`)         | UI 독립 검토          | 화면·상호작용·디자인 시스템·접근성 판정         |
| `/spec-to-pr:publish` (`publish`)                     | 초안 PR/MR 발행       | 필요한 자료를 동기화해 초안만 생성하거나 갱신   |
| `/spec-to-pr:archive-openspec` (`archive-openspec`)   | 병합 뒤 OpenSpec 보관 | 병합 근거와 사용자의 별도 요청이 있을 때만 실행 |

## 제공 방식과 스킬

`mode`는 최종 결과와 필요한 검증 자료를 정합니다.

| `mode`    | 결과                                                   |
| --------- | ------------------------------------------------------ |
| `brief`   | 기획서·Figma·OpenAPI를 바탕으로 전체 구현              |
| `legacy`  | 별도 `legacyProjectRoot`의 동작을 현재 프로젝트로 이관 |
| `feature` | 전체 구현에 변경 기능 E2E와 영상 1개를 추가            |
| `figma`   | 고정된 모의 데이터로 Figma 화면을 구현                 |

네 방식 모두 기본 발행 값은 `draft`입니다. `sourceProvenance`, `visualTargets`, `compare-visuals`, `legacyInventory`, `apiCoverage`, `performanceEvidence`, `pr-report-v2.1`은 기존 단계가 주고받는 계약입니다. 이를 위해 별도 스킬이나 처리 경로를 만들지 않습니다.

## 추천 스킬을 정하는 방법

계약 단계는 입력 자료와 범위를 바탕으로 `recommendedSkills`를 같은 규칙에 따라 계산합니다.

- `figmaUrl` → `figma`, `design-system`
- `openApiPaths` 또는 `openApiUrls` → `api-generator`
- React/Next 패키지 → `react-best-practices`, `next-best-practices`
- `mode: feature`와 UI 작업 → `playwright`

`stageSkillRoute`는 `intake-contracts` → `implement` → `review-functional` → `review-design` → `publish` → `archive-openspec`처럼 단계별로 실행할 공개 스킬을 뜻합니다. 이는 `deliveryProfile.recommendedSkills`와 다른 값입니다.

`appliedSkills`에는 다음 중 **실제로 설치되어 있고 현재 작업에 맞아 사용한 스킬**만 기록합니다.

1. SpecToPR이 계산한 `recommendedSkills`
2. 사용자가 `skillHints`로 요청한 스킬

선택 스킬이 없다고 실행이 중단되지는 않습니다. 누락된 스킬은 `appliedSkills`에서 제외하되 프로젝트 지침과 `requiredValidations`는 그대로 지킵니다. 사용하지 않은 스킬을 PR 보고서에 넣거나 임의 경로에서 스킬 본문을 읽지 않습니다.

## 프로젝트 지침의 우선순위

`intake-contracts`는 직접 지정하거나 자동으로 찾은 지침을 `guidanceTrace`에 기록하되, 기능 범위를 넓히는 근거로 사용하지 않습니다. 내용이 충돌하면 다음 순서로 판단합니다.

1. 현재 사용자 요청
2. 직접 지정한 `guidancePaths`
3. 자동으로 찾은 프로젝트 지침
4. 설치되어 있고 현재 작업에 맞는 스킬
5. SpecToPR 기본값

구현 담당자와 검토자는 일반적인 스킬 조언보다 프로젝트 지침을 우선합니다.

## 검토자와 스킬의 차이

`review-functional`과 `review-design`은 작업을 안내하는 스킬입니다. 실제 독립 검토 역할은 `functional-reviewer`와 `design-reviewer`입니다.

두 검토자는 읽기 전용입니다. 코드를 고치거나 `workflow_*` 도구를 호출하지 않고, 고정된 상태·계약·코드 차이·검증 자료를 읽어 판정만 반환합니다. `design-reviewer`는 UI 작업일 때만 참여합니다.

## 오래 걸리는 실행을 다루는 방식

`implement`는 하나의 구현 맥락을 유지합니다. 반복 상태 조회나 같은 테스트·검토의 재실행을 병렬화하지 않고, 독립적이고 읽기 전용인 조사만 작업량 한도 안에서 병렬화합니다. 구현이 끝난 뒤에만 두 검토자가 동일한 변경 불가 검토 묶음에서 동시에 판단합니다.

기본 시간 예산은 작업 차례 10분, 전체 실행 45분입니다. 시간 초과는 통과가 아니라 재개 가능한 진단 상태이며, 활성 작업을 취소한 뒤 같은 스레드와 최신 영구 상태를 반환합니다. `budget.elapsedMs`, `budget.actionTurns`, `budget.formatTurn`으로 지연 경계를 확인하고, 필요한 경우에만 `--turn-timeout-seconds` 또는 `--run-timeout-seconds`를 조정해 같은 실행을 재개하세요. 검토자 시간 초과에는 대체 검토자를 자동으로 만들지 않습니다.

## 시각 피드백 루프

`implement`는 고정 92% 기준으로 최초 비교와 최대 두 번의 보정을 사용자 확인 없이 이어갑니다. geometry·fixture·renderer lineage가 맞지 않는 취득 오류는 횟수에 넣지 않습니다. 세 번째 유효 실패는 실행을 `blocked`로 끝내고 `review-design`을 호출하지 않으며, `publish`는 발행 조건을 만족할 때 같은 15개 섹션 템플릿에 동일 크기 기준/결과와 별도 diff/overlay를 담은 진단 초안을 만듭니다. `review-functional`과 `review-design`의 집중 UI assertion은 전체 점수가 92% 이상이어도 별도로 통과해야 합니다.

## 공개 도구와 브라우저의 경계

실행 상태를 바꾸는 도구는 `workflow_info`, `workflow_start`, `workflow_advance`, `workflow_submit`, `workflow_status`, `workflow_publish`, `workflow_archive` 일곱 개뿐입니다. API를 사용하는 UI의 `api-ready` 자료도 `workflow_submit`으로 제출합니다.

브라우저 검증의 판정 기준은 Playwright Test/CLI의 검증문과 구조화된 결과입니다. Browser MCP는 동작을 직접 재현하고 살펴볼 때, Chrome DevTools MCP는 콘솔·네트워크·성능·메모리·실시간 DOM 문제를 진단할 때만 사용합니다. 스크린샷·영상·추적 기록·에이전트 관찰은 검증문을 대신하지 않습니다. 필수 브라우저 검증을 실행하지 못하면 `BROWSER_NOT_RUN`으로 차단합니다. 변경 기능 E2E와 영상 1개는 `feature` 방식에서만 요구합니다.

## 발행 결과가 불확실할 때

`publish` 스킬은 `diagnostic-publication-uncertain`을 받았다고 자동으로 다시 발행하지 않습니다. 기본값은 `recoverUncertain: false`입니다.

먼저 GitHub/GitLab에서 소스와 대상 브랜치가 같은 기존 초안을 확인해 사용자에게 보여 줍니다. 사용자가 명시적으로 승인한 경우에만 같은 `workflow_publish`를 `recoverUncertain: true`로 다시 호출합니다. 이 복구 절차는 기존 발행 단계 안에서 진행되며, 차단된 상태를 통과 상태로 바꾸지 않습니다. SDK도 자동으로 승인하지 않습니다.
