import { existsSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  Codex,
  type ApprovalMode,
  type CodexOptions,
  type ModelReasoningEffort,
  type RunResult,
  type SandboxMode,
  type ThreadOptions,
} from "@openai/codex-sdk";

import {
  executeBudgetedBoundaryTurns,
  type BoundaryClient,
  type BoundaryThread,
} from "./boundary-runner.js";
import {
  UsageCalibrationStore,
  calibrateTokenRange,
  isUsageCalibrationReadEnabled,
  isUsageCalibrationEligible,
  readCalibrationBestEffort,
  recordCalibrationBestEffort,
} from "./usage-calibration.js";
import {
  defaultTokenRangeForWorkload,
  effectiveHardLimitForWorkload,
  estimateSdkWorkload,
  type AggregatedUsage,
  type SdkWorkloadEstimate,
  type WorkloadSize,
} from "./workload-budget.js";
import {
  CODEX_WORKFLOW_TOOL_NAMES,
  buildCodexPublishInstructions,
  buildCodexReviewAgentInstructions,
} from "./workflow-policy.js";

export type SpecToPrCodexRunInput = {
  workingDirectory: string;
  deliveryMode?: "auto" | "brief" | "legacy" | "feature" | "figma";
  changeKind?: "auto" | "feature" | "fix" | "refactor" | "migration" | "design" | "docs";
  publication?: "draft" | "none";
  prompt?: string;
  briefPath?: string;
  docsPath?: string;
  docsPaths?: string[];
  figmaUrl?: string;
  openApiPath?: string;
  openApiPaths?: string[];
  guidancePaths?: string[];
  skillHints?: string[];
  resumeThreadId?: string;
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalMode;
  additionalDirectories?: string[];
  codexPathOverride?: string;
  env?: Record<string, string>;
  outputSchema?: unknown;
  enableReviewAgents?: boolean;
  maxTurns?: number;
  usageHistoryPath?: string;
  usageCalibration?: boolean;
};

export type SpecToPrCodexRunResult = {
  threadId: string | null;
  finalResponse: string;
  usage: RunResult["usage"];
  items: RunResult["items"];
  workload: SdkWorkloadEstimate;
  budget: {
    state:
      | "completed"
      | "blocked"
      | "split-required"
      | "run-mismatch"
      | "usage-unavailable"
      | "status-unavailable"
      | "turn-limit";
    checkpointPercent: 80;
    checkpointAtTokens: number;
    hardLimitTokens: number;
    usedTokens: number;
    checkpointCount: number;
    requiredValidations: string[];
    usageAvailability: AggregatedUsage["availability"];
  };
  turnCount: number;
  outputFormatting:
    | "not-requested"
    | "not-terminal"
    | "applied"
    | "budget-skipped"
    | "usage-unavailable"
    | "failed";
  usageCalibration: {
    enabled: boolean;
    read: "loaded" | "unavailable" | "disabled";
    write: "recorded" | "unavailable" | "skipped" | "disabled";
    sampleCount: number;
  };
};

export async function runSpecToPrWithCodex(
  input: SpecToPrCodexRunInput,
): Promise<SpecToPrCodexRunResult> {
  validateSpecToPrRunInput(input);
  const composableSources = normalizeComposableSources(input);
  const codex = new Codex(buildCodexOptions(input));
  const deliveryMode = resolveDeliveryMode(input);
  const initialEstimate = estimateSdkWorkload({
    deliveryMode,
    promptLength: input.prompt?.length ?? 0,
    hasBrief: input.briefPath !== undefined,
    hasFigma: input.figmaUrl !== undefined,
    hasOpenApi: composableSources.openApiPaths.length > 0,
  });
  const repositoryRoot = resolveRepositoryRoot(input.workingDirectory);
  const usageStore = new UsageCalibrationStore(resolveUsageHistoryPath(input), {
    excludedRoot: repositoryRoot,
  });
  const calibrationEnabled = input.usageCalibration !== false;
  const calibrationReadEnabled = isUsageCalibrationReadEnabled({
    enabled: calibrationEnabled,
    resumed: input.resumeThreadId !== undefined,
  });
  const calibrationRead = calibrationReadEnabled
    ? await readCalibrationBestEffort(usageStore)
    : { samples: [], status: "disabled" as const };
  const calibrationByWorkload = Object.fromEntries(
    (["XS", "S", "M", "L", "XL"] as const).map((size) => [
      size,
      calibrateTokenRange({
        mode: deliveryMode,
        workloadSize: size,
        fallback: defaultTokenRangeForWorkload(size),
        samples: calibrationRead.samples,
      }),
    ]),
  ) as Record<WorkloadSize, ReturnType<typeof calibrateTokenRange>>;
  const calibration = calibrationByWorkload[initialEstimate.size];
  const initialWorkload: SdkWorkloadEstimate = {
    size: initialEstimate.size,
    confidence: calibration.confidence,
    source: calibration.source,
    tokenRange: { min: calibration.min, max: calibration.max },
    sampleCount: calibration.sampleCount,
  };
  const hardLimitTokens = effectiveHardLimitForWorkload(initialWorkload.size);
  const requiredValidations = requiredValidationsForInput(input);
  const result = await executeBudgetedBoundaryTurns({
    client: createBoundaryClient(codex, buildThreadOptions(input)),
    initialPrompt:
      input.resumeThreadId === undefined ? buildSpecToPrPrompt(input) : buildResumeSpecToPrPrompt(),
    ...(input.resumeThreadId === undefined ? {} : { resumeThreadId: input.resumeThreadId }),
    ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
    hardLimitTokens,
    workloadSize: initialWorkload.size,
    workloadHardLimits: Object.fromEntries(
      Object.keys(calibrationByWorkload).map((size) => [
        size,
        effectiveHardLimitForWorkload(size as WorkloadSize),
      ]),
    ),
    requiredValidations,
    maxTurns: input.maxTurns ?? 12,
  });
  const usage = sdkUsage(result.usage);
  const runtimeWorkload = result.workflowStatus?.workload;
  const runtimeCalibration = calibrationByWorkload[result.workloadSize];
  const workload: SdkWorkloadEstimate =
    runtimeCalibration.source === "calibrated"
      ? {
          size: result.workloadSize,
          confidence: runtimeCalibration.confidence,
          source: runtimeCalibration.source,
          tokenRange: { min: runtimeCalibration.min, max: runtimeCalibration.max },
          sampleCount: runtimeCalibration.sampleCount,
        }
      : runtimeWorkload === undefined
        ? initialWorkload
        : {
            size: runtimeWorkload.size,
            confidence: runtimeWorkload.confidence,
            source: runtimeWorkload.source,
            tokenRange: runtimeWorkload.tokenRange,
            sampleCount: runtimeCalibration.sampleCount,
          };

  const calibrationWrite = !calibrationEnabled
    ? "disabled"
    : !isUsageCalibrationEligible({
          completed: result.state === "completed",
          resumed: input.resumeThreadId !== undefined,
          usageAvailability: result.usage.availability,
        })
      ? "skipped"
      : await recordCalibrationBestEffort(usageStore, {
          version: 1,
          mode: deliveryMode,
          workloadSize: result.workloadSize,
          estimatedMinTokens: workload.tokenRange.min,
          estimatedMaxTokens: workload.tokenRange.max,
          hardLimitTokens: result.hardLimitTokens,
          inputTokens: result.usage.inputTokens,
          cachedInputTokens: result.usage.cachedInputTokens,
          outputTokens: result.usage.outputTokens,
          reasoningOutputTokens: result.usage.reasoningOutputTokens,
          totalTokens: result.usage.totalTokens,
          turnCount: result.turnCount,
          checkpointCount: result.checkpointCount,
          completed: result.state === "completed",
          recordedAtEpochMs: Date.now(),
        });

  return {
    threadId: result.threadId,
    finalResponse: result.finalResponse,
    usage,
    items: result.items,
    workload,
    budget: {
      state: result.state,
      checkpointPercent: 80,
      checkpointAtTokens: Math.floor(result.hardLimitTokens * 0.8),
      hardLimitTokens: result.hardLimitTokens,
      usedTokens: result.usage.totalTokens,
      checkpointCount: result.checkpointCount,
      requiredValidations: result.requiredValidations,
      usageAvailability: result.usage.availability,
    },
    turnCount: result.turnCount,
    outputFormatting: result.outputFormatting,
    usageCalibration: {
      enabled: calibrationEnabled,
      read: calibrationRead.status,
      write: calibrationWrite,
      sampleCount: runtimeCalibration.sampleCount,
    },
  };
}

export function buildSpecToPrPrompt(input: SpecToPrCodexRunInput): string {
  validateSpecToPrRunInput(input);
  const composableSources = normalizeComposableSources(input);
  const sources = [
    formatSource("Brief", input.briefPath),
    ...composableSources.docsPaths.map((sourcePath) => formatSource("Docs", sourcePath)),
    formatSource("Figma", input.figmaUrl),
    ...composableSources.openApiPaths.map((sourcePath) => formatSource("OpenAPI", sourcePath)),
    ...composableSources.guidancePaths.map((sourcePath) =>
      formatSource("Project guidance", sourcePath),
    ),
    ...composableSources.skillHints.map((skillHint) =>
      formatSource("Optional skill hint", skillHint),
    ),
  ].filter((line): line is string => line !== undefined);

  const userPrompt =
    input.prompt ??
    "Run the spec-to-pr workflow from intake through evidence-backed implementation planning.";
  const hasUiScope = isUiScope(input, userPrompt);
  const deliveryMode = resolveDeliveryMode(input);
  const publication = input.publication ?? (deliveryMode === "figma" ? "none" : "draft");
  const changeKind = input.changeKind ?? defaultChangeKind(deliveryMode);
  const startFields = [
    `projectRoot: ${JSON.stringify(input.workingDirectory)}`,
    "requestText: the complete user request plus any faithful brief-derived UI/API scope summary",
    `scope: ${JSON.stringify(hasUiScope ? "ui" : "auto")}`,
    `mode: ${JSON.stringify(deliveryMode)}`,
    `changeKind: ${JSON.stringify(changeKind)}`,
    `publication: ${JSON.stringify(publication)}`,
    ...(input.briefPath === undefined ? [] : [`briefPath: ${JSON.stringify(input.briefPath)}`]),
    ...(input.figmaUrl === undefined ? [] : [`figmaUrl: ${JSON.stringify(input.figmaUrl)}`]),
    ...(composableSources.docsPaths.length === 0
      ? []
      : [`docsPaths: ${JSON.stringify(composableSources.docsPaths)}`]),
    ...(composableSources.openApiPaths.length === 0
      ? []
      : [`openApiPaths: ${JSON.stringify(composableSources.openApiPaths)}`]),
    ...(composableSources.guidancePaths.length === 0
      ? []
      : [`guidancePaths: ${JSON.stringify(composableSources.guidancePaths)}`]),
    ...(composableSources.skillHints.length === 0
      ? []
      : [`skillHints: ${JSON.stringify(composableSources.skillHints)}`]),
  ].join(", ");

  return [
    "Use the installed spec-to-pr Codex plugin when it is available.",
    `The complete public tool surface is: ${CODEX_WORKFLOW_TOOL_NAMES.join(", ")}. Do not call internal or legacy micro-tools.`,
    modeInstructions(deliveryMode),
    `Call workflow_info to read the contract, then workflow_start once with the request and these delivery fields: ${startFields}.`,
    "Apply instructions in this precedence order: current user request > explicit project guidance > automatically discovered project guidance > applicable installed skills > SpecToPR defaults.",
    "For each optional skill hint, ask the host to use the named skill only when it is installed and applicable. Missing optional skills do not block the Run; never assume a hinted capability is available.",
    publication === "draft"
      ? "Before implementation, inspect git status and work on an actual non-target codex/<short-slug> source branch without absorbing unrelated dirty changes. Before workflow_publish, stage only intended files, commit all intended changes on that source branch, require a clean tree and at least one commit beyond the target, then pass the actual sourceBranch and targetBranch."
      : "Do not create a publication-only branch when publication is none unless implementation isolation requires it.",
    "Use workflow_advance until it returns an external action or terminal status. Fulfill external actions and return compact evidence with workflow_submit; use workflow_status to resume or inspect blockers.",
    "In this SDK turn, complete only one external action group and stop after its returned workflow status. Functional and design reviews returned together may run in parallel.",
    "Keep API and UI work in one implementation context; never split them into separate implementation agents or worktrees.",
    'For API-backed UI, generate distinct physical non-empty project-local types, schemas, wrappers, mocks, and a passing JSON contract-test result before UI work and UI completion evidence; path, symlink, and hard-link aliases do not count separately. Submit workflow_submit with kind: "api-ready", status: "passed", one stable implementationContextId, artifactPaths, and apiArtifacts containing nonempty types, schemas, wrappers, mocks, and contractTests arrays. Continue UI in the same context and repeat that implementationContextId on final implementation only after workflow_status records the checkpoint; apiReady: true alone is not evidence.',
    "Run the fast default gates selected by workflow applicability. Run full matrices, hardening suites, package verification, and cross-host manifest validation only for an explicit release workflow.",
    "",
    buildCodexPublishInstructions(),
    "",
    input.enableReviewAgents === false
      ? ""
      : buildCodexReviewAgentInstructions({
          includeFunctionalReview: true,
          includeDesignReview: hasUiScope,
        }),
    "",
    "User request:",
    userPrompt,
    "",
    "Sources:",
    sources.length === 0 ? "- none provided" : sources.join("\n"),
  ].join("\n");
}

export function buildResumeSpecToPrPrompt(): string {
  return [
    "Resume the existing Run recorded in this Codex task; do not create a new Run or repeat intake.",
    "Recover the latest runId from thread history and call workflow_status first. If no durable runId is recoverable, stop without modifying files.",
    "Use resumeContext.goal, its project-relative evidencePaths, submission summaries, stages, and nextActions as the compact source of truth.",
    "Complete only one external action group and stop after its fresh structured workflow status.",
    "Preserve every required validation and keep API and UI work in one implementation context.",
  ].join("\n");
}

export function validateSpecToPrRunInput(input: SpecToPrCodexRunInput): void {
  if (input.workingDirectory.trim() === "") {
    throw new Error("workingDirectory is required");
  }
  const mode = resolveDeliveryMode(input);
  if (input.resumeThreadId === undefined) {
    if (mode === "brief" && (input.briefPath === undefined || input.briefPath.trim() === "")) {
      throw new Error("brief mode requires briefPath");
    }
    if (mode === "figma" && (input.figmaUrl === undefined || input.figmaUrl.trim() === "")) {
      throw new Error("figma mode requires figmaUrl");
    }
    if (
      (mode === "legacy" || mode === "feature") &&
      (input.prompt === undefined || input.prompt.trim().length < 3)
    ) {
      throw new Error(`${mode} mode requires a concrete prompt describing the requested change`);
    }
  }
  if (input.maxTurns !== undefined && (!Number.isInteger(input.maxTurns) || input.maxTurns <= 0)) {
    throw new Error("maxTurns must be a positive integer");
  }
  validateComposableSources(input);
  if (input.usageCalibration !== false) {
    const usageHistoryPath = resolveUsageHistoryPath(input);
    if (
      isWithinDirectory(
        resolveRepositoryRoot(input.workingDirectory),
        canonicalizeThroughExistingAncestor(usageHistoryPath),
      )
    ) {
      throw new Error("usageHistoryPath must stay outside the target repository");
    }
    if (isHardLinkedFile(usageHistoryPath)) {
      throw new Error("usageHistoryPath must not be a hard-linked file");
    }
  }
}

function resolveUsageHistoryPath(input: SpecToPrCodexRunInput): string {
  const configured =
    input.usageHistoryPath ??
    path.join(os.homedir(), ".codex", "spec-to-pr", "usage-history.jsonl");
  return path.isAbsolute(configured)
    ? path.normalize(configured)
    : path.resolve(input.workingDirectory, configured);
}

function isWithinDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function canonicalizeThroughExistingAncestor(candidate: string): string {
  let current = path.resolve(candidate);
  const missingSegments: string[] = [];

  while (true) {
    try {
      return path.resolve(realpathSync.native(current), ...missingSegments);
    } catch (error: unknown) {
      if (!isMissingPath(error)) throw error;
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(candidate);
      missingSegments.unshift(path.basename(current));
      current = parent;
    }
  }
}

function resolveRepositoryRoot(workingDirectory: string): string {
  let current = canonicalizeThroughExistingAncestor(workingDirectory);
  while (true) {
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return canonicalizeThroughExistingAncestor(workingDirectory);
    current = parent;
  }
}

function isMissingPath(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isHardLinkedFile(candidate: string): boolean {
  try {
    const metadata = statSync(candidate);
    return metadata.isFile() && metadata.nlink > 1;
  } catch (error: unknown) {
    if (isMissingPath(error)) return false;
    throw error;
  }
}

function createBoundaryClient(codex: Codex, options: ThreadOptions): BoundaryClient {
  return {
    startThread: () => adaptThread(codex.startThread(options)),
    resumeThread: (threadId) => adaptThread(codex.resumeThread(threadId, options)),
  };
}

function adaptThread(thread: ReturnType<Codex["startThread"]>): BoundaryThread {
  return {
    get id() {
      return thread.id;
    },
    run: async (prompt, options) =>
      options?.outputSchema === undefined
        ? thread.run(prompt)
        : thread.run(prompt, { outputSchema: options.outputSchema }),
  };
}

function sdkUsage(usage: AggregatedUsage): RunResult["usage"] {
  if (usage.availability !== "complete") return null;
  return {
    input_tokens: usage.inputTokens,
    cached_input_tokens: usage.cachedInputTokens,
    output_tokens: usage.outputTokens,
    reasoning_output_tokens: usage.reasoningOutputTokens,
  };
}

function requiredValidationsForInput(input: SpecToPrCodexRunInput): string[] {
  const prompt = input.prompt ?? "";
  const mode = resolveDeliveryMode(input);
  const composableSources = normalizeComposableSources(input);
  const ui = isUiScope(input, prompt);
  const validations = ["functional"];
  if (ui) validations.push("accessibility");
  if (input.figmaUrl !== undefined) validations.push("visual", "figma-bundle");
  if (mode === "legacy") validations.push("legacy-baseline");
  if (mode === "feature") validations.push("targeted-feature-e2e", "feature-video");
  if (
    ui &&
    (composableSources.openApiPaths.length > 0 ||
      /\b(api|openapi|endpoint|schema|mock)\b/i.test(prompt))
  ) {
    validations.push("api-ready");
  }
  if ((input.publication ?? (mode === "figma" ? "none" : "draft")) === "draft") {
    validations.push("draft-publication-preflight");
  }
  return validations;
}

function buildCodexOptions(input: SpecToPrCodexRunInput): CodexOptions {
  const options: CodexOptions = {};

  if (input.codexPathOverride !== undefined) {
    options.codexPathOverride = input.codexPathOverride;
  }
  if (input.env !== undefined) {
    options.env = input.env;
  }

  return options;
}

function buildThreadOptions(input: SpecToPrCodexRunInput): ThreadOptions {
  const options: ThreadOptions = {
    workingDirectory: input.workingDirectory,
    sandboxMode: input.sandboxMode ?? "workspace-write",
    approvalPolicy: input.approvalPolicy ?? "on-request",
    modelReasoningEffort: input.modelReasoningEffort ?? "high",
  };

  if (input.model !== undefined) {
    options.model = input.model;
  }
  if (input.additionalDirectories !== undefined) {
    options.additionalDirectories = input.additionalDirectories;
  }

  return options;
}

function formatSource(label: string, value: string | undefined): string | undefined {
  return value === undefined || value.trim() === ""
    ? undefined
    : `- ${label}: ${JSON.stringify(value)}`;
}

const MAX_COMPOSABLE_SOURCE_PATHS = 20;
const MAX_SOURCE_PATH_LENGTH = 1_000;
const MAX_SKILL_HINT_LENGTH = 128;
const SKILL_HINT_PATTERN = /^[a-z0-9][a-z0-9._ -]*(?::[a-z0-9][a-z0-9._ -]*)?$/i;

type NormalizedComposableSources = {
  docsPaths: string[];
  openApiPaths: string[];
  guidancePaths: string[];
  skillHints: string[];
};

function normalizeComposableSources(input: SpecToPrCodexRunInput): NormalizedComposableSources {
  return {
    docsPaths: uniqueInputValues([
      ...(input.docsPath === undefined ? [] : [input.docsPath]),
      ...(input.docsPaths ?? []),
    ]),
    openApiPaths: uniqueInputValues([
      ...(input.openApiPath === undefined ? [] : [input.openApiPath]),
      ...(input.openApiPaths ?? []),
    ]),
    guidancePaths: uniqueInputValues(input.guidancePaths ?? []),
    skillHints: uniqueInputValues(input.skillHints ?? []),
  };
}

function validateComposableSources(input: SpecToPrCodexRunInput): void {
  const pathArrays = [
    ["docsPaths", input.docsPaths ?? []],
    ["openApiPaths", input.openApiPaths ?? []],
    ["guidancePaths", input.guidancePaths ?? []],
  ] as const;
  for (const [field, values] of pathArrays) {
    if (values.length > MAX_COMPOSABLE_SOURCE_PATHS) {
      throw new Error(`${field} cannot contain more than ${MAX_COMPOSABLE_SOURCE_PATHS} paths`);
    }
    values.forEach((value) => validateSourcePath(value, field));
  }
  if (input.docsPath !== undefined) validateSourcePath(input.docsPath, "docsPath");
  if (input.openApiPath !== undefined) validateSourcePath(input.openApiPath, "openApiPath");
  if (input.briefPath !== undefined) validateSourcePath(input.briefPath, "briefPath");

  const skillHints = input.skillHints ?? [];
  if (skillHints.length > MAX_COMPOSABLE_SOURCE_PATHS) {
    throw new Error(`skillHints cannot contain more than ${MAX_COMPOSABLE_SOURCE_PATHS} hints`);
  }
  skillHints.forEach((skillHint) => {
    const normalized = skillHint.trim();
    if (
      normalized.length === 0 ||
      normalized.length > MAX_SKILL_HINT_LENGTH ||
      !SKILL_HINT_PATTERN.test(normalized)
    ) {
      throw new Error("skillHints must contain skill names, not filesystem paths");
    }
  });

  const normalized = normalizeComposableSources(input);
  for (const field of ["docsPaths", "openApiPaths"] as const) {
    if (normalized[field].length > MAX_COMPOSABLE_SOURCE_PATHS) {
      throw new Error(
        `${field} legacy and plural inputs cannot contain more than ${MAX_COMPOSABLE_SOURCE_PATHS} distinct paths`,
      );
    }
  }

  const roles = new Map<string, string>();
  for (const [role, values] of [
    ["briefPath", input.briefPath === undefined ? [] : [input.briefPath]],
    ["docsPaths", [input.docsPath, ...(input.docsPaths ?? [])].filter(isDefined)],
    ["openApiPaths", [input.openApiPath, ...(input.openApiPaths ?? [])].filter(isDefined)],
    ["guidancePaths", input.guidancePaths ?? []],
  ] as const) {
    for (const sourcePath of values) {
      const key = normalizedInputPathKey(sourcePath);
      const previous = roles.get(key);
      if (previous !== undefined && previous !== role) {
        throw new Error(`Source path conflicts with ${previous}: ${sourcePath}`);
      }
      roles.set(key, role);
    }
  }
}

function validateSourcePath(value: string, field: string): void {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_SOURCE_PATH_LENGTH) {
    throw new Error(`${field} entries must be between 1 and ${MAX_SOURCE_PATH_LENGTH} characters`);
  }
}

function uniqueInputValues(values: readonly string[]): string[] {
  const unique = new Map<string, string>();
  values.forEach((value) => {
    const trimmed = value.trim();
    const key = normalizedInputPathKey(trimmed);
    if (!unique.has(key)) unique.set(key, trimmed);
  });
  return [...unique.values()];
}

function normalizedInputPathKey(value: string): string {
  return path.normalize(value.trim()).split(path.sep).join("/");
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isUiScope(input: SpecToPrCodexRunInput, prompt: string): boolean {
  if (input.deliveryMode === "feature" || input.deliveryMode === "figma") {
    return true;
  }
  if (input.figmaUrl !== undefined && input.figmaUrl.trim() !== "") {
    return true;
  }

  return /\b(ui|ux|frontend|front-end|screen|page|view|component|design|figma|responsive|visual)\b/i.test(
    prompt,
  );
}

function resolveDeliveryMode(
  input: SpecToPrCodexRunInput,
): NonNullable<SpecToPrCodexRunInput["deliveryMode"]> {
  if (input.deliveryMode !== undefined) return input.deliveryMode;
  if (input.figmaUrl !== undefined && input.figmaUrl.trim() !== "") return "figma";
  if (input.briefPath !== undefined && input.briefPath.trim() !== "") return "brief";
  return "auto";
}

function defaultChangeKind(
  mode: NonNullable<SpecToPrCodexRunInput["deliveryMode"]>,
): NonNullable<SpecToPrCodexRunInput["changeKind"]> {
  if (mode === "feature" || mode === "brief") return "feature";
  if (mode === "figma") return "design";
  return "auto";
}

function modeInstructions(mode: NonNullable<SpecToPrCodexRunInput["deliveryMode"]>): string {
  if (mode === "brief") {
    return "Brief mode: read the supplied project-local brief before workflow_start, preserve its acceptance criteria, set scope=ui when applicable, and include a compact faithful UI/API scope summary in requestText. The runtime also reads briefPath for classification; do not invent missing requirements.";
  }
  if (mode === "legacy") {
    return "Legacy mode: capture a focused baseline for the requested behavior and verify only the affected regression scope by default.";
  }
  if (mode === "feature") {
    return [
      "Feature mode: run a single targeted feature E2E selected by test path, tag, or project and record exactly one .webm or .mp4.",
      "Never run the full-project E2E suite by default.",
      "Run one unchained Playwright command without --list or --pass-with-no-tests. Use a stable implementationContextId and write a strict JSON result containing only status=passed, the exact selector, that same implementationContextId, and a positive testCount. Record a structurally valid non-zero-duration WebM/MP4 container up to 25 MB.",
      "Submit featureEvidence with scope=targeted-feature, testSelector, testCommand, resultPath, and videoPath on implementation.",
    ].join(" ");
  }
  if (mode === "figma") {
    return "Figma mode: use the connected Figma capability to capture real nodes, variables, screenshots, and component context; before contracts submit exactly one figma-bundle with provider=host-connected-figma, ISO capturedAt, matching fileUrl, nonempty nodeIds, a declared JSON manifestPath, and one or more actual PNG artifacts. The strict manifest repeats that provenance and exactly lists the PNG visualPaths. Do not replace intake with URL-only claims, repeat the bundle, or poll at runtime.";
  }
  return "Auto mode: keep evidence proportional to the classified change and do not activate mode-specific gates without explicit input.";
}
