import { z } from "zod";

export const ObservabilityTargetSchema = z.enum(["plugin", "target-app", "both"]);

export const TelemetryExporterSchema = z.enum(["console", "otlp-http", "otlp-grpc", "none"]);

export const DeploymentEnvironmentSchema = z.enum(["development", "test", "staging", "production"]);

export const ObservabilityPlanSchema = z
  .object({
    target: ObservabilityTargetSchema,
    exporter: TelemetryExporterSchema,
    collectorUrl: z.string().url().optional(),
    serviceName: z.string().trim().min(1),
    serviceVersion: z.string().trim().min(1),
    environment: DeploymentEnvironmentSchema,
    enableTraces: z.boolean(),
    enableMetrics: z.boolean(),
    enableLogCorrelation: z.boolean(),
    enableOtelLogs: z.boolean(),
    apiWrapperInstrumentation: z.boolean(),
    criticalUserActionInstrumentation: z.boolean(),
    redactionEnabled: z.boolean(),
    existingTelemetryDetected: z.boolean(),
    existingLoggerDetected: z.boolean(),
    notes: z.array(z.string()).default([]),
  })
  .strict();

export const ObservabilityGapSchema = z
  .object({
    severity: z.enum(["blocker", "major", "minor", "info"]),
    title: z.string().trim().min(1),
    expected: z.string().trim().min(1),
    observed: z.string().trim().min(1),
    impact: z.string().trim().min(1),
  })
  .strict();

export type ObservabilityTarget = z.infer<typeof ObservabilityTargetSchema>;
export type TelemetryExporter = z.infer<typeof TelemetryExporterSchema>;
export type DeploymentEnvironment = z.infer<typeof DeploymentEnvironmentSchema>;
export type ObservabilityPlan = z.infer<typeof ObservabilityPlanSchema>;
export type ObservabilityGap = z.infer<typeof ObservabilityGapSchema>;

export function createDefaultObservabilityPlan(input: {
  target: ObservabilityTarget;
  serviceName: string;
  serviceVersion: string;
  environment?: DeploymentEnvironment;
  collectorUrl?: string;
  existingTelemetryDetected?: boolean;
  existingLoggerDetected?: boolean;
}): ObservabilityPlan {
  const exporter = input.collectorUrl === undefined ? "console" : "otlp-http";

  return ObservabilityPlanSchema.parse({
    target: input.target,
    exporter,
    ...(input.collectorUrl === undefined ? {} : { collectorUrl: input.collectorUrl }),
    serviceName: input.serviceName,
    serviceVersion: input.serviceVersion,
    environment: input.environment ?? "development",
    enableTraces: true,
    enableMetrics: true,
    enableLogCorrelation: true,
    enableOtelLogs: false,
    apiWrapperInstrumentation: true,
    criticalUserActionInstrumentation: false,
    redactionEnabled: true,
    existingTelemetryDetected: input.existingTelemetryDetected ?? false,
    existingLoggerDetected: input.existingLoggerDetected ?? false,
    notes: [
      "OpenTelemetry logs for Node.js are treated as optional; structured log correlation is enabled by default.",
    ],
  });
}

export function detectObservabilityGaps(plan: ObservabilityPlan): ObservabilityGap[] {
  const gaps: ObservabilityGap[] = [];

  if (!plan.redactionEnabled) {
    gaps.push(
      ObservabilityGapSchema.parse({
        severity: "blocker",
        title: "Telemetry redaction is disabled",
        expected: "Telemetry attributes should pass through a redaction layer.",
        observed: "redactionEnabled is false.",
        impact: "Secrets could be exported to telemetry backends.",
      }),
    );
  }

  if (plan.exporter !== "console" && plan.exporter !== "none" && plan.collectorUrl === undefined) {
    gaps.push(
      ObservabilityGapSchema.parse({
        severity: "major",
        title: "Collector URL is missing",
        expected: "OTLP exporters should define a collector URL.",
        observed: `Exporter is ${plan.exporter}, but collectorUrl is missing.`,
        impact: "Telemetry cannot be delivered to a collector.",
      }),
    );
  }

  if (!plan.enableLogCorrelation) {
    gaps.push(
      ObservabilityGapSchema.parse({
        severity: "minor",
        title: "Log correlation is disabled",
        expected: "Logs should include trace_id/span_id/run_id correlation fields.",
        observed: "enableLogCorrelation is false.",
        impact: "Failures may be harder to correlate across trace and logs.",
      }),
    );
  }

  if (plan.enableOtelLogs) {
    gaps.push(
      ObservabilityGapSchema.parse({
        severity: "info",
        title: "OpenTelemetry Log SDK is enabled explicitly",
        expected: "Node.js log SDK integration should be treated as optional and reviewed.",
        observed: "enableOtelLogs is true.",
        impact:
          "Runtime compatibility should be verified because Node.js OTel logging support may change.",
      }),
    );
  }

  return gaps;
}
