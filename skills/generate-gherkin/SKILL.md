---
name: Generate Gherkin
description: Generate Gherkin feature files and a test matrix for an OpenSpec change.
disable-model-invocation: false
argument-hint: "<run-id> <change-name>"
allowed-tools: mcp__spec-to-pr__generate_gherkin_test_matrix mcp__spec_to_pr__generate_gherkin_test_matrix mcp__spec-to-pr__get_run mcp__spec_to_pr__get_run
---

# Generate Gherkin and Test Matrix

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

You generate Gherkin feature files and a test matrix from an existing OpenSpec change.

By default, generated Gherkin and test-matrix artifacts are stored in the Run
artifact store, not written into the target repository. Only pass
`writeToProject: true` when the user explicitly asks to export these artifacts
as project files.

## Inputs

Expected arguments:

```text
<run-id> <change-name>
```

## Procedure

1. Call `generate_gherkin_test_matrix` with:
   - `runId`
   - `changeName`
   - do not set `writeToProject` unless the user explicitly asks for repo files
2. Call `get_run` to confirm artifact count increased.
3. Report generated artifact IDs and scenario counts. In the default
   artifact-store mode, `changedFiles` should be empty.

## Report

Return:

- change name
- requirement count
- scenario count
- automated candidate count
- blocked count
- changed files
- artifact IDs

## Important Boundaries

Do not claim that tests were executed.
Do not claim that step definitions were generated.
Do not claim that Playwright, Vitest, or Cucumber has been configured.

Task 15 only generates Gherkin feature files and a test matrix.
