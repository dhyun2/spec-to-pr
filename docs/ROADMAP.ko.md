# Spec to PR 로드맵 v2

## 제품 목표

`spec-to-pr`는 제품 기획서, Figma 디자인, OpenAPI 문서, 기존 저장소를 입력받아 검증 가능한 Pull Request 또는 Merge Request를 생성하는 Claude Code 플러그인입니다.

이 플러그인의 최종 목표는 단순히 코드를 생성하는 것이 아닙니다. 구현이 올바르다는 증거까지 함께 생성해야 합니다.

목표 워크플로우는 다음과 같습니다.

```text
제품 기획서 / 티켓 / PDF / Notion / Issue
+ Figma URL / Figma MCP capability
+ OpenAPI 문서
+ 저장소
        ↓
Source / Evidence Registry
        ↓
Brief Intake + Normalization
        ↓
Figma MCP Capability Discovery
        ↓
Figma Raw Artifact Recording
        ↓
Figma Design-System Inventory + Cross-check
        ↓
OpenAPI Intake
        ↓
Evidence Graph + Requirement Traceability
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

## 로드맵 v2 변경 요약

v2 로드맵은 Figma 구간을 단일 intake task에서 세 개의 task로 분리합니다. Figma는 구현 품질에 직접 영향을 주는 핵심 근거이므로 한 번만 수집하고 끝내면 안 됩니다.

이전 구조:

```text
09 Figma Intake Adapter
10 OpenAPI Intake Adapter
11 Evidence Graph
```

새 구조:

```text
09 Figma MCP Capability Discovery
10 Figma Source Intake and Raw Artifact Recording
11 Figma Design-System Inventory and Cross-check
12 OpenAPI Intake Adapter
13 Evidence Graph
```

따라서 OpenAPI와 이후 task 번호가 뒤로 밀립니다. 로드맵은 이제 **31개 Task가 아니라 33개 Task**입니다.

## 핵심 원칙

AI Agent는 요구사항을 해석하고 코드를 작성할 수 있습니다. 하지만 완료 여부의 진실 공급원이 되어서는 안 됩니다.

완료는 다음과 같은 결정론적 산출물로 증명되어야 합니다.

- 원문 근거 evidence
- 정규화된 기획서 문서
- 생성된 spec
- 생성 또는 수정된 코드
- exit code가 포함된 check 결과
- 테스트 리포트
- Figma metadata/context/screenshot/variables/Code Connect artifact
- 브라우저 스크린샷
- 시각 비교 리포트
- gap ledger
- PR/MR 보고서

“구현했습니다”, “테스트 통과했습니다”, “Figma와 일치합니다” 같은 자연어 문장은 완료 증거로 충분하지 않습니다.

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
9. 기획서는 정규화되기 전까지 신뢰할 수 없는 데이터로 취급한다.
10. Figma 데이터는 UI 생성 전에 수집, inventory화, cross-check되어야 한다.
11. Figma local, remote, plugin/Code Connect capability를 먼저 기록한 뒤 provider를 선택한다.
12. Figma 충실도는 screenshot 하나로 판단하지 않는다. metadata, design context, variables, components, assets, Code Connect mapping도 추적한다.

## Figma 전략

Figma는 여러 단계의 evidence pipeline으로 다룹니다.

```text
Figma Capability Discovery
        ↓
Figma Source Intake + Raw Artifact Recording
        ↓
Figma Design-System Inventory
        ↓
Figma Design Contract
        ↓
UI Agent Context Pack
        ↓
Visual Regression
        ↓
Review Council
        ↓
PR Report
```

### Provider Discovery

플러그인은 특정 Figma provider가 항상 있다고 가정하지 않습니다.

오케스트레이션 Skill은 사용 가능한 provider를 확인하고 기록해야 합니다.

- local desktop Figma MCP
- remote Figma MCP
- Figma plugin / Code Connect 관련 MCP capability
- 프로젝트별 Figma tooling

`spec-to-pr` MCP 서버는 발견된 capability matrix를 기록합니다. 다른 Figma MCP 서버를 직접 호출할 수 있다고 가정하지 않습니다.

### Provider Policy

선택 기준은 provider 이름이 아니라 capability입니다.

| 목적                        | 우선 정책                                                                  |
| --------------------------- | -------------------------------------------------------------------------- |
| 현재 desktop 선택 node 확인 | local desktop MCP가 있으면 우선                                            |
| URL 기반 metadata           | local과 remote가 둘 다 있으면 cross-check                                  |
| design context              | 가장 풍부한 context를 반환하는 provider를 사용하고 핵심 node는 cross-check |
| screenshot baseline         | target node screenshot에 성공한 provider를 사용하고 provider identity 기록 |
| variables/styles            | `get_variable_defs` 유사 capability가 있는 provider 우선                   |
| Code Connect                | 비어 있지 않은 Code Connect map을 제공하는 provider 우선                   |
| Figma에 쓰기/generate       | write/generate tool을 명시적으로 지원하는 provider 사용                    |

### Figma Cross-check 지점

Figma는 여러 단계에서 다시 검증합니다.

1. Intake: URL, fileKey, nodeId, provider, metadata, screenshot 가능 여부.
2. Inventory: components, variables, styles, assets, Code Connect, provider mismatch.
3. UI context pack: UI Agent에게 충분한 design evidence가 있는지 확인.
4. Visual regression: Figma screenshot과 browser screenshot 비교.
5. Review Council: 구현이 올바른 component/token을 사용했는지, 없는 상태를 추측 구현하지 않았는지 확인.
6. PR Report: Figma node에서 구현 파일, screenshot, diff, gap까지 최종 trace 출력.

## Task 상태

| Task | 이름                                           | 상태        | 비고                                                                |
| ---: | ---------------------------------------------- | ----------- | ------------------------------------------------------------------- |
|   01 | Executable Plugin Shell                        | In Progress | Claude Code → plugin → MCP stdio 경로 증명                          |
|   02 | Shared Runtime Contracts                       | Pending     | Source, Evidence, Artifact, Gap, Check, Decision, AgentResult 정의  |
|   03 | Run Aggregate and SQLite Persistence           | Pending     | 영속 실행 장부 생성                                                 |
|   04 | State Machine and Resumability                 | Pending     | stage 전이, retry, resume 추가                                      |
|   05 | Security and Policy Baseline                   | Pending     | path, command, secret, prompt-injection 보호                        |
|   06 | Intake Manifest and Project Profiler           | Pending     | 저장소 스택과 입력 manifest 탐지                                    |
|   07 | Source Registry and Content Addressing         | Pending     | 모든 입력 snapshot과 digest 생성                                    |
|   08 | Brief Intake Adapter and Text Normalization    | Pending     | PDF/MD/ticket/inline 기획서 정규화 및 evidence/gap 생성             |
|   09 | Figma MCP Capability Discovery                 | Pending     | local/remote/plugin Figma MCP capability와 provider policy 기록     |
|   10 | Figma Source Intake and Raw Artifact Recording | Pending     | Figma source 등록 및 metadata/context/screenshot/variables 기록     |
|   11 | Figma Design-System Inventory and Cross-check  | Pending     | Figma 디자인시스템, component, token, asset, provider mismatch 파싱 |
|   12 | OpenAPI Intake Adapter                         | Pending     | OpenAPI 문서 parse, bundle, validate                                |
|   13 | Evidence Graph and Requirement Traceability    | Pending     | brief → spec → API → Figma → code → tests 연결                      |
|   14 | OpenSpec Change Generator                      | Pending     | proposal/design/tasks/spec 산출물 생성                              |
|   15 | Gherkin and Test Matrix Generator              | Pending     | scenario와 test matrix 생성                                         |
|   16 | API Generator, Drift and Wrapper Pipeline      | Pending     | API type/schema/wrapper/test 생성 또는 최신성 검증                  |
|   17 | Figma Design Contract and Design-System Mapper | Pending     | Figma inventory를 기존 디자인시스템에 매핑                          |
|   18 | Worktree-Isolated Agent Runtime                | Pending     | Agent를 격리된 Git worktree에서 실행                                |
|   19 | Spec/BDD Agent Lane                            | Pending     | spec agent workflow 구현                                            |
|   20 | API Contract Agent Lane                        | Pending     | API agent workflow 구현                                             |
|   21 | Design/UI Agent Lane                           | Pending     | UI agent workflow 구현                                              |
|   22 | Review Council and Gap Ledger                  | Pending     | Agent 결과 교차 검토와 gap 관리                                     |
|   23 | Integration and Bounded Repair Loop            | Pending     | Agent 결과 통합과 실패 복구                                         |
|   24 | FSD Architecture and Source Guards             | Pending     | FSD와 API boundary rule 강제                                        |
|   25 | Quality Gate Runner                            | Pending     | lint/typecheck/test/build/contract gate 실행                        |
|   26 | Visual Regression and Screenshot Compare       | Pending     | Figma와 browser screenshot 비교                                     |
|   27 | Accessibility Gate                             | Pending     | 자동 접근성 검사와 구조화된 접근성 체크                             |
|   28 | Performance and Web Vitals                     | Pending     | Lighthouse와 Web Vitals instrumentation                             |
|   29 | OpenTelemetry and Log Correlation              | Pending     | trace/metric/log correlation 추가                                   |
|   30 | Evidence-Driven PR Report                      | Pending     | 최종 PR/MR body 생성                                                |
|   31 | GitHub and GitLab Publishers                   | Pending     | draft PR/MR 및 artifact 발행                                        |
|   32 | OpenSpec Archive and Post-Merge Lifecycle      | Pending     | merge 후 OpenSpec change archive                                    |
|   33 | Evals, Hardening and Release                   | Pending     | 평가, 보안 강화, 패키징, 릴리즈 후보 준비                           |

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
- Figma provider capability schema
- Normalized brief document schema
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

저장소 구조, 프로젝트 convention, 제공된 입력 descriptor를 탐지합니다.

중요한 이유:

Agent는 기존 프로젝트 구조를 따라야 하며, 임의로 새로운 도구나 아키텍처를 만들면 안 됩니다. 또한 기획서가 파일, PDF, 티켓, Issue, URL, inline text 중 어떤 형태로 왔는지 알아야 합니다.

주요 산출물:

- input manifest
- project profile
- package manager detection
- framework detection
- monorepo detection
- FSD detection
- design-system detection
- test command detection
- API generator detection
- brief input descriptors
- Figma input descriptors
- OpenAPI input descriptors

## Phase B — 입력 정규화와 추적성

Phase B는 파일, URL, 티켓, MCP output을 안정적인 digest 기반 evidence로 변환합니다.

### Task 07 — Source Registry and Content Addressing

목표:

모든 입력 source를 snapshot하고 hash를 계산합니다.

주요 산출물:

- source registry
- canonical content snapshots
- SHA-256 digests
- capturedAt metadata
- content-addressed source store
- source drift detection hooks

### Task 08 — Brief Intake Adapter and Text Normalization

목표:

제품 기획서 입력을 정규화하고 지원 가능한 경우 requirement evidence를 추출합니다.

중요한 이유:

기획서는 Markdown, plain text, PDF, ticket, issue, Notion export, URL, inline text로 올 수 있습니다. LLM이나 Agent가 해석하기 전에 먼저 동일한 Normalized Brief Document로 정규화해야 합니다.

주요 산출물:

- normalized brief document
- block-level source map
- file-line evidence
- 지원 가능한 경우 PDF page/block evidence
- 지원 가능한 경우 ticket field/comment evidence
- requirement evidence
- ambiguity gaps
- contradiction gaps
- unsupported source gaps
- prompt-injection-like security gaps

### Task 09 — Figma MCP Capability Discovery

목표:

현재 Claude Code 환경에서 사용 가능한 Figma MCP provider와 tool capability를 발견하고 기록합니다.

중요한 이유:

Figma 충실도는 provider capability에 따라 달라집니다. local desktop MCP, remote MCP, plugin/Code Connect capability가 서로 다른 데이터를 제공할 수 있으므로 provider 선택 전에 capability를 기록해야 합니다.

주요 산출물:

- Figma provider capability report
- local desktop MCP availability record
- remote MCP availability record
- plugin/Code Connect capability record
- tool capability matrix
- provider preference policy
- Figma connection gaps

### Task 10 — Figma Source Intake and Raw Artifact Recording

목표:

Figma source를 등록하고 raw Figma MCP output을 영속 artifact로 기록합니다.

중요한 이유:

Figma URL만으로는 충분하지 않습니다. fileKey, nodeId, metadata, design context, screenshot, variable definitions, Code Connect output이 주소 가능한 artifact로 저장되어야 합니다.

주요 산출물:

- parsed fileKey and nodeId
- canonical Figma source locator
- Figma metadata artifacts
- Figma design context artifacts
- Figma screenshot artifacts
- Figma variable/style definition artifacts
- Figma Code Connect map artifacts
- provider identity metadata
- missing-data gaps

### Task 11 — Figma Design-System Inventory and Cross-check

목표:

raw Figma artifact를 디자인시스템 inventory로 파싱하고 provider 결과를 cross-check합니다.

중요한 이유:

UI 생성은 component, variant, token, style, vector, asset, Code Connect mapping 정보를 알아야 합니다. screenshot만으로는 충분하지 않습니다.

주요 산출물:

- Figma design inventory
- component instance inventory
- variant/property inventory
- variable/token inventory
- text/paint/effect style inventory
- icon/vector/asset inventory
- Code Connect mapping inventory
- provider comparison report
- unmapped component gaps
- missing token gaps
- detached instance gaps
- raster-only asset gaps
- Figma evidence sufficiency report

### Task 12 — OpenAPI Intake Adapter

목표:

OpenAPI 문서를 parse, bundle, validate합니다.

주요 산출물:

- operation inventory
- schema inventory
- security scheme report
- request/response model
- error response inventory
- API gaps

### Task 13 — Evidence Graph and Requirement Traceability

목표:

requirement를 spec, API operation, Figma node, implementation file, test와 연결합니다.

주요 산출물:

- traceability graph
- requirement matrix
- orphan evidence report
- untested requirement report
- implementation-without-evidence report
- Figma evidence coverage report
- API evidence coverage report

## Phase C — 명세, API, 디자인 계약

Phase C는 구현 Agent가 사용할 구조화된 작업 단위를 준비합니다.

### Task 14 — OpenSpec Change Generator

목표:

OpenSpec change artifact를 생성합니다.

주요 산출물:

- proposal.md
- design.md
- tasks.md
- delta specs
- validation report
- evidence-backed change summary

### Task 15 — Gherkin and Test Matrix Generator

목표:

실행 가능한 behavior scenario와 test matrix를 생성합니다.

주요 산출물:

- `.feature` files
- scenario IDs
- requirement tags
- test matrix
- acceptance test skeleton
- negative/boundary test cases

### Task 16 — API Generator, Drift and Wrapper Pipeline

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

### Task 17 — Figma Design Contract and Design-System Mapper

목표:

Figma inventory를 기존 프로젝트 design-system component와 token에 매핑합니다.

주요 산출물:

- design contract
- token mapping
- component mapping
- typography mapping
- layout/auto-layout mapping
- asset mapping
- Code Connect validation
- unmapped design gaps

## Phase D — Agent 실행과 통합

Phase D는 격리된 Agent를 통해 실제 구현 작업을 실행합니다.

### Task 18 — Worktree-Isolated Agent Runtime

목표:

Agent를 별도 Git worktree에서 scoped context와 file ownership rule로 실행합니다.

주요 산출물:

- agent descriptor
- context pack
- worktree manager
- file ownership policy
- structured result submission

### Task 19 — Spec/BDD Agent Lane

목표:

Spec/BDD agent workflow를 구현합니다.

주요 산출물:

- OpenSpec artifacts
- Gherkin features
- acceptance tests
- spec gaps
- implementation-independent validation

### Task 20 — API Contract Agent Lane

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

### Task 21 — Design/UI Agent Lane

목표:

Figma 기반 UI를 대상 저장소 내부에 구현합니다.

주요 산출물:

- FSD UI code
- state components
- fixture routes or stories
- component tests
- browser screenshots
- design gaps

### Task 22 — Review Council and Gap Ledger

목표:

모든 Agent 결과를 교차 검토합니다.

주요 산출물:

- review findings
- contradiction matrix
- gap ledger
- waiver records
- resolution evidence
- Figma implementation review
- API contract review
- brief evidence review

### Task 23 — Integration and Bounded Repair Loop

목표:

Agent 작업물을 integration worktree에 merge하고 제한된 repair attempt를 실행합니다.

주요 산출물:

- integration commit
- conflict report
- repair history
- stop condition report

### Task 24 — FSD Architecture and Source Guards

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

### Task 25 — Quality Gate Runner

목표:

결정론적인 quality check를 실행합니다.

주요 산출물:

- lint report
- typecheck report
- build report
- unit/component/contract/acceptance test reports
- coverage summary

### Task 26 — Visual Regression and Screenshot Compare

목표:

Figma screenshot과 browser screenshot을 비교합니다.

주요 산출물:

- Figma screenshots
- browser screenshots
- overlay images
- diff heatmaps
- visual metrics
- viewport matrix
- provider/source metadata
- visual report

### Task 27 — Accessibility Gate

목표:

자동 접근성 검사를 실행하고 수동 검토 항목을 분리합니다.

주요 산출물:

- axe report
- keyboard navigation report
- focus report
- contrast report
- manual review checklist

### Task 28 — Performance and Web Vitals

목표:

lab performance를 측정하고 field Web Vitals instrumentation을 준비합니다.

주요 산출물:

- Lighthouse report
- performance budget report
- bundle budget report
- Web Vitals instrumentation report

### Task 29 — OpenTelemetry and Log Correlation

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

### Task 30 — Evidence-Driven PR Report

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
- Figma Provider Capability
- Figma Design-System Inventory
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

### Task 31 — GitHub and GitLab Publishers

목표:

artifact와 label이 포함된 draft PR 또는 MR을 발행합니다.

주요 산출물:

- GitHub publisher
- GitLab publisher
- artifact URL handling
- draft/readiness policy
- reviewer/label support

### Task 32 — OpenSpec Archive and Post-Merge Lifecycle

목표:

merge 이후 OpenSpec change를 archive합니다.

주요 산출물:

- archive command runner
- post-merge validation
- archive report
- follow-up PR/commit option

### Task 33 — Evals, Hardening and Release

목표:

플러그인을 평가하고, 보안 강화하고, 패키징하고, 릴리즈 후보를 준비합니다.

주요 산출물:

- evaluation fixtures
- malicious input tests
- Figma provider capability fixtures
- benchmark report
- deterministic ZIP
- SHA-256 checksums
- release manifest
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
                 │   ├─ 08 Brief Intake
                 │   ├─ 09 Figma Capability Discovery
                 │   │   └─ 10 Figma Raw Artifact Recording
                 │   │       └─ 11 Figma Design-System Inventory
                 │   └─ 12 OpenAPI Intake
                 └─ 13 Evidence Graph
                     ├─ 14 OpenSpec
                     ├─ 15 Gherkin
                     ├─ 16 API Pipeline
                     └─ 17 Figma Design Contract
                         └─ 18 Agent Runtime
                             ├─ 19 Spec Agent
                             ├─ 20 API Agent
                             └─ 21 UI Agent
                                 └─ 22 Review Council
                                     └─ 23 Integration
                                         └─ 24 FSD Guard
                                             ├─ 25 Quality
                                             ├─ 26 Visual
                                             ├─ 27 Accessibility
                                             ├─ 28 Performance
                                             └─ 29 OpenTelemetry
                                                 └─ 30 PR Report
                                                     └─ 31 Publisher
                                                         └─ 32 Archive
                                                             └─ 33 Release
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
chore(repo): initialize strict node typescript formatting and git hygiene
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
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm release:build 0.1.0 --dry-run
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
