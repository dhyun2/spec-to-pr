# Task 27 — Accessibility Gate

## Goal

Run automated accessibility checks, produce manual review items, map accessibility violations to Gaps, and store an accessibility report artifact in the Run.

## Why this task exists

Visual and functional tests do not prove accessibility.

The plugin must explicitly check:

- semantic roles
- accessible names
- form labels
- color contrast
- keyboard navigation
- dialog/sheet focus behavior
- focus restore
- touch target and pointer-only interaction risks
- manual screen reader review status

## Non-goals

- No automatic source code fixes
- No legal accessibility certification
- No full manual screen reader audit
- No baseline approval
- No PR publishing

## Outputs

- accessibility gate plan
- accessibility scan report
- manual review checklist
- accessibility gaps
- accessibility report artifact
- reviewer triage artifact

## Definition of Done

- Accessibility targets can be planned.
- Axe-like results can be normalized.
- Keyboard and focus check contracts exist.
- Violations can be mapped to Gap objects.
- Accessibility report artifact is recorded.
- Skill and reviewer agent are documented.
- MCP stdio tests can call accessibility gate tools.

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

Expected:

- accessibility model tests pass
- axe result normalizer tests pass
- keyboard/focus check tests pass
- violation-to-gap mapper tests pass
- AccessibilityGateService tests pass
- MCP stdio integration can call:
  - plan_accessibility_gate
  - run_accessibility_gate
  - get_accessibility_report
  - record_accessibility_review

## Known limitations

- Keyboard and focus checks are modeled but not fully automated in this task.
- Screen reader review is represented as manual review item.
- Automated checks do not prove full WCAG conformance.
- Accessibility reviewer cannot waive gaps.
- Accessibility reviewer cannot modify source code.
- Actual Playwright + axe runner wiring may be expanded in a later quality integration task.
