import { z } from "zod";

import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema } from "../runtime/scalars.js";

export const ReviewHostSchema = z.enum(["github", "gitlab"]);

export const PublishModeSchema = z.enum(["draft", "ready"]);

export const PublishTargetSchema = z
  .object({
    host: ReviewHostSchema,
    webBaseUrl: z.string().url(),
    apiBaseUrl: z.string().url(),
    owner: z.string().trim().min(1).optional(),
    repo: z.string().trim().min(1).optional(),
    projectPath: z.string().trim().min(1).optional(),
    projectId: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((target, context) => {
    if (target.host === "github") {
      if (target.owner === undefined || target.repo === undefined) {
        context.addIssue({
          code: "custom",
          message: "GitHub publish target requires owner and repo",
          path: ["owner"],
        });
      }
    }

    if (target.host === "gitlab") {
      if (target.projectPath === undefined && target.projectId === undefined) {
        context.addIssue({
          code: "custom",
          message: "GitLab publish target requires projectPath or projectId",
          path: ["projectPath"],
        });
      }
    }
  });

export const ReviewRequestPayloadSchema = z
  .object({
    runId: RunIdSchema,
    title: z.string().trim().min(1).max(250),
    body: z.string().min(1),
    sourceBranch: z.string().trim().min(1),
    targetBranch: z.string().trim().min(1),
    headSha: GitObjectIdSchema.optional(),
    mode: PublishModeSchema.default("draft"),
    labels: z.array(z.string().trim().min(1)).default([]),
    reviewers: z.array(z.string().trim().min(1)).default([]),
    assignees: z.array(z.string().trim().min(1)).default([]),
    reportArtifactId: ArtifactIdSchema,
  })
  .strict();

export const PublishPlanSchema = z
  .object({
    runId: RunIdSchema,
    target: PublishTargetSchema,
    payload: ReviewRequestPayloadSchema,
    requiredTokenEnv: z.string().trim().min(1),
    willPushBranch: z.boolean(),
    willCreateOrUpdate: z.boolean(),
    warnings: z.array(z.string()).default([]),
    plannedAt: IsoDateTimeSchema,
  })
  .strict();

export const PublishedReviewRequestSchema = z
  .object({
    host: ReviewHostSchema,
    url: z.string().url(),
    number: z.string().trim().min(1),
    id: z.string().trim().min(1).optional(),
    iid: z.string().trim().min(1).optional(),
    draft: z.boolean(),
    sourceBranch: z.string().trim().min(1),
    targetBranch: z.string().trim().min(1),
    created: z.boolean(),
    updated: z.boolean(),
  })
  .strict();

export const PublishResultSchema = z
  .object({
    runId: RunIdSchema,
    status: z.enum(["passed", "failed", "blocked"]),
    target: PublishTargetSchema.optional(),
    request: PublishedReviewRequestSchema.optional(),
    reportArtifactId: ArtifactIdSchema.optional(),
    errorCode: z.string().trim().min(1).optional(),
    errorMessage: z.string().trim().min(1).optional(),
    retryable: z.boolean().default(false),
    publishedAt: IsoDateTimeSchema,
  })
  .strict();

export type ReviewHost = z.infer<typeof ReviewHostSchema>;
export type PublishMode = z.infer<typeof PublishModeSchema>;
export type PublishTarget = z.infer<typeof PublishTargetSchema>;
export type ReviewRequestPayload = z.infer<typeof ReviewRequestPayloadSchema>;
export type PublishPlan = z.infer<typeof PublishPlanSchema>;
export type PublishedReviewRequest = z.infer<typeof PublishedReviewRequestSchema>;
export type PublishResult = z.infer<typeof PublishResultSchema>;
