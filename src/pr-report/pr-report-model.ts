import { z } from "zod";

import { ArtifactIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";

export const ReportLocaleSchema = z.enum(["ko", "en"]);

export const ReportDecisionSchema = z.enum(["blocked", "draft", "ready-after-review", "ready"]);

export const ReportSectionStatusSchema = z.enum([
  "pass",
  "fail",
  "warning",
  "not-run",
  "skipped",
  "not-applicable",
]);

export const ReportLinkSchema = z
  .object({
    label: z.string().trim().min(1),
    uri: z.string().trim().min(1),
  })
  .strict();

export const ReportCheckSummarySchema = z
  .object({
    name: z.string().trim().min(1),
    kind: z.string().trim().min(1),
    status: ReportSectionStatusSchema,
    command: z.string().optional(),
    exitCode: z.number().int().optional(),
    reportArtifactId: ArtifactIdSchema.optional(),
    summary: z.string().trim().min(1),
  })
  .strict();

export const ReportGapSummarySchema = z
  .object({
    id: GapIdSchema,
    category: z.string(),
    severity: z.string(),
    status: z.string(),
    title: z.string(),
    impact: z.string(),
  })
  .strict();

export const ReportGateRowSchema = z
  .object({
    gate: z.string().trim().min(1),
    required: z.boolean(),
    status: ReportSectionStatusSchema,
    evidence: z.array(z.string().trim().min(1)).default([]),
    notes: z.string().trim().min(1),
  })
  .strict();

export const ReportArtifactSummaryRowSchema = z
  .object({
    item: z.string().trim().min(1),
    status: ReportSectionStatusSchema,
    artifacts: z.array(ArtifactIdSchema).default([]),
    notes: z.string().trim().min(1),
  })
  .strict();

export const RequirementTraceRowSchema = z
  .object({
    requirementId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    status: z.string().trim().min(1),
    briefEvidence: z.array(z.string()).default([]),
    figmaEvidence: z.array(z.string()).default([]),
    openApiEvidence: z.array(z.string()).default([]),
    scenarios: z.array(z.string()).default([]),
    checks: z.array(z.string()).default([]),
    gaps: z.array(GapIdSchema).default([]),
  })
  .strict();

export const VisualComparisonRowSchema = z
  .object({
    state: z.string().trim().min(1),
    figmaArtifactId: ArtifactIdSchema.optional(),
    browserArtifactId: ArtifactIdSchema.optional(),
    diffArtifactId: ArtifactIdSchema.optional(),
    exactMatch: z.number().min(0).max(100).optional(),
    reviewMatch: z.number().min(0).max(100).optional(),
    result: ReportSectionStatusSchema,
    notes: z.string().optional(),
  })
  .strict();

export const PerformanceMetricRowSchema = z
  .object({
    metric: z.string().trim().min(1),
    value: z.string().trim().min(1),
    budget: z.string().optional(),
    result: ReportSectionStatusSchema,
    source: z.string().trim().min(1),
  })
  .strict();

export const PrReportViewModelSchema = z
  .object({
    schemaVersion: z.literal("pr-report-v1"),
    locale: ReportLocaleSchema.default("en"),
    runId: RunIdSchema,
    generatedAt: z.string().datetime({ offset: true }),
    decision: ReportDecisionSchema,
    title: z.string().trim().min(1),
    summaryBullets: z.array(z.string().trim().min(1)).default([]),
    runMetadata: z.record(z.string(), z.string()).default({}),
    reviewGuide: z.array(z.string().trim().min(1)).default([]),
    gateRows: z.array(ReportGateRowSchema).default([]),
    specificationLinks: z.array(ReportLinkSchema).default([]),
    traceabilityRows: z.array(RequirementTraceRowSchema).default([]),
    changeScopeRows: z.array(z.record(z.string(), z.string())).default([]),
    apiRows: z.array(z.record(z.string(), z.string())).default([]),
    functionalChecks: z.array(ReportCheckSummarySchema).default([]),
    designChecks: z.array(ReportCheckSummarySchema).default([]),
    figmaProviderRows: z.array(ReportArtifactSummaryRowSchema).default([]),
    figmaInventoryRows: z.array(ReportArtifactSummaryRowSchema).default([]),
    visualRows: z.array(VisualComparisonRowSchema).default([]),
    accessibilityChecks: z.array(ReportCheckSummarySchema).default([]),
    performanceRows: z.array(PerformanceMetricRowSchema).default([]),
    observabilityChecks: z.array(ReportCheckSummarySchema).default([]),
    runtimeChecks: z.array(ReportCheckSummarySchema).default([]),
    gapSummaries: z.array(ReportGapSummarySchema).default([]),
    archivePlan: z.array(z.string()).default([]),
    reportArtifactIds: z.array(ArtifactIdSchema).default([]),
  })
  .strict();

export type ReportDecision = z.infer<typeof ReportDecisionSchema>;
export type ReportLocale = z.infer<typeof ReportLocaleSchema>;
export type ReportSectionStatus = z.infer<typeof ReportSectionStatusSchema>;
export type ReportCheckSummary = z.infer<typeof ReportCheckSummarySchema>;
export type ReportGateRow = z.infer<typeof ReportGateRowSchema>;
export type ReportArtifactSummaryRow = z.infer<typeof ReportArtifactSummaryRowSchema>;
export type PrReportViewModel = z.infer<typeof PrReportViewModelSchema>;
