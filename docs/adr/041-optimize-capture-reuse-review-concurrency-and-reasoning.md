# ADR 041: Optimize Capture, Evidence Reuse, Review Concurrency, and Reasoning

- Status: Accepted
- Date: 2026-07-30

## Context

Feature delivery currently separates implementation-time E2E/video/performance collection from
post-packet visual capture, which structurally repeats Playwright. Evidence replay is bound to the
complete HEAD and diff rather than the evidence's actual dependencies. Review concurrency is
workload-gated, and the SDK applies one reasoning effort to the complete coordinator thread.

The optimization must preserve the seven public workflow tools, eight durable stages, immutable
review packets, the existing quality gates, one implementation writer, and independent read-only
reviewers. It must not require an intermediate implementation submission.

## Decision

Adopt the design in
[`docs/architecture/runtime-execution-optimization.md`](../architecture/runtime-execution-optimization.md).

Specifically:

1. A candidate-bound `capture-session-v1` collects all required browser evidence through zero or
   one Playwright CLI invocation per candidate. The normal implementation submission verifies the
   candidate and projects the session into current-packet visual receipts.
2. Evidence reuse uses typed dependency fingerprints and verified carry-forward receipts.
   Reviewer freshness remains bound to the complete current packet. Final reviewer verdicts are
   not reused, and visual comparison is recomputed from any reused captures.
3. Visual comparison and functional review begin together for every workload. A passing visual
   result exposes design review immediately. Packet-scoped review results are buffered and applied
   as one review-cycle outcome.
4. The selected model is stage-routed: coordinator boundaries use medium reasoning, while
   implementation and review use high reasoning. Development and validation of this change use
   `gpt-5.6-terra`.

This supersedes the workload-gated reviewer-concurrency decision in ADR 038. It does not change
deadlines, workload estimation, deterministic preflight, or publication.

## Consequences

- Feature browser startup, navigation, fixture setup, video recording, and evidence reporting are
  shared rather than repeated.
- Repairs rerun only evidence whose dependency fingerprint changed.
- Review latency approaches the longest applicable branch rather than the sum of all reviews.
- Parallel review findings are not lost when one reviewer requests changes.
- Mechanical coordinator turns use less reasoning while code and review decisions retain high
  reasoning.
- Capture-session binding, fingerprint calculation, and review-result buffering add internal
  schemas and tests, but no public MCP tool or durable stage.
