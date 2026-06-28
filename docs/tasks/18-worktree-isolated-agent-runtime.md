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

## Implemented Components

- `src/agent-runtime/agent-descriptor.ts`
- `src/agent-runtime/file-ownership-policy.ts`
- `src/agent-runtime/context-pack.ts`
- `src/agent-runtime/command-runner.ts`
- `src/agent-runtime/worktree-manager.ts`
- `src/agent-runtime/agent-runtime-report.ts`
- `src/application/agent-runtime-service.ts`
- `skills/prepare-agent-runtime/SKILL.md`

## MCP Tools

- `list_agent_descriptors`
- `prepare_agent_runtime`
- `create_agent_worktree`
- `get_agent_context_pack`
- `list_agent_worktrees`
- `cleanup_agent_worktree`

## Verification

- `pnpm typecheck`
- `pnpm build`
- `pnpm vitest run tests/unit/agent-descriptor.test.ts tests/unit/file-ownership-policy.test.ts tests/unit/context-pack.test.ts tests/integration/worktree-manager.test.ts tests/integration/agent-runtime-service.test.ts`
- `pnpm vitest run tests/integration/mcp-stdio.test.ts`

## Limitations

- The runtime prepares worktrees and context packs only.
- It does not run implementation agents.
- It does not commit, push, merge, or create pull requests.
- Worktrees are created from the Run base commit when present, otherwise from current `HEAD`.
- Cleanup removes one prepared agent worktree at a time.
