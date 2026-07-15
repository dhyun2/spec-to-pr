import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { PNG } from "pngjs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import { WorkflowReportMetadataSchema } from "../pr-report/pr-report-model.js";
import {
  renderBlockedWorkflowReport,
  renderReadyWorkflowReport,
} from "../pr-report/workflow-report-renderer.js";
import { PublishIntentSchema, PublishResultSchema } from "../publisher/index.js";
import { ArtifactRefSchema, type ArtifactRef } from "../runtime/artifact.js";
import { createArtifactId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { summarizeRun, type RunManifest } from "../run/index.js";
import type { RunStageName, StageState } from "../run/stages.js";
import type { RunStore } from "../store/run-store.js";
import { RevisionConflictError } from "../store/errors.js";
import {
  ReviewSubmissionSchema,
  ImplementationReviewPacketSchema,
  ChangeKindSchema,
  DeliveryModeSchema,
  DeliveryProfileSchema,
  DiagnosticPublicationSchema,
  FigmaFileUrlSchema,
  ImplementationContextIdSchema,
  PublicationIntentSchema,
  SkillHintSchema,
  WorkflowBlockerSchema,
  WorkflowSourcePathSchema,
  WorkflowActionSchema,
  WorkflowScopeSchema,
  WorkflowStatusSchema,
  WorkflowSubmissionSchema,
  WorkloadEstimateSchema,
  buildDelegationPolicy,
  buildGatePlan,
  buildDeliveryProfile,
  classifyWorkflowScope,
  estimateWorkload,
  isSafeDurableEvidencePath,
  type WorkflowScope,
  type WorkflowBlocker,
  type DeliveryProfile,
  type ImplementationReviewPacket,
  type WorkloadEstimate,
  type WorkloadSignals,
  type WorkflowStatus,
  type WorkflowSubmission,
} from "../workflow/index.js";
import { reopenImplementationForReviewChanges } from "../state/stage-machine.js";
import type { IntakeRequestService } from "./intake-request-service.js";
import type { OpenSpecArchiveService } from "./openspec-archive-service.js";
import type { PublisherService } from "./publisher-service.js";
import type { RunService } from "./run-service.js";
import type { StageService } from "./stage-service.js";

const WORKER_ID = "workflow-orchestrator" as const;
const execFileAsync = promisify(execFile);
const DEFAULT_EXTERNAL_LEASE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_EXTERNAL_HEARTBEAT_MS = 60 * 1000;
const MAX_DIAGNOSTIC_CLAIM_ATTEMPTS = 8;
const MAX_COMPOSABLE_SOURCE_PATHS = 20;
const MAX_INTAKE_SOURCE_CHARS = 200_000;
const MAX_OPENAPI_OPERATIONS = 1_000;
const GUIDANCE_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "docs/architecture/ARCHITECTURE.md",
  "docs/etc/folder-structure.md",
] as const;

const ComposableSourcePathsSchema = z
  .array(WorkflowSourcePathSchema)
  .max(MAX_COMPOSABLE_SOURCE_PATHS)
  .default([]);
const NormalizedDeliveryProfilePathsSchema = z
  .object({
    briefPath: WorkflowSourcePathSchema.optional(),
    docsPaths: ComposableSourcePathsSchema,
    openApiPaths: ComposableSourcePathsSchema,
    guidancePaths: ComposableSourcePathsSchema,
    discoveredGuidancePaths: ComposableSourcePathsSchema,
  })
  .strict();
const SkillHintsSchema = z.array(SkillHintSchema).max(20).default([]);

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
    briefPath: WorkflowSourcePathSchema.optional(),
    figmaUrl: FigmaFileUrlSchema.optional(),
    docsPath: WorkflowSourcePathSchema.optional(),
    docsPaths: ComposableSourcePathsSchema,
    openApiPath: WorkflowSourcePathSchema.optional(),
    openApiPaths: ComposableSourcePathsSchema,
    guidancePaths: ComposableSourcePathsSchema,
    skillHints: SkillHintsSchema,
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

    for (const [singularField, arrayField] of [
      ["docsPath", "docsPaths"],
      ["openApiPath", "openApiPaths"],
    ] as const) {
      const paths = uniqueInputValues([
        ...(input[singularField] === undefined ? [] : [input[singularField]]),
        ...input[arrayField],
      ]);
      if (paths.length > MAX_COMPOSABLE_SOURCE_PATHS) {
        context.addIssue({
          code: "custom",
          path: [arrayField],
          message: `${singularField} and ${arrayField} cannot contain more than ${MAX_COMPOSABLE_SOURCE_PATHS} distinct paths`,
        });
      }
    }

    const roles = new Map<string, string>();
    for (const [role, paths] of [
      ["briefPath", input.briefPath === undefined ? [] : [input.briefPath]],
      ["docsPaths", [input.docsPath, ...input.docsPaths].filter(isDefined)],
      ["openApiPaths", [input.openApiPath, ...input.openApiPaths].filter(isDefined)],
      ["guidancePaths", input.guidancePaths],
    ] as const) {
      paths.forEach((sourcePath, index) => {
        const key = normalizedInputPathKey(sourcePath);
        const previous = roles.get(key);
        if (previous !== undefined && previous !== role) {
          context.addIssue({
            code: "custom",
            path: [role, index],
            message: `Source path conflicts with ${previous}: ${sourcePath}`,
          });
        }
        roles.set(key, role);
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
    intent: PublishIntentSchema.default("ready"),
    mode: z.enum(["preview", "execute"]),
    sourceBranch: z.string().trim().min(1),
    targetBranch: z.string().trim().min(1).default("main"),
    title: z.string().trim().min(1).optional(),
    remoteName: z.string().trim().min(1).default("origin"),
    pushBranch: z.boolean().default(true),
    recoverUncertain: z.boolean().default(false),
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
    if (
      input.recoverUncertain &&
      (input.intent !== "blocked-diagnostic" || input.mode !== "execute" || !input.confirm)
    ) {
      context.addIssue({
        code: "custom",
        path: ["recoverUncertain"],
        message: "recoverUncertain=true requires confirmed blocked-diagnostic execute publication",
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
  private readonly diagnosticPublishFlights = new Map<string, Promise<unknown>>();

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
    const sources = await prepareComposableSources(input);
    const normalizedProfilePaths = NormalizedDeliveryProfilePathsSchema.parse({
      ...(sources.brief === undefined ? {} : { briefPath: sources.brief.path }),
      docsPaths: sources.docs.map((file) => file.path),
      openApiPaths: sources.openApi.map((file) => file.path),
      guidancePaths: sources.guidance.map((file) => file.path),
      discoveredGuidancePaths: sources.discoveredGuidance.map((file) => file.path),
    });
    const publication = input.publication ?? (input.mode === "figma" ? "none" : "draft");
    const initialHead = await currentGitHead(input.projectRoot);
    const created = await this.dependencies.runService.createRun({
      projectRoot: input.projectRoot,
      ...(initialHead === null ? {} : { baseCommit: initialHead }),
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
    const intakeArtifactIds = [parsed.artifact.id];
    for (const [kind, files] of [
      ["brief", sources.brief === undefined ? [] : [sources.brief]],
      ["docs", sources.docs],
      ["openapi", sources.openApi],
      ["guidance", [...sources.guidance, ...sources.discoveredGuidance]],
    ] as const) {
      for (const file of files) {
        const artifactIds = await ingestProjectTextSource({
          service: this.dependencies.intakeRequestService,
          runId: created.id,
          kind,
          file,
        });
        intakeArtifactIds.push(...artifactIds);
      }
    }

    const figmaUrl = input.figmaUrl ?? parsed.parsed.figmaUrls[0];
    const explicitScope =
      (input.mode === "feature" || input.mode === "figma") && input.scope === "auto"
        ? "ui"
        : input.scope;
    const classificationText = [
      input.requestText,
      ...(sources.brief === undefined ? [] : [sources.brief.text]),
      ...sources.docs.map((file) => file.text),
      ...sources.openApi.map((file) => file.text),
    ].join("\n\n");
    const classifiedScope = classifyWorkflowScope({
      requestText: classificationText,
      explicitScope,
      figmaUrls: figmaUrl === undefined ? parsed.parsed.figmaUrls : [figmaUrl],
    });
    const scope = WorkflowScopeSchema.parse({
      ...classifiedScope,
      api: classifiedScope.api || sources.openApi.length > 0,
      specification: classifiedScope.specification || sources.openApi.length > 0,
    });
    const gatePlan = buildGatePlan(scope);
    const recommendedSkills = await recommendedSkillsForIntake({
      projectRoot: input.projectRoot,
      ...(figmaUrl === undefined ? {} : { figmaUrl }),
      hasOpenApi: sources.openApi.length > 0,
      featureUi: scope.ui && (input.mode === "feature" || input.changeKind === "feature"),
    });
    const deliveryProfile = buildDeliveryProfile({
      mode: input.mode,
      changeKind: input.changeKind,
      publication,
      scope,
      ...(normalizedProfilePaths.briefPath === undefined
        ? {}
        : { briefPath: normalizedProfilePaths.briefPath }),
      ...(figmaUrl === undefined ? {} : { figmaUrl }),
      docsPaths: normalizedProfilePaths.docsPaths,
      openApiPaths: normalizedProfilePaths.openApiPaths,
      guidancePaths: normalizedProfilePaths.guidancePaths,
      discoveredGuidancePaths: normalizedProfilePaths.discoveredGuidancePaths,
      skillHints: sources.skillHints,
      recommendedSkills,
    });
    const workload = estimateWorkload({
      phase: "intake",
      mode: deliveryProfile.mode,
      scope,
      signals: {
        requirements: countIntakeRequirements(classificationText),
        apiOperations:
          sources.openApi.length > 0 ? countOpenApiOperations(sources.openApi) : scope.api ? 1 : 0,
        uiSurfaces: scope.ui ? 1 : 0,
        figmaNodes: figmaUrl === undefined ? 0 : 1,
        testTargets: scope.code ? 1 : 0,
        workspacePackages: await countDeclaredWorkspacePackages(input.projectRoot),
        uncertainty: scope.code ? 3 : 1,
      },
    });

    await this.dependencies.stageService.complete({
      runId: created.id,
      stageName: "intake",
      workerId: WORKER_ID,
      leaseId: started.stage.lease!.id,
      artifactIds: [...intakeArtifactIds],
      checkpoint: {
        name: "scope-classified",
        data: { scope, gatePlan, deliveryProfile, workload },
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
    if (submission.kind === "functional-review" || submission.kind === "design-review") {
      await assertReviewPacketFresh(run);
    }
    const evidenceArtifacts = await this.ingestSubmissionEvidence(run, submission);
    const implementationSnapshot =
      submission.kind === "implementation" && submission.status === "passed"
        ? await captureGitSnapshot(run)
        : undefined;
    if (submission.kind === "implementation" && implementationSnapshot !== undefined) {
      assertChangedFilesMatch(submission.changedFiles, implementationSnapshot.changedFiles);
    }
    const reviewPacket =
      submission.kind === "implementation" && implementationSnapshot !== undefined
        ? createImplementationReviewPacket(run, implementationSnapshot, evidenceArtifacts)
        : undefined;

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
    const activeRun = await this.dependencies.runStore.get(run.id);
    const runWithEvidence = {
      ...activeRun,
      artifacts: [...activeRun.artifacts, ...evidenceArtifacts],
    };
    const rawBlocker = blockerFromSubmission(submission);
    const typedBlocker =
      rawBlocker === undefined
        ? undefined
        : reconstructWorkflowBlocker(runWithEvidence, rawBlocker, started.stage);
    const artifact = await this.recordSubmissionArtifact(
      activeRun,
      submission,
      evidenceArtifacts,
      reviewPacket,
    );
    const artifactIds = [...evidenceArtifacts.map((item) => item.id), artifact.id];
    const outcome = submissionOutcome(submission);

    if (
      (submission.kind === "functional-review" || submission.kind === "design-review") &&
      submission.verdict === "changes-requested"
    ) {
      const current = await this.dependencies.runStore.get(run.id);
      const reopened = reopenImplementationForReviewChanges(
        current,
        typedBlocker?.summary ?? genericBlockerSummary(submission.kind, "unexpected"),
        this.now,
      );
      await this.dependencies.runStore.save(
        {
          ...reopened,
          stages: reopened.stages.map((item) =>
            item.name === "implementation"
              ? { ...item, artifactIds: [...new Set([...item.artifactIds, artifact.id])] }
              : item,
          ),
        },
        current.revision,
      );
      return this.status({ runId: run.id });
    }

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
                  reviewPacket,
                  apiReadyArtifactIds:
                    stage(run, "implementation").checkpoint?.data["artifactIds"] ?? [],
                },
              },
            }
          : {}),
      });
      if (submission.kind === "contracts" && submission.workloadSignals !== undefined) {
        await this.recordWorkloadEstimate(run.id, submission.workloadSignals);
      }
    } else {
      await this.dependencies.stageService.fail({
        runId: run.id,
        stageName,
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        artifactIds,
        error: {
          code:
            typedBlocker?.code ??
            (outcome === "blocked" ? "WORKFLOW_BLOCKED" : "CHANGES_REQUESTED"),
          message:
            typedBlocker?.summary ??
            `${stageName} stage reported ${outcome === "blocked" ? "a blocker" : "a failure"}.`,
          retryable: typedBlocker?.retryable ?? outcome !== "blocked",
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
    const workload = workloadFromRun(run, scope, deliveryProfile);
    const nextActions = actionsForRun(run, scope, deliveryProfile);
    const requiredValidations = requiredValidationsForRun(scope, deliveryProfile);
    const currentStage = run.stages.find(
      (item) => !["passed", "skipped", "waived"].includes(item.status),
    );
    const blockerDetails = await this.blockerDetailsForRun(run, requiredValidations);
    const blockers = blockerDetails.flatMap((blocker) =>
      blocker.retryable ? [] : [blocker.summary],
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
    const currentBlocker = blockerDetails.find((blocker) => !blocker.retryable);
    const diagnosticPublication =
      status === "blocked" && currentBlocker !== undefined
        ? await this.diagnosticPublicationForRun(run, currentBlocker)
        : undefined;

    return WorkflowStatusSchema.parse({
      runId: run.id,
      status,
      ...(currentStage === undefined ? {} : { currentStage: currentStage.name }),
      scope,
      deliveryProfile,
      workload,
      delegationPolicy: buildDelegationPolicy(workload.size),
      requiredValidations,
      stages: run.stages.map((item) => ({
        name: item.name,
        status: item.status,
        ...(item.name === "implementation" && item.checkpoint !== undefined
          ? { checkpoint: item.checkpoint.name }
          : {}),
      })),
      nextActions,
      blockers,
      blockerDetails,
      ...(diagnosticPublication === undefined ? {} : { diagnosticPublication }),
      resumeContext: resumeContextForRun(run),
    });
  }

  public async ensureBlockedDiagnosticReport(rawInput: unknown): Promise<ArtifactRef> {
    const input = WorkflowStatusInputSchema.parse(rawInput);
    const run = await this.dependencies.runStore.get(input.runId);
    const blocker = (
      await this.blockerDetailsForRun(
        run,
        requiredValidationsForRun(scopeFromRun(run), deliveryProfileFromRun(run)),
      )
    ).find((item) => !item.retryable);
    if (blocker === undefined) {
      throw new Error(`Run ${run.id} has no current non-retryable blocker`);
    }

    const blockedStageAttempt = stage(run, blocker.stage).attempt;
    const idempotencyKey = blockedDiagnosticReportKey(run, blocker);
    const existing = [...run.artifacts]
      .reverse()
      .find(
        (artifact) =>
          artifact.kind === "pr-report" &&
          artifact.metadata["reportIntent"] === "blocked-diagnostic" &&
          artifact.metadata["idempotencyKey"] === idempotencyKey,
      );
    if (existing !== undefined) return existing;

    const timestamp = this.now();
    const sourceRunRevision = run.revision;
    const markdown = renderBlockedWorkflowReport({
      runId: run.id,
      projectRoot: run.projectRoot,
      blocker,
    });
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
        ...WorkflowReportMetadataSchema.parse({
          reportKind: "pr-body-markdown",
          reportIntent: "blocked-diagnostic",
          decision: "blocked",
        }),
        locale: "en",
        blockedStage: blocker.stage,
        errorCode: blocker.code,
        blockedStageAttempt,
        sourceRunRevision,
        idempotencyKey,
      },
    });

    try {
      await this.dependencies.runStore.save(
        {
          ...run,
          revision: run.revision + 1,
          updatedAt: timestamp,
          artifacts: [...run.artifacts, artifact],
        },
        run.revision,
      );
    } catch (error: unknown) {
      if (!(error instanceof RevisionConflictError)) throw error;
      const winner = (await this.dependencies.runStore.get(run.id)).artifacts.find(
        (item) =>
          item.kind === "pr-report" &&
          item.metadata["reportIntent"] === "blocked-diagnostic" &&
          item.metadata["idempotencyKey"] === idempotencyKey,
      );
      if (winner === undefined) throw error;
      return winner;
    }
    return artifact;
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
    if (input.intent === "blocked-diagnostic") {
      return this.publishBlockedDiagnostic(input, run, publisher);
    }
    if (stage(run, "report").status !== "passed") {
      throw new Error("Ready publication requires a passed report stage");
    }
    if (reviewPacketFromRun(run) === undefined) {
      throw new Error("Ready publication requires the current implementation review packet");
    }
    await assertReviewPacketFresh(run);
    const packet = reviewPacketFromRun(run)!;
    const reportArtifact = readyReportArtifactForPacket(run, packet.id);
    if (reportArtifact === undefined) {
      throw new Error("Ready publication requires a ready report for the current review packet");
    }
    const reportMetadata = WorkflowReportMetadataSchema.safeParse({
      reportKind: reportArtifact.metadata["reportKind"],
      reportIntent: reportArtifact.metadata["reportIntent"],
      decision: reportArtifact.metadata["decision"],
    });
    if (
      !reportMetadata.success ||
      reportMetadata.data.reportIntent !== "ready" ||
      reportArtifact.metadata["reviewPacketId"] !== packet.id
    ) {
      throw new Error("Ready publication requires a ready report for the current review packet");
    }
    const baseInput = {
      runId: run.id,
      intent: input.intent,
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
      ...(packet.headSha === null ? {} : { headSha: packet.headSha }),
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

  private async publishBlockedDiagnostic(
    input: z.infer<typeof WorkflowPublishInputSchema>,
    run: RunManifest,
    publisher: PublisherService,
  ): Promise<unknown> {
    const workflowStatus = await this.status({ runId: run.id });
    const blocker = workflowStatus.blockerDetails.find((item) => !item.retryable);
    if (workflowStatus.status !== "blocked" || blocker === undefined) {
      throw new Error("Blocked diagnostic publication requires a currently blocked Run");
    }
    if (input.mode === "preview") {
      const skipped = blocker.kind === "publish-precondition";
      return {
        runId: run.id,
        intent: input.intent,
        mode: input.mode,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        willEnsureReport: true,
        eligibleForPublication: !skipped,
        preflightPending: !skipped,
        skipped,
        blocker: {
          stage: blocker.stage,
          code: blocker.code,
          kind: blocker.kind,
          exactUnblockAction: blocker.exactUnblockAction,
        },
      };
    }

    const executionIdentity = diagnosticExecutionIdentity(run, blocker, input);
    const executionKey = JSON.stringify(executionIdentity);
    const inFlight = this.diagnosticPublishFlights.get(executionKey);
    if (inFlight !== undefined) return inFlight;
    const flight = this.executeBlockedDiagnostic(
      input,
      run,
      publisher,
      blocker,
      executionIdentity,
    ).finally(() => {
      if (this.diagnosticPublishFlights.get(executionKey) === flight) {
        this.diagnosticPublishFlights.delete(executionKey);
      }
    });
    this.diagnosticPublishFlights.set(executionKey, flight);
    return flight;
  }

  private async executeBlockedDiagnostic(
    input: z.infer<typeof WorkflowPublishInputSchema>,
    run: RunManifest,
    publisher: PublisherService,
    blocker: WorkflowBlocker,
    executionIdentity: DiagnosticExecutionIdentity,
  ): Promise<unknown> {
    const reportArtifact = await this.ensureBlockedDiagnosticReport({ runId: run.id });
    const actualReportKey = reportArtifact.metadata["idempotencyKey"];
    if (
      reportArtifact.metadata["reportIntent"] !== "blocked-diagnostic" ||
      actualReportKey !== executionIdentity.reportKey
    ) {
      const stopped: DiagnosticContextChangedResult = {
        intent: "blocked-diagnostic",
        skipped: true,
        reason: "diagnostic-context-changed",
        retryable: true,
        expectedReportKey: executionIdentity.reportKey,
        actualReportKey: typeof actualReportKey === "string" ? actualReportKey : null,
        diagnosticReport: { artifactId: reportArtifact.id, path: reportArtifact.uri },
        status: await this.status({ runId: run.id }),
      };
      return stopped;
    }
    if (blocker.kind === "publish-precondition") {
      return {
        intent: input.intent,
        skipped: true,
        reason: "publish-precondition",
        localReportPath: reportArtifact.uri,
        diagnosticReport: { artifactId: reportArtifact.id, path: reportArtifact.uri },
        exactUnblockAction: blocker.exactUnblockAction,
        status: await this.status({ runId: run.id }),
      };
    }
    const runWithReport = await this.dependencies.runStore.get(run.id);
    const synchronized = await this.synchronizedDiagnosticPublishResultForRun(
      runWithReport,
      reportArtifact.id,
      executionIdentity,
    );
    if (synchronized !== undefined) {
      return { result: synchronized, status: await this.status({ runId: run.id }) };
    }
    const claim = await this.acquireDiagnosticPublishClaim(
      run.id,
      reportArtifact.id,
      executionIdentity,
      input.recoverUncertain,
    );
    if (claim.state === "synchronized") {
      return { result: claim.result, status: await this.status({ runId: run.id }) };
    }
    if (claim.state === "in-progress") {
      return {
        intent: "blocked-diagnostic",
        skipped: true,
        reason: "diagnostic-publication-in-progress",
        retryable: true,
        retryAfter: claim.expiresAt,
        diagnosticReport: { artifactId: reportArtifact.id, path: reportArtifact.uri },
        status: await this.status({ runId: run.id }),
      };
    }
    if (claim.state === "uncertain") {
      return diagnosticPublicationUncertainResult(
        reportArtifact,
        await this.status({ runId: run.id }),
      );
    }
    const baseInput = {
      runId: run.id,
      intent: input.intent,
      reportArtifactId: reportArtifact.id,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      remoteName: input.remoteName,
      mode: "draft" as const,
      pushBranch: input.pushBranch,
      labels: ["spec-to-pr"],
      reviewers: [],
      assignees: [],
    };
    try {
      const result = await this.withDiagnosticPublishClaimHeartbeat(
        run.id,
        claim.executionKey,
        claim.ownerClaimId,
        (signal) => publisher.publish({ ...baseInput, confirm: true }, { signal }),
      );
      await this.releaseDiagnosticPublishClaim(run.id, claim.executionKey, claim.ownerClaimId);
      return { result, status: await this.status({ runId: run.id }) };
    } catch (error: unknown) {
      if (error instanceof DiagnosticPublishClaimUncertainError) {
        await this.markDiagnosticPublishClaimUncertainBestEffort(
          run.id,
          claim.executionKey,
          claim.ownerClaimId,
        );
        return diagnosticPublicationUncertainResult(
          reportArtifact,
          await this.status({ runId: run.id }),
        );
      }
      await this.releaseDiagnosticPublishClaim(run.id, claim.executionKey, claim.ownerClaimId);
      throw error;
    }
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
    reviewPacket?: ImplementationReviewPacket,
  ): Promise<ArtifactRef> {
    const timestamp = this.now();
    const persistedSubmission = reconstructFailedSubmissionForPersistence(
      { ...run, artifacts: [...run.artifacts, ...evidenceArtifacts] },
      submission,
    );
    const failureContext = failureContextForSubmission(run, submission);
    const persistedSummary =
      persistedSubmission.kind === "figma-bundle"
        ? "Accepted host-connected Figma bundle."
        : persistedSubmission.summary;
    const content = `${JSON.stringify(persistedSubmission, null, 2)}\n`;
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
        ...(submission.kind === "figma-bundle"
          ? { summary: persistedSummary, status: "passed" }
          : { summary: persistedSummary }),
        ...("verdict" in submission ? { verdict: submission.verdict } : {}),
        ...("status" in submission ? { status: submission.status } : {}),
        ...(failureContext === undefined ? {} : failureContext),
        evidenceArtifactIds: evidenceArtifacts.map((item) => item.id),
        ...(submission.kind !== "contracts"
          ? {}
          : {
              requirementManifest: submission.requirementManifest,
              requirementIds: submission.requirementManifest.map((item) => item.id),
              ...(submission.legacyBaseline === undefined
                ? {}
                : { legacyBaseline: submission.legacyBaseline }),
            }),
        ...(submission.kind !== "implementation"
          ? {}
          : {
              changedFiles: submission.changedFiles,
              ...(reviewPacket === undefined ? {} : { reviewPacket }),
              ...(submission.featureEvidence === undefined
                ? {}
                : { featureVideoPath: submission.featureEvidence.videoPath }),
            }),
        ...(submission.kind !== "functional-review" && submission.kind !== "design-review"
          ? {}
          : {
              reviewPacketId: submission.reviewPacketId,
              reviewedRequirements: submission.requirements,
              gateResults: submission.gateResults,
              findings: submission.findings,
            }),
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

  private async recordWorkloadEstimate(runId: string, signals: WorkloadSignals): Promise<void> {
    const current = await this.dependencies.runStore.get(RunIdSchema.parse(runId));
    const intake = stage(current, "intake");
    if (intake.checkpoint === undefined) {
      throw new Error(`Run ${runId} is missing the intake checkpoint`);
    }
    const timestamp = this.now();
    const workload = estimateWorkload({
      phase: "contracts",
      mode: deliveryProfileFromRun(current).mode,
      scope: scopeFromRun(current),
      signals,
    });

    await this.dependencies.runStore.save(
      {
        ...current,
        revision: current.revision + 1,
        updatedAt: timestamp,
        stages: current.stages.map((item) =>
          item.name === "intake"
            ? {
                ...item,
                checkpoint: {
                  ...intake.checkpoint!,
                  data: { ...intake.checkpoint!.data, workload },
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
    const preparedEvidencePaths: Array<{
      evidencePath: string;
      resolvedPath: string;
      projectRelativePath: string;
    }> = [];

    for (const evidencePath of submission.artifactPaths) {
      if (path.isAbsolute(evidencePath)) {
        throw new Error(
          "Evidence path must be a project-relative durable evidence path within the project root",
        );
      }
      if (!isSafeDurableEvidencePath(evidencePath)) {
        throw new Error("Evidence path must be a safe durable evidence path");
      }
      const requestedPath = path.resolve(root, evidencePath);
      assertWithinProjectRoot(root, requestedPath, evidencePath);

      let resolvedPath: string;
      try {
        resolvedPath = await realpath(requestedPath);
      } catch {
        throw new Error(`Evidence file does not exist: ${evidencePath}`);
      }
      assertWithinProjectRoot(root, resolvedPath, evidencePath);
      const projectRelativePath = path.relative(root, resolvedPath).split(path.sep).join("/");
      if (!isSafeDurableEvidencePath(projectRelativePath)) {
        throw new Error("Evidence path must be a safe durable evidence path");
      }
      preparedEvidencePaths.push({ evidencePath, resolvedPath, projectRelativePath });
    }

    for (const { evidencePath, resolvedPath, projectRelativePath } of preparedEvidencePaths) {
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
        label: path.posix.basename(projectRelativePath),
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
            projectRelativePath,
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
    const packet = reviewPacketFromRun(run);
    if (packet === undefined) throw new Error("A current implementation review packet is required");
    await assertReviewPacketFresh(run);
    const submissions = await this.latestWorkflowSubmissions(run);
    const contracts = submissions.get("contracts");
    const implementation = submissions.get("implementation");
    const functional = submissions.get("functional-review");
    const design = submissions.get("design-review");
    if (contracts?.kind !== "contracts" || implementation?.kind !== "implementation") {
      throw new Error("PR report requires current contracts and implementation evidence");
    }
    const reviews = [functional, design].filter(
      (submission): submission is z.infer<typeof ReviewSubmissionSchema> =>
        submission?.kind === "functional-review" || submission?.kind === "design-review",
    );
    if (reviews.some((review) => review.reviewPacketId !== packet.id)) {
      throw new Error("PR report cannot use stale review packet evidence");
    }
    const reviewedRequirements = new Set(
      reviews.flatMap((review) => review.requirements.map((r) => r.id)),
    );
    const unreviewed = contracts.requirementManifest
      .map((requirement) => requirement.id)
      .filter((requirementId) => !reviewedRequirements.has(requirementId));
    if (unreviewed.length > 0) {
      throw new Error(`PR report requires review coverage for: ${unreviewed.join(", ")}`);
    }
    const evidencePaths = [
      ...new Set([contracts, implementation, ...reviews].flatMap((item) => item.artifactPaths)),
    ];
    const markdown = renderReadyWorkflowReport({
      runId: run.id,
      reviewPacket: packet,
      guidanceTrace: contracts.guidanceTrace,
      requirementManifest: contracts.requirementManifest,
      ...(contracts.legacyBaseline === undefined
        ? {}
        : { legacyBaseline: contracts.legacyBaseline }),
      evidencePaths,
      reviews,
      ...(implementation.featureEvidence === undefined
        ? {}
        : { featureVideoPath: implementation.featureEvidence.videoPath }),
    });
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
        ...WorkflowReportMetadataSchema.parse({
          reportKind: "pr-body-markdown",
          reportIntent: "ready",
          decision: "ready",
        }),
        locale: "ko",
        reviewPacketId: packet.id,
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

  private async latestWorkflowSubmissions(
    run: RunManifest,
  ): Promise<Map<string, WorkflowSubmission>> {
    const submissions = new Map<string, WorkflowSubmission>();
    for (const artifact of [...run.artifacts].reverse()) {
      const kind = artifact.metadata["workflowSubmissionKind"];
      if (
        typeof kind !== "string" ||
        submissions.has(kind) ||
        artifact.metadata["adapter"] !== "workflow-v2"
      ) {
        continue;
      }
      const parsed = WorkflowSubmissionSchema.safeParse(
        JSON.parse(
          (await this.dependencies.artifactStore.readContent(artifact.digest)).toString("utf8"),
        ),
      );
      if (parsed.success) submissions.set(kind, parsed.data);
    }
    return submissions;
  }

  private async diagnosticPublicationForRun(run: RunManifest, blocker: WorkflowBlocker) {
    const reportKey = blockedDiagnosticReportKey(run, blocker);
    const blockedStageAttempt = stage(run, blocker.stage).attempt;
    for (const artifact of [...run.artifacts].reverse()) {
      if (artifact.metadata["reportKind"] !== "publish-result") continue;

      let parsed: ReturnType<typeof PublishResultSchema.safeParse>;
      try {
        parsed = PublishResultSchema.safeParse(
          JSON.parse(
            (await this.dependencies.artifactStore.readContent(artifact.digest)).toString("utf8"),
          ),
        );
      } catch {
        continue;
      }
      if (!parsed.success || parsed.data.request === undefined) continue;
      const reportArtifact = run.artifacts.find(
        (candidate) => candidate.id === parsed.data.reportArtifactId,
      );
      if (
        reportArtifact?.metadata["reportIntent"] !== "blocked-diagnostic" ||
        reportArtifact.metadata["idempotencyKey"] !== reportKey ||
        reportArtifact.metadata["blockedStage"] !== blocker.stage ||
        reportArtifact.metadata["errorCode"] !== blocker.code ||
        reportArtifact.metadata["blockedStageAttempt"] !== blockedStageAttempt
      ) {
        continue;
      }

      const request = parsed.data.request;
      const summary = DiagnosticPublicationSchema.safeParse({
        host: request.host,
        url: request.url,
        number: request.number,
        created: request.created,
        updated: request.updated,
        publishResultArtifactId: artifact.id,
      });
      if (summary.success) return summary.data;
    }
    return undefined;
  }

  private async synchronizedDiagnosticPublishResultForRun(
    run: RunManifest,
    reportArtifactId: string,
    executionIdentity: DiagnosticExecutionIdentity,
  ) {
    for (const artifact of [...run.artifacts].reverse()) {
      if (artifact.metadata["reportKind"] !== "publish-result") continue;
      let parsed: ReturnType<typeof PublishResultSchema.safeParse>;
      try {
        parsed = PublishResultSchema.safeParse(
          JSON.parse(
            (await this.dependencies.artifactStore.readContent(artifact.digest)).toString("utf8"),
          ),
        );
      } catch {
        continue;
      }
      if (
        !parsed.success ||
        parsed.data.reportArtifactId !== reportArtifactId ||
        artifact.metadata["diagnosticReportKey"] !== executionIdentity.reportKey ||
        artifact.metadata["sourceBranch"] !== executionIdentity.sourceBranch ||
        artifact.metadata["targetBranch"] !== executionIdentity.targetBranch ||
        artifact.metadata["remoteName"] !== executionIdentity.remoteName ||
        artifact.metadata["pushBranch"] !== executionIdentity.pushBranch ||
        !diagnosticPublishResultIsFullySynced(parsed.data)
      ) {
        continue;
      }
      return {
        run: summarizeRun(run),
        result: parsed.data,
        publishResultArtifactId: artifact.id,
      };
    }
    return undefined;
  }

  private async acquireDiagnosticPublishClaim(
    runId: string,
    reportArtifactId: string,
    executionIdentity: DiagnosticExecutionIdentity,
    recoverUncertain: boolean,
  ) {
    const executionKey = diagnosticClaimFenceKey(executionIdentity);

    for (let attempt = 0; attempt < MAX_DIAGNOSTIC_CLAIM_ATTEMPTS; attempt += 1) {
      const run = await this.dependencies.runStore.get(RunIdSchema.parse(runId));
      const synchronized = await this.synchronizedDiagnosticPublishResultForRun(
        run,
        reportArtifactId,
        executionIdentity,
      );
      if (synchronized !== undefined) {
        return { state: "synchronized" as const, result: synchronized };
      }

      const timestamp = this.now();
      const activeClaim = latestDiagnosticPublishClaimEvent(run, executionKey);
      if (diagnosticPublishClaimIsActive(activeClaim, timestamp)) {
        return {
          state: "in-progress" as const,
          expiresAt: activeClaim?.metadata["expiresAt"] as string,
        };
      }
      if (
        activeClaim !== undefined &&
        (activeClaim.metadata["claimState"] === "uncertain" ||
          activeClaim.metadata["claimState"] === "active") &&
        !recoverUncertain
      ) {
        return { state: "uncertain" as const };
      }

      const ownerClaimId = createArtifactId();
      const expiresAt = new Date(Date.parse(timestamp) + this.externalLeaseTtlMs).toISOString();
      const artifact = await this.writeDiagnosticPublishClaimEvent({
        artifactId: ownerClaimId,
        executionKey,
        ownerClaimId,
        state: "active",
        timestamp,
        expiresAt,
      });
      try {
        await this.dependencies.runStore.save(
          {
            ...run,
            revision: run.revision + 1,
            updatedAt: timestamp,
            artifacts: [...run.artifacts, artifact],
          },
          run.revision,
        );
        return { state: "acquired" as const, executionKey, ownerClaimId };
      } catch (error: unknown) {
        if (!(error instanceof RevisionConflictError)) throw error;
      }
    }

    throw new Error(`Could not acquire blocked-diagnostic publication claim for Run ${runId}`);
  }

  private async withDiagnosticPublishClaimHeartbeat<T>(
    runId: string,
    executionKey: string,
    ownerClaimId: string,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let ownershipFailure: DiagnosticPublishClaimUncertainError | undefined;
    let rejectOwnershipLoss!: (error: DiagnosticPublishClaimUncertainError) => void;
    const ownershipLoss = new Promise<never>((_resolve, reject) => {
      rejectOwnershipLoss = reject;
    });
    let heartbeatChain = Promise.resolve();
    const loseOwnership = (error: unknown) => {
      if (ownershipFailure !== undefined) return;
      ownershipFailure = new DiagnosticPublishClaimUncertainError(
        "Blocked-diagnostic publication ownership became uncertain.",
        error,
      );
      controller.abort(ownershipFailure);
      rejectOwnershipLoss(ownershipFailure);
    };
    const timer = setInterval(() => {
      heartbeatChain = heartbeatChain
        .then(async () => {
          if (ownershipFailure !== undefined) return;
          const renewed = await this.renewDiagnosticPublishClaim(runId, executionKey, ownerClaimId);
          if (!renewed) {
            throw new Error("Blocked-diagnostic publication claim ownership was lost");
          }
        })
        .catch((error: unknown) => {
          loseOwnership(error);
        });
    }, this.externalHeartbeatMs);
    timer.unref();

    const operationPromise = operation(controller.signal);
    try {
      const result = await Promise.race([operationPromise, ownershipLoss]);
      clearInterval(timer);
      await heartbeatChain;
      if (ownershipFailure !== undefined) throw ownershipFailure;
      return result;
    } catch (error: unknown) {
      clearInterval(timer);
      if (ownershipFailure !== undefined) {
        void operationPromise.catch(() => undefined);
        throw ownershipFailure;
      }
      await heartbeatChain;
      if (ownershipFailure !== undefined) {
        void operationPromise.catch(() => undefined);
        throw ownershipFailure;
      }
      throw error;
    }
  }

  private async renewDiagnosticPublishClaim(
    runId: string,
    executionKey: string,
    ownerClaimId: string,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_DIAGNOSTIC_CLAIM_ATTEMPTS; attempt += 1) {
      const run = await this.dependencies.runStore.get(RunIdSchema.parse(runId));
      const latest = latestDiagnosticPublishClaimEvent(run, executionKey);
      if (
        latest?.metadata["claimState"] !== "active" ||
        latest.metadata["ownerClaimId"] !== ownerClaimId
      ) {
        return false;
      }

      const timestamp = this.now();
      const expiresAt = new Date(Date.parse(timestamp) + this.externalLeaseTtlMs).toISOString();
      const artifact = await this.writeDiagnosticPublishClaimEvent({
        artifactId: createArtifactId(),
        executionKey,
        ownerClaimId,
        state: "active",
        timestamp,
        expiresAt,
      });
      try {
        await this.dependencies.runStore.save(
          {
            ...run,
            revision: run.revision + 1,
            updatedAt: timestamp,
            artifacts: [...run.artifacts, artifact],
          },
          run.revision,
        );
        return true;
      } catch (error: unknown) {
        if (!(error instanceof RevisionConflictError)) throw error;
      }
    }

    throw new Error(`Could not renew blocked-diagnostic publication claim for Run ${runId}`);
  }

  private async releaseDiagnosticPublishClaim(
    runId: string,
    executionKey: string,
    ownerClaimId: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_DIAGNOSTIC_CLAIM_ATTEMPTS; attempt += 1) {
      const run = await this.dependencies.runStore.get(RunIdSchema.parse(runId));
      const latest = latestDiagnosticPublishClaimEvent(run, executionKey);
      if (
        latest?.metadata["claimState"] !== "active" ||
        latest.metadata["ownerClaimId"] !== ownerClaimId
      ) {
        return;
      }

      const timestamp = this.now();
      const artifact = await this.writeDiagnosticPublishClaimEvent({
        artifactId: createArtifactId(),
        executionKey,
        ownerClaimId,
        state: "released",
        timestamp,
      });
      try {
        await this.dependencies.runStore.save(
          {
            ...run,
            revision: run.revision + 1,
            updatedAt: timestamp,
            artifacts: [...run.artifacts, artifact],
          },
          run.revision,
        );
        return;
      } catch (error: unknown) {
        if (!(error instanceof RevisionConflictError)) throw error;
      }
    }

    throw new Error(`Could not release blocked-diagnostic publication claim for Run ${runId}`);
  }

  private async markDiagnosticPublishClaimUncertainBestEffort(
    runId: string,
    executionKey: string,
    ownerClaimId: string,
  ): Promise<void> {
    try {
      for (let attempt = 0; attempt < MAX_DIAGNOSTIC_CLAIM_ATTEMPTS; attempt += 1) {
        const run = await this.dependencies.runStore.get(RunIdSchema.parse(runId));
        const latest = latestDiagnosticPublishClaimEvent(run, executionKey);
        if (
          latest?.metadata["ownerClaimId"] !== ownerClaimId ||
          latest.metadata["claimState"] === "released"
        ) {
          return;
        }
        if (latest.metadata["claimState"] === "uncertain") return;

        const timestamp = this.now();
        const artifact = await this.writeDiagnosticPublishClaimEvent({
          artifactId: createArtifactId(),
          executionKey,
          ownerClaimId,
          state: "uncertain",
          timestamp,
        });
        try {
          await this.dependencies.runStore.save(
            {
              ...run,
              revision: run.revision + 1,
              updatedAt: timestamp,
              artifacts: [...run.artifacts, artifact],
            },
            run.revision,
          );
          return;
        } catch (error: unknown) {
          if (!(error instanceof RevisionConflictError)) return;
        }
      }
    } catch {
      // The expired active claim still fences automatic takeover if this best-effort marker fails.
    }
  }

  private async writeDiagnosticPublishClaimEvent(input: {
    artifactId: string;
    executionKey: string;
    ownerClaimId: string;
    state: "active" | "released" | "uncertain";
    timestamp: string;
    expiresAt?: string;
  }): Promise<ArtifactRef> {
    const value = {
      event:
        input.state === "active" ? "claim" : input.state === "released" ? "release" : "uncertain",
      executionKey: input.executionKey,
      ownerClaimId: input.ownerClaimId,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    };
    const blob = await this.dependencies.artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(value)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: input.timestamp,
      label: "diagnostic-publish-claim.json",
    });
    return ArtifactRefSchema.parse({
      id: input.artifactId,
      kind: "agent-result-report",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: input.timestamp,
      metadata: {
        adapter: "workflow-v2",
        reportKind: "diagnostic-publish-claim",
        diagnosticExecutionKey: input.executionKey,
        claimState: input.state,
        ownerClaimId: input.ownerClaimId,
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      },
    });
  }

  private async blockerDetailsForRun(
    run: RunManifest,
    requiredValidations: string[],
  ): Promise<WorkflowBlocker[]> {
    const blockers: WorkflowBlocker[] = [];
    for (const item of run.stages) {
      if (item.error === undefined) continue;
      const submission = await this.causativeWorkflowSubmission(run, item);
      const blocker = submission === undefined ? undefined : blockerFromSubmission(submission);
      blockers.push(
        blocker === undefined
          ? deriveWorkflowBlocker(
              run,
              item,
              requiredValidations,
              submission === undefined ? undefined : "unexpected",
            )
          : reconstructWorkflowBlocker(run, blocker, item),
      );
    }
    return blockers;
  }

  private async causativeWorkflowSubmission(
    run: RunManifest,
    failedStage: StageState,
  ): Promise<WorkflowSubmission | undefined> {
    const artifacts = new Map(run.artifacts.map((artifact) => [artifact.id, artifact]));
    for (const artifactId of [...failedStage.artifactIds].reverse()) {
      const artifact = artifacts.get(artifactId);
      if (
        artifact?.metadata["adapter"] !== "workflow-v2" ||
        artifact.metadata["workflowFailureStage"] !== failedStage.name ||
        artifact.metadata["workflowFailureAttempt"] !== failedStage.attempt
      ) {
        continue;
      }
      const parsed = WorkflowSubmissionSchema.safeParse(
        JSON.parse(
          (await this.dependencies.artifactStore.readContent(artifact.digest)).toString("utf8"),
        ),
      );
      if (
        parsed.success &&
        parsed.data.kind !== "figma-bundle" &&
        submissionOutcome(parsed.data) !== "passed"
      ) {
        return parsed.data;
      }
    }
    return undefined;
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
type DiagnosticExecutionIdentity = {
  runId: string;
  reportKey: string;
  sourceBranch: string;
  targetBranch: string;
  remoteName: string;
  pushBranch: boolean;
};
type DiagnosticClaimFenceIdentity = Pick<
  DiagnosticExecutionIdentity,
  "runId" | "reportKey" | "sourceBranch" | "targetBranch"
>;
type DiagnosticContextChangedResult = {
  intent: "blocked-diagnostic";
  skipped: true;
  reason: "diagnostic-context-changed";
  retryable: true;
  expectedReportKey: string;
  actualReportKey: string | null;
  diagnosticReport: { artifactId: string; path: string };
  status: WorkflowStatus;
};

class DiagnosticPublishClaimUncertainError extends Error {
  public override readonly name = "DiagnosticPublishClaimUncertainError";

  public constructor(
    message: string,
    public readonly ownershipCause: unknown,
  ) {
    super(message);
  }
}

const DIAGNOSTIC_RECOVERY_INSTRUCTION =
  "Inspect the matching provider draft and durable publish result, then retry workflow_publish with recoverUncertain=true only after confirming no publication is still active.";

function diagnosticPublicationUncertainResult(reportArtifact: ArtifactRef, status: WorkflowStatus) {
  return {
    intent: "blocked-diagnostic" as const,
    skipped: true as const,
    reason: "diagnostic-publication-uncertain" as const,
    retryable: false as const,
    exactRecoveryInstruction: DIAGNOSTIC_RECOVERY_INSTRUCTION,
    diagnosticReport: { artifactId: reportArtifact.id, path: reportArtifact.uri },
    status,
  };
}

function blockedDiagnosticReportKey(run: RunManifest, blocker: WorkflowBlocker): string {
  return `${blocker.stage}:${stage(run, blocker.stage).attempt}:${blocker.code}`;
}

function diagnosticExecutionIdentity(
  run: RunManifest,
  blocker: WorkflowBlocker,
  input: z.infer<typeof WorkflowPublishInputSchema>,
): DiagnosticExecutionIdentity {
  return {
    runId: run.id,
    reportKey: blockedDiagnosticReportKey(run, blocker),
    sourceBranch: input.sourceBranch,
    targetBranch: input.targetBranch,
    remoteName: input.remoteName,
    pushBranch: input.pushBranch,
  };
}

function diagnosticClaimFenceKey(identity: DiagnosticExecutionIdentity): string {
  const fenceIdentity: DiagnosticClaimFenceIdentity = {
    runId: identity.runId,
    reportKey: identity.reportKey,
    sourceBranch: identity.sourceBranch,
    targetBranch: identity.targetBranch,
  };
  return createHash("sha256").update(JSON.stringify(fenceIdentity)).digest("hex");
}

function latestDiagnosticPublishClaimEvent(
  run: RunManifest,
  executionKey: string,
): ArtifactRef | undefined {
  return [...run.artifacts]
    .reverse()
    .find(
      (artifact) =>
        artifact.metadata["reportKind"] === "diagnostic-publish-claim" &&
        artifact.metadata["diagnosticExecutionKey"] === executionKey,
    );
}

function diagnosticPublishClaimIsActive(
  artifact: ArtifactRef | undefined,
  timestamp: string,
): boolean {
  const expiresAt = artifact?.metadata["expiresAt"];
  return (
    artifact?.metadata["claimState"] === "active" &&
    typeof expiresAt === "string" &&
    Date.parse(expiresAt) > Date.parse(timestamp)
  );
}

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

function diagnosticPublishResultIsFullySynced(result: PublisherResult): boolean {
  return (
    result.status === "blocked" &&
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

function blockerFromSubmission(submission: WorkflowSubmission): WorkflowBlocker | undefined {
  return "blocker" in submission ? submission.blocker : undefined;
}

function reconstructFailedSubmissionForPersistence(
  run: RunManifest,
  submission: WorkflowSubmission,
): WorkflowSubmission {
  if (submission.kind === "figma-bundle" || submission.kind === "api-ready") return submission;
  const successful =
    "verdict" in submission ? submission.verdict === "approved" : submission.status === "passed";
  if (successful) return submission;

  const rawBlocker = blockerFromSubmission(submission);
  const blocker =
    rawBlocker === undefined
      ? undefined
      : reconstructWorkflowBlocker(run, rawBlocker, stage(run, rawBlocker.stage));
  return {
    ...submission,
    summary: blocker?.summary ?? genericBlockerSummary(submission.kind, "unexpected"),
    ...(blocker === undefined ? {} : { blocker }),
  };
}

function failureContextForSubmission(
  run: RunManifest,
  submission: WorkflowSubmission,
):
  | {
      workflowStageName: RunStageName;
      workflowStageAttempt: number;
      workflowFailureStage: RunStageName;
      workflowFailureAttempt: number;
    }
  | undefined {
  if (submission.kind === "figma-bundle" || submission.kind === "api-ready") return undefined;
  const successful =
    "verdict" in submission ? submission.verdict === "approved" : submission.status === "passed";
  if (successful) return undefined;

  const submissionStage = stageForSubmission(submission);
  const failureStage =
    (submission.kind === "functional-review" || submission.kind === "design-review") &&
    submission.verdict === "changes-requested"
      ? "implementation"
      : submissionStage;
  return {
    workflowStageName: submissionStage,
    workflowStageAttempt: stage(run, submissionStage).attempt,
    workflowFailureStage: failureStage,
    workflowFailureAttempt: stage(run, failureStage).attempt,
  };
}

function reconstructWorkflowBlocker(
  run: RunManifest,
  blocker: WorkflowBlocker,
  failedStage: StageState,
): WorkflowBlocker {
  const requiredValidations = requiredValidationsForRun(
    scopeFromRun(run),
    deliveryProfileFromRun(run),
  );
  const trustedEvidencePaths = new Set(
    run.artifacts.flatMap((artifact) => {
      const projectPath = artifact.metadata["projectRelativePath"];
      return typeof projectPath === "string" && isSafeDurableEvidencePath(projectPath)
        ? [projectPath]
        : [];
    }),
  );
  return WorkflowBlockerSchema.parse({
    stage: blocker.stage,
    code: blockerCodeForKind(blocker.kind),
    kind: blocker.kind,
    summary: genericBlockerSummary(blocker.stage, blocker.kind),
    retryable: blocker.retryable,
    resumable: blocker.resumable,
    completedWork: completedWorkForRun(run),
    evidencePaths: blocker.evidencePaths.filter(
      (evidencePath) =>
        isSafeDurableEvidencePath(evidencePath) && trustedEvidencePaths.has(evidencePath),
    ),
    attemptedRecovery: attemptedRecoveryForStage(failedStage),
    unrunValidations: remainingValidationsForRun(run, requiredValidations),
    exactUnblockAction: genericUnblockAction(blocker.stage, blocker.kind),
  });
}

function blockerCodeForKind(kind: WorkflowBlocker["kind"]): string {
  if (kind === "missing-input") return "MISSING_INPUT";
  if (kind === "missing-tool") return "MISSING_TOOL";
  if (kind === "policy") return "POLICY_BLOCKER";
  if (kind === "verification") return "VERIFICATION_BLOCKED";
  if (kind === "publish-precondition") return "PUBLISH_PRECONDITION";
  if (kind === "budget-split") return "BUDGET_SPLIT_REQUIRED";
  return "UNEXPECTED_BLOCKER";
}

function completedWorkForRun(run: RunManifest): string[] {
  return run.stages
    .filter((item) => ["passed", "skipped", "waived"].includes(item.status))
    .map((item) => `${item.name} stage ${item.status}.`);
}

function attemptedRecoveryForStage(failedStage: StageState): string[] {
  const executionCount = failedStage.attempt + 1;
  return executionCount <= 1
    ? []
    : [`The ${failedStage.name} stage was attempted ${executionCount} times.`];
}

function deriveWorkflowBlocker(
  run: RunManifest,
  failedStage: StageState,
  requiredValidations: string[],
  kindOverride?: WorkflowBlocker["kind"],
): WorkflowBlocker {
  if (failedStage.error === undefined) {
    throw new Error(`Cannot derive a blocker for ${failedStage.name} without a stage error`);
  }
  const kind = kindOverride ?? blockerKindForStageError(failedStage.name, failedStage.error.code);
  const code = canonicalDurableBlockerCode(kind, failedStage.error.code);
  const evidencePaths = [
    ...new Set(
      run.artifacts.flatMap((artifact) => {
        const projectPath = artifact.metadata["projectRelativePath"];
        if (typeof projectPath !== "string" || !isSafeDurableEvidencePath(projectPath)) return [];
        return [projectPath];
      }),
    ),
  ].slice(-50);

  return WorkflowBlockerSchema.parse({
    stage: failedStage.name,
    code,
    kind,
    summary: genericBlockerSummary(failedStage.name, kind),
    retryable: failedStage.error.retryable,
    resumable: true,
    completedWork: completedWorkForRun(run),
    evidencePaths,
    attemptedRecovery: attemptedRecoveryForStage(failedStage),
    unrunValidations: remainingValidationsForRun(run, requiredValidations),
    exactUnblockAction: genericUnblockAction(failedStage.name, kind),
  });
}

function remainingValidationsForRun(run: RunManifest, requiredValidations: string[]): string[] {
  const completed = completedValidationsForRun(run);
  return [...new Set(requiredValidations)]
    .filter((validation) => !completed.has(validation))
    .slice(0, 20);
}

function completedValidationsForRun(run: RunManifest): Set<string> {
  const completed = new Set<string>();
  const artifacts = new Map(run.artifacts.map((artifact) => [artifact.id, artifact]));
  const latestStageSubmission = (stageName: "contracts" | "functional-review" | "design-review") =>
    [...stage(run, stageName).artifactIds]
      .reverse()
      .map((artifactId) => artifacts.get(artifactId))
      .find(
        (artifact) =>
          artifact?.metadata["adapter"] === "workflow-v2" &&
          artifact.metadata["workflowSubmissionKind"] === stageName,
      );

  for (const reviewStage of ["functional-review", "design-review"] as const) {
    const gateResults = latestStageSubmission(reviewStage)?.metadata["gateResults"];
    if (!Array.isArray(gateResults)) continue;
    for (const result of gateResults) {
      if (
        typeof result === "object" &&
        result !== null &&
        "id" in result &&
        "status" in result &&
        typeof result.id === "string" &&
        result.status === "passed"
      ) {
        completed.add(result.id);
      }
    }
  }

  if (stage(run, "contracts").status === "passed") {
    const legacyBaseline = latestStageSubmission("contracts")?.metadata["legacyBaseline"];
    if (
      typeof legacyBaseline === "object" &&
      legacyBaseline !== null &&
      "checks" in legacyBaseline &&
      Array.isArray(legacyBaseline.checks) &&
      legacyBaseline.checks.length > 0 &&
      legacyBaseline.checks.every(
        (check) =>
          typeof check === "object" &&
          check !== null &&
          "status" in check &&
          check.status === "passed",
      )
    ) {
      completed.add("legacy-baseline");
    }
  }

  const implementation = stage(run, "implementation");
  if (implementation.status === "passed") {
    for (const artifactId of implementation.artifactIds) {
      const role = artifacts.get(artifactId)?.metadata["featureEvidenceRole"];
      if (role === "result") completed.add("targeted-feature-e2e");
      if (role === "video") completed.add("feature-video");
    }
  }
  if (implementation.checkpoint?.data["apiReady"] === true) completed.add("api-ready");

  if (
    run.artifacts.some(
      (artifact) =>
        artifact.metadata["adapter"] === "workflow-v2" &&
        artifact.metadata["workflowSubmissionKind"] === "figma-bundle" &&
        artifact.metadata["status"] === "passed",
    )
  ) {
    completed.add("figma-bundle");
  }

  if (
    stage(run, "publish").artifactIds.some(
      (artifactId) => artifacts.get(artifactId)?.metadata["reportKind"] === "publish-result",
    )
  ) {
    completed.add("draft-publication-preflight");
  }

  return completed;
}

const KNOWN_DURABLE_BLOCKER_CODES = new Set([
  "WORKFLOW_BLOCKED",
  "CHANGES_REQUESTED",
  "REVIEW_CHANGES_REQUESTED",
  "PUBLISH_PARTIAL",
  "PUBLISH_FAILED",
  "PUBLISH_BLOCKED",
  "PUBLISH_PRECONDITION",
  "PUBLISH_UNEXPECTED_ERROR",
  "ARCHIVE_FAILED",
  "ARCHIVE_UNEXPECTED_ERROR",
]);

function canonicalDurableBlockerCode(kind: WorkflowBlocker["kind"], rawCode: string): string {
  return KNOWN_DURABLE_BLOCKER_CODES.has(rawCode) ? rawCode : blockerCodeForKind(kind);
}

function blockerKindForStageError(stageName: RunStageName, code: string): WorkflowBlocker["kind"] {
  if (/UNEXPECTED/.test(code)) return "unexpected";
  if (code === "WORKFLOW_BLOCKED") return "unexpected";
  if (code === "REVIEW_CHANGES_REQUESTED") return "unexpected";
  if (/BUDGET|TOKEN_LIMIT|CONTEXT_LIMIT/.test(code)) return "budget-split";
  if (/MISSING_(?:INPUT|CONTEXT|APPROVAL|EVIDENCE)/.test(code)) return "missing-input";
  if (/MISSING_TOOL|TOOL_UNAVAILABLE|RUNTIME_UNAVAILABLE/.test(code)) return "missing-tool";
  if (stageName === "publish" || /^PUBLISH_/.test(code)) return "publish-precondition";
  if (/POLICY|PRECONDITION/.test(code)) return "policy";
  if (
    stageName === "functional-review" ||
    stageName === "design-review" ||
    /REVIEW|VERIFY|VALIDATION|TEST/.test(code)
  ) {
    return "verification";
  }
  return "unexpected";
}

function genericBlockerSummary(stageName: RunStageName, kind: WorkflowBlocker["kind"]): string {
  const reason =
    kind === "missing-input"
      ? "required input is missing"
      : kind === "missing-tool"
        ? "a required tool is unavailable"
        : kind === "policy"
          ? "a policy condition is unmet"
          : kind === "verification"
            ? "verification requires attention"
            : kind === "publish-precondition"
              ? "a publication precondition is unmet"
              : kind === "budget-split"
                ? "the remaining work must be split"
                : "an unexpected condition requires attention";
  return `The ${stageName} stage stopped because ${reason}.`;
}

function genericUnblockAction(stageName: RunStageName, kind: WorkflowBlocker["kind"]): string {
  if (kind === "missing-input") return `Provide the missing input and resume ${stageName}.`;
  if (kind === "missing-tool") return `Enable the required tool and resume ${stageName}.`;
  if (kind === "policy") return `Resolve the policy condition and retry ${stageName}.`;
  if (kind === "verification") return `Address the verification result and rerun ${stageName}.`;
  if (kind === "publish-precondition") {
    return `Satisfy the publication precondition and retry ${stageName}.`;
  }
  if (kind === "budget-split") return `Split the remaining work before resuming ${stageName}.`;
  return `Inspect sanitized diagnostics and retry ${stageName} when safe.`;
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

function workloadFromRun(
  run: RunManifest,
  scope: WorkflowScope,
  profile: DeliveryProfile,
): WorkloadEstimate {
  const rawWorkload = stage(run, "intake").checkpoint?.data["workload"];
  const parsed = WorkloadEstimateSchema.safeParse(rawWorkload);
  if (parsed.success) return parsed.data;

  return estimateWorkload({
    phase: "intake",
    mode: profile.mode,
    scope,
    signals: {
      requirements: 1,
      apiOperations: scope.api ? 1 : 0,
      uiSurfaces: scope.ui ? 1 : 0,
      figmaNodes: profile.figmaUrl === undefined ? 0 : 1,
      testTargets: scope.code ? 1 : 0,
      uncertainty: 5,
    },
  });
}

function countIntakeRequirements(text: string): number {
  const explicitLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*+] |\d+[.)] )/.test(line)).length;
  if (explicitLines > 0) return Math.min(explicitLines, 50);

  const sentences = text
    .split(/[.!?\n]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 3).length;
  return Math.max(1, Math.min(sentences, 50));
}

function requiredValidationsForRun(scope: WorkflowScope, profile: DeliveryProfile): string[] {
  const validations: string[] = buildGatePlan(scope)
    .filter((gate) => gate.applicability === "required")
    .map((gate) => gate.id);
  if (profile.requirements.legacyBaseline) validations.push("legacy-baseline");
  if (profile.requirements.targetedFeatureE2E) validations.push("targeted-feature-e2e");
  if (profile.requirements.featureVideo) validations.push("feature-video");
  if (profile.requirements.figmaBundle) validations.push("figma-bundle");
  if (scope.ui && scope.api) validations.push("api-ready");
  if (profile.publication === "draft") validations.push("draft-publication-preflight");
  return validations;
}

function resumeContextForRun(run: RunManifest): WorkflowStatus["resumeContext"] {
  const goal = run.evidence
    .filter((item) => item.metadata["itemType"] === "instruction")
    .map((item) => item.excerpt)
    .filter((excerpt): excerpt is string => excerpt !== undefined)
    .join("\n\n")
    .slice(0, 4_000)
    .trim();
  const allEvidencePaths = [
    ...new Set(
      run.artifacts.flatMap((artifact) => {
        const projectPath = artifact.metadata["projectRelativePath"];
        return typeof projectPath === "string" && isSafeDurableEvidencePath(projectPath)
          ? [projectPath]
          : [];
      }),
    ),
  ].filter((projectPath) => projectPath.length <= 1_000);
  const evidencePaths =
    allEvidencePaths.length <= 200
      ? allEvidencePaths
      : [...allEvidencePaths.slice(0, 50), ...allEvidencePaths.slice(-150)];
  const submissionsByKind = new Map<
    string,
    WorkflowStatus["resumeContext"]["submissions"][number]
  >();
  run.artifacts.forEach((artifact) => {
    const kind = artifact.metadata["workflowSubmissionKind"];
    const summary = artifact.metadata["summary"];
    const outcome = artifact.metadata["status"] ?? artifact.metadata["verdict"];
    if (typeof kind === "string" && typeof summary === "string" && typeof outcome === "string") {
      submissionsByKind.set(kind, { kind, summary: summary.slice(0, 500), outcome });
    }
  });
  const submissions = [...submissionsByKind.values()].slice(-16);

  return {
    goal: goal === "" ? "Continue the recorded spec-to-pr Run." : goal,
    evidencePaths,
    submissions,
  };
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
  const packet = reviewPacketFromRun(run);
  if (packet === undefined) {
    throw new Error(`Run ${run.id} has no implementation review packet`);
  }

  const actions = [];
  if (isActionable(stage(run, "functional-review"))) {
    actions.push(
      WorkflowActionSchema.parse({
        kind: "review-functional",
        runId: run.id,
        reviewPacketId: packet.id,
      }),
    );
  }
  if (scope.ui && isActionable(stage(run, "design-review"))) {
    actions.push(
      WorkflowActionSchema.parse({
        kind: "review-design",
        runId: run.id,
        reviewPacketId: packet.id,
      }),
    );
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
    submission.legacyBaseline === undefined
  ) {
    throw new Error("Legacy mode requires a focused baseline before contracts can pass");
  }
  if (
    submission.kind === "contracts" &&
    submission.status === "passed" &&
    (!sameStringMembers(submission.guidanceTrace.explicit, profile.guidancePaths) ||
      !sameStringMembers(submission.guidanceTrace.discovered, profile.discoveredGuidancePaths))
  ) {
    throw new Error("Passed contracts must report every explicit and discovered guidance path");
  }
  if (
    submission.kind === "contracts" &&
    submission.status === "passed" &&
    submission.guidanceTrace.skillHints.some((skillHint) => !profile.skillHints.includes(skillHint))
  ) {
    throw new Error("Every applied skill hint must be requested in the delivery profile");
  }
  if (submission.kind === "contracts" && submission.status === "passed") {
    const allowedSkills = new Set([...profile.skillHints, ...profile.recommendedSkills]);
    const unapprovedSkills = submission.guidanceTrace.appliedSkills.filter(
      (skill) => !allowedSkills.has(skill),
    );
    if (unapprovedSkills.length > 0) {
      throw new Error(
        `Every applied skill must be explicitly hinted or deterministically recommended: ${unapprovedSkills.join(", ")}`,
      );
    }
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
  if (submission.kind === "functional-review" || submission.kind === "design-review") {
    const packet = reviewPacketFromRun(run);
    if (packet === undefined || submission.reviewPacketId !== packet.id) {
      throw new Error("Review submission must reference the current implementation review packet");
    }
    const requirementIds = contractRequirementIds(run);
    const unknownRequirements = submission.requirements
      .map((requirement) => requirement.id)
      .filter((requirementId) => !requirementIds.has(requirementId));
    if (unknownRequirements.length > 0) {
      throw new Error(
        `Review references requirements outside the contract manifest: ${unknownRequirements.join(", ")}`,
      );
    }
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

function contractRequirementIds(run: RunManifest): Set<string> {
  const artifact = [...run.artifacts]
    .reverse()
    .find((item) => item.metadata["workflowSubmissionKind"] === "contracts");
  const rawIds = artifact?.metadata["requirementIds"];
  if (!Array.isArray(rawIds) || rawIds.some((value) => typeof value !== "string")) {
    throw new Error("The contracts stage is missing its structured requirement manifest");
  }
  return new Set(rawIds as string[]);
}

function reviewPacketFromRun(run: RunManifest): ImplementationReviewPacket | undefined {
  const parsed = ImplementationReviewPacketSchema.safeParse(
    stage(run, "implementation").checkpoint?.data["reviewPacket"],
  );
  return parsed.success ? parsed.data : undefined;
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

type ProjectTextFile = {
  path: string;
  resolvedPath: string;
};

type ProjectTextSource = ProjectTextFile & {
  text: string;
  chunks: string[];
};

type PreparedComposableSources = {
  brief?: ProjectTextSource;
  docs: ProjectTextSource[];
  openApi: ProjectTextSource[];
  guidance: ProjectTextSource[];
  discoveredGuidance: ProjectTextSource[];
  skillHints: string[];
};

async function prepareComposableSources(
  input: z.infer<typeof WorkflowStartInputSchema>,
): Promise<PreparedComposableSources> {
  const root = await realpath(input.projectRoot);
  const docsInput = uniqueInputValues([
    ...(input.docsPath === undefined ? [] : [input.docsPath]),
    ...input.docsPaths,
  ]);
  const openApiInput = uniqueInputValues([
    ...(input.openApiPath === undefined ? [] : [input.openApiPath]),
    ...input.openApiPaths,
  ]);
  const guidanceInput = uniqueInputValues(input.guidancePaths);
  const skillHints = uniqueInputValues(input.skillHints);
  const brief =
    input.briefPath === undefined
      ? undefined
      : await readProjectTextFile(root, input.briefPath, "Brief");
  const docs = await readDistinctProjectTextFiles(root, docsInput, "Supporting document");
  const openApi = await readDistinctProjectTextFiles(root, openApiInput, "OpenAPI");
  const guidance = await readDistinctProjectTextFiles(root, guidanceInput, "Guidance");

  const claimedFiles = new Map<string, string>();
  const claim = (file: ProjectTextFile, role: string, automatic = false): boolean => {
    const previous = claimedFiles.get(file.resolvedPath);
    if (previous !== undefined) {
      if (automatic) return false;
      throw new Error(`Source file cannot be used as both ${previous} and ${role}: ${file.path}`);
    }
    claimedFiles.set(file.resolvedPath, role);
    return true;
  };

  if (brief !== undefined) claim(brief, "brief");
  docs.forEach((file) => claim(file, "supporting documentation"));
  openApi.forEach((file) => claim(file, "OpenAPI"));
  guidance.forEach((file) => claim(file, "explicit guidance"));

  const occupiedInputPaths = new Set(
    [input.briefPath, ...docsInput, ...openApiInput, ...guidanceInput]
      .filter(isDefined)
      .map(normalizedInputPathKey),
  );
  const discoveredGuidance: ProjectTextFile[] = [];
  for (const candidate of GUIDANCE_CANDIDATES) {
    if (guidance.length + discoveredGuidance.length >= MAX_COMPOSABLE_SOURCE_PATHS) break;
    if (occupiedInputPaths.has(normalizedInputPathKey(candidate))) continue;
    const file = await readOptionalProjectTextFile(root, candidate, "Discovered guidance");
    if (file !== undefined && claim(file, "discovered guidance", true)) {
      discoveredGuidance.push(file);
    }
  }

  const loaded = new Map<string, ProjectTextSource>();
  const load = async (file: ProjectTextFile): Promise<ProjectTextSource> => {
    const existing = loaded.get(file.resolvedPath);
    if (existing !== undefined) return existing;
    const text = await readFile(file.resolvedPath, "utf8");
    const source = { ...file, text, chunks: buildParserSafeChunks(text) };
    loaded.set(file.resolvedPath, source);
    return source;
  };
  const loadAll = async (files: ProjectTextFile[]): Promise<ProjectTextSource[]> => {
    const sources: ProjectTextSource[] = [];
    for (const file of files) sources.push(await load(file));
    return sources;
  };

  return {
    ...(brief === undefined ? {} : { brief: await load(brief) }),
    docs: await loadAll(docs),
    openApi: await loadAll(openApi),
    guidance: await loadAll(guidance),
    discoveredGuidance: await loadAll(discoveredGuidance),
    skillHints,
  };
}

async function readDistinctProjectTextFiles(
  projectRoot: string,
  paths: string[],
  label: string,
): Promise<ProjectTextFile[]> {
  const files: ProjectTextFile[] = [];
  const seen = new Set<string>();
  for (const filePath of paths) {
    const file = await readProjectTextFile(projectRoot, filePath, label);
    if (!seen.has(file.resolvedPath)) {
      files.push(file);
      seen.add(file.resolvedPath);
    }
  }
  return files;
}

async function ingestProjectTextSource(input: {
  service: IntakeRequestService;
  runId: string;
  kind: "brief" | "docs" | "openapi" | "guidance";
  file: ProjectTextSource;
}): Promise<string[]> {
  const artifactIds: string[] = [];
  for (let index = 0; index < input.file.chunks.length; index += 1) {
    const result = await input.service.parseIntakeRequest({
      runId: input.runId,
      requestText: input.file.chunks[index],
      label: intakeSourceLabel(input.kind, input.file.path, index, input.file.chunks.length),
    });
    artifactIds.push(result.artifact.id);
  }
  return artifactIds;
}

export function buildParserSafeChunks(text: string): string[] {
  const chunks: string[] = [];
  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
  let end = text.length;
  while (end > 0) {
    const target = Math.max(0, end - MAX_INTAKE_SOURCE_CHARS);
    const containing = target === 0 ? undefined : graphemes.containing(target);
    const start =
      containing === undefined || containing.index === target
        ? target
        : containing.index + containing.segment.length;
    if (start >= end) {
      throw new Error("Project text source contains a grapheme that exceeds the parser limit");
    }
    const chunk = text.slice(start, end);
    if (chunk.trim() === "") {
      throw new Error("Project text source cannot form non-whitespace parser-safe chunks");
    }
    chunks.push(chunk);
    end = start;
  }
  chunks.reverse();
  if (chunks.length === 0 || chunks.join("") !== text) {
    throw new Error("Project text source cannot form parser-safe chunks without content loss");
  }
  return chunks;
}

function intakeSourceLabel(
  kind: "brief" | "docs" | "openapi" | "guidance",
  filePath: string,
  index: number,
  total: number,
): string {
  const suffix = total === 1 ? "" : `#part-${index + 1}-of-${total}`;
  const preferred = `${kind}:${filePath}${suffix}`;
  if (preferred.length <= 200) return preferred;

  const digest = createHash("sha256").update(filePath).digest("hex").slice(0, 16);
  const basename = path.basename(filePath).slice(0, 120);
  return `${kind}:${basename}:${digest}${suffix}`.slice(0, 200);
}

function countOpenApiOperations(files: readonly ProjectTextSource[]): number {
  let total = 0;
  for (const file of files) {
    let document: unknown;
    try {
      document = parseYaml(file.text);
    } catch {
      total += 1;
      continue;
    }

    if (typeof document !== "object" || document === null) {
      total += 1;
      continue;
    }
    const paths = (document as { paths?: unknown }).paths;
    if (typeof paths !== "object" || paths === null) {
      total += 1;
      continue;
    }

    let documentOperations = 0;
    for (const pathItem of Object.values(paths)) {
      if (typeof pathItem !== "object" || pathItem === null) continue;
      documentOperations += Object.keys(pathItem).filter((key) =>
        /^(?:get|put|post|delete|options|head|patch|trace)$/i.test(key),
      ).length;
      if (total + documentOperations >= MAX_OPENAPI_OPERATIONS) {
        return MAX_OPENAPI_OPERATIONS;
      }
    }
    total += Math.max(1, documentOperations);
  }
  return Math.min(total, MAX_OPENAPI_OPERATIONS);
}

function uniqueInputValues(values: readonly string[]): string[] {
  const unique = new Map<string, string>();
  values.forEach((value) => {
    const key = normalizedInputPathKey(value);
    if (!unique.has(key)) unique.set(key, value);
  });
  return [...unique.values()];
}

function normalizedInputPathKey(value: string): string {
  return path.normalize(value).split(path.sep).join("/");
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function sameStringMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

async function readProjectTextFile(
  projectRoot: string,
  filePath: string,
  label: string,
): Promise<ProjectTextFile> {
  const file = await resolveProjectTextFile(projectRoot, filePath, label, false);
  if (file === undefined) throw new Error(`${label} file does not exist: ${filePath}`);
  return file;
}

async function readOptionalProjectTextFile(
  projectRoot: string,
  filePath: string,
  label: string,
): Promise<ProjectTextFile | undefined> {
  return resolveProjectTextFile(projectRoot, filePath, label, true);
}

async function resolveProjectTextFile(
  projectRoot: string,
  filePath: string,
  label: string,
  missingAllowed: boolean,
): Promise<ProjectTextFile | undefined> {
  const root = await realpath(projectRoot);
  const requestedPath = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(root, filePath);
  assertWithinProjectRoot(root, requestedPath, filePath);

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(requestedPath);
  } catch (error) {
    if (missingAllowed && isMissingFileError(error)) return undefined;
    throw new Error(`${label} file does not exist: ${filePath}`);
  }
  assertWithinProjectRoot(root, resolvedPath, filePath);
  const details = await stat(resolvedPath);
  if (!details.isFile()) throw new Error(`${label} path must reference a file: ${filePath}`);
  if (details.size > 1024 * 1024)
    throw new Error(`${label} file exceeds the 1 MB limit: ${filePath}`);

  return {
    path: path.relative(root, resolvedPath).split(path.sep).join("/"),
    resolvedPath,
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

async function recommendedSkillsForIntake(input: {
  projectRoot: string;
  figmaUrl?: string;
  hasOpenApi: boolean;
  featureUi: boolean;
}): Promise<string[]> {
  const skills: string[] = [];
  if (input.figmaUrl !== undefined) skills.push("figma", "design-system");
  if (input.hasOpenApi) skills.push("api-generator");

  const packages = await declaredPackageNames(input.projectRoot);
  if (packages.has("react")) skills.push("react-best-practices");
  if (packages.has("next")) skills.push("next-best-practices");
  if (input.featureUi) skills.push("playwright");
  return [...new Set(skills)];
}

async function declaredPackageNames(projectRoot: string): Promise<Set<string>> {
  try {
    const content = await readFile(path.join(projectRoot, "package.json"), "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const packages = new Set<string>();
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      const values = parsed[field];
      if (typeof values !== "object" || values === null || Array.isArray(values)) continue;
      Object.keys(values).forEach((packageName) => packages.add(packageName));
    }
    return packages;
  } catch {
    return new Set();
  }
}

async function countDeclaredWorkspacePackages(projectRoot: string): Promise<number> {
  const patterns = new Set<string>();
  try {
    const content = await readFile(path.join(projectRoot, "package.json"), "utf8");
    const parsed = JSON.parse(content) as { workspaces?: unknown };
    const declared = Array.isArray(parsed.workspaces)
      ? parsed.workspaces
      : typeof parsed.workspaces === "object" && parsed.workspaces !== null
        ? (parsed.workspaces as { packages?: unknown }).packages
        : undefined;
    if (Array.isArray(declared)) {
      declared.forEach((value) => {
        if (typeof value === "string") patterns.add(value);
      });
    }
  } catch {
    // package.json is optional for non-JavaScript projects.
  }
  try {
    const content = await readFile(path.join(projectRoot, "pnpm-workspace.yaml"), "utf8");
    const parsed = parseYaml(content) as { packages?: unknown } | null;
    if (Array.isArray(parsed?.packages)) {
      parsed.packages.forEach((value) => {
        if (typeof value === "string") patterns.add(value);
      });
    }
  } catch {
    // pnpm-workspace.yaml is optional.
  }

  const packageRoots = new Set<string>();
  for (const rawPattern of [...patterns].slice(0, 100)) {
    if (rawPattern.startsWith("!")) continue;
    const pattern = rawPattern.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
    const wildcard = pattern.match(/^(.*)\/\*{1,2}$/);
    if (wildcard !== null) {
      const parent = path.resolve(projectRoot, wildcard[1] ?? "");
      if (!isWithinRoot(path.resolve(projectRoot), parent)) continue;
      let entries;
      try {
        entries = await readdir(parent, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries.slice(0, 1_000)) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(parent, entry.name);
        if (await hasPackageManifest(candidate)) packageRoots.add(candidate);
      }
    } else if (!pattern.includes("*")) {
      const candidate = path.resolve(projectRoot, pattern);
      if (
        isWithinRoot(path.resolve(projectRoot), candidate) &&
        (await hasPackageManifest(candidate))
      ) {
        packageRoots.add(candidate);
      }
    }
    if (packageRoots.size >= 1_000) return 1_000;
  }
  return packageRoots.size;
}

function createImplementationReviewPacket(
  run: RunManifest,
  snapshot: GitSnapshot,
  evidenceArtifacts: ArtifactRef[],
): ImplementationReviewPacket {
  const previous = reviewPacketFromRun(run);
  const evidenceHex = createHash("sha256")
    .update(
      JSON.stringify({
        changedFiles: snapshot.changedFiles,
        evidenceDigests: evidenceArtifacts.map((artifact) => artifact.digest).sort(),
      }),
    )
    .digest("hex");
  if (run.baseCommit === undefined) {
    throw new Error("Implementation review packets require a Git base commit");
  }
  const identity = {
    runId: run.id,
    revision: (previous?.revision ?? 0) + 1,
    baseSha: run.baseCommit,
    headSha: snapshot.headSha,
    evidenceDigest: `sha256:${evidenceHex}`,
    diffDigest: snapshot.diffDigest,
    changedFiles: snapshot.changedFiles,
  };
  const id = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return ImplementationReviewPacketSchema.parse({ id: `packet_${id}`, ...identity });
}

type GitSnapshot = {
  headSha: string;
  diffDigest: `sha256:${string}`;
  changedFiles: string[];
};

async function captureGitSnapshot(run: RunManifest): Promise<GitSnapshot> {
  if (run.baseCommit === undefined) {
    throw new Error("Implementation review packets require a Git base commit");
  }
  const headSha = await currentGitHead(run.projectRoot);
  if (headSha === null)
    throw new Error("Implementation review packets require a readable Git HEAD");
  try {
    const [{ stdout: diff }, { stdout: trackedNames }, { stdout: untrackedNames }] =
      await Promise.all([
        execFileAsync("git", ["diff", "--binary", run.baseCommit, "--"], {
          cwd: run.projectRoot,
          encoding: "buffer",
          maxBuffer: 50 * 1024 * 1024,
        }),
        execFileAsync("git", ["diff", "--name-only", "-z", run.baseCommit, "--"], {
          cwd: run.projectRoot,
          encoding: "buffer",
          maxBuffer: 5 * 1024 * 1024,
        }),
        execFileAsync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
          cwd: run.projectRoot,
          encoding: "buffer",
          maxBuffer: 5 * 1024 * 1024,
        }),
      ]);
    const tracked = splitNullPaths(trackedNames);
    const untracked = splitNullPaths(untrackedNames);
    const changedFiles = [...new Set([...tracked, ...untracked])].sort();
    const digest = createHash("sha256").update(Buffer.isBuffer(diff) ? diff : Buffer.from(diff));
    const root = await realpath(run.projectRoot);
    for (const relativePath of untracked.sort()) {
      const requestedPath = path.resolve(root, relativePath);
      assertWithinProjectRoot(root, requestedPath, relativePath);
      const resolvedPath = await realpath(requestedPath);
      assertWithinProjectRoot(root, resolvedPath, relativePath);
      const details = await stat(resolvedPath);
      if (!details.isFile() || details.size > 50 * 1024 * 1024) {
        throw new Error(`Untracked review file is not a bounded regular file: ${relativePath}`);
      }
      digest.update(`\0untracked:${relativePath}\0`).update(await readFile(resolvedPath));
    }
    return {
      headSha,
      diffDigest: `sha256:${digest.digest("hex")}`,
      changedFiles,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to capture the implementation Git diff: ${message}`);
  }
}

async function assertReviewPacketFresh(run: RunManifest): Promise<void> {
  const packet = reviewPacketFromRun(run);
  if (packet === undefined) throw new Error("The implementation review packet is missing");
  const snapshot = await captureGitSnapshot(run);
  if (
    snapshot.headSha !== packet.headSha ||
    snapshot.diffDigest !== packet.diffDigest ||
    !sameStrings(snapshot.changedFiles, packet.changedFiles)
  ) {
    throw new Error("The implementation review packet is stale; current Git diff does not match");
  }
}

function assertChangedFilesMatch(declared: string[], actual: string[]): void {
  const normalized = [...new Set(declared.map(normalizeGitPath))].sort();
  if (!sameStrings(normalized, actual)) {
    throw new Error(
      `Implementation changedFiles must exactly match the Git diff: expected ${actual.join(", ") || "none"}`,
    );
  }
}

function splitNullPaths(value: Buffer | string): string[] {
  return (Buffer.isBuffer(value) ? value.toString("utf8") : value)
    .split("\0")
    .filter(Boolean)
    .map(normalizeGitPath);
}

function normalizeGitPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function hasPackageManifest(packageRoot: string): Promise<boolean> {
  try {
    return (await stat(path.join(packageRoot, "package.json"))).isFile();
  } catch {
    return false;
  }
}

async function currentGitHead(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    const parsed = z
      .string()
      .regex(/^[a-f0-9]{7,64}$/i)
      .safeParse(stdout.trim());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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

function readyReportArtifactForPacket(
  run: RunManifest,
  reviewPacketId: string,
): ArtifactRef | undefined {
  const artifacts = new Map(run.artifacts.map((artifact) => [artifact.id, artifact]));
  return [...stage(run, "report").artifactIds]
    .reverse()
    .map((artifactId) => artifacts.get(artifactId))
    .find(
      (artifact): artifact is ArtifactRef =>
        artifact?.kind === "pr-report" &&
        artifact.metadata["reportKind"] === "pr-body-markdown" &&
        artifact.metadata["reportIntent"] === "ready" &&
        artifact.metadata["decision"] === "ready" &&
        artifact.metadata["reviewPacketId"] === reviewPacketId,
    );
}
