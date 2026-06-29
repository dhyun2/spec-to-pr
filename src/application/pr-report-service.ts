import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  collectPrReportViewModel,
  PrReportViewModelSchema,
  renderPrReportMarkdown,
  writePrReportArtifacts,
} from "../pr-report/index.js";
import { ReportLocaleSchema } from "../pr-report/pr-report-model.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { ArtifactRef } from "../runtime/index.js";
import type { RunStore } from "../store/run-store.js";

export const GeneratePrReportInputSchema = z
  .object({
    runId: RunIdSchema,
    language: ReportLocaleSchema.default("ko"),
  })
  .strict();

export const GeneratePrReportResultSchema = z
  .object({
    run: RunSummarySchema,
    markdownArtifactId: ArtifactIdSchema,
    viewModelArtifactId: ArtifactIdSchema,
    decision: z.string(),
    language: ReportLocaleSchema,
    openBlockerGapCount: z.number().int().nonnegative(),
    openMajorGapCount: z.number().int().nonnegative(),
  })
  .strict();

export const GetPrReportInputSchema = z
  .object({
    runId: RunIdSchema,
    artifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const GetPrReportResultSchema = z
  .object({
    run: RunSummarySchema,
    artifactId: ArtifactIdSchema,
    viewModelArtifactId: ArtifactIdSchema.optional(),
    uri: z.string().trim().min(1),
    markdown: z.string(),
  })
  .strict();

export const RecordPrReportReviewInputSchema = z
  .object({
    runId: RunIdSchema,
    reportArtifactId: ArtifactIdSchema.optional(),
    review: z.record(z.string(), z.unknown()),
  })
  .strict();

export const RecordPrReportReviewResultSchema = z
  .object({
    run: RunSummarySchema,
    reviewArtifactId: ArtifactIdSchema,
    findingCount: z.number().int().nonnegative(),
  })
  .strict();

export class PrReportService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async generatePrReport(rawInput: unknown) {
    const input = GeneratePrReportInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const generatedAt = IsoDateTimeSchema.parse(this.now());
    const collectedViewModel = collectPrReportViewModel({
      run,
      generatedAt,
      locale: input.language,
    });
    const markdownArtifactId = createArtifactId();
    const viewModelArtifactId = createArtifactId();
    const viewModel = PrReportViewModelSchema.parse({
      ...collectedViewModel,
      reportArtifactIds: [markdownArtifactId, viewModelArtifactId],
    });
    const finalMarkdown = renderPrReportMarkdown(viewModel);
    const finalWritten = await writePrReportArtifacts({
      artifactStore: this.artifactStore,
      markdown: finalMarkdown,
      viewModel,
      generatedAt,
      markdownArtifactId,
      viewModelArtifactId,
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: generatedAt,
      artifacts: [...run.artifacts, finalWritten.markdownArtifact, finalWritten.viewModelArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return GeneratePrReportResultSchema.parse({
      run: summarizeRun(nextRun),
      markdownArtifactId: finalWritten.markdownArtifact.id,
      viewModelArtifactId: finalWritten.viewModelArtifact.id,
      decision: viewModel.decision,
      language: viewModel.locale,
      openBlockerGapCount: openGapCount(run.gaps, "blocker"),
      openMajorGapCount: openGapCount(run.gaps, "major"),
    });
  }

  public async getPrReport(rawInput: unknown) {
    const input = GetPrReportInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const reportArtifact =
      input.artifactId === undefined
        ? latestPrReportArtifact(run.artifacts)
        : requireArtifact(run.artifacts, input.artifactId);

    if (
      reportArtifact.kind !== "pr-report" ||
      reportArtifact.metadata["reportKind"] !== "pr-body-markdown"
    ) {
      throw new Error(`Artifact is not a PR report markdown artifact: ${reportArtifact.id}`);
    }

    const markdown = (await this.artifactStore.readContent(reportArtifact.digest)).toString("utf8");
    const viewModelArtifact = latestViewModelForMarkdown(run.artifacts, reportArtifact.id);

    return GetPrReportResultSchema.parse({
      run: summarizeRun(run),
      artifactId: reportArtifact.id,
      ...(viewModelArtifact === undefined ? {} : { viewModelArtifactId: viewModelArtifact.id }),
      uri: reportArtifact.uri,
      markdown,
    });
  }

  public async recordReview(rawInput: unknown) {
    const input = RecordPrReportReviewInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const reviewArtifact = await this.writeReviewArtifact({
      content: `${JSON.stringify(input.review, null, 2)}\n`,
      timestamp,
      metadata: {
        reportKind: "pr-report-review",
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

    return RecordPrReportReviewResultSchema.parse({
      run: summarizeRun(nextRun),
      reviewArtifactId: reviewArtifact.id,
      findingCount: findingCount(input.review),
    });
  }

  private async writeReviewArtifact(input: {
    content: string;
    timestamp: string;
    metadata: Record<string, unknown>;
  }): Promise<ArtifactRef> {
    const blob = await this.artifactStore.writeBlob({
      content: Buffer.from(input.content, "utf8"),
      mediaType: "application/json",
      storedAt: input.timestamp,
      label: "pr-report-review",
    });

    return ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "pr-report",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: input.timestamp,
      metadata: {
        adapter: "pr-report-v1",
        ...input.metadata,
      },
    });
  }
}

function requireArtifact(artifacts: ArtifactRef[], artifactId: string): ArtifactRef {
  const artifact = artifacts.find((item) => item.id === artifactId);

  if (artifact === undefined) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }

  return artifact;
}

function latestPrReportArtifact(artifacts: ArtifactRef[]): ArtifactRef {
  const artifact = artifacts
    .filter(
      (item) => item.kind === "pr-report" && item.metadata["reportKind"] === "pr-body-markdown",
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

  if (artifact === undefined) {
    throw new Error("No PR report markdown artifact found.");
  }

  return artifact;
}

function latestViewModelForMarkdown(
  artifacts: ArtifactRef[],
  markdownArtifactId: string,
): ArtifactRef | undefined {
  return artifacts
    .filter(
      (item) =>
        item.kind === "pr-report" &&
        item.metadata["reportKind"] === "pr-report-view-model" &&
        item.metadata["markdownArtifactId"] === markdownArtifactId,
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}

function openGapCount(gaps: Array<{ severity: string; status: string }>, severity: string): number {
  return gaps.filter(
    (gap) => gap.severity === severity && (gap.status === "open" || gap.status === "assumed"),
  ).length;
}

function findingCount(review: Record<string, unknown>): number {
  const findings = review["findings"];

  return Array.isArray(findings) ? findings.length : 0;
}
