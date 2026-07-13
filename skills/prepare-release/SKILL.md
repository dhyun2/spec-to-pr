---
name: prepare-release
description: Use when preparing the spec-to-pr plugin itself for a release candidate after normal implementation and review evidence is complete.
---

# Prepare Release

Read `workflow_status` and require completed implementation and applicable reviews. Run the repository's release-only checks: formatting, type checking, build, tests, plugin validation, package verification, security hardening, and release-note generation.

Keep each command and result as compact evidence. Failed, missing, skipped, or not-run required checks block the release candidate. Use `workflow_submit` only for a submission requested by the current workflow action, then continue with `workflow_advance`. Do not publish packages, tags, or review requests unless the user separately authorizes that action.
