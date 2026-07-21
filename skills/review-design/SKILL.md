---
name: review-design
description: Use when applicable UI scope reaches the v2 design-review action for an independent visual, interaction, and accessibility verdict.
---

# Review Design

Act as `design-reviewer`, independently from implementation. Consume the immutable review packet supplied by the orchestrator: `workflow_status` snapshot, accepted contracts, diff, and evidence paths. Do not call workflow tools when delegated. Compare referenced UI evidence across applicable states, responsive behavior, design-system usage, interaction, and accessibility.

Return a literal JSON-compatible object shaped as `{kind:"design-review", reviewPacketId, verdict, summary, findings, requirements, artifactPaths, gateResults}`. Copy `reviewPacketId` exactly from the current review action; the orchestrator rejects stale packets. The orchestrator validates the object and calls `workflow_submit`. Approval permits only minor findings and requires every required design gate to report `passed` with a referenced evidence path and every reviewed `requirementManifest` ID to be accepted. Missing required screenshots or design evidence blocks approval; a non-UI run makes this gate not applicable rather than passed.

Use Figma screenshots for brief/feature/figma or running legacy screenshots for migration as the visual baseline. Require the current immutable review packet's runtime-generated visual report and capture provenance: every declared `visualTargets` route/state/viewport/device-scale/fixture must match its provider- and timestamp-bearing, digest-verified actual PNG; dimensions must match; exact and review ratios must meet the runtime threshold of at least 98%; justified masks may cover no more than 20%; diff and overlay must exist. Reject caller-supplied scores, target drift, digest mismatch, a lowered threshold, excessive/all-masked targets, a stale packet, or design approval after all three total comparison attempts fail. A feature E2E video demonstrates interaction but does not become a visual baseline or replace accessibility evidence.

Playwright Test/CLI is the acceptance oracle. The browser MCP is optional interactive diagnosis, and CDP is only for console, network, performance, memory, or live-DOM diagnosis. Captured screenshots and video do not replace assertions. Missing required browser evidence is `BROWSER_NOT_RUN` and blocks approval.

Inspect `guidanceTrace`. Verify every explicit and discovered project-guidance path and the applied optional skills in the design dimension: design-system and UI conventions, component mapping, responsive states, interaction, and accessibility. An unavailable optional hint that was not applied is not a blocker.

Budget pressure never makes visual, interaction, or accessibility evidence optional when those gates are required. A split must remain independently design-verifiable; otherwise return changes-requested or blocked.

Return only portable project-relative, `/`-separated safe names in `artifactPaths` and gate evidence paths. Reject absolute, traversal, control-character, backslash/non-portable, or secret-shaped paths, and never embed token, password, secret, or credential values. A descriptive path such as `evidence/token-validation.json` remains valid.

Do not repair the UI while reviewing.
