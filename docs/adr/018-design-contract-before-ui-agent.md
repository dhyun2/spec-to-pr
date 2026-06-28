# ADR-018: Design Contract Before UI Agent

## Status

Accepted

## Context

Figma evidence provides design source data, but it does not automatically tell the implementation agent which code components or tokens to use.

If the UI Agent works directly from screenshots or raw Figma metadata, it may:

- hard-code colors
- create duplicate components
- ignore Code Connect mappings
- use arbitrary typography
- invent missing states
- bypass the project's design system

## Decision

Introduce a Figma Design Contract before running the UI Agent.

The contract maps:

- Figma components to code components
- Figma variables to code tokens
- Figma text styles to typography classes
- Figma assets to code assets or gaps

## Consequences

Good:

- UI Agent gets bounded implementation rules.
- Review Council can validate UI work against a contract.
- Missing mappings become explicit gaps.
- Design-system reuse is enforced earlier.

Tradeoffs:

- Mapping is conservative.
- Some mappings may require human review.
- UI implementation is delayed until the contract is available.
