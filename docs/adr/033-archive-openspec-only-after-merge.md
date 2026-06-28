# ADR-033: Archive OpenSpec Only After Merge

## Status

Accepted

## Context

OpenSpec change folders represent proposed work. Once the corresponding code is merged, the change should be archived so current specs represent the new source of truth and the change history is preserved.

Archiving before merge can hide context from reviewers and mark unfinished work as completed.

## Decision

Task 32 archives OpenSpec changes only after the linked PR/MR is confirmed merged.

The workflow is split into:

1. verify merge state
2. plan archive
3. optional reviewer check
4. execute archive
5. record result
6. optional follow-up commit or PR

Archive execution is explicit and records plan, result, report, and command logs as Run artifacts.

## Consequences

Good:

- Active changes do not linger after merge.
- Specs stay synchronized with implementation.
- Audit trail is preserved.
- Archive is not performed prematurely.

Tradeoffs:

- Requires publisher result or explicit merge-state evidence.
- Requires user-triggered skill.
- Archive may need a follow-up commit if the merge branch is closed.
