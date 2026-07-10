---
sidebar_position: 20
title: "T20 · API Contract 에이전트 레인"
sidebar_label: "T20 API Contract 레인"
---

# T20 · API Contract 에이전트 레인

> **한 줄 요약** — Worktree 격리 런타임 위에서, 문서화된 OpenAPI 증거만으로 API 계약 작업(래퍼·스키마·목·계약 테스트)을 수행하는 API 특화 에이전트 레인.

| 항목              | 내용                                                                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **목적**          | OpenAPI 증거·API 파이프라인 아티팩트·추적성 데이터를 사용하되, 문서에 없는 API 동작을 발명하지 않는 API 전담 구현 에이전트를 제공한다                                                                                                                                                |
| **입력**          | [Run](/reference/glossary#run) ID, 프로젝트 프로필(T06), OpenAPI 인테이크 리포트(T12), API 파이프라인 아티팩트(T16), [TraceabilityMatrix](/reference/glossary#traceabilitymatrix)(T13), Gherkin 테스트 매트릭스(T15), T18의 [Worktree](/reference/glossary#worktree) 런타임 컨텍스트 |
| **출력**          | API Contract [Context Pack](/reference/glossary#context-pack), API 파일 소유권 정책, API Contract [AgentResult](/reference/glossary#agentresult), worktree 내 API 변경 파일, 차단 시 API [Gap](/reference/glossary#gap) → T22(Review Council)가 소비                                 |
| **선행 태스크**   | T18                                                                                                                                                                                                                                                                                  |
| **병렬 가능**     | T19 (Spec/BDD 레인), T21 (Design/UI 레인)                                                                                                                                                                                                                                            |
| **관련 스킬**     | `/spec-to-pr:run-api-contract`                                                                                                                                                                                                                                                       |
| **담당 에이전트** | `agents/api-contract.md`                                                                                                                                                                                                                                                             |

## 왜 필요한가

T16이 생성한 API 파이프라인 산출물은 스켈레톤이다. 이를 프로젝트에 맞게 구현·연결하는 에이전트가 필요하지만, 그 에이전트가 문서화되지 않은 엔드포인트를 발명하거나 UI 파일을 건드리면 전체 증거 사슬이 무너진다. T20은 OpenAPI 증거 범위 안에서만 움직이는 API 전담 레인을 소유권 정책과 결과 검증기로 강제한다.

## 동작 흐름

1. `prepare_api_contract_agent`가 Context Pack을 빌드한다 (`src/api-agent/api-contract-context-builder.ts`) — OpenAPI 인테이크 리포트, API 파이프라인 아티팩트, TraceabilityMatrix, Gherkin 매트릭스, 소유권 정책 포함.
2. `/spec-to-pr:run-api-contract` 스킬이 `api-contract` 서브에이전트에 위임한다.
3. 에이전트는 할당된 worktree 안에서 API 래퍼·스키마·목·계약 테스트 작업을 수행한다.
4. `record_api_contract_agent_result`가 결과를 검증·기록한다 (`src/api-agent/api-contract-result-validator.ts`):
   - API 소유권 정책을 벗어난 변경 파일 거부
   - `commitSha` 없는 passed 결과 거부
   - 실패한 check가 포함된 passed 결과 거부
5. 구현이 차단되면 API Gap을 기록한다.

### 구현 규칙

- OpenAPI 증거에 없는 엔드포인트를 발명하지 않는다.
- UI에서 생성 클라이언트를 직접 import하지 않는다.
- 프로젝트가 허용하지 않는 한 생성 파일을 수동 편집하지 않는다.
- feature/entity API 래퍼를 사용해야 한다.
- 누락된 API 계약 세부사항은 API Gap이 되어야 한다.
- passed 구현 결과는 `commitSha`가 필요하다.
- 변경 파일은 API 소유권 정책을 만족해야 한다.

### 범위 제외 (Non-goals)

UI 구현·Design/UI 에이전트(→ T21), Review Council(→ T22), 통합 머지(→ T23), PR 발행, 라이브 API 호출은 하지 않는다.

## 입력 상세

- **프로젝트 프로필** — 래퍼/생성 경로 등 프로젝트 정책.
- **OpenAPI 인테이크 리포트** (T12) — 유일하게 허용되는 API 사실의 출처.
- **API 파이프라인 아티팩트** (T16) — 생성된 스켈레톤과 manifest.
- **TraceabilityMatrix / Gherkin 테스트 매트릭스** — 요구사항·시나리오 연결.
- **Worktree 에이전트 런타임 컨텍스트** (T18) — api-contract worktree와 소유권 정책.

## 출력 상세

- **API Contract Context Pack** — 에이전트 입력 패키지.
- **API 파일 소유권 정책** — 허용/금지 경로.
- **API Contract AgentResult** — 검증된 구조화 결과:

```json
{
  "agent": "api-contract",
  "status": "passed",
  "commitSha": "abc123...",
  "changedFiles": ["src/shared/api/staff/staff.wrapper.ts"],
  "gapIds": [],
  "checks": [{ "name": "typecheck", "status": "passed" }]
}
```

- worktree 내 API 래퍼/스키마/목/계약 테스트 변경.
- 구현이 차단되었을 때의 API Gap.

구현 컴포넌트: `agents/api-contract.md`, `skills/run-api-contract/SKILL.md`, `src/api-agent/api-contract-agent-contracts.ts`, `api-contract-context-builder.ts`, `api-contract-result-validator.ts`, `src/application/api-contract-agent-service.ts`.

## 완료 조건 (Definition of Done)

- [ ] API Contract 에이전트 Context Pack을 준비할 수 있다.
- [ ] API Contract 에이전트 지시문이 존재한다.
- [ ] `/spec-to-pr:run-api-contract` 스킬이 존재한다.
- [ ] 결과 검증이 API 외 파일 변경을 거부한다.
- [ ] 결과 검증이 `commitSha` 없는 passed 결과를 거부한다.
- [ ] 결과 검증이 실패한 check가 있는 passed 결과를 거부한다.
- [ ] MCP 도구가 stdio 통합 테스트로 동작한다.

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

- API Contract 컨텍스트 빌더·결과 검증기·`ApiContractAgentService` 통합 테스트 통과.
- MCP stdio 통합에서 `prepare_api_contract_agent`, `get_api_contract_agent_context`, `record_api_contract_agent_result` 호출 성공.

## 알려진 한계

- 이 태스크는 API 에이전트 worktree를 머지하지 않는다.
- Claude Code 밖에서 API 에이전트를 자동 실행하지 않는다.
- 라이브 API 호출은 수행하지 않는다.
- Review Council은 아직 실행되지 않는다 — 통합·수리는 이후 태스크에서 이루어진다.
- API check는 에이전트가 기록하지만 전체 품질 게이트는 나중(T25)에 실행된다.
