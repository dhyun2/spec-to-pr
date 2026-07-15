---
name: publish
description: Use when the user explicitly requests creating or updating a draft review request for a publish-ready or blocked-diagnostic v2 Run.
---

# Publish

Call `workflow_status`. For normal delivery, require publish-ready status with no unresolved required gate and use `intent: ready`. A boundary stop such as `split-required` is not publish-ready and cannot waive review. For a currently blocked Run with requested draft publication, use `intent: blocked-diagnostic`; this preserves the blocker and may create or update a diagnostic draft without passing report or publish stages. A publish-precondition blocker remains local because the same precondition prevents a safe draft.

Verify the actual `sourceBranch` differs from `targetBranch` (normally `main`), the checked-out HEAD is the declared source branch and commit, every intended change is committed there, the working tree is clean, and the source is at least one commit ahead of the target. Do not include unrelated pre-existing changes. Then call `workflow_publish` with the current `runId`, selected `intent`, `mode` set to `execute`, those branch names, `pushBranch` set to `true` when the branch must be pushed, and `confirm` set to `true`. The generated report remains the review-request body; runtime preflight rejects a dirty tree, a branch/HEAD mismatch, or a source branch with no committed delta.

Verify the returned draft URL, body synchronization, visual-preview synchronization when applicable, and feature-video synchronization when required. The feature video is uploaded and linked only for a user-facing `feature` profile. Report blockers when publishing or any required synchronization fails. Publishing may push the source branch and create or update a draft review request; it never merges, approves, closes, or marks the request ready.

If blocked-diagnostic execution returns `reason: diagnostic-publication-uncertain`, stop: an expired or heartbeat-lost durable claim means the host mutation may have succeeded even though no result was recorded. `recoverUncertain` defaults to `false`; do not publish again automatically. Inspect GitHub/GitLab for an existing matching source/target draft, show the result to the user, and call the same `workflow_publish` action with `recoverUncertain: true` only after explicit user approval. This optional recovery adds no tool or stage, does not mark blocked report/publish stages passed, and is never auto-approved by the SDK.
