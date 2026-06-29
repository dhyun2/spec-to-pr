---
name: Generate Design Contract
description: Generate a Figma design contract and design-system mapping for a spec-to-pr Run.
disable-model-invocation: false
argument-hint: "<run-id> <change-name> <figma-inventory-artifact-id>"
allowed-tools: mcp__spec-to-pr__generate_figma_design_contract mcp__spec-to-pr__get_run
---

# Generate Figma Design Contract

You generate a design implementation contract from an existing Figma design inventory artifact.

## Why this skill exists

The Design/UI Agent must not implement directly from screenshots or raw Figma metadata.

Before UI implementation, the system must produce a contract that defines:

- which code component maps to each Figma component
- which code token maps to each Figma variable
- which typography class maps to each Figma text style
- which assets require export or existing code mapping
- which missing mappings must remain as design gaps

## Inputs

Expected arguments:

```text
<run-id> <change-name> <figma-inventory-artifact-id>
```

## Procedure

1. Call `mcp__spec-to-pr__generate_figma_design_contract` with:
   - `runId`
   - `changeName`
   - `figmaInventoryArtifactId`
2. Call `mcp__spec-to-pr__get_run` to confirm:
   - design contract artifacts were added
   - design gaps were recorded when mappings are missing
3. Report:
   - changed files
   - component mapping count
   - token mapping count
   - typography mapping count
   - asset mapping count
   - gap IDs

## How future agents consume this output

The Design/UI Agent must read:

- `figma-design-contract.json`
- `component-map.json`
- `token-map.json`
- `typography-map.json`
- `asset-map.json`
- `ui-implementation-rules.md`

The agent must:

- use mapped code components
- use mapped tokens/classes/css variables
- avoid hard-coded visual values when mappings exist
- cite design gaps when mappings are missing
- avoid inventing Figma states that are not backed by evidence

## Important boundaries

Do not claim that UI was implemented.
Do not create or modify UI source code.
Do not run visual regression.
Do not close design gaps without resolution artifacts.

Task 17 only generates the design contract used by later UI agents.
