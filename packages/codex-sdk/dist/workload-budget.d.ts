import type { RunResult } from "@openai/codex-sdk";
export type WorkloadSize = "XS" | "S" | "M" | "L" | "XL";
export type DeliveryMode = "auto" | "brief" | "legacy" | "feature" | "figma";
export type SdkWorkloadEstimate = {
    size: WorkloadSize;
    confidence: "low" | "medium" | "high";
    source: "intake" | "contracts" | "calibrated";
    tokenRange: {
        min: number;
        max: number;
    };
    sampleCount: number;
};
export type AggregatedUsage = {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
    observedTurns: number;
    missingTurns: number;
    availability: "complete" | "partial" | "unavailable";
};
export declare function defaultTokenRangeForWorkload(size: WorkloadSize): {
    min: number;
    max: number;
};
export declare function estimateSdkWorkload(input: {
    deliveryMode: DeliveryMode;
    promptLength: number;
    hasBrief: boolean;
    hasFigma: boolean;
    hasOpenApi: boolean;
}): SdkWorkloadEstimate;
export declare function accumulateUsage(current: AggregatedUsage | null, usage: RunResult["usage"]): AggregatedUsage;
export declare function decideBudgetAction(input: {
    usedTokens: number;
    hardLimitTokens: number;
    checkpointed: boolean;
    workloadSize: WorkloadSize;
    requiredValidations: readonly string[];
}): {
    action: "continue" | "checkpoint" | "approval-required" | "split-required";
    requiredValidations: string[];
    thresholdTokens: number;
    shortfallTokens: number;
};
