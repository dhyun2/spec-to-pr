# Fast Workflow v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every production change. Keep API generation, mocks, and UI implementation in one implementation context.

**Goal:** Replace the 111-tool, 27-stage, multi-lane workflow with a seven-tool facade, eight-stage orchestrator, conditional gates, and two independent reviewer roles.

**Delivery modes:** Complete the facade with `brief`, `legacy`, `feature`, and `figma` entry modes. These modes reuse the existing topology. Only user-facing feature work requires a targeted feature E2E plus one bounded video; only Figma mode requires host Figma intake.

**Architecture:** A `WorkflowService` owns sequencing and compact status. The stdio MCP server is only a seven-tool adapter. Existing domain services remain internal while the legacy public tools, skills, and agent registrations are removed.

**Tech Stack:** TypeScript, Zod, MCP SDK, SQLite RunStore, Vitest.

## Global Constraints

- Public MCP tools are exactly `workflow_info`, `workflow_start`, `workflow_advance`, `workflow_submit`, `workflow_status`, `workflow_publish`, and `workflow_archive`.
- Advertised MCP schemas must serialize below 40 KB.
- Durable stages are exactly `intake`, `contracts`, `implementation`, `functional-review`, `design-review`, `report`, `publish`, and `archive`.
- API types, schemas, wrappers, mocks, and contract-test evidence must be recorded in the `api-ready` checkpoint before UI completion is accepted.
- API and UI are never separate implementation agents or worktrees.
- Registered reviewer roles are only `functional-reviewer` and `design-reviewer`.
- Functional review is required for code scope; design review is required only for applicable UI scope.
- Missing optional gates are not applicable; missing required gates block.
- Empty, failed, review-needed, skipped, or not-run evidence never satisfies a required gate.
- The latest completed gate evidence supersedes older attempts.
- Publishing remains draft-only; archive remains explicit and post-merge.
- Delivery mode must not add public MCP tools, durable stages, implementation lanes, or reviewer roles.
- Full-project E2E is never selected by default for feature delivery.

---

### Task 1: Canonical v2 workflow and review contracts

**Files:**

- Modify: `src/run/stages.ts`
- Modify: `src/runtime/constants.ts`
- Create: `src/workflow/workflow-contracts.ts`
- Create: `src/workflow/gate-policy.ts`
- Create: `src/workflow/index.ts`
- Test: `tests/unit/workflow-contracts.test.ts`
- Test: `tests/unit/gate-policy.test.ts`
- Modify: `tests/unit/stage-machine.test.ts`
- Modify: `tests/unit/runtime-contracts.test.ts`

**Interfaces:**

- Produces `WorkflowScope`, `GateApplicability`, `WorkflowAction`, `WorkflowStatus`, `WorkflowSubmission`, and explicit review verdict schemas.
- Produces `classifyWorkflowScope({ requestText, figmaUrls, explicitScope })` and `buildGatePlan(scope)`.

- [ ] Write tests asserting the exact eight stages, two reviewer roles, UI/non-UI applicability, and rejected review invariants.
- [ ] Run `pnpm vitest run tests/unit/workflow-contracts.test.ts tests/unit/gate-policy.test.ts tests/unit/stage-machine.test.ts tests/unit/runtime-contracts.test.ts` and confirm failure because v2 contracts do not exist.
- [ ] Implement the minimal schemas and stage/role constants.
- [ ] Re-run the focused tests and refactor only after they pass.

### Task 2: Workflow service and compact orchestration

**Files:**

- Create: `src/application/workflow-service.ts`
- Modify: `src/application/index.ts`
- Modify: `src/mcp/run-service-provider.ts`
- Test: `tests/integration/workflow-service.test.ts`

**Interfaces:**

- `start({ projectRoot, requestText, scope? })` creates a Run, records intake/profile evidence, completes intake, and returns compact status.
- `advance({ runId, until? })` processes deterministic transitions or returns one external action.
- `submit({ runId, submission })` records a compact artifact, enforces `api-ready`, and applies explicit review verdict rules.
- `status({ runId })` never returns the full Run aggregate.
- `publish(...)` and `archive(...)` wrap the existing safety-preserving services.

- [ ] Write integration tests for non-UI flow, API-before-UI rejection, parallel review readiness, blocked review, report generation, and compact status.
- [ ] Run the new integration test and confirm failure because `WorkflowService` is missing.
- [ ] Implement RunStore/artifact-backed submissions and automatic stage leases/transitions.
- [ ] Re-run focused tests; verify retry/resume behavior without public lease calls.

### Task 3: Replace the 111-tool MCP server with seven facade tools

**Files:**

- Replace: `src/mcp/create-server.ts`
- Modify: `src/mcp/run-service-provider.ts`
- Replace: `tests/integration/mcp-stdio.test.ts`
- Modify: `tests/integration/release-runtime-smoke.test.ts`

**Interfaces:**

- Each tool delegates to one `WorkflowService` method and returns compact structured content.
- `workflow_info` returns contract version `2.0.0`, the exact tool list, and no full service inventory.

- [ ] Replace the monolithic MCP test with a smoke test that asserts exact names, serialized schema size `< 40_000`, start/status behavior, and absence of legacy names.
- [ ] Run the MCP test and confirm it fails against the legacy server.
- [ ] Replace the server adapter and provider surface with the seven registrations.
- [ ] Run MCP and release-runtime smoke tests; measure tool schema bytes.

### Task 4: Make reviews and gate decisions canonical

**Files:**

- Modify: `src/review/review-model.ts`
- Modify: `src/application/review-council-service.ts`
- Modify: `src/application/integration-service.ts`
- Modify: `src/quality-gates/quality-gate-planner.ts`
- Modify: `src/application/quality-gate-service.ts`
- Modify: `src/application/accessibility-gate-service.ts`
- Modify: `src/application/performance-gate-service.ts`
- Modify: `src/application/visual-regression-service.ts`
- Modify: `src/pr-report/pr-report-decision-policy.ts`
- Modify: `src/application/review-scorecard-service.ts`
- Test: `tests/unit/review-model.test.ts`
- Test: `tests/integration/review-council-service.test.ts`
- Test: `tests/integration/integration-service.test.ts`
- Test: `tests/unit/quality-gate-planner.test.ts`
- Test: `tests/integration/quality-gate-service.test.ts`
- Test: `tests/integration/accessibility-gate-service.test.ts`
- Test: `tests/integration/performance-gate-service.test.ts`
- Test: `tests/integration/visual-regression-service.test.ts`
- Test: `tests/unit/pr-report-decision-policy.test.ts`
- Test: `tests/integration/review-scorecard-service.test.ts`

**Interfaces:**

- Review results include `scope` and overall `approved | changes-requested | blocked`.
- One gate plan drives execution, scorecard presentation, and report readiness.

- [ ] Add failing tests for major findings, blocked requirements, optional missing scripts, empty evidence, and stale-failure supersession.
- [ ] Implement only the policy changes required by those tests.
- [ ] Run all review, quality, visual, accessibility, performance, scorecard, and report-policy tests.

### Task 5: Collapse skills and agent registrations

**Files:**

- Replace: `skills/spec-to-pr/SKILL.md`
- Create: `skills/intake-contracts/SKILL.md`
- Create: `skills/implement/SKILL.md`
- Create: `skills/review-functional/SKILL.md`
- Create: `skills/review-design/SKILL.md`
- Create: `skills/publish/SKILL.md`
- Rewrite: `skills/doctor/SKILL.md`, `skills/archive-openspec/SKILL.md`, `skills/prepare-release/SKILL.md`
- Delete: all other `skills/*` directories.
- Create: `agents/functional-reviewer.md`, `agents/design-reviewer.md`
- Create: `.codex/agents/spec-to-pr-functional-reviewer.toml`, `.codex/agents/spec-to-pr-design-reviewer.toml`
- Delete: all other role files in `agents/` and `.codex/agents/`.
- Modify: `tests/plugin/layout.test.ts`

**Interfaces:**

- `spec-to-pr` calls only the seven workflow tools.
- `implement` requires the `api-ready` checkpoint before UI evidence submission.
- Reviewer skills map one-to-one to the two canonical roles.

- [ ] Make layout tests assert exactly nine skills, two reviewer registrations, no duplicated host namespace boilerplate, and no legacy MCP tool names.
- [ ] Run the layout test and confirm it fails against v1 definitions.
- [ ] Write the nine concise skills and two canonical roles; delete the superseded definitions.
- [ ] Validate every skill with the skill validator and re-run layout tests.

### Task 6: SDK, documentation, packaging, and final verification

**Files:**

- Modify: `packages/codex-sdk/src/workflow-policy.ts`
- Modify: `packages/codex-sdk/src/spec-to-pr-runner.ts`
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `.codex-plugin/plugin.json`
- Modify: `tests/integration/release-runtime-smoke.test.ts`
- Modify: `tests/unit/release-package-builder.test.ts`
- Modify: `tests/unit/codex-sdk-workflow-policy.test.ts`

**Interfaces:**

- SDK prompts use only the facade workflow and request conditional reviewers.
- Documentation describes the fast default and release-only gates separately.

- [ ] Add failing SDK policy tests for non-UI and UI reviewer selection.
- [ ] Update SDK prompts, docs, manifest descriptions, and release expectations.
- [ ] Run `pnpm format`, then `pnpm check`, `pnpm plugin:validate:codex`, and skill/plugin validators.
- [ ] Measure final tool count/schema bytes, stage count, skill count, agent count, and static word reduction against the design budgets.

### Task 7: Four-mode delivery policy

**Files:**

- Create: `src/workflow/delivery-policy.ts`
- Modify: `src/workflow/workflow-contracts.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `src/mcp/create-server.ts`
- Test: `tests/unit/delivery-policy.test.ts`
- Test: `tests/integration/workflow-service.test.ts`

**Interfaces:**

- `DeliveryMode` is `auto | brief | legacy | feature | figma`.
- `ChangeKind` separates feature work from fixes, refactors, migrations, design-only work, and docs.
- Intake derives one immutable delivery profile that controls brief, legacy-baseline, targeted-E2E, feature-video, and Figma-bundle requirements.

- [ ] Add failing classification and enforcement tests for all four modes.
- [ ] Implement the delivery profile without adding stages or public tools.
- [ ] Prove only user-facing feature mode requires targeted E2E and video.
- [ ] Prove Figma mode blocks contracts until a real bundle is submitted.

### Task 8: Feature evidence publication

**Files:**

- Modify: `src/publisher/publish-contracts.ts`
- Modify: `src/application/publisher-service.ts`
- Modify: GitHub and GitLab publisher adapters
- Test: publisher unit and integration tests

- [ ] Add failing tests for one `.webm`/`.mp4` artifact, size limits, draft report links, and partial upload failure.
- [ ] Store and publish the video only when the delivery profile requires it.
- [ ] Keep visual baseline synchronization and feature-video synchronization as separate readiness facts.

### Task 9: SDK, skills, and documentation synchronization

**Files:**

- Modify: `packages/codex-sdk/src/cli.ts`
- Modify: `packages/codex-sdk/src/spec-to-pr-runner.ts`
- Modify: `skills/intake-contracts/SKILL.md`
- Modify: `skills/implement/SKILL.md`
- Modify: both review skills and `skills/spec-to-pr/SKILL.md`
- Rewrite: root READMEs and retained website docs
- Delete: superseded v1 task logs, website pages, and navigation

- [ ] Add failing SDK prompt and skill behavior checks for the four modes.
- [ ] Add `--mode`, `--change-kind`, and draft publication intent without introducing another orchestrator.
- [ ] Keep exactly nine workflow skills and two reviewer registrations.
- [ ] Make the website navigation expose only the current v2 workflow and four recipes.
- [ ] Run link checks, website build/typecheck, plugin validation, skill validation, and the full test suite.
