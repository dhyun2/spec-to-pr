# ADR-020: Spec/BDD Agent Uses Context Pack and Run Ledger

## Status

Accepted

## Context

The plugin now has evidence, OpenSpec, Gherkin, and test matrix artifacts.

A Spec/BDD Agent must review these artifacts, but it should not receive the entire repository or unbounded chat context.

## Decision

Prepare a scoped Spec/BDD context pack for the agent.

The context pack contains:

- run metadata
- OpenSpec change paths
- requirement summary
- Gherkin index
- test matrix summary
- evidence summary
- gap summary
- allowed write paths
- expected output contract

The Spec/BDD Agent writes only approved artifacts and returns a structured result.

## Consequences

Good:

- The agent has bounded context.
- The output is easier to validate.
- The Run ledger records artifacts and decisions.
- Later Review Council can audit Spec/BDD output.

Tradeoffs:

- The agent may need follow-up context if the pack is incomplete.
- The lane prepares work but does not execute tests yet.

## Implementation Notes

The first Spec/BDD lane implementation exposes three MCP tools:

- `prepare_spec_bdd_agent`
- `get_spec_bdd_agent_context`
- `record_spec_bdd_agent_result`

The service writes context packs under `.spec-to-pr/runs/<run-id>/agents/spec-bdd/<change-name>/`.

The record step writes review reports under `openspec/changes/<change-name>/artifacts/`,
creates acceptance skeletons under `tests/acceptance/generated/<change-name>/`, and appends a
validated `ImplementationAgentResult` for `agent: spec-bdd` to the Run ledger.

## Deferred Decisions

- The service does not directly invoke the subagent.
- Acceptance skeleton files are non-executable markdown until a later test implementation task.
- Review Council validation remains a later lane.
