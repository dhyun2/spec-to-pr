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
