import type { RunResult } from "@openai/codex-sdk";
import { type AggregatedUsage, type WorkloadSize } from "./workload-budget.js";
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
        submissions: Array<{
            kind: string;
            summary: string;
            outcome: string;
        }>;
    };
    requiredValidations: string[];
    workload: {
        size: WorkloadSize;
        confidence: "low" | "medium" | "high";
        source: "intake" | "contracts" | "calibrated";
        tokenRange: {
            min: number;
            max: number;
        };
        budget: {
            checkpointPercent: 80;
            checkpointAtTokens: number;
            hardLimitTokens: number;
        };
    };
};
export type BoundaryThread = {
    readonly id: string | null;
    run(prompt: string, options?: {
        outputSchema?: unknown;
    }): Promise<RunResult>;
};
export type BoundaryClient = {
    startThread(): BoundaryThread;
    resumeThread(threadId: string): BoundaryThread;
};
export type BoundaryRunState = "completed" | "blocked" | "split-required" | "run-mismatch" | "usage-unavailable" | "status-unavailable" | "turn-limit";
export declare function executeBudgetedBoundaryTurns(input: {
    client: BoundaryClient;
    initialPrompt: string;
    resumeThreadId?: string;
    outputSchema?: unknown;
    hardLimitTokens: number;
    workloadSize: WorkloadSize;
    workloadHardLimits?: Partial<Record<WorkloadSize, number>>;
    requiredValidations: readonly string[];
    maxTurns: number;
}): Promise<{
    threadId: string | null;
    finalResponse: string;
    items: RunResult["items"];
    usage: AggregatedUsage;
    state: BoundaryRunState;
    outputFormatting: "not-requested" | "not-terminal" | "applied" | "budget-skipped" | "usage-unavailable" | "failed";
    turnCount: number;
    checkpointCount: number;
    workflowStatus: BoundaryWorkflowStatus | null;
    requiredValidations: string[];
    workloadSize: WorkloadSize;
    hardLimitTokens: number;
}>;
export declare function extractWorkflowStatus(items: RunResult["items"]): BoundaryWorkflowStatus | null;
export declare function buildCompactCheckpointPrompt(status: BoundaryWorkflowStatus, requiredValidations: readonly string[], effectiveBudget: {
    usedTokens: number;
    hardLimitTokens: number;
}): string;
export declare function buildBoundaryContinuationPrompt(status: BoundaryWorkflowStatus, requiredValidations: readonly string[], effectiveBudget: {
    usedTokens: number;
    hardLimitTokens: number;
}): string;
export declare function buildFinalResponsePrompt(status: BoundaryWorkflowStatus): string;
