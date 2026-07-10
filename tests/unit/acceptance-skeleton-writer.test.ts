import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeAcceptanceSkeletons } from "../../src/spec-bdd/acceptance-skeleton-writer.js";
import type { TestMatrix } from "../../src/gherkin/test-matrix.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-bdd-skeleton-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("acceptance skeleton writer", () => {
  it("writes non-executable acceptance skeletons from test matrix rows", async () => {
    const result = await writeAcceptanceSkeletons({
      projectRoot: directory,
      changeName: "deliver-reservation-management",
      matrix: testMatrix(),
    });

    expect(result.files).toEqual([
      "tests/acceptance/generated/deliver-reservation-management/scn-001.test.md",
    ]);

    const content = await readFile(path.join(directory, result.files[0]!), "utf8");

    expect(content).toContain("This file is a generated acceptance skeleton.");
    expect(content).toContain("It is not an executable test yet.");
  });
});

function testMatrix(): TestMatrix {
  return {
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
        scenarioId: "SCN-001",
        scenarioName: "Reservation list is visible",
        featureFile: "gherkin/reservation.feature",
        area: "reservation",
        layer: "acceptance",
        automation: "automated-candidate",
        status: "ready",
        reason: "Requirement is covered by evidence.",
        briefEvidenceIds: [],
        figmaEvidenceIds: [],
        openApiEvidenceIds: [],
        gapIds: [],
        sourceArtifactIds: [],
      },
    ],
  };
}
