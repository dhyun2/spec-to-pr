---
name: prepare-release
description: Use when preparing the spec-to-pr plugin itself for a release candidate after normal implementation and review evidence is complete.
---

# Prepare Release

Read `workflow_status` and require completed implementation and applicable reviews. Run the repository's release-only checks: formatting, type checking, build, tests, plugin validation, package verification, security hardening, and release-note generation.

Keep each command and result as compact evidence. Verify the workload and full required-validation schemas, SDK boundary-budget/null-usage/output-schema tests, best-effort numeric-only usage calibration, generated SDK declarations, and bundled MCP server remain synchronized. Failed, missing, skipped, or not-run required checks block the release candidate; token pressure cannot reduce the release matrix. Use `workflow_submit` only for a submission requested by the current workflow action, then continue with `workflow_advance`. Do not publish packages, tags, or review requests unless the user separately authorizes that action.
