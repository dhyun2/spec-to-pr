# Task 32 - Manual Post-Merge OpenSpec Archive Lifecycle

## Goal

Archive an OpenSpec change only when the user explicitly starts the post-merge workflow and explicit merge evidence exists.

## Why This Task Exists

Task 31 publishes or updates a PR/MR and then stops. The plugin does not keep watching review state.

After Task 31, people review the PR/MR, resolve gaps, rerun CI, and merge. Task 32 starts only when the user returns and explicitly asks for OpenSpec archive after merge.

Task 32 is not a background worker.

## Inputs

- Run ID
- OpenSpec change name
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
- `check_review_request_status_once` performs at most one remote status check per call.
- `run_openspec_archive` recalculates the plan server-side before executing.
- `run_openspec_archive` requires `yes: true`.
- Open blocker gaps block archive.
- Closed but unmerged review requests block archive.
- Archive results are recorded as evidence; failed archive is not automatically reverted.

## Tooling

- `plan_openspec_archive`
- `record_merge_attestation`
- `check_review_request_status_once`
- `run_openspec_archive`
- `get_openspec_archive_report`

## Skill

`/spec-to-pr:archive-openspec`

The Skill must be user-triggered and has `disable-model-invocation: true`.

## Definition of Done

- Merge evidence contracts exist.
- Archive plan contract includes `polling: false`.
- User attestation records a merge evidence artifact.
- One-shot remote status check records a merge evidence artifact.
- Archive execution refuses missing or non-merged evidence.
- Archive execution records stdout, stderr, exit code, result, and report.
- MCP exposes the manual archive tools.
- Skill documents the manual, no-polling workflow.
- Tests cover plan, attestation, one-shot status, archive result, and MCP stdio.

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
