import { z } from "zod";

import { ArtifactIdSchema } from "../runtime/ids.js";
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
    owner: AgentRoleSchema.optional(),
    startedAt: IsoDateTimeSchema.optional(),
    completedAt: IsoDateTimeSchema.optional(),
    artifactIds: z.array(ArtifactIdSchema).default([]),
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
  });

export type RunStageName = z.infer<typeof RunStageNameSchema>;
export type StageStatus = z.infer<typeof StageStatusSchema>;
export type StageError = z.infer<typeof StageErrorSchema>;
export type StageState = z.infer<typeof StageStateSchema>;

export function createInitialStageStates(): StageState[] {
  return RUN_STAGE_NAMES.map((name) =>
    StageStateSchema.parse({
      name,
      status: "pending",
      attempt: 0,
      artifactIds: [],
    }),
  );
}
