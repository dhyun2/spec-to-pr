import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  detectPublishTargetFromRemote,
  canUseGitLabRawEvidenceFallback,
  GitHubPublisherAdapter,
  GitLabPublisherAdapter,
  PublishedReviewRequestSchema,
  PublishIntentSchema,
  PublishPlanSchema,
  PublishResultSchema,
  type PublishedReviewAsset,
  readPublisherToken,
  redactSecrets,
  ReviewHostSchema,
  type ReviewRequestAsset,
  ReviewRequestSynchronizationError,
  ReviewRequestPayloadSchema,
} from "../publisher/index.js";
import type {
  PublishIntent,
  PublishedReviewRequest,
  PublishResult,
  PublishTarget,
  ReviewRequestPayload,
  ReviewRequestPublisher,
} from "../publisher/index.js";
import {
  ReportLocaleSchema,
  ReportDecisionSchema,
  WorkflowReportMetadataSchema,
  WorkflowReportIntentSchema,
  type ReportDecision,
  type WorkflowReportIntent,
} from "../pr-report/pr-report-model.js";
import { redactSecretShapes } from "../pr-report/markdown-safe.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { AgentResultSchema } from "../runtime/agent-result.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { RUNTIME_CONTRACT_VERSION } from "../runtime/constants.js";
import { createAgentResultId, createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema } from "../runtime/scalars.js";
import type { ArtifactRef } from "../runtime/index.js";
import type { RunStore } from "../store/run-store.js";
import { RevisionConflictError } from "../store/errors.js";
import { VisualReportSchema, type VisualReport } from "../visual/visual-model.js";
import { isSafeDurableEvidencePath } from "../workflow/workflow-contracts.js";

const execFileAsync = promisify(execFile);
const PUBLISHER_ADAPTER = "publisher-v1" as const;
const MAX_PUBLISH_RESULT_SAVE_ATTEMPTS = 8;

type VisualPreviewPolicy = {
  includeFigma?: boolean;
  includeBrowser?: boolean;
  includeDiff?: boolean;
};

type VisualPreviewContext = {
  name: string;
  route: string;
  state: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
};

type VisualPreviewResult = VisualReport["results"][number] & {
  context?: VisualPreviewContext;
};

type VisualPreviewReport = Omit<VisualReport, "results"> & {
  results: VisualPreviewResult[];
};

const VisualPreviewContextSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    route: z.string().trim().min(1).max(2_000),
    state: z.string().trim().min(1).max(200),
    viewport: z
      .object({
        width: z.number().int().positive().max(10_000),
        height: z.number().int().positive().max(10_000),
      })
      .strict(),
    deviceScaleFactor: z.number().positive().max(8),
  })
  .strip();

class PublishPreparationError extends Error {
  public constructor(
    message: string,
    public readonly details: {
      visualPreviewExpected: boolean;
      featureVideoExpected: boolean;
      partialReasons: string[];
    },
  ) {
    super(message);
    this.name = "PublishPreparationError";
  }
}

class PublishNoDeltaError extends Error {
  public constructor(
    public readonly sourceBranch: string,
    public readonly targetBranch: string,
  ) {
    super(
      `Draft publication requires at least one committed change on ${sourceBranch} beyond ${targetBranch}`,
    );
    this.name = "PublishNoDeltaError";
  }
}

export type GitCommandRunner = (
  cwd: string,
  args: string[],
  options?: {
    encoding?: "utf8" | "latin1";
    maxBuffer?: number;
  },
) => Promise<{
  stdout: string;
  stderr: string;
}>;

const BasePublishInputShape = {
  runId: RunIdSchema,
  intent: PublishIntentSchema.default("ready"),
  reportArtifactId: ArtifactIdSchema.optional(),
  sourceBranch: z.string().trim().min(1),
  targetBranch: z.string().trim().min(1).default("main"),
  title: z.string().trim().min(1).optional(),
  host: ReviewHostSchema.optional(),
  mode: z.literal("draft").default("draft"),
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

export const PlanReviewRequestPublishInputSchema = z
  .object(BasePublishInputShape)
  .strict()
  .refine((input) => input.sourceBranch !== input.targetBranch, {
    path: ["sourceBranch"],
    message: "Draft publication requires a source branch different from the target branch",
  });

export const PlanReviewRequestPublishResultSchema = PublishPlanSchema;

export const PublishReviewRequestInputSchema = z
  .object({
    ...BasePublishInputShape,
    confirm: z.literal(true),
  })
  .strict()
  .refine((input) => input.sourceBranch !== input.targetBranch, {
    path: ["sourceBranch"],
    message: "Draft publication requires a source branch different from the target branch",
  });

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
    allowBlockedBody: z.boolean().default(false),
    publishMode: z.enum(["blocked-draft-update"]).optional(),
    confirm: z.literal(true),
  })
  .strict()
  .refine((input) => input.sourceBranch !== input.targetBranch, {
    path: ["sourceBranch"],
    message: "Draft publication requires a source branch different from the target branch",
  });

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
    const reportMetadata = reportMetadataFromArtifact(reportArtifact);
    const detected = await this.detectTarget({
      runId: input.runId,
      remoteName: input.remoteName,
      ...(input.remoteUrl === undefined ? {} : { remoteUrl: input.remoteUrl }),
      ...(input.host === undefined ? {} : { host: input.host }),
    });
    const target = detected.target as PublishTarget;
    const reviewPacketId = reportArtifact.metadata["reviewPacketId"];
    const payload = ReviewRequestPayloadSchema.parse({
      runId: run.id,
      title: publishTitle({
        runId: run.id,
        intent: input.intent,
        ...(input.title === undefined ? {} : { title: input.title }),
      }),
      body: reportBody,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      ...(input.headSha === undefined || input.intent === "blocked-diagnostic"
        ? {}
        : { headSha: input.headSha }),
      ...(input.intent === "ready" &&
      typeof reviewPacketId === "string" &&
      /^packet_[a-f0-9]{64}$/.test(reviewPacketId)
        ? { reviewPacketId }
        : {}),
      mode: input.mode,
      labels: publishLabels(input.labels, input.intent),
      reviewers: input.reviewers,
      assignees: input.assignees,
      reportArtifactId: reportArtifact.id,
    });

    return PublishPlanSchema.parse({
      runId: run.id,
      intent: input.intent,
      target,
      payload,
      ...(reportMetadata.reportIntent === undefined
        ? {}
        : { reportIntent: reportMetadata.reportIntent }),
      ...(reportMetadata.reportDecision === undefined
        ? {}
        : { reportDecision: reportMetadata.reportDecision }),
      reportMetadataValid: reportMetadata.valid,
      requiredTokenEnv: publisherAuthHint(target.host),
      willPushBranch: input.pushBranch,
      willCreateOrUpdate: reportMatchesPublishIntent({
        reportMetadataValid: reportMetadata.valid,
        reportDecision: reportMetadata.reportDecision,
        reportIntent: reportMetadata.reportIntent,
        publishIntent: input.intent,
      }),
      warnings: buildPlanWarnings({
        payload,
        reportMetadataValid: reportMetadata.valid,
        reportDecision: reportMetadata.reportDecision,
        reportIntent: reportMetadata.reportIntent,
        publishIntent: input.intent,
      }),
      plannedAt: timestamp,
    });
  }

  public async publish(rawInput: unknown, options: { signal?: AbortSignal } = {}) {
    const input = PublishReviewRequestInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const { confirm, ...planInput } = input;
    void confirm;

    const plan = await this.plan(planInput);
    if (!plan.willCreateOrUpdate) {
      const result = blockedPublishResult({
        runId: run.id,
        target: plan.target,
        reportArtifactId: plan.payload.reportArtifactId,
        intent: plan.intent,
        reportMetadataValid: plan.reportMetadataValid,
        ...(plan.reportIntent === undefined ? {} : { reportIntent: plan.reportIntent }),
        ...(plan.reportDecision === undefined ? {} : { reportDecision: plan.reportDecision }),
        publishedAt: timestamp,
      });

      return this.recordPublishResult({
        runId: run.id,
        result,
        payload: plan.payload,
        timestamp,
        remoteName: input.remoteName,
        pushBranch: input.pushBranch,
        addPublishingAgentResult: false,
      });
    }

    try {
      await this.assertPublishBranchReady({
        projectRoot: run.projectRoot,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        ...(input.headSha === undefined || plan.intent === "blocked-diagnostic"
          ? {}
          : { headSha: input.headSha }),
      });
    } catch (error: unknown) {
      if (!(error instanceof PublishNoDeltaError)) throw error;
      const result = noDeltaPublishResult({
        runId: run.id,
        target: plan.target,
        reportArtifactId: plan.payload.reportArtifactId,
        sourceBranch: error.sourceBranch,
        targetBranch: error.targetBranch,
        publishedAt: timestamp,
      });

      return this.recordPublishResult({
        runId: run.id,
        result,
        payload: plan.payload,
        timestamp,
        remoteName: input.remoteName,
        pushBranch: input.pushBranch,
        addPublishingAgentResult: false,
      });
    }

    const result = await this.executePublish({
      run,
      plan,
      timestamp,
      pushBranch: input.pushBranch,
      remoteName: input.remoteName,
      signal: options.signal,
    });
    options.signal?.throwIfAborted();

    return this.recordPublishResult({
      runId: run.id,
      result,
      payload: plan.payload,
      timestamp,
      remoteName: input.remoteName,
      pushBranch: input.pushBranch,
      addPublishingAgentResult: result.status === "passed",
    });
  }

  public async updateBody(rawInput: unknown, options: { signal?: AbortSignal } = {}) {
    const input = UpdateReviewRequestBodyInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const { allowBlockedBody, confirm, publishMode, requestNumber, ...planInput } = input;
    void confirm;

    const blockedBodyUpdateAllowed =
      allowBlockedBody ||
      publishMode === "blocked-draft-update" ||
      input.intent === "blocked-diagnostic";
    const plan = await this.plan({
      ...planInput,
      ...(blockedBodyUpdateAllowed ? { intent: "blocked-diagnostic" as const } : {}),
    });

    if (!plan.willCreateOrUpdate) {
      const result = blockedPublishResult({
        runId: run.id,
        target: plan.target,
        reportArtifactId: plan.payload.reportArtifactId,
        intent: plan.intent,
        reportMetadataValid: plan.reportMetadataValid,
        ...(plan.reportIntent === undefined ? {} : { reportIntent: plan.reportIntent }),
        ...(plan.reportDecision === undefined ? {} : { reportDecision: plan.reportDecision }),
        publishedAt: timestamp,
      });

      return this.recordPublishResult({
        runId: run.id,
        result,
        payload: plan.payload,
        timestamp,
        remoteName: input.remoteName,
        pushBranch: input.pushBranch,
        addPublishingAgentResult: false,
      });
    }

    const result = await this.executeUpdateBody({
      plan,
      requestNumber,
      timestamp,
      signal: options.signal,
    });
    options.signal?.throwIfAborted();

    return this.recordPublishResult({
      runId: run.id,
      result,
      payload: plan.payload,
      timestamp,
      remoteName: input.remoteName,
      pushBranch: input.pushBranch,
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

  private async assertPublishBranchReady(input: {
    projectRoot: string;
    sourceBranch: string;
    targetBranch: string;
    headSha?: string;
  }): Promise<void> {
    const status = (await this.git(input.projectRoot, ["status", "--porcelain"])).stdout.trim();
    if (status.length > 0) {
      throw new Error(
        "Draft publication requires a clean working tree; commit the intended implementation changes first",
      );
    }

    const checkedOutBranch = (
      await this.git(input.projectRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"])
    ).stdout.trim();
    if (checkedOutBranch !== input.sourceBranch) {
      throw new Error(
        `Draft publication requires checked-out branch ${input.sourceBranch}; found ${checkedOutBranch || "detached HEAD"}`,
      );
    }

    const checkedOutHead = (
      await this.git(input.projectRoot, ["rev-parse", "--verify", "HEAD"])
    ).stdout.trim();
    const sourceHead = (
      await this.git(input.projectRoot, ["rev-parse", "--verify", input.sourceBranch])
    ).stdout.trim();
    if (checkedOutHead !== sourceHead) {
      throw new Error(`Checked-out HEAD does not match source branch ${input.sourceBranch}`);
    }
    if (input.headSha !== undefined && checkedOutHead !== input.headSha) {
      throw new Error(
        `Checked-out HEAD ${checkedOutHead} does not match the reviewed source SHA ${input.headSha}`,
      );
    }

    const aheadText = (
      await this.git(input.projectRoot, [
        "rev-list",
        "--count",
        `${input.targetBranch}..${input.sourceBranch}`,
      ])
    ).stdout.trim();
    const ahead = Number.parseInt(aheadText, 10);
    if (!Number.isSafeInteger(ahead) || ahead < 1) {
      throw new PublishNoDeltaError(input.sourceBranch, input.targetBranch);
    }
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
    remoteName: string;
    signal: AbortSignal | undefined;
  }): Promise<PublishResult> {
    try {
      input.signal?.throwIfAborted();
      const token = readPublisherToken(
        input.plan.target.host,
        new URL(input.plan.target.webBaseUrl).hostname,
      );

      if (input.pushBranch) {
        await this.git(input.run.projectRoot, [
          "push",
          "--set-upstream",
          input.remoteName,
          input.plan.payload.sourceBranch,
        ]);
      }
      input.signal?.throwIfAborted();

      const publisher = this.publishers[input.plan.target.host];
      const prepared = await this.preparePayloadForPublish({
        run: input.run,
        plan: input.plan,
        publisher,
        token: token.token,
        signal: input.signal,
      });
      const existing = await publisher.findExisting({
        target: input.plan.target,
        payload: prepared.payload,
        token: token.token,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (existing !== undefined && !existing.draft) {
        throw new Error(`Refusing to update non-draft review request ${existing.number}`);
      }
      const request =
        existing === undefined
          ? await publisher.create({
              target: input.plan.target,
              payload: prepared.payload,
              token: token.token,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            })
          : await publisher.update({
              target: input.plan.target,
              requestNumber: existing.number,
              update: reviewRequestUpdateFromPayload(prepared.payload),
              token: token.token,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            });
      if (!request.draft) {
        throw new Error(`Review request ${request.number} is not a draft after publication`);
      }

      return PublishResultSchema.parse({
        runId: input.plan.runId,
        status: input.plan.intent === "blocked-diagnostic" ? "blocked" : "passed",
        target: input.plan.target,
        request,
        reportArtifactId: input.plan.payload.reportArtifactId,
        publishedAssets: prepared.publishedAssets,
        requestSynced: true,
        visualPreviewExpected: prepared.visualPreviewExpected,
        visualPreviewSynced: prepared.visualPreviewSynced,
        featureVideoExpected: prepared.featureVideoExpected,
        featureVideoSynced: prepared.featureVideoSynced,
        fallbackMode: prepared.fallbackMode,
        ...(prepared.fallbackReason === undefined
          ? {}
          : { fallbackReason: prepared.fallbackReason }),
        partialReasons: prepared.partialReasons,
        retryable: false,
        publishedAt: input.timestamp,
      });
    } catch (error: unknown) {
      if (input.signal?.aborted) throw input.signal.reason ?? error;
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
    signal: AbortSignal | undefined;
  }): Promise<PublishResult> {
    try {
      input.signal?.throwIfAborted();
      const token = readPublisherToken(
        input.plan.target.host,
        new URL(input.plan.target.webBaseUrl).hostname,
      );
      const publisher = this.publishers[input.plan.target.host];
      const run = await this.runStore.get(input.plan.runId);
      const prepared = await this.preparePayloadForPublish({
        run,
        plan: input.plan,
        publisher,
        token: token.token,
        signal: input.signal,
      });
      const existing = await publisher.findExisting({
        target: input.plan.target,
        payload: prepared.payload,
        token: token.token,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (existing === undefined || existing.number !== input.requestNumber) {
        throw new Error(`Draft review request ${input.requestNumber} could not be verified`);
      }
      if (!existing.draft) {
        throw new Error(`Refusing to update non-draft review request ${existing.number}`);
      }
      const request = await publisher.update({
        target: input.plan.target,
        requestNumber: input.requestNumber,
        update: reviewRequestUpdateFromPayload(prepared.payload),
        token: token.token,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (!request.draft) {
        throw new Error(`Review request ${request.number} is not a draft after body update`);
      }

      return PublishResultSchema.parse({
        runId: input.plan.runId,
        status: input.plan.intent === "blocked-diagnostic" ? "blocked" : "passed",
        target: input.plan.target,
        request,
        reportArtifactId: input.plan.payload.reportArtifactId,
        publishedAssets: prepared.publishedAssets,
        requestSynced: true,
        visualPreviewExpected: prepared.visualPreviewExpected,
        visualPreviewSynced: prepared.visualPreviewSynced,
        featureVideoExpected: prepared.featureVideoExpected,
        featureVideoSynced: prepared.featureVideoSynced,
        fallbackMode: prepared.fallbackMode,
        ...(prepared.fallbackReason === undefined
          ? {}
          : { fallbackReason: prepared.fallbackReason }),
        partialReasons: prepared.partialReasons,
        retryable: false,
        publishedAt: input.timestamp,
      });
    } catch (error: unknown) {
      if (input.signal?.aborted) throw input.signal.reason ?? error;
      return failedPublishResult({
        runId: input.plan.runId,
        target: input.plan.target,
        reportArtifactId: input.plan.payload.reportArtifactId,
        error,
        publishedAt: input.timestamp,
      });
    }
  }

  private async preparePayloadForPublish(input: {
    run: Awaited<ReturnType<RunStore["get"]>>;
    plan: z.infer<typeof PublishPlanSchema>;
    publisher: ReviewRequestPublisher;
    token: string;
    signal: AbortSignal | undefined;
  }): Promise<{
    payload: ReviewRequestPayload;
    publishedAssets: PublishedReviewAsset[];
    visualPreviewExpected: boolean;
    visualPreviewSynced: boolean;
    featureVideoExpected: boolean;
    featureVideoSynced: boolean;
    fallbackMode: "none" | "gitlab-raw-evidence";
    fallbackReason?: string;
    partialReasons: string[];
  }> {
    const visualPreview = await this.collectVisualPreviewAssets(input.run, input.plan.payload);
    const featureVideo = await this.collectFeatureVideoAsset(input.run, input.plan.payload);
    const assets = [...visualPreview.assets, ...(featureVideo === undefined ? [] : [featureVideo])];
    const visualPreviewExpected =
      visualPreview.assets.length > 0 && visualPreview.report !== undefined;
    const featureVideoExpected = featureVideo !== undefined;

    if (assets.length === 0) {
      return {
        payload: input.plan.payload,
        publishedAssets: [],
        visualPreviewExpected: false,
        visualPreviewSynced: false,
        featureVideoExpected: false,
        featureVideoSynced: false,
        fallbackMode: "none",
        partialReasons: [],
      };
    }

    let publishedAssets: PublishedReviewAsset[];
    let fallbackMode: "none" | "gitlab-raw-evidence" = "none";
    let fallbackReason: string | undefined;
    const partialReasons: string[] = [];
    try {
      publishedAssets = await input.publisher.publishAssets({
        target: input.plan.target,
        payload: input.plan.payload,
        token: input.token,
        assets,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const rawFallback = await this.tryGitLabRawVisualFallback({
        run: input.run,
        target: input.plan.target,
        payload: input.plan.payload,
        visualPreview,
        featureVideo,
        error,
      });
      if (rawFallback !== undefined) {
        publishedAssets = rawFallback;
        fallbackMode = "gitlab-raw-evidence";
        fallbackReason = `GitLab review-asset upload failed; used immutable raw visual evidence instead: ${redactSecrets(message)}`;
      } else {
        const label = visualPreviewExpected ? "visual evidence" : "feature video";
        throw new PublishPreparationError(`${label} upload failed: ${message}`, {
          visualPreviewExpected,
          featureVideoExpected,
          partialReasons: [`${label} upload failed: ${redactSecrets(message)}`],
        });
      }
    }

    if (fallbackMode === "none" && publishedAssets.length !== assets.length) {
      throw new PublishPreparationError(
        `review evidence upload incomplete: ${publishedAssets.length}/${assets.length} asset(s) uploaded`,
        {
          visualPreviewExpected,
          featureVideoExpected,
          partialReasons: [
            `review evidence upload incomplete: ${publishedAssets.length}/${assets.length} asset(s) uploaded`,
          ],
        },
      );
    }

    const visualAssets = publishedAssets.filter((asset) => asset.role !== "e2e-video");
    const videoAsset = publishedAssets.find((asset) => asset.role === "e2e-video");
    let body = input.plan.payload.body;
    if (visualPreviewExpected && visualPreview.report !== undefined) {
      body = injectVisualEvidencePreview({
        body,
        report: visualPreview.report,
        assets: visualAssets,
        ...(visualPreview.locale === undefined ? {} : { locale: visualPreview.locale }),
      });
    }
    if (videoAsset !== undefined) {
      body = injectFeatureVideoEvidence(body, videoAsset);
    }

    return {
      payload: ReviewRequestPayloadSchema.parse({
        ...input.plan.payload,
        body,
      }),
      publishedAssets,
      visualPreviewExpected,
      visualPreviewSynced: visualPreviewExpected,
      featureVideoExpected,
      featureVideoSynced: featureVideoExpected,
      fallbackMode,
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      partialReasons,
    };
  }

  private async tryGitLabRawVisualFallback(input: {
    run: Awaited<ReturnType<RunStore["get"]>>;
    target: PublishTarget;
    payload: ReviewRequestPayload;
    visualPreview: {
      report?: VisualPreviewReport;
      assets: ReviewRequestAsset[];
      locale?: "ko" | "en";
    };
    featureVideo: ReviewRequestAsset | undefined;
    error: unknown;
  }): Promise<PublishedReviewAsset[] | undefined> {
    if (
      input.target.host !== "gitlab" ||
      input.payload.headSha === undefined ||
      input.visualPreview.report === undefined ||
      input.featureVideo !== undefined ||
      !canUseGitLabRawEvidenceFallback(input.error)
    ) {
      return undefined;
    }

    const required = new Map<string, ReviewRequestAsset>();
    for (const asset of input.visualPreview.assets) {
      if (asset.role !== "figma" && asset.role !== "browser") continue;
      const key = `${asset.targetId}:${asset.role}`;
      if (required.has(key)) return undefined;
      required.set(key, asset);
    }
    const expectedKeys = input.visualPreview.report.results.flatMap((result) => [
      `${result.targetId}:figma`,
      `${result.targetId}:browser`,
    ]);
    if (required.size !== expectedKeys.length || expectedKeys.some((key) => !required.has(key))) {
      return undefined;
    }

    const checkedOutHead = (
      await this.git(input.run.projectRoot, ["rev-parse", "--verify", "HEAD"])
    ).stdout.trim();
    const status = (await this.git(input.run.projectRoot, ["status", "--porcelain"])).stdout.trim();
    if (checkedOutHead !== input.payload.headSha || status.length > 0) return undefined;

    const rawAssets: PublishedReviewAsset[] = [];
    for (const key of expectedKeys) {
      const asset = required.get(key)!;
      const evidence = asset.evidence;
      if (
        evidence === undefined ||
        evidence.headSha !== input.payload.headSha ||
        !isSafeGitLabRawEvidencePath(evidence.projectRelativePath)
      ) {
        return undefined;
      }
      const evidencePath = path.resolve(input.run.projectRoot, evidence.projectRelativePath);
      if (!isPathWithinRoot(input.run.projectRoot, evidencePath)) return undefined;

      const tracked = await this.git(input.run.projectRoot, [
        "ls-tree",
        "-r",
        input.payload.headSha,
        "--",
        evidence.projectRelativePath,
      ]);
      if (!gitTreeContainsRegularFile(tracked.stdout, evidence.projectRelativePath)) {
        return undefined;
      }

      let committedContent: Buffer;
      try {
        const objectName = `${input.payload.headSha}:${evidence.projectRelativePath}`;
        const result = await this.git(input.run.projectRoot, ["cat-file", "blob", objectName], {
          encoding: "latin1",
          maxBuffer: 50 * 1024 * 1024,
        });
        committedContent = Buffer.from(result.stdout, "latin1");
      } catch {
        return undefined;
      }
      const committedDigest = `sha256:${createHash("sha256")
        .update(committedContent)
        .digest("hex")}`;
      if (committedDigest !== evidence.digest) return undefined;

      let content: Buffer;
      try {
        content = await readFile(evidencePath);
      } catch {
        return undefined;
      }
      const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
      if (digest !== evidence.digest) return undefined;

      const url = gitLabRawEvidenceUrl({
        target: input.target,
        headSha: input.payload.headSha,
        projectRelativePath: evidence.projectRelativePath,
      });
      if (url === undefined) return undefined;
      rawAssets.push({
        artifactId: asset.artifactId,
        targetId: asset.targetId,
        role: asset.role,
        label: asset.label,
        url,
        // A same-project GitLab raw URL is authenticated by the reviewer session
        // and can render inline in the MR description.
        embeddable: true,
      });
    }

    return rawAssets;
  }

  private async collectFeatureVideoAsset(
    run: Awaited<ReturnType<RunStore["get"]>>,
    payload: ReviewRequestPayload,
  ): Promise<ReviewRequestAsset | undefined> {
    const reportArtifact = requireArtifact(run.artifacts, payload.reportArtifactId);
    const reviewPacketId = reportArtifact.metadata["reviewPacketId"];
    const artifact = [...run.artifacts]
      .reverse()
      .find(
        (item) =>
          item.metadata["workflowSubmissionKind"] === "implementation" &&
          item.metadata["featureEvidenceRole"] === "video" &&
          (reviewPacketId === undefined || item.metadata["reviewPacketId"] === reviewPacketId),
      );

    if (artifact === undefined) return undefined;
    if (artifact.mediaType !== "video/webm" && artifact.mediaType !== "video/mp4") {
      throw new Error(`Feature E2E artifact is not a supported video: ${artifact.id}`);
    }

    const extension = artifact.mediaType === "video/mp4" ? ".mp4" : ".webm";
    return {
      artifactId: artifact.id,
      targetId: "feature-e2e",
      role: "e2e-video",
      label: "Feature E2E video",
      filename: `${safePathSegment(payload.runId)}-feature-e2e-${artifact.id.replace(/^art_/, "").slice(0, 12)}${extension}`,
      mediaType: artifact.mediaType,
      content: await this.artifactStore.readContent(artifact.digest),
    };
  }

  private async collectVisualPreviewAssets(
    run: Awaited<ReturnType<RunStore["get"]>>,
    payload: ReviewRequestPayload,
  ): Promise<{
    report?: VisualPreviewReport;
    assets: ReviewRequestAsset[];
    locale?: "ko" | "en";
  }> {
    const prReportArtifact = requireArtifact(run.artifacts, payload.reportArtifactId);
    const locale = ReportLocaleSchema.safeParse(prReportArtifact.metadata["locale"]);
    const reviewPacketId = prReportArtifact.metadata["reviewPacketId"];
    const reportArtifact = latestVisualReportArtifact(run.artifacts, reviewPacketId);

    if (reportArtifact === undefined) {
      return {
        assets: [],
      };
    }

    const rawReport = JSON.parse(
      (await this.artifactStore.readContent(reportArtifact.digest)).toString("utf8"),
    );
    const report = normalizeVisualReport(rawReport);
    const policy = await this.readVisualPreviewPolicy(run.artifacts);
    const assets: ReviewRequestAsset[] = [];
    const labels = visualPreviewLabels(report);

    for (const result of report.results) {
      if (includeVisualRole(policy, "figma")) {
        assets.push(
          await this.visualAssetFromArtifact({
            artifacts: run.artifacts,
            artifactId: result.figmaScreenshotArtifactId,
            targetId: result.targetId,
            role: "figma",
            label: labels.baseline,
            payload,
          }),
        );
      }

      if (includeVisualRole(policy, "browser")) {
        assets.push(
          await this.visualAssetFromArtifact({
            artifacts: run.artifacts,
            artifactId: result.browserScreenshotArtifactId,
            targetId: result.targetId,
            role: "browser",
            label: labels.actual,
            payload,
          }),
        );
      }

      if (result.diffArtifactId !== undefined && includeVisualRole(policy, "diff")) {
        assets.push(
          await this.visualAssetFromArtifact({
            artifacts: run.artifacts,
            artifactId: result.diffArtifactId,
            targetId: result.targetId,
            role: "diff",
            label: "Diff",
            payload,
          }),
        );
      }
    }

    return {
      report,
      assets,
      ...(locale.success ? { locale: locale.data } : {}),
    };
  }

  private async readVisualPreviewPolicy(artifacts: ArtifactRef[]): Promise<VisualPreviewPolicy> {
    const artifact = [...artifacts].reverse().find((item) => item.kind === "parsed-intake-request");

    if (artifact === undefined) {
      return {};
    }

    try {
      const parsed = JSON.parse(
        (await this.artifactStore.readContent(artifact.digest)).toString("utf8"),
      ) as {
        parsed?: {
          visualPreviewPolicy?: VisualPreviewPolicy;
        };
      };

      return parsed.parsed?.visualPreviewPolicy ?? {};
    } catch {
      return {};
    }
  }

  private async visualAssetFromArtifact(input: {
    artifacts: ArtifactRef[];
    artifactId: string;
    targetId: string;
    role: ReviewRequestAsset["role"];
    label: string;
    payload: ReviewRequestPayload;
  }): Promise<ReviewRequestAsset> {
    const artifact = requireArtifact(input.artifacts, input.artifactId);
    const sourceArtifact = resolveSourceVisualArtifact(input.artifacts, artifact);

    if (!artifact.mediaType.startsWith("image/")) {
      throw new Error(`Visual artifact is not an image: ${artifact.id}`);
    }

    const extension = extensionForMediaType(artifact.mediaType);

    return {
      artifactId: artifact.id,
      targetId: input.targetId,
      role: input.role,
      label: input.label,
      filename:
        [
          safePathSegment(input.payload.runId),
          safePathSegment(input.targetId),
          input.role,
          artifact.id.replace(/^art_/, "").slice(0, 12),
        ].join("-") + extension,
      mediaType: artifact.mediaType,
      content: await this.artifactStore.readContent(artifact.digest),
      ...(sourceArtifact.digest !== artifact.digest
        ? {}
        : rawEvidenceFromArtifacts({ artifact, sourceArtifact })),
    };
  }

  private async recordPublishResult(input: {
    runId: string;
    result: PublishResult;
    payload: ReviewRequestPayload;
    timestamp: string;
    remoteName: string;
    pushBranch: boolean;
    addPublishingAgentResult: boolean;
  }) {
    let run = await this.runStore.get(RunIdSchema.parse(input.runId));
    const reportArtifact = requireArtifact(run.artifacts, input.payload.reportArtifactId);
    const publishResultArtifact = await this.writeJsonArtifact({
      label: "publish-result",
      value: input.result,
      timestamp: input.timestamp,
      metadata: {
        reportKind: "publish-result",
        status: input.result.status,
        host: input.result.target?.host,
        requestUrl: input.result.request?.url,
        requestDraft: input.result.request?.draft,
        requestSynced: input.result.requestSynced,
        visualPreviewExpected: input.result.visualPreviewExpected,
        visualPreviewSynced: input.result.visualPreviewSynced,
        featureVideoExpected: input.result.featureVideoExpected,
        featureVideoSynced: input.result.featureVideoSynced,
        fallbackMode: input.result.fallbackMode,
        ...(input.result.fallbackReason === undefined
          ? {}
          : { fallbackReason: input.result.fallbackReason }),
        publishIntent: reportArtifact.metadata["reportIntent"],
        diagnosticReportKey: reportArtifact.metadata["idempotencyKey"],
        sourceBranch: input.payload.sourceBranch,
        targetBranch: input.payload.targetBranch,
        remoteName: input.remoteName,
        pushBranch: input.pushBranch,
      },
    });
    const shouldAddPublishingAgentResult =
      input.addPublishingAgentResult && publishResultIsFullySynced(input.result);
    const publishingAgentResult = shouldAddPublishingAgentResult
      ? AgentResultSchema.parse({
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
        })
      : undefined;

    for (let attempt = 0; attempt < MAX_PUBLISH_RESULT_SAVE_ATTEMPTS; attempt += 1) {
      if (run.artifacts.some((artifact) => artifact.id === publishResultArtifact.id)) {
        return PublishReviewRequestResultSchema.parse({
          run: summarizeRun(run),
          result: input.result,
          publishResultArtifactId: publishResultArtifact.id,
          ...(publishingAgentResult === undefined
            ? {}
            : { agentResultId: publishingAgentResult.id }),
        });
      }

      const agentResults =
        publishingAgentResult === undefined ||
        run.agentResults.some((result) => result.id === publishingAgentResult.id)
          ? run.agentResults
          : [...run.agentResults, publishingAgentResult];
      const nextRun = RunManifestSchema.parse({
        ...run,
        revision: run.revision + 1,
        updatedAt:
          Date.parse(input.timestamp) >= Date.parse(run.updatedAt)
            ? input.timestamp
            : run.updatedAt,
        artifacts: [...run.artifacts, publishResultArtifact],
        agentResults,
      });

      try {
        await this.runStore.save(nextRun, run.revision);
        return PublishReviewRequestResultSchema.parse({
          run: summarizeRun(nextRun),
          result: input.result,
          publishResultArtifactId: publishResultArtifact.id,
          ...(publishingAgentResult === undefined
            ? {}
            : { agentResultId: publishingAgentResult.id }),
        });
      } catch (error: unknown) {
        if (!(error instanceof RevisionConflictError)) throw error;
        run = await this.runStore.get(RunIdSchema.parse(input.runId));
      }
    }

    throw new Error(`Could not persist publish result for Run ${input.runId}`);
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

function includeVisualRole(
  policy: VisualPreviewPolicy,
  role: "figma" | "browser" | "diff",
): boolean {
  if (role === "figma") return policy.includeFigma !== false;
  if (role === "browser") return policy.includeBrowser !== false;

  return policy.includeDiff !== false;
}

async function defaultGitCommandRunner(
  cwd: string,
  args: string[],
  options: {
    encoding?: "utf8" | "latin1";
    maxBuffer?: number;
  } = {},
): Promise<{
  stdout: string;
  stderr: string;
}> {
  const encoding = options.encoding ?? "utf8";
  const result = await execFileAsync("git", args, {
    cwd,
    encoding,
    ...(options.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
  });

  return {
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout.toString(encoding) : result.stdout,
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr.toString(encoding) : result.stderr,
  };
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

function resolveSourceVisualArtifact(artifacts: ArtifactRef[], artifact: ArtifactRef): ArtifactRef {
  let current = artifact;
  const visited = new Set<string>([artifact.id]);

  while (typeof current.metadata["sourceArtifactId"] === "string") {
    const sourceArtifactId = current.metadata["sourceArtifactId"];
    if (visited.has(sourceArtifactId)) return artifact;
    const source = artifacts.find((candidate) => candidate.id === sourceArtifactId);
    if (source === undefined) return artifact;
    visited.add(source.id);
    current = source;
  }

  return current;
}

function rawEvidenceFromArtifacts(input: {
  artifact: ArtifactRef;
  sourceArtifact: ArtifactRef;
}): Pick<ReviewRequestAsset, "evidence"> {
  const projectRelativePath = input.sourceArtifact.metadata["projectRelativePath"];
  const headSha = input.artifact.metadata["headSha"];

  if (typeof projectRelativePath !== "string") return {};

  return {
    evidence: {
      projectRelativePath,
      digest: input.sourceArtifact.digest,
      ...(typeof headSha !== "string" ? {} : { headSha }),
    },
  };
}

function isSafeGitLabRawEvidencePath(projectRelativePath: string): boolean {
  // `visual/*.png` is synthetic comparison output held only by the artifact
  // store; it is never a durable source file. Feature-scoped visual evidence
  // lives under `.spec-to-pr/<feature>/visual/` and remains eligible.
  return (
    isSafeDurableEvidencePath(projectRelativePath) && !projectRelativePath.startsWith("visual/")
  );
}

function isPathWithinRoot(projectRoot: string, candidatePath: string): boolean {
  const root = path.resolve(projectRoot);
  const candidate = path.resolve(candidatePath);

  return candidate.startsWith(`${root}${path.sep}`);
}

function gitTreeContainsRegularFile(output: string, projectRelativePath: string): boolean {
  return output.split(/\r?\n/).some((line) => {
    const match = /^(100644|100755) blob [a-f0-9]{40,64}\t(.+)$/iu.exec(line);
    return match?.[2] === projectRelativePath;
  });
}

function gitLabRawEvidenceUrl(input: {
  target: PublishTarget;
  headSha: string;
  projectRelativePath: string;
}): string | undefined {
  if (input.target.host !== "gitlab" || input.target.projectPath === undefined) return undefined;

  const projectPath = input.target.projectPath.split("/").map(encodeURIComponent).join("/");
  const evidencePath = input.projectRelativePath.split("/").map(encodeURIComponent).join("/");
  const webBaseUrl = input.target.webBaseUrl.replace(/\/+$/, "");

  return `${webBaseUrl}/${projectPath}/-/raw/${encodeURIComponent(input.headSha)}/${evidencePath}`;
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

function latestVisualReportArtifact(
  artifacts: ArtifactRef[],
  reviewPacketId: unknown,
): ArtifactRef | undefined {
  return artifacts
    .filter(
      (item) =>
        item.kind === "visual-report" &&
        (item.metadata["reportKind"] === "visual-report-json" ||
          item.metadata["reportKind"] === "visual-report-v2-json") &&
        (reviewPacketId === undefined || item.metadata["reviewPacketId"] === reviewPacketId),
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}

function normalizeVisualReport(rawReport: unknown): VisualPreviewReport {
  const legacy = VisualReportSchema.safeParse(rawReport);
  if (legacy.success) return legacy.data;
  if (typeof rawReport !== "object" || rawReport === null || Array.isArray(rawReport)) {
    throw new Error("Visual report is not a supported report object");
  }
  const report = rawReport as Record<string, unknown>;
  const rawResults = report["results"];
  if (!Array.isArray(rawResults)) throw new Error("Visual report is missing results");
  const contexts: Array<VisualPreviewContext | undefined> = [];
  const results = rawResults.map((rawResult) => {
    if (typeof rawResult !== "object" || rawResult === null || Array.isArray(rawResult)) {
      throw new Error("Visual report contains an invalid result");
    }
    const result = rawResult as Record<string, unknown>;
    const context = VisualPreviewContextSchema.safeParse(result);
    contexts.push(context.success ? context.data : undefined);
    return {
      targetId: result["targetId"],
      status: result["status"],
      figmaScreenshotArtifactId: result["baselineArtifactId"],
      browserScreenshotArtifactId: result["actualArtifactId"],
      overlayArtifactId: result["overlayArtifactId"],
      diffArtifactId: result["diffArtifactId"],
      metrics: result["metrics"],
      gapIds: [],
      notes: [],
    };
  });
  const baselineKind =
    typeof rawResults[0] === "object" && rawResults[0] !== null
      ? (rawResults[0] as Record<string, unknown>)["baselineKind"]
      : "figma";
  const normalized = VisualReportSchema.parse({
    runId: report["runId"],
    changeName: "review-packet-visual-comparison",
    visualBaseline: baselineKind,
    comparisonScope: "screen",
    generatedAt: report["generatedAt"],
    targetCount: results.length,
    passedCount: results.filter((result) => result.status === "passed").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    reviewNeededCount: results.filter((result) => result.status === "review-needed").length,
    results,
  });
  return {
    ...normalized,
    results: normalized.results.map((result, index) => ({
      ...result,
      ...(contexts[index] === undefined ? {} : { context: contexts[index] }),
    })),
  };
}

function injectVisualEvidencePreview(input: {
  body: string;
  report: VisualPreviewReport;
  assets: PublishedReviewAsset[];
  locale?: "ko" | "en";
}): string {
  const locale = input.locale ?? (isKoreanReportBody(input.body) ? "ko" : "en");
  const preview = renderVisualEvidencePreview(input.report, input.assets, locale);

  if (preview === undefined) {
    return input.body;
  }

  const cleaned = removeVisualEvidencePreview(input.body).trimEnd();
  const slotIndex = cleaned.indexOf(VISUAL_PREVIEW_SLOT);

  if (slotIndex !== -1) {
    return `${cleaned.slice(0, slotIndex).trimEnd()}\n\n${preview}\n\n${cleaned.slice(slotIndex + VISUAL_PREVIEW_SLOT.length).trimStart()}`;
  }

  const runMetadataIndex =
    locale === "ko"
      ? cleaned.indexOf("\n## 실행 메타데이터")
      : cleaned.indexOf("\n## Run Metadata");

  if (runMetadataIndex === -1) {
    return `${cleaned}\n\n${preview}\n`;
  }

  return `${cleaned.slice(0, runMetadataIndex).trimEnd()}\n\n${preview}\n${cleaned.slice(runMetadataIndex)}\n`;
}

const VISUAL_PREVIEW_START = "<!-- spec-to-pr:visual-evidence:start -->";
const VISUAL_PREVIEW_END = "<!-- spec-to-pr:visual-evidence:end -->";
const VISUAL_PREVIEW_SLOT = "<!-- spec-to-pr:visual-evidence:slot -->";
const FEATURE_VIDEO_START = "<!-- spec-to-pr:feature-video:start -->";
const FEATURE_VIDEO_END = "<!-- spec-to-pr:feature-video:end -->";

function injectFeatureVideoEvidence(body: string, asset: PublishedReviewAsset): string {
  const start = body.indexOf(FEATURE_VIDEO_START);
  const end = body.indexOf(FEATURE_VIDEO_END);
  const cleanBody =
    start === -1 || end === -1 || end < start
      ? body.trimEnd()
      : `${body.slice(0, start).trimEnd()}\n\n${body.slice(end + FEATURE_VIDEO_END.length).trimStart()}`.trimEnd();
  const korean = isKoreanReportBody(cleanBody);

  return [
    cleanBody,
    "",
    FEATURE_VIDEO_START,
    korean ? "## 기능 E2E 영상" : "## Feature E2E Evidence",
    "",
    korean
      ? `[변경한 기능 녹화 보기](${asset.url})`
      : `[Open the targeted feature recording](${asset.url})`,
    "",
    FEATURE_VIDEO_END,
  ].join("\n");
}

function removeVisualEvidencePreview(body: string): string {
  const start = body.indexOf(VISUAL_PREVIEW_START);
  const end = body.indexOf(VISUAL_PREVIEW_END);

  if (start === -1 || end === -1 || end < start) {
    return body;
  }

  return `${body.slice(0, start).trimEnd()}\n\n${body.slice(end + VISUAL_PREVIEW_END.length).trimStart()}`;
}

function renderVisualEvidencePreview(
  report: VisualPreviewReport,
  assets: PublishedReviewAsset[],
  locale: "ko" | "en" = "en",
): string | undefined {
  if (assets.length === 0 || report.results.length === 0) {
    return undefined;
  }

  const assetByTargetAndRole = new Map<string, PublishedReviewAsset>();
  const labels = visualPreviewLabels(report, locale);

  for (const asset of assets) {
    assetByTargetAndRole.set(`${asset.targetId}:${asset.role}`, asset);
  }

  const rows = report.results.map((result, index) => {
    const figma = assetByTargetAndRole.get(`${result.targetId}:figma`);
    const browser = assetByTargetAndRole.get(`${result.targetId}:browser`);
    const diff = assetByTargetAndRole.get(`${result.targetId}:diff`);
    const reviewMatch = `${(result.metrics.reviewMatchRatio * 100).toFixed(2)}%`;
    const exactMatch = `${(result.metrics.exactMatchRatio * 100).toFixed(2)}%`;
    const target = visualTargetDisplay(result, index, locale);

    const screenCell =
      target.context === undefined
        ? escapeMarkdownTableCell(target.name)
        : `${escapeMarkdownTableCell(target.name)}<br>${escapeMarkdownTableCell(target.context)}`;

    return locale === "ko"
      ? [
          screenCell,
          imageCell(figma, labels.baseline, target.name),
          imageCell(browser, labels.actual, target.name),
          imageCell(diff, "차이", target.name),
          reviewMatch,
          exactMatch,
          koreanVisualStatus(result.status),
        ]
      : [
          screenCell,
          imageCell(figma, labels.baseline, target.name),
          imageCell(browser, labels.actual, target.name),
          imageCell(diff, "Diff", target.name),
          reviewMatch,
          exactMatch,
          result.status,
        ];
  });

  const hasNonEmbeddable = assets.some((asset) => asset.embeddable === false);
  const fallbackNote = hasNonEmbeddable
    ? locale === "ko"
      ? "\n> 이 저장소는 인라인 이미지 미리보기가 제한되어(예: 비공개 저장소) 이미지를 링크로 대체했습니다. 로그인한 뒤 링크를 열어 확인하세요."
      : "\n> Inline image previews are restricted for this repository (e.g. a private repo), so images are shown as links. Open them while signed in to view."
    : "";

  return [
    VISUAL_PREVIEW_START,
    locale === "ko"
      ? report.visualBaseline === "legacy-screenshot"
        ? "### 레거시와 이관 결과"
        : "### Figma와 브라우저 결과"
      : "## Visual Evidence Preview",
    "",
    visualPreviewDescription(report, assets, locale),
    fallbackNote,
    "",
    locale === "ko"
      ? `| 화면 | ${labels.baseline} | ${labels.actual} | 차이 | 검토 일치율 | 픽셀 일치율 | 결과 |`
      : `| Screen | ${labels.baseline} | ${labels.actual} | Diff | Review match | Exact match | Status |`,
    "| --- | --- | --- | --- | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    VISUAL_PREVIEW_END,
  ].join("\n");
}

function visualTargetDisplay(
  result: VisualPreviewResult,
  index: number,
  locale: "ko" | "en",
): { name: string; context?: string } {
  if (result.context === undefined) {
    return { name: locale === "ko" ? `화면 ${index + 1}` : `Screen ${index + 1}` };
  }

  const providedName = redactSecretShapes(result.context.name.trim());
  const safeRoute = redactSecretShapes(result.context.route);
  const safeState = redactSecretShapes(result.context.state);
  const name =
    providedName !== result.targetId && !looksLikeOpaqueVisualIdentifier(providedName)
      ? providedName
      : (visualNameFromRoute(safeRoute) ??
        (locale === "ko" ? `화면 ${index + 1}` : `Screen ${index + 1}`));

  return {
    name,
    context: `${safeRoute} · ${safeState} · ${result.context.viewport.width}×${result.context.viewport.height} @${result.context.deviceScaleFactor}x`,
  };
}

function visualNameFromRoute(route: string): string | undefined {
  const routeWithoutQuery = route.split("?", 1)[0] ?? route;
  const segments = routeWithoutQuery
    .split(/[/:#]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && !/^\d+$/.test(segment));
  const segment = segments.at(-1);
  if (segment === undefined || looksLikeOpaqueVisualIdentifier(segment)) return undefined;
  return segment.replace(/[._-]+/g, " ");
}

function looksLikeOpaqueVisualIdentifier(value: string): boolean {
  return (
    /^(?:legacy_)?[a-f0-9]{16,}$/i.test(value) ||
    /^(?:target|screen|view)?[_-]?[a-z0-9]{20,}$/i.test(value)
  );
}

function visualPreviewLabels(
  report: VisualPreviewReport,
  locale: "ko" | "en" = "en",
): { baseline: string; actual: string } {
  if (locale === "ko") {
    return report.visualBaseline === "legacy-screenshot"
      ? { baseline: "레거시", actual: "이관 결과" }
      : { baseline: "Figma", actual: "브라우저" };
  }
  return report.visualBaseline === "legacy-screenshot"
    ? { baseline: "Legacy baseline", actual: "Target" }
    : { baseline: "Figma", actual: "Browser" };
}

function visualPreviewDescription(
  report: VisualPreviewReport,
  assets: PublishedReviewAsset[],
  locale: "ko" | "en",
): string {
  const hasDiff = assets.some((asset) => asset.role === "diff");
  if (report.visualBaseline === "legacy-screenshot") {
    return locale === "ko"
      ? `레거시 화면과 이관 결과를 같은 조건으로 비교했습니다.${hasDiff ? " 픽셀 차이 이미지도 함께 제공합니다." : ""}`
      : `The legacy baseline and migrated result were compared under the same conditions.${hasDiff ? " A pixel diff is also available." : ""}`;
  }

  return locale === "ko"
    ? `Figma 기준 화면과 브라우저 캡처를 같은 조건으로 비교했습니다.${hasDiff ? " 픽셀 차이 이미지도 함께 제공합니다." : ""}`
    : `The Figma baseline and browser capture were compared under the same conditions.${hasDiff ? " A pixel diff is also available." : ""}`;
}

function koreanVisualStatus(status: VisualPreviewResult["status"]): string {
  if (status === "passed") return "통과";
  if (status === "review-needed") return "검토 필요";
  return "실패";
}

function isKoreanReportBody(body: string): boolean {
  return body.startsWith("# 요약") || body.includes("\n## 실행 메타데이터");
}

function imageCell(
  asset: PublishedReviewAsset | undefined,
  altPrefix: string,
  targetName: string,
): string {
  if (asset === undefined) {
    return "-";
  }

  // Non-embeddable assets (e.g. private GitHub raw URLs) render as a plain link
  // so the review body never shows a broken image.
  if (asset.embeddable === false) {
    return `[${escapeMarkdownTableCell(`${altPrefix} · ${targetName} ↗`)}](${asset.url})`;
  }

  return `<img src="${escapeHtmlAttribute(asset.url)}" alt="${escapeHtmlAttribute(`${altPrefix} · ${targetName}`)}" width="260" />`;
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === "image/jpeg") return ".jpg";
  if (mediaType === "image/webp") return ".webp";

  return ".png";
}

function safePathSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

  return safe === "" ? "item" : safe;
}

function escapeMarkdownTableCell(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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
  const preparationDetails =
    input.error instanceof PublishPreparationError ? input.error.details : undefined;
  const synchronizationDetails =
    input.error instanceof ReviewRequestSynchronizationError ? input.error : undefined;
  const partialReasons =
    synchronizationDetails === undefined
      ? (preparationDetails?.partialReasons ?? [publishFailureReason(message)])
      : [
          `review request ${synchronizationDetails.phase} synchronization failed after host mutation: ${message}`,
        ];

  return PublishResultSchema.parse({
    runId: input.runId,
    status: "failed",
    target: input.target,
    ...(synchronizationDetails === undefined ? {} : { request: synchronizationDetails.request }),
    reportArtifactId: input.reportArtifactId,
    requestSynced: false,
    visualPreviewExpected: preparationDetails?.visualPreviewExpected ?? false,
    visualPreviewSynced: false,
    featureVideoExpected: preparationDetails?.featureVideoExpected ?? false,
    featureVideoSynced: false,
    fallbackMode: "none",
    partialReasons,
    errorCode: synchronizationDetails === undefined ? "PUBLISH_FAILED" : "PUBLISH_PARTIAL_SYNC",
    errorMessage: message,
    retryable: synchronizationDetails?.phase !== "reviewers",
    publishedAt: input.publishedAt,
  });
}

function defaultTitle(runId: string): string {
  return `spec-to-pr evidence report for ${runId}`;
}

function blockedTitle(runId: string): string {
  return `[Blocked] SpecToPR Run ${runId}`;
}

function publishTitle(input: { runId: string; intent: PublishIntent; title?: string }): string {
  return input.intent === "blocked-diagnostic"
    ? blockedTitle(input.runId)
    : (input.title ?? defaultTitle(input.runId));
}

function publishLabels(labels: string[], intent: PublishIntent): string[] {
  const readyLabels = labels.filter((label) => label !== "spec-to-pr:blocked");
  const synchronized = [...new Set(["spec-to-pr", ...readyLabels])];

  return intent === "blocked-diagnostic" ? [...synchronized, "spec-to-pr:blocked"] : synchronized;
}

function reviewRequestUpdateFromPayload(
  payload: ReviewRequestPayload,
): Pick<ReviewRequestPayload, "title" | "body" | "labels"> {
  return {
    title: payload.title,
    body: payload.body,
    labels: payload.labels,
  };
}

type ReportMetadataState = {
  valid: boolean;
  reportIntent?: WorkflowReportIntent;
  reportDecision?: ReportDecision;
};

function reportMetadataFromArtifact(artifact: ArtifactRef): ReportMetadataState {
  const reportIntent = WorkflowReportIntentSchema.safeParse(artifact.metadata["reportIntent"]);
  const reportDecision = ReportDecisionSchema.safeParse(artifact.metadata["decision"]);
  const combined = WorkflowReportMetadataSchema.safeParse({
    reportKind: artifact.metadata["reportKind"],
    reportIntent: artifact.metadata["reportIntent"],
    decision: artifact.metadata["decision"],
  });

  return {
    valid: combined.success,
    ...(reportIntent.success ? { reportIntent: reportIntent.data } : {}),
    ...(reportDecision.success ? { reportDecision: reportDecision.data } : {}),
  };
}

function reportMatchesPublishIntent(input: {
  reportMetadataValid: boolean;
  reportDecision: ReportDecision | undefined;
  reportIntent: WorkflowReportIntent | undefined;
  publishIntent: PublishIntent;
}): boolean {
  if (!input.reportMetadataValid) return false;

  if (input.publishIntent === "blocked-diagnostic") {
    return input.reportIntent === "blocked-diagnostic" && input.reportDecision === "blocked";
  }

  return input.reportIntent === "ready" && input.reportDecision !== "blocked";
}

function buildPlanWarnings(input: {
  payload: ReviewRequestPayload;
  reportMetadataValid: boolean;
  reportDecision: ReportDecision | undefined;
  reportIntent: WorkflowReportIntent | undefined;
  publishIntent: PublishIntent;
}): string[] {
  const warnings: string[] = [];

  if (!input.reportMetadataValid) {
    warnings.push(
      `Report metadata is invalid: ${reportMetadataDescription(input)}. Publication is disabled.`,
    );
  } else if (
    !reportMatchesPublishIntent({
      reportMetadataValid: input.reportMetadataValid,
      reportDecision: input.reportDecision,
      reportIntent: input.reportIntent,
      publishIntent: input.publishIntent,
    })
  ) {
    warnings.push(
      `Report ${reportMetadataDescription(input)} cannot be published with intent ${input.publishIntent}.`,
    );
  } else if (input.publishIntent === "blocked-diagnostic") {
    warnings.push(
      "Publishing a blocked diagnostic draft does not change the blocked workflow status.",
    );
  } else if (input.reportDecision !== "ready") {
    warnings.push(`Report decision is ${input.reportDecision}. Publish only as a draft.`);
  }

  if (input.payload.body.length > 60_000) {
    warnings.push("PR/MR body is very large. Host may truncate or reject it.");
  }

  return warnings;
}

function reportMetadataDescription(input: {
  reportIntent: WorkflowReportIntent | undefined;
  reportDecision: ReportDecision | undefined;
}): string {
  return `intent ${input.reportIntent ?? "unknown"} and decision ${input.reportDecision ?? "unknown"}`;
}

function findingCount(review: Record<string, unknown>): number {
  const findings = review["findings"];

  return Array.isArray(findings) ? findings.length : 0;
}

function blockedPublishResult(input: {
  runId: string;
  target: PublishTarget;
  reportArtifactId: string;
  intent: PublishIntent;
  reportMetadataValid: boolean;
  reportIntent?: WorkflowReportIntent;
  reportDecision?: ReportDecision;
  publishedAt: string;
}): PublishResult {
  const metadataDescription = reportMetadataDescription({
    reportIntent: input.reportIntent,
    reportDecision: input.reportDecision,
  });
  const reportIsBlockedForReadyPublish =
    input.reportMetadataValid && input.intent === "ready" && input.reportDecision === "blocked";
  const errorCode = !input.reportMetadataValid
    ? "PUBLISH_REPORT_METADATA_INVALID"
    : reportIsBlockedForReadyPublish
      ? "PUBLISH_BLOCKED"
      : "PUBLISH_INTENT_MISMATCH";
  const errorMessage = !input.reportMetadataValid
    ? `Report metadata is invalid: ${metadataDescription}. Publication is disabled.`
    : reportIsBlockedForReadyPublish
      ? "Report decision is blocked. Finish required gates or regenerate the report after resolving blockers."
      : `Publish intent ${input.intent} is incompatible with report ${metadataDescription}.`;

  return PublishResultSchema.parse({
    runId: input.runId,
    status: "blocked",
    target: input.target,
    reportArtifactId: input.reportArtifactId,
    requestSynced: false,
    visualPreviewExpected: false,
    visualPreviewSynced: false,
    featureVideoExpected: false,
    featureVideoSynced: false,
    fallbackMode: "none",
    partialReasons: [errorMessage],
    errorCode,
    errorMessage,
    retryable: false,
    publishedAt: input.publishedAt,
  });
}

function noDeltaPublishResult(input: {
  runId: string;
  target: PublishTarget;
  reportArtifactId: string;
  sourceBranch: string;
  targetBranch: string;
  publishedAt: string;
}): PublishResult {
  const message = `No committed delta exists on ${input.sourceBranch} beyond ${input.targetBranch}; no review request was created or updated.`;

  return PublishResultSchema.parse({
    runId: input.runId,
    status: "blocked",
    target: input.target,
    reportArtifactId: input.reportArtifactId,
    requestSynced: false,
    visualPreviewExpected: false,
    visualPreviewSynced: false,
    featureVideoExpected: false,
    featureVideoSynced: false,
    fallbackMode: "none",
    partialReasons: [message],
    errorCode: "PUBLISH_NO_DELTA",
    errorMessage: message,
    retryable: false,
    publishedAt: input.publishedAt,
  });
}

function publisherAuthHint(host: PublishTarget["host"]): string {
  return host === "github"
    ? "GITHUB_TOKEN or GH_TOKEN, or gh auth token"
    : "GITLAB_TOKEN or GITLAB_PRIVATE_TOKEN, or glab auth token";
}

function publishFailureReason(message: string): string {
  if (/token is not configured|auth token|authenticate/i.test(message)) {
    return `publisher token missing: ${message}`;
  }

  return `body sync failed: ${message}`;
}

function publishResultIsFullySynced(result: PublishResult): boolean {
  return (
    result.status === "passed" &&
    result.requestSynced &&
    result.request?.draft === true &&
    (!result.visualPreviewExpected || result.visualPreviewSynced) &&
    (!result.featureVideoExpected || result.featureVideoSynced) &&
    result.partialReasons.length === 0
  );
}
