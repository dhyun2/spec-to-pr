import { z } from "zod";

import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { IsoDateTimeSchema } from "../runtime/scalars.js";

export const ReviewRequestProviderSchema = z.enum(["github", "gitlab"]);

export const ReviewRequestStatusSchema = z.enum(["open", "merged", "closed_unmerged", "unknown"]);

export const MergeEvidenceKindSchema = z.enum([
  "user-attested",
  "remote-checked",
  "webhook-recorded",
]);

export const MergeEvidenceSchema = z
  .object({
    id: ArtifactIdSchema,
    runId: RunIdSchema,
    kind: MergeEvidenceKindSchema,
    provider: ReviewRequestProviderSchema.optional(),
    reviewRequestUrl: z.string().url(),
    status: ReviewRequestStatusSchema,
    statement: z.string().trim().min(1),
    checkedAt: IsoDateTimeSchema,
    attestedBy: z.string().trim().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.kind === "user-attested" && evidence.status !== "merged") {
      context.addIssue({
        code: "custom",
        message: "User-attested merge evidence must have merged status",
        path: ["status"],
      });
    }

    if (evidence.kind === "remote-checked" && evidence.provider === undefined) {
      context.addIssue({
        code: "custom",
        message: "Remote-checked merge evidence requires provider",
        path: ["provider"],
      });
    }
  });

export type ReviewRequestProvider = z.infer<typeof ReviewRequestProviderSchema>;
export type ReviewRequestStatus = z.infer<typeof ReviewRequestStatusSchema>;
export type MergeEvidenceKind = z.infer<typeof MergeEvidenceKindSchema>;
export type MergeEvidence = z.infer<typeof MergeEvidenceSchema>;

export type ParsedReviewRequestUrl = {
  provider: ReviewRequestProvider;
  owner?: string;
  repo?: string;
  projectPath?: string;
  number: string;
};

export function parseReviewRequestUrl(rawUrl: string): ParsedReviewRequestUrl | undefined {
  const url = new URL(rawUrl);

  if (url.hostname === "github.com") {
    const [owner, repo, pull, number] = url.pathname.split("/").filter(Boolean);

    if (owner !== undefined && repo !== undefined && pull === "pull" && number !== undefined) {
      return {
        provider: "github",
        owner,
        repo,
        number,
      };
    }
  }

  if (url.hostname === "gitlab.com") {
    const segments = url.pathname.split("/").filter(Boolean);
    const marker = segments.indexOf("-");
    const mergeRequests = segments.indexOf("merge_requests");
    const projectEnd = marker >= 0 ? marker : mergeRequests;
    const number = mergeRequests >= 0 ? segments[mergeRequests + 1] : undefined;

    if (projectEnd > 0 && number !== undefined) {
      return {
        provider: "gitlab",
        projectPath: segments.slice(0, projectEnd).join("/"),
        number,
      };
    }
  }

  return undefined;
}

export function inferReviewRequestProvider(rawUrl: string): ReviewRequestProvider | undefined {
  return parseReviewRequestUrl(rawUrl)?.provider;
}
