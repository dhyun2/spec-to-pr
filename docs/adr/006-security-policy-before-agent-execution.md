# ADR-006: Security Policy Before Agent Execution

## Status

Accepted

## Context

The final plugin will execute code generation, tests, build commands, browser automation, API generation, and PR publication.

If command and path policies are added after the agent runtime, unsafe assumptions can leak into many layers.

External documents such as briefs, OpenAPI descriptions, and Figma text must be treated as untrusted data.

## Decision

Implement a policy layer before implementing the real agent runtime.

The policy layer includes:

- path validation
- command classification
- secret redaction
- untrusted content wrappers
- audit logging

## Rationale

Agents should not directly decide whether a path or command is safe.

The deterministic policy layer must decide:

- allowed
- requires approval
- denied

## Consequences

Good:

- Unsafe behavior is rejected early.
- Later command runners can be built on a fixed policy contract.
- Prompt injection content is kept separate from instructions.
- Audit records are structured.

Tradeoffs:

- Early implementation takes longer.
- Some useful commands may be blocked until allowlisted.
- Approval flow is not implemented yet, only represented as a verdict.
