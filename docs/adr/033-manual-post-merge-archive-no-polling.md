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

Archive execution is split into:

1. record or check merge evidence
2. plan archive
3. optionally run archive with `yes: true`
4. record result and report artifacts
5. report follow-up commit requirement

## Consequences

Good:

- Archive timing stays under user control.
- No background token usage or polling cost.
- Merge evidence is auditable.
- Archive failures are visible instead of hidden by automatic revert.

Tradeoffs:

- The user must explicitly return after merge.
- User-attested merge evidence is weaker than remote evidence.
- Archive changes still require a human-controlled commit or follow-up PR.
