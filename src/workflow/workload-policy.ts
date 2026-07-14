import { z } from "zod";

import type { DeliveryMode, WorkflowScope } from "./workflow-contracts.js";

export const WorkloadSizeSchema = z.enum(["XS", "S", "M", "L", "XL"]);
export const WorkloadConfidenceSchema = z.enum(["low", "medium", "high"]);
export const WorkloadSignalsSchema = z
  .object({
    requirements: z.number().int().nonnegative().optional(),
    relevantFiles: z.number().int().nonnegative().optional(),
    apiOperations: z.number().int().nonnegative().optional(),
    uiSurfaces: z.number().int().nonnegative().optional(),
    figmaNodes: z.number().int().nonnegative().optional(),
    testTargets: z.number().int().nonnegative().optional(),
    workspacePackages: z.number().int().nonnegative().optional(),
    uncertainty: z.number().int().min(0).max(5).optional(),
  })
  .strict();

export const WorkloadEstimateSchema = z
  .object({
    size: WorkloadSizeSchema,
    score: z.number().int().nonnegative(),
    confidence: WorkloadConfidenceSchema,
    source: z.enum(["intake", "contracts", "calibrated"]),
    tokenRange: z
      .object({
        min: z.number().int().positive(),
        max: z.number().int().positive(),
      })
      .strict()
      .refine((range) => range.min < range.max, "Token range min must be below max"),
    budget: z
      .object({
        checkpointPercent: z.literal(80),
        checkpointAtTokens: z.number().int().positive(),
        hardLimitTokens: z.number().int().positive(),
      })
      .strict(),
    sampleCount: z.number().int().nonnegative(),
    reasons: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()
  .superRefine((estimate, context) => {
    if (estimate.budget.hardLimitTokens !== estimate.tokenRange.max) {
      context.addIssue({
        code: "custom",
        path: ["budget", "hardLimitTokens"],
        message: "Workload hard limit must equal the token range maximum",
      });
    }
    if (estimate.budget.checkpointAtTokens !== Math.floor(estimate.budget.hardLimitTokens * 0.8)) {
      context.addIssue({
        code: "custom",
        path: ["budget", "checkpointAtTokens"],
        message: "Workload checkpoint must equal 80% of the hard limit",
      });
    }
  });

export type WorkloadSize = z.infer<typeof WorkloadSizeSchema>;
export type WorkloadSignals = z.infer<typeof WorkloadSignalsSchema>;
export type WorkloadEstimate = z.infer<typeof WorkloadEstimateSchema>;

const TOKEN_RANGES: Record<WorkloadSize, { min: number; max: number }> = {
  XS: { min: 20_000, max: 50_000 },
  S: { min: 45_000, max: 100_000 },
  M: { min: 90_000, max: 180_000 },
  L: { min: 160_000, max: 320_000 },
  XL: { min: 280_000, max: 600_000 },
};

const MODE_WEIGHT: Record<DeliveryMode, number> = {
  auto: 0,
  brief: 4,
  legacy: 8,
  feature: 6,
  figma: 5,
};

export function estimateWorkload(input: {
  phase: "intake" | "contracts";
  mode: DeliveryMode;
  scope: Pick<WorkflowScope, "code" | "ui" | "api">;
  signals: WorkloadSignals;
}): WorkloadEstimate {
  const signals = WorkloadSignalsSchema.parse(input.signals);
  const score = Math.ceil(
    (signals.requirements ?? 0) * 2 +
      (signals.relevantFiles ?? 0) +
      (signals.apiOperations ?? 0) * 3 +
      (signals.uiSurfaces ?? 0) * 4 +
      Math.min(signals.figmaNodes ?? 0, 40) * 0.5 +
      (signals.testTargets ?? 0) * 2 +
      Math.min(signals.workspacePackages ?? 0, 20) * 4 +
      (signals.uncertainty ?? 2) * 4 +
      MODE_WEIGHT[input.mode] +
      (input.scope.code ? 2 : 0) +
      (input.scope.api ? 3 : 0) +
      (input.scope.ui ? 4 : 0),
  );
  const size = sizeForScore(score);
  const tokenRange = TOKEN_RANGES[size];
  const observedFields = Object.keys(signals).filter((key) => key !== "uncertainty").length;
  const confidence =
    input.phase === "intake"
      ? "low"
      : (signals.uncertainty ?? 1) === 0 && observedFields >= 5
        ? "high"
        : "medium";
  const reasons = [
    `${input.phase} signals score ${score}`,
    `${input.mode} delivery profile`,
    input.scope.ui ? "UI scope included" : "No UI scope",
    input.scope.api ? "API scope included" : "No API scope",
  ];

  return WorkloadEstimateSchema.parse({
    size,
    score,
    confidence,
    source: input.phase,
    tokenRange,
    budget: {
      checkpointPercent: 80,
      checkpointAtTokens: Math.floor(tokenRange.max * 0.8),
      hardLimitTokens: tokenRange.max,
    },
    sampleCount: 0,
    reasons,
  });
}

function sizeForScore(score: number): WorkloadSize {
  if (score <= 8) return "XS";
  if (score <= 24) return "S";
  if (score <= 50) return "M";
  if (score <= 90) return "L";
  return "XL";
}
