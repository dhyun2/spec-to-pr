---
sidebar_position: 19
title: "T19 · Spec/BDD 에이전트 레인"
sidebar_label: "T19 Spec/BDD 레인"
---

# T19 · Spec/BDD 에이전트 레인

> **한 줄 요약** — [OpenSpec](/reference/glossary#openspec)·Gherkin·테스트 매트릭스·증거/​[Gap](/reference/glossary#gap) 요약을 검토하고, Spec/BDD 리뷰 리포트와 인수 스켈레톤을 생산하는 역할 특화 에이전트 레인.

| 항목              | 내용                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 구현 에이전트가 스펙을 소비하기 전에, Spec/BDD 전문 에이전트가 OpenSpec 요구사항이 소스 증거와 일치하는지·Gherkin이 과잉 해석하지 않았는지 검증하고 그 결정을 기록한다                                                           |
| **입력**          | [Run](/reference/glossary#run) ID, OpenSpec change 파일·`change-manifest.json`(T14), `gherkin-index.json`·`test-matrix.json`(T15), `evidence-summary.md`·`gap-summary.md`, T18의 [Worktree](/reference/glossary#worktree) 런타임 |
| **출력**          | Spec/BDD [Context Pack](/reference/glossary#context-pack), 리뷰 리포트(MD/JSON), 인수 스켈레톤 파일, Spec/BDD [AgentResult](/reference/glossary#agentresult) → T22(Review Council)가 소비                                        |
| **선행 태스크**   | T18                                                                                                                                                                                                                              |
| **병렬 가능**     | T20 (API Contract 레인), T21 (Design/UI 레인)                                                                                                                                                                                    |
| **관련 스킬**     | `/spec-to-pr:run-spec-bdd`                                                                                                                                                                                                       |
| **담당 에이전트** | `agents/spec-bdd.md`                                                                                                                                                                                                             |

## 왜 필요한가

T14와 T15는 스펙과 시나리오를 결정적으로 생성한다. 그러나 구현 에이전트가 그것을 그대로 소비하기 전에 Spec/BDD 전문가가 다음을 확인해야 한다:

- OpenSpec 요구사항이 소스 증거와 일치하는가
- Gherkin 시나리오가 요구사항을 과잉 해석하지 않았는가
- Gap이 있는 요구사항이 적절히 표시되어 있는가
- 미래 테스트 구현을 위한 인수 스켈레톤이 존재하는가
- 모든 Spec/BDD 결정이 기록되어 있는가

## 동작 흐름

`/spec-to-pr:run-spec-bdd`는 사용자가 호출하는 워크플로 스킬이다. 사용자가 컨텍스트 준비·에이전트 실행·결과 기록에 필요한 모든 MCP 호출을 기억할 필요가 없도록 존재한다.

1. `prepare_spec_bdd_agent`가 Context Pack을 빌드한다 (`src/spec-bdd/spec-bdd-context.ts`).
2. 스킬이 `spec-bdd` 서브에이전트에 작업을 위임한다.
3. 에이전트는 허용된 파일만 쓰도록 지시받는다 — 격리 worktree 안에서만 동작한다.
4. 에이전트는 스펙 리뷰어로서 동작한다: 제품 코드를 구현하지 않고, 증거 기반 OpenSpec·Gherkin 아티팩트를 리뷰하며, Spec/BDD 리뷰 리포트를 쓰고, 인수 스켈레톤을 생성한다.
5. `record_spec_bdd_agent_result`가 결과 아티팩트를 기록한다 — AgentResult가 런타임 계약(`src/spec-bdd/spec-bdd-contracts.ts`)에 대해 검증된다.
6. 스킬이 상태를 사용자에게 보고한다.

### 범위 제외 (Non-goals)

API 구현(→ T20), UI 구현(→ T21), 테스트 실행, Review Council(→ T22), 통합 머지(→ T23), PR 발행은 하지 않는다.

## 입력 상세

- **OpenSpec change 파일 / change-manifest.json** — T14 산출물.
- **gherkin-index.json / test-matrix.json** — T15 산출물.
- **evidence-summary.md / gap-summary.md** — 증거·Gap 요약.
- **에이전트 런타임** — T18이 준비한 spec-bdd worktree와 소유권 정책.

## 출력 상세

- **Spec/BDD Context Pack** — 위 입력을 에이전트가 읽을 수 있게 패키징.
- **Spec/BDD 리뷰 리포트** — Markdown + JSON (`src/spec-bdd/spec-bdd-review-renderer.ts`).
- **인수 스켈레톤 파일** — projectRoot 내부에 작성 (`src/spec-bdd/acceptance-skeleton-writer.ts`). 실행 가능한 테스트는 아니다.
- **Spec/BDD AgentResult** — 런타임 계약으로 검증된 구조화 결과.

구현 컴포넌트: `agents/spec-bdd.md`, `skills/run-spec-bdd/SKILL.md`, `src/spec-bdd/spec-bdd-contracts.ts`, `spec-bdd-context.ts`, `spec-bdd-review-renderer.ts`, `acceptance-skeleton-writer.ts`, `src/application/spec-bdd-agent-lane-service.ts`.

## 완료 조건 (Definition of Done)

- [ ] `spec-bdd` 플러그인 에이전트가 존재한다.
- [ ] `run-spec-bdd` 스킬이 존재한다.
- [ ] `prepare_spec_bdd_agent` MCP 도구가 Context Pack을 빌드한다.
- [ ] `record_spec_bdd_agent_result` MCP 도구가 결과 아티팩트를 기록한다.
- [ ] 인수 스켈레톤 파일을 projectRoot 안에 쓸 수 있다.
- [ ] Spec/BDD AgentResult가 런타임 계약에 대해 검증된다.
- [ ] stdio MCP 테스트가 prepare/record 흐름을 커버한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

기대 결과:

- 에이전트 파일·스킬 파일 존재, Context Pack·리뷰 렌더러·서비스 테스트 통과.
- MCP stdio 통합에서 `prepare_spec_bdd_agent`, `get_spec_bdd_agent_context`, `record_spec_bdd_agent_result` 호출 성공.

## 알려진 한계

- 서비스는 레인을 준비·기록할 뿐 서브에이전트를 직접 실행하지 않는다.
- 인수 스켈레톤은 실행 가능한 테스트가 아니다.
- Spec/BDD 리뷰는 Review Council(T22)을 대체하지 않는다.
- 파일 소유권은 여전히 런타임/정책 레이어에서 강제되어야 한다.
- passed 구현 AgentResult는 제공된 commit SHA를 기록하고, 없으면 current/base SHA를 기록한다.
