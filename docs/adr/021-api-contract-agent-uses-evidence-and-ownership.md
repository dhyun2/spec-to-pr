# ADR-021: API Contract Agent Uses Evidence and Ownership

## Status

Accepted

## Context

The API Contract Agent modifies contract-sensitive code:

- generated API client
- Zod schemas
- API wrappers
- mappers
- mocks
- contract tests
- source guard tests

If it reads raw OpenAPI loosely or edits arbitrary files, it can introduce undocumented behavior or break architecture boundaries.

## Decision

The API Contract Agent receives a scoped context pack and file ownership policy.

It may only use:

- OpenAPI evidence
- API intake reports
- API pipeline artifacts
- traceability matrix
- test matrix
- existing project API conventions

It must not invent endpoints or modify UI implementation files.

## Consequences

Good:

- API changes stay grounded in documented contracts.
- UI direct generated-client imports can be prevented.
- Missing API details become explicit gaps.
- Agent output is machine-validated before it enters the Run ledger.

Tradeoffs:

- The agent may be blocked when OpenAPI evidence is incomplete.
- Generated wrappers may be conservative.
- More review artifacts are produced before implementation.
