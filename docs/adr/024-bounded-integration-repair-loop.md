# ADR-024: Bounded Integration Repair Loop

## Status

Accepted

## Context

Agent outputs are produced in isolated Git worktrees. They may pass local checks but fail when combined.

Common integration problems:

- cherry-pick conflicts
- import path mismatches
- type changes from API agent not reflected in UI agent
- OpenSpec/Gherkin ID mismatch
- source guard violations
- small lint or formatting issues

Allowing an AI agent to repair indefinitely is unsafe.

## Decision

Use a dedicated integration worktree and a bounded repair loop.

The integration service applies approved agent commits in deterministic order. If integration fails, it creates a conflict report and allows a limited number of repair attempts by the integrator agent.

## Repair Limits

Repair may fix:

- merge conflict markers
- import mismatches
- type reference mismatches
- formatting/lint issues
- small glue code inconsistencies

Repair must not:

- create undocumented API endpoints
- invent missing Figma states
- delete tests to pass checks
- close gaps without evidence
- modify OpenSpec scope without review

## Consequences

Good:

- Agent outputs are integrated safely.
- Repair is auditable.
- Stale or unbounded AI modification is prevented.
- Quality gates run on a single integrated worktree later.

Tradeoffs:

- Some failures require human intervention.
- Bounded repair can stop before all issues are fixed.
- Integration remains separate from full verification.
