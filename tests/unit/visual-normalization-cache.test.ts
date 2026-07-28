import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";

import {
  VISUAL_NORMALIZATION_CACHE_TEST_SEAM,
  VISUAL_NORMALIZATION_CACHE_VERSION,
  VisualNormalizationCache,
  type VisualNormalizationCacheKey,
} from "../../src/visual/visual-normalization-cache.js";

const BASE_KEY: VisualNormalizationCacheKey = {
  sourceDigest: `sha256:${"1".repeat(64)}`,
  normalizerVersion: "visual-normalizer-v1",
  sourceSize: { width: 2, height: 2 },
  logicalSize: { width: 1, height: 1 },
  colorSpace: "srgb",
  options: {
    alphaMode: "premultiplied",
    interpolation: "nearest",
  },
};

describe("visual normalization cache", () => {
  it.each([
    ["source digest", { sourceDigest: `sha256:${"2".repeat(64)}` }],
    ["normalizer version", { normalizerVersion: "visual-normalizer-v2" }],
    ["source width", { sourceSize: { width: 3, height: 2 } }],
    ["source height", { sourceSize: { width: 2, height: 3 } }],
    ["logical width", { logicalSize: { width: 2, height: 1 } }],
    ["logical height", { logicalSize: { width: 1, height: 2 } }],
    ["color space", { colorSpace: "display-p3" }],
    ["alpha mode", { options: { alphaMode: "straight", interpolation: "nearest" } }],
    ["interpolation", { options: { alphaMode: "premultiplied", interpolation: "bilinear" } }],
  ])("misses when the %s semantic dimension drifts", async (_label, drift) => {
    const cache = new VisualNormalizationCache(1_024);
    const compute = vi
      .fn()
      .mockResolvedValueOnce(value([2, 3, 4, 255]))
      .mockResolvedValueOnce(
        value(
          [7, 8, 9, 255],
          "logicalSize" in drift
            ? (drift.logicalSize as { width: number; height: number })
            : undefined,
        ),
      );

    await cache.getOrCompute(BASE_KEY, compute);
    const changed = {
      ...BASE_KEY,
      ...drift,
    } as VisualNormalizationCacheKey;
    const result = await cache.getOrCompute(changed, compute);

    expect(result.value.rgba.subarray(0, 4)).toEqual(Buffer.from([7, 8, 9, 255]));
    expect(result.disposition).toBe("miss");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("charges PNG plus RGBA bytes and evicts the least recently used entry", async () => {
    const sample = value([1, 1, 1, 255]);
    const chargedBytes = sample.png.byteLength + sample.rgba.byteLength;
    const cache = new VisualNormalizationCache(chargedBytes * 2);
    const firstKey = keyWithDigest("1");
    const secondKey = keyWithDigest("2");
    const thirdKey = keyWithDigest("3");

    await cache.getOrCompute(firstKey, async () => value([1, 1, 1, 255]));
    await cache.getOrCompute(secondKey, async () => value([2, 2, 2, 255]));
    await cache.getOrCompute(firstKey, async () => {
      throw new Error("the first entry should still be cached");
    });
    await cache.getOrCompute(thirdKey, async () => value([3, 3, 3, 255]));

    const recomputedSecond = vi.fn(async () => value([4, 4, 4, 255]));
    await cache.getOrCompute(secondKey, recomputedSecond);

    expect(recomputedSecond).toHaveBeenCalledOnce();
    expect(cache.snapshotStats()).toMatchObject({
      maximumBytes: chargedBytes * 2,
      entryCount: 2,
      residentBytes: chargedBytes * 2,
      evictions: 2,
    });
  });

  it("returns owned buffers so callers cannot mutate cached PNG or RGBA bytes", async () => {
    const cache = new VisualNormalizationCache(1_024);
    const compute = vi.fn(async () => value([2, 3, 4, 255]));
    const first = await cache.getOrCompute(BASE_KEY, compute);
    first.value.png[0] = 0;
    first.value.rgba[0] = 99;

    const second = await cache.getOrCompute(BASE_KEY, compute);

    expect(second.value.png[0]).toBe(137);
    expect(second.value.rgba).toEqual(Buffer.from([2, 3, 4, 255]));
    expect(second.disposition).toBe("hit");
    expect(compute).toHaveBeenCalledOnce();
  });

  it("evicts a corrupt resident PNG and recomputes coherent PNG/RGBA bytes", async () => {
    const cache = new VisualNormalizationCache(1_024);
    await cache.getOrCompute(BASE_KEY, async () => value([2, 3, 4, 255]));
    cache[VISUAL_NORMALIZATION_CACHE_TEST_SEAM](BASE_KEY, (resident) => {
      resident.png[0] = 0;
    });
    const compute = vi.fn(async () => value([7, 8, 9, 255]));

    const result = await cache.getOrCompute(BASE_KEY, compute);

    expect(result.value.png[0]).toBe(137);
    expect(result.value.rgba).toEqual(Buffer.from([7, 8, 9, 255]));
    expect(result.disposition).toBe("miss");
    expect(compute).toHaveBeenCalledOnce();
    expect(cache.snapshotStats()).toMatchObject({
      malformedEntries: 1,
      misses: 2,
    });
  });

  it("rejects PNG/RGBA/key dimension or pixel incoherence before residency", async () => {
    const cache = new VisualNormalizationCache(1_024);
    const mismatchedRgba = value([1, 2, 3, 255]);
    mismatchedRgba.rgba[0] = 99;
    cache.set(BASE_KEY, mismatchedRgba);
    cache.set({ ...BASE_KEY, logicalSize: { width: 2, height: 1 } }, value([1, 2, 3, 255]));

    expect(cache.snapshotStats()).toMatchObject({
      entryCount: 0,
      malformedEntries: 2,
    });
  });

  it("atomically distinguishes a miss from a concurrent single-flight waiter", async () => {
    const cache = new VisualNormalizationCache(1_024);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const compute = vi.fn(async () => {
      await gate;
      return value([1, 2, 3, 255]);
    });

    const miss = cache.getOrCompute(BASE_KEY, compute);
    await Promise.resolve();
    const waiter = cache.getOrCompute(BASE_KEY, compute);
    release();

    await expect(miss).resolves.toMatchObject({ disposition: "miss" });
    await expect(waiter).resolves.toMatchObject({ disposition: "single-flight" });
    expect(compute).toHaveBeenCalledOnce();
    expect(cache.snapshotStats()).toMatchObject({
      hits: 0,
      misses: 1,
      singleFlights: 1,
    });
  });

  it("uses an explicit cache format version", () => {
    expect(VISUAL_NORMALIZATION_CACHE_VERSION).toBe("visual-normalization-cache-v1");
  });
});

function keyWithDigest(character: string): VisualNormalizationCacheKey {
  return {
    ...BASE_KEY,
    sourceDigest: `sha256:${character.repeat(64)}`,
  };
}

function value(
  rgba: [number, number, number, number],
  size: { width: number; height: number } = { width: 1, height: 1 },
) {
  const image = new PNG(size);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data.set(rgba, offset);
  }
  return {
    png: PNG.sync.write(image),
    rgba: Buffer.from(image.data),
    width: size.width,
    height: size.height,
  };
}
