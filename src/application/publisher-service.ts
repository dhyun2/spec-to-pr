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
import { VisualReportSchema, type VisualReport } from "../visual/index.js";

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
      requiredTokenEnv:
        target.host === "github"
          ? "GITHUB_TOKEN or GH_TOKEN"
          : "GITLAB_TOKEN or GITLAB_PRIVATE_TOKEN",
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
    const { confirm, requestNumber, ...planInput } = input;
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

      return PublishResultSchema.parse({
        runId: input.plan.runId,
        status: "passed",
        target: input.plan.target,
        request,
        reportArtifactId: input.plan.payload.reportArtifactId,
        publishedAssets: prepared.publishedAssets,
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
      const request = await publisher.updateBody({
        target: input.plan.target,
        requestNumber: input.requestNumber,
        body: prepared.payload.body,
        token: token.token,
      });

      return PublishResultSchema.parse({
        runId: input.plan.runId,
        status: "passed",
        target: input.plan.target,
        request,
        reportArtifactId: input.plan.payload.reportArtifactId,
        publishedAssets: prepared.publishedAssets,
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
  }> {
    const visualPreview = await this.collectVisualPreviewAssets(input.run, input.plan.payload);

    if (visualPreview.assets.length === 0 || visualPreview.report === undefined) {
      return {
        payload: input.plan.payload,
        publishedAssets: [],
      };
    }

    const publishedAssets = await input.publisher.publishAssets({
      target: input.plan.target,
      payload: input.plan.payload,
      token: input.token,
      assets: visualPreview.assets,
    });

    return {
      payload: ReviewRequestPayloadSchema.parse({
        ...input.plan.payload,
        body: injectVisualEvidencePreview({
          body: input.plan.payload.body,
          report: visualPreview.report,
          assets: publishedAssets,
        }),
      }),
      publishedAssets,
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
    const assets: ReviewRequestAsset[] = [];

    for (const result of report.results) {
      assets.push(
        await this.visualAssetFromArtifact({
          artifacts: run.artifacts,
          artifactId: result.figmaScreenshotArtifactId,
          targetId: result.targetId,
          role: "figma",
          label: "Figma",
          payload,
        }),
        await this.visualAssetFromArtifact({
          artifacts: run.artifacts,
          artifactId: result.browserScreenshotArtifactId,
          targetId: result.targetId,
          role: "browser",
          label: "Browser",
          payload,
        }),
      );

      if (result.diffArtifactId !== undefined) {
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
      imageCell(figma, "Figma"),
      imageCell(browser, "Browser"),
      imageCell(diff, "Diff"),
      `${reviewMatch}<br>exact ${exactMatch}<br>${result.status}`,
      [figma, browser, diff]
        .filter((asset): asset is PublishedReviewAsset => asset !== undefined)
        .map((asset) => `${asset.label}: \`${asset.artifactId}\``)
        .join("<br>") || "-",
    ];
  });

  return [
    VISUAL_PREVIEW_START,
    locale === "ko" ? "## 시각 증거 미리보기" : "## Visual Evidence Preview",
    "",
    locale === "ko"
      ? "Figma baseline, 브라우저 캡처, visual diff 이미지를 리뷰용으로 업로드했습니다. 로컬 증거 추적을 위해 artifact ID도 함께 남깁니다."
      : "Figma baseline, browser capture, and visual diff are uploaded for review. Artifact IDs are kept for local evidence traceability.",
    "",
    locale === "ko"
      ? "| 대상 | Figma | Browser | Diff | 점수 | Artifact IDs |"
      : "| Target | Figma | Browser | Diff | Score | Artifact IDs |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    VISUAL_PREVIEW_END,
  ].join("\n");
}

function isKoreanReportBody(body: string): boolean {
  return body.startsWith("# 요약") || body.includes("\n## 실행 메타데이터");
}

function imageCell(asset: PublishedReviewAsset | undefined, altPrefix: string): string {
  if (asset === undefined) {
    return "-";
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
    errorCode: "PUBLISH_BLOCKED",
    errorMessage:
      "Report decision is blocked. Finish required gates or regenerate the report after resolving blockers.",
    retryable: false,
    publishedAt: input.publishedAt,
  });
}
