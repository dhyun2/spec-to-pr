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
