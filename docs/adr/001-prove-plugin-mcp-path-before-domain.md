# ADR-0001: Prove Plugin → MCP Path Before Domain Logic

## Status

Accepted

## Context

The final plugin will orchestrate brief parsing, Figma ingestion, OpenAPI code generation, multi-agent implementation, verification, and PR publishing.

Before any domain logic can be trusted, Claude Code must be able to discover the plugin and communicate with the local MCP server.

## Decision

Task 01 implements only a minimal executable plugin shell:

- plugin manifest
- MCP server config
- stdio MCP server
- kernel_info tool
- kernel_ping tool
- doctor skill
- real stdio integration test

## Consequences

Good:

- Packaging errors are discovered early.
- MCP handshake errors are isolated from domain errors.
- The first task has a small, clear definition of done.

Tradeoff:

- No product feature is implemented in Task 01.
