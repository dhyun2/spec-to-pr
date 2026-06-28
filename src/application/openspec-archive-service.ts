import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  createOpenSpecArchivePlan,
  executeOpenSpecArchive,
  OpenSpecArchiveExecutionResultSchema,
  OpenSpecArchivePlanSchema,
  ReviewRequestMergeStatusSchema,
  ReviewRequestMergeVerificationSchema,
  type ArchiveCommandRunner,
  type ReviewRequestMergeStatus,
} from "../openspec-archive/index.js";
import { OpenSpecChangeNameSchema, toOpenSpecChangeName } from "../openspec/openspec-paths.js";
import { PublishResultSchema } from "../publisher/index.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { ArtifactRef } from "../runtime/index.js";
import type { RunStore } from "../store/run-store.js";

const ARCHIVE_ADAPTER = "openspec-archive-v1" as const;

export const VerifyReviewRequestMergedInputSchema = z
  .object({
    runId: RunIdSchema,
    review: ReviewRequestMergeStatusSchema.optional(),
    publishResultArtifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const VerifyReviewRequestMergedResultSchema = z
  .object({
    run: RunSummarySchema,
    verification: ReviewRequestMergeVerificationSchema,
    artifactId: ArtifactIdSchema,
  })
  .strict();

const BaseArchiveInputShape = {
  runId: RunIdSchema,
  changeName: OpenSpecChangeNameSchema,
  review: ReviewRequestMergeStatusSchema.optional(),
  mergeStatusArtifactId: ArtifactIdSchema.optional(),
} as const;

export const PlanOpenSpecArchiveInputSchema = z.object(BaseArchiveInputShape).strict();

export const PlanOpenSpecArchiveResultSchema = z
  .object({
    run: RunSummarySchema,
    plan: OpenSpecArchivePlanSchema,
    artifactId: ArtifactIdSchema,
  })
  .strict();

export const ExecuteOpenSpecArchiveInputSchema = z.object(BaseArchiveInputShape).strict();

export const ExecuteOpenSpecArchiveResultSchema = z
  .object({
    run: RunSummarySchema,
    plan: OpenSpecArchivePlanSchema,
    result: OpenSpecArchiveExecutionResultSchema,
    artifactIds: z.array(ArtifactIdSchema),
    planArtifactId: ArtifactIdSchema,
    resultArtifactId: ArtifactIdSchema,
    reportArtifactId: ArtifactIdSchema,
  })
  .strict();

export const GetOpenSpecArchiveResultInputSchema = z
  .object({
    runId: RunIdSchema,
    artifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const GetOpenSpecArchiveResultResultSchema = z
  .object({
    run: RunSummarySchema,
    artifactId: ArtifactIdSchema,
    result: OpenSpecArchiveExecutionResultSchema,
  })
  .strict();

export const RecordOpenSpecArchiveReviewInputSchema = z
  .object({
    runId: RunIdSchema,
    planArtifactId: ArtifactIdSchema.optional(),
    archiveResultArtifactId: ArtifactIdSchema.optional(),
    review: z.record(z.string(), z.unknown()),
  })
  .strict();

export const RecordOpenSpecArchiveReviewResultSchema = z
  .object({
    run: RunSummarySchema,
    reviewArtifactId: ArtifactIdSchema,
    findingCount: z.number().int().nonnegative(),
  })
  .strict();

export class OpenSpecArchiveService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly commandRunner?: ArchiveCommandRunner,
  ) {}

  public async verifyMerged(rawInput: unknown) {
    const input = VerifyReviewRequestMergedInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const publishResultArtifact =
      input.publishResultArtifactId === undefined
        ? latestOptionalPublishResultArtifact(run.artifacts)
        : requireArtifact(run.artifacts, input.publishResultArtifactId);
    const publishResult =
      publishResultArtifact === undefined
        ? undefined
        : PublishResultSchema.parse(
            JSON.parse(
              (await this.artifactStore.readContent(publishResultArtifact.digest)).toString("utf8"),
            ),
          );
    const review = input.review ?? reviewFromPublishResult(publishResult);
    const verification = ReviewRequestMergeVerificationSchema.parse({
      runId: run.id,
      review,
      verified: review.merged,
      warnings: buildMergeVerificationWarnings({
        review,
        ...(publishResult === undefined ? {} : { publishResult }),
      }),
      ...(publishResultArtifact === undefined
        ? {}
        : { publishResultArtifactId: publishResultArtifact.id }),
      verifiedAt: timestamp,
    });
    const artifact = await this.writeJsonArtifact({
      artifactId: createArtifactId(),
      label: "review-merge-status",
      kind: "openspec-archive-result",
      value: verification,
      timestamp,
      metadata: {
        reportKind: "review-merge-status",
        provider: review.provider,
        merged: review.merged,
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, artifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return VerifyReviewRequestMergedResultSchema.parse({
      run: summarizeRun(nextRun),
      verification,
      artifactId: artifact.id,
    });
  }

  public async plan(rawInput: unknown) {
    const input = PlanOpenSpecArchiveInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const review = await this.resolveReview(run.artifacts, input);
    const plan = await createOpenSpecArchivePlan({
      run,
      changeName: toOpenSpecChangeName(input.changeName),
      review,
      generatedAt: timestamp,
    });
    const artifact = await this.writeJsonArtifact({
      artifactId: createArtifactId(),
      label: "openspec-archive-plan",
      kind: "openspec-archive-plan",
      value: plan,
      timestamp,
      metadata: {
        reportKind: "openspec-archive-plan",
        changeName: plan.changeName,
        canExecute: plan.canExecute,
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, artifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return PlanOpenSpecArchiveResultSchema.parse({
      run: summarizeRun(nextRun),
      plan,
      artifactId: artifact.id,
    });
  }

  public async execute(rawInput: unknown) {
    const input = ExecuteOpenSpecArchiveInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const startedAt = IsoDateTimeSchema.parse(this.now());
    const review = await this.resolveReview(run.artifacts, input);
    const plan = await createOpenSpecArchivePlan({
      run,
      changeName: toOpenSpecChangeName(input.changeName),
      review,
      generatedAt: startedAt,
    });
    const planArtifact = await this.writeJsonArtifact({
      artifactId: createArtifactId(),
      label: "openspec-archive-plan",
      kind: "openspec-archive-plan",
      value: plan,
      timestamp: startedAt,
      metadata: {
        reportKind: "openspec-archive-plan",
        changeName: plan.changeName,
        canExecute: plan.canExecute,
      },
    });
    const completedAt = IsoDateTimeSchema.parse(this.now());
    const execution = await executeOpenSpecArchive({
      plan,
      projectRoot: run.projectRoot,
      artifactStore: this.artifactStore,
      startedAt,
      completedAt,
      ...(this.commandRunner === undefined ? {} : { commandRunner: this.commandRunner }),
    });
    const reportArtifact = await this.writeMarkdownArtifact({
      artifactId: createArtifactId(),
      label: "openspec-archive-report",
      content: renderArchiveReport(plan, execution.result),
      timestamp: completedAt,
      metadata: {
        reportKind: "openspec-archive-report",
        changeName: plan.changeName,
        status: execution.result.status,
      },
    });
    const resultArtifactId = createArtifactId();
    const result = OpenSpecArchiveExecutionResultSchema.parse({
      ...execution.result,
      resultArtifactId,
      reportArtifactId: reportArtifact.id,
    });
    const resultArtifact = await this.writeJsonArtifact({
      artifactId: resultArtifactId,
      label: "openspec-archive-result",
      kind: "openspec-archive-result",
      value: result,
      timestamp: completedAt,
      metadata: {
        reportKind: "openspec-archive-result",
        changeName: plan.changeName,
        status: result.status,
      },
    });
    const artifacts = [planArtifact, ...execution.artifacts, resultArtifact, reportArtifact];
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: completedAt,
      artifacts: [...run.artifacts, ...artifacts],
    });

    await this.runStore.save(nextRun, run.revision);

    return ExecuteOpenSpecArchiveResultSchema.parse({
      run: summarizeRun(nextRun),
      plan,
      result,
      artifactIds: artifacts.map((artifact) => artifact.id),
      planArtifactId: planArtifact.id,
      resultArtifactId: resultArtifact.id,
      reportArtifactId: reportArtifact.id,
    });
  }

  public async getResult(rawInput: unknown) {
    const input = GetOpenSpecArchiveResultInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const artifact =
      input.artifactId === undefined
        ? latestArchiveResultArtifact(run.artifacts)
        : requireArtifact(run.artifacts, input.artifactId);

    if (
      artifact.kind !== "openspec-archive-result" ||
      artifact.metadata["reportKind"] !== "openspec-archive-result"
    ) {
      throw new Error(`Artifact is not an OpenSpec archive result artifact: ${artifact.id}`);
    }

    const result = OpenSpecArchiveExecutionResultSchema.parse(
      JSON.parse((await this.artifactStore.readContent(artifact.digest)).toString("utf8")),
    );

    return GetOpenSpecArchiveResultResultSchema.parse({
      run: summarizeRun(run),
      artifactId: artifact.id,
      result,
    });
  }

  public async recordReview(rawInput: unknown) {
    const input = RecordOpenSpecArchiveReviewInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const reviewArtifact = await this.writeJsonArtifact({
      artifactId: createArtifactId(),
      label: "openspec-archive-review",
      kind: "openspec-archive-report",
      value: input.review,
      timestamp,
      metadata: {
        reportKind: "openspec-archive-review",
        ...(input.planArtifactId === undefined ? {} : { planArtifactId: input.planArtifactId }),
        ...(input.archiveResultArtifactId === undefined
          ? {}
          : { archiveResultArtifactId: input.archiveResultArtifactId }),
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, reviewArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return RecordOpenSpecArchiveReviewResultSchema.parse({
      run: summarizeRun(nextRun),
      reviewArtifactId: reviewArtifact.id,
      findingCount: findingCount(input.review),
    });
  }

  private async resolveReview(
    artifacts: ArtifactRef[],
    input: {
      review?: ReviewRequestMergeStatus | undefined;
      mergeStatusArtifactId?: string | undefined;
    },
  ): Promise<ReviewRequestMergeStatus> {
    if (input.review !== undefined) {
      return input.review;
    }

    if (input.mergeStatusArtifactId === undefined) {
      throw new Error("OpenSpec archive plan requires review or mergeStatusArtifactId.");
    }

    const artifact = requireArtifact(artifacts, input.mergeStatusArtifactId);

    if (artifact.metadata["reportKind"] !== "review-merge-status") {
      throw new Error(`Artifact is not a review merge-status artifact: ${artifact.id}`);
    }

    const verification = ReviewRequestMergeVerificationSchema.parse(
      JSON.parse((await this.artifactStore.readContent(artifact.digest)).toString("utf8")),
    );

    return verification.review;
  }

  private async writeJsonArtifact(input: {
    artifactId: string;
    label: string;
    kind: "openspec-archive-plan" | "openspec-archive-result" | "openspec-archive-report";
    value: unknown;
    timestamp: string;
    metadata: Record<string, unknown>;
  }): Promise<ArtifactRef> {
    const blob = await this.artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(input.value, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: input.timestamp,
      label: input.label,
    });

    return ArtifactRefSchema.parse({
      id: input.artifactId,
      kind: input.kind,
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: input.timestamp,
      metadata: {
        adapter: ARCHIVE_ADAPTER,
        label: input.label,
        ...input.metadata,
      },
    });
  }

  private async writeMarkdownArtifact(input: {
    artifactId: string;
    label: string;
    content: string;
    timestamp: string;
    metadata: Record<string, unknown>;
  }): Promise<ArtifactRef> {
    const blob = await this.artifactStore.writeBlob({
      content: Buffer.from(input.content, "utf8"),
      mediaType: "text/markdown",
      storedAt: input.timestamp,
      label: input.label,
    });

    return ArtifactRefSchema.parse({
      id: input.artifactId,
      kind: "openspec-archive-report",
      uri: blob.uri,
      mediaType: "text/markdown",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: input.timestamp,
      metadata: {
        adapter: ARCHIVE_ADAPTER,
        label: input.label,
        ...input.metadata,
      },
    });
  }
}

function reviewFromPublishResult(
  publishResult: z.infer<typeof PublishResultSchema> | undefined,
): ReviewRequestMergeStatus {
  if (publishResult?.request !== undefined) {
    return ReviewRequestMergeStatusSchema.parse({
      provider: publishResult.request.host,
      reviewRequestUrl: publishResult.request.url,
      number: publishResult.request.number,
      merged: false,
      sourceBranch: publishResult.request.sourceBranch,
      targetBranch: publishResult.request.targetBranch,
      raw: {
        note: "Publish result records the review request but does not prove merge.",
      },
    });
  }

  return ReviewRequestMergeStatusSchema.parse({
    provider: publishResult?.target?.host ?? "manual",
    merged: false,
    raw: {
      note: "No merge status was provided.",
    },
  });
}

function buildMergeVerificationWarnings(input: {
  review: ReviewRequestMergeStatus;
  publishResult?: z.infer<typeof PublishResultSchema>;
}): string[] {
  const warnings: string[] = [];

  if (!input.review.merged) {
    warnings.push("Review request is not merged; OpenSpec archive execution must stay blocked.");
  }

  if (input.publishResult === undefined) {
    warnings.push("No publish result artifact was available for cross-checking.");
    return warnings;
  }

  if (input.publishResult.status !== "passed") {
    warnings.push(`Publish result status is ${input.publishResult.status}.`);
  }

  if (
    input.publishResult.request !== undefined &&
    input.publishResult.request.host !== input.review.provider
  ) {
    warnings.push("Merge status provider does not match publish result provider.");
  }

  if (
    input.publishResult.request?.url !== undefined &&
    input.review.reviewRequestUrl !== undefined &&
    input.publishResult.request.url !== input.review.reviewRequestUrl
  ) {
    warnings.push("Merge status URL does not match publish result URL.");
  }

  if (
    input.publishResult.request?.number !== undefined &&
    input.review.number !== undefined &&
    input.publishResult.request.number !== input.review.number
  ) {
    warnings.push("Merge status number does not match publish result number.");
  }

  return warnings;
}

function requireArtifact(artifacts: ArtifactRef[], artifactId: string): ArtifactRef {
  const artifact = artifacts.find((item) => item.id === artifactId);

  if (artifact === undefined) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }

  return artifact;
}

function latestOptionalPublishResultArtifact(artifacts: ArtifactRef[]): ArtifactRef | undefined {
  return artifacts
    .filter(
      (item) =>
        item.kind === "agent-result-report" && item.metadata["reportKind"] === "publish-result",
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}

function latestArchiveResultArtifact(artifacts: ArtifactRef[]): ArtifactRef {
  const artifact = artifacts
    .filter(
      (item) =>
        item.kind === "openspec-archive-result" &&
        item.metadata["reportKind"] === "openspec-archive-result",
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

  if (artifact === undefined) {
    throw new Error("No OpenSpec archive result artifact found.");
  }

  return artifact;
}

function renderArchiveReport(
  plan: z.infer<typeof OpenSpecArchivePlanSchema>,
  result: z.infer<typeof OpenSpecArchiveExecutionResultSchema>,
): string {
  return [
    `# OpenSpec Archive Report - ${plan.changeName}`,
    "",
    "## Plan",
    "",
    `- Can execute: ${plan.canExecute}`,
    `- Expected change root: ${plan.expectedChangeRoot}`,
    `- Expected archive root: ${plan.expectedArchiveRoot ?? "-"}`,
    `- Command: \`${plan.command.join(" ")}\``,
    `- Requires follow-up commit: ${plan.requiresFollowUpCommit}`,
    "",
    "## Preconditions",
    "",
    "| ID | Status | Blocking | Summary |",
    "|---|---|---:|---|",
    ...plan.preconditions.map(
      (item) =>
        `| ${item.id} | ${item.status} | ${String(item.blocking)} | ${escapeTable(item.summary)} |`,
    ),
    "",
    "## Result",
    "",
    `- Status: ${result.status}`,
    `- Exit code: ${result.exitCode ?? "-"}`,
    `- Archive path: ${result.archivePath ?? "-"}`,
    `- Summary: ${result.summary}`,
    "",
  ].join("\n");
}

function findingCount(review: Record<string, unknown>): number {
  const findings = review["findings"];

  return Array.isArray(findings) ? findings.length : 0;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
