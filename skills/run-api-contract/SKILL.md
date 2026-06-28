---
name: Run API Contract Agent
description: Prepare and run the API Contract Agent lane for a spec-to-pr Run.
disable-model-invocation: true
argument-hint: "<run-id> <worktree-path> <base-sha>"
allowed-tools: mcp__spec-to-pr__prepare_api_contract_agent mcp__spec-to-pr__get_api_contract_agent_context mcp__spec-to-pr__record_api_contract_agent_result mcp__spec-to-pr__get_run
---

# Run API Contract Agent

You run the API Contract Agent lane.

## Inputs

Expected arguments:

```text
<run-id> <worktree-path> <base-sha>
```

- `run-id` is the spec-to-pr Run ID.
- `worktree-path` is the API agent worktree prepared by the agent runtime.
- `base-sha` is the commit SHA the agent starts from.

## Procedure

1. Call `mcp__spec-to-pr__prepare_api_contract_agent` with:
   - `runId`
   - `worktreePath`
   - `baseSha`
2. Read the returned `contextPackPath`.
3. Invoke the `api-contract` subagent.
4. Instruct the subagent to read:
   - `context.json`
   - `instructions.md`
   - `ownership-policy.json`
   - `api-evidence.json`
   - `api-gaps.json`
   - `api-artifacts.json`
5. The subagent must work only inside the API agent worktree.
6. The subagent must return an implementation AgentResult.
7. Call `mcp__spec-to-pr__record_api_contract_agent_result` with:
   - `runId`
   - `contextArtifactId`
   - `result`
8. Call `mcp__spec-to-pr__get_run` to confirm the result was recorded.

## What the Agent should do

The API Contract Agent should:

- inspect OpenAPI evidence
- inspect API gaps
- inspect API pipeline artifacts
- run or respect project API generator policy
- create or update feature/entity API wrappers
- create or update API mappers
- create or update Zod schemas when required
- create or update mocks
- create or update contract tests
- create or update source guard tests
- avoid UI implementation files

## What the Agent must not do

The API Contract Agent must not:

- invent undocumented endpoints
- create UI screens
- modify Figma artifacts
- mark failed checks as passed
- hide API gaps
- manually edit generated files unless policy explicitly allows it

## Report

Return:

- context artifact ID
- changed files
- commit SHA if passed
- checks run
- gaps opened or preserved
- decisions made

## Important Boundaries

This Skill does not merge the API agent worktree.

Integration happens later in the integration task.
