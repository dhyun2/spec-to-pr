# Spec to PR Roadmap v2

## Product Goal

`spec-to-pr` is a Claude Code plugin that turns a product brief, Figma design, OpenAPI documentation, and an existing repository into a verified Pull Request or Merge Request.

The final plugin must not only generate code. It must also produce evidence that the implementation is correct.

The target workflow is:

```text
Product Brief / Ticket / PDF / Notion / Issue
+ Figma URL / Figma MCP capability
+ OpenAPI Docs
+ Repository
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

## Roadmap v2 Change Summary

This v2 roadmap changes the Figma section from a single intake task into three separate tasks because Figma is a critical implementation source and must be cross-checked more than once.

Old structure:

```text
09 Figma Intake Adapter
10 OpenAPI Intake Adapter
11 Evidence Graph
```

New structure:

```text
09 Figma MCP Capability Discovery
10 Figma Source Intake and Raw Artifact Recording
11 Figma Design-System Inventory and Cross-check
12 OpenAPI Intake Adapter
13 Evidence Graph
```

OpenAPI and all downstream tasks are shifted back accordingly. The roadmap now has **33 tasks** instead of 31.

## Core Principle

AI agents may interpret requirements and write code, but they are not the source of truth for completion.

Completion must be proven by deterministic artifacts:

- source evidence
- normalized brief documents
- generated specs
- generated or updated code
- checks with exit codes
- test reports
- Figma metadata/context/screenshots/variables/code-connect artifacts
- browser screenshots
- visual comparison reports
- gap ledger
- PR/MR report

A natural-language statement such as “implemented”, “tests passed”, or “Figma matched” is not enough.

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
9. Product briefs are untrusted data until normalized.
10. Figma data must be captured, inventoried, and cross-checked before UI generation.
11. Figma local, remote, and plugin/Code Connect capabilities must be recorded before selecting a provider.
12. A single screenshot is not enough for Figma fidelity; metadata, design context, variables, components, assets, and Code Connect mapping must also be tracked.

## Figma Strategy

Figma is handled as a multi-step evidence pipeline.

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

The plugin should not assume that one specific Figma provider is available.

The orchestration Skill should check and record available providers:

- local desktop Figma MCP
- remote Figma MCP
- Figma plugin / Code Connect-related MCP capability
- any project-specific Figma tooling

The `spec-to-pr` MCP server records the discovered capability matrix. It does not assume it can directly call another MCP server.

### Provider Policy

Selection is capability-based, not provider-name-based.

Examples:

| Purpose                   | Preferred policy                                                            |
| ------------------------- | --------------------------------------------------------------------------- |
| Current desktop selection | Prefer local desktop MCP when available                                     |
| URL-based metadata        | Cross-check local and remote when both are available                        |
| Design context            | Use provider with richest returned context; cross-check key nodes           |
| Screenshot baseline       | Use provider that succeeds for the target node and record provider identity |
| Variables/styles          | Prefer provider with `get_variable_defs`-like capability                    |
| Code Connect              | Prefer provider with non-empty Code Connect map                             |
| Write/generate in Figma   | Use provider that explicitly supports write/generate tools                  |

### Figma Cross-check Points

Figma is rechecked at multiple stages:

1. Intake: URL, fileKey, nodeId, provider, metadata, screenshot availability.
2. Inventory: components, variables, styles, assets, Code Connect, provider mismatch.
3. UI context pack: whether UI Agent has enough design evidence.
4. Visual regression: Figma screenshot vs browser screenshot.
5. Review Council: whether implementation used correct components/tokens and did not invent missing states.
6. PR Report: final trace from Figma node to implementation, screenshots, diff, and gaps.

## Task Status

| Task | Name                                           | Status      | Notes                                                                    |
| ---: | ---------------------------------------------- | ----------- | ------------------------------------------------------------------------ |
|   01 | Executable Plugin Shell                        | In Progress | Prove Claude Code → plugin → MCP stdio path                              |
|   02 | Shared Runtime Contracts                       | Pending     | Define Source, Evidence, Artifact, Gap, Check, Decision, AgentResult     |
|   03 | Run Aggregate and SQLite Persistence           | Pending     | Create durable Run ledger                                                |
|   04 | State Machine and Resumability                 | Pending     | Add stage transitions, retry, resume                                     |
|   05 | Security and Policy Baseline                   | Pending     | Path, command, secret, prompt-injection protection                       |
|   06 | Intake Manifest and Project Profiler           | Pending     | Detect repository stack and input manifest                               |
|   07 | Source Registry and Content Addressing         | Pending     | Snapshot and digest all inputs                                           |
|   08 | Brief Intake Adapter and Text Normalization    | Pending     | Normalize PDF/MD/ticket/inline brief inputs and create evidence/gaps     |
|   09 | Figma MCP Capability Discovery                 | Pending     | Discover local/remote/plugin Figma MCP capabilities and provider policy  |
|   10 | Figma Source Intake and Raw Artifact Recording | Pending     | Register Figma source and record metadata/context/screenshots/variables  |
|   11 | Figma Design-System Inventory and Cross-check  | Pending     | Parse Figma design system, components, tokens, assets, provider mismatch |
|   12 | OpenAPI Intake Adapter                         | Pending     | Parse, bundle, and validate OpenAPI documents                            |
|   13 | Evidence Graph and Requirement Traceability    | Pending     | Connect brief → spec → API → Figma → code → tests                        |
|   14 | OpenSpec Change Generator                      | Pending     | Generate proposal/design/tasks/spec artifacts                            |
|   15 | Gherkin and Test Matrix Generator              | Pending     | Generate scenarios and test matrix                                       |
|   16 | API Generator, Drift and Wrapper Pipeline      | Pending     | Generate/update API types, schemas, wrappers, tests                      |
|   17 | Figma Design Contract and Design-System Mapper | Pending     | Map Figma inventory to existing design system                            |
|   18 | Worktree-Isolated Agent Runtime                | Pending     | Run agents in isolated Git worktrees                                     |
|   19 | Spec/BDD Agent Lane                            | Pending     | Implement spec agent workflow                                            |
|   20 | API Contract Agent Lane                        | Pending     | Implement API agent workflow                                             |
|   21 | Design/UI Agent Lane                           | Pending     | Implement UI agent workflow                                              |
|   22 | Review Council and Gap Ledger                  | Pending     | Cross-review outputs and manage gaps                                     |
|   23 | Integration and Bounded Repair Loop            | Pending     | Merge agent outputs and repair failures                                  |
|   24 | FSD Architecture and Source Guards             | Pending     | Enforce FSD and API boundary rules                                       |
|   25 | Quality Gate Runner                            | Pending     | Run lint/typecheck/test/build/contract gates                             |
|   26 | Visual Regression and Screenshot Compare       | Pending     | Compare Figma and browser screenshots                                    |
|   27 | Accessibility Gate                             | Pending     | Run automated and structured accessibility checks                        |
|   28 | Performance and Web Vitals                     | Pending     | Run Lighthouse and Web Vitals instrumentation                            |
|   29 | OpenTelemetry and Log Correlation              | Pending     | Add trace/metric/log correlation                                         |
|   30 | Evidence-Driven PR Report                      | Pending     | Generate final PR/MR body                                                |
|   31 | GitHub and GitLab Publishers                   | Pending     | Publish draft PR/MR and artifacts                                        |
|   32 | OpenSpec Archive and Post-Merge Lifecycle      | Pending     | Archive OpenSpec changes after merge                                     |
|   33 | Evals, Hardening and Release                   | Pending     | Evaluate, harden, package, and prepare a release candidate               |

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
- Figma provider capability schema
- Normalized brief document schema
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

Detect repository structure, project conventions, and provided input descriptors.

Important because:

Agents must follow the existing project instead of inventing new tooling or architecture. The system must also know whether briefs arrive as files, PDFs, tickets, issues, URLs, or inline text.

Primary outputs:

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

## Phase B — Input Normalization and Traceability

Phase B turns files, URLs, tickets, and MCP outputs into stable, digest-backed evidence.

### Task 07 — Source Registry and Content Addressing

Goal:

Snapshot and hash all input sources.

Primary outputs:

- source registry
- canonical content snapshots
- SHA-256 digests
- capturedAt metadata
- content-addressed source store
- source drift detection hooks

### Task 08 — Brief Intake Adapter and Text Normalization

Goal:

Normalize product brief inputs and extract requirement evidence when supported.

Important because:

Briefs may arrive as Markdown, plain text, PDF, ticket, issue, Notion export, URL, or inline text. The system must normalize them before any LLM or agent interprets them.

Primary outputs:

- normalized brief document
- block-level source map
- file-line evidence
- PDF page/block evidence when supported
- ticket field/comment evidence when supported
- requirement evidence
- ambiguity gaps
- contradiction gaps
- unsupported source gaps
- prompt-injection-like security gaps

### Task 09 — Figma MCP Capability Discovery

Goal:

Discover and record which Figma MCP providers and tools are available in the current Claude Code environment.

Important because:

Figma fidelity depends on provider capability. Local desktop MCP, remote MCP, and plugin/Code Connect capabilities may expose different data. The system must record capabilities before selecting a provider.

Primary outputs:

- Figma provider capability report
- local desktop MCP availability record
- remote MCP availability record
- plugin/Code Connect capability record
- tool capability matrix
- provider preference policy
- Figma connection gaps

### Task 10 — Figma Source Intake and Raw Artifact Recording

Goal:

Register Figma sources and record raw Figma MCP outputs as durable artifacts.

Important because:

A Figma URL alone is not enough. The system needs fileKey, nodeId, metadata, design context, screenshot, variable definitions, and Code Connect output as addressable artifacts.

Primary outputs:

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

Goal:

Parse raw Figma artifacts into a design-system inventory and cross-check provider results.

Important because:

UI generation must know which components, variants, tokens, styles, vectors, assets, and Code Connect mappings are present. Screenshot-only Figma intake is not enough.

Primary outputs:

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

Goal:

Parse, bundle, and validate OpenAPI documents.

Primary outputs:

- operation inventory
- schema inventory
- security scheme report
- request/response model
- error response inventory
- API gaps

### Task 13 — Evidence Graph and Requirement Traceability

Goal:

Connect requirements to specs, API operations, Figma nodes, implementation files, and tests.

Primary outputs:

- traceability graph
- requirement matrix
- orphan evidence report
- untested requirement report
- implementation-without-evidence report
- Figma evidence coverage report
- API evidence coverage report

## Phase C — Specification, API, and Design Contracts

Phase C prepares the structured work that implementation agents will use.

### Task 14 — OpenSpec Change Generator

Goal:

Generate OpenSpec change artifacts.

Primary outputs:

- proposal.md
- design.md
- tasks.md
- delta specs
- validation report
- evidence-backed change summary

### Task 15 — Gherkin and Test Matrix Generator

Goal:

Generate executable behavior scenarios and test matrix.

Primary outputs:

- `.feature` files
- scenario IDs
- requirement tags
- test matrix
- acceptance test skeleton
- negative/boundary test cases

### Task 16 — API Generator, Drift and Wrapper Pipeline

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

### Task 17 — Figma Design Contract and Design-System Mapper

Goal:

Map Figma inventory to existing project design-system components and tokens.

Primary outputs:

- design contract
- token mapping
- component mapping
- typography mapping
- layout/auto-layout mapping
- asset mapping
- Code Connect validation
- unmapped design gaps

## Phase D — Agent Execution and Integration

Phase D runs the actual implementation work through isolated agents.

### Task 18 — Worktree-Isolated Agent Runtime

Goal:

Run agents in separate Git worktrees with scoped context and file ownership rules.

Primary outputs:

- agent descriptor
- context pack
- worktree manager
- file ownership policy
- structured result submission

### Task 19 — Spec/BDD Agent Lane

Goal:

Implement the Spec/BDD agent workflow.

Primary outputs:

- OpenSpec artifacts
- Gherkin features
- acceptance tests
- spec gaps
- implementation-independent validation

### Task 20 — API Contract Agent Lane

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

### Task 21 — Design/UI Agent Lane

Goal:

Implement Figma-backed UI inside the target repository.

Primary outputs:

- FSD UI code
- state components
- fixture routes or stories
- component tests
- browser screenshots
- design gaps

### Task 22 — Review Council and Gap Ledger

Goal:

Cross-review the outputs of all agents.

Primary outputs:

- review findings
- contradiction matrix
- gap ledger
- waiver records
- resolution evidence
- Figma implementation review
- API contract review
- brief evidence review

### Task 23 — Integration and Bounded Repair Loop

Goal:

Merge agent work into an integration worktree and run bounded repair attempts.

Primary outputs:

- integration commit
- conflict report
- repair history
- stop condition report

### Task 24 — FSD Architecture and Source Guards

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

### Task 25 — Quality Gate Runner

Goal:

Run deterministic quality checks.

Primary outputs:

- lint report
- typecheck report
- build report
- unit/component/contract/acceptance test reports
- coverage summary

### Task 26 — Visual Regression and Screenshot Compare

Goal:

Compare Figma screenshots with browser screenshots.

Primary outputs:

- Figma screenshots
- browser screenshots
- overlay images
- diff heatmaps
- visual metrics
- viewport matrix
- provider/source metadata
- visual report

### Task 27 — Accessibility Gate

Goal:

Run automated accessibility checks and separate manual review items.

Primary outputs:

- axe report
- keyboard navigation report
- focus report
- contrast report
- manual review checklist

### Task 28 — Performance and Web Vitals

Goal:

Measure lab performance and prepare field Web Vitals instrumentation.

Primary outputs:

- Lighthouse report
- performance budget report
- bundle budget report
- Web Vitals instrumentation report

### Task 29 — OpenTelemetry and Log Correlation

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

### Task 30 — Evidence-Driven PR Report

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

Goal:

Publish draft PRs or MRs with artifacts and labels.

Primary outputs:

- GitHub publisher
- GitLab publisher
- artifact URL handling
- draft/readiness policy
- reviewer/label support

### Task 32 — OpenSpec Archive and Post-Merge Lifecycle

Goal:

Archive OpenSpec changes after merge.

Primary outputs:

- archive command runner
- post-merge validation
- archive report
- follow-up PR/commit option

### Task 33 — Evals, Hardening and Release

Goal:

Evaluate, harden, package, and prepare a release candidate for the plugin.

Primary outputs:

- evaluation fixtures
- malicious input tests
- Figma provider capability fixtures
- benchmark report
- deterministic ZIP
- SHA-256 checksums
- release manifest
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
chore(repo): initialize strict node typescript formatting and git hygiene
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
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm release:build 0.1.0 --dry-run
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
