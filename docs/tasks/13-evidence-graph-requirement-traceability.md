# Task 13 — Evidence Graph and Requirement Traceability

## Goal

Build a traceability graph that connects brief requirement evidence, OpenAPI operations, Figma nodes, artifacts, and gaps.

## Why this task exists

The plugin must prove not only that inputs were parsed, but that requirements are connected to implementation-relevant evidence.

Task 08 extracts brief evidence.
Task 09~11 records and inventories Figma evidence.
Task 12 extracts OpenAPI evidence.

Task 13 connects them into a graph and produces a traceability matrix.

## Inputs

- Run ID
- Brief Evidence from Task 08
- Figma Evidence and Artifacts from Task 09~11
- OpenAPI Evidence and Artifacts from Task 12
- existing Gaps

## Outputs

- EvidenceGraph artifact
- TraceabilityMatrix artifact
- Gap entries for requirements with missing API or Figma support
- Orphan API report
- Orphan Figma report
- updated Run

## Non-goals

- No OpenSpec generation
- No Gherkin generation
- No test code generation
- No API client generation
- No UI implementation
- No LLM-based semantic matching
- No final review approval

## Definition of Done

- Requirement nodes are created from brief evidence.
- API operation nodes are created from OpenAPI evidence.
- Figma design nodes are created from Figma evidence/artifacts.
- Deterministic links are built with confidence and reasons.
- Traceability matrix is generated.
- Missing API/Figma support creates reviewable gaps.
- Orphan API/Figma evidence is reported.
- MCP tools can build and retrieve traceability matrix.

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

- traceability contract tests pass
- keyword extraction tests pass
- graph node builder tests pass
- deterministic linker tests pass
- traceability gap detector tests pass
- EvidenceGraphService tests pass
- MCP stdio integration calls:
  - build_evidence_graph
  - get_traceability_matrix

## Known limitations

- Matching is deterministic and conservative.
- No LLM semantic linking is performed.
- Requirement type is not yet refined enough to know whether API/Figma is mandatory.
- Missing API/Figma gaps may need later review adjustment.
- Orphan API/Figma nodes are reports, not automatic blockers.
- No OpenSpec/Gherkin/test/code is generated here.
