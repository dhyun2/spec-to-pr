import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  createDefaultObservabilityPlan,
  DeploymentEnvironmentSchema,
  detectObservabilityGaps,
  ObservabilityGapSchema,
  ObservabilityPlanSchema,
  ObservabilityReportSchema,
  ObservabilityTargetSchema,
  renderObservabilityConfig,
} from "../observability/index.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { GapSchema } from "../runtime/gap.js";
import { createArtifactId, createGapId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { ArtifactRef, Gap } from "../runtime/index.js";
import type { RunStore } from "../store/run-store.js";

const OBSERVABILITY_ADAPTER = "observability-v1" as const;

const RenderedObservabilityConfigSchema = z
  .object({
    otelNodeTs: z.string(),
    loggerCorrelationTs: z.string(),
    apiWrapperSpanTemplateTs: z.string(),
    observabilityReadmeMd: z.string(),
  })
  .strict();

const ObservabilityPlanningInputShape = {
  runId: RunIdSchema,
  target: ObservabilityTargetSchema.default("both"),
  serviceName: z.string().trim().min(1).default("spec-to-pr-target"),
  serviceVersion: z.string().trim().min(1).default("0.0.0"),
  environment: DeploymentEnvironmentSchema.default("development"),
  collectorUrl: z.string().url().optional(),
  existingTelemetryDetected: z.boolean().default(false),
  existingLoggerDetected: z.boolean().default(false),
} as const;

export const PlanObservabilityInputSchema = z.object(ObservabilityPlanningInputShape).strict();

export const PlanObservabilityResultSchema = z
  .object({
    runId: RunIdSchema,
    plan: ObservabilityPlanSchema,
    gaps: z.array(ObservabilityGapSchema),
    rendered: RenderedObservabilityConfigSchema,
  })
  .strict();

export const GenerateObservabilityConfigInputSchema = z
  .object(ObservabilityPlanningInputShape)
  .strict();

export const GenerateObservabilityConfigResultSchema = z
  .object({
    run: RunSummarySchema,
    report: ObservabilityReportSchema,
    artifactIds: z.array(ArtifactIdSchema),
    configArtifactIds: z.array(ArtifactIdSchema),
    reportArtifactId: ArtifactIdSchema,
    gapIds: z.array(GapIdSchema),
    gapCount: z.number().int().nonnegative(),
  })
  .strict();

export const GetObservabilityReportInputSchema = z
  .object({
    runId: RunIdSchema,
    reportArtifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const GetObservabilityReportResultSchema = z
  .object({
    run: RunSummarySchema,
    reportArtifactId: ArtifactIdSchema,
    report: ObservabilityReportSchema,
  })
  .strict();

export const RecordObservabilityReviewInputSchema = z
  .object({
    runId: RunIdSchema,
    reportArtifactId: ArtifactIdSchema.optional(),
    review: z.record(z.string(), z.unknown()),
  })
  .strict();

export const RecordObservabilityReviewResultSchema = z
  .object({
    run: RunSummarySchema,
    reviewArtifactId: ArtifactIdSchema,
    findingCount: z.number().int().nonnegative(),
  })
  .strict();

export class ObservabilityService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async planObservability(rawInput: unknown) {
    const input = PlanObservabilityInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const plan = createDefaultObservabilityPlan({
      target: input.target,
      serviceName: input.serviceName,
      serviceVersion: input.serviceVersion,
      environment: input.environment,
      existingTelemetryDetected: input.existingTelemetryDetected,
      existingLoggerDetected: input.existingLoggerDetected,
      ...(input.collectorUrl === undefined ? {} : { collectorUrl: input.collectorUrl }),
    });
    const gaps = detectObservabilityGaps(plan);
    const rendered = renderObservabilityConfig(plan);

    return PlanObservabilityResultSchema.parse({
      runId: run.id,
      plan,
      gaps,
      rendered,
    });
  }

  public async generateConfig(rawInput: unknown) {
    const input = GenerateObservabilityConfigInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const planned = await this.planObservability(input);
    const configArtifacts = await Promise.all([
      this.writeArtifact({
        label: "observability/otel.node.ts",
        content: planned.rendered.otelNodeTs,
        mediaType: "text/typescript",
        timestamp,
        metadata: {
          reportKind: "observability-config",
          template: "otel-node",
        },
      }),
      this.writeArtifact({
        label: "observability/logger-correlation.ts",
        content: planned.rendered.loggerCorrelationTs,
        mediaType: "text/typescript",
        timestamp,
        metadata: {
          reportKind: "observability-config",
          template: "logger-correlation",
        },
      }),
      this.writeArtifact({
        label: "observability/api-wrapper-span-template.ts",
        content: planned.rendered.apiWrapperSpanTemplateTs,
        mediaType: "text/typescript",
        timestamp,
        metadata: {
          reportKind: "observability-config",
          template: "api-wrapper-span",
        },
      }),
      this.writeArtifact({
        label: "observability/README.md",
        content: planned.rendered.observabilityReadmeMd,
        mediaType: "text/markdown",
        timestamp,
        metadata: {
          reportKind: "observability-config",
          template: "readme",
        },
      }),
    ]);
    const gapObjects = planned.gaps.map((gap) => createObservabilityGap(gap, timestamp));
    const reportArtifactId = createArtifactId();
    const report = ObservabilityReportSchema.parse({
      adapter: OBSERVABILITY_ADAPTER,
      runId: run.id,
      generatedAt: timestamp,
      plan: planned.plan,
      gaps: planned.gaps,
      artifactIds: [...configArtifacts.map((artifact) => artifact.id), reportArtifactId],
      gapIds: gapObjects.map((gap) => gap.id),
      summary: `Observability plan generated with ${planned.gaps.length} gap(s).`,
    });
    const reportArtifact = await this.writeArtifact({
      artifactId: reportArtifactId,
      label: "observability/report.json",
      content: `${JSON.stringify(report, null, 2)}\n`,
      mediaType: "application/json",
      timestamp,
      metadata: {
        reportKind: "observability-report-json",
        gapCount: gapObjects.length,
        target: planned.plan.target,
        exporter: planned.plan.exporter,
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      gaps: [...run.gaps, ...gapObjects],
      artifacts: [...run.artifacts, ...configArtifacts, reportArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return GenerateObservabilityConfigResultSchema.parse({
      run: summarizeRun(nextRun),
      report,
      artifactIds: [...configArtifacts.map((artifact) => artifact.id), reportArtifact.id],
      configArtifactIds: configArtifacts.map((artifact) => artifact.id),
      reportArtifactId: reportArtifact.id,
      gapIds: gapObjects.map((gap) => gap.id),
      gapCount: gapObjects.length,
    });
  }

  public async getReport(rawInput: unknown) {
    const input = GetObservabilityReportInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const reportArtifact =
      input.reportArtifactId === undefined
        ? latestObservabilityReportArtifact(run.artifacts)
        : requireArtifact(run.artifacts, input.reportArtifactId);

    if (reportArtifact.metadata["reportKind"] !== "observability-report-json") {
      throw new Error(
        `Artifact is not an observability report JSON artifact: ${reportArtifact.id}`,
      );
    }

    const report = ObservabilityReportSchema.parse(
      JSON.parse((await this.artifactStore.readContent(reportArtifact.digest)).toString("utf8")),
    );

    return GetObservabilityReportResultSchema.parse({
      run: summarizeRun(run),
      reportArtifactId: reportArtifact.id,
      report,
    });
  }

  public async recordReview(rawInput: unknown) {
    const input = RecordObservabilityReviewInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const reviewArtifact = await this.writeArtifact({
      label: "observability-review",
      content: `${JSON.stringify(input.review, null, 2)}\n`,
      mediaType: "application/json",
      timestamp,
      metadata: {
        reportKind: "observability-review",
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

    return RecordObservabilityReviewResultSchema.parse({
      run: summarizeRun(nextRun),
      reviewArtifactId: reviewArtifact.id,
      findingCount: findingCount(input.review),
    });
  }

  private async writeArtifact(input: {
    label: string;
    content: string;
    mediaType: string;
    timestamp: string;
    metadata: Record<string, unknown>;
    artifactId?: string;
  }): Promise<ArtifactRef> {
    const blob = await this.artifactStore.writeBlob({
      content: Buffer.from(input.content, "utf8"),
      mediaType: input.mediaType,
      storedAt: input.timestamp,
      label: input.label,
    });

    return ArtifactRefSchema.parse({
      id: input.artifactId ?? createArtifactId(),
      kind: "telemetry-config",
      uri: blob.uri,
      mediaType: input.mediaType,
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: input.timestamp,
      metadata: {
        adapter: OBSERVABILITY_ADAPTER,
        label: input.label,
        ...input.metadata,
      },
    });
  }
}

function createObservabilityGap(
  gap: z.infer<typeof ObservabilityGapSchema>,
  timestamp: string,
): Gap {
  return GapSchema.parse({
    id: createGapId(),
    category: "observability",
    severity: gap.severity,
    status: "open",
    title: gap.title,
    expected: gap.expected,
    observed: gap.observed,
    impact: gap.impact,
    sourceEvidenceIds: [],
    owner: "evidence-verifier",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function requireArtifact(artifacts: ArtifactRef[], artifactId: string): ArtifactRef {
  const artifact = artifacts.find((item) => item.id === artifactId);

  if (artifact === undefined) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }

  return artifact;
}

function latestObservabilityReportArtifact(artifacts: ArtifactRef[]): ArtifactRef {
  const artifact = artifacts
    .filter(
      (item) =>
        item.kind === "telemetry-config" &&
        item.metadata["reportKind"] === "observability-report-json",
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

  if (artifact === undefined) {
    throw new Error("No observability report JSON artifact found.");
  }

  return artifact;
}

function findingCount(review: Record<string, unknown>): number {
  const findings = review["findings"];

  return Array.isArray(findings) ? findings.length : 0;
}
