# ADR-022: Design/UI Agent Consumes Design Contract

## Status

Accepted

## Context

The plugin has collected Figma evidence and generated a design contract. It now needs a UI implementation lane.

A generic coding agent is not safe enough because it may:

- ignore design-system components
- hardcode colors or spacing
- import generated API clients from UI
- break FSD boundaries
- invent missing Figma states
- skip empty/loading/error states

## Decision

Introduce a dedicated Design/UI Agent Lane.

The lane provides:

- a design-ui subagent descriptor
- a run-design-ui Skill
- a scoped context pack
- worktree ownership policy
- forbidden import policy
- structured result recording

## Consequences

Good:

- UI implementation is grounded in Figma and OpenSpec evidence.
- Design-system usage becomes explicit.
- FSD and API boundaries are enforced.
- Missing design evidence becomes a gap instead of guessed implementation.

Tradeoffs:

- The agent can only work within allowed paths.
- Some implementation requests may be blocked until API/design gaps are resolved.
- Visual scoring is deferred to a later task.

## Implementation Notes

The lane records a durable context pack artifact so a later agent or operator can reload the same Design/UI instructions by Run ID and change name. The prepare step derives default artifacts from the Run when explicit artifact IDs are not provided, while still accepting explicit IDs for deterministic orchestration.

The result recorder validates Design/UI `AgentResult` payloads before appending them to the Run. It rejects changes outside UI-owned globs and scans changed files for direct generated-client, HTTP-client, OpenAPI, or `fetch` usage.

## Deferred Decisions

- Visual evidence comparison remains outside this lane.
- Repair loops and merge orchestration remain outside this lane.
- Final UI acceptance should be handled by later verification and integration tasks.
