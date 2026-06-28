import { PNG } from "pngjs";

import { isMaskedPixel } from "./image-mask.js";
import { VisualComparisonMetricsSchema } from "./visual-model.js";
import type { VisualComparisonMetrics, VisualMaskRegion } from "./visual-model.js";
import type { VisualGatePolicy } from "./visual-policy.js";

export type ImageComparisonOutput = {
  metrics: VisualComparisonMetrics;
  diffPng: Buffer;
  overlayPng: Buffer;
};

export function comparePngImages(input: {
  expectedPng: Buffer;
  actualPng: Buffer;
  masks: VisualMaskRegion[];
  policy: VisualGatePolicy;
}): ImageComparisonOutput {
  const expected = PNG.sync.read(input.expectedPng);
  const actual = PNG.sync.read(input.actualPng);
  const width = Math.min(expected.width, actual.width);
  const height = Math.min(expected.height, actual.height);
  const diff = new PNG({
    width,
    height,
  });
  const overlay = new PNG({
    width,
    height,
  });

  let comparedPixelCount = 0;
  let maskedPixelCount = 0;
  let exactMatchCount = 0;
  let reviewMatchCount = 0;
  let distanceSum = 0;
  let maxDistance = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const indexExpected = (expected.width * y + x) << 2;
      const indexActual = (actual.width * y + x) << 2;
      const indexOut = (width * y + x) << 2;

      if (isMaskedPixel({ x, y, masks: input.masks })) {
        maskedPixelCount += 1;
        writePixel(diff, indexOut, 160, 160, 160, 255);
        copyPixel(actual, overlay, indexActual, indexOut);
        continue;
      }

      comparedPixelCount += 1;

      const er = expected.data[indexExpected] ?? 0;
      const eg = expected.data[indexExpected + 1] ?? 0;
      const eb = expected.data[indexExpected + 2] ?? 0;
      const ar = actual.data[indexActual] ?? 0;
      const ag = actual.data[indexActual + 1] ?? 0;
      const ab = actual.data[indexActual + 2] ?? 0;
      const distance = Math.sqrt((er - ar) ** 2 + (eg - ag) ** 2 + (eb - ab) ** 2);

      distanceSum += distance;
      maxDistance = Math.max(maxDistance, distance);

      if (distance === 0) {
        exactMatchCount += 1;
      }

      if (distance <= input.policy.reviewDistanceThreshold) {
        reviewMatchCount += 1;
        writePixel(diff, indexOut, 0, 0, 0, 0);
      } else {
        writePixel(diff, indexOut, 255, 0, 0, 255);
      }

      writePixel(
        overlay,
        indexOut,
        Math.round(er * 0.5 + ar * 0.5),
        Math.round(eg * 0.5 + ag * 0.5),
        Math.round(eb * 0.5 + ab * 0.5),
        255,
      );
    }
  }

  const exactMatchRatio = comparedPixelCount === 0 ? 1 : exactMatchCount / comparedPixelCount;
  const reviewMatchRatio = comparedPixelCount === 0 ? 1 : reviewMatchCount / comparedPixelCount;

  return {
    metrics: VisualComparisonMetricsSchema.parse({
      width,
      height,
      comparedPixelCount,
      maskedPixelCount,
      exactMatchRatio,
      reviewMatchRatio,
      meanDistance: comparedPixelCount === 0 ? 0 : distanceSum / comparedPixelCount,
      maxDistance,
    }),
    diffPng: PNG.sync.write(diff),
    overlayPng: PNG.sync.write(overlay),
  };
}

function writePixel(
  image: PNG,
  index: number,
  red: number,
  green: number,
  blue: number,
  alpha: number,
): void {
  image.data[index] = red;
  image.data[index + 1] = green;
  image.data[index + 2] = blue;
  image.data[index + 3] = alpha;
}

function copyPixel(source: PNG, target: PNG, sourceIndex: number, targetIndex: number): void {
  target.data[targetIndex] = source.data[sourceIndex] ?? 0;
  target.data[targetIndex + 1] = source.data[sourceIndex + 1] ?? 0;
  target.data[targetIndex + 2] = source.data[sourceIndex + 2] ?? 0;
  target.data[targetIndex + 3] = source.data[sourceIndex + 3] ?? 255;
}
