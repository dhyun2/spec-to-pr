# Task 20 — API Contract Agent Lane

## Goal

Create the API Contract Agent lane on top of the worktree-isolated agent runtime.

## Why this task exists

The plugin needs an API-focused implementation agent that can use OpenAPI evidence, API pipeline artifacts, and traceability data without inventing undocumented API behavior.

## Inputs

- Run ID
- Project profile
- OpenAPI intake report
- API pipeline artifact
- Traceability matrix
- Gherkin test matrix
- Worktree agent runtime context

## Outputs

- API Contract Agent context pack
- API file ownership policy
- API Contract AgentResult
- API wrapper/schema/mock/contract-test changes in the agent worktree
- API gaps when implementation is blocked

## Non-goals

- No UI implementation
- No Design/UI Agent
- No Review Council
- No integration merge
- No PR publishing
- No live API calls

## Rules

- Do not invent endpoints not found in OpenAPI evidence.
- Do not directly import generated client from UI.
- Generated files must not be manually edited unless the project already allows it.
- Feature/entity API wrappers must be used.
- Missing API contract details must become API gaps.
- Passed implementation results require commitSha.
- Changed files must satisfy API ownership policy.

## Definition of Done

- API Contract Agent context pack can be prepared.
- API Contract Agent instructions exist.
- Skill `/spec-to-pr:run-api-contract` exists.
- Agent result validation rejects non-API file changes.
- Agent result validation rejects passed result without commitSha.
- Agent result validation rejects failed checks in passed result.
- MCP tools work through stdio integration tests.

## Implemented Components

- `agents/api-contract.md`
- `skills/run-api-contract/SKILL.md`
- `src/api-agent/api-contract-agent-contracts.ts`
- `src/api-agent/api-contract-context-builder.ts`
- `src/api-agent/api-contract-result-validator.ts`
- `src/application/api-contract-agent-service.ts`

## MCP Tools

- `prepare_api_contract_agent`
- `get_api_contract_agent_context`
- `record_api_contract_agent_result`

## Verification

Run:

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

Expected:

- API Contract Agent context builder tests pass
- API Contract Agent result validator tests pass
- ApiContractAgentService integration tests pass
- MCP stdio integration can call:
  - `prepare_api_contract_agent`
  - `get_api_contract_agent_context`
  - `record_api_contract_agent_result`

## Known Limitations

- This task does not merge the API agent worktree.
- This task does not run the API agent automatically outside Claude Code.
- Live API calls are not performed.
- Review Council does not run yet.
- Integration and repair happen later.
- API checks are recorded by the agent but full quality gates run later.
