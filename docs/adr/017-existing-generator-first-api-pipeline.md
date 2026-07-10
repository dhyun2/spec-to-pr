# ADR-017: Existing Generator First API Pipeline

## Status

Accepted

## Context

Target repositories may already have API generators, generated client paths, transport layers, and source guard conventions.

Introducing a new generator too early can break repository conventions.

## Decision

Task 16 uses an existing-generator-first strategy.

Order:

1. Use Project Profile generator information if available.
2. Detect package scripts and known generator config files.
3. Run existing generator when safe.
4. Check generated drift.
5. Generate wrappers, mocks, contract skeletons, and guards around the existing output.
6. Use fallback TypeScript/Zod generator only when no existing generator exists.

## Consequences

Good:

- Respects target repository conventions.
- Reduces churn in generated code.
- Avoids duplicate API clients.
- Makes API wrapper boundary explicit.

Tradeoffs:

- Different projects may produce different generated outputs.
- Fallback generator is intentionally conservative.
- Some schemas may remain unsupported until a project-specific adapter is added.
