import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

import { compareImages } from "../../scripts/lite/compare-images.js";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("compareImages", () => {
  it("returns 100% and writes an empty diff for equal PNGs", async () => {
    const directory = await createTemporaryDirectory();
    const baselinePath = path.join(directory, "baseline.png");
    const actualPath = path.join(directory, "actual.png");
    const diffPath = path.join(directory, "diff.png");
    const image = createPng(2, 2, [18, 52, 86, 255]);

    await Promise.all([writeFile(baselinePath, image), writeFile(actualPath, image)]);
    const result = await compareImages({ baselinePath, actualPath, diffPath });

    expect(result).toMatchObject({ matchRatio: 1, matchPercent: "100.00%", status: "passed" });
    expect((await readFile(diffPath)).byteLength).toBeGreaterThan(0);
  });

  it("reports a lower ratio and a failed status when a pixel differs", async () => {
    const directory = await createTemporaryDirectory();
    const baselinePath = path.join(directory, "baseline.png");
    const actualPath = path.join(directory, "actual.png");
    const diffPath = path.join(directory, "diff.png");
    const baseline = PNG.sync.read(createPng(2, 2, [0, 0, 0, 255]));
    baseline.data[0] = 255;
    baseline.data[1] = 255;
    baseline.data[2] = 255;

    await Promise.all([
      writeFile(baselinePath, PNG.sync.write(baseline)),
      writeFile(actualPath, createPng(2, 2, [0, 0, 0, 255])),
    ]);
    const result = await compareImages({
      baselinePath,
      actualPath,
      diffPath,
      pixelTolerance: 0,
    });

    expect(result.matchRatio).toBe(0.75);
    expect(result.status).toBe("failed");
  });

  it("fails when a required control region fails even if the mostly blank full image passes", async () => {
    const directory = await createTemporaryDirectory();
    const baselinePath = path.join(directory, "baseline.png");
    const actualPath = path.join(directory, "actual.png");
    const diffPath = path.join(directory, "diff.png");
    const actual = PNG.sync.read(createPng(10, 10, [0, 0, 0, 255]));
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        const offset = (y * 10 + x) * 4;
        actual.data[offset] = 255;
      }
    }
    await Promise.all([
      writeFile(baselinePath, createPng(10, 10, [0, 0, 0, 255])),
      writeFile(actualPath, PNG.sync.write(actual)),
    ]);

    const result = await compareImages({
      baselinePath,
      actualPath,
      diffPath,
      pixelTolerance: 0,
      regions: [{ id: "bottom-controls", x: 0, y: 0, width: 2, height: 2 }],
    });

    expect(result.matchPercent).toBe("96.00%");
    expect(result.status).toBe("failed");
    expect(result.regions).toEqual([
      expect.objectContaining({ id: "bottom-controls", matchPercent: "0.00%", status: "failed" }),
    ]);
  });

  it("refuses images with different dimensions instead of inventing a ratio", async () => {
    const directory = await createTemporaryDirectory();
    const baselinePath = path.join(directory, "baseline.png");
    const actualPath = path.join(directory, "actual.png");
    const diffPath = path.join(directory, "diff.png");
    await Promise.all([
      writeFile(baselinePath, createPng(1, 1, [0, 0, 0, 255])),
      writeFile(actualPath, createPng(2, 2, [0, 0, 0, 255])),
    ]);

    await expect(compareImages({ baselinePath, actualPath, diffPath })).rejects.toThrow(
      "IMAGE_DIMENSION_MISMATCH",
    );
  });

  it("runs as the bundled plugin script without external package imports", async () => {
    const directory = await createTemporaryDirectory();
    const baselinePath = path.join(directory, "baseline.png");
    const actualPath = path.join(directory, "actual.png");
    const diffPath = path.join(directory, "diff.png");
    await Promise.all([
      writeFile(baselinePath, createPng(1, 1, [18, 52, 86, 255])),
      writeFile(actualPath, createPng(1, 1, [18, 52, 86, 255])),
    ]);

    const bundlePath = path.join(process.cwd(), "skills/spec-to-pr/scripts/compare-images.cjs");
    const { stdout } = await execFileAsync(process.execPath, [
      bundlePath,
      "--baseline",
      baselinePath,
      "--actual",
      actualPath,
      "--diff",
      diffPath,
    ]);

    expect(JSON.parse(stdout)).toMatchObject({ matchPercent: "100.00%", status: "passed" });
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-lite-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createPng(
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
): Buffer {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = rgba[0];
    image.data[offset + 1] = rgba[1];
    image.data[offset + 2] = rgba[2];
    image.data[offset + 3] = rgba[3];
  }
  return PNG.sync.write(image);
}
