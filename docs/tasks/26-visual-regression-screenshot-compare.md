# Task 26 — Visual Regression and Screenshot Compare

## Goal

Compare stored Figma screenshot artifacts with browser screenshots captured from the integrated implementation.

## Why this task exists

Functional tests can pass while the UI still diverges from Figma.

The system must produce visual evidence:

- Figma baseline screenshot
- browser actual screenshot
- overlay image
- diff heatmap
- exact match metric
- review match metric
- mask regions
- visual report
- visual gaps

## Non-goals

- No UI code modification
- No automatic baseline update
- No Figma MCP calls
- No accessibility checks
- No performance checks
- No PR publishing

## Skill

This task adds:

```text
/spec-to-pr:run-visual-regression
```

The Skill is manually invoked because it starts browsers, captures screenshots, writes artifacts, and modifies Run state.

## Agent

This task adds:

```text
visual-regression-reviewer
```

The Agent reviews visual report artifacts and triages mismatch causes. It does not decide pass/fail and does not modify source code.

## Definition of Done

- Visual target model exists.
- Browser screenshots can be captured.
- Figma screenshot and browser screenshot can be compared.
- Mask regions are applied and recorded.
- exact match and review match are computed.
- diff and overlay artifacts are produced.
- visual report artifact is recorded.
- failed comparisons create visual gaps.
- Skill and reviewer agent are documented.

## Verification

Run:

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

Optional browser setup:

```bash
pnpm exec playwright install --with-deps chromium
```

Expected:

- image mask tests pass
- image comparator tests pass
- visual policy tests pass
- VisualRegressionService tests pass
- MCP stdio integration lists:
  - plan_visual_regression
  - capture_browser_screenshots
  - compare_visual_snapshots
  - get_visual_report
  - record_visual_review_result

## Known limitations

- Figma screenshots must already exist as Run artifacts.
- Browser capture requires Playwright and an installed Chromium browser.
- The task does not run a dev server for the target project.
- Dynamic regions are masked only when masks are explicitly provided.
- Visual differences are recorded as gaps but are not fixed automatically.
