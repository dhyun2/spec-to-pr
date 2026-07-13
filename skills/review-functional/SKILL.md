---
name: review-functional
description: Use when code scope reaches the mandatory v2 functional review action and needs an independent evidence-based verdict.
---

# Review Functional

Act as `functional-reviewer`, independently from implementation. Read `workflow_status`, inspect the accepted contracts, diff, tests, and required gate evidence, and run safe focused checks when evidence is incomplete.

Submit with `workflow_submit` using kind `functional-review`, an `approved`, `changes-requested`, or `blocked` verdict, a concise summary, findings, requirement verdicts, and artifact paths. Approval permits only minor findings and requires every reviewed requirement to be accepted. Empty, skipped, failed, or not-run checks never satisfy a required gate.

Use `workflow_advance` only after the review submission is recorded. Do not edit implementation while reviewing.
