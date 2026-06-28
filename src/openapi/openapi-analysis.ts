import { z } from "zod";

import { ArtifactIdSchema, EvidenceIdSchema, GapIdSchema, SourceIdSchema } from "../runtime/ids.js";
import { Sha256DigestSchema } from "../runtime/scalars.js";
import { OpenApiInventorySchema } from "./openapi-inventory.js";

export const OpenApiAnalysisResultSchema = z
  .object({
    duplicate: z.boolean(),
    sourceId: SourceIdSchema,
    sourceDigest: Sha256DigestSchema,
    versionKind: z.string(),
    version: z.string().optional(),
    operationCount: z.number().int().nonnegative(),
    schemaCount: z.number().int().nonnegative(),
    securitySchemeCount: z.number().int().nonnegative(),
    refCount: z.number().int().nonnegative(),
    evidenceAdded: z.number().int().nonnegative(),
    gapsAdded: z.number().int().nonnegative(),
    artifactIds: z.array(ArtifactIdSchema),
    evidenceIds: z.array(EvidenceIdSchema),
    gapIds: z.array(GapIdSchema),
    inventory: OpenApiInventorySchema,
  })
  .strict();

export type OpenApiAnalysisResult = z.infer<typeof OpenApiAnalysisResultSchema>;
