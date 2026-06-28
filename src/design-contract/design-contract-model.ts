import { z } from "zod";

import { ArtifactIdSchema, EvidenceIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";

export const MappingConfidenceSchema = z.enum(["high", "medium", "low", "missing"]);

export const MappingSourceSchema = z.enum([
  "code-connect",
  "name-match",
  "token-match",
  "manual",
  "missing",
]);

export const ComponentMappingSchema = z
  .object({
    figmaNodeId: z.string().trim().min(1),
    figmaName: z.string().trim().min(1),
    figmaType: z.string().trim().min(1).optional(),
    codeComponent: z.string().trim().min(1).optional(),
    importPath: z.string().trim().min(1).optional(),
    propsHint: z.record(z.string(), z.unknown()).default({}),
    source: MappingSourceSchema,
    confidence: MappingConfidenceSchema,
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
  })
  .strict();

export const TokenMappingSchema = z
  .object({
    figmaVariable: z.string().trim().min(1),
    figmaValue: z.string().trim().optional(),
    tokenName: z.string().trim().min(1).optional(),
    cssVariable: z.string().trim().min(1).optional(),
    className: z.string().trim().min(1).optional(),
    category: z.enum(["color", "spacing", "radius", "shadow", "typography", "unknown"]),
    source: MappingSourceSchema,
    confidence: MappingConfidenceSchema,
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
  })
  .strict();

export const TypographyMappingSchema = z
  .object({
    figmaTextStyle: z.string().trim().min(1),
    fontFamily: z.string().trim().optional(),
    fontSize: z.string().trim().optional(),
    lineHeight: z.string().trim().optional(),
    codeClassName: z.string().trim().min(1).optional(),
    tokenName: z.string().trim().min(1).optional(),
    source: MappingSourceSchema,
    confidence: MappingConfidenceSchema,
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
  })
  .strict();

export const AssetMappingSchema = z
  .object({
    figmaNodeId: z.string().trim().min(1),
    figmaName: z.string().trim().min(1),
    assetType: z.enum(["icon", "image", "vector", "illustration", "unknown"]),
    codeAssetPath: z.string().trim().min(1).optional(),
    codeComponent: z.string().trim().min(1).optional(),
    exportRequired: z.boolean(),
    source: MappingSourceSchema,
    confidence: MappingConfidenceSchema,
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
  })
  .strict();

export const DesignContractGapSummarySchema = z
  .object({
    unmappedComponents: z.number().int().nonnegative(),
    unmappedTokens: z.number().int().nonnegative(),
    unmappedTypography: z.number().int().nonnegative(),
    unmappedAssets: z.number().int().nonnegative(),
    blockerGaps: z.number().int().nonnegative(),
    majorGaps: z.number().int().nonnegative(),
  })
  .strict();

export const FigmaDesignContractSchema = z
  .object({
    schemaVersion: z.literal("figma-design-contract-v1"),
    runId: RunIdSchema,
    changeName: z.string().trim().min(1),
    generatedAt: z.string().datetime({ offset: true }),
    sourceArtifactIds: z.array(ArtifactIdSchema).default([]),
    componentMappings: z.array(ComponentMappingSchema).default([]),
    tokenMappings: z.array(TokenMappingSchema).default([]),
    typographyMappings: z.array(TypographyMappingSchema).default([]),
    assetMappings: z.array(AssetMappingSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    gapSummary: DesignContractGapSummarySchema,
  })
  .strict();

export type MappingConfidence = z.infer<typeof MappingConfidenceSchema>;
export type MappingSource = z.infer<typeof MappingSourceSchema>;
export type ComponentMapping = z.infer<typeof ComponentMappingSchema>;
export type TokenMapping = z.infer<typeof TokenMappingSchema>;
export type TypographyMapping = z.infer<typeof TypographyMappingSchema>;
export type AssetMapping = z.infer<typeof AssetMappingSchema>;
export type FigmaDesignContract = z.infer<typeof FigmaDesignContractSchema>;
