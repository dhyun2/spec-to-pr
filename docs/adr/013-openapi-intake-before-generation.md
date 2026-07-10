# ADR-013: OpenAPI Intake Before API Generation

## Status

Accepted

## Context

The final plugin must generate or verify API clients, wrappers, runtime schemas, mocks, and contract tests.
However, running a generator before understanding the OpenAPI document can produce unstable or misleading output.

Potential problems include:

- missing operationId
- duplicate operationId
- missing success responses
- missing error responses
- invalid path parameters
- unsupported content types
- undefined security schemes
- dangling `$ref`
- remote `$ref` requiring network access
- prompt-injection-like text in descriptions

## Decision

Introduce an OpenAPI Intake Adapter before API generation.

The adapter parses a registered Source snapshot and produces deterministic inventories and gaps before any code generation.

The adapter:

- parses registered OpenAPI source snapshots
- supports JSON and YAML
- accepts OpenAPI 3.0.x and 3.1.x
- rejects or gaps Swagger 2.0
- creates operation inventory
- creates schema inventory
- creates security inventory
- creates `$ref` inventory
- creates API gaps
- stores normalized document and inventory artifacts

## Why not generate code immediately?

API generation should be based on a known-good inventory.
Missing operationIds or incomplete responses should become explicit gaps before implementation agents rely on them.

## Consequences

Good:

- API generation later receives a structured, validated inventory.
- API gaps are discovered early.
- OpenAPI text remains untrusted input.
- PR reports can cite OpenAPI operation evidence.

Tradeoffs:

- Task 12 does not generate client code.
- Full JSON Schema validation is deferred.
- Remote reference resolution is deferred.
- Some validation is conservative.
