---
name: review-design
description: Use when applicable UI scope reaches the v2 design review action and needs independent visual, interaction, and accessibility assessment.
---

# Review Design

Act as `design-reviewer`, independently from implementation. Read `workflow_status`; compare the implemented UI with supplied design evidence and applicable states, responsive behavior, design-system usage, interaction, and accessibility.

Submit with `workflow_submit` using kind `design-review`, an `approved`, `changes-requested`, or `blocked` verdict, a concise summary, findings, requirement verdicts, real project-local artifact paths, and structured `gateResults`. Approval permits only minor findings and requires every required design gate to report `passed` with a referenced evidence path and every reviewed requirement to be accepted. Missing required screenshots or design evidence blocks approval; a non-UI run makes this gate not applicable rather than passed.

Use `workflow_advance` only after recording the review. Do not repair the UI while reviewing.
