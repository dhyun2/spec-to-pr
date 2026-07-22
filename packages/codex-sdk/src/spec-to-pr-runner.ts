import { execFileSync } from "node:child_process";
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
  type BlockedDiagnosticPreflight,
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
  buildCodexActionEnvelopeInstructions,
} from "./workflow-policy.js";

export type SpecToPrCodexRunInput = {
  workingDirectory: string;
  deliveryMode?: "auto" | "brief" | "legacy" | "feature" | "figma";
  changeKind?: "auto" | "feature" | "fix" | "refactor" | "migration" | "design" | "docs";
  publication?: "draft" | "none";
  prompt?: string;
  legacyProjectRoot?: string;
  legacyNetworkEvidencePath?: string;
  briefPath?: string;
  docsPath?: string;
  docsPaths?: string[];
  figmaUrl?: string;
  openApiPath?: string;
  openApiPaths?: string[];
  openApiUrl?: string;
  openApiUrls?: string[];
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
    hasOpenApi: composableSources.openApiPaths.length + composableSources.openApiUrls.length > 0,
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
    inspectBlockedDiagnosticPreflight: () =>
      inspectBlockedDiagnosticPreflight(input.workingDirectory, input.env),
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
    formatSource("Legacy project", input.legacyProjectRoot),
    formatSource("Legacy runtime network evidence", input.legacyNetworkEvidencePath),
    formatSource("Brief", input.briefPath),
    ...composableSources.docsPaths.map((sourcePath) => formatSource("Docs", sourcePath)),
    formatSource("Figma", input.figmaUrl),
    ...composableSources.openApiPaths.map((sourcePath) => formatSource("OpenAPI", sourcePath)),
    ...composableSources.openApiUrls.map((sourceUrl) => formatSource("OpenAPI URL", sourceUrl)),
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
  const publication = input.publication ?? "draft";
  const changeKind = input.changeKind ?? defaultChangeKind(deliveryMode);
  const startFields = [
    `projectRoot: ${JSON.stringify(input.workingDirectory)}`,
    "requestText: the complete user request plus any faithful brief-derived UI/API scope summary",
    `scope: ${JSON.stringify(hasUiScope ? "ui" : "auto")}`,
    `mode: ${JSON.stringify(deliveryMode)}`,
    `changeKind: ${JSON.stringify(changeKind)}`,
    `publication: ${JSON.stringify(publication)}`,
    ...(input.legacyProjectRoot === undefined
      ? []
      : [`legacyProjectRoot: ${JSON.stringify(input.legacyProjectRoot)}`]),
    ...(input.legacyNetworkEvidencePath === undefined
      ? []
      : [`legacyNetworkEvidencePath: ${JSON.stringify(input.legacyNetworkEvidencePath)}`]),
    ...(input.briefPath === undefined ? [] : [`briefPath: ${JSON.stringify(input.briefPath)}`]),
    ...(input.figmaUrl === undefined ? [] : [`figmaUrl: ${JSON.stringify(input.figmaUrl)}`]),
    ...(composableSources.docsPaths.length === 0
      ? []
      : [`docsPaths: ${JSON.stringify(composableSources.docsPaths)}`]),
    ...(composableSources.openApiPaths.length === 0
      ? []
      : [`openApiPaths: ${JSON.stringify(composableSources.openApiPaths)}`]),
    ...(composableSources.openApiUrls.length === 0
      ? []
      : [`openApiUrls: ${JSON.stringify(composableSources.openApiUrls)}`]),
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
    "When submitting evidence, include an optional skill in guidanceTrace.appliedSkills only when it was actually applied. Do not copy unused skill hints or recommendations.",
    "Use workflow_advance until it returns an external action or terminal status. Fulfill external actions and return compact evidence with workflow_submit; use workflow_status to resume or inspect blockers.",
    buildCodexActionEnvelopeInstructions({
      publication,
      includeReviewAgents: input.enableReviewAgents !== false,
      includeDesignReview: hasUiScope,
    }),
    'For API-backed UI, generate distinct physical non-empty project-local types, schemas, wrappers, mocks, and a passing JSON contract-test result before UI work and UI completion evidence; path, symlink, and hard-link aliases do not count separately. Submit workflow_submit with kind: "api-ready", status: "passed", one stable implementationContextId, artifactPaths, apiArtifacts with nonempty types/schemas/wrappers/mocks/contractTests arrays, and operation-aware operations. Continue UI in the same context and repeat that implementationContextId on final implementation only after workflow_status records the checkpoint; apiReady: true alone is not evidence. Final implementation must include apiCoverage mapping every documented operation to production call sites, mock handlers, and executable evidence, or an explicit blocking gap.',
    "Treat deliveryProfile.sourceProvenance as immutable pinned input evidence. For each UI state, declare visualTargets with baseline kind/path, route, state, fixture, viewport, deviceScaleFactor, and only justified masks. After capturing a target screenshot, answer compare-visuals with a capture manifest that repeats targetId, route, state, viewport, deviceScaleFactor, and fixture and records provider, ISO capturedAt, actualPath, and its sha256 actualDigest. The runtime rejects target drift or digest mismatch, then computes alpha-aware exact/review scores, diff, and overlay, requires at least 98%, and permits three total comparison attempts: the initial comparison plus at most two repairs. Never submit caller-computed scores or verdicts.",
    "For brief, legacy, and feature delivery, include measured lab performance and Web Vitals evidence plus an explicit field-data source or unavailable reason. The final canonical pr-report-v2.1 binds source provenance, requirements, changed files, API coverage/gaps, legacy coverage, visual ratios/assets, both independent reviews, performance, feature evidence when applicable, blockers, risks, rollback, and the evidence index to the immutable review packet. Every section is complete, not-run, blocked, or not-applicable; stale packet paths are omitted. A blocked diagnostic uses the same 15-section PR shape and identifies the stopped stage and exact unblock action.",
    "Run the fast default gates selected by workflow applicability. Run full matrices, hardening suites, package verification, and cross-host manifest validation only for an explicit release workflow.",
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
    "Use status.nextActions, blockerDetails, deliveryProfile.publication, delegationPolicy, diagnosticPublication, requiredValidations, and resumeContext as the compact action envelope.",
    "Complete only one external action group and stop after its fresh structured workflow status.",
    "Preserve every required validation and keep API and UI work in one implementation context.",
  ].join("\n");
}

export function inspectBlockedDiagnosticPreflight(
  workingDirectory: string,
  configuredEnv?: Record<string, string>,
): BlockedDiagnosticPreflight {
  const env = configuredEnv === undefined ? { ...process.env } : { ...configuredEnv };
  const sourceBranch = gitOutput(workingDirectory, ["branch", "--show-current"], env);
  if (sourceBranch === undefined || !sourceBranch.startsWith("codex/")) {
    return { eligible: false, reason: "non-codex-or-detached-source-branch" };
  }
  const worktreeStatus = gitOutput(
    workingDirectory,
    ["status", "--porcelain", "--untracked-files=normal"],
    env,
  );
  if (worktreeStatus === undefined || worktreeStatus !== "") {
    return { eligible: false, reason: "working-tree-not-clean" };
  }

  const remoteName = "origin";
  const remoteUrl = gitOutput(workingDirectory, ["remote", "get-url", remoteName], env);
  const host = supportedReviewHost(remoteUrl, env);
  if (host === undefined) return { eligible: false, reason: "unsupported-remote" };
  if (!hasExistingPublisherCredential(host, env)) {
    return { eligible: false, reason: "publisher-credentials-unavailable" };
  }

  const remoteHead = gitOutput(
    workingDirectory,
    ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remoteName}/HEAD`],
    env,
  );
  const targetBranch = remoteHead?.startsWith(`${remoteName}/`)
    ? remoteHead.slice(remoteName.length + 1)
    : "main";
  if (sourceBranch === targetBranch) {
    return { eligible: false, reason: "source-equals-target" };
  }
  if (gitOutput(workingDirectory, ["rev-parse", "--verify", targetBranch], env) === undefined) {
    return { eligible: false, reason: "target-branch-unavailable" };
  }
  const ahead = gitOutput(
    workingDirectory,
    ["rev-list", "--count", `${targetBranch}..${sourceBranch}`],
    env,
  );
  if (ahead === undefined || !/^\d+$/.test(ahead) || Number(ahead) < 1) {
    return { eligible: false, reason: "no-committed-delta" };
  }

  return { eligible: true, sourceBranch, targetBranch, remoteName };
}

export function validateSpecToPrRunInput(input: SpecToPrCodexRunInput): void {
  if (input.workingDirectory.trim() === "") {
    throw new Error("workingDirectory is required");
  }
  const mode = resolveDeliveryMode(input);
  const composableSources = normalizeComposableSources(input);
  validateComposableSources(input);
  if (input.resumeThreadId === undefined) {
    const fullDelivery = mode === "brief" || mode === "feature";
    if (fullDelivery && (input.briefPath === undefined || input.briefPath.trim() === "")) {
      throw new Error(mode + " mode requires briefPath");
    }
    if (fullDelivery && (input.figmaUrl === undefined || input.figmaUrl.trim() === "")) {
      throw new Error(mode + " mode requires figmaUrl");
    }
    if (
      fullDelivery &&
      composableSources.openApiPaths.length + composableSources.openApiUrls.length === 0
    ) {
      throw new Error(mode + " mode requires at least one OpenAPI source");
    }
    if (
      mode === "legacy" &&
      (input.legacyProjectRoot === undefined || input.legacyProjectRoot.trim() === "")
    ) {
      throw new Error("legacy mode requires legacyProjectRoot");
    }
    if (input.legacyNetworkEvidencePath !== undefined && mode !== "legacy") {
      throw new Error("legacyNetworkEvidencePath is only valid for legacy mode");
    }
    if (mode === "figma" && (input.figmaUrl === undefined || input.figmaUrl.trim() === "")) {
      throw new Error("figma mode requires figmaUrl");
    }
    if (
      (mode === "legacy" || mode === "feature") &&
      (input.prompt === undefined || input.prompt.trim().length < 3)
    ) {
      throw new Error(mode + " mode requires a concrete prompt describing the requested change");
    }
  }
  if (input.maxTurns !== undefined && (!Number.isInteger(input.maxTurns) || input.maxTurns <= 0)) {
    throw new Error("maxTurns must be a positive integer");
  }
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
  if (input.legacyProjectRoot !== undefined && input.additionalDirectories !== undefined) {
    const legacyRoot = canonicalizeThroughExistingAncestor(input.legacyProjectRoot);
    const overlap = input.additionalDirectories.some((candidate) => {
      const absoluteCandidate = path.isAbsolute(candidate)
        ? candidate
        : path.resolve(input.workingDirectory, candidate);
      const writableRoot = canonicalizeThroughExistingAncestor(absoluteCandidate);
      return (
        isWithinDirectory(legacyRoot, writableRoot) || isWithinDirectory(writableRoot, legacyRoot)
      );
    });
    if (overlap) {
      throw new Error("Writable additionalDirectories must not overlap the legacy project");
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

function gitOutput(
  workingDirectory: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: workingDirectory,
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
  } catch {
    return undefined;
  }
}

function supportedReviewHost(
  remoteUrl: string | undefined,
  env: NodeJS.ProcessEnv,
): "github" | "gitlab" | undefined {
  if (remoteUrl === undefined) return undefined;
  const host = remoteHost(remoteUrl);
  if (host === undefined) return undefined;
  const override = env["SPEC_TO_PR_GIT_HOST"]?.trim().toLowerCase();
  if (override === "github" || override === "gitlab") return override;
  if (host === "github.com") return "github";
  if (host === "gitlab.com") return "gitlab";
  return undefined;
}

function remoteHost(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim();
  const scpHost = /^[^@]+@([^:]+):/.exec(trimmed)?.[1];
  if (scpHost !== undefined) return scpHost.toLowerCase();
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function hasExistingPublisherCredential(
  host: "github" | "gitlab",
  env: NodeJS.ProcessEnv,
): boolean {
  const names =
    host === "github" ? ["GITHUB_TOKEN", "GH_TOKEN"] : ["GITLAB_TOKEN", "GITLAB_PRIVATE_TOKEN"];
  if (names.some((name) => (env[name]?.trim().length ?? 0) > 0)) return true;
  const command = host === "github" ? "gh" : "glab";
  try {
    return (
      execFileSync(command, ["auth", "token"], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      }).trim().length > 0
    );
  } catch {
    return false;
  }
}

function requiredValidationsForInput(input: SpecToPrCodexRunInput): string[] {
  const prompt = input.prompt ?? "";
  const mode = resolveDeliveryMode(input);
  const composableSources = normalizeComposableSources(input);
  const ui = isUiScope(input, prompt);
  const validations = new Set<string>(["functional"]);
  if (ui) validations.add("accessibility");
  if (input.figmaUrl !== undefined) {
    validations.add("visual");
    validations.add("figma-bundle");
    validations.add("visual-comparison");
  }
  if (mode === "legacy") {
    validations.add("visual");
    validations.add("legacy-baseline");
    validations.add("legacy-inventory");
    validations.add("visual-comparison");
  }
  if (mode === "brief" || mode === "legacy" || mode === "feature") {
    validations.add("api-coverage");
    validations.add("performance");
    validations.add("performance-evidence");
  }
  if (mode === "figma") validations.add("mock-data");
  if (mode === "feature") {
    validations.add("targeted-feature-e2e");
    validations.add("feature-video");
  }
  if (
    ui &&
    (composableSources.openApiPaths.length + composableSources.openApiUrls.length > 0 ||
      /\b(api|openapi|endpoint|schema|mock)\b/i.test(prompt))
  ) {
    validations.add("api-ready");
  }
  if ((input.publication ?? "draft") === "draft") {
    validations.add("draft-publication-preflight");
  }
  return [...validations];
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
  const additionalDirectories = uniqueInputValues(input.additionalDirectories ?? []);
  if (additionalDirectories.length > 0) options.additionalDirectories = additionalDirectories;

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
  openApiUrls: string[];
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
    openApiUrls: uniqueUrlValues([
      ...(input.openApiUrl === undefined ? [] : [input.openApiUrl]),
      ...(input.openApiUrls ?? []),
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
  if (input.legacyNetworkEvidencePath !== undefined) {
    validateSourcePath(input.legacyNetworkEvidencePath, "legacyNetworkEvidencePath");
  }
  const openApiUrls = [
    ...(input.openApiUrl === undefined ? [] : [input.openApiUrl]),
    ...(input.openApiUrls ?? []),
  ];
  if (openApiUrls.length > MAX_COMPOSABLE_SOURCE_PATHS) {
    throw new Error(`openApiUrls cannot contain more than ${MAX_COMPOSABLE_SOURCE_PATHS} URLs`);
  }
  openApiUrls.forEach((value) => validateSourceUrl(value, "openApiUrls"));

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
  if (
    normalized.openApiPaths.length + normalized.openApiUrls.length >
    MAX_COMPOSABLE_SOURCE_PATHS
  ) {
    throw new Error(
      `OpenAPI paths and URLs cannot contain more than ${MAX_COMPOSABLE_SOURCE_PATHS} distinct sources`,
    );
  }

  const roles = new Map<string, string>();
  for (const [role, values] of [
    ["briefPath", input.briefPath === undefined ? [] : [input.briefPath]],
    [
      "legacyNetworkEvidencePath",
      input.legacyNetworkEvidencePath === undefined ? [] : [input.legacyNetworkEvidencePath],
    ],
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

function validateSourceUrl(value: string, field: string): void {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 2_000) {
    throw new Error(`${field} entries must be between 1 and 2000 characters`);
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${field} entries must be valid URLs`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${field} entries must use HTTPS`);
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(`${field} entries must not contain embedded credentials`);
  }
  for (const name of parsed.searchParams.keys()) {
    if (/token|secret|password|credential|api[_-]?key|authorization/i.test(name)) {
      throw new Error(`${field} entries must not contain secret-shaped query parameters`);
    }
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

function uniqueUrlValues(values: readonly string[]): string[] {
  const unique = new Map<string, string>();
  values.forEach((value) => {
    const trimmed = value.trim();
    let key = trimmed;
    try {
      key = new URL(trimmed).toString();
    } catch {
      // Validation reports malformed URLs after normalization.
    }
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
  const mode = resolveDeliveryMode(input);
  if (mode === "brief" || mode === "legacy" || mode === "feature" || mode === "figma") {
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
  if (input.legacyProjectRoot !== undefined && input.legacyProjectRoot.trim() !== "") {
    return "legacy";
  }
  if (input.briefPath !== undefined && input.briefPath.trim() !== "") return "brief";
  if (input.figmaUrl !== undefined && input.figmaUrl.trim() !== "") return "figma";
  return "auto";
}

function defaultChangeKind(
  mode: NonNullable<SpecToPrCodexRunInput["deliveryMode"]>,
): NonNullable<SpecToPrCodexRunInput["changeKind"]> {
  if (mode === "feature" || mode === "brief") return "feature";
  if (mode === "legacy") return "migration";
  if (mode === "figma") return "design";
  return "auto";
}

function modeInstructions(mode: NonNullable<SpecToPrCodexRunInput["deliveryMode"]>): string {
  if (mode === "brief") {
    return "Brief mode is full delivery: require the supplied brief, Figma source, and local OpenAPI path or HTTPS openApiUrls source before workflow_start; preserve acceptance criteria; implement API and UI in one context; produce sourceProvenance, visualTargets, API gap, apiCoverage, compare-visuals, accessibility, Web Vitals/performance, and pr-report-v2.1 evidence; do not invent missing requirements.";
  }
  if (mode === "legacy") {
    return "Legacy mode is cross-project migration: require a separate legacyProjectRoot, treat it as read-only, inspect workflow_status.legacyInventory, map every in-scope stable feature key through legacyCoverage, derive API candidates from the explicitly listed bounded source adapters, run both projects, use the running legacy screen as the mandatory visual baseline, compare the target at the same route/state/viewport through compare-visuals, and report migration/API/performance gaps in pr-report-v2.1. Treat legacyProjectRoot and workflow_status.legacyInventory as the immutable feature boundary, not a dependency visibility boundary. Resolve every requested feature only against that inventory; if no feature key matches, report an in-bound scope mismatch. A sibling, parent, or keyword-similar module requires an explicit replacement legacyProjectRoot and is never inferred from repository-wide search. Inspect directly referenced dependency evidence outside that root only through explicit in-root import or configuration edges and only to resolve or run an in-bound feature; bounded examples are HTTP client or alias configuration, environment-name schemas/examples, package metadata/type declarations, and enclosing build/start metadata. Never scan dependency trees or build output broadly, read or persist secret values, or turn dependency evidence into unrelated feature keys, routes, screens, or API candidates. When source discovery leaves an ambiguous method or path, optionally supply a project-local legacyNetworkEvidencePath containing bounded HAR JSON or a request array captured from the scoped legacy flow. API candidates require complete api-ready/apiCoverage evidence; zero candidates require a complete API section bound to the adapter list and inventory digest. Ambiguous methods/paths resolve only from a unique scoped OpenAPI/runtime match and otherwise remain a durable intake blocker. Optional OpenAPI enriches candidates but never controls API-section applicability.";
  }
  if (mode === "feature") {
    return [
      "Feature mode: inherit the full brief/Figma/OpenAPI delivery contract including visualTargets, compare-visuals, apiCoverage, Web Vitals, and pr-report-v2.1, then run a single targeted feature E2E selected by test path, tag, or project and record exactly one .webm or .mp4.",
      "Never run the full-project E2E suite by default.",
      "Run one unchained Playwright command without --list or --pass-with-no-tests. Use a stable implementationContextId and write a strict JSON result containing only status=passed, the exact selector, that same implementationContextId, and a positive testCount. Record a structurally valid non-zero-duration WebM/MP4 container up to 25 MB.",
      "Submit featureEvidence with scope=targeted-feature, testSelector, testCommand, resultPath, and videoPath on implementation.",
    ].join(" ");
  }
  if (mode === "figma") {
    return "Figma mode: use the connected Figma capability to capture real nodes, variables, screenshots, and component context; implement deterministic mock data; before contracts submit exactly one figma-bundle with provider=host-connected-figma, ISO capturedAt, matching fileUrl, nonempty nodeIds, a declared JSON manifestPath, one or more actual PNG artifacts, and visualTargets. The strict Figma manifest repeats that provenance and exactly lists the PNG visualPaths. The separate mock manifest is {deterministic:true, fixtures:[{path, sha256}]} and binds every fixture by digest. Run compare-visuals against Figma, require at least 98%, and publish a draft with pr-report-v2.1; do not add real API, full performance, or feature-video work by default.";
  }
  return "Auto mode: keep evidence proportional to the classified change and do not activate mode-specific gates without explicit input.";
}
