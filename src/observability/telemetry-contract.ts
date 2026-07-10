import { z } from "zod";

export const TelemetrySignalSchema = z.enum(["trace", "metric", "log"]);

export const SpecToPrSpanNameSchema = z.enum([
  "spec_to_pr.run",
  "spec_to_pr.stage",
  "spec_to_pr.mcp_tool",
  "spec_to_pr.agent",
  "spec_to_pr.command",
  "spec_to_pr.quality_gate",
  "spec_to_pr.visual_compare",
  "spec_to_pr.accessibility_gate",
  "spec_to_pr.performance_gate",
  "spec_to_pr.report",
]);

export const TelemetryAttributeKeySchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9_.-]+$/, "Expected lowercase semantic attribute key");

export const TelemetryAttributeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
]);

export const TelemetryAttributesSchema = z.record(
  TelemetryAttributeKeySchema,
  TelemetryAttributeValueSchema,
);

export const CorrelationFieldsSchema = z
  .object({
    traceId: z.string().trim().min(1).optional(),
    spanId: z.string().trim().min(1).optional(),
    runId: z.string().trim().min(1).optional(),
    stageName: z.string().trim().min(1).optional(),
    agentRole: z.string().trim().min(1).optional(),
    toolName: z.string().trim().min(1).optional(),
    artifactId: z.string().trim().min(1).optional(),
  })
  .strict();

export type TelemetrySignal = z.infer<typeof TelemetrySignalSchema>;
export type SpecToPrSpanName = z.infer<typeof SpecToPrSpanNameSchema>;
export type TelemetryAttributes = z.infer<typeof TelemetryAttributesSchema>;
export type CorrelationFields = z.infer<typeof CorrelationFieldsSchema>;

export const SPEC_TO_PR_ATTRIBUTE_KEYS = {
  runId: "spec_to_pr.run.id",
  runRevision: "spec_to_pr.run.revision",
  stageName: "spec_to_pr.stage.name",
  stageAttempt: "spec_to_pr.stage.attempt",
  agentRole: "spec_to_pr.agent.role",
  toolName: "spec_to_pr.tool.name",
  commandName: "spec_to_pr.command.name",
  commandExitCode: "spec_to_pr.command.exit_code",
  artifactId: "spec_to_pr.artifact.id",
  gapId: "spec_to_pr.gap.id",
  worktreePath: "spec_to_pr.worktree.path",
  baseSha: "spec_to_pr.git.base_sha",
  headSha: "spec_to_pr.git.head_sha",
} as const;
