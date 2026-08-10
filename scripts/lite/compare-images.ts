import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { PNG } from "pngjs";

const DEFAULT_THRESHOLD = 0.92;
const DEFAULT_PIXEL_TOLERANCE = 0.02;

export type ImageComparisonInput = {
  baselinePath: string;
  actualPath: string;
  diffPath: string;
  threshold?: number;
  pixelTolerance?: number;
};

export type ImageComparisonResult = {
  width: number;
  height: number;
  matchRatio: number;
  matchPercent: string;
  threshold: number;
  status: "passed" | "failed";
  diffPath: string;
};

/**
 * Stateless PNG comparison for a Draft PR. It intentionally owns no Run,
 * retry, evidence receipt, or persistent workflow state.
 */
export async function compareImages(input: ImageComparisonInput): Promise<ImageComparisonResult> {
  const threshold = normalizeRatio(input.threshold ?? DEFAULT_THRESHOLD, "threshold");
  const pixelTolerance = normalizeRatio(
    input.pixelTolerance ?? DEFAULT_PIXEL_TOLERANCE,
    "pixelTolerance",
  );
  const [baselineBytes, actualBytes] = await Promise.all([
    readFile(input.baselinePath),
    readFile(input.actualPath),
  ]);
  const baseline = PNG.sync.read(baselineBytes);
  const actual = PNG.sync.read(actualBytes);

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    throw new Error(
      `IMAGE_DIMENSION_MISMATCH: baseline is ${baseline.width}x${baseline.height}; actual is ${actual.width}x${actual.height}`,
    );
  }

  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const pixels = baseline.width * baseline.height;
  let matched = 0;

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const distance = rgbaDistance(baseline.data, actual.data, offset);
    if (distance <= pixelTolerance) {
      matched += 1;
      diff.data[offset] = 0;
      diff.data[offset + 1] = 0;
      diff.data[offset + 2] = 0;
      diff.data[offset + 3] = 0;
      continue;
    }

    diff.data[offset] = 239;
    diff.data[offset + 1] = 68;
    diff.data[offset + 2] = 68;
    diff.data[offset + 3] = 255;
  }

  await writeFile(input.diffPath, PNG.sync.write(diff));
  const matchRatio = matched / pixels;

  return {
    width: baseline.width,
    height: baseline.height,
    matchRatio,
    matchPercent: `${(matchRatio * 100).toFixed(2)}%`,
    threshold,
    status: matchRatio >= threshold ? "passed" : "failed",
    diffPath: input.diffPath,
  };
}

function rgbaDistance(left: Buffer, right: Buffer, offset: number): number {
  const red = left[offset]! - right[offset]!;
  const green = left[offset + 1]! - right[offset + 1]!;
  const blue = left[offset + 2]! - right[offset + 2]!;
  const alpha = left[offset + 3]! - right[offset + 3]!;
  return Math.sqrt(red * red + green * green + blue * blue + alpha * alpha) / 510;
}

function normalizeRatio(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number between 0 and 1`);
  }
  return value;
}

function parseArgs(argv: readonly string[]): ImageComparisonInput {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !flag.startsWith("--")) {
      throw new Error(
        "Usage: compare-images --baseline <png> --actual <png> --diff <png> [--threshold <0..1>]",
      );
    }
    values.set(flag, value);
  }

  const baselinePath = values.get("--baseline");
  const actualPath = values.get("--actual");
  const diffPath = values.get("--diff");
  if (baselinePath === undefined || actualPath === undefined || diffPath === undefined) {
    throw new Error(
      "Usage: compare-images --baseline <png> --actual <png> --diff <png> [--threshold <0..1>]",
    );
  }

  return {
    baselinePath,
    actualPath,
    diffPath,
    ...(values.has("--threshold") ? { threshold: Number(values.get("--threshold")) } : {}),
    ...(values.has("--pixel-tolerance")
      ? { pixelTolerance: Number(values.get("--pixel-tolerance")) }
      : {}),
  };
}

const invokedPath = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (/compare-images\.(?:[cm]?js|ts)$/u.test(invokedPath)) {
  void runCli();
}

async function runCli(): Promise<void> {
  try {
    const result = await compareImages(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
