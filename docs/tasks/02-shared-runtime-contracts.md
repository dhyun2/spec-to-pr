# Task 02 — Shared Runtime Contracts

## Goal

Define the shared runtime language used by all future agents.

Task 01 proved that the Claude Code plugin can start and expose MCP tools. Task 02 defines the structured data that future tools and agents must submit.

## Why this task exists

Natural language statements such as "implemented", "tests passed", or "Figma matched" are not reliable system state.

The plugin needs machine-verifiable contracts for:

- Source
- Evidence
- Artifact
- Check
- Decision
- Gap
- AgentResult

## Non-goals

- No Run aggregate
- No SQLite persistence
- No reference integrity checking
- No source content collection
- No SHA-256 calculation
- No Figma MCP calls
- No OpenAPI parsing
- No agent execution
- No PR publishing

## Design principles

1. Contract-first development
2. Evidence over assertion
3. Role-specific agent result contracts
4. Invalid states should fail at the schema boundary
5. JSON Schema artifacts should be generated for non-TypeScript consumers

## Contracts

### Source

A Source is a large input unit such as a brief file, Figma URL, OpenAPI document, or repository snapshot.

### Evidence

Evidence is a precise location inside a Source, such as file lines, a JSON Pointer, a Figma node, or a Git file range.

### Artifact

An Artifact is an output produced by an agent or verifier.

Examples:

- OpenSpec document
- Gherkin feature
- API contract report
- screenshot
- visual diff
- test report
- PR report

### Check

A Check is an executed verification result.

A passed Check cannot have a non-zero exit code.
A failed Check requires failureReason.
A skipped Check requires skipReason.

### Decision

A Decision records an implementation or review choice, including rationale, risk, and evidence.

### Gap

A Gap records the difference between expected and observed behavior.

Gap statuses:

- open
- assumed
- waived
- resolved

Resolved gaps require resolution artifacts.
Waived gaps require waiver evidence.
Assumed gaps require assumption details.

### AgentResult

AgentResult is split by role:

- implementation
- verification
- publishing

Implementation results require commitSha when passed.
Verification results must not change files.
Publishing results require prUrl and reportArtifactId when passed.

## Definition of Done

- Runtime schemas exist under `src/runtime`
- JSON Schema artifacts are generated under `schemas/runtime`
- Contract invariant tests pass
- Task 01 MCP tests still pass
- `pnpm check` passes
