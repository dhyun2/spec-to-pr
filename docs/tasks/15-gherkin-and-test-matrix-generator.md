# Task 15 — Gherkin and Test Matrix Generator

## Goal

Generate Gherkin feature files and a test matrix from an OpenSpec change model.

## Why this task exists

OpenSpec requirements are reviewable, but they are not enough to calculate test coverage.

The plugin needs to connect each requirement to:

- one or more scenario IDs
- a test layer
- automation readiness
- evidence IDs
- gap IDs
- future test file targets

## Inputs

- Run ID
- OpenSpec change name
- OpenSpec change manifest
- Run evidence and gaps

## Outputs

- artifacts/gherkin/*.feature
- artifacts/gherkin-index.json
- artifacts/test-matrix.json
- artifacts/test-matrix.md
- ArtifactRef entries in Run

## Non-goals

- No test execution
- No Cucumber runner setup
- No Playwright test implementation
- No step definitions
- No acceptance test code execution
- No CI integration
- No coverage measurement

## Rules

- Ready requirements become automated-candidate scenarios.
- Partial requirements become review-needed or manual scenarios.
- Blocked requirements remain blocked in the matrix.
- Gap-only rows do not become executable scenarios.
- Every scenario must include requirement tags.
- Every scenario should include evidence tags when available.
- Generated files must be deterministic.

## Definition of Done

- Gherkin model exists.
- Test matrix model exists.
- Ready requirements generate `.feature` scenarios.
- Partial/blocked requirements are represented in matrix.
- Feature files are grouped by spec area.
- test-matrix.json and test-matrix.md are generated.
- Gherkin artifacts are recorded in Run.
- MCP tool works through stdio integration tests.
