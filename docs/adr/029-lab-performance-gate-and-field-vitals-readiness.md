# ADR-029: Lab Performance Gate and Field Vitals Readiness

## Status

Accepted

## Context

The plugin needs to report performance in PR/MR output. Performance has two distinct evidence classes:

- lab results, such as Lighthouse in CI
- field data, such as RUM or CrUX

Treating lab results as field Web Vitals would be misleading.

## Decision

Task 28 separates:

- lab performance gate
- bundle/asset budget gate
- Web Vitals field instrumentation readiness

Lighthouse and bundle checks can pass or fail PR gates.
Field Web Vitals are marked as unavailable unless a real RUM/CrUX artifact exists.

## Consequences

Good:

- PRs can catch performance regressions.
- Reports do not overclaim field data.
- Web Vitals instrumentation can be prepared before production release.

Tradeoffs:

- Lab metrics may not reflect real user p75 values.
- Some routes need fixture data and stable environments.
- Field Web Vitals need later observability or RUM setup.
