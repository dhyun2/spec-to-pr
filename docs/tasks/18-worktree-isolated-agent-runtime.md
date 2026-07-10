---
sidebar_position: 18
title: "T18 · Worktree 격리 에이전트 런타임"
sidebar_label: "T18 에이전트 런타임"
---

# T18 · Worktree 격리 에이전트 런타임

> **한 줄 요약** — 구현 에이전트들이 서로의 작업 트리를 침범하지 않도록, 격리된 Git [Worktree](/reference/glossary#worktree)와 역할별 [Context Pack](/reference/glossary#context-pack)을 준비하는 태스크.

| 항목              | 내용                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | Spec/BDD·API·UI·통합 에이전트가 동시에 같은 워킹 트리에 쓰지 못하게 하고, 각 에이전트에 고정 base commit·전용 worktree·범위 한정 컨텍스트·파일 소유권 정책·결정적 결과 계약을 제공한다 |
| **입력**          | [Run](/reference/glossary#run) ID·projectRoot·baseCommit(또는 HEAD), OpenSpec 아티팩트(T14), Gherkin/테스트 매트릭스(T15), API 파이프라인 아티팩트(T16), Figma 디자인 계약(T17)        |
| **출력**          | 에이전트 런타임 리포트, 에이전트 descriptor, Context Pack 파일, Git worktree, [ArtifactRef](/reference/glossary#artifactref) → T19·T20·T21 에이전트 레인이 소비                        |
| **선행 태스크**   | T15, T16, T17                                                                                                                                                                          |
| **병렬 가능**     | 없음 (세 생성 레인의 합류 지점)                                                                                                                                                        |
| **관련 스킬**     | `/spec-to-pr:prepare-agent-runtime`                                                                                                                                                    |
| **담당 에이전트** | -                                                                                                                                                                                      |

## 왜 필요한가

Spec, API, UI, 통합 에이전트가 같은 워킹 트리에 동시에 쓰면 서로의 변경을 덮어쓰고, 어떤 에이전트가 어떤 파일을 바꿨는지 감사할 수 없게 된다. 각 에이전트에게는 다음이 필요하다:

- 안정적인 base commit
- 전용 worktree
- 범위가 한정된 Context Pack
- 파일 소유권 정책
- 명시적으로 허용된 명령
- 결정적 결과 계약

T18이 없으면 T19~T21의 세 레인은 병렬로 실행될 수 없다.

## 동작 흐름

1. Run의 projectRoot가 Git 저장소인지 확인하고, `Run.baseCommit`(없으면 현재 `HEAD`)을 base로 고정한다.
2. 에이전트 descriptor를 로드한다 (`src/agent-runtime/agent-descriptor.ts`). 구현 에이전트 역할: `spec-bdd`, `api-contract`, `design-ui`, `integrator`.
3. 역할별 파일 소유권 정책을 결정한다 (`src/agent-runtime/file-ownership-policy.ts`).
4. Context Pack을 생성한다 (`src/agent-runtime/context-pack.ts`) — runId, projectRoot, baseCommit, agent descriptor, ownership, 에이전트별로 선별된 [EvidenceRef](/reference/glossary#evidence)/artifacts/[Gap](/reference/glossary#gap), instructions 포함 (`AgentContextPackSchema`).
5. `GitWorktreeManager`(`src/agent-runtime/worktree-manager.ts`)가 worktree를 생성한다:
   - 경로: `<projectRoot>/.spec-to-pr/worktrees/<runId>/<agentRole>`
   - 브랜치: `spec-to-pr/<shortRunId>/<agentRole>` (shortRunId = `run_` 접두사를 제거한 앞 12자)
   - 명령: `git worktree add -B <branch> <path> <baseCommit>`
6. 에이전트 런타임 리포트를 생성하고 Context Pack·리포트를 Run 아티팩트로 기록한다.

### 범위 제외 (Non-goals)

실제 LLM 에이전트 실행, Spec/BDD·API·UI 구현(→ T19~T21), 통합 머지(→ T23), PR 생성(→ T31)은 하지 않는다.

## 입력 상세

- **Run ID / projectRoot / baseCommit** — worktree의 기준. baseCommit이 없으면 현재 `HEAD`를 사용한다.
- **OpenSpec 아티팩트** (T14), **Gherkin/테스트 매트릭스** (T15), **API 파이프라인 아티팩트** (T16), **Figma 디자인 계약** (T17) — 역할별 Context Pack에 선별 포함된다.

## 출력 상세

- **에이전트 런타임 리포트** — 준비된 worktree·Context Pack 현황.
- **에이전트 descriptor** — 역할·목적·필수 아티팩트·기대 산출물.
- **Context Pack 파일** (`AgentContextPackSchema` 기준):

```json
{
  "runId": "run_...",
  "projectRoot": "/path/to/project",
  "baseCommit": "abc123...",
  "agent": { "agent": "design-ui", "displayName": "Design/UI Agent" },
  "ownership": { "allowed": ["src/pages/**"], "forbidden": ["src/shared/api/generated/**"] },
  "evidence": [],
  "artifacts": [],
  "gaps": [],
  "instructions": ["..."]
}
```

- **Git worktree** — `.spec-to-pr/worktrees/<runId>/<agentRole>` 경로, `spec-to-pr/<shortRunId>/<agentRole>` 브랜치.
- Context Pack과 런타임 리포트를 참조하는 Run 아티팩트.

구현 컴포넌트: `src/agent-runtime/agent-descriptor.ts`, `file-ownership-policy.ts`, `context-pack.ts`, `command-runner.ts`, `worktree-manager.ts`, `agent-runtime-report.ts`, `src/application/agent-runtime-service.ts`, `skills/prepare-agent-runtime/SKILL.md`.

## 완료 조건 (Definition of Done)

- [ ] 에이전트 descriptor가 존재한다.
- [ ] 파일 소유권 정책이 존재한다.
- [ ] Context Pack이 생성된다.
- [ ] Git worktree를 생성·목록 조회할 수 있다.
- [ ] worktree가 고정된 base commit에서 생성된다.
- [ ] 기존 사용자 변경이 수정되지 않는다.
- [ ] MCP 도구로 에이전트 런타임을 준비·조회할 수 있다.
- [ ] `/spec-to-pr:prepare-agent-runtime` 스킬이 존재한다.

## 검증 방법

```bash
pnpm typecheck
pnpm build
pnpm vitest run tests/unit/agent-descriptor.test.ts tests/unit/file-ownership-policy.test.ts tests/unit/context-pack.test.ts tests/integration/worktree-manager.test.ts tests/integration/agent-runtime-service.test.ts
pnpm vitest run tests/integration/mcp-stdio.test.ts
```

MCP 도구: `list_agent_descriptors`, `prepare_agent_runtime`, `create_agent_worktree`, `get_agent_context_pack`, `list_agent_worktrees`, `cleanup_agent_worktree`.

## 알려진 한계

- 런타임은 worktree와 Context Pack 준비까지만 한다 — 구현 에이전트를 실행하지 않는다.
- 커밋·푸시·머지·PR 생성을 하지 않는다.
- worktree는 Run base commit이 있으면 그것에서, 없으면 현재 `HEAD`에서 생성된다.
- cleanup은 준비된 에이전트 worktree를 한 번에 하나씩 제거한다.
