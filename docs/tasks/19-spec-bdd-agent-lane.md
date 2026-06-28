# Task 19 — Spec/BDD Agent Lane

## Goal

Add the Spec/BDD role-specific agent lane.

The Spec/BDD Agent reviews OpenSpec, Gherkin, Test Matrix, Evidence Summary, and Gap Summary, then produces a Spec/BDD review report and acceptance skeletons.

## Why this task exists

Task 14 and Task 15 generate specs and scenarios deterministically. But before implementation agents use them, a Spec/BDD specialist must check:

- whether OpenSpec requirements match source evidence
- whether Gherkin scenarios over-interpret requirements
- whether requirements with gaps are marked appropriately
- whether acceptance skeletons exist for future test implementation
- whether all Spec/BDD decisions are recorded

## Inputs

- Run ID
- OpenSpec change name
- OpenSpec change files
- change-manifest.json
- gherkin-index.json
- test-matrix.json
- evidence-summary.md
- gap-summary.md

## Outputs

- Spec/BDD context pack
- Spec/BDD review report markdown
- Spec/BDD review report JSON
- acceptance skeleton files
- Spec/BDD AgentResult

## Non-goals

- No API implementation
- No UI implementation
- No test execution
- No Review Council
- No integration merge
- No PR publishing

## Definition of Done

- spec-bdd plugin agent exists
- run-spec-bdd skill exists
- prepare_spec_bdd_agent MCP tool builds context pack
- record_spec_bdd_agent_result MCP tool records result artifacts
- acceptance skeleton files can be written inside project root
- Spec/BDD AgentResult validates against runtime contracts
- stdio MCP test covers prepare/record flow

## Skill Behavior

`/spec-to-pr:run-spec-bdd` is a user-invoked workflow skill.

It exists because users should not manually remember every MCP call required to prepare context, run the Spec/BDD agent, and record results.

The skill:

1. prepares the context pack
2. delegates work to the `spec-bdd` agent
3. instructs the agent to write only allowed files
4. records the result through MCP
5. reports status back to the user

## Agent Behavior

The `spec-bdd` agent reads the context pack and acts as a specification reviewer.

It does not implement product code. It reviews evidence-backed OpenSpec and Gherkin artifacts, writes Spec/BDD review reports, and creates acceptance skeletons.

## Implemented Components

- `agents/spec-bdd.md`
- `skills/run-spec-bdd/SKILL.md`
- `src/spec-bdd/spec-bdd-contracts.ts`
- `src/spec-bdd/spec-bdd-context.ts`
- `src/spec-bdd/spec-bdd-review-renderer.ts`
- `src/spec-bdd/acceptance-skeleton-writer.ts`
- `src/application/spec-bdd-agent-lane-service.ts`

## MCP Tools

- `prepare_spec_bdd_agent`
- `record_spec_bdd_agent_result`
- `get_spec_bdd_agent_context`

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

- agent file exists
- skill file exists
- context pack tests pass
- review renderer tests pass
- service tests pass
- MCP stdio integration can call `prepare_spec_bdd_agent`, `get_spec_bdd_agent_context`, and `record_spec_bdd_agent_result`

## Known Limitations

- The service prepares and records the lane but does not directly execute the subagent.
- Acceptance skeletons are not executable tests.
- Spec/BDD review does not replace Review Council.
- File ownership must still be enforced by the runtime/policy layer.
- Passed implementation AgentResult records the supplied commit SHA, or current/base SHA when no commit SHA is supplied.
