---
name: Run Accessibility Gate
description: Plan and run accessibility checks, then record accessibility review notes.
disable-model-invocation: false
argument-hint: "<run-id> [targets-json]"
allowed-tools: mcp__spec-to-pr__plan_accessibility_gate mcp__spec_to_pr__plan_accessibility_gate mcp__spec-to-pr__run_accessibility_gate mcp__spec_to_pr__run_accessibility_gate mcp__spec-to-pr__get_accessibility_report mcp__spec_to_pr__get_accessibility_report mcp__spec-to-pr__record_accessibility_review mcp__spec_to_pr__record_accessibility_review
---

# Run Accessibility Gate

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

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

`targets-json` must be an array. Each target requires a stable `id` string:

```json
[
  {
    "id": "mapfinder-default",
    "name": "매장찾기 기본 화면",
    "url": "https://localhost:5173/mapfinder",
    "viewport": {
      "width": 375,
      "height": 812
    }
  }
]
```

## Procedure

1. Call `plan_accessibility_gate`.
2. If targets are provided, call `run_accessibility_gate`.
3. Call `get_accessibility_report` with the returned report artifact ID.
4. Invoke the `accessibility-reviewer` subagent through Task with:
   - accessibility report
   - gap IDs
   - manual review items
   - screenshot artifact references if available
5. Call `record_accessibility_review` with the reviewer's triage notes.

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

## Host Compatibility And Subagent Fallback

Subagent names differ by host:

- Claude Code: the agents defined in `agents/` (for example `design-ui`, `api-contract`, `spec-bdd`, `integrator`, `review-council`, and the `*-reviewer` agents).
- Codex: the same agents are defined in `.codex/agents/` as `spec-to-pr-<name>` (for example `spec-to-pr-design-ui`).

If the host does not support named subagents, or a matching agent is not available, do not skip the lane. Perform the same instructions inline in the current thread and record the outcome with the same `record_*` MCP tool. Sequential in-thread execution is the supported fallback and must still produce the same structured result and evidence.
