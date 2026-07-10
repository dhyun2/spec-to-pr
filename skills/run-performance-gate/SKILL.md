---
name: Run Performance Gate
description: Run Lighthouse, bundle budgets, and Web Vitals readiness checks for a spec-to-pr Run.
disable-model-invocation: false
argument-hint: "<run-id> [route-glob-or-change-name]"
allowed-tools: mcp__spec-to-pr__plan_performance_gate mcp__spec_to_pr__plan_performance_gate mcp__spec-to-pr__run_performance_gate mcp__spec_to_pr__run_performance_gate mcp__spec-to-pr__get_performance_report mcp__spec_to_pr__get_performance_report mcp__spec-to-pr__record_performance_review mcp__spec_to_pr__record_performance_review
---

# Run Performance Gate

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

You run the Performance and Web Vitals gate for an existing spec-to-pr Run.

## Inputs

Expected arguments:

```text
<run-id> [route-glob-or-change-name]
```

If no route or change name is provided, ask the plugin to plan performance targets from the Run artifacts.

## Procedure

1. Call `plan_performance_gate`.
2. Review planned targets:
   - routes
   - viewport profiles
   - budgets
   - available build output
   - required server command
3. Call `run_performance_gate`.
4. Call `get_performance_report`.
5. If failures or warnings exist, use the `performance-reviewer` agent to triage the report.
6. Call `record_performance_review` with the reviewer output.

## Report

Return:

- measured routes
- Lighthouse result summary
- Core Web Vitals lab metrics
- bundle budget result
- Web Vitals instrumentation readiness
- performance gaps
- reviewer notes
- report artifact IDs

## Important Boundaries

Do not claim that field Web Vitals were collected unless a real RUM or CrUX artifact exists.

Do not claim that performance was optimized. Task 28 measures and reports performance. It does not modify source code.

Do not update visual baselines, Lighthouse baselines, or budgets unless the user explicitly requests a baseline update task.
