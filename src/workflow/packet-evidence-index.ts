import { z } from "zod";

import { ArtifactIdSchema } from "../runtime/ids.js";
import { GitObjectIdSchema, Sha256DigestSchema } from "../runtime/scalars.js";
import { EvidenceFingerprintV1Schema, canReuseEvidence } from "./evidence-fingerprint.js";

export const PacketEvidenceEntrySchema = z
  .object({
    command: z.string().trim().min(1),
    selector: z.string().trim().min(1).optional(),
    resultDigest: Sha256DigestSchema,
    artifactId: ArtifactIdSchema,
    headSha: GitObjectIdSchema,
    diffDigest: Sha256DigestSchema,
    adapterVersion: z.string().trim().min(1),
    evidenceFingerprint: EvidenceFingerprintV1Schema.optional(),
  })
  .strict();

export const PacketEvidenceIndexSchema = z.array(PacketEvidenceEntrySchema).max(10_000);

export type PacketEvidenceEntry = z.infer<typeof PacketEvidenceEntrySchema>;

export function reusablePacketEvidence(
  index: readonly PacketEvidenceEntry[],
  requested: PacketEvidenceEntry,
): PacketEvidenceEntry | undefined {
  return index.find(
    (entry) =>
      entry.command === requested.command &&
      entry.selector === requested.selector &&
      entry.resultDigest === requested.resultDigest &&
      entry.artifactId === requested.artifactId &&
      entry.adapterVersion === requested.adapterVersion &&
      ((entry.headSha === requested.headSha && entry.diffDigest === requested.diffDigest) ||
        (entry.evidenceFingerprint !== undefined &&
          requested.evidenceFingerprint !== undefined &&
          canReuseEvidence(entry.evidenceFingerprint, requested.evidenceFingerprint))),
  );
}
