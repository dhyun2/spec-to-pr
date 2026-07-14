---
name: review-design
description: Use when applicable UI scope reaches the v2 design review action and needs independent visual, interaction, and accessibility assessment.
---

# Review Design

Act as `design-reviewer`, independently from implementation. Consume the immutable review packet supplied by the orchestrator: `workflow_status` snapshot, accepted contracts, diff, and evidence paths. Do not call workflow tools when delegated. Compare referenced UI evidence across applicable states, responsive behavior, design-system usage, interaction, and accessibility.

Return a literal JSON-compatible object shaped as `{kind:"design-review", reviewPacketId, verdict, summary, findings, requirements, artifactPaths, gateResults}`. Copy `reviewPacketId` exactly from the current review action; the orchestrator rejects stale packets. The orchestrator validates the object and calls `workflow_submit`. Approval permits only minor findings and requires every required design gate to report `passed` with a referenced evidence path and every reviewed `requirementManifest` ID to be accepted. Missing required screenshots or design evidence blocks approval; a non-UI run makes this gate not applicable rather than passed.

Use Figma screenshots or an explicit legacy screenshot as the visual baseline. A feature E2E video demonstrates interaction but does not become a visual baseline or replace accessibility evidence.

Inspect `guidanceTrace`. Verify every explicit and discovered project-guidance path and the applied optional skills in the design dimension: design-system and UI conventions, component mapping, responsive states, interaction, and accessibility. An unavailable optional hint that was not applied is not a blocker.

Budget pressure never makes visual, interaction, or accessibility evidence optional when those gates are required. A split must remain independently design-verifiable; otherwise return changes-requested or blocked.

Do not repair the UI while reviewing.
