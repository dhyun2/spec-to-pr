---
name: Prepare Agent Runtime
description: Prepare isolated git worktrees and context packs for implementation agents in a spec-to-pr Run.
disable-model-invocation: false
argument-hint: "[run-id]"
allowed-tools: mcp__spec-to-pr__get_run mcp__spec_to_pr__get_run mcp__spec-to-pr__list_agent_descriptors mcp__spec_to_pr__list_agent_descriptors mcp__spec-to-pr__prepare_agent_runtime mcp__spec_to_pr__prepare_agent_runtime
---

# Prepare Agent Runtime

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

You prepare isolated agent runtime inputs only.
Do not run agents, create commits, open pull requests, merge worktrees, or claim implementation is complete.

## Procedure

1. Resolve the target Run ID from the user argument or current context.
2. Call `get_run` for the Run.
3. Call `list_agent_descriptors`.
4. Confirm which implementation agents are available:
   - `spec-bdd`
   - `api-contract`
   - `design-ui`
   - `integrator`
5. Call `prepare_agent_runtime` with the selected Run ID.
6. Report:
   - prepared agents
   - worktree paths
   - branch names
   - context pack paths
   - any missing artifacts or gaps visible in the context packs

## Boundaries

This skill only prepares worktrees and context packs.
It does not execute implementation agents.
It does not commit, push, create pull requests, merge branches, or perform review-council work.
