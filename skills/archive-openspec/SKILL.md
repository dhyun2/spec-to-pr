---
name: Archive OpenSpec
description: Manually archive an OpenSpec change after the PR/MR has been merged.
disable-model-invocation: false
argument-hint: "[--merge-confirmed | --check-remote-once] [--execute] [--run <run-id>] [--change <change-name>]"
allowed-tools: mcp__spec-to-pr__get_run mcp__spec_to_pr__get_run mcp__spec-to-pr__resolve_archive_target mcp__spec_to_pr__resolve_archive_target mcp__spec-to-pr__record_user_merge_attestation mcp__spec_to_pr__record_user_merge_attestation mcp__spec-to-pr__plan_openspec_archive mcp__spec_to_pr__plan_openspec_archive mcp__spec-to-pr__check_review_request_status_once mcp__spec_to_pr__check_review_request_status_once mcp__spec-to-pr__run_openspec_archive mcp__spec_to_pr__run_openspec_archive mcp__spec-to-pr__get_openspec_archive_report mcp__spec_to_pr__get_openspec_archive_report
---

# Archive OpenSpec

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

You archive an OpenSpec change only after a PR/MR has been merged.

## Critical Rule

This Skill never polls and never assumes merge state.

Task 31 publishes a PR/MR and stops. Task 32 is a manual post-merge command. Run this Skill only when the user explicitly says the PR/MR was merged or asks for a one-time remote status check.

The user does not need to know a Run ID or change name for the normal path.

## Inputs

Expected arguments:

```text
[--merge-confirmed | --check-remote-once] [--execute] [--run <run-id>] [--change <change-name>]
```

Arguments:

- `--merge-confirmed`: user attests that the PR/MR was merged.
- `--check-remote-once`: check GitHub/GitLab status exactly once.
- `--execute`: actually run archive. Without this, produce a plan only.
- `--run <run-id>`: optional explicit Run fallback for advanced use.
- `--change <change-name>`: optional explicit OpenSpec change fallback for advanced use.

Natural language such as "PR 머지했어. archive 해줘." counts as merge confirmation. If the target is ambiguous, ask the user to choose.

## Target Resolution

If `--run` and `--change` are provided, use them.

If not provided:

1. Call `resolve_archive_target`.
2. Prefer the current workflow Run if the caller can infer it from conversation context by passing `--run`.
3. Otherwise let the resolver find the latest Run with a published PR/MR and an unarchived OpenSpec change.
4. If exactly one target is returned, use it.
5. If multiple candidates are returned, ask the user to choose.
6. Do not guess between multiple candidates.

## Procedure

1. Resolve the archive target.
2. Call `get_run` with the resolved Run ID.
3. Confirm the Run contains a publishing result from Task 31.
4. Confirm the Run has a PR/MR URL.
5. If `--merge-confirmed` is present or the user said the PR/MR was merged:
   - call `record_user_merge_attestation`.
6. If `--check-remote-once` is present:
   - call `check_review_request_status_once`.
   - continue only if status is `merged`.
7. Call `plan_openspec_archive`.
8. Report:
   - merge evidence
   - open blocker gaps
   - archive command
   - files expected to move or change
   - whether execution is allowed
9. If `--execute` is present or the user clearly asked to archive now, and the plan is executable:
   - call `run_openspec_archive` with `yes: true`.
   - call `get_openspec_archive_report`.
10. If execution was not requested:

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
- Target resolution source
- Archive plan status
- Blocking gaps
- Archive command
- Execute mode
- Archive result artifact ID, if executed
