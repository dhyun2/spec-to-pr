import type { DeliveryMode, WorkloadSize } from "./workload-budget.js";
export type UsageCalibrationSample = {
    version: 1;
    mode: DeliveryMode;
    workloadSize: WorkloadSize;
    estimatedMinTokens: number;
    estimatedMaxTokens: number;
    hardLimitTokens: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
    turnCount: number;
    checkpointCount: number;
    completed: boolean;
    recordedAtEpochMs: number;
};
export declare class UsageCalibrationStore {
    readonly filePath: string;
    constructor(filePath: string);
    record(rawSample: UsageCalibrationSample): Promise<void>;
    read(): Promise<UsageCalibrationSample[]>;
}
export type UsageCalibrationPort = Pick<UsageCalibrationStore, "read" | "record">;
export declare function isUsageCalibrationReadEnabled(input: {
    enabled: boolean;
    resumed: boolean;
}): boolean;
export declare function isUsageCalibrationEligible(input: {
    completed: boolean;
    resumed: boolean;
    usageAvailability: "complete" | "partial" | "unavailable";
}): boolean;
export declare function readCalibrationBestEffort(store: UsageCalibrationPort): Promise<{
    samples: UsageCalibrationSample[];
    status: "loaded" | "unavailable";
}>;
export declare function recordCalibrationBestEffort(store: UsageCalibrationPort, sample: UsageCalibrationSample): Promise<"recorded" | "unavailable">;
export declare function calibrateTokenRange(input: {
    mode: DeliveryMode;
    workloadSize: WorkloadSize;
    fallback: {
        min: number;
        max: number;
    };
    samples: readonly UsageCalibrationSample[];
}): {
    min: number;
    max: number;
    sampleCount: number;
    source: "intake" | "calibrated";
    confidence: "low" | "medium" | "high";
};
