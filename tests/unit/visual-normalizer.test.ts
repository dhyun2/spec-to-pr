import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import {
  VisualNormalizationCache,
  type VisualNormalizationCacheKey,
} from "../../src/visual/visual-normalization-cache.js";
import { normalizeVisualPng } from "../../src/visual/visual-normalizer.js";

describe("visual normalizer", () => {
  it("deterministically resizes and composites alpha onto white", async () => {
    const source = solidPng(2, 2, [255, 0, 0, 128]);

    const first = await normalizeVisualPng({
      content: source,
      sourceSize: { width: 2, height: 2 },
      logicalSize: { width: 4, height: 4 },
      colorSpace: "srgb",
      role: "Figma baseline",
    });
    const second = await normalizeVisualPng({
      content: source,
      sourceSize: { width: 2, height: 2 },
      logicalSize: { width: 4, height: 4 },
      colorSpace: "srgb",
      role: "Figma baseline",
    });

    expect(first).toMatchObject({
      width: 4,
      height: 4,
      version: "visual-normalizer-v1",
    });
    expect(first.content.equals(second.content)).toBe(true);
    const decoded = PNG.sync.read(first.content);
    expect([...decoded.data.subarray(0, 4)]).toEqual([255, 127, 127, 255]);
  });

  it("rejects source dimensions that disagree with decoded pixels", async () => {
    await expect(
      normalizeVisualPng({
        content: solidPng(2, 2, [0, 0, 0, 255]),
        sourceSize: { width: 3, height: 2 },
        logicalSize: { width: 4, height: 4 },
        colorSpace: "srgb",
        role: "Figma baseline",
      }),
    ).rejects.toThrow(/FIGMA_CAPTURE_GEOMETRY_INVALID.*decoded/);
  });

  it("reuses unchanged baseline PNG and RGBA bytes while allowing actuals to stay fresh", async () => {
    const cache = new VisualNormalizationCache();
    const source = solidPng(2, 2, [10, 20, 30, 255]);
    const input = {
      content: source,
      sourceDigest: `sha256:${"1".repeat(64)}` as const,
      sourceSize: { width: 2, height: 2 },
      logicalSize: { width: 2, height: 2 },
      colorSpace: "srgb" as const,
      role: "Figma baseline",
      cache,
    };

    const cold = await normalizeVisualPng(input);
    cold.content[0] = 0;
    cold.rgba[0] = 0;
    const warm = await normalizeVisualPng(input);
    const freshActual = await normalizeVisualPng({
      ...input,
      role: "browser actual",
      cacheRead: false,
    });

    expect(cold.cacheStatus).toBe("miss");
    expect(warm.cacheStatus).toBe("hit");
    expect(freshActual.cacheStatus).toBe("bypassed");
    expect(warm.content[0]).not.toBe(0);
    expect(warm.rgba[0]).toBe(10);
    expect(cache.snapshotStats()).toMatchObject({
      hits: 1,
      misses: 1,
      bypasses: 1,
    });
  });

  it("includes every normalization option in the cache key", async () => {
    const cache = new VisualNormalizationCache();
    const source = solidPng(1, 1, [10, 20, 30, 255]);
    const keys: VisualNormalizationCacheKey[] = [];
    const getOrCompute = cache.getOrCompute.bind(cache);
    cache.getOrCompute = async (key, compute) => {
      keys.push(key);
      return getOrCompute(key, compute);
    };

    await normalizeVisualPng({
      content: source,
      sourceSize: { width: 1, height: 1 },
      logicalSize: { width: 1, height: 1 },
      colorSpace: "srgb",
      role: "baseline",
      cache,
    });

    expect(keys).toEqual([
      expect.objectContaining({
        normalizerVersion: "visual-normalizer-v1",
        options: {
          alphaMode: "premultiplied",
          interpolation: "nearest",
        },
      }),
    ]);
  });

  it("returns atomic miss and single-flight dispositions for concurrent normalization", async () => {
    const cache = new VisualNormalizationCache();
    const source = solidPng(400, 400, [10, 20, 30, 255]);
    const input = {
      content: source,
      sourceDigest: `sha256:${"3".repeat(64)}` as const,
      sourceSize: { width: 400, height: 400 },
      logicalSize: { width: 400, height: 400 },
      colorSpace: "srgb" as const,
      role: "concurrent baseline",
      cache,
    };

    const [first, second] = await Promise.all([
      normalizeVisualPng(input),
      normalizeVisualPng(input),
    ]);

    expect([first.cacheStatus, second.cacheStatus]).toEqual(["miss", "single-flight"]);
    expect(cache.snapshotStats()).toMatchObject({
      hits: 0,
      misses: 1,
      singleFlights: 1,
    });
  });

  it("checkpoints actual normalization buffer ownership synchronously", async () => {
    const source = solidPng(2, 1, [10, 20, 30, 255]);
    const checkpoints: Array<{
      stage: string;
      managedBytes: number;
      rssBytes: number;
      ownership: Record<string, number>;
    }> = [];

    await normalizeVisualPng({
      content: source,
      sourceSize: { width: 2, height: 1 },
      logicalSize: { width: 2, height: 1 },
      colorSpace: "srgb",
      role: "measured normalization",
      cache: false,
      onMemoryCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
    });

    expect(checkpoints).toContainEqual({
      stage: "normalizer-rgba-output",
      managedBytes: source.byteLength + 16,
      rssBytes: expect.any(Number),
      ownership: {
        sourcePng: source.byteLength,
        decodedSourceRgba: 8,
        normalizedRgba: 8,
      },
    });
    expect(checkpoints.at(-1)).toMatchObject({
      stage: "normalizer-result",
      ownership: {
        sourcePng: source.byteLength,
        decodedSourceRgba: 8,
        normalizedRgba: 8,
        returnedRgba: 8,
      },
    });
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
