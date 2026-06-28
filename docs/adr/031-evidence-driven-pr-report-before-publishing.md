# ADR-031: Evidence-driven PR Report Before Publishing

## Status

Accepted

## Context

The final plugin must publish PRs or MRs. However, publishing should not be mixed with report generation.

The report must be generated and reviewed before it is sent to GitHub or GitLab.

## Decision

Task 30 generates PR/MR body artifacts but does not publish them.

Task 31 handles GitHub/GitLab publishing.

## Rationale

Separating report generation from publishing makes failures easier to isolate:

- report generation failure
- evidence inconsistency
- GitHub/GitLab API failure
- permission failure

It also allows a reviewer to inspect the generated body before publishing.

## Consequences

Good:

- Report is deterministic.
- Publishing is optional and separate.
- PR body can be tested with golden snapshots.
- Review agent can flag inconsistencies before publishing.

Tradeoffs:

- One extra workflow step is required.
- Report artifact may become stale if Run changes after generation.
