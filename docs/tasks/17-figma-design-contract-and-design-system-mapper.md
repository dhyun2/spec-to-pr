# Task 17 — Figma Design Contract and Design-System Mapper

## Goal

Generate a design implementation contract from Figma design inventory and the target repository's design system.

## Why this task exists

Figma inventory is not enough for implementation.

The UI Agent needs a contract that says:

- which code component maps to which Figma component
- which design token maps to which Figma variable
- which typography class maps to which Figma text style
- which asset should be imported, exported, or treated as a gap
- which states must not be invented

## Inputs

- Run ID
- OpenSpec change name
- Figma design inventory artifact from Task 11
- Project profile artifact from Task 06
- Optional Code Connect map artifact
- Existing repository design-system files

## Outputs

- figma-design-contract.json
- figma-design-contract.md
- component-map.json
- token-map.json
- typography-map.json
- asset-map.json
- ui-implementation-rules.md
- design-gap-summary.md
- ArtifactRef entries in Run

## Non-goals

- No UI implementation
- No CSS modification
- No token generation in source code
- No visual diff
- No Playwright execution
- No Design/UI Agent execution

## Rules

- Prefer Code Connect mappings when present.
- Prefer existing design-system components over new components.
- Missing mappings become design gaps.
- Figma-only states are not invented.
- Unmapped tokens must not become arbitrary hard-coded values.
- UI Agent must later consume the generated contract.

## Definition of Done

- Design contract model exists.
- Project design-system scanner exists.
- Component/token/typography/asset mapping is generated.
- Design gaps are generated for unmapped items.
- UI implementation rules are generated.
- MCP tool can generate design contract.
- Skill explains how to run the workflow.
