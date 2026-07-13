# ADR 036: Use Delivery Profiles, Not Mode-Specific Pipelines

## Status

Accepted — 2026-07-13

## Context

SpecToPR must support brief-to-PR, legacy-change-to-PR, user-facing feature-to-PR with targeted E2E video, and Figma-to-implementation. Building four pipelines would reintroduce duplicated agents, stages, tools, and policy drift removed by the v2 facade.

## Decision

Intake records one delivery profile on the existing Run. The profile identifies the mode, change kind, publication intent, and conditional evidence requirements. All modes continue through the same eight stages and seven public MCP tools.

Feature E2E and video are required only for a user-facing feature profile. Figma intake uses the host's connected Figma capability and the existing `workflow_submit` boundary. API contracts, mocks, and UI remain in one implementation context. Functional and design review remain the only independent reviewer roles.

## Consequences

- Adding an entry mode does not add a pipeline, MCP tool, durable stage, or agent lane.
- Evidence stays proportional to the requested change.
- Figma provider details remain outside the runtime facade.
- Draft publication can report missing mode-specific evidence deterministically.
