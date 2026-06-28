import { z } from "zod";

import { ArtifactIdSchema, EvidenceIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { OpenSpecChangeNameSchema, OpenSpecSpecAreaSchema } from "./openspec-paths.js";

export const OpenSpecRequirementStatusSchema = z.enum(["ready", "blocked", "partial", "gap-only"]);

export const OpenSpecRequirementModelSchema = z
  .object({
    id: z.string().trim().min(1),
    area: OpenSpecSpecAreaSchema,
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    status: OpenSpecRequirementStatusSchema,
    briefEvidenceIds: z.array(EvidenceIdSchema).default([]),
    figmaEvidenceIds: z.array(EvidenceIdSchema).default([]),
    openApiEvidenceIds: z.array(EvidenceIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    tags: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const OpenSpecChangeModelSchema = z
  .object({
    runId: RunIdSchema,
    changeName: OpenSpecChangeNameSchema,
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    generatedAt: z.string().datetime({ offset: true }),
    sourceArtifactIds: z.array(ArtifactIdSchema).default([]),
    requirements: z.array(OpenSpecRequirementModelSchema),
    gapIds: z.array(GapIdSchema).default([]),
    specAreas: z.array(OpenSpecSpecAreaSchema),
  })
  .strict();

export type OpenSpecRequirementStatus = z.infer<typeof OpenSpecRequirementStatusSchema>;
export type OpenSpecRequirementModel = z.infer<typeof OpenSpecRequirementModelSchema>;
export type OpenSpecChangeModel = z.infer<typeof OpenSpecChangeModelSchema>;
