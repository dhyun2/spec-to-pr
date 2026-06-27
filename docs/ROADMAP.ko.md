# Spec to PR 로드맵

## 제품 목표

`spec-to-pr`는 제품 기획서, Figma 디자인, OpenAPI 문서, 기존 저장소를 입력받아 검증 가능한 Pull Request 또는 Merge Request를 생성하는 Claude Code 플러그인입니다.

이 플러그인의 최종 목표는 단순히 코드를 생성하는 것이 아닙니다. 구현이 올바르다는 증거까지 함께 생성해야 합니다.

목표 워크플로우는 다음과 같습니다.

```text
제품 기획서
+ Figma URL
+ OpenAPI 문서
+ 저장소
        ↓
Source / Evidence Registry
        ↓
OpenSpec + Gherkin + Test Matrix
        ↓
API Contract Generation
        ↓
Figma Design Contract
        ↓
Worktree-isolated Agents
        ├── Spec/BDD Agent
        ├── API Contract Agent
        └── Design/UI Agent
        ↓
Review Council
        ↓
Integration
        ↓
Quality Gates
        ↓
Visual / Accessibility / Performance / Observability Evidence
        ↓
Evidence-driven PR/MR Report
```

## 핵심 원칙

AI Agent는 요구사항을 해석하고 코드를 작성할 수 있습니다. 하지만 완료 여부의 진실 공급원이 되어서는 안 됩니다.

완료는 다음과 같은 결정론적 산출물로 증명되어야 합니다.

- 원문 근거 evidence
- 생성된 spec
- 생성 또는 수정된 코드
- exit code가 포함된 check 결과
- 테스트 리포트
- 스크린샷
- 시각 비교 리포트
- gap ledger
- PR/MR 보고서

“구현했습니다”, “테스트 통과했습니다” 같은 자연어 문장은 완료 증거로 충분하지 않습니다.

## 개발 원칙

1. 가장 아래 실행 기반부터 만든다.
2. 각 Task는 PR/MR 단위로 리뷰 가능해야 한다.
3. 각 Task는 commit 단위로 작게 쪼갠다.
4. 모든 Task는 다음을 정의해야 한다.
   - 목표
   - 하지 않을 일
   - 입력
   - 출력
   - 커밋 계획
   - 테스트
   - 완료 기준
5. 하위 레이어가 증명되기 전에 상위 기능을 구현하지 않는다.
6. Agent가 검증 불가능한 완료 주장을 만들게 하지 않는다.
7. 중요한 모든 산출물은 주소를 가질 수 있고 재현 가능해야 한다.
8. 알 수 없거나 지원하지 않는 동작은 추측 구현하지 않고 Gap으로 남긴다.

## Task 상태

| Task | 이름                                           | 상태        | 비고                                                               |
| ---: | ---------------------------------------------- | ----------- | ------------------------------------------------------------------ |
|   01 | Executable Plugin Shell                        | In Progress | Claude Code → plugin → MCP stdio 경로 증명                         |
|   02 | Shared Runtime Contracts                       | Pending     | Source, Evidence, Artifact, Gap, Check, Decision, AgentResult 정의 |
|   03 | Run Aggregate and SQLite Persistence           | Pending     | 영속 실행 장부 생성                                                |
|   04 | State Machine and Resumability                 | Pending     | stage 전이, retry, resume 추가                                     |
|   05 | Security and Policy Baseline                   | Pending     | path, command, secret, prompt-injection 보호                       |
|   06 | Intake Manifest and Project Profiler           | Pending     | 저장소 스택과 입력 manifest 탐지                                   |
|   07 | Source Registry and Content Addressing         | Pending     | 모든 입력 snapshot과 digest 생성                                   |
|   08 | Brief Intake Adapter and Text Normalization    | Pending     | 기획서 입력을 정규화하고 evidence 또는 unsupported gap 생성        |
|   09 | Figma Intake Adapter                           | Pending     | Figma URL을 node/design evidence로 변환                            |
|   10 | OpenAPI Intake Adapter                         | Pending     | OpenAPI 문서 파싱 및 검증                                          |
|   11 | Evidence Graph and Requirement Traceability    | Pending     | brief → spec → API → Figma → code → tests 연결                     |
|   12 | OpenSpec Change Generator                      | Pending     | proposal/design/tasks/spec 산출물 생성                             |
|   13 | Gherkin and Test Matrix Generator              | Pending     | scenario와 test matrix 생성                                        |
|   14 | API Generator, Drift and Wrapper Pipeline      | Pending     | API type/schema/wrapper/test 생성 또는 최신성 검증                 |
|   15 | Figma Design Contract and Design-System Mapper | Pending     | Figma를 기존 디자인시스템에 매핑                                   |
|   16 | Worktree-Isolated Agent Runtime                | Pending     | Agent를 격리된 Git worktree에서 실행                               |
|   17 | Spec/BDD Agent Lane                            | Pending     | spec agent workflow 구현                                           |
|   18 | API Contract Agent Lane                        | Pending     | API agent workflow 구현                                            |
|   19 | Design/UI Agent Lane                           | Pending     | UI agent workflow 구현                                             |
|   20 | Review Council and Gap Ledger                  | Pending     | Agent 결과 교차 검토와 gap 관리                                    |
|   21 | Integration and Bounded Repair Loop            | Pending     | Agent 결과 통합과 실패 복구                                        |
|   22 | FSD Architecture and Source Guards             | Pending     | FSD와 API boundary rule 강제                                       |
|   23 | Quality Gate Runner                            | Pending     | lint/typecheck/test/build/contract gate 실행                       |
|   24 | Visual Regression and Screenshot Compare       | Pending     | Figma와 browser screenshot 비교                                    |
|   25 | Accessibility Gate                             | Pending     | 자동 접근성 검사와 구조화된 접근성 체크                            |
|   26 | Performance and Web Vitals                     | Pending     | Lighthouse와 Web Vitals instrumentation                            |
|   27 | OpenTelemetry and Log Correlation              | Pending     | trace/metric/log correlation 추가                                  |
|   28 | Evidence-Driven PR Report                      | Pending     | 최종 PR/MR body 생성                                               |
|   29 | GitHub and GitLab Publishers                   | Pending     | draft PR/MR 및 artifact 발행                                       |
|   30 | OpenSpec Archive and Post-Merge Lifecycle      | Pending     | merge 후 OpenSpec change archive                                   |
|   31 | Evals, Hardening and Release                   | Pending     | 평가, 보안 강화, 패키징, 릴리즈                                    |

## Phase A — 실행 기반

Phase A는 플러그인이 안전하게 실행되고 영속 상태를 저장할 수 있음을 증명합니다.

### Task 01 — Executable Plugin Shell

목표:

Claude Code가 플러그인을 발견하고, MCP 서버를 stdio로 실행하고, Tool 목록을 조회하고, 최소 read-only kernel tool을 호출할 수 있음을 증명합니다.

중요한 이유:

플러그인 로딩이나 MCP transport가 깨져 있으면 이후 기능을 신뢰할 수 없습니다.

주요 산출물:

- `.claude-plugin/plugin.json`
- `.mcp.json`
- `src/mcp/server.ts`
- `skills/doctor/SKILL.md`
- `kernel_info`
- `kernel_ping`
- stdio integration test

하지 않을 일:

- Run persistence 없음
- Source/Evidence/Gap model 없음
- Figma 없음
- OpenAPI 없음
- Agent 없음
- PR publisher 없음

### Task 02 — Shared Runtime Contracts

목표:

모든 Agent가 공통으로 사용할 runtime language를 정의합니다.

중요한 이유:

Agent output은 구조화되고 검증 가능해야 합니다. 자연어 완료 주장은 충분하지 않습니다.

주요 산출물:

- Source schema
- Evidence schema
- Artifact schema
- Check schema
- Decision schema
- Gap schema
- 역할별 AgentResult schema
- JSON Schema artifact
- invariant test

### Task 03 — Run Aggregate and SQLite Persistence

목표:

영속 실행 장부를 만듭니다.

중요한 이유:

오래 실행되는 multi-agent workflow에는 프로세스가 종료되어도 남는 단일 진실 공급원이 필요합니다.

주요 산출물:

- Run manifest
- stage catalog
- reference integrity check
- SQLite schema
- RunStore port
- SqliteRunStore adapter
- create/get/list run MCP tools

### Task 04 — State Machine and Resumability

목표:

유효한 stage 전이, retry, checkpoint, resume behavior를 추가합니다.

중요한 이유:

장시간 자동화에서 실패는 정상 상황입니다. 시스템은 마지막 안전 checkpoint부터 재개할 수 있어야 합니다.

주요 산출물:

- transition engine
- worker lease
- retry policy
- checkpoint metadata
- stale worker rejection
- resume tools

### Task 05 — Security and Policy Baseline

목표:

workspace와 사용자 환경을 보호합니다.

중요한 이유:

기획서, OpenAPI description, Figma text는 신뢰할 수 없는 입력입니다. Agent가 문서 안의 텍스트를 명령으로 취급하면 안 됩니다.

주요 산출물:

- path validator
- symlink escape prevention
- command allowlist
- secret redaction
- approval policy
- audit log
- malicious fixture tests

### Task 06 — Intake Manifest and Project Profiler

목표:

저장소 구조와 프로젝트 convention을 탐지합니다.

중요한 이유:

Agent는 기존 프로젝트 구조를 따라야 하며, 임의로 새로운 도구나 아키텍처를 만들면 안 됩니다.

주요 산출물:

- project profile
- package manager detection
- framework detection
- monorepo detection
- FSD detection
- design-system detection
- test command detection
- API generator detection

## Phase B — 입력 정규화와 추적성

Phase B는 파일과 URL을 안정적인 digest 기반 evidence로 변환합니다.

### Task 07 — Source Registry and Content Addressing

목표:

모든 입력 source를 snapshot하고 hash를 계산합니다.

주요 산출물:

- source registry
- canonical content snapshots
- SHA-256 digests
- capturedAt metadata

### Task 08 — Brief Intake Adapter and Text Normalization

목표:

제품 기획서 입력을 정규화하고 지원 가능한 경우 requirement evidence를 추출합니다.

주요 산출물:

- normalized brief document
- requirement evidence
- ambiguity gaps
- unsupported source gaps

### Task 09 — Figma Intake Adapter

목표:

Figma URL을 design evidence로 변환합니다.

주요 산출물:

- parsed fileKey and nodeId
- Figma metadata
- design context
- node screenshots
- token references
- component references
- missing-state gaps

### Task 10 — OpenAPI Intake Adapter

목표:

OpenAPI 문서를 parse, bundle, validate합니다.

주요 산출물:

- operation inventory
- schema inventory
- security scheme report
- request/response model
- API gaps

### Task 11 — Evidence Graph and Requirement Traceability

목표:

requirement를 spec, API operation, Figma node, implementation file, test와 연결합니다.

주요 산출물:

- traceability graph
- requirement matrix
- orphan evidence report
- untested requirement report
- implementation-without-evidence report

## Phase C — 명세, API, 디자인 계약

Phase C는 구현 Agent가 사용할 구조화된 작업 단위를 준비합니다.

### Task 12 — OpenSpec Change Generator

목표:

OpenSpec change artifact를 생성합니다.

주요 산출물:

- proposal.md
- design.md
- tasks.md
- delta specs
- validation report

### Task 13 — Gherkin and Test Matrix Generator

목표:

실행 가능한 behavior scenario와 test matrix를 생성합니다.

주요 산출물:

- `.feature` files
- scenario IDs
- requirement tags
- test matrix
- acceptance test skeleton

### Task 14 — API Generator, Drift and Wrapper Pipeline

목표:

API client code를 생성 또는 검증하고 feature-level wrapper를 통해 노출합니다.

주요 산출물:

- generator run report
- generated drift report
- API wrappers
- runtime validation
- mocks
- contract tests
- source guard tests

### Task 15 — Figma Design Contract and Design-System Mapper

목표:

Figma design을 기존 프로젝트 design-system component와 token에 매핑합니다.

주요 산출물:

- design contract
- token mapping
- component mapping
- typography mapping
- unmapped design gaps

## Phase D — Agent 실행과 통합

Phase D는 격리된 Agent를 통해 실제 구현 작업을 실행합니다.

### Task 16 — Worktree-Isolated Agent Runtime

목표:

Agent를 별도 Git worktree에서 scoped context와 file ownership rule로 실행합니다.

주요 산출물:

- agent descriptor
- context pack
- worktree manager
- file ownership policy
- structured result submission

### Task 17 — Spec/BDD Agent Lane

목표:

Spec/BDD agent workflow를 구현합니다.

주요 산출물:

- OpenSpec artifacts
- Gherkin features
- acceptance tests
- spec gaps
- implementation-independent validation

### Task 18 — API Contract Agent Lane

목표:

API agent workflow를 구현합니다.

주요 산출물:

- generated API updates
- wrappers
- mappers
- Zod/runtime validation
- mocks
- contract tests
- API gaps

### Task 19 — Design/UI Agent Lane

목표:

Figma 기반 UI를 대상 저장소 내부에 구현합니다.

주요 산출물:

- FSD UI code
- state components
- fixture routes or stories
- component tests
- browser screenshots
- design gaps

### Task 20 — Review Council and Gap Ledger

목표:

모든 Agent 결과를 교차 검토합니다.

주요 산출물:

- review findings
- contradiction matrix
- gap ledger
- waiver records
- resolution evidence

### Task 21 — Integration and Bounded Repair Loop

목표:

Agent 작업물을 integration worktree에 merge하고 제한된 repair attempt를 실행합니다.

주요 산출물:

- integration commit
- conflict report
- repair history
- stop condition report

### Task 22 — FSD Architecture and Source Guards

목표:

architecture boundary를 강제합니다.

주요 산출물:

- FSD dependency report
- deep import guard
- UI direct fetch guard
- generated client import guard
- source guard tests

## Phase E — 검증과 증거

Phase E는 구현이 동작한다는 것을 증명하고 evidence를 기록합니다.

### Task 23 — Quality Gate Runner

목표:

결정론적인 quality check를 실행합니다.

주요 산출물:

- lint report
- typecheck report
- build report
- unit/component/contract/acceptance test reports
- coverage summary

### Task 24 — Visual Regression and Screenshot Compare

목표:

Figma screenshot과 browser screenshot을 비교합니다.

주요 산출물:

- Figma screenshots
- browser screenshots
- overlay images
- diff heatmaps
- visual metrics
- visual report

### Task 25 — Accessibility Gate

목표:

자동 접근성 검사를 실행하고 수동 검토 항목을 분리합니다.

주요 산출물:

- axe report
- keyboard navigation report
- focus report
- contrast report
- manual review checklist

### Task 26 — Performance and Web Vitals

목표:

lab performance를 측정하고 field Web Vitals instrumentation을 준비합니다.

주요 산출물:

- Lighthouse report
- performance budget report
- bundle budget report
- Web Vitals instrumentation report

### Task 27 — OpenTelemetry and Log Correlation

목표:

플러그인 실행과 생성된 app code에 필요한 observability를 추가합니다.

주요 산출물:

- trace instrumentation
- metric instrumentation
- log correlation
- redaction policy
- OTLP config report

## Phase F — 발행과 릴리즈

Phase F는 검증된 evidence를 리뷰 가능한 PR/MR artifact와 릴리즈 결과물로 변환합니다.

### Task 28 — Evidence-Driven PR Report

목표:

Run artifact를 기반으로 최종 PR/MR body를 생성합니다.

주요 산출물:

- PR report view model
- Markdown template
- golden report snapshots

필수 보고서 섹션:

- Summary
- Run Metadata
- Review Guide
- Specification
- Requirement Traceability
- Change Scope
- API Generator / API Contract
- Functional Verification
- Design Contract
- Visual Regression
- Screenshot Compare
- Network Verification
- Accessibility
- Performance / Web Vitals
- OpenTelemetry
- Runtime / Verification
- Gaps And Review Notes
- OpenSpec Archive Plan
- Decision

### Task 29 — GitHub and GitLab Publishers

목표:

artifact와 label이 포함된 draft PR 또는 MR을 발행합니다.

주요 산출물:

- GitHub publisher
- GitLab publisher
- artifact URL handling
- draft/readiness policy
- reviewer/label support

### Task 30 — OpenSpec Archive and Post-Merge Lifecycle

목표:

merge 이후 OpenSpec change를 archive합니다.

주요 산출물:

- archive command runner
- post-merge validation
- archive report
- follow-up PR/commit option

### Task 31 — Evals, Hardening and Release

목표:

플러그인을 평가하고, 보안 강화하고, 패키징하고, 릴리즈합니다.

주요 산출물:

- evaluation fixtures
- malicious input tests
- benchmark report
- deterministic ZIP
- SHA-256 checksums
- release notes

## 의존성 그래프

```text
01 Plugin Shell
 └─ 02 Runtime Contracts
     └─ 03 Run + SQLite
         └─ 04 State Machine
             ├─ 05 Security
             └─ 06 Project Profiler
                 ├─ 07 Source Registry
                 │   ├─ 08 Brief Adapter
                 │   ├─ 09 Figma Adapter
                 │   └─ 10 OpenAPI Adapter
                 └─ 11 Evidence Graph
                     ├─ 12 OpenSpec
                     ├─ 13 Gherkin
                     ├─ 14 API Pipeline
                     └─ 15 Design Contract
                         └─ 16 Agent Runtime
                             ├─ 17 Spec Agent
                             ├─ 18 API Agent
                             └─ 19 UI Agent
                                 └─ 20 Review Council
                                     └─ 21 Integration
                                         └─ 22 FSD Guard
                                             ├─ 23 Quality
                                             ├─ 24 Visual
                                             ├─ 25 Accessibility
                                             ├─ 26 Performance
                                             └─ 27 OpenTelemetry
                                                 └─ 28 PR Report
                                                     └─ 29 Publisher
                                                         └─ 30 Archive
                                                             └─ 31 Release
```

## Task 완료 계약

모든 Task는 다음을 포함해야 합니다.

```text
docs/tasks/<task-id>-<task-name>.md
새 동작에 대한 테스트
verification log
명확한 non-goals
commit-sized changes
업데이트된 ROADMAP.md status
```

각 Task는 다음 질문에 답해야 합니다.

1. 이 Task는 왜 필요한가?
2. 이 Task가 무엇을 가능하게 하는가?
3. 이 Task가 의도적으로 하지 않는 것은 무엇인가?
4. 어떤 파일이 생성되거나 변경되는가?
5. 어떤 테스트가 동작을 증명하는가?
6. 알려진 한계는 무엇인가?
7. 다음 Task는 무엇인가?

## Commit Convention

작고 되돌릴 수 있는 commit을 사용합니다.

예시:

```text
docs(task-01): define plugin shell scope
chore(repo): initialize strict node typescript workspace
feat(plugin): declare claude plugin and mcp entrypoint
feat(kernel): expose kernel info and ping tools
feat(skill): add doctor skill
test(plugin): verify plugin layout
test(kernel): verify real stdio handshake
docs(task-01): document design decisions and verification
```

## 검증 명령어

기본 검증 순서는 다음과 같습니다.

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm plugin:validate
pnpm audit
```

환경에 Claude Code CLI가 없다면 다음을 기록합니다.

```text
SKIPPED: claude CLI not available
```

그리고 자동화된 plugin layout test로 대체 검증합니다.

## 현재 집중 Task

현재 Task:

```text
Task 01 — Executable Plugin Shell
```

다음 Task:

```text
Task 02 — Shared Runtime Contracts
```
