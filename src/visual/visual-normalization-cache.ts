export const VISUAL_NORMALIZATION_CACHE_VERSION = "visual-normalization-cache-v1";
export const MAX_VISUAL_NORMALIZATION_CACHE_BYTES = 128 * 1024 * 1024;

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
  bypasses: number;
  evictions: number;
  malformedEntries: number;
};

type CacheEntry = {
  value: VisualNormalizationCacheValue;
  chargedBytes: number;
};

export class VisualNormalizationCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<VisualNormalizationCacheValue>>();
  private residentBytes = 0;
  private hits = 0;
  private misses = 0;
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
    if (!isValidValue(entry.value)) {
      this.deleteEntry(serialized, entry);
      this.malformedEntries += 1;
      return undefined;
    }
    this.entries.delete(serialized);
    this.entries.set(serialized, entry);
    return cloneValue(entry.value);
  }

  public set(key: VisualNormalizationCacheKey, value: VisualNormalizationCacheValue): void {
    const serialized = serializeVisualNormalizationCacheKey(key);
    const existing = this.entries.get(serialized);
    if (existing !== undefined) this.deleteEntry(serialized, existing);
    if (!isValidValue(value)) {
      this.malformedEntries += 1;
      return;
    }
    const owned = cloneValue(value);
    const chargedBytes = owned.png.byteLength + owned.rgba.byteLength;
    if (chargedBytes > this.maximumBytes) return;
    while (this.residentBytes + chargedBytes > this.maximumBytes) {
      const oldest = this.entries.entries().next().value as [string, CacheEntry] | undefined;
      if (oldest === undefined) break;
      this.deleteEntry(oldest[0], oldest[1]);
      this.evictions += 1;
    }
    this.entries.set(serialized, { value: owned, chargedBytes });
    this.residentBytes += chargedBytes;
  }

  public async getOrCompute(
    key: VisualNormalizationCacheKey,
    compute: () => Promise<VisualNormalizationCacheValue>,
  ): Promise<VisualNormalizationCacheValue> {
    const cached = this.get(key);
    if (cached !== undefined) {
      this.hits += 1;
      return cached;
    }
    const serialized = serializeVisualNormalizationCacheKey(key);
    const current = this.inFlight.get(serialized);
    if (current !== undefined) {
      this.hits += 1;
      return cloneValue(await current);
    }
    this.misses += 1;
    const pending = compute().then((value) => {
      if (!isValidValue(value)) {
        throw new Error("VISUAL_NORMALIZATION_CACHE_INVALID: computed entry is malformed");
      }
      this.set(key, value);
      return cloneValue(value);
    });
    this.inFlight.set(serialized, pending);
    try {
      return cloneValue(await pending);
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
      bypasses: this.bypasses,
      evictions: this.evictions,
      malformedEntries: this.malformedEntries,
    };
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

function isValidValue(value: VisualNormalizationCacheValue): boolean {
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

function cloneValue(value: VisualNormalizationCacheValue): VisualNormalizationCacheValue {
  return {
    png: Buffer.from(value.png),
    rgba: Buffer.from(value.rgba),
    width: value.width,
    height: value.height,
  };
}
