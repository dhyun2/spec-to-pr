---
name: Setup Observability
description: Generate OpenTelemetry and log correlation artifacts for a spec-to-pr Run.
disable-model-invocation: false
argument-hint: "<run-id> [target=plugin|target-app|both] [collector-url]"
allowed-tools: mcp__spec-to-pr__plan_observability mcp__spec_to_pr__plan_observability mcp__spec-to-pr__generate_observability_config mcp__spec_to_pr__generate_observability_config mcp__spec-to-pr__get_observability_report mcp__spec_to_pr__get_observability_report mcp__spec-to-pr__record_observability_review mcp__spec_to_pr__record_observability_review mcp__spec-to-pr__get_run mcp__spec_to_pr__get_run
---

# Setup Observability

## MCP Tool Namespace

Tool names in this skill are written without the host prefix. Use the namespace exposed in the current host:

- Codex: `mcp__spec_to_pr__<tool>`
- Claude Code: `mcp__spec-to-pr__<tool>`

This skill generates observability planning artifacts for a spec-to-pr Run.

## Why This Skill Exists

Observability setup changes the Run ledger and produces telemetry configuration artifacts. It may later affect target application code, collector configuration, and logging conventions.

Therefore it must be user-invoked, not automatically triggered.

## Inputs

Expected arguments:

```text
<run-id> [target] [collector-url]
```

Examples:

```text
/spec-to-pr:setup-observability run_abc both
/spec-to-pr:setup-observability run_abc target-app https://otel-collector.example.com/v1/traces
```

## Procedure

1. Parse the Run ID.
2. Determine target:
   - default: `both`
   - allowed: `plugin`, `target-app`, `both`
3. If a collector URL is provided, use it as `collectorUrl`.
4. Call `plan_observability`.
5. Call `generate_observability_config`.
6. Call `get_observability_report` with the returned report artifact ID.
7. Call `get_run` to confirm artifacts and gaps were recorded.
8. If reviewer output is available, call `record_observability_review`.
9. Report:
   - report artifact ID
   - generated artifact IDs
   - observability gap count
   - whether log correlation is enabled
   - whether OTel logs are enabled

## Tool Usage

Use only:

- `plan_observability`
- `generate_observability_config`
- `get_observability_report`
- `record_observability_review`
- `get_run`

Do not run shell commands.
Do not edit application files.
Do not claim production telemetry is deployed.

## Important Boundaries

This skill generates observability artifacts. It does not:

- deploy an OpenTelemetry Collector
- configure Grafana/Tempo/Jaeger
- guarantee production RUM data
- enable vendor-specific telemetry
- export secrets
- modify source code unless a later apply step is explicitly introduced

## Reviewer Agent Handoff

If observability gaps are created, ask the user whether they want to run the `observability-reviewer` agent.

The reviewer agent should inspect the report and explain:

- missing collector configuration
- missing log correlation
- unsafe telemetry attributes
- existing telemetry conflicts
- whether OTel Log SDK usage is marked experimental
