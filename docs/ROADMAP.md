# Spec to PR Roadmap

## Product Goal

`spec-to-pr` is a Claude Code plugin that turns a product brief, Figma design, OpenAPI documentation, and an existing repository into a verified pull request or merge request.

The final plugin must not only generate code. It must also produce evidence that the implementation is correct.

The target workflow is:

```text
Product Brief
+ Figma URL
+ OpenAPI Docs
+ Repository
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

## Core Principle

AI agents may interpret requirements and write code, but they are not the source of truth for completion.

Completion must be proven by deterministic artifacts:

- source evidence
- generated specs
- generated or updated code
- checks with exit codes
- test reports
- screenshots
- visual comparison reports
- gap ledger
- PR/MR report

A natural-language statement such as “implemented” or “tests passed” is not enough.

## Development Principles

1. Build from the bottom up.
2. Each Task should be reviewable as a PR/MR.
3. Each Task should be split into commit-sized changes.
4. Every Task must define:
   - goal
   - non-goals
   - inputs
   - outputs
   - commit plan
   - tests
   - definition of done
5. Do not implement downstream features before the lower layer is proven.
6. Do not let agents produce unverifiable completion claims.
7. All important artifacts must be addressable and reproducible.
8. Unknown or unsupported behavior must become a Gap, not guessed implementation.

## Task Status

| Task | Name                                           | Status      | Notes                                                                |
| ---: | ---------------------------------------------- | ----------- | -------------------------------------------------------------------- |
|   01 | Executable Plugin Shell                        | In Progress | Prove Claude Code → plugin → MCP stdio path                          |
|   02 | Shared Runtime Contracts                       | Pending     | Define Source, Evidence, Artifact, Gap, Check, Decision, AgentResult |
|   03 | Run Aggregate and SQLite Persistence           | Pending     | Create durable Run ledger                                            |
|   04 | State Machine and Resumability                 | Pending     | Add stage transitions, retry, resume                                 |
|   05 | Security and Policy Baseline                   | Pending     | Path, command, secret, prompt-injection protection                   |
|   06 | Intake Manifest and Project Profiler           | Pending     | Detect repository stack and input manifest                           |
|   07 | Source Registry and Content Addressing         | Pending     | Snapshot and digest all inputs                                       |
|   08 | Brief Adapter                                  | Pending     | Convert brief into structured requirement evidence                   |
|   09 | Figma Intake Adapter                           | Pending     | Convert Figma URL into node/design evidence                          |
|   10 | OpenAPI Intake Adapter                         | Pending     | Parse and validate OpenAPI documents                                 |
|   11 | Evidence Graph and Requirement Traceability    | Pending     | Connect brief → spec → API → Figma → code → tests                    |
|   12 | OpenSpec Change Generator                      | Pending     | Generate proposal/design/tasks/spec artifacts                        |
|   13 | Gherkin and Test Matrix Generator              | Pending     | Generate scenarios and test matrix                                   |
|   14 | API Generator, Drift and Wrapper Pipeline      | Pending     | Generate/update API types, schemas, wrappers, tests                  |
|   15 | Figma Design Contract and Design-System Mapper | Pending     | Map Figma to existing design system                                  |
|   16 | Worktree-Isolated Agent Runtime                | Pending     | Run agents in isolated Git worktrees                                 |
|   17 | Spec/BDD Agent Lane                            | Pending     | Implement spec agent workflow                                        |
|   18 | API Contract Agent Lane                        | Pending     | Implement API agent workflow                                         |
|   19 | Design/UI Agent Lane                           | Pending     | Implement UI agent workflow                                          |
|   20 | Review Council and Gap Ledger                  | Pending     | Cross-review outputs and manage gaps                                 |
|   21 | Integration and Bounded Repair Loop            | Pending     | Merge agent outputs and repair failures                              |
|   22 | FSD Architecture and Source Guards             | Pending     | Enforce FSD and API boundary rules                                   |
|   23 | Quality Gate Runner                            | Pending     | Run lint/typecheck/test/build/contract gates                         |
|   24 | Visual Regression and Screenshot Compare       | Pending     | Compare Figma and browser screenshots                                |
|   25 | Accessibility Gate                             | Pending     | Run automated and structured accessibility checks                    |
|   26 | Performance and Web Vitals                     | Pending     | Run Lighthouse and Web Vitals instrumentation                        |
|   27 | OpenTelemetry and Log Correlation              | Pending     | Add trace/metric/log correlation                                     |
|   28 | Evidence-Driven PR Report                      | Pending     | Generate final PR/MR body                                            |
|   29 | GitHub and GitLab Publishers                   | Pending     | Publish draft PR/MR and artifacts                                    |
|   30 | OpenSpec Archive and Post-Merge Lifecycle      | Pending     | Archive OpenSpec changes after merge                                 |
|   31 | Evals, Hardening and Release                   | Pending     | Evaluate, harden, package, and release                               |

## Phase A — Execution Foundation

Phase A proves that the plugin can execute safely and persist durable state.

### Task 01 — Executable Plugin Shell

Goal:

Prove that Claude Code can discover the plugin, start the MCP server over stdio, list tools, and call minimal read-only kernel tools.

Important because:

If plugin loading or MCP transport is broken, no later feature can be trusted.

Primary outputs:

- `.claude-plugin/plugin.json`
- `.mcp.json`
- `src/mcp/server.ts`
- `skills/doctor/SKILL.md`
- `kernel_info`
- `kernel_ping`
- stdio integration test

Non-goals:

- no Run persistence
- no Source/Evidence/Gap model
- no Figma
- no OpenAPI
- no agents
- no PR publisher

### Task 02 — Shared Runtime Contracts

Goal:

Define the common runtime language used by all agents.

Important because:

Agent output must be structured and verifiable. Natural-language completion claims are not enough.

Primary outputs:

- Source schema
- Evidence schema
- Artifact schema
- Check schema
- Decision schema
- Gap schema
- role-specific AgentResult schemas
- JSON Schema artifacts
- invariant tests

### Task 03 — Run Aggregate and SQLite Persistence

Goal:

Create the durable execution ledger.

Important because:

A long-running multi-agent workflow needs a single source of truth that survives process restarts.

Primary outputs:

- Run manifest
- stage catalog
- reference integrity checks
- SQLite schema
- RunStore port
- SqliteRunStore adapter
- create/get/list run MCP tools

### Task 04 — State Machine and Resumability

Goal:

Add valid stage transitions, retries, checkpoints, and resume behavior.

Important because:

Failures are normal in long-running automation. The system must resume from the last safe checkpoint.

Primary outputs:

- transition engine
- worker lease
- retry policy
- checkpoint metadata
- stale worker rejection
- resume tools

### Task 05 — Security and Policy Baseline

Goal:

Protect the workspace and user environment.

Important because:

Briefs, OpenAPI descriptions, and Figma text are untrusted input. Agents must not treat document text as instructions.

Primary outputs:

- path validator
- symlink escape prevention
- command allowlist
- secret redaction
- approval policy
- audit log
- malicious fixture tests

### Task 06 — Intake Manifest and Project Profiler

Goal:

Detect repository structure and project conventions.

Important because:

Agents must follow the existing project instead of inventing new tooling or architecture.

Primary outputs:

- project profile
- package manager detection
- framework detection
- monorepo detection
- FSD detection
- design-system detection
- test command detection
- API generator detection

## Phase B — Input Normalization and Traceability

Phase B turns files and URLs into stable, digest-backed evidence.

### Task 07 — Source Registry and Content Addressing

Goal:

Snapshot and hash all input sources.

Primary outputs:

- source registry
- canonical content snapshots
- SHA-256 digests
- capturedAt metadata

### Task 08 — Brief Adapter

Goal:

Extract requirement evidence from the product brief.

Primary outputs:

- structured brief model
- requirement evidence
- ambiguity gaps
- contradiction gaps

### Task 09 — Figma Intake Adapter

Goal:

Convert Figma URLs into design evidence.

Primary outputs:

- parsed fileKey and nodeId
- Figma metadata
- design context
- node screenshots
- token references
- component references
- missing-state gaps

### Task 10 — OpenAPI Intake Adapter

Goal:

Parse, bundle, and validate OpenAPI documents.

Primary outputs:

- operation inventory
- schema inventory
- security scheme report
- request/response model
- API gaps

### Task 11 — Evidence Graph and Requirement Traceability

Goal:

Connect requirements to specs, API operations, Figma nodes, implementation files, and tests.

Primary outputs:

- traceability graph
- requirement matrix
- orphan evidence report
- untested requirement report
- implementation-without-evidence report

## Phase C — Specification, API, and Design Contracts

Phase C prepares the structured work that implementation agents will use.

### Task 12 — OpenSpec Change Generator

Goal:

Generate OpenSpec change artifacts.

Primary outputs:

- proposal.md
- design.md
- tasks.md
- delta specs
- validation report

### Task 13 — Gherkin and Test Matrix Generator

Goal:

Generate executable behavior scenarios and test matrix.

Primary outputs:

- `.feature` files
- scenario IDs
- requirement tags
- test matrix
- acceptance test skeleton

### Task 14 — API Generator, Drift and Wrapper Pipeline

Goal:

Generate or verify API client code and expose it through feature-level wrappers.

Primary outputs:

- generator run report
- generated drift report
- API wrappers
- runtime validation
- mocks
- contract tests
- source guard tests

### Task 15 — Figma Design Contract and Design-System Mapper

Goal:

Map Figma design to existing project design-system components and tokens.

Primary outputs:

- design contract
- token mapping
- component mapping
- typography mapping
- unmapped design gaps

## Phase D — Agent Execution and Integration

Phase D runs the actual implementation work through isolated agents.

### Task 16 — Worktree-Isolated Agent Runtime

Goal:

Run agents in separate Git worktrees with scoped context and file ownership rules.

Primary outputs:

- agent descriptor
- context pack
- worktree manager
- file ownership policy
- structured result submission

### Task 17 — Spec/BDD Agent Lane

Goal:

Implement the Spec/BDD agent workflow.

Primary outputs:

- OpenSpec artifacts
- Gherkin features
- acceptance tests
- spec gaps
- implementation-independent validation

### Task 18 — API Contract Agent Lane

Goal:

Implement the API agent workflow.

Primary outputs:

- generated API updates
- wrappers
- mappers
- Zod/runtime validation
- mocks
- contract tests
- API gaps

### Task 19 — Design/UI Agent Lane

Goal:

Implement Figma-backed UI inside the target repository.

Primary outputs:

- FSD UI code
- state components
- fixture routes or stories
- component tests
- browser screenshots
- design gaps

### Task 20 — Review Council and Gap Ledger

Goal:

Cross-review the outputs of all agents.

Primary outputs:

- review findings
- contradiction matrix
- gap ledger
- waiver records
- resolution evidence

### Task 21 — Integration and Bounded Repair Loop

Goal:

Merge agent work into an integration worktree and run bounded repair attempts.

Primary outputs:

- integration commit
- conflict report
- repair history
- stop condition report

### Task 22 — FSD Architecture and Source Guards

Goal:

Enforce architecture boundaries.

Primary outputs:

- FSD dependency report
- deep import guard
- UI direct fetch guard
- generated client import guard
- source guard tests

## Phase E — Verification and Evidence

Phase E proves that the implementation works and records the evidence.

### Task 23 — Quality Gate Runner

Goal:

Run deterministic quality checks.

Primary outputs:

- lint report
- typecheck report
- build report
- unit/component/contract/acceptance test reports
- coverage summary

### Task 24 — Visual Regression and Screenshot Compare

Goal:

Compare Figma screenshots with browser screenshots.

Primary outputs:

- Figma screenshots
- browser screenshots
- overlay images
- diff heatmaps
- visual metrics
- visual report

### Task 25 — Accessibility Gate

Goal:

Run automated accessibility checks and separate manual review items.

Primary outputs:

- axe report
- keyboard navigation report
- focus report
- contrast report
- manual review checklist

### Task 26 — Performance and Web Vitals

Goal:

Measure lab performance and prepare field Web Vitals instrumentation.

Primary outputs:

- Lighthouse report
- performance budget report
- bundle budget report
- Web Vitals instrumentation report

### Task 27 — OpenTelemetry and Log Correlation

Goal:

Add observability to plugin execution and generated app code where applicable.

Primary outputs:

- trace instrumentation
- metric instrumentation
- log correlation
- redaction policy
- OTLP config report

## Phase F — Publishing and Release

Phase F turns verified evidence into reviewable PR/MR artifacts and release hardening.

### Task 28 — Evidence-Driven PR Report

Goal:

Generate the final PR/MR body from Run artifacts.

Primary outputs:

- PR report view model
- Markdown template
- golden report snapshots

Required report sections:

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

Goal:

Publish draft PRs or MRs with artifacts and labels.

Primary outputs:

- GitHub publisher
- GitLab publisher
- artifact URL handling
- draft/readiness policy
- reviewer/label support

### Task 30 — OpenSpec Archive and Post-Merge Lifecycle

Goal:

Archive OpenSpec changes after merge.

Primary outputs:

- archive command runner
- post-merge validation
- archive report
- follow-up PR/commit option

### Task 31 — Evals, Hardening and Release

Goal:

Evaluate, harden, package, and release the plugin.

Primary outputs:

- evaluation fixtures
- malicious input tests
- benchmark report
- deterministic ZIP
- SHA-256 checksums
- release notes

## Dependency Graph

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

## Task Completion Contract

Every Task must include:

```text
docs/tasks/<task-id>-<task-name>.md
tests for new behavior
verification log
clear non-goals
commit-sized changes
updated ROADMAP.md status
```

Each Task must answer:

1. Why does this Task exist?
2. What does it unlock?
3. What does it intentionally not do?
4. What files are created or changed?
5. What tests prove it works?
6. What are the known limitations?
7. What comes next?

## Commit Convention

Use small, reversible commits.

Examples:

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

## Verification Commands

The default verification sequence is:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm plugin:validate
pnpm audit
```

If Claude Code CLI is not available in the environment, record:

```text
SKIPPED: claude CLI not available
```

and verify plugin layout with automated tests instead.

## Current Focus

Current Task:

```text
Task 01 — Executable Plugin Shell
```

Next Task:

```text
Task 02 — Shared Runtime Contracts
```
