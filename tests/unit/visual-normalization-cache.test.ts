import { describe, expect, it, vi } from "vitest";

import {
  VISUAL_NORMALIZATION_CACHE_VERSION,
  VisualNormalizationCache,
  type VisualNormalizationCacheKey,
} from "../../src/visual/visual-normalization-cache.js";

const BASE_KEY: VisualNormalizationCacheKey = {
  sourceDigest: `sha256:${"1".repeat(64)}`,
  normalizerVersion: "visual-normalizer-v1",
  sourceSize: { width: 2, height: 2 },
  logicalSize: { width: 4, height: 4 },
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
    ["logical width", { logicalSize: { width: 5, height: 4 } }],
    ["logical height", { logicalSize: { width: 4, height: 5 } }],
    ["color space", { colorSpace: "display-p3" }],
    ["alpha mode", { options: { alphaMode: "straight", interpolation: "nearest" } }],
    ["interpolation", { options: { alphaMode: "premultiplied", interpolation: "bilinear" } }],
  ])("misses when the %s semantic dimension drifts", async (_label, drift) => {
    const cache = new VisualNormalizationCache(1_024);
    const compute = vi
      .fn()
      .mockResolvedValueOnce(value([1], [2, 3, 4, 5]))
      .mockResolvedValueOnce(value([6], [7, 8, 9, 10]));

    await cache.getOrCompute(BASE_KEY, compute);
    const changed = {
      ...BASE_KEY,
      ...drift,
    } as VisualNormalizationCacheKey;
    const result = await cache.getOrCompute(changed, compute);

    expect(result.png).toEqual(Buffer.from([6]));
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("charges PNG plus RGBA bytes and evicts the least recently used entry", async () => {
    const cache = new VisualNormalizationCache(10);
    const firstKey = keyWithDigest("1");
    const secondKey = keyWithDigest("2");
    const thirdKey = keyWithDigest("3");

    await cache.getOrCompute(firstKey, async () => value([1], [1, 1, 1, 1]));
    await cache.getOrCompute(secondKey, async () => value([2], [2, 2, 2, 2]));
    await cache.getOrCompute(firstKey, async () => {
      throw new Error("the first entry should still be cached");
    });
    await cache.getOrCompute(thirdKey, async () => value([3], [3, 3, 3, 3]));

    const recomputedSecond = vi.fn(async () => value([4], [4, 4, 4, 4]));
    await cache.getOrCompute(secondKey, recomputedSecond);

    expect(recomputedSecond).toHaveBeenCalledOnce();
    expect(cache.snapshotStats()).toMatchObject({
      maximumBytes: 10,
      entryCount: 2,
      residentBytes: 10,
      evictions: 2,
    });
  });

  it("returns owned buffers so callers cannot mutate cached PNG or RGBA bytes", async () => {
    const cache = new VisualNormalizationCache(1_024);
    const compute = vi.fn(async () => value([1], [2, 3, 4, 5]));
    const first = await cache.getOrCompute(BASE_KEY, compute);
    first.png[0] = 99;
    first.rgba[0] = 99;

    const second = await cache.getOrCompute(BASE_KEY, compute);

    expect(second.png).toEqual(Buffer.from([1]));
    expect(second.rgba).toEqual(Buffer.from([2, 3, 4, 5]));
    expect(compute).toHaveBeenCalledOnce();
  });

  it("evicts a malformed entry and recomputes it instead of returning corrupt bytes", async () => {
    const cache = new VisualNormalizationCache(1_024);
    cache.set(
      BASE_KEY,
      value([1], [2, 3, 4]) as unknown as Parameters<VisualNormalizationCache["set"]>[1],
    );
    const compute = vi.fn(async () => value([6], [7, 8, 9, 10]));

    const result = await cache.getOrCompute(BASE_KEY, compute);

    expect(result.rgba).toEqual(Buffer.from([7, 8, 9, 10]));
    expect(compute).toHaveBeenCalledOnce();
    expect(cache.snapshotStats().malformedEntries).toBe(1);
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

function value(png: number[], rgba: number[]) {
  return {
    png: Buffer.from(png),
    rgba: Buffer.from(rgba),
    width: 1,
    height: 1,
  };
}
