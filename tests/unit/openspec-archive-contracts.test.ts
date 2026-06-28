import { describe, expect, it } from "vitest";

import { ReviewRequestMergeStatusSchema } from "../../src/openspec-archive/index.js";

describe("OpenSpec archive contracts", () => {
  it("requires merged metadata when review request is merged", () => {
    const result = ReviewRequestMergeStatusSchema.safeParse({
      provider: "github",
      reviewRequestUrl: "https://github.com/acme/spec-to-pr/pull/123",
      number: "123",
      merged: true,
      raw: {},
    });

    expect(result.success).toBe(false);
  });

  it("accepts normalized merged review request status", () => {
    const status = ReviewRequestMergeStatusSchema.parse({
      provider: "gitlab",
      reviewRequestUrl: "https://gitlab.com/acme/spec-to-pr/-/merge_requests/7",
      number: "7",
      merged: true,
      mergedAt: "2026-06-23T00:00:00.000Z",
      mergedCommitSha: "abcdef1",
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      raw: {},
    });

    expect(status.mergedCommitSha).toBe("abcdef1");
  });
});
