# Task 30 - Evidence-Driven PR/MR Report

## Goal

Generate a PR/MR body from Run evidence, artifacts, checks, gaps, and decisions.

## Why This Task Exists

Agent-written PR summaries are unreliable because they may claim completion without evidence.

Task 30 generates a deterministic Markdown report from Run artifacts.

## Inputs

- Run ID
- OpenSpec artifacts
- Traceability matrix
- API reports
- Design contract reports
- Agent results
- Review Council findings
- Integration report
- Architecture guard report
- Quality gate report
- Visual report
- Accessibility report
- Performance report
- OpenTelemetry report
- Gap ledger

## Outputs

- PR report view model artifact
- PR/MR body markdown artifact
- report review artifact when requested
- updated Run artifact list

## Non-Goals

- No GitHub/GitLab publishing
- No branch push
- No reviewer assignment
- No label creation
- No OpenSpec archive
- No code modification
- No test execution

## Rules

- Pass can only come from passed CheckResult.
- Skipped or Not Run must never be described as Pass.
- Open gaps must be visible.
- Visual metrics must include algorithm and threshold.
- Performance must distinguish lab and field data.
- Accessibility must distinguish automated and manual review.
- OpenSpec archive must be described as plan unless archive evidence exists.

## Definition of Done

- PR report view model is generated.
- Markdown report is generated.
- Decision policy produces Blocked / Draft / Ready.
- Report artifact refs are added to Run.
- Skill exists.
- Reviewer agent exists.
- MCP tool works in stdio integration tests.

## Verification

Run:

```bash
pnpm format:check
pnpm typecheck
pnpm schemas:build
pnpm build
pnpm test
pnpm audit
```

Expected:

- PR report collector tests pass
- PR report decision policy tests pass
- PR report renderer tests pass
- PR report service tests pass
- MCP stdio integration can call:
  - generate_pr_report
  - get_pr_report
  - record_pr_report_review

## Known Limitations

- Report sections are only as complete as their upstream artifacts.
- Task 30 does not publish PR/MR.
- Task 30 does not re-run checks.
- Task 30 does not approve gap waivers.
- Task 30 does not archive OpenSpec changes.
- Report reviewer agent can flag inconsistencies but cannot change deterministic decision.
