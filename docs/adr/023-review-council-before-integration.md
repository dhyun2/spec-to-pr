# ADR-023: Review Council Before Integration

## Status

Accepted

## Context

Spec/BDD, API Contract, and Design/UI agents work in separate lanes. Each agent can produce a valid AgentResult, but cross-lane contradictions can still exist.

Examples:

- UI claims a state that Figma did not define.
- API wrapper uses an operation that OpenAPI intake did not find.
- Spec scenario has no implementation evidence.
- A requirement has an open blocker gap but is marked complete.
- An agent modified files outside its ownership boundary.

## Decision

Add a Review Council stage before integration and repair.

Review Council performs:

- deterministic prechecks
- semantic cross-review using a subagent
- structured findings
- requirement verdicts
- contradiction matrix
- gap ledger updates

## Consequences

Good:

- False completion claims are caught before integration.
- Gaps remain visible and first-class.
- Integration receives reviewed and classified inputs.
- PR report can include review council findings.

Tradeoffs:

- Adds one more stage before integration.
- Requires structured context packs.
- Semantic review still needs deterministic validation before persistence.
