import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { comparePngImages } from "../../src/visual/image-comparator.js";
import { DEFAULT_VISUAL_GATE_POLICY } from "../../src/visual/visual-policy.js";

describe("comparePngImages", () => {
  it("reports perfect exact and review match for identical images", () => {
    const image = solidPng(2, 2, [255, 0, 0, 255]);

    const result = comparePngImages({
      expectedPng: image,
      actualPng: image,
      masks: [],
      policy: DEFAULT_VISUAL_GATE_POLICY,
    });

    expect(result.metrics.exactMatchRatio).toBe(1);
    expect(result.metrics.reviewMatchRatio).toBe(1);
  });

  it("accounts for one pixel mismatch", () => {
    const expected = solidPng(2, 2, [255, 0, 0, 255]);
    const actual = pngWithPixel(2, 2, [255, 0, 0, 255], {
      x: 1,
      y: 1,
      rgba: [0, 0, 255, 255],
    });

    const result = comparePngImages({
      expectedPng: expected,
      actualPng: actual,
      masks: [],
      policy: {
        ...DEFAULT_VISUAL_GATE_POLICY,
        reviewDistanceThreshold: 0,
      },
    });

    expect(result.metrics.comparedPixelCount).toBe(4);
    expect(result.metrics.exactMatchRatio).toBe(0.75);
    expect(result.metrics.reviewMatchRatio).toBe(0.75);
  });

  it("excludes masked pixels from comparison", () => {
    const expected = solidPng(2, 2, [255, 0, 0, 255]);
    const actual = pngWithPixel(2, 2, [255, 0, 0, 255], {
      x: 1,
      y: 1,
      rgba: [0, 0, 255, 255],
    });

    const result = comparePngImages({
      expectedPng: expected,
      actualPng: actual,
      masks: [
        {
          name: "dynamic-avatar",
          x: 1,
          y: 1,
          width: 1,
          height: 1,
          reason: "Random avatar",
        },
      ],
      policy: DEFAULT_VISUAL_GATE_POLICY,
    });

    expect(result.metrics.comparedPixelCount).toBe(3);
    expect(result.metrics.maskedPixelCount).toBe(1);
    expect(result.metrics.exactMatchRatio).toBe(1);
  });
});

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  return pngWithPixel(width, height, rgba);
}

function pngWithPixel(
  width: number,
  height: number,
  fill: [number, number, number, number],
  override?: { x: number; y: number; rgba: [number, number, number, number] },
): Buffer {
  const image = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      writePixel(image, x, y, fill);
    }
  }

  if (override !== undefined) {
    writePixel(image, override.x, override.y, override.rgba);
  }

  return PNG.sync.write(image);
}

function writePixel(
  image: PNG,
  x: number,
  y: number,
  rgba: [number, number, number, number],
): void {
  const index = (image.width * y + x) << 2;

  image.data[index] = rgba[0];
  image.data[index + 1] = rgba[1];
  image.data[index + 2] = rgba[2];
  image.data[index + 3] = rgba[3];
}
