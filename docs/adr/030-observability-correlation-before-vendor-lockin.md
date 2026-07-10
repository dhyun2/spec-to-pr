# ADR-030: Observability Correlation Before Vendor Lock-in

## Status

Accepted

## Context

The plugin should produce traceable evidence for long-running multi-agent workflows.

It would be tempting to generate vendor-specific integrations directly, such as Datadog, New Relic, Honeycomb, or Grafana Cloud configuration.

However, the plugin should remain portable and evidence-first.

## Decision

Use OpenTelemetry-compatible contracts and templates first.

Task 29 generates:

- resource attributes
- span naming policy
- trace/log correlation fields
- redaction policy
- OTLP configuration template
- API wrapper instrumentation template
- observability readiness report

The default log strategy is structured log correlation with trace_id/span_id/run_id/stage_id fields.

## Consequences

Good:

- Vendor-neutral telemetry.
- PR report can explain observability readiness.
- Sensitive values are redacted by policy.
- Existing logger or tracing setup can be detected and respected.

Tradeoffs:

- Task 29 does not deploy a collector.
- Task 29 does not guarantee production field telemetry.
- Node.js OTel log SDK integration remains optional.
