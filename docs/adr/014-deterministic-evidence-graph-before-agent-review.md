# ADR-014: Deterministic Evidence Graph Before Agent Review

## Status

Accepted

## Context

The final plugin uses multiple agents to implement features. Before agents write code, the system must know how requirements relate to API and Figma evidence.

If this mapping is done only through natural-language agent reasoning, traceability becomes hard to audit.

## Decision

Create a deterministic evidence graph before OpenSpec, Gherkin, API generation, UI implementation, and Review Council.

The graph stores:

- nodes
- edges
- confidence
- reasons
- source evidence references
- orphan reports
- missing evidence gaps

## Consequences

Good:

- Requirements become traceable.
- Later specs and tests can cite stable node IDs.
- Missing API or Figma support becomes visible early.
- Review Council can review structured candidate links.

Tradeoffs:

- Deterministic matching is conservative.
- Some valid semantic links may be missed.
- LLM-assisted refinement is deferred to later review tasks.
