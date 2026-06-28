import { describe, expect, it } from "vitest";

import {
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
});
