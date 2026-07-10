# ADR-012: Build Figma Design Inventory Before UI Agent Implementation

## Status

Accepted

## Context

UI implementation quality depends on more than screenshots. The agent needs component identity, variables, typography, asset references, and Code Connect mapping.

## Decision

Before UI Agent implementation, parse raw Figma artifacts into a deterministic design inventory and cross-check report.

## Consequences

Good:

- UI Agent receives structured design context.
- Missing design-system mappings become explicit gaps.
- Provider conflicts are detected before implementation.
- PR report can trace design evidence to implementation.

Tradeoffs:

- Parsing provider-specific raw output is approximate at this stage.
- Some Figma concepts may require future parser improvements.
