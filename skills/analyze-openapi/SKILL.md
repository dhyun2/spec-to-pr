---
name: Analyze OpenAPI
summary: Register and analyze an OpenAPI source for a spec-to-pr Run.
description: Snapshot an OpenAPI file source and analyze operations, schemas, security schemes, refs, and API gaps.
disable-model-invocation: false
argument-hint: "<run-id> <openapi-file-path>"
allowed-tools: mcp__spec-to-pr__register_file_source mcp__spec-to-pr__analyze_openapi_source mcp__spec-to-pr__get_run
---

# Analyze OpenAPI

You analyze only OpenAPI intake evidence.

## Inputs

Expected arguments:

```text
<run-id> <openapi-file-path>
```

The file path must be relative to the Run project root.

## Procedure

1. Call `register_file_source` with:
   - `runId`
   - `kind: openapi`
   - `path`
   - `mediaType` inferred from extension:
     - `.json` → `application/json`
     - `.yaml` or `.yml` → `application/yaml`
2. Call `analyze_openapi_source` with the returned `source.id`.
3. Call `get_run` to confirm evidence, artifacts, and gaps were added.
4. Report:
   - source id
   - source digest
   - OpenAPI version
   - operation count
   - schema count
   - security scheme count
   - ref count
   - gaps added

## Boundaries

Do not claim any of the following:

- TypeScript types generated
- Zod schemas generated
- API client generated
- wrappers implemented
- mocks generated
- contract tests generated
- live API verified

Task 12 only performs OpenAPI intake analysis.
