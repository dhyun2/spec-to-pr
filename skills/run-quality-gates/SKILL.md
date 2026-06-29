---
name: Run Quality Gates
description: Run deterministic lint, typecheck, build, and test quality gates for a spec-to-pr Run.
disable-model-invocation: false
argument-hint: "<run-id>"
allowed-tools: mcp__spec-to-pr__run_quality_gates mcp__spec_to_pr__run_quality_gates mcp__spec-to-pr__get_run mcp__spec_to_pr__get_run
---

# Run Quality Gates

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

You run Task 25 quality gates for an existing spec-to-pr Run.

## Inputs

Expected arguments:

```text
<run-id>
```

## Procedure

1. Call `run_quality_gates` with:
   - `runId`
2. Report:
   - status
   - passed count
   - failed count
   - skipped count
   - quality report artifact ID
   - coverage artifact ID, if present
   - generated gap IDs
   - verification AgentResult ID
3. Call `get_run` to confirm:
   - CheckResult entries are attached to the verification AgentResult
   - quality artifacts are visible
   - failed gates created gaps when applicable

## How agents consume this

This skill does not run a subagent.

It generates deterministic quality evidence.

Later stages consume the output as follows:

- `integrator` reads failed gate gaps before repair.
- `review-council` reads CheckResult evidence before final approval.
- visual, accessibility, and performance stages run only after quality gates.

## Report Format

Return:

- Quality gate status
- Quality report artifact ID
- Markdown report artifact ID
- Coverage artifact ID, if any
- Check IDs
- Gap IDs
- Verification AgentResult ID

## Important Boundaries

Do not claim that visual regression, accessibility, or performance checks ran.

Do not install dependencies.

Do not perform automatic repair.
