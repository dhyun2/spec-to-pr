---
sidebar_position: 1
title: 공개 스킬 8개
---

# 스킬 레퍼런스

현재 저장소가 제공하는 것은 정확히 **8 public marketplace skills**입니다. Release maintenance는 public marketplace workflow 밖의 maintainer concern이며 사용자 Run의 skill 수에 포함하지 않습니다.

| Public skill                                          | 언제 쓰나                        | 핵심 경계                                           |
| ----------------------------------------------------- | -------------------------------- | --------------------------------------------------- |
| `/spec-to-pr` (`spec-to-pr`)                          | 전체 workflow 실행               | 하나의 delivery profile, 7개 public tool만 사용     |
| `/spec-to-pr:doctor` (`doctor`)                       | 설치/contract 진단               | `workflow_info`가 v2 surface와 일치해야 함          |
| `/spec-to-pr:intake-contracts` (`intake-contracts`)   | source와 contracts 준비          | real evidence와 `workloadSignals`로 estimate 정교화 |
| `/spec-to-pr:implement` (`implement`)                 | 계약 기반 구현                   | API·UI 한 context, 필수 검사 유지                   |
| `/spec-to-pr:review-functional` (`review-functional`) | code scope 독립 검토             | requirement와 required functional gate 판정         |
| `/spec-to-pr:review-design` (`review-design`)         | UI scope 독립 검토               | visual/interaction/design-system/accessibility 판정 |
| `/spec-to-pr:publish` (`publish`)                     | ready 또는 diagnostic draft 발행 | draft PR/MR과 required asset sync만 수행            |
| `/spec-to-pr:archive-openspec` (`archive-openspec`)   | merge 뒤 archive                 | authoritative merge evidence와 별도 요청 필수       |

## Mode routing

Mode는 납품·증거 정책이고 source는 조합됩니다. `brief`는 `briefPath`, `legacy`는 concrete delta/focused baseline, `feature`는 changed-feature Playwright E2E와 영상 정확히 1개, `figma`는 `figmaUrl`과 real `figma-bundle`을 요구합니다. `auto`는 mode-specific evidence를 임의로 켜지 않습니다. Mode마다 새 skill/stage/agent lane을 만들지 않습니다.

## Deterministic recommendation과 적용 trace

Contracts는 source와 scope에서 optional `recommendedSkills`를 deterministic하게 계산합니다: `figmaUrl` → `figma`/`design-system`, `openApiPaths` → `api-generator`, 감지된 React/Next package → `react-best-practices`/`next-best-practices`, `mode: feature` + UI → `playwright`입니다.

`intake-contracts`, `implement`, `review-functional`, `review-design`, `publish`, `archive-openspec`은 durable action의 public `stageSkillRoute`입니다. 이 action routing은 `deliveryProfile.recommendedSkills`나 optional applied-skill 후보가 아닙니다.

`appliedSkills`에는 다음 허용 합집합 중 **available and applicable**하며 실제 사용한 skill만 기록합니다.

1. SpecToPR가 계산한 `recommendedSkills`
2. 사용자가 `skillHints`로 요청한 설치 skill

Missing optional skills do not block the Run. 누락된 hint는 `appliedSkills`에서 제외하되 project guidance와 `requiredValidations`는 그대로 지킵니다. 적용하지 않은 skill을 PR report에 넣거나 임의 경로에서 skill 본문을 읽지 않습니다.

## Project guidance precedence

`intake-contracts`는 explicit/discovered guidance를 `guidanceTrace`에 기록하고 scope 분류에서는 제외합니다. 우선순위는 current user request → explicit `guidancePaths` → automatically discovered project guidance → applicable installed skill → SpecToPR defaults입니다. `implement`와 reviewer는 generic skill 조언보다 project guidance를 우선합니다.

## Reviewer와 skill의 차이

`review-functional`과 `review-design`은 workflow 지침이고 실제 독립 role은 `functional-reviewer`와 `design-reviewer`입니다. 두 reviewer profile은 workflow-MCP-free, fully read-only입니다. Implementation을 수정하거나 `workflow_*`를 호출하지 않고 immutable status/contracts/diff/evidence packet에 verdict만 반환합니다. Design reviewer는 UI scope가 아니면 호출하지 않습니다.

## Public tool과 browser 경계

Durable 상태 변경은 `workflow_info`, `workflow_start`, `workflow_advance`, `workflow_submit`, `workflow_status`, `workflow_publish`, `workflow_archive`만 담당합니다. API-backed UI의 `api-ready`도 같은 `workflow_submit`을 사용하며 새 tool/stage를 추가하지 않습니다.

Playwright Test/CLI assertion과 structured result가 browser acceptance oracle입니다. Browser MCP는 optional interactive reproduction/inspection, Chrome DevTools MCP는 console/network/performance/memory/live-DOM diagnosis에만 conditional입니다. Screenshot, video, trace, agent observation은 assertion을 대체하지 않으며 required browser proof를 실행할 수 없으면 `BROWSER_NOT_RUN`으로 blocked됩니다. Feature만 changed-feature E2E와 video 정확히 1개를 요구합니다.

## 불확실한 diagnostic publication 복구

`publish` skill은 `diagnostic-publication-uncertain`을 자동 retry하지 않습니다. `recoverUncertain: false`가 기본이며, 먼저 GitHub/GitLab에서 matching draft를 확인하고 사용자에게 결과를 보여준 뒤 명시적 승인으로만 같은 `workflow_publish`를 `recoverUncertain: true`로 호출합니다. 이 옵션은 기존 publish tool/stage 안에 있고 blocked state를 passed로 바꾸지 않으며 SDK가 자동 승인하지 않습니다.
