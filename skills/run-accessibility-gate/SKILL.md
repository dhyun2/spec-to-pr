---
name: Run Accessibility Gate
description: Plan and run accessibility checks, then record accessibility review notes.
disable-model-invocation: true
argument-hint: "<run-id> [targets-json]"
allowed-tools: mcp__spec-to-pr__plan_accessibility_gate mcp__spec-to-pr__run_accessibility_gate mcp__spec-to-pr__get_accessibility_report mcp__spec-to-pr__record_accessibility_review Task
---

# Run Accessibility Gate

You run the accessibility gate for an existing spec-to-pr Run.

## Why this Skill exists

Accessibility checking is a multi-step workflow:

1. Decide which UI states should be checked.
2. Run or record automated accessibility scans.
3. Record manual review requirements.
4. Ask the accessibility reviewer subagent to triage the report.
5. Store reviewer notes as an artifact.

Users should not have to call each MCP tool manually.

## Inputs

Expected arguments:

```text
<run-id> [targets-json]
```

If `targets-json` is omitted, call `plan_accessibility_gate` with an empty target list and report that no browser scan target was provided.

## Procedure

1. Call `mcp__spec-to-pr__plan_accessibility_gate`.
2. If targets are provided, call `mcp__spec-to-pr__run_accessibility_gate`.
3. Call `mcp__spec-to-pr__get_accessibility_report` with the returned report artifact ID.
4. Invoke the `accessibility-reviewer` subagent through Task with:
   - accessibility report
   - gap IDs
   - manual review items
   - screenshot artifact references if available
5. Call `mcp__spec-to-pr__record_accessibility_review` with the reviewer's triage notes.

## Important Boundaries

Do not claim:

- WCAG compliance is fully proven
- screen reader testing was completed
- manual review was completed
- source code was fixed
- baseline was updated

This Skill records accessibility evidence and triage only.

## Report Format

Return:

- decision
- automated violation count
- gaps added
- manual review required count
- report artifact ID
- reviewer artifact ID
