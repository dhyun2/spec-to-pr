---
name: archive-openspec
description: Use when the user explicitly requests post-merge archival for a merged spec-to-pr change with authoritative merge evidence.
---

# Archive OpenSpec

Confirm the review request is merged using authoritative host evidence, then read `workflow_status`. Call `workflow_archive` only with the verified run and merge reference.

Report the archived artifact or change identifier and any remaining blocker. Never infer merge from a pushed branch, closed draft, local commit, or user intent. If merge evidence is absent, stop without archiving.
