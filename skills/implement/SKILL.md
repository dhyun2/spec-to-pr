---
name: implement
description: Use when a v2 workflow requests implementation of code, API-backed UI, tests, mocks, or repository changes from accepted contracts.
---

# Implement

Use one implementation context for API and UI; do not split them into separate agents or worktrees.

1. Read `workflow_status` and confirm the `implement` action from `workflow_advance`.
2. For API scope, implement and verify types, schemas, generated clients or wrappers, mocks, and contract tests from documented evidence.
3. Record that evidence as the `api-ready` checkpoint before UI implementation and before UI evidence submission.
4. Implement UI against those wrappers and mocks, then run applicable checks.
5. Call `workflow_submit` once with an `implementation` result: status, summary, `apiReady`, `uiChanged`, changed files, and artifact paths.

A passed UI result requires `apiReady: true`. Missing, empty, skipped, or failed contract evidence blocks submission. Do not invent endpoints or report checks that did not run.
