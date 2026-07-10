import { z } from "zod";

import { ArtifactIdSchema, GapIdSchema } from "../runtime/ids.js";
import { AgentRoleSchema, IsoDateTimeSchema } from "../runtime/scalars.js";

export const RUN_STAGE_NAMES = [
  "intake",
  "project-profile",
  "source-registry",
  "brief-adapter",
  "figma-adapter",
  "openapi-adapter",
  "evidence-graph",
  "openspec",
  "gherkin-test-matrix",
  "api-contract",
  "design-contract",
  "agent-runtime",
  "spec-bdd",
  "api-agent",
  "design-ui",
  "review-council",
  "integration",
  "fsd-guard",
  "quality-gates",
  "visual-regression",
  "accessibility",
  "performance",
  "observability",
  "pr-report",
  "publisher",
  "openspec-archive",
] as const;

export const RunStageNameSchema = z.enum(RUN_STAGE_NAMES);

export const StageStatusSchema = z.enum([
  "pending",
  "running",
  "passed",
  "failed",
  "blocked",
  "waived",
  "skipped",
]);

export const LeaseIdSchema = z
  .string()
  .regex(/^lease_[a-f0-9]{32}$/, "Expected lease_<32 lowercase hex characters>");

export const WorkerIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/, "Worker id contains unsupported characters");

export const StageLeaseSchema = z
  .object({
    id: LeaseIdSchema,
    workerId: WorkerIdSchema,
    acquiredAt: IsoDateTimeSchema,
    heartbeatAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((lease, context) => {
    if (Date.parse(lease.heartbeatAt) < Date.parse(lease.acquiredAt)) {
      context.addIssue({
        code: "custom",
        message: "heartbeatAt must be after acquiredAt",
        path: ["heartbeatAt"],
      });
    }

    if (Date.parse(lease.expiresAt) <= Date.parse(lease.heartbeatAt)) {
      context.addIssue({
        code: "custom",
        message: "expiresAt must be after heartbeatAt",
        path: ["expiresAt"],
      });
    }
  });

export const StageCheckpointSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    data: z.record(z.string(), z.unknown()).default({}),
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const StageErrorSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(2_000),
    retryable: z.boolean(),
  })
  .strict();

export const StageStateSchema = z
  .object({
    name: RunStageNameSchema,
    status: StageStatusSchema,
    attempt: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive().default(3),
    owner: AgentRoleSchema.optional(),
    startedAt: IsoDateTimeSchema.optional(),
    completedAt: IsoDateTimeSchema.optional(),
    lease: StageLeaseSchema.optional(),
    checkpoint: StageCheckpointSchema.optional(),
    artifactIds: z.array(ArtifactIdSchema).default([]),
    gapIds: z.array(GapIdSchema).default([]),
    error: StageErrorSchema.optional(),
  })
  .strict()
  .superRefine((stage, context) => {
    if (
      stage.startedAt !== undefined &&
      stage.completedAt !== undefined &&
      Date.parse(stage.completedAt) < Date.parse(stage.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "completedAt must be after startedAt",
        path: ["completedAt"],
      });
    }

    if (stage.status === "running" && stage.lease === undefined) {
      context.addIssue({
        code: "custom",
        message: "Running stages require a lease",
        path: ["lease"],
      });
    }

    if (stage.status !== "running" && stage.lease !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only running stages may include a lease",
        path: ["lease"],
      });
    }

    if (stage.error !== undefined && !["failed", "blocked"].includes(stage.status)) {
      context.addIssue({
        code: "custom",
        message: "Only failed or blocked stages may include error",
        path: ["error"],
      });
    }

    if (stage.status === "failed" && stage.error === undefined) {
      context.addIssue({
        code: "custom",
        message: "Failed stages require error information",
        path: ["error"],
      });
    }

    if (stage.status === "blocked" && stage.gapIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Blocked stages must reference at least one gap",
        path: ["gapIds"],
      });
    }

    if (stage.attempt > stage.maxAttempts) {
      context.addIssue({
        code: "custom",
        message: "attempt cannot exceed maxAttempts",
        path: ["attempt"],
      });
    }
  });

export type RunStageName = z.infer<typeof RunStageNameSchema>;
export type StageStatus = z.infer<typeof StageStatusSchema>;
export type LeaseId = z.infer<typeof LeaseIdSchema>;
export type WorkerId = z.infer<typeof WorkerIdSchema>;
export type StageLease = z.infer<typeof StageLeaseSchema>;
export type StageCheckpoint = z.infer<typeof StageCheckpointSchema>;
export type StageError = z.infer<typeof StageErrorSchema>;
export type StageState = z.infer<typeof StageStateSchema>;

export function createInitialStageStates(): StageState[] {
  return RUN_STAGE_NAMES.map((name) =>
    StageStateSchema.parse({
      name,
      status: "pending",
      attempt: 0,
      maxAttempts: 3,
      artifactIds: [],
      gapIds: [],
    }),
  );
}
