import { z } from "zod";

export const FsdLayerSchema = z.enum(["app", "pages", "widgets", "features", "entities", "shared"]);

export const FsdSegmentSchema = z.enum([
  "ui",
  "model",
  "api",
  "lib",
  "config",
  "assets",
  "routes",
  "providers",
  "styles",
  "generated",
  "unknown",
]);

export const FsdModuleRefSchema = z
  .object({
    absolutePath: z.string().min(1),
    relativePath: z.string().min(1),
    layer: FsdLayerSchema.optional(),
    slice: z.string().optional(),
    segment: FsdSegmentSchema.optional(),
    publicApi: z.boolean().default(false),
  })
  .strict();

export type FsdLayer = z.infer<typeof FsdLayerSchema>;
export type FsdSegment = z.infer<typeof FsdSegmentSchema>;
export type FsdModuleRef = z.infer<typeof FsdModuleRefSchema>;

export const FSD_LAYER_RANK: Record<FsdLayer, number> = {
  app: 6,
  pages: 5,
  widgets: 4,
  features: 3,
  entities: 2,
  shared: 1,
};

export function compareFsdLayer(source: FsdLayer, target: FsdLayer): "allowed" | "upward" {
  return FSD_LAYER_RANK[target] <= FSD_LAYER_RANK[source] ? "allowed" : "upward";
}

export function isFsdLayer(value: string): value is FsdLayer {
  return FsdLayerSchema.safeParse(value).success;
}

export function isPublicApiPath(relativePath: string): boolean {
  return /(?:^|\/)index\.(ts|tsx|js|jsx)$/.test(relativePath);
}
