---
name: Generate PR Report
description: Generate an evidence-driven PR/MR report body from a completed spec-to-pr Run.
disable-model-invocation: false
argument-hint: "<run-id> [--format markdown] [--review]"
allowed-tools: mcp__spec-to-pr__get_run mcp__spec_to_pr__get_run mcp__spec-to-pr__generate_review_scorecard mcp__spec_to_pr__generate_review_scorecard mcp__spec-to-pr__generate_pr_report mcp__spec_to_pr__generate_pr_report mcp__spec-to-pr__get_pr_report mcp__spec_to_pr__get_pr_report mcp__spec-to-pr__record_pr_report_review mcp__spec_to_pr__record_pr_report_review
---

# Generate PR Report

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

You generate an evidence-driven PR/MR report body for an existing spec-to-pr Run.

## Why This Skill Exists

This workflow creates a new PR report artifact and may trigger a report review artifact.
The markdown artifact is the base PR/MR body. During publishing, the publisher may
upload visual PNG artifacts and inject a `Visual Evidence Preview` section with
remote image URLs while preserving the original report content and artifact IDs.

It must not run automatically because:

- it mutates the Run ledger,
- it may create repo or artifact files,
- it may produce a report that reviewers treat as official,
- it must only happen after the user decides the Run is ready for reporting.

## Inputs

Expected arguments:

```text
<run-id> [--format markdown] [--review]
```

- `<run-id>`: required Run ID
- `--format markdown`: default; generate Markdown PR body
- `--review`: optional; ask the `pr-report-reviewer` agent to review report consistency after generation

## Procedure

1. Call `get_run`.
2. Confirm the Run exists.
3. Call `generate_review_scorecard` with `minimumScore: 8`, `attempt: 1`, and `maxAttempts: 3` unless the latest Run already has a passing `review-scorecard-json` artifact. Ratio-style thresholds are normalized to the 0-10 score scale, so `minimumScore: 0.85` is treated as `8.5/10`.
4. If the scorecard decision is `retry`, repair the reported `nextRepairTarget`, regenerate the scorecard with the next attempt number, and do not call the report publish path until every dimension meets the normalized minimum threshold.
5. If the scorecard decision is `blocked`, continue only to generate a blocked PR report; do not describe the report as publishable.
6. Call `generate_pr_report` with `language: "ko"` unless the user explicitly asks for English.
7. Call `get_pr_report`.
8. If `--review` is present:
   - invoke the `pr-report-reviewer` subagent with:
     - report artifact ID
     - report markdown path or URI
     - view model artifact ID
     - Run ID
   - record review using `record_pr_report_review`.
9. Report:
   - PR report artifact ID
   - view model artifact ID
   - decision
   - required gate statuses, including not-run gates
   - mandatory gates summary
   - open blocker gap count
   - open major gap count

## Important Boundaries

When this Skill is invoked by itself, do not publish to GitHub or GitLab.
When an end-to-end `SpecToPR` workflow asked for a review request, continue into
`Publish Review Request` after this report is generated and reviewed.
Do not claim merge readiness if the report decision says blocked.
Do not treat a missing gate as passed.
Do not generate a publishable report if any mandatory gate is missing: lint, typecheck, build, functional verification, OpenSpec, visual comparison when Figma evidence exists, accessibility, performance/Web Vitals, security, or observability.
Do not generate a publishable report if the latest review scorecard is missing, below the normalized minimum threshold in any dimension, or points to a `nextRepairTarget`; generate only a blocked report until the scorecard passes.
For legacy migrations, do not generate a publishable report if legacy feature inventory is missing, the matching feature coverage matrix is missing, any legacy feature is uncovered, any row is documented-only without executable test evidence, or required visual/resource contract evidence is missing.
If Figma evidence exists but no Figma/browser visual comparison report exists, report the decision as blocked.
For legacy migrations, report legacy-vs-target visual parity separately from Figma-vs-target design fidelity; Figma score alone does not satisfy migration pass/fail.
Do not change gap status.
Do not mark skipped checks as passed.
Do not claim OpenSpec archive has happened.

## Host Compatibility And Subagent Fallback

Subagent names differ by host:

- Claude Code: the agents defined in `agents/` (for example `design-ui`, `api-contract`, `spec-bdd`, `integrator`, `review-council`, and the `*-reviewer` agents).
- Codex: the same agents are defined in `.codex/agents/` as `spec-to-pr-<name>` (for example `spec-to-pr-design-ui`).

If the host does not support named subagents, or a matching agent is not available, do not skip the lane. Perform the same instructions inline in the current thread and record the outcome with the same `record_*` MCP tool. Sequential in-thread execution is the supported fallback and must still produce the same structured result and evidence.
