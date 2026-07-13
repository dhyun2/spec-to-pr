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
  type PublishedReviewAsset,
  readPublisherToken,
  redactSecrets,
  ReviewHostSchema,
  type ReviewRequestAsset,
  ReviewRequestPayloadSchema,
} from "../publisher/index.js";
import type {
  PublishedReviewRequest,
  PublishResult,
  PublishTarget,
  ReviewRequestPayload,
  ReviewRequestPublisher,
} from "../publisher/index.js";
import { ReportDecisionSchema, type ReportDecision } from "../pr-report/pr-report-model.js";
import { RunManifestSchema, RunSummarySchema, summarizeRun } from "../run/index.js";
import { AgentResultSchema } from "../runtime/agent-result.js";
import { ArtifactRefSchema } from "../runtime/artifact.js";
import { RUNTIME_CONTRACT_VERSION } from "../runtime/constants.js";
import { createAgentResultId, createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema } from "../runtime/scalars.js";
import type { ArtifactRef } from "../runtime/index.js";
import type { RunStore } from "../store/run-store.js";
import { VisualReportSchema, type VisualReport } from "../visual/visual-model.js";

const execFileAsync = promisify(execFile);
const PUBLISHER_ADAPTER = "publisher-v1" as const;

type VisualPreviewPolicy = {
  includeFigma?: boolean;
  includeBrowser?: boolean;
  includeDiff?: boolean;
};

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
    const reportDecision = reportDecisionFromArtifact(reportArtifact);
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
      reportDecision,
      requiredTokenEnv: publisherAuthHint(target.host),
      willPushBranch: input.pushBranch,
      willCreateOrUpdate: reportDecision !== "blocked",
      warnings: buildPlanWarnings({ payload, reportDecision }),
      plannedAt: timestamp,
    });
  }

  public async publish(rawInput: unknown) {
    const input = PublishReviewRequestInputSchema.parse(rawInput);
    const run = await this.runStore.get(input.runId);
    const timestamp = IsoDateTimeSchema.parse(this.now());
    const { confirm, ...planInput } = input;
    void confirm;

    const plan = await this.plan(planInput);
    if (plan.reportDecision === "blocked") {
      const result = blockedPublishResult({
        runId: run.id,
        target: plan.target,
        reportArtifactId: plan.payload.reportArtifactId,
        publishedAt: timestamp,
      });

      return this.recordPublishResult({
        runId: run.id,
        result,
        payload: plan.payload,
        timestamp,
        addPublishingAgentResult: false,
      });
    }

    await this.assertPublishBranchReady({
      projectRoot: run.projectRoot,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
    });

    const result = await this.executePublish({
      run,
      plan,
      timestamp,
      pushBranch: input.pushBranch,
      remoteName: input.remoteName,
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
    const { allowBlockedBody, confirm, publishMode, requestNumber, ...planInput } = input;
    void confirm;

    const plan = await this.plan(planInput);
    const blockedBodyUpdateAllowed = allowBlockedBody || publishMode === "blocked-draft-update";

    if (plan.reportDecision === "blocked" && !blockedBodyUpdateAllowed) {
      const result = blockedPublishResult({
        runId: run.id,
        target: plan.target,
        reportArtifactId: plan.payload.reportArtifactId,
        publishedAt: timestamp,
      });

      return this.recordPublishResult({
        runId: run.id,
        result,
        payload: plan.payload,
        timestamp,
        addPublishingAgentResult: false,
      });
    }

    const result = await this.executeUpdateBody({
      plan,
      requestNumber,
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

  private async assertPublishBranchReady(input: {
    projectRoot: string;
    sourceBranch: string;
    targetBranch: string;
  }): Promise<void> {
    const status = (await this.git(input.projectRoot, ["status", "--porcelain"])).stdout.trim();
    if (status.length > 0) {
      throw new Error(
        "Draft publication requires a clean working tree; commit the intended implementation changes first",
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
      throw new Error(
        `Draft publication requires at least one committed change on ${input.sourceBranch} beyond ${input.targetBranch}`,
      );
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
  }): Promise<PublishResult> {
    try {
      const token = readPublisherToken(input.plan.target.host);

      if (input.pushBranch) {
        await this.git(input.run.projectRoot, [
          "push",
          "--set-upstream",
          input.remoteName,
          input.plan.payload.sourceBranch,
        ]);
      }

      const publisher = this.publishers[input.plan.target.host];
      const prepared = await this.preparePayloadForPublish({
        run: input.run,
        plan: input.plan,
        publisher,
        token: token.token,
      });
      const existing = await publisher.findExisting({
        target: input.plan.target,
        payload: prepared.payload,
        token: token.token,
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
            })
          : await publisher.updateBody({
              target: input.plan.target,
              requestNumber: existing.number,
              body: prepared.payload.body,
              token: token.token,
            });
      if (!request.draft) {
        throw new Error(`Review request ${request.number} is not a draft after publication`);
      }

      return PublishResultSchema.parse({
        runId: input.plan.runId,
        status: "passed",
        target: input.plan.target,
        request,
        reportArtifactId: input.plan.payload.reportArtifactId,
        publishedAssets: prepared.publishedAssets,
        requestSynced: true,
        visualPreviewExpected: prepared.visualPreviewExpected,
        visualPreviewSynced: prepared.visualPreviewSynced,
        featureVideoExpected: prepared.featureVideoExpected,
        featureVideoSynced: prepared.featureVideoSynced,
        fallbackMode: "none",
        partialReasons: prepared.partialReasons,
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
      const run = await this.runStore.get(input.plan.runId);
      const prepared = await this.preparePayloadForPublish({
        run,
        plan: input.plan,
        publisher,
        token: token.token,
      });
      const existing = await publisher.findExisting({
        target: input.plan.target,
        payload: prepared.payload,
        token: token.token,
      });
      if (existing === undefined || existing.number !== input.requestNumber) {
        throw new Error(`Draft review request ${input.requestNumber} could not be verified`);
      }
      if (!existing.draft) {
        throw new Error(`Refusing to update non-draft review request ${existing.number}`);
      }
      const request = await publisher.updateBody({
        target: input.plan.target,
        requestNumber: input.requestNumber,
        body: prepared.payload.body,
        token: token.token,
      });
      if (!request.draft) {
        throw new Error(`Review request ${request.number} is not a draft after body update`);
      }

      return PublishResultSchema.parse({
        runId: input.plan.runId,
        status: "passed",
        target: input.plan.target,
        request,
        reportArtifactId: input.plan.payload.reportArtifactId,
        publishedAssets: prepared.publishedAssets,
        requestSynced: true,
        visualPreviewExpected: prepared.visualPreviewExpected,
        visualPreviewSynced: prepared.visualPreviewSynced,
        featureVideoExpected: prepared.featureVideoExpected,
        featureVideoSynced: prepared.featureVideoSynced,
        fallbackMode: "none",
        partialReasons: prepared.partialReasons,
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

  private async preparePayloadForPublish(input: {
    run: Awaited<ReturnType<RunStore["get"]>>;
    plan: z.infer<typeof PublishPlanSchema>;
    publisher: ReviewRequestPublisher;
    token: string;
  }): Promise<{
    payload: ReviewRequestPayload;
    publishedAssets: PublishedReviewAsset[];
    visualPreviewExpected: boolean;
    visualPreviewSynced: boolean;
    featureVideoExpected: boolean;
    featureVideoSynced: boolean;
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
        partialReasons: [],
      };
    }

    let publishedAssets: PublishedReviewAsset[];
    try {
      publishedAssets = await input.publisher.publishAssets({
        target: input.plan.target,
        payload: input.plan.payload,
        token: input.token,
        assets,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const label = visualPreviewExpected ? "visual evidence" : "feature video";
      throw new PublishPreparationError(`${label} upload failed: ${message}`, {
        visualPreviewExpected,
        featureVideoExpected,
        partialReasons: [`${label} upload failed: ${redactSecrets(message)}`],
      });
    }

    if (publishedAssets.length !== assets.length) {
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
      partialReasons: [],
    };
  }

  private async collectFeatureVideoAsset(
    run: Awaited<ReturnType<RunStore["get"]>>,
    payload: ReviewRequestPayload,
  ): Promise<ReviewRequestAsset | undefined> {
    const artifact = [...run.artifacts]
      .reverse()
      .find(
        (item) =>
          item.metadata["workflowSubmissionKind"] === "implementation" &&
          item.metadata["featureEvidenceRole"] === "video",
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
    report?: VisualReport;
    assets: ReviewRequestAsset[];
  }> {
    const reportArtifact = latestVisualReportArtifact(run.artifacts);

    if (reportArtifact === undefined) {
      return {
        assets: [],
      };
    }

    const report = VisualReportSchema.parse(
      JSON.parse((await this.artifactStore.readContent(reportArtifact.digest)).toString("utf8")),
    );
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
    };
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
        requestDraft: input.result.request?.draft,
        requestSynced: input.result.requestSynced,
        visualPreviewExpected: input.result.visualPreviewExpected,
        visualPreviewSynced: input.result.visualPreviewSynced,
        featureVideoExpected: input.result.featureVideoExpected,
        featureVideoSynced: input.result.featureVideoSynced,
      },
    });
    const shouldAddPublishingAgentResult =
      input.addPublishingAgentResult && publishResultIsFullySynced(input.result);
    const agentResults = shouldAddPublishingAgentResult
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

function latestVisualReportArtifact(artifacts: ArtifactRef[]): ArtifactRef | undefined {
  return artifacts
    .filter(
      (item) =>
        item.kind === "visual-report" && item.metadata["reportKind"] === "visual-report-json",
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}

function injectVisualEvidencePreview(input: {
  body: string;
  report: VisualReport;
  assets: PublishedReviewAsset[];
}): string {
  const locale = isKoreanReportBody(input.body) ? "ko" : "en";
  const preview = renderVisualEvidencePreview(input.report, input.assets, locale);

  if (preview === undefined) {
    return input.body;
  }

  const cleaned = removeVisualEvidencePreview(input.body).trimEnd();
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
const FEATURE_VIDEO_START = "<!-- spec-to-pr:feature-video:start -->";
const FEATURE_VIDEO_END = "<!-- spec-to-pr:feature-video:end -->";

function injectFeatureVideoEvidence(body: string, asset: PublishedReviewAsset): string {
  const start = body.indexOf(FEATURE_VIDEO_START);
  const end = body.indexOf(FEATURE_VIDEO_END);
  const cleanBody =
    start === -1 || end === -1 || end < start
      ? body.trimEnd()
      : `${body.slice(0, start).trimEnd()}\n\n${body.slice(end + FEATURE_VIDEO_END.length).trimStart()}`.trimEnd();

  return [
    cleanBody,
    "",
    FEATURE_VIDEO_START,
    "## Feature E2E Evidence",
    "",
    `[Open the targeted feature recording](${asset.url})`,
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
  report: VisualReport,
  assets: PublishedReviewAsset[],
  locale: "ko" | "en" = "en",
): string | undefined {
  if (assets.length === 0 || report.results.length === 0) {
    return undefined;
  }

  const assetByTargetAndRole = new Map<string, PublishedReviewAsset>();
  const labels = visualPreviewLabels(report);

  for (const asset of assets) {
    assetByTargetAndRole.set(`${asset.targetId}:${asset.role}`, asset);
  }

  const rows = report.results.map((result) => {
    const figma = assetByTargetAndRole.get(`${result.targetId}:figma`);
    const browser = assetByTargetAndRole.get(`${result.targetId}:browser`);
    const diff = assetByTargetAndRole.get(`${result.targetId}:diff`);
    const reviewMatch = `${(result.metrics.reviewMatchRatio * 100).toFixed(2)}%`;
    const exactMatch = `${(result.metrics.exactMatchRatio * 100).toFixed(2)}%`;

    return [
      escapeMarkdownTableCell(result.targetId),
      imageCell(figma, labels.baseline),
      imageCell(browser, labels.actual),
      imageCell(diff, "Diff"),
      `${reviewMatch}<br>exact ${exactMatch}<br>${result.status}`,
    ];
  });

  const hasNonEmbeddable = assets.some((asset) => asset.embeddable === false);
  const fallbackNote = hasNonEmbeddable
    ? locale === "ko"
      ? "\n> 이 저장소는 인라인 이미지 미리보기가 제한되어(예: private 저장소) 이미지를 링크로 대체했습니다. 링크를 클릭하면 로그인된 상태에서 볼 수 있습니다."
      : "\n> Inline image previews are restricted for this repository (e.g. a private repo), so images are shown as links. Open them while signed in to view."
    : "";

  return [
    VISUAL_PREVIEW_START,
    locale === "ko" ? "## 시각 증거 미리보기" : "## Visual Evidence Preview",
    "",
    visualPreviewDescription(report, locale),
    fallbackNote,
    "",
    locale === "ko"
      ? `| 대상 | ${labels.baseline} | ${labels.actual} | Diff | 점수 |`
      : `| Target | ${labels.baseline} | ${labels.actual} | Diff | Score |`,
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    VISUAL_PREVIEW_END,
  ].join("\n");
}

function visualPreviewLabels(report: VisualReport): { baseline: string; actual: string } {
  return report.visualBaseline === "legacy-screenshot"
    ? { baseline: "Legacy baseline", actual: "Target" }
    : { baseline: "Figma", actual: "Browser" };
}

function visualPreviewDescription(report: VisualReport, locale: "ko" | "en"): string {
  if (report.visualBaseline === "legacy-screenshot") {
    return locale === "ko"
      ? "legacy screenshot baseline, target screenshot, visual diff 이미지를 리뷰용으로 업로드했습니다."
      : "Legacy screenshot baseline, target screenshot, and visual diff are uploaded for review.";
  }

  return locale === "ko"
    ? "Figma baseline, 브라우저 캡처, visual diff 이미지를 리뷰용으로 업로드했습니다."
    : "Figma baseline, browser capture, and visual diff are uploaded for review.";
}

function isKoreanReportBody(body: string): boolean {
  return body.startsWith("# 요약") || body.includes("\n## 실행 메타데이터");
}

function imageCell(asset: PublishedReviewAsset | undefined, altPrefix: string): string {
  if (asset === undefined) {
    return "-";
  }

  // Non-embeddable assets (e.g. private GitHub raw URLs) render as a plain link
  // so the review body never shows a broken image.
  if (asset.embeddable === false) {
    return `[${escapeMarkdownTableCell(`${altPrefix} ↗`)}](${asset.url})`;
  }

  return `<img src="${escapeHtmlAttribute(asset.url)}" alt="${escapeHtmlAttribute(`${altPrefix} ${asset.targetId}`)}" width="260" />`;
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
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, "<br>");
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

  return PublishResultSchema.parse({
    runId: input.runId,
    status: "failed",
    target: input.target,
    reportArtifactId: input.reportArtifactId,
    requestSynced: false,
    visualPreviewExpected: preparationDetails?.visualPreviewExpected ?? false,
    visualPreviewSynced: false,
    featureVideoExpected: preparationDetails?.featureVideoExpected ?? false,
    featureVideoSynced: false,
    fallbackMode: "none",
    partialReasons: preparationDetails?.partialReasons ?? [publishFailureReason(message)],
    errorCode: "PUBLISH_FAILED",
    errorMessage: message,
    retryable: true,
    publishedAt: input.publishedAt,
  });
}

function defaultTitle(runId: string): string {
  return `spec-to-pr evidence report for ${runId}`;
}

function reportDecisionFromArtifact(artifact: ArtifactRef): ReportDecision {
  return ReportDecisionSchema.catch("blocked").parse(artifact.metadata["decision"]);
}

function buildPlanWarnings(input: {
  payload: ReviewRequestPayload;
  reportDecision: ReportDecision;
}): string[] {
  const warnings: string[] = [];

  if (input.reportDecision === "blocked") {
    warnings.push(
      "Report decision is blocked. Publishing is disabled until blockers are resolved.",
    );
  } else if (input.reportDecision !== "ready") {
    warnings.push(`Report decision is ${input.reportDecision}. Publish only as a draft.`);
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

function blockedPublishResult(input: {
  runId: string;
  target: PublishTarget;
  reportArtifactId: string;
  publishedAt: string;
}): PublishResult {
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
    partialReasons: ["Report decision is blocked. Publishing is disabled."],
    errorCode: "PUBLISH_BLOCKED",
    errorMessage:
      "Report decision is blocked. Finish required gates or regenerate the report after resolving blockers.",
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
