import { z } from "zod";

import { Sha256DigestSchema } from "../runtime/scalars.js";

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

const RepositoryPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[a-z]:[\\/]/i.test(value) &&
      !value.split(/[\\/]/).some((segment) => segment === ".."),
    "Path must be repository-relative",
  );

export const CapturedFigmaComponentSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    nodeId: z.string().trim().min(1).max(500),
  })
  .strict();

const ComponentResolutionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("component"),
      module: z.string().trim().min(1).max(500),
      exportName: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("asset"),
      path: RepositoryPathSchema,
      digest: Sha256DigestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("exception"),
      reason: z.string().trim().min(1).max(1_000),
    })
    .strict(),
]);

export const FigmaDesignMappingSchema = z
  .object({
    designSystem: z
      .object({
        packageName: z
          .string()
          .trim()
          .min(1)
          .max(214)
          .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i),
        packageVersion: z
          .string()
          .trim()
          .regex(
            /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
            "Design-system package version must be an exact semantic version",
          ),
        guidanceSkill: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
    components: z
      .array(
        z
          .object({
            figmaComponent: z.string().trim().min(1).max(500),
            nodeId: z.string().trim().min(1).max(500),
            resolution: ComponentResolutionSchema,
          })
          .strict(),
      )
      .max(1_000),
    fonts: z
      .array(
        z
          .object({
            family: z.string().trim().min(1).max(300),
            source: z.string().trim().min(1).max(1_000),
            digest: Sha256DigestSchema.optional(),
          })
          .strict(),
      )
      .max(200),
    tokens: z
      .array(
        z
          .object({
            figmaVariable: z.string().trim().min(1).max(500),
            codeToken: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(2_000),
  })
  .strict();

export type CapturedFigmaComponent = z.infer<typeof CapturedFigmaComponentSchema>;
export type FigmaDesignMapping = z.infer<typeof FigmaDesignMappingSchema>;

export function assertCompleteDesignMapping(rawInput: {
  capturedComponents: CapturedFigmaComponent[];
  mapping: FigmaDesignMapping;
}): void {
  const parsed = z
    .object({
      capturedComponents: z.array(CapturedFigmaComponentSchema).max(1_000),
      mapping: FigmaDesignMappingSchema,
    })
    .strict()
    .safeParse(rawInput);
  if (!parsed.success) {
    throw designMappingError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  const capturedKeys = parsed.data.capturedComponents.map(componentKey);
  const mappedKeys = parsed.data.mapping.components.map((component) =>
    componentKey({ name: component.figmaComponent, nodeId: component.nodeId }),
  );
  const duplicateCaptured = duplicates(capturedKeys);
  const duplicateMapped = duplicates(mappedKeys);
  const captured = new Set(capturedKeys);
  const mapped = new Set(mappedKeys);
  const missing = [...captured].filter((key) => !mapped.has(key));
  const unbound = [...mapped].filter((key) => !captured.has(key));
  if (
    duplicateCaptured.length > 0 ||
    duplicateMapped.length > 0 ||
    missing.length > 0 ||
    unbound.length > 0
  ) {
    throw designMappingError(
      `missing: ${missing.join(", ") || "none"}; unbound: ${unbound.join(", ") || "none"}; duplicate captured: ${duplicateCaptured.join(", ") || "none"}; duplicate mappings: ${duplicateMapped.join(", ") || "none"}`,
    );
  }

  assertUniqueMappingValues(
    parsed.data.mapping.fonts.map((font) => font.family),
    "font families",
  );
  assertUniqueMappingValues(
    parsed.data.mapping.tokens.map((token) => token.figmaVariable),
    "Figma variables",
  );
}

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

function componentKey(component: CapturedFigmaComponent): string {
  return `${component.name}\u0000${component.nodeId}`;
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function assertUniqueMappingValues(values: string[], label: string): void {
  const duplicateValues = duplicates(values);
  if (duplicateValues.length > 0) {
    throw designMappingError(`duplicate ${label}: ${duplicateValues.join(", ")}`);
  }
}

function designMappingError(message: string): Error {
  return new Error(`FIGMA_DESIGN_MAPPING_INCOMPLETE: ${message}`);
}
