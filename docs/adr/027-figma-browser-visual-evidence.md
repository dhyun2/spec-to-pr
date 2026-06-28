# ADR-027: Figma Browser Visual Evidence

## Status

Accepted

## Context

Design/UI Agent may claim that a screen matches Figma, but natural-language claims are not reliable evidence.

Task 10 stores Figma screenshot artifacts. Task 21 implements UI. Task 25 verifies functional quality gates.

The missing piece is visual comparison between stored Figma baseline images and browser screenshots from the integrated implementation.

## Decision

Task 26 introduces deterministic visual comparison:

- Figma screenshot artifact is the baseline.
- Browser screenshot artifact is the actual.
- Comparison produces exact match, review match, overlay, diff heatmap, and visual report.
- Dynamic areas must be masked explicitly.
- A visual-regression-reviewer subagent may triage mismatches but cannot decide pass/fail.

## Consequences

Good:

- PR reports can show visual evidence.
- UI divergence becomes visible.
- Visual gaps are recorded instead of hidden.
- Reviewer can inspect side-by-side evidence.

Tradeoffs:

- Browser rendering can vary by OS, font, and browser.
- Pixel comparison requires tolerance.
- Mask policy must be reviewed.
- This task does not fix visual mismatches automatically.
