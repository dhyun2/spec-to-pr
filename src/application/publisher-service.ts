import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import {
  NoopRuntimeMetrics,
  type RuntimeMetricsSink,
} from "../runtime/performance-instrumentation.js";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  ReviewAssetUploadReceiptSchema,
  reviewAssetUploadReceiptArtifactId,
  reviewAssetUploadReceiptIdentity,
  reviewAssetUploadTargetKey,
  type ReviewAssetUploadReceipt,
} from "../publisher/asset-upload-receipt.js";
import {
  detectPublishTargetFromRemote,
  canUseGitLabRawEvidenceFallback,
  GitLabAssetUploadError,
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
  type ReviewAssetPublishOutcome,
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
  PrReportV2Schema,
  WorkflowReportMetadataSchema,
  WorkflowReportIntentSchema,
  assertCurrentPrReportV2,
  type PrReportV2,
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
import {
  ImplementationReviewPacketSchema,
  isSafeDurableEvidencePath,
} from "../workflow/workflow-contracts.js";
import { assertWorkspaceFresh } from "../workspace/workspace-binding.js";

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

type PublicationVisualTarget = {
  attempt: number;
  targetId: string;
  name: string;
  route: string;
  state: string;
  fixture: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  status: "passed" | "failed";
  metrics: {
    reviewMatchRatio: number;
    exactMatchRatio: number;
    maskedAreaRatio: number;
    threshold: number;
  };
  baselineArtifactId: string;
  actualArtifactId: string;
  diffArtifactId?: string;
  overlayArtifactId?: string;
};

type VisualPreviewReport = Omit<VisualReport, "results"> & {
  results: VisualPreviewResult[];
  publicationTargets: PublicationVisualTarget[];
};

type PublicationReportBinding = {
  report: PrReportV2;
  jsonArtifact: ArtifactRef;
  reviewPacketId?: string;
  headSha?: string;
  diffDigest?: string;
  visualReportArtifact?: ArtifactRef;
};

type PublicationExecutionFence = {
  runRevision: number;
  runSemanticDigest: `sha256:${string}`;
  reportArtifactId: string;
  reportDigest: string;
  reviewPacketId?: string;
  headSha?: string;
  diffDigest?: string;
  sourceBranch: string;
  targetBranch: string;
  remoteName: string;
  remoteTargetKey: string;
  credentialSource: "env" | "cli";
  cleanStatusDigest: `sha256:${string}`;
};

type ReceiptPublishedAsset = {
  asset: PublishedReviewAsset;
  receiptArtifactId: string;
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
  reviewPacketId: z
    .string()
    .regex(/^packet_[a-f0-9]{64}$/)
    .optional(),
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
  private readonly git: GitCommandRunner;

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
    git: GitCommandRunner = defaultGitCommandRunner,
    private readonly metrics: RuntimeMetricsSink = new NoopRuntimeMetrics(),
  ) {
    this.git = async (cwd, args, options) => {
      this.metrics.increment("git.command_count");
      const result = await git(cwd, args, options);
      if (args[0] === "diff" && args.includes("--binary")) {
        this.metrics.increment("git.binary_diff_bytes", Buffer.byteLength(result.stdout));
      }
      return result;
    };
  }

  public async detectTarget(rawInput: unknown) {
    const input = DetectPublishTargetInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    if (run.workspaceBinding !== undefined) {
      await assertWorkspaceFresh(
        run.workspaceBinding,
        {
          sourceBranch: run.workspaceBinding.sourceBranch,
          targetBranch: run.workspaceBinding.targetBranch,
          remoteName: input.remoteName,
          ...(input.remoteUrl === undefined ? {} : { remoteUrl: input.remoteUrl }),
        },
        { git: (cwd, args) => this.git(cwd, args) },
      );
      const target = run.workspaceBinding.publicationTarget;
      if (input.host !== undefined && target.host !== input.host) {
        throw new Error(
          `Requested host ${input.host} but ${input.remoteName} remote is ${target.host}`,
        );
      }
      return DetectPublishTargetResultSchema.parse({
        run: summarizeRun(run),
        remoteName: run.workspaceBinding.remoteName,
        remoteUrl: run.workspaceBinding.remoteUrl,
        target,
      });
    }
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
    const reportArtifact = resolvePrReportArtifact(run.artifacts, input.reportArtifactId);
    const binding = await this.resolvePublicationReportBinding(run, reportArtifact, input.intent);
    if (run.workspaceBinding !== undefined) {
      await assertWorkspaceFresh(
        run.workspaceBinding,
        {
          sourceBranch: input.sourceBranch,
          targetBranch: input.targetBranch,
          remoteName: input.remoteName,
          ...(input.remoteUrl === undefined ? {} : { remoteUrl: input.remoteUrl }),
          ...(binding.headSha === undefined ? {} : { reviewedHeadSha: binding.headSha }),
        },
        {
          git: (cwd, args) => this.git(cwd, args),
          authProbe: async () => ({
            available: true,
            source: "deferred-to-authoritative-publication-fence",
          }),
        },
      );
    }
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const reportBody = (await this.artifactStore.readContent(reportArtifact.digest)).toString(
      "utf8",
    );
    const reportMetadata = reportMetadataFromArtifact(reportArtifact);
    const target =
      run.workspaceBinding?.publicationTarget ??
      ((
        await this.detectTarget({
          runId: input.runId,
          remoteName: input.remoteName,
          ...(input.remoteUrl === undefined ? {} : { remoteUrl: input.remoteUrl }),
          ...(input.host === undefined ? {} : { host: input.host }),
        })
      ).target as PublishTarget);
    if (input.host !== undefined && target.host !== input.host) {
      throw new Error(
        `Requested host ${input.host} but ${input.remoteName} remote is ${target.host}`,
      );
    }
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
      ...(binding.headSha === undefined ? {} : { headSha: binding.headSha }),
      ...(binding.reviewPacketId === undefined ? {} : { reviewPacketId: binding.reviewPacketId }),
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

    let branchState: Awaited<ReturnType<PublisherService["assertPublishBranchReady"]>>;
    try {
      branchState = await this.assertPublishBranchReady({
        projectRoot: publicationProjectRoot(run),
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        ...(plan.payload.headSha === undefined ? {} : { headSha: plan.payload.headSha }),
        workspaceValidated: run.workspaceBinding !== undefined,
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

    let credential: ReturnType<typeof readPublisherToken>;
    try {
      credential = readPublisherToken(plan.target.host, new URL(plan.target.webBaseUrl).hostname);
    } catch (error: unknown) {
      const result = failedPublishResult({
        runId: plan.runId,
        target: plan.target,
        reportArtifactId: plan.payload.reportArtifactId,
        error,
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
    const reportArtifact = requireArtifact(run.artifacts, plan.payload.reportArtifactId);
    const fenceRun = await this.assertPublicationBindingsCurrent(
      run,
      plan,
      reportArtifact,
      branchState.headSha,
    );
    const implementation = fenceRun.stages.find((stage) => stage.name === "implementation");
    const packet = ImplementationReviewPacketSchema.safeParse(
      implementation?.checkpoint?.data["reviewPacket"],
    );
    const fence: PublicationExecutionFence = {
      runRevision: fenceRun.revision,
      runSemanticDigest: publicationRunSemanticDigest(fenceRun),
      reportArtifactId: reportArtifact.id,
      reportDigest: reportArtifact.digest,
      ...(plan.payload.reviewPacketId === undefined
        ? {}
        : { reviewPacketId: plan.payload.reviewPacketId }),
      ...(branchState.headSha === undefined ? {} : { headSha: branchState.headSha }),
      ...(packet.success ? { diffDigest: packet.data.diffDigest } : {}),
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      remoteName: input.remoteName,
      remoteTargetKey: publicationRemoteTargetKey(plan.target),
      credentialSource: publisherCredentialSource(credential.source),
      cleanStatusDigest: branchState.cleanStatusDigest,
    };

    const result = await this.executePublish({
      run: fenceRun,
      plan,
      fence,
      token: credential.token,
      timestamp,
      pushBranch: input.pushBranch,
      remoteName: input.remoteName,
      signal: options.signal,
      credentialSource: publisherCredentialSource(credential.source),
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
      fence,
      plan,
      credentialSource: publisherCredentialSource(credential.source),
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

    const branchState = await this.assertPublishBranchReady({
      projectRoot: publicationProjectRoot(run),
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      ...(plan.payload.headSha === undefined ? {} : { headSha: plan.payload.headSha }),
      workspaceValidated: run.workspaceBinding !== undefined,
    });
    let credential: ReturnType<typeof readPublisherToken>;
    try {
      credential = readPublisherToken(plan.target.host, new URL(plan.target.webBaseUrl).hostname);
    } catch (error: unknown) {
      const result = failedPublishResult({
        runId: plan.runId,
        target: plan.target,
        reportArtifactId: plan.payload.reportArtifactId,
        error,
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
    const reportArtifact = requireArtifact(run.artifacts, plan.payload.reportArtifactId);
    const fenceRun = await this.assertPublicationBindingsCurrent(
      run,
      plan,
      reportArtifact,
      branchState.headSha,
    );
    const implementation = fenceRun.stages.find((stage) => stage.name === "implementation");
    const packet = ImplementationReviewPacketSchema.safeParse(
      implementation?.checkpoint?.data["reviewPacket"],
    );
    const credentialSource = publisherCredentialSource(credential.source);
    const fence: PublicationExecutionFence = {
      runRevision: fenceRun.revision,
      runSemanticDigest: publicationRunSemanticDigest(fenceRun),
      reportArtifactId: reportArtifact.id,
      reportDigest: reportArtifact.digest,
      ...(plan.payload.reviewPacketId === undefined
        ? {}
        : { reviewPacketId: plan.payload.reviewPacketId }),
      ...(branchState.headSha === undefined ? {} : { headSha: branchState.headSha }),
      ...(packet.success ? { diffDigest: packet.data.diffDigest } : {}),
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      remoteName: input.remoteName,
      remoteTargetKey: publicationRemoteTargetKey(plan.target),
      credentialSource,
      cleanStatusDigest: branchState.cleanStatusDigest,
    };

    const result = await this.executeUpdateBody({
      run: fenceRun,
      plan,
      fence,
      token: credential.token,
      remoteName: input.remoteName,
      credentialSource,
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
      fence,
      plan,
      credentialSource,
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

  private async resolvePublicationReportBinding(
    run: Awaited<ReturnType<RunStore["get"]>>,
    markdownArtifact: ArtifactRef,
    requestedIntent: PublishIntent,
  ): Promise<PublicationReportBinding> {
    const invalid = (message: string): never => {
      throw new Error(`PUBLISH_REPORT_BINDING_INVALID: ${message}`);
    };
    const reportJsonArtifactId = markdownArtifact.metadata["reportJsonArtifactId"];
    if (typeof reportJsonArtifactId !== "string") {
      return invalid("Markdown does not reference its canonical JSON artifact");
    }
    const jsonArtifact = run.artifacts.find((artifact) => artifact.id === reportJsonArtifactId);
    if (
      jsonArtifact === undefined ||
      jsonArtifact.kind !== "pr-report" ||
      jsonArtifact.mediaType !== "application/json" ||
      jsonArtifact.metadata["reportKind"] !== "pr-report-v2-json"
    ) {
      return invalid("the referenced canonical JSON artifact is missing or invalid");
    }

    let report: PrReportV2;
    try {
      report = PrReportV2Schema.parse(
        JSON.parse((await this.artifactStore.readContent(jsonArtifact.digest)).toString("utf8")),
      );
      assertCurrentPrReportV2(report);
    } catch (error: unknown) {
      return invalid(
        `the referenced canonical JSON cannot be validated: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (report.schemaVersion !== "pr-report-v2.1" || report.runId !== run.id) {
      return invalid("the canonical JSON is not current or belongs to another Run");
    }

    const markdownMetadata = reportMetadataFromArtifact(markdownArtifact);
    const expectedIntent = report.decision === "ready" ? "ready" : "blocked-diagnostic";
    if (!markdownMetadata.valid) {
      return invalid("Markdown report metadata is missing, malformed, or internally inconsistent");
    }
    if (
      markdownMetadata.reportDecision !== report.decision ||
      markdownMetadata.reportIntent !== expectedIntent
    ) {
      return invalid("Markdown intent or decision does not match the canonical JSON");
    }
    if (requestedIntent !== expectedIntent) {
      return invalid(
        `requested intent ${requestedIntent} does not match canonical intent ${expectedIntent}`,
      );
    }
    if (
      jsonArtifact.metadata["reportSchemaVersion"] !== report.schemaVersion ||
      jsonArtifact.metadata["decision"] !== report.decision
    ) {
      return invalid("canonical JSON artifact metadata does not match its content");
    }

    if (report.binding === undefined) {
      if (report.visual.reportArtifactId !== undefined) {
        return invalid("packetless reports cannot reference visual media");
      }
      return { report, jsonArtifact };
    }

    const binding = report.binding;
    for (const artifact of [markdownArtifact, jsonArtifact]) {
      if (
        artifact.metadata["reviewPacketId"] !== binding.reviewPacketId ||
        artifact.metadata["headSha"] !== binding.headSha ||
        artifact.metadata["diffDigest"] !== binding.diffDigest
      ) {
        return invalid(`artifact ${artifact.id} metadata crosses the canonical packet binding`);
      }
    }

    let visualReportArtifact: ArtifactRef | undefined;
    if (report.visual.reportArtifactId !== undefined) {
      visualReportArtifact = run.artifacts.find(
        (artifact) => artifact.id === report.visual.reportArtifactId,
      );
      if (
        visualReportArtifact === undefined ||
        visualReportArtifact.kind !== "visual-report" ||
        visualReportArtifact.metadata["reviewPacketId"] !== binding.reviewPacketId ||
        visualReportArtifact.metadata["headSha"] !== binding.headSha ||
        visualReportArtifact.metadata["diffDigest"] !== binding.diffDigest
      ) {
        return invalid("the exact visual report artifact crosses the canonical packet binding");
      }
      if (
        markdownArtifact.metadata["visualReportArtifactId"] !== visualReportArtifact.id ||
        jsonArtifact.metadata["visualReportArtifactId"] !== visualReportArtifact.id
      ) {
        return invalid("report artifact metadata does not name the exact visual report");
      }

      let rawVisual: Record<string, unknown>;
      try {
        const raw = JSON.parse(
          (await this.artifactStore.readContent(visualReportArtifact.digest)).toString("utf8"),
        ) as unknown;
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
          return invalid("the exact visual report content is not an object");
        }
        rawVisual = raw as Record<string, unknown>;
      } catch (error: unknown) {
        return invalid(
          `the exact visual report cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (rawVisual["runId"] !== run.id) {
        return invalid("the exact visual report belongs to another Run");
      }
      if (
        rawVisual["reviewPacketId"] !== binding.reviewPacketId ||
        rawVisual["headSha"] !== binding.headSha ||
        rawVisual["diffDigest"] !== binding.diffDigest
      ) {
        return invalid("the exact visual report content crosses the canonical packet binding");
      }
    }

    const implementation = run.stages.find((candidate) => candidate.name === "implementation");
    if (implementation?.error?.code === "VISUAL_REVIEW_THRESHOLD_NOT_MET") {
      const checkpoint = implementation.checkpoint;
      const checkpointPacket =
        typeof checkpoint?.data["reviewPacket"] === "object" &&
        checkpoint.data["reviewPacket"] !== null
          ? (checkpoint.data["reviewPacket"] as Record<string, unknown>)
          : undefined;
      if (
        visualReportArtifact === undefined ||
        checkpoint?.name !== "visual-threshold-not-met" ||
        checkpoint.data["visualReportArtifactId"] !== visualReportArtifact.id ||
        checkpoint.data["visualReportDigest"] !== visualReportArtifact.digest ||
        checkpointPacket?.["id"] !== binding.reviewPacketId ||
        checkpointPacket["headSha"] !== binding.headSha ||
        checkpointPacket["diffDigest"] !== binding.diffDigest
      ) {
        return invalid("terminal visual blocker does not bind the persisted checkpoint report");
      }
    }

    return {
      report,
      jsonArtifact,
      reviewPacketId: binding.reviewPacketId,
      headSha: binding.headSha,
      diffDigest: binding.diffDigest,
      ...(visualReportArtifact === undefined ? {} : { visualReportArtifact }),
    };
  }

  private async assertPublishBranchReady(input: {
    projectRoot: string;
    sourceBranch: string;
    targetBranch: string;
    headSha?: string;
    workspaceValidated?: boolean;
  }): Promise<{ headSha?: string; cleanStatusDigest: `sha256:${string}` }> {
    let checkedOutHead = input.headSha;
    let status = "";
    if (!input.workspaceValidated) {
      status = (await this.git(input.projectRoot, ["status", "--porcelain"])).stdout.trim();
    }
    if (status.length > 0) {
      throw new Error(
        "Draft publication requires a clean working tree; commit the intended implementation changes first",
      );
    }

    if (!input.workspaceValidated) {
      const checkedOutBranch = (
        await this.git(input.projectRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"])
      ).stdout.trim();
      if (checkedOutBranch !== input.sourceBranch) {
        throw new Error(
          `Draft publication requires checked-out branch ${input.sourceBranch}; found ${checkedOutBranch || "detached HEAD"}`,
        );
      }

      checkedOutHead = (
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
    return {
      ...(checkedOutHead === undefined ? {} : { headSha: checkedOutHead }),
      cleanStatusDigest: `sha256:${createHash("sha256").update(status).digest("hex")}`,
    };
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

  private async assertPublicationBindingsCurrent(
    sourceRun: Awaited<ReturnType<RunStore["get"]>>,
    plan: z.infer<typeof PublishPlanSchema>,
    reportArtifact: ArtifactRef,
    headSha: string | undefined,
  ): Promise<Awaited<ReturnType<RunStore["get"]>>> {
    const current = await this.runStore.get(plan.runId);
    const report = current.artifacts.find(
      (artifact) => artifact.id === reportArtifact.id && artifact.digest === reportArtifact.digest,
    );
    if (
      publicationRunSemanticDigest(current) !== publicationRunSemanticDigest(sourceRun) ||
      report === undefined
    ) {
      throw new Error("PUBLISH_EXECUTION_FENCE_STALE: Run or report binding changed");
    }
    if (plan.payload.reviewPacketId !== undefined) {
      const implementation = current.stages.find((stage) => stage.name === "implementation");
      const packet = ImplementationReviewPacketSchema.safeParse(
        implementation?.checkpoint?.data["reviewPacket"],
      );
      if (
        !packet.success ||
        packet.data.id !== plan.payload.reviewPacketId ||
        packet.data.headSha !== headSha
      ) {
        throw new Error("PUBLISH_EXECUTION_FENCE_STALE: review packet or head binding changed");
      }
    }
    return current;
  }

  private async assertPublicationExecutionFenceCurrent(input: {
    plan: z.infer<typeof PublishPlanSchema>;
    fence: PublicationExecutionFence;
    remoteName: string;
    credentialSource: "env" | "cli";
  }) {
    assertPublicationFenceMatchesPlan(
      input.fence,
      input.plan,
      input.remoteName,
      input.credentialSource,
    );
    const current = await this.runStore.get(input.plan.runId);
    assertPublicationRunMatchesFence(current, input.fence, input.plan);
    return current;
  }

  private async assertPublicationGitFenceCurrent(input: {
    run: Awaited<ReturnType<RunStore["get"]>>;
    plan: z.infer<typeof PublishPlanSchema>;
    fence: PublicationExecutionFence;
    remoteName: string;
  }): Promise<void> {
    const branchState = await this.assertPublishBranchReady({
      projectRoot: publicationProjectRoot(input.run),
      sourceBranch: input.fence.sourceBranch,
      targetBranch: input.fence.targetBranch,
      ...(input.fence.headSha === undefined ? {} : { headSha: input.fence.headSha }),
      workspaceValidated: input.run.workspaceBinding !== undefined,
    });
    if (
      branchState.headSha !== input.fence.headSha ||
      branchState.cleanStatusDigest !== input.fence.cleanStatusDigest
    ) {
      throw new Error("PUBLISH_EXECUTION_FENCE_STALE: Git head or clean status changed");
    }

    if (input.run.workspaceBinding !== undefined) {
      await assertWorkspaceFresh(
        input.run.workspaceBinding,
        {
          sourceBranch: input.fence.sourceBranch,
          targetBranch: input.fence.targetBranch,
          remoteName: input.remoteName,
          ...(input.fence.headSha === undefined ? {} : { reviewedHeadSha: input.fence.headSha }),
        },
        {
          git: (cwd, args) => this.git(cwd, args),
          authProbe: async () => ({
            available: true,
            source: "validated-by-publication-credential-fence",
          }),
        },
      );
      return;
    }

    const remoteUrl = (
      await this.git(publicationProjectRoot(input.run), ["remote", "get-url", input.remoteName])
    ).stdout.trim();
    const currentTarget = detectPublishTargetFromRemote({
      name: input.remoteName,
      url: remoteUrl,
    });
    if (publicationRemoteTargetKey(currentTarget) !== input.fence.remoteTargetKey) {
      throw new Error("PUBLISH_EXECUTION_FENCE_STALE: publication remote target changed");
    }
  }

  private async assertPublicationFenceCurrent(input: {
    plan: z.infer<typeof PublishPlanSchema>;
    fence: PublicationExecutionFence;
    remoteName: string;
    credentialSource: "env" | "cli";
  }) {
    const run = await this.assertPublicationExecutionFenceCurrent(input);
    await this.assertPublicationGitFenceCurrent({
      run,
      plan: input.plan,
      fence: input.fence,
      remoteName: input.remoteName,
    });
    return run;
  }

  private async executePublish(input: {
    run: Awaited<ReturnType<RunStore["get"]>>;
    plan: z.infer<typeof PublishPlanSchema>;
    fence: PublicationExecutionFence;
    token: string;
    timestamp: string;
    pushBranch: boolean;
    remoteName: string;
    signal: AbortSignal | undefined;
    credentialSource: "env" | "cli";
  }): Promise<PublishResult> {
    try {
      this.metrics.increment("publisher.http_count", 1, { host: input.plan.target.host });
      input.signal?.throwIfAborted();
      assertPublicationFenceMatchesPlan(
        input.fence,
        input.plan,
        input.remoteName,
        input.credentialSource,
      );
      await this.assertPublicationFenceCurrent(input);

      if (input.pushBranch) {
        await this.git(publicationProjectRoot(input.run), [
          "push",
          "--set-upstream",
          input.remoteName,
          ...(input.fence.headSha === undefined
            ? [input.plan.payload.sourceBranch]
            : [`${input.fence.headSha}:refs/heads/${input.plan.payload.sourceBranch}`]),
        ]);
      }
      input.signal?.throwIfAborted();

      const publisher = this.publishers[input.plan.target.host];
      const prepared = await this.preparePayloadForPublish({
        run: input.run,
        plan: input.plan,
        publisher,
        token: input.token,
        timestamp: input.timestamp,
        signal: input.signal,
        assertFenceCurrent: async () => {
          await this.assertPublicationFenceCurrent(input);
        },
      });
      try {
        assertPublishedAssetUrlsInBody(prepared.payload.body, prepared.publishedAssets);
      } catch (error: unknown) {
        return partialAssetPublishResult({
          runId: input.plan.runId,
          target: input.plan.target,
          reportArtifactId: input.plan.payload.reportArtifactId,
          prepared,
          partialReasons: [
            ...prepared.partialReasons,
            error instanceof Error ? error.message : "PUBLISH_ASSET_BODY_SYNC_INCOMPLETE",
          ],
          retryable: false,
          publishedAt: input.timestamp,
        });
      }
      const existing = await publisher.findExisting({
        target: input.plan.target,
        payload: prepared.payload,
        token: input.token,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (existing !== undefined && !existing.draft) {
        throw new Error(`Refusing to update non-draft review request ${existing.number}`);
      }
      await this.assertPublicationFenceCurrent(input);
      const request =
        existing === undefined
          ? await publisher.create({
              target: input.plan.target,
              payload: prepared.payload,
              token: input.token,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            })
          : await publisher.update({
              target: input.plan.target,
              requestNumber: existing.number,
              update: reviewRequestUpdateFromPayload(prepared.payload),
              token: input.token,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            });
      if (!request.draft) {
        throw new Error(`Review request ${request.number} is not a draft after publication`);
      }
      if (prepared.publishedAssets.length > 0) {
        try {
          if (publisher.readBody === undefined) {
            throw new Error("PUBLISH_ASSET_BODY_SYNC_UNVERIFIED");
          }
          const remoteBody = await publisher.readBody({
            target: input.plan.target,
            requestNumber: request.number,
            token: input.token,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          });
          assertPublishedAssetUrlsInBody(remoteBody, prepared.publishedAssets);
        } catch (error: unknown) {
          return partialAssetPublishResult({
            runId: input.plan.runId,
            target: input.plan.target,
            request,
            reportArtifactId: input.plan.payload.reportArtifactId,
            prepared,
            partialReasons: [
              ...prepared.partialReasons,
              error instanceof Error ? error.message : "PUBLISH_ASSET_BODY_SYNC_UNVERIFIED",
            ],
            retryable: true,
            publishedAt: input.timestamp,
          });
        }
      }
      if (!prepared.assetUploadComplete) {
        return partialAssetPublishResult({
          runId: input.plan.runId,
          target: input.plan.target,
          request,
          reportArtifactId: input.plan.payload.reportArtifactId,
          prepared,
          partialReasons: prepared.partialReasons,
          retryable: prepared.assetUploadRetryable,
          publishedAt: input.timestamp,
        });
      }

      return PublishResultSchema.parse({
        runId: input.plan.runId,
        status: input.plan.intent === "blocked-diagnostic" ? "blocked" : "passed",
        target: input.plan.target,
        request,
        reportArtifactId: input.plan.payload.reportArtifactId,
        publishedAssets: prepared.publishedAssets,
        uploadReceiptArtifactIds: prepared.uploadReceiptArtifactIds,
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
    run: Awaited<ReturnType<RunStore["get"]>>;
    plan: z.infer<typeof PublishPlanSchema>;
    fence: PublicationExecutionFence;
    token: string;
    remoteName: string;
    credentialSource: "env" | "cli";
    requestNumber: string;
    timestamp: string;
    signal: AbortSignal | undefined;
  }): Promise<PublishResult> {
    try {
      this.metrics.increment("publisher.http_count", 1, { host: input.plan.target.host });
      input.signal?.throwIfAborted();
      assertPublicationFenceMatchesPlan(
        input.fence,
        input.plan,
        input.remoteName,
        input.credentialSource,
      );
      await this.assertPublicationFenceCurrent(input);
      const publisher = this.publishers[input.plan.target.host];
      const prepared = await this.preparePayloadForPublish({
        run: input.run,
        plan: input.plan,
        publisher,
        token: input.token,
        timestamp: input.timestamp,
        signal: input.signal,
        assertFenceCurrent: async () => {
          await this.assertPublicationFenceCurrent(input);
        },
      });
      try {
        assertPublishedAssetUrlsInBody(prepared.payload.body, prepared.publishedAssets);
      } catch (error: unknown) {
        return partialAssetPublishResult({
          runId: input.plan.runId,
          target: input.plan.target,
          reportArtifactId: input.plan.payload.reportArtifactId,
          prepared,
          partialReasons: [
            ...prepared.partialReasons,
            error instanceof Error ? error.message : "PUBLISH_ASSET_BODY_SYNC_INCOMPLETE",
          ],
          retryable: false,
          publishedAt: input.timestamp,
        });
      }
      const existing = await publisher.findExisting({
        target: input.plan.target,
        payload: prepared.payload,
        token: input.token,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (existing === undefined || existing.number !== input.requestNumber) {
        throw new Error(`Draft review request ${input.requestNumber} could not be verified`);
      }
      if (!existing.draft) {
        throw new Error(`Refusing to update non-draft review request ${existing.number}`);
      }
      await this.assertPublicationFenceCurrent(input);
      const request = await publisher.update({
        target: input.plan.target,
        requestNumber: input.requestNumber,
        update: reviewRequestUpdateFromPayload(prepared.payload),
        token: input.token,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (!request.draft) {
        throw new Error(`Review request ${request.number} is not a draft after body update`);
      }
      if (prepared.publishedAssets.length > 0) {
        try {
          if (publisher.readBody === undefined) {
            throw new Error("PUBLISH_ASSET_BODY_SYNC_UNVERIFIED");
          }
          const remoteBody = await publisher.readBody({
            target: input.plan.target,
            requestNumber: request.number,
            token: input.token,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          });
          assertPublishedAssetUrlsInBody(remoteBody, prepared.publishedAssets);
        } catch (error: unknown) {
          return partialAssetPublishResult({
            runId: input.plan.runId,
            target: input.plan.target,
            request,
            reportArtifactId: input.plan.payload.reportArtifactId,
            prepared,
            partialReasons: [
              ...prepared.partialReasons,
              error instanceof Error ? error.message : "PUBLISH_ASSET_BODY_SYNC_UNVERIFIED",
            ],
            retryable: true,
            publishedAt: input.timestamp,
          });
        }
      }
      if (!prepared.assetUploadComplete) {
        return partialAssetPublishResult({
          runId: input.plan.runId,
          target: input.plan.target,
          request,
          reportArtifactId: input.plan.payload.reportArtifactId,
          prepared,
          partialReasons: prepared.partialReasons,
          retryable: prepared.assetUploadRetryable,
          publishedAt: input.timestamp,
        });
      }

      return PublishResultSchema.parse({
        runId: input.plan.runId,
        status: input.plan.intent === "blocked-diagnostic" ? "blocked" : "passed",
        target: input.plan.target,
        request,
        reportArtifactId: input.plan.payload.reportArtifactId,
        publishedAssets: prepared.publishedAssets,
        uploadReceiptArtifactIds: prepared.uploadReceiptArtifactIds,
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
    timestamp: string;
    signal: AbortSignal | undefined;
    assertFenceCurrent?: (() => Promise<void>) | undefined;
  }): Promise<{
    payload: ReviewRequestPayload;
    publishedAssets: PublishedReviewAsset[];
    uploadReceiptArtifactIds: string[];
    assetUploadComplete: boolean;
    assetUploadRetryable: boolean;
    visualPreviewExpected: boolean;
    visualPreviewSynced: boolean;
    featureVideoExpected: boolean;
    featureVideoSynced: boolean;
    fallbackMode: "none" | "gitlab-raw-evidence";
    fallbackReason?: string;
    partialReasons: string[];
  }> {
    const visualPreview = await this.collectVisualPreviewAssets(
      input.run,
      input.plan.payload,
      input.plan.intent,
    );
    const featureVideo = await this.collectFeatureVideoAsset(input.run, input.plan.payload);
    const assets = [...visualPreview.assets, ...(featureVideo === undefined ? [] : [featureVideo])];
    const visualPreviewExpected =
      visualPreview.assets.length > 0 && visualPreview.report !== undefined;
    const featureVideoExpected = featureVideo !== undefined;

    if (assets.length === 0) {
      return {
        payload: input.plan.payload,
        publishedAssets: [],
        uploadReceiptArtifactIds: [],
        assetUploadComplete: true,
        assetUploadRetryable: false,
        visualPreviewExpected: false,
        visualPreviewSynced: false,
        featureVideoExpected: false,
        featureVideoSynced: false,
        fallbackMode: "none",
        partialReasons: [],
      };
    }

    const receiptAssets = await this.loadPublishedAssetsFromReceipts({
      run: input.run,
      target: input.plan.target,
      payload: input.plan.payload,
      assets,
      timestamp: input.timestamp,
    });
    const publishedByKey = new Map(
      receiptAssets.map((entry) => [reviewAssetKey(entry.asset), entry]),
    );
    let missingAssets = assets.filter((asset) => !publishedByKey.has(reviewAssetKey(asset)));
    let fallbackMode: "none" | "gitlab-raw-evidence" = "none";
    let fallbackReason: string | undefined;
    const partialReasons: string[] = [];
    let terminalFailure: Extract<ReviewAssetPublishOutcome, { status: "failed" }> | undefined;
    let lastTransientFailures: Array<Extract<ReviewAssetPublishOutcome, { status: "failed" }>> = [];
    let thrownUploadError: unknown;

    for (let attempt = 1; attempt <= 3 && missingAssets.length > 0; attempt += 1) {
      if (attempt > 1) {
        this.metrics.increment("publisher.retry_count", 1, { host: input.plan.target.host });
      }
      let outcomes: ReviewAssetPublishOutcome[];
      try {
        await input.assertFenceCurrent?.();
        outcomes = await input.publisher.publishAssets({
          target: input.plan.target,
          payload: input.plan.payload,
          token: input.token,
          assets: missingAssets,
          maxConcurrency: 3,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
      } catch (error: unknown) {
        thrownUploadError = error;
        break;
      }
      await input.assertFenceCurrent?.();
      const settled = settleAssetPublishOutcomes(missingAssets, outcomes);
      const newlyPublished = settled
        .filter(
          (outcome): outcome is Extract<ReviewAssetPublishOutcome, { status: "published" }> =>
            outcome.status === "published",
        )
        .map((outcome) => outcome.asset);
      const newReceipts = await this.persistAssetUploadReceipts({
        runId: input.plan.runId,
        target: input.plan.target,
        payload: input.plan.payload,
        assets: missingAssets,
        publishedAssets: newlyPublished,
        timestamp: input.timestamp,
      });
      for (const receiptAsset of newReceipts) {
        publishedByKey.set(reviewAssetKey(receiptAsset.asset), receiptAsset);
      }

      const failures = settled.filter(
        (outcome): outcome is Extract<ReviewAssetPublishOutcome, { status: "failed" }> =>
          outcome.status === "failed",
      );
      terminalFailure = failures.find(
        (outcome) => outcome.failure === "permanent" || outcome.failure === "uncertain",
      );
      lastTransientFailures = failures.filter((outcome) => outcome.failure === "transient");
      if (terminalFailure !== undefined) break;
      missingAssets = missingAssets.filter((asset) =>
        lastTransientFailures.some((failure) => failure.artifactId === asset.artifactId),
      );
    }

    let publishedAssets = assets.flatMap((asset) => {
      const entry = publishedByKey.get(reviewAssetKey(asset));
      return entry === undefined ? [] : [entry.asset];
    });
    let assetUploadComplete = publishedAssets.length === assets.length;
    let assetUploadRetryable =
      !assetUploadComplete && terminalFailure === undefined && thrownUploadError === undefined;

    if (!assetUploadComplete) {
      const fallbackError =
        thrownUploadError ??
        (terminalFailure?.status === "failed" && terminalFailure.failure !== "permanent"
          ? new GitLabAssetUploadError(terminalFailure.message)
          : lastTransientFailures[0]?.status === "failed"
            ? new GitLabAssetUploadError(lastTransientFailures[0].message, 503)
            : undefined);
      const rawFallback = await this.tryGitLabRawVisualFallback({
        run: input.run,
        target: input.plan.target,
        payload: input.plan.payload,
        visualPreview,
        featureVideo,
        error: fallbackError,
      });
      if (rawFallback !== undefined) {
        publishedAssets = rawFallback;
        fallbackMode = "gitlab-raw-evidence";
        fallbackReason =
          "GitLab review-asset upload failed; used immutable raw visual evidence instead";
        assetUploadComplete = true;
        assetUploadRetryable = false;
      } else {
        const label = visualPreviewExpected ? "visual evidence" : "feature video";
        const failureMessage =
          terminalFailure?.status === "failed"
            ? terminalFailure.message
            : lastTransientFailures[0]?.status === "failed"
              ? lastTransientFailures[0].message
              : thrownUploadError instanceof Error
                ? redactSecrets(thrownUploadError.message)
                : "upload outcome was uncertain";
        partialReasons.push(
          `${label} upload incomplete: ${publishedAssets.length}/${assets.length} asset(s) confirmed; ${failureMessage}`,
        );
      }
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
      uploadReceiptArtifactIds: assets.flatMap((asset) => {
        const entry = publishedByKey.get(reviewAssetKey(asset));
        return entry === undefined ? [] : [entry.receiptArtifactId];
      }),
      assetUploadComplete,
      assetUploadRetryable,
      visualPreviewExpected,
      visualPreviewSynced:
        visualPreviewExpected &&
        (fallbackMode === "gitlab-raw-evidence" ||
          visualPreview.assets.every((asset) => publishedByKey.has(reviewAssetKey(asset)))),
      featureVideoExpected,
      featureVideoSynced:
        featureVideoExpected &&
        featureVideo !== undefined &&
        publishedByKey.has(reviewAssetKey(featureVideo)),
      fallbackMode,
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      partialReasons,
    };
  }

  private async loadPublishedAssetsFromReceipts(input: {
    run: Awaited<ReturnType<RunStore["get"]>>;
    target: PublishTarget;
    payload: ReviewRequestPayload;
    assets: ReviewRequestAsset[];
    timestamp: string;
  }): Promise<ReceiptPublishedAsset[]> {
    const results: ReceiptPublishedAsset[] = [];
    for (const asset of input.assets) {
      const expected = assetUploadReceipt({
        target: input.target,
        payload: input.payload,
        asset,
        url: "receipt-identity-placeholder",
        embeddable: false,
        confirmedAt: input.timestamp,
      });
      const receiptArtifactId = reviewAssetUploadReceiptArtifactId(expected);
      const artifact = input.run.artifacts.find(
        (candidate) =>
          candidate.id === receiptArtifactId &&
          candidate.metadata["reportKind"] === "review-asset-upload-receipt",
      );
      if (artifact === undefined) continue;

      let receipt: ReviewAssetUploadReceipt;
      try {
        receipt = ReviewAssetUploadReceiptSchema.parse(
          JSON.parse((await this.artifactStore.readContent(artifact.digest)).toString("utf8")),
        );
      } catch {
        continue;
      }
      if (reviewAssetUploadReceiptArtifactId(receipt) !== receiptArtifactId) continue;
      results.push({
        receiptArtifactId,
        asset: {
          artifactId: receipt.artifactId,
          artifactDigest: receipt.artifactDigest,
          targetId: receipt.targetId,
          role: receipt.role,
          label: asset.label,
          url: receipt.url,
          embeddable: receipt.embeddable,
        },
      });
    }
    return results;
  }

  private async persistAssetUploadReceipts(input: {
    runId: string;
    target: PublishTarget;
    payload: ReviewRequestPayload;
    assets: ReviewRequestAsset[];
    publishedAssets: PublishedReviewAsset[];
    timestamp: string;
  }): Promise<ReceiptPublishedAsset[]> {
    if (input.publishedAssets.length === 0) return [];
    const sourceAssets = new Map(input.assets.map((asset) => [reviewAssetKey(asset), asset]));
    const receipts = input.publishedAssets.map((published) => {
      const source = sourceAssets.get(reviewAssetKey(published));
      if (source === undefined || source.artifactDigest !== published.artifactDigest) {
        throw new Error("PUBLISH_ASSET_OUTCOME_IDENTITY_MISMATCH");
      }
      const receipt = assetUploadReceipt({
        target: input.target,
        payload: input.payload,
        asset: source,
        url: published.url,
        embeddable: published.embeddable,
        confirmedAt: input.timestamp,
      });
      return {
        receipt,
        receiptArtifactId: reviewAssetUploadReceiptArtifactId(receipt),
        asset: published,
      };
    });
    const artifactRefs: ArtifactRef[] = [];
    for (const entry of receipts) {
      const content = Buffer.from(`${JSON.stringify(entry.receipt, null, 2)}\n`, "utf8");
      const blob = await this.artifactStore.writeBlob({
        content,
        mediaType: "application/json",
        storedAt: input.timestamp,
        label: "review-asset-upload-receipt",
      });
      artifactRefs.push(
        ArtifactRefSchema.parse({
          id: entry.receiptArtifactId,
          kind: "agent-result-report",
          uri: blob.uri,
          mediaType: "application/json",
          digest: blob.digest,
          producedBy: "pr-publisher",
          evidenceIds: [],
          createdAt: input.timestamp,
          metadata: {
            adapter: PUBLISHER_ADAPTER,
            reportKind: "review-asset-upload-receipt",
            receiptIdentity: reviewAssetUploadReceiptIdentity(entry.receipt),
            targetKey: entry.receipt.targetKey,
            reportArtifactId: entry.receipt.reportArtifactId,
            artifactId: entry.receipt.artifactId,
            artifactDigest: entry.receipt.artifactDigest,
            targetId: entry.receipt.targetId,
            role: entry.receipt.role,
          },
        }),
      );
    }

    let run = await this.runStore.get(RunIdSchema.parse(input.runId));
    for (let attempt = 0; attempt < MAX_PUBLISH_RESULT_SAVE_ATTEMPTS; attempt += 1) {
      const missing = artifactRefs.filter(
        (artifact) => !run.artifacts.some((existing) => existing.id === artifact.id),
      );
      if (missing.length === 0) break;
      const nextRun = RunManifestSchema.parse({
        ...run,
        revision: run.revision + 1,
        updatedAt:
          Date.parse(input.timestamp) >= Date.parse(run.updatedAt)
            ? input.timestamp
            : run.updatedAt,
        artifacts: [...run.artifacts, ...missing],
      });
      try {
        await this.runStore.save(nextRun, run.revision);
        run = nextRun;
        break;
      } catch (error: unknown) {
        if (!(error instanceof RevisionConflictError)) throw error;
        run = await this.runStore.get(RunIdSchema.parse(input.runId));
      }
    }
    for (const entry of receipts) {
      if (!run.artifacts.some((artifact) => artifact.id === entry.receiptArtifactId)) {
        throw new Error("Could not persist review asset upload receipts");
      }
    }
    return receipts.map(({ asset, receiptArtifactId }) => ({ asset, receiptArtifactId }));
  }

  private async tryGitLabRawVisualFallback(input: {
    run: Awaited<ReturnType<RunStore["get"]>>;
    target: PublishTarget;
    payload: ReviewRequestPayload;
    visualPreview: {
      report?: VisualPreviewReport;
      assets: ReviewRequestAsset[];
      locale?: "ko" | "en";
      requiresGeneratedDiagnostics: boolean;
    };
    featureVideo: ReviewRequestAsset | undefined;
    error: unknown;
  }): Promise<PublishedReviewAsset[] | undefined> {
    if (
      input.target.host !== "gitlab" ||
      input.payload.headSha === undefined ||
      input.visualPreview.report === undefined ||
      input.featureVideo !== undefined ||
      input.visualPreview.requiresGeneratedDiagnostics ||
      input.visualPreview.assets.some(
        (asset) => asset.role !== "figma" && asset.role !== "browser",
      ) ||
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

    const projectRoot = publicationProjectRoot(input.run);
    const checkedOutHead = (
      await this.git(projectRoot, ["rev-parse", "--verify", "HEAD"])
    ).stdout.trim();
    const status = (await this.git(projectRoot, ["status", "--porcelain"])).stdout.trim();
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
      const evidencePath = path.resolve(projectRoot, evidence.projectRelativePath);
      if (!isPathWithinRoot(projectRoot, evidencePath)) return undefined;

      const tracked = await this.git(projectRoot, [
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
        const result = await this.git(projectRoot, ["cat-file", "blob", objectName], {
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
        artifactDigest: asset.artifactDigest,
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
    const reviewPacketId = payload.reviewPacketId;
    if (reviewPacketId === undefined) return undefined;
    const artifact = [...run.artifacts]
      .reverse()
      .find(
        (item) =>
          item.metadata["workflowSubmissionKind"] === "implementation" &&
          item.metadata["featureEvidenceRole"] === "video" &&
          item.metadata["reviewPacketId"] === reviewPacketId,
      );

    if (artifact === undefined) return undefined;
    if (artifact.mediaType !== "video/webm" && artifact.mediaType !== "video/mp4") {
      throw new Error(`Feature E2E artifact is not a supported video: ${artifact.id}`);
    }

    const extension = artifact.mediaType === "video/mp4" ? ".mp4" : ".webm";
    return {
      artifactId: artifact.id,
      artifactDigest: artifact.digest as ReviewRequestAsset["artifactDigest"],
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
    intent: PublishIntent,
  ): Promise<{
    report?: VisualPreviewReport;
    assets: ReviewRequestAsset[];
    locale?: "ko" | "en";
    requiresGeneratedDiagnostics: boolean;
  }> {
    const prReportArtifact = requireArtifact(run.artifacts, payload.reportArtifactId);
    const locale = ReportLocaleSchema.safeParse(prReportArtifact.metadata["locale"]);
    const binding = await this.resolvePublicationReportBinding(run, prReportArtifact, intent);
    const reportArtifact = binding.visualReportArtifact;

    if (reportArtifact === undefined) {
      return {
        assets: [],
        requiresGeneratedDiagnostics: false,
      };
    }

    const rawReport = JSON.parse(
      (await this.artifactStore.readContent(reportArtifact.digest)).toString("utf8"),
    );
    const report = normalizeVisualReport(rawReport);
    const policy = await this.readVisualPreviewPolicy(run.artifacts);
    const assets: ReviewRequestAsset[] = [];
    const labels = visualPreviewLabels(report);
    const requiresGeneratedDiagnostics =
      intent === "blocked-diagnostic" &&
      report.publicationTargets.some((target) => target.status === "failed");

    for (const [index, result] of report.results.entries()) {
      const target = report.publicationTargets[index];
      if (target === undefined) throw new Error("Visual publication target is missing");

      if (requiresGeneratedDiagnostics || includeVisualRole(policy, "figma")) {
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

      if (requiresGeneratedDiagnostics || includeVisualRole(policy, "browser")) {
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

      if (requiresGeneratedDiagnostics && result.diffArtifactId === undefined) {
        throw new Error(`Blocked visual report is missing a diff artifact for ${result.targetId}`);
      }
      if (requiresGeneratedDiagnostics && result.overlayArtifactId === undefined) {
        throw new Error(
          `Blocked visual report is missing an overlay artifact for ${result.targetId}`,
        );
      }

      if (
        result.diffArtifactId !== undefined &&
        (requiresGeneratedDiagnostics || includeVisualRole(policy, "diff"))
      ) {
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

      if (result.overlayArtifactId !== undefined && requiresGeneratedDiagnostics) {
        assets.push(
          await this.visualAssetFromArtifact({
            artifacts: run.artifacts,
            artifactId: result.overlayArtifactId,
            targetId: result.targetId,
            role: "overlay",
            label: "Overlay",
            payload,
          }),
        );
      }
    }

    return {
      report,
      assets,
      requiresGeneratedDiagnostics,
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
      artifactDigest: artifact.digest as ReviewRequestAsset["artifactDigest"],
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
    fence?: PublicationExecutionFence;
    plan?: z.infer<typeof PublishPlanSchema>;
    credentialSource?: "env" | "cli";
  }) {
    const fenced =
      input.fence !== undefined || input.plan !== undefined || input.credentialSource !== undefined;
    if (
      fenced &&
      (input.fence === undefined ||
        input.plan === undefined ||
        input.credentialSource === undefined)
    ) {
      throw new Error("Publication result fence inputs must be supplied together");
    }
    let run =
      input.fence === undefined || input.plan === undefined || input.credentialSource === undefined
        ? await this.runStore.get(RunIdSchema.parse(input.runId))
        : await this.assertPublicationFenceCurrent({
            fence: input.fence,
            plan: input.plan,
            remoteName: input.remoteName,
            credentialSource: input.credentialSource,
          });
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
        run =
          input.fence === undefined ||
          input.plan === undefined ||
          input.credentialSource === undefined
            ? await this.runStore.get(RunIdSchema.parse(input.runId))
            : await this.assertPublicationFenceCurrent({
                fence: input.fence,
                plan: input.plan,
                remoteName: input.remoteName,
                credentialSource: input.credentialSource,
              });
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

function publicationRemoteTargetKey(target: PublishTarget): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        host: target.host,
        webBaseUrl: target.webBaseUrl,
        apiBaseUrl: target.apiBaseUrl,
        owner: target.owner,
        repo: target.repo,
        projectPath: target.projectPath,
        projectId: target.projectId,
      }),
    )
    .digest("hex")}`;
}

function publisherCredentialSource(source: string): "env" | "cli" {
  return /^(?:gh|glab)\s/.test(source) ? "cli" : "env";
}

function assertPublicationFenceMatchesPlan(
  fence: PublicationExecutionFence,
  plan: z.infer<typeof PublishPlanSchema>,
  remoteName: string,
  credentialSource: "env" | "cli",
): void {
  if (
    fence.reportArtifactId !== plan.payload.reportArtifactId ||
    fence.reviewPacketId !== plan.payload.reviewPacketId ||
    (plan.payload.headSha !== undefined && fence.headSha !== plan.payload.headSha) ||
    fence.sourceBranch !== plan.payload.sourceBranch ||
    fence.targetBranch !== plan.payload.targetBranch ||
    fence.remoteName !== remoteName ||
    fence.remoteTargetKey !== publicationRemoteTargetKey(plan.target) ||
    fence.credentialSource !== credentialSource
  ) {
    throw new Error(
      "PUBLISH_EXECUTION_FENCE_STALE: report, packet, head, branch, or remote binding changed",
    );
  }
}

function publicationRunSemanticDigest(
  run: Awaited<ReturnType<RunStore["get"]>>,
): `sha256:${string}` {
  const diagnosticClaims = new Map<
    string,
    {
      diagnosticExecutionKey: string;
      claimState: string;
      ownerClaimId: string;
    }
  >();
  const semanticArtifacts = run.artifacts.filter((artifact) => {
    const reportKind = artifact.metadata["reportKind"];
    if (reportKind === "review-asset-upload-receipt") return false;
    if (reportKind !== "diagnostic-publish-claim") return true;

    const diagnosticExecutionKey = artifact.metadata["diagnosticExecutionKey"];
    const claimState = artifact.metadata["claimState"];
    const ownerClaimId = artifact.metadata["ownerClaimId"];
    if (
      typeof diagnosticExecutionKey !== "string" ||
      typeof claimState !== "string" ||
      typeof ownerClaimId !== "string"
    ) {
      return true;
    }
    diagnosticClaims.set(diagnosticExecutionKey, {
      diagnosticExecutionKey,
      claimState,
      ownerClaimId,
    });
    return false;
  });
  const semanticRun = {
    ...run,
    revision: 0,
    updatedAt: "publication-semantic-snapshot",
    stages: run.stages.map((stage) =>
      stage.lease === undefined
        ? stage
        : {
            ...stage,
            lease: {
              ...stage.lease,
              heartbeatAt: "publication-lease-heartbeat",
              expiresAt: "publication-lease-expiry",
            },
          },
    ),
    artifacts: semanticArtifacts,
    diagnosticPublishClaims: [...diagnosticClaims.values()].sort((left, right) =>
      left.diagnosticExecutionKey.localeCompare(right.diagnosticExecutionKey),
    ),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(semanticRun)).digest("hex")}`;
}

function assertPublicationRunMatchesFence(
  run: Awaited<ReturnType<RunStore["get"]>>,
  fence: PublicationExecutionFence,
  plan: z.infer<typeof PublishPlanSchema>,
): void {
  if (
    run.revision < fence.runRevision ||
    publicationRunSemanticDigest(run) !== fence.runSemanticDigest
  ) {
    throw new Error("PUBLISH_EXECUTION_FENCE_STALE: Run semantic binding changed");
  }
  const report = run.artifacts.find(
    (artifact) => artifact.id === fence.reportArtifactId && artifact.digest === fence.reportDigest,
  );
  if (report === undefined || fence.reportArtifactId !== plan.payload.reportArtifactId) {
    throw new Error("PUBLISH_EXECUTION_FENCE_STALE: report binding changed");
  }
  if (fence.reviewPacketId === undefined) return;

  const implementation = run.stages.find((stage) => stage.name === "implementation");
  const packet = ImplementationReviewPacketSchema.safeParse(
    implementation?.checkpoint?.data["reviewPacket"],
  );
  if (
    !packet.success ||
    packet.data.id !== fence.reviewPacketId ||
    packet.data.headSha !== fence.headSha ||
    packet.data.diffDigest !== fence.diffDigest
  ) {
    throw new Error("PUBLISH_EXECUTION_FENCE_STALE: review packet, head, or diff binding changed");
  }
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

function publicationProjectRoot(run: Awaited<ReturnType<RunStore["get"]>>): string {
  return run.workspaceBinding?.repositoryRoot ?? run.projectRoot;
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

function normalizeVisualReport(rawReport: unknown): VisualPreviewReport {
  const legacy = VisualReportSchema.safeParse(rawReport);
  if (legacy.success) {
    return {
      ...legacy.data,
      publicationTargets: legacy.data.results.map((result) => ({
        attempt: 1,
        targetId: result.targetId,
        name: result.targetId,
        route: "-",
        state: "-",
        fixture: "-",
        viewport: { width: result.metrics.width, height: result.metrics.height },
        deviceScaleFactor: 1,
        status: result.status === "passed" ? "passed" : "failed",
        metrics: {
          reviewMatchRatio: result.metrics.reviewMatchRatio,
          exactMatchRatio: result.metrics.exactMatchRatio,
          maskedAreaRatio: result.metrics.maskedAreaRatio ?? 0,
          threshold: result.metrics.threshold ?? 0,
        },
        baselineArtifactId: result.figmaScreenshotArtifactId,
        actualArtifactId: result.browserScreenshotArtifactId,
        ...(result.diffArtifactId === undefined ? {} : { diffArtifactId: result.diffArtifactId }),
        ...(result.overlayArtifactId === undefined
          ? {}
          : { overlayArtifactId: result.overlayArtifactId }),
      })),
    };
  }
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
  const attempt =
    typeof report["attempt"] === "number" && Number.isInteger(report["attempt"])
      ? report["attempt"]
      : 1;
  const publicationTargets = normalized.results.map((result, index) => {
    const rawResult = rawResults[index] as Record<string, unknown>;
    const context = contexts[index];
    const fixture = typeof rawResult["fixture"] === "string" ? rawResult["fixture"] : "-";

    return {
      attempt,
      targetId: result.targetId,
      name: context?.name ?? result.targetId,
      route: context?.route ?? "-",
      state: context?.state ?? "-",
      fixture,
      viewport: context?.viewport ?? { width: result.metrics.width, height: result.metrics.height },
      deviceScaleFactor: context?.deviceScaleFactor ?? 1,
      status: result.status === "passed" ? "passed" : "failed",
      metrics: {
        reviewMatchRatio: result.metrics.reviewMatchRatio,
        exactMatchRatio: result.metrics.exactMatchRatio,
        maskedAreaRatio: result.metrics.maskedAreaRatio ?? 0,
        threshold: result.metrics.threshold ?? 0,
      },
      baselineArtifactId: result.figmaScreenshotArtifactId,
      actualArtifactId: result.browserScreenshotArtifactId,
      ...(result.diffArtifactId === undefined ? {} : { diffArtifactId: result.diffArtifactId }),
      ...(result.overlayArtifactId === undefined
        ? {}
        : { overlayArtifactId: result.overlayArtifactId }),
    } satisfies PublicationVisualTarget;
  });
  return {
    ...normalized,
    results: normalized.results.map((result, index) => ({
      ...result,
      ...(contexts[index] === undefined ? {} : { context: contexts[index] }),
    })),
    publicationTargets,
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

  const blocks = report.results.map((result, index) => {
    const publicationTarget = report.publicationTargets[index];
    if (publicationTarget === undefined) return "";
    const figma = assetByTargetAndRole.get(`${result.targetId}:figma`);
    const browser = assetByTargetAndRole.get(`${result.targetId}:browser`);
    const diff = assetByTargetAndRole.get(`${result.targetId}:diff`);
    const overlay = assetByTargetAndRole.get(`${result.targetId}:overlay`);
    const reviewMatch = `${(publicationTarget.metrics.reviewMatchRatio * 100).toFixed(2)}%`;
    const mismatch = `${((1 - publicationTarget.metrics.reviewMatchRatio) * 100).toFixed(2)}%`;
    const exactMatch = `${(publicationTarget.metrics.exactMatchRatio * 100).toFixed(2)}%`;
    const maskedArea = `${(publicationTarget.metrics.maskedAreaRatio * 100).toFixed(2)}%`;
    const threshold = `${(publicationTarget.metrics.threshold * 100).toFixed(2)}%`;
    const target = visualTargetDisplay(result, index, locale);
    const route = escapeMarkdownTableCell(redactSecretShapes(publicationTarget.route));
    const state = escapeMarkdownTableCell(redactSecretShapes(publicationTarget.state));
    const fixture = escapeMarkdownTableCell(redactSecretShapes(publicationTarget.fixture));
    const diagnostics = [
      diagnosticLink(diff, "Diff", target.name),
      diagnosticLink(overlay, "Overlay", target.name),
    ].filter((item): item is string => item !== undefined);

    return [
      `#### ${escapeMarkdownTableCell(target.name)} · ${fixture}`,
      "",
      locale === "ko"
        ? "| 경로 | 상태 | Fixture | 화면 | DPR | 시도 | 검토 일치율 | 불일치율 | 픽셀 일치율 | 마스킹 | 기준 | 결과 |"
        : "| Route | State | Fixture | Viewport | DPR | Attempt | Review match | Mismatch | Pixel match | Masked | Threshold | Status |",
      "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
      `| ${route} | ${state} | ${fixture} | ${publicationTarget.viewport.width}×${publicationTarget.viewport.height} | ${publicationTarget.deviceScaleFactor} | ${publicationTarget.attempt} | ${reviewMatch} | ${mismatch} | ${exactMatch} | ${maskedArea} | ${threshold} | ${locale === "ko" ? koreanVisualStatus(result.status) : result.status} |`,
      "",
      `| ${labels.baseline} | ${labels.actual} |`,
      "| --- | --- |",
      `| ${imageCell(figma, labels.baseline, target.name, 320)} | ${imageCell(browser, labels.actual, target.name, 320)} |`,
      ...(diagnostics.length === 0
        ? []
        : ["", `${locale === "ko" ? "진단" : "Diagnostics"}: ${diagnostics.join(" · ")}`]),
    ].join("\n");
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
    ...blocks.filter((block) => block !== ""),
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
  width = 320,
): string {
  if (asset === undefined) {
    return "-";
  }

  // Non-embeddable assets (e.g. private GitHub raw URLs) render as a plain link
  // so the review body never shows a broken image.
  if (asset.embeddable === false) {
    return `[${escapeMarkdownTableCell(`${altPrefix} · ${targetName} ↗`)}](${asset.url})`;
  }

  return `<img src="${escapeHtmlAttribute(asset.url)}" alt="${escapeHtmlAttribute(`${altPrefix} · ${targetName}`)}" width="${width}" />`;
}

function diagnosticLink(
  asset: PublishedReviewAsset | undefined,
  label: string,
  targetName: string,
): string | undefined {
  if (asset === undefined) return undefined;
  if (asset.embeddable === false) {
    return `[${escapeMarkdownTableCell(`${label} · ${targetName} ↗`)}](${asset.url})`;
  }
  return `[${label}](${asset.url})`;
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

function partialAssetPublishResult(input: {
  runId: string;
  target: PublishTarget;
  request?: PublishedReviewRequest;
  reportArtifactId: string;
  prepared: {
    publishedAssets: PublishedReviewAsset[];
    uploadReceiptArtifactIds: string[];
    visualPreviewExpected: boolean;
    featureVideoExpected: boolean;
    fallbackMode: "none" | "gitlab-raw-evidence";
    fallbackReason?: string;
  };
  partialReasons: string[];
  retryable: boolean;
  publishedAt: string;
}): PublishResult {
  const partialReasons =
    input.partialReasons.length > 0
      ? input.partialReasons.map((reason) => redactSecrets(reason))
      : ["review asset publication is incomplete"];
  return PublishResultSchema.parse({
    runId: input.runId,
    status: "blocked",
    target: input.target,
    ...(input.request === undefined ? {} : { request: input.request }),
    reportArtifactId: input.reportArtifactId,
    publishedAssets: input.prepared.publishedAssets,
    uploadReceiptArtifactIds: input.prepared.uploadReceiptArtifactIds,
    requestSynced: false,
    visualPreviewExpected: input.prepared.visualPreviewExpected,
    visualPreviewSynced: false,
    featureVideoExpected: input.prepared.featureVideoExpected,
    featureVideoSynced: false,
    fallbackMode: input.prepared.fallbackMode,
    ...(input.prepared.fallbackReason === undefined
      ? {}
      : { fallbackReason: input.prepared.fallbackReason }),
    partialReasons,
    errorCode: "PUBLISH_PARTIAL_SYNC",
    errorMessage: partialReasons.join("; "),
    retryable: input.retryable,
    publishedAt: input.publishedAt,
  });
}

function assetUploadReceipt(input: {
  target: PublishTarget;
  payload: ReviewRequestPayload;
  asset: ReviewRequestAsset;
  url: string;
  embeddable: boolean;
  confirmedAt: string;
}): ReviewAssetUploadReceipt {
  return ReviewAssetUploadReceiptSchema.parse({
    schemaVersion: "review-asset-upload-v1",
    runId: input.payload.runId,
    host: input.target.host,
    targetKey: reviewAssetUploadTargetKey(input.target),
    reportArtifactId: input.payload.reportArtifactId,
    ...(input.payload.reviewPacketId === undefined
      ? {}
      : { reviewPacketId: input.payload.reviewPacketId }),
    ...(input.payload.headSha === undefined ? {} : { headSha: input.payload.headSha }),
    artifactId: input.asset.artifactId,
    artifactDigest: input.asset.artifactDigest,
    targetId: input.asset.targetId,
    role: input.asset.role,
    url: input.url,
    embeddable: input.embeddable,
    confirmedAt: input.confirmedAt,
  });
}

function reviewAssetKey(asset: {
  artifactId: string;
  artifactDigest: string;
  targetId: string;
  role: string;
}): string {
  return [asset.artifactId, asset.artifactDigest, asset.targetId, asset.role].join("\u0000");
}

function settleAssetPublishOutcomes(
  assets: ReviewRequestAsset[],
  outcomes: ReviewAssetPublishOutcome[],
): ReviewAssetPublishOutcome[] {
  if (outcomes.length !== assets.length) {
    return assets.map((asset) => ({
      status: "failed",
      artifactId: asset.artifactId,
      failure: "uncertain",
      message: "Publisher returned an incomplete asset outcome set",
    }));
  }
  const remaining = [...outcomes];
  return assets.map((asset) => {
    const index = remaining.findIndex((outcome) =>
      outcome.status === "published"
        ? outcome.asset.artifactId === asset.artifactId
        : outcome.artifactId === asset.artifactId,
    );
    if (index < 0) {
      return {
        status: "failed",
        artifactId: asset.artifactId,
        failure: "uncertain",
        message: "Publisher returned a mismatched asset outcome",
      };
    }
    const [outcome] = remaining.splice(index, 1);
    if (
      outcome === undefined ||
      (outcome.status === "published" &&
        (outcome.asset.artifactDigest !== asset.artifactDigest ||
          outcome.asset.targetId !== asset.targetId ||
          outcome.asset.role !== asset.role))
    ) {
      return {
        status: "failed",
        artifactId: asset.artifactId,
        failure: "uncertain",
        message: "Publisher returned a mismatched asset outcome",
      };
    }
    return outcome;
  });
}

function assertPublishedAssetUrlsInBody(
  body: string,
  requiredAssets: PublishedReviewAsset[],
): void {
  const missing = requiredAssets.filter((asset) => !body.includes(asset.url));
  if (missing.length > 0) {
    throw new Error("PUBLISH_ASSET_BODY_SYNC_INCOMPLETE");
  }
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
