# ADR-007: Profile the Target Repository Before Generation

## Status

Accepted

## Context

Agents that generate code without understanding the target repository often introduce incorrect tools, wrong folder structures, duplicate API clients, or architecture violations.

Examples:

- adding npm commands to a pnpm repository
- creating a new API client when generated clients already exist
- putting UI code into generic components instead of FSD slices
- using Next.js conventions in a Vite app
- bypassing existing design-system components

## Decision

Before specification generation, API wrapper generation, UI implementation, or agent execution, create a ProjectProfile.

The ProjectProfile records repository facts and confidence levels.

## Consequences

Good:

- Agents receive bounded, relevant repository context.
- Existing project conventions are respected.
- Later tasks can make better decisions.
- Ambiguous findings become reviewable profile findings.

Tradeoffs:

- Adds an extra step before code generation.
- Detection is heuristic and must expose confidence.
- Some repositories require manual override.
