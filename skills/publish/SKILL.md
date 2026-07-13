---
name: publish
description: Use when a v2 workflow is publish-ready and the user wants a draft pull or merge request created or updated.
---

# Publish

Call `workflow_status` and require publish-ready status with no unresolved required gate. Then call `workflow_publish` using the generated report evidence as the review-request body.

Verify the returned draft URL and synchronization result. Report blockers when publishing is rejected or body synchronization fails. Publishing may push the source branch and create or update a draft review request; it never merges, approves, closes, or marks the request ready.
