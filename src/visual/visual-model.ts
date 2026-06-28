import { z } from "zod";

import { ArtifactIdSchema, EvidenceIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";

export const VisualTargetStatusSchema = z.enum([
  "planned",
  "captured",
  "compared",
  "failed",
  "review-needed",
  "passed",
]);

export const VisualMaskRegionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const VisualViewportSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    deviceScaleFactor: z.number().positive().default(1),
    isMobile: z.boolean().default(false),
  })
  .strict();

export const VisualTargetSchema = z
  .object({
    id: z.string().trim().min(1),
    runId: RunIdSchema,
    changeName: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(200),
    route: z.string().trim().min(1),
    viewport: VisualViewportSchema,
    figmaSourceId: z.string().trim().min(1),
    figmaEvidenceIds: z.array(EvidenceIdSchema).default([]),
    figmaScreenshotArtifactId: ArtifactIdSchema,
    designContractArtifactId: ArtifactIdSchema.optional(),
    masks: z.array(VisualMaskRegionSchema).default([]),
    status: VisualTargetStatusSchema.default("planned"),
  })
  .strict();

export const VisualComparisonMetricsSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    comparedPixelCount: z.number().int().nonnegative(),
    maskedPixelCount: z.number().int().nonnegative(),
    exactMatchRatio: z.number().min(0).max(1),
    reviewMatchRatio: z.number().min(0).max(1),
    meanDistance: z.number().nonnegative(),
    maxDistance: z.number().nonnegative(),
  })
  .strict();

export const VisualComparisonStatusSchema = z.enum(["passed", "failed", "review-needed"]);

export const VisualComparisonResultSchema = z
  .object({
    targetId: z.string().trim().min(1),
    status: VisualComparisonStatusSchema,
    figmaScreenshotArtifactId: ArtifactIdSchema,
    browserScreenshotArtifactId: ArtifactIdSchema,
    overlayArtifactId: ArtifactIdSchema.optional(),
    diffArtifactId: ArtifactIdSchema.optional(),
    metrics: VisualComparisonMetricsSchema,
    gapIds: z.array(GapIdSchema).default([]),
    notes: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const VisualReportSchema = z
  .object({
    runId: RunIdSchema,
    changeName: z.string().trim().min(1),
    generatedAt: IsoDateTimeSchema,
    targetCount: z.number().int().nonnegative(),
    passedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    reviewNeededCount: z.number().int().nonnegative(),
    results: z.array(VisualComparisonResultSchema),
  })
  .strict();

export const VisualReviewFindingCategorySchema = z.enum([
  "implementation-mismatch",
  "design-contract-gap",
  "fixture-data-mismatch",
  "dynamic-region-mask-needed",
  "excessive-mask",
  "font-rendering-tolerance",
  "acceptable-difference",
  "reviewer-needed",
]);

export const VisualReviewFindingSeveritySchema = z.enum(["blocker", "major", "minor", "info"]);

export const VisualReviewFindingSchema = z
  .object({
    targetId: z.string().trim().min(1),
    severity: VisualReviewFindingSeveritySchema,
    category: VisualReviewFindingCategorySchema,
    description: z.string().trim().min(1).max(2_000),
    recommendedOwner: z
      .enum(["design-ui", "api-contract", "integrator", "review-council", "human"])
      .optional(),
    requiresHumanReview: z.boolean().default(false),
    artifactIds: z.array(ArtifactIdSchema).default([]),
  })
  .strict();

export const VisualReviewResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(2_000),
    findings: z.array(VisualReviewFindingSchema).default([]),
  })
  .strict();

export type VisualTargetStatus = z.infer<typeof VisualTargetStatusSchema>;
export type VisualMaskRegion = z.infer<typeof VisualMaskRegionSchema>;
export type VisualViewport = z.infer<typeof VisualViewportSchema>;
export type VisualTarget = z.infer<typeof VisualTargetSchema>;
export type VisualComparisonMetrics = z.infer<typeof VisualComparisonMetricsSchema>;
export type VisualComparisonStatus = z.infer<typeof VisualComparisonStatusSchema>;
export type VisualComparisonResult = z.infer<typeof VisualComparisonResultSchema>;
export type VisualReport = z.infer<typeof VisualReportSchema>;
export type VisualReviewFinding = z.infer<typeof VisualReviewFindingSchema>;
export type VisualReviewResult = z.infer<typeof VisualReviewResultSchema>;
