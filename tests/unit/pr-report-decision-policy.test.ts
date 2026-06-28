import { describe, expect, it } from "vitest";

import { decideReportStatus } from "../../src/pr-report/pr-report-decision-policy.js";

describe("PR report decision policy", () => {
  it("blocks on mandatory check failure", () => {
    const decision = decideReportStatus({
      checks: [
        {
          id: "chk_11111111111111111111111111111111",
          name: "typecheck",
          kind: "typecheck",
          status: "failed",
          failureReason: "Type error",
          summary: "Typecheck failed",
        },
      ],
      gaps: [],
    });

    expect(decision).toBe("blocked");
  });

  it("blocks on open blocker gaps", () => {
    const decision = decideReportStatus({
      checks: [],
      gaps: [
        {
          id: "gap_11111111111111111111111111111111",
          category: "api",
          severity: "blocker",
          status: "open",
          title: "Missing API",
          expected: "API exists",
          observed: "API missing",
          impact: "Cannot implement",
          sourceEvidenceIds: [],
          resolutionArtifactIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
          metadata: {},
        },
      ],
    });

    expect(decision).toBe("blocked");
  });

  it("drafts on open major gaps", () => {
    const decision = decideReportStatus({
      checks: [],
      gaps: [
        {
          id: "gap_11111111111111111111111111111111",
          category: "design",
          severity: "major",
          status: "open",
          title: "Missing Figma state",
          expected: "State exists",
          observed: "State missing",
          impact: "Visual uncertainty",
          sourceEvidenceIds: [],
          resolutionArtifactIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
          metadata: {},
        },
      ],
    });

    expect(decision).toBe("draft");
  });
});
