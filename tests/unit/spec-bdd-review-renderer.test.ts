import { describe, expect, it } from "vitest";

import { renderSpecBddReviewMarkdown } from "../../src/spec-bdd/spec-bdd-review-renderer.js";

describe("Spec/BDD review renderer", () => {
  it("renders Spec/BDD review markdown", () => {
    const markdown = renderSpecBddReviewMarkdown({
      adapter: "spec-bdd-agent-v1",
      runId: "run_11111111111111111111111111111111",
      changeName: "deliver-reservation-management",
      status: "passed",
      reviewedAt: "2026-06-23T00:00:00.000Z",
      reviewedRequirements: 2,
      reviewedScenarios: 2,
      acceptanceSkeletonCount: 2,
      findings: [],
      artifactIds: [],
    });

    expect(markdown).toContain("Spec/BDD Review");
    expect(markdown).toContain("Reviewed requirements: 2");
    expect(markdown).toContain("No findings.");
  });
});
