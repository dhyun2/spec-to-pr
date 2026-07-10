---
sidebar_position: 23
title: "T23 · 통합과 Bounded Repair 루프"
sidebar_label: "T23 통합·수리 루프"
---

# T23 · 통합과 Bounded Repair 루프

> **한 줄 요약** — [Review Council](/reference/glossary#review-council)이 승인한 에이전트 커밋들을 전용 통합 [Worktree](/reference/glossary#worktree)에 결정론적 순서로 적용하고, 충돌·경미한 통합 실패는 상한이 있는(bounded) 수리 루프로만 복구한다.

| 항목              | 내용                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 격리된 레인에서 만들어진 Spec/API/UI 커밋이 실제로 한 브랜치에서 함께 동작하는지 증명하고, 수리를 예산 안으로 제한한다                                     |
| **입력**          | Run ID, Review Council 결과(T22), 승인된 AgentResult와 커밋 SHA(T19~T21), 파일 소유권 정책, repair budget                                                  |
| **출력**          | 통합 worktree/브랜치, IntegrationPlan·ConflictReport·RepairHistory·IntegrationResult 아티팩트, Integrator AgentResult — T24~T29 게이트와 T30 리포트가 소비 |
| **선행 태스크**   | T22 (T18~T21 레인 산출물 전제)                                                                                                                             |
| **병렬 가능**     | 없음 (T24~T29 게이트의 공통 선행)                                                                                                                          |
| **관련 스킬**     | `/spec-to-pr:run-integration`                                                                                                                              |
| **담당 에이전트** | `agents/integrator.md`                                                                                                                                     |

## 왜 필요한가

Spec/BDD, API Contract, Design/UI 에이전트는 각자 격리된 worktree에서 작업한다. 품질 게이트(T24~T29)와 PR 리포트 생성(T30)이 돌기 전에 이 산출물들이 하나로 통합되어야 한다.

[Review Council](/reference/glossary#review-council)의 승인은 "각 결과가 증거로 뒷받침된다"는 뜻이지, 모든 커밋이 서로 깨끗하게 적용된다는 보장이 아니다. T23이 없으면 충돌은 임의 방식으로 수습되고, 수리가 무한정 반복되며, 어떤 커밋이 어떤 순서로 들어갔는지 추적할 수 없게 된다.

## 동작 흐름

1. `prepare_integration` — Run에서 승인된 [AgentResult](/reference/glossary#agentresult)만 골라 IntegrationPlan을 만든다 (`status: "planned"`).
2. 통합 worktree 생성 — 경로 `<projectRoot>/.spec-to-pr/worktrees/<runId>/integration`, 브랜치 `spec-to-pr/<shortRunId>/integration`. `shortRunId`는 Run ID에서 `run_` 접두사를 제거한 뒤 앞 12자다 (`src/integration/integration-worktree.ts`).
3. `apply_integration` — 후보 커밋을 결정론적 순서(`order` 필드)로 cherry-pick 한다. 전략은 `cherry-pick`(기본) 또는 `merge`.
4. 충돌 발생 시 ConflictReport 아티팩트를 기록하고 상태를 `conflicted`로 전이한다.
5. **Bounded repair** — Integrator 에이전트가 수리를 시도하되, `RepairPolicy.maxAttempts`(기본값 **2**, `src/integration/repair-policy.ts`)를 넘을 수 없다. 허용되는 변경 패턴은 `resolve-conflict-markers`, `fix-import-paths`, `fix-type-references`, `formatting`, `source-guard-import-correction` 다섯 가지뿐이다.
6. `record_integration_repair` — 각 수리 시도를 RepairAttempt(시도 번호·트리거·변경 파일·요약)로 RepairHistory에 기록한다.
7. `finalize_integration` — 남은 블로커를 통합 [Gap](/reference/glossary#gap)으로 전환하고 IntegrationResult(`passed`/`failed`/`blocked`)와 Integrator AgentResult를 Run에 기록한다.

## 입력 상세

- **Run ID** — 대상 [Run](/reference/glossary#run).
- **Review Council 결과** — T22의 승인 verdict. 승인되지 않은 AgentResult는 통합 후보에서 제외된다 (`approvedByReviewCouncil: true`만 통과).
- **승인된 AgentResult + 커밋 SHA** — 각 에이전트 worktree의 `commitSha`/`baseSha`.
- **파일 소유권 정책** — 에이전트별 변경 허용 범위. 수리 시에도 준수해야 한다.
- **Repair budget** — `RepairPolicySchema`: `maxAttempts`(기본 2), `allowedChangePatterns`, `forbiddenActions`. 금지 행위에는 `add-undocumented-endpoint`, `invent-figma-state`, `delete-tests`, `remove-gaps-without-evidence`, `disable-quality-gates`, `change-openspec-scope`가 포함된다. 즉 수리는 요구사항·엔드포인트·디자인 상태를 새로 발명할 수 없다.

## 출력 상세

`src/integration/integration-contracts.ts`의 IntegrationPlan 예시:

```json
{
  "runId": "run_01hzy3k9",
  "status": "planned",
  "strategy": "cherry-pick",
  "baseCommit": "3f2a…",
  "integrationBranch": "spec-to-pr/01hzy3k9/integration",
  "integrationWorktreePath": ".spec-to-pr/worktrees/run_01hzy3k9/integration",
  "candidates": [
    { "agent": "spec-bdd", "commitSha": "…", "order": 0, "approvedByReviewCouncil": true },
    { "agent": "api-contract", "commitSha": "…", "order": 1, "approvedByReviewCouncil": true },
    { "agent": "design-ui", "commitSha": "…", "order": 2, "approvedByReviewCouncil": true }
  ],
  "maxRepairAttempts": 2,
  "createdAt": "2026-07-10T00:00:00Z"
}
```

- **ConflictReport** — 실패한 명령, exit code, 충돌 파일 목록(`conflictMarkersDetected` 포함), stdout/stderr [ArtifactRef](/reference/glossary#artifactref).
- **RepairHistory** — RepairAttempt 배열. 상태는 `planned`/`applied`/`failed`/`rejected`.
- **IntegrationResult** — 상태(`planned`→`applying`→`conflicted`→`repairing`→`passed`/`failed`/`blocked`), 적용·건너뛴 후보, headSha, gap ID 목록.
- **Integrator AgentResult** — 통합 수행 증거.

## 완료 조건 (Definition of Done)

- [ ] IntegrationPlan을 준비할 수 있다.
- [ ] 통합 worktree를 생성할 수 있다 (`.spec-to-pr/worktrees/<runId>/integration`).
- [ ] 승인된 커밋이 결정론적 순서로 적용된다.
- [ ] 실패 시 ConflictReport가 생성된다.
- [ ] RepairHistory가 기록되고 수리 시도는 `maxRepairAttempts`를 넘지 않는다.
- [ ] MCP 툴 `prepare_integration` / `get_integration_plan` / `apply_integration` / `record_integration_repair` / `finalize_integration`이 동작한다.
- [ ] 스킬 `/spec-to-pr:run-integration`이 존재한다.
- [ ] `agents/integrator.md`가 존재한다.

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

- 통합 순서(integration-order) 테스트 통과
- repair policy 테스트 통과
- integration contract 테스트 통과
- Git 사용 가능 환경에서 git runner 테스트 통과
- IntegrationService 테스트 통과
- MCP stdio 통합 테스트에서 위 5개 툴이 나열됨
- 스킬 `/spec-to-pr:run-integration`, 에이전트 `integrator` 존재

## 알려진 한계

- T23은 전체 품질 게이트를 실행하지 않는다 (T24~T29 담당).
- 수리는 bounded이므로 충돌이 미해결 상태로 남을 수 있다 — 이 경우 Gap으로 남는다.
- 의미론적(semantic) 수리가 필요한 충돌은 Integrator 에이전트를 명시적으로 호출해야 한다.
- 통합은 브랜치를 push 하지 않고, PR을 발행하지 않는다 (T31 담당).
- 통합은 Gap을 닫지 않는다.
