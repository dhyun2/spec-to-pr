# ADR-0010: Generate OpenSpec from Evidence Graph

## Status

Accepted

## Context

The final plugin should not jump from raw brief or Figma data directly into implementation.

Task 13 produces an Evidence Graph that links requirements to brief evidence, Figma nodes, OpenAPI operations, gaps, and future implementation/test targets.

This graph is machine-readable, but reviewers and implementation agents need a human-readable spec change.

## Decision

Generate an OpenSpec change folder from the Evidence Graph.

The generator creates:

- proposal.md
- design.md
- tasks.md
- specs/<area>/spec.md
- artifacts/evidence-summary.md
- artifacts/traceability-matrix.md
- artifacts/gap-summary.md
- artifacts/change-manifest.json

## Rationale

OpenSpec provides a structured spec-driven workflow where proposed changes live under changes/ and later merge/archive into current specs.

Generating OpenSpec from evidence ensures that AI implementation work is grounded in collected source evidence.

## Consequences

Good:

- Reviewers can inspect scope before implementation.
- Agents receive stable spec artifacts.
- Gaps remain visible.
- PR reports can link implementation back to OpenSpec.

Tradeoffs:

- Generated text is conservative.
- Human review may still refine proposal/design language.
- OpenSpec validation is separate from artifact generation.
