import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { z } from "zod";

import { assertBoundedPng } from "./png-decoder.js";
import {
  VisualMaskSchema,
  type VisualComparisonOutput,
  type VisualMask,
} from "./visual-comparator.js";
import type { VisualMemoryCheckpoint } from "./visual-memory.js";
import type {
  VisualComparisonWorkerRequest,
  VisualComparisonWorkerResponse,
} from "./visual-comparison-worker.js";

export const MAX_VISUAL_COMPARISON_WORKERS = 3;
export const MAX_ACTIVE_VISUAL_PIXELS = 8_000_000;
const MAX_ENCODED_PNG_BYTES_PER_PIXEL = 6;
const MAX_ENCODED_PNG_FIXED_OVERHEAD_BYTES = 64 * 1024;
const MAX_BATCH_CALLER_AND_OWNED_BYTES_PER_PIXEL =
  2 *
  (2 * 4 + // baseline and actual RGBA
    2 * MAX_ENCODED_PNG_BYTES_PER_PIXEL); // baseline and actual normalized PNGs
export const MAX_VISUAL_COMPARISON_BATCH_INPUT_BYTES =
  MAX_ACTIVE_VISUAL_PIXELS * MAX_BATCH_CALLER_AND_OWNED_BYTES_PER_PIXEL +
  4 * MAX_ENCODED_PNG_FIXED_OVERHEAD_BYTES;
const MAX_ACTIVE_VISUAL_ALLOCATION_BYTES_PER_PIXEL =
  2 * 4 + // decoded PNG inputs (RGBA transfers reuse owned snapshots)
  1 + // mask bitmap
  2 * 4 + // raw diff and overlay
  2 * MAX_ENCODED_PNG_BYTES_PER_PIXEL + // encoded diff and overlay
  2 * MAX_ENCODED_PNG_BYTES_PER_PIXEL; // worst-case response transfer copies
export const MAX_VISUAL_COMPARISON_ACTIVE_ALLOCATION_BYTES =
  MAX_ACTIVE_VISUAL_PIXELS * MAX_ACTIVE_VISUAL_ALLOCATION_BYTES_PER_PIXEL +
  4 * MAX_ENCODED_PNG_FIXED_OVERHEAD_BYTES;
export const MAX_VISUAL_COMPARISON_LIVE_BYTES =
  MAX_VISUAL_COMPARISON_BATCH_INPUT_BYTES + MAX_VISUAL_COMPARISON_ACTIVE_ALLOCATION_BYTES;
// Transferred inputs stay in the owned-snapshot charge. The active allowance
// covers only additional allocations, so the same bytes are never counted twice.
export const DEFAULT_VISUAL_COMPARISON_TIMEOUT_MS = 30_000;

export type VisualComparisonPoolJob = {
  targetId: string;
  baseline: Buffer;
  actual: Buffer;
  baselineRgba?: { data: Buffer; width: number; height: number };
  actualRgba?: { data: Buffer; width: number; height: number };
  masks?: VisualMask[];
  pixelTolerance?: number;
};

export type VisualComparisonPoolResult = {
  targetId: string;
  comparison: VisualComparisonOutput;
};

export type VisualComparisonPoolStats = {
  maximumWorkers: number;
  maximumActivePixels: number;
  maximumBatchInputBytes: number;
  workerCount: number;
  activeWorkers: number;
  activePixels: number;
  peakWorkers: number;
  peakActiveWorkers: number;
  peakActivePixels: number;
  currentManagedBytes: number;
  peakManagedBytes: number;
  completedJobs: number;
  failedJobs: number;
};

export type VisualComparisonMeasurement = {
  rssBaselineBytes: number;
  inFlightPeakRssBytes: number;
  inFlightRssDeltaBytes: number;
  peakManagedBytes: number;
  peakManagedStage: string;
  projectedBatchInputBytes: number;
  callerSourceBytes: number;
  ownedSnapshotBytes: number;
  checkpoints: VisualMemoryCheckpoint[];
};

type ValidatedSourceJob = {
  targetId: string;
  baseline: Buffer;
  actual: Buffer;
  baselineRgba?: { data: Buffer; width: number; height: number };
  actualRgba?: { data: Buffer; width: number; height: number };
  masks: VisualMask[];
  pixelTolerance?: number;
  pixels: number;
  sourceBuffers: Buffer[];
  sourceManagedBytes: number;
  projectedOwnedBytes: number;
};

type ValidatedJob = {
  targetId: string;
  baseline: Buffer<ArrayBuffer>;
  actual: Buffer<ArrayBuffer>;
  baselineRgba?: { data: Buffer<ArrayBuffer>; width: number; height: number };
  actualRgba?: { data: Buffer<ArrayBuffer>; width: number; height: number };
  masks: VisualMask[];
  pixelTolerance?: number;
  pixels: number;
  ownedManagedBytes: number;
};

type PendingJob = {
  id: number;
  job: ValidatedJob;
  resolve: (result: VisualComparisonPoolResult) => void;
  reject: (error: Error) => void;
  tracker: MeasurementTracker;
  managedBytes: number;
  retainedOwnedBytes: number;
  settled: boolean;
};

type MeasurementTracker = {
  pending: PendingJob[];
  rssBaselineBytes: number;
  inFlightPeakRssBytes: number;
  peakManagedBytes: number;
  peakManagedStage: string;
  externalManagedBytes: number;
  projectedBatchInputBytes: number;
  callerSourceBytes: number;
  ownedSnapshotBytes: number;
  checkpoints: VisualMemoryCheckpoint[];
};

type WorkerSlot = {
  worker: Worker;
  current: PendingJob | undefined;
  timeout: NodeJS.Timeout | undefined;
};

type VisualComparisonPoolOptions = {
  maximumWorkers?: number;
  maximumActivePixels?: number;
  maximumBatchInputBytes?: number;
  timeoutMs?: number;
  workerUrl?: URL;
};

const TargetIdSchema = z.string().trim().min(1).max(200);

export class VisualComparisonPool {
  private readonly maximumWorkers: number;
  private readonly maximumActivePixels: number;
  private readonly maximumBatchInputBytes: number;
  private readonly timeoutMs: number;
  private readonly workerUrl: URL;
  private readonly workerExecArgv: string[] | undefined;
  private readonly workers = new Set<WorkerSlot>();
  private readonly queue: PendingJob[] = [];
  private activePixels = 0;
  private peakWorkers = 0;
  private peakActiveWorkers = 0;
  private peakActivePixels = 0;
  private currentManagedBytes = 0;
  private peakManagedBytes = 0;
  private completedJobs = 0;
  private failedJobs = 0;
  private nextJobId = 1;
  private closing = false;

  public constructor(options: VisualComparisonPoolOptions = {}) {
    this.maximumWorkers = boundedPositiveInteger(
      options.maximumWorkers ?? MAX_VISUAL_COMPARISON_WORKERS,
      MAX_VISUAL_COMPARISON_WORKERS,
      "maximum workers",
    );
    this.maximumActivePixels = boundedPositiveInteger(
      options.maximumActivePixels ?? MAX_ACTIVE_VISUAL_PIXELS,
      MAX_ACTIVE_VISUAL_PIXELS,
      "maximum active pixels",
    );
    this.maximumBatchInputBytes = boundedPositiveInteger(
      options.maximumBatchInputBytes ?? MAX_VISUAL_COMPARISON_BATCH_INPUT_BYTES,
      MAX_VISUAL_COMPARISON_BATCH_INPUT_BYTES,
      "batch input bytes",
    );
    this.timeoutMs = boundedPositiveInteger(
      options.timeoutMs ?? DEFAULT_VISUAL_COMPARISON_TIMEOUT_MS,
      Number.MAX_SAFE_INTEGER,
      "worker timeout",
    );
    if (options.workerUrl !== undefined) {
      this.workerUrl = options.workerUrl;
      this.workerExecArgv = undefined;
    } else {
      const bundledWorkerUrl = new URL("./visual-comparison-worker.js", import.meta.url);
      if (bundledWorkerUrl.protocol === "file:" && !existsSync(fileURLToPath(bundledWorkerUrl))) {
        this.workerUrl = new URL("./visual-comparison-worker.ts", import.meta.url);
        this.workerExecArgv = ["--import", "tsx"];
      } else {
        this.workerUrl = bundledWorkerUrl;
        this.workerExecArgv = undefined;
      }
    }
  }

  public async compare(
    rawJobs: readonly VisualComparisonPoolJob[],
  ): Promise<VisualComparisonPoolResult[]> {
    return (await this.compareMeasured(rawJobs)).results;
  }

  public async compareMeasured(rawJobs: readonly VisualComparisonPoolJob[]): Promise<{
    results: VisualComparisonPoolResult[];
    measurement: VisualComparisonMeasurement;
  }> {
    if (this.closing) {
      throw new Error("VISUAL_COMPARISON_POOL_CLOSED: comparison pool is closed");
    }
    const rssBaselineBytes = process.memoryUsage().rss;
    const tracker: MeasurementTracker = {
      pending: [],
      rssBaselineBytes,
      inFlightPeakRssBytes: rssBaselineBytes,
      peakManagedBytes: 0,
      peakManagedStage: "empty",
      externalManagedBytes: 0,
      projectedBatchInputBytes: 0,
      callerSourceBytes: 0,
      ownedSnapshotBytes: 0,
      checkpoints: [],
    };
    const validatedJobs = rawJobs.map((job) => validateJob(job));
    for (const job of validatedJobs) {
      if (job.pixels > this.maximumActivePixels) {
        throw new Error(
          `VISUAL_COMPARISON_PIXEL_BUDGET: target ${job.targetId} requires ${job.pixels} active pixels; maximum is ${this.maximumActivePixels}`,
        );
      }
    }
    const seenSourceBuffers = new Set<Buffer>();
    for (const job of validatedJobs) {
      job.sourceManagedBytes = job.sourceBuffers.reduce((total, buffer) => {
        if (seenSourceBuffers.has(buffer)) return total;
        seenSourceBuffers.add(buffer);
        return total + buffer.byteLength;
      }, 0);
    }
    const callerSourceBytes = validatedJobs.reduce(
      (total, job) => total + job.sourceManagedBytes,
      0,
    );
    const ownedSnapshotBytes = validatedJobs.reduce(
      (total, job) => total + job.projectedOwnedBytes,
      0,
    );
    const projectedBatchInputBytes = callerSourceBytes + ownedSnapshotBytes;
    if (projectedBatchInputBytes > this.maximumBatchInputBytes) {
      throw new Error(
        `VISUAL_COMPARISON_BATCH_BYTE_BUDGET: batch requires ${projectedBatchInputBytes} bytes (${callerSourceBytes} caller + ${ownedSnapshotBytes} owned snapshots); maximum is ${this.maximumBatchInputBytes}`,
      );
    }
    tracker.projectedBatchInputBytes = projectedBatchInputBytes;
    tracker.callerSourceBytes = callerSourceBytes;
    tracker.ownedSnapshotBytes = ownedSnapshotBytes;
    if (validatedJobs.length === 0) {
      return {
        results: [],
        measurement: finishMeasurement(tracker),
      };
    }
    const jobs = validatedJobs.map((job) => snapshotJob(job));
    this.ensureWorkerCount(Math.min(this.maximumWorkers, jobs.length));
    tracker.externalManagedBytes = callerSourceBytes;
    this.currentManagedBytes += callerSourceBytes;
    const pendingPromises = jobs.map(
      (job) =>
        new Promise<VisualComparisonPoolResult>((resolve, reject) => {
          const pending: PendingJob = {
            id: this.nextJobId++,
            job,
            resolve,
            reject,
            tracker,
            managedBytes: job.ownedManagedBytes,
            retainedOwnedBytes: job.ownedManagedBytes,
            settled: false,
          };
          tracker.pending.push(pending);
          this.queue.push(pending);
          this.currentManagedBytes += pending.managedBytes;
        }),
    );
    this.observeTracker(tracker, "parent-validated-inputs", {
      callerSources: callerSourceBytes,
      ownedSnapshots: ownedSnapshotBytes,
      projectedBatchInputs: projectedBatchInputBytes,
    });
    this.observeTracker(tracker, "parent-queued-owned-inputs", {
      ownedSnapshots: ownedSnapshotBytes,
    });
    const sampleRss = () => {
      tracker.inFlightPeakRssBytes = Math.max(
        tracker.inFlightPeakRssBytes,
        process.memoryUsage().rss,
      );
    };
    const sampler = setInterval(sampleRss, 1);
    sampler.unref();
    this.schedule();
    let settled: PromiseSettledResult<VisualComparisonPoolResult>[];
    try {
      settled = await Promise.allSettled(pendingPromises);
      sampleRss();
    } finally {
      clearInterval(sampler);
      sampleRss();
      for (const pending of tracker.pending) this.setPendingManagedBytes(pending, 0);
      this.releaseExternalManagedBytes(tracker);
    }
    const firstFailure = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (firstFailure !== undefined) throw firstFailure.reason;
    return {
      results: settled.map(
        (result) => (result as PromiseFulfilledResult<VisualComparisonPoolResult>).value,
      ),
      measurement: finishMeasurement(tracker),
    };
  }

  public snapshotStats(): VisualComparisonPoolStats {
    const activeWorkers = [...this.workers].filter((slot) => slot.current !== undefined).length;
    return {
      maximumWorkers: this.maximumWorkers,
      maximumActivePixels: this.maximumActivePixels,
      maximumBatchInputBytes: this.maximumBatchInputBytes,
      workerCount: this.workers.size,
      activeWorkers,
      activePixels: this.activePixels,
      peakWorkers: this.peakWorkers,
      peakActiveWorkers: this.peakActiveWorkers,
      peakActivePixels: this.peakActivePixels,
      currentManagedBytes: this.currentManagedBytes,
      peakManagedBytes: this.peakManagedBytes,
      completedJobs: this.completedJobs,
      failedJobs: this.failedJobs,
    };
  }

  public async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    const closed = new Error("VISUAL_COMPARISON_POOL_CLOSED: comparison pool is closed");
    for (const pending of this.queue.splice(0)) this.rejectPending(pending, closed);
    const workers = [...this.workers];
    this.workers.clear();
    await Promise.all(
      workers.map(async (slot) => {
        if (slot.timeout !== undefined) clearTimeout(slot.timeout);
        if (slot.current !== undefined) {
          this.activePixels -= slot.current.job.pixels;
          this.rejectPending(slot.current, closed);
          slot.current = undefined;
        }
        await slot.worker.terminate();
      }),
    );
  }

  private ensureWorkerCount(count: number): void {
    while (!this.closing && this.workers.size < count) {
      const worker = new Worker(this.workerUrl, {
        ...(this.workerExecArgv === undefined ? {} : { execArgv: this.workerExecArgv }),
      });
      worker.unref();
      const slot: WorkerSlot = { worker, current: undefined, timeout: undefined };
      this.workers.add(slot);
      this.peakWorkers = Math.max(this.peakWorkers, this.workers.size);
      worker.on("message", (response: VisualComparisonWorkerResponse) => {
        this.handleResponse(slot, response);
      });
      worker.on("error", (error) => {
        this.handleWorkerFailure(slot, error);
      });
      worker.on("exit", (code) => {
        if (this.workers.has(slot)) {
          this.handleWorkerFailure(slot, new Error(`worker exited with status ${String(code)}`));
        }
      });
    }
  }

  private schedule(): void {
    if (this.closing) return;
    for (;;) {
      const slot = [...this.workers].find((candidate) => candidate.current === undefined);
      if (slot === undefined) return;
      const availablePixels = this.maximumActivePixels - this.activePixels;
      const queueIndex = this.queue.findIndex((pending) => pending.job.pixels <= availablePixels);
      if (queueIndex < 0) return;
      const pending = this.queue.splice(queueIndex, 1)[0]!;
      this.dispatch(slot, pending);
    }
  }

  private dispatch(slot: WorkerSlot, pending: PendingJob): void {
    slot.worker.ref();
    slot.current = pending;
    this.activePixels += pending.job.pixels;
    const activeWorkers = [...this.workers].filter(
      (candidate) => candidate.current !== undefined,
    ).length;
    this.peakActiveWorkers = Math.max(this.peakActiveWorkers, activeWorkers);
    this.peakActivePixels = Math.max(this.peakActivePixels, this.activePixels);
    const baselineData = pending.job.baselineRgba?.data ?? pending.job.baseline;
    const actualData = pending.job.actualRgba?.data ?? pending.job.actual;
    const transferableBytes = baselineData.byteLength + actualData.byteLength;
    pending.retainedOwnedBytes = pending.job.ownedManagedBytes - transferableBytes;
    this.setPendingManagedBytes(pending, pending.job.ownedManagedBytes, "parent-transfer-inputs", {
      retainedOwnedInputs: pending.retainedOwnedBytes,
      transferableInputs: transferableBytes,
    });
    const request: VisualComparisonWorkerRequest = {
      jobId: pending.id,
      baseline:
        pending.job.baselineRgba === undefined
          ? { kind: "png", data: baselineData }
          : {
              kind: "rgba",
              data: baselineData,
              width: pending.job.baselineRgba.width,
              height: pending.job.baselineRgba.height,
            },
      actual:
        pending.job.actualRgba === undefined
          ? { kind: "png", data: actualData }
          : {
              kind: "rgba",
              data: actualData,
              width: pending.job.actualRgba.width,
              height: pending.job.actualRgba.height,
            },
      masks: pending.job.masks,
      ...(pending.job.pixelTolerance === undefined
        ? {}
        : { pixelTolerance: pending.job.pixelTolerance }),
    };
    slot.timeout = setTimeout(() => {
      this.failAndReplaceSlot(
        slot,
        new Error(
          `VISUAL_COMPARISON_WORKER_TIMEOUT: target ${pending.job.targetId} exceeded ${this.timeoutMs}ms`,
        ),
      );
    }, this.timeoutMs);
    slot.timeout.unref();
    slot.worker.postMessage(request, [baselineData.buffer, actualData.buffer]);
  }

  private handleResponse(slot: WorkerSlot, response: VisualComparisonWorkerResponse): void {
    const pending = slot.current;
    if (pending === undefined || response.jobId !== pending.id) {
      this.failAndReplaceSlot(
        slot,
        new Error("VISUAL_COMPARISON_WORKER_PROTOCOL: received an unexpected job response"),
      );
      return;
    }
    if (response.kind === "memory") {
      this.setPendingManagedBytes(
        pending,
        pending.retainedOwnedBytes + response.checkpoint.managedBytes,
        response.checkpoint.stage,
        {
          retainedOwnedInputs: pending.retainedOwnedBytes,
          ...response.checkpoint.ownership,
        },
        response.checkpoint.rssBytes,
      );
      return;
    }
    if (response.ok) {
      const outputBytes =
        response.comparison.diff.byteLength + response.comparison.overlay.byteLength;
      this.setPendingManagedBytes(pending, outputBytes, "parent-result-outputs", {
        resultOutputs: outputBytes,
      });
    }
    this.releaseSlot(slot);
    if (response.ok) {
      this.completedJobs += 1;
      this.resolvePending(pending, {
        targetId: pending.job.targetId,
        comparison: {
          ...response.comparison,
          diff: zeroCopyBuffer(response.comparison.diff),
          overlay: zeroCopyBuffer(response.comparison.overlay),
        },
      });
    } else {
      this.failedJobs += 1;
      this.rejectPending(
        pending,
        new Error(`VISUAL_COMPARISON_FAILED: target ${pending.job.targetId}: ${response.error}`),
      );
    }
    this.schedule();
  }

  private handleWorkerFailure(slot: WorkerSlot, cause: Error): void {
    const pending = slot.current;
    if (pending === undefined) {
      this.removeSlot(slot);
      this.ensureWorkerCount(Math.min(this.maximumWorkers, this.queue.length));
      this.schedule();
      return;
    }
    this.failAndReplaceSlot(
      slot,
      new Error(`VISUAL_COMPARISON_WORKER_CRASH: target ${pending.job.targetId}: ${cause.message}`),
    );
  }

  private failAndReplaceSlot(slot: WorkerSlot, error: Error): void {
    const pending = slot.current;
    this.releaseSlot(slot);
    this.removeSlot(slot);
    void slot.worker.terminate();
    if (pending !== undefined) {
      this.failedJobs += 1;
      this.rejectPending(pending, error);
    }
    this.ensureWorkerCount(Math.min(this.maximumWorkers, this.queue.length));
    this.schedule();
  }

  private releaseSlot(slot: WorkerSlot): void {
    if (slot.timeout !== undefined) {
      clearTimeout(slot.timeout);
      slot.timeout = undefined;
    }
    if (slot.current !== undefined) {
      this.activePixels -= slot.current.job.pixels;
      slot.current = undefined;
    }
    slot.worker.unref();
  }

  private removeSlot(slot: WorkerSlot): void {
    this.workers.delete(slot);
  }

  private setPendingManagedBytes(
    pending: PendingJob,
    managedBytes: number,
    stage?: string,
    ownership?: Record<string, number>,
    rssBytes: number = process.memoryUsage().rss,
  ): void {
    if (pending.settled) return;
    this.currentManagedBytes += managedBytes - pending.managedBytes;
    pending.managedBytes = managedBytes;
    if (stage !== undefined && ownership !== undefined) {
      this.observeTracker(pending.tracker, stage, ownership, rssBytes);
    }
  }

  private releaseExternalManagedBytes(tracker: MeasurementTracker): void {
    this.currentManagedBytes -= tracker.externalManagedBytes;
    tracker.externalManagedBytes = 0;
  }

  private resolvePending(pending: PendingJob, result: VisualComparisonPoolResult): void {
    if (pending.settled) return;
    this.setPendingManagedBytes(pending, 0);
    pending.settled = true;
    pending.resolve(result);
  }

  private rejectPending(pending: PendingJob, error: Error): void {
    if (pending.settled) return;
    this.setPendingManagedBytes(pending, 0);
    pending.settled = true;
    pending.reject(error);
  }

  private observeTracker(
    tracker: MeasurementTracker,
    stage: string,
    ownership: Record<string, number>,
    rssBytes: number = process.memoryUsage().rss,
  ): void {
    const managedBytes = tracker.pending.reduce(
      (total, pending) => total + pending.managedBytes,
      tracker.externalManagedBytes,
    );
    const checkpoint: VisualMemoryCheckpoint = {
      stage,
      managedBytes,
      rssBytes,
      ownership: {
        externalCallerSources: tracker.externalManagedBytes,
        ...ownership,
      },
    };
    tracker.checkpoints.push(checkpoint);
    tracker.inFlightPeakRssBytes = Math.max(tracker.inFlightPeakRssBytes, rssBytes);
    if (managedBytes > tracker.peakManagedBytes) {
      tracker.peakManagedBytes = managedBytes;
      tracker.peakManagedStage = stage;
    }
    this.peakManagedBytes = Math.max(this.peakManagedBytes, this.currentManagedBytes);
  }
}

export const defaultVisualComparisonPool = new VisualComparisonPool();

function finishMeasurement(tracker: MeasurementTracker): VisualComparisonMeasurement {
  return {
    rssBaselineBytes: tracker.rssBaselineBytes,
    inFlightPeakRssBytes: tracker.inFlightPeakRssBytes,
    inFlightRssDeltaBytes: Math.max(0, tracker.inFlightPeakRssBytes - tracker.rssBaselineBytes),
    peakManagedBytes: tracker.peakManagedBytes,
    peakManagedStage: tracker.peakManagedStage,
    projectedBatchInputBytes: tracker.projectedBatchInputBytes,
    callerSourceBytes: tracker.callerSourceBytes,
    ownedSnapshotBytes: tracker.ownedSnapshotBytes,
    checkpoints: tracker.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      ownership: { ...checkpoint.ownership },
    })),
  };
}

function validateJob(job: VisualComparisonPoolJob): ValidatedSourceJob {
  const targetId = TargetIdSchema.parse(job.targetId);
  assertBoundedPng(job.baseline, `${targetId} baseline`);
  assertBoundedPng(job.actual, `${targetId} actual`);
  const baselineWidth = job.baseline.readUInt32BE(16);
  const baselineHeight = job.baseline.readUInt32BE(20);
  const actualWidth = job.actual.readUInt32BE(16);
  const actualHeight = job.actual.readUInt32BE(20);
  if (baselineWidth !== actualWidth || baselineHeight !== actualHeight) {
    throw new Error(
      `VISUAL_DIMENSION_MISMATCH: target ${targetId} baseline is ${baselineWidth}x${baselineHeight}, actual is ${actualWidth}x${actualHeight}`,
    );
  }
  const pixels = baselineWidth * baselineHeight;
  const maximumEncodedBytes =
    pixels * MAX_ENCODED_PNG_BYTES_PER_PIXEL + MAX_ENCODED_PNG_FIXED_OVERHEAD_BYTES;
  if (
    job.baseline.byteLength > maximumEncodedBytes ||
    job.actual.byteLength > maximumEncodedBytes
  ) {
    throw new Error(
      `VISUAL_ENCODED_BYTE_BUDGET: target ${targetId} PNG inputs exceed ${maximumEncodedBytes} bytes each`,
    );
  }
  if ((job.baselineRgba === undefined) !== (job.actualRgba === undefined)) {
    throw new Error(
      `VISUAL_COMPARISON_INVALID_INPUT: target ${targetId} decoded baseline and actual must be supplied together`,
    );
  }
  const baselineRgba =
    job.baselineRgba === undefined
      ? undefined
      : validateRgba(job.baselineRgba, targetId, "baseline", baselineWidth, baselineHeight);
  const actualRgba =
    job.actualRgba === undefined
      ? undefined
      : validateRgba(job.actualRgba, targetId, "actual", actualWidth, actualHeight);
  const masks = z
    .array(VisualMaskSchema)
    .max(50)
    .parse(job.masks ?? []);
  const pixelTolerance =
    job.pixelTolerance === undefined
      ? undefined
      : z.number().min(0).max(1).parse(job.pixelTolerance);
  return {
    targetId,
    baseline: job.baseline,
    actual: job.actual,
    ...(baselineRgba === undefined ? {} : { baselineRgba }),
    ...(actualRgba === undefined ? {} : { actualRgba }),
    masks,
    ...(pixelTolerance === undefined ? {} : { pixelTolerance }),
    pixels,
    sourceBuffers: [
      job.baseline,
      job.actual,
      ...(baselineRgba === undefined ? [] : [baselineRgba.data]),
      ...(actualRgba === undefined ? [] : [actualRgba.data]),
    ],
    sourceManagedBytes: 0,
    projectedOwnedBytes:
      job.baseline.byteLength +
      job.actual.byteLength +
      (baselineRgba?.data.byteLength ?? 0) +
      (actualRgba?.data.byteLength ?? 0),
  };
}

function snapshotJob(job: ValidatedSourceJob): ValidatedJob {
  const baseline = ownTransferableBuffer(job.baseline);
  const actual = ownTransferableBuffer(job.actual);
  const baselineRgba =
    job.baselineRgba === undefined
      ? undefined
      : {
          ...job.baselineRgba,
          data: ownTransferableBuffer(job.baselineRgba.data),
        };
  const actualRgba =
    job.actualRgba === undefined
      ? undefined
      : {
          ...job.actualRgba,
          data: ownTransferableBuffer(job.actualRgba.data),
        };
  return {
    targetId: job.targetId,
    baseline,
    actual,
    ...(baselineRgba === undefined ? {} : { baselineRgba }),
    ...(actualRgba === undefined ? {} : { actualRgba }),
    masks: job.masks,
    ...(job.pixelTolerance === undefined ? {} : { pixelTolerance: job.pixelTolerance }),
    pixels: job.pixels,
    ownedManagedBytes: job.projectedOwnedBytes,
  };
}

function validateRgba(
  image: { data: Buffer; width: number; height: number },
  targetId: string,
  role: string,
  expectedWidth: number,
  expectedHeight: number,
): { data: Buffer; width: number; height: number } {
  if (
    !Buffer.isBuffer(image.data) ||
    image.width !== expectedWidth ||
    image.height !== expectedHeight ||
    image.data.byteLength !== image.width * image.height * 4
  ) {
    throw new Error(
      `VISUAL_INVALID_RGBA: target ${targetId} ${role} must match ${expectedWidth}x${expectedHeight}`,
    );
  }
  return {
    data: image.data,
    width: image.width,
    height: image.height,
  };
}

function zeroCopyBuffer(data: Uint8Array): Buffer {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function ownTransferableBuffer(source: Buffer): Buffer<ArrayBuffer> {
  const owned = Buffer.from(new ArrayBuffer(source.byteLength));
  source.copy(owned);
  return owned;
}

function boundedPositiveInteger(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`Visual comparison ${label} must be an integer from 1 to ${maximum}`);
  }
  return value;
}
