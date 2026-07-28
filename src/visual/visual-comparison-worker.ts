import { parentPort } from "node:worker_threads";

import {
  compareVisualRgba,
  compareVisualPngs,
  type VisualComparisonOutput,
  type VisualMask,
} from "./visual-comparator.js";

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
  ok: true;
  comparison: Omit<VisualComparisonOutput, "diff" | "overlay"> & {
    diff: Uint8Array;
    overlay: Uint8Array;
  };
};

export type VisualComparisonWorkerFailure = {
  jobId: number;
  ok: false;
  error: string;
};

export type VisualComparisonWorkerResponse =
  VisualComparisonWorkerSuccess | VisualComparisonWorkerFailure;

if (parentPort !== null) {
  parentPort.on("message", (request: VisualComparisonWorkerRequest) => {
    void compare(request);
  });
}

async function compare(request: VisualComparisonWorkerRequest): Promise<void> {
  try {
    const options = {
      masks: request.masks,
      ...(request.pixelTolerance === undefined ? {} : { pixelTolerance: request.pixelTolerance }),
    };
    const comparison =
      request.baseline.kind === "rgba" && request.actual.kind === "rgba"
        ? await compareVisualRgba({
            baseline: {
              data: Buffer.from(request.baseline.data),
              width: request.baseline.width,
              height: request.baseline.height,
            },
            actual: {
              data: Buffer.from(request.actual.data),
              width: request.actual.width,
              height: request.actual.height,
            },
            ...options,
          })
        : request.baseline.kind === "png" && request.actual.kind === "png"
          ? await compareVisualPngs({
              baseline: Buffer.from(request.baseline.data),
              actual: Buffer.from(request.actual.data),
              ...options,
            })
          : (() => {
              throw new Error("VISUAL_COMPARISON_WORKER_PROTOCOL: image encodings must match");
            })();
    const diff = Uint8Array.from(comparison.diff);
    const overlay = Uint8Array.from(comparison.overlay);
    const response: VisualComparisonWorkerSuccess = {
      jobId: request.jobId,
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
      ok: false,
      error: error instanceof Error ? error.message : "unknown visual comparison error",
    };
    parentPort?.postMessage(response);
  }
}
