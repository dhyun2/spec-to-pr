import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { PNG } from "pngjs";
import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { ArtifactRefSchema, type ArtifactRef } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import type { RunManifest } from "../run/run.js";
import type { RunStageName, StageState } from "../run/stages.js";
import type { RunStore } from "../store/run-store.js";
import {
  ReviewSubmissionSchema,
  ChangeKindSchema,
  DeliveryModeSchema,
  DeliveryProfileSchema,
  FigmaFileUrlSchema,
  ImplementationContextIdSchema,
  PublicationIntentSchema,
  WorkflowActionSchema,
  WorkflowScopeSchema,
  WorkflowStatusSchema,
  WorkflowSubmissionSchema,
  buildGatePlan,
  buildDeliveryProfile,
  classifyWorkflowScope,
  type WorkflowScope,
  type DeliveryProfile,
  type WorkflowStatus,
  type WorkflowSubmission,
} from "../workflow/index.js";
import type { IntakeRequestService } from "./intake-request-service.js";
import type { OpenSpecArchiveService } from "./openspec-archive-service.js";
import type { ProjectProfileService } from "./profile-service.js";
import type { PublisherService } from "./publisher-service.js";
import type { RunService } from "./run-service.js";
import type { StageService } from "./stage-service.js";

const WORKER_ID = "workflow-orchestrator" as const;
const DEFAULT_EXTERNAL_LEASE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_EXTERNAL_HEARTBEAT_MS = 60 * 1000;

const FigmaManifestSchema = z
  .object({
    provider: z.literal("host-connected-figma"),
    capturedAt: z.string().datetime({ offset: true }),
    fileUrl: FigmaFileUrlSchema,
    nodeIds: z.array(z.string().trim().min(1)).min(1),
    visualPaths: z
      .array(
        z
          .string()
          .trim()
          .regex(/\.png$/i),
      )
      .min(1),
  })
  .strict();

const FeatureResultSchema = z
  .object({
    status: z.literal("passed"),
    selector: z.string().trim().min(1),
    implementationContextId: ImplementationContextIdSchema,
    testCount: z.number().int().positive(),
  })
  .strict();

export const WorkflowStartInputSchema = z
  .object({
    projectRoot: z.string().trim().min(1),
    requestText: z.string().trim().min(1).max(200_000),
    scope: z.enum(["auto", "ui", "non-ui", "docs"]).default("auto"),
    mode: DeliveryModeSchema.default("auto"),
    changeKind: ChangeKindSchema.default("auto"),
    publication: PublicationIntentSchema.optional(),
    briefPath: z.string().trim().min(1).optional(),
    figmaUrl: FigmaFileUrlSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode === "brief" && input.briefPath === undefined) {
      context.addIssue({
        code: "custom",
        path: ["briefPath"],
        message: "brief mode requires briefPath",
      });
    }
    if (input.mode === "figma" && input.figmaUrl === undefined) {
      context.addIssue({
        code: "custom",
        path: ["figmaUrl"],
        message: "figma mode requires figmaUrl",
      });
    }
    if (
      (input.mode === "feature" || input.mode === "figma") &&
      input.scope !== "auto" &&
      input.scope !== "ui"
    ) {
      context.addIssue({
        code: "custom",
        path: ["scope"],
        message: `${input.mode} mode requires UI scope`,
      });
    }
  });

export const WorkflowAdvanceInputSchema = z
  .object({
    runId: RunIdSchema,
    until: z.enum(["boundary", "report", "publish-ready"]).default("boundary"),
  })
  .strict();

export const WorkflowSubmitInputSchema = z
  .object({
    runId: RunIdSchema,
    submission: WorkflowSubmissionSchema,
  })
  .strict();

export const WorkflowStatusInputSchema = z.object({ runId: RunIdSchema }).strict();

export const WorkflowPublishInputSchema = z
  .object({
    runId: RunIdSchema,
    mode: z.enum(["preview", "execute"]),
    sourceBranch: z.string().trim().min(1),
    targetBranch: z.string().trim().min(1).default("main"),
    title: z.string().trim().min(1).optional(),
    remoteName: z.string().trim().min(1).default("origin"),
    pushBranch: z.boolean().default(true),
    confirm: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.sourceBranch === input.targetBranch) {
      context.addIssue({
        code: "custom",
        path: ["sourceBranch"],
        message: "Draft publication requires sourceBranch to differ from targetBranch",
      });
    }
    if (input.mode === "execute" && !input.confirm) {
      context.addIssue({
        code: "custom",
        path: ["confirm"],
        message: "Executing publication requires confirm=true",
      });
    }
  });

export const WorkflowArchiveInputSchema = z
  .object({
    runId: RunIdSchema.optional(),
    mode: z.enum(["preview", "execute"]),
    changeName: z.string().trim().min(1).optional(),
    mergeEvidenceId: ArtifactIdSchema.optional(),
    confirm: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode !== "execute") {
      return;
    }
    if (!input.confirm) {
      context.addIssue({
        code: "custom",
        path: ["confirm"],
        message: "Executing archive requires confirm=true",
      });
    }
    if (
      input.runId === undefined ||
      input.changeName === undefined ||
      input.mergeEvidenceId === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Executing archive requires runId, changeName, and mergeEvidenceId",
      });
    }
  });

export type WorkflowServiceDependencies = {
  runStore: RunStore;
  artifactStore: ArtifactBlobStore;
  runService: RunService;
  intakeRequestService: IntakeRequestService;
  profileService: ProjectProfileService;
  stageService: StageService;
  publisherService?: PublisherService;
  archiveService?: OpenSpecArchiveService;
  now?: () => string;
  externalLeaseTtlMs?: number;
  externalHeartbeatMs?: number;
};

export class WorkflowService {
  private readonly now: () => string;
  private readonly externalLeaseTtlMs: number;
  private readonly externalHeartbeatMs: number;

  public constructor(private readonly dependencies: WorkflowServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.externalLeaseTtlMs = dependencies.externalLeaseTtlMs ?? DEFAULT_EXTERNAL_LEASE_TTL_MS;
    this.externalHeartbeatMs = dependencies.externalHeartbeatMs ?? DEFAULT_EXTERNAL_HEARTBEAT_MS;

    if (
      this.externalHeartbeatMs <= 0 ||
      this.externalLeaseTtlMs <= this.externalHeartbeatMs ||
      this.externalLeaseTtlMs > 60 * 60 * 1000
    ) {
      throw new Error("External stage lease settings require 0 < heartbeat < TTL <= 1 hour");
    }
  }

  public async start(rawInput: unknown): Promise<WorkflowStatus> {
    const input = WorkflowStartInputSchema.parse(rawInput);
    const briefText =
      input.mode === "brief" && input.briefPath !== undefined
        ? await readProjectTextFile(input.projectRoot, input.briefPath, "Brief")
        : undefined;
    const publication = input.publication ?? (input.mode === "figma" ? "none" : "draft");
    const created = await this.dependencies.runService.createRun({
      projectRoot: input.projectRoot,
      sources: [],
    });
    const started = await this.dependencies.stageService.start({
      runId: created.id,
      stageName: "intake",
      workerId: WORKER_ID,
    });
    const parsed = await this.dependencies.intakeRequestService.parseIntakeRequest({
      runId: created.id,
      requestText: input.requestText,
    });
    const parsedBrief =
      briefText === undefined || input.briefPath === undefined
        ? undefined
        : await this.dependencies.intakeRequestService.parseIntakeRequest({
            runId: created.id,
            requestText: briefText,
            label: `brief:${input.briefPath}`,
          });
    await this.dependencies.profileService.inspectProject({
      runId: created.id,
      projectRoot: input.projectRoot,
    });

    const figmaUrl = input.figmaUrl ?? parsed.parsed.figmaUrls[0];
    const explicitScope =
      (input.mode === "feature" || input.mode === "figma") && input.scope === "auto"
        ? "ui"
        : input.scope;
    const scope = classifyWorkflowScope({
      requestText:
        briefText === undefined ? input.requestText : `${input.requestText}\n\n${briefText}`,
      explicitScope,
      figmaUrls: figmaUrl === undefined ? parsed.parsed.figmaUrls : [figmaUrl],
    });
    const gatePlan = buildGatePlan(scope);
    const deliveryProfile = buildDeliveryProfile({
      mode: input.mode,
      changeKind: input.changeKind,
      publication,
      scope,
      ...(input.briefPath === undefined ? {} : { briefPath: input.briefPath }),
      ...(figmaUrl === undefined ? {} : { figmaUrl }),
    });

    await this.dependencies.stageService.complete({
      runId: created.id,
      stageName: "intake",
      workerId: WORKER_ID,
      leaseId: started.stage.lease!.id,
      artifactIds: [
        parsed.artifact.id,
        ...(parsedBrief === undefined ? [] : [parsedBrief.artifact.id]),
      ],
      checkpoint: {
        name: "scope-classified",
        data: { scope, gatePlan, deliveryProfile },
      },
    });

    return this.status({ runId: created.id });
  }

  public async advance(rawInput: unknown): Promise<WorkflowStatus> {
    const input = WorkflowAdvanceInputSchema.parse(rawInput);

    for (let step = 0; step < 8; step += 1) {
      const run = await this.dependencies.runStore.get(input.runId);
      const scope = scopeFromRun(run);
      const deliveryProfile = deliveryProfileFromRun(run);
      const designStage = stage(run, "design-review");
      const functionalStage = stage(run, "functional-review");
      const reportStage = stage(run, "report");

      if (!scope.ui && designStage.status === "pending") {
        await this.skipStage(run.id, "design-review", "No UI changes are in scope.");
        continue;
      }

      if (
        reportStage.status === "pending" &&
        functionalStage.status === "passed" &&
        ["passed", "skipped", "waived"].includes(stage(run, "design-review").status)
      ) {
        await this.generateReport(run.id);
        if (input.until === "report") {
          return this.status({ runId: run.id });
        }
        continue;
      }

      if (
        reportStage.status === "passed" &&
        deliveryProfile.publication === "none" &&
        stage(run, "publish").status === "pending"
      ) {
        await this.skipStage(run.id, "publish", "Draft publication was not requested.");
        await this.skipStage(run.id, "archive", "Archive is an explicit post-merge action.");
        continue;
      }

      return this.status({ runId: input.runId });
    }

    throw new Error(`Workflow ${input.runId} exceeded the deterministic advance limit`);
  }

  public async submit(rawInput: unknown): Promise<WorkflowStatus> {
    const input = WorkflowSubmitInputSchema.parse(rawInput);
    const run = await this.dependencies.runStore.get(input.runId);
    const submission = input.submission;
    assertSubmissionPrerequisites(run, submission);
    const evidenceArtifacts = await this.ingestSubmissionEvidence(run, submission);

    if (submission.kind === "figma-bundle") {
      await this.recordSubmissionArtifact(run, submission, evidenceArtifacts);
      return this.status({ runId: run.id });
    }

    if (submission.kind === "api-ready") {
      const artifact = await this.recordSubmissionArtifact(run, submission, evidenceArtifacts);
      await this.recordApiReadyCheckpoint(
        run.id,
        [...evidenceArtifacts.map((item) => item.id), artifact.id],
        submission.implementationContextId,
      );
      return this.status({ runId: run.id });
    }

    const stageName = stageForSubmission(submission);
    const started = await this.dependencies.stageService.start({
      runId: run.id,
      stageName,
      workerId: WORKER_ID,
    });
    const artifact = await this.recordSubmissionArtifact(
      await this.dependencies.runStore.get(run.id),
      submission,
      evidenceArtifacts,
    );
    const artifactIds = [...evidenceArtifacts.map((item) => item.id), artifact.id];
    const outcome = submissionOutcome(submission);

    if (outcome === "passed") {
      await this.dependencies.stageService.complete({
        runId: run.id,
        stageName,
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        artifactIds,
        ...(submission.kind === "implementation"
          ? {
              checkpoint: {
                name: "implementation-complete",
                data: {
                  apiReady: submission.apiReady,
                  implementationContextId: submission.implementationContextId,
                  uiChanged: submission.uiChanged,
                  apiReadyArtifactIds:
                    stage(run, "implementation").checkpoint?.data["artifactIds"] ?? [],
                },
              },
            }
          : {}),
      });
    } else {
      await this.dependencies.stageService.fail({
        runId: run.id,
        stageName,
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        artifactIds,
        error: {
          code: outcome === "blocked" ? "WORKFLOW_BLOCKED" : "CHANGES_REQUESTED",
          message: submission.summary,
          retryable: outcome !== "blocked",
        },
      });
    }

    return this.status({ runId: run.id });
  }

  public async status(rawInput: unknown): Promise<WorkflowStatus> {
    const input = WorkflowStatusInputSchema.parse(rawInput);
    const run = await this.dependencies.runStore.get(input.runId);
    const scope = scopeFromRun(run);
    const deliveryProfile = deliveryProfileFromRun(run);
    const nextActions = actionsForRun(run, scope, deliveryProfile);
    const currentStage = run.stages.find(
      (item) => !["passed", "skipped", "waived"].includes(item.status),
    );
    const blockers = run.stages.flatMap((item) =>
      item.error === undefined || item.error.retryable ? [] : [item.error.message],
    );
    const reportPassed = stage(run, "report").status === "passed";
    const publishPassed = stage(run, "publish").status === "passed";
    const publicationCompleted =
      publishPassed ||
      (deliveryProfile.publication === "none" && stage(run, "publish").status === "skipped");
    const status = publicationCompleted
      ? "completed"
      : blockers.length > 0
        ? "blocked"
        : reportPassed
          ? "publish-ready"
          : nextActions.length > 0
            ? "needs-external-action"
            : "running";

    return WorkflowStatusSchema.parse({
      runId: run.id,
      status,
      ...(currentStage === undefined ? {} : { currentStage: currentStage.name }),
      scope,
      deliveryProfile,
      stages: run.stages.map((item) => ({
        name: item.name,
        status: item.status,
        ...(item.name === "implementation" && item.checkpoint !== undefined
          ? { checkpoint: item.checkpoint.name }
          : {}),
      })),
      nextActions,
      blockers,
      artifactIds: run.artifacts.map((artifact) => artifact.id),
    });
  }

  public async publish(rawInput: unknown): Promise<unknown> {
    const input = WorkflowPublishInputSchema.parse(rawInput);
    const publisher = this.dependencies.publisherService;

    if (publisher === undefined) {
      throw new Error("Publishing is unavailable in this runtime");
    }

    const run = await this.dependencies.runStore.get(input.runId);
    if (deliveryProfileFromRun(run).publication !== "draft") {
      throw new Error("Draft publication was not requested for this workflow");
    }
    const reportArtifact = latestArtifact(run, "pr-report", "pr-body-markdown");
    const baseInput = {
      runId: run.id,
      reportArtifactId: reportArtifact.id,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      ...(input.title === undefined ? {} : { title: input.title }),
      remoteName: input.remoteName,
      mode: "draft" as const,
      pushBranch: input.pushBranch,
      labels: ["spec-to-pr"],
      reviewers: [],
      assignees: [],
    };

    if (input.mode === "preview") {
      return publisher.plan(baseInput);
    }

    const started = await this.dependencies.stageService.start({
      runId: run.id,
      stageName: "publish",
      workerId: WORKER_ID,
      leaseTtlMs: this.externalLeaseTtlMs,
    });
    let result: Awaited<ReturnType<PublisherService["publish"]>>;

    try {
      result = await this.withLeaseHeartbeat(run.id, "publish", started.stage.lease!.id, () =>
        publisher.publish({ ...baseInput, confirm: true }),
      );
    } catch (error: unknown) {
      await this.dependencies.stageService.fail({
        runId: run.id,
        stageName: "publish",
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        error: {
          code: "PUBLISH_UNEXPECTED_ERROR",
          message: "Publisher threw unexpectedly after publication started.",
          retryable: true,
        },
      });
      throw error;
    }

    if (publishResultIsFullySynced(result.result)) {
      await this.dependencies.stageService.complete({
        runId: run.id,
        stageName: "publish",
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        artifactIds: [result.publishResultArtifactId],
      });
      await this.skipStage(run.id, "archive", "Archive is an explicit post-merge action.");
    } else {
      const error = publishStageError(result.result);
      await this.dependencies.stageService.fail({
        runId: run.id,
        stageName: "publish",
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        artifactIds: [result.publishResultArtifactId],
        error,
      });
    }

    return { result, status: await this.status({ runId: run.id }) };
  }

  public async archive(rawInput: unknown): Promise<unknown> {
    const input = WorkflowArchiveInputSchema.parse(rawInput);
    const archiveService = this.dependencies.archiveService;

    if (archiveService === undefined) {
      throw new Error("OpenSpec archive is unavailable in this runtime");
    }

    if (input.mode === "preview") {
      const resolved = await archiveService.resolveTarget({
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        ...(input.changeName === undefined ? {} : { changeName: input.changeName }),
      });

      if (!resolved.resolved) {
        return resolved;
      }

      return archiveService.plan({ runId: resolved.runId, changeName: resolved.changeName });
    }

    const runId = input.runId!;
    const started = await this.dependencies.stageService.start({
      runId,
      stageName: "archive",
      workerId: WORKER_ID,
      leaseTtlMs: this.externalLeaseTtlMs,
    });
    let result: Awaited<ReturnType<OpenSpecArchiveService["runArchive"]>>;

    try {
      result = await this.withLeaseHeartbeat(runId, "archive", started.stage.lease!.id, () =>
        archiveService.runArchive({
          runId,
          changeName: input.changeName!,
          mergeEvidenceId: input.mergeEvidenceId!,
          yes: true,
        }),
      );
    } catch (error: unknown) {
      await this.dependencies.stageService.fail({
        runId,
        stageName: "archive",
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        error: {
          code: "ARCHIVE_UNEXPECTED_ERROR",
          message: "OpenSpec archive threw unexpectedly after archiving started.",
          retryable: true,
        },
      });
      throw error;
    }

    if (result.status === "passed") {
      await this.dependencies.stageService.complete({
        runId,
        stageName: "archive",
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        artifactIds: [result.reportArtifactId],
      });
    } else {
      await this.dependencies.stageService.fail({
        runId,
        stageName: "archive",
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        artifactIds: [result.reportArtifactId],
        error: {
          code: "ARCHIVE_FAILED",
          message: `OpenSpec archive ${result.status}`,
          retryable: result.status === "failed",
        },
      });
    }

    return { result, status: await this.status({ runId }) };
  }

  private async recordSubmissionArtifact(
    run: RunManifest,
    submission: WorkflowSubmission,
    evidenceArtifacts: ArtifactRef[],
  ): Promise<ArtifactRef> {
    const timestamp = this.now();
    const content = `${JSON.stringify(submission, null, 2)}\n`;
    const blob = await this.dependencies.artifactStore.writeBlob({
      content: Buffer.from(content, "utf8"),
      mediaType: "application/json",
      storedAt: timestamp,
      label: `workflow-${submission.kind}`,
    });
    const artifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: submission.kind === "figma-bundle" ? "figma-design-context" : "agent-result-report",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: producerForSubmission(submission),
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        adapter: "workflow-v2",
        workflowSubmissionKind: submission.kind,
        ...(submission.kind === "figma-bundle" ? {} : { summary: submission.summary }),
        ...("verdict" in submission ? { verdict: submission.verdict } : {}),
        ...("status" in submission ? { status: submission.status } : {}),
        evidenceArtifactIds: evidenceArtifacts.map((item) => item.id),
      },
    });
    const current = await this.dependencies.runStore.get(run.id);
    if (
      submission.kind === "figma-bundle" &&
      current.artifacts.some(
        (existing) => existing.metadata["workflowSubmissionKind"] === "figma-bundle",
      )
    ) {
      throw new Error("A Figma bundle was already submitted for this Run");
    }

    await this.dependencies.runStore.save(
      {
        ...current,
        revision: current.revision + 1,
        updatedAt: timestamp,
        artifacts: [...current.artifacts, ...evidenceArtifacts, artifact],
      },
      current.revision,
    );

    return artifact;
  }

  private async withLeaseHeartbeat<T>(
    runId: string,
    stageName: RunStageName,
    leaseId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    let heartbeatFailure: unknown;
    let heartbeatChain = Promise.resolve();
    const timer = setInterval(() => {
      heartbeatChain = heartbeatChain
        .then(async () => {
          if (heartbeatFailure !== undefined) return;
          await this.dependencies.stageService.heartbeat({
            runId,
            stageName,
            leaseId,
            workerId: WORKER_ID,
            leaseTtlMs: this.externalLeaseTtlMs,
          });
        })
        .catch((error: unknown) => {
          heartbeatFailure ??= error;
        });
    }, this.externalHeartbeatMs);
    timer.unref();

    try {
      const result = await operation();
      clearInterval(timer);
      await heartbeatChain;
      if (heartbeatFailure !== undefined) throw heartbeatFailure;
      return result;
    } catch (error: unknown) {
      clearInterval(timer);
      await heartbeatChain;
      throw error;
    }
  }

  private async recordApiReadyCheckpoint(
    runId: string,
    artifactIds: string[],
    implementationContextId: string,
  ): Promise<void> {
    const current = await this.dependencies.runStore.get(RunIdSchema.parse(runId));
    const timestamp = this.now();
    const implementation = stage(current, "implementation");

    if (!["pending", "failed", "blocked"].includes(implementation.status)) {
      throw new Error("api-ready evidence must be submitted before implementation completes");
    }

    await this.dependencies.runStore.save(
      {
        ...current,
        revision: current.revision + 1,
        updatedAt: timestamp,
        stages: current.stages.map((item) =>
          item.name === "implementation"
            ? {
                ...item,
                artifactIds: [...new Set([...item.artifactIds, ...artifactIds])],
                checkpoint: {
                  name: "api-ready",
                  data: { apiReady: true, artifactIds, implementationContextId },
                  updatedAt: timestamp,
                },
              }
            : item,
        ),
      },
      current.revision,
    );
  }

  private async ingestSubmissionEvidence(
    run: RunManifest,
    submission: WorkflowSubmission,
  ): Promise<ArtifactRef[]> {
    const root = await realpath(run.projectRoot);
    const timestamp = this.now();
    const artifacts: ArtifactRef[] = [];
    const apiPhysicalFiles = new Map<string, string>();

    for (const evidencePath of submission.artifactPaths) {
      const requestedPath = path.isAbsolute(evidencePath)
        ? path.normalize(evidencePath)
        : path.resolve(root, evidencePath);
      assertWithinProjectRoot(root, requestedPath, evidencePath);

      let resolvedPath: string;
      try {
        resolvedPath = await realpath(requestedPath);
      } catch {
        throw new Error(`Evidence file does not exist: ${evidencePath}`);
      }
      assertWithinProjectRoot(root, resolvedPath, evidencePath);

      const details = await stat(resolvedPath);
      if (!details.isFile()) {
        throw new Error(`Evidence path must reference a file: ${evidencePath}`);
      }
      if (details.size > 50 * 1024 * 1024) {
        throw new Error(`Evidence file exceeds the 50 MB limit: ${evidencePath}`);
      }
      if (details.size === 0) {
        throw new Error(`Evidence file is empty: ${evidencePath}`);
      }

      const featureEvidenceRole =
        submission.kind === "implementation" &&
        submission.featureEvidence?.videoPath === evidencePath
          ? "video"
          : submission.kind === "implementation" &&
              submission.featureEvidence?.resultPath === evidencePath
            ? "result"
            : undefined;
      if (featureEvidenceRole === "video" && details.size > 25 * 1024 * 1024) {
        throw new Error(`Feature video exceeds the 25 MB limit: ${evidencePath}`);
      }

      const content = await readFile(resolvedPath);
      if (featureEvidenceRole === "video" && videoDurationMs(content) === undefined) {
        throw new Error(
          `Feature video must be a valid WebM or MP4 container with non-zero duration: ${evidencePath}`,
        );
      }
      if (featureEvidenceRole === "result" && submission.kind === "implementation") {
        assertPassingFeatureResult(
          content,
          evidencePath,
          submission.featureEvidence?.testSelector,
          submission.implementationContextId,
        );
      }

      const apiEvidenceRole =
        submission.kind === "api-ready"
          ? apiArtifactRole(submission.apiArtifacts, evidencePath)
          : undefined;
      if (apiEvidenceRole !== undefined) {
        const physicalFile = `${String(details.dev)}:${String(details.ino)}`;
        const existingRole = apiPhysicalFiles.get(physicalFile);
        if (existingRole !== undefined) {
          throw new Error(
            `API-ready categories require distinct physical evidence files; ${evidencePath} aliases ${existingRole}`,
          );
        }
        apiPhysicalFiles.set(physicalFile, evidencePath);
      }
      if (apiEvidenceRole === "contractTests") {
        assertPassingJsonResult(content, evidencePath);
      }
      if (submission.kind === "figma-bundle") {
        if (evidencePath === submission.manifestPath) {
          assertFigmaManifest(content, evidencePath, submission);
        } else {
          assertPng(content, evidencePath);
        }
      }

      const mediaType = mediaTypeForPath(resolvedPath);
      const blob = await this.dependencies.artifactStore.writeBlob({
        content,
        mediaType,
        storedAt: timestamp,
        label: path.basename(resolvedPath),
      });
      artifacts.push(
        ArtifactRefSchema.parse({
          id: createArtifactId(),
          kind: "other",
          uri: blob.uri,
          mediaType,
          digest: blob.digest,
          producedBy: producerForSubmission(submission),
          evidenceIds: [],
          createdAt: timestamp,
          metadata: {
            adapter: "workflow-v2-evidence",
            projectRelativePath: path.relative(root, resolvedPath),
            byteLength: details.size,
            workflowSubmissionKind: submission.kind,
            ...(featureEvidenceRole === undefined ? {} : { featureEvidenceRole }),
            ...(apiEvidenceRole === undefined ? {} : { apiEvidenceRole }),
            ...(submission.kind !== "figma-bundle"
              ? {}
              : { figmaProvider: submission.provider, figmaCapturedAt: submission.capturedAt }),
          },
        }),
      );
    }

    return artifacts;
  }

  private async generateReport(runId: string): Promise<void> {
    const run = await this.dependencies.runStore.get(RunIdSchema.parse(runId));
    const timestamp = this.now();
    const summaries = run.artifacts
      .filter((artifact) => artifact.metadata["workflowSubmissionKind"] !== undefined)
      .map(
        (artifact) =>
          `- ${String(artifact.metadata["workflowSubmissionKind"])}: ${String(artifact.metadata["summary"] ?? "recorded")}`,
      );
    const markdown = [
      `# SpecToPR Run ${run.id}`,
      "",
      "## Decision",
      "",
      "Ready for draft review.",
      "",
      "## Evidence",
      "",
      ...(summaries.length === 0 ? ["- No external submissions recorded."] : summaries),
      "",
    ].join("\n");
    const blob = await this.dependencies.artifactStore.writeBlob({
      content: Buffer.from(markdown, "utf8"),
      mediaType: "text/markdown",
      storedAt: timestamp,
      label: "pr-report.md",
    });
    const artifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "pr-report",
      uri: blob.uri,
      mediaType: "text/markdown",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        adapter: "workflow-v2",
        reportKind: "pr-body-markdown",
        decision: "ready",
        locale: "ko",
      },
    });

    await this.dependencies.runStore.save(
      {
        ...run,
        revision: run.revision + 1,
        updatedAt: timestamp,
        artifacts: [...run.artifacts, artifact],
      },
      run.revision,
    );
    await this.completeStage(run.id, "report", [artifact.id]);
  }

  private async completeStage(
    runId: string,
    stageName: RunStageName,
    artifactIds: string[] = [],
  ): Promise<void> {
    const started = await this.dependencies.stageService.start({
      runId,
      stageName,
      workerId: WORKER_ID,
    });
    await this.dependencies.stageService.complete({
      runId,
      stageName,
      workerId: WORKER_ID,
      leaseId: started.stage.lease!.id,
      artifactIds,
    });
  }

  private async skipStage(runId: string, stageName: RunStageName, reason: string): Promise<void> {
    const started = await this.dependencies.stageService.start({
      runId,
      stageName,
      workerId: WORKER_ID,
    });
    await this.dependencies.stageService.skip({
      runId,
      stageName,
      workerId: WORKER_ID,
      leaseId: started.stage.lease!.id,
      reason,
    });
  }
}

type PublisherResult = Awaited<ReturnType<PublisherService["publish"]>>["result"];

function publishResultIsFullySynced(result: PublisherResult): boolean {
  return (
    result.status === "passed" &&
    result.requestSynced &&
    result.request?.draft === true &&
    (!result.visualPreviewExpected || result.visualPreviewSynced) &&
    (!result.featureVideoExpected || result.featureVideoSynced) &&
    result.partialReasons.length === 0
  );
}

function publishStageError(result: PublisherResult) {
  const partial = result.status === "passed";
  const fallbackMessage = partial
    ? "Publication completed only partially and requires another synchronization attempt."
    : `Publication ${result.status}.`;

  return {
    code: partial ? "PUBLISH_PARTIAL" : (result.errorCode ?? "PUBLISH_FAILED"),
    message: result.errorMessage ?? (result.partialReasons.join("; ") || fallbackMessage),
    retryable: partial || (result.status === "failed" && result.retryable),
  };
}

function scopeFromRun(run: RunManifest): WorkflowScope {
  const rawScope = stage(run, "intake").checkpoint?.data["scope"];
  const parsed = WorkflowScopeSchema.safeParse(rawScope);

  if (!parsed.success) {
    throw new Error(`Run ${run.id} uses an unsupported pre-v2 workflow contract`);
  }

  return parsed.data;
}

function deliveryProfileFromRun(run: RunManifest): DeliveryProfile {
  const rawProfile = stage(run, "intake").checkpoint?.data["deliveryProfile"];
  if (rawProfile === undefined) {
    return buildDeliveryProfile({
      mode: "auto",
      changeKind: "auto",
      publication: "draft",
      scope: scopeFromRun(run),
    });
  }
  const parsed = DeliveryProfileSchema.safeParse(rawProfile);

  if (!parsed.success) {
    throw new Error(`Run ${run.id} uses an unsupported delivery profile`);
  }

  return parsed.data;
}

function stage(run: RunManifest, name: RunStageName): StageState {
  const value = run.stages.find((item) => item.name === name);

  if (value === undefined) {
    throw new Error(`Run ${run.id} is missing workflow stage ${name}`);
  }

  return value;
}

function actionsForRun(run: RunManifest, scope: WorkflowScope, profile: DeliveryProfile) {
  if (isActionable(stage(run, "contracts"))) {
    return [WorkflowActionSchema.parse({ kind: "prepare-contracts", runId: run.id })];
  }
  if (stage(run, "contracts").status === "passed" && isActionable(stage(run, "implementation"))) {
    return [
      WorkflowActionSchema.parse({
        kind: "implement",
        runId: run.id,
        requireApiReady: scope.ui && scope.api,
      }),
    ];
  }
  if (stage(run, "implementation").status !== "passed") {
    return [];
  }

  const actions = [];
  if (isActionable(stage(run, "functional-review"))) {
    actions.push(WorkflowActionSchema.parse({ kind: "review-functional", runId: run.id }));
  }
  if (scope.ui && isActionable(stage(run, "design-review"))) {
    actions.push(WorkflowActionSchema.parse({ kind: "review-design", runId: run.id }));
  }
  if (
    profile.publication === "draft" &&
    stage(run, "report").status === "passed" &&
    isActionable(stage(run, "publish"))
  ) {
    actions.push(WorkflowActionSchema.parse({ kind: "publish-draft", runId: run.id }));
  }

  return actions;
}

function isActionable(value: StageState): boolean {
  return (
    ["pending", "failed", "blocked"].includes(value.status) &&
    (value.error === undefined || value.error.retryable)
  );
}

function stageForSubmission(
  submission: Exclude<WorkflowSubmission, { kind: "figma-bundle" | "api-ready" }>,
): RunStageName {
  if (submission.kind === "contracts") return "contracts";
  if (submission.kind === "implementation") return "implementation";
  return submission.kind;
}

function assertSubmissionPrerequisites(run: RunManifest, submission: WorkflowSubmission): void {
  const profile = deliveryProfileFromRun(run);
  if (submission.kind === "api-ready" && stage(run, "contracts").status !== "passed") {
    throw new Error("The contracts stage must pass before the api-ready checkpoint");
  }
  if (
    submission.kind === "contracts" &&
    submission.status === "passed" &&
    profile.requirements.legacyBaseline &&
    submission.baselinePaths.length === 0
  ) {
    throw new Error("Legacy mode requires a focused baseline before contracts can pass");
  }
  if (
    submission.kind === "contracts" &&
    submission.status === "passed" &&
    profile.requirements.figmaBundle &&
    !run.artifacts.some(
      (artifact) => artifact.metadata["workflowSubmissionKind"] === "figma-bundle",
    )
  ) {
    throw new Error("Figma bundle evidence must be submitted before contracts can pass");
  }
  if (
    submission.kind === "figma-bundle" &&
    profile.figmaUrl !== undefined &&
    submission.fileUrl !== profile.figmaUrl
  ) {
    throw new Error("Figma bundle URL must match the delivery profile");
  }
  if (
    submission.kind === "figma-bundle" &&
    run.artifacts.some((artifact) => artifact.metadata["workflowSubmissionKind"] === "figma-bundle")
  ) {
    throw new Error("A Figma bundle was already submitted for this Run");
  }
  if (submission.kind === "figma-bundle" && stage(run, "contracts").status !== "pending") {
    throw new Error("Figma bundle evidence must be submitted before contracts begin");
  }
  if (
    submission.kind === "implementation" &&
    submission.status === "passed" &&
    profile.requirements.targetedFeatureE2E &&
    submission.featureEvidence === undefined
  ) {
    throw new Error(
      "User-facing feature mode requires targeted feature E2E evidence and one video",
    );
  }
  if (submission.kind === "implementation" && stage(run, "contracts").status !== "passed") {
    throw new Error("The contracts stage must pass before implementation begins");
  }
  if (
    submission.kind === "implementation" &&
    submission.status === "passed" &&
    scopeFromRun(run).ui &&
    scopeFromRun(run).api &&
    (stage(run, "implementation").checkpoint?.name !== "api-ready" ||
      !submission.apiReady ||
      submission.implementationContextId !==
        stage(run, "implementation").checkpoint?.data["implementationContextId"])
  ) {
    throw new Error(
      "API-backed UI implementation requires a real api-ready checkpoint from the same implementation context before completion",
    );
  }
  if (
    (submission.kind === "functional-review" || submission.kind === "design-review") &&
    stage(run, "implementation").status !== "passed"
  ) {
    throw new Error("The implementation stage must pass before review begins");
  }
  if (submission.kind === "design-review" && !scopeFromRun(run).ui) {
    throw new Error("Design review is not applicable to non-UI scope");
  }
  if (
    submission.kind === "implementation" &&
    submission.status === "passed" &&
    submission.uiChanged &&
    !scopeFromRun(run).ui
  ) {
    throw new Error("UI changes contradict the classified non-UI scope; restart with UI scope");
  }
  if (
    (submission.kind === "functional-review" || submission.kind === "design-review") &&
    submission.verdict === "approved"
  ) {
    assertRequiredGateResults(run, submission);
  }
}

function assertRequiredGateResults(
  run: RunManifest,
  submission: z.infer<typeof ReviewSubmissionSchema>,
): void {
  const designGateIds = new Set(["visual", "accessibility"]);
  const requiredGateIds = buildGatePlan(scopeFromRun(run))
    .filter((gate) => gate.applicability === "required")
    .filter((gate) =>
      submission.kind === "design-review"
        ? designGateIds.has(gate.id)
        : !designGateIds.has(gate.id) && gate.id !== "release",
    )
    .map((gate) => gate.id);
  const passedGateIds = new Set(
    submission.gateResults.filter((gate) => gate.status === "passed").map((gate) => gate.id),
  );
  const missing = requiredGateIds.filter((gateId) => !passedGateIds.has(gateId));

  if (missing.length > 0) {
    throw new Error(
      `Approved ${submission.kind} is missing required gate results: ${missing.join(", ")}`,
    );
  }
}

function assertWithinProjectRoot(root: string, candidate: string, originalPath: string): void {
  const relative = path.relative(root, candidate);

  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  ) {
    return;
  }

  throw new Error(`Evidence path must stay within the project root: ${originalPath}`);
}

function mediaTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".json") return "application/json";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".md") return "text/markdown";
  if ([".ts", ".tsx", ".js", ".jsx", ".css", ".txt", ".log"].includes(extension)) {
    return "text/plain";
  }
  return "application/octet-stream";
}

function apiArtifactRole(
  artifacts: {
    types: string[];
    schemas: string[];
    wrappers: string[];
    mocks: string[];
    contractTests: string[];
  },
  evidencePath: string,
): keyof typeof artifacts | undefined {
  return (Object.keys(artifacts) as Array<keyof typeof artifacts>).find((role) =>
    artifacts[role].includes(evidencePath),
  );
}

function assertPassingJsonResult(content: Buffer, evidencePath: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error(`Evidence must be a passing JSON test result: ${evidencePath}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Evidence must be a passing JSON test result: ${evidencePath}`);
  }
  const result = parsed as Record<string, unknown>;
  if (result["status"] !== "passed") {
    throw new Error(`Evidence must be a passing targeted test result: ${evidencePath}`);
  }
}

function assertPassingFeatureResult(
  content: Buffer,
  evidencePath: string,
  expectedSelector: string | undefined,
  expectedContextId: string | undefined,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error(`Feature evidence must be an exact passing JSON result: ${evidencePath}`);
  }
  const result = FeatureResultSchema.safeParse(parsed);
  if (!result.success || result.data.selector !== expectedSelector) {
    throw new Error(
      `Feature result must identify selector ${String(expectedSelector)}: ${evidencePath}`,
    );
  }
  if (result.data.implementationContextId !== expectedContextId) {
    throw new Error(`Feature result must match the implementationContextId: ${evidencePath}`);
  }
}

function assertFigmaManifest(
  content: Buffer,
  evidencePath: string,
  submission: Extract<WorkflowSubmission, { kind: "figma-bundle" }>,
): void {
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error(`Figma manifest must be valid JSON: ${evidencePath}`);
  }
  const parsed = FigmaManifestSchema.safeParse(raw);
  const expectedVisualPaths = submission.artifactPaths.filter(
    (artifactPath) => artifactPath !== submission.manifestPath,
  );
  if (
    !parsed.success ||
    parsed.data.provider !== submission.provider ||
    parsed.data.capturedAt !== submission.capturedAt ||
    parsed.data.fileUrl !== submission.fileUrl ||
    JSON.stringify(parsed.data.nodeIds) !== JSON.stringify(submission.nodeIds) ||
    JSON.stringify(parsed.data.visualPaths) !== JSON.stringify(expectedVisualPaths)
  ) {
    throw new Error(`Figma manifest provenance does not match its submission: ${evidencePath}`);
  }
}

function assertPng(content: Buffer, evidencePath: string): void {
  try {
    const image = PNG.sync.read(content);
    if (image.width < 1 || image.height < 1) throw new Error("empty image");
  } catch {
    throw new Error(`Figma visual must be a valid PNG image: ${evidencePath}`);
  }
}

function videoDurationMs(content: Buffer): number | undefined {
  return mp4DurationMs(content) ?? webmDurationMs(content);
}

function mp4DurationMs(content: Buffer): number | undefined {
  const topLevel = readMp4Boxes(content, 0, content.length);
  const ftyp = topLevel.find((box) => box.type === "ftyp");
  const moov = topLevel.find((box) => box.type === "moov");
  const mdat = topLevel.find((box) => box.type === "mdat");
  if (
    ftyp === undefined ||
    moov === undefined ||
    mdat === undefined ||
    mdat.end <= mdat.start + 8
  ) {
    return undefined;
  }
  const movieBoxes = readMp4Boxes(content, moov.start + 8, moov.end);
  const movieHeader = movieBoxes.find((box) => box.type === "mvhd");
  if (movieHeader === undefined || !movieBoxes.some((box) => box.type === "trak")) return undefined;
  const payload = movieHeader.start + 8;
  if (payload + 20 > movieHeader.end) return undefined;
  const version = content[payload];
  if (version === 0) {
    const timescale = content.readUInt32BE(payload + 12);
    const duration = content.readUInt32BE(payload + 16);
    return timescale > 0 && duration > 0 ? (duration / timescale) * 1_000 : undefined;
  }
  if (version === 1 && payload + 32 <= movieHeader.end) {
    const timescale = content.readUInt32BE(payload + 20);
    const duration = content.readBigUInt64BE(payload + 24);
    return timescale > 0 && duration > 0n ? (Number(duration) / timescale) * 1_000 : undefined;
  }
  return undefined;
}

function readMp4Boxes(content: Buffer, start: number, end: number) {
  const boxes: Array<{ type: string; start: number; end: number }> = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size = content.readUInt32BE(offset);
    if (size < 8 || offset + size > end) return [];
    boxes.push({
      type: content.subarray(offset + 4, offset + 8).toString("ascii"),
      start: offset,
      end: offset + size,
    });
    offset += size;
  }
  return offset === end ? boxes : [];
}

function webmDurationMs(content: Buffer): number | undefined {
  const has = (bytes: number[]) => content.indexOf(Buffer.from(bytes)) >= 0;
  if (
    content.length < 64 ||
    !content.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ||
    !has([0x18, 0x53, 0x80, 0x67]) ||
    !has([0x16, 0x54, 0xae, 0x6b]) ||
    !has([0x1f, 0x43, 0xb6, 0x75]) ||
    !has([0xa3])
  ) {
    return undefined;
  }
  const durationId = content.indexOf(Buffer.from([0x44, 0x89]));
  if (durationId < 0 || durationId + 3 >= content.length) return undefined;
  const sizeByte = content[durationId + 2]!;
  if ((sizeByte & 0x80) === 0) return undefined;
  const size = sizeByte & 0x7f;
  const valueOffset = durationId + 3;
  const duration =
    size === 4 && valueOffset + 4 <= content.length
      ? content.readFloatBE(valueOffset)
      : size === 8 && valueOffset + 8 <= content.length
        ? content.readDoubleBE(valueOffset)
        : undefined;
  return duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

function submissionOutcome(submission: Exclude<WorkflowSubmission, { kind: "figma-bundle" }>) {
  if ("verdict" in submission) {
    return submission.verdict === "approved"
      ? "passed"
      : submission.verdict === "blocked"
        ? "blocked"
        : "failed";
  }
  return submission.status;
}

function producerForSubmission(submission: WorkflowSubmission) {
  if (submission.kind === "implementation" || submission.kind === "api-ready") {
    return "implementation" as const;
  }
  if (submission.kind === "functional-review") return "functional-reviewer" as const;
  if (submission.kind === "design-review") return "design-reviewer" as const;
  return "orchestrator" as const;
}

async function readProjectTextFile(
  projectRoot: string,
  filePath: string,
  label: string,
): Promise<string> {
  const root = await realpath(projectRoot);
  const requestedPath = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(root, filePath);
  assertWithinProjectRoot(root, requestedPath, filePath);

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(requestedPath);
  } catch {
    throw new Error(`${label} file does not exist: ${filePath}`);
  }
  assertWithinProjectRoot(root, resolvedPath, filePath);
  const details = await stat(resolvedPath);
  if (!details.isFile()) throw new Error(`${label} path must reference a file: ${filePath}`);
  if (details.size > 1024 * 1024)
    throw new Error(`${label} file exceeds the 1 MB limit: ${filePath}`);

  return readFile(resolvedPath, "utf8");
}

function latestArtifact(
  run: RunManifest,
  kind: ArtifactRef["kind"],
  reportKind: string,
): ArtifactRef {
  const artifact = [...run.artifacts]
    .reverse()
    .find((item) => item.kind === kind && item.metadata["reportKind"] === reportKind);

  if (artifact === undefined) {
    throw new Error(`Run ${run.id} has no ${reportKind} artifact`);
  }

  return artifact;
}
