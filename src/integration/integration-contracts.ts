import { z } from "zod";

import { AgentResultIdSchema, ArtifactIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema } from "../runtime/scalars.js";

export const IntegrationStrategySchema = z.enum(["cherry-pick", "merge"]);

export const IntegrationStatusSchema = z.enum([
  "planned",
  "applying",
  "conflicted",
  "repairing",
  "passed",
  "failed",
  "blocked",
]);

export const IntegratedAgentKindSchema = z.enum([
  "spec-bdd",
  "api-contract",
  "design-ui",
  "integrator",
]);

export const IntegrationCandidateSchema = z
  .object({
    agentResultId: AgentResultIdSchema,
    agent: IntegratedAgentKindSchema,
    commitSha: GitObjectIdSchema,
    baseSha: GitObjectIdSchema,
    order: z.number().int().nonnegative(),
    approvedByReviewCouncil: z.boolean(),
    changedFiles: z.array(z.string()).default([]),
  })
  .strict();

export const IntegrationPlanSchema = z
  .object({
    runId: RunIdSchema,
    status: z.literal("planned"),
    strategy: IntegrationStrategySchema,
    baseCommit: GitObjectIdSchema,
    integrationBranch: z.string().trim().min(1),
    integrationWorktreePath: z.string().trim().min(1),
    candidates: z.array(IntegrationCandidateSchema),
    maxRepairAttempts: z.number().int().nonnegative(),
    repairPolicyArtifactId: ArtifactIdSchema.optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const IntegrationConflictFileSchema = z
  .object({
    path: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    conflictMarkersDetected: z.boolean(),
  })
  .strict();

export const IntegrationConflictReportSchema = z
  .object({
    runId: RunIdSchema,
    candidate: IntegrationCandidateSchema.optional(),
    command: z.string().trim().min(1),
    exitCode: z.number().int(),
    stdoutArtifactId: ArtifactIdSchema.optional(),
    stderrArtifactId: ArtifactIdSchema.optional(),
    conflictedFiles: z.array(IntegrationConflictFileSchema),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const RepairAttemptStatusSchema = z.enum(["planned", "applied", "failed", "rejected"]);

export const RepairAttemptSchema = z
  .object({
    attempt: z.number().int().positive(),
    status: RepairAttemptStatusSchema,
    trigger: z.string().trim().min(1),
    changedFiles: z.array(z.string()).default([]),
    artifactIds: z.array(ArtifactIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.optional(),
    summary: z.string().trim().min(1),
  })
  .strict();

export const IntegrationResultSchema = z
  .object({
    runId: RunIdSchema,
    status: IntegrationStatusSchema,
    integrationBranch: z.string().trim().min(1),
    integrationWorktreePath: z.string().trim().min(1),
    headSha: GitObjectIdSchema.optional(),
    appliedCandidates: z.array(IntegrationCandidateSchema).default([]),
    skippedCandidates: z.array(IntegrationCandidateSchema).default([]),
    conflictReportArtifactIds: z.array(ArtifactIdSchema).default([]),
    repairAttempts: z.array(RepairAttemptSchema).default([]),
    artifactIds: z.array(ArtifactIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export type IntegrationStrategy = z.infer<typeof IntegrationStrategySchema>;
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;
export type IntegratedAgentKind = z.infer<typeof IntegratedAgentKindSchema>;
export type IntegrationCandidate = z.infer<typeof IntegrationCandidateSchema>;
export type IntegrationPlan = z.infer<typeof IntegrationPlanSchema>;
export type IntegrationConflictReport = z.infer<typeof IntegrationConflictReportSchema>;
export type RepairAttempt = z.infer<typeof RepairAttemptSchema>;
export type IntegrationResult = z.infer<typeof IntegrationResultSchema>;
