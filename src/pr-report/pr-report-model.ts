import { z } from "zod";

import { ArtifactIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, Sha256DigestSchema } from "../runtime/scalars.js";

export const ReportLocaleSchema = z.enum(["ko", "en"]);

export const ReportDecisionSchema = z.enum(["blocked", "draft", "ready-after-review", "ready"]);

export const WorkflowReportIntentSchema = z.enum(["ready", "blocked-diagnostic"]);

export const WorkflowReportMetadataSchema = z.discriminatedUnion("reportIntent", [
  z
    .object({
      reportKind: z.literal("pr-body-markdown"),
      reportIntent: z.literal("ready"),
      decision: z.literal("ready"),
    })
    .strict(),
  z
    .object({
      reportKind: z.literal("pr-body-markdown"),
      reportIntent: z.literal("blocked-diagnostic"),
      decision: z.literal("blocked"),
    })
    .strict(),
]);

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

export const ReviewScorecardReportRowSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1),
    score: z.number().min(0).max(10),
    threshold: z.number().min(0).max(10),
    status: ReportSectionStatusSchema,
    notes: z.string().trim().min(1),
    evidence: z.array(z.string().trim().min(1)).default([]),
    nextRepairTarget: z.boolean().default(false),
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
    scorecardRows: z.array(ReviewScorecardReportRowSchema).default([]),
    specificationLinks: z.array(ReportLinkSchema).default([]),
    traceabilityRows: z.array(RequirementTraceRowSchema).default([]),
    traceabilityRowCount: z.number().int().nonnegative().default(0),
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

const PrReportBindingV2Schema = z
  .object({
    reviewPacketId: z.string().regex(/^packet_[a-f0-9]{64}$/),
    revision: z.number().int().positive(),
    baseSha: GitObjectIdSchema,
    headSha: GitObjectIdSchema,
    evidenceDigest: Sha256DigestSchema,
    diffDigest: Sha256DigestSchema,
  })
  .strict();

const PrReportSourceV2Schema = z
  .object({
    kind: z.enum(["brief", "figma", "openapi", "docs", "legacy", "legacy-network", "guidance"]),
    locator: z.string().trim().min(1).max(2_000),
    resolvedLocator: z.string().trim().min(1).max(2_000).optional(),
    digest: Sha256DigestSchema.optional(),
    capturedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const PrReportRequirementV2Schema = z
  .object({
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(500),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(2_000)).min(1),
    implementationFiles: z.array(z.string().trim().min(1).max(1_000)).default([]),
    reviewVerdicts: z.array(z.string().trim().min(1).max(100)).default([]),
  })
  .strict();

const PrReportApiOperationV2Schema = z
  .object({
    operationKey: z.string().trim().min(3),
    method: z.string().trim().min(1),
    path: z.string().trim().min(1),
    operationId: z.string().trim().min(1).optional(),
    status: z.string().trim().min(1),
    productionCallSites: z.array(z.string()).default([]),
    mockHandlers: z.array(z.string()).default([]),
    executableEvidencePaths: z.array(z.string()).default([]),
    blocking: z.boolean(),
    notes: z.string().optional(),
  })
  .strict();

const PrReportLegacyCoverageV2Schema = z
  .object({
    featureKey: z.string().trim().min(1),
    requirementIds: z.array(z.string()).min(1),
    status: z.string().trim().min(1),
    targetFiles: z.array(z.string()).default([]),
    executableEvidencePaths: z.array(z.string()).default([]),
    rationale: z.string().trim().min(1),
  })
  .strict();

const PrReportVisualResultV2Schema = z
  .object({
    targetId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    state: z.string().trim().min(1),
    route: z.string().trim().min(1),
    baselineKind: z.enum(["figma", "legacy-screenshot"]),
    viewport: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive() })
      .strict(),
    deviceScaleFactor: z.number().positive(),
    fixture: z.string().trim().min(1),
    masks: z.array(z.record(z.string(), z.unknown())).default([]),
    status: z.enum(["passed", "failed"]),
    metrics: z
      .object({
        exactMatchRatio: z.number().min(0).max(1),
        reviewMatchRatio: z.number().min(0).max(1),
        threshold: z.number().min(0).max(1),
        maskedAreaRatio: z.number().min(0).max(1),
      })
      .passthrough(),
    baselineArtifactId: ArtifactIdSchema,
    actualArtifactId: ArtifactIdSchema,
    diffArtifactId: ArtifactIdSchema,
    overlayArtifactId: ArtifactIdSchema,
  })
  .passthrough();

const PrReportReviewV2Schema = z
  .object({
    kind: z.enum(["functional-review", "design-review"]),
    verdict: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    gates: z.array(z.record(z.string(), z.unknown())).default([]),
    findings: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .strict();

export const PrReportSectionStatusSchema = z.enum([
  "complete",
  "not-run",
  "blocked",
  "not-applicable",
]);

export const PrReportSectionStatusesSchema = z
  .object({
    api: PrReportSectionStatusSchema,
    legacy: PrReportSectionStatusSchema,
    visual: PrReportSectionStatusSchema,
    "functional-review": PrReportSectionStatusSchema,
    "design-review": PrReportSectionStatusSchema,
    performance: PrReportSectionStatusSchema,
    "feature-evidence": PrReportSectionStatusSchema,
  })
  .strict();

export const PrReportV2Schema = z
  .object({
    schemaVersion: z.enum(["pr-report-v2", "pr-report-v2.1"]),
    runId: RunIdSchema,
    generatedAt: z.string().datetime({ offset: true }),
    decision: z.enum(["ready", "blocked"]),
    mode: z.enum(["auto", "brief", "legacy", "feature", "figma"]),
    sectionStatuses: PrReportSectionStatusesSchema.optional(),
    binding: PrReportBindingV2Schema.optional(),
    summary: z
      .object({
        title: z.string().trim().min(1),
        bullets: z.array(z.string()),
        exclusions: z.array(z.string()),
      })
      .strict(),
    sources: z.array(PrReportSourceV2Schema),
    skills: z
      .object({
        hints: z.array(z.string().trim().min(1)),
        applied: z.array(z.string().trim().min(1)),
      })
      .strict(),
    requirements: z.array(PrReportRequirementV2Schema),
    changedFiles: z.array(z.string()),
    implementationNotes: z.array(z.string()),
    api: z
      .object({
        applicable: z.boolean(),
        inventoryDigest: Sha256DigestSchema.optional(),
        discoveryAdapters: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
        operations: z.array(PrReportApiOperationV2Schema),
        gaps: z.array(z.string()),
      })
      .strict(),
    legacy: z
      .object({ applicable: z.boolean(), coverage: z.array(PrReportLegacyCoverageV2Schema) })
      .strict(),
    visual: z
      .object({
        applicable: z.boolean(),
        reportArtifactId: ArtifactIdSchema.optional(),
        attempt: z.number().int().nonnegative(),
        status: z.enum(["passed", "failed", "not-run", "blocked", "not-applicable"]),
        results: z.array(PrReportVisualResultV2Schema),
      })
      .strict(),
    reviews: z.array(PrReportReviewV2Schema),
    performance: z
      .object({ applicable: z.boolean(), evidence: z.record(z.string(), z.unknown()).optional() })
      .strict(),
    featureEvidence: z.record(z.string(), z.unknown()).optional(),
    gaps: z.array(z.string()),
    blockers: z.array(z.string()),
    unrunValidations: z.array(z.string()),
    risks: z.array(
      z
        .object({
          likelihood: z.string(),
          impact: z.string(),
          mitigation: z.string(),
          evidence: z.array(z.string()),
        })
        .strict(),
    ),
    rollback: z
      .object({
        trigger: z.string(),
        strategy: z.string(),
        steps: z.array(z.string()).min(1),
        dataImpact: z.string(),
        postChecks: z.array(z.string()).min(1),
      })
      .strict(),
    evidencePaths: z.array(z.string()),
    artifactIds: z.array(ArtifactIdSchema),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.schemaVersion === "pr-report-v2.1" && report.sectionStatuses === undefined) {
      context.addIssue({
        code: "custom",
        path: ["sectionStatuses"],
        message: "pr-report-v2.1 requires every section status",
      });
    }
    if (report.decision === "ready" && report.binding === undefined) {
      context.addIssue({
        code: "custom",
        path: ["binding"],
        message: "Ready report requires a review packet binding",
      });
    }
    if (report.decision === "ready" && report.requirements.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["requirements"],
        message: "Ready report requires requirement traceability",
      });
    }
    if (report.visual.reportArtifactId !== undefined && report.binding === undefined) {
      context.addIssue({
        code: "custom",
        path: ["visual", "reportArtifactId"],
        message: "A visual report reference requires a review packet binding",
      });
    }
  });

export type ReportDecision = z.infer<typeof ReportDecisionSchema>;
export type WorkflowReportIntent = z.infer<typeof WorkflowReportIntentSchema>;
export type WorkflowReportMetadata = z.infer<typeof WorkflowReportMetadataSchema>;
export type ReportLocale = z.infer<typeof ReportLocaleSchema>;
export type ReportSectionStatus = z.infer<typeof ReportSectionStatusSchema>;
export type ReportCheckSummary = z.infer<typeof ReportCheckSummarySchema>;
export type ReportGateRow = z.infer<typeof ReportGateRowSchema>;
export type ReportArtifactSummaryRow = z.infer<typeof ReportArtifactSummaryRowSchema>;
export type ReviewScorecardReportRow = z.infer<typeof ReviewScorecardReportRowSchema>;
export type PrReportViewModel = z.infer<typeof PrReportViewModelSchema>;
export type PrReportV2 = z.infer<typeof PrReportV2Schema>;
export type PrReportSectionStatus = z.infer<typeof PrReportSectionStatusSchema>;

export function assertCurrentPrReportV2(report: PrReportV2): void {
  if (report.mode !== "legacy" || !report.api.applicable) return;
  if (report.api.inventoryDigest === undefined) {
    throw new Error("Current legacy API reporting requires the bounded inventory digest");
  }
  if (report.api.discoveryAdapters === undefined || report.api.discoveryAdapters.length === 0) {
    throw new Error("Current legacy API reporting requires explicit discovery adapters");
  }
}
