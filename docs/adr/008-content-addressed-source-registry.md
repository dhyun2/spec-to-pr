# ADR-008: Content-addressed Source Registry

## Status

Accepted

## Context

The final plugin must prove which input version was used for every requirement, API contract, Figma comparison, test matrix, and PR report.

Storing only file paths or URLs is not enough because the content behind them can change.

## Decision

Task 07 introduces a content-addressed source registry.

For each local file source:

1. Verify the file is inside the Run project root.
2. Read raw bytes.
3. Compute raw SHA-256 digest.
4. Canonicalize text-like content.
5. Compute canonical SHA-256 digest.
6. Store canonical content under its digest.
7. Store metadata next to the content.
8. Add a SourceRef to the Run.

SourceRef.digest uses the canonical digest.

## Why Canonical Content?

Briefs and OpenAPI YAML files often differ only by line endings or Unicode normalization.

Canonicalization prevents harmless CRLF/LF differences from creating unrelated source identities.

## Consequences

Good:

- Later Evidence can cite stable input versions.
- PR reports can include source provenance.
- Input drift can be detected.
- Duplicate source registration becomes idempotent.

Tradeoffs:

- Raw bytes are not the primary SourceRef digest for text files.
- Binary files do not get text canonicalization.
- URL and Figma snapshots are deferred to later adapters.
