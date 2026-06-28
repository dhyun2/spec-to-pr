import { z } from "zod";

import type { VisualComparisonMetrics, VisualComparisonStatus } from "./visual-model.js";

export const VisualGatePolicySchema = z
  .object({
    exactPassThreshold: z.number().min(0).max(1).default(0.95),
    reviewPassThreshold: z.number().min(0).max(1).default(0.8),
    reviewDistanceThreshold: z.number().int().min(0).max(441).default(64),
    failBelowReviewThreshold: z.boolean().default(true),
  })
  .strict();

export type VisualGatePolicy = z.infer<typeof VisualGatePolicySchema>;

export const DEFAULT_VISUAL_GATE_POLICY: VisualGatePolicy = VisualGatePolicySchema.parse({});

export function evaluateVisualComparison(input: {
  metrics: VisualComparisonMetrics;
  policy: VisualGatePolicy;
}): VisualComparisonStatus {
  if (
    input.metrics.exactMatchRatio >= input.policy.exactPassThreshold ||
    input.metrics.reviewMatchRatio >= input.policy.reviewPassThreshold
  ) {
    return "passed";
  }

  return input.policy.failBelowReviewThreshold ? "failed" : "review-needed";
}
