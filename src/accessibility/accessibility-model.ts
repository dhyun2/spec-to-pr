import { z } from "zod";

import { ArtifactIdSchema, EvidenceIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";

export const AccessibilitySeveritySchema = z.enum(["critical", "serious", "moderate", "minor"]);

export const AccessibilityCheckStatusSchema = z.enum([
  "passed",
  "failed",
  "skipped",
  "not-run",
  "review-needed",
]);

export const AccessibilityTargetSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    url: z.string().trim().min(1),
    viewport: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
    sourceRequirementIds: z.array(z.string()).default([]),
    figmaArtifactIds: z.array(ArtifactIdSchema).default([]),
    browserScreenshotArtifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const AccessibilityViolationSchema = z
  .object({
    id: z.string().trim().min(1),
    impact: AccessibilitySeveritySchema,
    help: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    helpUrl: z.string().url().optional(),
    target: z.array(z.string()).default([]),
    html: z.string().optional(),
    failureSummary: z.string().optional(),
    wcagTags: z.array(z.string()).default([]),
  })
  .strict();

export const AutomatedAccessibilityCheckSchema = z
  .object({
    id: z.string().trim().min(1),
    targetId: z.string().trim().min(1),
    engine: z.enum(["axe-core", "custom", "playwright"]),
    status: AccessibilityCheckStatusSchema,
    violationCount: z.number().int().nonnegative(),
    criticalCount: z.number().int().nonnegative(),
    seriousCount: z.number().int().nonnegative(),
    moderateCount: z.number().int().nonnegative(),
    minorCount: z.number().int().nonnegative(),
    violations: z.array(AccessibilityViolationSchema).default([]),
    reportArtifactId: ArtifactIdSchema.optional(),
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    summary: z.string().trim().min(1),
  })
  .strict();

export const KeyboardCheckSchema = z
  .object({
    id: z.string().trim().min(1),
    targetId: z.string().trim().min(1),
    status: AccessibilityCheckStatusSchema,
    tabStops: z.number().int().nonnegative().optional(),
    escapeWorks: z.boolean().optional(),
    enterSpaceWorks: z.boolean().optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export const FocusCheckSchema = z
  .object({
    id: z.string().trim().min(1),
    targetId: z.string().trim().min(1),
    status: AccessibilityCheckStatusSchema,
    focusTrapWorks: z.boolean().optional(),
    focusRestoreWorks: z.boolean().optional(),
    initialFocusSelector: z.string().optional(),
    finalFocusSelector: z.string().optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export const ManualAccessibilityReviewItemSchema = z
  .object({
    id: z.string().trim().min(1),
    targetId: z.string().trim().min(1),
    topic: z.enum([
      "screen-reader-flow",
      "focus-order",
      "keyboard-usability",
      "accessible-copy",
      "motion-reduction",
      "touch-target",
      "complex-widget",
      "other",
    ]),
    status: z.enum(["required", "not-run", "completed", "waived"]),
    reason: z.string().trim().min(1),
    reviewer: z.string().trim().min(1).optional(),
    reviewedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export const AccessibilityGateDecisionSchema = z.enum([
  "passed",
  "failed",
  "review-needed",
  "blocked",
]);

export const AccessibilityReportSchema = z
  .object({
    adapter: z.literal("accessibility-gate-v1"),
    runId: RunIdSchema,
    generatedAt: IsoDateTimeSchema,
    targets: z.array(AccessibilityTargetSchema),
    automatedChecks: z.array(AutomatedAccessibilityCheckSchema),
    keyboardChecks: z.array(KeyboardCheckSchema),
    focusChecks: z.array(FocusCheckSchema),
    manualReviewItems: z.array(ManualAccessibilityReviewItemSchema),
    gapIds: z.array(GapIdSchema).default([]),
    artifactIds: z.array(ArtifactIdSchema).default([]),
    decision: AccessibilityGateDecisionSchema,
    summary: z.string().trim().min(1),
  })
  .strict();

export const AccessibilityReviewRecordSchema = z
  .object({
    runId: RunIdSchema,
    reportArtifactId: ArtifactIdSchema,
    reviewer: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    falsePositiveNotes: z.array(z.string()).default([]),
    manualReviewNotes: z.array(z.string()).default([]),
    recordedAt: IsoDateTimeSchema,
  })
  .strict();

export type AccessibilitySeverity = z.infer<typeof AccessibilitySeveritySchema>;
export type AccessibilityCheckStatus = z.infer<typeof AccessibilityCheckStatusSchema>;
export type AccessibilityTarget = z.infer<typeof AccessibilityTargetSchema>;
export type AccessibilityViolation = z.infer<typeof AccessibilityViolationSchema>;
export type AutomatedAccessibilityCheck = z.infer<typeof AutomatedAccessibilityCheckSchema>;
export type KeyboardCheck = z.infer<typeof KeyboardCheckSchema>;
export type FocusCheck = z.infer<typeof FocusCheckSchema>;
export type ManualAccessibilityReviewItem = z.infer<
  typeof ManualAccessibilityReviewItemSchema
>;
export type AccessibilityReport = z.infer<typeof AccessibilityReportSchema>;
export type AccessibilityGateDecision = z.infer<typeof AccessibilityGateDecisionSchema>;
export type AccessibilityReviewRecord = z.infer<typeof AccessibilityReviewRecordSchema>;
