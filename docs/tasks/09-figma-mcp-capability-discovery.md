# Task 09 - Figma MCP Capability Discovery

## Goal

Record available Figma MCP providers and their capabilities before any Figma design intake happens.

## Why This Task Exists

The plugin must not assume that a specific Figma MCP provider is available. Claude Code may have local desktop Figma MCP, remote Figma MCP, plugin-specific Figma tools, or none of them.

Before recording Figma metadata, screenshots, variables, or Code Connect mappings, the Run ledger must know:

- which providers are available
- which tools each provider exposes
- which provider should be primary for each purpose
- which required capabilities are missing

## Non-Goals

- No direct Figma MCP calls from spec-to-pr server
- No Figma URL parsing
- No screenshot recording
- No design system inventory
- No visual diff
- No UI code generation

## Provider Kinds

- local-desktop
- remote
- plugin
- unknown

## Required Capabilities

- metadata
- design-context
- screenshot
- variable-defs
- code-connect-map

## Definition of Done

- Figma capability report schema exists.
- Provider policy schema exists.
- Capability report can be recorded as an artifact.
- Provider policy can be derived and queried.
- Missing required capabilities create design gaps.
- MCP tools expose capability recording and policy retrieval.
