import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { GapSchema } from "../runtime/gap.js";
import { createGapId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { ArtifactRef, Gap } from "../runtime/index.js";
import type { RunStore } from "../store/run-store.js";
import {
  captureBrowserScreenshot,
  comparePngImages,
  DEFAULT_VISUAL_GATE_POLICY,
  evaluateVisualComparison,
  renderVisualReportMarkdown,
  VisualGatePolicySchema,
  VisualMaskRegionSchema,
  VisualReportSchema,
  VisualReviewResultSchema,
  VisualTargetSchema,
  writeVisualBlob,
} from "../visual/index.js";
import type {
  VisualComparisonResult,
  VisualGatePolicy,
  VisualMaskRegion,
  VisualReport,
  VisualReviewResult,
  VisualTarget,
} from "../visual/index.js";

export const PlanVisualRegressionInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: z.string().trim().min(1),
  })
  .strict();

export const PlanVisualRegressionResultSchema = z
  .object({
    runId: RunIdSchema,
    changeName: z.string().trim().min(1),
    targetCount: z.number().int().nonnegative(),
    targets: z.array(VisualTargetSchema),
  })
  .strict();

export const CaptureBrowserScreenshotsInputSchema = z
  .object({
    runId: RunIdSchema,
    baseUrl: z.string().url(),
    targets: z.array(VisualTargetSchema),
    timeoutMs: z.number().int().positive().max(120_000).default(30_000),
  })
  .strict();

export const CaptureBrowserScreenshotsResultSchema = z
  .object({
    run: RunSummarySchema,
    capturedCount: z.number().int().nonnegative(),
    browserScreenshotArtifactIds: z.record(z.string(), ArtifactIdSchema),
    gapIds: z.array(GapIdSchema),
  })
  .strict();

export const CompareVisualSnapshotsInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: z.string().trim().min(1),
    targets: z.array(VisualTargetSchema),
    browserScreenshotArtifactIds: z.record(z.string(), ArtifactIdSchema),
    policy: VisualGatePolicySchema.optional(),
  })
  .strict();

export const CompareVisualSnapshotsResultSchema = z
  .object({
    run: RunSummarySchema,
    report: VisualReportSchema,
    reportArtifactId: ArtifactIdSchema,
    markdownReportArtifactId: ArtifactIdSchema,
    diffArtifactIds: z.array(ArtifactIdSchema),
    overlayArtifactIds: z.array(ArtifactIdSchema),
    gapIds: z.array(GapIdSchema),
  })
  .strict();

export const GetVisualReportInputSchema = z
  .object({
    runId: RunIdSchema,
    reportArtifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const GetVisualReportResultSchema = z
  .object({
    run: RunSummarySchema,
    reportArtifactId: ArtifactIdSchema,
    markdownReportArtifactId: ArtifactIdSchema.optional(),
    report: VisualReportSchema,
  })
  .strict();

export const RecordVisualReviewResultInputSchema = z
  .object({
    runId: RunIdSchema,
    reportArtifactId: ArtifactIdSchema.optional(),
    result: VisualReviewResultSchema,
  })
  .strict();

export const RecordVisualReviewResultSchema = z
  .object({
    run: RunSummarySchema,
    reviewArtifactId: ArtifactIdSchema,
    findingCount: z.number().int().nonnegative(),
    humanReviewFindingCount: z.number().int().nonnegative(),
  })
  .strict();

export class VisualRegressionService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async plan(rawInput: unknown) {
    const input = PlanVisualRegressionInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const figmaScreenshots = run.artifacts.filter(
      (artifact) => artifact.kind === "figma-screenshot",
    );
    const targets = figmaScreenshots.map((artifact, index) =>
      targetFromFigmaScreenshot({
        runId: run.id,
        changeName: input.changeName,
        artifact,
        index,
      }),
    );

    return PlanVisualRegressionResultSchema.parse({
      runId: run.id,
      changeName: input.changeName,
      targetCount: targets.length,
      targets,
    });
  }

  public async capture(rawInput: unknown) {
    const input = CaptureBrowserScreenshotsInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const browserArtifacts: ArtifactRef[] = [];
    const gaps: Gap[] = [];

    for (const target of input.targets) {
      try {
        const captured = await captureBrowserScreenshot({
          baseUrl: input.baseUrl,
          target,
          timeoutMs: input.timeoutMs,
        });
        const artifact = await writeVisualBlob({
          artifactStore: this.artifactStore,
          content: captured.screenshot,
          mediaType: "image/png",
          label: `browser-screenshot-${target.id}`,
          generatedAt: timestamp,
          kind: "screenshot",
          evidenceIds: target.figmaEvidenceIds,
          metadata: {
            adapter: "visual-regression-v1",
            reportKind: "browser-screenshot",
            visualTargetId: target.id,
            route: target.route,
            url: captured.url,
          },
        });

        browserArtifacts.push(artifact);
      } catch (error: unknown) {
        gaps.push(
          createVisualGap({
            target,
            timestamp,
            title: `Browser screenshot capture failed: ${target.name}`,
            observed: error instanceof Error ? error.message : "Unknown capture error.",
            severity: "blocker",
            owner: "integrator",
          }),
        );
      }
    }

    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, ...browserArtifacts],
      gaps: [...run.gaps, ...gaps],
    });

    await this.runStore.save(nextRun, run.revision);

    return CaptureBrowserScreenshotsResultSchema.parse({
      run: summarizeRun(nextRun),
      capturedCount: browserArtifacts.length,
      browserScreenshotArtifactIds: Object.fromEntries(
        browserArtifacts.map((artifact) => [
          String(artifact.metadata["visualTargetId"]),
          artifact.id,
        ]),
      ),
      gapIds: gaps.map((gap) => gap.id),
    });
  }

  public async compare(rawInput: unknown) {
    const input = CompareVisualSnapshotsInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const policy = input.policy ?? DEFAULT_VISUAL_GATE_POLICY;
    const artifactsToAdd: ArtifactRef[] = [];
    const gapsToAdd: Gap[] = [];
    const results: VisualComparisonResult[] = [];

    for (const target of input.targets) {
      const figmaArtifact = requireArtifact(run.artifacts, target.figmaScreenshotArtifactId);
      const browserArtifactId = input.browserScreenshotArtifactIds[target.id];

      if (browserArtifactId === undefined) {
        throw new Error(`Missing browser screenshot artifact for target ${target.id}`);
      }

      const browserArtifact = requireArtifact(run.artifacts, browserArtifactId);
      const figmaPng = await this.artifactStore.readContent(figmaArtifact.digest);
      const browserPng = await this.artifactStore.readContent(browserArtifact.digest);
      const comparison = comparePngImages({
        expectedPng: figmaPng,
        actualPng: browserPng,
        masks: target.masks,
        policy,
      });
      const diffArtifact = await writeVisualBlob({
        artifactStore: this.artifactStore,
        content: comparison.diffPng,
        mediaType: "image/png",
        label: `visual-diff-${target.id}`,
        generatedAt: timestamp,
        kind: "visual-diff",
        evidenceIds: target.figmaEvidenceIds,
        metadata: {
          adapter: "visual-regression-v1",
          reportKind: "visual-diff",
          visualTargetId: target.id,
        },
      });
      const overlayArtifact = await writeVisualBlob({
        artifactStore: this.artifactStore,
        content: comparison.overlayPng,
        mediaType: "image/png",
        label: `visual-overlay-${target.id}`,
        generatedAt: timestamp,
        kind: "screenshot",
        evidenceIds: target.figmaEvidenceIds,
        metadata: {
          adapter: "visual-regression-v1",
          reportKind: "visual-overlay",
          visualTargetId: target.id,
        },
      });
      const status = evaluateVisualComparison({
        metrics: comparison.metrics,
        policy,
      });
      const gapIds: string[] = [];

      artifactsToAdd.push(diffArtifact, overlayArtifact);

      if (status !== "passed") {
        const gap = createVisualGap({
          target,
          timestamp,
          title: `Visual mismatch for ${target.name}`,
          observed: `Review match was ${(comparison.metrics.reviewMatchRatio * 100).toFixed(2)}%.`,
          severity: status === "failed" ? "major" : "minor",
          owner: "design-ui",
        });

        gapsToAdd.push(gap);
        gapIds.push(gap.id);
      }

      results.push({
        targetId: target.id,
        status,
        figmaScreenshotArtifactId: figmaArtifact.id,
        browserScreenshotArtifactId: browserArtifact.id,
        diffArtifactId: diffArtifact.id,
        overlayArtifactId: overlayArtifact.id,
        metrics: comparison.metrics,
        gapIds,
        notes: target.masks.map((mask) => `Mask ${mask.name}: ${mask.reason}`),
      });
    }

    const report = VisualReportSchema.parse({
      runId: run.id,
      changeName: input.changeName,
      generatedAt: timestamp,
      targetCount: results.length,
      passedCount: results.filter((result) => result.status === "passed").length,
      failedCount: results.filter((result) => result.status === "failed").length,
      reviewNeededCount: results.filter((result) => result.status === "review-needed").length,
      results,
    });
    const reportJsonArtifact = await writeVisualBlob({
      artifactStore: this.artifactStore,
      content: Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      label: "visual-report-json",
      generatedAt: timestamp,
      kind: "visual-report",
      metadata: {
        adapter: "visual-regression-v1",
        reportKind: "visual-report-json",
        changeName: input.changeName,
      },
    });
    const reportMdArtifact = await writeVisualBlob({
      artifactStore: this.artifactStore,
      content: Buffer.from(renderVisualReportMarkdown(report), "utf8"),
      mediaType: "text/markdown",
      label: "visual-report-md",
      generatedAt: timestamp,
      kind: "visual-report",
      metadata: {
        adapter: "visual-regression-v1",
        reportKind: "visual-report-markdown",
        changeName: input.changeName,
        jsonReportArtifactId: reportJsonArtifact.id,
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, ...artifactsToAdd, reportJsonArtifact, reportMdArtifact],
      gaps: [...run.gaps, ...gapsToAdd],
    });

    await this.runStore.save(nextRun, run.revision);

    return CompareVisualSnapshotsResultSchema.parse({
      run: summarizeRun(nextRun),
      report,
      reportArtifactId: reportJsonArtifact.id,
      markdownReportArtifactId: reportMdArtifact.id,
      diffArtifactIds: artifactsToAdd
        .filter((artifact) => artifact.metadata["reportKind"] === "visual-diff")
        .map((artifact) => artifact.id),
      overlayArtifactIds: artifactsToAdd
        .filter((artifact) => artifact.metadata["reportKind"] === "visual-overlay")
        .map((artifact) => artifact.id),
      gapIds: gapsToAdd.map((gap) => gap.id),
    });
  }

  public async getReport(rawInput: unknown) {
    const input = GetVisualReportInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const reportArtifact =
      input.reportArtifactId === undefined
        ? latestVisualReportArtifact(run.artifacts)
        : requireArtifact(run.artifacts, input.reportArtifactId);

    if (reportArtifact.metadata["reportKind"] !== "visual-report-json") {
      throw new Error(`Artifact is not a visual report JSON artifact: ${reportArtifact.id}`);
    }

    const report = VisualReportSchema.parse(
      JSON.parse((await this.artifactStore.readContent(reportArtifact.digest)).toString("utf8")),
    );
    const markdownReportArtifact = latestVisualMarkdownForJson(run.artifacts, reportArtifact.id);

    return GetVisualReportResultSchema.parse({
      run: summarizeRun(run),
      reportArtifactId: reportArtifact.id,
      ...(markdownReportArtifact === undefined
        ? {}
        : { markdownReportArtifactId: markdownReportArtifact.id }),
      report,
    });
  }

  public async recordReviewResult(rawInput: unknown) {
    const input = RecordVisualReviewResultInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const reviewArtifact = await writeVisualBlob({
      artifactStore: this.artifactStore,
      content: Buffer.from(`${JSON.stringify(input.result, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      label: "visual-review-result",
      generatedAt: timestamp,
      kind: "visual-report",
      metadata: {
        adapter: "visual-regression-v1",
        reportKind: "visual-review-result",
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

    return RecordVisualReviewResultSchema.parse({
      run: summarizeRun(nextRun),
      reviewArtifactId: reviewArtifact.id,
      findingCount: input.result.findings.length,
      humanReviewFindingCount: input.result.findings.filter(
        (finding) => finding.requiresHumanReview,
      ).length,
    });
  }
}

function targetFromFigmaScreenshot(input: {
  runId: string;
  changeName: string;
  artifact: ArtifactRef;
  index: number;
}): VisualTarget {
  return VisualTargetSchema.parse({
    id: String(input.artifact.metadata["visualTargetId"] ?? `visual-${input.index + 1}`),
    runId: input.runId,
    changeName: input.changeName,
    name: String(input.artifact.metadata["name"] ?? `Figma target ${input.index + 1}`),
    route: String(input.artifact.metadata["route"] ?? `/__spec-to-pr/visual/${input.index + 1}`),
    viewport: {
      width: numberFromMetadata(input.artifact.metadata["viewportWidth"], 390),
      height: numberFromMetadata(input.artifact.metadata["viewportHeight"], 844),
      deviceScaleFactor: numberFromMetadata(input.artifact.metadata["deviceScaleFactor"], 1),
      isMobile: Boolean(input.artifact.metadata["isMobile"] ?? true),
    },
    figmaSourceId: String(input.artifact.metadata["sourceId"] ?? "unknown"),
    figmaEvidenceIds: input.artifact.evidenceIds,
    figmaScreenshotArtifactId: input.artifact.id,
    masks: parseMasks(input.artifact.metadata["masks"]),
    status: "planned",
  });
}

function parseMasks(value: unknown): VisualMaskRegion[] {
  const parsed = z.array(VisualMaskRegionSchema).safeParse(value);

  return parsed.success ? parsed.data : [];
}

function numberFromMetadata(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function requireArtifact(artifacts: ArtifactRef[], artifactId: string): ArtifactRef {
  const artifact = artifacts.find((item) => item.id === artifactId);

  if (artifact === undefined) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }

  return artifact;
}

function latestVisualReportArtifact(artifacts: ArtifactRef[]): ArtifactRef {
  const artifact = artifacts
    .filter(
      (item) =>
        item.kind === "visual-report" && item.metadata["reportKind"] === "visual-report-json",
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

  if (artifact === undefined) {
    throw new Error("No visual report JSON artifact found.");
  }

  return artifact;
}

function latestVisualMarkdownForJson(
  artifacts: ArtifactRef[],
  jsonReportArtifactId: string,
): ArtifactRef | undefined {
  return artifacts
    .filter(
      (item) =>
        item.kind === "visual-report" &&
        item.metadata["reportKind"] === "visual-report-markdown" &&
        item.metadata["jsonReportArtifactId"] === jsonReportArtifactId,
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}

function createVisualGap(input: {
  target: VisualTarget;
  timestamp: string;
  title: string;
  observed: string;
  severity: "blocker" | "major" | "minor";
  owner: "integrator" | "design-ui";
}): Gap {
  return GapSchema.parse({
    id: createGapId(),
    category: "visual",
    severity: input.severity,
    status: "open",
    title: input.title,
    expected: `Browser screenshot should match Figma baseline ${input.target.figmaScreenshotArtifactId}.`,
    observed: input.observed,
    impact: "The implemented UI may not match the approved design.",
    sourceEvidenceIds: input.target.figmaEvidenceIds,
    owner: input.owner,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    metadata: {
      visualTargetId: input.target.id,
      route: input.target.route,
    },
  });
}
