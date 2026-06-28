# Task 25 — Quality Gate Runner

## Goal

Run deterministic quality checks after architecture guard and record the evidence in the Run ledger.

## Why this task exists

Integrated code must prove that it can pass project-level verification before visual,
accessibility, performance, and publishing stages run.

The plugin must record:

- lint report
- typecheck report
- build report
- unit test report
- component test report
- contract test report
- acceptance test report
- coverage summary when available

## Inputs

- Run ID
- integration or project worktree path from the Run
- package.json scripts
- optional gate selection
- optional command timeout
- optional coverage summary path

## Outputs

- quality-gate-report.json
- quality-gate-report.md
- per-gate report artifacts
- stdout/stderr log artifacts
- optional coverage-report artifact
- CheckResult entries
- verification AgentResult
- Gap entries for failed gates

## Non-goals

- No visual regression execution
- No accessibility scan
- No performance/Web Vitals scan
- No automatic repair
- No dependency installation
- No shell command execution
- No PR publishing

## Rules

- Gates run in a deterministic order.
- Package scripts are detected from package.json.
- Missing scripts are recorded as skipped checks.
- Commands are executed without shell interpolation.
- Failed gates create blocker or major gaps.
- The service records evidence even when one or more gates fail.
- Coverage is read from an existing coverage summary file when present.

## Definition of Done

- Quality gate command plans can be detected from package.json.
- lint/typecheck/build/unit/component/contract/acceptance gates are represented.
- Missing gates are skipped deterministically.
- Passing, failing, and skipped checks are recorded as CheckResult entries.
- stdout/stderr/report artifacts are recorded in the Run.
- coverage-summary.json is converted into a coverage report artifact when present.
- failed gates create Gap entries.
- a verification AgentResult is recorded.
- MCP tool works through stdio integration tests.

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

- quality gate command planner tests pass
- quality gate report tests pass
- QualityGateService tests pass
- MCP stdio integration lists:
  - run_quality_gates

## Known limitations

- Gate discovery is package.json based.
- The runner does not install dependencies.
- Coverage is only summarized when a coverage summary file already exists.
- Long-running or watch-mode scripts should not be configured as quality gates.
- No automatic repair is performed.
