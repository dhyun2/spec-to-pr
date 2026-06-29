---
name: Run Spec BDD Agent
description: Prepare and run the Spec/BDD agent lane for an OpenSpec change.
disable-model-invocation: false
context: fork
agent: spec-bdd
argument-hint: "<run-id> <change-name>"
allowed-tools: mcp__spec-to-pr__prepare_spec_bdd_agent mcp__spec-to-pr__record_spec_bdd_agent_result mcp__spec-to-pr__get_run
---

# Run Spec/BDD Agent

You run the Spec/BDD Agent lane for an existing Run and OpenSpec change.

## Inputs

Expected arguments:

```text
<run-id> <change-name>
```

## Procedure

1. Call `mcp__spec-to-pr__prepare_spec_bdd_agent` with:
   - `runId`
   - `changeName`
2. Read the returned context pack path and instructions.
3. Perform the Spec/BDD review according to the context pack.
4. Write the required artifacts:
   - `openspec/changes/<change-name>/artifacts/spec-bdd-review.md`
   - `openspec/changes/<change-name>/artifacts/spec-bdd-review.json`
   - `tests/acceptance/generated/<change-name>/**`
5. Call `mcp__spec-to-pr__record_spec_bdd_agent_result` with:
   - written files
   - status
   - decisions
   - checks, if any were actually run
   - gaps, if any were discovered
6. Call `mcp__spec-to-pr__get_run` to verify the Run has new artifacts or agent result references.

## Important boundaries

Do not implement UI code.
Do not implement API code.
Do not claim tests passed unless they were actually run.
Do not resolve gaps without resolution artifacts.
Do not create a PR.

## Output

Return:

- status
- files written
- requirements reviewed
- scenarios reviewed
- gaps preserved or discovered
- next recommended lane
