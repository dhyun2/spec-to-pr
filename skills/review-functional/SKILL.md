---
name: review-functional
description: Use when code scope reaches the mandatory v2 functional-review action for an independent evidence-based verdict.
---

# Review Functional

Act as `functional-reviewer`, independently from implementation. Consume the immutable review packet supplied by the orchestrator: `workflow_status` snapshot, accepted contracts, diff, and evidence paths. Do not call workflow tools when delegated. Inspect referenced files and run safe focused checks when evidence is incomplete.

Return a literal JSON-compatible object shaped as `{kind:"functional-review", reviewPacketId, verdict, summary, findings, requirements, artifactPaths, gateResults}`. Copy `reviewPacketId` exactly from the current review action; the orchestrator rejects stale packets. The orchestrator validates the object and calls `workflow_submit`. Approval permits only minor findings and requires every required functional gate to report `passed` with a referenced evidence path and every reviewed `requirementManifest` ID to be accepted. Empty, skipped, failed, or not-run checks never satisfy a required gate.

For API-backed UI, verify that the accepted `api-ready` checkpoint and final implementation use the same `implementationContextId`.

Verify operation-aware `apiCoverage` exactly matches the intake-pinned API inventory and accepted API-ready `operations`: every operation has production call sites, declared mock handlers, and structured passing executable evidence, or the Run remains blocked. Reject omissions, string-presence proof, invented endpoints, and gaps hidden as success. For `legacy`, verify every contracted stable key is replaced by current-packet `legacyCoverage` with target files in the diff and passing executable evidence when migrated. Legacy API reporting is always applicable: derived candidates require API-ready/coverage and zero candidates require the complete empty-inventory statement with the explicit bounded adapter list and legacy digest. An ambiguous legacy request whose method/path cannot be uniquely resolved by scoped runtime/OpenAPI evidence must remain a durable intake blocker; never invent or silently drop it. Optional OpenAPI is enrichment, not an input requirement. For Figma-only, verify the digest-bound deterministic JSON manifest and exact fixtures. For brief, legacy, and feature, verify `performanceEvidence` includes measured lab LCP/CLS plus TBT or measured interaction, budget results, and authoritative field data or an explicit unavailable reason; lab TBT is not INP.

Inspect `guidanceTrace` and `deliveryProfile.recommendedSkills`. Verify every explicit and discovered project-guidance path against changed-file placement, architecture, API and framework conventions, and confirm only actually applied optional skills were recorded, available, applicable, and subordinate to project guidance. An unavailable optional hint that was not applied is not a blocker.

For a `feature` profile, verify one unchained Playwright invocation whose declared selector targets the changed feature and appears as an actual command argument. Require a strict project-local result JSON containing only `status: passed`, a selector exactly equal to `testSelector`, the implementation submission's matching `implementationContextId`, and a positive `testCount`, plus exactly one structurally valid, non-zero-duration WebM or MP4 container no larger than 25 MB. List-only, pass-with-no-tests, chained, broad, or unfiltered E2E commands are changes-requested even if they report success.

Playwright Test/CLI is the acceptance oracle. The browser MCP is optional interactive diagnosis, and CDP is only for console, network, performance, memory, or live-DOM diagnosis. Captured screenshots and video do not replace assertions. Missing required browser evidence is `BROWSER_NOT_RUN` and blocks approval.

Budget pressure never makes a required functional gate optional. Return changes-requested or blocked if a split omits its focused regression evidence or if an implementation reached the hard limit by skipping checks.

Return only portable project-relative, `/`-separated safe names in `artifactPaths` and gate evidence paths. Reject absolute, traversal, control-character, backslash/non-portable, or secret-shaped paths, and never embed token, password, secret, or credential values. A descriptive path such as `evidence/token-validation.json` remains valid.

Do not edit implementation while reviewing.
