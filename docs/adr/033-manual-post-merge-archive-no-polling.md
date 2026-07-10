# ADR-033: Manual Post-Merge Archive With No Polling

## Status

Accepted

## Context

Task 31 publishes or updates a PR/MR. The review, gap-fixing, CI, and merge phase is controlled by people and repository policy, not by a background plugin process.

OpenSpec archive may move a change folder and update current specs. Running it automatically after publishing, or by guessing merge state, can mark unfinished work as complete.

## Decision

Task 32 is a user-triggered post-merge command.

The archive lifecycle requires explicit merge evidence:

- user-attested
- remote-checked by one explicit API call
- webhook-recorded in a future integration

The workflow does not poll, does not watch in the background, and does not infer merge state.

The Skill resolves the archive target before planning. Users may provide `runId` and `changeName`, but the common path is to resolve the latest suitable published Run and unarchived OpenSpec change automatically. If multiple candidates exist, the user must choose.

Archive execution is split into:

1. resolve archive target
2. record or check merge evidence
3. plan archive
4. optionally run archive with `yes: true`
5. record result and report artifacts
6. report follow-up commit requirement

## Consequences

Good:

- Archive timing stays under user control.
- Users do not need to remember Run IDs for the common path.
- No background token usage or polling cost.
- Merge evidence is auditable.
- Archive failures are visible instead of hidden by automatic revert.

Tradeoffs:

- The user must explicitly return after merge.
- User-attested merge evidence is weaker than remote evidence.
- Archive changes still require a human-controlled commit or follow-up PR.
