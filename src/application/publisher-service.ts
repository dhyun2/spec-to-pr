import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  detectPublishTargetFromRemote,
  GitHubPublisherAdapter,
  GitLabPublisherAdapter,
  PublishedReviewRequestSchema,
  PublishPlanSchema,
  PublishResultSchema,
  readPublisherToken,
  redactSecrets,
  ReviewHostSchema,
  ReviewRequestPayloadSchema,
} from "../publisher/index.js";
import type {
  PublishedReviewRequest,
  PublishResult,
  PublishTarget,
  ReviewRequestPayload,
  ReviewRequestPublisher,
} from "../publisher/index.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { AgentResultSchema } from "../runtime/agent-result.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { RUNTIME_CONTRACT_VERSION } from "../runtime/constants.js";
import { createAgentResultId, createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema } from "../runtime/scalars.js";
import type { ArtifactRef } from "../runtime/index.js";
import type { RunStore } from "../store/run-store.js";

const execFileAsync = promisify(execFile);
const PUBLISHER_ADAPTER = "publisher-v1" as const;

export type GitCommandRunner = (
  cwd: string,
  args: string[],
) => Promise<{
  stdout: string;
  stderr: string;
}>;

const BasePublishInputShape = {
  runId: RunIdSchema,
  reportArtifactId: ArtifactIdSchema.optional(),
  sourceBranch: z.string().trim().min(1),
  targetBranch: z.string().trim().min(1).default("main"),
  title: z.string().trim().min(1).optional(),
  host: ReviewHostSchema.optional(),
  mode: z.enum(["draft", "ready"]).default("draft"),
  labels: z.array(z.string().trim().min(1)).default(["spec-to-pr"]),
  reviewers: z.array(z.string().trim().min(1)).default([]),
  assignees: z.array(z.string().trim().min(1)).default([]),
  pushBranch: z.boolean().default(true),
  remoteName: z.string().trim().min(1).default("origin"),
  remoteUrl: z.string().trim().min(1).optional(),
  headSha: GitObjectIdSchema.optional(),
} as const;

export const DetectPublishTargetInputSchema = z
  .object({
    runId: RunIdSchema,
    remoteName: z.string().trim().min(1).default("origin"),
    remoteUrl: z.string().trim().min(1).optional(),
    host: ReviewHostSchema.optional(),
  })
  .strict();

export const DetectPublishTargetResultSchema = z
  .object({
    run: RunSummarySchema,
    remoteName: z.string().trim().min(1),
    remoteUrl: z.string().trim().min(1),
    target: z.unknown(),
  })
  .strict();

export const PlanReviewRequestPublishInputSchema = z.object(BasePublishInputShape).strict();

export const PlanReviewRequestPublishResultSchema = PublishPlanSchema;

export const PublishReviewRequestInputSchema = z
  .object({
    ...BasePublishInputShape,
    confirm: z.literal(true),
  })
  .strict();

export const PublishReviewRequestResultSchema = z
  .object({
    run: RunSummarySchema,
    result: PublishResultSchema,
    publishResultArtifactId: ArtifactIdSchema,
    agentResultId: z.string().optional(),
  })
  .strict();

export const UpdateReviewRequestBodyInputSchema = z
  .object({
    ...BasePublishInputShape,
    requestNumber: z.string().trim().min(1),
    confirm: z.literal(true),
  })
  .strict();

export const GetPublishResultInputSchema = z
  .object({
    runId: RunIdSchema,
    artifactId: ArtifactIdSchema.optional(),
  })
  .strict();

export const GetPublishResultResultSchema = z
  .object({
    run: RunSummarySchema,
    artifactId: ArtifactIdSchema,
    result: PublishResultSchema,
  })
  .strict();

export const RecordPublishReviewInputSchema = z
  .object({
    runId: RunIdSchema,
    publishResultArtifactId: ArtifactIdSchema.optional(),
    review: z.record(z.string(), z.unknown()),
  })
  .strict();

export const RecordPublishReviewResultSchema = z
  .object({
    run: RunSummarySchema,
    reviewArtifactId: ArtifactIdSchema,
    findingCount: z.number().int().nonnegative(),
  })
  .strict();

export class PublisherService {
  public constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactBlobStore,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly publishers: {
      github: ReviewRequestPublisher;
      gitlab: ReviewRequestPublisher;
    } = {
      github: new GitHubPublisherAdapter(),
      gitlab: new GitLabPublisherAdapter(),
    },
    private readonly git: GitCommandRunner = defaultGitCommandRunner,
  ) {}

  public async detectTarget(rawInput: unknown) {
    const input = DetectPublishTargetInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const remoteUrl =
      input.remoteUrl ??
      (await this.git(run.projectRoot, ["remote", "get-url", input.remoteName])).stdout.trim();
    const target = detectPublishTargetFromRemote({
      name: input.remoteName,
      url: remoteUrl,
    });

    if (input.host !== undefined && target.host !== input.host) {
      throw new Error(
        `Requested host ${input.host} but ${input.remoteName} remote is ${target.host}`,
      );
    }

    return DetectPublishTargetResultSchema.parse({
      run: summarizeRun(run),
      remoteName: input.remoteName,
      remoteUrl,
      target,
    });
  }

  public async plan(rawInput: unknown) {
    const input = PlanReviewRequestPublishInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const reportArtifact = resolvePrReportArtifact(run.artifacts, input.reportArtifactId);
    const reportBody = (await this.artifactStore.readContent(reportArtifact.digest)).toString(
      "utf8",
    );
    const detected = await this.detectTarget({
      runId: input.runId,
      remoteName: input.remoteName,
      ...(input.remoteUrl === undefined ? {} : { remoteUrl: input.remoteUrl }),
      ...(input.host === undefined ? {} : { host: input.host }),
    });
    const target = detected.target as PublishTarget;
    const payload = ReviewRequestPayloadSchema.parse({
      runId: run.id,
      title: input.title ?? defaultTitle(run.id),
      body: reportBody,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      ...(input.headSha === undefined ? {} : { headSha: input.headSha }),
      mode: input.mode,
      labels: input.labels,
      reviewers: input.reviewers,
      assignees: input.assignees,
      reportArtifactId: reportArtifact.id,
    });

    return PublishPlanSchema.parse({
      runId: run.id,
      target,
      payload,
      requiredTokenEnv:
        target.host === "github"
          ? "GITHUB_TOKEN or GH_TOKEN"
          : "GITLAB_TOKEN or GITLAB_PRIVATE_TOKEN",
      willPushBranch: input.pushBranch,
      willCreateOrUpdate: true,
      warnings: buildPlanWarnings({ payload }),
      plannedAt: timestamp,
    });
  }

  public async publish(rawInput: unknown) {
    const input = PublishReviewRequestInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const plan = await this.plan(input);
    const result = await this.executePublish({
      run,
      plan,
      timestamp,
      pushBranch: input.pushBranch,
    });

    return this.recordPublishResult({
      runId: run.id,
      result,
      payload: plan.payload,
      timestamp,
      addPublishingAgentResult: result.status === "passed",
    });
  }

  public async updateBody(rawInput: unknown) {
    const input = UpdateReviewRequestBodyInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const plan = await this.plan(input);
    const result = await this.executeUpdateBody({
      plan,
      requestNumber: input.requestNumber,
      timestamp,
    });

    return this.recordPublishResult({
      runId: run.id,
      result,
      payload: plan.payload,
      timestamp,
      addPublishingAgentResult: result.status === "passed",
    });
  }

  public async getResult(rawInput: unknown) {
    const input = GetPublishResultInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const artifact =
      input.artifactId === undefined
        ? latestPublishResultArtifact(run.artifacts)
        : requireArtifact(run.artifacts, input.artifactId);

    if (artifact.metadata["reportKind"] !== "publish-result") {
      throw new Error(`Artifact is not a publish result artifact: ${artifact.id}`);
    }

    const result = PublishResultSchema.parse(
      JSON.parse((await this.artifactStore.readContent(artifact.digest)).toString("utf8")),
    );

    return GetPublishResultResultSchema.parse({
      run: summarizeRun(run),
      artifactId: artifact.id,
      result,
    });
  }

  public async recordReview(rawInput: unknown) {
    const input = RecordPublishReviewInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const reviewArtifact = await this.writeJsonArtifact({
      label: "publish-review",
      value: input.review,
      timestamp,
      metadata: {
        reportKind: "publish-review",
        ...(input.publishResultArtifactId === undefined
          ? {}
          : { publishResultArtifactId: input.publishResultArtifactId }),
      },
    });
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [...run.artifacts, reviewArtifact],
    });

    await this.runStore.save(nextRun, run.revision);

    return RecordPublishReviewResultSchema.parse({
      run: summarizeRun(nextRun),
      reviewArtifactId: reviewArtifact.id,
      findingCount: findingCount(input.review),
    });
  }

  private async executePublish(input: {
    run: Awaited<ReturnType<RunStore["get"]>>;
    plan: z.infer<typeof PublishPlanSchema>;
    timestamp: string;
    pushBranch: boolean;
  }): Promise<PublishResult> {
    try {
      const token = readPublisherToken(input.plan.target.host);

      if (input.pushBranch) {
        await this.git(input.run.projectRoot, [
          "push",
          "--set-upstream",
          "origin",
          input.plan.payload.sourceBranch,
        ]);
      }

      const publisher = this.publishers[input.plan.target.host];
      const existing = await publisher.findExisting({
        target: input.plan.target,
        payload: input.plan.payload,
        token: token.token,
      });
      const request =
        existing === undefined
          ? await publisher.create({
              target: input.plan.target,
              payload: input.plan.payload,
              token: token.token,
            })
          : await publisher.updateBody({
              target: input.plan.target,
              requestNumber: existing.number,
              body: input.plan.payload.body,
              token: token.token,
            });

      return PublishResultSchema.parse({
        runId: input.plan.runId,
        status: "passed",
        target: input.plan.target,
        request,
        reportArtifactId: input.plan.payload.reportArtifactId,
        retryable: false,
        publishedAt: input.timestamp,
      });
    } catch (error: unknown) {
      return failedPublishResult({
        runId: input.plan.runId,
        target: input.plan.target,
        reportArtifactId: input.plan.payload.reportArtifactId,
        error,
        publishedAt: input.timestamp,
      });
    }
  }

  private async executeUpdateBody(input: {
    plan: z.infer<typeof PublishPlanSchema>;
    requestNumber: string;
    timestamp: string;
  }): Promise<PublishResult> {
    try {
      const token = readPublisherToken(input.plan.target.host);
      const publisher = this.publishers[input.plan.target.host];
      const request = await publisher.updateBody({
        target: input.plan.target,
        requestNumber: input.requestNumber,
        body: input.plan.payload.body,
        token: token.token,
      });

      return PublishResultSchema.parse({
        runId: input.plan.runId,
        status: "passed",
        target: input.plan.target,
        request,
        reportArtifactId: input.plan.payload.reportArtifactId,
        retryable: false,
        publishedAt: input.timestamp,
      });
    } catch (error: unknown) {
      return failedPublishResult({
        runId: input.plan.runId,
        target: input.plan.target,
        reportArtifactId: input.plan.payload.reportArtifactId,
        error,
        publishedAt: input.timestamp,
      });
    }
  }

  private async recordPublishResult(input: {
    runId: string;
    result: PublishResult;
    payload: ReviewRequestPayload;
    timestamp: string;
    addPublishingAgentResult: boolean;
  }) {
    const run = await this.runStore.get(RunIdSchema.parse(input.runId));
    const publishResultArtifact = await this.writeJsonArtifact({
      label: "publish-result",
      value: input.result,
      timestamp: input.timestamp,
      metadata: {
        reportKind: "publish-result",
        status: input.result.status,
        host: input.result.target?.host,
        requestUrl: input.result.request?.url,
      },
    });
    const agentResults = input.addPublishingAgentResult
      ? [
          ...run.agentResults,
          AgentResultSchema.parse({
            schemaVersion: RUNTIME_CONTRACT_VERSION,
            id: createAgentResultId(),
            runId: run.id,
            kind: "publishing",
            agent: "pr-publisher",
            status: "passed",
            baseSha: input.payload.headSha ?? run.baseCommit ?? "0000000",
            evidenceIds: [],
            artifactIds: [input.payload.reportArtifactId, publishResultArtifact.id],
            gapIds: [],
            checks: [],
            decisions: [],
            target: input.result.request?.host,
            prUrl: input.result.request?.url,
            prNumber: input.result.request?.number,
            draft: input.result.request?.draft ?? true,
            reportArtifactId: input.payload.reportArtifactId,
            startedAt: input.timestamp,
            completedAt: input.timestamp,
          }),
        ]
      : run.agentResults;
    const nextRun = RunManifestSchema.parse({
      ...run,
      revision: run.revision + 1,
      updatedAt: input.timestamp,
      artifacts: [...run.artifacts, publishResultArtifact],
      agentResults,
    });

    await this.runStore.save(nextRun, run.revision);

    return PublishReviewRequestResultSchema.parse({
      run: summarizeRun(nextRun),
      result: input.result,
      publishResultArtifactId: publishResultArtifact.id,
      ...(agentResults.length === run.agentResults.length
        ? {}
        : { agentResultId: agentResults.at(-1)?.id }),
    });
  }

  private async writeJsonArtifact(input: {
    label: string;
    value: unknown;
    timestamp: string;
    metadata: Record<string, unknown>;
  }): Promise<ArtifactRef> {
    const content = `${JSON.stringify(input.value, null, 2)}\n`;
    const blob = await this.artifactStore.writeBlob({
      content: Buffer.from(content, "utf8"),
      mediaType: "application/json",
      storedAt: input.timestamp,
      label: input.label,
    });

    return ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "agent-result-report",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "pr-publisher",
      evidenceIds: [],
      createdAt: input.timestamp,
      metadata: {
        adapter: PUBLISHER_ADAPTER,
        label: input.label,
        ...input.metadata,
      },
    });
  }
}

async function defaultGitCommandRunner(
  cwd: string,
  args: string[],
): Promise<{
  stdout: string;
  stderr: string;
}> {
  return execFileAsync("git", args, {
    cwd,
  });
}

function resolvePrReportArtifact(
  artifacts: ArtifactRef[],
  artifactId: string | undefined,
): ArtifactRef {
  const artifact =
    artifactId === undefined
      ? artifacts
          .filter(
            (item) =>
              item.kind === "pr-report" && item.metadata["reportKind"] === "pr-body-markdown",
          )
          .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]
      : artifacts.find((item) => item.id === artifactId);

  if (artifact === undefined) {
    throw new Error("PR report artifact not found.");
  }

  if (artifact.kind !== "pr-report" || artifact.metadata["reportKind"] !== "pr-body-markdown") {
    throw new Error(`Artifact is not a PR report markdown artifact: ${artifact.id}`);
  }

  return artifact;
}

function requireArtifact(artifacts: ArtifactRef[], artifactId: string): ArtifactRef {
  const artifact = artifacts.find((item) => item.id === artifactId);

  if (artifact === undefined) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }

  return artifact;
}

function latestPublishResultArtifact(artifacts: ArtifactRef[]): ArtifactRef {
  const artifact = artifacts
    .filter(
      (item) =>
        item.kind === "agent-result-report" && item.metadata["reportKind"] === "publish-result",
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

  if (artifact === undefined) {
    throw new Error("No publish result artifact found.");
  }

  return artifact;
}

function failedPublishResult(input: {
  runId: string;
  target: PublishTarget;
  reportArtifactId: string;
  error: unknown;
  publishedAt: string;
}): PublishResult {
  const message = redactSecrets(
    input.error instanceof Error ? input.error.message : String(input.error),
  );

  return PublishResultSchema.parse({
    runId: input.runId,
    status: "failed",
    target: input.target,
    reportArtifactId: input.reportArtifactId,
    errorCode: "PUBLISH_FAILED",
    errorMessage: message,
    retryable: true,
    publishedAt: input.publishedAt,
  });
}

function defaultTitle(runId: string): string {
  return `spec-to-pr evidence report for ${runId}`;
}

function buildPlanWarnings(input: { payload: ReviewRequestPayload }): string[] {
  const warnings: string[] = [];

  if (input.payload.mode !== "draft") {
    warnings.push("Publish mode is ready, not draft. Ensure reviewer approval policy allows this.");
  }

  if (input.payload.body.length > 60_000) {
    warnings.push("PR/MR body is very large. Host may truncate or reject it.");
  }

  return warnings;
}

function findingCount(review: Record<string, unknown>): number {
  const findings = review["findings"];

  return Array.isArray(findings) ? findings.length : 0;
}
