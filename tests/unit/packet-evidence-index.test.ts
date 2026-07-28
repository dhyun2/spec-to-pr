import { describe, expect, it } from "vitest";

import {
  PacketEvidenceEntrySchema,
  reusablePacketEvidence,
} from "../../src/workflow/packet-evidence-index.js";

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
});
