import { createHash } from "node:crypto";

import { z } from "zod";

import { RelativePathSchema, Sha256DigestSchema } from "../runtime/scalars.js";

export const EvidenceFamilySchema = z.enum([
  "api-ready",
  "feature-e2e",
  "feature-video",
  "performance",
  "visual-capture",
]);

const EvidenceFingerprintInputSchema = z
  .object({
    role: z.string().trim().min(1).max(100),
    path: RelativePathSchema,
    digest: Sha256DigestSchema,
  })
  .strict();

const EvidenceFingerprintDraftV1Schema = z
  .object({
    schemaVersion: z.literal("evidence-fingerprint-v1"),
    family: EvidenceFamilySchema,
    algorithmVersion: z.string().trim().min(1).max(100),
    repositoryKey: Sha256DigestSchema,
    dependencyGraphDigest: Sha256DigestSchema,
    contractDigest: Sha256DigestSchema,
    toolchainDigest: Sha256DigestSchema,
    subjectDigest: Sha256DigestSchema,
    inputs: z.array(EvidenceFingerprintInputSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((fingerprint, context) => {
    const bindings = new Set<string>();
    fingerprint.inputs.forEach((input, index) => {
      const key = `${input.role}\u0000${input.path}`;
      if (bindings.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["inputs", index],
          message: "Fingerprint inputs must be unique by role and path",
        });
      }
      bindings.add(key);
    });
  });

export function evidenceFingerprintIdentity(input: unknown): `sha256:${string}` {
  const fingerprint = EvidenceFingerprintDraftV1Schema.parse(input);
  return fingerprintIdentityFromParsed(fingerprint);
}

function fingerprintIdentityFromParsed(
  fingerprint: z.infer<typeof EvidenceFingerprintDraftV1Schema>,
): `sha256:${string}` {
  const canonical = {
    ...fingerprint,
    inputs: [...fingerprint.inputs].sort(
      (left, right) =>
        left.role.localeCompare(right.role) ||
        left.path.localeCompare(right.path) ||
        left.digest.localeCompare(right.digest),
    ),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

export const EvidenceFingerprintV1Schema = EvidenceFingerprintDraftV1Schema.extend({
  fingerprint: Sha256DigestSchema,
}).superRefine((value, context) => {
  const { fingerprint, ...draft } = value;
  if (fingerprint !== fingerprintIdentityFromParsed(draft)) {
    context.addIssue({
      code: "custom",
      path: ["fingerprint"],
      message: "Evidence fingerprint does not match its canonical dependency inputs",
    });
  }
});

export type EvidenceFingerprintV1 = z.infer<typeof EvidenceFingerprintV1Schema>;

export function canReuseEvidence(
  source: EvidenceFingerprintV1,
  target: EvidenceFingerprintV1,
): boolean {
  return (
    source.family === target.family &&
    source.algorithmVersion === target.algorithmVersion &&
    source.fingerprint === target.fingerprint
  );
}
