---
name: Run Design UI Agent
description: Prepare and run the Design/UI agent lane for a spec-to-pr Run.
disable-model-invocation: true
argument-hint: "<run-id> <change-name>"
allowed-tools: mcp__spec-to-pr__prepare_design_ui_agent mcp__spec-to-pr__get_design_ui_agent_context mcp__spec-to-pr__record_design_ui_agent_result mcp__spec-to-pr__get_run
---

# Run Design/UI Agent

You prepare the Design/UI Agent lane and instruct the `design-ui` subagent to implement UI changes.

## Inputs

Expected arguments:

```text
<run-id> <change-name>
```

## Why this Skill exists

This workflow has side effects:

- it prepares an agent context pack
- it uses an isolated worktree
- it may modify UI files
- it records structured agent results

Therefore it must be user-invoked and must not run automatically.

## Procedure

1. Call `mcp__spec-to-pr__prepare_design_ui_agent` with:
   - `runId`
   - `changeName`

2. Read the returned context:
   - worktree path
   - context pack path
   - allowed files
   - forbidden imports
   - expected output schema

3. Call `mcp__spec-to-pr__get_design_ui_agent_context` if the context summary is not enough.

4. Invoke the `design-ui` subagent.

5. Tell the subagent to:
   - read the context pack
   - write an implementation plan
   - implement only allowed files
   - use design-system components and tokens
   - call only feature/entity API wrappers
   - avoid generated client or fetch imports in UI
   - add tests/fixtures/stories as requested
   - return a structured AgentResult

6. After the subagent finishes, call `mcp__spec-to-pr__record_design_ui_agent_result`.

7. Call `mcp__spec-to-pr__get_run` to confirm the result was recorded.

## Report

Return:

- run ID
- change name
- worktree path
- context pack path
- changed files
- checks
- decisions
- gaps
- status

## Boundaries

Do not claim visual regression passed.
Do not claim accessibility passed.
Do not claim integration succeeded.
Do not claim PR is ready.

Those are later tasks.
