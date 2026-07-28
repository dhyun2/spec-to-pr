import { createHash } from "node:crypto";

import type { VisualSize } from "../figma/figma-capture-contract.js";
import { VisualSizeSchema } from "../figma/figma-capture-contract.js";
import { createPng, encodePng } from "./png-codec.js";
import { decodeBoundedPng, MAX_VISUAL_PIXEL_COUNT } from "./png-decoder.js";
import {
  VisualNormalizationCache,
  type VisualNormalizationCacheKey,
  type VisualNormalizationCacheValue,
} from "./visual-normalization-cache.js";

export const VISUAL_NORMALIZER_VERSION = "visual-normalizer-v1";
export const defaultVisualNormalizationCache = new VisualNormalizationCache();

export async function normalizeVisualPng(input: {
  content: Buffer;
  sourceDigest?: `sha256:${string}`;
  sourceSize: VisualSize;
  logicalSize: VisualSize;
  colorSpace: "srgb";
  role: string;
  cache?: VisualNormalizationCache | false;
  cacheRead?: boolean;
}): Promise<{
  content: Buffer;
  rgba: Buffer;
  width: number;
  height: number;
  version: "visual-normalizer-v1";
  cacheStatus: "hit" | "miss" | "bypassed";
}> {
  const sourceSize = VisualSizeSchema.parse(input.sourceSize);
  const logicalSize = VisualSizeSchema.parse(input.logicalSize);
  if (input.colorSpace !== "srgb") {
    throw new Error("FIGMA_CAPTURE_GEOMETRY_INVALID: visual normalization requires sRGB");
  }
  if (logicalSize.width > Math.floor(MAX_VISUAL_PIXEL_COUNT / logicalSize.height)) {
    throw new Error(
      `VISUAL_PIXEL_LIMIT: normalized ${input.role} ${logicalSize.width}x${logicalSize.height} exceeds ${MAX_VISUAL_PIXEL_COUNT} pixels`,
    );
  }

  const cache = input.cache === undefined ? defaultVisualNormalizationCache : input.cache;
  const key: VisualNormalizationCacheKey = {
    sourceDigest:
      input.sourceDigest ?? `sha256:${createHash("sha256").update(input.content).digest("hex")}`,
    normalizerVersion: VISUAL_NORMALIZER_VERSION,
    sourceSize,
    logicalSize,
    colorSpace: input.colorSpace,
    options: {
      alphaMode: "premultiplied",
      interpolation: "nearest",
    },
  };
  if (cache === false || input.cacheRead === false) {
    (cache === false ? defaultVisualNormalizationCache : cache).recordBypass();
    const normalized = await computeNormalizedVisual(
      input.content,
      sourceSize,
      logicalSize,
      input.role,
    );
    return toResult(normalized, "bypassed");
  }
  const before = cache.snapshotStats();
  const normalized = await cache.getOrCompute(key, () =>
    computeNormalizedVisual(input.content, sourceSize, logicalSize, input.role),
  );
  const cacheStatus = cache.snapshotStats().hits > before.hits ? "hit" : "miss";
  return toResult(normalized, cacheStatus);
}

async function computeNormalizedVisual(
  content: Buffer,
  sourceSize: VisualSize,
  logicalSize: VisualSize,
  role: string,
): Promise<VisualNormalizationCacheValue> {
  const source = await decodeBoundedPng(content, role);
  if (source.width !== sourceSize.width || source.height !== sourceSize.height) {
    throw new Error(
      `FIGMA_CAPTURE_GEOMETRY_INVALID: decoded ${role} is ${source.width}x${source.height}, expected ${sourceSize.width}x${sourceSize.height}`,
    );
  }

  const output = createPng(logicalSize.width, logicalSize.height);
  for (let y = 0; y < logicalSize.height; y += 1) {
    for (let x = 0; x < logicalSize.width; x += 1) {
      const sourceX = Math.min(
        source.width - 1,
        Math.floor((x * source.width) / logicalSize.width),
      );
      const sourceY = Math.min(
        source.height - 1,
        Math.floor((y * source.height) / logicalSize.height),
      );
      const outputOffset = (y * logicalSize.width + x) * 4;

      for (let channel = 0; channel < 3; channel += 1) {
        output.data[outputOffset + channel] = Math.round(
          opaqueChannel(source.data, source.width, sourceX, sourceY, channel),
        );
      }
      output.data[outputOffset + 3] = 255;
    }
  }

  return {
    png: encodePng(output),
    rgba: Buffer.from(output.data),
    width: logicalSize.width,
    height: logicalSize.height,
  };
}

function toResult(value: VisualNormalizationCacheValue, cacheStatus: "hit" | "miss" | "bypassed") {
  return {
    content: Buffer.from(value.png),
    rgba: Buffer.from(value.rgba),
    width: value.width,
    height: value.height,
    version: VISUAL_NORMALIZER_VERSION,
    cacheStatus,
  } as const;
}

function opaqueChannel(data: Buffer, width: number, x: number, y: number, channel: number): number {
  const offset = (y * width + x) * 4;
  const alpha = data[offset + 3]! / 255;
  return data[offset + channel]! * alpha + 255 * (1 - alpha);
}
