---
name: spec-to-pr
description: Use when running an evidence-driven implementation from intake through a draft review request or explicit post-merge archive.
---

# Spec to PR

Use the v2 facade as the sole workflow authority:

1. Call `workflow_info` and require contract version `2.0.0`.
2. Call `workflow_start` with the project root, original request, and explicit scope when known.
3. Call `workflow_advance` until it returns an external action.
4. Perform that action with the matching skill, then record its compact evidence with `workflow_submit`.
5. Read `workflow_status`; repeat advance, action, and submission while required gates remain.
6. Call `workflow_publish` only when status is publish-ready. Publishing is draft-only.
7. Call `workflow_archive` only after the merged review request is explicitly verified.

Keep API and UI work in one implementation context. The `api-ready` checkpoint must precede UI evidence submission. Use only `functional-reviewer`, plus `design-reviewer` when UI scope applies. Never merge, approve, waive missing required evidence, or treat skipped work as passed.
