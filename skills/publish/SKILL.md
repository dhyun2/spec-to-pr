---
name: publish
description: Use when a v2 workflow is publish-ready and the user wants a draft pull or merge request created or updated.
---

# Publish

Call `workflow_status` and require publish-ready status with no unresolved required gate. A boundary stop such as `split-required` is not publish-ready and cannot waive review. Verify the actual `sourceBranch` differs from `targetBranch` (normally `main`), the checked-out HEAD is the declared source branch and commit, every intended change is committed there, the working tree is clean, and the source is at least one commit ahead of the target. Do not include unrelated pre-existing changes. Then call `workflow_publish` with the current `runId`, `mode` set to `execute`, those branch names, `pushBranch` set to `true` when the branch must be pushed, and `confirm` set to `true`. The generated report remains the review-request body; runtime preflight rejects a dirty tree, a branch/HEAD mismatch, or a source branch with no committed delta.

Verify the returned draft URL, body synchronization, visual-preview synchronization when applicable, and feature-video synchronization when required. The feature video is uploaded and linked only for a user-facing `feature` profile. Report blockers when publishing or any required synchronization fails. Publishing may push the source branch and create or update a draft review request; it never merges, approves, closes, or marks the request ready.
