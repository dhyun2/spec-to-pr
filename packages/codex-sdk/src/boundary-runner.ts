import type { RunResult } from "@openai/codex-sdk";

import {
  accumulateUsage,
  decideBudgetAction,
  type AggregatedUsage,
  type WorkloadSize,
} from "./workload-budget.js";
import { parallelReviewersForWorkload } from "./generated/delivery-mode-policy.js";

export type BoundaryWorkflowStatus = {
  runId: string;
  revision: number;
  status: "running" | "needs-external-action" | "blocked" | "publish-ready" | "completed";
  currentStage?: string;
  stages: unknown[];
  nextActions: unknown[];
  blockers: string[];
  blockerDetails: BoundaryWorkflowBlocker[];
  deliveryProfile: {
    publication: "draft" | "none";
    recommendedSkills: string[];
  };
  delegationPolicy: {
    singleWriter: true;
    allowNested: false;
    maxReadOnlyScouts: 0 | 1 | 2;
    parallelReviewers: boolean;
  };
  diagnosticPublication?: {
    host: "github" | "gitlab";
    url: string;
    number: string;
    created: boolean;
    updated: boolean;
    publishResultArtifactId: string;
  };
  resumeContext: {
    goal: string;
    evidencePaths: string[];
    submissions: Array<{ kind: string; summary: string; outcome: string }>;
  };
  requiredValidations: string[];
  workload: {
    size: WorkloadSize;
    confidence: "low" | "medium" | "high";
    source: "intake" | "contracts" | "calibrated";
    tokenRange: { min: number; max: number };
    budget: {
      checkpointPercent: 80;
      checkpointAtTokens: number;
      hardLimitTokens: number;
    };
  };
};

export type BoundaryWorkflowBlocker = {
  stage: string;
  code: string;
  kind:
    | "missing-input"
    | "missing-tool"
    | "policy"
    | "verification"
    | "publish-precondition"
    | "budget-split"
    | "unexpected";
  summary: string;
  retryable: boolean;
  resumable: boolean;
  completedWork: string[];
  evidencePaths: string[];
  attemptedRecovery: string[];
  unrunValidations: string[];
  exactUnblockAction: string;
};

export type BoundaryThread = {
  readonly id: string | null;
  run(prompt: string, options?: { outputSchema?: unknown }): Promise<RunResult>;
};

export type BoundaryClient = {
  startThread(): BoundaryThread;
  resumeThread(threadId: string): BoundaryThread;
};

export type BlockedDiagnosticPreflight =
  | {
      eligible: true;
      sourceBranch: string;
      targetBranch: string;
      remoteName: string;
    }
  | { eligible: false; reason: string };

export type BoundaryRunState =
  | "completed"
  | "blocked"
  | "split-required"
  | "run-mismatch"
  | "usage-unavailable"
  | "status-unavailable"
  | "turn-limit";

export async function executeBudgetedBoundaryTurns(input: {
  client: BoundaryClient;
  initialPrompt: string;
  resumeThreadId?: string;
  outputSchema?: unknown;
  hardLimitTokens: number;
  workloadSize: WorkloadSize;
  workloadHardLimits?: Partial<Record<WorkloadSize, number>>;
  requiredValidations: readonly string[];
  maxTurns: number;
  blockedDiagnosticTokenReserve?: number;
  inspectBlockedDiagnosticPreflight?: () =>
    BlockedDiagnosticPreflight | Promise<BlockedDiagnosticPreflight>;
}): Promise<{
  threadId: string | null;
  finalResponse: string;
  items: RunResult["items"];
  usage: AggregatedUsage;
  state: BoundaryRunState;
  outputFormatting:
    | "not-requested"
    | "not-terminal"
    | "applied"
    | "budget-skipped"
    | "usage-unavailable"
    | "failed";
  turnCount: number;
  checkpointCount: number;
  workflowStatus: BoundaryWorkflowStatus | null;
  requiredValidations: string[];
  workloadSize: WorkloadSize;
  hardLimitTokens: number;
}> {
  if (!Number.isInteger(input.maxTurns) || input.maxTurns <= 0) {
    throw new Error("maxTurns must be a positive integer");
  }
  if (
    input.blockedDiagnosticTokenReserve !== undefined &&
    (!Number.isInteger(input.blockedDiagnosticTokenReserve) ||
      input.blockedDiagnosticTokenReserve <= 0 ||
      input.blockedDiagnosticTokenReserve >= input.hardLimitTokens)
  ) {
    throw new Error(
      "blockedDiagnosticTokenReserve must be a positive integer below hardLimitTokens",
    );
  }

  let thread =
    input.resumeThreadId === undefined
      ? input.client.startThread()
      : input.client.resumeThread(input.resumeThreadId);
  let prompt = input.initialPrompt;
  let usage: AggregatedUsage | null = null;
  let finalResponse = "";
  let workflowStatus: BoundaryWorkflowStatus | null = null;
  let state: BoundaryRunState = "turn-limit";
  let outputFormatting:
    | "not-requested"
    | "not-terminal"
    | "applied"
    | "budget-skipped"
    | "usage-unavailable"
    | "failed" = input.outputSchema === undefined ? "not-requested" : "not-terminal";
  let checkpointed = false;
  let checkpointCount = 0;
  let turnCount = 0;
  let activeWorkloadSize = input.workloadSize;
  let activeHardLimitTokens = input.hardLimitTokens;
  let activeRequiredValidations = [...input.requiredValidations];
  let hasAuthoritativeValidations = false;
  let pinnedRunId: string | null = null;
  let blockedFinalizationAttempted = false;
  let blockedDiagnosticPreflightIneligible = false;
  let blockedDiagnosticReserveLatched = false;
  let blockedDiagnosticReserveExhausted = false;
  const items: RunResult["items"] = [];

  while (turnCount < input.maxTurns) {
    const turn = await thread.run(prompt);
    turnCount += 1;
    finalResponse = turn.finalResponse;
    items.push(...turn.items);
    usage = accumulateUsage(usage, turn.usage);
    const currentStatus = extractWorkflowStatus(turn.items);

    if (currentStatus === null) {
      state = "status-unavailable";
      break;
    }
    if (pinnedRunId !== null && currentStatus.runId !== pinnedRunId) {
      state = "run-mismatch";
      break;
    }
    pinnedRunId ??= currentStatus.runId;
    workflowStatus = currentStatus;
    blockedDiagnosticReserveLatched ||=
      input.blockedDiagnosticTokenReserve !== undefined &&
      currentStatus.deliveryProfile.publication === "draft";
    const configuredHardLimit = input.workloadHardLimits?.[currentStatus.workload.size];
    if (configuredHardLimit !== undefined) {
      activeHardLimitTokens = configuredHardLimit;
    } else if (currentStatus.workload.size !== activeWorkloadSize) {
      activeHardLimitTokens = currentStatus.workload.budget.hardLimitTokens;
    }
    activeWorkloadSize = currentStatus.workload.size;
    activeRequiredValidations = hasAuthoritativeValidations
      ? unionStrings(activeRequiredValidations, currentStatus.requiredValidations)
      : [...currentStatus.requiredValidations];
    hasAuthoritativeValidations = true;
    if (workflowStatus.status === "completed") {
      state = "completed";
      break;
    }
    if (workflowStatus.status === "blocked") {
      state = "blocked";
      const blockedDiagnosticReserveRemaining =
        !blockedDiagnosticReserveLatched ||
        usage.totalTokens <= activeHardLimitTokens - (input.blockedDiagnosticTokenReserve ?? 0);
      blockedDiagnosticReserveExhausted =
        blockedDiagnosticReserveLatched && !blockedDiagnosticReserveRemaining;
      if (
        !blockedFinalizationAttempted &&
        canAttemptBlockedDiagnosticFinalization(workflowStatus) &&
        usage.availability === "complete" &&
        usage.totalTokens < activeHardLimitTokens &&
        blockedDiagnosticReserveRemaining &&
        turnCount < input.maxTurns
      ) {
        const preflight = await inspectBlockedDiagnosticPreflight(
          input.inspectBlockedDiagnosticPreflight,
        );
        if (preflight.eligible) {
          blockedFinalizationAttempted = true;
          prompt = buildBlockedDiagnosticFinalizationPrompt(workflowStatus, preflight);
          continue;
        }
        blockedDiagnosticPreflightIneligible = true;
      }
      break;
    }
    if (turn.usage === null) {
      state = "usage-unavailable";
      break;
    }

    const normalTurnLimit = blockedDiagnosticReserveLatched ? input.maxTurns - 1 : input.maxTurns;
    const normalTokenLimit = blockedDiagnosticReserveLatched
      ? activeHardLimitTokens - (input.blockedDiagnosticTokenReserve ?? 0)
      : activeHardLimitTokens;
    const canAdmitAnotherNormalTurn =
      !blockedDiagnosticReserveLatched ||
      usage.totalTokens + turn.usage.input_tokens + turn.usage.output_tokens < normalTokenLimit;

    const decision = decideBudgetAction({
      usedTokens: usage.totalTokens,
      hardLimitTokens: normalTokenLimit,
      checkpointed,
      workloadSize: activeWorkloadSize,
      requiredValidations: activeRequiredValidations,
    });
    if (decision.action === "split-required") {
      state = decision.action;
      break;
    }
    if (decision.action === "checkpoint") {
      if (turnCount >= normalTurnLimit || !canAdmitAnotherNormalTurn) {
        state = "turn-limit";
        break;
      }
      checkpointed = true;
      checkpointCount += 1;
      thread = input.client.startThread();
      prompt = buildCompactCheckpointPrompt(workflowStatus, activeRequiredValidations, {
        usedTokens: usage.totalTokens,
        hardLimitTokens: normalTokenLimit,
      });
      continue;
    }

    if (turnCount >= normalTurnLimit || !canAdmitAnotherNormalTurn) {
      state = "turn-limit";
      break;
    }

    prompt = buildBoundaryContinuationPrompt(workflowStatus, activeRequiredValidations, {
      usedTokens: usage.totalTokens,
      hardLimitTokens: normalTokenLimit,
    });
  }

  if (input.outputSchema !== undefined && (state === "completed" || state === "blocked")) {
    if (blockedDiagnosticPreflightIneligible || blockedDiagnosticReserveExhausted) {
      outputFormatting = "budget-skipped";
    } else if (usage?.availability !== "complete") {
      outputFormatting = "usage-unavailable";
    } else if (usage.totalTokens >= activeHardLimitTokens || turnCount >= input.maxTurns) {
      outputFormatting = "budget-skipped";
    } else {
      try {
        const formatted = await thread.run(buildFinalResponsePrompt(workflowStatus!), {
          outputSchema: input.outputSchema,
        });
        turnCount += 1;
        finalResponse = formatted.finalResponse;
        items.push(...formatted.items);
        usage = accumulateUsage(usage, formatted.usage);
        outputFormatting = "applied";
      } catch {
        usage = accumulateUsage(usage, null);
        outputFormatting = "failed";
      }
    }
  }

  return {
    threadId: thread.id,
    finalResponse,
    items,
    usage: usage ?? accumulateUsage(null, null),
    state,
    outputFormatting,
    turnCount,
    checkpointCount,
    workflowStatus,
    requiredValidations: activeRequiredValidations,
    workloadSize: activeWorkloadSize,
    hardLimitTokens: activeHardLimitTokens,
  };
}

export function extractWorkflowStatus(items: RunResult["items"]): BoundaryWorkflowStatus | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type !== "mcp_tool_call" || item.result === undefined) continue;
    const parsed = parseWorkflowStatus(item.result.structured_content);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function buildCompactCheckpointPrompt(
  status: BoundaryWorkflowStatus,
  requiredValidations: readonly string[],
  effectiveBudget: { usedTokens: number; hardLimitTokens: number },
): string {
  return [
    "Resume the installed spec-to-pr workflow from this compact context checkpoint.",
    "Call workflow_status with the recorded runId first; durable workflow state and project files are authoritative.",
    "Complete only the next external action group, then stop after the returned workflow status. Independent functional and design reviews in the same action group may run in parallel.",
    "Do not waive, skip, or reduce required validation because of token pressure. Keep API and UI implementation in one context.",
    `Checkpoint: ${JSON.stringify(compactStatus(status, requiredValidations, effectiveBudget))}`,
  ].join("\n");
}

export function buildBoundaryContinuationPrompt(
  status: BoundaryWorkflowStatus,
  requiredValidations: readonly string[],
  effectiveBudget: { usedTokens: number; hardLimitTokens: number },
): string {
  return [
    `Continue spec-to-pr Run ${status.runId}.`,
    "Call workflow_status first, complete only the next external action group, and stop after its returned status. Independent functional and design reviews in the same group may run in parallel.",
    "Preserve every required validation; budget pressure never authorizes a waiver.",
    `Boundary: ${JSON.stringify(compactStatus(status, requiredValidations, effectiveBudget))}`,
  ].join("\n");
}

export function buildFinalResponsePrompt(status: BoundaryWorkflowStatus): string {
  return [
    `Format the final result for terminal spec-to-pr Run ${status.runId}.`,
    "Do not perform another workflow action or modify files. Use the durable status and evidence already produced in this thread.",
    `Terminal status: ${JSON.stringify(compactStatus(status, status.requiredValidations))}`,
  ].join("\n");
}

export function buildBlockedDiagnosticFinalizationPrompt(
  status: BoundaryWorkflowStatus,
  preflight?: Extract<BlockedDiagnosticPreflight, { eligible: true }>,
): string {
  const blocker = status.blockerDetails.find((item) => !item.retryable);
  return [
    `Finalize blocked diagnostic evidence for spec-to-pr Run ${status.runId}; do not retry implementation or the blocked validation.`,
    "This is the only diagnostic-publication turn. First verify that a committed delta, a clean branch, a supported remote (GitHub/GitLab), and existing non-interactive credentials already exist.",
    preflight === undefined
      ? 'Only when every precondition is already true, call workflow_publish once with intent: "blocked-diagnostic", mode: "execute", confirm: true, and the actual non-target sourceBranch and targetBranch.'
      : `The SDK preflight already passed. Call workflow_publish once with intent: "blocked-diagnostic", mode: "execute", confirm: true, sourceBranch: ${JSON.stringify(preflight.sourceBranch)}, targetBranch: ${JSON.stringify(preflight.targetBranch)}, and remoteName: ${JSON.stringify(preflight.remoteName)}.`,
    "If any precondition is absent, do not create commits, branches, credentials, issues, or another recovery loop; preserve the local diagnostic report.",
    "Call workflow_status once after the publish attempt or local-only decision, then stop even when the Run remains blocked.",
    `Blocked action envelope: ${JSON.stringify({
      runId: status.runId,
      publication: status.deliveryProfile.publication,
      blocker,
      diagnosticPublication: status.diagnosticPublication ?? null,
    })}`,
  ].join("\n");
}

async function inspectBlockedDiagnosticPreflight(
  inspect: (() => BlockedDiagnosticPreflight | Promise<BlockedDiagnosticPreflight>) | undefined,
): Promise<BlockedDiagnosticPreflight> {
  if (inspect === undefined) {
    return { eligible: false, reason: "preflight-inspector-unavailable" };
  }
  try {
    return await inspect();
  } catch {
    return { eligible: false, reason: "preflight-inspection-failed" };
  }
}

function compactStatus(
  status: BoundaryWorkflowStatus,
  requiredValidations: readonly string[],
  effectiveBudget?: { usedTokens: number; hardLimitTokens: number },
) {
  return {
    runId: status.runId,
    revision: status.revision,
    status: status.status,
    ...(status.currentStage === undefined ? {} : { currentStage: status.currentStage }),
    stages: status.stages,
    workload: status.workload,
    actionEnvelope: {
      nextActions: status.nextActions,
      blockers: status.blockers,
      blockerDetails: status.blockerDetails,
      publication: status.deliveryProfile.publication,
      recommendedSkills: status.deliveryProfile.recommendedSkills,
      delegationPolicy: status.delegationPolicy,
      diagnosticPublication: status.diagnosticPublication ?? null,
      resumeContext: status.resumeContext,
      requiredValidations: [...requiredValidations],
    },
    ...(effectiveBudget === undefined
      ? {}
      : {
          effectiveBudget: {
            usedTokens: effectiveBudget.usedTokens,
            remainingTokens: Math.max(
              0,
              effectiveBudget.hardLimitTokens - effectiveBudget.usedTokens,
            ),
            checkpointAtTokens: Math.floor(effectiveBudget.hardLimitTokens * 0.8),
            hardLimitTokens: effectiveBudget.hardLimitTokens,
          },
        }),
  };
}

function canAttemptBlockedDiagnosticFinalization(status: BoundaryWorkflowStatus): boolean {
  if (
    status.deliveryProfile.publication !== "draft" ||
    status.diagnosticPublication !== undefined
  ) {
    return false;
  }
  const blocker = status.blockerDetails.find((item) => !item.retryable);
  return blocker !== undefined && blocker.kind !== "publish-precondition";
}

function unionStrings(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set([...left, ...right])];
}

function parseWorkflowStatus(value: unknown): BoundaryWorkflowStatus | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nested = parseWorkflowStatusCandidate(record["status"]);
  if (nested !== null) return nested;
  return parseWorkflowStatusCandidate(value);
}

function parseWorkflowStatusCandidate(value: unknown): BoundaryWorkflowStatus | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const runId = record["runId"];
  const revision = record["revision"];
  const status = record["status"];
  const allowedStatuses = new Set([
    "running",
    "needs-external-action",
    "blocked",
    "publish-ready",
    "completed",
  ]);
  if (
    typeof runId !== "string" ||
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    revision < 0 ||
    typeof status !== "string" ||
    !allowedStatuses.has(status)
  ) {
    return null;
  }
  if (
    !Array.isArray(record["stages"]) ||
    !Array.isArray(record["nextActions"]) ||
    !isStringArray(record["blockers"]) ||
    !isStringArray(record["requiredValidations"])
  ) {
    return null;
  }
  const currentStage = record["currentStage"];
  if (currentStage !== undefined && typeof currentStage !== "string") return null;
  const workload = parseWorkload(record["workload"]);
  const resumeContext = parseResumeContext(record["resumeContext"]);
  if (workload === null || resumeContext === null) return null;
  const deliveryProfile = parseDeliveryProfile(record["deliveryProfile"]);
  const delegationPolicy = parseDelegationPolicy(record["delegationPolicy"], workload.size);
  const blockerDetails = parseBlockerDetails(record["blockerDetails"]);
  const diagnosticPublication = parseDiagnosticPublication(record["diagnosticPublication"]);
  if (
    deliveryProfile === null ||
    delegationPolicy === null ||
    blockerDetails === null ||
    diagnosticPublication === null
  ) {
    return null;
  }

  return {
    runId,
    revision,
    status: status as BoundaryWorkflowStatus["status"],
    ...(currentStage === undefined ? {} : { currentStage }),
    stages: record["stages"],
    nextActions: record["nextActions"],
    blockers: record["blockers"],
    blockerDetails,
    deliveryProfile,
    delegationPolicy,
    ...(diagnosticPublication === undefined ? {} : { diagnosticPublication }),
    resumeContext,
    requiredValidations: record["requiredValidations"],
    workload,
  };
}

function parseDeliveryProfile(value: unknown): BoundaryWorkflowStatus["deliveryProfile"] | null {
  if (value === undefined) return { publication: "none", recommendedSkills: [] };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const publication = record["publication"];
  const recommendedSkills = record["recommendedSkills"] ?? [];
  if ((publication !== "draft" && publication !== "none") || !isStringArray(recommendedSkills)) {
    return null;
  }
  return { publication, recommendedSkills };
}

function parseDelegationPolicy(
  value: unknown,
  workloadSize: WorkloadSize,
): BoundaryWorkflowStatus["delegationPolicy"] | null {
  if (value === undefined) {
    return {
      singleWriter: true,
      allowNested: false,
      maxReadOnlyScouts:
        workloadSize === "M" ? 1 : workloadSize === "L" || workloadSize === "XL" ? 2 : 0,
      parallelReviewers: parallelReviewersForWorkload(workloadSize),
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const maxReadOnlyScouts = record["maxReadOnlyScouts"];
  if (
    record["singleWriter"] !== true ||
    record["allowNested"] !== false ||
    (maxReadOnlyScouts !== 0 && maxReadOnlyScouts !== 1 && maxReadOnlyScouts !== 2) ||
    typeof record["parallelReviewers"] !== "boolean"
  ) {
    return null;
  }
  return {
    singleWriter: true,
    allowNested: false,
    maxReadOnlyScouts,
    parallelReviewers: record["parallelReviewers"],
  };
}

function parseBlockerDetails(value: unknown): BoundaryWorkflowBlocker[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parseBlocker);
  return parsed.every((item): item is BoundaryWorkflowBlocker => item !== null) ? parsed : null;
}

function parseBlocker(value: unknown): BoundaryWorkflowBlocker | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind = record["kind"];
  if (
    typeof record["stage"] !== "string" ||
    typeof record["code"] !== "string" ||
    typeof kind !== "string" ||
    ![
      "missing-input",
      "missing-tool",
      "policy",
      "verification",
      "publish-precondition",
      "budget-split",
      "unexpected",
    ].includes(kind) ||
    typeof record["summary"] !== "string" ||
    typeof record["retryable"] !== "boolean" ||
    typeof record["resumable"] !== "boolean" ||
    !isStringArray(record["completedWork"]) ||
    !isStringArray(record["evidencePaths"]) ||
    !isStringArray(record["attemptedRecovery"]) ||
    !isStringArray(record["unrunValidations"]) ||
    typeof record["exactUnblockAction"] !== "string"
  ) {
    return null;
  }
  return {
    stage: record["stage"],
    code: record["code"],
    kind: kind as BoundaryWorkflowBlocker["kind"],
    summary: record["summary"],
    retryable: record["retryable"],
    resumable: record["resumable"],
    completedWork: record["completedWork"],
    evidencePaths: record["evidencePaths"],
    attemptedRecovery: record["attemptedRecovery"],
    unrunValidations: record["unrunValidations"],
    exactUnblockAction: record["exactUnblockAction"],
  };
}

function parseDiagnosticPublication(
  value: unknown,
): BoundaryWorkflowStatus["diagnosticPublication"] | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    (record["host"] !== "github" && record["host"] !== "gitlab") ||
    typeof record["url"] !== "string" ||
    typeof record["number"] !== "string" ||
    typeof record["created"] !== "boolean" ||
    typeof record["updated"] !== "boolean" ||
    typeof record["publishResultArtifactId"] !== "string"
  ) {
    return null;
  }
  return {
    host: record["host"],
    url: record["url"],
    number: record["number"],
    created: record["created"],
    updated: record["updated"],
    publishResultArtifactId: record["publishResultArtifactId"],
  };
}

function parseResumeContext(value: unknown): BoundaryWorkflowStatus["resumeContext"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const goal = record["goal"];
  const evidencePaths = record["evidencePaths"];
  const submissions = record["submissions"];
  if (typeof goal !== "string" || !isStringArray(evidencePaths) || !Array.isArray(submissions)) {
    return null;
  }
  const parsedSubmissions = submissions.flatMap((submission) => {
    if (typeof submission !== "object" || submission === null || Array.isArray(submission)) {
      return [];
    }
    const candidate = submission as Record<string, unknown>;
    return typeof candidate["kind"] === "string" &&
      typeof candidate["summary"] === "string" &&
      typeof candidate["outcome"] === "string"
      ? [
          {
            kind: candidate["kind"],
            summary: candidate["summary"],
            outcome: candidate["outcome"],
          },
        ]
      : [];
  });
  if (parsedSubmissions.length !== submissions.length) return null;
  return { goal, evidencePaths, submissions: parsedSubmissions };
}

function parseWorkload(value: unknown): BoundaryWorkflowStatus["workload"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const size = record["size"];
  const confidence = record["confidence"];
  const source = record["source"];
  const tokenRange = record["tokenRange"];
  const budget = record["budget"];
  if (
    typeof size !== "string" ||
    !["XS", "S", "M", "L", "XL"].includes(size) ||
    typeof confidence !== "string" ||
    !["low", "medium", "high"].includes(confidence) ||
    typeof source !== "string" ||
    !["intake", "contracts", "calibrated"].includes(source) ||
    !isTokenRange(tokenRange) ||
    !isBudget(budget)
  ) {
    return null;
  }
  return {
    size: size as WorkloadSize,
    confidence: confidence as BoundaryWorkflowStatus["workload"]["confidence"],
    source: source as BoundaryWorkflowStatus["workload"]["source"],
    tokenRange,
    budget,
  };
}

function isTokenRange(value: unknown): value is { min: number; max: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)["min"] === "number" &&
    typeof (value as Record<string, unknown>)["max"] === "number"
  );
}

function isBudget(
  value: unknown,
): value is { checkpointPercent: 80; checkpointAtTokens: number; hardLimitTokens: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record["checkpointPercent"] === 80 &&
    typeof record["checkpointAtTokens"] === "number" &&
    typeof record["hardLimitTokens"] === "number"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
