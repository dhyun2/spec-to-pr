# Task 32 - Manual Post-Merge OpenSpec Archive Lifecycle

## Goal

Archive an OpenSpec change only when the user explicitly starts the post-merge workflow and explicit merge evidence exists.

## Why This Task Exists

Task 31 publishes or updates a PR/MR and then stops. The plugin does not keep watching review state.

After Task 31, people review the PR/MR, resolve gaps, rerun CI, and merge. Task 32 starts only when the user returns and explicitly asks for OpenSpec archive after merge.

Task 32 is not a background worker.

## Inputs

- optional Run ID fallback
- optional OpenSpec change name fallback
- Task 31 publish result artifact already recorded in the Run
- merge evidence:
  - user-attested
  - remote-checked by one explicit API call
  - webhook-recorded in a future integration
- execute flag for archive execution

## Outputs

- merge evidence artifact
- archive plan
- archive result artifact
- archive report artifact
- stdout/stderr log artifacts when the archive command runs
- follow-up commit requirement

## User Experience

The normal user path should be short:

```text
PR 머지했어. archive 해줘.
```

Or as a slash command:

```text
/spec-to-pr:archive-openspec --merge-confirmed
```

Run ID and change name are fallback inputs, not required in the common path:

```text
/spec-to-pr:archive-openspec --run <run-id> --change <change-name> --merge-confirmed --execute
```

The Skill resolves the archive target from RunStore before planning.

## Non-Goals

- No PR/MR status polling
- No background watcher
- No inferred merge state
- No archive without user-confirmed execution
- No PR/MR merge
- No PR/MR approval
- No reviewer decision replacement
- No blocker gap waiver
- No automatic archive commit or push
- No automatic follow-up PR

## Rules

- Task 32 never runs automatically after publishing.
- Task 32 is a user-triggered post-merge command.
- Archive requires explicit merge evidence.
- `plan_openspec_archive` is read-only and reports `polling: false`.
- `resolve_archive_target` is read-only and resolves Run, change, and PR/MR URL when the user omits them.
- `check_review_request_status_once` performs at most one remote status check per call.
- `run_openspec_archive` recalculates the plan server-side before executing.
- `run_openspec_archive` requires `yes: true`.
- Open blocker gaps block archive.
- Closed but unmerged review requests block archive.
- Archive results are recorded as evidence; failed archive is not automatically reverted.

## Tooling

- `resolve_archive_target`
- `plan_openspec_archive`
- `record_user_merge_attestation`
- `check_review_request_status_once`
- `run_openspec_archive`
- `get_openspec_archive_report`

## Skill

`/spec-to-pr:archive-openspec`

The Skill must be user-triggered and has `disable-model-invocation: true`.

## Archive Target Resolver

`resolve_archive_target` accepts optional `runId` and `changeName`.

- If `runId` is supplied, resolve within that Run.
- If `changeName` is supplied, use it as an explicit fallback.
- If neither is supplied, inspect recent Runs for a Task 31 publish result and an unarchived OpenSpec change.
- If one candidate exists, return it.
- If multiple candidates exist, return them and require user choice.
- If no candidate exists, return unresolved and do not plan archive.

The resolver does not use polling, background watching, or merge-state inference.

## Definition of Done

- Merge evidence contracts exist.
- Archive target resolver supports omitted Run ID and change name.
- Archive plan contract includes `polling: false`.
- User attestation records a merge evidence artifact.
- One-shot remote status check records a merge evidence artifact.
- Archive execution refuses missing or non-merged evidence.
- Archive execution records stdout, stderr, exit code, result, and report.
- MCP exposes the manual archive tools.
- Skill documents the manual, no-polling workflow.
- Tests cover target resolution, plan, attestation, one-shot status, archive result, and MCP stdio.

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

## Known Limitations

- Default implementation does not poll.
- Webhook listener is not included.
- Remote status check only happens when explicitly requested.
- User-attested merge evidence is weaker than remote API evidence.
- Archive commit/push is not automatic.
- OpenSpec CLI must be available for real archive execution.
- Closed but unmerged PR/MR is not archived.

## Failure Policy

- Blocked archive is recorded as an archive result artifact.
- Failed archive is recorded as an archive result artifact.
- The service does not automatically revert OpenSpec files.
- The service does not waive blocker gaps.
- Follow-up repair, commit, push, or rollback remains a user or release-process decision.
