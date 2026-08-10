import type { PngImage } from "./png-codec.js";

export const MAX_VISUAL_PIXEL_COUNT = 8_388_608;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type PngGeometry = { width: number; height: number };

export async function decodeBoundedPng(content: Buffer, role: string): Promise<PngImage> {
  assertBoundedPng(content, role);
  try {
    const { decodePng } = await import("./png-codec.js");
    const image = decodePng(content);
    if (image.width < 1 || image.height < 1) throw new Error("empty image");
    return image;
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("VISUAL_")) throw error;
    throw new Error(`VISUAL_INVALID_PNG: ${role} must be a valid PNG with non-empty dimensions`);
  }
}

export function assertBoundedPng(content: Buffer, role: string): void {
  const { width, height } = readPngGeometry(content, role);
  if (width > Math.floor(MAX_VISUAL_PIXEL_COUNT / height)) {
    throw new Error(
      `VISUAL_PIXEL_LIMIT: ${role} ${width}x${height} exceeds ${MAX_VISUAL_PIXEL_COUNT} pixels`,
    );
  }
}

/**
 * Reads PNG dimensions without decoding pixel data or applying the comparison
 * memory budget. Contract intake uses this to reject a viewport/full-page
 * mismatch before the comparison path reaches the generic pixel-limit error.
 */
export function readPngGeometry(content: Buffer, role: string): PngGeometry {
  if (
    content.byteLength < 24 ||
    !content.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE) ||
    content.readUInt32BE(8) !== 13 ||
    content.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error(`VISUAL_INVALID_PNG: ${role} must be a valid PNG with non-empty dimensions`);
  }
  const width = content.readUInt32BE(16);
  const height = content.readUInt32BE(20);
  if (width < 1 || height < 1) {
    throw new Error(`VISUAL_INVALID_PNG: ${role} must be a valid PNG with non-empty dimensions`);
  }
  return { width, height };
}
