import { createHash } from "node:crypto";

import { z } from "zod";

import {
  GitObjectIdSchema,
  IsoDateTimeSchema,
  RelativePathSchema,
  Sha256DigestSchema,
} from "../runtime/scalars.js";

export const ImplementationSnapshotSchema = z
  .object({
    schemaVersion: z.literal("implementation-snapshot-v1"),
    repositoryKey: Sha256DigestSchema,
    baseSha: GitObjectIdSchema,
    headSha: GitObjectIdSchema,
    sourceBranch: z.string().trim().min(1),
    clean: z.literal(true),
    changedFiles: z.array(RelativePathSchema),
    diffDigest: Sha256DigestSchema,
    binaryDiffBytes: z.number().int().nonnegative(),
    capturedAt: IsoDateTimeSchema,
  })
  .strict();

export type ImplementationSnapshot = z.infer<typeof ImplementationSnapshotSchema>;

export type ImplementationSnapshotFence = {
  headSha: string;
  sourceBranch: string;
  clean: boolean;
};

export function implementationRepositoryKey(repositoryRoot: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(repositoryRoot).digest("hex")}`;
}

export function reusableImplementationSnapshot(
  snapshot: ImplementationSnapshot,
  current: ImplementationSnapshotFence,
): boolean {
  return (
    current.clean &&
    current.headSha === snapshot.headSha &&
    current.sourceBranch === snapshot.sourceBranch
  );
}
