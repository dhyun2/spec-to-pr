# Task 29 - OpenTelemetry and Log Correlation

## Goal

Add observability planning, telemetry configuration, trace/log correlation, and redaction rules for the plugin workflow and target application integration points.

## Why This Task Exists

The spec-to-pr workflow is long-running and multi-stage. Failures must be traceable across:

- Run
- Stage
- Agent
- MCP Tool
- command execution
- quality gate
- visual comparison
- accessibility check
- performance gate
- artifact generation

## Inputs

- Run ID
- project profile
- API wrapper artifacts
- quality/visual/accessibility/performance reports
- target observability preferences
- optional OTLP endpoint configuration

## Outputs

- telemetry resource contract
- span naming policy
- redaction policy
- plugin correlation log format
- target app observability plan
- optional OpenTelemetry config files
- API wrapper instrumentation template
- observability report artifact
- observability gaps

## Non-Goals

- No collector deployment
- No vendor-specific lock-in
- No production RUM data collection claim
- No full OTel Log SDK dependency claim
- No unredacted secrets in telemetry
- No automatic app-wide instrumentation without project policy

## Definition of Done

- Telemetry resource contract exists.
- Redaction layer blocks secret-like attributes.
- Observability plan can be generated for a Run.
- OpenTelemetry config template can be rendered.
- API wrapper span template can be rendered.
- Structured log correlation fields are defined.
- Observability report is stored as an artifact.
- MCP tools work through stdio integration tests.
