---
name: Doctor
description: Verify that the spec-to-pr plugin and local MCP kernel are installed and reachable.
disable-model-invocation: false
argument-hint: "[echo-message]"
allowed-tools: mcp__spec-to-pr__kernel_info mcp__spec-to-pr__kernel_ping
---

# Spec to PR Doctor

You verify only the Task 01 plugin shell.

## Inputs

The optional argument is a short echo message for the ping test.
If no argument is provided, use `doctor`.

## Procedure

1. Call `mcp__spec-to-pr__kernel_info`.
2. Confirm:
   - pluginName is `spec-to-pr`
   - transport is `stdio`
   - runtime.name is `node`
   - runtime.minimumMajor is at least 22
   - tools includes `kernel_info`
   - tools includes `kernel_ping`
3. Call `mcp__spec-to-pr__kernel_ping` with the provided echo message.
4. Confirm:
   - `ok` is true
   - `echo` matches the provided message
   - `contractVersion` matches the kernel info contract version

## Report Format

Return:

- Plugin version
- Contract version
- Transport
- Runtime requirement
- Registered tools
- Ping result

## Important Boundaries

Do not claim that any of the following is implemented:

- brief parsing
- OpenSpec generation
- Figma ingestion
- OpenAPI ingestion
- agent execution
- Run persistence
- tests generated from requirements
- visual regression
- pull request publishing

Task 01 only proves plugin loading and MCP connectivity.
