# ADR-034: Release Readiness Before Publication

## Status

Accepted

## Context

The spec-to-pr plugin coordinates source ingestion, Figma evidence, OpenAPI analysis, agent execution, quality gates, visual regression, PR publishing, and OpenSpec archive.

A public or team release must not be based only on manual confidence.

## Decision

Task 33 introduces a release readiness pipeline before any publication.

The pipeline includes:

- eval suites
- security hardening fixtures
- deterministic package builder
- allowlist-based package verifier
- SHA-256 checksums
- release manifest
- release notes
- reviewer agents

## Consequences

Good:

- Release artifacts are reproducible.
- Dangerous files are excluded.
- Evals document expected behavior.
- Security fixtures protect critical boundaries.
- Release notes avoid claiming scaffolded features as verified.

Tradeoffs:

- Release preparation takes longer.
- Some publication steps remain manual.
- Full supply-chain provenance depends on CI provider support.
