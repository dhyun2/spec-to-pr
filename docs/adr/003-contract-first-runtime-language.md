# ADR-0003: Contract-first Runtime Language

## Status

Accepted

## Context

The final plugin will coordinate multiple agents:

- Spec/BDD Agent
- API Contract Agent
- Design/UI Agent
- Integrator
- Review Council
- Evidence Verifier
- PR Publisher

If agents report completion in natural language, the system cannot reliably determine whether work was actually completed.

Examples of unreliable statements:

- "Implemented"
- "Tests passed"
- "Figma matched"
- "API connected"

These statements do not include source evidence, generated artifacts, command results, exit codes, gap status, or commit identity.

## Decision

Define shared runtime contracts before implementing any domain agent.

The contracts are:

- Source
- Evidence
- Artifact
- Check
- Decision
- Gap
- AgentResult

AgentResult is split into:

- implementation result
- verification result
- publishing result

Each role has a different success contract.

## Rationale

Implementation agents must produce code and commits.
Verification agents must produce reports and should not modify files.
Publishing agents must produce PR/MR URLs and PR report artifacts.

A single untyped result shape would either be too weak or would force every role to provide irrelevant fields.

## Consequences

Good:

- Agent output becomes machine-verifiable.
- Completion claims require evidence.
- Gaps become first-class artifacts.
- Future PR reports can be generated from structured data.
- Future Run aggregate can enforce reference integrity.

Tradeoffs:

- Initial development is slower.
- Some schemas are stricter than early prototypes need.
- JSON Schema export cannot fully represent every cross-field invariant, so runtime validation remains necessary.
