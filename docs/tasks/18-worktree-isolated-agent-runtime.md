# Task 18 — Worktree-Isolated Agent Runtime

## Goal

Prepare isolated Git worktrees and context packs for future implementation agents.

## Why this task exists

Spec, API, UI, and integration agents must not write to the same working tree at the same time.

Each agent needs:

- a stable base commit
- a dedicated worktree
- a scoped context pack
- a file ownership policy
- explicit allowed commands
- a deterministic result contract

## Inputs

- Run ID
- Run projectRoot
- Run baseCommit or current HEAD
- OpenSpec artifacts
- Gherkin/test matrix artifacts
- API pipeline artifacts
- Figma design contract artifacts

## Outputs

- agent runtime report
- agent descriptors
- context pack files
- Git worktrees
- Run artifacts referencing context packs and runtime report

## Non-goals

- No actual LLM agent execution
- No Spec/BDD implementation
- No API implementation
- No UI implementation
- No integration merge
- No PR creation

## Definition of Done

- Agent descriptors exist.
- File ownership policies exist.
- Context packs are generated.
- Git worktrees can be created and listed.
- Worktrees are created from a fixed base commit.
- Existing user changes are not modified.
- MCP tools prepare and inspect agent runtime.
- Skill `/spec-to-pr:prepare-agent-runtime` exists.
