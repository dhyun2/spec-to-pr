import { z } from "zod";

import { CorrelationFieldsSchema } from "./telemetry-contract.js";
import type { CorrelationFields, TelemetryAttributes } from "./telemetry-contract.js";
import { redactTelemetryAttributes } from "./telemetry-redaction.js";

export const TelemetryContextSchema = z
  .object({
    correlation: CorrelationFieldsSchema,
    attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  })
  .strict();

export type TelemetryContext = z.infer<typeof TelemetryContextSchema>;

export function createTelemetryContext(input: {
  correlation: CorrelationFields;
  attributes?: TelemetryAttributes;
}): TelemetryContext {
  const redacted = redactTelemetryAttributes(input.attributes ?? {});

  return TelemetryContextSchema.parse({
    correlation: input.correlation,
    attributes: normalizeScalarAttributes(redacted),
  });
}

export function toStructuredLogFields(context: TelemetryContext) {
  return {
    trace_id: context.correlation.traceId,
    span_id: context.correlation.spanId,
    run_id: context.correlation.runId,
    stage: context.correlation.stageName,
    agent: context.correlation.agentRole,
    tool: context.correlation.toolName,
    artifact_id: context.correlation.artifactId,
    ...context.attributes,
  };
}

function normalizeScalarAttributes(attributes: TelemetryAttributes) {
  const result: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (Array.isArray(value)) {
      result[key] = value.join(",");
      continue;
    }

    result[key] = value;
  }

  return result;
}
