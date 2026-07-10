---
sidebar_position: 1
title: 스킬 27개
---

# 스킬 레퍼런스 (27개)

모든 스킬은 `/spec-to-pr:<이름>`으로 호출합니다. 오케스트레이터(`/spec-to-pr`)가 알아서 순서대로 호출하므로 평소에는 직접 부를 일이 적지만, 부분 실행·디버깅 때 유용합니다.

## 오케스트레이터

| 스킬          | 역할                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `/spec-to-pr` | 전체 파이프라인 실행. `<project-root> [brief/docs/figma/openapi] [source-branch] [target-branch]` |

## 진단

| 스킬                       | 역할                               | 관련 태스크                                     |
| -------------------------- | ---------------------------------- | ----------------------------------------------- |
| `/spec-to-pr:doctor`       | 플러그인·MCP kernel 실행 경로 점검 | [T01](/tasks/01-executable-plugin-shell)        |
| `/spec-to-pr:figma-doctor` | Figma MCP provider·capability 진단 | [T09](/tasks/09-figma-mcp-capability-discovery) |

## 수집·분석

| 스킬                             | 역할                                                                         | 관련 태스크                                                     |
| -------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `/spec-to-pr:figma-intake`       | Figma URL 등록 + MCP 산출물(디자인 컨텍스트·스크린샷·변수·Code Connect) 기록 | [T10](/tasks/10-figma-source-intake-and-raw-artifact-recording) |
| `/spec-to-pr:analyze-openapi`    | OpenAPI 스냅샷·오퍼레이션·스키마·gap 분석                                    | [T12](/tasks/12-openapi-intake-adapter)                         |
| `/spec-to-pr:build-traceability` | 기획서·Figma·OpenAPI를 잇는 Evidence Graph 생성                              | [T13](/tasks/13-evidence-graph-requirement-traceability)        |

## 생성

| 스킬                                   | 역할                                               | 관련 태스크                                                     |
| -------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `/spec-to-pr:generate-openspec`        | 추적 매트릭스 → OpenSpec 제안 문서                 | [T14](/tasks/14-openspec-change-generator)                      |
| `/spec-to-pr:generate-gherkin`         | OpenSpec → Gherkin + 테스트 매트릭스               | [T15](/tasks/15-gherkin-and-test-matrix-generator)              |
| `/spec-to-pr:generate-api-pipeline`    | OpenAPI → 타입(Zod)·래퍼·mock·계약 테스트 스켈레톤 | [T16](/tasks/16-api-generator-drift-wrapper-pipeline)           |
| `/spec-to-pr:generate-design-contract` | Figma → Design Contract + 디자인 시스템 매핑       | [T17](/tasks/17-figma-design-contract-and-design-system-mapper) |

## 에이전트 lane

| 스킬                                | 역할                              | 관련 태스크                                      |
| ----------------------------------- | --------------------------------- | ------------------------------------------------ |
| `/spec-to-pr:prepare-agent-runtime` | worktree + context pack 준비      | [T18](/tasks/18-worktree-isolated-agent-runtime) |
| `/spec-to-pr:run-spec-bdd`          | Spec/BDD lane 실행                | [T19](/tasks/19-spec-bdd-agent-lane)             |
| `/spec-to-pr:run-api-contract`      | API Contract lane 실행            | [T20](/tasks/20-api-contract-agent-lane)         |
| `/spec-to-pr:run-design-ui`         | Design/UI lane 실행               | [T21](/tasks/21-design-ui-agent-lane)            |
| `/spec-to-pr:run-review-council`    | 교차 검토 → verdict               | [T22](/tasks/22-review-council-and-gap-ledger)   |
| `/spec-to-pr:run-integration`       | 승인된 변경 통합 + bounded repair | [T23](/tasks/23-integration-bounded-repair-loop) |

## 검증 게이트

| 스킬                                 | 역할                                  | 관련 태스크                                           |
| ------------------------------------ | ------------------------------------- | ----------------------------------------------------- |
| `/spec-to-pr:run-architecture-guard` | FSD 경계·public API 규칙 검증         | [T24](/tasks/24-fsd-architecture-source-guards)       |
| `/spec-to-pr:run-quality-gates`      | lint·typecheck·build·테스트           | [T25](/tasks/25-quality-gate-runner)                  |
| `/spec-to-pr:run-visual-regression`  | 스크린샷 캡처·비교                    | [T26](/tasks/26-visual-regression-screenshot-compare) |
| `/spec-to-pr:run-visual-repair-loop` | 0.98 도달까지 bounded 수리            | [T26](/tasks/26-visual-regression-screenshot-compare) |
| `/spec-to-pr:run-accessibility-gate` | 접근성 검사                           | [T27](/tasks/27-accessibility-gate)                   |
| `/spec-to-pr:run-performance-gate`   | Lighthouse·Web Vitals                 | [T28](/tasks/28-performance-and-web-vitals)           |
| `/spec-to-pr:setup-observability`    | OpenTelemetry·로그 상관관계 설정 생성 | [T29](/tasks/29-opentelemetry-and-log-correlation)    |

## 발행·마무리

| 스킬                                 | 역할                           | 관련 태스크                                                   |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------- |
| `/spec-to-pr:generate-pr-report`     | 증거 기반 PR/MR 본문 생성      | [T30](/tasks/30-evidence-driven-pr-report)                    |
| `/spec-to-pr:publish-review-request` | draft PR/MR 생성·갱신          | [T31](/tasks/31-github-gitlab-publishers)                     |
| `/spec-to-pr:archive-openspec`       | 머지 확인 후 OpenSpec 아카이브 | [T32](/tasks/32-manual-post-merge-openspec-archive-lifecycle) |
| `/spec-to-pr:prepare-release`        | 플러그인 릴리즈 검증           | [T33](/tasks/33-evals-hardening-release)                      |

:::note 스킬 vs MCP tool
스킬은 사람이 부르는 인터페이스이고, 실제 상태 변경은 스킬이 내부에서 호출하는 **kernel MCP tool**(80여 개)이 수행합니다. T02~T08 같은 기반 태스크는 전용 스킬 없이 오케스트레이터가 tool을 직접 호출합니다.
:::
