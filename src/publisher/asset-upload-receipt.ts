import { createHash } from "node:crypto";

import { z } from "zod";

import { ArtifactIdSchema, RunIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, IsoDateTimeSchema, Sha256DigestSchema } from "../runtime/scalars.js";
import {
  ReviewHostSchema,
  ReviewPacketIdSchema,
  ReviewRequestAssetRoleSchema,
  type PublishTarget,
} from "./publish-contracts.js";

export const ReviewAssetUploadReceiptSchema = z
  .object({
    schemaVersion: z.literal("review-asset-upload-v1"),
    runId: RunIdSchema,
    host: ReviewHostSchema,
    targetKey: z.string().trim().min(1),
    reportArtifactId: ArtifactIdSchema,
    reviewPacketId: ReviewPacketIdSchema.optional(),
    headSha: GitObjectIdSchema.optional(),
    artifactId: ArtifactIdSchema,
    artifactDigest: Sha256DigestSchema,
    targetId: z.string().trim().min(1),
    role: ReviewRequestAssetRoleSchema,
    url: z.string().trim().min(1),
    embeddable: z.boolean(),
    confirmedAt: IsoDateTimeSchema,
  })
  .strict();

export type ReviewAssetUploadReceipt = z.infer<typeof ReviewAssetUploadReceiptSchema>;

export function reviewAssetUploadTargetKey(target: PublishTarget): string {
  if (target.host === "github") {
    return `github:${target.webBaseUrl.replace(/\/+$/, "")}/${target.owner}/${target.repo}`;
  }
  return `gitlab:${target.webBaseUrl.replace(/\/+$/, "")}/${
    target.projectId ?? target.projectPath
  }`;
}

export function reviewAssetUploadReceiptArtifactId(
  receipt: ReviewAssetUploadReceipt,
): `art_${string}` {
  return `art_${reviewAssetUploadReceiptIdentity(receipt).slice("sha256:".length, 39)}`;
}

export function reviewAssetUploadReceiptIdentity(
  receipt: ReviewAssetUploadReceipt,
): `sha256:${string}` {
  const identity = {
    host: receipt.host,
    targetKey: receipt.targetKey,
    reportArtifactId: receipt.reportArtifactId,
    ...(receipt.reviewPacketId === undefined ? {} : { reviewPacketId: receipt.reviewPacketId }),
    ...(receipt.headSha === undefined ? {} : { headSha: receipt.headSha }),
    artifactId: receipt.artifactId,
    artifactDigest: receipt.artifactDigest,
    targetId: receipt.targetId,
    role: receipt.role,
  };
  const digest = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return `sha256:${digest}`;
}
