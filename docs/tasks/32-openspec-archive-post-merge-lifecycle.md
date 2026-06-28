# Task 32 - OpenSpec Archive and Post-Merge Lifecycle

## Goal

Archive an OpenSpec change only after its corresponding PR/MR has been merged and required verification evidence is present.

## Why This Task Exists

OpenSpec changes should not remain active after the implementation is merged. However, archive must not happen before review and merge are complete.

Task 32 connects:

- PR/MR merged state
- merged commit SHA
- OpenSpec change folder
- current spec synchronization
- archive result
- Run artifact ledger

## Inputs

- Run ID
- change name
- PR/MR URL, publish result artifact, or explicit merge status
- provider: GitHub, GitLab, or manual
- execution mode: plan or execute

## Outputs

- archive merge-status artifact
- archive plan artifact
- archive execution result artifact
- archive report artifact
- stdout/stderr log artifacts when the archive command runs
- updated Run ledger

## Non-Goals

- No PR/MR merge
- No review approval
- No deployment verification
- No release tagging
- No force archive when required gates failed
- No automatic waiver of blocker gaps
- No automatic follow-up PR

## Rules

- Archive requires merged PR/MR evidence.
- Archive requires a merged commit SHA.
- Archive requires no open blocker gaps.
- Archive requires an existing OpenSpec change folder.
- Plan and execute are separate operations.
- Archive result must be recorded as artifacts.
- Archive reviewer agent may review but must not execute archive.

## Definition of Done

- Merge status can be verified from explicit input and cross-checked with publish artifacts.
- Archive plan identifies files and blocking preconditions.
- Archive execution records command, exit code, stdout/stderr artifacts, result, and report.
- OpenSpec archive folder expectation is recorded after execution.
- Run artifacts include merge status, archive plan, result, report, and review artifacts.
- Skill `/spec-to-pr:archive-openspec-change` documents the safe workflow.

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

- archive plan tests pass
- merge status contract tests pass
- archive service tests pass
- MCP stdio archive tools work
- execute tool is covered with blocked execution in default tests

## Known Limitations

- This task does not merge PRs or MRs.
- This task does not approve reviews.
- OpenSpec CLI must be installed for actual execution.
- If OpenSpec CLI is unavailable, execution failure is recorded instead of hidden.
- Archive may require a follow-up commit.
- Provider live merge-state lookup is intentionally not required in default tests.

## Failure Policy

- Failed archive execution is recorded as an OpenSpec archive result artifact.
- Blocked archive execution is recorded when merge or preconditions are not satisfied.
- The service does not automatically revert OpenSpec files.
- The service does not waive blocker gaps.
- Follow-up repair or rollback remains a user or release-process decision.
