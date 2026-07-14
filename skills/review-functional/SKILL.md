---
name: review-functional
description: Use when code scope reaches the mandatory v2 functional review action and needs an independent evidence-based verdict.
---

# Review Functional

Act as `functional-reviewer`, independently from implementation. Consume the immutable review packet supplied by the orchestrator: `workflow_status` snapshot, accepted contracts, diff, and evidence paths. Do not call workflow tools when delegated. Inspect referenced files and run safe focused checks when evidence is incomplete.

Return a literal JSON-compatible object shaped as `{kind:"functional-review", reviewPacketId, verdict, summary, findings, requirements, artifactPaths, gateResults}`. Copy `reviewPacketId` exactly from the current review action; the orchestrator rejects stale packets. The orchestrator validates the object and calls `workflow_submit`. Approval permits only minor findings and requires every required functional gate to report `passed` with a referenced evidence path and every reviewed `requirementManifest` ID to be accepted. Empty, skipped, failed, or not-run checks never satisfy a required gate.

For API-backed UI, verify that the accepted `api-ready` checkpoint and final implementation use the same `implementationContextId`.

Inspect `guidanceTrace`. Verify every explicit and discovered project-guidance path against changed-file placement, architecture, API and framework conventions, and confirm the applied optional skills were available, applicable, and subordinate to project guidance. An unavailable optional hint that was not applied is not a blocker.

For a `feature` profile, verify one unchained Playwright invocation whose declared selector targets the changed feature and appears as an actual command argument. Require a strict project-local result JSON containing only `status: passed`, a selector exactly equal to `testSelector`, the implementation submission's matching `implementationContextId`, and a positive `testCount`, plus exactly one structurally valid, non-zero-duration WebM or MP4 container no larger than 25 MB. List-only, pass-with-no-tests, chained, broad, or unfiltered E2E commands are changes-requested even if they report success.

Budget pressure never makes a required functional gate optional. Return changes-requested or blocked if a split omits its focused regression evidence or if an implementation reached the hard limit by skipping checks.

Do not edit implementation while reviewing.
