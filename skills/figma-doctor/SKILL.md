---
name: Figma Doctor
description: Discover available Figma MCP providers and record their capabilities in a spec-to-pr Run.
disable-model-invocation: true
argument-hint: "[run-id]"
allowed-tools: mcp__spec-to-pr__record_figma_mcp_capabilities mcp__spec-to-pr__get_figma_provider_policy
---

# Figma Doctor

You verify Figma MCP capability only. Do not claim that Figma design intake or UI implementation is complete.

## Procedure

1. Inspect the tools available in the current Claude Code session.
2. Identify Figma-related MCP tools.
3. Group them by provider if provider namespace is visible.
4. Prefer these provider kinds when inferable:
   - local-desktop
   - remote
   - plugin
   - unknown
5. Call `mcp__spec-to-pr__record_figma_mcp_capabilities` with the observed providers and raw tool names.
6. Call `mcp__spec-to-pr__get_figma_provider_policy`.
7. Report:
   - available providers
   - important tools found
   - missing capabilities
   - selected provider policy

## Boundaries

Do not call Figma design tools in this skill unless explicitly instructed.
This skill records capability only.
