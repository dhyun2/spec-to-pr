# ADR 036: Use Delivery Profiles, Not Mode-Specific Pipelines

- Status: Accepted
- Date: 2026-07-13

## Context

SpecToPR must accept four practical entry modes:

- a brief/spec, Figma design, OpenAPI contract, and target repository;
- a separate legacy project migrated into a target repository;
- a user-facing feature that needs full-delivery plus focused interaction proof;
- a Figma URL and target repository.

Four independent pipelines would duplicate agents, stages, tools, and policies. It would also make feature-only evidence expensive by accidentally applying it to every repository change.

## Decision

`workflow_start` records one delivery profile on the existing Run. A profile contains `mode`, `changeKind`, publication intent, supplied source references, and derived evidence requirements. The modes are `auto`, `brief`, `legacy`, `feature`, and `figma`; all use the same seven public tools, eight durable stages, eight public marketplace skills, and two reviewers defined by ADR 035. Release maintenance remains outside the public user workflow.

Mode policies are:

| Mode      | Required input                        | Extra evidence                                                      | Default boundary                    |
| --------- | ------------------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| `brief`   | brief + Figma + local/URL OpenAPI     | API/UI, visual ratios/assets, API gaps, performance                 | draft PR/MR by default              |
| `legacy`  | target + separate `legacyProjectRoot` | inventory/coverage, running legacy comparison, API/performance gaps | migration draft PR/MR by default    |
| `feature` | same full inputs for one feature      | full brief evidence + one changed-feature E2E and exactly one video | video-linked draft PR/MR by default |
| `figma`   | `figmaUrl` and target repository      | deterministic mock UI and measured Figma comparison                 | design draft PR/MR by default       |

Feature evidence is required only when the `feature` profile is user-facing/UI-scoped. The test command must be one unchained Playwright invocation that selects the changed feature by path, tag, or project; list-only and pass-with-no-tests options are rejected. Its strict project-local JSON result contains only `status: passed`, the exact selector, the implementation submission's `implementationContextId`, and a positive `testCount`; the single declared video must be a structurally valid WebM or MP4 container with non-zero duration and no larger than 25 MB. A full-project E2E run is never accepted as feature evidence.

Figma intake uses the host's connected Figma capability. The host captures real node, screenshot, variable, asset, and component context when available, writes project-local evidence, then submits exactly one typed `figma-bundle` through `workflow_submit`. The bundle declares `provider: host-connected-figma`, ISO `capturedAt`, a matching `fileUrl`, nonempty `nodeIds`, a JSON `manifestPath`, and one or more actual PNG artifacts. The strict manifest repeats the provenance and exactly lists the PNG `visualPaths`. SpecToPR does not add Figma-specific runtime microtools, accept repeated bundles, or poll Figma.

API and UI stay in one implementation context with an explicit evidence-backed `api-ready` submission before API-backed UI completion. Its categories use distinct physical non-empty files—path, symlink, and hard-link aliases are rejected—the contract-test result reports `status: passed`, and a stable `implementationContextId` must match final implementation. Functional review and conditional design review remain independent. The orchestrator freezes a `workflow_status` review packet for each reviewer; reviewers return schema-shaped verdicts without calling workflow tools. Any publication is draft-only and requires a non-target source branch, a clean tree, and at least one committed source delta beyond the target.

Intake pins timestamps, local/remote raw digests, resolved locators, and applicable API inventories. Figma and running-legacy screenshots share one `visualTargets` manifest; `compare-visuals` accepts paths rather than caller scores, and runtime computes alpha-aware exact/review ratios, diff, and overlay at a minimum 98%, rejects masks above 20%, and permits three total comparison attempts (the initial comparison plus at most two repairs). Legacy intake creates bounded stable-key `legacyInventory` and derives API candidates without requiring OpenAPI; optional OpenAPI enriches the inventory. A zero-operation legacy inventory still renders a complete API section. API-ready/final `apiCoverage` exactly match applicable candidate operations. Figma-only requires digest-bound deterministic JSON fixtures. Canonical JSON and Markdown `pr-report-v2.1` use the same 15 sections with explicit section status and only bind current packet evidence.

## Consequences

- A new entry mode is a small policy/profile change, not a new pipeline.
- Evidence cost stays proportional: only feature adds targeted E2E/video, while Figma avoids real API/performance work.
- Legacy migration inventories only bounded relevant source and never edits the legacy project.
- Feature video is useful without making every change run E2E.
- Figma provider details remain outside the runtime facade.
- Missing mode-specific evidence blocks deterministically instead of being inferred or silently skipped.
