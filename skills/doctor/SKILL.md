---
name: doctor
description: Use when checking whether the spec-to-pr v2 workflow facade is installed, reachable, and exposing the expected contract.
---

# Doctor

Call `workflow_info` and verify:

- contract version is `2.0.0`;
- the advertised tools are exactly the seven workflow facade tools;
- the durable stages are intake, contracts, implementation, functional review, design review, report, publish, and archive;
- reviewer roles are exactly `functional-reviewer` and `design-reviewer`;
- capabilities confirm API readiness before applicable UI evidence, deterministic visual comparison with three total attempts, legacy-derived API inventory, operation-aware coverage, performance evidence, canonical `pr-report-v2.1`, one managed GitHub evidence ref, independent functional review, and UI-only design review.

Report the version, tool inventory, stages, and any mismatch. If the call fails or the contract differs, stop the workflow as blocked; do not emulate missing workflow behavior manually.
