---
name: spec-to-pr
description: Use when orchestrating an evidence-driven v2 Run across its stage-specific external actions.
---

# Spec to PR

Use the v2 facade as the sole workflow authority:

1. Call `workflow_info` and require contract version `2.0.0`.
2. Choose one delivery profile. Delivery mode controls delivery and evidence; sources compose independently. Call `workflow_start` with `projectRoot`, `requestText`, `scope`, `mode`, `changeKind`, `publication`, and any supplied `briefPath`, `figmaUrl`, `docsPaths`, `openApiPaths`, `guidancePaths`, or `skillHints`. Set `scope` to exactly one of `auto | ui | non-ui | docs`; never send a natural-language label. Set `scope: ui` for `feature` and `figma`:
   - `brief`: require `briefPath`; default `changeKind: feature` and `publication: draft`.
   - `legacy`: require a concrete change request; use the actual change kind, commonly `fix`, and default `publication: draft`.
   - `feature`: use for zero-to-100 user-facing UI delivery; set `changeKind: feature` and default `publication: draft`, even when the sources include a brief, Figma, OpenAPI, and supporting documents.
   - `figma`: require `figmaUrl`, set `changeKind: design`, and capture real Figma evidence before contracts. Figma defaults to `publication: none` unless the user requests a draft.
   - `auto`: preserve the lightweight v2 behavior when no mode was selected.
   - Any supplied `figmaUrl` requires a real `figma-bundle` before contracts, including in `feature` mode.
3. When `publication: draft`, inspect repository state before implementation. Work on an actual non-target `codex/<short-slug>` source branch; do not implement directly on the target branch or absorb unrelated dirty changes.
4. Call `workflow_advance` until it returns an external action.
5. Perform that action with the matching skill, then record its compact evidence with `workflow_submit`. For review actions, the orchestrator first calls `workflow_status`, freezes a review packet containing its `reviewPacketId`, Run/revision, base/head, binary diff digest, accepted contracts, and evidence paths, and passes the packet to the applicable independent reviewer. Reviewers do not call workflow tools; they copy the current `reviewPacketId` into literal schema-shaped submission objects for the orchestrator to validate and submit. A changes-requested verdict reopens implementation and invalidates reviews/report derived from that packet.
6. Read `workflow_status`; repeat advance, action, and submission while required gates remain.
7. Before publication, stage only intended files, commit all intended implementation and evidence changes on the source branch, and require a clean working tree with at least one commit beyond the target branch.
8. Call `workflow_publish` only when `publication: draft` was requested and status is publish-ready. Publishing is draft-only.
9. Call `workflow_archive` only after the merged review request is explicitly verified.

Immediately after start, report the `workflow_status.workload` size (`XS`–`XL`), token range, and confidence. Treat it as a range, not a promise, and preserve the complete `requiredValidations` list from status. When the SDK reports the 80% boundary, finish the current action group and continue from the compact fresh-thread checkpoint using `resumeContext.goal`, its project-relative evidence paths, and submission summaries. On `--resume`, call `workflow_status` for the existing run ID first; never repeat intake or create a duplicate Run. At the automatic hard limit, do not begin another action: keep that list unchanged and return `split-required` for independently verifiable scope slices. If SDK usage is unavailable, stop before another nonterminal action instead of assuming zero.

Keep API and UI work in one implementation context. The `api-ready` checkpoint must precede UI evidence submission. Use only `functional-reviewer`, plus `design-reviewer` when UI scope applies; these independent reviews may run in parallel after implementation. Never merge, approve, waive missing required evidence, treat skipped work as passed, or remove verification because the runtime reached an automatic boundary.

Route stage work to the matching public skill; do not use the umbrella skill as a substitute for stage-specific instructions. Keep `deliveryProfile.recommendedSkills` and user `skillHints` optional, apply only installed and applicable candidates, and record only skills actually applied. Reviewers remain read-only and never call the workflow MCP.

Before every `workflow_submit`, require each `artifactPaths` or evidence-path entry to be a portable project-relative, `/`-separated safe name. Reject absolute, traversal, control-character, backslash/non-portable, or secret-shaped paths, and never embed token, password, secret, or credential values. A descriptive filename such as `token-validation.json` remains valid because it names evidence rather than containing a secret value.
