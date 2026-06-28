import { describe, expect, it } from "vitest";

import { generateGherkinAndTestMatrix } from "../../src/gherkin/gherkin-generator.js";

const now = "2026-06-23T00:00:00.000Z";
const runId = "run_11111111111111111111111111111111";
const briefEvidenceId = "ev_11111111111111111111111111111111";
const figmaEvidenceId = "ev_22222222222222222222222222222222";
const openApiEvidenceId = "ev_33333333333333333333333333333333";
const gapId = "gap_11111111111111111111111111111111";

describe("Gherkin generator", () => {
  it("generates scenarios and matrix rows for ready requirements", () => {
    const result = generateGherkinAndTestMatrix({
      model: {
        runId,
        changeName: "deliver-reservation-management",
        title: "Deliver Reservation Management",
        summary: "Reservation change",
        generatedAt: now,
        sourceArtifactIds: [],
        specAreas: ["reservation-management"],
        gapIds: [],
        requirements: [
          {
            id: "REQ-001",
            area: "reservation-management",
            title: "예약 목록 조회",
            summary: "예약 목록을 조회해야 한다.",
            status: "ready",
            briefEvidenceIds: [briefEvidenceId],
            figmaEvidenceIds: [figmaEvidenceId],
            openApiEvidenceIds: [openApiEvidenceId],
            gapIds: [],
            tags: [],
          },
        ],
      },
      gaps: [],
    });

    expect(result.bundle.features).toHaveLength(1);
    expect(result.bundle.features[0]!.rules[0]!.scenarios).toHaveLength(1);
    expect(result.bundle.features[0]!.rules[0]!.scenarios[0]!.tags).toContain("@REQ:REQ-001");
    expect(result.matrix.rows[0]).toMatchObject({
      requirementId: "REQ-001",
      automation: "automated-candidate",
      status: "ready",
    });
  });

  it("keeps blocked requirements out of executable feature scenarios", () => {
    const result = generateGherkinAndTestMatrix({
      model: {
        runId,
        changeName: "deliver-reservation-management",
        title: "Deliver Reservation Management",
        summary: "Reservation change",
        generatedAt: now,
        sourceArtifactIds: [],
        specAreas: ["reservation-management"],
        gapIds: [gapId],
        requirements: [
          {
            id: "REQ-002",
            area: "reservation-management",
            title: "문의 팝업",
            summary: "문의 팝업을 제공한다.",
            status: "blocked",
            briefEvidenceIds: [briefEvidenceId],
            figmaEvidenceIds: [],
            openApiEvidenceIds: [],
            gapIds: [gapId],
            tags: [],
          },
        ],
      },
      gaps: [
        {
          id: gapId,
          category: "api",
          severity: "blocker",
          status: "open",
          title: "Missing inquiry endpoint",
          expected: "Inquiry endpoint should exist.",
          observed: "No endpoint found.",
          impact: "Cannot implement inquiry popup.",
          sourceEvidenceIds: [],
          resolutionArtifactIds: [],
          createdAt: now,
          updatedAt: now,
          metadata: {},
        },
      ],
    });

    expect(result.bundle.features[0]!.rules[0]!.scenarios).toHaveLength(0);
    expect(result.matrix.rows[0]).toMatchObject({
      automation: "blocked",
      status: "blocked",
    });
  });
});
