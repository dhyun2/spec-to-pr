import { describe, expect, it } from "vitest";

import {
  ReviewAssetUploadReceiptSchema,
  reviewAssetUploadReceiptArtifactId,
  reviewAssetUploadReceiptIdentity,
} from "../../src/publisher/asset-upload-receipt.js";

const receipt = {
  schemaVersion: "review-asset-upload-v1" as const,
  runId: "run_11111111111111111111111111111111",
  host: "github" as const,
  targetKey: "github:https://github.com/acme/spec-to-pr",
  reportArtifactId: "art_11111111111111111111111111111111",
  reviewPacketId: `packet_${"b".repeat(64)}`,
  headSha: "a".repeat(40),
  artifactId: "art_22222222222222222222222222222222",
  artifactDigest: `sha256:${"c".repeat(64)}` as const,
  targetId: "home",
  role: "figma" as const,
  url: "https://raw.githubusercontent.com/acme/spec-to-pr/evidence/figma.png",
  embeddable: true,
  confirmedAt: "2026-07-28T00:00:00.000Z",
};

describe("review asset upload receipts", () => {
  it("binds artifact identity to host, target, report, packet/head, digest, target, and role", () => {
    const parsed = ReviewAssetUploadReceiptSchema.parse(receipt);
    const originalId = reviewAssetUploadReceiptArtifactId(parsed);
    const originalIdentity = reviewAssetUploadReceiptIdentity(parsed);
    const mutations = [
      { host: "gitlab" as const },
      { targetKey: "github:https://github.com/acme/other" },
      { reportArtifactId: "art_33333333333333333333333333333333" },
      { reviewPacketId: `packet_${"d".repeat(64)}` },
      { headSha: "e".repeat(40) },
      { artifactId: "art_44444444444444444444444444444444" },
      { artifactDigest: `sha256:${"f".repeat(64)}` as const },
      { targetId: "checkout" },
      { role: "browser" as const },
    ];

    expect(originalId).toMatch(/^art_[a-f0-9]{32}$/);
    expect(originalIdentity).toMatch(/^sha256:[a-f0-9]{64}$/);
    for (const mutation of mutations) {
      const changed = ReviewAssetUploadReceiptSchema.parse({ ...receipt, ...mutation });
      expect(reviewAssetUploadReceiptArtifactId(changed)).not.toBe(originalId);
      expect(reviewAssetUploadReceiptIdentity(changed)).not.toBe(originalIdentity);
    }
  });

  it("does not change receipt identity for URL or confirmation-time changes", () => {
    const originalId = reviewAssetUploadReceiptArtifactId(
      ReviewAssetUploadReceiptSchema.parse(receipt),
    );

    expect(
      reviewAssetUploadReceiptArtifactId(
        ReviewAssetUploadReceiptSchema.parse({
          ...receipt,
          url: "https://github.example/new-location.png",
          confirmedAt: "2026-07-28T01:00:00.000Z",
        }),
      ),
    ).toBe(originalId);
  });
});
