---
sidebar_position: 1
title: 스킬 9개
---

# 스킬 레퍼런스

SpecToPR v2가 유지하는 skill은 정확히 9개입니다.

| Skill                           | 언제 쓰나                      | 핵심 경계                                                  |
| ------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| `/spec-to-pr`                   | 전체 workflow 실행             | delivery profile/workload 하나, public tool 7개만 사용     |
| `/spec-to-pr:doctor`            | 설치/contract 진단             | `workflow_info`가 v2 표면과 일치해야 함                    |
| `/spec-to-pr:intake-contracts`  | intake source와 contracts 준비 | real evidence와 숫자 `workloadSignals`로 estimate 정교화   |
| `/spec-to-pr:implement`         | 계약 기반 구현                 | API·UI 한 context, 80% boundary checkpoint, 필수 검사 유지 |
| `/spec-to-pr:review-functional` | code scope 독립 검토           | requirement와 required functional gate evidence 확인       |
| `/spec-to-pr:review-design`     | UI scope 독립 검토             | visual/interaction/design-system/accessibility 확인        |
| `/spec-to-pr:publish`           | publish-ready Run 발행         | draft PR/MR과 required asset sync만 수행                   |
| `/spec-to-pr:archive-openspec`  | merge 뒤 archive               | authoritative merge evidence 필수, polling 없음            |
| `/spec-to-pr:prepare-release`   | plugin 자체 release 준비       | full matrix/archive/package/cross-host checks              |

## Mode routing

오케스트레이터가 `workflow_start`에 delivery profile을 기록합니다.

- `brief`: `briefPath` 필수
- `legacy`: concrete change request와 focused baseline 필수
- `feature`: user-facing UI일 때 changed-feature E2E와 영상 정확히 한 개
- `figma`: `figmaUrl`과 real `figma-bundle` 필수
- `auto`: mode-specific evidence를 임의로 활성화하지 않음

네 모드는 같은 `intake-contracts`, `implement`, review, publish skill을 재사용합니다. Mode마다 별도 skill이나 agent lane을 만들지 않습니다.

Workload/budget도 별도 skill이 아닙니다. `workflow_status`의 `XS`~`XL` estimate와 전체 `requiredValidations`를 기존 skill들이 읽고, SDK runner가 action turn 경계에서 실제 usage를 집계합니다. Budget이 부족하거나 usage가 누락돼도 reviewer가 required gate/mode evidence를 생략하거나 approval로 바꿀 수 없습니다.

## Reviewer와 skill의 차이

`review-functional`과 `review-design`은 workflow 지침이고, 실제 독립 role은 각각 `functional-reviewer`와 `design-reviewer`입니다. Reviewer는 implementation을 수정하지 않고 verdict와 evidence를 제출합니다. Design reviewer는 UI scope가 아니면 호출하지 않습니다.

## Public tool과 skill의 차이

Skill은 호스트가 읽는 실행 지침이고, durable 상태 변경은 다음 7개 MCP tool이 담당합니다.

`workflow_info`, `workflow_start`, `workflow_advance`, `workflow_submit`, `workflow_status`, `workflow_publish`, `workflow_archive`

삭제된 v1 skill 이름이나 내부 domain service를 직접 호출하는 방식은 지원하지 않습니다.

API-backed UI의 `api-ready` 제출은 같은 `workflow_submit`을 사용합니다. `artifactPaths`와 `apiArtifacts`의 `types`, `schemas`, `wrappers`, `mocks`, `contractTests`는 물리적으로 서로 다른 비어 있지 않은 project-local 파일을 가리키고, contract-test JSON은 `status: passed`를 보고해야 합니다. Path, symlink, hard link alias는 별도 증거가 아닙니다. `implementationContextId`는 최종 구현과 같아야 합니다. Public tool이나 stage는 추가되지 않습니다.
