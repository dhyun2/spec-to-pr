---
sidebar_position: 2
title: 에이전트 15개
---

# 에이전트 레퍼런스

`agents/*.md`에 정의된 서브에이전트들입니다. 역할이 좁을수록 출력 검증이 쉽다는 원칙에 따라, **구현 3 + 판정 1 + 통합 1 + 전담 리뷰어 10**으로 구성됩니다. 개념 설명은 [서브에이전트와 lane](/concepts/subagents)을 보세요.

## 구현 lane

| 에이전트       | 스테이지  | 역할                                                                     |
| -------------- | --------- | ------------------------------------------------------------------------ |
| `spec-bdd`     | spec-bdd  | OpenSpec·Gherkin 검토와 정련, 수용 테스트 스켈레톤 (제품 코드 작성 금지) |
| `api-contract` | api-agent | OpenAPI + 생성 파이프라인 기반 API 래퍼·mock·계약 테스트 구현            |
| `design-ui`    | design-ui | Design Contract·디자인 시스템 기반 UI 구현                               |

## 판정·통합

| 에이전트         | 스테이지       | 역할                                                    |
| ---------------- | -------------- | ------------------------------------------------------- |
| `review-council` | review-council | lane 결과 교차 검토, gap 판정 → approve / retry / block |
| `integrator`     | integration    | 승인된 변경만 통합 worktree로 cherry-pick               |

## 전담 리뷰어

| 에이전트                      | 스테이지          | 무엇을 판정하나                                         |
| ----------------------------- | ----------------- | ------------------------------------------------------- |
| `visual-regression-reviewer`  | visual-regression | 시각 비교 실패의 원인 분류 (진짜 회귀 vs 렌더링 노이즈) |
| `accessibility-reviewer`      | accessibility     | 접근성 위반의 심각도 분류                               |
| `performance-reviewer`        | performance       | Lighthouse·예산 초과 원인 분류                          |
| `security-hardening-reviewer` | security          | 보안 정책·공급망 검증                                   |
| `observability-reviewer`      | observability     | OpenTelemetry 준비 상태·로그 상관관계                   |
| `pr-report-reviewer`          | pr-report         | PR 본문과 증거의 일치 검증                              |
| `publisher-reviewer`          | publisher         | 발행 계획·결과 감사                                     |
| `openspec-archive-reviewer`   | openspec-archive  | 머지 후 아카이브 마무리 검증                            |
| `eval-reviewer`               | release           | 릴리즈 준비 평가                                        |
| `release-reviewer`            | release           | 패키지 manifest·릴리즈 노트 검증                        |

## Codex에서의 차이

Codex에는 위 15개가 `.codex/agents/*.toml`로 동일하게 제공되며, Codex 전용 `design-ui-repair` 에이전트가 하나 추가되어 **총 16개**입니다. (Claude Code에서는 visual repair loop가 design-ui 에이전트를 재사용합니다.)

## 모델과 동등성

Claude Code 에이전트는 `model`을 명시하지 않으면 활성 세션 모델을 상속합니다. 현재 저장소에서 명시적인 모델 선언은 `spec-bdd`의 `sonnet`뿐입니다. Codex 에이전트는 모델 이름 대신 `high` reasoning effort를 요청합니다.

따라서 `opus`·`sonnet`·`haiku`의 고정 배정은 이 플러그인의 보장 범위가 아닙니다. 두 호스트에서 보장하는 것은 같은 evidence 제약, 구조화된 AgentResult, gate, scorecard, 발행 차단 정책입니다. 자세한 내용은 [Claude Code · Codex 호스트 동등성](/concepts/host-parity)을 보세요.
