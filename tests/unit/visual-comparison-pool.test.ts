import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_ACTIVE_VISUAL_PIXELS,
  MAX_VISUAL_COMPARISON_LIVE_BYTES,
  MAX_VISUAL_COMPARISON_WORKERS,
  VisualComparisonPool,
} from "../../src/visual/visual-comparison-pool.js";

const pools: VisualComparisonPool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

describe("visual comparison worker pool", () => {
  it("uses real workers, preserves target order, and bounds workers and active pixels", async () => {
    const pool = new VisualComparisonPool({
      maximumWorkers: 3,
      maximumActivePixels: 3,
      timeoutMs: 5_000,
    });
    pools.push(pool);
    const jobs = [
      job("first", 2, 1),
      job("second", 1, 1),
      job("third", 2, 1),
      job("fourth", 1, 1),
      job("fifth", 2, 1),
    ];

    const results = await pool.compare(jobs);

    expect(results.map((result) => result.targetId)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
      "fifth",
    ]);
    expect(results.every((result) => result.comparison.status === "passed")).toBe(true);
    expect(pool.snapshotStats()).toMatchObject({
      maximumWorkers: 3,
      maximumActivePixels: 3,
      peakWorkers: 3,
      currentManagedBytes: 0,
    });
    expect(pool.snapshotStats().peakActivePixels).toBeLessThanOrEqual(3);
    expect(pool.snapshotStats().peakManagedBytes).toBeGreaterThan(0);
  });

  it("reports a worker crash as an ordinary comparison failure", async () => {
    const pool = new VisualComparisonPool({
      workerUrl: new URL("data:text/javascript,process.exit(1)"),
      timeoutMs: 1_000,
    });
    pools.push(pool);

    await expect(pool.compare([job("crash", 1, 1)])).rejects.toThrow(
      /VISUAL_COMPARISON_WORKER_CRASH.*crash/,
    );
  });

  it("reports a worker timeout as an ordinary comparison failure", async () => {
    const source = encodeURIComponent(
      'import { parentPort } from "node:worker_threads"; parentPort.on("message", () => {});',
    );
    const pool = new VisualComparisonPool({
      workerUrl: new URL(`data:text/javascript,${source}`),
      timeoutMs: 25,
    });
    pools.push(pool);

    await expect(pool.compare([job("timeout", 1, 1)])).rejects.toThrow(
      /VISUAL_COMPARISON_WORKER_TIMEOUT.*timeout/,
    );
  });

  it("owns queued image bytes at admission before callers can mutate them", async () => {
    const pool = new VisualComparisonPool({
      maximumWorkers: 1,
      maximumActivePixels: 1,
      timeoutMs: 5_000,
    });
    pools.push(pool);
    const png = solidPng(1, 1);
    const queuedActual = Buffer.from([0, 0, 0, 255]);
    const queuedActualPng = Buffer.from(png);
    const comparison = pool.compare([
      {
        targetId: "active",
        baseline: png,
        actual: png,
        baselineRgba: { data: Buffer.from([0, 0, 0, 255]), width: 1, height: 1 },
        actualRgba: { data: Buffer.from([0, 0, 0, 255]), width: 1, height: 1 },
        masks: [],
      },
      {
        targetId: "queued",
        baseline: png,
        actual: png,
        baselineRgba: { data: Buffer.from([0, 0, 0, 255]), width: 1, height: 1 },
        actualRgba: { data: queuedActual, width: 1, height: 1 },
        masks: [],
      },
      {
        targetId: "queued-png",
        baseline: Buffer.from(png),
        actual: queuedActualPng,
        masks: [],
      },
    ]);

    queuedActual[0] = 255;
    queuedActualPng[45] = queuedActualPng[45]! ^ 0xff;

    await expect(comparison).resolves.toMatchObject([
      { targetId: "active", comparison: { status: "passed" } },
      { targetId: "queued", comparison: { status: "passed" } },
      { targetId: "queued-png", comparison: { status: "passed" } },
    ]);
    expect(pool.snapshotStats()).toMatchObject({
      activeWorkers: 0,
      currentManagedBytes: 0,
    });
  });

  it("does not reject a failed batch until every sibling has settled and released memory", async () => {
    const source = encodeURIComponent(`
      import { parentPort } from "node:worker_threads";
      parentPort.on("message", (request) => {
        if (request.jobId >= 3) {
          parentPort.postMessage({
            jobId: request.jobId,
            kind: "result",
            ok: true,
            comparison: {
              status: "passed",
              metrics: {},
              maskReasons: [],
              diff: new Uint8Array(),
              overlay: new Uint8Array(),
            },
          });
          return;
        }
        const delay = request.jobId === 1 ? 0 : 150;
        setTimeout(() => {
          parentPort.postMessage({
            jobId: request.jobId,
            kind: "memory",
            checkpoint: {
              stage: "controlled-failure",
              managedBytes: 32,
              rssBytes: process.memoryUsage().rss,
              ownership: { controlledFailure: 32 },
            },
          });
          parentPort.postMessage({
            jobId: request.jobId,
            kind: "result",
            ok: false,
            error: request.jobId === 1 ? "first failure" : "late sibling failure",
          });
        }, delay);
      });
    `);
    const pool = new VisualComparisonPool({
      maximumWorkers: 2,
      maximumActivePixels: 2,
      workerUrl: new URL(`data:text/javascript,${source}`),
      timeoutMs: 5_000,
    });
    pools.push(pool);

    await expect(
      pool.compare([job("first-failure", 1, 1), job("late-failure", 1, 1)]),
    ).rejects.toThrow(/VISUAL_COMPARISON_FAILED.*first-failure.*first failure/);

    expect(pool.snapshotStats()).toMatchObject({
      activeWorkers: 0,
      activePixels: 0,
      currentManagedBytes: 0,
      failedJobs: 2,
    });
    await expect(pool.compare([job("future", 1, 1)])).resolves.toMatchObject([
      { targetId: "future", comparison: { status: "passed" } },
    ]);
    expect(pool.snapshotStats()).toMatchObject({
      activeWorkers: 0,
      currentManagedBytes: 0,
      failedJobs: 2,
      completedJobs: 1,
    });
  });

  it("rejects encoded PNG ownership that exceeds the derived per-pixel ledger", async () => {
    const pool = new VisualComparisonPool();
    pools.push(pool);
    const png = solidPng(1, 1);
    const oversized = Buffer.concat([png, Buffer.alloc(66_000)]);

    await expect(
      pool.compare([
        {
          targetId: "encoded-overflow",
          baseline: oversized,
          actual: png,
          masks: [],
        },
      ]),
    ).rejects.toThrow(/VISUAL_ENCODED_BYTE_BUDGET/);
  });

  it("returns same-iteration RSS and ownership checkpoints for a measured comparison", async () => {
    const pool = new VisualComparisonPool();
    pools.push(pool);
    const png = solidPng(2, 1);

    const measured = await pool.compareMeasured([
      {
        targetId: "measured",
        baseline: png,
        actual: png,
        baselineRgba: { data: Buffer.alloc(8), width: 2, height: 1 },
        actualRgba: { data: Buffer.alloc(8), width: 2, height: 1 },
        masks: [],
      },
    ]);

    expect(measured.results).toHaveLength(1);
    expect(measured.measurement.inFlightPeakRssBytes).toBeGreaterThanOrEqual(
      measured.measurement.rssBaselineBytes,
    );
    expect(measured.measurement.inFlightRssDeltaBytes).toBe(
      measured.measurement.inFlightPeakRssBytes - measured.measurement.rssBaselineBytes,
    );
    expect(measured.measurement.peakManagedBytes).toBeGreaterThanOrEqual(34);
    expect(measured.measurement.checkpoints.map((checkpoint) => checkpoint.stage)).toEqual(
      expect.arrayContaining(["parent-validated-inputs", "comparator-rgba-outputs"]),
    );
    expect(pool.snapshotStats().currentManagedBytes).toBe(0);
  });

  it("measures a production worker comparison near the 8M-pixel gate under the derived budget", async () => {
    const pool = new VisualComparisonPool();
    pools.push(pool);
    const width = 4_000;
    const height = 1_999;
    const pixels = width * height;
    const png = solidPng(width, height);

    const measured = await pool.compareMeasured([
      {
        targetId: "near-limit",
        baseline: png,
        actual: png,
        baselineRgba: { data: Buffer.alloc(pixels * 4), width, height },
        actualRgba: { data: Buffer.alloc(pixels * 4), width, height },
        masks: [],
      },
    ]);

    expect(measured.results[0]?.comparison.status).toBe("passed");
    expect(pool.snapshotStats()).toMatchObject({
      maximumWorkers: MAX_VISUAL_COMPARISON_WORKERS,
      maximumActivePixels: MAX_ACTIVE_VISUAL_PIXELS,
      peakActivePixels: pixels,
      currentManagedBytes: 0,
    });
    expect(measured.measurement.peakManagedBytes).toBeLessThanOrEqual(
      MAX_VISUAL_COMPARISON_LIVE_BYTES,
    );
    expect(measured.measurement.peakManagedBytes).toBeGreaterThanOrEqual(pixels * 16);
    const admissionOwnership = measured.measurement.checkpoints.find(
      (checkpoint) => checkpoint.stage === "parent-validated-inputs",
    )?.ownership;
    expect(admissionOwnership?.callerSources).toBeGreaterThanOrEqual(pixels * 8);
    expect(admissionOwnership?.ownedSnapshots).toBeGreaterThanOrEqual(pixels * 8);
    expect(measured.measurement.inFlightRssDeltaBytes).toBeLessThanOrEqual(
      MAX_VISUAL_COMPARISON_LIVE_BYTES,
    );
  }, 30_000);
});

function job(targetId: string, width: number, height: number) {
  const png = solidPng(width, height);
  return {
    targetId,
    baseline: png,
    actual: png,
    masks: [],
  };
}

function solidPng(width: number, height: number): Buffer {
  const image = new PNG({ width, height });
  for (let offset = 3; offset < image.data.length; offset += 4) {
    image.data[offset] = 255;
  }
  return PNG.sync.write(image);
}
