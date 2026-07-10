import { z } from "zod";

import { ArtifactIdSchema, EvidenceIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";

export const DesignUiContextPackSchema = z
  .object({
    runId: RunIdSchema,
    changeName: z.string().trim().min(1),
    agent: z.literal("design-ui"),
    worktreePath: z.string().trim().min(1),
    contextRoot: z.string().trim().min(1),
    designContractArtifactId: ArtifactIdSchema,
    figmaInventoryArtifactId: ArtifactIdSchema.optional(),
    openSpecArtifactIds: z.array(ArtifactIdSchema).default([]),
    gherkinArtifactIds: z.array(ArtifactIdSchema).default([]),
    apiContractArtifactIds: z.array(ArtifactIdSchema).default([]),
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    files: z
      .object({
        agentBrief: z.string().trim().min(1),
        designContract: z.string().trim().min(1),
        figmaInventory: z.string().trim().min(1),
        figmaEvidenceSummary: z.string().trim().min(1),
        openSpecSummary: z.string().trim().min(1),
        gherkinSummary: z.string().trim().min(1),
        apiWrapperContract: z.string().trim().min(1),
        fsdOwnershipPolicy: z.string().trim().min(1),
        allowedFiles: z.string().trim().min(1),
        forbiddenImports: z.string().trim().min(1),
        implementationPlanTemplate: z.string().trim().min(1),
        resultSchema: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

export const DesignUiAllowedFilesSchema = z
  .object({
    writableGlobs: z.array(z.string().trim().min(1)),
    readonlyGlobs: z.array(z.string().trim().min(1)),
    forbiddenGlobs: z.array(z.string().trim().min(1)),
  })
  .strict();

export const DesignUiForbiddenImportsSchema = z
  .object({
    forbiddenPatterns: z.array(z.string().trim().min(1)),
    message: z.string().trim().min(1),
  })
  .strict();

export type DesignUiContextPack = z.infer<typeof DesignUiContextPackSchema>;
export type DesignUiAllowedFiles = z.infer<typeof DesignUiAllowedFilesSchema>;
export type DesignUiForbiddenImports = z.infer<typeof DesignUiForbiddenImportsSchema>;
