import { describe, expect, it } from "vitest";

import { MergeEvidenceSchema, parseReviewRequestUrl } from "../../src/archive/index.js";

describe("merge evidence contracts", () => {
  it("requires merged status for user-attested evidence", () => {
    const result = MergeEvidenceSchema.safeParse({
      id: "art_11111111111111111111111111111111",
      runId: "run_11111111111111111111111111111111",
      kind: "user-attested",
      provider: "github",
      reviewRequestUrl: "https://github.com/acme/spec-to-pr/pull/123",
      status: "open",
      statement: "The user says this merged.",
      checkedAt: "2026-06-23T00:00:00.000Z",
      attestedBy: "user",
    });

    expect(result.success).toBe(false);
  });

  it("accepts normalized user-attested merge evidence", () => {
    const evidence = MergeEvidenceSchema.parse({
      id: "art_22222222222222222222222222222222",
      runId: "run_11111111111111111111111111111111",
      kind: "user-attested",
      provider: "github",
      reviewRequestUrl: "https://github.com/acme/spec-to-pr/pull/123",
      status: "merged",
      statement: "User confirmed that the review request was merged.",
      checkedAt: "2026-06-23T00:00:00.000Z",
      attestedBy: "user",
    });

    expect(evidence.status).toBe("merged");
  });

  it("parses supported GitHub and GitLab review request URLs", () => {
    expect(parseReviewRequestUrl("https://github.com/acme/spec-to-pr/pull/123")).toMatchObject({
      provider: "github",
      owner: "acme",
      repo: "spec-to-pr",
      number: "123",
    });

    expect(
      parseReviewRequestUrl("https://gitlab.com/acme/platform/spec-to-pr/-/merge_requests/7"),
    ).toMatchObject({
      provider: "gitlab",
      projectPath: "acme/platform/spec-to-pr",
      number: "7",
    });
  });

  it("requires provider for remote-checked evidence", () => {
    const result = MergeEvidenceSchema.safeParse({
      id: "art_33333333333333333333333333333333",
      runId: "run_11111111111111111111111111111111",
      kind: "remote-checked",
      reviewRequestUrl: "https://gitlab.com/acme/spec-to-pr/-/merge_requests/7",
      status: "merged",
      statement: "Remote status was checked once.",
      checkedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});
