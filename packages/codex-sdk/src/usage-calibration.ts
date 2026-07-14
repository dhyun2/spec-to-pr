import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  defaultTokenRangeForWorkload,
  type DeliveryMode,
  type WorkloadSize,
} from "./workload-budget.js";

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
const MAX_HISTORY_BYTES = 1_048_576;
const MAX_HISTORY_RECORDS = 256;
const HISTORY_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;
const SAFE_OPEN_FLAGS = (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const recordQueues = new Map<string, Promise<void>>();

export class UsageCalibrationStore {
  public constructor(
    public readonly filePath: string,
    private readonly options: { excludedRoot?: string } = {},
  ) {}

  public async record(rawSample: UsageCalibrationSample): Promise<void> {
    const sample = parseSample(rawSample);
    const queueKey = path.resolve(this.filePath);
    const previous = recordQueues.get(queueKey) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.recordExclusive(sample));
    recordQueues.set(queueKey, current);

    try {
      await current;
    } finally {
      if (recordQueues.get(queueKey) === current) recordQueues.delete(queueKey);
    }
  }

  private async recordExclusive(sample: UsageCalibrationSample): Promise<void> {
    await this.assertLocationAllowed();
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await this.assertLocationAllowed();
    const releaseLock = await acquireFileLock(`${this.filePath}.lock`);

    try {
      const retained = retainRecent([...(await this.read()), sample]);
      const content = `${retained.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
      if (Buffer.byteLength(content) > MAX_HISTORY_BYTES) {
        throw new Error("Usage calibration history exceeds its byte limit");
      }

      await this.assertLocationAllowed();
      await writeAtomically(this.filePath, content);
    } finally {
      await releaseLock();
    }
  }

  public async read(): Promise<UsageCalibrationSample[]> {
    await this.assertLocationAllowed();
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | SAFE_OPEN_FLAGS);
    } catch (error: unknown) {
      if (isMissingFile(error)) return [];
      throw error;
    }

    try {
      const metadata = await assertSafeRegularFile(handle);
      if (metadata.size > MAX_HISTORY_BYTES) {
        throw new Error("Usage calibration history exceeds its byte limit");
      }
      const content = await readBounded(handle, metadata.size);
      return retainRecent(
        content
          .split(/\r?\n/)
          .filter((line) => line.trim() !== "")
          .flatMap((line) => {
            try {
              return [parseSample(JSON.parse(line) as unknown)];
            } catch {
              return [];
            }
          }),
      );
    } finally {
      await handle.close();
    }
  }

  private async assertLocationAllowed(): Promise<void> {
    if (this.options.excludedRoot === undefined) return;
    const [root, candidate] = await Promise.all([
      canonicalizeThroughExistingAncestor(this.options.excludedRoot),
      canonicalizeThroughExistingAncestor(this.filePath),
    ]);
    if (isWithinDirectory(root, candidate)) {
      throw new Error("Usage calibration history must stay outside the target repository");
    }
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
        sample.workloadSize === input.workloadSize &&
        sample.hardLimitTokens === defaultTokenRangeForWorkload(sample.workloadSize).max,
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

async function assertSafeRegularFile(handle: Awaited<ReturnType<typeof open>>) {
  const metadata = await handle.stat();
  if (!metadata.isFile() || metadata.nlink !== 1) {
    throw new Error("Usage calibration history must be a regular single-link file");
  }
  return metadata;
}

function retainRecent(samples: readonly UsageCalibrationSample[]): UsageCalibrationSample[] {
  const cutoff = Date.now() - HISTORY_RETENTION_MS;
  return samples
    .filter((sample) => sample.recordedAtEpochMs >= cutoff)
    .sort((left, right) => left.recordedAtEpochMs - right.recordedAtEpochMs)
    .slice(-MAX_HISTORY_RECORDS);
}

async function canonicalizeThroughExistingAncestor(candidate: string): Promise<string> {
  let current = path.resolve(candidate);
  const missingSegments: string[] = [];

  while (true) {
    try {
      return path.resolve(await realpath(current), ...missingSegments);
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(candidate);
      missingSegments.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isWithinDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function readBounded(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
): Promise<string> {
  const buffer = Buffer.alloc(size);
  let offset = 0;

  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }

  return buffer.subarray(0, offset).toString("utf8");
}

async function writeAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(
    temporaryPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | SAFE_OPEN_FLAGS,
    0o600,
  );

  try {
    await assertSafeRegularFile(handle);
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(temporaryPath, filePath);
  } catch (error: unknown) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function acquireFileLock(lockPath: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(
        lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | SAFE_OPEN_FLAGS,
        0o600,
      );
      await assertSafeRegularFile(handle);
      await handle.close();
      return async () => {
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (error: unknown) {
      if (!isAlreadyExists(error)) throw error;
      await delay(5);
    }
  }

  throw new Error("Usage calibration history is busy");
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
