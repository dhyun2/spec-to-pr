# ADR-010: Discover Figma MCP Capabilities Before Figma Intake

## Status

Accepted

## Context

Figma is a critical evidence source for UI implementation. However, available Figma MCP tools may differ between local desktop MCP, remote MCP, and plugin-provided integrations.

A raw Figma URL is not enough. The system must first know what data can be fetched and from which provider.

## Decision

Before Figma source intake, record Figma MCP provider capabilities in the Run ledger.

The spec-to-pr MCP server does not call Figma MCP directly. Claude Code or a Skill discovers available Figma tools and passes the capability report into spec-to-pr.

## Consequences

Good:

- Provider assumptions are avoided.
- Local/remote differences are recorded.
- Missing Figma capability becomes a Gap instead of silent failure.
- Later Figma intake and design-system inventory can choose provider per purpose.

Tradeoffs:

- Requires orchestration instructions in a Skill.
- Capability discovery is only as accurate as the tool availability reported by the host client.
