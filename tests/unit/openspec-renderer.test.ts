import { describe, expect, it } from "vitest";

import { renderOpenSpecChange } from "../../src/openspec/openspec-renderer.js";
import { createInitialRun } from "../../src/run/index.js";

const now = "2026-06-23T00:00:00.000Z";
const runId = "run_11111111111111111111111111111111";
const sourceId = "src_11111111111111111111111111111111";
const evidenceId = "ev_11111111111111111111111111111111";
const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("OpenSpec renderer", () => {
  it("renders proposal design tasks specs and artifacts", () => {
    const run = createInitialRun(
      {
        sources: [
          {
            id: sourceId,
            kind: "brief",
            locator: {
              type: "file",
              path: "docs/brief.md",
            },
            digest,
            capturedAt: now,
            metadata: {},
          },
        ],
      },
      {
        id: runId,
        pluginVersion: "0.1.0",
        projectRoot: "/repo",
        now,
      },
    );

    run.evidence.push({
      id: evidenceId,
      sourceId,
      location: {
        type: "file-lines",
        path: "docs/brief.md",
        startLine: 1,
        endLine: 1,
      },
      summary: "예약 목록 조회 요구사항",
      digest,
      capturedAt: now,
      metadata: {},
    });

    const rendered = renderOpenSpecChange({
      model: {
        runId,
        changeName: "deliver-reservation-management",
        title: "Deliver Reservation Management",
        summary: "Reservation management change.",
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
            briefEvidenceIds: [evidenceId],
            figmaEvidenceIds: [],
            openApiEvidenceIds: [],
            gapIds: [],
            tags: [],
          },
        ],
      },
      run,
    });

    expect(rendered.proposalMd).toContain("Deliver Reservation Management");
    expect(rendered.tasksMd).toContain("Implement REQ-001");
    expect(rendered.specs[0]!.content).toContain("The system SHALL");
  });
});
