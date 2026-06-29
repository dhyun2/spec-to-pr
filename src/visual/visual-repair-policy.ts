import { z } from "zod";

import type { VisualReport } from "./visual-model.js";

export const VisualRepairScoreMetricSchema = z.enum(["reviewMatchRatio", "exactMatchRatio"]);

export const VisualRepairPolicySchema = z
  .object({
    minPassingScore: z.number().min(0).max(1).default(0.9),
    maxAttempts: z.number().int().positive().max(20).default(3),
    scoreMetric: VisualRepairScoreMetricSchema.default("reviewMatchRatio"),
    retryOnReviewNeeded: z.boolean().default(true),
  })
  .strict();

export const VisualRepairDecisionSchema = z
  .object({
    status: z.enum(["passed", "retry", "failed", "not-applicable"]),
    score: z.number().min(0).max(1),
    threshold: z.number().min(0).max(1),
    attempt: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
    attemptsRemaining: z.number().int().nonnegative(),
    scoreMetric: VisualRepairScoreMetricSchema,
    passingTargetIds: z.array(z.string().trim().min(1)),
    failingTargetIds: z.array(z.string().trim().min(1)),
    nextOwner: z.enum(["design-ui", "human", "none"]),
    reason: z.string().trim().min(1),
  })
  .strict();

export type VisualRepairPolicy = z.infer<typeof VisualRepairPolicySchema>;
export type VisualRepairDecision = z.infer<typeof VisualRepairDecisionSchema>;

export const DEFAULT_VISUAL_REPAIR_POLICY: VisualRepairPolicy = VisualRepairPolicySchema.parse({});

export function decideVisualRepair(input: {
  report: VisualReport;
  attempt: number;
  policy?: Partial<VisualRepairPolicy>;
}): VisualRepairDecision {
  const policy = VisualRepairPolicySchema.parse(input.policy ?? {});
  const attempt = Math.max(1, Math.floor(input.attempt));
  const attemptsRemaining = Math.max(policy.maxAttempts - attempt, 0);

  if (input.report.results.length === 0) {
    return VisualRepairDecisionSchema.parse({
      status: "not-applicable",
      score: 1,
      threshold: policy.minPassingScore,
      attempt,
      maxAttempts: policy.maxAttempts,
      attemptsRemaining,
      scoreMetric: policy.scoreMetric,
      passingTargetIds: [],
      failingTargetIds: [],
      nextOwner: "none",
      reason: "No visual comparison targets were present in the report.",
    });
  }

  const scoredResults = input.report.results.map((result) => ({
    targetId: result.targetId,
    status: result.status,
    score: result.metrics[policy.scoreMetric],
  }));
  const failing = scoredResults.filter(
    (result) =>
      result.score < policy.minPassingScore ||
      result.status === "failed" ||
      (policy.retryOnReviewNeeded && result.status === "review-needed"),
  );
  const score = roundScore(Math.min(...scoredResults.map((result) => result.score)));

  if (failing.length === 0) {
    return VisualRepairDecisionSchema.parse({
      status: "passed",
      score,
      threshold: policy.minPassingScore,
      attempt,
      maxAttempts: policy.maxAttempts,
      attemptsRemaining,
      scoreMetric: policy.scoreMetric,
      passingTargetIds: scoredResults.map((result) => result.targetId),
      failingTargetIds: [],
      nextOwner: "none",
      reason: `All visual targets met the ${(policy.minPassingScore * 100).toFixed(2)}% repair threshold.`,
    });
  }

  const exhausted = attempt >= policy.maxAttempts;

  return VisualRepairDecisionSchema.parse({
    status: exhausted ? "failed" : "retry",
    score,
    threshold: policy.minPassingScore,
    attempt,
    maxAttempts: policy.maxAttempts,
    attemptsRemaining,
    scoreMetric: policy.scoreMetric,
    passingTargetIds: scoredResults
      .filter((result) => !failing.some((failed) => failed.targetId === result.targetId))
      .map((result) => result.targetId),
    failingTargetIds: failing.map((result) => result.targetId),
    nextOwner: exhausted ? "human" : "design-ui",
    reason: exhausted
      ? `Visual repair failed after ${policy.maxAttempts} attempt(s); lowest ${policy.scoreMetric} was ${(score * 100).toFixed(2)}%.`
      : `Visual repair requires another Design/UI attempt; lowest ${policy.scoreMetric} was ${(score * 100).toFixed(2)}%.`,
  });
}

function roundScore(score: number): number {
  return Number(score.toFixed(4));
}
