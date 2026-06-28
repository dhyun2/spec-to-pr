# ADR-025: Deterministic Architecture Guard Before Quality Gates

## Status

Accepted

## Context

After agent outputs are integrated, the code may compile or even pass some tests while violating architectural constraints.

Examples:

- UI imports generated clients directly.
- features import other feature internals.
- entities import features.
- shared imports app-specific code.

These problems should be detected before expensive quality gates and before visual/performance checks.

## Decision

Introduce a deterministic architecture guard after integration and before quality gates.

The guard analyzes imports, FSD layers, slice boundaries, and API access patterns.

## Consequences

Good:

- Architecture violations are detected early.
- Repair work can be targeted.
- CI can reuse generated source guard tests.
- Review reports include deterministic evidence.

Tradeoffs:

- Static analysis may have false positives.
- Project-specific aliases require configuration.
- Some dynamic imports may not resolve perfectly.
