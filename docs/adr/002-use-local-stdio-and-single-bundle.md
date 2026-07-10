# ADR-0002: Use Local stdio MCP and a Single Bundle

## Status

Accepted

## Context

The plugin runs inside Claude Code as a local extension. It does not need to expose an HTTP port for Task 01.

## Decision

Use MCP stdio transport and bundle the server to:

dist/mcp/server.js

The plugin .mcp.json runs:

node ${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js

## Rationale

- No port management
- No local HTTP authentication in Task 01
- Lower setup cost
- Easier plugin distribution
- No node_modules in plugin zip
- stdout reserved for MCP protocol
- stderr used for operational logs

## Consequences

The server is local-only. Future remote control or dashboard features may introduce Streamable HTTP as a separate adapter.
