import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import {
  compareVisualPngs,
  normalizeVisualTargetManifest,
  VisualTargetManifestSchema,
} from "../../src/visual/visual-comparator.js";
import { VisualComparisonMetricsSchema } from "../../src/visual/visual-model.js";

describe("visual comparator v2", () => {
  it("computes exact and tolerant ratios from RGBA bytes and emits deterministic images", async () => {
    const baseline = solidPng(10, 10, [40, 80, 120, 255]);
    const actualImage = PNG.sync.read(baseline);
    actualImage.data[0] = 41;
    const actual = PNG.sync.write(actualImage);

    const comparison = await compareVisualPngs({ baseline, actual });

    expect(comparison.metrics).toMatchObject({
      width: 10,
      height: 10,
      comparedPixelCount: 100,
      maskedPixelCount: 0,
      exactMatchRatio: 0.99,
      reviewMatchRatio: 1,
      threshold: 0.92,
    });
    expect(comparison.status).toBe("passed");
    expect(() => VisualComparisonMetricsSchema.parse(comparison.metrics)).not.toThrow();
    expect(() => PNG.sync.read(comparison.diff)).not.toThrow();
    expect(() => PNG.sync.read(comparison.overlay)).not.toThrow();
  });

  it("rejects dimension mismatch instead of cropping or resizing", async () => {
    await expect(
      compareVisualPngs({
        baseline: solidPng(10, 10, [0, 0, 0, 255]),
        actual: solidPng(9, 10, [0, 0, 0, 255]),
      }),
    ).rejects.toThrow(/VISUAL_DIMENSION_MISMATCH/);
  });

  it("rejects an oversized IHDR before PNG decoding allocates pixels", async () => {
    const oversized = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversized);
    oversized.writeUInt32BE(13, 8);
    oversized.write("IHDR", 12, "ascii");
    oversized.writeUInt32BE(10_000, 16);
    oversized.writeUInt32BE(10_000, 20);

    await expect(
      compareVisualPngs({
        baseline: oversized,
        actual: solidPng(1, 1, [0, 0, 0, 255]),
      }),
    ).rejects.toThrow(/VISUAL_PIXEL_LIMIT/);
  });

  it("detects alpha-only differences", async () => {
    const comparison = await compareVisualPngs({
      baseline: solidPng(2, 1, [255, 0, 0, 255]),
      actual: solidPng(2, 1, [255, 0, 0, 128]),
    });

    expect(comparison.metrics.exactMatchRatio).toBe(0);
    expect(comparison.metrics.reviewMatchRatio).toBe(0);
    expect(comparison.metrics.maxDistance).toBeGreaterThan(0);
    expect(comparison.status).toBe("failed");
  });

  it("reports bounded unioned masks and rejects excessive or complete masks", async () => {
    const baseline = solidPng(10, 10, [0, 0, 0, 255]);
    const actual = solidPng(10, 10, [255, 255, 255, 255]);
    const masks = [
      { x: 0, y: 0, width: 3, height: 5, reason: "clock" },
      { x: 2, y: 0, width: 2, height: 5, reason: "animation" },
    ];

    const comparison = await compareVisualPngs({ baseline, actual, masks });

    expect(comparison.metrics).toMatchObject({
      comparedPixelCount: 80,
      maskedPixelCount: 20,
      maskedAreaRatio: 0.2,
    });
    expect(comparison.maskReasons).toEqual(["clock", "animation"]);

    await expect(
      compareVisualPngs({
        baseline,
        actual,
        masks: [{ x: 0, y: 0, width: 5, height: 5, reason: "hide too much" }],
      }),
    ).rejects.toThrow(/VISUAL_EXCESSIVE_MASK/);

    await expect(
      compareVisualPngs({
        baseline,
        actual,
        masks: [{ x: 0, y: 0, width: 10, height: 10, reason: "hide everything" }],
      }),
    ).rejects.toThrow(/VISUAL_ALL_PIXELS_MASKED/);
  });

  it("passes exactly 0.92 and fails 0.9199", async () => {
    const baseline = solidPng(100, 100, [0, 0, 0, 255]);
    const atBoundary = await compareVisualPngs({
      baseline,
      actual: pngWithChangedPixels(100, 100, 800),
    });
    const belowBoundary = await compareVisualPngs({
      baseline,
      actual: pngWithChangedPixels(100, 100, 801),
    });

    expect(atBoundary.metrics.reviewMatchRatio).toBe(0.92);
    expect(atBoundary.metrics.threshold).toBe(0.92);
    expect(atBoundary.status).toBe("passed");
    expect(belowBoundary.metrics.reviewMatchRatio).toBe(0.9199);
    expect(belowBoundary.status).toBe("failed");
  });

  it("does not allow an untyped caller override to change the runtime visual gate", async () => {
    const comparison = await compareVisualPngs({
      baseline: solidPng(100, 100, [0, 0, 0, 255]),
      actual: pngWithChangedPixels(100, 100, 800),
      reviewThreshold: 1,
    } as unknown as Parameters<typeof compareVisualPngs>[0]);

    expect(comparison.metrics.threshold).toBe(0.92);
    expect(comparison.status).toBe("passed");
  });

  it("uses one baseline-neutral target contract for Figma and legacy screenshots", () => {
    const common = {
      targetId: "checkout-default",
      name: "Checkout",
      state: "default",
      route: "/checkout",
      baselinePath: "visual/baseline.png",
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      fixture: "fixtures/checkout.json",
      masks: [],
    };

    expect(
      VisualTargetManifestSchema.parse({ ...common, baselineKind: "figma" }).baselineKind,
    ).toBe("figma");
    expect(
      VisualTargetManifestSchema.parse({
        ...common,
        baselineKind: "legacy-screenshot",
      }).baselineKind,
    ).toBe("legacy-screenshot");
    expect(() =>
      VisualTargetManifestSchema.parse({
        ...common,
        baselineKind: "figma",
        reviewThreshold: 0.98,
      }),
    ).toThrow();
  });

  it("normalizes a stored legacy target threshold before a new comparison", () => {
    expect(
      normalizeVisualTargetManifest({
        targetId: "checkout-default",
        name: "Checkout",
        state: "default",
        route: "/checkout",
        baselineKind: "figma",
        baselinePath: "visual/baseline.png",
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        fixture: "fixtures/checkout.json",
        masks: [],
        reviewThreshold: 0.98,
      }).reviewThreshold,
    ).toBe(0.92);
  });
});

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = rgba[0];
    image.data[offset + 1] = rgba[1];
    image.data[offset + 2] = rgba[2];
    image.data[offset + 3] = rgba[3];
  }
  return PNG.sync.write(image);
}

function pngWithChangedPixels(width: number, height: number, changedPixels: number): Buffer {
  const image = new PNG({ width, height });
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    image.data[pixel * 4 + 3] = 255;
  }
  for (let pixel = 0; pixel < changedPixels; pixel += 1) {
    image.data[pixel * 4] = 255;
  }
  return PNG.sync.write(image);
}
