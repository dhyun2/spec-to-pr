# Task 23 — Integration and Bounded Repair Loop

## Goal

Integrate approved AgentResult commits into a dedicated integration worktree and run a bounded repair loop for conflicts and small integration failures.

## Why this task exists

Spec, API, and UI agents work in isolated worktrees. Their outputs must be integrated before quality gates and PR report generation can run.

Review Council approval does not guarantee that all commits apply cleanly together.

## Inputs

- Run ID
- Review Council result
- approved AgentResult objects
- commit SHAs from agent worktrees
- file ownership policy
- repair budget

## Outputs

- integration worktree
- integration branch
- integration plan artifact
- conflict report artifact
- repair history artifact
- integration result artifact
- Integrator AgentResult

## Non-goals

- No full quality gate execution
- No visual regression
- No PR publishing
- No OpenSpec archive
- No unlimited repair
- No product-scope expansion

## Rules

- Only Review Council-approved AgentResults are integrated.
- Integration happens in a dedicated worktree.
- Commits are applied in deterministic order.
- Cherry-pick conflicts are recorded as conflict reports.
- Repair attempts are bounded by maxRepairAttempts.
- Repair must not invent requirements, endpoints, or design states.
- Remaining blockers become integration gaps.

## Definition of Done

- Integration plan can be prepared.
- Integration worktree can be created.
- Approved commits can be applied in deterministic order.
- Conflict report is generated on failure.
- Repair history is recorded.
- MCP tools support prepare/get/apply/record-repair/finalize integration.
- Skill `/spec-to-pr:run-integration` exists.
- `agents/integrator.md` exists.
