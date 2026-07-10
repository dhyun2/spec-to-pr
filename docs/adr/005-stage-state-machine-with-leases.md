# ADR-005: Stage State Machine with Leases

## Status

Accepted

## Context

Task 03 stores Runs durably, but Stage states are only static values.

A real automation workflow needs controlled transitions and protection against stale workers.

Without leases, this can happen:

1. Worker A starts `api-contract`.
2. Worker A times out.
3. Worker B restarts `api-contract`.
4. Worker A later submits success.
5. Worker A overwrites Worker B's newer result.

## Decision

Use a deterministic state machine and lease-based ownership for running stages.

A running stage has:

- lease id
- worker id
- acquiredAt
- heartbeatAt
- expiresAt

Only the current lease holder can update the running stage.

Expired leases can be reclaimed.

## Consequences

Good:

- Stale worker results are rejected.
- Resume planning can detect expired work.
- Stage retries become explicit.
- Later agent runtime can rely on a deterministic state layer.

Tradeoffs:

- Every stage update needs worker and lease metadata.
- Clock skew can affect lease expiry if multiple machines are involved.
- Task 04 still does not execute agents; it only controls state.
