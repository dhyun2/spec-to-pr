---
sidebar_position: 1
title: How a Run moves
hide_title: true
---

import GuideHero from "@site/src/components/guide/GuideHero";
import RunPipeline from "@site/src/components/guide/RunPipeline";
import NextStep from "@site/src/components/guide/NextStep";

<GuideHero
eyebrow="One Run · eight durable stages"
title="How a Run moves"
summary="Follow one change from the incoming request through state, evidence, authority boundaries, a draft PR, and explicit post-merge archive."
primary={{ label: "See review ownership", href: "/concepts/reviews" }}
secondary={{ label: "Choose my case", href: "/usage/" }}
/>

Four delivery modes share one Run and one pipeline. Delivery mode controls delivery and evidence; input sources compose independently. Project guidance is traceable but excluded from scope classification.

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

### Artifact-evidence path contract

Every `artifactPaths` and artifact-evidence path must be a portable project-relative, `/`-separated safe name rooted at the project. Before ingestion, the runtime rejects absolute, traversal, control-character, backslash-containing non-portable paths and secret-shaped paths. Never place token/password/secret/credential **values** in a path. A descriptive name such as `token-validation.json` remains valid because it does not contain an actual secret value.

## Workload and resume boundary

After intake, `workflow_status` reports `XS`–`XL`, an estimated token range/confidence/reasons, the 80% checkpoint, and authoritative `requiredValidations`. Contracts may refine the same estimate with numeric `workloadSignals`; this adds no tool or stage. The SDK checkpoints at the first completed boundary at or above 80%, starts a compact fresh thread from `resumeContext`, and returns `split-required` at the hard limit without shrinking validation. Missing usage blocks as `usage-unavailable`.

## One implementation context

One implementation writer owns API and UI. API-backed UI first submits physically distinct non-empty types, schemas, wrappers, mocks, a passing contract-test JSON, and operation-aware `operations` with one `implementationContextId`; final implementation repeats that ID and supplies exact `apiCoverage`.

Intake pins timestamped local/remote `sourceProvenance` and the complete OpenAPI operation inventory. Figma and running-legacy baselines share `visualTargets`. Every actual capture repeats its target route/state/viewport/device scale/fixture and records provider, ISO capture time, PNG path, and `sha256:` digest. Runtime rejects target drift, digest mismatch, and caller scores before `compare-visuals` computes exact/review ratios, diff, and overlay at a minimum 98%, with at most 20% justified masking and three total comparison attempts (the initial comparison plus at most two repairs). Legacy contracts plan stable keys and final implementation replaces them with current-packet migrated/excluded coverage. Brief/feature API coverage must exactly match intake OpenAPI operations. Legacy derives API candidates through its explicit bounded source-adapter list: candidates require the same complete API evidence, zero candidates produce a `complete` API section bound to that list and the inventory digest, and ambiguous methods/paths resolve only from a unique scoped runtime/OpenAPI match. Otherwise intake returns a durable blocker with the Run ID. Report creates canonical 15-section `pr-report-v2.1` JSON and Markdown for ready and blocked results; historical v2.1 remains readable while new publication requires current adapter/digest evidence.

Instruction precedence is current user request → explicit `guidancePaths` → automatically discovered guidance → available/applicable installed skill → SpecToPR defaults. Missing optional skills do not block.

Ambiguous legacy APIs resolve only from project-local bounded HAR/request JSON (up to 1 MB and 1,000 requests) or uniquely matching scoped OpenAPI. Runtime evidence digest and adapter are pinned into the inventory; `collect-legacy-network-evidence` accepts a `legacy-network-evidence` submission and resumes intake in the same Run.

## Delegation policy

`delegationPolicy` derives from workload: zero read-only scout workers for XS/S, at most one for M, and at most two for L/XL. Scouts only do bounded independent read-heavy discovery; they do not edit, browse, call workflow MCP, nest, or create parallel writers. Only the fully read-only, workflow-MCP-free `functional-reviewer` and UI-only `design-reviewer` may run in parallel after implementation from immutable packets.

## Mode evidence

| Mode      | Additional evidence                                                             |
| --------- | ------------------------------------------------------------------------------- |
| `brief`   | Full API/UI, Figma ratios, API gaps, and Web Vitals                             |
| `legacy`  | Separate-root migration, running-legacy comparison, and derived API gaps        |
| `feature` | Brief full delivery plus one targeted Playwright invocation and one valid video |
| `figma`   | Deterministic mock UI and measured host-connected Figma comparison              |

Only feature inherits targeted E2E/video. Any supplied `figmaUrl` requires one real `figma-bundle` regardless of mode.

## Browser evidence routing

Playwright Test/CLI web-first assertions and structured results are the browser acceptance oracle. Browser MCP or a host browser is optional for interactive reproduction/inspection. Chrome DevTools MCP is conditional diagnosis for console, network, performance, memory, or live DOM. Screenshots, videos, traces, and agent observation do not replace assertions. Required proof not run blocks as `BROWSER_NOT_RUN` with an exact unblock action.

## Ready and blocked publication

`workflow_publish intent: ready` creates or updates only a draft PR/MR from a passed canonical report. A blocker stores typed, redacted `blockerDetails`: stage, code, kind, retryable/resumable flags, completed work, evidence, attempted recovery, unrun validations, and the exact unblock action—never raw prompts, secrets, tokens, transcripts, or unrestricted private paths.

Ready and blocked publication use the same 15-section `pr-report-v2.1`. Every section is `complete`, `not-run`, `blocked`, or `not-applicable`, and stale evidence paths outside the current review packet are omitted. Ready sections expose sources, requirements, files, API, legacy, visuals, reviews, performance, feature evidence, risk, rollback, and evidence; blocked sections expose not-run status, stopped stage, and exact unblock action in the same shape.

GitHub evidence uses one managed `spec-to-pr/evidence` branch with immutable run/packet/target/artifact paths instead of creating a branch per Run. PR URLs are pinned to the upload commit SHA, so later uploads cannot rewrite earlier evidence links.

`workflow_publish intent: blocked-diagnostic` may create a diagnostic draft only when the tree is clean, source is non-target, the remote is supported/authenticated, a delta is committed, and source is at least one commit ahead. It remains `status: blocked`; it is evidence, not a passed report/publish verdict. Missing preconditions or `PUBLISH_NO_DELTA` return a **local blocked report** without an empty commit or issue fallback, and the same action does not loop on a precondition it cannot resolve.

If a durable concurrency claim expires or loses its heartbeat and the external mutation cannot be proven, the result is `reason: diagnostic-publication-uncertain` and publication does not retry automatically. `recoverUncertain: false` is the default. Only after the user inspects GitHub/GitLab for an existing matching source/target draft and gives explicit approval may the existing `workflow_publish` action be called with `recoverUncertain: true`. This optional recovery adds no tool or stage, leaves blocked stages blocked, and is never auto-approved by the SDK.

After recovery, continue the **same Run** from `resumeContext` without replaying passed stages. If a diagnostic draft exists, update the same source/target **same draft PR** from `[Blocked]` to its normal ready title/body and remove the blocked label. Humans retain ready/approve/merge authority.

<NextStep
eyebrow="Next concept"
title="The same packet produces two different review verdicts"
description="See why functional and design verdicts stay separate and what each agent may read, return, and never mutate."
href="/concepts/reviews"
label="Open agent reviews"
secondary={{ label: "Open visual verification", href: "/concepts/visual-verification" }}
/>
