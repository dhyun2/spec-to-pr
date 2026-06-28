---
name: Archive OpenSpec Change
description: Plan and optionally execute OpenSpec archive after a PR/MR has been merged.
disable-model-invocation: true
argument-hint: "<run-id> <change-name> <provider> <review-url-or-number> [plan|execute]"
allowed-tools: mcp__spec-to-pr__get_run mcp__spec-to-pr__verify_review_request_merged mcp__spec-to-pr__plan_openspec_archive mcp__spec-to-pr__execute_openspec_archive mcp__spec-to-pr__get_openspec_archive_result mcp__spec-to-pr__record_openspec_archive_review
---

# Archive OpenSpec Change

You archive an OpenSpec change only after the linked PR/MR has been merged.

## Why This Skill Exists

OpenSpec archive is a post-merge lifecycle action. It may move files and update current specs, so it must not be run automatically.

This Skill gives the user a safe workflow:

1. Confirm merged review request.
2. Plan archive.
3. Show blocking preconditions.
4. Execute only when explicitly requested.

## Inputs

Expected arguments:

```text
<run-id> <change-name> <provider> <review-url-or-number> [plan|execute]
```

Provider:

```text
github
gitlab
manual
```

Mode:

```text
plan
execute
```

Default mode is `plan`.

## Required Merge Status

Before calling archive tools, obtain or request a merge status object:

```json
{
  "provider": "github",
  "reviewRequestUrl": "https://github.com/org/repo/pull/123",
  "number": "123",
  "merged": true,
  "mergedAt": "2026-06-23T00:00:00.000Z",
  "mergedCommitSha": "abcdef1",
  "sourceBranch": "feature/reservation",
  "targetBranch": "main"
}
```

If merge status cannot be proven, call `verify_review_request_merged` or `plan_openspec_archive` with `merged: false` and report that execution is blocked.

## Procedure

### Plan Mode

1. Call `mcp__spec-to-pr__get_run`.
2. Build or request the merge status object.
3. Call `mcp__spec-to-pr__verify_review_request_merged`.
4. Call `mcp__spec-to-pr__plan_openspec_archive`.
5. Report:
   - canExecute
   - blocking failed preconditions
   - expected command
   - expected archive path
   - follow-up commit requirement

Do not execute archive in plan mode.

### Execute Mode

1. First run plan mode logic.
2. If `canExecute` is false, stop.
3. Ask the user to confirm execution if not already explicit.
4. Call `mcp__spec-to-pr__execute_openspec_archive`.
5. Call `mcp__spec-to-pr__get_openspec_archive_result`.
6. Report:
   - status
   - exit code
   - archive path
   - artifact IDs
   - follow-up commit requirement

## Important Boundaries

- Do not merge PRs or MRs.
- Do not approve reviews.
- Do not waive gaps.
- Do not run archive if merge status is not proven.
- Do not claim archive succeeded without result artifacts.
- Do not create release tags.
