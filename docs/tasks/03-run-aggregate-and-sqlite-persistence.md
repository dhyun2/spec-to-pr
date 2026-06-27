# Task 03 — Run Aggregate and SQLite Persistence

## Goal

Create a durable execution ledger for one spec-to-pr automation run.

Task 02 defined runtime contract fragments:

- Source
- Evidence
- Artifact
- Check
- Decision
- Gap
- AgentResult

Task 03 groups those fragments into a Run aggregate and persists it in SQLite.

## Why this task exists

Runtime contract fragments are not enough by themselves.

The system also needs to know:

- which Source belongs to which Run
- whether Evidence references an existing Source
- whether Artifact references existing Evidence
- whether Gap references existing Evidence and resolution Artifact
- whether AgentResult belongs to the current Run
- whether stale updates are trying to overwrite newer Run state
- whether the Run can survive Claude Code process restarts

## Non-goals

- No stage transition engine
- No retry or resume logic
- No worker lease
- No agent execution
- No source content collection
- No SHA-256 calculation
- No Figma MCP integration
- No OpenAPI parsing
- No PR publishing

## Design

Task 03 introduces:

- RunManifest
- StageState
- RunSummary
- RunStore port
- SqliteRunStore adapter
- RunService
- MCP tools:
  - create_run
  - get_run
  - list_runs

## Persistence model

Use snapshot persistence, not event sourcing.

Each Run is stored as a validated JSON manifest snapshot with a monotonically increasing revision.

SQLite stores:

- full manifest JSON
- summary JSON for list views

## Concurrency

Use optimistic concurrency with `revision`.

A save operation must provide `expectedRevision`.
The new Run revision must be `expectedRevision + 1`.
The database update must match the expected revision.

## Definition of Done

- Run aggregate validates all required stages
- Run aggregate rejects duplicate stages
- Run aggregate validates Source/Evidence/Artifact/Gap/AgentResult references
- SQLite store persists Runs across process restarts
- SQLite store rejects stale revision updates
- MCP create_run/get_run/list_runs tools work through the real stdio server
- Existing Task 01 and Task 02 tests still pass
