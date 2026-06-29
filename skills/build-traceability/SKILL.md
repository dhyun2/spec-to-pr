---
name: Build Traceability
description: Build requirement traceability graph and matrix from collected brief, Figma, and OpenAPI evidence.
disable-model-invocation: false
argument-hint: "<run-id>"
allowed-tools: mcp__spec-to-pr__build_evidence_graph mcp__spec-to-pr__get_traceability_matrix mcp__spec-to-pr__get_run
---

# Build Traceability

You build the evidence graph for an existing spec-to-pr Run.

## Inputs

Expected argument:

```text
<run-id>
```

## Procedure

1. Call `mcp__spec-to-pr__build_evidence_graph` with the run ID.
2. Call `mcp__spec-to-pr__get_traceability_matrix` with the run ID.
3. Call `mcp__spec-to-pr__get_run` to confirm:
   - traceability graph artifact exists
   - traceability matrix artifact exists
   - any generated traceability gaps are present

## Report

Return:

- requirement count
- API node count
- Figma node count
- edge count
- gaps added
- orphan API count
- orphan Figma count
- traceability graph artifact ID
- traceability matrix artifact ID

## Important Boundaries

Do not claim that OpenSpec, Gherkin, API client, tests, or UI code were generated.

Task 13 only builds traceability data.
