import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  BundleBudgetSchema,
  BudgetCheckResultSchema,
  checkBundleBudget,
  createLighthouseCiConfig,
  detectWebVitalsReadiness,
  LighthouseCiConfigSchema,
  LighthouseSummarySchema,
  mapPerformanceGaps,
  parseLighthouseReports,
  PerformancePlanSchema,
  renderPerformanceReport,
  WebVitalsReadinessReportSchema,
} from "../performance/index.js";
import type { LighthouseSummary } from "../performance/index.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { ArtifactRef, Gap } from "../runtime/index.js";
import type { RunStore } from "../store/run-store.js";

const PERFORMANCE_GATE_ADAPTER = "performance-gate-v1" as const;

const PerformanceRouteInputSchema = z
  .object({
    id: z.string().trim().min(1),
    urlPath: z.string().trim().min(1),
    label: z.string().trim().min(1),
  })
  .strict();

const AssetSummarySchema = z
  .object({
    path: z.string().trim().min(1),
    type: z.enum(["script", "stylesheet", "image", "font", "document", "other"]),
    transferBytes: z.number().int().nonnegative(),
    initial: z.boolean().optional(),
  })
  .strict();

const SourceTextSchema = z
  .object({
    path: z.string().trim().min(1),
    content: z.string(),
  })
  .strict();

export const PerformanceGateDecisionSchema = z.enum(["passed", "failed", "review-needed"]);

export const PerformanceReportSchema = z
  .object({
    adapter: z.literal(PERFORMANCE_GATE_ADAPTER),
    runId: RunIdSchema,
    generatedAt: IsoDateTimeSchema,
    plan: PerformancePlanSchema,
    lhciConfig: LighthouseCiConfigSchema,
    lighthouse: LighthouseSummarySchema,
    budget: BudgetCheckResultSchema,
    webVitals: WebVitalsReadinessReportSchema,
    gapIds: z.array(GapIdSchema),
    artifactIds: z.array(ArtifactIdSchema).default([]),
    decision: PerformanceGateDecisionSchema,
    fieldDataCaveat: z.literal("lab-only"),
    summary: z.string().trim().min(1),
  })
  .strict();

export const PlanPerformanceGateInputSchema = z
  .object({
    runId: RunIdSchema,
    baseUrl: z.string().url(),
    routes: z.array(PerformanceRouteInputSchema).default([]),
  })
  .strict();

export const PlanPerformanceGateResultSchema = z
  .object({
    runId: RunIdSchema,
    plan: PerformancePlanSchema,
    budget: BundleBudgetSchema,
    lhciConfig: LighthouseCiConfigSchema,
  })
  .strict();

export const RunPerformanceGateInputSchema = z
  .object({
    runId: RunIdSchema,
    baseUrl: z.string().url(),
    routes: z.array(PerformanceRouteInputSchema),
    lighthouseReports: z.array(z.unknown()).default([]),
    assets: z.array(AssetSummarySchema).default([]),
    packageJson: z.unknown().optional(),
    sourceTexts: z.array(SourceTextSchema).default([]),
  })
  .strict();

export const RunPerformanceGateResultSchema = z
  .object({
    run: RunSummarySchema,
    report: PerformanceReportSchema,
    reportArtifactId: ArtifactIdSchema,
    markdownReportArtifactId: ArtifactIdSchema,
    decision: PerformanceGateDecisionSchema,
    gapIds: z.array(GapIdSchema),
    lighthouse: LighthouseSummarySchema,
    budget: BudgetCheckResultSchema,
    webVitals: WebVitalsReadinessReportSchema,
  })
  .strict();

export const GetPerformanceReportInputSchema = z
  .object({
    runId: RunIdSchema,
    reportArtifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const GetPerformanceReportResultSchema = z
  .object({
    run: RunSummarySchema,
    reportArtifactId: ArtifactIdSchema,
    markdownReportArtifactId: ArtifactIdSchema.optional(),
    report: PerformanceReportSchema,
  })
  .strict();

export const RecordPerformanceReviewInputSchema = z
  .object({
    runId: RunIdSchema,
    reportArtifactId: ArtifactIdSchema.optional(),
    review: z.record(z.string(), z.unknown()),
  })
  .strict();

export const RecordPerformanceReviewResultSchema = z
  .object({
    run: RunSummarySchema,
    reviewArtifactId: ArtifactIdSchema,
    findingCount: z.number().int().nonnegative(),
  })
  .strict();

export class PerformanceGateService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async plan(rawInput: unknown) {
    const input = PlanPerformanceGateInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const routes =
      input.routes.length > 0
        ? input.routes
        : [
            {
              id: "root",
              urlPath: "/",
              label: "Root route",
            },
          ];
    const plan = PerformancePlanSchema.parse({
      runId: run.id,
      generatedAt: timestamp,
      baseUrl: input.baseUrl,
      routes: routes.map((route) => ({
        ...route,
        source: "manual",
        viewportProfiles: [
          {
            name: "desktop",
            width: 1440,
            height: 900,
            deviceScaleFactor: 1,
            isMobile: false,
          },
          {
            name: "mobile",
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            isMobile: true,
          },
        ],
      })),
      thresholds: {},
      repeats: 3,
      notes: [
        "This plan uses lab performance targets. Field Web Vitals require RUM or CrUX artifacts.",
      ],
    });
    const budget = BundleBudgetSchema.parse({});
    const lhciConfig = createLighthouseCiConfig({
      plan,
      budget,
    });

    return PlanPerformanceGateResultSchema.parse({
      runId: run.id,
      plan,
      budget,
      lhciConfig,
    });
  }

  public async run(rawInput: unknown) {
    const input = RunPerformanceGateInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const planned = await this.plan({
      runId: input.runId,
      baseUrl: input.baseUrl,
      routes: input.routes,
    });
    const lighthouse = parseLighthouseReports(input.lighthouseReports);
    const budget = checkBundleBudget({
      assets: input.assets,
      budget: planned.budget,
    });
    const webVitals = detectWebVitalsReadiness({
      packageJson: input.packageJson,
      sourceTexts: input.sourceTexts,
    });
    const gaps = mapPerformanceGaps({
      lighthouse,
      thresholds: planned.plan.thresholds,
      budget,
      webVitals,
      timestamp,
    });
    const decision = decidePerformanceGate({ lighthouse, gaps });
    const reportArtifactId = createArtifactId();
    const markdownReportArtifactId = createArtifactId();
    const report = PerformanceReportSchema.parse({
      adapter: PERFORMANCE_GATE_ADAPTER,
      runId: run.id,
      generatedAt: timestamp,
      plan: planned.plan,
      lhciConfig: planned.lhciConfig,
      lighthouse,
      budget,
      webVitals,
      gapIds: gaps.map((gap) => gap.id),
      artifactIds: [reportArtifactId, markdownReportArtifactId],
      decision,
      fieldDataCaveat: "lab-only",
      summary: summaryForDecision(decision, lighthouse, gaps),
    });
    const reportJsonArtifact = await this.writeArtifact({
      artifactId: reportArtifactId,
      label: "performance-report-json",
      mediaType: "application/json",
      content: `${JSON.stringify(report, null, 2)}\n`,
      createdAt: timestamp,
      metadata: {
        adapter: PERFORMANCE_GATE_ADAPTER,
        reportKind: "performance-report-json",
        routeCount: planned.plan.routes.length,
        gapCount: gaps.length,
        decision,
        webVitalsReadiness: webVitals.status,
      },
    });
    const reportMarkdownArtifact = await this.writeArtifact({
      artifactId: markdownReportArtifactId,
      label: "performance-report-markdown",
      mediaType: "text/markdown",
      content: renderPerformanceReport({
        plan: planned.plan,
        lighthouse,
        budget,
        webVitals,
        gaps,
      }),
      createdAt: timestamp,
      metadata: {
        adapter: PERFORMANCE_GATE_ADAPTER,
        reportKind: "performance-report-markdown",
        jsonReportArtifactId: reportJsonArtifact.id,
        decision,
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      gaps: [...run.gaps, ...gaps],
      artifacts: [...run.artifacts, reportJsonArtifact, reportMarkdownArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return RunPerformanceGateResultSchema.parse({
      run: summarizeRun(nextRun),
      report,
      reportArtifactId: reportJsonArtifact.id,
      markdownReportArtifactId: reportMarkdownArtifact.id,
      decision,
      gapIds: gaps.map((gap) => gap.id),
      lighthouse,
      budget,
      webVitals,
    });
  }

  public async getReport(rawInput: unknown) {
    const input = GetPerformanceReportInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const reportArtifact =
      input.reportArtifactId === undefined
        ? latestPerformanceReportArtifact(run.artifacts)
        : requireArtifact(run.artifacts, input.reportArtifactId);

    if (reportArtifact.metadata["reportKind"] !== "performance-report-json") {
      throw new Error(`Artifact is not a performance report JSON artifact: ${reportArtifact.id}`);
    }

    const report = PerformanceReportSchema.parse(
      JSON.parse((await this.artifactStore.readContent(reportArtifact.digest)).toString("utf8")),
    );
    const markdownReportArtifact = latestPerformanceMarkdownForJson(
      run.artifacts,
      reportArtifact.id,
    );

    return GetPerformanceReportResultSchema.parse({
      run: summarizeRun(run),
      reportArtifactId: reportArtifact.id,
      ...(markdownReportArtifact === undefined
        ? {}
        : { markdownReportArtifactId: markdownReportArtifact.id }),
      report,
    });
  }

  public async recordReview(rawInput: unknown) {
    const input = RecordPerformanceReviewInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const reviewArtifact = await this.writeArtifact({
      label: "performance-review",
      mediaType: "application/json",
      content: `${JSON.stringify(input.review, null, 2)}\n`,
      createdAt: timestamp,
      metadata: {
        adapter: "performance-reviewer-v1",
        reportKind: "performance-review",
        ...(input.reportArtifactId === undefined
          ? {}
          : { reportArtifactId: input.reportArtifactId }),
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, reviewArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return RecordPerformanceReviewResultSchema.parse({
      run: summarizeRun(nextRun),
      reviewArtifactId: reviewArtifact.id,
      findingCount: findingCount(input.review),
    });
  }

  private async writeArtifact(input: {
    label: string;
    mediaType: string;
    content: string;
    createdAt: string;
    metadata: Record<string, unknown>;
    artifactId?: string;
  }): Promise<ArtifactRef> {
    const blob = await this.artifactStore.writeBlob({
      content: Buffer.from(input.content, "utf8"),
      mediaType: input.mediaType,
      storedAt: input.createdAt,
      label: input.label,
    });

    return ArtifactRefSchema.parse({
      id: input.artifactId ?? createArtifactId(),
      kind: "performance-report",
      uri: blob.uri,
      mediaType: input.mediaType,
      digest: blob.digest,
      producedBy: "evidence-verifier",
      evidenceIds: [],
      createdAt: input.createdAt,
      metadata: input.metadata,
    });
  }
}

function decidePerformanceGate(input: {
  lighthouse: LighthouseSummary;
  gaps: Gap[];
}): z.infer<typeof PerformanceGateDecisionSchema> {
  if (input.lighthouse.metrics.length === 0) {
    return "review-needed";
  }

  if (input.gaps.some((gap) => gap.severity === "blocker" || gap.severity === "major")) {
    return "failed";
  }

  if (input.gaps.length > 0) {
    return "review-needed";
  }

  return "passed";
}

function summaryForDecision(
  decision: z.infer<typeof PerformanceGateDecisionSchema>,
  lighthouse: LighthouseSummary,
  gaps: Gap[],
): string {
  return `Performance gate decision: ${decision}. Lab route results: ${lighthouse.metrics.length}. Performance gaps: ${gaps.length}. Field Web Vitals are lab-only unless RUM or CrUX artifacts exist.`;
}

function requireArtifact(artifacts: ArtifactRef[], artifactId: string): ArtifactRef {
  const artifact = artifacts.find((item) => item.id === artifactId);

  if (artifact === undefined) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }

  return artifact;
}

function latestPerformanceReportArtifact(artifacts: ArtifactRef[]): ArtifactRef {
  const artifact = artifacts
    .filter(
      (item) =>
        item.kind === "performance-report" &&
        item.metadata["reportKind"] === "performance-report-json",
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

  if (artifact === undefined) {
    throw new Error("No performance report JSON artifact found.");
  }

  return artifact;
}

function latestPerformanceMarkdownForJson(
  artifacts: ArtifactRef[],
  jsonReportArtifactId: string,
): ArtifactRef | undefined {
  return artifacts
    .filter(
      (item) =>
        item.kind === "performance-report" &&
        item.metadata["reportKind"] === "performance-report-markdown" &&
        item.metadata["jsonReportArtifactId"] === jsonReportArtifactId,
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}

function findingCount(review: Record<string, unknown>): number {
  const findings = review["findings"];

  return Array.isArray(findings) ? findings.length : 0;
}
