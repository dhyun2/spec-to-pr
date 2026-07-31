import { describe, expect, it } from "vitest";

import {
  PacketEvidenceEntrySchema,
  reusablePacketEvidence,
} from "../../src/workflow/packet-evidence-index.js";
import { evidenceFingerprintIdentity } from "../../src/workflow/evidence-fingerprint.js";

const fingerprintDraft = {
  schemaVersion: "evidence-fingerprint-v1" as const,
  family: "feature-e2e" as const,
  algorithmVersion: "e2e-v1",
  repositoryKey: `sha256:${"a".repeat(64)}` as const,
  dependencyGraphDigest: `sha256:${"b".repeat(64)}` as const,
  contractDigest: `sha256:${"c".repeat(64)}` as const,
  toolchainDigest: `sha256:${"d".repeat(64)}` as const,
  subjectDigest: `sha256:${"e".repeat(64)}` as const,
  inputs: [{ role: "test", path: "e2e/checkout.spec.ts", digest: `sha256:${"1".repeat(64)}` }],
};

const entry = PacketEvidenceEntrySchema.parse({
  command: "pnpm exec playwright test e2e/checkout.spec.ts",
  selector: "e2e/checkout.spec.ts",
  resultDigest: `sha256:${"1".repeat(64)}`,
  artifactId: `art_${"a".repeat(32)}`,
  headSha: "b".repeat(40),
  diffDigest: `sha256:${"2".repeat(64)}`,
  adapterVersion: "workflow-v2-evidence",
});

describe("PacketEvidenceEntry", () => {
  it("reuses evidence only when every immutable execution binding matches", () => {
    expect(reusablePacketEvidence([entry], entry)).toEqual(entry);

    for (const mismatch of [
      { command: "pnpm test" },
      { selector: "e2e/cart.spec.ts" },
      { resultDigest: `sha256:${"3".repeat(64)}` },
      { artifactId: `art_${"c".repeat(32)}` },
      { headSha: "d".repeat(40) },
      { diffDigest: `sha256:${"4".repeat(64)}` },
      { adapterVersion: "workflow-v3-evidence" },
    ]) {
      expect(reusablePacketEvidence([entry], { ...entry, ...mismatch })).toBeUndefined();
    }
  });

  it("does not reuse a prior packet result after repair changes head or diff", () => {
    const repaired = {
      ...entry,
      headSha: "e".repeat(40),
      diffDigest: `sha256:${"5".repeat(64)}` as const,
    };

    expect(reusablePacketEvidence([entry], repaired)).toBeUndefined();
    expect(reusablePacketEvidence([PacketEvidenceEntrySchema.parse(repaired)], repaired)).toEqual(
      repaired,
    );
  });

  it("permits same-Run evidence carry-forward only when the dependency fingerprint is identical", () => {
    const fingerprint = {
      ...fingerprintDraft,
      fingerprint: evidenceFingerprintIdentity(fingerprintDraft),
    };
    const source = PacketEvidenceEntrySchema.parse({ ...entry, evidenceFingerprint: fingerprint });
    const repaired = PacketEvidenceEntrySchema.parse({
      ...entry,
      headSha: "e".repeat(40),
      diffDigest: `sha256:${"5".repeat(64)}`,
      evidenceFingerprint: fingerprint,
    });

    expect(reusablePacketEvidence([source], repaired)).toEqual(source);
    expect(
      reusablePacketEvidence([source], {
        ...repaired,
        evidenceFingerprint: {
          ...fingerprint,
          subjectDigest: `sha256:${"9".repeat(64)}`,
          fingerprint: `sha256:${"9".repeat(64)}`,
        },
      }),
    ).toBeUndefined();
  });
});
