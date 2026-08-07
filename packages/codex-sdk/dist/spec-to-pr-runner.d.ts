import { type ApprovalMode, type ModelReasoningEffort, type RunResult, type SandboxMode } from "@openai/codex-sdk";
import { type BlockedDiagnosticPreflight, type BoundaryThread } from "./boundary-runner.js";
import { type AggregatedUsage, type SdkWorkloadEstimate } from "./workload-budget.js";
import { type CodexModelRouting, type CodexModelRoutingInput } from "./model-routing.js";
export declare const DEFAULT_BLOCKED_DIAGNOSTIC_TOKEN_RESERVE = 24000;
export declare const DEFAULT_BOUNDARY_TURN_TIMEOUT_MS: number;
export declare const DEFAULT_BOUNDARY_RUN_TIMEOUT_MS: number;
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
    figmaUrls?: string[];
    openApiPath?: string;
    openApiPaths?: string[];
    openApiUrl?: string;
    openApiUrls?: string[];
    guidancePaths?: string[];
    skillHints?: string[];
    resumeThreadId?: string;
    model?: string;
    /** Host-neutral strategy whose Codex mapping is Luna/Terra/Sol by default. */
    modelRouting?: CodexModelRoutingInput;
    modelReasoningEffort?: ModelReasoningEffort;
    sandboxMode?: SandboxMode;
    approvalPolicy?: ApprovalMode;
    additionalDirectories?: string[];
    codexPathOverride?: string;
    env?: Record<string, string>;
    outputSchema?: unknown;
    enableReviewAgents?: boolean;
    maxTurns?: number;
    /** Bound one model/tool turn so an unavailable dependency cannot keep the user waiting forever. */
    turnTimeoutMs?: number;
    /** Bound a complete user Run; release workflows can opt into a larger explicit budget. */
    runTimeoutMs?: number;
    blockedDiagnosticTokenReserve?: number;
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
        state: "completed" | "blocked" | "split-required" | "run-mismatch" | "usage-unavailable" | "status-unavailable" | "turn-limit" | "turn-timeout" | "run-timeout";
        checkpointPercent: 80;
        checkpointAtTokens: number;
        hardLimitTokens: number;
        usedTokens: number;
        checkpointCount: number;
        requiredValidations: string[];
        usageAvailability: AggregatedUsage["availability"];
        elapsedMs: number;
        turnTimeoutMs: number;
        runTimeoutMs: number;
        actionTurns: Array<{
            turn: number;
            elapsedMs: number;
            outcome: "completed" | "turn-timeout" | "run-timeout" | "failed";
        }>;
        formatTurn?: {
            elapsedMs: number;
            outcome: "completed" | "turn-timeout" | "run-timeout" | "failed";
        };
    };
    turnCount: number;
    outputFormatting: "not-requested" | "not-terminal" | "applied" | "budget-skipped" | "usage-unavailable" | "failed";
    usageCalibration: {
        enabled: boolean;
        read: "loaded" | "unavailable" | "disabled";
        write: "recorded" | "unavailable" | "skipped" | "disabled";
        sampleCount: number;
    };
    modelRouting: CodexModelRouting["workflow"];
};
export declare function runSpecToPrWithCodex(input: SpecToPrCodexRunInput): Promise<SpecToPrCodexRunResult>;
export declare function buildSpecToPrPrompt(input: SpecToPrCodexRunInput): string;
export declare function buildResumeSpecToPrPrompt(): string;
export declare function inspectBlockedDiagnosticPreflight(workingDirectory: string, configuredEnv?: Record<string, string>): BlockedDiagnosticPreflight;
export declare function validateSpecToPrRunInput(input: SpecToPrCodexRunInput): void;
export declare function adaptThread(thread: {
    readonly id: string | null;
    run(prompt: string, options?: {
        outputSchema?: unknown;
        signal?: AbortSignal;
    }): Promise<RunResult>;
}): BoundaryThread;
