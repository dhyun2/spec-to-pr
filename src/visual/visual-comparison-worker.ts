import { parentPort } from "node:worker_threads";

import {
  compareVisualRgba,
  compareVisualPngs,
  type VisualComparisonOutput,
  type VisualMask,
} from "./visual-comparator.js";
import type { VisualMemoryCheckpoint } from "./visual-memory.js";

export type VisualComparisonWorkerRequest = {
  jobId: number;
  baseline: VisualComparisonWorkerImage;
  actual: VisualComparisonWorkerImage;
  masks: VisualMask[];
  pixelTolerance?: number;
};

export type VisualComparisonWorkerImage =
  | { kind: "png"; data: Uint8Array }
  | { kind: "rgba"; data: Uint8Array; width: number; height: number };

export type VisualComparisonWorkerSuccess = {
  jobId: number;
  kind: "result";
  ok: true;
  comparison: Omit<VisualComparisonOutput, "diff" | "overlay"> & {
    diff: Uint8Array;
    overlay: Uint8Array;
  };
};

export type VisualComparisonWorkerFailure = {
  jobId: number;
  kind: "result";
  ok: false;
  error: string;
};

export type VisualComparisonWorkerMemory = {
  jobId: number;
  kind: "memory";
  checkpoint: VisualMemoryCheckpoint;
};

export type VisualComparisonWorkerResponse =
  VisualComparisonWorkerSuccess | VisualComparisonWorkerFailure | VisualComparisonWorkerMemory;

if (parentPort !== null) {
  parentPort.on("message", (request: VisualComparisonWorkerRequest) => {
    void compare(request);
  });
}

async function compare(request: VisualComparisonWorkerRequest): Promise<void> {
  try {
    const reportMemory = (checkpoint: VisualMemoryCheckpoint) => {
      const response: VisualComparisonWorkerMemory = {
        jobId: request.jobId,
        kind: "memory",
        checkpoint,
      };
      parentPort?.postMessage(response);
    };
    const baselineData = zeroCopyBuffer(request.baseline.data);
    const actualData = zeroCopyBuffer(request.actual.data);
    reportMemory({
      stage: "worker-inputs",
      managedBytes: baselineData.byteLength + actualData.byteLength,
      rssBytes: process.memoryUsage().rss,
      ownership: {
        workerInputs: baselineData.byteLength + actualData.byteLength,
      },
    });
    const options = {
      masks: request.masks,
      ...(request.pixelTolerance === undefined ? {} : { pixelTolerance: request.pixelTolerance }),
      onMemoryCheckpoint: reportMemory,
    };
    const comparison =
      request.baseline.kind === "rgba" && request.actual.kind === "rgba"
        ? await compareVisualRgba({
            baseline: {
              data: baselineData,
              width: request.baseline.width,
              height: request.baseline.height,
            },
            actual: {
              data: actualData,
              width: request.actual.width,
              height: request.actual.height,
            },
            ...options,
          })
        : request.baseline.kind === "png" && request.actual.kind === "png"
          ? await compareVisualPngs({
              baseline: baselineData,
              actual: actualData,
              ...options,
            })
          : (() => {
              throw new Error("VISUAL_COMPARISON_WORKER_PROTOCOL: image encodings must match");
            })();
    const diff = transferableView(comparison.diff);
    const overlay = transferableView(comparison.overlay);
    const transferCopyBytes =
      (diff.buffer === comparison.diff.buffer ? 0 : diff.byteLength) +
      (overlay.buffer === comparison.overlay.buffer ? 0 : overlay.byteLength);
    reportMemory({
      stage: "worker-response",
      managedBytes: comparison.diff.byteLength + comparison.overlay.byteLength + transferCopyBytes,
      rssBytes: process.memoryUsage().rss,
      ownership: {
        encodedOutputs: comparison.diff.byteLength + comparison.overlay.byteLength,
        responseTransferCopies: transferCopyBytes,
      },
    });
    const response: VisualComparisonWorkerSuccess = {
      jobId: request.jobId,
      kind: "result",
      ok: true,
      comparison: {
        ...comparison,
        diff,
        overlay,
      },
    };
    parentPort?.postMessage(response, [diff.buffer, overlay.buffer]);
  } catch (error: unknown) {
    const response: VisualComparisonWorkerFailure = {
      jobId: request.jobId,
      kind: "result",
      ok: false,
      error: error instanceof Error ? error.message : "unknown visual comparison error",
    };
    parentPort?.postMessage(response);
  }
}

function zeroCopyBuffer(data: Uint8Array): Buffer {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function transferableView(data: Buffer): Uint8Array<ArrayBuffer> {
  return data.buffer instanceof ArrayBuffer &&
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength
    ? new Uint8Array(data.buffer)
    : Uint8Array.from(data);
}
