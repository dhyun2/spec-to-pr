# Task 04 - State Machine and Resumability

## Goal

Add deterministic stage transitions, leases, checkpoints, retry metadata, and resume planning to the durable Run ledger.

Task 03 created a durable Run aggregate. Task 04 makes the Run executable as a controlled state machine.

## Why This Task Exists

A long-running multi-agent workflow can fail, timeout, be cancelled, or be resumed later.

The system must answer:

- which stage is next?
- which stage is currently running?
- who owns the running stage?
- did the worker lease expire?
- can this stage be retried?
- is this update stale?
- where should the workflow resume?

## Non-Goals

- No actual agent process execution
- No Git worktree creation
- No brief, Figma, or OpenAPI processing
- No test command runner
- No artifact file generation
- No PR publishing

## Design

Task 04 introduces:

- Stage transition policy
- Stage lease
- Stage checkpoint
- Retry budget
- Resume plan
- StageService
- MCP tools:
  - `start_stage`
  - `heartbeat_stage`
  - `complete_stage`
  - `fail_stage`
  - `block_stage`
  - `skip_stage`
  - `get_resume_plan`

## State Transitions

Allowed:

```text
pending -> running
running -> passed
running -> failed
running -> blocked
running -> skipped
failed -> running
blocked -> running
skipped -> running
```

Not allowed:

```text
passed -> running
pending -> passed
failed -> passed
blocked -> passed
```

## Lease Rules

A running stage must have a lease.

Only the current lease holder can:

- heartbeat
- complete
- fail
- block
- skip

Expired leases may be reclaimed by starting the stage again.

## Definition Of Done

- Invalid transitions are rejected
- Running stages require a lease
- Lease mismatch is rejected
- Expired lease can be reclaimed
- Retry attempt increments when failed or blocked stages restart
- Resume plan identifies next stages and expired leases
- MCP stage tools work through stdio integration tests

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

- Stage transition unit tests pass
- Resume planner tests pass
- SQLite persistence tests still pass
- MCP stdio integration test calls:
  - `create_run`
  - `start_stage`
  - `heartbeat_stage`
  - `complete_stage`
  - `get_resume_plan`

## Known Limitations

- Stage transitions do not execute real agents.
- Resume plan is advisory and does not automatically run stages.
- Lease expiry depends on local clock.
- Checkpoints are metadata only.
- Retry policy is basic `maxAttempts` logic.
- Artifact and Gap IDs must already exist in Run to attach them.
