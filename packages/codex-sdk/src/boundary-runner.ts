import type { RunResult } from "@openai/codex-sdk";

import {
  accumulateUsage,
  decideBudgetAction,
  type AggregatedUsage,
  type WorkloadSize,
} from "./workload-budget.js";

export type BoundaryWorkflowStatus = {
  runId: string;
  status: "running" | "needs-external-action" | "blocked" | "publish-ready" | "completed";
  currentStage?: string;
  stages: unknown[];
  nextActions: unknown[];
  blockers: string[];
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

export type BoundaryThread = {
  readonly id: string | null;
  run(prompt: string, options?: { outputSchema?: unknown }): Promise<RunResult>;
};

export type BoundaryClient = {
  startThread(): BoundaryThread;
  resumeThread(threadId: string): BoundaryThread;
};

export type BoundaryRunState =
  | "completed"
  | "blocked"
  | "approval-required"
  | "split-required"
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
  budgetLocked?: boolean;
  requiredValidations: readonly string[];
  maxTurns: number;
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
  const items: RunResult["items"] = [];

  for (let index = 0; index < input.maxTurns; index += 1) {
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
    workflowStatus = currentStatus;
    if (input.budgetLocked === false) {
      activeHardLimitTokens =
        input.workloadHardLimits?.[currentStatus.workload.size] ??
        currentStatus.workload.budget.hardLimitTokens;
    }
    activeWorkloadSize = currentStatus.workload.size;
    activeRequiredValidations = [...currentStatus.requiredValidations];
    if (workflowStatus.status === "completed") {
      state = "completed";
      break;
    }
    if (workflowStatus.status === "blocked") {
      state = "blocked";
      break;
    }
    if (turn.usage === null) {
      state = "usage-unavailable";
      break;
    }

    const decision = decideBudgetAction({
      usedTokens: usage.totalTokens,
      hardLimitTokens: activeHardLimitTokens,
      checkpointed,
      workloadSize: activeWorkloadSize,
      requiredValidations: activeRequiredValidations,
    });
    if (decision.action === "approval-required" || decision.action === "split-required") {
      state = decision.action;
      break;
    }
    if (decision.action === "checkpoint") {
      if (index + 1 >= input.maxTurns) {
        state = "turn-limit";
        break;
      }
      checkpointed = true;
      checkpointCount += 1;
      thread = input.client.startThread();
      prompt = buildCompactCheckpointPrompt(workflowStatus, activeRequiredValidations);
      continue;
    }

    prompt = buildBoundaryContinuationPrompt(workflowStatus, activeRequiredValidations);
  }

  if (input.outputSchema !== undefined && (state === "completed" || state === "blocked")) {
    if (usage?.availability !== "complete") {
      outputFormatting = "usage-unavailable";
    } else if (usage.totalTokens >= activeHardLimitTokens) {
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
): string {
  return [
    "Resume the installed spec-to-pr workflow from this compact context checkpoint.",
    "Call workflow_status with the recorded runId first; durable workflow state and project files are authoritative.",
    "Complete only the next external action group, then stop after the returned workflow status. Independent functional and design reviews in the same action group may run in parallel.",
    "Do not waive, skip, or reduce required validation because of token pressure. Keep API and UI implementation in one context.",
    `Checkpoint: ${JSON.stringify(compactStatus(status, requiredValidations))}`,
  ].join("\n");
}

export function buildBoundaryContinuationPrompt(
  status: BoundaryWorkflowStatus,
  requiredValidations: readonly string[],
): string {
  return [
    `Continue spec-to-pr Run ${status.runId}.`,
    "Call workflow_status first, complete only the next external action group, and stop after its returned status. Independent functional and design reviews in the same group may run in parallel.",
    "Preserve every required validation; budget pressure never authorizes a waiver.",
    `Boundary: ${JSON.stringify(compactStatus(status, requiredValidations))}`,
  ].join("\n");
}

export function buildFinalResponsePrompt(status: BoundaryWorkflowStatus): string {
  return [
    `Format the final result for terminal spec-to-pr Run ${status.runId}.`,
    "Do not perform another workflow action or modify files. Use the durable status and evidence already produced in this thread.",
    `Terminal status: ${JSON.stringify(compactStatus(status, status.requiredValidations))}`,
  ].join("\n");
}

function compactStatus(status: BoundaryWorkflowStatus, requiredValidations: readonly string[]) {
  return {
    runId: status.runId,
    status: status.status,
    ...(status.currentStage === undefined ? {} : { currentStage: status.currentStage }),
    stages: status.stages,
    nextActions: status.nextActions,
    blockers: status.blockers,
    resumeContext: status.resumeContext,
    workload: status.workload,
    requiredValidations: [...requiredValidations],
  };
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
  const status = record["status"];
  const allowedStatuses = new Set([
    "running",
    "needs-external-action",
    "blocked",
    "publish-ready",
    "completed",
  ]);
  if (typeof runId !== "string" || typeof status !== "string" || !allowedStatuses.has(status)) {
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

  return {
    runId,
    status: status as BoundaryWorkflowStatus["status"],
    ...(currentStage === undefined ? {} : { currentStage }),
    stages: record["stages"],
    nextActions: record["nextActions"],
    blockers: record["blockers"],
    resumeContext,
    requiredValidations: record["requiredValidations"],
    workload,
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
