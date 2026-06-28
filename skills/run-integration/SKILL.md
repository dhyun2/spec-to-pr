---
name: Run Integration
description: Integrate Review Council-approved agent results into a dedicated integration worktree.
disable-model-invocation: true
argument-hint: "<run-id> <approved-agent-result-id...>"
allowed-tools: mcp__spec-to-pr__get_run mcp__spec-to-pr__prepare_integration mcp__spec-to-pr__get_integration_plan mcp__spec-to-pr__apply_integration mcp__spec-to-pr__record_integration_repair mcp__spec-to-pr__finalize_integration
---

# Run Integration

You run the Task 23 integration workflow.

## Inputs

Expected arguments:

```text
<run-id> <approved-agent-result-id...>
```

The approved AgentResult IDs must come from the Review Council output.

## Why this Skill exists

Integration creates a Git worktree, applies commits, and may produce conflict reports. This is a side-effecting workflow and must be manually invoked by the user.

## Procedure

1. Call `mcp__spec-to-pr__get_run`.
2. Confirm Review Council artifacts exist.
3. Call `mcp__spec-to-pr__prepare_integration` with:
   - runId
   - approvedAgentResultIds
   - maxRepairAttempts default 2
4. Optionally call `mcp__spec-to-pr__get_integration_plan` to reload the plan.
5. Report the integration plan:
   - integration branch
   - worktree path
   - candidate commit order
6. Call `mcp__spec-to-pr__apply_integration`.
7. If result is `passed`, call `mcp__spec-to-pr__finalize_integration`.
8. If result is `conflicted`, summarize the conflict report and ask the user whether to run the integrator repair agent.
9. Record each repair attempt with `mcp__spec-to-pr__record_integration_repair`.
10. Do not claim quality gates passed. They run in later tasks.

## Agent Usage

If integration conflicts require repair, invoke the `integrator` subagent with:

- integration worktree path
- conflict report
- repair policy
- allowed files
- forbidden actions

The integrator agent may only resolve conflicts and small integration mismatches. It must not add product scope, undocumented APIs, or new Figma states.

## Report

Return:

- integration branch
- integration worktree path
- applied candidates
- skipped candidates
- conflict report artifact IDs
- repair status
- next recommended task

## Boundaries

Do not run full quality gates.
Do not publish a PR.
Do not push branches.
Do not delete tests or gaps.
