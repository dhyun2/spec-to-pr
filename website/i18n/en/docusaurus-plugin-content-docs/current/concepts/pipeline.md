---
sidebar_position: 1
title: How a Run works
hide_title: true
---

import GuideHero from "@site/src/components/guide/GuideHero";
import RunPipeline from "@site/src/components/guide/RunPipeline";
import NextStep from "@site/src/components/guide/NextStep";

<GuideHero
eyebrow="One Run · eight durable stages"
title="How a Run works"
summary="Follow one change from intake through implementation, verification, a draft PR, and explicit post-merge archiving."
primary={{ label: "See reviewer roles", href: "/concepts/reviews" }}
secondary={{ label: "Choose a use case", href: "/usage/" }}
/>

All four delivery modes use one Run and the same pipeline. The selected mode determines the result and required evidence, while input sources can be combined as needed. Project guidance is tracked, but it does not expand the requested scope.

## Run map

<RunPipeline locale="en" />

## Seven public tools

| Tool               | Role                                                                           |
| ------------------ | ------------------------------------------------------------------------------ |
| `workflow_info`    | Inspect contract version and inventory                                         |
| `workflow_start`   | Create a Run and record scope/profile/workload                                 |
| `workflow_advance` | Advance deterministically to the next external action or terminal state        |
| `workflow_submit`  | Submit contracts, API-ready, implementation, Figma/visual, and review evidence |
| `workflow_status`  | Read stage, estimate, blockers, next action, and bounded resume context        |
| `workflow_publish` | Preview/create/update a draft from the canonical report                        |
| `workflow_archive` | Explicitly archive after authoritative merge evidence                          |

## Eight durable stages

`intake` → `contracts` → `implementation` → `functional-review` / `design-review` → `report` → `publish` → `archive`.

The sequential durable spine remains intact. Non-UI work marks design review not applicable. Publish is draft-only; archive is an explicit post-merge action.

### Evidence path rules

Every entry in `artifactPaths` and every evidence path must be relative to the project root, portable across operating systems, and separated with `/`. Before accepting a file, the runtime rejects absolute paths, directory traversal, control characters, backslashes, and paths that look like secret values. Never put an actual token, password, secret, or credential **value** in a path. A descriptive filename such as `token-validation.json` is valid because it does not contain the value itself.

## Workload estimates and resuming

After intake, `workflow_status` reports an `XS`–`XL` workload, estimated token range, confidence and reasons, the 80% checkpoint, and authoritative `requiredValidations`. Contracts can refine that estimate with numeric `workloadSignals`; this does not add another tool or stage. At the first completed boundary at or above 80%, the SDK saves a checkpoint and starts a compact new thread from `resumeContext`. At the hard limit it returns `split-required` without reducing validation. If usage cannot be measured, the next action is blocked as `usage-unavailable` rather than treating usage as zero.

The default time budget is 10 minutes per action turn and 45 minutes for the full Run. When either deadline expires, the SDK cancels the active work and returns the existing thread and latest durable state; it never turns a validation pass into a timeout result or starts a new Run. Increase `--turn-timeout-seconds` or `--run-timeout-seconds` only with a reason, inspect `budget.elapsedMs`, `budget.actionTurns`, and `budget.formatTurn` to identify the wait, then resume the same Run.

## One implementation context

One implementation writer owns both API and UI work. Before final UI implementation, API-backed work submits distinct, non-empty types, schemas, wrappers, mocks, a passing contract-test JSON, and operation-aware `operations` under one `implementationContextId`. The final implementation uses the same ID and supplies exact `apiCoverage`.

Intake records timestamped local and remote `sourceProvenance` and the complete OpenAPI operation inventory. Figma and running-legacy baselines share `visualTargets`. Every actual capture repeats its target route/state/viewport/device scale/fixture and records the provider, ISO capture time, PNG path, and `sha256:` digest. Before `compare-visuals` runs, the runtime rejects changed comparison conditions, digest mismatches, and caller-provided scores; invalid acquisition consumes no attempt. It then computes exact and review ratios, diff, and overlay at the fixed 92% similarity threshold with no more than 20% justified masking. The initial comparison and at most two repairs run automatically. A third valid failure keeps the Run blocked, skips design review, and preserves equal-size baseline/current plus separate diff/overlay media in a diagnostic draft when publication preconditions allow. Focused UI assertions remain independent gates. Legacy contracts record stable keys as planned; final implementation replaces them with current-packet migrated or excluded coverage. Brief and feature API coverage must exactly match the OpenAPI operations recorded at intake. Legacy derives API candidates from an explicit, bounded list of source adapters. Existing candidates require complete API evidence; no candidates produce a `complete` API section tied to the adapter list and inventory digest. An ambiguous method or path is resolved only by one unique scoped runtime or OpenAPI match. Otherwise intake returns a durable blocker while preserving the Run ID. Reporting creates canonical 15-section `pr-report-v2.1` JSON and Markdown for both ready and blocked results. Historical v2.1 reports remain readable, while new publication requires current adapter and digest evidence.

Instruction precedence is current user request → explicit `guidancePaths` → automatically discovered guidance → available/applicable installed skill → SpecToPR defaults. Missing optional skills do not block.

Ambiguous legacy APIs resolve only from project-local bounded HAR/request JSON (up to 1 MB and 1,000 requests) or uniquely matching scoped OpenAPI. Runtime evidence digest and adapter are pinned into the inventory; `collect-legacy-network-evidence` accepts a `legacy-network-evidence` submission and resumes intake in the same Run.

## Delegation policy

`delegationPolicy` derives from workload: zero read-only scout workers for XS/S, at most one for M, and at most two for L/XL. Scouts only do bounded independent read-heavy discovery; they do not edit, browse, call workflow MCP, nest, or create parallel writers. Only the fully read-only, workflow-MCP-free `functional-reviewer` and UI-only `design-reviewer` may run in parallel after implementation from immutable packets.

To reduce elapsed time, the runtime does not parallelize generic helpers, repeated status polling, or duplicate validation. It parallelizes only independent non-overlapping read-only discovery within those workload caps, plus the two independent reviews after implementation from the same immutable packet. A reviewer timeout remains diagnostic; the runtime does not auto-create a replacement reviewer.

## Evidence by mode

| Mode      | Additional evidence                                                             |
| --------- | ------------------------------------------------------------------------------- |
| `brief`   | Full API/UI, Figma ratios, API gaps, and Web Vitals                             |
| `legacy`  | Separate-root migration, running-legacy comparison, and derived API gaps        |
| `feature` | Brief full delivery plus one targeted Playwright invocation and one valid video |
| `figma`   | Deterministic mock UI and measured host-connected Figma comparison              |

Only feature inherits targeted E2E/video. Any supplied `figmaUrl` requires one real `figma-bundle` regardless of mode.

## Choosing browser evidence

Playwright Test/CLI web-first assertions and structured results decide whether browser requirements pass. Browser MCP or a host browser is optional for reproducing and inspecting interactions. Chrome DevTools MCP is used only when console, network, performance, memory, or live-DOM diagnosis is needed. Screenshots, videos, traces, and agent observations do not replace assertions. If required proof cannot run, the Run is blocked as `BROWSER_NOT_RUN` with an exact recovery action.

## Ready and blocked publication

`workflow_publish intent: ready` creates or updates only a draft PR/MR from a passed canonical report. A blocker stores typed, redacted `blockerDetails`: stage, code, kind, retryable/resumable flags, completed work, evidence, attempted recovery, unrun validations, and the exact unblock action—never raw prompts, secrets, tokens, transcripts, or unrestricted private paths.

Ready and blocked publication use the same 15-section `pr-report-v2.1`. Every section is `complete`, `not-run`, `blocked`, or `not-applicable`, and stale evidence paths outside the current review packet are omitted. Ready sections expose sources, requirements, files, API, legacy, visuals, reviews, performance, feature evidence, risk, rollback, and evidence; blocked sections expose not-run status, stopped stage, and exact unblock action in the same shape.

GitHub evidence uses one managed `spec-to-pr/evidence` branch with immutable run/packet/target/artifact paths instead of creating a branch per Run. PR URLs are pinned to the upload commit SHA, so later uploads cannot rewrite earlier evidence links.

Legacy draft review material is kept under `.spec-to-pr/<feature>/` and the same change's `openspec/changes/<change-name>/`. The feature directory contains only `manifest.json`, `contracts/`, `evidence/`, `visual/`, and `report/`. The manifest is the contract-integrity authority for the current Run/revision, legacy-root digest, requirements, and OpenSpec file digests. Collapsed PR metadata shows only the Run, commit, and input digests needed to reproduce the review; the visible body leads with requirement status and side-by-side legacy/current screens. Raw HARs, cookies, tokens, complete logs, opaque feature keys, and repetitive lists of every implementation file stay out of the review surface.

When a GitLab project upload fails with 401/403/408/429, 5xx, or a transient network error, only legacy/current PNGs that are tracked regular files whose exact reviewed-commit blobs and clean-worktree files both match the captured SHA-256 may use raw URLs as a fallback. Synthetic diffs/overlays, video, missing/changed/digest-mismatched files never use this path; the original publication failure remains.

`workflow_publish intent: blocked-diagnostic` may create a diagnostic draft only when the tree is clean, source is non-target, the remote is supported/authenticated, a delta is committed, and source is at least one commit ahead. It remains `status: blocked`; it is evidence, not a passed report/publish verdict. Missing preconditions or `PUBLISH_NO_DELTA` return a **local blocked report** without an empty commit or issue fallback, and the same action does not loop on a precondition it cannot resolve.

If a durable concurrency claim expires or loses its heartbeat and the external mutation cannot be proven, the result is `reason: diagnostic-publication-uncertain` and publication does not retry automatically. `recoverUncertain: false` is the default. Only after the user inspects GitHub/GitLab for an existing matching source/target draft and gives explicit approval may the existing `workflow_publish` action be called with `recoverUncertain: true`. This optional recovery adds no tool or stage, leaves blocked stages blocked, and is never auto-approved by the SDK.

After recovery, continue the **same Run** from `resumeContext` without replaying stages that already passed. If a diagnostic draft exists, update the existing draft PR for the same source and target: replace its `[Blocked]` title and body with the normal ready content, then remove the blocked label. Ready, approval, and merge decisions remain with people.

<NextStep
eyebrow="Next concept"
title="The same packet produces two different review verdicts"
description="See why functional and design verdicts stay separate and what each agent may read, return, and never mutate."
href="/concepts/reviews"
label="Open agent reviews"
secondary={{ label: "Open visual verification", href: "/concepts/visual-verification" }}
/>
