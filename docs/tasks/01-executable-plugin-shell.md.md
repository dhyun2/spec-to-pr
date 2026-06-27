# Task 01 - Executable Plugin Shell

## Goal

Prove that Claude Code can discover this plugin, start its MCP server over stdio, list tools, and call a minimal read-only kernel tool.

## Non-goals

- No Run persistence
- No SQLite
- No Source/Evidence/Gap model
- No Figma integration
- No OpenAPI parsing
- No subagent execution
- No PR publishing

## Walking Skeleton

-> plugin.json
-> .mcp.json
-> node dist/mcp/server.js
-> MCP stdio handshake
-> tools/list
-> kernel_info
-> kernel_ping

## Definition of Done

- TypeScript typecheck passes
- Bundle builds
- Plugin layout test passes
- Real MCP stdio integration test passes
- Claude plugin strict validation passes
- Doctor skill exists
