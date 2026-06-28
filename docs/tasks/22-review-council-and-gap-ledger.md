# Task 22 — Review Council and Gap Ledger

## Goal

Cross-review Spec/BDD, API Contract, and Design/UI Agent outputs and update the Gap Ledger with evidence-backed findings.

## Why this task exists

Implementation Agent results are not sufficient by themselves.

The system needs to determine whether:

- implemented claims are backed by source evidence
- API work only uses documented OpenAPI operations
- UI work follows Figma design contract
- tests cover generated Gherkin scenarios
- open gaps contradict completion claims
- agents changed files outside their ownership
- requirements are ready, partial, blocked, or rejected

## Inputs

- Run ID
- Traceability Matrix
- OpenSpec change manifest
- Gherkin index and test matrix
- API intake and API pipeline artifacts
- Figma design contract and inventory artifacts
- Spec/BDD AgentResult
- API Contract AgentResult
- Design/UI AgentResult
- existing Gap Ledger

## Outputs

- ReviewCouncilContextPack
- ReviewCouncilResult
- ReviewCouncilReport Artifact
- Contradiction Matrix Artifact
- new or updated Gap entries
- VerificationAgentResult for `review-council`

## Non-goals

- No product code changes
- No API wrapper changes
- No UI implementation changes
- No test execution
- No visual regression execution
- No PR publishing
- No automatic merge readiness finalization

## Rules

- Review Council must not modify product source files.
- Review Council may open new gaps.
- Review Council may not resolve a gap without resolution artifacts.
- Requirement verdicts must cite evidence, gaps, or findings.
- Accepted implementation claims must have artifact/check evidence.
- Missing evidence must become a finding or gap.
- Open blocker gaps prevent accepted verdict.

## Definition of Done

- Review finding model exists.
- Requirement verdict model exists.
- Contradiction matrix model exists.
- Deterministic prechecks run.
- Review context pack is generated.
- Review Council subagent is available.
- Review Council result can be recorded.
- Review report artifact is added to Run.
- New gaps can be appended to Run.
- MCP stdio test covers review council flow.
