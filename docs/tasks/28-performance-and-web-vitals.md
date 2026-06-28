# Task 28 - Performance and Web Vitals

## Goal

Run lab performance gates and Web Vitals readiness checks for integrated implementation routes.

## Why This Task Exists

Functional tests and visual checks do not guarantee good user experience.

Task 28 records:

- Lighthouse lab metrics
- bundle and asset budgets
- Core Web Vitals thresholds
- Web Vitals RUM instrumentation readiness
- performance gaps
- performance reviewer triage

## Non-Goals

- No automatic source optimization
- No image compression
- No baseline update
- No production RUM backend deployment
- No claim of field data unless explicit field artifact exists

## Definition of Done

- Performance plan is generated.
- Lighthouse run result can be parsed.
- Bundle and asset budgets can be evaluated.
- Web Vitals instrumentation readiness can be checked.
- Performance report artifact is produced.
- Performance gaps are recorded.
- Skill and reviewer agent are added.

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

- budget checker tests pass
- Lighthouse parser tests pass
- Web Vitals readiness tests pass
- PerformanceGateService tests pass
- MCP stdio integration can call:
  - plan_performance_gate
  - run_performance_gate
  - get_performance_report
  - record_performance_review

## Known Limitations

- Lighthouse execution may be delegated to CI or external runner.
- Task 28 records lab results; it does not create production field data.
- INP is treated as field/RUM readiness, not a direct Lighthouse metric.
- No automatic optimization is performed.
- Performance reviewer does not modify source code.
