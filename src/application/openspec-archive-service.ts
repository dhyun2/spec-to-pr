import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  createOpenSpecArchivePlan,
  latestArtifactByReportKind,
  MergeEvidenceSchema,
  OpenSpecArchivePlanSchema,
  OpenSpecArchiveResultSchema,
  parseReviewRequestUrl,
  renderOpenSpecArchiveReport,
  ReviewRequestProviderSchema,
  ReviewRequestStatusSchema,
  runOpenSpecArchiveCommand,
  type ArchiveCommandRunner,
  type MergeEvidence,
  type ReviewRequestProvider,
  type ReviewRequestStatus,
} from "../archive/index.js";
import { OpenSpecChangeNameSchema } from "../openspec/openspec-paths.js";
import { PublishResultSchema, readPublisherToken, redactSecrets } from "../publisher/index.js";
import { encodeGitLabProjectId } from "../publisher/review-host.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";
import type { ArtifactRef } from "../runtime/index.js";
import type { RunStore } from "../store/run-store.js";

const ARCHIVE_ADAPTER = "manual-openspec-archive-v1" as const;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const PlanOpenSpecArchiveInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: OpenSpecChangeNameSchema,
  })
  .strict();

export const PlanOpenSpecArchiveResultSchema = OpenSpecArchivePlanSchema;

export const RecordMergeAttestationInputSchema = z
  .object({
    runId: RunIdSchema,
    reviewRequestUrl: z.string().url(),
    statement: z.string().trim().min(1),
    attestedBy: z.string().trim().min(1),
  })
  .strict();

export const RecordMergeAttestationResultSchema = z
  .object({
    run: RunSummarySchema,
    mergeEvidenceId: ArtifactIdSchema,
    type: z.literal("user-attested"),
    reviewRequestUrl: z.string().url(),
    evidence: MergeEvidenceSchema,
  })
  .strict();

export const CheckReviewRequestStatusOnceInputSchema = z
  .object({
    runId: RunIdSchema,
    provider: ReviewRequestProviderSchema,
    reviewRequestUrl: z.string().url(),
  })
  .strict();

export const CheckReviewRequestStatusOnceResultSchema = z
  .object({
    run: RunSummarySchema,
    mergeEvidenceId: ArtifactIdSchema,
    provider: ReviewRequestProviderSchema,
    status: ReviewRequestStatusSchema,
    checkedAt: IsoDateTimeSchema,
    evidence: MergeEvidenceSchema,
  })
  .strict();

export const RunOpenSpecArchiveInputSchema = z
  .object({
    runId: RunIdSchema,
    changeName: OpenSpecChangeNameSchema,
    mergeEvidenceId: ArtifactIdSchema,
    yes: z.literal(true),
  })
  .strict();

export const RunOpenSpecArchiveResultSchema = z
  .object({
    run: RunSummarySchema,
    archiveResultId: ArtifactIdSchema,
    exitCode: z.number().int().optional(),
    status: z.enum(["passed", "failed", "blocked"]),
    archivePath: z.string().trim().min(1).optional(),
    followUpCommitRequired: z.boolean(),
    stdoutArtifactId: ArtifactIdSchema.optional(),
    stderrArtifactId: ArtifactIdSchema.optional(),
    reportArtifactId: ArtifactIdSchema,
  })
  .strict();

export const GetOpenSpecArchiveReportInputSchema = z
  .object({
    runId: RunIdSchema,
    archiveResultId: ArtifactIdSchema,
  })
  .strict();

export const GetOpenSpecArchiveReportResultSchema = z
  .object({
    run: RunSummarySchema,
    status: z.enum(["passed", "failed", "blocked"]),
    changeName: OpenSpecChangeNameSchema,
    archivePath: z.string().trim().min(1).optional(),
    stdoutArtifactId: ArtifactIdSchema.optional(),
    stderrArtifactId: ArtifactIdSchema.optional(),
    reportArtifactId: ArtifactIdSchema,
    result: OpenSpecArchiveResultSchema,
  })
  .strict();

export class OpenSpecArchiveService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly commandRunner?: ArchiveCommandRunner,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  public async plan(rawInput: unknown) {
    const input = PlanOpenSpecArchiveInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const publishResultUrl = await this.latestPublishResultUrl(run.artifacts);
    const mergeEvidence = await this.latestMergeEvidence(run.artifacts);

    return PlanOpenSpecArchiveResultSchema.parse(
      await createOpenSpecArchivePlan({
        run,
        changeName: input.changeName,
        ...(publishResultUrl === undefined ? {} : { publishResultUrl }),
        ...(mergeEvidence === undefined ? {} : { mergeEvidence }),
        generatedAt: timestamp,
      }),
    );
  }

  public async recordMergeAttestation(rawInput: unknown) {
    const input = RecordMergeAttestationInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const parsedReviewRequest = parseReviewRequestUrl(input.reviewRequestUrl);

    if (parsedReviewRequest === undefined) {
      throw new Error(`Unsupported review request URL: ${input.reviewRequestUrl}`);
    }

    const evidence = MergeEvidenceSchema.parse({
      id: createArtifactId(),
      runId: run.id,
      kind: "user-attested",
      provider: parsedReviewRequest.provider,
      reviewRequestUrl: input.reviewRequestUrl,
      status: "merged",
      statement: input.statement,
      checkedAt: timestamp,
      attestedBy: input.attestedBy,
      metadata: {
        source: "manual-post-merge-command",
        number: parsedReviewRequest.number,
      },
    });
    const artifact = await this.writeJsonArtifact({
      artifactId: evidence.id,
      kind: "merge-evidence",
      label: "merge-evidence-user-attested",
      value: evidence,
      timestamp,
      metadata: {
        reportKind: "merge-evidence",
        evidenceKind: evidence.kind,
        status: evidence.status,
        reviewRequestUrl: evidence.reviewRequestUrl,
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, artifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return RecordMergeAttestationResultSchema.parse({
      run: summarizeRun(nextRun),
      mergeEvidenceId: evidence.id,
      type: "user-attested",
      reviewRequestUrl: evidence.reviewRequestUrl,
      evidence,
    });
  }

  public async checkReviewRequestStatusOnce(rawInput: unknown) {
    const input = CheckReviewRequestStatusOnceInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const evidence = await this.remoteCheckedEvidence({
      runId: run.id,
      provider: input.provider,
      reviewRequestUrl: input.reviewRequestUrl,
      checkedAt: timestamp,
    });
    const artifact = await this.writeJsonArtifact({
      artifactId: evidence.id,
      kind: "merge-evidence",
      label: "merge-evidence-remote-checked",
      value: evidence,
      timestamp,
      metadata: {
        reportKind: "merge-evidence",
        evidenceKind: evidence.kind,
        provider: evidence.provider,
        status: evidence.status,
        reviewRequestUrl: evidence.reviewRequestUrl,
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, artifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return CheckReviewRequestStatusOnceResultSchema.parse({
      run: summarizeRun(nextRun),
      mergeEvidenceId: evidence.id,
      provider: input.provider,
      status: evidence.status,
      checkedAt: timestamp,
      evidence,
    });
  }

  public async runArchive(rawInput: unknown) {
    const input = RunOpenSpecArchiveInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const startedAt = IsoDateTimeSchema.parse(this.now());
    const publishResultUrl = await this.latestPublishResultUrl(run.artifacts);
    const mergeEvidence = await this.requireMergeEvidence(run.artifacts, input.mergeEvidenceId);
    const plan = await createOpenSpecArchivePlan({
      run,
      changeName: input.changeName,
      ...(publishResultUrl === undefined ? {} : { publishResultUrl }),
      mergeEvidence,
      generatedAt: startedAt,
    });
    const execution = await this.executeOrBlock({
      run,
      plan,
      startedAt,
    });
    const completedAt = IsoDateTimeSchema.parse(this.now());
    const reportArtifactId = createArtifactId();
    const result = OpenSpecArchiveResultSchema.parse({
      ...execution.result,
      completedAt,
      reportArtifactId,
    });
    const reportArtifact = await this.writeTextArtifact({
      artifactId: reportArtifactId,
      kind: "openspec-archive-report",
      label: "openspec-archive-report",
      content: renderOpenSpecArchiveReport({
        plan,
        result,
      }),
      mediaType: "text/markdown",
      timestamp: completedAt,
      metadata: {
        reportKind: "openspec-archive-report",
        changeName: plan.changeName,
        status: result.status,
      },
    });
    const resultArtifact = await this.writeJsonArtifact({
      artifactId: createArtifactId(),
      kind: "openspec-archive-result",
      label: "openspec-archive-result",
      value: result,
      timestamp: completedAt,
      metadata: {
        reportKind: "openspec-archive-result",
        changeName: plan.changeName,
        status: result.status,
        reportArtifactId: reportArtifact.id,
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: completedAt,
      artifacts: [...run.artifacts, ...execution.artifacts, resultArtifact, reportArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return RunOpenSpecArchiveResultSchema.parse({
      run: summarizeRun(nextRun),
      archiveResultId: resultArtifact.id,
      ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
      status: result.status,
      ...(result.archivePath === undefined ? {} : { archivePath: result.archivePath }),
      followUpCommitRequired: result.followUpCommitRequired,
      ...(result.stdoutArtifactId === undefined
        ? {}
        : { stdoutArtifactId: result.stdoutArtifactId }),
      ...(result.stderrArtifactId === undefined
        ? {}
        : { stderrArtifactId: result.stderrArtifactId }),
      reportArtifactId: reportArtifact.id,
    });
  }

  public async getReport(rawInput: unknown) {
    const input = GetOpenSpecArchiveReportInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const artifact = requireArtifact(run.artifacts, input.archiveResultId);

    if (
      artifact.kind !== "openspec-archive-result" ||
      artifact.metadata["reportKind"] !== "openspec-archive-result"
    ) {
      throw new Error(`Artifact is not an OpenSpec archive result artifact: ${artifact.id}`);
    }

    const result = OpenSpecArchiveResultSchema.parse(
      JSON.parse((await this.artifactStore.readContent(artifact.digest)).toString("utf8")),
    );

    return GetOpenSpecArchiveReportResultSchema.parse({
      run: summarizeRun(run),
      status: result.status,
      changeName: result.changeName,
      ...(result.archivePath === undefined ? {} : { archivePath: result.archivePath }),
      ...(result.stdoutArtifactId === undefined
        ? {}
        : { stdoutArtifactId: result.stdoutArtifactId }),
      ...(result.stderrArtifactId === undefined
        ? {}
        : { stderrArtifactId: result.stderrArtifactId }),
      reportArtifactId: result.reportArtifactId,
      result,
    });
  }

  private async executeOrBlock(input: {
    run: Awaited<ReturnType<RunStore["get"]>>;
    plan: z.infer<typeof OpenSpecArchivePlanSchema>;
    startedAt: string;
  }): Promise<{
    result: z.infer<typeof OpenSpecArchiveResultSchema>;
    artifacts: ArtifactRef[];
  }> {
    if (input.plan.status !== "ready") {
      return {
        result: OpenSpecArchiveResultSchema.parse({
          runId: input.run.id,
          changeName: input.plan.changeName,
          status: "blocked",
          startedAt: input.startedAt,
          completedAt: input.startedAt,
          archiveCommand: input.plan.archiveCommand,
          polling: false,
          followUpCommitRequired: input.plan.followUpCommitRequired,
          summary: `OpenSpec archive blocked: ${input.plan.blockingReasons.join("; ")}`,
        }),
        artifacts: [],
      };
    }

    try {
      const execution = await runOpenSpecArchiveCommand({
        projectRoot: input.run.projectRoot,
        changeName: input.plan.changeName,
        ...(this.commandRunner === undefined ? {} : { commandRunner: this.commandRunner }),
      });
      const completedAt = IsoDateTimeSchema.parse(this.now());
      const stdoutArtifact = await this.writeTextArtifact({
        artifactId: createArtifactId(),
        kind: "log",
        label: "openspec-archive-stdout",
        content: execution.stdout,
        mediaType: "text/plain",
        timestamp: completedAt,
        metadata: {
          reportKind: "openspec-archive-log",
          stream: "stdout",
        },
      });
      const stderrArtifact = await this.writeTextArtifact({
        artifactId: createArtifactId(),
        kind: "log",
        label: "openspec-archive-stderr",
        content: execution.stderr,
        mediaType: "text/plain",
        timestamp: completedAt,
        metadata: {
          reportKind: "openspec-archive-log",
          stream: "stderr",
        },
      });
      const status = execution.exitCode === 0 ? "passed" : "failed";

      return {
        result: OpenSpecArchiveResultSchema.parse({
          runId: input.run.id,
          changeName: input.plan.changeName,
          status,
          startedAt: input.startedAt,
          completedAt,
          archiveCommand: input.plan.archiveCommand,
          polling: false,
          exitCode: execution.exitCode,
          ...(status === "passed" ? { archivePath: input.plan.expectedArchiveRoot } : {}),
          stdoutArtifactId: stdoutArtifact.id,
          stderrArtifactId: stderrArtifact.id,
          followUpCommitRequired: input.plan.followUpCommitRequired,
          summary:
            status === "passed"
              ? `Archived OpenSpec change ${input.plan.changeName}.`
              : `OpenSpec archive failed with exit code ${execution.exitCode}.`,
        }),
        artifacts: [stdoutArtifact, stderrArtifact],
      };
    } catch (error: unknown) {
      const completedAt = IsoDateTimeSchema.parse(this.now());
      const stderrArtifact = await this.writeTextArtifact({
        artifactId: createArtifactId(),
        kind: "log",
        label: "openspec-archive-stderr",
        content: safeErrorMessage(error),
        mediaType: "text/plain",
        timestamp: completedAt,
        metadata: {
          reportKind: "openspec-archive-log",
          stream: "stderr",
        },
      });
      const commandMissing = errorCode(error) === "ENOENT";

      return {
        result: OpenSpecArchiveResultSchema.parse({
          runId: input.run.id,
          changeName: input.plan.changeName,
          status: commandMissing ? "blocked" : "failed",
          startedAt: input.startedAt,
          completedAt,
          archiveCommand: input.plan.archiveCommand,
          polling: false,
          stderrArtifactId: stderrArtifact.id,
          followUpCommitRequired: input.plan.followUpCommitRequired,
          summary: commandMissing
            ? "OpenSpec archive blocked: OpenSpec CLI is unavailable."
            : `OpenSpec archive failed: ${safeErrorMessage(error)}`,
        }),
        artifacts: [stderrArtifact],
      };
    }
  }

  private async remoteCheckedEvidence(input: {
    runId: string;
    provider: ReviewRequestProvider;
    reviewRequestUrl: string;
    checkedAt: string;
  }): Promise<MergeEvidence> {
    try {
      const status = await this.fetchReviewStatus(input.provider, input.reviewRequestUrl);

      return MergeEvidenceSchema.parse({
        id: createArtifactId(),
        runId: input.runId,
        kind: "remote-checked",
        provider: input.provider,
        reviewRequestUrl: input.reviewRequestUrl,
        status,
        statement: `Checked ${input.provider} review request status once: ${status}.`,
        checkedAt: input.checkedAt,
        metadata: {
          polling: false,
        },
      });
    } catch (error: unknown) {
      return MergeEvidenceSchema.parse({
        id: createArtifactId(),
        runId: input.runId,
        kind: "remote-checked",
        provider: input.provider,
        reviewRequestUrl: input.reviewRequestUrl,
        status: "unknown",
        statement: `One-shot ${input.provider} status check failed: ${safeErrorMessage(error)}.`,
        checkedAt: input.checkedAt,
        metadata: {
          polling: false,
          error: safeErrorMessage(error),
        },
      });
    }
  }

  private async fetchReviewStatus(
    provider: ReviewRequestProvider,
    reviewRequestUrl: string,
  ): Promise<ReviewRequestStatus> {
    const parsed = parseReviewRequestUrl(reviewRequestUrl);

    if (parsed === undefined || parsed.provider !== provider) {
      throw new Error(`Review request URL does not match provider ${provider}.`);
    }

    const token = readPublisherToken(provider).token;

    if (provider === "github") {
      if (parsed.owner === undefined || parsed.repo === undefined) {
        throw new Error("GitHub review request URL is missing owner or repo.");
      }

      const response = await this.fetchImpl(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
        {
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`GitHub status check failed: ${response.status} ${await response.text()}`);
      }

      const pull = (await response.json()) as Record<string, unknown>;

      if (pull["merged"] === true) {
        return "merged";
      }

      return pull["state"] === "open" ? "open" : "closed_unmerged";
    }

    if (parsed.projectPath === undefined) {
      throw new Error("GitLab review request URL is missing project path.");
    }

    const project = encodeGitLabProjectId(parsed.projectPath);
    const response = await this.fetchImpl(
      `https://gitlab.com/api/v4/projects/${project}/merge_requests/${parsed.number}`,
      {
        method: "GET",
        headers: {
          "PRIVATE-TOKEN": token,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`GitLab status check failed: ${response.status} ${await response.text()}`);
    }

    const mr = (await response.json()) as Record<string, unknown>;
    const state = String(mr["state"] ?? "");

    if (state === "merged") {
      return "merged";
    }

    return state === "opened" ? "open" : "closed_unmerged";
  }

  private async latestPublishResultUrl(artifacts: ArtifactRef[]): Promise<string | undefined> {
    const artifact = latestArtifactByReportKind(artifacts, "agent-result-report", "publish-result");

    if (artifact === undefined) {
      return undefined;
    }

    const result = PublishResultSchema.parse(
      JSON.parse((await this.artifactStore.readContent(artifact.digest)).toString("utf8")),
    );

    return result.request?.url;
  }

  private async latestMergeEvidence(artifacts: ArtifactRef[]): Promise<MergeEvidence | undefined> {
    const artifact = latestArtifactByReportKind(artifacts, "merge-evidence", "merge-evidence");

    if (artifact === undefined) {
      return undefined;
    }

    return MergeEvidenceSchema.parse(
      JSON.parse((await this.artifactStore.readContent(artifact.digest)).toString("utf8")),
    );
  }

  private async requireMergeEvidence(
    artifacts: ArtifactRef[],
    artifactId: string,
  ): Promise<MergeEvidence> {
    const artifact = requireArtifact(artifacts, artifactId);

    if (
      artifact.kind !== "merge-evidence" ||
      artifact.metadata["reportKind"] !== "merge-evidence"
    ) {
      throw new Error(`Artifact is not a merge evidence artifact: ${artifact.id}`);
    }

    return MergeEvidenceSchema.parse(
      JSON.parse((await this.artifactStore.readContent(artifact.digest)).toString("utf8")),
    );
  }

  private async writeJsonArtifact(input: {
    artifactId: string;
    kind: "merge-evidence" | "openspec-archive-result";
    label: string;
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

  private async writeTextArtifact(input: {
    artifactId: string;
    kind: "log" | "openspec-archive-report";
    label: string;
    content: string;
    mediaType: string;
    timestamp: string;
    metadata: Record<string, unknown>;
  }): Promise<ArtifactRef> {
    const blob = await this.artifactStore.writeBlob({
      content: Buffer.from(input.content, "utf8"),
      mediaType: input.mediaType,
      storedAt: input.timestamp,
      label: input.label,
    });

    return ArtifactRefSchema.parse({
      id: input.artifactId,
      kind: input.kind,
      uri: blob.uri,
      mediaType: input.mediaType,
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

function requireArtifact(artifacts: ArtifactRef[], artifactId: string): ArtifactRef {
  const artifact = artifacts.find((item) => item.id === artifactId);

  if (artifact === undefined) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }

  return artifact;
}

function safeErrorMessage(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;

  return typeof code === "string" ? code : undefined;
}
