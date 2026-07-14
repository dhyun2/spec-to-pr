import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

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

const MODES = new Set<DeliveryMode>(["auto", "brief", "legacy", "feature", "figma"]);
const SIZES = new Set<WorkloadSize>(["XS", "S", "M", "L", "XL"]);

export class UsageCalibrationStore {
  public constructor(public readonly filePath: string) {}

  public async record(rawSample: UsageCalibrationSample): Promise<void> {
    const sample = parseSample(rawSample);
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await appendFile(this.filePath, `${JSON.stringify(sample)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  public async read(): Promise<UsageCalibrationSample[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (isMissingFile(error)) return [];
      throw error;
    }

    return content
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .flatMap((line) => {
        try {
          return [parseSample(JSON.parse(line) as unknown)];
        } catch {
          return [];
        }
      });
  }
}

export type UsageCalibrationPort = Pick<UsageCalibrationStore, "read" | "record">;

export function isUsageCalibrationReadEnabled(input: {
  enabled: boolean;
  resumed: boolean;
}): boolean {
  return input.enabled && !input.resumed;
}

export function isUsageCalibrationEligible(input: {
  completed: boolean;
  resumed: boolean;
  usageAvailability: "complete" | "partial" | "unavailable";
}): boolean {
  return input.completed && !input.resumed && input.usageAvailability === "complete";
}

export async function readCalibrationBestEffort(
  store: UsageCalibrationPort,
): Promise<{ samples: UsageCalibrationSample[]; status: "loaded" | "unavailable" }> {
  try {
    return { samples: await store.read(), status: "loaded" };
  } catch {
    return { samples: [], status: "unavailable" };
  }
}

export async function recordCalibrationBestEffort(
  store: UsageCalibrationPort,
  sample: UsageCalibrationSample,
): Promise<"recorded" | "unavailable"> {
  try {
    await store.record(sample);
    return "recorded";
  } catch {
    return "unavailable";
  }
}

export function calibrateTokenRange(input: {
  mode: DeliveryMode;
  workloadSize: WorkloadSize;
  fallback: { min: number; max: number };
  samples: readonly UsageCalibrationSample[];
}): {
  min: number;
  max: number;
  sampleCount: number;
  source: "intake" | "calibrated";
  confidence: "low" | "medium" | "high";
} {
  const totals = input.samples
    .filter(
      (sample) =>
        sample.completed &&
        sample.mode === input.mode &&
        sample.workloadSize === input.workloadSize,
    )
    .map((sample) => sample.totalTokens)
    .sort((left, right) => left - right);
  if (totals.length < 10) {
    return {
      ...input.fallback,
      sampleCount: totals.length,
      source: "intake",
      confidence: "low",
    };
  }

  const min = percentile(totals, 0.5);
  const max = Math.max(min + 1_000, percentile(totals, 0.9));
  const stableSpread = max / Math.max(1, min) <= 1.5;
  return {
    min,
    max,
    sampleCount: totals.length,
    source: "calibrated",
    confidence: totals.length >= 30 && stableSpread ? "high" : "medium",
  };
}

function parseSample(value: unknown): UsageCalibrationSample {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Usage calibration sample must be an object");
  }
  const record = value as Record<string, unknown>;
  const mode = record["mode"];
  const workloadSize = record["workloadSize"];
  if (record["version"] !== 1 || typeof mode !== "string" || !MODES.has(mode as DeliveryMode)) {
    throw new Error("Invalid usage calibration version or mode");
  }
  if (typeof workloadSize !== "string" || !SIZES.has(workloadSize as WorkloadSize)) {
    throw new Error("Invalid workload size");
  }

  const sample: UsageCalibrationSample = {
    version: 1,
    mode: mode as DeliveryMode,
    workloadSize: workloadSize as WorkloadSize,
    estimatedMinTokens: numberField(record, "estimatedMinTokens"),
    estimatedMaxTokens: numberField(record, "estimatedMaxTokens"),
    hardLimitTokens: numberField(record, "hardLimitTokens"),
    inputTokens: numberField(record, "inputTokens"),
    cachedInputTokens: numberField(record, "cachedInputTokens"),
    outputTokens: numberField(record, "outputTokens"),
    reasoningOutputTokens: numberField(record, "reasoningOutputTokens"),
    totalTokens: numberField(record, "totalTokens"),
    turnCount: numberField(record, "turnCount"),
    checkpointCount: numberField(record, "checkpointCount"),
    completed: booleanField(record, "completed"),
    recordedAtEpochMs: numberField(record, "recordedAtEpochMs"),
  };
  if (sample.estimatedMinTokens >= sample.estimatedMaxTokens) {
    throw new Error("Estimated token min must be below max");
  }
  if (
    sample.hardLimitTokens <= 0 ||
    sample.totalTokens !== sample.inputTokens + sample.outputTokens
  ) {
    throw new Error("Usage calibration total or hard limit is inconsistent");
  }
  return sample;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Usage calibration ${key} must be a non-negative safe integer`);
  }
  return value;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`Usage calibration ${key} must be boolean`);
  return value;
}

function percentile(sorted: readonly number[], ratio: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index]!;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
