import { z } from "zod";

import { SourceIdSchema } from "../runtime/ids.js";
import { EvidenceLocationSchema } from "../runtime/source.js";
import { Sha256DigestSchema } from "../runtime/scalars.js";

export const NormalizedBriefFormatSchema = z.enum([
  "markdown",
  "plaintext",
  "pdf",
  "ticket",
  "html",
  "unknown",
]);

export const NormalizedBriefBlockKindSchema = z.enum([
  "heading",
  "paragraph",
  "list-item",
  "table-row",
  "ticket-field",
  "pdf-text-block",
  "unsupported",
]);

export const NormalizedBriefBlockSchema = z
  .object({
    blockId: z.string().trim().min(1),
    kind: NormalizedBriefBlockKindSchema,
    text: z.string(),
    location: EvidenceLocationSchema,
    headingPath: z.array(z.string()).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const NormalizedBriefDocumentSchema = z
  .object({
    sourceId: SourceIdSchema,
    sourceDigest: Sha256DigestSchema,
    format: NormalizedBriefFormatSchema,
    title: z.string().trim().min(1).optional(),
    blocks: z.array(NormalizedBriefBlockSchema),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type NormalizedBriefFormat = z.infer<typeof NormalizedBriefFormatSchema>;
export type NormalizedBriefBlockKind = z.infer<typeof NormalizedBriefBlockKindSchema>;
export type NormalizedBriefBlock = z.infer<typeof NormalizedBriefBlockSchema>;
export type NormalizedBriefDocument = z.infer<typeof NormalizedBriefDocumentSchema>;
