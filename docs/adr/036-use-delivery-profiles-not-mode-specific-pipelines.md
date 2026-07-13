# ADR 036: Use Delivery Profiles, Not Mode-Specific Pipelines

- Status: Accepted
- Date: 2026-07-13

## Context

SpecToPR must accept four practical entry modes:

- a supplied brief/spec and target repository;
- a legacy repository plus a concrete requested change;
- a user-facing feature that needs focused interaction proof;
- a Figma URL and target repository.

Four independent pipelines would duplicate agents, stages, tools, and policies. It would also make feature-only evidence expensive by accidentally applying it to every repository change.

## Decision

`workflow_start` records one delivery profile on the existing Run. A profile contains `mode`, `changeKind`, publication intent, supplied source references, and derived evidence requirements. The modes are `auto`, `brief`, `legacy`, `feature`, and `figma`; all use the same seven public tools, eight durable stages, nine skills, and two reviewers defined by ADR 035.

Mode policies are:

| Mode      | Required input                         | Extra evidence                                                         | Default boundary                                               |
| --------- | -------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| `brief`   | `briefPath` and target repository      | acceptance criteria and contract artifacts                             | draft PR/MR by default unless publication is explicitly `none` |
| `legacy`  | concrete change request and repository | focused current-behavior baseline for the requested delta              | draft PR/MR by default; affected checks, not full inventory    |
| `feature` | user-facing feature request            | one changed-feature E2E result and exactly one `.webm` or `.mp4` video | draft PR/MR by default with the video linked                   |
| `figma`   | `figmaUrl` and target repository       | one real `figma-bundle`                                                | design implementation; draft publication only when requested   |

Feature evidence is required only when the `feature` profile is user-facing/UI-scoped. The test command must be one unchained Playwright invocation that selects the changed feature by path, tag, or project; list-only and pass-with-no-tests options are rejected. Its strict project-local JSON result contains only `status: passed`, the exact selector, the implementation submission's `implementationContextId`, and a positive `testCount`; the single declared video must be a structurally valid WebM or MP4 container with non-zero duration and no larger than 25 MB. A full-project E2E run is never accepted as feature evidence.

Figma intake uses the host's connected Figma capability. The host captures real node, screenshot, variable, asset, and component context when available, writes project-local evidence, then submits exactly one typed `figma-bundle` through `workflow_submit`. The bundle declares `provider: host-connected-figma`, ISO `capturedAt`, a matching `fileUrl`, nonempty `nodeIds`, a JSON `manifestPath`, and one or more actual PNG artifacts. The strict manifest repeats the provenance and exactly lists the PNG `visualPaths`. SpecToPR does not add Figma-specific runtime microtools, accept repeated bundles, or poll Figma.

API and UI stay in one implementation context with an explicit evidence-backed `api-ready` submission before API-backed UI completion. Its categories use distinct physical non-empty files—path, symlink, and hard-link aliases are rejected—the contract-test result reports `status: passed`, and a stable `implementationContextId` must match final implementation. Functional review and conditional design review remain independent. The orchestrator freezes a `workflow_status` review packet for each reviewer; reviewers return schema-shaped verdicts without calling workflow tools. Any publication is draft-only and requires a non-target source branch, a clean tree, and at least one committed source delta beyond the target.

## Consequences

- A new entry mode is a small policy/profile change, not a new pipeline.
- Evidence cost stays proportional to the requested change.
- Legacy validation stays focused on the requested behavior.
- Feature video is useful without making every change run E2E.
- Figma provider details remain outside the runtime facade.
- Missing mode-specific evidence blocks deterministically instead of being inferred or silently skipped.
