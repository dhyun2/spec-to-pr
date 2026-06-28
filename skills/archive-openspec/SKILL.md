---
name: Archive OpenSpec
description: Manually archive an OpenSpec change after the PR/MR has been merged.
disable-model-invocation: true
argument-hint: "<run-id> <change-name> (--merge-confirmed | --check-remote-once) [--execute]"
allowed-tools: mcp__spec-to-pr__get_run mcp__spec-to-pr__plan_openspec_archive mcp__spec-to-pr__record_merge_attestation mcp__spec-to-pr__check_review_request_status_once mcp__spec-to-pr__run_openspec_archive mcp__spec-to-pr__get_openspec_archive_report
---

# Archive OpenSpec

You archive an OpenSpec change only after a PR/MR has been merged.

## Critical Rule

This Skill never polls and never assumes merge state.

Task 31 publishes a PR/MR and stops. Task 32 is a manual post-merge command. Run this Skill only when the user explicitly says the PR/MR was merged or asks for a one-time remote status check.

## Inputs

Expected arguments:

```text
<run-id> <change-name> (--merge-confirmed | --check-remote-once) [--execute]
```

Arguments:

- `<run-id>`: spec-to-pr Run ID.
- `<change-name>`: OpenSpec change name.
- `--merge-confirmed`: user attests that the PR/MR was merged.
- `--check-remote-once`: check GitHub/GitLab status exactly once.
- `--execute`: actually run archive. Without this, produce a plan only.

## Procedure

1. Call `mcp__spec-to-pr__get_run`.
2. Confirm the Run contains a publishing result from Task 31.
3. Confirm the Run has a PR/MR URL.
4. If `--merge-confirmed` is present:
   - call `mcp__spec-to-pr__record_merge_attestation`.
5. If `--check-remote-once` is present:
   - call `mcp__spec-to-pr__check_review_request_status_once`.
   - continue only if status is `merged`.
6. Call `mcp__spec-to-pr__plan_openspec_archive`.
7. Report:
   - merge evidence
   - open blocker gaps
   - archive command
   - files expected to move or change
   - whether execution is allowed
8. If `--execute` is present and the plan is executable:
   - call `mcp__spec-to-pr__run_openspec_archive` with `yes: true`.
   - call `mcp__spec-to-pr__get_openspec_archive_report`.
9. If `--execute` is absent:
   - stop after the plan.
   - do not run archive.

## Boundaries

Do not:

- poll PR/MR status
- watch in the background
- infer merge state
- merge a PR/MR
- approve a PR/MR
- archive before merge evidence exists
- hide open blocker gaps
- claim archive succeeded without an archive result artifact

## Report Format

Return:

- Run ID
- Change name
- Review request URL
- Merge evidence type
- Archive plan status
- Blocking gaps
- Archive command
- Execute mode
- Archive result artifact ID, if executed
