# Task 10 - Figma Source Intake and Raw Artifact Recording

## Goal

Register Figma node URLs as SourceRef records and store raw Figma MCP outputs as durable Evidence and Artifact records.

## Why This Task Exists

Figma is a critical design evidence source. A raw URL is not enough for later UI implementation and visual review.

The Run ledger must preserve:

- fileKey
- nodeId
- canonical Figma URL
- provider used
- metadata output
- design context output
- screenshot baseline
- variable/style definitions
- Code Connect map

## Non-Goals

- No direct Figma MCP calls from spec-to-pr
- No Figma REST API calls
- No design-system inventory parsing
- No visual diff
- No UI code generation

## Definition of Done

- Figma URL parser normalizes fileKey and nodeId.
- Figma SourceRef can be attached to Run.sources.
- Raw Figma MCP outputs can be recorded as ArtifactRef records.
- Each Figma artifact has a Figma-node EvidenceRef.
- Duplicate raw artifacts are deduplicated by digest.
- MCP stdio integration covers source registration and raw artifact recording.
