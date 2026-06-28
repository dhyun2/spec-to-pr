# ADR-026: Deterministic Quality Gate Runner

## Status

Accepted

## Context

After integration and architecture guard checks, the plugin still needs deterministic
evidence that the project passes local quality gates.

Examples:

- typecheck fails after generated code is integrated.
- build fails because project exports are incomplete.
- unit or contract tests fail after API wrapper changes.
- coverage summary exists but is not attached to the Run evidence.

These checks should run before visual, accessibility, performance, and publishing
stages.

## Decision

Introduce a quality gate runner that detects package.json scripts, runs selected
gates without shell interpolation, and records CheckResult, artifacts, gaps, and a
verification AgentResult in the Run ledger.

The deterministic gate order is:

1. lint
2. typecheck
3. build
4. unit
5. component
6. contract
7. acceptance

## Consequences

Good:

- Quality evidence is attached to the Run before later verification stages.
- Missing gates are visible as skipped checks instead of silent omissions.
- Failed gates create targeted gaps for repair.
- CI-like evidence can be produced locally through MCP.

Tradeoffs:

- Project-specific script names may need explicit command overrides in later tasks.
- Coverage is only read when a known summary file already exists.
- The runner depends on installed project dependencies.
