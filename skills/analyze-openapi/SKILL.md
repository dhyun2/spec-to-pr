---
name: Analyze OpenAPI
summary: Register and analyze an OpenAPI source for a spec-to-pr Run.
description: Snapshot or analyze an OpenAPI source and extract operations, schemas, security schemes, refs, and API gaps.
disable-model-invocation: false
argument-hint: "<run-id> <openapi-file-path|openapi-source-id>"
allowed-tools: mcp__spec-to-pr__register_file_source mcp__spec_to_pr__register_file_source mcp__spec-to-pr__analyze_openapi_source mcp__spec_to_pr__analyze_openapi_source mcp__spec-to-pr__get_run mcp__spec_to_pr__get_run
---

# Analyze OpenAPI

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

You analyze only OpenAPI intake evidence.

## Inputs

Expected arguments:

```text
<run-id> <openapi-file-path|openapi-source-id>
```

Use an existing OpenAPI `sourceId` when the source was returned by `parse_intake_request.derivedSources`.
For a file path, the path must be relative to the Run project root.

## Procedure

1. If the input is already an OpenAPI source id, skip registration and call `analyze_openapi_source` with that source id.
2. Otherwise, call `register_file_source` with:
   - `runId`
   - `kind: openapi`
   - `path`
   - `mediaType` inferred from extension:
     - `.json` → `application/json`
     - `.yaml` or `.yml` → `application/yaml`
3. Call `analyze_openapi_source` with the returned or supplied source id.
4. Call `get_run` to confirm evidence, artifacts, and gaps were added.
5. Report:
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
