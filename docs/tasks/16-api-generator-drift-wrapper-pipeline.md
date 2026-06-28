# Task 16 — API Generator, Drift and Wrapper Pipeline

## Goal

Generate or verify API client artifacts from OpenAPI evidence and expose them through project-appropriate feature/entity wrappers.

## Why this task exists

Task 12 analyzes OpenAPI documents but does not generate API code.

Task 16 turns OpenAPI evidence into:

- generated TypeScript types
- generated or existing API client connection
- Zod runtime schemas where supported
- feature-level API wrappers
- mock handlers
- contract test skeletons
- source guard tests
- API pipeline reports

## Inputs

- Run ID
- OpenAPI intake report artifact
- project profile
- traceability matrix
- target source key
- target generated path
- target wrapper path

## Outputs

- generated type/schema/client files
- wrapper files
- mock skeletons
- contract test skeletons
- source guard tests
- API pipeline report artifacts
- generated file manifest
- API gaps for unsupported schema or missing operations

## Non-goals

- No live API calls
- No destructive staging tests
- No forced generator replacement
- No UI implementation
- No PR publishing
- No full OpenAPI semantic coverage
- No external ref bundling unless already resolved by prior intake

## Rules

- Prefer existing project generator.
- Do not invent undocumented operations.
- Do not let UI import generated clients directly.
- Do not manually edit generated files.
- Unsupported schema features must become warnings or gaps.
- Generated files must include source digest and generator metadata.
- Source guard tests must be generated when wrappers are generated.

## Definition of Done

- Existing generator discovery works.
- Fallback generator can produce conservative TS/Zod files for supported schemas.
- Wrapper generator creates feature API wrapper skeletons for documented operations.
- Mock generator creates MSW handler skeletons when MSW is detected or requested.
- Contract test generator creates schema-based skeletons.
- Source guard tests are generated.
- API pipeline report artifact is recorded in Run.
- MCP tool works through stdio integration tests.

## Verification

Run:

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

Expected:

- generator discovery tests pass
- TypeScript fallback generator tests pass
- Zod fallback generator tests pass
- wrapper generator tests pass
- mock generator tests pass
- source guard generator tests pass
- ApiPipelineService integration test passes
- MCP stdio integration can call `generate_api_pipeline`

## Known limitations

- Fallback generator is conservative.
- Existing project generator adapters require project-specific hardening.
- External `$ref` must be bundled before full generation.
- oneOf/anyOf/allOf support is limited.
- Generated wrapper imports may need project-specific adapter updates.
- Source guard avoids extra dependencies and uses Node filesystem traversal.
- Live API contract tests are not executed in this task.
