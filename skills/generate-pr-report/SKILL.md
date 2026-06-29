---
name: Generate PR Report
description: Generate an evidence-driven PR/MR report body from a completed spec-to-pr Run.
disable-model-invocation: false
argument-hint: "<run-id> [--format markdown] [--review]"
allowed-tools: mcp__spec-to-pr__get_run mcp__spec-to-pr__generate_pr_report mcp__spec-to-pr__get_pr_report mcp__spec-to-pr__record_pr_report_review
---

# Generate PR Report

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

1. Call `mcp__spec-to-pr__get_run`.
2. Confirm the Run exists.
3. Call `mcp__spec-to-pr__generate_pr_report`.
4. Call `mcp__spec-to-pr__get_pr_report`.
5. If `--review` is present:
   - invoke the `pr-report-reviewer` subagent with:
     - report artifact ID
     - report markdown path or URI
     - view model artifact ID
     - Run ID
   - record review using `mcp__spec-to-pr__record_pr_report_review`.
6. Report:
   - PR report artifact ID
   - view model artifact ID
   - decision
   - required gate statuses, including not-run gates
   - mandatory gates summary
   - open blocker gap count
   - open major gap count

## Important Boundaries

When this Skill is invoked by itself, do not publish to GitHub or GitLab.
When an end-to-end `Spec To PR` workflow asked for a review request, continue into
`Publish Review Request` after this report is generated and reviewed.
Do not claim merge readiness if the report decision says blocked.
Do not treat a missing gate as passed.
If Figma evidence exists but no Figma/browser visual comparison report exists, report the decision as blocked.
Do not change gap status.
Do not mark skipped checks as passed.
Do not claim OpenSpec archive has happened.
