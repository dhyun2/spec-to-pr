import { describe, expect, it } from "vitest";

import { renderReviewCouncilReport } from "../../src/review/review-renderer.js";

describe("review renderer", () => {
  it("renders finding, verdict, contradiction, and gap summaries", () => {
    const report = renderReviewCouncilReport({
      schemaVersion: "review-council-v1",
      runId: "run_11111111111111111111111111111111",
      agent: "review-council",
      reviewer: "review-council",
      generatedAt: "2026-06-23T00:00:00.000Z",
      summary: "One issue found.",
      findings: [
        {
          id: "rf_11111111111111111111111111111111",
          category: "contradiction",
          severity: "major",
          status: "open",
          title: "API | UI mismatch",
          expected: "UI claim matches API evidence.",
          observed: "UI uses a missing field.",
          recommendation: "Open a gap.",
          createdAt: "2026-06-23T00:00:00.000Z",
          agentResultIds: [],
          evidenceIds: [],
          artifactIds: [],
          gapIds: [],
        },
      ],
      requirementVerdicts: [
        {
          requirementId: "REQ-001",
          verdict: "blocked",
          reason: "Missing API field.",
          evidenceIds: [],
          artifactIds: [],
          gapIds: [],
          findingIds: ["rf_11111111111111111111111111111111"],
        },
      ],
      contradictions: [
        {
          id: "rc_11111111111111111111111111111111",
          severity: "major",
          left: {
            kind: "requirement",
            id: "REQ-001",
            summary: "Requires amount field.",
          },
          right: {
            kind: "artifact",
            id: "api",
            summary: "OpenAPI lacks amount field.",
          },
          explanation: "Requirement cannot be implemented against current API.",
          findingIds: ["rf_11111111111111111111111111111111"],
        },
      ],
      newGapDrafts: [
        {
          findingId: "rf_11111111111111111111111111111111",
          category: "api",
          severity: "major",
          title: "Missing amount field",
          expected: "API response includes amount.",
          observed: "API response omits amount.",
          impact: "UI cannot render required value.",
          sourceEvidenceIds: [],
        },
      ],
      sourceArtifactIds: [],
    });

    expect(report).toContain("# Review Council Report");
    expect(report).toContain("API \\| UI mismatch");
    expect(report).toContain("REQ-001");
    expect(report).toContain("Missing amount field");
  });
});
