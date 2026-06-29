import { describe, expect, it } from "vitest";

import {
  PublishedReviewAssetSchema,
  PublishResultSchema,
  PublishTargetSchema,
  ReviewRequestPayloadSchema,
} from "../../src/publisher/publish-contracts.js";

describe("publish contracts", () => {
  it("requires owner and repo for GitHub", () => {
    expect(
      PublishTargetSchema.safeParse({
        host: "github",
        webBaseUrl: "https://github.com",
        apiBaseUrl: "https://api.github.com",
      }).success,
    ).toBe(false);
  });

  it("accepts valid payload", () => {
    const payload = ReviewRequestPayloadSchema.parse({
      runId: "run_11111111111111111111111111111111",
      title: "Spec to PR",
      body: "Report",
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      mode: "draft",
      reportArtifactId: "art_11111111111111111111111111111111",
    });

    expect(payload.mode).toBe("draft");
  });

  it("records uploaded visual evidence assets on publish results", () => {
    const asset = PublishedReviewAssetSchema.parse({
      artifactId: "art_22222222222222222222222222222222",
      targetId: "home",
      role: "figma",
      label: "Figma",
      url: "https://gitlab.example/uploads/figma.png",
    });
    const result = PublishResultSchema.parse({
      runId: "run_11111111111111111111111111111111",
      status: "passed",
      reportArtifactId: "art_11111111111111111111111111111111",
      publishedAssets: [asset],
      publishedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(result.publishedAssets).toHaveLength(1);
    expect(result.publishedAssets[0]?.url).toContain("figma.png");
  });
});
