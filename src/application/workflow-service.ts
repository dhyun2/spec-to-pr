import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import type { ArtifactBlobStore } from "../artifact-registry/artifact-blob-store.js";
import {
  PrReportSectionStatusesSchema,
  PrReportV2Schema,
  WorkflowReportMetadataSchema,
  assertCurrentPrReportV2,
  type PrReportSectionStatus,
  type PrReportV2,
  type WorkflowReportIntent,
} from "../pr-report/pr-report-model.js";
import { publicSourceRows } from "../pr-report/public-provenance.js";
import {
  LegacyInventorySchema,
  assertLegacyInventoryFresh,
  buildLegacyInventory,
  directoriesOverlap,
  mergeLegacyRuntimeNetworkEvidence,
  validateLegacyRuntimeNetworkEvidence,
  type LegacyInventory,
} from "../legacy/legacy-inventory.js";
import {
  resolveLegacyApiCandidates,
  type ResolvedLegacyApiOperation,
} from "../legacy/legacy-api-resolver.js";
import { renderPrReportV2Markdown } from "../pr-report/workflow-report-renderer.js";
import { PublishIntentSchema, PublishResultSchema } from "../publisher/index.js";
import { ArtifactRefSchema, type ArtifactRef } from "../runtime/artifact.js";
import { GapSchema } from "../runtime/gap.js";
import { createArtifactId, createGapId } from "../runtime/id-factory.js";
import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import {
  NoopRuntimeMetrics,
  RuntimeMetricsRecorder,
  type RuntimeMetricsSink,
} from "../runtime/performance-instrumentation.js";
import type { Sha256Digest } from "../runtime/scalars.js";
import { summarizeRun, type RunManifest } from "../run/index.js";
import {
  extractPdfText,
  fetchOpenApiDocument,
  orderedConcurrentMap,
  type RemoteOpenApiSource,
} from "../source-ingestion/source-loader.js";
import {
  inventoryOpenApiOperations,
  openApiClassificationSummary,
} from "../source-ingestion/openapi-inventory.js";
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
  WorkflowSourceUrlSchema,
  WorkflowActionSchema,
  WorkflowActionStatusSchema,
  WorkflowCheckpointStatusSchema,
  WorkflowDetailStatusSchema,
  WorkflowResumeContextSchema,
  WorkflowStatusInputSchema,
  CompactFailedVisualTargetsSchema,
  VisualLineageOutcomeV2Schema,
  VisualRepairEvidenceV2Schema,
  WorkflowScopeSchema,
  WorkflowSubmissionSchema,
  WorkloadEstimateSchema,
  OpenApiOperationContractSchema,
  buildDelegationPolicy,
  buildGatePlan,
  buildDeliveryProfile,
  classifyWorkflowScope,
  estimateWorkload,
  isSafeDurableEvidencePath,
  resolveDeliveryPolicy,
  type WorkflowScope,
  type ModelProvider,
  type WorkflowBlocker,
  type DeliveryProfile,
  type ImplementationReviewPacket,
  type WorkloadEstimate,
  type WorkloadSignals,
  type WorkflowStatus,
  type WorkflowActionStatus,
  type WorkflowCheckpointStatus,
  type WorkflowDetailStatus,
  type WorkflowResumeContext,
  type WorkflowSubmission,
  type EvidenceFingerprintV1,
  DraftEvidenceManifestSchema,
  resolveModelRouting,
} from "../workflow/index.js";
import {
  reopenImplementationForRevision,
  reopenImplementationForReviewChanges,
  reopenImplementationForVisualRepair,
  terminalizeVisualThresholdFailure,
} from "../state/stage-machine.js";
import type { IntakeRequestService } from "./intake-request-service.js";
import type { OpenSpecArchiveService } from "./openspec-archive-service.js";
import type { PublisherService } from "./publisher-service.js";
import type { RunService } from "./run-service.js";
import type { StageService } from "./stage-service.js";
import {
  MAX_VISUAL_REPAIR_ATTEMPTS,
  normalizeVisualTargetManifest,
  VisualTargetManifestCompatibilitySchema,
  VisualTargetManifestSchema,
  VisualRendererLineageBindingSchema,
  type VisualTargetManifest,
} from "../visual/visual-comparator.js";
import { defaultVisualComparisonPool } from "../visual/visual-comparison-pool.js";
import { decodeBoundedPng, readPngGeometry } from "../visual/png-decoder.js";
import { normalizeVisualPng } from "../visual/visual-normalizer.js";
import {
  VisualCaptureReceiptSchema,
  VisualCaptureReceiptV2Schema,
  assertCaptureReceipt,
  canonicalCaptureAssetDigests,
  canonicalCaptureFontDigests,
  captureRendererLineageId,
} from "../visual/capture-receipt.js";
import {
  BaselineIsolationEvidenceSchema,
  assertBaselineIsolation,
} from "../visual/baseline-isolation.js";
import {
  PlaywrightCliResultSchema,
  UiAssertionObservationSchema,
  UiAssertionReportSchema,
  assertUiAssertionReport,
} from "../visual/ui-assertion-contract.js";
import {
  CapturedFigmaComponentSchema,
  FigmaDesignMappingSchema,
  FigmaStateContractSchema,
  assertCompleteDesignMapping,
  assertExactFigmaImplementationBindings,
  assertFigmaCaptureGeometry,
  assertFigmaPublicApiCatalogEvidence,
  assertFigmaStateContracts,
  type FigmaDesignMapping,
  type FigmaStateContract,
} from "../figma/figma-capture-contract.js";
import {
  WorkspaceStartInputSchema,
  assertChangedFilesWithinWorkspace,
  assertWorkspaceFresh,
  resolveWorkspaceBinding,
} from "../workspace/workspace-binding.js";
import {
  createVisualLineage,
  latestVisualLineageOutcome,
  type VisualLineageOutcome,
} from "../workflow/visual-repair-lineage.js";
import {
  CaptureSessionReceiptV1Schema,
  type CaptureSessionReceiptV1,
} from "../workflow/capture-session.js";
import {
  nextCommittedVisualAttempt,
  reduceVisualReservations,
  type VisualAttemptReservation,
  type VisualAttemptReservationEvent,
} from "../workflow/visual-attempt-reservation.js";
import {
  ImplementationSnapshotSchema,
  implementationRepositoryKey,
  reusableImplementationSnapshot,
  type ImplementationSnapshot,
} from "../workflow/implementation-snapshot.js";
import {
  PacketEvidenceEntrySchema,
  PacketEvidenceIndexSchema,
  reusablePacketEvidence,
  type PacketEvidenceEntry,
} from "../workflow/packet-evidence-index.js";

const WORKER_ID = "workflow-orchestrator" as const;
const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 60_000;
const DEFAULT_EXTERNAL_LEASE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_EXTERNAL_HEARTBEAT_MS = 60 * 1000;
const MAX_DIAGNOSTIC_CLAIM_ATTEMPTS = 8;
const MAX_COMPOSABLE_SOURCE_PATHS = 20;
const MAX_INTAKE_SOURCE_CHARS = 200_000;
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
const ComposableSourceUrlsSchema = z
  .array(WorkflowSourceUrlSchema)
  .max(MAX_COMPOSABLE_SOURCE_PATHS)
  .default([]);
const ComposableFigmaUrlsSchema = z
  .array(FigmaFileUrlSchema)
  .max(MAX_COMPOSABLE_SOURCE_PATHS)
  .default([]);
type StandardWorkflowSubmission = Exclude<WorkflowSubmission, { kind: "legacy-network-evidence" }>;
const NormalizedDeliveryProfilePathsSchema = z
  .object({
    briefPath: WorkflowSourcePathSchema.optional(),
    legacyNetworkEvidencePath: WorkflowSourcePathSchema.optional(),
    docsPaths: ComposableSourcePathsSchema,
    openApiPaths: ComposableSourcePathsSchema,
    openApiUrls: ComposableSourceUrlsSchema,
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
    fileUrls: z.array(FigmaFileUrlSchema).min(1).max(MAX_COMPOSABLE_SOURCE_PATHS),
    nodeIds: z.array(z.string().trim().min(1)).max(50),
    capturedComponents: z.array(CapturedFigmaComponentSchema).max(1_000),
    designMapping: FigmaDesignMappingSchema,
    stateContracts: z.array(FigmaStateContractSchema).min(1).max(50),
    visualPaths: z
      .array(
        z
          .string()
          .trim()
          .regex(/\.png$/i),
      )
      .min(1),
    visualTargets: z.array(VisualTargetManifestCompatibilitySchema).min(1).max(50),
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
    workspace: WorkspaceStartInputSchema.optional(),
    requestText: z.string().trim().min(1).max(200_000),
    scope: z.enum(["auto", "ui", "non-ui", "docs"]).default("auto"),
    mode: DeliveryModeSchema.default("auto"),
    changeKind: ChangeKindSchema.default("auto"),
    publication: PublicationIntentSchema.optional(),
    legacyProjectRoot: z.string().trim().min(1).max(1_000).optional(),
    legacyNetworkEvidencePath: WorkflowSourcePathSchema.optional(),
    briefPath: WorkflowSourcePathSchema.optional(),
    figmaUrl: FigmaFileUrlSchema.optional(),
    figmaUrls: ComposableFigmaUrlsSchema,
    docsPath: WorkflowSourcePathSchema.optional(),
    docsPaths: ComposableSourcePathsSchema,
    openApiPath: WorkflowSourcePathSchema.optional(),
    openApiPaths: ComposableSourcePathsSchema,
    openApiUrl: WorkflowSourceUrlSchema.optional(),
    openApiUrls: ComposableSourceUrlsSchema,
    guidancePaths: ComposableSourcePathsSchema,
    skillHints: SkillHintsSchema,
    modelRouting: z
      .object({
        strategy: z.enum(["adaptive-verified", "pinned", "custom"]).default("adaptive-verified"),
        pinnedModel: z.string().trim().min(1).max(200).optional(),
        customModels: z
          .object({
            fast: z.string().trim().min(1).max(200),
            build: z.string().trim().min(1).max(200),
            expert: z.string().trim().min(1).max(200),
          })
          .strict()
          .optional(),
        qualityGaps: z
          .array(
            z
              .object({
                role: z.enum(["fast", "build", "expert"]),
                requestedModel: z.string().trim().min(1).max(200),
                actualModel: z.string().trim().min(1).max(200),
                reason: z.string().trim().min(1).max(2_000),
              })
              .strict(),
          )
          .max(10)
          .default([]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const figmaUrls = uniqueInputUrls([
      ...(input.figmaUrl === undefined ? [] : [input.figmaUrl]),
      ...input.figmaUrls,
    ]);
    if (input.mode === "brief" || input.mode === "feature") {
      if (input.briefPath === undefined) {
        context.addIssue({
          code: "custom",
          path: ["briefPath"],
          message: input.mode + " mode requires briefPath",
        });
      }
      if (figmaUrls.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["figmaUrls"],
          message: input.mode + " mode requires figmaUrl or figmaUrls",
        });
      }
      if (
        uniqueInputValues([
          ...(input.openApiPath === undefined ? [] : [input.openApiPath]),
          ...input.openApiPaths,
        ]).length +
          uniqueInputUrls([
            ...(input.openApiUrl === undefined ? [] : [input.openApiUrl]),
            ...input.openApiUrls,
          ]).length ===
        0
      ) {
        context.addIssue({
          code: "custom",
          path: ["openApiPaths"],
          message: input.mode + " mode requires at least one OpenAPI source",
        });
      }
    }
    if (input.mode === "legacy" && input.legacyProjectRoot === undefined) {
      context.addIssue({
        code: "custom",
        path: ["legacyProjectRoot"],
        message: "legacy mode requires legacyProjectRoot",
      });
    }
    if (
      input.legacyNetworkEvidencePath !== undefined &&
      input.mode !== "auto" &&
      input.mode !== "legacy"
    ) {
      context.addIssue({
        code: "custom",
        path: ["legacyNetworkEvidencePath"],
        message: "legacyNetworkEvidencePath is only valid for legacy mode",
      });
    }
    if (input.legacyNetworkEvidencePath !== undefined && input.legacyProjectRoot === undefined) {
      context.addIssue({
        code: "custom",
        path: ["legacyProjectRoot"],
        message: "legacyNetworkEvidencePath requires legacyProjectRoot",
      });
    }
    if (input.mode === "figma" && figmaUrls.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["figmaUrls"],
        message: "figma mode requires figmaUrl or figmaUrls",
      });
    }
    if (
      (input.mode === "brief" ||
        input.mode === "legacy" ||
        input.mode === "feature" ||
        input.mode === "figma" ||
        figmaUrls.length > 0 ||
        input.legacyProjectRoot !== undefined) &&
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

    const openApiSourceCount =
      uniqueInputValues([
        ...(input.openApiPath === undefined ? [] : [input.openApiPath]),
        ...input.openApiPaths,
      ]).length +
      uniqueInputUrls([
        ...(input.openApiUrl === undefined ? [] : [input.openApiUrl]),
        ...input.openApiUrls,
      ]).length;
    if (openApiSourceCount > MAX_COMPOSABLE_SOURCE_PATHS) {
      context.addIssue({
        code: "custom",
        path: ["openApiUrls"],
        message: `OpenAPI paths and URLs cannot contain more than ${MAX_COMPOSABLE_SOURCE_PATHS} distinct sources`,
      });
    }

    const roles = new Map<string, string>();
    for (const [role, paths] of [
      ["briefPath", input.briefPath === undefined ? [] : [input.briefPath]],
      [
        "legacyNetworkEvidencePath",
        input.legacyNetworkEvidencePath === undefined ? [] : [input.legacyNetworkEvidencePath],
      ],
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

export { WorkflowStatusInputSchema };

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
  fetchOpenApiSource?: (input: { url: string }) => Promise<RemoteOpenApiSource>;
  publisherService?: PublisherService;
  archiveService?: OpenSpecArchiveService;
  metrics?: RuntimeMetricsSink;
  now?: () => string;
  monotonicNow?: () => number;
  externalLeaseTtlMs?: number;
  externalHeartbeatMs?: number;
  /** Host identity selects an adapter-owned model catalog; core stores roles only. */
  hostProvider?: ModelProvider;
};

type VisualAttemptReservationResult =
  | { kind: "reserved"; reservation: VisualAttemptReservation }
  | { kind: "committed-replay"; reservation: VisualAttemptReservation }
  | { kind: "busy"; reservation: VisualAttemptReservation };

type PreparedVisualEvidence = {
  artifact: ArtifactRef;
  content: Buffer;
  label: string;
};

type MutatingStatusView = "action" | "detail";
type MutatingWorkflowStatus = WorkflowActionStatus | WorkflowDetailStatus;
type ReviewerStageName = "functional-review" | "design-review";
type ReviewerTiming = {
  startedAt: number;
  visualStableAtStart: boolean;
  completedWallMs?: number;
};

export class WorkflowService {
  private readonly now: () => string;
  private readonly monotonicNow: () => number;
  private readonly externalLeaseTtlMs: number;
  private readonly externalHeartbeatMs: number;
  private readonly metrics: RuntimeMetricsSink;
  private readonly diagnosticPublishFlights = new Map<string, Promise<unknown>>();
  private readonly reviewerTimings = new Map<string, Map<ReviewerStageName, ReviewerTiming>>();

  public constructor(private readonly dependencies: WorkflowServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.monotonicNow = dependencies.monotonicNow ?? performance.now.bind(performance);
    this.externalLeaseTtlMs = dependencies.externalLeaseTtlMs ?? DEFAULT_EXTERNAL_LEASE_TTL_MS;
    this.externalHeartbeatMs = dependencies.externalHeartbeatMs ?? DEFAULT_EXTERNAL_HEARTBEAT_MS;
    this.metrics = dependencies.metrics ?? new NoopRuntimeMetrics();

    if (
      this.externalHeartbeatMs <= 0 ||
      this.externalLeaseTtlMs <= this.externalHeartbeatMs ||
      this.externalLeaseTtlMs > 60 * 60 * 1000
    ) {
      throw new Error("External stage lease settings require 0 < heartbeat < TTL <= 1 hour");
    }
  }

  private async measureWorkflowAction<T>(
    rawInput: unknown,
    action: "start" | "advance" | "submit" | "status" | "publish" | "archive",
    operation: () => Promise<T>,
  ): Promise<T> {
    const measured = () => this.metrics.time("external_action.wall_ms", { action }, operation);
    const scopedRun = z.object({ runId: RunIdSchema }).passthrough().safeParse(rawInput);
    if (this.metrics instanceof RuntimeMetricsRecorder && scopedRun.success) {
      return this.metrics.withRun(scopedRun.data.runId, measured);
    }
    return measured();
  }

  public async start(rawInput: unknown): Promise<WorkflowDetailStatus>;
  public async start(rawInput: unknown, view: "action"): Promise<WorkflowActionStatus>;
  public async start(rawInput: unknown, view: "detail"): Promise<WorkflowDetailStatus>;
  public async start(
    rawInput: unknown,
    view: MutatingStatusView = "detail",
  ): Promise<MutatingWorkflowStatus> {
    if (this.metrics instanceof RuntimeMetricsRecorder) {
      const recorder = this.metrics;
      const pending = recorder.beginRun();
      return recorder.withPendingRun(pending, async () => {
        const status = await this.measureWorkflowAction(rawInput, "start", () =>
          this.startUninstrumented(rawInput, view),
        );
        recorder.bindPendingRun(pending, status.runId);
        return status;
      });
    }
    return this.measureWorkflowAction(rawInput, "start", () =>
      this.startUninstrumented(rawInput, view),
    );
  }

  private async startUninstrumented(
    rawInput: unknown,
    view: MutatingStatusView,
  ): Promise<MutatingWorkflowStatus> {
    const input = WorkflowStartInputSchema.parse(rawInput);
    const effectiveMode = resolveWorkflowDeliveryMode(input);
    const modelRouting = resolveModelRouting({
      provider: this.dependencies.hostProvider ?? "codex",
      ...(input.modelRouting === undefined ? {} : { routing: input.modelRouting }),
    });
    const publication = input.publication ?? "draft";
    const workspaceBinding =
      input.workspace === undefined
        ? undefined
        : await resolveWorkspaceBinding({
            requestedPath: input.projectRoot,
            ...input.workspace,
          });
    const projectRoot = workspaceBinding?.repositoryRoot ?? input.projectRoot;
    const canonicalLegacyProjectRoot = await canonicalLegacyDirectory({
      projectRoot,
      ...(input.legacyProjectRoot === undefined
        ? {}
        : { legacyProjectRoot: input.legacyProjectRoot }),
      required: effectiveMode === "legacy",
    });
    const sources = await prepareComposableSources(
      { ...input, projectRoot },
      this.dependencies.fetchOpenApiSource ?? fetchOpenApiDocument,
    );
    let usableLegacyNetwork = sources.legacyNetwork;
    let legacyNetworkEvidenceGap: string | undefined;
    if (usableLegacyNetwork !== undefined) {
      try {
        validateLegacyRuntimeNetworkEvidence(usableLegacyNetwork.text);
      } catch {
        // Optional runtime evidence can improve the API map, but a malformed
        // capture must not prevent safe work confirmed in the legacy source.
        legacyNetworkEvidenceGap =
          "The supplied legacy runtime network evidence could not be parsed and was not used.";
        usableLegacyNetwork = undefined;
      }
    }
    const sourceCapturedAt = this.now();
    const normalizedProfilePaths = NormalizedDeliveryProfilePathsSchema.parse({
      ...(sources.brief === undefined ? {} : { briefPath: sources.brief.path }),
      ...(usableLegacyNetwork === undefined
        ? {}
        : { legacyNetworkEvidencePath: usableLegacyNetwork.path }),
      docsPaths: sources.docs.map((file) => file.path),
      openApiPaths: sources.openApi
        .filter((source) => source.origin === "file")
        .map((source) => source.path),
      openApiUrls: sources.openApi
        .filter((source) => source.origin === "url")
        .map((source) => source.path),
      guidancePaths: sources.guidance.map((file) => file.path),
      discoveredGuidancePaths: sources.discoveredGuidance.map((file) => file.path),
    });
    const sourceOpenApiOperations = inventoryOpenApiOperations(sources.openApi);
    const initialHead =
      workspaceBinding?.baseSha ?? (await currentGitHead(projectRoot, this.metrics));
    const created = await this.dependencies.runService.createRun({
      projectRoot,
      ...(initialHead === null ? {} : { baseCommit: initialHead }),
      ...(workspaceBinding === undefined ? {} : { workspaceBinding }),
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
    const sourceIntakeRequests: Array<{ requestText: string; label: string }> = [];
    for (const [kind, files] of [
      ["brief", sources.brief === undefined ? [] : [sources.brief]],
      ["docs", sources.docs],
      ["openapi", sources.openApi],
      ["guidance", [...sources.guidance, ...sources.discoveredGuidance]],
    ] as const) {
      for (const file of files) {
        sourceIntakeRequests.push(...projectTextSourceIntakeRequests({ kind, file }));
      }
    }
    for (let start = 0; start < sourceIntakeRequests.length; start += 200) {
      const results = await this.dependencies.intakeRequestService.parseIntakeRequests({
        runId: created.id,
        requests: sourceIntakeRequests.slice(start, start + 200),
      });
      intakeArtifactIds.push(...results.map((result) => result.artifact.id));
    }
    const legacyInventoryResult =
      canonicalLegacyProjectRoot === undefined
        ? undefined
        : await this.recordLegacyInventory(
            created.id,
            canonicalLegacyProjectRoot,
            usableLegacyNetwork,
          );
    const legacyInventoryArtifact = legacyInventoryResult?.artifact;
    const legacyApiResult =
      legacyInventoryResult === undefined
        ? { operations: [], unresolved: [] }
        : deriveLegacyApiOperations(legacyInventoryResult.inventory, sourceOpenApiOperations);
    const openApiOperations =
      effectiveMode === "legacy"
        ? legacyApiResult.operations
        : mergeDeliveryApiOperations(sourceOpenApiOperations, legacyApiResult.operations);

    const figmaUrls = uniqueInputUrls([
      ...(input.figmaUrl === undefined ? [] : [input.figmaUrl]),
      ...input.figmaUrls,
      ...parsed.parsed.figmaUrls,
    ]);
    const figmaUrl = figmaUrls[0];
    const forcedUi =
      effectiveMode === "brief" ||
      effectiveMode === "legacy" ||
      effectiveMode === "feature" ||
      effectiveMode === "figma" ||
      figmaUrl !== undefined;
    const explicitScope = forcedUi && input.scope === "auto" ? "ui" : input.scope;
    const classificationText = [
      input.requestText,
      ...(sources.brief === undefined ? [] : [sources.brief.text]),
      ...sources.docs.map((file) => file.text),
      openApiClassificationSummary(sourceOpenApiOperations),
    ].join("\n\n");
    const workloadRequirementCount = countIntakeRequirementsFromTexts([
      input.requestText,
      ...(sources.brief === undefined ? [] : [sources.brief.text]),
      ...sources.docs.map((file) => file.text),
      ...sources.openApi.map((file) => file.text),
    ]);
    const classifiedScope = classifyWorkflowScope({
      requestText: classificationText,
      explicitScope,
      figmaUrls,
    });
    const scope = WorkflowScopeSchema.parse({
      ...classifiedScope,
      ui: forcedUi || classifiedScope.ui,
      api:
        effectiveMode === "figma"
          ? false
          : classifiedScope.api ||
            sources.openApi.length > 0 ||
            effectiveMode === "brief" ||
            effectiveMode === "feature",
      specification: classifiedScope.specification || sources.openApi.length > 0,
      hasVisualBaseline: classifiedScope.hasVisualBaseline || figmaUrl !== undefined,
      performanceSensitive:
        classifiedScope.performanceSensitive ||
        effectiveMode === "brief" ||
        effectiveMode === "feature",
    });
    const gatePlan = buildGatePlan(scope);
    const recommendedSkills = await recommendedSkillsForIntake({
      projectRoot,
      ...(figmaUrl === undefined ? {} : { figmaUrl }),
      hasOpenApi: sources.openApi.length > 0,
      featureUi: scope.ui && (effectiveMode === "feature" || input.changeKind === "feature"),
    });
    const deliveryProfile = buildDeliveryProfile({
      mode: effectiveMode,
      changeKind: input.changeKind,
      publication,
      scope,
      ...(canonicalLegacyProjectRoot === undefined
        ? {}
        : { legacyProjectRoot: canonicalLegacyProjectRoot }),
      ...(normalizedProfilePaths.legacyNetworkEvidencePath === undefined
        ? {}
        : { legacyNetworkEvidencePath: normalizedProfilePaths.legacyNetworkEvidencePath }),
      ...(normalizedProfilePaths.briefPath === undefined
        ? {}
        : { briefPath: normalizedProfilePaths.briefPath }),
      ...(figmaUrl === undefined ? {} : { figmaUrl }),
      figmaUrls,
      docsPaths: normalizedProfilePaths.docsPaths,
      openApiPaths: normalizedProfilePaths.openApiPaths,
      openApiUrls: normalizedProfilePaths.openApiUrls,
      openApiOperations,
      guidancePaths: normalizedProfilePaths.guidancePaths,
      discoveredGuidancePaths: normalizedProfilePaths.discoveredGuidancePaths,
      skillHints: sources.skillHints,
      recommendedSkills,
      sourceProvenance: sourceProvenanceForPreparedSources(sources, sourceCapturedAt),
      modelRouting,
    });
    const workload = estimateWorkload({
      phase: "intake",
      mode: deliveryProfile.mode,
      scope,
      signals: {
        requirements: workloadRequirementCount,
        apiOperations: sources.openApi.length > 0 ? openApiOperations.length : scope.api ? 1 : 0,
        uiSurfaces: scope.ui ? 1 : 0,
        figmaNodes: figmaUrls.length,
        testTargets: scope.code ? 1 : 0,
        workspacePackages: await countDeclaredWorkspacePackages(projectRoot),
        uncertainty: scope.code ? 3 : 1,
      },
    });

    if (legacyApiResult.unresolved.length > 0) {
      const timestamp = this.now();
      const gap = GapSchema.parse({
        id: createGapId(),
        category: "api",
        severity: "major",
        status: "open",
        title: "Legacy API method or path is unresolved",
        expected:
          "Every detected legacy API call is either mapped from source evidence or disclosed for reviewer confirmation.",
        observed: legacyApiResult.unresolved
          .map((candidate) => `${candidate.normalizedKey} at ${candidate.sourcePath}`)
          .join("; ")
          .slice(0, 4_000),
        impact:
          "The affected interaction must not invent a request contract; implementation can continue for confirmed behavior.",
        reviewerDecision:
          "Confirm the request contract before enabling the affected write or authenticated interaction.",
        sourceEvidenceIds: [],
        resolutionArtifactIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: {
          unresolvedCandidates: legacyApiResult.unresolved,
          discoveryAdapters: legacyInventoryResult?.inventory.apiDiscoveryAdapters ?? [],
          blockingPhase: "merge-ready",
        },
      });
      const current = await this.dependencies.runStore.get(created.id);
      await this.dependencies.runStore.save(
        {
          ...current,
          revision: current.revision + 1,
          updatedAt: timestamp,
          gaps: [...current.gaps, gap],
        },
        current.revision,
      );
    }

    for (const qualityGap of modelRouting.qualityGaps) {
      const timestamp = this.now();
      const current = await this.dependencies.runStore.get(created.id);
      const gap = GapSchema.parse({
        id: createGapId(),
        category: "tooling",
        severity: "major",
        status: "open",
        title: `Model verification quality reduced for ${qualityGap.role} role`,
        expected: `Use ${qualityGap.requestedModel} for the ${qualityGap.role} role.`,
        observed: `Using ${qualityGap.actualModel}. ${qualityGap.reason}`,
        impact:
          "Development continues, but the affected evidence or independent review has reduced model verification quality.",
        reviewerDecision:
          "Decide whether the affected verification must be repeated with the requested model before merge.",
        sourceEvidenceIds: [],
        resolutionArtifactIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: { modelRouting: qualityGap, blockingPhase: "merge-ready" },
      });
      await this.dependencies.runStore.save(
        {
          ...current,
          revision: current.revision + 1,
          updatedAt: timestamp,
          gaps: [...current.gaps, gap],
        },
        current.revision,
      );
    }

    if (legacyNetworkEvidenceGap !== undefined) {
      const timestamp = this.now();
      const current = await this.dependencies.runStore.get(created.id);
      const gap = GapSchema.parse({
        id: createGapId(),
        category: "api",
        severity: "major",
        status: "open",
        title: "Legacy runtime network evidence is unavailable",
        expected: "Optional runtime evidence is parseable and can enrich the legacy API mapping.",
        observed: legacyNetworkEvidenceGap,
        impact:
          "Confirmed source behavior can be implemented, but unresolved API or authentication behavior remains a Gap.",
        reviewerDecision:
          "Provide corrected runtime evidence only if the unresolved interaction must be enabled before merge.",
        sourceEvidenceIds: [],
        resolutionArtifactIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: { blockingPhase: "merge-ready" },
      });
      await this.dependencies.runStore.save(
        {
          ...current,
          revision: current.revision + 1,
          updatedAt: timestamp,
          gaps: [...current.gaps, gap],
        },
        current.revision,
      );
    }

    await this.dependencies.stageService.complete({
      runId: created.id,
      stageName: "intake",
      workerId: WORKER_ID,
      leaseId: started.stage.lease!.id,
      artifactIds: [
        ...intakeArtifactIds,
        ...(legacyInventoryArtifact === undefined ? [] : [legacyInventoryArtifact.id]),
      ],
      checkpoint: {
        name: "scope-classified",
        data: {
          scope,
          gatePlan,
          deliveryProfile,
          workload,
          ...(effectiveMode === "legacy" ? { legacyOpenApiEvidence: sourceOpenApiOperations } : {}),
        },
      },
    });

    return this.mutatingStatus(created.id, view);
  }

  private async recordLegacyInventory(
    runId: string,
    legacyProjectRoot: string,
    legacyNetworkEvidence?: ProjectTextSource,
  ): Promise<{ artifact: ArtifactRef; inventory: LegacyInventory }> {
    const sourceInventory = await buildLegacyInventory(legacyProjectRoot);
    this.metrics.increment("legacy.rebuild_count");
    this.metrics.increment("legacy.file_read_count", sourceInventory.scannedFiles);
    this.metrics.increment("legacy.parse_count", sourceInventory.entries.length);
    const inventory =
      legacyNetworkEvidence === undefined
        ? sourceInventory
        : mergeLegacyRuntimeNetworkEvidence(
            sourceInventory,
            legacyNetworkEvidence.text,
            legacyNetworkEvidence.path,
          );
    const timestamp = this.now();
    const blob = await this.dependencies.artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(inventory, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: timestamp,
      label: "legacy-inventory-v3.json",
    });
    const artifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "legacy-feature-inventory",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        adapter: "legacy-inventory-v3",
        projectRelativePath: "contracts/legacy-inventory.json",
        rootDigest: inventory.rootDigest,
        sourceDigest: inventory.sourceDigest ?? inventory.rootDigest,
        featureKeys: inventory.entries.map((entry) => entry.featureKey),
        entryCount: inventory.entries.length,
        visitedDirectories: inventory.visitedDirectories,
        visitedEntries: inventory.visitedEntries,
        scannedFiles: inventory.scannedFiles,
        truncated: inventory.truncated,
        apiDiscoveryAdapters: inventory.apiDiscoveryAdapters,
      },
    });
    const current = await this.dependencies.runStore.get(runId);
    await this.dependencies.runStore.save(
      {
        ...current,
        revision: current.revision + 1,
        updatedAt: timestamp,
        artifacts: [...current.artifacts, artifact],
      },
      current.revision,
    );
    return { artifact, inventory };
  }

  public async advance(rawInput: unknown): Promise<WorkflowDetailStatus>;
  public async advance(rawInput: unknown, view: "action"): Promise<WorkflowActionStatus>;
  public async advance(rawInput: unknown, view: "detail"): Promise<WorkflowDetailStatus>;
  public async advance(
    rawInput: unknown,
    view: MutatingStatusView = "detail",
  ): Promise<MutatingWorkflowStatus> {
    return this.measureWorkflowAction(rawInput, "advance", () =>
      this.advanceUninstrumented(rawInput, view),
    );
  }

  private async advanceUninstrumented(
    rawInput: unknown,
    view: MutatingStatusView,
  ): Promise<MutatingWorkflowStatus> {
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
        stage(run, "implementation").status === "passed" &&
        functionalStage.status === "passed" &&
        (scope.ui
          ? stage(run, "design-review").status === "passed"
          : stage(run, "design-review").status === "skipped")
      ) {
        await this.generateReport(run.id);
        if (input.until === "report") {
          return this.mutatingStatus(run.id, view);
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

      return this.mutatingStatus(input.runId, view);
    }

    throw new Error(`Workflow ${input.runId} exceeded the deterministic advance limit`);
  }

  public async submit(rawInput: unknown): Promise<WorkflowDetailStatus>;
  public async submit(rawInput: unknown, view: "action"): Promise<WorkflowActionStatus>;
  public async submit(rawInput: unknown, view: "detail"): Promise<WorkflowDetailStatus>;
  public async submit(
    rawInput: unknown,
    view: MutatingStatusView = "detail",
  ): Promise<MutatingWorkflowStatus> {
    return this.measureWorkflowAction(rawInput, "submit", () =>
      this.submitUninstrumented(rawInput, view),
    );
  }

  private async submitUninstrumented(
    rawInput: unknown,
    view: MutatingStatusView,
  ): Promise<MutatingWorkflowStatus> {
    const input = WorkflowSubmitInputSchema.parse(rawInput);
    let run = await this.dependencies.runStore.get(input.runId);
    const submission = input.submission;
    if (submission.kind === "legacy-network-evidence") {
      return this.submitLegacyNetworkEvidence(run, submission.evidencePath, view);
    }
    if (
      submission.kind === "visual-comparison" ||
      (submission.kind === "contracts" && submission.status === "passed")
    ) {
      await this.assertLegacyReferenceFresh(run);
    }
    if (submission.kind === "visual-comparison") {
      await assertReviewPacketFresh(run, this.dependencies.artifactStore, this.metrics, {
        allowedUntrackedPaths: submission.artifactPaths,
      });
      await this.recordVisualComparison(run, submission);
      return this.mutatingStatus(run.id, view);
    }
    assertSubmissionPrerequisites(run, submission, this.now());
    await assertDraftBundleIntegrity(run, submission);
    let implementationSnapshot: GitSnapshot | undefined;
    if (
      submission.kind === "implementation" &&
      submission.status === "passed" &&
      stage(run, "implementation").status === "passed"
    ) {
      implementationSnapshot = await captureGitSnapshot(run, this.metrics, this.now());
      assertChangedFilesMatch(submission.changedFiles, implementationSnapshot.changedFiles);
      const currentPacket = reviewPacketFromRun(run);
      if (stage(run, "implementation").status === "passed") {
        const currentSnapshotMatches =
          currentPacket !== undefined &&
          currentPacket.headSha === implementationSnapshot.headSha &&
          currentPacket.diffDigest === implementationSnapshot.diffDigest &&
          sameStrings(currentPacket.changedFiles, implementationSnapshot.changedFiles);
        if (currentSnapshotMatches) {
          return this.mutatingStatus(run.id, view);
        }
        const reopened = reopenImplementationForRevision(
          run,
          "The committed implementation changed after its review packet was frozen. A new packet is required.",
          this.now,
        );
        await this.dependencies.runStore.save(reopened, run.revision);
        run = await this.dependencies.runStore.get(run.id);
      }
    }
    const reviewStage =
      submission.kind === "functional-review" || submission.kind === "design-review"
        ? submission.kind
        : undefined;
    const reviewFence = reviewStage === undefined ? undefined : reviewSubmissionFence(run);
    if (
      (submission.kind === "functional-review" || submission.kind === "design-review") &&
      submission.verdict !== "changes-requested"
    ) {
      await assertReviewPacketFresh(run, this.dependencies.artifactStore, this.metrics);
    }
    const evidenceArtifacts = await this.ingestSubmissionEvidence(run, submission);
    if (submission.kind === "implementation") {
      await this.assertEvidenceFingerprintInputs(run.projectRoot, submission.evidenceFingerprints);
    }
    implementationSnapshot =
      implementationSnapshot ??
      (submission.kind === "implementation" && submission.status === "passed"
        ? await captureGitSnapshot(run, this.metrics, this.now())
        : undefined);
    if (submission.kind === "implementation" && implementationSnapshot !== undefined) {
      assertChangedFilesMatch(submission.changedFiles, implementationSnapshot.changedFiles);
    }
    const captureSession =
      submission.kind === "implementation" && implementationSnapshot !== undefined
        ? await this.assertImplementationCaptureSession(
            run,
            submission,
            implementationSnapshot,
            evidenceArtifacts,
          )
        : undefined;
    const evidenceFingerprints =
      submission.kind === "implementation" ? submission.evidenceFingerprints : [];
    const implementationSnapshotArtifact =
      submission.kind === "implementation" &&
      implementationSnapshot?.implementationSnapshot !== undefined
        ? await this.writeImplementationSnapshotArtifact(
            implementationSnapshot.implementationSnapshot,
          )
        : undefined;
    const evidenceIndex =
      submission.kind === "implementation" && implementationSnapshot !== undefined
        ? buildImplementationEvidenceIndex(submission, evidenceArtifacts, implementationSnapshot)
        : [];
    const reviewPacket =
      submission.kind === "implementation" && implementationSnapshot !== undefined
        ? await createImplementationReviewPacket(
            run,
            implementationSnapshot,
            evidenceArtifacts,
            this.dependencies.artifactStore,
            implementationSnapshotArtifact,
            evidenceIndex,
            evidenceFingerprints,
          )
        : undefined;
    const captureSessionBinding =
      captureSession === undefined || reviewPacket === undefined
        ? undefined
        : await this.writeCaptureSessionBinding(captureSession, reviewPacket);
    const acceptedEvidenceArtifacts = [
      ...evidenceArtifacts,
      ...(implementationSnapshotArtifact === undefined ? [] : [implementationSnapshotArtifact]),
      ...(captureSessionBinding === undefined ? [] : [captureSessionBinding]),
    ];

    if (submission.kind === "figma-bundle") {
      await this.recordSubmissionArtifact(run, submission, evidenceArtifacts);
      return this.mutatingStatus(run.id, view);
    }

    if (submission.kind === "api-ready") {
      const artifact = await this.recordSubmissionArtifact(run, submission, evidenceArtifacts);
      await this.recordApiReadyCheckpoint(
        run.id,
        [...evidenceArtifacts.map((item) => item.id), artifact.id],
        submission.implementationContextId,
        submission.operations,
      );
      return this.mutatingStatus(run.id, view);
    }

    const stageName = stageForSubmission(submission);
    const started =
      reviewFence === undefined
        ? await this.dependencies.stageService.start({
            runId: run.id,
            stageName,
            workerId: WORKER_ID,
          })
        : await this.startFencedReviewStage(run.id, reviewStage!, reviewFence);
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
      acceptedEvidenceArtifacts,
      reviewPacket,
    );
    const artifactIds = [...acceptedEvidenceArtifacts.map((item) => item.id), artifact.id];
    if (submission.kind === "functional-review" || submission.kind === "design-review") {
      if (
        submission.verdict === "changes-requested" &&
        !(await this.isReviewPacketSourceFresh(run))
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
        this.completeReviewerTiming(submission.reviewPacketId, submission.kind);
        return this.mutatingStatus(run.id, view);
      }
      await this.bufferReviewResult(run.id, submission.reviewPacketId);
      return this.mutatingStatus(run.id, view);
    }
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

    return this.mutatingStatus(run.id, view);
  }

  private async startFencedReviewStage(
    runId: string,
    stageName: "functional-review" | "design-review",
    fence: ReviewSubmissionFence,
  ) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const current = await this.dependencies.runStore.get(runId);
      assertCurrentReviewFence(current, fence, stageName);
      try {
        return await this.dependencies.stageService.start({
          runId,
          stageName,
          workerId: WORKER_ID,
          expectedRevision: current.revision,
          leaseTtlMs: 60 * 60 * 1_000,
        });
      } catch (error: unknown) {
        if (!(error instanceof RevisionConflictError)) throw error;
      }
    }
    throw new Error("REVIEW_PACKET_STALE: refresh the Run before submitting the reviewer result");
  }

  /**
   * Reviewer submissions are immutable packet-scoped inbox entries.  A UI packet is only
   * terminal once both independent reviewer results are present, so a quick changes-requested
   * result cannot discard a concurrently running sibling review.
   */
  private async bufferReviewResult(runId: string, reviewPacketId: string): Promise<void> {
    const run = await this.dependencies.runStore.get(runId);
    const packet = reviewPacketFromRun(run);
    if (packet?.id !== reviewPacketId || stage(run, "implementation").status !== "passed") {
      throw new Error("REVIEW_PACKET_STALE: the review packet changed while buffering a result");
    }
    const expectedStages: Array<"functional-review" | "design-review"> = scopeFromRun(run).ui
      ? ["functional-review", "design-review"]
      : ["functional-review"];
    const inbox = reviewResultInbox(run, reviewPacketId);
    const results = expectedStages.map((stageName) => inbox.get(stageName));
    if (results.some((result) => result === undefined)) return;

    for (const result of results) {
      const review = result!;
      const current = await this.dependencies.runStore.get(runId);
      const reviewStage = stage(current, review.stageName);
      if (reviewStage.status === "passed" || reviewStage.status === "failed") continue;
      if (reviewStage.status !== "running" || reviewStage.lease === undefined) {
        throw new Error(
          `REVIEW_PACKET_STALE: ${review.stageName} is not running for its buffered reviewer result`,
        );
      }
      const artifactIds = [...review.evidenceArtifactIds, review.artifact.id];
      if (review.verdict === "approved") {
        await this.dependencies.stageService.complete({
          runId,
          stageName: review.stageName,
          workerId: WORKER_ID,
          leaseId: reviewStage.lease.id,
          artifactIds,
        });
      } else {
        await this.dependencies.stageService.fail({
          runId,
          stageName: review.stageName,
          workerId: WORKER_ID,
          leaseId: reviewStage.lease.id,
          artifactIds,
          error: {
            code:
              review.blocker?.code ??
              (review.verdict === "blocked" ? "WORKFLOW_BLOCKED" : "CHANGES_REQUESTED"),
            message:
              review.blocker?.summary ?? `${review.stageName} stage reported ${review.verdict}.`,
            retryable: review.blocker?.retryable ?? review.verdict !== "blocked",
          },
        });
      }
      this.completeReviewerTiming(reviewPacketId, review.stageName);
    }

    const changesRequested = results.find((result) => result!.verdict === "changes-requested");
    if (changesRequested !== undefined) {
      const current = await this.dependencies.runStore.get(runId);
      const reopened = reopenImplementationForReviewChanges(
        current,
        changesRequested!.blocker?.summary ??
          changesRequested!.summary ??
          genericBlockerSummary(changesRequested!.stageName, "unexpected"),
        this.now,
      );
      const reviewArtifactIds = results.map((result) => result!.artifact.id);
      await this.dependencies.runStore.save(
        {
          ...reopened,
          stages: reopened.stages.map((item) =>
            item.name === "implementation"
              ? { ...item, artifactIds: [...new Set([...item.artifactIds, ...reviewArtifactIds])] }
              : item,
          ),
        },
        current.revision,
      );
    }
    await this.cleanupReviewerTimingIfTerminal(runId, reviewPacketId);
  }

  private async isReviewPacketSourceFresh(run: RunManifest): Promise<boolean> {
    try {
      await assertReviewPacketFresh(run, this.dependencies.artifactStore, this.metrics);
      return true;
    } catch {
      return false;
    }
  }

  private async submitLegacyNetworkEvidence(
    run: RunManifest,
    evidencePath: string,
    view: MutatingStatusView,
  ): Promise<MutatingWorkflowStatus> {
    const intake = stage(run, "intake");
    const profile = deliveryProfileFromRun(run);
    if (
      profile.mode !== "legacy" ||
      profile.legacyProjectRoot === undefined ||
      intake.status !== "blocked" ||
      intake.error?.code !== "LEGACY_API_METHOD_UNKNOWN"
    ) {
      throw new Error(
        "Legacy network evidence can only resume a legacy Run waiting at unresolved API intake",
      );
    }
    const file = await readProjectTextFile(
      run.projectRoot,
      evidencePath,
      "Legacy runtime network evidence",
    );
    const rawContent = await readFile(file.resolvedPath);
    const text = rawContent.toString("utf8");
    validateLegacyRuntimeNetworkEvidence(text);
    const source: ProjectTextSource = {
      ...file,
      origin: "file",
      rawContent,
      text,
      chunks: buildParserSafeChunks(text),
      mediaType: mediaTypeForPath(file.path),
      rawDigest: `sha256:${createHash("sha256").update(rawContent).digest("hex")}`,
    };
    const started = await this.dependencies.stageService.start({
      runId: run.id,
      stageName: "intake",
      workerId: WORKER_ID,
    });
    const recorded = await this.recordLegacyInventory(run.id, profile.legacyProjectRoot, source);
    const legacyApiResult = deriveLegacyApiOperations(
      recorded.inventory,
      legacyOpenApiEvidenceFromRun(run, profile),
    );
    if (legacyApiResult.unresolved.length > 0) {
      await this.dependencies.stageService.block({
        runId: run.id,
        stageName: "intake",
        workerId: WORKER_ID,
        leaseId: started.stage.lease!.id,
        error: {
          code: "LEGACY_API_METHOD_UNKNOWN",
          message:
            "The supplied runtime evidence did not uniquely resolve every dynamic legacy API call.",
          retryable: true,
        },
        gapIds: intake.gapIds,
        artifactIds: [recorded.artifact.id],
        ...(intake.checkpoint === undefined
          ? {}
          : {
              checkpoint: {
                name: intake.checkpoint.name,
                data: intake.checkpoint.data,
              },
            }),
      });
      return this.mutatingStatus(run.id, view);
    }
    const scope = scopeFromRun(run);
    const updatedProfile = DeliveryProfileSchema.parse({
      ...profile,
      legacyNetworkEvidencePath: source.path,
      openApiOperations: legacyApiResult.operations,
      sourceProvenance: [
        ...profile.sourceProvenance.filter((item) => item.kind !== "legacy-network"),
        {
          kind: "legacy-network",
          locator: source.path,
          resolvedLocator: source.path,
          digest: source.rawDigest,
          capturedAt: this.now(),
        },
      ],
    });
    const current = await this.dependencies.runStore.get(run.id);
    const timestamp = this.now();
    await this.dependencies.runStore.save(
      {
        ...current,
        revision: current.revision + 1,
        updatedAt: timestamp,
        gaps: current.gaps.map((gap) =>
          intake.gapIds.includes(gap.id)
            ? GapSchema.parse({
                ...gap,
                status: "resolved",
                resolutionArtifactIds: [recorded.artifact.id],
                updatedAt: timestamp,
              })
            : gap,
        ),
      },
      current.revision,
    );
    await this.dependencies.stageService.complete({
      runId: run.id,
      stageName: "intake",
      workerId: WORKER_ID,
      leaseId: started.stage.lease!.id,
      artifactIds: [recorded.artifact.id],
      checkpoint: {
        name: "scope-classified",
        data: {
          scope,
          gatePlan: buildGatePlan(scope),
          deliveryProfile: updatedProfile,
          workload: workloadFromRun(run, scope, updatedProfile),
          legacyOpenApiEvidence: legacyOpenApiEvidenceFromRun(run, profile),
        },
      },
    });
    return this.mutatingStatus(run.id, view);
  }

  private async mutatingStatus(
    runId: string,
    view: MutatingStatusView,
  ): Promise<MutatingWorkflowStatus> {
    return view === "action"
      ? this.status({ runId, view: "action" })
      : this.status({ runId, view: "detail" });
  }

  public async status(input: { runId: string; view: "action" }): Promise<WorkflowActionStatus>;
  public async status(input: {
    runId: string;
    view: "checkpoint";
  }): Promise<WorkflowCheckpointStatus>;
  public async status(input: { runId: string; view: "detail" }): Promise<WorkflowDetailStatus>;
  public async status(input: { runId: string }): Promise<WorkflowActionStatus>;
  public async status(rawInput: unknown): Promise<WorkflowStatus>;
  public async status(rawInput: unknown): Promise<WorkflowStatus> {
    return this.measureWorkflowAction(rawInput, "status", () =>
      this.statusUninstrumented(rawInput),
    );
  }

  private async statusUninstrumented(rawInput: unknown): Promise<WorkflowStatus> {
    const input = WorkflowStatusInputSchema.parse(rawInput);
    const run = await this.dependencies.runStore.get(input.runId);
    const scope = scopeFromRun(run);
    const deliveryProfile = deliveryProfileFromRun(run);
    const workload = workloadFromRun(run, scope, deliveryProfile);
    const nextActions = await actionsForRun(
      run,
      scope,
      deliveryProfile,
      this.now(),
      this.dependencies.artifactStore,
    );
    this.startExposedReviewerTimings(run, deliveryProfile, nextActions);
    const requiredValidations = requiredValidationsForRun(scope, deliveryProfile);
    const currentStage = run.stages.find((item) => !["passed", "skipped"].includes(item.status));
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
    const common = buildCommonStatusProjection({
      runId: run.id,
      revision: run.revision,
      status,
      ...(currentStage === undefined ? {} : { currentStage: currentStage.name }),
      deliveryProfile: {
        publication: deliveryProfile.publication,
        recommendedSkills: deliveryProfile.recommendedSkills,
        ...(deliveryProfile.modelRouting === undefined
          ? {}
          : { modelRouting: deliveryProfile.modelRouting }),
      },
      ...(run.workspaceBinding === undefined ? {} : { workspaceBinding: run.workspaceBinding }),
      workload,
      delegationPolicy: buildDelegationPolicy(workload.size),
      requiredValidations,
      nextActions,
      blockers,
      blockerDetails,
      ...(diagnosticPublication === undefined ? {} : { diagnosticPublication }),
    });
    if (input.view === "action") {
      return buildActionStatusProjection(common, run);
    }
    if (input.view === "checkpoint") {
      return buildCheckpointStatusProjection(common, run);
    }
    const legacyInventory = await this.legacyInventorySummaryForRun(run);
    return buildDetailStatusProjection(common, run, scope, deliveryProfile, legacyInventory);
  }

  private startExposedReviewerTimings(
    run: RunManifest,
    profile: DeliveryProfile,
    actions: WorkflowStatus["nextActions"],
  ): void {
    const packet = reviewPacketFromRun(run);
    if (packet === undefined) return;
    const visualStable =
      !profile.requirements.visualComparison ||
      currentVisualReport(run, packet.id)?.metadata["visualStatus"] === "passed";
    for (const action of actions) {
      if (action.kind !== "review-functional" && action.kind !== "review-design") continue;
      if (action.reviewPacketId !== packet.id) continue;
      const stageName = action.kind === "review-functional" ? "functional-review" : "design-review";
      let timings = this.reviewerTimings.get(packet.id);
      if (timings === undefined) {
        timings = new Map();
        this.reviewerTimings.set(packet.id, timings);
      }
      if (!timings.has(stageName)) {
        timings.set(stageName, {
          startedAt: this.monotonicNow(),
          visualStableAtStart: visualStable,
        });
      }
    }
  }

  private completeReviewerTiming(packetId: string, stageName: ReviewerStageName): void {
    let timings = this.reviewerTimings.get(packetId);
    if (timings === undefined) {
      timings = new Map();
      this.reviewerTimings.set(packetId, timings);
    }
    let timing = timings.get(stageName);
    if (timing === undefined) {
      timing = { startedAt: this.monotonicNow(), visualStableAtStart: true };
      timings.set(stageName, timing);
    }
    if (timing.completedWallMs !== undefined) return;
    const wallMs = Math.max(0, this.monotonicNow() - timing.startedAt);
    timing.completedWallMs = wallMs;
    this.metrics.increment("review.wall_ms", wallMs, { stage: stageName });
  }

  private invalidateReviewerTimings(packetId: string): void {
    const timings = this.reviewerTimings.get(packetId);
    if (timings === undefined) return;
    const invalidatedAt = this.monotonicNow();
    for (const [stageName, timing] of timings) {
      const wallMs = timing.completedWallMs ?? Math.max(0, invalidatedAt - timing.startedAt);
      if (timing.completedWallMs === undefined) {
        this.metrics.increment("review.wall_ms", wallMs, { stage: stageName });
      }
      this.metrics.increment("review.invalidated_wall_ms", wallMs, { stage: stageName });
    }
    this.reviewerTimings.delete(packetId);
  }

  private async cleanupReviewerTimingIfTerminal(runId: string, packetId: string): Promise<void> {
    const run = await this.dependencies.runStore.get(runId);
    const profile = deliveryProfileFromRun(run);
    const visualStable =
      !profile.requirements.visualComparison ||
      currentVisualReport(run, packetId)?.metadata["visualStatus"] === "passed";
    if (
      visualStable &&
      stage(run, "functional-review").status === "passed" &&
      ["passed", "skipped"].includes(stage(run, "design-review").status)
    ) {
      this.reviewerTimings.delete(packetId);
    }
  }

  private async legacyInventorySummaryForRun(run: RunManifest) {
    const artifact = [...run.artifacts]
      .reverse()
      .find((candidate) => candidate.kind === "legacy-feature-inventory");
    if (artifact === undefined) return undefined;
    const inventory = LegacyInventorySchema.parse(
      JSON.parse(
        (await this.dependencies.artifactStore.readContent(artifact.digest)).toString("utf8"),
      ),
    );
    return {
      artifactId: artifact.id,
      version: inventory.version,
      rootDigest: inventory.rootDigest,
      truncated: inventory.truncated,
      apiState: inventory.apiState,
      apiDiscoveryAdapters: inventory.apiDiscoveryAdapters,
      entries: inventory.entries.slice(0, 500).map((entry) => ({
        featureKey: entry.featureKey,
        category: entry.category,
        normalizedKey: entry.normalizedKey,
        sourcePath: entry.sourcePath,
        symbol: entry.symbol,
      })),
      apiCandidates: inventory.apiCandidates.slice(0, 500).map((candidate) => ({
        candidateKey: candidate.candidateKey,
        operationKey: candidate.operationKey,
        ...(candidate.originRef === undefined
          ? {}
          : {
              originRef:
                candidate.originRef.kind === "environment"
                  ? `${candidate.originRef.runtime}:${candidate.originRef.name}`
                  : candidate.originRef.kind === "openapi-server"
                    ? `openapi:${candidate.originRef.sourceLocator}#${candidate.originRef.serverIndex}`
                    : candidate.originRef.kind,
              origins:
                candidate.originRef.kind === "environment"
                  ? [
                      ...(candidate.originRef.sanitizedOrigin === undefined
                        ? []
                        : [candidate.originRef.sanitizedOrigin]),
                      ...(candidate.originRef.sanitizedOrigins ?? []).map(
                        (origin) => origin.origin,
                      ),
                    ].slice(0, 20)
                  : candidate.originRef.kind === "literal" ||
                      candidate.originRef.kind === "runtime-origin"
                    ? [candidate.originRef.sanitizedOrigin]
                    : [],
            }),
        sourcePaths: [
          ...new Set(
            candidate.callSites.flatMap((callSite) => [
              callSite.ownerSourcePath,
              callSite.terminalSourcePath,
            ]),
          ),
        ].slice(0, 100),
        transportRefs: [
          ...new Set(
            candidate.callSites.flatMap((callSite) =>
              callSite.transportRef === undefined ? [] : [callSite.transportRef],
            ),
          ),
        ].slice(0, 100),
        callSites: candidate.callSites.slice(0, 100).map((callSite) => ({
          callSiteKey: callSite.callSiteKey,
          ownerSourcePath: callSite.ownerSourcePath,
          terminalSourcePath: callSite.terminalSourcePath,
          line: callSite.line,
          column: callSite.column,
        })),
      })),
      supportingDependencies: inventory.supportingDependencies
        .slice(0, 500)
        .map((dependency) => dependency.applicationRelativePath),
    };
  }

  private async assertLegacyReferenceFresh(run: RunManifest): Promise<void> {
    const profile = deliveryProfileFromRun(run);
    if (profile.mode !== "legacy" || profile.legacyProjectRoot === undefined) return;
    const artifact = [...run.artifacts]
      .reverse()
      .find((candidate) => candidate.kind === "legacy-feature-inventory");
    if (artifact === undefined) {
      throw new Error("LEGACY_INVENTORY_TRUNCATED: narrow the migration scope and restart intake");
    }
    const pinned = LegacyInventorySchema.parse(
      JSON.parse(
        (await this.dependencies.artifactStore.readContent(artifact.digest)).toString("utf8"),
      ),
    );
    await assertLegacyInventoryFresh(profile.legacyProjectRoot, pinned);
    if (profile.legacyNetworkEvidencePath !== undefined) {
      const provenance = profile.sourceProvenance.find(
        (source) =>
          source.kind === "legacy-network" && source.locator === profile.legacyNetworkEvidencePath,
      );
      if (provenance === undefined) {
        throw new Error(
          "LEGACY_RUNTIME_EVIDENCE_CHANGED: restart intake with the runtime network evidence",
        );
      }
      const evidenceFile = await readProjectTextFile(
        run.projectRoot,
        profile.legacyNetworkEvidencePath,
        "Legacy runtime network evidence",
      );
      const currentDigest = `sha256:${createHash("sha256")
        .update(await readFile(evidenceFile.resolvedPath))
        .digest("hex")}`;
      if (currentDigest !== provenance.digest) {
        throw new Error(
          "LEGACY_RUNTIME_EVIDENCE_CHANGED: restore the evidence or restart intake from its new state",
        );
      }
    }
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
    const report = await this.materializeBlockedReport(run, blocker, timestamp);
    const {
      jsonArtifact,
      markdownArtifact: artifact,
      runtimeArtifact,
    } = await this.writePrReportArtifacts({
      run,
      report,
      reportIntent: "blocked-diagnostic",
      timestamp,
      metadata: {
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
          artifacts: [
            ...run.artifacts,
            jsonArtifact,
            artifact,
            ...(runtimeArtifact === undefined ? [] : [runtimeArtifact]),
          ],
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
    return this.measureWorkflowAction(rawInput, "publish", () =>
      this.publishUninstrumented(rawInput),
    );
  }

  private async publishUninstrumented(rawInput: unknown): Promise<unknown> {
    const input = WorkflowPublishInputSchema.parse(rawInput);
    const publisher = this.dependencies.publisherService;

    if (publisher === undefined) {
      throw new Error("Publishing is unavailable in this runtime");
    }

    const run = await this.dependencies.runStore.get(input.runId);
    if (deliveryProfileFromRun(run).publication !== "draft") {
      throw new Error("Draft publication was not requested for this workflow");
    }
    if (run.workspaceBinding !== undefined) {
      const packet = reviewPacketFromRun(run);
      await assertWorkspaceFresh(run.workspaceBinding, {
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        remoteName: input.remoteName,
        ...(input.intent !== "ready" || packet?.headSha === null || packet?.headSha === undefined
          ? {}
          : { reviewedHeadSha: packet.headSha }),
      });
    }
    if (input.intent === "blocked-diagnostic") {
      return this.publishBlockedDiagnostic(input, run, publisher);
    }
    await this.assertLegacyReferenceFresh(run);
    if (stage(run, "report").status !== "passed") {
      throw new Error("Ready publication requires a passed report stage");
    }
    if (reviewPacketFromRun(run) === undefined) {
      throw new Error("Ready publication requires the current implementation review packet");
    }
    await assertReviewPacketFresh(run, this.dependencies.artifactStore, this.metrics);
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
    const reportJsonArtifactId = reportArtifact.metadata["reportJsonArtifactId"];
    const reportJsonArtifact =
      typeof reportJsonArtifactId === "string"
        ? run.artifacts.find((artifact) => artifact.id === reportJsonArtifactId)
        : undefined;
    if (reportJsonArtifact === undefined) {
      throw new Error("Ready publication requires a referenced pr-report-v2.1 JSON artifact");
    }
    const parsedReport = PrReportV2Schema.parse(
      JSON.parse(
        (await this.dependencies.artifactStore.readContent(reportJsonArtifact.digest)).toString(
          "utf8",
        ),
      ),
    );
    assertCurrentPrReportV2(parsedReport);
    if (
      parsedReport.schemaVersion !== "pr-report-v2.1" ||
      parsedReport.decision !== "ready" ||
      parsedReport.binding?.reviewPacketId !== packet.id
    ) {
      throw new Error("Ready publication requires a current pr-report-v2.1 JSON artifact");
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

    return { result, status: await this.status({ runId: run.id, view: "detail" }) };
  }

  private async publishBlockedDiagnostic(
    input: z.infer<typeof WorkflowPublishInputSchema>,
    run: RunManifest,
    publisher: PublisherService,
  ): Promise<unknown> {
    const workflowStatus = await this.status({ runId: run.id, view: "detail" });
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
        status: await this.status({ runId: run.id, view: "detail" }),
      };
      return stopped;
    }
    const runWithReport = await this.dependencies.runStore.get(run.id);
    const reportJsonArtifactId = reportArtifact.metadata["reportJsonArtifactId"];
    const reportJsonArtifact =
      typeof reportJsonArtifactId === "string"
        ? runWithReport.artifacts.find((artifact) => artifact.id === reportJsonArtifactId)
        : undefined;
    if (reportJsonArtifact === undefined) {
      throw new Error("Blocked diagnostic publication requires its canonical report JSON");
    }
    const canonicalReport = PrReportV2Schema.parse(
      JSON.parse(
        (await this.dependencies.artifactStore.readContent(reportJsonArtifact.digest)).toString(
          "utf8",
        ),
      ),
    );
    assertCurrentPrReportV2(canonicalReport);
    if (
      canonicalReport.schemaVersion !== "pr-report-v2.1" ||
      canonicalReport.runId !== run.id ||
      canonicalReport.decision !== "blocked"
    ) {
      throw new Error("Blocked diagnostic publication requires a current Run-bound report");
    }
    if (blocker.kind === "publish-precondition") {
      return {
        intent: input.intent,
        skipped: true,
        reason: "publish-precondition",
        localReportPath: reportArtifact.uri,
        diagnosticReport: { artifactId: reportArtifact.id, path: reportArtifact.uri },
        exactUnblockAction: blocker.exactUnblockAction,
        status: await this.status({ runId: run.id, view: "detail" }),
      };
    }
    const synchronized = await this.synchronizedDiagnosticPublishResultForRun(
      runWithReport,
      reportArtifact.id,
      executionIdentity,
    );
    if (synchronized !== undefined) {
      return {
        result: synchronized,
        status: await this.status({ runId: run.id, view: "detail" }),
      };
    }
    const claim = await this.acquireDiagnosticPublishClaim(
      run.id,
      reportArtifact.id,
      executionIdentity,
      blocker,
      input.recoverUncertain,
    );
    if (claim.state === "synchronized") {
      return {
        result: claim.result,
        status: await this.status({ runId: run.id, view: "detail" }),
      };
    }
    if (claim.state === "in-progress") {
      return {
        intent: "blocked-diagnostic",
        skipped: true,
        reason: "diagnostic-publication-in-progress",
        retryable: true,
        retryAfter: claim.expiresAt,
        diagnosticReport: { artifactId: reportArtifact.id, path: reportArtifact.uri },
        status: await this.status({ runId: run.id, view: "detail" }),
      };
    }
    if (claim.state === "uncertain") {
      return diagnosticPublicationUncertainResult(
        reportArtifact,
        await this.status({ runId: run.id, view: "detail" }),
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
      ...(canonicalReport.binding === undefined
        ? {}
        : {
            reviewPacketId: canonicalReport.binding.reviewPacketId,
            headSha: canonicalReport.binding.headSha,
          }),
    };
    try {
      const result = await this.withDiagnosticPublishClaimHeartbeat(
        run.id,
        claim.executionKey,
        claim.ownerClaimId,
        (signal) => publisher.publish({ ...baseInput, confirm: true }, { signal }),
      );
      await this.releaseDiagnosticPublishClaim(run.id, claim.executionKey, claim.ownerClaimId);
      return { result, status: await this.status({ runId: run.id, view: "detail" }) };
    } catch (error: unknown) {
      if (error instanceof DiagnosticPublishClaimUncertainError) {
        await this.markDiagnosticPublishClaimUncertainBestEffort(
          run.id,
          claim.executionKey,
          claim.ownerClaimId,
        );
        return diagnosticPublicationUncertainResult(
          reportArtifact,
          await this.status({ runId: run.id, view: "detail" }),
        );
      }
      await this.releaseDiagnosticPublishClaim(run.id, claim.executionKey, claim.ownerClaimId);
      throw error;
    }
  }

  public async archive(rawInput: unknown): Promise<unknown> {
    return this.measureWorkflowAction(rawInput, "archive", () =>
      this.archiveUninstrumented(rawInput),
    );
  }

  private async archiveUninstrumented(rawInput: unknown): Promise<unknown> {
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

    return { result, status: await this.status({ runId, view: "detail" }) };
  }

  private async recordSubmissionArtifact(
    run: RunManifest,
    submission: StandardWorkflowSubmission,
    evidenceArtifacts: ArtifactRef[],
    reviewPacket?: ImplementationReviewPacket,
  ): Promise<ArtifactRef> {
    const timestamp = this.now();
    const persistedEvidenceArtifacts =
      reviewPacket === undefined
        ? evidenceArtifacts
        : evidenceArtifacts.map((evidence) =>
            ArtifactRefSchema.parse({
              ...evidence,
              metadata: {
                ...evidence.metadata,
                reviewPacketId: reviewPacket.id,
                headSha: reviewPacket.headSha,
                diffDigest: reviewPacket.diffDigest,
              },
            }),
          );
    const persistedSubmission = reconstructFailedSubmissionForPersistence(
      { ...run, artifacts: [...run.artifacts, ...evidenceArtifacts] },
      submission,
    );
    const persistedBlocker = blockerFromSubmission(persistedSubmission);
    const failureContext = failureContextForSubmission(run, submission);
    const persistedSummary =
      persistedSubmission.kind === "figma-bundle"
        ? "Accepted host-connected Figma bundle."
        : persistedSubmission.kind === "visual-comparison"
          ? "Runtime-computed visual comparison."
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
          ? {
              summary: persistedSummary,
              status: "passed",
              figmaFileUrls: submission.fileUrls ?? [submission.fileUrl],
              capturedComponents: submission.capturedComponents,
              designMapping: submission.designMapping,
              stateContracts: submission.stateContracts,
              visualTargets: submission.visualTargets,
            }
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
              visualTargets: submission.visualTargets,
              legacyScopeKeys: submission.legacyScopeKeys,
              legacyCoverage: submission.legacyCoverage,
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
              apiCoverage: submission.apiCoverage,
              legacyCoverage: submission.legacyCoverage,
              ...(submission.mockDataEvidence === undefined
                ? {}
                : { mockDataEvidence: submission.mockDataEvidence }),
              ...(submission.designSystemEvidence === undefined
                ? {}
                : { designSystemEvidence: submission.designSystemEvidence }),
              ...(submission.performanceEvidence === undefined
                ? {}
                : { performanceEvidence: submission.performanceEvidence }),
              evidenceFingerprints: submission.evidenceFingerprints,
            }),
        ...(submission.kind !== "api-ready" ? {} : { apiOperations: submission.operations }),
        ...(submission.kind !== "functional-review" && submission.kind !== "design-review"
          ? {}
          : {
              reviewPacketId: submission.reviewPacketId,
              reviewedRequirements: submission.requirements,
              gateResults: submission.gateResults,
              findings: submission.findings,
              ...(persistedBlocker === undefined ? {} : { workflowBlocker: persistedBlocker }),
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
        artifacts: [...current.artifacts, ...persistedEvidenceArtifacts, artifact],
      },
      current.revision,
    );

    return artifact;
  }

  private async writeImplementationSnapshotArtifact(
    snapshot: ImplementationSnapshot,
  ): Promise<ArtifactRef> {
    const parsed = ImplementationSnapshotSchema.parse(snapshot);
    const content = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    const blob = await this.dependencies.artifactStore.writeBlob({
      content,
      mediaType: "application/json",
      storedAt: parsed.capturedAt,
      label: "implementation-snapshot-v1.json",
    });
    return ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "agent-result-report",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: parsed.capturedAt,
      metadata: {
        adapter: "implementation-snapshot-v1",
        schemaVersion: parsed.schemaVersion,
        headSha: parsed.headSha,
        diffDigest: parsed.diffDigest,
      },
    });
  }

  private async assertImplementationCaptureSession(
    run: RunManifest,
    submission: Extract<WorkflowSubmission, { kind: "implementation" }>,
    snapshot: GitSnapshot,
    evidenceArtifacts: ArtifactRef[],
  ): Promise<{ artifact: ArtifactRef; session: CaptureSessionReceiptV1 } | undefined> {
    if (submission.captureSessionPath === undefined) return undefined;
    const artifact = evidenceArtifacts.find(
      (candidate) => candidate.metadata["projectRelativePath"] === submission.captureSessionPath,
    );
    if (artifact === undefined) {
      throw new Error(
        `CAPTURE_SESSION_INVALID: manifest was not ingested: ${submission.captureSessionPath}`,
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(
        (await this.dependencies.artifactStore.readContent(artifact.digest)).toString("utf8"),
      );
    } catch {
      throw new Error(
        `CAPTURE_SESSION_INVALID: manifest must be strict JSON: ${submission.captureSessionPath}`,
      );
    }
    const parsed = CaptureSessionReceiptV1Schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `CAPTURE_SESSION_INVALID: manifest schema is invalid: ${parsed.error.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      );
    }
    const session = parsed.data;
    const expectedBaseSha = run.workspaceBinding?.baseSha ?? run.baseCommit;
    const candidateDiffDigest = await captureCandidateDiffDigest({
      run,
      headSha: snapshot.headSha,
      excludedEvidencePaths: [
        submission.captureSessionPath,
        session.invocation.reporterResultPath,
        ...session.outputs.targets.flatMap((target) => [target.actualPath, target.observationPath]),
        ...(session.outputs.featureResult === undefined
          ? []
          : [session.outputs.featureResult.path]),
        ...(session.outputs.video === undefined ? [] : [session.outputs.video.path]),
        ...(session.outputs.performance === undefined ? [] : [session.outputs.performance.path]),
      ],
      metrics: this.metrics,
    });
    if (
      session.runId !== run.id ||
      session.implementationContextId !== submission.implementationContextId ||
      session.candidate.baseSha !== expectedBaseSha ||
      session.candidate.headSha !== snapshot.headSha ||
      session.candidate.diffDigest !== candidateDiffDigest ||
      session.invocation.invocationCount !== 1
    ) {
      throw new Error(
        "CAPTURE_SESSION_INVALID: manifest does not bind exactly to the Run, implementation context, candidate, and one Playwright invocation",
      );
    }

    const assertSessionArtifact = (evidencePath: string, digest: string, role: string) => {
      const evidence = evidenceArtifacts.find(
        (candidate) => candidate.metadata["projectRelativePath"] === evidencePath,
      );
      if (evidence === undefined || evidence.digest !== digest) {
        throw new Error(
          `CAPTURE_SESSION_INVALID: ${role} is missing or its digest does not match ${evidencePath}`,
        );
      }
    };
    assertSessionArtifact(
      session.invocation.reporterResultPath,
      session.invocation.reporterResultDigest,
      "Playwright reporter result",
    );
    for (const target of session.outputs.targets) {
      assertSessionArtifact(
        target.actualPath,
        target.actualDigest,
        `${target.targetId} actual PNG`,
      );
      assertSessionArtifact(
        target.observationPath,
        target.observationDigest,
        `${target.targetId} assertion observation`,
      );
    }
    if (session.outputs.featureResult !== undefined) {
      assertSessionArtifact(
        session.outputs.featureResult.path,
        session.outputs.featureResult.digest,
        "feature result",
      );
    }
    if (session.outputs.video !== undefined) {
      assertSessionArtifact(
        session.outputs.video.path,
        session.outputs.video.digest,
        "feature video",
      );
    }
    if (session.outputs.performance !== undefined) {
      assertSessionArtifact(
        session.outputs.performance.path,
        session.outputs.performance.digest,
        "performance result",
      );
    }
    if (submission.featureEvidence !== undefined) {
      if (
        session.outputs.featureResult?.path !== submission.featureEvidence.resultPath ||
        session.outputs.video?.path !== submission.featureEvidence.videoPath ||
        session.invocation.command !== submission.featureEvidence.testCommand ||
        session.invocation.selector !== submission.featureEvidence.testSelector
      ) {
        throw new Error(
          "CAPTURE_SESSION_INVALID: feature E2E result, video, command, and selector must come from the capture session",
        );
      }
    }
    if (
      submission.performanceEvidence !== undefined &&
      session.outputs.performance?.path !== submission.performanceEvidence.lab.resultPath
    ) {
      throw new Error(
        "CAPTURE_SESSION_INVALID: performance evidence must come from the capture session",
      );
    }
    return { artifact, session };
  }

  private async assertEvidenceFingerprintInputs(
    projectRoot: string,
    fingerprints: EvidenceFingerprintV1[],
  ): Promise<void> {
    if (fingerprints.length === 0) return;
    const root = await realpath(projectRoot);
    const verified = new Map<string, string>();
    for (const fingerprint of fingerprints) {
      for (const input of fingerprint.inputs) {
        if (!isSafeDurableEvidencePath(input.path)) {
          throw new Error(
            `EVIDENCE_FINGERPRINT_INVALID: unsafe dependency input path ${input.path}`,
          );
        }
        const requestedPath = path.resolve(root, input.path);
        assertWithinProjectRoot(root, requestedPath, input.path);
        let resolvedPath: string;
        try {
          resolvedPath = await realpath(requestedPath);
        } catch {
          throw new Error(`EVIDENCE_FINGERPRINT_INVALID: missing dependency input ${input.path}`);
        }
        assertWithinProjectRoot(root, resolvedPath, input.path);
        let digest = verified.get(resolvedPath);
        if (digest === undefined) {
          const details = await stat(resolvedPath);
          if (!details.isFile() || details.size > 50 * 1024 * 1024) {
            throw new Error(
              `EVIDENCE_FINGERPRINT_INVALID: dependency input must be a non-oversized file ${input.path}`,
            );
          }
          digest = `sha256:${createHash("sha256")
            .update(await readFile(resolvedPath))
            .digest("hex")}`;
          verified.set(resolvedPath, digest);
        }
        if (digest !== input.digest) {
          throw new Error(
            `EVIDENCE_FINGERPRINT_INVALID: dependency input digest changed for ${input.path}`,
          );
        }
      }
    }
  }

  private async writeCaptureSessionBinding(
    captureSession: { artifact: ArtifactRef; session: CaptureSessionReceiptV1 },
    packet: ImplementationReviewPacket,
  ): Promise<ArtifactRef> {
    const timestamp = this.now();
    const binding = {
      schemaVersion: "capture-session-binding-v1",
      captureSessionId: captureSession.session.captureSessionId,
      captureSessionArtifactId: captureSession.artifact.id,
      captureSessionDigest: captureSession.artifact.digest,
      reviewPacketId: packet.id,
      headSha: packet.headSha,
      diffDigest: packet.diffDigest,
    };
    const content = Buffer.from(`${JSON.stringify(binding, null, 2)}\n`, "utf8");
    const blob = await this.dependencies.artifactStore.writeBlob({
      content,
      mediaType: "application/json",
      storedAt: timestamp,
      label: "capture-session-binding-v1.json",
    });
    return ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "agent-result-report",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: timestamp,
      metadata: {
        adapter: "capture-session-binding-v1",
        schemaVersion: binding.schemaVersion,
        captureSessionId: binding.captureSessionId,
        captureSessionArtifactId: binding.captureSessionArtifactId,
        captureSessionDigest: binding.captureSessionDigest,
        reviewPacketId: binding.reviewPacketId,
        headSha: binding.headSha,
        diffDigest: binding.diffDigest,
      },
    });
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
    operations: Array<Record<string, unknown>>,
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
                  data: {
                    apiReady: true,
                    artifactIds,
                    implementationContextId,
                    operations,
                  },
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
    submission: StandardWorkflowSubmission,
  ): Promise<ArtifactRef[]> {
    const root = await realpath(run.projectRoot);
    const timestamp = this.now();
    const artifacts: ArtifactRef[] = [];
    const apiPhysicalFiles = new Map<string, string>();
    const legacyExecutableEvidence = new Set(
      submission.kind === "implementation"
        ? submission.legacyCoverage.flatMap((coverage) => coverage.executableEvidencePaths)
        : [],
    );
    const apiCoverageByEvidence = new Map<
      string,
      Array<{ operationKey: string; mockHandlers: string[] }>
    >();
    if (submission.kind === "implementation") {
      for (const coverage of submission.apiCoverage) {
        for (const evidencePath of coverage.executableEvidencePaths) {
          const existing = apiCoverageByEvidence.get(evidencePath) ?? [];
          existing.push({
            operationKey: coverage.operationKey,
            mockHandlers: coverage.mockHandlers,
          });
          apiCoverageByEvidence.set(evidencePath, existing);
        }
      }
    }
    const preparedEvidencePaths: Array<{
      evidencePath: string;
      resolvedPath: string;
      projectRelativePath: string;
    }> = [];

    const submissionEvidencePaths =
      submission.kind === "figma-bundle"
        ? [
            ...submission.artifactPaths,
            submission.designMapping.publicApiCatalog.packageManifest.path,
            ...submission.designMapping.publicApiCatalog.publicBarrels.map((barrel) => barrel.path),
            ...submission.designMapping.publicApiCatalog.publicSources.map((source) => source.path),
            ...(submission.designMapping.publicApiCatalog.codeConnectManifest === undefined
              ? []
              : [submission.designMapping.publicApiCatalog.codeConnectManifest.path]),
          ]
        : submission.artifactPaths;
    for (const evidencePath of [...new Set(submissionEvidencePaths)]) {
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

    if (submission.kind === "figma-bundle") {
      await assertFigmaDesignAssets(root, submission.designMapping);
      const catalogPaths = new Set([
        submission.designMapping.publicApiCatalog.packageManifest.path,
        ...submission.designMapping.publicApiCatalog.publicBarrels.map((barrel) => barrel.path),
        ...submission.designMapping.publicApiCatalog.publicSources.map((source) => source.path),
        ...(submission.designMapping.publicApiCatalog.codeConnectManifest === undefined
          ? []
          : [submission.designMapping.publicApiCatalog.codeConnectManifest.path]),
      ]);
      assertFigmaPublicApiCatalogEvidence({
        mapping: submission.designMapping,
        evidence: await Promise.all(
          preparedEvidencePaths
            .filter((item) => catalogPaths.has(item.evidencePath))
            .map(async (item) => ({
              path: item.evidencePath,
              content: await readFile(item.resolvedPath),
            })),
        ),
      });
    }

    const mockFixtureDigests = new Map<
      string,
      {
        id: string;
        digest: string;
        named: boolean;
        stateContractDigest?: string | undefined;
      }
    >();
    if (submission.kind === "implementation" && submission.mockDataEvidence !== undefined) {
      const physicalFixtures = new Set<string>();
      for (const fixture of normalizedMockFixtures(submission.mockDataEvidence)) {
        const fixturePath = fixture.path;
        const prepared = preparedEvidencePaths.find((item) => item.evidencePath === fixturePath);
        if (prepared === undefined) {
          throw new Error(`Mock fixture must be included in artifactPaths: ${fixturePath}`);
        }
        if (physicalFixtures.has(prepared.resolvedPath)) {
          throw new Error(`Mock fixture paths must resolve to distinct files: ${fixturePath}`);
        }
        physicalFixtures.add(prepared.resolvedPath);
        const content = await readFile(prepared.resolvedPath);
        assertMockFixture(content, fixturePath);
        mockFixtureDigests.set(fixturePath, {
          id: fixture.id,
          digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
          named: fixture.named,
          ...(fixture.stateContractDigest === undefined
            ? {}
            : { stateContractDigest: fixture.stateContractDigest }),
        });
      }
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
      const compatibilityTarget =
        submission.kind === "contracts"
          ? submission.visualTargets.find(
              (target) =>
                target.baselineKind === "legacy-screenshot" &&
                target.figmaCapture === undefined &&
                target.baselinePath === evidencePath,
            )
          : undefined;
      if (compatibilityTarget !== undefined) {
        assertCompatibilityBaselineGeometry(
          compatibilityTarget,
          readPngGeometry(content, evidencePath),
        );
      }
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
      if (legacyExecutableEvidence.has(evidencePath)) {
        assertPassingJsonResult(content, evidencePath);
      }
      const apiCoverage = apiCoverageByEvidence.get(evidencePath);
      if (apiCoverage !== undefined) {
        assertApiCoverageResult(content, evidencePath, apiCoverage);
      }
      if (
        submission.kind === "implementation" &&
        submission.performanceEvidence?.lab.resultPath === evidencePath
      ) {
        assertPerformanceResult(content, evidencePath, submission.performanceEvidence.lab.metrics);
      }
      if (
        submission.kind === "implementation" &&
        submission.mockDataEvidence?.manifestPath === evidencePath
      ) {
        assertDeterministicMockManifest(
          content,
          evidencePath,
          [...mockFixtureDigests].map(([fixturePath, fixture]) => ({
            fixturePath,
            ...fixture,
          })),
        );
      }
      if (submission.kind === "figma-bundle") {
        if (evidencePath === submission.manifestPath) {
          assertFigmaManifest(content, evidencePath, submission);
        } else {
          const catalogEvidence = [
            submission.designMapping.publicApiCatalog.packageManifest,
            ...submission.designMapping.publicApiCatalog.publicBarrels,
            ...submission.designMapping.publicApiCatalog.publicSources,
            ...(submission.designMapping.publicApiCatalog.codeConnectManifest === undefined
              ? []
              : [submission.designMapping.publicApiCatalog.codeConnectManifest]),
          ].find((candidate) => candidate.path === evidencePath);
          if (catalogEvidence !== undefined) {
            const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
            if (digest !== catalogEvidence.digest) {
              throw new Error(
                `FIGMA_DESIGN_MAPPING_INCOMPLETE: public API/Code Connect evidence digest does not match: ${evidencePath}`,
              );
            }
          } else {
            const target = submission.visualTargets.find(
              (candidate) => candidate.baselinePath === evidencePath,
            );
            if (target === undefined || target.figmaCapture === undefined) {
              throw new Error(
                `FIGMA_CAPTURE_GEOMETRY_INVALID: ${evidencePath} is not bound to a Figma target`,
              );
            }
            const decoded = await decodeBoundedPng(content, evidencePath);
            this.metrics.increment("visual.decode_pixels", decoded.width * decoded.height);
            const stateContract = submission.stateContracts.find(
              (contract) => contract.targetId === target.targetId,
            );
            if (stateContract === undefined) {
              throw new Error(
                `FIGMA_STATE_CONTRACT_INVALID: missing expected node/state binding for ${target.targetId}`,
              );
            }
            assertFigmaCaptureGeometry({
              geometry: target.figmaCapture,
              target: {
                nodeId: stateContract.nodeId,
                state: stateContract.state,
              },
              viewport: target.viewport,
              decodedSize: { width: decoded.width, height: decoded.height },
            });
          }
        }
      }
      const visualCapture =
        submission.kind === "visual-comparison"
          ? submission.captures.find((capture) => capture.actualPath === evidencePath)
          : undefined;
      const visualReceipt =
        submission.kind === "visual-comparison"
          ? submission.captures.find((capture) => capture.receiptPath === evidencePath)
          : undefined;
      const baselineIsolationEvidence =
        submission.kind === "visual-comparison" &&
        submission.baselineIsolationPath === evidencePath;
      if (submission.kind === "visual-comparison") {
        if (baselineIsolationEvidence) {
          let rawEvidence: unknown;
          try {
            rawEvidence = JSON.parse(content.toString("utf8"));
          } catch {
            throw new Error(
              `VISUAL_BASELINE_ISOLATION_INVALID: evidence must be strict JSON: ${evidencePath}`,
            );
          }
          const parsedIsolation = BaselineIsolationEvidenceSchema.safeParse(rawEvidence);
          if (!parsedIsolation.success) {
            throw new Error(
              `VISUAL_BASELINE_ISOLATION_INVALID: evidence schema is invalid: ${evidencePath}: ${parsedIsolation.error.issues.map((issue) => issue.message).join("; ")}`,
            );
          }
        } else if (visualReceipt !== undefined) {
          let rawReceipt: unknown;
          try {
            rawReceipt = JSON.parse(content.toString("utf8"));
          } catch {
            throw new Error(
              `VISUAL_CAPTURE_PROVENANCE_INVALID: receipt must be strict JSON: ${evidencePath}`,
            );
          }
          if (!VisualCaptureReceiptSchema.safeParse(rawReceipt).success) {
            throw new Error(
              `VISUAL_CAPTURE_PROVENANCE_INVALID: receipt schema is invalid: ${evidencePath}`,
            );
          }
        } else if (visualCapture !== undefined) {
          await assertPng(content, evidencePath);
        } else {
          throw new Error(
            `VISUAL_CAPTURE_PROVENANCE_INVALID: unbound visual artifact: ${evidencePath}`,
          );
        }
      }

      const mediaType = mediaTypeForPath(resolvedPath);
      const openSpecChangeName = openSpecChangeForContractArtifact(submission, projectRelativePath);
      const mockFixture = mockFixtureDigests.get(evidencePath);
      const blob = await this.dependencies.artifactStore.writeBlob({
        content,
        mediaType,
        storedAt: timestamp,
        label: path.posix.basename(projectRelativePath),
      });
      artifacts.push(
        ArtifactRefSchema.parse({
          id: createArtifactId(),
          kind:
            openSpecChangeName !== undefined
              ? "openspec"
              : (submission.kind === "figma-bundle" && /\.png$/i.test(evidencePath)) ||
                  visualCapture !== undefined
                ? "screenshot"
                : "other",
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
            ...(submission.kind !== "visual-comparison"
              ? {}
              : {
                  reviewPacketId: submission.reviewPacketId,
                  headSha: reviewPacketFromRun(run)?.headSha,
                  diffDigest: reviewPacketFromRun(run)?.diffDigest,
                  visualRole: baselineIsolationEvidence
                    ? "baseline-isolation"
                    : visualCapture === undefined
                      ? "capture-receipt"
                      : "actual",
                  ...(visualCapture === undefined ? {} : { targetId: visualCapture.targetId }),
                  ...(visualReceipt === undefined ? {} : { targetId: visualReceipt.targetId }),
                }),
            ...(featureEvidenceRole === undefined ? {} : { featureEvidenceRole }),
            ...(featureEvidenceRole !== "result" || submission.kind !== "implementation"
              ? {}
              : {
                  evidenceCommand: submission.featureEvidence?.testCommand,
                  evidenceSelector: submission.featureEvidence?.testSelector,
                }),
            ...(apiEvidenceRole === undefined ? {} : { apiEvidenceRole }),
            ...(mockFixture === undefined
              ? {}
              : {
                  mockFixtureId: mockFixture.id,
                  mockFixtureDigest: mockFixture.digest,
                  mockFixtureNamed: mockFixture.named,
                  ...(mockFixture.stateContractDigest === undefined
                    ? {}
                    : { stateContractDigest: mockFixture.stateContractDigest }),
                }),
            ...(openSpecChangeName === undefined ? {} : { changeName: openSpecChangeName }),
            ...(submission.kind !== "figma-bundle"
              ? {}
              : { figmaProvider: submission.provider, figmaCapturedAt: submission.capturedAt }),
          },
        }),
      );
    }

    return artifacts;
  }

  private async prepareVisualSubmissionEvidence(
    run: RunManifest,
    submission: Extract<WorkflowSubmission, { kind: "visual-comparison" }>,
  ): Promise<PreparedVisualEvidence[]> {
    const root = await realpath(run.projectRoot);
    const timestamp = this.now();
    const prepared: PreparedVisualEvidence[] = [];

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

      const content = await readFile(resolvedPath);
      const visualCapture = submission.captures.find(
        (capture) => capture.actualPath === evidencePath,
      );
      const visualReceipt = submission.captures.find(
        (capture) => capture.receiptPath === evidencePath,
      );
      const visualAssertion = submission.captures.find(
        (capture) => capture.assertionReportPath === evidencePath,
      );
      const visualAssertionResult = submission.captures.find(
        (capture) => capture.assertionResultPath === evidencePath,
      );
      const visualAssertionObservation = submission.captures.find(
        (capture) => capture.assertionObservationPath === evidencePath,
      );
      const baselineIsolationEvidence = submission.baselineIsolationPath === evidencePath;
      if (baselineIsolationEvidence) {
        let rawEvidence: unknown;
        try {
          rawEvidence = JSON.parse(content.toString("utf8"));
        } catch {
          throw new Error(
            `VISUAL_BASELINE_ISOLATION_INVALID: evidence must be strict JSON: ${evidencePath}`,
          );
        }
        const parsedIsolation = BaselineIsolationEvidenceSchema.safeParse(rawEvidence);
        if (!parsedIsolation.success) {
          throw new Error(
            `VISUAL_BASELINE_ISOLATION_INVALID: evidence schema is invalid: ${evidencePath}: ${parsedIsolation.error.issues.map((issue) => issue.message).join("; ")}`,
          );
        }
      } else if (visualReceipt !== undefined) {
        let rawReceipt: unknown;
        try {
          rawReceipt = JSON.parse(content.toString("utf8"));
        } catch {
          throw new Error(
            `VISUAL_CAPTURE_PROVENANCE_INVALID: receipt must be strict JSON: ${evidencePath}`,
          );
        }
        if (!VisualCaptureReceiptSchema.safeParse(rawReceipt).success) {
          throw new Error(
            `VISUAL_CAPTURE_PROVENANCE_INVALID: receipt schema is invalid: ${evidencePath}`,
          );
        }
      } else if (visualAssertion !== undefined) {
        let rawAssertionReport: unknown;
        try {
          rawAssertionReport = JSON.parse(content.toString("utf8"));
        } catch {
          throw new Error(
            `UI_ASSERTION_REPORT_INVALID: report must be strict JSON: ${evidencePath}`,
          );
        }
        const parsedAssertionReport = UiAssertionReportSchema.safeParse(rawAssertionReport);
        if (!parsedAssertionReport.success) {
          throw new Error(
            `UI_ASSERTION_REPORT_INVALID: report schema is invalid: ${evidencePath}: ${parsedAssertionReport.error.issues.map((issue) => issue.message).join("; ")}`,
          );
        }
      } else if (visualAssertionResult !== undefined) {
        let rawResult: unknown;
        try {
          rawResult = JSON.parse(content.toString("utf8"));
        } catch {
          throw new Error(
            `UI_ASSERTION_REPORT_INVALID: Playwright CLI result must be strict JSON: ${evidencePath}`,
          );
        }
        const parsedResult = PlaywrightCliResultSchema.safeParse(rawResult);
        if (!parsedResult.success) {
          throw new Error(
            `UI_ASSERTION_REPORT_INVALID: Playwright CLI result schema is invalid: ${evidencePath}: ${parsedResult.error.issues.map((issue) => issue.message).join("; ")}`,
          );
        }
      } else if (visualAssertionObservation !== undefined) {
        let rawObservation: unknown;
        try {
          rawObservation = JSON.parse(content.toString("utf8"));
        } catch {
          throw new Error(
            `UI_ASSERTION_REPORT_INVALID: observation must be strict JSON: ${evidencePath}`,
          );
        }
        const parsedObservation = UiAssertionObservationSchema.safeParse(rawObservation);
        if (!parsedObservation.success) {
          throw new Error(
            `UI_ASSERTION_REPORT_INVALID: observation schema is invalid: ${evidencePath}: ${parsedObservation.error.issues.map((issue) => issue.message).join("; ")}`,
          );
        }
      } else if (visualCapture !== undefined) {
        await assertPng(content, evidencePath);
      } else {
        throw new Error(
          `VISUAL_CAPTURE_PROVENANCE_INVALID: unbound visual artifact: ${evidencePath}`,
        );
      }

      const mediaType = mediaTypeForPath(resolvedPath);
      const digest = `sha256:${createHash("sha256").update(content).digest("hex")}` as const;
      prepared.push({
        content,
        label: path.posix.basename(projectRelativePath),
        artifact: ArtifactRefSchema.parse({
          id: createArtifactId(),
          kind: visualCapture === undefined ? "other" : "screenshot",
          uri: `artifact://sha256/${digest.slice("sha256:".length)}`,
          mediaType,
          digest,
          producedBy: producerForSubmission(submission),
          evidenceIds: [],
          createdAt: timestamp,
          metadata: {
            adapter: "workflow-v2-evidence",
            projectRelativePath,
            byteLength: details.size,
            workflowSubmissionKind: submission.kind,
            reviewPacketId: submission.reviewPacketId,
            headSha: reviewPacketFromRun(run)?.headSha,
            diffDigest: reviewPacketFromRun(run)?.diffDigest,
            visualRole: baselineIsolationEvidence
              ? "baseline-isolation"
              : visualReceipt !== undefined
                ? "capture-receipt"
                : visualAssertion !== undefined
                  ? "ui-assertions"
                  : visualAssertionResult !== undefined
                    ? "ui-assertion-result"
                    : visualAssertionObservation !== undefined
                      ? "ui-assertion-observation"
                      : "actual",
            ...(visualCapture === undefined ? {} : { targetId: visualCapture.targetId }),
            ...(visualReceipt === undefined ? {} : { targetId: visualReceipt.targetId }),
            ...(visualAssertion === undefined ? {} : { targetId: visualAssertion.targetId }),
            ...(visualAssertionResult === undefined
              ? {}
              : { targetId: visualAssertionResult.targetId }),
            ...(visualAssertionObservation === undefined
              ? {}
              : { targetId: visualAssertionObservation.targetId }),
          },
        }),
      });
    }

    return prepared;
  }

  private async persistPreparedVisualEvidence(prepared: PreparedVisualEvidence[]): Promise<void> {
    for (const item of prepared) {
      const blob = await this.dependencies.artifactStore.writeBlob({
        content: item.content,
        mediaType: item.artifact.mediaType,
        storedAt: item.artifact.createdAt,
        label: item.label,
      });
      if (blob.digest !== item.artifact.digest || blob.uri !== item.artifact.uri) {
        throw new Error("Prepared visual evidence changed while being persisted");
      }
    }
  }

  private async assertVisualCaptureAcquisition(
    run: RunManifest,
    packet: ImplementationReviewPacket,
    submission: Extract<WorkflowSubmission, { kind: "visual-comparison" }>,
    targets: VisualTargetManifest[],
    evidenceArtifacts: ArtifactRef[],
    preparedContent: ReadonlyMap<string, Buffer>,
  ): Promise<`sha256:${string}` | undefined> {
    const mapping = figmaDesignMappingFromRun(run);
    const expectedFonts = canonicalCaptureFontDigests(mapping?.fonts ?? []);
    let rendererLineageId: `sha256:${string}` | undefined;
    const expectedAssets = canonicalCaptureAssetDigests(
      mapping?.components.flatMap((component) =>
        component.resolution.kind === "asset"
          ? [{ path: component.resolution.path, digest: component.resolution.digest }]
          : [],
      ) ?? [],
    );

    for (const target of targets) {
      const capture = submission.captures.find(
        (candidate) => candidate.targetId === target.targetId,
      );
      if (capture === undefined) {
        throw new Error(
          `VISUAL_CAPTURE_PROVENANCE_INVALID: missing capture for ${target.targetId}`,
        );
      }
      const actualArtifact = evidenceArtifacts.find(
        (artifact) => artifact.metadata["projectRelativePath"] === capture.actualPath,
      );
      if (actualArtifact === undefined) {
        throw new Error(
          `VISUAL_CAPTURE_PROVENANCE_INVALID: missing actual PNG for ${target.targetId}`,
        );
      }
      const expectedBaselineSubmissionKind =
        target.baselineKind === "figma" ? "figma-bundle" : "contracts";
      const baselineArtifact = [...run.artifacts]
        .reverse()
        .find(
          (artifact) =>
            artifact.metadata["projectRelativePath"] === target.baselinePath &&
            artifact.metadata["workflowSubmissionKind"] === expectedBaselineSubmissionKind,
        );
      if (baselineArtifact === undefined) {
        throw new Error(
          `VISUAL_CAPTURE_PROVENANCE_INVALID: missing immutable baseline for ${target.targetId}`,
        );
      }

      if (target.figmaCapture === undefined) {
        if (
          capture.assertionReportPath !== undefined ||
          capture.assertionResultPath !== undefined ||
          capture.assertionObservationPath !== undefined
        ) {
          throw new Error(
            `UI_ASSERTION_REPORT_INVALID: compatibility target ${target.targetId} forbids unbound UI assertion artifacts`,
          );
        }
        if (actualArtifact.digest === baselineArtifact.digest) {
          throw new Error(
            "VISUAL_CAPTURE_REPLAY: identical compatibility captures require a strict packet receipt",
          );
        }
        continue;
      }
      if (capture.receiptPath === undefined || capture.receiptDigest === undefined) {
        throw new Error(
          `VISUAL_CAPTURE_PROVENANCE_INVALID: strict target ${target.targetId} requires a capture receipt`,
        );
      }
      if (
        capture.assertionReportPath === undefined ||
        capture.assertionReportDigest === undefined ||
        capture.assertionResultPath === undefined ||
        capture.assertionResultDigest === undefined ||
        capture.assertionObservationPath === undefined ||
        capture.assertionObservationDigest === undefined
      ) {
        throw new Error(
          `UI_ASSERTION_REPORT_INVALID: strict target ${target.targetId} requires a report and Playwright CLI result`,
        );
      }
      const receiptArtifact = evidenceArtifacts.find(
        (artifact) => artifact.metadata["projectRelativePath"] === capture.receiptPath,
      );
      if (receiptArtifact === undefined) {
        throw new Error(
          `VISUAL_CAPTURE_PROVENANCE_INVALID: missing receipt for ${target.targetId}`,
        );
      }
      const fixtureArtifact = [...run.artifacts]
        .reverse()
        .find(
          (artifact) =>
            artifact.metadata["workflowSubmissionKind"] === "implementation" &&
            artifact.metadata["mockFixtureId"] === target.fixture,
        );
      if (fixtureArtifact === undefined) {
        throw new Error(
          `MOCK_FIXTURE_NOT_CONSUMED: no immutable fixture digest exists for ${target.fixture}`,
        );
      }
      const actualContent =
        preparedContent.get(actualArtifact.digest) ??
        (await this.dependencies.artifactStore.readContent(actualArtifact.digest));
      const decodedActual = await decodeBoundedPng(
        actualContent,
        `${target.targetId} browser capture`,
      );
      this.metrics.increment("visual.decode_pixels", decodedActual.width * decodedActual.height);
      const expectedWidth = Math.round(target.viewport.width * target.deviceScaleFactor);
      const expectedHeight = Math.round(target.viewport.height * target.deviceScaleFactor);
      if (decodedActual.width !== expectedWidth || decodedActual.height !== expectedHeight) {
        throw new Error(
          `VISUAL_CAPTURE_PROVENANCE_INVALID: decoded actual is ${decodedActual.width}x${decodedActual.height}, expected ${expectedWidth}x${expectedHeight}`,
        );
      }
      let receipt: unknown;
      try {
        const receiptContent =
          preparedContent.get(receiptArtifact.digest) ??
          (await this.dependencies.artifactStore.readContent(receiptArtifact.digest));
        receipt = JSON.parse(receiptContent.toString("utf8"));
      } catch {
        throw new Error(
          `VISUAL_CAPTURE_PROVENANCE_INVALID: receipt must be strict JSON for ${target.targetId}`,
        );
      }
      const stateContract = figmaStateContractsFromRun(run).find(
        (contract) => contract.targetId === target.targetId,
      );
      if (stateContract === undefined) {
        throw new Error(
          `UI_ASSERTION_REPORT_INVALID: missing state contract for ${target.targetId}`,
        );
      }
      const validated = assertCaptureReceipt({
        receipt,
        packet,
        target,
        actualDigest: actualArtifact.digest,
        fixtureDigest: fixtureArtifact.digest,
        actualPath: capture.actualPath,
        expectedFonts,
        expectedAssets,
        stateContractDigest: stateContract.digest,
      });
      if (validated.capturedAt !== capture.capturedAt) {
        throw new Error(
          `VISUAL_CAPTURE_PROVENANCE_INVALID: receipt timestamp does not match ${target.targetId}`,
        );
      }
      const assertionArtifact = evidenceArtifacts.find(
        (artifact) =>
          artifact.metadata["projectRelativePath"] === capture.assertionReportPath &&
          artifact.metadata["visualRole"] === "ui-assertions",
      );
      if (assertionArtifact === undefined) {
        throw new Error(`UI_ASSERTION_REPORT_INVALID: missing report for ${target.targetId}`);
      }
      const assertionResultArtifact = evidenceArtifacts.find(
        (artifact) =>
          artifact.metadata["projectRelativePath"] === capture.assertionResultPath &&
          artifact.metadata["visualRole"] === "ui-assertion-result",
      );
      if (assertionResultArtifact === undefined) {
        throw new Error(
          `UI_ASSERTION_REPORT_INVALID: missing Playwright CLI result for ${target.targetId}`,
        );
      }
      const assertionObservationArtifact = evidenceArtifacts.find(
        (artifact) =>
          artifact.metadata["projectRelativePath"] === capture.assertionObservationPath &&
          artifact.metadata["visualRole"] === "ui-assertion-observation",
      );
      if (assertionObservationArtifact === undefined) {
        throw new Error(`UI_ASSERTION_REPORT_INVALID: missing observation for ${target.targetId}`);
      }
      let assertionReport: unknown;
      try {
        const assertionContent =
          preparedContent.get(assertionArtifact.digest) ??
          (await this.dependencies.artifactStore.readContent(assertionArtifact.digest));
        assertionReport = JSON.parse(assertionContent.toString("utf8"));
      } catch {
        throw new Error(
          `UI_ASSERTION_REPORT_INVALID: report must be strict JSON for ${target.targetId}`,
        );
      }
      let assertionResult: unknown;
      try {
        const assertionResultContent =
          preparedContent.get(assertionResultArtifact.digest) ??
          (await this.dependencies.artifactStore.readContent(assertionResultArtifact.digest));
        assertionResult = JSON.parse(assertionResultContent.toString("utf8"));
      } catch {
        throw new Error(
          `UI_ASSERTION_REPORT_INVALID: Playwright CLI result must be strict JSON for ${target.targetId}`,
        );
      }
      let assertionObservation: unknown;
      try {
        const assertionObservationContent =
          preparedContent.get(assertionObservationArtifact.digest) ??
          (await this.dependencies.artifactStore.readContent(assertionObservationArtifact.digest));
        assertionObservation = JSON.parse(assertionObservationContent.toString("utf8"));
      } catch {
        throw new Error(
          `UI_ASSERTION_REPORT_INVALID: observation must be strict JSON for ${target.targetId}`,
        );
      }
      assertUiAssertionReport({
        report: assertionReport,
        packet,
        target,
        stateContract,
        captureReceiptDigest: capture.receiptDigest,
        producerResultPath: capture.assertionResultPath,
        producerResultDigest: capture.assertionResultDigest,
        producerResult: assertionResult,
        producerObservationPath: capture.assertionObservationPath,
        producerObservationDigest: capture.assertionObservationDigest,
        producerObservation: assertionObservation,
        screenshotPath: capture.actualPath,
        screenshotDigest: capture.actualDigest,
      });
      const captureLineageId = captureRendererLineageId(validated.environment);
      if (rendererLineageId !== undefined && captureLineageId !== rendererLineageId) {
        throw rendererDriftError(
          `target ${target.targetId} uses ${captureLineageId}, expected ${rendererLineageId}`,
        );
      }
      rendererLineageId = captureLineageId;
    }
    if (rendererLineageId !== undefined) {
      assertRendererLineageMatchesCommittedAttempts(run, packet, rendererLineageId);
    }
    return rendererLineageId;
  }

  private async assertVisualBaselineIsolation(
    run: RunManifest,
    packet: ImplementationReviewPacket,
    submission: Extract<WorkflowSubmission, { kind: "visual-comparison" }>,
    targets: VisualTargetManifest[],
    evidenceArtifacts: ArtifactRef[],
    preparedContent: ReadonlyMap<string, Buffer>,
  ): Promise<void> {
    const isolationArtifact = evidenceArtifacts.find(
      (artifact) =>
        artifact.metadata["projectRelativePath"] === submission.baselineIsolationPath &&
        artifact.metadata["visualRole"] === "baseline-isolation",
    );
    if (isolationArtifact === undefined) {
      throw new Error(
        `VISUAL_BASELINE_ISOLATION_INVALID: missing evidence ${submission.baselineIsolationPath}`,
      );
    }
    const content =
      preparedContent.get(isolationArtifact.digest) ??
      (await this.dependencies.artifactStore.readContent(isolationArtifact.digest));
    let evidence: unknown;
    try {
      evidence = JSON.parse(content.toString("utf8"));
    } catch {
      throw new Error("VISUAL_BASELINE_ISOLATION_INVALID: evidence must be strict JSON");
    }
    const baselineArtifacts = visualBaselineArtifacts(run, targets);
    const sourceInputs = baselineIsolationSourceInputsFromRun(run, packet);
    await assertBaselineIsolation({
      projectRoot: run.projectRoot,
      packet,
      baselineArtifacts,
      evidence,
      implementationSourceFiles: sourceInputs.implementationSourceFiles,
      designSystemSourceFiles: sourceInputs.designSystemSourceFiles,
      browserBundlePaths: sourceInputs.browserBundlePaths,
      excludedPaths: [
        ...sourceInputs.registeredExcludedPaths,
        ...submission.artifactPaths,
        ...targets.map((target) => target.baselinePath),
      ],
    });
  }

  private async recordVisualComparison(
    run: RunManifest,
    submission: Extract<WorkflowSubmission, { kind: "visual-comparison" }>,
  ): Promise<void> {
    if (stage(run, "intake").status !== "passed") {
      throw new Error("The intake stage must pass before downstream evidence can be submitted");
    }
    const profile = deliveryProfileFromRun(run);
    if (!profile.requirements.visualComparison) {
      throw new Error("Visual comparison is not applicable to this delivery profile");
    }
    const packet = reviewPacketFromRun(run);
    if (packet === undefined || packet.id !== submission.reviewPacketId) {
      throw new Error("Visual comparison must reference the current implementation review packet");
    }
    const targets = visualTargetsFromRun(run);
    if (targets.length === 0) {
      throw new Error("Visual comparison requires a declared Figma or legacy target manifest");
    }
    const historicalFigmaTarget = targets.find(
      (target) =>
        target.baselineKind === "figma" &&
        (target.figmaCapture === undefined || !("schemaVersion" in target.figmaCapture)),
    );
    if (historicalFigmaTarget !== undefined) {
      throw new Error(
        `FIGMA_CAPTURE_GEOMETRY_REACQUISITION_REQUIRED: persisted target ${historicalFigmaTarget.targetId} lacks present v2 geometry`,
      );
    }
    const captures = new Map(submission.captures.map((capture) => [capture.targetId, capture]));
    const targetIds = new Set(targets.map((target) => target.targetId));
    const missing = targets
      .map((target) => target.targetId)
      .filter((targetId) => !captures.has(targetId));
    const unknown = submission.captures
      .map((capture) => capture.targetId)
      .filter((targetId) => !targetIds.has(targetId));
    if (missing.length > 0 || unknown.length > 0) {
      throw new Error(
        `Visual captures must exactly cover declared targets; missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}`,
      );
    }
    const mismatchedCapture = targets.find((target) => {
      const capture = captures.get(target.targetId)!;
      return (
        capture.route !== target.route ||
        capture.state !== target.state ||
        capture.viewport.width !== target.viewport.width ||
        capture.viewport.height !== target.viewport.height ||
        capture.deviceScaleFactor !== target.deviceScaleFactor ||
        capture.fixture !== target.fixture
      );
    });
    if (mismatchedCapture !== undefined) {
      throw new Error(
        `Visual capture manifest does not match declared target ${mismatchedCapture.targetId}`,
      );
    }
    const replayedBaseline = submission.captures.find((capture) =>
      targets.some((target) => target.baselinePath === capture.actualPath),
    );
    if (replayedBaseline !== undefined) {
      throw new Error(
        `VISUAL_CAPTURE_REPLAY: ${replayedBaseline.actualPath} is a declared baseline path`,
      );
    }
    const submissionIdentity = visualSubmissionIdentity(packet.id, submission.captures);
    const committedReplay = this.isCommittedVisualReplay(run, submission);
    if (stage(run, "implementation").status !== "passed" && !committedReplay) {
      throw new Error("Implementation must pass before visual comparison");
    }
    const preparedEvidence = await this.prepareVisualSubmissionEvidence(run, submission);
    const actualArtifacts = preparedEvidence.map((item) => item.artifact);
    const boundEvidenceArtifacts = actualArtifacts.map((artifact) => {
      const capture = submission.captures.find(
        (capture) => capture.actualPath === artifact.metadata["projectRelativePath"],
      );
      const receiptCapture = submission.captures.find(
        (capture) => capture.receiptPath === artifact.metadata["projectRelativePath"],
      );
      const assertionCapture = submission.captures.find(
        (capture) => capture.assertionReportPath === artifact.metadata["projectRelativePath"],
      );
      const assertionResultCapture = submission.captures.find(
        (capture) => capture.assertionResultPath === artifact.metadata["projectRelativePath"],
      );
      const assertionObservationCapture = submission.captures.find(
        (capture) => capture.assertionObservationPath === artifact.metadata["projectRelativePath"],
      );
      const baselineIsolationArtifact =
        submission.baselineIsolationPath === artifact.metadata["projectRelativePath"];
      if (capture !== undefined && capture.actualDigest !== artifact.digest) {
        throw new Error(
          `VISUAL_CAPTURE_DIGEST_MISMATCH: ${capture.actualPath} does not match its declared digest`,
        );
      }
      if (receiptCapture !== undefined && receiptCapture.receiptDigest !== artifact.digest) {
        throw new Error(
          `VISUAL_CAPTURE_PROVENANCE_INVALID: ${receiptCapture.receiptPath} does not match its declared digest`,
        );
      }
      if (
        assertionCapture !== undefined &&
        assertionCapture.assertionReportDigest !== artifact.digest
      ) {
        throw new Error(
          `UI_ASSERTION_REPORT_INVALID: ${assertionCapture.assertionReportPath} does not match its declared digest`,
        );
      }
      if (
        assertionResultCapture !== undefined &&
        assertionResultCapture.assertionResultDigest !== artifact.digest
      ) {
        throw new Error(
          `UI_ASSERTION_REPORT_INVALID: ${assertionResultCapture.assertionResultPath} does not match its declared digest`,
        );
      }
      if (
        assertionObservationCapture !== undefined &&
        assertionObservationCapture.assertionObservationDigest !== artifact.digest
      ) {
        throw new Error(
          `UI_ASSERTION_REPORT_INVALID: ${assertionObservationCapture.assertionObservationPath} does not match its declared digest`,
        );
      }
      if (baselineIsolationArtifact && submission.baselineIsolationDigest !== artifact.digest) {
        throw new Error(
          `VISUAL_BASELINE_ISOLATION_INVALID: ${submission.baselineIsolationPath} does not match its declared digest`,
        );
      }
      return ArtifactRefSchema.parse({
        ...artifact,
        metadata: {
          ...artifact.metadata,
          ...(capture === undefined &&
          receiptCapture === undefined &&
          assertionCapture === undefined &&
          assertionResultCapture === undefined &&
          assertionObservationCapture === undefined
            ? {}
            : {
                targetId: (capture ??
                  receiptCapture ??
                  assertionCapture ??
                  assertionResultCapture ??
                  assertionObservationCapture)!.targetId,
                captureProvider: (capture ??
                  receiptCapture ??
                  assertionCapture ??
                  assertionResultCapture ??
                  assertionObservationCapture)!.provider,
                visualCapturedAt: (capture ??
                  receiptCapture ??
                  assertionCapture ??
                  assertionResultCapture ??
                  assertionObservationCapture)!.capturedAt,
                ...(capture !== undefined
                  ? { declaredCaptureDigest: capture.actualDigest }
                  : receiptCapture !== undefined
                    ? { declaredReceiptDigest: receiptCapture!.receiptDigest }
                    : assertionCapture !== undefined
                      ? {
                          declaredAssertionReportDigest: assertionCapture!.assertionReportDigest,
                        }
                      : assertionResultCapture !== undefined
                        ? {
                            declaredAssertionResultDigest:
                              assertionResultCapture!.assertionResultDigest,
                          }
                        : {
                            declaredAssertionObservationDigest:
                              assertionObservationCapture!.assertionObservationDigest,
                          }),
              }),
        },
      });
    });
    const preparedContent = new Map(
      preparedEvidence.map((item) => [item.artifact.digest, item.content] as const),
    );
    await this.assertVisualBaselineIsolation(
      run,
      packet,
      submission,
      targets,
      boundEvidenceArtifacts,
      preparedContent,
    );
    const rendererLineageId = await this.assertVisualCaptureAcquisition(
      run,
      packet,
      submission,
      targets,
      boundEvidenceArtifacts,
      preparedContent,
    );
    const reservationResult = await this.reserveVisualAttempt(
      run.id,
      packet,
      submissionIdentity,
      rendererLineageId,
      async (current) => {
        await this.assertVisualBaselineIsolation(
          current,
          packet,
          submission,
          targets,
          boundEvidenceArtifacts,
          preparedContent,
        );
        await assertReviewPacketFresh(current, this.dependencies.artifactStore, this.metrics, {
          allowedUntrackedPaths: submission.artifactPaths,
        });
      },
    );
    if (reservationResult.kind === "busy") {
      throw new Error(
        "VISUAL_ATTEMPT_IN_PROGRESS: a visual comparison lease is active; refresh workflow_status and retry",
      );
    }
    const reservation = reservationResult.reservation;
    const attempt = reservation.attempt;
    const lineageId = visualLineageId(packet);

    try {
      if (reservationResult.kind === "committed-replay") return;
      await this.persistPreparedVisualEvidence(preparedEvidence);
      const attemptEvidenceArtifacts = boundEvidenceArtifacts.map((artifact) =>
        ArtifactRefSchema.parse({
          ...artifact,
          metadata: { ...artifact.metadata, visualComparisonAttempt: attempt, submissionIdentity },
        }),
      );
      const attemptActualArtifacts = attemptEvidenceArtifacts.filter(
        (artifact) => artifact.metadata["visualRole"] === "actual",
      );
      const timestamp = this.now();
      const generatedArtifacts: ArtifactRef[] = [];
      const results: Array<Record<string, unknown>> = [];
      type NormalizedVisual = Awaited<ReturnType<typeof normalizeVisualPng>>;
      const preparedTargets: Array<{
        target: VisualTargetManifest;
        capture: (typeof submission.captures)[number];
        receipt: z.infer<typeof VisualCaptureReceiptV2Schema> | undefined;
        actualArtifact: ArtifactRef;
        baselineArtifact: ArtifactRef;
        comparisonBaseline: Buffer;
        comparisonActual: Buffer;
        normalizedBaseline?: NormalizedVisual;
        normalizedActual?: NormalizedVisual;
      }> = [];
      for (const target of targets) {
        const capture = captures.get(target.targetId)!;
        const receiptArtifact = attemptEvidenceArtifacts.find(
          (artifact) =>
            artifact.metadata["visualRole"] === "capture-receipt" &&
            artifact.metadata["targetId"] === target.targetId,
        );
        const receipt =
          receiptArtifact === undefined
            ? undefined
            : VisualCaptureReceiptV2Schema.parse(
                JSON.parse(
                  (
                    preparedContent.get(receiptArtifact.digest) ??
                    (await this.dependencies.artifactStore.readContent(receiptArtifact.digest))
                  ).toString("utf8"),
                ),
              );
        const actualArtifact = attemptActualArtifacts.find(
          (artifact) => artifact.metadata["projectRelativePath"] === capture.actualPath,
        );
        if (actualArtifact === undefined) {
          throw new Error(
            `Missing ingested actual PNG for ${target.targetId}: ${capture.actualPath}`,
          );
        }
        const expectedBaselineSubmissionKind =
          target.baselineKind === "figma" ? "figma-bundle" : "contracts";
        const baselineArtifact = [...run.artifacts]
          .reverse()
          .find(
            (artifact) =>
              artifact.metadata["projectRelativePath"] === target.baselinePath &&
              artifact.metadata["workflowSubmissionKind"] === expectedBaselineSubmissionKind,
          );
        if (baselineArtifact === undefined) {
          throw new Error(
            `Missing immutable ${target.baselineKind} baseline for ${target.targetId}: ${target.baselinePath}`,
          );
        }

        const baselineContent = await this.dependencies.artifactStore.readContent(
          baselineArtifact.digest,
        );
        const actualContent = await this.dependencies.artifactStore.readContent(
          actualArtifact.digest,
        );
        let comparisonBaseline = baselineContent;
        let comparisonActual = actualContent;
        let normalizedBaseline: NormalizedVisual | undefined;
        let normalizedActual: NormalizedVisual | undefined;

        if (target.figmaCapture !== undefined) {
          normalizedBaseline = await normalizeVisualPng({
            content: baselineContent,
            sourceDigest: baselineArtifact.digest as `sha256:${string}`,
            sourceSize: target.figmaCapture.bitmapSize,
            logicalSize: target.figmaCapture.logicalSize,
            colorSpace: target.figmaCapture.colorSpace,
            role: `${target.targetId} Figma baseline`,
          });
          normalizedActual = await normalizeVisualPng({
            content: actualContent,
            sourceDigest: actualArtifact.digest as `sha256:${string}`,
            sourceSize: {
              width: Math.round(target.viewport.width * target.deviceScaleFactor),
              height: Math.round(target.viewport.height * target.deviceScaleFactor),
            },
            logicalSize: target.figmaCapture.logicalSize,
            colorSpace: target.figmaCapture.colorSpace,
            role: `${target.targetId} browser capture`,
            cacheRead: false,
          });
          this.metrics.increment(
            normalizedBaseline.cacheStatus === "miss"
              ? "visual.normalization_cache_miss"
              : "visual.normalization_cache_hit",
          );
          this.metrics.increment("visual.normalization_cache_miss");
          this.metrics.increment(
            "visual.decode_pixels",
            (normalizedBaseline.cacheStatus === "miss"
              ? target.figmaCapture.bitmapSize.width * target.figmaCapture.bitmapSize.height
              : 0) +
              Math.round(target.viewport.width * target.deviceScaleFactor) *
                Math.round(target.viewport.height * target.deviceScaleFactor),
          );
          this.metrics.increment(
            "visual.encode_pixels",
            (normalizedBaseline.cacheStatus === "miss"
              ? normalizedBaseline.width * normalizedBaseline.height
              : 0) +
              normalizedActual.width * normalizedActual.height,
          );
          comparisonBaseline = normalizedBaseline.content;
          comparisonActual = normalizedActual.content;
        }
        preparedTargets.push({
          target,
          capture,
          receipt,
          actualArtifact,
          baselineArtifact,
          comparisonBaseline,
          comparisonActual,
          ...(normalizedBaseline === undefined ? {} : { normalizedBaseline }),
          ...(normalizedActual === undefined ? {} : { normalizedActual }),
        });
      }

      const comparisonResults = await defaultVisualComparisonPool.compare(
        preparedTargets.map((prepared) => ({
          targetId: prepared.target.targetId,
          baseline: prepared.comparisonBaseline,
          actual: prepared.comparisonActual,
          ...(prepared.normalizedBaseline === undefined || prepared.normalizedActual === undefined
            ? {}
            : {
                baselineRgba: {
                  data: prepared.normalizedBaseline.rgba,
                  width: prepared.normalizedBaseline.width,
                  height: prepared.normalizedBaseline.height,
                },
                actualRgba: {
                  data: prepared.normalizedActual.rgba,
                  width: prepared.normalizedActual.width,
                  height: prepared.normalizedActual.height,
                },
              }),
          masks: prepared.target.masks,
        })),
      );
      const poolAfter = defaultVisualComparisonPool.snapshotStats();
      this.metrics.gauge("visual.active_workers", poolAfter.activeWorkers, {
        stage: "implementation",
      });
      this.metrics.gauge("visual.peak_workers", poolAfter.peakActiveWorkers, {
        stage: "implementation",
      });

      for (const [index, prepared] of preparedTargets.entries()) {
        const { target, capture, receipt, actualArtifact, baselineArtifact } = prepared;
        const artifactBase = `visual/${target.targetId}`;
        let comparedActualArtifact = actualArtifact;
        let baselineRef: ArtifactRef;
        if (prepared.normalizedBaseline !== undefined && prepared.normalizedActual !== undefined) {
          baselineRef = await this.writeVisualArtifact({
            content: prepared.normalizedBaseline.content,
            kind: "screenshot",
            projectRelativePath: `${artifactBase}.baseline.normalized.png`,
            targetId: target.targetId,
            role: "baseline-normalized",
            packet,
            attempt,
            timestamp,
            sourceArtifactId: baselineArtifact.id,
            normalizerVersion: prepared.normalizedBaseline.version,
          });
          comparedActualArtifact = await this.writeVisualArtifact({
            content: prepared.normalizedActual.content,
            kind: "screenshot",
            projectRelativePath: `${artifactBase}.actual.normalized.png`,
            targetId: target.targetId,
            role: "actual-normalized",
            packet,
            attempt,
            timestamp,
            sourceArtifactId: actualArtifact.id,
            normalizerVersion: prepared.normalizedActual.version,
          });
          generatedArtifacts.push(baselineRef, comparedActualArtifact);
        } else {
          baselineRef = ArtifactRefSchema.parse({
            ...baselineArtifact,
            id: createArtifactId(),
            kind: "screenshot",
            producedBy: "orchestrator",
            createdAt: timestamp,
            metadata: {
              ...baselineArtifact.metadata,
              projectRelativePath: `${artifactBase}.baseline.png`,
              reviewPacketId: packet.id,
              headSha: packet.headSha,
              diffDigest: packet.diffDigest,
              targetId: target.targetId,
              visualRole: "baseline",
              visualComparisonAttempt: attempt,
              sourceArtifactId: baselineArtifact.id,
            },
          });
          generatedArtifacts.push(baselineRef);
        }
        const comparison = comparisonResults[index]?.comparison;
        if (comparison === undefined) {
          throw new Error(`VISUAL_COMPARISON_INCOMPLETE: missing result for ${target.targetId}`);
        }
        const diffArtifact = await this.writeVisualArtifact({
          content: comparison.diff,
          kind: "visual-diff",
          projectRelativePath: `${artifactBase}.diff.png`,
          targetId: target.targetId,
          role: "diff",
          packet,
          attempt,
          timestamp,
        });
        const overlayArtifact = await this.writeVisualArtifact({
          content: comparison.overlay,
          kind: "screenshot",
          projectRelativePath: `${artifactBase}.overlay.png`,
          targetId: target.targetId,
          role: "overlay",
          packet,
          attempt,
          timestamp,
        });
        generatedArtifacts.push(diffArtifact, overlayArtifact);
        results.push({
          targetId: target.targetId,
          name: target.name,
          state: target.state,
          route: target.route,
          baselineKind: target.baselineKind,
          viewport: target.viewport,
          deviceScaleFactor: target.deviceScaleFactor,
          fixture: target.fixture,
          captureProvider: capture.provider,
          ...(receipt === undefined
            ? {}
            : {
                captureSummary: {
                  provider: capture.provider,
                  browser: `${receipt.environment.browser.family} ${receipt.environment.browser.version}`,
                  fontsReady: receipt.environment.readiness.fontsReady,
                  assetsReady: receipt.environment.readiness.assetsReady,
                },
              }),
          capturedAt: capture.capturedAt,
          actualDigest: capture.actualDigest,
          masks: target.masks,
          maskReasons: comparison.maskReasons,
          status: comparison.status,
          metrics: comparison.metrics,
          baselineArtifactId: baselineRef.id,
          actualArtifactId: comparedActualArtifact.id,
          sourceBaselineArtifactId: baselineArtifact.id,
          sourceActualArtifactId: actualArtifact.id,
          ...(prepared.normalizedBaseline === undefined
            ? {}
            : {
                normalizerVersion: "visual-normalizer-v1",
                normalizedBaselineDigest: baselineRef.digest,
                normalizedActualDigest: comparedActualArtifact.digest,
              }),
          diffArtifactId: diffArtifact.id,
          overlayArtifactId: overlayArtifact.id,
        });
      }

      const visualStatus = results.every((result) => result["status"] === "passed")
        ? "passed"
        : "failed";
      const rendererLineageBinding =
        rendererLineageId === undefined
          ? undefined
          : VisualRendererLineageBindingSchema.parse({
              visualLineageId: lineageId,
              rendererLineageId,
            });
      const reportContent = Buffer.from(
        `${JSON.stringify(
          {
            version: 2,
            runId: run.id,
            reviewPacketId: packet.id,
            visualLineageId: lineageId,
            ...(rendererLineageBinding === undefined ? {} : rendererLineageBinding),
            headSha: packet.headSha,
            diffDigest: packet.diffDigest,
            attempt,
            maxAttempts: MAX_VISUAL_REPAIR_ATTEMPTS,
            status: visualStatus,
            generatedAt: timestamp,
            results,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      const reportBlob = await this.dependencies.artifactStore.writeBlob({
        content: reportContent,
        mediaType: "application/json",
        storedAt: timestamp,
        label: "visual-comparison-v2.json",
      });
      const reportArtifact = ArtifactRefSchema.parse({
        id: createArtifactId(),
        kind: "visual-report",
        uri: reportBlob.uri,
        mediaType: "application/json",
        digest: reportBlob.digest,
        producedBy: "orchestrator",
        evidenceIds: [],
        createdAt: timestamp,
        metadata: {
          adapter: "visual-comparison-v2",
          reportKind: "visual-report-v2-json",
          workflowSubmissionKind: "visual-comparison",
          reviewPacketId: packet.id,
          visualLineageId: lineageId,
          ...(rendererLineageBinding === undefined ? {} : rendererLineageBinding),
          headSha: packet.headSha,
          diffDigest: packet.diffDigest,
          visualComparisonAttempt: attempt,
          visualStatus,
          targetIds: targets.map((target) => target.targetId),
          visualArtifactIds: [
            ...attemptEvidenceArtifacts.map((artifact) => artifact.id),
            ...generatedArtifacts.map((artifact) => artifact.id),
          ],
          submissionIdentity,
        },
      });
      const lineageArtifact = await this.createVisualRepairOutcomeArtifact({
        runId: run.id,
        packet,
        lineageId,
        rendererLineageId,
        attempt,
        visualStatus,
        results,
        timestamp,
      });
      await this.commitVisualAttemptOutcome({
        runId: run.id,
        packet,
        reservation,
        generatedArtifacts: [...attemptEvidenceArtifacts, ...generatedArtifacts],
        visualReport: reportArtifact,
        lineageArtifact,
        status: visualStatus,
      });
    } catch (error: unknown) {
      if (reservationResult.kind === "committed-replay") throw error;
      this.metrics.increment("visual.reservation_aborted");
      const timestamp = this.now();
      const failureArtifact = await this.visualAttemptStatusArtifact({
        runId: run.id,
        packet,
        reservation: {
          ...reservation,
          status: "aborted",
          updatedAt: timestamp,
        },
      });
      await this.appendVisualAttemptArtifacts(
        run.id,
        submissionIdentity,
        [failureArtifact],
        timestamp,
      );
      throw error;
    }
  }

  private async createVisualRepairOutcomeArtifact(input: {
    runId: string;
    packet: ImplementationReviewPacket;
    lineageId: string;
    rendererLineageId: `sha256:${string}` | undefined;
    attempt: 1 | 2 | 3;
    visualStatus: "passed" | "failed";
    results: Array<Record<string, unknown>>;
    timestamp: string;
  }): Promise<ArtifactRef> {
    const compactFailedTargets = input.results.flatMap((result) => {
      if (result["status"] !== "failed" || typeof result["targetId"] !== "string") return [];
      const metrics =
        typeof result["metrics"] === "object" && result["metrics"] !== null
          ? (result["metrics"] as Record<string, unknown>)
          : {};
      return typeof metrics["reviewMatchRatio"] === "number"
        ? [
            {
              targetId: result["targetId"],
              reviewMatchRatio: metrics["reviewMatchRatio"],
            },
          ]
        : [];
    });
    const failedTargets = input.results
      .filter((result) => result["status"] === "failed")
      .map((result) => {
        const captureSummary = result["captureSummary"];
        const hasCaptureSummary = typeof captureSummary === "object" && captureSummary !== null;
        const metrics =
          typeof result["metrics"] === "object" && result["metrics"] !== null
            ? (result["metrics"] as Record<string, unknown>)
            : {};
        const causeHints: Array<
          "implementation" | "acquisition" | "fixture" | "design-mapping" | "baseline-isolation"
        > = [];
        if (
          typeof metrics["reviewMatchRatio"] === "number" &&
          typeof metrics["threshold"] === "number" &&
          metrics["reviewMatchRatio"] < metrics["threshold"]
        ) {
          causeHints.push("implementation");
        }
        const captureFacts = hasCaptureSummary
          ? (captureSummary as Record<string, unknown>)
          : undefined;
        if (
          captureFacts !== undefined &&
          (captureFacts["fontsReady"] !== true || captureFacts["assetsReady"] !== true)
        ) {
          causeHints.push("acquisition");
        }
        if (causeHints.length === 0) {
          throw new Error(
            `VISUAL_REPAIR_EVIDENCE_INCOMPLETE: failed target ${String(result["targetId"])} has no validated cause category`,
          );
        }
        return {
          targetId: result["targetId"],
          name: result["name"],
          route: result["route"],
          state: result["state"],
          fixture: result["fixture"],
          viewport: result["viewport"],
          deviceScaleFactor: result["deviceScaleFactor"],
          metrics: result["metrics"],
          diffArtifactId: result["diffArtifactId"],
          overlayArtifactId: result["overlayArtifactId"],
          ...(captureFacts === undefined ? {} : { captureSummary }),
          causeHints,
        };
      });
    const repairRequired =
      input.visualStatus === "failed" && input.attempt < MAX_VISUAL_REPAIR_ATTEMPTS;
    const status =
      input.visualStatus === "passed" ? "closed" : repairRequired ? "repair-required" : "exhausted";
    const artifactId = createArtifactId();
    const evidence =
      input.visualStatus === "failed"
        ? VisualRepairEvidenceV2Schema.parse({
            schemaVersion: "visual-repair-evidence-v2",
            runId: input.runId,
            lineageId: input.lineageId,
            reviewPacketId: input.packet.id,
            headSha: input.packet.headSha,
            ...(input.rendererLineageId === undefined
              ? {}
              : { rendererLineageId: input.rendererLineageId }),
            attempt: input.attempt,
            generatedAt: input.timestamp,
            failedTargets,
          })
        : undefined;
    const content = Buffer.from(
      `${JSON.stringify(
        evidence ?? {
          schemaVersion: "visual-repair-lineage-v2",
          runId: input.runId,
          lineageId: input.lineageId,
          reviewPacketId: input.packet.id,
          headSha: input.packet.headSha,
          ...(input.rendererLineageId === undefined
            ? {}
            : { rendererLineageId: input.rendererLineageId }),
          attempt: input.attempt,
          generatedAt: input.timestamp,
          status,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const blob = await this.dependencies.artifactStore.writeBlob({
      content,
      mediaType: "application/json",
      storedAt: input.timestamp,
      label:
        evidence === undefined
          ? `visual-lineage-attempt-${String(input.attempt)}.json`
          : `visual-repair-evidence-attempt-${String(input.attempt)}.json`,
    });
    const artifact = ArtifactRefSchema.parse({
      id: artifactId,
      kind: "other",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: input.timestamp,
      metadata: {
        adapter: evidence === undefined ? "visual-repair-lineage-v2" : "visual-repair-evidence-v2",
        schemaVersion:
          evidence === undefined ? "visual-repair-lineage-v2" : "visual-repair-evidence-v2",
        visualLineageId: input.lineageId,
        ...(input.rendererLineageId === undefined
          ? {}
          : { rendererLineageId: input.rendererLineageId }),
        visualLineageAttempt: input.attempt,
        visualLineageStatus: status,
        sourcePacketId: input.packet.id,
        headSha: input.packet.headSha,
        repairRequired,
        visualStatus: input.visualStatus,
        failedTargets: compactFailedTargets,
        ...(evidence === undefined ? {} : { repairEvidenceArtifactId: artifactId }),
      },
    });

    return artifact;
  }

  private async commitVisualAttemptOutcome(input: {
    runId: string;
    packet: ImplementationReviewPacket;
    reservation: VisualAttemptReservation;
    generatedArtifacts: ArtifactRef[];
    visualReport: ArtifactRef;
    lineageArtifact: ArtifactRef;
    repairEvidenceArtifact?: ArtifactRef;
    status: "passed" | "failed";
  }): Promise<void> {
    const timestamp = input.visualReport.createdAt;
    const committedAttempt = await this.visualAttemptStatusArtifact({
      runId: input.runId,
      packet: input.packet,
      reservation: {
        ...input.reservation,
        status: "committed",
        updatedAt: timestamp,
        reportArtifactId: input.visualReport.id,
        reportDigest: input.visualReport.digest,
      },
    });
    const artifacts = [
      ...input.generatedArtifacts,
      input.visualReport,
      committedAttempt,
      input.lineageArtifact,
      ...(input.repairEvidenceArtifact === undefined ? [] : [input.repairEvidenceArtifact]),
    ];
    const repairRequired =
      input.status === "failed" && input.reservation.attempt < MAX_VISUAL_REPAIR_ATTEMPTS;
    const terminalIdentity =
      input.status === "failed" && input.reservation.attempt === MAX_VISUAL_REPAIR_ATTEMPTS
        ? `sha256:${createHash("sha256")
            .update(
              JSON.stringify({
                runId: input.runId,
                lineageId: visualLineageId(input.packet),
                reviewPacketId: input.packet.id,
                attempt: 3,
                visualReportDigest: input.visualReport.digest,
              }),
            )
            .digest("hex")}`
        : undefined;

    for (let retry = 0; retry < 12; retry += 1) {
      const current = await this.dependencies.runStore.get(input.runId);
      const currentTerminalIdentity = stage(current, "implementation").checkpoint?.data[
        "visualTerminalIdentity"
      ];
      if (terminalIdentity !== undefined && currentTerminalIdentity === terminalIdentity) {
        return;
      }
      if (
        terminalIdentity === undefined &&
        current.artifacts.some(
          (artifact) =>
            artifact.kind === "visual-report" &&
            artifact.metadata["submissionIdentity"] === input.reservation.submissionIdentity,
        )
      ) {
        return;
      }
      const currentPacket = reviewPacketFromRun(current);
      if (
        stage(current, "implementation").status !== "passed" ||
        currentPacket?.id !== input.packet.id ||
        currentPacket.headSha !== input.packet.headSha ||
        currentPacket.diffDigest !== input.packet.diffDigest
      ) {
        throw new Error(
          "VISUAL_ATTEMPT_STALE: the implementation review packet, head, or diff is no longer current",
        );
      }

      const next =
        terminalIdentity === undefined
          ? repairRequired
            ? reopenImplementationForVisualRepair(
                {
                  ...current,
                  artifacts: [...current.artifacts, ...artifacts],
                },
                `Visual comparison attempt ${String(input.reservation.attempt)} failed; repair the implementation before recapturing.`,
                () => timestamp,
              )
            : {
                ...current,
                revision: current.revision + 1,
                updatedAt: timestamp,
                artifacts: [...current.artifacts, ...artifacts],
              }
          : terminalizeVisualThresholdFailure(current, {
              artifacts,
              reviewPacket: input.packet,
              visualLineageId: visualLineageId(input.packet),
              visualReportArtifactId: input.visualReport.id,
              visualReportDigest: input.visualReport.digest,
              terminalIdentity,
              timestamp,
            });
      try {
        await this.dependencies.runStore.save(next, current.revision);
        this.metrics.increment("visual.reservation_committed", 1, { outcome: "committed" });
        this.metrics.gauge("visual.active_workers", 0, { stage: "implementation" });
        if (input.status === "failed") {
          this.invalidateReviewerTimings(input.packet.id);
        }
        return;
      } catch (error: unknown) {
        if (!(error instanceof RevisionConflictError)) throw error;
      }
    }
    throw new Error("VISUAL_ATTEMPT_REFRESH_REQUIRED: refresh workflow_status and retry");
  }

  private isCommittedVisualReplay(
    run: RunManifest,
    submission: Extract<WorkflowSubmission, { kind: "visual-comparison" }>,
  ): boolean {
    const packet = reviewPacketFromRun(run);
    if (packet === undefined || packet.id !== submission.reviewPacketId) return false;
    const submissionIdentity = visualSubmissionIdentity(
      submission.reviewPacketId,
      submission.captures,
    );
    return reduceVisualReservations(
      visualAttemptReservations(run, visualLineageId(packet), "v3"),
      this.now(),
    ).committed.some((reservation) => reservation.submissionIdentity === submissionIdentity);
  }

  private async reserveVisualAttempt(
    runId: string,
    packet: ImplementationReviewPacket,
    submissionIdentity: string,
    rendererLineageId: `sha256:${string}` | undefined,
    validateBeforeReservation?: (current: RunManifest) => Promise<void>,
  ): Promise<VisualAttemptReservationResult> {
    for (let retry = 0; retry < 12; retry += 1) {
      const current = await this.dependencies.runStore.get(runId);
      const currentPacket = reviewPacketFromRun(current);
      if (currentPacket?.id !== packet.id) {
        throw new Error(
          "Visual comparison must reference the current implementation review packet",
        );
      }
      if (rendererLineageId !== undefined) {
        assertRendererLineageMatchesCommittedAttempts(current, packet, rendererLineageId);
      }
      const events = visualAttemptReservations(current, visualLineageId(packet));
      const summary = reduceVisualReservations(events, this.now());
      const committedReplay = summary.committed.find(
        (candidate) => candidate.submissionIdentity === submissionIdentity,
      );
      if (committedReplay !== undefined) {
        this.metrics.increment("visual.reservation_committed", 1, { outcome: "replay" });
        return { kind: "committed-replay", reservation: committedReplay };
      }
      if (currentVisualReport(current, packet.id)?.metadata["visualStatus"] === "passed") {
        throw new Error("The current review packet already has a passing visual comparison");
      }
      if (summary.active !== undefined) {
        this.metrics.gauge("visual.active_workers", 1, { stage: "implementation" });
        this.metrics.gauge("visual.peak_workers", 1, { stage: "implementation" });
        return { kind: "busy", reservation: summary.active };
      }
      await validateBeforeReservation?.(current);
      if (summary.recoverable !== undefined) {
        const latestRecoverableEvent = [...events]
          .reverse()
          .find((candidate) => candidate.ownerToken === summary.recoverable?.ownerToken);
        if (latestRecoverableEvent?.status === "in-progress") {
          const timestamp = this.now();
          const staleReservation: VisualAttemptReservation = {
            ...summary.recoverable,
            status: "stale",
            updatedAt: timestamp,
          };
          const staleArtifact = await this.visualAttemptStatusArtifact({
            runId,
            packet,
            reservation: staleReservation,
          });
          try {
            await this.dependencies.runStore.save(
              {
                ...current,
                revision: current.revision + 1,
                updatedAt: timestamp,
                artifacts: [...current.artifacts, staleArtifact],
              },
              current.revision,
            );
            this.metrics.increment("visual.reservation_stale");
            continue;
          } catch (error: unknown) {
            if (!(error instanceof RevisionConflictError)) throw error;
            continue;
          }
        }
      }
      const attempt = nextCommittedVisualAttempt(summary);
      if (attempt === undefined) {
        throw new Error(
          `VISUAL_ATTEMPT_LIMIT_REACHED: the active visual lineage already used ${MAX_VISUAL_REPAIR_ATTEMPTS} attempts`,
        );
      }
      const timestamp = this.now();
      const reservation: VisualAttemptReservation = {
        submissionIdentity,
        attempt,
        status: "in-progress",
        ownerToken: randomUUID(),
        reservedAt: timestamp,
        updatedAt: timestamp,
      };
      const artifact = await this.visualAttemptStatusArtifact({
        runId,
        packet,
        reservation,
      });
      try {
        await this.dependencies.runStore.save(
          {
            ...current,
            revision: current.revision + 1,
            updatedAt: timestamp,
            artifacts: [...current.artifacts, artifact],
          },
          current.revision,
        );
        this.metrics.gauge("visual.active_workers", 1, { stage: "implementation" });
        this.metrics.gauge("visual.peak_workers", 1, { stage: "implementation" });
        return { kind: "reserved", reservation };
      } catch (error: unknown) {
        if (!(error instanceof RevisionConflictError)) throw error;
      }
    }
    throw new Error("VISUAL_ATTEMPT_REFRESH_REQUIRED: refresh workflow_status and retry");
  }

  private async visualAttemptStatusArtifact(input: {
    runId: string;
    packet: ImplementationReviewPacket;
    reservation: VisualAttemptReservation;
  }): Promise<ArtifactRef> {
    const { reservation } = input;
    const content = Buffer.from(
      `${JSON.stringify({
        reviewPacketId: input.packet.id,
        visualLineageId: visualLineageId(input.packet),
        ...reservation,
      })}\n`,
      "utf8",
    );
    const blob = await this.dependencies.artifactStore.writeBlob({
      content,
      mediaType: "application/json",
      storedAt: reservation.updatedAt,
      label: `visual-attempt-${String(reservation.attempt)}-${reservation.status}.json`,
    });
    return ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "other",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: reservation.updatedAt,
      metadata: {
        adapter: "visual-attempt-reservation-v3",
        reviewPacketId: input.packet.id,
        visualLineageId: visualLineageId(input.packet),
        headSha: input.packet.headSha,
        diffDigest: input.packet.diffDigest,
        submissionIdentity: reservation.submissionIdentity,
        visualComparisonAttempt: reservation.attempt,
        reservationStatus: reservation.status,
        ownerToken: reservation.ownerToken,
        reservedAt: reservation.reservedAt,
        updatedAt: reservation.updatedAt,
        ...(reservation.reportArtifactId === undefined
          ? {}
          : { reportArtifactId: reservation.reportArtifactId }),
        ...(reservation.reportDigest === undefined
          ? {}
          : { reportDigest: reservation.reportDigest }),
      },
    });
  }

  private async appendVisualAttemptArtifacts(
    runId: string,
    submissionIdentity: string,
    artifacts: ArtifactRef[],
    timestamp: string,
  ): Promise<void> {
    for (let retry = 0; retry < 12; retry += 1) {
      const current = await this.dependencies.runStore.get(runId);
      if (
        current.artifacts.some(
          (artifact) =>
            artifact.kind === "visual-report" &&
            artifact.metadata["submissionIdentity"] === submissionIdentity,
        )
      ) {
        return;
      }
      try {
        await this.dependencies.runStore.save(
          {
            ...current,
            revision: current.revision + 1,
            updatedAt: timestamp,
            artifacts: [...current.artifacts, ...artifacts],
          },
          current.revision,
        );
        return;
      } catch (error: unknown) {
        if (!(error instanceof RevisionConflictError)) throw error;
      }
    }
    throw new Error("VISUAL_ATTEMPT_REFRESH_REQUIRED: refresh workflow_status and retry");
  }

  private async writeVisualArtifact(input: {
    content: Buffer;
    kind: "screenshot" | "visual-diff";
    projectRelativePath: string;
    targetId: string;
    role: "baseline-normalized" | "actual-normalized" | "diff" | "overlay";
    packet: ImplementationReviewPacket;
    attempt: number;
    timestamp: string;
    sourceArtifactId?: string;
    normalizerVersion?: "visual-normalizer-v1";
  }): Promise<ArtifactRef> {
    const blob = await this.dependencies.artifactStore.writeBlob({
      content: input.content,
      mediaType: "image/png",
      storedAt: input.timestamp,
      label: path.posix.basename(input.projectRelativePath),
    });
    return ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: input.kind,
      uri: blob.uri,
      mediaType: "image/png",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: input.timestamp,
      metadata: {
        adapter: "visual-comparison-v2",
        projectRelativePath: input.projectRelativePath,
        reviewPacketId: input.packet.id,
        headSha: input.packet.headSha,
        diffDigest: input.packet.diffDigest,
        targetId: input.targetId,
        visualRole: input.role,
        visualComparisonAttempt: input.attempt,
        ...(input.sourceArtifactId === undefined
          ? {}
          : { sourceArtifactId: input.sourceArtifactId }),
        ...(input.normalizerVersion === undefined
          ? {}
          : { normalizerVersion: input.normalizerVersion }),
      },
    });
  }

  private async generateReport(runId: string): Promise<void> {
    const run = await this.dependencies.runStore.get(RunIdSchema.parse(runId));
    await this.assertLegacyReferenceFresh(run);
    const timestamp = this.now();
    const packet = reviewPacketFromRun(run);
    if (packet === undefined) throw new Error("A current implementation review packet is required");
    await assertReviewPacketFresh(run, this.dependencies.artifactStore, this.metrics);
    const submissions = await this.latestWorkflowSubmissions(run);
    const contracts = submissions.get("contracts");
    const implementation = submissions.get("implementation");
    const functional = submissions.get("functional-review");
    const design = submissions.get("design-review");
    const profile = deliveryProfileFromRun(run);
    if (implementation?.kind !== "implementation" || contracts?.kind !== "contracts") {
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
    const reportRequirements = contracts.requirementManifest;
    const unreviewed = reportRequirements
      .map((requirement) => requirement.id)
      .filter((requirementId) => !reviewedRequirements.has(requirementId));
    if (unreviewed.length > 0) {
      throw new Error(`PR report requires review coverage for: ${unreviewed.join(", ")}`);
    }
    const sectionApplicability = reportSectionApplicabilityForRun(run, profile);
    let sectionStatuses = readyReportSectionStatuses(sectionApplicability);
    const legacyRootDigest = legacyRootDigestFromRun(run);
    const legacyApiDiscoveryAdapters = legacyApiDiscoveryAdaptersFromRun(run);
    const visualArtifact = currentVisualReport(run, packet.id);
    let visualReport: Record<string, unknown> | undefined;
    if (sectionApplicability.visual) {
      if (visualArtifact?.metadata["visualStatus"] !== "passed") {
        throw new Error("PR report requires a passing current-packet visual comparison");
      }
      visualReport = JSON.parse(
        (await this.dependencies.artifactStore.readContent(visualArtifact.digest)).toString("utf8"),
      ) as Record<string, unknown>;
    }
    const packetArtifacts = run.artifacts.filter(
      (artifact) => artifact.metadata["reviewPacketId"] === packet.id,
    );
    const evidencePaths = [
      ...new Set([
        ...[
          ...(contracts?.kind === "contracts" ? [contracts] : []),
          implementation,
          ...reviews,
        ].flatMap((item) => item.artifactPaths),
        ...packetArtifacts.flatMap((artifact) => {
          const evidencePath = artifact.metadata["projectRelativePath"];
          return typeof evidencePath === "string" ? [evidencePath] : [];
        }),
      ]),
    ];
    const featureEvidence =
      implementation.featureEvidence === undefined
        ? undefined
        : {
            ...implementation.featureEvidence,
            testCount: await this.featureTestCountForRun(
              run,
              implementation.featureEvidence.resultPath,
            ),
          };
    const apiGaps = implementation.apiCoverage
      .filter((operation) => operation.status === "gap")
      .map(
        (operation) =>
          `${operation.operationKey}: ${operation.notes ?? "gap reported without details"}`,
      );
    const gapDetails = reportGapDetailsForRun(run, implementation.apiCoverage);
    if (gapDetails.some((gap) => gap.category === "api" && gap.status !== "resolved")) {
      sectionStatuses = PrReportSectionStatusesSchema.parse({
        ...sectionStatuses,
        api: "not-run",
      });
    }
    const report = PrReportV2Schema.parse({
      schemaVersion: "pr-report-v2.1",
      runId: run.id,
      generatedAt: timestamp,
      decision: "ready",
      mode: profile.mode,
      ...reportTemplateForMode(profile.mode),
      sectionStatuses,
      binding: {
        reviewPacketId: packet.id,
        revision: packet.revision,
        baseSha: packet.baseSha,
        headSha: packet.headSha,
        evidenceDigest: packet.evidenceDigest,
        diffDigest: packet.diffDigest,
      },
      summary: {
        title: `SpecToPR ${profile.mode} delivery`,
        bullets: [implementation.summary],
        exclusions: exclusionsForProfile(profile),
      },
      sources: publicSourceRows(profile, legacyRootDigest),
      skills: {
        hints: contracts?.kind === "contracts" ? contracts.guidanceTrace.skillHints : [],
        applied: contracts?.kind === "contracts" ? contracts.guidanceTrace.appliedSkills : [],
      },
      requirements: reportRequirements.map((requirement) => ({
        ...requirement,
        implementationFiles: packet.changedFiles,
        reviewVerdicts: reviews.flatMap((review) =>
          review.requirements
            .filter((candidate) => candidate.id === requirement.id)
            .map((candidate) => `${review.kind}:${candidate.verdict}`),
        ),
      })),
      changedFiles: packet.changedFiles,
      implementationNotes: [implementation.summary],
      api: {
        applicable: sectionApplicability.api,
        ...(profile.mode === "legacy" && legacyRootDigest !== undefined
          ? { inventoryDigest: legacyRootDigest }
          : {}),
        ...(profile.mode === "legacy" ? { discoveryAdapters: legacyApiDiscoveryAdapters } : {}),
        operations: implementation.apiCoverage,
        gaps: apiGaps,
      },
      legacy: {
        applicable: sectionApplicability.legacy,
        coverage: implementation.legacyCoverage,
      },
      visual: {
        applicable: sectionApplicability.visual,
        ...(visualArtifact === undefined ? {} : { reportArtifactId: visualArtifact.id }),
        attempt: typeof visualReport?.["attempt"] === "number" ? visualReport["attempt"] : 0,
        status:
          visualArtifact === undefined
            ? sectionApplicability.visual
              ? "not-run"
              : "not-applicable"
            : visualArtifact.metadata["visualStatus"],
        results: Array.isArray(visualReport?.["results"]) ? visualReport["results"] : [],
      },
      reviews: reviews.map((review) => ({
        kind: review.kind,
        verdict: review.verdict,
        summary: review.summary,
        gates: review.gateResults,
        findings: review.findings,
      })),
      performance: {
        applicable: sectionApplicability.performance,
        ...(implementation.performanceEvidence === undefined
          ? {}
          : { evidence: implementation.performanceEvidence }),
      },
      ...(featureEvidence === undefined ? {} : { featureEvidence }),
      gaps: apiGaps,
      gapDetails,
      blockers: [],
      unrunValidations: [],
      risks: reviews.flatMap((review) =>
        review.findings.map((finding) => ({
          likelihood: "review-observed",
          impact: finding.severity,
          mitigation: finding.title,
          evidence: finding.evidence,
        })),
      ),
      rollback: {
        trigger: "A reviewed acceptance check or affected route regresses after merge.",
        strategy: "Revert the delivery commit and redeploy the last known-good artifact.",
        steps: [
          "Revert the merged change without rewriting shared history.",
          "Redeploy the previous known-good artifact.",
        ],
        dataImpact:
          "No automatic data rollback is assumed; verify migrations and writes separately.",
        postChecks: [
          "Rerun the affected functional checks.",
          "Verify the affected route and API health after rollback.",
        ],
      },
      evidencePaths,
      artifactIds: [
        ...new Set([
          ...packetArtifacts.map((artifact) => artifact.id),
          ...run.stages.flatMap((item) => item.artifactIds),
        ]),
      ],
    });
    assertCurrentPrReportV2(report);
    const { jsonArtifact, markdownArtifact, runtimeArtifact } = await this.writePrReportArtifacts({
      run,
      report,
      reportIntent: "ready",
      timestamp,
      metadata: {},
    });

    await this.dependencies.runStore.save(
      {
        ...run,
        revision: run.revision + 1,
        updatedAt: timestamp,
        artifacts: [
          ...run.artifacts,
          jsonArtifact,
          markdownArtifact,
          ...(runtimeArtifact === undefined ? [] : [runtimeArtifact]),
        ],
      },
      run.revision,
    );
    await this.completeStage(run.id, "report", [jsonArtifact.id, markdownArtifact.id]);
  }

  private async writePrReportArtifacts(input: {
    run: RunManifest;
    report: PrReportV2;
    reportIntent: WorkflowReportIntent;
    timestamp: string;
    metadata: Record<string, unknown>;
  }): Promise<{
    jsonArtifact: ArtifactRef;
    markdownArtifact: ArtifactRef;
    runtimeArtifact?: ArtifactRef;
  }> {
    const report = PrReportV2Schema.parse(input.report);
    assertCurrentPrReportV2(report);
    if (report.schemaVersion !== "pr-report-v2.1" || report.runId !== input.run.id) {
      throw new Error("Current PR report persistence requires a Run-bound pr-report-v2.1");
    }
    if (
      (input.reportIntent === "ready" && report.decision !== "ready") ||
      (input.reportIntent === "blocked-diagnostic" && report.decision !== "blocked")
    ) {
      throw new Error("PR report intent and decision must agree before persistence");
    }

    const bindingMetadata =
      report.binding === undefined
        ? {}
        : {
            reviewPacketId: report.binding.reviewPacketId,
            headSha: report.binding.headSha,
            diffDigest: report.binding.diffDigest,
            ...(report.visual.reportArtifactId === undefined
              ? {}
              : { visualReportArtifactId: report.visual.reportArtifactId }),
          };
    const jsonBlob = await this.dependencies.artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: input.timestamp,
      label: "pr-report-v2.1.json",
    });
    const jsonArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "pr-report",
      uri: jsonBlob.uri,
      mediaType: "application/json",
      digest: jsonBlob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: input.timestamp,
      metadata: {
        ...input.metadata,
        adapter: "pr-report-v2",
        reportKind: "pr-report-v2-json",
        reportSchemaVersion: "pr-report-v2.1",
        decision: report.decision,
        ...bindingMetadata,
      },
    });
    const markdownBlob = await this.dependencies.artifactStore.writeBlob({
      content: Buffer.from(renderPrReportV2Markdown(report), "utf8"),
      mediaType: "text/markdown",
      storedAt: input.timestamp,
      label: "pr-report.md",
    });
    const markdownArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "pr-report",
      uri: markdownBlob.uri,
      mediaType: "text/markdown",
      digest: markdownBlob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: input.timestamp,
      metadata: {
        ...input.metadata,
        adapter: "pr-report-v2",
        ...WorkflowReportMetadataSchema.parse({
          reportKind: "pr-body-markdown",
          reportIntent: input.reportIntent,
          decision: report.decision,
        }),
        locale: "ko",
        reportSchemaVersion: "pr-report-v2.1",
        reportJsonArtifactId: jsonArtifact.id,
        ...bindingMetadata,
      },
    });
    const runtimeArtifact = await this.writeRuntimePerformanceArtifact(
      input.run.id,
      jsonBlob.digest,
      input.timestamp,
    );
    return {
      jsonArtifact,
      markdownArtifact,
      ...(runtimeArtifact === undefined ? {} : { runtimeArtifact }),
    };
  }

  private async writeRuntimePerformanceArtifact(
    runId: string,
    fixtureDigest: Sha256Digest,
    timestamp: string,
  ): Promise<ArtifactRef | undefined> {
    if (!(this.metrics instanceof RuntimeMetricsRecorder)) return undefined;
    const blob = await this.dependencies.artifactStore.writeBlob({
      content: Buffer.from(
        `${JSON.stringify(this.metrics.snapshot({ runId, fixtureDigest, collectedAt: timestamp }), null, 2)}\n`,
        "utf8",
      ),
      mediaType: "application/json",
      storedAt: timestamp,
      label: "runtime-performance-v1.json",
    });
    return ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "agent-result-report",
      uri: blob.uri,
      mediaType: "application/json",
      digest: blob.digest,
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: timestamp,
      metadata: { adapter: "runtime-performance-v1", reportKind: "runtime-performance-v1" },
    });
  }

  private async featureTestCountForRun(
    run: RunManifest,
    resultPath: string,
  ): Promise<number | undefined> {
    const artifact = [...run.artifacts]
      .reverse()
      .find((candidate) => candidate.metadata["projectRelativePath"] === resultPath);
    if (artifact === undefined) return undefined;
    const parsed = FeatureResultSchema.safeParse(
      JSON.parse(
        (await this.dependencies.artifactStore.readContent(artifact.digest)).toString("utf8"),
      ),
    );
    return parsed.success ? parsed.data.testCount : undefined;
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

  private async materializeBlockedReport(
    run: RunManifest,
    blocker: WorkflowBlocker,
    timestamp: string,
  ) {
    const profile = deliveryProfileFromRun(run);
    const sectionApplicability = reportSectionApplicabilityForRun(run, profile);
    const legacyRootDigest = legacyRootDigestFromRun(run);
    const legacyApiDiscoveryAdapters = legacyApiDiscoveryAdaptersFromRun(run);
    const submissions = await this.latestWorkflowSubmissions(run);
    const contracts = submissions.get("contracts");
    const implementation = submissions.get("implementation");
    const rawPacket = reviewPacketFromRun(run);
    let packet = rawPacket;
    let terminalVisualArtifact: ArtifactRef | undefined;
    if (blocker.code === "VISUAL_REVIEW_THRESHOLD_NOT_MET") {
      const checkpoint = stage(run, "implementation").checkpoint;
      const terminalPacket = ImplementationReviewPacketSchema.safeParse(
        checkpoint?.data["reviewPacket"],
      );
      const reportArtifactId = checkpoint?.data["visualReportArtifactId"];
      const reportDigest = checkpoint?.data["visualReportDigest"];
      if (
        checkpoint?.name !== "visual-threshold-not-met" ||
        !terminalPacket.success ||
        typeof reportArtifactId !== "string" ||
        typeof reportDigest !== "string"
      ) {
        throw new Error(
          "VISUAL_TERMINAL_REPORT_BINDING_INVALID: terminal packet and visual report identity are required",
        );
      }
      terminalVisualArtifact = run.artifacts.find(
        (artifact) => artifact.id === reportArtifactId && artifact.kind === "visual-report",
      );
      if (
        terminalVisualArtifact === undefined ||
        terminalVisualArtifact.digest !== reportDigest ||
        terminalVisualArtifact.metadata["reviewPacketId"] !== terminalPacket.data.id ||
        terminalVisualArtifact.metadata["headSha"] !== terminalPacket.data.headSha ||
        terminalVisualArtifact.metadata["diffDigest"] !== terminalPacket.data.diffDigest
      ) {
        throw new Error(
          "VISUAL_TERMINAL_REPORT_BINDING_INVALID: the exact terminal visual report is unavailable or stale",
        );
      }
      packet = terminalPacket.data;
    } else if (packet !== undefined) {
      try {
        await assertReviewPacketFresh(run, this.dependencies.artifactStore, this.metrics);
      } catch {
        packet = undefined;
      }
    }
    const reviews = [submissions.get("functional-review"), submissions.get("design-review")].filter(
      (submission): submission is z.infer<typeof ReviewSubmissionSchema> =>
        (submission?.kind === "functional-review" || submission?.kind === "design-review") &&
        packet !== undefined &&
        submission.reviewPacketId === packet.id,
    );
    const visualArtifact =
      terminalVisualArtifact ??
      (packet === undefined ? undefined : currentVisualReport(run, packet.id));
    let visualReport: Record<string, unknown> | undefined;
    if (visualArtifact !== undefined) {
      try {
        visualReport = JSON.parse(
          (await this.dependencies.artifactStore.readContent(visualArtifact.digest)).toString(
            "utf8",
          ),
        ) as Record<string, unknown>;
      } catch {
        visualReport = undefined;
      }
    }
    const contractSubmission = contracts?.kind === "contracts" ? contracts : undefined;
    const implementationSubmission =
      implementation?.kind === "implementation" ? implementation : undefined;
    const featureEvidence = implementationSubmission?.featureEvidence;
    const apiGaps = [
      ...(implementationSubmission?.apiCoverage ?? [])
        .filter((operation) => operation.status === "gap")
        .map(
          (operation) =>
            `${operation.operationKey}: ${operation.notes ?? "gap reported without details"}`,
        ),
      ...run.gaps
        .filter((gap) => gap.category === "api" && gap.status === "open")
        .map((gap) => `${gap.title}: ${gap.observed}`),
    ];
    const gapDetails = reportGapDetailsForRun(run, implementationSubmission?.apiCoverage ?? [], {
      ...(sectionApplicability.visual && visualArtifact === undefined
        ? {
            visual: {
              title: "UI visual comparison was not run",
              impact: "The migrated UI has no measured comparison against its required baseline.",
              reviewerDecision:
                "Run the comparison or explicitly decide whether this Draft remains blocked.",
            },
          }
        : {}),
      ...(profile.requirements.featureVideo && featureEvidence === undefined
        ? {
            featureVideo: {
              title: "Feature user-flow video was not captured",
              impact:
                "The reviewer cannot verify the required end-to-end user flow from this Draft.",
              reviewerDecision: "Capture the packet-bound video before approving the feature flow.",
            },
          }
        : {}),
    });
    const evidencePaths = [
      ...new Set([
        ...blocker.evidencePaths,
        ...(contractSubmission?.artifactPaths ?? []),
        ...(implementationSubmission?.artifactPaths ?? []),
        ...reviews.flatMap((review) => review.artifactPaths),
      ]),
    ];
    const sectionStatuses = blockedReportSectionStatuses({
      run,
      profile,
      sectionApplicability,
      blocker,
      implementation: implementationSubmission,
      visualArtifact,
      packetCurrent: packet !== undefined,
    });

    const report = PrReportV2Schema.parse({
      schemaVersion: "pr-report-v2.1",
      runId: run.id,
      generatedAt: timestamp,
      decision: "blocked",
      mode: profile.mode,
      ...reportTemplateForMode(profile.mode),
      sectionStatuses,
      ...(packet === undefined
        ? {}
        : {
            binding: {
              reviewPacketId: packet.id,
              revision: packet.revision,
              baseSha: packet.baseSha,
              headSha: packet.headSha,
              evidenceDigest: packet.evidenceDigest,
              diffDigest: packet.diffDigest,
            },
          }),
      summary: {
        title: `SpecToPR ${profile.mode} blocked delivery`,
        bullets: [
          ...blocker.completedWork,
          ...(implementationSubmission === undefined ? [] : [implementationSubmission.summary]),
        ],
        exclusions: ["Work after the blocked stage was not executed."],
      },
      sources: publicSourceRows(profile, legacyRootDigest),
      skills: {
        hints: contractSubmission?.guidanceTrace.skillHints ?? profile.skillHints,
        applied: contractSubmission?.guidanceTrace.appliedSkills ?? [],
      },
      requirements: (contractSubmission?.requirementManifest ?? []).map((requirement) => ({
        ...requirement,
        implementationFiles:
          packet?.changedFiles ??
          (rawPacket === undefined ? (implementationSubmission?.changedFiles ?? []) : []),
        reviewVerdicts: reviews.flatMap((review) =>
          review.requirements
            .filter((candidate) => candidate.id === requirement.id)
            .map((candidate) => `${review.kind}:${candidate.verdict}`),
        ),
      })),
      changedFiles:
        packet?.changedFiles ??
        (rawPacket === undefined ? (implementationSubmission?.changedFiles ?? []) : []),
      implementationNotes:
        implementationSubmission === undefined ? [] : [implementationSubmission.summary],
      api: {
        applicable: sectionApplicability.api,
        ...(profile.mode === "legacy" && legacyRootDigest !== undefined
          ? { inventoryDigest: legacyRootDigest }
          : {}),
        ...(profile.mode === "legacy" ? { discoveryAdapters: legacyApiDiscoveryAdapters } : {}),
        operations: implementationSubmission?.apiCoverage ?? [],
        gaps: apiGaps,
      },
      legacy: {
        applicable: sectionApplicability.legacy,
        coverage: implementationSubmission?.legacyCoverage ?? [],
      },
      visual: {
        applicable: sectionApplicability.visual,
        ...(visualArtifact === undefined ? {} : { reportArtifactId: visualArtifact.id }),
        attempt: typeof visualReport?.["attempt"] === "number" ? visualReport["attempt"] : 0,
        status:
          visualArtifact === undefined
            ? sectionApplicability.visual
              ? "not-run"
              : "not-applicable"
            : visualArtifact.metadata["visualStatus"],
        results: Array.isArray(visualReport?.["results"]) ? visualReport.results : [],
      },
      reviews: reviews.map((review) => ({
        kind: review.kind,
        verdict: review.verdict,
        summary: review.summary,
        gates: review.gateResults,
        findings: review.findings,
      })),
      performance: {
        applicable: sectionApplicability.performance,
        ...(implementationSubmission?.performanceEvidence === undefined
          ? {}
          : { evidence: implementationSubmission.performanceEvidence }),
      },
      ...(featureEvidence === undefined
        ? {}
        : {
            featureEvidence: {
              ...featureEvidence,
              testCount: await this.featureTestCountForRun(run, featureEvidence.resultPath),
            },
          }),
      gaps: apiGaps,
      gapDetails,
      blockers: [`${blocker.stage}/${blocker.code}: ${blocker.summary}`],
      unrunValidations: blocker.unrunValidations,
      risks: reviews.flatMap((review) =>
        review.findings.map((finding) => ({
          likelihood: "review-observed",
          impact: finding.severity,
          mitigation: finding.title,
          evidence: finding.evidence,
        })),
      ),
      rollback: {
        trigger: blocker.summary,
        strategy: "Resolve the blocker and resume the same durable Run.",
        steps: [blocker.exactUnblockAction],
        dataImpact: "No automatic data rollback is performed by a blocked diagnostic.",
        postChecks: ["Rerun every remaining required validation before ready publication."],
      },
      evidencePaths,
      artifactIds: [
        ...new Set([
          ...run.stages.flatMap((item) => item.artifactIds),
          ...(visualArtifact === undefined ? [] : [visualArtifact.id]),
        ]),
      ],
    });
    assertCurrentPrReportV2(report);
    return report;
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
    blocker: WorkflowBlocker,
    recoverUncertain: boolean,
  ) {
    const executionKey = diagnosticClaimFenceKey(executionIdentity);
    const compatibleExecutionKeys = diagnosticClaimFenceKeys(runId, executionIdentity, blocker);

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
      const activeClaim = latestDiagnosticPublishClaimEvent(run, compatibleExecutionKeys);
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
  ): Promise<StandardWorkflowSubmission | undefined> {
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
        parsed.data.kind !== "legacy-network-evidence" &&
        parsed.data.kind !== "figma-bundle" &&
        parsed.data.kind !== "visual-comparison" &&
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

function openSpecChangeForContractArtifact(
  submission: StandardWorkflowSubmission,
  projectRelativePath: string,
): string | undefined {
  if (submission.kind !== "contracts" || submission.draftBundle === undefined) {
    return undefined;
  }
  const bundle = submission.draftBundle;
  return [bundle.proposalPath, ...bundle.specPaths, bundle.tasksPath].includes(projectRelativePath)
    ? bundle.changeName
    : undefined;
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
  if (blocker.code === "VISUAL_REVIEW_THRESHOLD_NOT_MET") {
    const terminalIdentity = stage(run, blocker.stage).checkpoint?.data["visualTerminalIdentity"];
    if (typeof terminalIdentity !== "string") {
      throw new Error(
        "VISUAL_TERMINAL_IDENTITY_MISSING: terminal visual blockers require a persisted identity",
      );
    }
    return `${blocker.stage}:${blocker.code}:${terminalIdentity}`;
  }
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

/**
 * Before blocker diagnostics preserved safe source codes, claims used the
 * generic code derived from `kind`. Treat that older key as the same fence so
 * a changed presenter cannot silently bypass an uncertain host mutation.
 */
function diagnosticClaimFenceKeys(
  runId: string,
  identity: DiagnosticExecutionIdentity,
  blocker: WorkflowBlocker,
): string[] {
  const current = diagnosticClaimFenceKey(identity);
  const genericCode = blockerCodeForKind(blocker.kind);
  if (genericCode === blocker.code) return [current];
  const legacyIdentity: DiagnosticExecutionIdentity = {
    ...identity,
    runId,
    reportKey: `${blocker.stage}:${stageAttemptFromReportKey(identity.reportKey)}:${genericCode}`,
  };
  return [current, diagnosticClaimFenceKey(legacyIdentity)];
}

function stageAttemptFromReportKey(reportKey: string): string {
  const [, attempt] = reportKey.split(":", 3);
  return /^\d+$/.test(attempt ?? "") ? attempt! : "0";
}

function latestDiagnosticPublishClaimEvent(
  run: RunManifest,
  executionKeys: string | readonly string[],
): ArtifactRef | undefined {
  const keys = new Set(typeof executionKeys === "string" ? [executionKeys] : executionKeys);
  return [...run.artifacts]
    .reverse()
    .find(
      (artifact) =>
        artifact.metadata["reportKind"] === "diagnostic-publish-claim" &&
        typeof artifact.metadata["diagnosticExecutionKey"] === "string" &&
        keys.has(artifact.metadata["diagnosticExecutionKey"]),
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

function blockerFromSubmission(
  submission: StandardWorkflowSubmission,
): WorkflowBlocker | undefined {
  return "blocker" in submission ? submission.blocker : undefined;
}

function reconstructFailedSubmissionForPersistence(
  run: RunManifest,
  submission: StandardWorkflowSubmission,
): StandardWorkflowSubmission {
  if (
    submission.kind === "figma-bundle" ||
    submission.kind === "api-ready" ||
    submission.kind === "visual-comparison"
  ) {
    return submission;
  }
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
  submission: StandardWorkflowSubmission,
):
  | {
      workflowStageName: RunStageName;
      workflowStageAttempt: number;
      workflowFailureStage: RunStageName;
      workflowFailureAttempt: number;
    }
  | undefined {
  if (
    submission.kind === "figma-bundle" ||
    submission.kind === "api-ready" ||
    submission.kind === "visual-comparison"
  ) {
    return undefined;
  }
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
    code: safeWorkflowDiagnostic(blocker.code) ? blocker.code : blockerCodeForKind(blocker.kind),
    kind: blocker.kind,
    summary: safeWorkflowDiagnostic(blocker.summary)
      ? blocker.summary
      : genericBlockerSummary(blocker.stage, blocker.kind),
    retryable: blocker.retryable,
    resumable: blocker.resumable,
    completedWork: uniqueSafeWorkflowDiagnostics(blocker.completedWork, completedWorkForRun(run)),
    evidencePaths: blocker.evidencePaths.filter(
      (evidencePath) =>
        isSafeDurableEvidencePath(evidencePath) && trustedEvidencePaths.has(evidencePath),
    ),
    attemptedRecovery: uniqueSafeWorkflowDiagnostics(
      blocker.attemptedRecovery,
      attemptedRecoveryForStage(failedStage),
    ),
    unrunValidations: uniqueSafeWorkflowDiagnostics(
      blocker.unrunValidations.filter((validation) =>
        remainingValidationsForRun(run, requiredValidations).includes(validation),
      ),
      remainingValidationsForRun(run, requiredValidations),
    ),
    exactUnblockAction: safeWorkflowDiagnostic(blocker.exactUnblockAction)
      ? blocker.exactUnblockAction
      : genericUnblockAction(blocker.stage, blocker.kind, blocker.code),
  });
}

const UNSAFE_WORKFLOW_DIAGNOSTIC_PATTERNS = [
  /\b(?:gh[pousr]_|github_pat_|glpat-|sk-)[A-Za-z0-9_-]{8,}\b/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:authorization|private-token)\b|\bBearer\s+/i,
  /(?:^|[/\\])(?:Users|root|home)(?:[/\\]|$)/i,
  /[A-Z]:\\(?:Users|Documents|\.ssh)\b/i,
  /\\\\[^\\]+\\/,
  /(?:^|[^A-Za-z0-9])(?:access[_-]?key|secret(?:[_-][A-Za-z]+)*|private[_-]?key|password|credential)(?:$|[^A-Za-z0-9])/i,
];

function safeWorkflowDiagnostic(value: string): boolean {
  return !UNSAFE_WORKFLOW_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(value));
}

function uniqueSafeWorkflowDiagnostics(values: string[], fallback: string[]): string[] {
  const safeValues = values.filter(safeWorkflowDiagnostic);
  return [...new Set([...safeValues, ...fallback])].slice(0, 20);
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
    .filter((item) => ["passed", "skipped"].includes(item.status))
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
    exactUnblockAction: genericUnblockAction(failedStage.name, kind, failedStage.error.code),
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
  const latestStageSubmission = (
    stageName: "contracts" | "implementation" | "functional-review" | "design-review",
  ) =>
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
    const legacyCoverage = latestStageSubmission("contracts")?.metadata["legacyCoverage"];
    if (
      run.artifacts.some((artifact) => artifact.kind === "legacy-feature-inventory") &&
      Array.isArray(legacyCoverage) &&
      legacyCoverage.length > 0
    ) {
      completed.add("legacy-inventory");
    }
  }

  const implementation = stage(run, "implementation");
  if (implementation.status === "passed") {
    for (const artifactId of implementation.artifactIds) {
      const role = artifacts.get(artifactId)?.metadata["featureEvidenceRole"];
      if (role === "result") completed.add("targeted-feature-e2e");
      if (role === "video") completed.add("feature-video");
    }
    const implementationSubmission = latestStageSubmission("implementation");
    if (
      Array.isArray(implementationSubmission?.metadata["apiCoverage"]) &&
      implementationSubmission.metadata["apiCoverage"].length > 0
    ) {
      completed.add("api-coverage");
    }
    if (implementationSubmission?.metadata["performanceEvidence"] !== undefined) {
      completed.add("performance-evidence");
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

  const packet = reviewPacketFromRun(run);
  if (
    packet !== undefined &&
    currentVisualReport(run, packet.id)?.metadata["visualStatus"] === "passed"
  ) {
    completed.add("visual-comparison");
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
  "LEGACY_API_METHOD_UNKNOWN",
  "VISUAL_REVIEW_THRESHOLD_NOT_MET",
]);

function canonicalDurableBlockerCode(kind: WorkflowBlocker["kind"], rawCode: string): string {
  return KNOWN_DURABLE_BLOCKER_CODES.has(rawCode) ? rawCode : blockerCodeForKind(kind);
}

function blockerKindForStageError(stageName: RunStageName, code: string): WorkflowBlocker["kind"] {
  if (code === "LEGACY_API_METHOD_UNKNOWN") return "missing-input";
  if (code === "VISUAL_REVIEW_THRESHOLD_NOT_MET") return "verification";
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

function genericUnblockAction(
  stageName: RunStageName,
  kind: WorkflowBlocker["kind"],
  code?: string,
): string {
  if (code === "VISUAL_REVIEW_THRESHOLD_NOT_MET") {
    return "Inspect the failed 92% visual comparison in the draft, correct the implementation or evidence source, and start a new approved Run for further work.";
  }
  if (code === "LEGACY_API_METHOD_UNKNOWN") {
    return "Capture scoped runtime network evidence for the unresolved calls and submit it to this same Run to resume intake.";
  }
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

  if (parsed.data.publication === "none" && parsed.data.draftEvidenceBundle !== undefined) {
    const { draftEvidenceBundle: _staleDraftEvidenceBundle, ...localOnlyProfile } = parsed.data;
    return DeliveryProfileSchema.parse(localOnlyProfile);
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

function deliveryPolicyForRun(
  run: RunManifest,
  scope: WorkflowScope,
  profile: DeliveryProfile,
): ReturnType<typeof resolveDeliveryPolicy> | undefined {
  if (profile.mode === "auto") return undefined;
  return resolveDeliveryPolicy({
    mode: profile.mode,
    hasOpenApi: profile.openApiPaths.length + profile.openApiUrls.length > 0,
    legacyApiOperationCount: profile.mode === "legacy" ? profile.openApiOperations.length : 0,
    ui: scope.ui,
    workload: workloadFromRun(run, scope, profile).size,
  });
}

function countIntakeRequirements(text: string): number {
  return countIntakeRequirementsFromTexts([text]);
}

function countIntakeRequirementsFromTexts(texts: readonly string[]): number {
  let explicitLines = 0;
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      if (/^(?:[-*+] |\d+[.)] )/.test(line.trim())) {
        explicitLines += 1;
        if (explicitLines === 50) return 50;
      }
    }
  }
  if (explicitLines > 0) return explicitLines;

  let sentences = 0;
  for (const text of texts) {
    for (const sentence of text.split(/[.!?\n]+/)) {
      if (sentence.trim().length >= 3) {
        sentences += 1;
        if (sentences === 50) return 50;
      }
    }
  }
  return Math.max(1, sentences);
}

function requiredValidationsForRun(scope: WorkflowScope, profile: DeliveryProfile): string[] {
  const explicitModePolicy =
    profile.mode === "auto"
      ? undefined
      : resolveDeliveryPolicy({
          mode: profile.mode,
          hasOpenApi: profile.openApiPaths.length + profile.openApiUrls.length > 0,
          legacyApiOperationCount: profile.mode === "legacy" ? profile.openApiOperations.length : 0,
          ui: scope.ui,
          workload: "M",
        });
  const validations = new Set<string>(explicitModePolicy?.modeValidations ?? []);
  for (const gate of buildGatePlan(scope)) {
    if (gate.applicability === "required") validations.add(gate.id);
  }
  if (explicitModePolicy === undefined && scope.ui && scope.api) validations.add("api-ready");
  if (profile.publication === "draft") validations.add("draft-publication-preflight");
  return [...validations];
}

type WorkflowActionStatusCommon = Omit<WorkflowActionStatus, "view" | "stages">;

function buildCommonStatusProjection(
  common: WorkflowActionStatusCommon,
): WorkflowActionStatusCommon {
  return common;
}

function buildActionStatusProjection(
  common: WorkflowActionStatusCommon,
  run: RunManifest,
): WorkflowActionStatus {
  return WorkflowActionStatusSchema.parse({
    view: "action",
    ...common,
    stages: run.stages.map((item) => ({ name: item.name, status: item.status })),
  });
}

function buildCheckpointStatusProjection(
  common: WorkflowActionStatusCommon,
  run: RunManifest,
): WorkflowCheckpointStatus {
  return WorkflowCheckpointStatusSchema.parse({
    view: "checkpoint",
    ...common,
    stages: run.stages.map((item) => ({
      name: item.name,
      status: item.status,
      ...(item.checkpoint === undefined ? {} : { checkpoint: item.checkpoint.name }),
    })),
    resumeContext: boundedResumeContextForRun(run),
  });
}

function buildDetailStatusProjection(
  common: WorkflowActionStatusCommon,
  run: RunManifest,
  scope: WorkflowScope,
  deliveryProfile: DeliveryProfile,
  legacyInventory: WorkflowDetailStatus["legacyInventory"],
): WorkflowDetailStatus {
  const { deliveryProfile: _deliverySummary, ...shared } = common;
  return WorkflowDetailStatusSchema.parse({
    view: "detail",
    ...shared,
    scope,
    deliveryProfile,
    stages: run.stages.map((item) => ({
      name: item.name,
      status: item.status,
      ...(item.name === "implementation" && item.checkpoint !== undefined
        ? { checkpoint: item.checkpoint.name }
        : {}),
    })),
    ...(legacyInventory === undefined ? {} : { legacyInventory }),
    resumeContext: resumeContextForRun(run),
  });
}

function boundedResumeContextForRun(run: RunManifest): WorkflowResumeContext {
  const goal = run.evidence
    .slice(0, 32)
    .filter((item) => item.metadata["itemType"] === "instruction")
    .flatMap((item) => (item.excerpt === undefined ? [] : [item.excerpt]))
    .join("\n\n")
    .slice(0, 4_000)
    .trim();
  const artifactWindow =
    run.artifacts.length <= 200
      ? run.artifacts
      : [...run.artifacts.slice(0, 50), ...run.artifacts.slice(-150)];
  const evidencePaths = [
    ...new Set(
      artifactWindow.flatMap((artifact) => {
        const projectPath = artifact.metadata["projectRelativePath"];
        return typeof projectPath === "string" &&
          projectPath.length <= 1_000 &&
          isSafeDurableEvidencePath(projectPath)
          ? [projectPath]
          : [];
      }),
    ),
  ].slice(-200);
  const submissions: WorkflowResumeContext["submissions"] = [];
  for (let index = run.artifacts.length - 1; index >= 0 && submissions.length < 16; index -= 1) {
    const artifact = run.artifacts[index];
    const kind = artifact?.metadata["workflowSubmissionKind"];
    const summary = artifact?.metadata["summary"];
    const outcome = artifact?.metadata["status"] ?? artifact?.metadata["verdict"];
    if (typeof kind === "string" && typeof summary === "string" && typeof outcome === "string") {
      submissions.push({ kind, summary: summary.slice(0, 500), outcome });
    }
  }
  submissions.reverse();

  return WorkflowResumeContextSchema.parse({
    goal: goal === "" ? "Continue the recorded spec-to-pr Run." : goal,
    evidencePaths,
    submissions,
  });
}

function resumeContextForRun(run: RunManifest): WorkflowResumeContext {
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
  const submissionsByKind = new Map<string, WorkflowResumeContext["submissions"][number]>();
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

async function actionsForRun(
  run: RunManifest,
  scope: WorkflowScope,
  profile: DeliveryProfile,
  nowIso: string,
  artifactStore: ArtifactBlobStore,
) {
  const intake = stage(run, "intake");
  if (intake.status !== "passed") {
    return intake.status === "blocked" && intake.error?.code === "LEGACY_API_METHOD_UNKNOWN"
      ? [
          WorkflowActionSchema.parse({
            kind: "collect-legacy-network-evidence",
            runId: run.id,
            maxBytes: 1024 * 1024,
            maxRequests: 1_000,
          }),
        ]
      : [];
  }
  const policy = deliveryPolicyForRun(run, scope, profile);
  const parallelReviewers =
    policy?.parallelReviewers ??
    buildDelegationPolicy(workloadFromRun(run, scope, profile).size).parallelReviewers;
  if (isActionable(stage(run, "contracts"))) {
    return [WorkflowActionSchema.parse({ kind: "prepare-contracts", runId: run.id })];
  }
  if (stage(run, "contracts").status === "passed" && isActionable(stage(run, "implementation"))) {
    const visualRepair = await activeVisualRepairAction(run, artifactStore);
    if (visualRepair !== undefined) {
      return [
        WorkflowActionSchema.parse({
          kind: "implementation-repair",
          repairEvidenceVersion: visualRepair.repairEvidenceVersion,
          runId: run.id,
          reviewPacketId: visualRepair.sourcePacketId,
          lineageId: visualRepair.lineageId,
          nextAttempt: visualRepair.nextAttempt,
          failedTargets: visualRepair.failedTargets,
          ...(visualRepair.repairEvidenceVersion === "v2"
            ? { repairEvidenceArtifactId: visualRepair.repairEvidenceArtifactId }
            : {}),
        }),
      ];
    }
    return [
      WorkflowActionSchema.parse({
        kind: "implement",
        runId: run.id,
        requireApiReady:
          policy?.requireApiReady ?? (profile.mode === "auto" && scope.ui && scope.api),
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
  const evidenceIndex = currentReusablePacketEvidence(run, packet);

  const actions = [];
  const currentVisual = currentVisualReport(run, packet.id);
  if (
    profile.requirements.visualComparison &&
    currentVisual?.metadata["visualStatus"] !== "passed" &&
    !hasInProgressVisualAttempt(run, packet, nowIso) &&
    committedVisualComparisonAttemptCount(run, packet, nowIso) < MAX_VISUAL_REPAIR_ATTEMPTS
  ) {
    actions.push(
      WorkflowActionSchema.parse({
        kind: "compare-visuals",
        runId: run.id,
        reviewPacketId: packet.id,
        attempt: committedVisualComparisonAttemptCount(run, packet, nowIso) + 1,
      }),
    );
  }
  if (isActionable(stage(run, "functional-review"))) {
    actions.push(
      WorkflowActionSchema.parse({
        kind: "review-functional",
        runId: run.id,
        reviewPacketId: packet.id,
        ...(evidenceIndex.length === 0 ? {} : { evidenceIndex }),
      }),
    );
  }
  if (
    scope.ui &&
    isActionable(stage(run, "design-review")) &&
    (parallelReviewers || stage(run, "functional-review").status === "passed")
  ) {
    actions.push(
      WorkflowActionSchema.parse({
        kind: "review-design",
        runId: run.id,
        reviewPacketId: packet.id,
        ...(evidenceIndex.length === 0 ? {} : { evidenceIndex }),
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
  submission: Exclude<
    WorkflowSubmission,
    {
      kind: "figma-bundle" | "api-ready" | "visual-comparison" | "legacy-network-evidence";
    }
  >,
): RunStageName {
  if (submission.kind === "contracts") return "contracts";
  if (submission.kind === "implementation") return "implementation";
  return submission.kind;
}

type ReviewSubmissionFence = {
  reviewPacketId: string;
  headSha: string;
  diffDigest: string;
};

function reviewSubmissionFence(run: RunManifest): ReviewSubmissionFence {
  const packet = reviewPacketFromRun(run);
  if (packet === undefined) {
    throw new Error("REVIEW_PACKET_STALE: the implementation review packet is missing");
  }
  return {
    reviewPacketId: packet.id,
    headSha: packet.headSha,
    diffDigest: packet.diffDigest,
  };
}

function assertCurrentReviewFence(
  run: RunManifest,
  fence: ReviewSubmissionFence,
  reviewStage: "functional-review" | "design-review",
): void {
  const implementation = stage(run, "implementation");
  if (implementation.checkpoint?.name === "visual-threshold-not-met") {
    throw new Error(
      "REVIEW_PACKET_STALE: visual threshold terminalization invalidated the reviewer result",
    );
  }
  const packet = reviewPacketFromRun(run);
  if (
    packet === undefined ||
    packet.id !== fence.reviewPacketId ||
    packet.headSha !== fence.headSha ||
    packet.diffDigest !== fence.diffDigest
  ) {
    throw new Error(
      "REVIEW_PACKET_STALE: the current implementation packet, head, or diff no longer matches the reviewer result",
    );
  }
  if (implementation.status !== "passed") {
    throw new Error("REVIEW_PACKET_STALE: implementation is no longer passed for this review");
  }
  if (!isActionable(stage(run, reviewStage))) {
    throw new Error(`REVIEW_PACKET_STALE: ${reviewStage} is no longer actionable`);
  }
}

function assertSubmissionPrerequisites(
  run: RunManifest,
  submission: StandardWorkflowSubmission,
  nowIso: string,
): void {
  if (stage(run, "intake").status !== "passed") {
    throw new Error("The intake stage must pass before downstream evidence can be submitted");
  }
  const profile = deliveryProfileFromRun(run);
  if (submission.kind === "design-review") {
    // A design reviewer may independently approve the implementation even
    // while the mandatory runtime comparison is failed or not-run. The visual
    // evidence remains its own open merge-blocking Gap and is never converted
    // into a pass by this review verdict.
    const scope = scopeFromRun(run);
    const parallelReviewers =
      deliveryPolicyForRun(run, scope, profile)?.parallelReviewers ??
      buildDelegationPolicy(workloadFromRun(run, scope, profile).size).parallelReviewers;
    if (!parallelReviewers && stage(run, "functional-review").status !== "passed") {
      throw new Error("Functional review must pass before design review for XS, S, and M runs");
    }
  }
  if (submission.kind === "api-ready" && stage(run, "contracts").status !== "passed") {
    throw new Error("The contracts stage must pass before the api-ready checkpoint");
  }
  if (
    submission.kind === "api-ready" &&
    profile.requirements.apiCoverage &&
    submission.operations.length === 0
  ) {
    throw new Error("Full delivery API-ready evidence requires operation-aware readiness");
  }
  if (submission.kind === "api-ready" && profile.requirements.apiCoverage) {
    const authoritative = new Set(
      profile.openApiOperations.map((operation) => operation.operationKey),
    );
    const submitted = new Set(submission.operations.map((operation) => operation.operationKey));
    const missing = [...authoritative].filter((operationKey) => !submitted.has(operationKey));
    const unknown = [...submitted].filter((operationKey) => !authoritative.has(operationKey));
    if (authoritative.size === 0 || missing.length > 0 || unknown.length > 0) {
      throw new Error(
        `API-ready operations must exactly match the intake-pinned OpenAPI inventory; missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}`,
      );
    }
  }
  if (submission.kind === "visual-comparison") {
    const packet = reviewPacketFromRun(run);
    if (!profile.requirements.visualComparison) {
      throw new Error("Visual comparison is not applicable to this delivery profile");
    }
    if (stage(run, "implementation").status !== "passed") {
      throw new Error("Implementation must pass before visual comparison");
    }
    if (packet === undefined || packet.id !== submission.reviewPacketId) {
      throw new Error("Visual comparison must reference the current implementation review packet");
    }
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
    profile.publication === "draft" &&
    profile.draftEvidenceBundle !== undefined &&
    submission.draftBundle === undefined
  ) {
    throw new Error("Legacy draft publication requires a Draft bundle before contracts can pass");
  }
  if (
    submission.kind === "contracts" &&
    submission.status === "passed" &&
    profile.publication === "draft" &&
    profile.draftEvidenceBundle !== undefined &&
    submission.draftBundle?.manifestPath !== profile.draftEvidenceBundle.manifestPath
  ) {
    throw new Error("Draft bundle manifest must match the delivery profile manifest path");
  }
  if (
    submission.kind === "contracts" &&
    submission.status === "passed" &&
    profile.requirements.legacyBaseline &&
    (submission.visualTargets.length === 0 ||
      submission.visualTargets.some((target) => target.baselineKind !== "legacy-screenshot"))
  ) {
    throw new Error("Legacy mode requires one or more running legacy screenshot targets");
  }
  if (
    submission.kind === "contracts" &&
    submission.status === "passed" &&
    profile.requirements.legacyInventory
  ) {
    const inventoryKeys = legacyFeatureKeysFromRun(run);
    if (inventoryKeys.size === 0) {
      throw new Error("Legacy migration requires a non-empty runtime-generated inventory");
    }
    if (submission.legacyScopeKeys.length === 0) {
      throw new Error("Legacy migration requires explicit in-scope inventory feature keys");
    }
    const unknownKeys = submission.legacyScopeKeys.filter(
      (featureKey) => !inventoryKeys.has(featureKey),
    );
    if (unknownKeys.length > 0) {
      throw new Error(`Legacy scope references unknown feature keys: ${unknownKeys.join(", ")}`);
    }
    const requirementIds = new Set(
      submission.requirementManifest.map((requirement) => requirement.id),
    );
    const unknownRequirements = submission.legacyCoverage.flatMap((coverage) =>
      coverage.requirementIds.filter((requirementId) => !requirementIds.has(requirementId)),
    );
    if (unknownRequirements.length > 0) {
      throw new Error(
        `Legacy coverage references unknown requirements: ${[...new Set(unknownRequirements)].join(", ")}`,
      );
    }
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
    (profile.figmaUrls.length === 0 ||
      JSON.stringify(submission.fileUrls ?? [submission.fileUrl]) !==
        JSON.stringify(profile.figmaUrls))
  ) {
    throw new Error("Figma bundle URLs must exactly match the delivery profile");
  }
  if (submission.kind === "figma-bundle") {
    const capturedNodeIds = new Set(
      submission.visualTargets.flatMap((target) =>
        target.figmaCapture === undefined ? [] : [target.figmaCapture.nodeId],
      ),
    );
    const missingUrlStates = (submission.fileUrls ?? [submission.fileUrl]).filter((fileUrl) => {
      const nodeId = figmaNodeIdFromUrl(fileUrl);
      return nodeId !== undefined && !capturedNodeIds.has(nodeId);
    });
    if (missingUrlStates.length > 0) {
      throw new Error(
        `Figma bundle must bind every supplied URL state to a visual target: ${missingUrlStates.join(", ")}`,
      );
    }
  }
  if (
    submission.kind === "figma-bundle" &&
    run.artifacts.some((artifact) => artifact.metadata["workflowSubmissionKind"] === "figma-bundle")
  ) {
    throw new Error("A Figma bundle was already submitted for this Run");
  }
  if (
    submission.kind === "figma-bundle" &&
    !["pending", "failed", "blocked"].includes(stage(run, "contracts").status)
  ) {
    throw new Error("Figma bundle evidence must be submitted before contracts pass");
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
  if (
    submission.kind === "implementation" &&
    submission.status === "passed" &&
    profile.requirements.featureVideo &&
    submission.captureSessionPath === undefined
  ) {
    throw new Error("Feature user-flow video requires a packet-bound capture-session receipt");
  }
  if (
    submission.kind === "implementation" &&
    submission.status === "passed" &&
    profile.requirements.mockData &&
    submission.mockDataEvidence === undefined
  ) {
    throw new Error("Figma delivery requires deterministic mock manifest and fixture evidence");
  }
  if (
    submission.kind === "implementation" &&
    submission.status === "passed" &&
    profile.requirements.figmaBundle
  ) {
    assertFigmaImplementationBindings(run, submission);
  }
  if (
    submission.kind === "implementation" &&
    submission.status === "passed" &&
    profile.requirements.legacyInventory
  ) {
    const scoped = legacyScopeKeysFromRun(run);
    const covered = new Set(submission.legacyCoverage.map((coverage) => coverage.featureKey));
    const requirementIds = contractRequirementIds(run);
    const unknownRequirements = submission.legacyCoverage.flatMap((coverage) =>
      coverage.requirementIds.filter((requirementId) => !requirementIds.has(requirementId)),
    );
    const missing = [...scoped].filter((featureKey) => !covered.has(featureKey));
    const unknown = [...covered].filter((featureKey) => !scoped.has(featureKey));
    if (
      scoped.size === 0 ||
      missing.length > 0 ||
      unknown.length > 0 ||
      unknownRequirements.length > 0
    ) {
      throw new Error(
        `Implementation legacy coverage must exactly match contracted scope and requirements; missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}; unknown requirements: ${[...new Set(unknownRequirements)].join(", ") || "none"}`,
      );
    }
  }
  if (submission.kind === "implementation" && stage(run, "contracts").status !== "passed") {
    throw new Error("The contracts stage must pass before implementation begins");
  }
  if (
    submission.kind === "implementation" &&
    submission.status === "passed" &&
    profile.requirements.apiCoverage
  ) {
    const readyOperationKeys = apiReadyOperationKeysFromRun(run);
    const coveredOperationKeys = new Set(
      submission.apiCoverage.map((coverage) => coverage.operationKey),
    );
    if (readyOperationKeys.size === 0 || submission.apiCoverage.length === 0) {
      throw new Error("Full delivery implementation requires operation-aware API coverage");
    }
    const missing = [...readyOperationKeys].filter(
      (operationKey) => !coveredOperationKeys.has(operationKey),
    );
    const unknown = [...coveredOperationKeys].filter(
      (operationKey) => !readyOperationKeys.has(operationKey),
    );
    if (missing.length > 0 || unknown.length > 0) {
      throw new Error(
        `API coverage must exactly match API-ready operations; missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}`,
      );
    }
  }
  if (
    submission.kind === "implementation" &&
    submission.status === "passed" &&
    profile.requirements.performanceEvidence
  ) {
    const lab = submission.performanceEvidence?.lab;
    if (lab === undefined) {
      throw new Error("Full delivery implementation requires labelled lab performance evidence");
    }
    const latency = lab.metrics.tbtMs ?? lab.metrics.interactionLatencyMs;
    if (
      lab.metrics.lcpMs > 2_500 ||
      lab.metrics.cls > 0.1 ||
      latency === undefined ||
      latency > 200
    ) {
      throw new Error(
        "Lab performance exceeds the default affected-route budget (LCP 2500 ms, CLS 0.1, TBT/interaction 200 ms)",
      );
    }
  }
  if (
    submission.kind === "implementation" &&
    submission.status === "passed" &&
    (profile.requirements.apiCoverage ||
      (profile.mode === "auto" && scopeFromRun(run).ui && scopeFromRun(run).api)) &&
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
    if (
      submission.kind === "design-review" &&
      submission.verdict === "approved" &&
      scopeFromRun(run).ui
    ) {
      assertCurrentVisualComparisonPassed(run, submission.reviewPacketId, nowIso);
    }
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

async function assertDraftBundleIntegrity(
  run: RunManifest,
  submission: StandardWorkflowSubmission,
): Promise<void> {
  const profile = deliveryProfileFromRun(run);
  if (
    profile.publication !== "draft" ||
    profile.draftEvidenceBundle === undefined ||
    submission.kind !== "contracts" ||
    submission.status !== "passed" ||
    submission.draftBundle === undefined
  ) {
    return;
  }

  const manifestFile = await readProjectTextFile(
    run.projectRoot,
    submission.draftBundle.manifestPath,
    "Draft bundle manifest",
  );
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(await readFile(manifestFile.resolvedPath, "utf8"));
  } catch {
    throw new Error("Draft bundle manifest schema is invalid");
  }
  const parsed = DraftEvidenceManifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    throw new Error("Draft bundle manifest schema is invalid");
  }
  const manifest = parsed.data;
  const legacyRootDigest = legacyRootDigestFromRun(run);
  const requirementIds = submission.requirementManifest.map((requirement) => requirement.id);
  const submittedOpenSpec = [
    submission.draftBundle.proposalPath,
    ...submission.draftBundle.specPaths,
    submission.draftBundle.tasksPath,
  ];
  const manifestOpenSpec = [
    manifest.openSpec.proposal.path,
    ...manifest.openSpec.specs.map((artifact) => artifact.path),
    manifest.openSpec.tasks.path,
  ];

  if (manifest.runId !== run.id || manifest.runRevision !== run.revision) {
    throw new Error("Draft bundle manifest must reference the current Run revision");
  }
  if (legacyRootDigest === undefined || manifest.legacyRootDigest !== legacyRootDigest) {
    throw new Error("Draft bundle manifest legacy root digest is stale");
  }
  if (!sameStringMembers(manifest.requirementIds, requirementIds)) {
    throw new Error("Draft bundle manifest requirements must match the submitted contracts");
  }
  if (
    manifest.openSpec.changeName !== submission.draftBundle.changeName ||
    !sameStringMembers(manifestOpenSpec, submittedOpenSpec)
  ) {
    throw new Error("Draft bundle manifest OpenSpec paths must match the submitted change");
  }

  for (const artifact of [
    manifest.openSpec.proposal,
    ...manifest.openSpec.specs,
    manifest.openSpec.tasks,
  ]) {
    const source = await readProjectTextFile(
      run.projectRoot,
      artifact.path,
      "Draft bundle OpenSpec",
    );
    if (source.path !== artifact.path) {
      throw new Error(`Draft bundle OpenSpec path must resolve exactly: ${artifact.path}`);
    }
    const digest = `sha256:${createHash("sha256")
      .update(await readFile(source.resolvedPath))
      .digest("hex")}`;
    if (digest !== artifact.digest) {
      throw new Error(`Draft bundle OpenSpec digest does not match: ${artifact.path}`);
    }
  }
}

function contractRequirementIds(run: RunManifest): Set<string> {
  const artifact = contractsSubmissionReport(run);
  const rawIds = artifact?.metadata["requirementIds"];
  if (!Array.isArray(rawIds) || rawIds.some((value) => typeof value !== "string")) {
    throw new Error("The contracts stage is missing its structured requirement manifest");
  }
  return new Set(rawIds as string[]);
}

function reviewPacketFromRun(run: RunManifest): ImplementationReviewPacket | undefined {
  return parseImplementationReviewPacket(
    stage(run, "implementation").checkpoint?.data["reviewPacket"],
  );
}

function reviewPacketByIdFromRun(
  run: RunManifest,
  reviewPacketId: string,
): ImplementationReviewPacket | undefined {
  const current = reviewPacketFromRun(run);
  if (current?.id === reviewPacketId) return current;
  for (const artifact of run.artifacts) {
    const parsed = parseImplementationReviewPacket(artifact.metadata["reviewPacket"]);
    if (parsed?.id === reviewPacketId) return parsed;
  }
  return undefined;
}

function parseImplementationReviewPacket(raw: unknown): ImplementationReviewPacket | undefined {
  const parsed = ImplementationReviewPacketSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const withoutEvidenceIndex = { ...(raw as Record<string, unknown>) };
  delete withoutEvidenceIndex["evidenceIndex"];
  const sanitized = ImplementationReviewPacketSchema.safeParse(withoutEvidenceIndex);
  return sanitized.success ? sanitized.data : undefined;
}

function currentReusablePacketEvidence(
  run: RunManifest,
  packet: ImplementationReviewPacket,
): PacketEvidenceEntry[] {
  return (packet.evidenceIndex ?? []).filter((entry) => {
    const artifact = run.artifacts.find((candidate) => candidate.id === entry.artifactId);
    if (
      artifact === undefined ||
      artifact.metadata["reviewPacketId"] !== packet.id ||
      artifact.metadata["headSha"] !== packet.headSha ||
      artifact.metadata["diffDigest"] !== packet.diffDigest
    ) {
      return false;
    }
    const command = artifact.metadata["evidenceCommand"];
    const selector = artifact.metadata["evidenceSelector"];
    const adapterVersion = artifact.metadata["adapter"];
    if (
      typeof command !== "string" ||
      (selector !== undefined && typeof selector !== "string") ||
      typeof adapterVersion !== "string"
    ) {
      return false;
    }
    const expected = PacketEvidenceEntrySchema.safeParse({
      command,
      ...(selector === undefined ? {} : { selector }),
      resultDigest: artifact.digest,
      artifactId: artifact.id,
      headSha: packet.headSha,
      diffDigest: packet.diffDigest,
      adapterVersion,
    });
    return expected.success && reusablePacketEvidence([entry], expected.data) !== undefined;
  });
}

type BufferedReviewResult = {
  artifact: ArtifactRef;
  stageName: "functional-review" | "design-review";
  verdict: "approved" | "changes-requested" | "blocked";
  summary?: string;
  blocker?: WorkflowBlocker;
  evidenceArtifactIds: string[];
};

function reviewResultInbox(
  run: RunManifest,
  reviewPacketId: string,
): Map<BufferedReviewResult["stageName"], BufferedReviewResult> {
  const results = new Map<BufferedReviewResult["stageName"], BufferedReviewResult>();
  for (const artifact of [...run.artifacts].reverse()) {
    const kind = artifact.metadata["workflowSubmissionKind"];
    if (kind !== "functional-review" && kind !== "design-review") continue;
    if (artifact.metadata["reviewPacketId"] !== reviewPacketId || results.has(kind)) continue;
    const verdict = artifact.metadata["verdict"];
    if (verdict !== "approved" && verdict !== "changes-requested" && verdict !== "blocked") {
      continue;
    }
    const parsedBlocker = WorkflowBlockerSchema.safeParse(artifact.metadata["workflowBlocker"]);
    const evidenceArtifactIds = artifact.metadata["evidenceArtifactIds"];
    results.set(kind, {
      artifact,
      stageName: kind,
      verdict,
      ...(typeof artifact.metadata["summary"] === "string"
        ? { summary: artifact.metadata["summary"] }
        : {}),
      ...(parsedBlocker.success ? { blocker: parsedBlocker.data } : {}),
      evidenceArtifactIds: Array.isArray(evidenceArtifactIds)
        ? evidenceArtifactIds.filter((value): value is string => typeof value === "string")
        : [],
    });
  }
  return results;
}

function legacyFeatureKeysFromRun(run: RunManifest): Set<string> {
  const rawKeys = [...run.artifacts]
    .reverse()
    .find((artifact) => artifact.kind === "legacy-feature-inventory")?.metadata["featureKeys"];
  return new Set(
    Array.isArray(rawKeys)
      ? rawKeys.filter((featureKey): featureKey is string => typeof featureKey === "string")
      : [],
  );
}

function legacyScopeKeysFromRun(run: RunManifest): Set<string> {
  const rawKeys = contractsSubmissionReport(run)?.metadata["legacyScopeKeys"];
  return new Set(
    Array.isArray(rawKeys)
      ? rawKeys.filter((featureKey): featureKey is string => typeof featureKey === "string")
      : [],
  );
}

function contractsSubmissionReport(run: RunManifest): ArtifactRef | undefined {
  return [...run.artifacts]
    .reverse()
    .find(
      (artifact) =>
        artifact.kind === "agent-result-report" &&
        artifact.metadata["workflowSubmissionKind"] === "contracts",
    );
}

function apiReadyOperationKeysFromRun(run: RunManifest): Set<string> {
  const rawOperations = stage(run, "implementation").checkpoint?.data["operations"];
  if (!Array.isArray(rawOperations)) return new Set();
  return new Set(
    rawOperations.flatMap((operation) => {
      if (
        typeof operation === "object" &&
        operation !== null &&
        "operationKey" in operation &&
        typeof operation.operationKey === "string"
      ) {
        return [operation.operationKey];
      }
      return [];
    }),
  );
}

function visualTargetsFromRun(run: RunManifest): VisualTargetManifest[] {
  const profile = deliveryProfileFromRun(run);
  const expectedSubmissionKinds = profile.requirements.legacyBaseline
    ? ["contracts"]
    : ["figma-bundle", "contracts"];
  for (const artifact of [...run.artifacts].reverse()) {
    if (
      typeof artifact.metadata["workflowSubmissionKind"] !== "string" ||
      !expectedSubmissionKinds.includes(artifact.metadata["workflowSubmissionKind"])
    ) {
      continue;
    }
    const parsed = z
      .array(VisualTargetManifestCompatibilitySchema)
      .safeParse(artifact.metadata["visualTargets"]);
    if (parsed.success && parsed.data.length > 0) {
      return parsed.data.map(normalizeVisualTargetManifest);
    }
  }
  return [];
}

function visualBaselineArtifacts(run: RunManifest, targets: VisualTargetManifest[]): ArtifactRef[] {
  const byPath = new Map<string, ArtifactRef>();
  for (const target of targets) {
    const expectedSubmissionKind = target.baselineKind === "figma" ? "figma-bundle" : "contracts";
    const artifact = [...run.artifacts]
      .reverse()
      .find(
        (candidate) =>
          candidate.metadata["projectRelativePath"] === target.baselinePath &&
          candidate.metadata["workflowSubmissionKind"] === expectedSubmissionKind,
      );
    if (artifact === undefined) {
      throw new Error(
        `VISUAL_BASELINE_ISOLATION_INVALID: missing immutable baseline ${target.baselinePath}`,
      );
    }
    byPath.set(target.baselinePath, artifact);
  }
  return [...byPath.values()];
}

function baselineIsolationSourceInputsFromRun(
  run: RunManifest,
  packet: ImplementationReviewPacket,
): {
  implementationSourceFiles: string[];
  designSystemSourceFiles: string[];
  browserBundlePaths: string[];
  registeredExcludedPaths: string[];
} {
  const implementationReport = [...run.artifacts].reverse().find((artifact) => {
    if (
      artifact.kind !== "agent-result-report" ||
      artifact.metadata["workflowSubmissionKind"] !== "implementation"
    ) {
      return false;
    }
    const parsed = ImplementationReviewPacketSchema.safeParse(artifact.metadata["reviewPacket"]);
    return parsed.success && parsed.data.id === packet.id;
  });
  if (implementationReport === undefined) {
    throw new Error(
      "VISUAL_BASELINE_ISOLATION_INVALID: current implementation declaration is missing",
    );
  }
  const implementationSourceFiles = z
    .array(z.string())
    .safeParse(implementationReport.metadata["changedFiles"]);
  if (!implementationSourceFiles.success) {
    throw new Error(
      "VISUAL_BASELINE_ISOLATION_INVALID: implementation source declaration is invalid",
    );
  }
  const designSystemEvidence = z
    .object({
      usages: z.array(z.object({ sourceFile: z.string() }).passthrough()),
    })
    .passthrough()
    .safeParse(implementationReport.metadata["designSystemEvidence"]);
  const designSystemSourceFiles = designSystemEvidence.success
    ? designSystemEvidence.data.usages.map((usage) => usage.sourceFile)
    : [];
  const evidenceArtifactIds = new Set(
    z.array(z.string()).catch([]).parse(implementationReport.metadata["evidenceArtifactIds"]),
  );
  const browserBundlePaths = run.artifacts.flatMap((artifact) => {
    const projectRelativePath = artifact.metadata["projectRelativePath"];
    return evidenceArtifactIds.has(artifact.id) &&
      typeof projectRelativePath === "string" &&
      /\.(?:js|mjs|cjs|css)$/i.test(projectRelativePath)
      ? [projectRelativePath]
      : [];
  });
  const browserBundlePathSet = new Set(browserBundlePaths);
  const registeredEvidencePaths = run.artifacts.flatMap((artifact) => {
    const projectRelativePath = artifact.metadata["projectRelativePath"];
    return evidenceArtifactIds.has(artifact.id) &&
      typeof projectRelativePath === "string" &&
      !browserBundlePathSet.has(projectRelativePath)
      ? [projectRelativePath]
      : [];
  });
  const mockDataEvidence = z
    .object({
      manifestPath: z.string(),
      fixturePaths: z.array(z.string()).optional(),
      fixtures: z.array(z.object({ path: z.string() }).passthrough()).optional(),
    })
    .passthrough()
    .safeParse(implementationReport.metadata["mockDataEvidence"]);
  const registeredMockPaths = mockDataEvidence.success
    ? [
        mockDataEvidence.data.manifestPath,
        ...(mockDataEvidence.data.fixturePaths ?? []),
        ...(mockDataEvidence.data.fixtures?.map((fixture) => fixture.path) ?? []),
      ]
    : [];
  return {
    implementationSourceFiles: implementationSourceFiles.data,
    designSystemSourceFiles,
    browserBundlePaths,
    registeredExcludedPaths: [...new Set([...registeredEvidencePaths, ...registeredMockPaths])],
  };
}

function figmaDesignMappingFromRun(run: RunManifest): FigmaDesignMapping | undefined {
  for (const artifact of [...run.artifacts].reverse()) {
    if (artifact.metadata["workflowSubmissionKind"] !== "figma-bundle") continue;
    const parsed = FigmaDesignMappingSchema.safeParse(artifact.metadata["designMapping"]);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

function figmaStateContractsFromRun(run: RunManifest): FigmaStateContract[] {
  for (const artifact of [...run.artifacts].reverse()) {
    if (artifact.metadata["workflowSubmissionKind"] !== "figma-bundle") continue;
    const parsed = z
      .array(FigmaStateContractSchema)
      .min(1)
      .max(50)
      .safeParse(artifact.metadata["stateContracts"]);
    if (parsed.success) return parsed.data;
  }
  return [];
}

function figmaNodeIdFromUrl(fileUrl: string): string | undefined {
  const nodeId = new URL(fileUrl).searchParams.get("node-id")?.trim();
  return nodeId === undefined || nodeId === "" ? undefined : nodeId.replaceAll("-", ":");
}

function assertFigmaImplementationBindings(
  run: RunManifest,
  submission: Extract<WorkflowSubmission, { kind: "implementation" }>,
): void {
  const namedFixtures = submission.mockDataEvidence?.fixtures;
  if (namedFixtures === undefined) {
    throw new Error("MOCK_FIXTURE_ID_MISMATCH: strict Figma targets require named fixtures");
  }
  const targetFixtureIds = new Set(visualTargetsFromRun(run).map((target) => target.fixture));
  const suppliedFixtureIds = new Set(namedFixtures.map((fixture) => fixture.id));
  const missingFixtures = [...targetFixtureIds].filter((id) => !suppliedFixtureIds.has(id));
  const unusedFixtures = [...suppliedFixtureIds].filter((id) => !targetFixtureIds.has(id));
  if (targetFixtureIds.size === 0 || missingFixtures.length > 0 || unusedFixtures.length > 0) {
    throw new Error(
      `MOCK_FIXTURE_ID_MISMATCH: missing fixture IDs: ${missingFixtures.join(", ") || "none"}; unused fixture IDs: ${unusedFixtures.join(", ") || "none"}`,
    );
  }
  const stateContracts = figmaStateContractsFromRun(run);
  const stateContractsByTarget = new Map(
    stateContracts.map((contract) => [contract.targetId, contract]),
  );
  const invalidStateBindings = visualTargetsFromRun(run).filter((target) => {
    const contract = stateContractsByTarget.get(target.targetId);
    const fixture = namedFixtures.find((candidate) => candidate.id === target.fixture);
    return (
      contract === undefined ||
      target.figmaCapture === undefined ||
      contract.nodeId !== target.figmaCapture.nodeId ||
      contract.state !== target.state ||
      contract.fixtureId !== target.fixture ||
      fixture?.stateContractDigest !== contract.digest
    );
  });
  if (stateContracts.length !== targetFixtureIds.size || invalidStateBindings.length > 0) {
    throw new Error(
      `FIGMA_STATE_CONTRACT_INVALID: implementation fixtures must bind each target's fixture ID and state-contract digest; invalid targets: ${invalidStateBindings.map((target) => target.targetId).join(", ") || "none"}`,
    );
  }

  const mapping = figmaDesignMappingFromRun(run);
  if (mapping === undefined) {
    throw new Error("FIGMA_DESIGN_SYSTEM_EVIDENCE_INVALID: Figma design mapping is missing");
  }
  const usages = submission.designSystemEvidence?.usages ?? [];
  assertExactFigmaImplementationBindings({ mapping, usages });
}

function visualLineageId(packet: ImplementationReviewPacket): string {
  return packet.visualLineageId ?? packet.id;
}

function assertRendererLineageMatchesCommittedAttempts(
  run: RunManifest,
  packet: ImplementationReviewPacket,
  rendererLineageId: string,
): void {
  const lineageId = visualLineageId(packet);
  for (const artifact of run.artifacts) {
    if (artifact.kind !== "visual-report" || artifact.metadata["visualLineageId"] !== lineageId) {
      continue;
    }
    const committedRendererLineageId = artifact.metadata["rendererLineageId"];
    if (typeof committedRendererLineageId !== "string") {
      throw rendererDriftError(
        `committed attempt ${String(artifact.metadata["visualComparisonAttempt"])} is missing renderer lineage`,
      );
    }
    if (committedRendererLineageId !== rendererLineageId) {
      throw rendererDriftError(
        `capture uses ${rendererLineageId}, committed attempts use ${committedRendererLineageId}`,
      );
    }
  }
}

function rendererDriftError(reason: string): Error {
  return new Error(`VISUAL_CAPTURE_RENDERER_DRIFT: ${reason}`);
}

async function activeVisualRepairAction(
  run: RunManifest,
  artifactStore: ArtifactBlobStore,
): Promise<
  | {
      repairEvidenceVersion: "v2";
      sourcePacketId: string;
      lineageId: string;
      nextAttempt: 2 | 3;
      failedTargets: Array<{ targetId: string; reviewMatchRatio: number }>;
      repairEvidenceArtifactId: string;
    }
  | {
      repairEvidenceVersion: "legacy-v1";
      sourcePacketId: string;
      lineageId: string;
      nextAttempt: 2 | 3;
      failedTargets: Array<{ targetId: string; reviewMatchRatio: number }>;
    }
  | undefined
> {
  if (stage(run, "implementation").error?.code !== "VISUAL_IMPLEMENTATION_REPAIR_REQUIRED") {
    return undefined;
  }
  const packet = reviewPacketFromRun(run);
  if (packet === undefined) return undefined;
  const lineageId = visualLineageId(packet);
  const latest = await latestVisualLineageRecord(run, lineageId, artifactStore);
  if (
    latest === undefined ||
    latest.outcome.status !== "repair-required" ||
    latest.outcome.sourcePacketId !== packet.id ||
    (latest.outcome.attempt !== 1 && latest.outcome.attempt !== 2)
  ) {
    return undefined;
  }
  const common = {
    sourcePacketId: latest.outcome.sourcePacketId,
    lineageId,
    nextAttempt: (latest.outcome.attempt + 1) as 2 | 3,
    failedTargets: latest.failedTargets,
  };
  if (latest.repairEvidenceVersion === "legacy-v1") {
    return { ...common, repairEvidenceVersion: "legacy-v1" };
  }
  if (latest.repairEvidenceArtifactId === undefined) {
    throw invalidVisualRepairEvidence("current v2 repair outcome has no bound evidence artifact");
  }
  return {
    ...common,
    repairEvidenceVersion: "v2",
    repairEvidenceArtifactId: latest.repairEvidenceArtifactId,
  };
}

type VisualLineageRecord = {
  outcome: VisualLineageOutcome;
  repairEvidenceVersion: "v2" | "legacy-v1";
  repairEvidenceArtifactId?: string;
  failedTargets: Array<{ targetId: string; reviewMatchRatio: number }>;
};

async function latestVisualLineageRecord(
  run: RunManifest,
  lineageId: string,
  artifactStore: ArtifactBlobStore,
): Promise<VisualLineageRecord | undefined> {
  const records = await visualLineageRecords(run, lineageId, artifactStore);
  let latest: VisualLineageOutcome | undefined;
  try {
    latest = latestVisualLineageOutcome(
      records.map((record) => record.outcome),
      lineageId,
    );
  } catch (error: unknown) {
    throw invalidVisualRepairEvidence(
      error instanceof Error ? error.message : "duplicate lineage outcome",
    );
  }
  return records.find((record) => record.outcome === latest);
}

async function visualLineageRecords(
  run: RunManifest,
  lineageId: string,
  artifactStore: ArtifactBlobStore,
): Promise<VisualLineageRecord[]> {
  const records: VisualLineageRecord[] = [];
  for (const artifact of run.artifacts) {
    const adapter = artifact.metadata["adapter"];
    if (
      adapter !== "visual-repair-lineage-v1" &&
      adapter !== "visual-repair-lineage-v2" &&
      adapter !== "visual-repair-evidence-v2"
    ) {
      continue;
    }
    if (artifact.metadata["visualLineageId"] !== lineageId) {
      continue;
    }
    const sourcePacketId = artifact.metadata["sourcePacketId"];
    const attempt = artifact.metadata["visualLineageAttempt"];
    if (typeof sourcePacketId !== "string" || (attempt !== 1 && attempt !== 2 && attempt !== 3)) {
      throw invalidVisualRepairEvidence("current lineage metadata is malformed");
    }
    const failedTargets = CompactFailedVisualTargetsSchema.safeParse(
      artifact.metadata["failedTargets"],
    );
    if (adapter === "visual-repair-lineage-v1") {
      if (artifact.metadata["repairRequired"] === true && !failedTargets.success) {
        throw invalidVisualRepairEvidence("legacy repair targets are malformed");
      }
      const status =
        artifact.metadata["repairRequired"] === true
          ? "repair-required"
          : artifact.metadata["visualStatus"] === "passed"
            ? "closed"
            : "exhausted";
      if (
        (status === "repair-required" && attempt === 3) ||
        (status === "exhausted" && attempt !== 3)
      ) {
        throw invalidVisualRepairEvidence("legacy outcome status does not match its attempt");
      }
      records.push({
        outcome: { lineageId, sourcePacketId, attempt, status },
        repairEvidenceVersion: "legacy-v1",
        failedTargets: failedTargets.success ? failedTargets.data : [],
      });
      continue;
    }

    const status = artifact.metadata["visualLineageStatus"];
    if (status !== "repair-required" && status !== "closed" && status !== "exhausted") {
      throw invalidVisualRepairEvidence("current lineage status is malformed");
    }
    const sourcePacket = reviewPacketByIdFromRun(run, sourcePacketId);
    if (sourcePacket === undefined || visualLineageId(sourcePacket) !== lineageId) {
      throw invalidVisualRepairEvidence("source review packet is missing or outside the lineage");
    }
    const payload = await readVisualLineagePayload(artifactStore, artifact);
    if (adapter === "visual-repair-evidence-v2") {
      const parsed = VisualRepairEvidenceV2Schema.safeParse(payload);
      const repairEvidenceArtifactId = artifact.metadata["repairEvidenceArtifactId"];
      if (
        !parsed.success ||
        (status !== "repair-required" && status !== "exhausted") ||
        (status === "repair-required" && attempt === 3) ||
        (status === "exhausted" && attempt !== 3) ||
        repairEvidenceArtifactId !== artifact.id ||
        !failedTargets.success ||
        parsed.data.runId !== run.id ||
        parsed.data.lineageId !== lineageId ||
        parsed.data.reviewPacketId !== sourcePacketId ||
        parsed.data.headSha !== sourcePacket.headSha ||
        artifact.metadata["headSha"] !== sourcePacket.headSha ||
        parsed.data.rendererLineageId !== artifact.metadata["rendererLineageId"] ||
        parsed.data.attempt !== attempt
      ) {
        throw invalidVisualRepairEvidence("rich evidence does not match its lineage metadata");
      }
      const payloadCompactTargets = CompactFailedVisualTargetsSchema.parse(
        parsed.data.failedTargets.map((target) => ({
          targetId: target.targetId,
          reviewMatchRatio: target.metrics.reviewMatchRatio,
        })),
      );
      if (JSON.stringify(payloadCompactTargets) !== JSON.stringify(failedTargets.data)) {
        throw invalidVisualRepairEvidence("compact targets do not match rich evidence");
      }
      const artifactIds = new Set(run.artifacts.map((candidate) => candidate.id));
      if (
        parsed.data.failedTargets.some(
          (target) =>
            !artifactIds.has(target.diffArtifactId) || !artifactIds.has(target.overlayArtifactId),
        )
      ) {
        throw invalidVisualRepairEvidence("rich evidence references missing visual artifacts");
      }
      records.push({
        outcome: {
          lineageId,
          sourcePacketId,
          attempt,
          status,
          repairEvidenceArtifactId,
        },
        repairEvidenceVersion: "v2",
        repairEvidenceArtifactId,
        failedTargets: failedTargets.data,
      });
      continue;
    }

    const parsed = VisualLineageOutcomeV2Schema.safeParse(payload);
    if (
      !parsed.success ||
      status !== "closed" ||
      parsed.data.runId !== run.id ||
      parsed.data.lineageId !== lineageId ||
      parsed.data.reviewPacketId !== sourcePacketId ||
      parsed.data.headSha !== sourcePacket.headSha ||
      artifact.metadata["headSha"] !== sourcePacket.headSha ||
      parsed.data.rendererLineageId !== artifact.metadata["rendererLineageId"] ||
      parsed.data.attempt !== attempt
    ) {
      throw invalidVisualRepairEvidence("closed outcome does not match its lineage metadata");
    }
    records.push({
      outcome: { lineageId, sourcePacketId, attempt, status: "closed" },
      repairEvidenceVersion: "v2",
      failedTargets: [],
    });
  }
  return records;
}

async function readVisualLineagePayload(
  artifactStore: ArtifactBlobStore,
  artifact: ArtifactRef,
): Promise<unknown> {
  try {
    return JSON.parse((await artifactStore.readContent(artifact.digest)).toString("utf8"));
  } catch {
    throw invalidVisualRepairEvidence("lineage artifact payload is unreadable");
  }
}

function invalidVisualRepairEvidence(reason: string): Error {
  return new Error(`VISUAL_REPAIR_EVIDENCE_INVALID: ${reason}`);
}

function committedVisualComparisonAttemptCount(
  run: RunManifest,
  packet: ImplementationReviewPacket,
  nowIso: string,
): number {
  const reservations = visualAttemptReservations(run, visualLineageId(packet));
  if (reservations.length > 0) {
    return reduceVisualReservations(reservations, nowIso).committed.length;
  }
  const completedAttempts = new Set(
    run.artifacts.flatMap((artifact) => {
      const attempt = artifact.metadata["visualComparisonAttempt"];
      return artifact.kind === "visual-report" &&
        (artifact.metadata["visualLineageId"] === visualLineageId(packet) ||
          (artifact.metadata["visualLineageId"] === undefined &&
            artifact.metadata["reviewPacketId"] === packet.id)) &&
        (attempt === 1 || attempt === 2 || attempt === 3)
        ? [attempt]
        : [];
    }),
  );
  let count = 0;
  for (const attempt of [1, 2, 3] as const) {
    if (!completedAttempts.has(attempt)) break;
    count += 1;
  }
  return count;
}

function currentVisualReport(run: RunManifest, reviewPacketId: string): ArtifactRef | undefined {
  const reports = run.artifacts.filter(
    (artifact) =>
      artifact.kind === "visual-report" && artifact.metadata["reviewPacketId"] === reviewPacketId,
  );
  return (
    reports.find((artifact) => artifact.metadata["visualStatus"] === "passed") ??
    [...reports].sort(
      (left, right) =>
        Number(right.metadata["visualComparisonAttempt"] ?? 0) -
        Number(left.metadata["visualComparisonAttempt"] ?? 0),
    )[0]
  );
}

function visualAttemptReservations(
  run: RunManifest,
  lineageId: string,
  adapter: "all" | "v3" = "all",
): VisualAttemptReservationEvent[] {
  const reservations: VisualAttemptReservationEvent[] = [];
  const reportsByIdentity = new Map(
    run.artifacts.flatMap((artifact) => {
      const submissionIdentity = artifact.metadata["submissionIdentity"];
      return artifact.kind === "visual-report" && typeof submissionIdentity === "string"
        ? [[submissionIdentity, artifact] as const]
        : [];
    }),
  );
  for (const artifact of run.artifacts) {
    const artifactAdapter = artifact.metadata["adapter"];
    if (artifactAdapter !== "visual-attempt-reservation-v3") {
      if (adapter === "v3" || artifactAdapter !== "visual-attempt-reservation-v2") continue;
    }
    if ((artifact.metadata["visualLineageId"] ?? artifact.metadata["reviewPacketId"]) !== lineageId)
      continue;
    const submissionIdentity = artifact.metadata["submissionIdentity"];
    const attempt = artifact.metadata["visualComparisonAttempt"];
    const status = artifact.metadata["reservationStatus"];
    if (
      typeof submissionIdentity !== "string" ||
      (attempt !== 1 && attempt !== 2 && attempt !== 3) ||
      (status !== "in-progress" &&
        status !== "committed" &&
        status !== "aborted" &&
        status !== "stale" &&
        status !== "completed" &&
        status !== "failed")
    ) {
      continue;
    }
    if (artifactAdapter === "visual-attempt-reservation-v3") {
      const ownerToken = artifact.metadata["ownerToken"];
      const reservedAt = artifact.metadata["reservedAt"];
      const updatedAt = artifact.metadata["updatedAt"];
      if (
        typeof ownerToken !== "string" ||
        typeof reservedAt !== "string" ||
        typeof updatedAt !== "string"
      ) {
        continue;
      }
      const reportArtifactId = artifact.metadata["reportArtifactId"];
      const reportDigest = artifact.metadata["reportDigest"];
      reservations.push({
        submissionIdentity,
        attempt,
        status,
        ownerToken,
        reservedAt,
        updatedAt,
        ...(typeof reportArtifactId === "string" ? { reportArtifactId } : {}),
        ...(typeof reportDigest === "string" ? { reportDigest } : {}),
      });
      continue;
    }
    const report = reportsByIdentity.get(submissionIdentity);
    reservations.push({
      submissionIdentity,
      attempt,
      status,
      ownerToken: `legacy-v2:${submissionIdentity}:${String(attempt)}`,
      reservedAt: artifact.createdAt,
      updatedAt: artifact.createdAt,
      ...(status === "completed" && report !== undefined
        ? { reportArtifactId: report.id, reportDigest: report.digest }
        : {}),
    });
  }
  return reservations;
}

function hasInProgressVisualAttempt(
  run: RunManifest,
  packet: ImplementationReviewPacket,
  nowIso: string,
): boolean {
  return (
    reduceVisualReservations(visualAttemptReservations(run, visualLineageId(packet)), nowIso)
      .active !== undefined
  );
}

function visualSubmissionIdentity(
  reviewPacketId: string,
  captures: Array<{
    targetId: string;
    route: string;
    state: string;
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    fixture: string;
    provider: string;
    capturedAt: string;
    actualPath: string;
    actualDigest: string;
    assertionReportPath?: string | undefined;
    assertionReportDigest?: string | undefined;
    assertionResultPath?: string | undefined;
    assertionResultDigest?: string | undefined;
    assertionObservationPath?: string | undefined;
    assertionObservationDigest?: string | undefined;
    receiptPath?: string | undefined;
    receiptDigest?: string | undefined;
  }>,
): string {
  const canonical = captures
    .map((capture) => ({
      targetId: capture.targetId,
      route: capture.route,
      state: capture.state,
      viewport: {
        width: capture.viewport.width,
        height: capture.viewport.height,
      },
      deviceScaleFactor: capture.deviceScaleFactor,
      fixture: capture.fixture,
      provider: capture.provider,
      capturedAt: capture.capturedAt,
      actualPath: capture.actualPath,
      actualDigest: capture.actualDigest,
      ...(capture.assertionReportPath === undefined
        ? {}
        : { assertionReportPath: capture.assertionReportPath }),
      ...(capture.assertionReportDigest === undefined
        ? {}
        : { assertionReportDigest: capture.assertionReportDigest }),
      ...(capture.assertionResultPath === undefined
        ? {}
        : { assertionResultPath: capture.assertionResultPath }),
      ...(capture.assertionResultDigest === undefined
        ? {}
        : { assertionResultDigest: capture.assertionResultDigest }),
      ...(capture.assertionObservationPath === undefined
        ? {}
        : { assertionObservationPath: capture.assertionObservationPath }),
      ...(capture.assertionObservationDigest === undefined
        ? {}
        : { assertionObservationDigest: capture.assertionObservationDigest }),
      ...(capture.receiptPath === undefined ? {} : { receiptPath: capture.receiptPath }),
      ...(capture.receiptDigest === undefined ? {} : { receiptDigest: capture.receiptDigest }),
    }))
    .sort((left, right) => left.targetId.localeCompare(right.targetId));
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ reviewPacketId, captures: canonical }))
    .digest("hex")}`;
}

function assertCurrentVisualComparisonPassed(
  run: RunManifest,
  reviewPacketId: string,
  nowIso: string,
): void {
  const report = currentVisualReport(run, reviewPacketId);
  if (report?.metadata["visualStatus"] === "passed") return;
  const packet = reviewPacketFromRun(run);
  const attempts =
    packet?.id === reviewPacketId ? committedVisualComparisonAttemptCount(run, packet, nowIso) : 0;
  if (attempts >= MAX_VISUAL_REPAIR_ATTEMPTS) {
    throw new Error(
      `VISUAL_ATTEMPT_LIMIT_REACHED: design approval is blocked after ${MAX_VISUAL_REPAIR_ATTEMPTS} failed comparisons`,
    );
  }
  throw new Error("Design approval requires a passing current-packet visual comparison");
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
  const hasNoFailures =
    (result["numFailedTests"] === undefined || result["numFailedTests"] === 0) &&
    (result["numFailedTestSuites"] === undefined || result["numFailedTestSuites"] === 0);
  const hasExecutedTests =
    (typeof result["numPassedTests"] === "number" && result["numPassedTests"] > 0) ||
    (typeof result["numTotalTests"] === "number" && result["numTotalTests"] > 0);
  const frameworkReportPassed = result["success"] === true && hasNoFailures && hasExecutedTests;
  if (result["status"] !== "passed" && !frameworkReportPassed) {
    throw new Error(`Evidence must be a passing targeted test result: ${evidencePath}`);
  }
}

function assertDeterministicMockManifest(
  content: Buffer,
  evidencePath: string,
  expectedFixtures: Array<{
    fixturePath: string;
    id: string;
    digest: string;
    named: boolean;
    stateContractDigest?: string | undefined;
  }>,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error(`Mock data manifest must be strict JSON: ${evidencePath}`);
  }
  const result = z
    .object({
      deterministic: z.literal(true),
      fixtures: z
        .array(
          z
            .object({
              id: z
                .string()
                .trim()
                .min(1)
                .max(300)
                .regex(/^[a-z0-9][a-z0-9._:-]*$/i)
                .optional(),
              path: z.string().trim().min(1),
              sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
              stateContractDigest: z
                .string()
                .regex(/^sha256:[a-f0-9]{64}$/)
                .optional(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict()
    .safeParse(parsed);
  if (
    !result.success ||
    result.data.fixtures.length !== expectedFixtures.length ||
    new Set(result.data.fixtures.map((fixture) => fixture.path)).size !==
      result.data.fixtures.length ||
    new Set(result.data.fixtures.map((fixture) => fixture.id ?? fixture.path)).size !==
      result.data.fixtures.length ||
    expectedFixtures.some((expected) => {
      const received = result.data.fixtures.find(
        (fixture) => fixture.path === expected.fixturePath,
      );
      return (
        received === undefined ||
        received.sha256 !== expected.digest ||
        received.stateContractDigest !== expected.stateContractDigest ||
        (expected.named
          ? received.id !== expected.id
          : received.id !== undefined && received.id !== expected.id)
      );
    })
  ) {
    throw new Error(
      `Mock data manifest must bind deterministic=true to the exact fixture IDs, paths, and SHA-256 digests plus state-contract digests: ${evidencePath}`,
    );
  }
}

function normalizedMockFixtures(evidence: {
  fixturePaths?: string[] | undefined;
  fixtures?:
    Array<{ id: string; path: string; stateContractDigest?: string | undefined }> | undefined;
}): Array<{
  id: string;
  path: string;
  named: boolean;
  stateContractDigest?: string | undefined;
}> {
  if (evidence.fixtures !== undefined) {
    return evidence.fixtures.map((fixture) => ({ ...fixture, named: true }));
  }
  return (evidence.fixturePaths ?? []).map((fixturePath) => ({
    id: fixturePath,
    path: fixturePath,
    named: false,
  }));
}

function assertMockFixture(content: Buffer, evidencePath: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error(`Mock fixture must be strict JSON: ${evidencePath}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Mock fixture must contain a JSON object or array: ${evidencePath}`);
  }
}

function assertApiCoverageResult(
  content: Buffer,
  evidencePath: string,
  expected: Array<{ operationKey: string; mockHandlers: string[] }>,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error(`API coverage evidence must be passing structured JSON: ${evidencePath}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`API coverage evidence must be passing structured JSON: ${evidencePath}`);
  }
  const result = parsed as Record<string, unknown>;
  const operationKeys = result["operationKeys"];
  const mockHandlers = result["mockHandlers"];
  if (
    result["status"] !== "passed" ||
    !Array.isArray(operationKeys) ||
    !Array.isArray(mockHandlers) ||
    operationKeys.some((value) => typeof value !== "string") ||
    mockHandlers.some((value) => typeof value !== "string") ||
    expected.some(
      (operation) =>
        !operationKeys.includes(operation.operationKey) ||
        operation.mockHandlers.some((handler) => !mockHandlers.includes(handler)),
    )
  ) {
    throw new Error(
      `API coverage evidence must name every exercised operation and mock handler: ${evidencePath}`,
    );
  }
}

function assertPerformanceResult(
  content: Buffer,
  evidencePath: string,
  expectedMetrics: {
    lcpMs: number;
    cls: number;
    tbtMs?: number | undefined;
    interactionLatencyMs?: number | undefined;
  },
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error(`Performance evidence must be passing structured JSON: ${evidencePath}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Performance evidence must be passing structured JSON: ${evidencePath}`);
  }
  const result = parsed as Record<string, unknown>;
  if (
    result["status"] !== "passed" ||
    JSON.stringify(result["metrics"]) !== JSON.stringify(expectedMetrics)
  ) {
    throw new Error(
      `Performance result metrics must exactly match the declared lab evidence: ${evidencePath}`,
    );
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

async function assertFigmaDesignAssets(
  projectRoot: string,
  mapping: FigmaDesignMapping,
): Promise<void> {
  for (const component of mapping.components) {
    const asset =
      component.resolution.kind === "asset"
        ? component.resolution
        : component.resolution.kind === "exception"
          ? component.resolution.substitute
          : undefined;
    if (asset === undefined) continue;
    const requestedPath = path.resolve(projectRoot, asset.path);
    assertWithinProjectRoot(projectRoot, requestedPath, asset.path);
    let resolvedPath: string;
    try {
      resolvedPath = await realpath(requestedPath);
    } catch {
      throw new Error(
        `FIGMA_DESIGN_MAPPING_INCOMPLETE: canonical asset does not exist: ${asset.path}`,
      );
    }
    assertWithinProjectRoot(projectRoot, resolvedPath, asset.path);
    const digest = `sha256:${createHash("sha256")
      .update(await readFile(resolvedPath))
      .digest("hex")}`;
    if (digest !== asset.digest) {
      throw new Error(
        `FIGMA_DESIGN_MAPPING_INCOMPLETE: canonical asset digest does not match: ${asset.path}`,
      );
    }
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
  if (!parsed.success) {
    throw new Error(`Figma manifest provenance does not match its submission: ${evidencePath}`);
  }
  assertFigmaStateContracts({
    nodeIds: parsed.data.nodeIds,
    targets: parsed.data.visualTargets,
    stateContracts: parsed.data.stateContracts,
    mapping: parsed.data.designMapping,
  });
  const submittedFileUrls = submission.fileUrls ?? [submission.fileUrl];
  const catalogEvidencePaths = [
    submission.designMapping.publicApiCatalog.packageManifest.path,
    ...submission.designMapping.publicApiCatalog.publicBarrels.map((barrel) => barrel.path),
    ...submission.designMapping.publicApiCatalog.publicSources.map((source) => source.path),
    ...(submission.designMapping.publicApiCatalog.codeConnectManifest === undefined
      ? []
      : [submission.designMapping.publicApiCatalog.codeConnectManifest.path]),
  ];
  const expectedVisualPaths = submission.artifactPaths.filter(
    (artifactPath) =>
      artifactPath !== submission.manifestPath && !catalogEvidencePaths.includes(artifactPath),
  );
  if (
    parsed.data.provider !== submission.provider ||
    parsed.data.capturedAt !== submission.capturedAt ||
    parsed.data.fileUrl !== submission.fileUrl ||
    JSON.stringify(parsed.data.fileUrls) !== JSON.stringify(submittedFileUrls) ||
    !sameStringMembers(parsed.data.nodeIds, submission.nodeIds) ||
    JSON.stringify(parsed.data.capturedComponents) !==
      JSON.stringify(submission.capturedComponents) ||
    JSON.stringify(parsed.data.designMapping) !== JSON.stringify(submission.designMapping) ||
    JSON.stringify(parsed.data.stateContracts) !== JSON.stringify(submission.stateContracts) ||
    JSON.stringify(parsed.data.visualPaths) !== JSON.stringify(expectedVisualPaths) ||
    JSON.stringify(parsed.data.visualTargets.map(normalizeVisualTargetManifest)) !==
      JSON.stringify(submission.visualTargets)
  ) {
    throw new Error(`Figma manifest provenance does not match its submission: ${evidencePath}`);
  }
  assertCompleteDesignMapping({
    capturedComponents: parsed.data.capturedComponents,
    mapping: parsed.data.designMapping,
  });
}

async function assertPng(content: Buffer, evidencePath: string): Promise<void> {
  await decodeBoundedPng(content, evidencePath);
}

function assertCompatibilityBaselineGeometry(
  target: VisualTargetManifest,
  bitmapSize: { width: number; height: number },
): void {
  const expected = {
    width: Math.round(target.viewport.width * target.deviceScaleFactor),
    height: Math.round(target.viewport.height * target.deviceScaleFactor),
  };
  if (bitmapSize.width === expected.width && bitmapSize.height === expected.height) return;

  throw new Error(
    `VISUAL_BASELINE_GEOMETRY_INVALID: target ${target.targetId} legacy baseline is ${bitmapSize.width}x${bitmapSize.height}, expected ${expected.width}x${expected.height} for the declared viewport; full-page legacy baselines require a tiled capture plan before contract acceptance`,
  );
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

function submissionOutcome(
  submission: Exclude<StandardWorkflowSubmission, { kind: "figma-bundle" | "visual-comparison" }>,
) {
  if ("verdict" in submission) {
    return submission.verdict === "approved"
      ? "passed"
      : submission.verdict === "blocked"
        ? "blocked"
        : "failed";
  }
  return submission.status;
}

function producerForSubmission(submission: StandardWorkflowSubmission) {
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
  origin: "file" | "url";
  rawContent: Buffer;
  text: string;
  chunks: string[];
  mediaType: string;
  rawDigest: string;
};

type PreparedComposableSources = {
  brief?: ProjectTextSource;
  legacyNetwork?: ProjectTextSource;
  docs: ProjectTextSource[];
  openApi: ProjectTextSource[];
  guidance: ProjectTextSource[];
  discoveredGuidance: ProjectTextSource[];
  skillHints: string[];
};

function resolveWorkflowDeliveryMode(
  input: z.infer<typeof WorkflowStartInputSchema>,
): z.infer<typeof DeliveryModeSchema> {
  if (input.mode !== "auto") return input.mode;
  if (input.legacyProjectRoot !== undefined) return "legacy";
  if (input.briefPath !== undefined) return "brief";
  if (input.figmaUrl !== undefined || input.figmaUrls.length > 0) return "figma";
  return "auto";
}

type ReportSectionApplicability = Readonly<
  Record<
    | "api"
    | "legacy"
    | "visual"
    | "functional-review"
    | "design-review"
    | "performance"
    | "feature-evidence",
    boolean
  >
>;

function reportSectionApplicabilityForRun(
  run: RunManifest,
  profile: DeliveryProfile,
): ReportSectionApplicability {
  const scope = scopeFromRun(run);
  const policy = deliveryPolicyForRun(run, scope, profile);
  const visualApplicable =
    scope.ui || profile.requirements.visualComparison || visualTargetsFromRun(run).length > 0;
  if (policy !== undefined) {
    return {
      ...policy.sectionApplicability,
      visual: policy.sectionApplicability.visual || visualApplicable,
    };
  }
  return {
    api: profile.requirements.apiCoverage || scope.api,
    legacy: profile.requirements.legacyInventory,
    visual: visualApplicable,
    "functional-review": true,
    "design-review": scope.ui,
    performance: profile.requirements.performanceEvidence,
    "feature-evidence": profile.requirements.targetedFeatureE2E,
  };
}

function readyReportSectionStatuses(applicability: ReportSectionApplicability) {
  return PrReportSectionStatusesSchema.parse(
    Object.fromEntries(
      Object.entries(applicability).map(([section, applicable]) => [
        section,
        applicable ? "complete" : "not-applicable",
      ]),
    ),
  );
}

function blockedReportSectionStatuses(input: {
  run: RunManifest;
  profile: DeliveryProfile;
  sectionApplicability: ReportSectionApplicability;
  blocker: WorkflowBlocker;
  implementation: Extract<WorkflowSubmission, { kind: "implementation" }> | undefined;
  visualArtifact: ArtifactRef | undefined;
  packetCurrent: boolean;
}) {
  const statusFromStage = (
    section: keyof ReportSectionApplicability,
    stageName: RunStageName,
  ): PrReportSectionStatus => {
    if (!input.sectionApplicability[section]) return "not-applicable";
    const stageStatus = stage(input.run, stageName).status;
    if (stageStatus === "passed") return "complete";
    if (stageStatus === "failed" || stageStatus === "blocked") return "blocked";
    return "not-run";
  };
  const implementationStatus = (
    section: keyof ReportSectionApplicability,
    complete: boolean,
  ): PrReportSectionStatus => {
    if (!input.sectionApplicability[section]) return "not-applicable";
    if (complete) return "complete";
    return statusFromStage(section, "implementation");
  };
  const visualStatus: PrReportSectionStatus = !input.sectionApplicability.visual
    ? "not-applicable"
    : input.visualArtifact?.metadata["visualStatus"] === "passed"
      ? "complete"
      : input.visualArtifact === undefined
        ? "not-run"
        : "blocked";
  const unresolvedLegacyApi = input.run.gaps.some(
    (gap) => gap.category === "api" && gap.status === "open",
  );
  const apiComplete =
    (input.profile.mode === "legacy" &&
      input.profile.openApiOperations.length === 0 &&
      !unresolvedLegacyApi) ||
    input.implementation?.status === "passed";

  return PrReportSectionStatusesSchema.parse({
    api:
      input.blocker.code === "LEGACY_API_METHOD_UNKNOWN"
        ? "blocked"
        : implementationStatus("api", apiComplete),
    legacy: implementationStatus("legacy", input.implementation?.status === "passed"),
    visual: visualStatus,
    "functional-review": input.packetCurrent
      ? statusFromStage("functional-review", "functional-review")
      : input.sectionApplicability["functional-review"]
        ? "not-run"
        : "not-applicable",
    "design-review": input.packetCurrent
      ? statusFromStage("design-review", "design-review")
      : input.sectionApplicability["design-review"]
        ? "not-run"
        : "not-applicable",
    performance: implementationStatus(
      "performance",
      input.implementation?.performanceEvidence !== undefined,
    ),
    "feature-evidence": implementationStatus(
      "feature-evidence",
      input.implementation?.featureEvidence !== undefined,
    ),
  });
}

function legacyRootDigestFromRun(run: RunManifest): string | undefined {
  const digest = [...run.artifacts]
    .reverse()
    .find((artifact) => artifact.kind === "legacy-feature-inventory")?.metadata["rootDigest"];
  return typeof digest === "string" && /^sha256:[a-f0-9]{64}$/.test(digest) ? digest : undefined;
}

function legacyApiDiscoveryAdaptersFromRun(run: RunManifest): string[] {
  const value = [...run.artifacts]
    .reverse()
    .find((artifact) => artifact.kind === "legacy-feature-inventory")?.metadata[
    "apiDiscoveryAdapters"
  ];
  return Array.isArray(value)
    ? value.filter(
        (adapter): adapter is string =>
          typeof adapter === "string" && adapter.length > 0 && adapter.length <= 100,
      )
    : [];
}

function sourceProvenanceForPreparedSources(
  sources: PreparedComposableSources,
  capturedAt: string,
) {
  const row = (
    kind: "brief" | "docs" | "openapi" | "guidance" | "legacy-network",
    source: ProjectTextSource,
  ) => ({
    kind,
    locator: source.path,
    resolvedLocator: source.origin === "url" ? source.resolvedPath : source.path,
    digest: source.rawDigest,
    capturedAt,
  });
  return [
    ...(sources.brief === undefined ? [] : [row("brief", sources.brief)]),
    ...(sources.legacyNetwork === undefined ? [] : [row("legacy-network", sources.legacyNetwork)]),
    ...sources.docs.map((source) => row("docs", source)),
    ...sources.openApi.map((source) => row("openapi", source)),
    ...sources.guidance.map((source) => row("guidance", source)),
    ...sources.discoveredGuidance.map((source) => row("guidance", source)),
  ];
}

type UnresolvedLegacyApiCandidate = Pick<
  LegacyInventory["entries"][number],
  "normalizedKey" | "sourcePath" | "symbol" | "apiAdapter" | "evidenceConfidence"
>;

function deriveLegacyApiOperations(
  inventory: LegacyInventory,
  openApi: DeliveryProfile["openApiOperations"],
): {
  operations: DeliveryProfile["openApiOperations"];
  unresolved: UnresolvedLegacyApiCandidate[];
} {
  const semantic = resolveLegacyApiCandidates({
    candidates: inventory.apiCandidates,
    openApiOperations: openApi.map((operation) => ({
      method: operation.method,
      path: operation.path,
      sourceLocator: operation.sourceLocator,
      ...(operation.operationId === undefined ? {} : { operationId: operation.operationId }),
      ...(operation.serverOrigins === undefined ? {} : { serverOrigins: operation.serverOrigins }),
    })),
    runtimeRequests: inventory.apiCandidates.flatMap((candidate) =>
      candidate.method !== "UNKNOWN" &&
      candidate.pathTemplate !== undefined &&
      candidate.witnesses.some((witness) => witness.kind === "runtime")
        ? [
            {
              method: candidate.method,
              path: candidate.pathTemplate,
              ...(candidate.originRef?.kind === "runtime-origin"
                ? { origin: candidate.originRef.sanitizedOrigin }
                : {}),
              callSiteKeys: candidate.callSites.map((callSite) => callSite.callSiteKey),
            },
          ]
        : [],
    ),
  });
  const operations = mergeResolvedLegacyApiOperations(semantic.operations);
  const unresolved: UnresolvedLegacyApiCandidate[] = semantic.unresolved.map((candidate) => ({
    normalizedKey: candidate.operationKey,
    sourcePath: candidate.callSites[0]!.ownerSourcePath,
    symbol: candidate.operationKey,
    apiAdapter: "source-semantic-ast",
    evidenceConfidence: candidate.confidence,
  }));
  const semanticOperationKeys = new Set(
    inventory.apiCandidates.map((candidate) => candidate.operationKey),
  );
  const observed = inventory.entries.flatMap((entry) => {
    if (entry.category !== "api") return [];
    const match = /^(GET|PUT|POST|DELETE|OPTIONS|HEAD|PATCH|TRACE)\s+(.+)$/u.exec(
      entry.normalizedKey,
    );
    if (match === null || !match[2]!.startsWith("/")) return [];
    return [{ method: match[1]!, path: match[2]!.split(/[?#]/u, 1)[0]! }];
  });
  for (const entry of inventory.entries) {
    if (entry.category !== "api") continue;
    if (semanticOperationKeys.has(entry.normalizedKey)) continue;
    const match = /^([A-Za-z]+)\s+(.+)$/u.exec(entry.normalizedKey);
    if (match === null) {
      unresolved.push(entry);
      continue;
    }
    const rawMethod = match[1]!.toUpperCase();
    let locator = match[2]!;
    if (/^\/\//u.test(locator)) {
      try {
        locator = new URL(`https:${locator}`).pathname;
      } catch {
        unresolved.push(entry);
        continue;
      }
    } else if (/^https?:\/\//i.test(locator)) {
      try {
        locator = new URL(locator).pathname;
      } catch {
        unresolved.push(entry);
        continue;
      }
    }
    locator = locator.split(/[?#]/u, 1)[0]!;
    const enriched = uniqueOperationMatches([
      ...matchingOpenApiOperations(openApi, locator, rawMethod).map((operation) => ({
        method: operation.method,
        path: operation.path,
      })),
      ...observed.filter(
        (operation) =>
          locator.startsWith("/") &&
          operation.path === locator &&
          (rawMethod === "UNKNOWN" || operation.method === rawMethod),
      ),
    ]);
    if (rawMethod === "UNKNOWN" || !locator.startsWith("/")) {
      if (enriched.length !== 1) unresolved.push(entry);
      continue;
    }
    if (!/^(?:GET|PUT|POST|DELETE|OPTIONS|HEAD|PATCH|TRACE)$/u.test(rawMethod)) {
      unresolved.push(entry);
      continue;
    }
    const method = rawMethod as DeliveryProfile["openApiOperations"][number]["method"];
    operations.push({
      operationKey: `${method} ${locator}`,
      method,
      path: locator,
      sourceLocator: `external-legacy-project/${entry.sourcePath}`,
    });
  }
  return { operations, unresolved };
}

function mergeResolvedLegacyApiOperations(
  resolved: ResolvedLegacyApiOperation[],
): DeliveryProfile["openApiOperations"] {
  const operations = new Map<string, DeliveryProfile["openApiOperations"][number]>();
  for (const operation of resolved) {
    const origins = boundedServerOrigins(
      operation.serverOrigins ?? [],
      legacyOperationServerOrigins(operation),
    );
    const existing = operations.get(operation.operationKey);
    if (existing === undefined) {
      operations.set(operation.operationKey, {
        operationKey: operation.operationKey,
        method: operation.method,
        path: operation.path,
        sourceLocator: operation.sourceLocator,
        ...(operation.operationId === undefined ? {} : { operationId: operation.operationId }),
        ...(origins.length === 0 ? {} : { serverOrigins: origins }),
      });
      continue;
    }
    const serverOrigins = boundedServerOrigins(existing.serverOrigins ?? [], origins);
    operations.set(operation.operationKey, {
      ...existing,
      ...(serverOrigins.length === 0 ? {} : { serverOrigins }),
    });
  }
  return [...operations.values()];
}

function legacyOpenApiEvidenceFromRun(
  run: RunManifest,
  profile: DeliveryProfile,
): DeliveryProfile["openApiOperations"] {
  const parsed = z
    .array(OpenApiOperationContractSchema)
    .max(1_000)
    .safeParse(stage(run, "intake").checkpoint?.data["legacyOpenApiEvidence"]);
  if (parsed.success) return parsed.data;
  return profile.openApiOperations.filter(
    (operation) =>
      operation.sourceLocator !== "legacy-runtime-network" &&
      !operation.sourceLocator.startsWith("external-legacy-project/"),
  );
}

function legacyOperationServerOrigins(operation: ResolvedLegacyApiOperation): string[] {
  const origin = operation.originRef;
  if (origin === undefined || origin.kind === "openapi-server") return [];
  if (origin.kind !== "environment") return [origin.sanitizedOrigin];
  return [
    ...(origin.sanitizedOrigin === undefined ? [] : [origin.sanitizedOrigin]),
    ...(origin.sanitizedOrigins ?? []).map((item) => item.origin),
  ];
}

function uniqueOperationMatches(
  operations: Array<{ method: string; path: string }>,
): Array<{ method: string; path: string }> {
  return [
    ...new Map(
      operations.map((operation) => [`${operation.method} ${operation.path}`, operation]),
    ).values(),
  ];
}

function matchingOpenApiOperations(
  openApi: DeliveryProfile["openApiOperations"],
  locator: string,
  method: string,
): DeliveryProfile["openApiOperations"] {
  if (locator.startsWith("operation:")) {
    const operationId = locator.slice("operation:".length);
    return openApi.filter(
      (operation) =>
        operation.operationId === operationId &&
        (method === "UNKNOWN" || operation.method === method),
    );
  }
  if (!locator.startsWith("/")) return [];
  return openApi.filter(
    (operation) =>
      operation.path === locator && (method === "UNKNOWN" || operation.method === method),
  );
}

function mergeDeliveryApiOperations(
  openApi: DeliveryProfile["openApiOperations"],
  legacy: DeliveryProfile["openApiOperations"],
): DeliveryProfile["openApiOperations"] {
  const merged = new Map(openApi.map((operation) => [operation.operationKey, operation]));
  for (const operation of legacy) {
    const existing = merged.get(operation.operationKey);
    if (existing === undefined) {
      merged.set(operation.operationKey, operation);
      continue;
    }
    const serverOrigins = boundedServerOrigins(
      existing.serverOrigins ?? [],
      operation.serverOrigins ?? [],
    );
    merged.set(operation.operationKey, {
      ...existing,
      ...(serverOrigins.length === 0 ? {} : { serverOrigins }),
    });
  }
  if (merged.size > 1_000) throw new Error("Combined API operation inventory exceeds 1000");
  return [...merged.values()];
}

function boundedServerOrigins(...groups: readonly (readonly string[])[]): string[] {
  return [...new Set(groups.flat())].sort().slice(0, 20);
}

function prTemplateForMode(mode: DeliveryProfile["mode"]): PrReportV2["template"] {
  if (mode === "legacy") return "legacy-migration";
  if (mode === "brief") return "brief-delivery";
  if (mode === "feature") return "feature-flow";
  if (mode === "figma") return "figma-ui";
  // `auto` is retained only to render historical 0.x Runs. New 1.0 starts
  // resolve an explicit mode; this neutral delivery template keeps old Drafts
  // reviewer-first without incorrectly presenting them as Figma work.
  return "brief-delivery";
}

function reportTemplateForMode(mode: DeliveryProfile["mode"]): Pick<PrReportV2, "template"> {
  const template = prTemplateForMode(mode);
  return { template };
}

function reportGapDetailsForRun(
  run: RunManifest,
  apiCoverage: ReadonlyArray<{
    operationKey: string;
    status: string;
    notes?: string | undefined;
  }>,
  supplemental: {
    visual?: { title: string; impact: string; reviewerDecision: string };
    featureVideo?: { title: string; impact: string; reviewerDecision: string };
  } = {},
): NonNullable<PrReportV2["gapDetails"]> {
  const durable = run.gaps
    .filter((gap) => gap.status !== "resolved")
    .map((gap) => ({
      id: gap.id,
      category: gap.category,
      severity: gap.severity,
      status: gap.status,
      title: gap.title,
      impact: gap.impact,
      reviewerDecision: gap.reviewerDecision,
    }));
  const titles = new Set(durable.map((gap) => gap.title));
  const api = apiCoverage
    .filter((operation) => operation.status === "gap")
    .map((operation) => ({
      category: "api",
      severity: "major",
      status: "open",
      title: `${operation.operationKey}: ${operation.notes ?? "API contract is unresolved"}`,
      impact: "The affected API behavior is not asserted as complete and must not be invented.",
      reviewerDecision: "Confirm the contract or keep this interaction disabled before merge.",
    }))
    .filter((gap) => !titles.has(gap.title));
  const extra = [
    ...(supplemental.visual === undefined
      ? []
      : [
          {
            category: "visual",
            severity: "blocker",
            status: "open",
            ...supplemental.visual,
          },
        ]),
    ...(supplemental.featureVideo === undefined
      ? []
      : [
          {
            category: "user-flow",
            severity: "blocker",
            status: "open",
            ...supplemental.featureVideo,
          },
        ]),
  ].filter((gap) => !titles.has(gap.title));
  return [...durable, ...api, ...extra];
}

function exclusionsForProfile(profile: DeliveryProfile): string[] {
  if (profile.mode === "feature") {
    return ["The full-project E2E suite is excluded; only the declared feature selector is run."];
  }
  if (profile.mode === "figma") {
    return [
      "Real API integration is excluded; deterministic mock data is used.",
      "Performance and feature-video evidence are not applicable.",
    ];
  }
  if (profile.mode === "legacy") {
    return ["Figma is not the visual baseline; the running legacy project is authoritative."];
  }
  if (profile.mode === "brief") {
    return ["Full-project E2E video capture is not part of full-delivery brief mode."];
  }
  return ["Mode-specific evidence not activated by intake is excluded."];
}

async function canonicalLegacyDirectory(input: {
  projectRoot: string;
  legacyProjectRoot?: string;
  required: boolean;
}): Promise<string | undefined> {
  if (input.legacyProjectRoot === undefined) {
    if (input.required) throw new Error("legacy mode requires legacyProjectRoot");
    return undefined;
  }

  let legacyRoot: string;
  try {
    // `legacyProjectRoot` is part of the workflow input contract, so a
    // relative value must be anchored to the target project—not the MCP
    // server's own working directory. The latter varies between Codex hosts
    // and made valid sibling legacy roots fail before a Run could be created.
    const requestedLegacyRoot = path.isAbsolute(input.legacyProjectRoot)
      ? input.legacyProjectRoot
      : path.resolve(input.projectRoot, input.legacyProjectRoot);
    legacyRoot = await realpath(requestedLegacyRoot);
  } catch {
    throw new Error("Legacy project path does not exist: " + input.legacyProjectRoot);
  }
  const details = await stat(legacyRoot);
  if (!details.isDirectory()) {
    throw new Error("Legacy project path must reference a directory: " + input.legacyProjectRoot);
  }

  const targetRoot = await realpath(input.projectRoot);
  if (directoriesOverlap(legacyRoot, targetRoot)) {
    throw new Error(
      "Legacy project and target project must be different, separate, non-overlapping directories",
    );
  }
  return legacyRoot;
}

async function prepareComposableSources(
  input: z.infer<typeof WorkflowStartInputSchema>,
  fetchOpenApiSource: (input: { url: string }) => Promise<RemoteOpenApiSource>,
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
  const openApiUrlInput = uniqueInputUrls([
    ...(input.openApiUrl === undefined ? [] : [input.openApiUrl]),
    ...input.openApiUrls,
  ]);
  const guidanceInput = uniqueInputValues(input.guidancePaths);
  const skillHints = uniqueInputValues(input.skillHints);
  const brief =
    input.briefPath === undefined
      ? undefined
      : await readProjectTextFile(root, input.briefPath, "Brief");
  const legacyNetwork =
    input.legacyNetworkEvidencePath === undefined
      ? undefined
      : await readProjectTextFile(
          root,
          input.legacyNetworkEvidencePath,
          "Legacy runtime network evidence",
        );
  const docs = await readDistinctProjectTextFiles(root, docsInput, "Supporting document");
  const openApiFiles = await readDistinctProjectTextFiles(root, openApiInput, "OpenAPI");
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
  if (legacyNetwork !== undefined) claim(legacyNetwork, "legacy runtime network evidence");
  docs.forEach((file) => claim(file, "supporting documentation"));
  openApiFiles.forEach((file) => claim(file, "OpenAPI"));
  guidance.forEach((file) => claim(file, "explicit guidance"));

  const occupiedInputPaths = new Set(
    [
      input.briefPath,
      input.legacyNetworkEvidencePath,
      ...docsInput,
      ...openApiInput,
      ...guidanceInput,
    ]
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

  const localFiles = [
    ...(brief === undefined ? [] : [brief]),
    ...(legacyNetwork === undefined ? [] : [legacyNetwork]),
    ...docs,
    ...openApiFiles,
    ...guidance,
    ...discoveredGuidance,
  ];
  const loadTasks = [
    ...localFiles.map((file) => ({ kind: "file" as const, file })),
    ...openApiUrlInput.map((url) => ({ kind: "url" as const, url })),
  ];
  const loadedSources = await orderedConcurrentMap(loadTasks, 4, async (task) => {
    if (task.kind === "url") {
      const remote = await fetchOpenApiSource({ url: task.url });
      const rawContent = Buffer.from(remote.text, "utf8");
      return {
        origin: "url",
        path: remote.originalUrl,
        resolvedPath: remote.resolvedUrl,
        rawContent,
        text: remote.text,
        chunks: buildParserSafeChunks(remote.text),
        mediaType: remote.mediaType,
        rawDigest: remote.sha256,
      } satisfies ProjectTextSource;
    }
    const rawContent = await readFile(task.file.resolvedPath);
    const pdf =
      path.extname(task.file.path).toLowerCase() === ".pdf"
        ? await extractPdfText(rawContent)
        : undefined;
    const text = pdf?.text ?? rawContent.toString("utf8");
    return {
      ...task.file,
      origin: "file",
      rawContent,
      text,
      chunks: buildParserSafeChunks(text),
      mediaType: pdf?.mediaType ?? mediaTypeForPath(task.file.path),
      rawDigest:
        pdf?.sha256 ?? (`sha256:${createHash("sha256").update(rawContent).digest("hex")}` as const),
    } satisfies ProjectTextSource;
  });
  const localByResolvedPath = new Map(
    loadedSources
      .filter((source) => source.origin === "file")
      .map((source) => [source.resolvedPath, source]),
  );
  const loadedLocal = (file: ProjectTextFile): ProjectTextSource => {
    const source = localByResolvedPath.get(file.resolvedPath);
    if (source === undefined) throw new Error(`Prepared source was not loaded: ${file.path}`);
    return source;
  };
  const remoteOpenApi = loadedSources.filter((source) => source.origin === "url");

  return {
    ...(brief === undefined ? {} : { brief: loadedLocal(brief) }),
    ...(legacyNetwork === undefined ? {} : { legacyNetwork: loadedLocal(legacyNetwork) }),
    docs: docs.map(loadedLocal),
    openApi: [...openApiFiles.map(loadedLocal), ...remoteOpenApi],
    guidance: guidance.map(loadedLocal),
    discoveredGuidance: discoveredGuidance.map(loadedLocal),
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

function projectTextSourceIntakeRequests(input: {
  kind: "brief" | "docs" | "openapi" | "guidance";
  file: ProjectTextSource;
}): Array<{ requestText: string; label: string }> {
  const requests: Array<{ requestText: string; label: string }> = [];
  for (let index = 0; index < input.file.chunks.length; index += 1) {
    requests.push({
      requestText: input.file.chunks[index]!,
      label: intakeSourceLabel(input.kind, input.file.path, index, input.file.chunks.length),
    });
  }
  return requests;
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

function uniqueInputValues(values: readonly string[]): string[] {
  const unique = new Map<string, string>();
  values.forEach((value) => {
    const key = normalizedInputPathKey(value);
    if (!unique.has(key)) unique.set(key, value);
  });
  return [...unique.values()];
}

function uniqueInputUrls(values: readonly string[]): string[] {
  const unique = new Map<string, string>();
  values.forEach((value) => {
    const canonical = new URL(value.trim()).toString();
    if (!unique.has(canonical)) unique.set(canonical, canonical);
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

async function createImplementationReviewPacket(
  run: RunManifest,
  snapshot: GitSnapshot,
  evidenceArtifacts: ArtifactRef[],
  artifactStore: ArtifactBlobStore,
  snapshotArtifact: ArtifactRef | undefined,
  evidenceIndex: PacketEvidenceEntry[],
  evidenceFingerprints: EvidenceFingerprintV1[],
): Promise<ImplementationReviewPacket> {
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
    ...(snapshotArtifact === undefined
      ? {}
      : {
          snapshotArtifactId: snapshotArtifact.id,
          snapshotDigest: snapshotArtifact.digest,
        }),
    evidenceIndex,
    ...(evidenceFingerprints.length === 0 ? {} : { evidenceFingerprints }),
  };
  const id = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  const packetId = `packet_${id}`;
  const lineage = createVisualLineage(
    previous === undefined
      ? undefined
      : await activeVisualRepairCheckpoint(run, previous, artifactStore),
    { id: packetId },
  );
  return ImplementationReviewPacketSchema.parse({
    id: packetId,
    ...identity,
    visualLineageId: lineage.lineageId,
  });
}

async function activeVisualRepairCheckpoint(
  run: RunManifest,
  previousPacket: ImplementationReviewPacket,
  artifactStore: ArtifactBlobStore,
) {
  const lineageId = visualLineageId(previousPacket);
  const latest = await latestVisualLineageRecord(run, lineageId, artifactStore);
  if (
    latest === undefined ||
    latest.outcome.status !== "repair-required" ||
    latest.outcome.sourcePacketId !== previousPacket.id
  ) {
    return undefined;
  }
  return {
    lineageId,
    attempts: latest.outcome.attempt,
    repairRequired: true as const,
    sourcePacketId: previousPacket.id,
  };
}

function buildImplementationEvidenceIndex(
  submission: Extract<WorkflowSubmission, { kind: "implementation" }>,
  evidenceArtifacts: ArtifactRef[],
  snapshot: GitSnapshot,
): PacketEvidenceEntry[] {
  const featureEvidence = submission.featureEvidence;
  if (featureEvidence === undefined) return [];
  const resultArtifact = evidenceArtifacts.find(
    (artifact) => artifact.metadata["projectRelativePath"] === featureEvidence.resultPath,
  );
  if (resultArtifact === undefined) return [];
  const adapter = resultArtifact.metadata["adapter"];
  const evidenceFingerprint = submission.evidenceFingerprints.find(
    (fingerprint) => fingerprint.family === "feature-e2e",
  );
  return PacketEvidenceIndexSchema.parse([
    {
      command: featureEvidence.testCommand,
      selector: featureEvidence.testSelector,
      resultDigest: resultArtifact.digest,
      artifactId: resultArtifact.id,
      headSha: snapshot.headSha,
      diffDigest: snapshot.diffDigest,
      adapterVersion: typeof adapter === "string" ? adapter : "workflow-v2-evidence",
      ...(evidenceFingerprint === undefined ? {} : { evidenceFingerprint }),
    },
  ]);
}

type GitSnapshot = {
  headSha: string;
  diffDigest: `sha256:${string}`;
  changedFiles: string[];
  implementationSnapshot?: ImplementationSnapshot;
};

export async function captureGitSnapshot(
  run: RunManifest,
  metrics: RuntimeMetricsSink = new NoopRuntimeMetrics(),
  capturedAt = new Date().toISOString(),
  options: { allowedUntrackedPaths?: readonly string[] } = {},
): Promise<GitSnapshot> {
  const baseCommit = run.workspaceBinding?.baseSha ?? run.baseCommit;
  const projectRoot = run.workspaceBinding?.repositoryRoot ?? run.projectRoot;
  if (baseCommit === undefined) {
    throw new Error("Implementation review packets require a Git base commit");
  }
  const headSha = await currentGitHead(projectRoot, metrics);
  if (headSha === null)
    throw new Error("Implementation review packets require a readable Git HEAD");
  try {
    const allowedUntrackedPaths = normalizedUntrackedPaths(options.allowedUntrackedPaths);
    const strictBinding = bindingWithLegacyDraftEvidenceRoots(run);
    if (strictBinding !== undefined) {
      metrics.increment("git.command_count", 2);
      const [{ stdout: checkedOutBranch }, { stdout: trackedStatus }] = await Promise.all([
        execFileAsync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
          cwd: projectRoot,
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
          timeout: GIT_COMMAND_TIMEOUT_MS,
          killSignal: "SIGTERM",
        }),
        execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
          cwd: projectRoot,
          encoding: "utf8",
          maxBuffer: 5 * 1024 * 1024,
          timeout: GIT_COMMAND_TIMEOUT_MS,
          killSignal: "SIGTERM",
        }),
      ]);
      if (checkedOutBranch.trim() !== strictBinding.sourceBranch) {
        throw new Error(
          `WORKSPACE_BRANCH_MISMATCH: expected ${strictBinding.sourceBranch}, found ${checkedOutBranch.trim() || "detached HEAD"}`,
        );
      }
      if (!isCleanExceptAllowedUntracked(trackedStatus, allowedUntrackedPaths)) {
        throw new Error(
          "WORKSPACE_ROOT_MISMATCH: strict implementation snapshots require committed source changes",
        );
      }
    }
    const diffRange = strictBinding === undefined ? [baseCommit] : [baseCommit, headSha];
    metrics.increment("git.command_count", strictBinding === undefined ? 3 : 2);
    const [{ stdout: diff }, { stdout: trackedNames }, untrackedResult] = await Promise.all([
      execFileAsync("git", ["diff", "--binary", ...diffRange, "--"], {
        cwd: projectRoot,
        encoding: "buffer",
        maxBuffer: 50 * 1024 * 1024,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        killSignal: "SIGTERM",
      }),
      execFileAsync("git", ["diff", "--name-only", "-z", ...diffRange, "--"], {
        cwd: projectRoot,
        encoding: "buffer",
        maxBuffer: 5 * 1024 * 1024,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        killSignal: "SIGTERM",
      }),
      strictBinding === undefined
        ? execFileAsync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
            cwd: projectRoot,
            encoding: "buffer",
            maxBuffer: 5 * 1024 * 1024,
            timeout: GIT_COMMAND_TIMEOUT_MS,
            killSignal: "SIGTERM",
          })
        : Promise.resolve({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }),
    ]);
    const untrackedNames = untrackedResult.stdout;
    const binaryDiffBytes = Buffer.isBuffer(diff) ? diff.byteLength : Buffer.byteLength(diff);
    metrics.increment("git.binary_diff_bytes", binaryDiffBytes);
    const tracked = splitNullPaths(trackedNames);
    const untracked = splitNullPaths(untrackedNames).filter(
      (relativePath) => !allowedUntrackedPaths.has(relativePath),
    );
    const changedFiles = [...new Set([...tracked, ...untracked])].sort();
    assertChangedFilesWithinWorkspace(changedFiles, strictBinding);
    const digest = createHash("sha256").update(Buffer.isBuffer(diff) ? diff : Buffer.from(diff));
    const root = await realpath(projectRoot);
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
    const result: GitSnapshot = {
      headSha,
      diffDigest: `sha256:${digest.digest("hex")}`,
      changedFiles,
    };
    if (strictBinding !== undefined) {
      result.implementationSnapshot = ImplementationSnapshotSchema.parse({
        schemaVersion: "implementation-snapshot-v1",
        repositoryKey: implementationRepositoryKey(root),
        baseSha: baseCommit,
        headSha,
        sourceBranch: strictBinding.sourceBranch,
        clean: true,
        changedFiles,
        diffDigest: result.diffDigest,
        binaryDiffBytes,
        capturedAt,
      });
    }
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to capture the implementation Git diff: ${message}`);
  }
}

/**
 * Versions before the fast legacy path required durable evidence below `.spec-to-pr`
 * and `openspec`. Keep those already-started Runs viable without relaxing their
 * product-code scope.
 */
function bindingWithLegacyDraftEvidenceRoots(run: RunManifest) {
  const binding = run.workspaceBinding;
  if (binding === undefined) return undefined;

  const rawProfile = DeliveryProfileSchema.safeParse(
    stage(run, "intake").checkpoint?.data["deliveryProfile"],
  );
  if (
    !rawProfile.success ||
    rawProfile.data.mode !== "legacy" ||
    rawProfile.data.publication !== "draft" ||
    rawProfile.data.draftEvidenceBundle === undefined
  ) {
    return binding;
  }

  return {
    ...binding,
    supportingPaths: [...new Set([...binding.supportingPaths, ".spec-to-pr", "openspec"])],
  };
}

/**
 * Capture-session manifests are themselves evidence outputs. Excluding only the session's
 * declared generated outputs avoids a self-referential candidate digest while retaining a
 * complete implementation-source freshness fence.
 */
async function captureCandidateDiffDigest(input: {
  run: RunManifest;
  headSha: string;
  excludedEvidencePaths: string[];
  metrics: RuntimeMetricsSink;
}): Promise<`sha256:${string}`> {
  const baseCommit = input.run.workspaceBinding?.baseSha ?? input.run.baseCommit;
  const projectRoot = input.run.workspaceBinding?.repositoryRoot ?? input.run.projectRoot;
  if (baseCommit === undefined) {
    throw new Error("CAPTURE_SESSION_INVALID: implementation base commit is missing");
  }
  const excluded = [...new Set(input.excludedEvidencePaths)].sort();
  if (excluded.some((evidencePath) => !isSafeDurableEvidencePath(evidencePath))) {
    throw new Error("CAPTURE_SESSION_INVALID: capture-session output path is unsafe");
  }
  const strict = input.run.workspaceBinding !== undefined;
  const diffRange = strict ? [baseCommit, input.headSha] : [baseCommit];
  const pathspec = [".", ...excluded.map((evidencePath) => `:(exclude)${evidencePath}`)];
  try {
    input.metrics.increment("git.command_count", strict ? 1 : 2);
    const [diffResult, untrackedResult] = await Promise.all([
      execFileAsync("git", ["diff", "--binary", ...diffRange, "--", ...pathspec], {
        cwd: projectRoot,
        encoding: "buffer",
        maxBuffer: 50 * 1024 * 1024,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        killSignal: "SIGTERM",
      }),
      strict
        ? Promise.resolve({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })
        : execFileAsync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
            cwd: projectRoot,
            encoding: "buffer",
            maxBuffer: 5 * 1024 * 1024,
            timeout: GIT_COMMAND_TIMEOUT_MS,
            killSignal: "SIGTERM",
          }),
    ]);
    const diff = diffResult.stdout;
    const digest = createHash("sha256").update(Buffer.isBuffer(diff) ? diff : Buffer.from(diff));
    const root = await realpath(projectRoot);
    for (const relativePath of splitNullPaths(untrackedResult.stdout).sort()) {
      if (excluded.includes(relativePath)) continue;
      const requestedPath = path.resolve(root, relativePath);
      assertWithinProjectRoot(root, requestedPath, relativePath);
      const resolvedPath = await realpath(requestedPath);
      assertWithinProjectRoot(root, resolvedPath, relativePath);
      const details = await stat(resolvedPath);
      if (!details.isFile() || details.size > 50 * 1024 * 1024) {
        throw new Error(
          `CAPTURE_SESSION_INVALID: untracked candidate file is invalid: ${relativePath}`,
        );
      }
      digest.update(`\0untracked:${relativePath}\0`).update(await readFile(resolvedPath));
    }
    return `sha256:${digest.digest("hex")}`;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`CAPTURE_SESSION_INVALID: unable to capture candidate diff: ${message}`);
  }
}

async function assertReviewPacketFresh(
  run: RunManifest,
  artifactStore: ArtifactBlobStore,
  metrics: RuntimeMetricsSink = new NoopRuntimeMetrics(),
  options: { allowedUntrackedPaths?: readonly string[] } = {},
): Promise<void> {
  const packet = reviewPacketFromRun(run);
  if (packet === undefined) throw new Error("The implementation review packet is missing");
  if (packet.snapshotArtifactId !== undefined && packet.snapshotDigest !== undefined) {
    const artifact = run.artifacts.find(
      (candidate) =>
        candidate.id === packet.snapshotArtifactId &&
        candidate.digest === packet.snapshotDigest &&
        candidate.metadata["adapter"] === "implementation-snapshot-v1" &&
        candidate.metadata["reviewPacketId"] === packet.id,
    );
    if (artifact !== undefined) {
      try {
        const snapshot = ImplementationSnapshotSchema.parse(
          JSON.parse((await artifactStore.readContent(artifact.digest)).toString("utf8")),
        );
        if (
          snapshot.baseSha === packet.baseSha &&
          snapshot.headSha === packet.headSha &&
          snapshot.diffDigest === packet.diffDigest &&
          sameStrings(snapshot.changedFiles, packet.changedFiles)
        ) {
          const current = await captureImplementationSnapshotFence(
            run.workspaceBinding?.repositoryRoot ?? run.projectRoot,
            metrics,
            options.allowedUntrackedPaths,
          );
          if (reusableImplementationSnapshot(snapshot, current)) return;
        }
      } catch {
        // A malformed or unreadable bound artifact must take the full stale path.
      }
    }
    try {
      await captureGitSnapshot(run, metrics, undefined, options);
    } catch {
      // The stale-packet error below is authoritative for all fence mismatches.
    }
    throw new Error("The implementation review packet is stale; current Git diff does not match");
  }
  const snapshot = await captureGitSnapshot(run, metrics, undefined, options);
  if (
    snapshot.headSha !== packet.headSha ||
    snapshot.diffDigest !== packet.diffDigest ||
    !sameStrings(snapshot.changedFiles, packet.changedFiles)
  ) {
    throw new Error("The implementation review packet is stale; current Git diff does not match");
  }
}

async function captureImplementationSnapshotFence(
  projectRoot: string,
  metrics: RuntimeMetricsSink,
  allowedUntrackedPaths: readonly string[] | undefined = undefined,
): Promise<{ headSha: string; sourceBranch: string; clean: boolean }> {
  metrics.increment("git.command_count", 3);
  const [{ stdout: head }, { stdout: sourceBranch }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      killSignal: "SIGTERM",
    }),
    execFileAsync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      killSignal: "SIGTERM",
    }),
    execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 5 * 1024 * 1024,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      killSignal: "SIGTERM",
    }),
  ]);
  return {
    headSha: head.trim(),
    sourceBranch: sourceBranch.trim(),
    clean: isCleanExceptAllowedUntracked(status, normalizedUntrackedPaths(allowedUntrackedPaths)),
  };
}

function normalizedUntrackedPaths(paths: readonly string[] | undefined): ReadonlySet<string> {
  return new Set((paths ?? []).map(normalizeGitPath));
}

function isCleanExceptAllowedUntracked(
  status: string,
  allowedUntrackedPaths: ReadonlySet<string>,
): boolean {
  if (status.length === 0) return true;
  return status
    .split("\0")
    .filter(Boolean)
    .every((entry) => {
      if (!entry.startsWith("?? ")) return false;
      return allowedUntrackedPaths.has(normalizeGitPath(entry.slice(3)));
    });
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

async function currentGitHead(
  projectRoot: string,
  metrics: RuntimeMetricsSink = new NoopRuntimeMetrics(),
): Promise<string | null> {
  try {
    metrics.increment("git.command_count");
    const { stdout } = await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: GIT_COMMAND_TIMEOUT_MS,
      killSignal: "SIGTERM",
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
