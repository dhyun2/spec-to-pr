---
name: Run Architecture Guard
description: Analyze FSD boundaries and generate source guard tests for a spec-to-pr Run.
disable-model-invocation: false
argument-hint: "<run-id>"
allowed-tools: mcp__spec-to-pr__analyze_architecture_boundaries mcp__spec-to-pr__generate_source_guard_tests mcp__spec-to-pr__get_run
---

# Run Architecture Guard

You run the deterministic architecture guard for an existing spec-to-pr Run.

## Inputs

Expected arguments:

```text
<run-id>
```

## Procedure

1. Call `mcp__spec-to-pr__analyze_architecture_boundaries` with:
   - `runId`
2. Report:
   - violation count
   - blocker count
   - major count
   - generated architecture gap IDs
   - architecture report artifact ID
3. Call `mcp__spec-to-pr__generate_source_guard_tests` with:
   - `runId`
   - `force: false`
4. Call `mcp__spec-to-pr__get_run` to confirm:
   - artifact count increased
   - architecture gaps are visible when violations exist

## How agents consume this

This skill does not run a subagent.

It generates deterministic architecture evidence.

Later agents consume the output as follows:

- `integrator` reads architecture gaps before repair.
- `review-council` reads architecture report before final approval.
- `design-ui` must avoid repeating UI direct API violations.
- `api-contract` must keep generated client usage inside API wrapper zones.

## Report Format

Return:

- Architecture report artifact ID
- Source guard test path
- Violation counts
- Gap IDs
- Whether source guard test was newly written or unchanged

## Important Boundaries

Do not claim that lint, typecheck, or tests were executed.

Task 24 only analyzes architecture and writes source guard tests.

Quality gates run later.
