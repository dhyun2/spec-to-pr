# ADR-011: Record Figma Raw Output Before Design Inventory

## Status

Accepted

## Context

Figma MCP outputs may differ by provider and may evolve over time. Directly parsing them into design-system inventory without storing the raw output loses auditability.

## Decision

Task 10 records raw Figma MCP outputs as immutable content-addressed artifacts before any semantic design inventory is generated.

## Consequences

Good:

- Figma evidence can be audited later.
- Provider differences can be compared.
- Visual regression has a stable Figma screenshot baseline.
- Design inventory can be regenerated from raw artifacts.

Tradeoffs:

- Run artifacts increase in size.
- Raw data may include noisy or provider-specific format details.
