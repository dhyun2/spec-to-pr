import { describe, expect, it } from "vitest";

import { ReviewCouncilResultSchema } from "../../src/review/review-model.js";

describe("review model", () => {
  it("accepts findings, verdicts, contradictions, and gap drafts with linked finding IDs", () => {
    const result = ReviewCouncilResultSchema.parse({
      schemaVersion: "review-council-v1",
      runId: "run_11111111111111111111111111111111",
      agent: "review-council",
      generatedAt: "2026-06-23T00:00:00.000Z",
      summary: "Review found one API evidence gap.",
      findings: [
        {
          id: "rf_11111111111111111111111111111111",
          category: "api-contract",
          severity: "major",
          status: "open",
          title: "Missing OpenAPI evidence",
          expected: "API claim cites OpenAPI evidence.",
          observed: "No operation evidence was cited.",
          recommendation: "Keep this work as an API gap.",
          createdAt: "2026-06-23T00:00:00.000Z",
        },
      ],
      requirementVerdicts: [
        {
          requirementId: "REQ-001",
          verdict: "blocked",
          reason: "API evidence is missing.",
          findingIds: ["rf_11111111111111111111111111111111"],
        },
      ],
      contradictions: [
        {
          id: "rc_11111111111111111111111111111111",
          severity: "major",
          left: {
            kind: "agent-result",
            id: "ar_11111111111111111111111111111111",
            summary: "API agent passed.",
          },
          right: {
            kind: "evidence",
            id: "openapi",
            summary: "No matching operation evidence.",
          },
          explanation: "The implementation claim is not supported by OpenAPI evidence.",
          findingIds: ["rf_11111111111111111111111111111111"],
        },
      ],
      newGapDrafts: [
        {
          findingId: "rf_11111111111111111111111111111111",
          category: "api",
          severity: "major",
          title: "Missing OpenAPI operation evidence",
          expected: "Operation evidence exists.",
          observed: "No operation evidence was cited.",
          impact: "API implementation cannot be accepted as complete.",
        },
      ],
      sourceArtifactIds: [],
    });

    expect(result.reviewer).toBe("review-council");
  });

  it("rejects verdicts that reference unknown findings", () => {
    const result = ReviewCouncilResultSchema.safeParse({
      schemaVersion: "review-council-v1",
      runId: "run_11111111111111111111111111111111",
      agent: "review-council",
      generatedAt: "2026-06-23T00:00:00.000Z",
      summary: "Invalid finding reference.",
      findings: [],
      requirementVerdicts: [
        {
          requirementId: "REQ-001",
          verdict: "blocked",
          reason: "Finding is missing.",
          findingIds: ["rf_11111111111111111111111111111111"],
        },
      ],
      contradictions: [],
      newGapDrafts: [],
      sourceArtifactIds: [],
    });

    expect(result.success).toBe(false);
  });
});
