import { describe, expect, it } from "vitest";

import { renderGherkinArtifacts } from "../../src/gherkin/gherkin-renderer.js";

describe("Gherkin renderer", () => {
  it("renders feature files and test matrix", () => {
    const rendered = renderGherkinArtifacts({
      bundle: {
        changeName: "deliver-reservation-management",
        generatedAt: "2026-06-23T00:00:00.000Z",
        features: [
          {
            area: "reservation-management",
            name: "Reservation Management",
            tags: ["@AREA:reservation-management"],
            rules: [
              {
                name: "예약 목록 조회",
                scenarios: [
                  {
                    id: "SCN-REQ-001-001",
                    requirementId: "REQ-001",
                    name: "REQ-001 예약 목록 조회",
                    status: "automated-candidate",
                    tags: ["@REQ:REQ-001"],
                    steps: [
                      {
                        keyword: "Given",
                        text: "the reservation page is available",
                      },
                      {
                        keyword: "When",
                        text: "the user opens reservation list",
                      },
                      {
                        keyword: "Then",
                        text: "the reservation list is displayed",
                      },
                    ],
                    briefEvidenceIds: [],
                    figmaEvidenceIds: [],
                    openApiEvidenceIds: [],
                    gapIds: [],
                  },
                ],
              },
            ],
          },
        ],
      },
      matrix: {
        changeName: "deliver-reservation-management",
        generatedAt: "2026-06-23T00:00:00.000Z",
        requirementCount: 1,
        scenarioCount: 1,
        automatedCandidateCount: 1,
        blockedCount: 0,
        reviewNeededCount: 0,
        rows: [
          {
            requirementId: "REQ-001",
            scenarioId: "SCN-REQ-001-001",
            scenarioName: "REQ-001 예약 목록 조회",
            featureFile: "reservation-management.feature",
            area: "reservation-management",
            layer: "component",
            automation: "automated-candidate",
            status: "ready",
            reason: "Assigned to component layer.",
            briefEvidenceIds: [],
            figmaEvidenceIds: [],
            openApiEvidenceIds: [],
            gapIds: [],
            sourceArtifactIds: [],
          },
        ],
      },
    });

    expect(rendered.featureFiles[0]!.content).toContain("Feature: Reservation Management");
    expect(rendered.featureFiles[0]!.content).toContain("Scenario: REQ-001 예약 목록 조회");
    expect(rendered.testMatrixJson).toContain('"status": "ready"');
    expect(rendered.testMatrixMd).toContain("| Requirement | Scenario |");
  });
});
