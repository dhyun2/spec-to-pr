import { z } from "zod";

import { ArtifactIdSchema, CheckIdSchema } from "./ids.js";
import { IsoDateTimeSchema, RelativePathSchema } from "./scalars.js";

export const CheckKindSchema = z.enum([
  "lint",
  "typecheck",
  "unit",
  "component",
  "contract",
  "acceptance",
  "e2e",
  "visual",
  "accessibility",
  "performance",
  "security",
  "openspec",
  "architecture",
  "build",
  "other",
]);

export const CheckStatusSchema = z.enum(["passed", "failed", "skipped"]);

export const CheckResultSchema = z
  .object({
    id: CheckIdSchema,
    name: z.string().trim().min(1).max(200),
    kind: CheckKindSchema,
    status: CheckStatusSchema,
    command: z.string().trim().min(1).optional(),
    workingDirectory: RelativePathSchema.optional(),
    exitCode: z.number().int().optional(),
    startedAt: IsoDateTimeSchema.optional(),
    completedAt: IsoDateTimeSchema.optional(),
    durationMs: z.number().int().nonnegative().optional(),
    reportArtifactId: ArtifactIdSchema.optional(),
    stdoutArtifactId: ArtifactIdSchema.optional(),
    stderrArtifactId: ArtifactIdSchema.optional(),
    summary: z.string().trim().min(1).max(2_000),
    failureReason: z.string().trim().min(1).max(2_000).optional(),
    skipReason: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict()
  .superRefine((check, context) => {
    if (check.status === "passed" && check.exitCode !== undefined && check.exitCode !== 0) {
      context.addIssue({
        code: "custom",
        message: "A passed check cannot have a non-zero exitCode",
        path: ["exitCode"],
      });
    }

    if (check.status === "failed" && check.failureReason === undefined) {
      context.addIssue({
        code: "custom",
        message: "A failed check requires failureReason",
        path: ["failureReason"],
      });
    }

    if (check.status !== "failed" && check.failureReason !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only failed checks may include failureReason",
        path: ["failureReason"],
      });
    }

    if (check.status === "skipped" && check.skipReason === undefined) {
      context.addIssue({
        code: "custom",
        message: "A skipped check requires skipReason",
        path: ["skipReason"],
      });
    }

    if (check.status !== "skipped" && check.skipReason !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only skipped checks may include skipReason",
        path: ["skipReason"],
      });
    }

    const hasStartedAt = check.startedAt !== undefined;
    const hasCompletedAt = check.completedAt !== undefined;

    if (hasStartedAt !== hasCompletedAt) {
      context.addIssue({
        code: "custom",
        message: "startedAt and completedAt must be provided together",
        path: ["startedAt"],
      });
    }

    if (
      check.startedAt !== undefined &&
      check.completedAt !== undefined &&
      Date.parse(check.completedAt) < Date.parse(check.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "completedAt must be after startedAt",
        path: ["completedAt"],
      });
    }
  });

export type CheckKind = z.infer<typeof CheckKindSchema>;
export type CheckStatus = z.infer<typeof CheckStatusSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
