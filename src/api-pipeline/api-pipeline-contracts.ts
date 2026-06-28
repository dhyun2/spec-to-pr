import { z } from "zod";

import { ArtifactIdSchema, EvidenceIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { Sha256DigestSchema } from "../runtime/scalars.js";

export const ApiPipelineModeSchema = z.enum([
  "existing-generator",
  "fallback-generator",
  "plan-only",
]);

export const ApiGeneratedFileKindSchema = z.enum([
  "typescript-types",
  "zod-schemas",
  "api-client",
  "feature-wrapper",
  "entity-wrapper",
  "mock-handler",
  "contract-test",
  "source-guard-test",
  "manifest",
  "report",
]);

export const ApiOperationPipelineItemSchema = z
  .object({
    operationKey: z.string().trim().min(1),
    method: z.string().trim().min(1),
    path: z.string().trim().min(1),
    operationId: z.string().trim().min(1).optional(),
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    wrapperName: z.string().trim().min(1).optional(),
    wrapperPath: z.string().trim().min(1).optional(),
    generatedClientSymbol: z.string().trim().min(1).optional(),
    status: z.enum(["planned", "generated", "skipped", "blocked"]),
    reason: z.string().trim().min(1),
    gapIds: z.array(GapIdSchema).default([]),
  })
  .strict();

export const ApiGeneratedFileSchema = z
  .object({
    kind: ApiGeneratedFileKindSchema,
    path: z.string().trim().min(1),
    digest: Sha256DigestSchema,
    changed: z.boolean(),
  })
  .strict();

export const ApiGeneratorPlanSchema = z
  .object({
    mode: ApiPipelineModeSchema,
    generatorName: z.string().trim().min(1),
    command: z.array(z.string().trim().min(1)).default([]),
    generatedRoot: z.string().trim().min(1),
    wrapperRoot: z.string().trim().min(1),
    sourceKey: z.string().trim().min(1),
    canRun: z.boolean(),
    reason: z.string().trim().min(1),
  })
  .strict();

export const ApiPipelineReportSchema = z
  .object({
    adapter: z.literal("api-pipeline-v1"),
    runId: RunIdSchema,
    sourceKey: z.string().trim().min(1),
    openApiSourceDigest: Sha256DigestSchema.optional(),
    openApiIntakeArtifactId: ArtifactIdSchema.optional(),
    mode: ApiPipelineModeSchema,
    generator: ApiGeneratorPlanSchema,
    operationCount: z.number().int().nonnegative(),
    generatedOperationCount: z.number().int().nonnegative(),
    skippedOperationCount: z.number().int().nonnegative(),
    blockedOperationCount: z.number().int().nonnegative(),
    operations: z.array(ApiOperationPipelineItemSchema),
    generatedFiles: z.array(ApiGeneratedFileSchema),
    warnings: z.array(z.string().trim().min(1)).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    artifactIds: z.array(ArtifactIdSchema).default([]),
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ApiPipelineMode = z.infer<typeof ApiPipelineModeSchema>;
export type ApiGeneratedFileKind = z.infer<typeof ApiGeneratedFileKindSchema>;
export type ApiOperationPipelineItem = z.infer<typeof ApiOperationPipelineItemSchema>;
export type ApiGeneratedFile = z.infer<typeof ApiGeneratedFileSchema>;
export type ApiGeneratorPlan = z.infer<typeof ApiGeneratorPlanSchema>;
export type ApiPipelineReport = z.infer<typeof ApiPipelineReportSchema>;
