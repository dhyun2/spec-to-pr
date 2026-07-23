import { z } from "zod";

export const VisualSizeSchema = z
  .object({
    width: z.number().int().positive().max(10_000),
    height: z.number().int().positive().max(10_000),
  })
  .strict();

export const FigmaCaptureGeometrySchema = z
  .object({
    nodeId: z.string().trim().min(1).max(500),
    captureKind: z.enum(["viewport", "full-frame"]),
    logicalSize: VisualSizeSchema,
    exportScale: z.number().positive().max(8),
    bitmapSize: VisualSizeSchema,
    colorSpace: z.literal("srgb"),
  })
  .strict();

export type VisualSize = z.infer<typeof VisualSizeSchema>;
export type FigmaCaptureGeometry = z.infer<typeof FigmaCaptureGeometrySchema>;

export function assertFigmaCaptureGeometry(rawInput: {
  geometry: FigmaCaptureGeometry;
  viewport: VisualSize;
  decodedSize: VisualSize;
}): void {
  const geometry = FigmaCaptureGeometrySchema.parse(rawInput.geometry);
  const viewport = VisualSizeSchema.parse(rawInput.viewport);
  const decodedSize = VisualSizeSchema.parse(rawInput.decodedSize);

  if (
    decodedSize.width !== geometry.bitmapSize.width ||
    decodedSize.height !== geometry.bitmapSize.height
  ) {
    throw geometryError(
      `decoded PNG is ${decodedSize.width}x${decodedSize.height}, manifest bitmap is ${geometry.bitmapSize.width}x${geometry.bitmapSize.height}`,
    );
  }
  if (
    viewport.width !== geometry.logicalSize.width ||
    viewport.height !== geometry.logicalSize.height
  ) {
    throw geometryError(
      `browser viewport ${viewport.width}x${viewport.height} must use logical ${geometry.logicalSize.width}x${geometry.logicalSize.height}, not the exported bitmap`,
    );
  }

  const expectedWidth = geometry.logicalSize.width * geometry.exportScale;
  const expectedHeight = geometry.logicalSize.height * geometry.exportScale;
  if (
    Math.abs(geometry.bitmapSize.width - expectedWidth) > 1 ||
    Math.abs(geometry.bitmapSize.height - expectedHeight) > 1
  ) {
    throw geometryError(
      `bitmap ${geometry.bitmapSize.width}x${geometry.bitmapSize.height} does not match export scale ${geometry.exportScale} from logical ${geometry.logicalSize.width}x${geometry.logicalSize.height}`,
    );
  }
}

function geometryError(message: string): Error {
  return new Error(`FIGMA_CAPTURE_GEOMETRY_INVALID: ${message}`);
}
