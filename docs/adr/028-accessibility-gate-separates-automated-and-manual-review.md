# ADR-028: Accessibility Gate Separates Automated and Manual Review

## Status

Accepted

## Context

Automated accessibility tools can catch many issues, but they cannot prove all user-facing accessibility outcomes.

Examples requiring manual or guided review:

- whether screen reader flow is understandable
- whether focus order matches task flow
- whether accessible names are meaningful
- whether keyboard shortcuts and escape routes are discoverable

## Decision

Task 27 separates accessibility results into:

- automated checks
- guided keyboard/focus checks
- manual review items
- reviewer triage

Automated check results decide automated gate pass/fail. Manual review items must be reported as `not-run`, `required`, or `completed`.

## Consequences

Good:

- The plugin does not overclaim accessibility compliance.
- Reviewers can see exactly what was automated and what still needs human review.
- Serious violations become first-class Gaps.

Tradeoffs:

- The Accessibility Gate may report `review-needed` even when automated checks pass.
- Manual review remains outside full automation.
