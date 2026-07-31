import { describe, expect, it } from "vitest";

import {
  EvidenceFingerprintV1Schema,
  canReuseEvidence,
  evidenceFingerprintIdentity,
} from "../../src/workflow/evidence-fingerprint.js";

const draft = {
  schemaVersion: "evidence-fingerprint-v1" as const,
  family: "visual-capture" as const,
  algorithmVersion: "capture-v1",
  repositoryKey: `sha256:${"a".repeat(64)}` as const,
  dependencyGraphDigest: `sha256:${"b".repeat(64)}` as const,
  contractDigest: `sha256:${"c".repeat(64)}` as const,
  toolchainDigest: `sha256:${"d".repeat(64)}` as const,
  subjectDigest: `sha256:${"e".repeat(64)}` as const,
  inputs: [
    { role: "fixture", path: "fixtures/checkout.json", digest: `sha256:${"1".repeat(64)}` },
    { role: "ui", path: "src/checkout.tsx", digest: `sha256:${"2".repeat(64)}` },
  ],
};

describe("evidence fingerprint", () => {
  it("is stable across input ordering but changes when a declared dependency changes", () => {
    const fingerprint = evidenceFingerprintIdentity(draft);
    expect(evidenceFingerprintIdentity({ ...draft, inputs: [...draft.inputs].reverse() })).toBe(
      fingerprint,
    );
    expect(
      evidenceFingerprintIdentity({
        ...draft,
        inputs: [{ ...draft.inputs[0]!, digest: `sha256:${"3".repeat(64)}` }, draft.inputs[1]!],
      }),
    ).not.toBe(fingerprint);
  });

  it("allows only equal family, algorithm, and dependency identities to be reused", () => {
    const source = EvidenceFingerprintV1Schema.parse({
      ...draft,
      fingerprint: evidenceFingerprintIdentity(draft),
    });
    expect(canReuseEvidence(source, source)).toBe(true);
    expect(canReuseEvidence(source, { ...source, family: "feature-video" })).toBe(false);
    expect(
      EvidenceFingerprintV1Schema.safeParse({
        ...draft,
        inputs: [...draft.inputs, draft.inputs[0]!],
        fingerprint: evidenceFingerprintIdentity(draft),
      }).success,
    ).toBe(false);
  });
});
