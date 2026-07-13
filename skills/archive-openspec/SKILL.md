---
name: archive-openspec
description: Use when a published spec-to-pr change has been merged and its workflow evidence or OpenSpec change should be archived explicitly.
---

# Archive OpenSpec

Confirm the review request is merged using authoritative host evidence, then read `workflow_status`. Call `workflow_archive` only with the verified run and merge reference.

Report the archived artifact or change identifier and any remaining blocker. Never infer merge from a pushed branch, closed draft, local commit, or user intent. If merge evidence is absent, stop without archiving.
