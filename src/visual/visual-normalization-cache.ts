import { createHash } from "node:crypto";

import { decodePng } from "./png-codec.js";
import { assertBoundedPng } from "./png-decoder.js";

export const VISUAL_NORMALIZATION_CACHE_VERSION = "visual-normalization-cache-v1";
export const MAX_VISUAL_NORMALIZATION_CACHE_BYTES = 128 * 1024 * 1024;
export const VISUAL_NORMALIZATION_CACHE_TEST_SEAM: unique symbol = Symbol(
  "visual-normalization-cache-test-seam",
);

export type VisualNormalizationCacheKey = {
  sourceDigest: `sha256:${string}`;
  normalizerVersion: string;
  sourceSize: { width: number; height: number };
  logicalSize: { width: number; height: number };
  colorSpace: "srgb";
  options: {
    alphaMode: "premultiplied";
    interpolation: "nearest";
  };
};

export type VisualNormalizationCacheValue = {
  png: Buffer;
  rgba: Buffer;
  width: number;
  height: number;
};

export type VisualNormalizationCacheStats = {
  maximumBytes: number;
  residentBytes: number;
  entryCount: number;
  hits: number;
  misses: number;
  singleFlights: number;
  bypasses: number;
  evictions: number;
  malformedEntries: number;
};

export type VisualNormalizationCacheDisposition = "hit" | "miss" | "single-flight";

export type VisualNormalizationCacheResult = {
  value: VisualNormalizationCacheValue;
  disposition: VisualNormalizationCacheDisposition;
};

type CacheEntry = {
  value: VisualNormalizationCacheValue;
  chargedBytes: number;
  pngDigest: string;
  rgbaDigest: string;
};

export class VisualNormalizationCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<VisualNormalizationCacheValue>>();
  private residentBytes = 0;
  private hits = 0;
  private misses = 0;
  private singleFlights = 0;
  private bypasses = 0;
  private evictions = 0;
  private malformedEntries = 0;

  public constructor(private readonly maximumBytes: number = MAX_VISUAL_NORMALIZATION_CACHE_BYTES) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new Error("Visual normalization cache capacity must be a positive integer");
    }
  }

  public get(key: VisualNormalizationCacheKey): VisualNormalizationCacheValue | undefined {
    const serialized = serializeVisualNormalizationCacheKey(key);
    const entry = this.entries.get(serialized);
    if (entry === undefined) return undefined;
    if (!isValidResidentEntry(key, entry)) {
      this.deleteEntry(serialized, entry);
      this.malformedEntries += 1;
      this.evictions += 1;
      return undefined;
    }
    this.entries.delete(serialized);
    this.entries.set(serialized, entry);
    return cloneValue(entry.value);
  }

  public set(key: VisualNormalizationCacheKey, value: VisualNormalizationCacheValue): void {
    this.store(key, value);
  }

  public async getOrCompute(
    key: VisualNormalizationCacheKey,
    compute: () => Promise<VisualNormalizationCacheValue>,
  ): Promise<VisualNormalizationCacheResult> {
    const cached = this.get(key);
    if (cached !== undefined) {
      this.hits += 1;
      return { value: cached, disposition: "hit" };
    }
    const serialized = serializeVisualNormalizationCacheKey(key);
    const current = this.inFlight.get(serialized);
    if (current !== undefined) {
      this.singleFlights += 1;
      return {
        value: cloneValue(await current),
        disposition: "single-flight",
      };
    }
    this.misses += 1;
    const pending = compute().then((value) => {
      if (!this.store(key, value)) {
        throw new Error("VISUAL_NORMALIZATION_CACHE_INVALID: computed entry is malformed");
      }
      return cloneValue(value);
    });
    this.inFlight.set(serialized, pending);
    try {
      return {
        value: cloneValue(await pending),
        disposition: "miss",
      };
    } finally {
      if (this.inFlight.get(serialized) === pending) this.inFlight.delete(serialized);
    }
  }

  public recordBypass(): void {
    this.bypasses += 1;
  }

  public clear(): void {
    this.entries.clear();
    this.inFlight.clear();
    this.residentBytes = 0;
    this.hits = 0;
    this.misses = 0;
    this.singleFlights = 0;
    this.bypasses = 0;
    this.evictions = 0;
    this.malformedEntries = 0;
  }

  public snapshotStats(): VisualNormalizationCacheStats {
    return {
      maximumBytes: this.maximumBytes,
      residentBytes: this.residentBytes,
      entryCount: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      singleFlights: this.singleFlights,
      bypasses: this.bypasses,
      evictions: this.evictions,
      malformedEntries: this.malformedEntries,
    };
  }

  public [VISUAL_NORMALIZATION_CACHE_TEST_SEAM](
    key: VisualNormalizationCacheKey,
    mutate: (resident: VisualNormalizationCacheValue) => void,
  ): void {
    const entry = this.entries.get(serializeVisualNormalizationCacheKey(key));
    if (entry === undefined) throw new Error("Visual normalization cache test resident is missing");
    mutate(entry.value);
  }

  private store(key: VisualNormalizationCacheKey, value: VisualNormalizationCacheValue): boolean {
    const serialized = serializeVisualNormalizationCacheKey(key);
    if (!isCoherentValue(key, value)) {
      this.malformedEntries += 1;
      return false;
    }
    const owned = cloneValue(value);
    const chargedBytes = owned.png.byteLength + owned.rgba.byteLength;
    if (chargedBytes > this.maximumBytes) return true;
    const existing = this.entries.get(serialized);
    if (existing !== undefined) this.deleteEntry(serialized, existing);
    while (this.residentBytes + chargedBytes > this.maximumBytes) {
      const oldest = this.entries.entries().next().value as [string, CacheEntry] | undefined;
      if (oldest === undefined) break;
      this.deleteEntry(oldest[0], oldest[1]);
      this.evictions += 1;
    }
    this.entries.set(serialized, {
      value: owned,
      chargedBytes,
      pngDigest: sha256(owned.png),
      rgbaDigest: sha256(owned.rgba),
    });
    this.residentBytes += chargedBytes;
    return true;
  }

  private deleteEntry(serialized: string, entry: CacheEntry): void {
    if (!this.entries.delete(serialized)) return;
    this.residentBytes -= entry.chargedBytes;
  }
}

export function serializeVisualNormalizationCacheKey(key: VisualNormalizationCacheKey): string {
  return JSON.stringify([
    VISUAL_NORMALIZATION_CACHE_VERSION,
    key.sourceDigest,
    key.normalizerVersion,
    key.sourceSize.width,
    key.sourceSize.height,
    key.logicalSize.width,
    key.logicalSize.height,
    key.colorSpace,
    key.options.alphaMode,
    key.options.interpolation,
  ]);
}

function isValidValueShape(value: VisualNormalizationCacheValue): boolean {
  return (
    Buffer.isBuffer(value.png) &&
    value.png.byteLength > 0 &&
    Buffer.isBuffer(value.rgba) &&
    Number.isSafeInteger(value.width) &&
    value.width > 0 &&
    Number.isSafeInteger(value.height) &&
    value.height > 0 &&
    value.width <= Math.floor(Number.MAX_SAFE_INTEGER / value.height / 4) &&
    value.rgba.byteLength === value.width * value.height * 4
  );
}

function isCoherentValue(
  key: VisualNormalizationCacheKey,
  value: VisualNormalizationCacheValue,
): boolean {
  if (
    !isValidValueShape(value) ||
    value.width !== key.logicalSize.width ||
    value.height !== key.logicalSize.height
  ) {
    return false;
  }
  try {
    assertBoundedPng(value.png, "visual normalization cache entry");
    const decoded = decodePng(value.png);
    return (
      decoded.width === value.width &&
      decoded.height === value.height &&
      decoded.data.equals(value.rgba)
    );
  } catch {
    return false;
  }
}

function isValidResidentEntry(key: VisualNormalizationCacheKey, entry: CacheEntry): boolean {
  return (
    isValidValueShape(entry.value) &&
    entry.value.width === key.logicalSize.width &&
    entry.value.height === key.logicalSize.height &&
    entry.chargedBytes === entry.value.png.byteLength + entry.value.rgba.byteLength &&
    entry.pngDigest === sha256(entry.value.png) &&
    entry.rgbaDigest === sha256(entry.value.rgba)
  );
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function cloneValue(value: VisualNormalizationCacheValue): VisualNormalizationCacheValue {
  return {
    png: Buffer.from(value.png),
    rgba: Buffer.from(value.rgba),
    width: value.width,
    height: value.height,
  };
}
