---
name: Run Review Council
description: Prepare context for the review-council agent and record its structured review result.
disable-model-invocation: true
argument-hint: "<run-id>"
allowed-tools: mcp__spec-to-pr__prepare_review_council mcp__spec-to-pr__get_review_council_context mcp__spec-to-pr__record_review_council_result mcp__spec-to-pr__get_run
---

# Run Review Council

You run the Review Council workflow for a spec-to-pr Run.

## Inputs

Expected argument:

```text
<run-id>
```

## Procedure

1. Call `mcp__spec-to-pr__prepare_review_council` with the Run ID.
2. Read the returned:
   - context path
   - instructions path
   - context artifact ID
3. Optionally call `mcp__spec-to-pr__get_review_council_context` to reload the context pack.
4. Invoke or use the `review-council` subagent with that context.
5. The subagent must return a JSON object matching ReviewCouncilResultSchema.
6. Call `mcp__spec-to-pr__record_review_council_result` with:
   - runId
   - contextArtifactId
   - result
7. Call `mcp__spec-to-pr__get_run` to confirm:
   - review report artifact was added
   - review-council AgentResult was added
   - new gaps were added if needed

## What the subagent does

The `review-council` agent reads the context pack and checks:

- Spec/BDD output against product evidence
- API Contract output against OpenAPI evidence
- Design/UI output against Figma/design contract evidence
- Gherkin/test matrix coverage
- open gap policy
- contradiction between agent claims

The agent does not modify product code.

## Report

Return:

- context artifact ID
- report artifact ID
- result artifact ID
- new gap count
- finding count
- verdict count
- whether blocker findings remain

## Important boundaries

Do not claim that implementation was fixed.
Do not claim tests were executed.
Do not resolve gaps unless resolution artifacts exist.
Do not run this workflow automatically.
