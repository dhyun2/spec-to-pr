---
name: Figma Intake
description: Register a Figma URL and record available Figma MCP outputs into a spec-to-pr Run.
disable-model-invocation: true
argument-hint: "[run-id] [figma-url]"
allowed-tools: mcp__spec-to-pr__register_figma_source mcp__spec-to-pr__record_figma_metadata mcp__spec-to-pr__record_figma_design_context mcp__spec-to-pr__record_figma_screenshot mcp__spec-to-pr__record_figma_variable_defs mcp__spec-to-pr__record_figma_code_connect_map
---

# Figma Intake

This skill records Figma evidence only. It does not implement UI and does not run visual regression.

## Procedure

1. Call `register_figma_source` with the Run ID and Figma URL.
2. Use the selected provider policy from Task 09.
3. Call available Figma MCP tools externally:
   - get_metadata
   - get_design_context
   - get_screenshot
   - get_variable_defs
   - get_code_connect_map
4. Pass each output into the corresponding spec-to-pr recording tool.
5. Report the Source ID and created Artifact IDs.

## Boundaries

Do not claim design-system inventory is complete.
Do not claim Figma parity is complete.
