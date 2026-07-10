import { z } from "zod";

import { ArtifactIdSchema, EvidenceIdSchema, GapIdSchema } from "../runtime/ids.js";

export const TestLayerSchema = z.enum([
  "unit",
  "component",
  "contract",
  "acceptance",
  "e2e",
  "visual",
  "manual",
]);

export const TestAutomationStatusSchema = z.enum([
  "automated-candidate",
  "manual",
  "blocked",
  "review-needed",
]);

export const TestMatrixRequirementStatusSchema = z.enum([
  "ready",
  "partial",
  "blocked",
  "gap-only",
]);

export const TestMatrixRowSchema = z
  .object({
    requirementId: z.string().trim().min(1),
    scenarioId: z.string().trim().min(1),
    scenarioName: z.string().trim().min(1),
    featureFile: z.string().trim().min(1),
    area: z.string().trim().min(1),
    layer: TestLayerSchema,
    automation: TestAutomationStatusSchema,
    status: TestMatrixRequirementStatusSchema,
    reason: z.string().trim().min(1),
    briefEvidenceIds: z.array(EvidenceIdSchema).default([]),
    figmaEvidenceIds: z.array(EvidenceIdSchema).default([]),
    openApiEvidenceIds: z.array(EvidenceIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    sourceArtifactIds: z.array(ArtifactIdSchema).default([]),
  })
  .strict();

export const TestMatrixSchema = z
  .object({
    changeName: z.string().trim().min(1),
    generatedAt: z.string().datetime({ offset: true }),
    requirementCount: z.number().int().nonnegative(),
    scenarioCount: z.number().int().nonnegative(),
    automatedCandidateCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    reviewNeededCount: z.number().int().nonnegative(),
    rows: z.array(TestMatrixRowSchema),
  })
  .strict();

export type TestLayer = z.infer<typeof TestLayerSchema>;
export type TestAutomationStatus = z.infer<typeof TestAutomationStatusSchema>;
export type TestMatrixRequirementStatus = z.infer<typeof TestMatrixRequirementStatusSchema>;
export type TestMatrixRow = z.infer<typeof TestMatrixRowSchema>;
export type TestMatrix = z.infer<typeof TestMatrixSchema>;

export function inferTestLayer(input: {
  hasFigma: boolean;
  hasOpenApi: boolean;
  hasGaps: boolean;
  requirementText: string;
}): TestLayer {
  if (input.hasGaps) {
    return "manual";
  }

  if (
    input.hasOpenApi &&
    /api|request|response|endpoint|schema|operation/i.test(input.requirementText)
  ) {
    return "contract";
  }

  if (input.hasFigma && input.hasOpenApi) {
    return "acceptance";
  }

  if (input.hasFigma) {
    return "component";
  }

  if (input.hasOpenApi) {
    return "contract";
  }

  if (
    /format|mapper|policy|status|state|validation|계산|정책|상태|검증/.test(input.requirementText)
  ) {
    return "unit";
  }

  return "manual";
}

export function inferAutomationStatus(input: {
  requirementStatus: "ready" | "partial" | "blocked" | "gap-only";
  hasGaps: boolean;
  hasBlockerGap: boolean;
}): TestAutomationStatus {
  if (input.requirementStatus === "blocked" || input.hasBlockerGap) {
    return "blocked";
  }

  if (input.requirementStatus === "gap-only") {
    return "manual";
  }

  if (input.hasGaps || input.requirementStatus === "partial") {
    return "review-needed";
  }

  return "automated-candidate";
}
