---
name: Generate API Pipeline
description: Generate API types, Zod schemas, wrappers, mocks, contract skeletons, and source guards from an OpenAPI intake artifact.
disable-model-invocation: true
argument-hint: "<run-id> <openapi-intake-artifact-id> <source-key>"
allowed-tools: mcp__spec-to-pr__generate_api_pipeline mcp__spec-to-pr__get_run
---

# Generate API Pipeline

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

1. Call `mcp__spec-to-pr__generate_api_pipeline` with:
   - `runId`
   - `openApiIntakeArtifactId`
   - `sourceKey`
2. Call `mcp__spec-to-pr__get_run` to confirm API report artifacts were recorded.
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
