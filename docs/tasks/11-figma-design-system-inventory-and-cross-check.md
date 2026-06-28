# Task 11 - Figma Design-System Inventory and Cross-check

## Goal

Parse recorded Figma raw artifacts into a design-system inventory and cross-check provider outputs.

## Why This Task Exists

Raw Figma MCP outputs are useful for auditability, but implementation agents need structured data:

- components
- variants
- variables
- text styles
- effects
- assets
- Code Connect mappings
- screenshot baseline
- provider comparison
- gaps

## Non-Goals

- No UI code generation
- No visual diff
- No browser screenshots
- No design-system import validation in repository
- No agent execution

## Definition of Done

- Inventory schema exists.
- Analyzer reads Figma raw artifacts from Run.
- Analyzer creates component/token/asset/code-connect inventory.
- Analyzer creates gaps for missing critical artifacts.
- Analyzer creates gaps for unmapped components and provider mismatches.
- Inventory and cross-check report are stored as ArtifactRef records.
