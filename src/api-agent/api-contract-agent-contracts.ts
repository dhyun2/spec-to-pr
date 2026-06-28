import { z } from "zod";

import {
  AgentResultIdSchema,
  ArtifactIdSchema,
  EvidenceIdSchema,
  GapIdSchema,
  RunIdSchema,
} from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema, Sha256DigestSchema } from "../runtime/scalars.js";

export const ApiContractAgentContextSchema = z
  .object({
    runId: RunIdSchema,
    preparedAt: IsoDateTimeSchema,
    projectRoot: z.string().trim().min(1),
    worktreePath: z.string().trim().min(1),
    baseSha: GitObjectIdSchema,
    contextPackPath: z.string().trim().min(1),
    allowedWriteGlobs: z.array(z.string().trim().min(1)),
    forbiddenWriteGlobs: z.array(z.string().trim().min(1)),
    openApiIntakeArtifactIds: z.array(ArtifactIdSchema).default([]),
    apiPipelineArtifactIds: z.array(ArtifactIdSchema).default([]),
    traceabilityArtifactIds: z.array(ArtifactIdSchema).default([]),
    testMatrixArtifactIds: z.array(ArtifactIdSchema).default([]),
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    instructions: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const ApiContractContextFileSchema = z
  .object({
    path: z.string().trim().min(1),
    digest: Sha256DigestSchema,
  })
  .strict();

export const ApiContractAgentRecordedResultSchema = z
  .object({
    resultId: AgentResultIdSchema,
    runId: RunIdSchema,
    status: z.enum(["passed", "failed", "blocked"]),
    commitSha: GitObjectIdSchema.optional(),
    changedFiles: z.array(z.string().trim().min(1)).default([]),
    artifactIds: z.array(ArtifactIdSchema).default([]),
    evidenceIds: z.array(EvidenceIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    recordedAt: IsoDateTimeSchema,
  })
  .strict();

export type ApiContractAgentContext = z.infer<typeof ApiContractAgentContextSchema>;
export type ApiContractContextFile = z.infer<typeof ApiContractContextFileSchema>;
export type ApiContractAgentRecordedResult = z.infer<
  typeof ApiContractAgentRecordedResultSchema
>;
