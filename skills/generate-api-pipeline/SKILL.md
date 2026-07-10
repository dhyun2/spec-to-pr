---
name: Generate API Pipeline
description: Generate API types, Zod schemas, wrappers, mocks, contract skeletons, and source guards from an OpenAPI intake artifact.
disable-model-invocation: false
argument-hint: "<run-id> <openapi-intake-artifact-id> <source-key>"
allowed-tools: mcp__spec-to-pr__generate_api_pipeline mcp__spec_to_pr__generate_api_pipeline mcp__spec-to-pr__get_run mcp__spec_to_pr__get_run
---

# Generate API Pipeline

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

You generate API pipeline artifacts from a previously analyzed OpenAPI intake artifact.

## Inputs

Expected arguments:

```text
<run-id> <openapi-intake-artifact-id> <source-key>
```

Example:

```text
run_... art_... staff
```

## Procedure

1. Call `generate_api_pipeline` with:
   - `runId`
   - `openApiIntakeArtifactId`
   - `sourceKey`
2. Call `get_run` to confirm API report artifacts were recorded.
3. Report:
   - mode
   - generated files
   - warnings
   - report artifact ID

## Important Boundaries

Do not claim that live API calls were made.
Do not claim that UI was implemented.
Do not claim that all generated code is production-final without review.

Task 16 generates API pipeline artifacts and guard skeletons.
