import { z } from "zod";

import { EvidenceIdSchema, GapIdSchema, SourceIdSchema } from "../runtime/ids.js";
import { Sha256DigestSchema } from "../runtime/scalars.js";
import { EvidenceLocationSchema } from "../runtime/source.js";
import { BriefIssueFlagSchema, BriefItemTypeSchema } from "./brief-classifier.js";

export const BriefExtractedItemSchema = z
  .object({
    evidenceId: EvidenceIdSchema,
    itemType: BriefItemTypeSchema,
    location: EvidenceLocationSchema,
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    summary: z.string().trim().min(1),
    headingPath: z.array(z.string()).default([]),
    flags: z.array(BriefIssueFlagSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
  })
  .strict();

export const BriefAnalysisResultSchema = z
  .object({
    sourceId: SourceIdSchema,
    sourceDigest: Sha256DigestSchema,
    duplicate: z.boolean(),
    sectionCount: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    evidenceAdded: z.number().int().nonnegative(),
    gapsAdded: z.number().int().nonnegative(),
    items: z.array(BriefExtractedItemSchema),
  })
  .strict();

export type BriefExtractedItem = z.infer<typeof BriefExtractedItemSchema>;
export type BriefAnalysisResult = z.infer<typeof BriefAnalysisResultSchema>;
