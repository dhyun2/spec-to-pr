---
sidebar_position: 21
title: "T21 · Design/UI 에이전트 레인"
sidebar_label: "T21 Design/UI 레인"
---

# T21 · Design/UI 에이전트 레인

> **한 줄 요약** — Figma 증거·디자인 계약·[OpenSpec](/reference/glossary#openspec)·Gherkin·API 래퍼 계약·FSD 소유권 정책을 근거로, 격리 [Worktree](/reference/glossary#worktree) 안에서 UI를 구현하는 에이전트 레인.

| 항목              | 내용                                                                                                                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **목적**          | Figma 증거와 디자인 계약만으로는 부족하므로, 엄격한 구현 규칙 아래에서 그것을 소비하는 UI 전담 에이전트를 제공한다                                                                                                                                                         |
| **입력**          | [Run](/reference/glossary#run) ID, OpenSpec change 이름, 디자인 계약·component contract(T17), Figma 디자인 인벤토리(T11), API 래퍼 계약(T16/T20), Gherkin/테스트 매트릭스(T15), 프로젝트 프로필(T06), FSD 소유권 정책, T18의 에이전트 런타임 worktree                      |
| **출력**          | Design/UI [Context Pack](/reference/glossary#context-pack), UI 구현 계획 아티팩트, 허용/금지 파일 정책, component contract 구현 체크리스트, Design/UI [AgentResult](/reference/glossary#agentresult), worktree 내 UI 변경 파일 → T22(Review Council)·T26(시각 회귀)가 소비 |
| **선행 태스크**   | T18                                                                                                                                                                                                                                                                        |
| **병렬 가능**     | T19 (Spec/BDD 레인), T20 (API Contract 레인)                                                                                                                                                                                                                               |
| **관련 스킬**     | `/spec-to-pr:run-design-ui`                                                                                                                                                                                                                                                |
| **담당 에이전트** | `agents/design-ui.md`                                                                                                                                                                                                                                                      |

## 왜 필요한가

T17이 만든 디자인 계약은 지도일 뿐 구현이 아니다. 전담 UI 에이전트가 다음 규칙 아래에서 계약을 소비해야 한다:

- 대상 저장소의 디자인 시스템을 사용한다.
- Figma의 스타일성 컴포넌트 prop을 기존 UI 라이브러리 variant/토큰으로 정규화한다.
- 생성된 component contract 각각을 자기만의 variant 표면으로 구현한다 — compact/list/card 상태가 서로에게 새는 공유 CSS를 만들지 않는다.
- FSD 경계를 보존한다.
- UI에서 생성 클라이언트나 fetch를 직접 import하지 않는다.
- 증거가 뒷받침할 때 loading/empty/error/success 상태를 구현한다.
- 지원되지 않거나 누락된 디자인 증거는 [Gap](/reference/glossary#gap)으로 기록한다.
- UI 라이브러리 variant/토큰 누락은 명시적 스타일 오버라이드 전에 Gap으로 기록한다.
- 구조화된 AgentResult를 반환한다.

## 동작 흐름

1. 사용자가 `/spec-to-pr:run-design-ui <run-id> <change-name>`을 호출한다.
2. `prepare_design_ui_agent`가 Context Pack과 정책 아티팩트를 생성한다 (`src/design-ui/design-ui-context-builder.ts`). 에이전트가 읽어야 하는 파일: `agent-brief.md`, `design-contract.json`, `component-contracts.json`, `figma-inventory.json`, `figma-evidence-summary.md`, `openspec-summary.md`, `gherkin-summary.md`, `api-wrapper-contract.md`, `fsd-ownership-policy.json`, `allowed-files.json`, `forbidden-imports.json`, `implementation-plan.template.md`, `result.schema.json`.
3. 스킬이 `design-ui` 서브에이전트에 위임한다 — 할당된 worktree 안에서만 UI를 구현한다.
4. `record_design_ui_agent_result`가 결과를 검증·기록한다 (`src/design-ui/design-ui-result-validator.ts`) — 금지된 파일 변경과 금지된 import를 거부한다.

### 범위 제외 (Non-goals)

시각 회귀 채점(→ T26), Review Council(→ T22), 통합 머지(→ T23), 자동 수리 루프, PR 발행은 하지 않는다.

## 입력 상세

- **디자인 계약 아티팩트 / component contract** — T17 산출물.
- **Figma 디자인 인벤토리** — T11 산출물.
- **API 래퍼 계약 아티팩트** — UI가 사용할 수 있는 유일한 API 표면.
- **Gherkin/테스트 매트릭스** — 상태·시나리오 근거.
- **프로젝트 프로필 / FSD 소유권 정책** — 허용 경로와 레이어 경계.
- **에이전트 런타임 worktree** — T18이 준비한 design-ui worktree.

## 출력 상세

- **Design/UI Context Pack** — `agent-context-pack` 아티팩트로 메타데이터가 영속화된다.
- **UI 구현 계획 아티팩트** — 구현 전 계획.
- **허용/금지 파일 정책** — `allowed-files.json`, `forbidden-imports.json`.
- **component contract 구현 체크리스트** — variant별 구현 증거.
- **Design/UI AgentResult** — 구조화 결과 (금지 파일/금지 import 검증 통과 필수).
- design-ui worktree 내 변경된 UI/컴포넌트/테스트/픽스처 파일.

구현 컴포넌트: `agents/design-ui.md`, `skills/run-design-ui/SKILL.md`, `src/design-ui/design-ui-context-builder.ts`, `design-ui-result-validator.ts`, `src/application/design-ui-agent-lane-service.ts`.

## 완료 조건 (Definition of Done)

- [ ] Design/UI 서브에이전트 descriptor가 존재한다.
- [ ] 스킬이 존재하고 정확한 워크플로를 설명한다.
- [ ] Context Pack 빌더가 디자인 계약·component contract·Figma 인벤토리·OpenSpec·Gherkin·API 래퍼 정책·소유권 정책을 방출한다.
- [ ] 파일 소유권 정책이 허용된 UI 경로로 쓰기를 제한한다.
- [ ] 결과 기록기가 금지된 변경 파일을 거부한다.
- [ ] MCP 도구가 제공된다: `prepare_design_ui_agent`, `get_design_ui_agent_context`, `record_design_ui_agent_result`.
- [ ] Context Pack 생성과 결과 검증을 테스트가 커버한다.

## 검증 방법

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

집중 커버리지:

- Context Pack 빌더 테스트
- 금지 파일·금지 import 검증기 테스트
- `DesignUiAgentLaneService` prepare/get/record 테스트
- MCP stdio tool-list·tool-call 커버리지

## 알려진 한계

- 시각 회귀, 픽셀 diff, 접근성 채점, Lighthouse 게이트는 여기서 구현하지 않는다.
- 레인은 컴포넌트별 구현 증거를 준비하지만, 컴포넌트 수준 시각 pass/fail은 T26과 T30이 나중에 결정한다.
- Design/UI worktree를 머지하거나 PR을 발행하지 않는다.
- Context Pack 메타데이터는 `agent-context-pack` 아티팩트로 영속화되지만 시각 증명은 이 태스크에서 채점하지 않는다.
- 실제 UI 품질은 여전히 서브에이전트 실행과 이후 리뷰 레인에 달려 있다.
