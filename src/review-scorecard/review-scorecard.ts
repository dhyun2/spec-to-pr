import { z } from "zod";

import type { ArtifactRef } from "../runtime/artifact.js";

export const REVIEW_SCORECARD_REPORT_KIND = "review-scorecard-json" as const;
export const DEFAULT_REVIEW_SCORE_THRESHOLD = 8 as const;

export const ReviewScorecardDimensionStatusSchema = z.enum(["pass", "warning", "fail"]);

export const ReviewScorecardDimensionIdSchema = z.enum([
  "brief-fidelity",
  "legacy-coverage",
  "gherkin-completeness",
  "tdd-evidence",
  "design-system-usage",
  "visual-parity",
  "resource-contract",
  "api-contract",
  "publish-sync",
]);

export const ReviewScorecardDimensionSchema = z
  .object({
    id: ReviewScorecardDimensionIdSchema,
    label: z.string().trim().min(1),
    score: z.number().min(0).max(10),
    threshold: z.number().min(0).max(10).default(DEFAULT_REVIEW_SCORE_THRESHOLD),
    status: ReviewScorecardDimensionStatusSchema,
    notes: z.string().trim().min(1),
    evidence: z.array(z.string().trim().min(1)).default([]),
    nextRepairTarget: z.boolean().default(false),
  })
  .strict();

export const ReviewScorecardDecisionSchema = z.enum(["passed", "retry", "blocked"]);

export const ReviewScorecardSchema = z
  .object({
    adapter: z.literal("review-scorecard-v1"),
    generatedAt: z.string().datetime({ offset: true }),
    minimumScore: z.number().min(0).max(10).default(DEFAULT_REVIEW_SCORE_THRESHOLD),
    lowestScore: z.number().min(0).max(10),
    decision: ReviewScorecardDecisionSchema,
    nextRepairTarget: ReviewScorecardDimensionIdSchema.optional(),
    dimensions: z.array(ReviewScorecardDimensionSchema).min(1),
    summary: z.string().trim().min(1),
  })
  .strict();

export type ReviewScorecardDimension = z.infer<typeof ReviewScorecardDimensionSchema>;
export type ReviewScorecard = z.infer<typeof ReviewScorecardSchema>;

export type ReviewScorecardSummary = {
  artifactId: string;
  minimumScore: number;
  lowestScore: number;
  decision: z.infer<typeof ReviewScorecardDecisionSchema>;
  nextRepairTarget?: z.infer<typeof ReviewScorecardDimensionIdSchema>;
  dimensions: ReviewScorecardDimension[];
};

export function latestReviewScorecard(
  artifacts: ArtifactRef[],
): ReviewScorecardSummary | undefined {
  const artifact = [...artifacts]
    .reverse()
    .find(
      (item) =>
        item.kind === "review-scorecard" &&
        item.metadata["reportKind"] === REVIEW_SCORECARD_REPORT_KIND,
    );

  if (artifact === undefined) {
    return undefined;
  }

  return scorecardFromArtifact(artifact);
}

export function isReviewScorecardBlocking(artifacts: ArtifactRef[]): boolean {
  const scorecard = latestReviewScorecard(artifacts);

  if (scorecard === undefined) {
    return false;
  }

  return (
    scorecard.decision !== "passed" ||
    scorecard.lowestScore < scorecard.minimumScore ||
    scorecard.dimensions.some((dimension) => dimension.status === "fail")
  );
}

export function scorecardGateNote(scorecard: ReviewScorecardSummary): string {
  if (!isBlockingScorecard(scorecard)) {
    return `All review scorecard dimensions meet the required ${score(scorecard.minimumScore)} score.`;
  }

  const repairTarget =
    scorecard.nextRepairTarget ??
    scorecard.dimensions.find((dimension) => dimension.status === "fail")?.id;

  return `Lowest review score ${score(scorecard.lowestScore)} is below required ${score(scorecard.minimumScore)}${
    repairTarget === undefined ? "." : `; repair ${repairTarget} next.`
  }`;
}

export function isBlockingScorecard(scorecard: ReviewScorecardSummary): boolean {
  return (
    scorecard.decision !== "passed" ||
    scorecard.lowestScore < scorecard.minimumScore ||
    scorecard.dimensions.some((dimension) => dimension.status === "fail")
  );
}

function scorecardFromArtifact(artifact: ArtifactRef): ReviewScorecardSummary {
  const minimumScore = normalizeMinimumScore(
    metadataNumber(artifact.metadata["minimumScore"], DEFAULT_REVIEW_SCORE_THRESHOLD),
  );
  const rawDimensions = Array.isArray(artifact.metadata["dimensions"])
    ? artifact.metadata["dimensions"]
    : [];
  const nextRepairTarget = parseDimensionId(artifact.metadata["nextRepairTarget"]);
  const dimensions = rawDimensions.map((dimension) =>
    normalizeDimension(dimension, minimumScore, nextRepairTarget),
  );
  const fallbackDimension =
    dimensions.length === 0
      ? [
          ReviewScorecardDimensionSchema.parse({
            id: "brief-fidelity",
            label: "Overall review scorecard",
            score: metadataNumber(artifact.metadata["lowestScore"], 0),
            threshold: minimumScore,
            status:
              metadataNumber(artifact.metadata["lowestScore"], 0) >= minimumScore ? "pass" : "fail",
            notes: "No dimension rows were recorded; using overall score metadata.",
            nextRepairTarget: nextRepairTarget === "brief-fidelity",
          }),
        ]
      : [];
  const parsedDimensions = dimensions.length > 0 ? dimensions : fallbackDimension;
  const lowestScore = metadataNumber(
    artifact.metadata["lowestScore"],
    Math.min(...parsedDimensions.map((dimension) => dimension.score)),
  );
  const decision = parseDecision(
    artifact.metadata["decision"],
    parsedDimensions,
    lowestScore,
    minimumScore,
  );

  return {
    artifactId: artifact.id,
    minimumScore,
    lowestScore,
    decision,
    ...(nextRepairTarget === undefined ? {} : { nextRepairTarget }),
    dimensions: parsedDimensions,
  };
}

function normalizeDimension(
  rawDimension: unknown,
  defaultThreshold: number,
  nextRepairTarget: z.infer<typeof ReviewScorecardDimensionIdSchema> | undefined,
): ReviewScorecardDimension {
  const record = isRecord(rawDimension) ? rawDimension : {};
  const id = parseDimensionId(record["id"]) ?? "brief-fidelity";
  const threshold = normalizeMinimumScore(metadataNumber(record["threshold"], defaultThreshold));
  const scoreValue = metadataNumber(record["score"], 0);
  const explicitStatus = parseStatus(record["status"]);
  const status = explicitStatus ?? (scoreValue >= threshold ? "pass" : "fail");
  const explicitNextRepairTarget =
    typeof record["nextRepairTarget"] === "boolean" ? record["nextRepairTarget"] : false;

  return ReviewScorecardDimensionSchema.parse({
    id,
    label: typeof record["label"] === "string" && record["label"].trim() ? record["label"] : id,
    score: scoreValue,
    threshold,
    status,
    notes:
      typeof record["notes"] === "string" && record["notes"].trim()
        ? record["notes"]
        : "No scorecard notes were recorded for this dimension.",
    evidence: Array.isArray(record["evidence"])
      ? record["evidence"].filter((value): value is string => typeof value === "string")
      : [],
    nextRepairTarget: explicitNextRepairTarget || nextRepairTarget === id,
  });
}

function parseDecision(
  value: unknown,
  dimensions: ReviewScorecardDimension[],
  lowestScore: number,
  minimumScore: number,
): z.infer<typeof ReviewScorecardDecisionSchema> {
  if (value === "passed" || value === "retry" || value === "blocked") {
    return value;
  }

  return lowestScore >= minimumScore && dimensions.every((dimension) => dimension.status !== "fail")
    ? "passed"
    : "retry";
}

function parseDimensionId(
  value: unknown,
): z.infer<typeof ReviewScorecardDimensionIdSchema> | undefined {
  const parsed = ReviewScorecardDimensionIdSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

function parseStatus(
  value: unknown,
): z.infer<typeof ReviewScorecardDimensionStatusSchema> | undefined {
  const parsed = ReviewScorecardDimensionStatusSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

function metadataNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeMinimumScore(value: number): number {
  if (value > 0 && value <= 1) {
    return Number((value * 10).toFixed(2));
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function score(value: number): string {
  return value.toFixed(2);
}
