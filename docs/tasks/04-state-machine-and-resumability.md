---
sidebar_position: 4
title: "T04 · 상태 머신과 재개 가능성"
sidebar_label: "T04 상태 머신"
---

# T04 · 상태 머신과 재개 가능성

> **한 줄 요약** — 내구성 있는 [Run](/reference/glossary#run) 원장에 결정적 [Stage](/reference/glossary#stage) 전이, lease, 체크포인트, 재시도 메타데이터, 재개(resume) 계획을 더해 Run을 통제된 상태 머신으로 만든다.

| 항목              | 내용                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | 장시간 실행되는 멀티 에이전트 워크플로가 실패·타임아웃·취소되어도 어디서 무엇을 재개할지 결정적으로 답할 수 있게 한다.                                                  |
| **입력**          | T03의 Run 애그리게이트와 `SqliteRunStore`                                                                                                                               |
| **출력**          | Stage 전이 정책 · lease · 체크포인트 · 재시도 예산 · 재개 계획 · `StageService`, MCP 도구 `start_stage` 등 7종 → T05 이후 모든 Stage 기반 태스크와 에이전트 레인이 소비 |
| **선행 태스크**   | T03                                                                                                                                                                     |
| **병렬 가능**     | 없음                                                                                                                                                                    |
| **관련 스킬**     | -                                                                                                                                                                       |
| **담당 에이전트** | -                                                                                                                                                                       |

## 왜 필요한가

장시간 실행되는 멀티 에이전트 워크플로는 실패하거나, 타임아웃되거나, 취소되거나, 나중에 재개될 수 있다. 시스템은 다음 질문에 답해야 한다.

- 다음 Stage는 무엇인가? 지금 실행 중인 Stage는 무엇인가?
- 실행 중인 Stage의 소유자는 누구인가? 워커 lease가 만료되었는가?
- 이 Stage는 재시도할 수 있는가? 이 업데이트는 stale한가?
- 워크플로는 어디서 재개해야 하는가?

## 동작 흐름

1. `start_stage`가 Stage를 `running`으로 전이시키고 워커에게 lease를 발급한다.
2. 워커는 `heartbeat_stage`로 lease를 갱신하며 진행한다.
3. 종료 시 `complete_stage` / `fail_stage` / `block_stage` / `skip_stage` 중 하나로 전이한다 — 현재 lease 보유자만 가능하다.
4. `failed` / `blocked` / `skipped` Stage가 재시작되면 attempt가 증가하며, `maxAttempts`(기본 3)를 초과할 수 없다.
5. `get_resume_plan`이 다음 실행 대상 Stage와 만료된 lease를 식별한다.

허용 전이:

```text
pending -> running
running -> passed | failed | blocked | skipped
failed  -> running
blocked -> running
skipped -> running
```

금지 전이:

```text
passed  -> running
pending -> passed
failed  -> passed
blocked -> passed
```

## 입력 상세

- T03의 `RunManifest` / `StageState` (revision 기반 낙관적 동시성 포함).
- 워커 식별자(`workerId`)와 시각 — lease 발급/검증에 사용.

## 출력 상세

- Stage 전이 정책 (`src/state/stage-machine.ts`) — 위 전이 표를 강제.
- **Stage lease** — 실행 중인 Stage는 반드시 lease를 가진다. 기본 TTL은 5분(`DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000`)이며 heartbeat로 갱신된다. heartbeat / complete / fail / block / skip은 현재 lease 보유자만 호출할 수 있고, 만료된 lease는 해당 Stage를 다시 시작하는 방식으로 회수(reclaim)한다.
- Stage 체크포인트 — 재개 힌트용 메타데이터.
- 재시도 예산 — `maxAttempts` 기본값 3, `attempt <= maxAttempts` 불변식 (`src/run/stages.ts`).
- 재개 계획 (`src/state/resume-plan.ts`) — 다음 Stage 후보와 만료 lease 목록.
- `StageService` + MCP 도구: `start_stage`, `heartbeat_stage`, `complete_stage`, `fail_stage`, `block_stage`, `skip_stage`, `get_resume_plan`.

## 완료 조건 (Definition of Done)

- [ ] 유효하지 않은 전이가 거부된다.
- [ ] 실행 중인 Stage는 lease를 요구한다.
- [ ] lease 불일치가 거부된다.
- [ ] 만료된 lease를 회수할 수 있다.
- [ ] failed / blocked Stage 재시작 시 재시도 attempt가 증가한다.
- [ ] 재개 계획이 다음 Stage와 만료된 lease를 식별한다.
- [ ] MCP stage 도구가 stdio 통합 테스트를 통과한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

기대 결과: Stage 전이 단위 테스트, 재개 플래너 테스트, SQLite 영속화 테스트 통과. MCP stdio 통합 테스트가 `create_run` → `start_stage` → `heartbeat_stage` → `complete_stage` → `get_resume_plan`을 호출한다.

## 알려진 한계

- Stage 전이가 실제 에이전트를 실행하지는 않는다.
- 재개 계획은 권고(advisory)일 뿐, Stage를 자동으로 실행하지 않는다.
- lease 만료 판정은 로컬 시계에 의존한다.
- 체크포인트는 메타데이터일 뿐이다.
- 재시도 정책은 기본적인 `maxAttempts` 로직이다.
- [Artifact](/reference/glossary#artifact) · [Gap](/reference/glossary#gap) ID는 Run에 이미 존재해야만 Stage에 attach할 수 있다.
