---
name: Run Visual Regression
description: Capture browser screenshots and compare them against stored Figma screenshot artifacts.
disable-model-invocation: true
argument-hint: "<run-id> <change-name>"
allowed-tools: mcp__spec-to-pr__plan_visual_regression mcp__spec-to-pr__capture_browser_screenshots mcp__spec-to-pr__compare_visual_snapshots mcp__spec-to-pr__get_visual_report mcp__spec-to-pr__record_visual_review_result mcp__spec-to-pr__get_run
---

# Run Visual Regression

You run visual regression for an existing spec-to-pr Run.

## Inputs

Expected arguments:

```text
<run-id> <change-name>
```

## Procedure

1. Call `mcp__spec-to-pr__plan_visual_regression`.
2. Confirm the plan has:
   - Figma baseline artifacts
   - browser target routes or stories
   - viewport information
   - mask policy
3. Call `mcp__spec-to-pr__capture_browser_screenshots`.
4. Call `mcp__spec-to-pr__compare_visual_snapshots`.
5. Call `mcp__spec-to-pr__get_visual_report`.
6. If the report contains failed or review-needed comparisons:
   - invoke the `visual-regression-reviewer` subagent
   - provide the visual report artifact IDs
   - ask it to triage mismatches only
   - do not ask it to modify source code
7. Call `mcp__spec-to-pr__record_visual_review_result` if a visual review result is produced.
8. Call `mcp__spec-to-pr__get_run` to confirm artifacts and gaps were recorded.

## Report

Return:

- visual target count
- browser screenshots captured
- comparisons completed
- exact match range
- review match range
- failed comparisons
- review-needed comparisons
- visual report artifact ID
- visual review artifact ID if any

## Important Boundaries

Do not claim that UI code was fixed.
Do not update baselines automatically.
Do not hide masks.
Do not treat review commentary as pass/fail source of truth.
Do not run publisher tools.

Task 26 records visual evidence and visual review triage only.
