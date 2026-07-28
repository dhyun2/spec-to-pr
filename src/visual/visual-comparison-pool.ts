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
import type {
  VisualComparisonWorkerRequest,
  VisualComparisonWorkerResponse,
} from "./visual-comparison-worker.js";

export const MAX_VISUAL_COMPARISON_WORKERS = 3;
export const MAX_ACTIVE_VISUAL_PIXELS = 8_000_000;
export const VISUAL_COMPARISON_MANAGED_BYTES_PER_PIXEL = 4 * 4;
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
  workerCount: number;
  activeWorkers: number;
  activePixels: number;
  peakWorkers: number;
  peakActiveWorkers: number;
  peakActivePixels: number;
  peakManagedBytes: number;
  completedJobs: number;
  failedJobs: number;
};

type ValidatedJob = {
  targetId: string;
  baseline: Buffer;
  actual: Buffer;
  baselineRgba?: { data: Buffer; width: number; height: number };
  actualRgba?: { data: Buffer; width: number; height: number };
  masks: VisualMask[];
  pixelTolerance?: number;
  pixels: number;
};

type PendingJob = {
  id: number;
  job: ValidatedJob;
  resolve: (result: VisualComparisonPoolResult) => void;
  reject: (error: Error) => void;
};

type WorkerSlot = {
  worker: Worker;
  current: PendingJob | undefined;
  timeout: NodeJS.Timeout | undefined;
};

type VisualComparisonPoolOptions = {
  maximumWorkers?: number;
  maximumActivePixels?: number;
  timeoutMs?: number;
  workerUrl?: URL;
};

const TargetIdSchema = z.string().trim().min(1).max(200);

export class VisualComparisonPool {
  private readonly maximumWorkers: number;
  private readonly maximumActivePixels: number;
  private readonly timeoutMs: number;
  private readonly workerUrl: URL;
  private readonly workerExecArgv: string[] | undefined;
  private readonly workers = new Set<WorkerSlot>();
  private readonly queue: PendingJob[] = [];
  private activePixels = 0;
  private peakWorkers = 0;
  private peakActiveWorkers = 0;
  private peakActivePixels = 0;
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
    if (this.closing) {
      throw new Error("VISUAL_COMPARISON_POOL_CLOSED: comparison pool is closed");
    }
    const jobs = rawJobs.map((job) => validateJob(job));
    if (jobs.length === 0) return [];
    for (const job of jobs) {
      if (job.pixels > this.maximumActivePixels) {
        throw new Error(
          `VISUAL_COMPARISON_PIXEL_BUDGET: target ${job.targetId} requires ${job.pixels} active pixels; maximum is ${this.maximumActivePixels}`,
        );
      }
    }
    this.ensureWorkerCount(Math.min(this.maximumWorkers, jobs.length));
    const pending = jobs.map(
      (job) =>
        new Promise<VisualComparisonPoolResult>((resolve, reject) => {
          this.queue.push({
            id: this.nextJobId++,
            job,
            resolve,
            reject,
          });
        }),
    );
    this.schedule();
    return Promise.all(pending);
  }

  public snapshotStats(): VisualComparisonPoolStats {
    const activeWorkers = [...this.workers].filter((slot) => slot.current !== undefined).length;
    return {
      maximumWorkers: this.maximumWorkers,
      maximumActivePixels: this.maximumActivePixels,
      workerCount: this.workers.size,
      activeWorkers,
      activePixels: this.activePixels,
      peakWorkers: this.peakWorkers,
      peakActiveWorkers: this.peakActiveWorkers,
      peakActivePixels: this.peakActivePixels,
      peakManagedBytes: this.peakActivePixels * VISUAL_COMPARISON_MANAGED_BYTES_PER_PIXEL,
      completedJobs: this.completedJobs,
      failedJobs: this.failedJobs,
    };
  }

  public async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    const closed = new Error("VISUAL_COMPARISON_POOL_CLOSED: comparison pool is closed");
    for (const pending of this.queue.splice(0)) pending.reject(closed);
    const workers = [...this.workers];
    this.workers.clear();
    await Promise.all(
      workers.map(async (slot) => {
        if (slot.timeout !== undefined) clearTimeout(slot.timeout);
        if (slot.current !== undefined) {
          this.activePixels -= slot.current.job.pixels;
          slot.current.reject(closed);
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
    const baselineData = Uint8Array.from(pending.job.baselineRgba?.data ?? pending.job.baseline);
    const actualData = Uint8Array.from(pending.job.actualRgba?.data ?? pending.job.actual);
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
    this.releaseSlot(slot);
    if (response.ok) {
      this.completedJobs += 1;
      pending.resolve({
        targetId: pending.job.targetId,
        comparison: {
          ...response.comparison,
          diff: Buffer.from(response.comparison.diff),
          overlay: Buffer.from(response.comparison.overlay),
        },
      });
    } else {
      this.failedJobs += 1;
      pending.reject(
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
      pending.reject(error);
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
}

export const defaultVisualComparisonPool = new VisualComparisonPool();

function validateJob(job: VisualComparisonPoolJob): ValidatedJob {
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
    baseline: Buffer.from(job.baseline),
    actual: Buffer.from(job.actual),
    ...(baselineRgba === undefined ? {} : { baselineRgba }),
    ...(actualRgba === undefined ? {} : { actualRgba }),
    masks,
    ...(pixelTolerance === undefined ? {} : { pixelTolerance }),
    pixels: baselineWidth * baselineHeight,
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
    data: Buffer.from(image.data),
    width: image.width,
    height: image.height,
  };
}

function boundedPositiveInteger(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`Visual comparison ${label} must be an integer from 1 to ${maximum}`);
  }
  return value;
}
