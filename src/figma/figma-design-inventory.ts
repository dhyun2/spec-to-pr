import { z } from "zod";

import { ArtifactIdSchema, GapIdSchema, SourceIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema, Sha256DigestSchema } from "../runtime/scalars.js";

export const FigmaComponentInventoryItemSchema = z
  .object({
    nodeId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    type: z.string().trim().min(1).optional(),
    componentName: z.string().trim().min(1).optional(),
    mainComponentId: z.string().trim().min(1).optional(),
    variantProperties: z.record(z.string(), z.string()).default({}),
    codeConnectComponent: z.string().trim().min(1).optional(),
    codeConnectSource: z.string().trim().min(1).optional(),
    mapped: z.boolean(),
  })
  .strict();

export const FigmaTokenInventoryItemSchema = z
  .object({
    name: z.string().trim().min(1),
    kind: z.enum(["color", "spacing", "radius", "typography", "effect", "unknown"]),
    value: z.unknown().optional(),
    source: z.enum(["variable-defs", "design-context", "metadata", "unknown"]),
  })
  .strict();

export const FigmaAssetInventoryItemSchema = z
  .object({
    nodeId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    kind: z.enum(["icon", "vector", "image", "unknown"]),
    exportable: z.boolean().optional(),
  })
  .strict();

export const FigmaProviderComparisonSchema = z
  .object({
    comparedProviderIds: z.array(z.string().trim().min(1)).default([]),
    metadataMismatch: z.boolean().default(false),
    screenshotMissing: z.boolean().default(false),
    variableDefsMissing: z.boolean().default(false),
    codeConnectMissing: z.boolean().default(false),
    notes: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const FigmaDesignInventorySchema = z
  .object({
    sourceId: SourceIdSchema,
    sourceDigest: Sha256DigestSchema.optional(),
    generatedAt: IsoDateTimeSchema,
    sourceArtifactIds: z.array(ArtifactIdSchema).default([]),
    components: z.array(FigmaComponentInventoryItemSchema).default([]),
    tokens: z.array(FigmaTokenInventoryItemSchema).default([]),
    assets: z.array(FigmaAssetInventoryItemSchema).default([]),
    providerComparison: FigmaProviderComparisonSchema,
    gapIds: z.array(GapIdSchema).default([]),
  })
  .strict();

export type FigmaComponentInventoryItem = z.infer<typeof FigmaComponentInventoryItemSchema>;
export type FigmaTokenInventoryItem = z.infer<typeof FigmaTokenInventoryItemSchema>;
export type FigmaAssetInventoryItem = z.infer<typeof FigmaAssetInventoryItemSchema>;
export type FigmaProviderComparison = z.infer<typeof FigmaProviderComparisonSchema>;
export type FigmaDesignInventory = z.infer<typeof FigmaDesignInventorySchema>;
