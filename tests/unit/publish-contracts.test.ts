import { describe, expect, it } from "vitest";

import { PublishReviewRequestInputSchema } from "../../src/application/publisher-service.js";
import {
  PublishIntentSchema,
  PublishedReviewAssetSchema,
  PublishResultSchema,
  PublishTargetSchema,
  ReviewRequestUpdateSchema,
  ReviewRequestPayloadSchema,
} from "../../src/publisher/publish-contracts.js";

describe("publish contracts", () => {
  it("accepts ready and blocked-diagnostic publish intents", () => {
    expect(PublishIntentSchema.options).toEqual(["ready", "blocked-diagnostic"]);
    expect(
      PublishReviewRequestInputSchema.parse({
        runId: "run_11111111111111111111111111111111",
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        confirm: true,
      }).intent,
    ).toBe("ready");
    expect(
      PublishReviewRequestInputSchema.parse({
        runId: "run_11111111111111111111111111111111",
        sourceBranch: "spec-to-pr/run-1",
        targetBranch: "main",
        intent: "blocked-diagnostic",
        confirm: true,
      }).intent,
    ).toBe("blocked-diagnostic");
  });

  it("requires strict title, body, and label metadata for review request updates", () => {
    expect(
      ReviewRequestUpdateSchema.parse({
        title: "[Blocked] SpecToPR Run run_11111111111111111111111111111111",
        body: "# Blocked diagnostic",
        labels: ["spec-to-pr", "spec-to-pr:blocked"],
      }),
    ).toEqual({
      title: "[Blocked] SpecToPR Run run_11111111111111111111111111111111",
      body: "# Blocked diagnostic",
      labels: ["spec-to-pr", "spec-to-pr:blocked"],
    });
    expect(
      ReviewRequestUpdateSchema.safeParse({
        title: "SpecToPR",
        body: "# Ready",
        labels: ["spec-to-pr"],
        reviewers: ["octocat"],
      }).success,
    ).toBe(false);
  });

  it("requires a source branch different from the target", () => {
    expect(
      PublishReviewRequestInputSchema.safeParse({
        runId: "run_11111111111111111111111111111111",
        sourceBranch: "main",
        targetBranch: "main",
        confirm: true,
      }).success,
    ).toBe(false);
  });

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
      title: "SpecToPR",
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
      artifactDigest: `sha256:${"a".repeat(64)}`,
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
      uploadReceiptArtifactIds: ["art_33333333333333333333333333333333"],
      publishedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(result.publishedAssets).toHaveLength(1);
    expect(result.publishedAssets[0]?.url).toContain("figma.png");
    expect(result.uploadReceiptArtifactIds).toEqual(["art_33333333333333333333333333333333"]);
    expect(result.requestSynced).toBe(false);
    expect(result.visualPreviewExpected).toBe(false);
    expect(result.visualPreviewSynced).toBe(false);
    expect(result.fallbackMode).toBe("none");
    expect(result.partialReasons).toEqual([]);
  });

  it("tracks feature E2E video synchronization separately from visual previews", () => {
    const asset = PublishedReviewAssetSchema.parse({
      artifactId: "art_33333333333333333333333333333333",
      artifactDigest: `sha256:${"b".repeat(64)}`,
      targetId: "feature-e2e",
      role: "e2e-video",
      label: "Feature E2E video",
      url: "https://gitlab.example/uploads/checkout.webm",
      embeddable: false,
    });
    const result = PublishResultSchema.parse({
      runId: "run_11111111111111111111111111111111",
      status: "passed",
      reportArtifactId: "art_11111111111111111111111111111111",
      publishedAssets: [asset],
      featureVideoExpected: true,
      featureVideoSynced: true,
      publishedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(result.publishedAssets[0]?.role).toBe("e2e-video");
    expect(result.featureVideoExpected).toBe(true);
    expect(result.featureVideoSynced).toBe(true);
    expect(result.visualPreviewExpected).toBe(false);
  });
});
