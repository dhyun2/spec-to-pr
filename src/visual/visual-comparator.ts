import { z } from "zod";

import { FigmaCaptureGeometrySchema } from "../figma/figma-capture-contract.js";
import { IsoDateTimeSchema, Sha256DigestSchema } from "../runtime/scalars.js";
import { VISUAL_POLICY } from "../workflow/delivery-mode-policy.js";
import { decodeBoundedPng } from "./png-decoder.js";
import type { PngImage } from "./png-codec.js";

export const DEFAULT_VISUAL_REVIEW_THRESHOLD = VISUAL_POLICY.reviewThreshold;
export const DEFAULT_VISUAL_PIXEL_TOLERANCE = 0.02;
export const MAX_VISUAL_MASK_AREA_RATIO = VISUAL_POLICY.maxMaskedAreaRatio;
export const MAX_VISUAL_REPAIR_ATTEMPTS = VISUAL_POLICY.maxComparisonAttempts;

export const VisualMaskSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const VisualTargetManifestCoreSchema = z
  .object({
    targetId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9][a-z0-9._:-]*$/i),
    name: z.string().trim().min(1).max(200),
    state: z.string().trim().min(1).max(200),
    route: z.string().trim().min(1).max(2_000),
    baselineKind: z.enum(["figma", "legacy-screenshot"]),
    baselinePath: z
      .string()
      .trim()
      .regex(/\.png$/i),
    viewport: z
      .object({
        width: z.number().int().positive().max(10_000),
        height: z.number().int().positive().max(10_000),
      })
      .strict(),
    deviceScaleFactor: z.number().positive().max(8),
    fixture: z.string().trim().min(1).max(2_000),
    figmaCapture: FigmaCaptureGeometrySchema.optional(),
    masks: z.array(VisualMaskSchema).max(50).default([]),
  })
  .strict();

export const VisualTargetManifestCompatibilitySchema = VisualTargetManifestCoreSchema.extend({
  reviewThreshold: z.number().min(0).max(1).optional(),
}).strict();

export const VisualTargetManifestSchema = VisualTargetManifestCoreSchema.extend({
  reviewThreshold: z
    .literal(VISUAL_POLICY.reviewThreshold)
    .default(VISUAL_POLICY.reviewThreshold),
}).strict();

export const VisualCaptureSchema = z
  .object({
    targetId: VisualTargetManifestSchema.shape.targetId,
    route: VisualTargetManifestSchema.shape.route,
    state: VisualTargetManifestSchema.shape.state,
    viewport: VisualTargetManifestSchema.shape.viewport,
    deviceScaleFactor: VisualTargetManifestSchema.shape.deviceScaleFactor,
    fixture: VisualTargetManifestSchema.shape.fixture,
    provider: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9._:-]*$/i),
    capturedAt: IsoDateTimeSchema,
    actualPath: z
      .string()
      .trim()
      .regex(/\.png$/i),
    actualDigest: Sha256DigestSchema,
    receiptPath: z
      .string()
      .trim()
      .regex(/\.json$/i)
      .optional(),
    receiptDigest: Sha256DigestSchema.optional(),
  })
  .strict()
  .superRefine((capture, context) => {
    if ((capture.receiptPath === undefined) !== (capture.receiptDigest === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["receiptPath"],
        message: "Visual receipt path and digest must be supplied together",
      });
    }
  });

export const VisualComparisonMetricsV2Schema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    comparedPixelCount: z.number().int().positive(),
    maskedPixelCount: z.number().int().nonnegative(),
    maskedAreaRatio: z.number().min(0).max(1),
    exactMatchRatio: z.number().min(0).max(1),
    reviewMatchRatio: z.number().min(0).max(1),
    meanDistance: z.number().min(0).max(1),
    maxDistance: z.number().min(0).max(1),
    pixelTolerance: z.number().min(0).max(1),
    threshold: z.number().min(0).max(1),
  })
  .strict();

export type VisualMask = z.infer<typeof VisualMaskSchema>;
export type VisualTargetManifest = Omit<
  z.infer<typeof VisualTargetManifestCompatibilitySchema>,
  "reviewThreshold"
> & {
  reviewThreshold: typeof VISUAL_POLICY.reviewThreshold;
};
export type VisualComparisonMetricsV2 = z.infer<typeof VisualComparisonMetricsV2Schema>;

export function normalizeVisualTargetManifest(raw: unknown): VisualTargetManifest {
  const parsed = VisualTargetManifestCompatibilitySchema.parse(raw);
  return {
    ...parsed,
    reviewThreshold: VISUAL_POLICY.reviewThreshold,
  };
}

export type VisualComparisonOutput = {
  status: "passed" | "failed";
  metrics: VisualComparisonMetricsV2;
  maskReasons: string[];
  diff: Buffer;
  overlay: Buffer;
};

export async function compareVisualPngs(input: {
  baseline: Buffer;
  actual: Buffer;
  masks?: VisualMask[];
  pixelTolerance?: number;
}): Promise<VisualComparisonOutput> {
  const [{ createPng, encodePng }, baseline, actual] = await Promise.all([
    import("./png-codec.js"),
    readPng(input.baseline, "baseline"),
    readPng(input.actual, "actual"),
  ]);
  return compareDecodedVisualPngs({
    baseline,
    actual,
    createPng,
    encodePng,
    ...(input.masks === undefined ? {} : { masks: input.masks }),
    ...(input.pixelTolerance === undefined ? {} : { pixelTolerance: input.pixelTolerance }),
    threshold: VISUAL_POLICY.reviewThreshold,
  });
}

function compareDecodedVisualPngs(input: {
  baseline: PngImage;
  actual: PngImage;
  createPng: (width: number, height: number) => PngImage;
  encodePng: (image: PngImage) => Buffer;
  masks?: VisualMask[];
  pixelTolerance?: number;
  threshold: typeof VISUAL_POLICY.reviewThreshold;
}): VisualComparisonOutput {
  const { baseline, actual, createPng, encodePng, threshold } = input;
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    throw new Error(
      `VISUAL_DIMENSION_MISMATCH: baseline is ${baseline.width}x${baseline.height}, actual is ${actual.width}x${actual.height}`,
    );
  }

  const masks = z
    .array(VisualMaskSchema)
    .max(50)
    .parse(input.masks ?? []);
  const masked = buildMaskBitmap(baseline.width, baseline.height, masks);
  const totalPixelCount = baseline.width * baseline.height;
  const maskedPixelCount = masked.reduce((total, value) => total + value, 0);
  const comparedPixelCount = totalPixelCount - maskedPixelCount;
  if (comparedPixelCount === 0) {
    throw new Error(
      "VISUAL_ALL_PIXELS_MASKED: a visual comparison cannot mask the complete target",
    );
  }
  const maskedAreaRatio = maskedPixelCount / totalPixelCount;
  if (maskedAreaRatio > MAX_VISUAL_MASK_AREA_RATIO) {
    throw new Error(
      `VISUAL_EXCESSIVE_MASK: masked area ${(maskedAreaRatio * 100).toFixed(2)}% exceeds the ${(MAX_VISUAL_MASK_AREA_RATIO * 100).toFixed(0)}% limit`,
    );
  }

  const pixelTolerance = z
    .number()
    .min(0)
    .max(1)
    .parse(input.pixelTolerance ?? DEFAULT_VISUAL_PIXEL_TOLERANCE);
  const diff = createPng(baseline.width, baseline.height);
  const overlay = createPng(baseline.width, baseline.height);
  let exactMatches = 0;
  let reviewMatches = 0;
  let distanceTotal = 0;
  let maxDistance = 0;

  for (let pixel = 0; pixel < totalPixelCount; pixel += 1) {
    const offset = pixel * 4;
    writeOverlayPixel(overlay.data, offset, baseline.data, actual.data);
    if (masked[pixel] === 1) {
      writeMaskedPixel(diff.data, offset);
      continue;
    }

    const exact = rgbaEqual(baseline.data, actual.data, offset);
    if (exact) exactMatches += 1;
    const distance = rgbaLinearDistance(baseline.data, actual.data, offset);
    if (distance <= pixelTolerance) reviewMatches += 1;
    distanceTotal += distance;
    maxDistance = Math.max(maxDistance, distance);
    writeDiffPixel(diff.data, offset, distance, exact);
  }

  const metrics = VisualComparisonMetricsV2Schema.parse({
    width: baseline.width,
    height: baseline.height,
    comparedPixelCount,
    maskedPixelCount,
    maskedAreaRatio,
    exactMatchRatio: exactMatches / comparedPixelCount,
    reviewMatchRatio: reviewMatches / comparedPixelCount,
    meanDistance: distanceTotal / comparedPixelCount,
    maxDistance,
    pixelTolerance,
    threshold,
  });

  return {
    status: metrics.reviewMatchRatio >= threshold ? "passed" : "failed",
    metrics,
    maskReasons: [...new Set(masks.map((mask) => mask.reason))],
    diff: encodePng(diff),
    overlay: encodePng(overlay),
  };
}

function readPng(content: Buffer, role: string) {
  return decodeBoundedPng(content, role);
}

function buildMaskBitmap(width: number, height: number, masks: VisualMask[]): Uint8Array {
  const bitmap = new Uint8Array(width * height);
  for (const mask of masks) {
    if (mask.x + mask.width > width || mask.y + mask.height > height) {
      throw new Error(
        `VISUAL_MASK_OUT_OF_BOUNDS: ${mask.reason} exceeds the ${width}x${height} target`,
      );
    }
    for (let y = mask.y; y < mask.y + mask.height; y += 1) {
      for (let x = mask.x; x < mask.x + mask.width; x += 1) {
        bitmap[y * width + x] = 1;
      }
    }
  }
  return bitmap;
}

function rgbaEqual(baseline: Buffer, actual: Buffer, offset: number): boolean {
  return (
    baseline[offset] === actual[offset] &&
    baseline[offset + 1] === actual[offset + 1] &&
    baseline[offset + 2] === actual[offset + 2] &&
    baseline[offset + 3] === actual[offset + 3]
  );
}

function rgbaLinearDistance(baseline: Buffer, actual: Buffer, offset: number): number {
  const baselineAlpha = baseline[offset + 3]! / 255;
  const actualAlpha = actual[offset + 3]! / 255;
  let squared = (baselineAlpha - actualAlpha) ** 2;
  for (let channel = 0; channel < 3; channel += 1) {
    const baselineValue = srgbToLinear(baseline[offset + channel]! / 255) * baselineAlpha;
    const actualValue = srgbToLinear(actual[offset + channel]! / 255) * actualAlpha;
    squared += (baselineValue - actualValue) ** 2;
  }
  return Math.min(1, Math.sqrt(squared / 4));
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function writeOverlayPixel(output: Buffer, offset: number, baseline: Buffer, actual: Buffer): void {
  for (let channel = 0; channel < 4; channel += 1) {
    output[offset + channel] = Math.round(
      (baseline[offset + channel]! + actual[offset + channel]!) / 2,
    );
  }
}

function writeMaskedPixel(output: Buffer, offset: number): void {
  output[offset] = 96;
  output[offset + 1] = 96;
  output[offset + 2] = 96;
  output[offset + 3] = 255;
}

function writeDiffPixel(output: Buffer, offset: number, distance: number, exact: boolean): void {
  if (exact) {
    output[offset] = 0;
    output[offset + 1] = 0;
    output[offset + 2] = 0;
    output[offset + 3] = 0;
    return;
  }
  output[offset] = 255;
  output[offset + 1] = Math.round(64 * (1 - distance));
  output[offset + 2] = 0;
  output[offset + 3] = Math.max(32, Math.round(255 * distance));
}
