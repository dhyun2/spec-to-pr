import type { RunResult } from "@openai/codex-sdk";
import { type AggregatedUsage, type WorkloadSize } from "./workload-budget.js";
export type BoundaryWorkflowStatus = {
    runId: string;
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
export type BoundaryWorkflowBlocker = {
    stage: string;
    code: string;
    kind: "missing-input" | "missing-tool" | "policy" | "verification" | "publish-precondition" | "budget-split" | "unexpected";
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
    run(prompt: string, options?: {
        outputSchema?: unknown;
    }): Promise<RunResult>;
};
export type BoundaryClient = {
    startThread(): BoundaryThread;
    resumeThread(threadId: string): BoundaryThread;
};
export type BlockedDiagnosticPreflight = {
    eligible: true;
    sourceBranch: string;
    targetBranch: string;
    remoteName: string;
} | {
    eligible: false;
    reason: string;
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
    inspectBlockedDiagnosticPreflight?: () => BlockedDiagnosticPreflight | Promise<BlockedDiagnosticPreflight>;
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
export declare function buildBlockedDiagnosticFinalizationPrompt(status: BoundaryWorkflowStatus, preflight?: Extract<BlockedDiagnosticPreflight, {
    eligible: true;
}>): string;
