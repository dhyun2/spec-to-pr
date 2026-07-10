---
sidebar_position: 3
title: "T03 · Run 애그리게이트와 SQLite 영속화"
sidebar_label: "T03 Run + SQLite"
---

# T03 · Run 애그리게이트와 SQLite 영속화

> **한 줄 요약** — T02의 계약 조각들을 하나의 [Run](/reference/glossary#run) 애그리게이트로 묶고, 프로세스 재시작에도 살아남는 SQLite 실행 원장(ledger)으로 영속화한다.

| 항목              | 내용                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **목적**          | 한 번의 spec-to-pr 자동화 실행에 대한 내구성 있는 실행 원장을 만들고, 계약 조각 간 참조 무결성과 동시성 안전을 보장한다.                                                                               |
| **입력**          | T02의 런타임 계약 (Source / Evidence / Artifact / Gap / AgentResult 등)                                                                                                                                |
| **출력**          | `RunManifest` · `StageState` · `RunSummary` 계약, `RunStore` 포트 + `SqliteRunStore` 어댑터, `RunService`, MCP 도구 `create_run` / `get_run` / `list_runs` → T04의 상태 머신과 이후 모든 태스크가 소비 |
| **선행 태스크**   | T02                                                                                                                                                                                                    |
| **병렬 가능**     | 없음                                                                                                                                                                                                   |
| **관련 스킬**     | -                                                                                                                                                                                                      |
| **담당 에이전트** | -                                                                                                                                                                                                      |

## 왜 필요한가

계약 조각만으로는 부족하다. 시스템은 다음을 알아야 한다.

- 어떤 [Source](/reference/glossary#source)가 어떤 Run에 속하는가
- [Evidence](/reference/glossary#evidence)가 실제 존재하는 Source를 참조하는가
- [Artifact](/reference/glossary#artifact)가 실제 존재하는 Evidence를 참조하는가
- [Gap](/reference/glossary#gap)이 실제 존재하는 Evidence와 해결 Artifact를 참조하는가
- AgentResult가 현재 Run에 속하는가
- 오래된(stale) 업데이트가 더 새로운 Run 상태를 덮어쓰려 하는가
- Run이 Claude Code 프로세스 재시작을 견딜 수 있는가

## 동작 흐름

1. `create_run`이 필수 [Stage](/reference/glossary#stage) 26개(`intake` → `project-profile` → … → `publisher` → `openspec-archive`)를 가진 `RunManifest`를 생성한다.
2. Run 애그리게이트가 저장 전에 참조 무결성(Source/Evidence/Artifact/Gap/AgentResult)과 Stage 중복을 검증한다.
3. `SqliteRunStore`가 검증된 매니페스트 스냅샷 전체(JSON)와 목록 조회용 요약(JSON)을 저장한다.
4. 저장 시 `expectedRevision`을 함께 제출하고, 새 revision은 반드시 `expectedRevision + 1`이어야 한다 — DB 업데이트가 기대 revision과 일치하지 않으면 거부한다(낙관적 동시성).
5. `get_run` / `list_runs`로 프로세스 재시작 후에도 Run을 복구·조회한다.

## 입력 상세

- T02 계약 타입들 (`src/runtime/`).
- Run 생성 입력: projectRoot 등 실행 컨텍스트 (`src/run/run.ts` 참고).

## 출력 상세

- `RunManifest` — Run 전체 스냅샷. `revision`(단조 증가), `stages`, `sources`, `evidence`, `artifacts`, `gaps`, `agentResults`를 포함.
- `StageState` — Stage별 상태 (`pending` / `running` / `passed` / `failed` / `blocked` / `waived` / `skipped`).
- `RunSummary` — 목록 조회용 요약.
- `RunStore` 포트 (`src/store/run-store.ts`) + `SqliteRunStore` 어댑터 (`src/store/sqlite-run-store.ts`).
- MCP 도구: `create_run`, `get_run`, `list_runs`.

영속화 모델은 이벤트 소싱이 아닌 **스냅샷 영속화**다. Run 하나가 검증된 JSON 매니페스트 스냅샷으로 저장되며 revision이 단조 증가한다.

```text
SQLite 저장 항목
├── 전체 manifest JSON   (get_run 용)
└── summary JSON         (list_runs 용)
```

## 완료 조건 (Definition of Done)

- [ ] Run 애그리게이트가 필수 Stage 전체를 검증한다.
- [ ] Run 애그리게이트가 중복 Stage를 거부한다.
- [ ] Run 애그리게이트가 Source / Evidence / Artifact / Gap / AgentResult 참조를 검증한다.
- [ ] SQLite 스토어가 프로세스 재시작 후에도 Run을 유지한다.
- [ ] SQLite 스토어가 stale revision 업데이트를 거부한다.
- [ ] `create_run` / `get_run` / `list_runs` MCP 도구가 실제 stdio 서버를 통해 동작한다.
- [ ] 기존 T01 · T02 테스트가 계속 통과한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
```

MCP stdio 통합 테스트가 `create_run` → `get_run` → `list_runs`를 호출하고, 재시작 시나리오 테스트가 SQLite 파일에서 Run을 복구한다.

## 알려진 한계

- Stage 전이 엔진 없음 — 전이 규칙·lease·재시도는 T04에서 도입된다.
- 재시도/재개 로직, 워커 lease 없음 (T04).
- 에이전트 실행, Source 콘텐츠 수집, SHA-256 계산 없음 (T07 이후).
- Figma MCP 연동, OpenAPI 파싱, PR 발행 없음.
