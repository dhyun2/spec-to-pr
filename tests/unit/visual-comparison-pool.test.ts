import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_ACTIVE_VISUAL_PIXELS,
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
    });
    expect(pool.snapshotStats().peakActivePixels).toBeLessThanOrEqual(3);
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

  it("exports the production memory and concurrency budgets", () => {
    expect(MAX_VISUAL_COMPARISON_WORKERS).toBe(3);
    expect(MAX_ACTIVE_VISUAL_PIXELS).toBe(8_000_000);
  });
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
