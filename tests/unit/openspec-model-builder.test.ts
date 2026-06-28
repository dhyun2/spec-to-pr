import { describe, expect, it } from "vitest";

import {
  buildOpenSpecChangeModel,
  parseTraceabilityMatrixLike,
} from "../../src/openspec/openspec-model-builder.js";
import { createInitialRun } from "../../src/run/index.js";

const now = "2026-06-23T00:00:00.000Z";
const runId = "run_11111111111111111111111111111111";
const sourceId = "src_11111111111111111111111111111111";
const evidenceId = "ev_11111111111111111111111111111111";
const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function runWithEvidence() {
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

  return run;
}

describe("OpenSpec model builder", () => {
  it("builds a change model from traceability rows", () => {
    const model = buildOpenSpecChangeModel({
      run: runWithEvidence(),
      matrix: {
        rows: [
          {
            requirementId: "REQ-001",
            title: "예약 목록 조회",
            summary: "예약 목록을 조회해야 한다.",
            briefEvidenceIds: [evidenceId],
            figmaEvidenceIds: [],
            openApiEvidenceIds: [],
            gapIds: [],
            tags: [],
          },
        ],
        artifactIds: [],
      },
      changeName: "deliver-reservation-management",
      generatedAt: now,
    });

    expect(model.changeName).toBe("deliver-reservation-management");
    expect(model.requirements[0]?.area).toBe("reservation-management");
  });

  it("normalizes Task 13 matrix artifact rows", () => {
    const normalized = parseTraceabilityMatrixLike([
      {
        requirementNodeId: "tn_11111111111111111111111111111111",
        requirementLabel: "Reservation list should be shown",
        briefEvidenceIds: [evidenceId],
        apiNodeIds: ["tn_22222222222222222222222222222222"],
        figmaNodeIds: [],
        gapIds: [],
        status: "missing-figma",
      },
    ]);

    expect(normalized.rows[0]).toMatchObject({
      requirementId: "REQ-001",
      title: "Reservation list should be shown",
      briefEvidenceIds: [evidenceId],
    });
  });
});
