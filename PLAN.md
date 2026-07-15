# Lightweight Orchestration and Blocked Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep SpecToPR's seven-tool, eight-stage workflow lightweight while adding typed blockers, a bounded blocked-diagnostic draft PR path, deterministic skill/agent/browser routing, and fully synchronized Korean/English guidance.

**Architecture:** Preserve the sequential durable spine (`intake → contracts → implementation → functional/design review → report → publish → archive`) and a single implementation writer. Add data and intent at existing boundaries instead of new MCP tools or stages: typed blocker details on workflow status, `ready | blocked-diagnostic` on `workflow_publish`, a deterministic report renderer, and one bounded SDK finalization turn. Keep API and UI in one implementation context; permit only read-only scouts for large independent discovery and parallel read-only reviewers after implementation.

**Tech Stack:** TypeScript 5.8, Zod 4, Vitest 3, MCP SDK 1.29, Codex SDK, Docusaurus 3, Playwright 1.61

## Invariants

- [x] Keep exactly seven public MCP tools and eight durable stages.
- [x] Keep the normal ready PR body semantically and textually stable through a golden regression test.
- [x] Never create an empty commit or claim a blocked Run passed its report stage.
- [x] A blocked diagnostic publication remains `status: blocked`; publication is evidence, not a workflow verdict.
- [x] Do not add issue fallback, a publisher reasoning agent, a browser agent, nested agents, parallel writers, or hooks for core orchestration.
- [x] Do not weaken required validation when budget or tooling is constrained; split scope or report the exact unblock action.
- [x] Remove and ignore `docs/superpowers/`; maintain this root plan as the only repository implementation plan.

## Task 1: Freeze cleanup and baseline behavior

**Files:**

- Modify: `.gitignore`
- Delete: `docs/superpowers/plans/*.md`
- Delete: `docs/superpowers/specs/*.md`
- Modify: `tests/plugin/layout.test.ts`

- [x] Add a layout assertion that `docs/superpowers` is absent and ignored.
- [x] Run `pnpm vitest run tests/plugin/layout.test.ts`; confirm the new assertion initially fails if any tracked plan remains.
- [x] Preserve the existing deletions and `.gitignore` rule, then rerun the focused test.
- [x] Run `git status --short` and verify no unrelated user changes were removed.

## Task 2: Add typed blocker and orchestration contracts

**Files:**

- Modify: `src/workflow/workflow-contracts.ts`
- Modify: `src/workflow/delivery-policy.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `tests/unit/workflow-contracts.test.ts`
- Modify: `tests/unit/delivery-policy.test.ts`
- Modify: `tests/integration/workflow-service.test.ts`

- [x] Write failing schema tests for `BlockerKindSchema` values `missing-input`, `missing-tool`, `policy`, `verification`, `publish-precondition`, `budget-split`, and `unexpected`.
- [x] Define a strict `WorkflowBlockerSchema` with stage, code, kind, summary, retryable, resumable, completed work, evidence paths, attempted recovery, unrun validations, and exact unblock action. Bound every array and string and reject secret/transcript fields by strict parsing.
- [x] Add `blockerDetails` to `WorkflowStatusSchema` while retaining the concise `blockers` compatibility field.
- [x] Add a derived strict `delegationPolicy` containing `singleWriter: true`, `allowNested: false`, `maxReadOnlyScouts`, and `parallelReviewers`; assert XS/S use zero scouts, M at most one, and L/XL at most two.
- [x] Add `recommendedSkills` to `DeliveryProfileSchema` and `appliedSkills` to `GuidanceTraceSchema`, both defaulting to empty for stored-run compatibility.
- [x] Add optional typed blocker input to blocked/failed contracts, implementation, and review submissions; allow older payloads to derive an `unexpected` blocker without migration.
- [x] Map durable stage errors and submission blockers deterministically into `blockerDetails`; never include raw prompt text, tokens, secrets, absolute private paths, or transcripts.
- [x] Derive recommended skills during intake: Figma → `figma`, `design-system`; OpenAPI → `api-generator`; React/Next package evidence → matching React/Next skills; feature UI → `playwright`. Missing optional skills remain non-blocking.
- [x] Restrict reported applied skills to the union of explicit hints and deterministic recommendations.
- [x] Run `pnpm vitest run tests/unit/workflow-contracts.test.ts tests/unit/delivery-policy.test.ts tests/integration/workflow-service.test.ts`.

## Task 3: Extract stable ready and blocked report renderers

**Files:**

- Add: `src/pr-report/workflow-report-renderer.ts`
- Add: `tests/unit/workflow-report-renderer.test.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `src/pr-report/pr-report-model.ts`

- [x] Copy the current ready markdown output into an exact golden test before moving code.
- [x] Implement `renderReadyWorkflowReport` with the existing headings, traceability, gates, risks, evidence, and feature video output unchanged.
- [x] Implement `renderBlockedWorkflowReport` with stage, blocker kind/code, retryability/resumability, completed work, evidence, attempted recovery, unrun validations, and exact unblock action. Redact absolute project roots and secret-like values.
- [x] Add report metadata distinguishing `ready` and `blocked-diagnostic` while retaining `decision: ready | blocked`.
- [x] Add an idempotent blocked-report generator keyed by run revision, blocked stage, and error code. It writes an artifact but does not start or complete the report stage.
- [x] Run `pnpm vitest run tests/unit/workflow-report-renderer.test.ts tests/integration/workflow-service.test.ts`.

## Task 4: Generalize publisher updates and allow safe blocked drafts

**Files:**

- Modify: `src/publisher/publish-contracts.ts`
- Modify: `src/publisher/publisher-port.ts`
- Modify: `src/publisher/github-publisher.ts`
- Modify: `src/publisher/gitlab-publisher.ts`
- Modify: `src/application/publisher-service.ts`
- Modify: `tests/unit/publish-contracts.test.ts`
- Modify: `tests/unit/github-publisher.test.ts`
- Modify: `tests/unit/gitlab-publisher.test.ts`
- Modify: `tests/integration/publisher-service.test.ts`

- [x] Write failing tests for `intent: ready | blocked-diagnostic`, blocked-draft creation, same-PR update, and blocked-to-ready recovery.
- [x] Replace body-only adapter updates with a strict metadata update accepting title, body, and labels; GitHub patches the pull request and synchronizes issue labels, while GitLab updates title, description, and labels.
- [x] Keep a compatibility `updateBody` application method only if existing public callers require it; route it through the generalized adapter update.
- [x] Permit `decision: blocked` only when intent is `blocked-diagnostic`.
- [x] Reuse the existing clean-tree, non-target branch, supported remote, authentication, and at-least-one-commit-ahead preflight. Do not require a reviewed head SHA for diagnostic publication.
- [x] Create/update a draft titled `[Blocked] SpecToPR Run <runId>` with labels `spec-to-pr` and `spec-to-pr:blocked`.
- [x] On ready recovery, update the same source/target draft to the normal title/body and remove `spec-to-pr:blocked`.
- [x] If there is no committed delta, return a typed `PUBLISH_NO_DELTA` precondition result and do not create an empty commit or issue.
- [x] Run `pnpm vitest run tests/unit/publish-contracts.test.ts tests/unit/github-publisher.test.ts tests/unit/gitlab-publisher.test.ts tests/integration/publisher-service.test.ts`.

## Task 5: Route diagnostic publication through the existing workflow tool

**Files:**

- Modify: `src/application/workflow-service.ts`
- Modify: `src/mcp/create-server.ts`
- Modify: `tests/integration/workflow-service.test.ts`
- Modify: `tests/integration/mcp-stdio.test.ts`

- [x] Extend `WorkflowPublishInputSchema` with default `intent: ready` and explicit `blocked-diagnostic`.
- [x] Keep ready publication gated on a passed report and current review packet.
- [x] For diagnostic intent, require `publication: draft` and a currently blocked Run, ensure the idempotent blocked report exists, and call the publisher without changing the blocked stage or passing report/publish.
- [x] Store the diagnostic publish result as evidence and expose a compact `diagnosticPublication` status summary when a PR/MR was created or updated.
- [x] Skip diagnostic publication for publish-precondition blockers that the same action cannot resolve; return the exact local report path and unblock action.
- [x] Add compact MCP server instructions whose first 512 characters state workflow order, one-action boundary, and that missing evidence never passes. Keep the public tool list exactly unchanged.
- [x] Run `pnpm vitest run tests/integration/workflow-service.test.ts tests/integration/mcp-stdio.test.ts tests/integration/release-runtime-smoke.test.ts`.

## Task 6: Add one bounded SDK blocked finalization turn and compact routing

**Files:**

- Modify: `packages/codex-sdk/src/boundary-runner.ts`
- Modify: `packages/codex-sdk/src/spec-to-pr-runner.ts`
- Modify: `packages/codex-sdk/src/workflow-policy.ts`
- Modify: `packages/codex-sdk/README.md`
- Modify: `tests/unit/codex-sdk-budget.test.ts`
- Modify: `tests/unit/codex-sdk-workflow-policy.test.ts`

- [x] Write failing tests showing a blocked draft Run receives at most one finalization turn, a publication-none Run receives none, and a publish-precondition blocker cannot loop.
- [x] Extend the SDK status projection with blocker details, publication intent, delegation policy, and diagnostic publication summary.
- [x] Before breaking on blocked state, permit exactly one bounded turn instructing the model to call `workflow_publish` with `blocked-diagnostic` only when a committed delta, clean branch, supported remote, and credentials already exist; otherwise preserve the local diagnostic and stop.
- [x] Never exceed `maxTurns` or the hard token limit to attempt diagnostic publication.
- [x] Replace duplicated skill/tool prose in `buildSpecToPrPrompt` with a compact action envelope sourced from status. Keep the API/UI same-context and one-external-action constraints.
- [x] Encode scout routing: XS/S zero, M up to one read-only scout, L/XL up to two only for independent read-heavy discovery; no nested scouts or parallel writers. Functional/design reviewers may run in parallel only after implementation.
- [x] Record only actually applied optional skills in submitted evidence.
- [x] Run `pnpm vitest run tests/unit/codex-sdk-budget.test.ts tests/unit/codex-sdk-workflow-policy.test.ts` and the repository's canonical SDK build command `pnpm sdk:build`.

## Task 7: Tighten reviewer, skill, and release packaging boundaries

**Files:**

- Modify: `.codex/agents/spec-to-pr-functional-reviewer.toml`
- Modify: `.codex/agents/spec-to-pr-design-reviewer.toml`
- Modify: `agents/functional-reviewer.md`
- Modify: `agents/design-reviewer.md`
- Modify: `skills/spec-to-pr/SKILL.md`
- Modify: `skills/intake-contracts/SKILL.md`
- Modify: `skills/implement/SKILL.md`
- Modify: `skills/review-functional/SKILL.md`
- Modify: `skills/review-design/SKILL.md`
- Modify: `skills/publish/SKILL.md`
- Modify: `skills/archive-openspec/SKILL.md`
- Delete: `skills/prepare-release/SKILL.md`
- Add: `.agents/skills/prepare-release/SKILL.md`
- Modify: `src/release/release-package-builder.ts`
- Modify: `src/release/release-verifier.ts`
- Modify: `tests/plugin/layout.test.ts`
- Modify: `tests/unit/release-package-builder.test.ts`
- Modify: `tests/unit/release-verifier.test.ts`

- [x] Make the two reviewers read-only, implementation-edit-free, and workflow-MCP-free in both Codex and Claude profiles.
- [x] Keep skill descriptions mutually exclusive: umbrella orchestration, intake/contracts, same-context implementation, functional review, UI-only design review, explicit draft publication, and explicit post-merge archive.
- [x] Add deterministic optional-skill and browser/CDP policy: Playwright Test/CLI is the acceptance oracle; browser MCP is optional interactive diagnosis; CDP is only for console/network/performance/memory/live-DOM diagnosis; screenshots/video support but do not replace assertions; unavailable required browser evidence is `BROWSER_NOT_RUN` and blocks.
- [x] Move `prepare-release` to maintainer-only `.agents/skills` and remove it from marketplace/release package assertions.
- [x] Update all counts from nine marketplace skills to eight without changing the seven-tool/two-reviewer contract.
- [x] Run `pnpm vitest run tests/plugin/layout.test.ts tests/unit/release-package-builder.test.ts tests/unit/release-verifier.test.ts tests/plugin/source-reachability.test.ts`.

## Task 8: Publish bilingual comparison and four-case execution guidance

**Files:**

- Add: `website/docs/concepts/comparison.mdx`
- Add: `website/i18n/en/docusaurus-plugin-content-docs/current/concepts/comparison.mdx`
- Modify: `website/docs/intro.md`
- Add: `website/i18n/en/docusaurus-plugin-content-docs/current/intro.md`
- Modify: `website/sidebars.ts`
- Modify: `website/docs/usage/brief.mdx`
- Modify: `website/docs/usage/legacy.mdx`
- Modify: `website/docs/usage/feature.mdx`
- Modify: `website/docs/usage/figma.mdx`
- Modify: `website/i18n/en/docusaurus-plugin-content-docs/current/usage/brief.mdx`
- Modify: `website/i18n/en/docusaurus-plugin-content-docs/current/usage/legacy.mdx`
- Modify: `website/i18n/en/docusaurus-plugin-content-docs/current/usage/feature.mdx`
- Modify: `website/i18n/en/docusaurus-plugin-content-docs/current/usage/figma.mdx`
- Modify: `website/docs/reference/skills.md`
- Add: `website/i18n/en/docusaurus-plugin-content-docs/current/reference/skills.md`
- Modify: `website/docs/concepts/pipeline.md`
- Add: `website/i18n/en/docusaurus-plugin-content-docs/current/concepts/pipeline.md`
- Modify: `website/docs/troubleshooting.md`
- Add: `website/i18n/en/docusaurus-plugin-content-docs/current/troubleshooting.md`
- Modify: `website/docusaurus.config.ts`
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `docs/adr/035-use-coarse-workflow-facade-and-split-reviews.md`
- Modify: `tests/plugin/documentation-v2.test.ts`
- Modify: `tests/browser/four-case-guide.mjs`

- [x] Add failing documentation tests for Korean/English comparison routes, sidebar presence, primary source links, eight-skill count, blocked-diagnostic wording, and release labeling.
- [x] Compare GitHub Spec Kit, OpenSpec, Kiro, and BMAD across intake/contracts, implementation, validation, publication, blocked-state behavior, and best-fit use cases.
- [x] Document orchestration lessons from Codex, GitHub Copilot/Agentic Workflows, Claude Code, Cursor, Cline, Playwright, and Chrome DevTools MCP using official primary sources and a 2026-07-15 research cutoff.
- [x] Mark patterns as adopted, conditional, or rejected; state that issue fallback and heavy permanent teams are deliberately not implemented.
- [x] Add a detailed execution-policy section to each separate case page: exact required/optional inputs, sample prompt, stages, agents, skills, MCP/browser/CDP use, validation, normal PR result, blocked PR/local-report result, and resume behavior.
- [x] Keep feature-only targeted E2E plus one video; do not imply whole-project E2E or video for brief/legacy/Figma cases.
- [x] Synchronize README, ADR, footer, reference, pipeline, and troubleshooting facts.
- [x] Run `pnpm vitest run tests/plugin/documentation-v2.test.ts`.
- [x] Run `pnpm --dir website build` for Korean default and English locale output.
- [x] Run the guide server and `node tests/browser/four-case-guide.mjs`; assert all four case routes and the comparison route render without console errors.

## Task 9: Generate artifacts and verify the complete repository

**Files:**

- Regenerate: `dist/**`
- Regenerate: `packages/codex-sdk/dist/**`
- Regenerate if contract output changes: `schemas/runtime/**`
- Modify: `CHANGELOG.md`

- [x] Add an unreleased changelog section describing typed blockers, diagnostic drafts, lighter orchestration, eight marketplace skills, browser policy, and bilingual comparison guidance. Do not claim a new published version.
- [x] Run formatting on changed files, then `pnpm format:check`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.
- [x] Run `pnpm check` and `pnpm guide:check`.
- [x] Run `pnpm --dir website build` and the browser smoke test.
- [x] Run `git diff --check` and inspect `git status --short`.
- [x] Confirm tool count is seven, stage count is eight, marketplace skill count is eight, reviewer count is two, `docs/superpowers` is absent, and the normal ready report golden is unchanged.
- [x] Do not commit, push, publish a package, or open a PR unless the user explicitly requests that external mutation after reviewing the implementation.

## Task 10: Close adversarial durability and publication-fencing gaps

**Files:**

- Modify: `src/workflow/workflow-contracts.ts`
- Modify: `src/application/workflow-service.ts`
- Modify: `src/application/publisher-service.ts`
- Modify: `src/publisher/publisher-port.ts`
- Modify: `src/publisher/github-publisher.ts`
- Modify: `src/publisher/gitlab-publisher.ts`
- Modify: `tests/unit/workflow-contracts.test.ts`
- Modify: `tests/integration/workflow-service.test.ts`
- Modify: `tests/integration/publisher-service.test.ts`
- Modify: Korean/English workflow and troubleshooting guidance

- [x] Reject delimiter, separator, and recursively encoded secret-shaped evidence paths.
- [x] Persist typed blocker evidence only when it exactly references an already ingested safe artifact.
- [x] Treat expired or heartbeat-lost diagnostic claims as uncertain and never auto-take them over.
- [x] Abort provider requests when ownership is lost where the runtime supports cancellation.
- [x] Require explicit `recoverUncertain` approval after the user reconciles provider state.
- [x] Add live stale-owner concurrency, arbitrary-path persistence, and bilingual documentation regressions.
- [x] Regenerate the runtime bundle and repeat the complete Task 9 verification matrix.
