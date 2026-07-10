# ADR-0004: Run as Aggregate Root with SQLite Snapshot Persistence

## Status

Accepted

## Context

Task 02 defines runtime contract fragments, but those fragments do not enforce cross-object integrity by themselves.

For example:

- Evidence can reference a Source ID that is not present.
- Artifact can reference Evidence that does not exist.
- Gap can claim to be resolved by an Artifact that is not in the Run.
- AgentResult can belong to another Run.
- Concurrent updates can overwrite each other.

The plugin needs a durable execution ledger that survives process restarts and acts as the consistency boundary.

## Decision

Use `Run` as the aggregate root.

A Run owns:

- sources
- evidence
- artifacts
- gaps
- agentResults
- stages

Persist the full Run Manifest as a JSON snapshot in SQLite.

Use a summary table for lightweight list operations.

Use revision-based optimistic concurrency for updates.

## Why not event sourcing yet?

Event sourcing would store events such as:

- RunCreated
- SourceAdded
- EvidenceCaptured
- GapOpened
- ArtifactProduced
- StagePassed

This is valuable later, but Task 03 only needs durable snapshots and reference integrity.

Starting with event sourcing would increase complexity before stage execution and agent submission exist.

## Consequences

Good:

- Run becomes the single source of truth.
- Cross-object references can be validated.
- State survives Claude Code restarts.
- Stale updates can be rejected.
- Storage implementation is hidden behind RunStore.

Tradeoffs:

- Whole Run JSON is rewritten per save.
- Querying nested objects is less efficient than normalized tables.
- Event history is not available yet.
