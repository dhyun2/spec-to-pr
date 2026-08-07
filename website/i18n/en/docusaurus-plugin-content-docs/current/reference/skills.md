---
sidebar_position: 1
title: Eight public skills
---

# Skills reference

The current repository exposes exactly **8 public marketplace skills**. Release maintenance is a maintainer concern outside the public marketplace workflow and is not counted in a user Run.

| Public skill                                          | Use                                 | Boundary                                                |
| ----------------------------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `/spec-to-pr` (`spec-to-pr`)                          | Run the workflow                    | One delivery profile and only seven public tools        |
| `/spec-to-pr:doctor` (`doctor`)                       | Diagnose installation/contracts     | `workflow_info` must match the v2 surface               |
| `/spec-to-pr:intake-contracts` (`intake-contracts`)   | Prepare sources/contracts           | Real evidence and `workloadSignals` refine the estimate |
| `/spec-to-pr:implement` (`implement`)                 | Implement accepted contracts        | One API/UI context; required checks remain required     |
| `/spec-to-pr:review-functional` (`review-functional`) | Independent code-scope review       | Requirements and required functional gates              |
| `/spec-to-pr:review-design` (`review-design`)         | Independent UI review               | Visual/interaction/design-system/accessibility evidence |
| `/spec-to-pr:publish` (`publish`)                     | Publish a ready or diagnostic draft | Draft PR/MR and required asset sync only                |
| `/spec-to-pr:archive-openspec` (`archive-openspec`)   | Archive after merge                 | Authoritative merge evidence and a separate request     |

## Mode routing

Mode selects delivery/evidence policy. `brief` is brief/Figma/OpenAPI delivery; `legacy` migrates from a separate `legacyProjectRoot`; `feature` adds changed-feature Playwright E2E and one video; `figma` is mock-backed Figma implementation. All default to draft. `sourceProvenance`, `visualTargets`, `compare-visuals`, `legacyInventory`, `apiCoverage`, and `performanceEvidence` remain typed contracts; the machine report feeds one of four reviewer-first PR templates rather than exposing an internal report schema.

## Deterministic recommendations and applied trace

Contracts derive optional `recommendedSkills` deterministically from sources and scope: `figmaUrl` → `figma`/`design-system`, `openApiPaths`/`openApiUrls` → `api-generator`, detected React/Next packages → `react-best-practices`/`next-best-practices`, and `mode: feature` + UI → `playwright`.

`intake-contracts`, `implement`, `review-functional`, `review-design`, `publish`, and `archive-openspec` are the public `stageSkillRoute` for durable actions. That action routing is not `deliveryProfile.recommendedSkills` or an optional applied-skill candidate.

`appliedSkills` records only skills that are **available and applicable**, were actually used, and belong to the allowed union of:

1. SpecToPR's `recommendedSkills`;
2. installed skills requested through `skillHints`.

Missing optional skills do not block the Run. Omit an unavailable hint from `appliedSkills`, but preserve project guidance and every `requiredValidation`. Never report an unapplied skill or read skill content from an arbitrary path.

## Project guidance precedence

`intake-contracts` records explicit/discovered guidance in `guidanceTrace` and excludes it from scope classification. Precedence is current user request → explicit `guidancePaths` → automatically discovered project guidance → applicable installed skill → SpecToPR defaults. Project guidance outranks generic skill advice.

## Reviewers are not skills

`review-functional` and `review-design` are workflow instructions; the independent roles are `functional-reviewer` and `design-reviewer`. Both profiles are workflow-MCP-free and fully read-only. They return verdicts from immutable status/contracts/diff/evidence packets and never edit implementation or call `workflow_*`. Design review is UI-only.

## Keeping a Run fast

`implement` keeps one implementation context. UI/feature browser evidence is collected through one `capture-session-v1`; a result may be reused in the same Run only when its `evidence-fingerprint-v1` dependency inputs still match. The runtime does not parallelize repeated status polling or duplicate tests. For every UI packet, both reviewers assess the same immutable packet concurrently after implementation, and the packet inbox applies their result together.

Coordination, status, and publication use `medium` reasoning on the selected model. Implementation and functional/design review use `high` reasoning on that same model and conversation; the routing changes neither writer ownership nor reviewer permissions.

The default time budget is 10 minutes per action turn and 45 minutes for the full Run. A timeout is a resumable diagnostic, not a pass: the active work is cancelled and the same thread/latest durable state is returned. Inspect `budget.elapsedMs`, `budget.actionTurns`, and `budget.formatTurn`, then change `--turn-timeout-seconds` or `--run-timeout-seconds` only when justified and resume the same Run. A reviewer timeout never auto-creates a replacement reviewer.

## Visual feedback loop

`implement` runs the initial comparison and up to two repairs automatically at the fixed 92% threshold without asking the user. Acquisition with invalid geometry, fixture, or renderer lineage consumes no attempt. A third valid failure stops automatic repair and preserves equal-size baseline/current media plus separate diff/overlay links as a visual-comparison Gap. Functional and design reviewers independently record the available evidence; failed, not-run, `skipped`, and `waived` evidence is never passed. A publishable Draft puts the reviewer decision, Gap impact, and comparison outcome first and is never labelled verified or merge-ready on that evidence.

## Public-tool and browser boundaries

Only `workflow_info`, `workflow_start`, `workflow_advance`, `workflow_submit`, `workflow_status`, `workflow_publish`, and `workflow_archive` mutate durable state. API-ready uses the same `workflow_submit`; it adds no tool or stage.

Playwright Test/CLI assertions and structured results are the browser acceptance oracle. Browser MCP is optional interactive reproduction/inspection. Chrome DevTools MCP is conditional for console/network/performance/memory/live-DOM diagnosis. Screenshots, video, traces, and agent observation never replace assertions; unavailable required browser proof blocks as `BROWSER_NOT_RUN`. Only feature requires changed-feature E2E and exactly one video.

## Uncertain diagnostic-publication recovery

The `publish` skill never auto-retries `diagnostic-publication-uncertain`. `recoverUncertain: false` is the default. First inspect GitHub/GitLab for a matching draft and show the result to the user; only explicit approval permits calling the same `workflow_publish` action with `recoverUncertain: true`. The option stays inside the existing publish tool/stage, leaves blocked state blocked, and the SDK never auto-approves it.
