---
name: Run Spec BDD Agent
description: Prepare and run the Spec/BDD agent lane for an OpenSpec change.
disable-model-invocation: false
context: fork
agent: spec-bdd
argument-hint: "<run-id> <change-name>"
allowed-tools: mcp__spec-to-pr__prepare_spec_bdd_agent mcp__spec_to_pr__prepare_spec_bdd_agent mcp__spec-to-pr__record_spec_bdd_agent_result mcp__spec_to_pr__record_spec_bdd_agent_result mcp__spec-to-pr__get_run mcp__spec_to_pr__get_run
---

# Run Spec/BDD Agent

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

You run the Spec/BDD Agent lane for an existing Run and OpenSpec change.

Spec/BDD review reports are stored in the Run artifact store by default.
Do not create `tests/acceptance/generated/**` skeleton files unless the user
explicitly asks for repo-exported acceptance skeletons.

## Inputs

Expected arguments:

```text
<run-id> <change-name>
```

## Procedure

1. Call `prepare_spec_bdd_agent` with:
   - `runId`
   - `changeName`
2. Read the returned context pack path and instructions.
3. Perform the Spec/BDD review according to the context pack.
4. Prepare the Spec/BDD review result from the context pack. Keep generated
   reports internal by default; do not write acceptance skeleton markdown files
   into the target repo.
5. Call `record_spec_bdd_agent_result` with:
   - status
   - decisions
   - checks, if any were actually run
   - gaps, if any were discovered
   - do not set `writeToProject` unless the user explicitly asks for repo files
6. Call `get_run` to verify the Run has new artifacts or agent result references.

## Important boundaries

Do not implement UI code.
Do not implement API code.
Do not claim tests passed unless they were actually run.
Do not resolve gaps without resolution artifacts.
Do not create a PR.

## Output

Return:

- status
- artifact IDs and changed files, if any
- requirements reviewed
- scenarios reviewed
- gaps preserved or discovered
- next recommended lane

## Host Compatibility And Subagent Fallback

Subagent names differ by host:

- Claude Code: the agents defined in `agents/` (for example `design-ui`, `api-contract`, `spec-bdd`, `integrator`, `review-council`, and the `*-reviewer` agents).
- Codex: the same agents are defined in `.codex/agents/` as `spec-to-pr-<name>` (for example `spec-to-pr-design-ui`).

If the host does not support named subagents, or a matching agent is not available, do not skip the lane. Perform the same instructions inline in the current thread and record the outcome with the same `record_*` MCP tool. Sequential in-thread execution is the supported fallback and must still produce the same structured result and evidence.
