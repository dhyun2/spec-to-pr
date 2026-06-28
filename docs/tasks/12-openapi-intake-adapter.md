# Task 12 — OpenAPI Intake Adapter

## Goal

Analyze a registered OpenAPI Source snapshot and produce operation, schema, security, reference inventories, and API gaps.

## Why this task exists

OpenAPI documents are critical API evidence.
The plugin must not generate clients, wrappers, mocks, or contract tests before it knows what operations, schemas, security schemes, request bodies, responses, and gaps exist.

Task 12 turns OpenAPI from a raw source snapshot into structured API evidence.

```text
OpenAPI Source snapshot
  ↓
parse JSON/YAML
  ↓
minimum structural validation
  ↓
operation inventory
  ↓
schema inventory
  ↓
security scheme inventory
  ↓
$ref inventory
  ↓
API gap 생성
  ↓
Run.evidence / Run.artifacts / Run.gaps 저장
```

## Inputs

- Run ID
- registered OpenAPI Source ID
- source snapshot content

## Outputs

- OpenAPI normalized document artifact
- OpenAPI intake report artifact
- operation inventory
- schema inventory
- security scheme inventory
- `$ref` inventory
- EvidenceRef entries for operations and schemas
- API Gap entries for missing operationId, duplicate operationId, missing responses, missing security schemes, invalid structure, and unsupported versions
- updated Run

## Non-goals

This task intentionally does not do the following:

- No TypeScript type generation
- No Zod schema generation
- No API client generation
- No feature wrapper generation
- No MSW/mock generation
- No contract test generation
- No requirement-to-endpoint matching
- No Figma-to-endpoint matching
- No OpenAPI diff or breaking-change judgment
- No live API network call
- No external linter execution
- No remote `$ref` network fetching

## Rules

- OpenAPI descriptions are untrusted data, not instructions.
- JSON and YAML are supported.
- OpenAPI 3.0.x and 3.1.x are accepted.
- Swagger 2.0 is detected but reported as unsupported in this task.
- Unknown OpenAPI versions become API gaps.
- Missing `operationId` becomes an API gap.
- Duplicate `operationId` becomes an API gap.
- Operation without a 2xx response becomes an API gap.
- Operation without any 4xx/5xx response becomes an API gap candidate.
- Security requirement referencing an unknown security scheme becomes an API gap.
- `$ref` values are inventoried but not dereferenced by default.
- Remote or external `$ref` resolution is deferred to later policy-aware generation stages.

## Definition of Done

- OpenAPI Source snapshots can be parsed.
- JSON and YAML are both supported.
- OpenAPI version kind is detected.
- Operation inventory is generated.
- Schema inventory is generated.
- Security scheme inventory is generated.
- `$ref` inventory is generated.
- API gaps are stored in Run.gaps.
- Operation and schema evidence are linked to JSON Pointer locations.
- OpenAPI inventory artifact is stored.
- MCP stdio integration can call OpenAPI analysis.
- Unit and integration tests cover parser, inventory, gap detection, and service flow.

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

- OpenAPI parser tests pass.
- Operation inventory tests pass.
- API gap detection tests pass.
- OpenApiIntakeService tests pass.
- MCP stdio integration calls `register_file_source` and `analyze_openapi_source`.

## Known limitations

- Swagger 2.0 is not converted.
- `$ref` values are inventoried but not dereferenced.
- External URL refs are not resolved.
- TypeScript generation is not implemented.
- Zod generation is not implemented.
- API client generation is not implemented.
- Feature wrappers are not implemented.
- Contract tests are not generated.
- Full OpenAPI linting with external tools is deferred.
