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
