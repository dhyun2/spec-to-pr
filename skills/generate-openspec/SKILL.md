---
name: Generate OpenSpec
description: Generate an OpenSpec change from a traceability matrix artifact.
disable-model-invocation: false
argument-hint: "<run-id> <traceability-artifact-id> [change-name]"
allowed-tools: mcp__spec-to-pr__generate_openspec_change mcp__spec_to_pr__generate_openspec_change mcp__spec-to-pr__get_run mcp__spec_to_pr__get_run
---

# Generate OpenSpec

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

You generate OpenSpec change artifacts from an existing traceability matrix.

## Inputs

Expected arguments:

```text
<run-id> <traceability-artifact-id> [change-name]
```

## Procedure

1. Call `generate_openspec_change` with:
   - `runId`
   - `traceabilityArtifactId`
   - optional `changeName`
2. Call `get_run` to confirm artifact count increased.
3. Report generated files.

## Report

Return:

- change name
- changed files
- artifact IDs
- whether generation was duplicate/no-op

## Important Boundaries

Do not claim that code was implemented.
Do not claim that Gherkin or tests were generated.
Do not claim that OpenSpec was archived.

Task 14 only generates OpenSpec change artifacts.
