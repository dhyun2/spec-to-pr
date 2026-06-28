# ADR-019: Worktree-Isolated Agent Runtime

## Status

Accepted

## Context

The plugin will later run multiple implementation agents:

- Spec/BDD Agent
- API Contract Agent
- Design/UI Agent
- Integrator

If these agents share one working tree, their changes can conflict and stale updates can overwrite newer work.

## Decision

Use Git worktrees to isolate agent work.

Each agent gets:

- its own branch
- its own worktree path
- its own context pack
- its own file ownership policy

## Why Git Worktree?

Git worktree allows multiple working trees attached to one repository. This lets agents work on different branches without repeatedly cloning the repository.

## Consequences

Good:

- Agent changes are isolated.
- Stale results are easier to detect.
- Integration can cherry-pick or merge controlled outputs.
- File ownership can be enforced per worktree.

Tradeoffs:

- Worktree cleanup is required.
- Branch naming must be deterministic.
- Some repositories with submodules may need extra handling.

## Implementation Notes

The first implementation exposes preparation through MCP tools, not agent execution.

The service writes:

- context packs under `.spec-to-pr/context-packs/<run-id>/<agent>/`
- runtime reports under `.spec-to-pr/agent-runtime/<run-id>/`
- worktrees under `.spec-to-pr/worktrees/<run-id>/<agent>/`

The command runner is intentionally limited to `git` commands needed for repository detection,
`HEAD` resolution, worktree creation, listing, removal, and pruning.

## Deferred Decisions

- Agent process execution is intentionally deferred.
- Review council orchestration is intentionally deferred.
- Commit, push, pull request, and merge behavior is intentionally deferred.
