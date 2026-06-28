import { z } from "zod";

import { OpenSpecChangeNameSchema } from "../openspec/openspec-paths.js";
import { ArtifactIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema } from "../runtime/scalars.js";

export const ReviewProviderSchema = z.enum(["github", "gitlab", "manual"]);

export const ReviewRequestMergeStatusSchema = z
  .object({
    provider: ReviewProviderSchema,
    reviewRequestUrl: z.string().url().optional(),
    projectPath: z.string().trim().min(1).optional(),
    number: z.string().trim().min(1).optional(),
    merged: z.boolean(),
    mergedAt: IsoDateTimeSchema.optional(),
    mergedBy: z.string().trim().min(1).optional(),
    mergedCommitSha: GitObjectIdSchema.optional(),
    sourceBranch: z.string().trim().min(1).optional(),
    targetBranch: z.string().trim().min(1).optional(),
    raw: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .superRefine((status, context) => {
    if (status.merged && status.mergedAt === undefined) {
      context.addIssue({
        code: "custom",
        message: "Merged review request requires mergedAt",
        path: ["mergedAt"],
      });
    }

    if (status.merged && status.mergedCommitSha === undefined) {
      context.addIssue({
        code: "custom",
        message: "Merged review request requires mergedCommitSha",
        path: ["mergedCommitSha"],
      });
    }
  });

export const ReviewRequestMergeVerificationSchema = z
  .object({
    runId: RunIdSchema,
    review: ReviewRequestMergeStatusSchema,
    verified: z.boolean(),
    warnings: z.array(z.string().trim().min(1)).default([]),
    publishResultArtifactId: ArtifactIdSchema.optional(),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export const ArchivePreconditionStatusSchema = z.enum(["passed", "failed", "warning", "skipped"]);

export const ArchivePreconditionSchema = z
  .object({
    id: z.string().trim().min(1),
    status: ArchivePreconditionStatusSchema,
    summary: z.string().trim().min(1),
    blocking: z.boolean(),
    artifactIds: z.array(ArtifactIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
  })
  .strict();

export const OpenSpecArchivePlanSchema = z
  .object({
    runId: RunIdSchema,
    changeName: OpenSpecChangeNameSchema,
    generatedAt: IsoDateTimeSchema,
    review: ReviewRequestMergeStatusSchema,
    canExecute: z.boolean(),
    preconditions: z.array(ArchivePreconditionSchema),
    expectedChangeRoot: z.string().trim().min(1),
    expectedArchiveRoot: z.string().trim().min(1).optional(),
    command: z.array(z.string().trim().min(1)),
    requiresFollowUpCommit: z.boolean(),
    notes: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const OpenSpecArchiveExecutionStatusSchema = z.enum([
  "passed",
  "failed",
  "blocked",
  "skipped",
]);

export const OpenSpecArchiveExecutionResultSchema = z
  .object({
    runId: RunIdSchema,
    changeName: OpenSpecChangeNameSchema,
    status: OpenSpecArchiveExecutionStatusSchema,
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    command: z.array(z.string().trim().min(1)),
    exitCode: z.number().int().optional(),
    stdoutArtifactId: ArtifactIdSchema.optional(),
    stderrArtifactId: ArtifactIdSchema.optional(),
    resultArtifactId: ArtifactIdSchema.optional(),
    reportArtifactId: ArtifactIdSchema.optional(),
    archivePath: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(1),
  })
  .strict();

export type ReviewProvider = z.infer<typeof ReviewProviderSchema>;
export type ReviewRequestMergeStatus = z.infer<typeof ReviewRequestMergeStatusSchema>;
export type ReviewRequestMergeVerification = z.infer<typeof ReviewRequestMergeVerificationSchema>;
export type ArchivePrecondition = z.infer<typeof ArchivePreconditionSchema>;
export type OpenSpecArchivePlan = z.infer<typeof OpenSpecArchivePlanSchema>;
export type OpenSpecArchiveExecutionResult = z.infer<typeof OpenSpecArchiveExecutionResultSchema>;
