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

## 1.0 rules

- Every UI scope runs every declared route/state/viewport comparison target, regardless of mode.
- API, binding, authentication, and evidence-analysis failures do not stop confirmed work. Only an unsafe write stops the Run; everything else remains an open Gap.
- `skipped` and `waived` are not passed. A Draft may carry Gaps or failed/not-run evidence, but it can never be labelled verified or merge-ready.
- Exact `legacyProjectRoot` and `targetPaths` are used without similar-path inference. OpenSpec is an optional post-merge adapter, never a core prerequisite.

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

One implementation writer owns both API and UI work. Confirmed APIs are validated in that same context. If a method, body, or authentication boundary is uncertain, the interaction is kept safe and disclosed as a Gap instead of inventing a write; that analysis failure does not stop confirmed UI, state, or route work.

## Collect browser proof once

For a UI or `feature` candidate, `capture-session-v1` binds changed-feature E2E, exactly one feature video, actual visual captures, and applicable performance output to at most one Playwright Test/CLI invocation. Its manifest pins candidate base/head/diff digests, selectors, environment, and output digests. `compare-visuals` later materializes verified current-packet receipts from that capture; it does not launch another browser run.

Within the same Run, `evidence-fingerprint-v1` may carry forward evidence only when its dependency inputs, selector, toolchain, fixture, import closure, and result digest still match. A new requirement or source diff still creates a new review packet. Reuse never waives a gate or copies old evidence across Runs.

Intake records timestamped local and remote `sourceProvenance` and the confirmed OpenAPI operation inventory. Any UI work, regardless of mode, fixes Figma or running-legacy baselines in `visualTargets`. Every actual capture repeats its target route/state/viewport/device scale/fixture and records the provider, ISO capture time, PNG path, and `sha256:` digest. Before `compare-visuals` runs, the runtime rejects changed comparison conditions, digest mismatches, and caller-provided scores; invalid acquisition consumes no attempt. It then computes exact and review ratios, diff, and overlay at the fixed 92% similarity threshold with no more than 20% justified masking. The initial comparison and at most two repairs run automatically. A third valid failure stops automatic repair and preserves equal-size baseline/current plus separate diff/overlay media as a visual-comparison Gap. Focused UI assertions remain independent gates, and failed, not-run, skipped, or waived evidence is never passed. Legacy contracts record stable keys as planned; final implementation replaces them with current-packet migrated or excluded coverage. Legacy reads only the user-supplied `legacyProjectRoot` and `targetPaths`; it never infers similarly named paths. An uncertain API method, route, body, auth boundary, binding, or evidence record becomes an open Gap rather than blocking safe UI, route, state, and read-only work. The machine-readable `pr-report-v2.1` remains an evidence artifact, while publication selects one of four reviewer-first templates.

Instruction precedence is current user request → explicit `guidancePaths` → automatically discovered guidance → available/applicable installed skill → SpecToPR defaults. Missing optional skills do not block.

Project-local bounded HAR/request JSON or scoped OpenAPI can resolve an ambiguous legacy API Gap in the same Run. Their runtime digest and adapter are pinned into the inventory, but neither OpenSpec nor extra evidence is a prerequisite for starting a core Run.

## Delegation policy

`delegationPolicy` derives from workload: zero read-only scout workers for XS/S, at most one for M, and at most two for L/XL. Scouts only do bounded independent read-heavy discovery; they do not edit, browse, call workflow MCP, nest, or create parallel writers. For every UI packet, the fully read-only, workflow-MCP-free `functional-reviewer` and UI-only `design-reviewer` start in parallel from the same immutable packet. Their packet-scoped inbox preserves both verdicts before the runtime applies one outcome.

To reduce elapsed time, the runtime does not parallelize generic helpers, repeated status polling, or duplicate validation. It parallelizes only independent non-overlapping read-only discovery within those workload caps, plus the two independent UI reviews after implementation from the same immutable packet. A reviewer timeout remains diagnostic; the runtime does not auto-create a replacement reviewer. Coordination, status, and publication boundaries use `medium` reasoning on the selected model; implementation and the two review boundaries use `high` reasoning in the same conversation.

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

The machine report preserves evidence, but the PR body is one of four reviewer-first templates: Legacy migration (source→target, scope, legacy visual comparison, API Gaps), Brief delivery (requirements coverage, exclusions, visual comparison), Feature flow (before/after behavior, regression proof, required user-flow video, visual comparison), or Figma UI (state mapping, per-state ratios, design and accessibility validation). Every Gap appears at the top with impact and reviewer decision; raw logs, Run IDs, and empty checklists stay out of the default body.

GitHub evidence uses one managed `spec-to-pr/evidence` branch with immutable run/packet/target/artifact paths instead of creating a branch per Run. PR URLs are pinned to the upload commit SHA, so later uploads cannot rewrite earlier evidence links.

Legacy core review material is kept under `.spec-to-pr/<feature>/`. OpenSpec is an optional post-merge change record, not a prerequisite for a core Run or Draft PR. Raw HARs, cookies, tokens, complete logs, internal Run IDs, opaque feature keys, and repetitive lists of every implementation file stay out of the review body.

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
