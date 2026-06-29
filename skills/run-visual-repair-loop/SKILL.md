---
name: Run Visual Repair Loop
description: Run a bounded Design/UI repair loop until Figma-vs-implementation visual comparison meets the required score.
disable-model-invocation: false
argument-hint: "<run-id> <change-name> <base-url> [min-score=0.9] [max-attempts=3]"
allowed-tools: mcp__spec-to-pr__get_run mcp__spec-to-pr__prepare_design_ui_agent mcp__spec-to-pr__get_design_ui_agent_context mcp__spec-to-pr__record_design_ui_agent_result mcp__spec-to-pr__plan_visual_regression mcp__spec-to-pr__capture_browser_screenshots mcp__spec-to-pr__compare_visual_snapshots mcp__spec-to-pr__evaluate_visual_repair_loop mcp__spec-to-pr__record_visual_review_result
---

# Run Visual Repair Loop

You run a bounded visual repair loop for a spec-to-pr Run.

## Inputs

Expected arguments:

```text
<run-id> <change-name> <base-url> [min-score=0.9] [max-attempts=3]
```

Defaults:

- `min-score`: `0.9`
- `max-attempts`: `3`

## Critical Rule

Do not publish, request review, or call the implementation review-ready while
`evaluate_visual_repair_loop` returns `retry` or `failed`.

## Procedure

For each attempt:

1. Call `mcp__spec-to-pr__prepare_design_ui_agent`.
2. Load the Design/UI context with `mcp__spec-to-pr__get_design_ui_agent_context`.
3. Run the Design/UI implementation lane in an isolated worktree.
4. Record the agent result with `mcp__spec-to-pr__record_design_ui_agent_result`.
5. Call `mcp__spec-to-pr__plan_visual_regression`.
6. Call `mcp__spec-to-pr__capture_browser_screenshots`.
7. Call `mcp__spec-to-pr__compare_visual_snapshots`.
8. Call `mcp__spec-to-pr__evaluate_visual_repair_loop` with:
   - `attempt`
   - `policy.minPassingScore`
   - `policy.maxAttempts`

If the decision is `retry`, pass `failingTargetIds`, diff artifacts, overlay
artifacts, and the visual report back into the next Design/UI attempt.

If the decision is `failed`, stop and report the human-review blocker.

If the decision is `passed`, continue to Review Council or PR report generation.

## Report

Return:

- attempt count
- final visual score
- final decision
- failing target IDs, if any
- visual report artifact ID
- whether the Run may proceed to PR reporting

## Boundaries

Do not exceed `max-attempts`.
Do not waive visual failures.
Do not hide failed or review-needed targets.
Do not publish a blocked PR/MR report.
