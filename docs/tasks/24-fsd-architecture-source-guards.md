# Task 24 — FSD Architecture and Source Guards

## Goal

Analyze the integrated worktree and verify that FSD boundaries, public API rules, and API access boundaries are respected.

## Why this task exists

A successful Git integration does not prove that the code respects architecture boundaries.

The plugin must detect:

- invalid FSD layer imports
- cross-slice deep imports
- missing public API usage
- direct UI fetch calls
- direct UI httpClient imports
- direct UI generated client imports
- generated client usage outside allowed API wrapper zones

## Inputs

- Run ID
- integration worktree path
- project profile
- file ownership policy
- API pipeline report
- Figma design contract report

## Outputs

- architecture-report.json
- architecture-report.md
- optional generated source guard test
- CheckResult for architecture guard
- ArtifactRef entries
- Architecture Gap entries for blocker/major violations

## Non-goals

- No lint execution
- No typecheck execution
- No test execution
- No automatic code modification
- No agent repair
- No PR publishing

## Rules

- Higher FSD layers may import lower layers.
- Lower FSD layers must not import higher layers.
- Different slices must be accessed through public API.
- UI code must not directly import generated API clients.
- UI code must not directly call fetch/httpClient.
- Generated clients may be used only inside allowed API wrapper zones.

## Definition of Done

- Source files can be scanned.
- Import/export declarations are extracted.
- FSD layer and slice are detected from paths.
- Invalid layer direction is reported.
- Cross-slice deep imports are reported.
- Direct UI fetch/httpClient/generated imports are reported.
- Architecture report artifact is recorded in Run.
- Optional source guard test is generated in the target repository.
- MCP tools work through stdio integration tests.
