import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildSpecBddContextPack } from "../../src/spec-bdd/spec-bdd-context.js";
import { createInitialRun } from "../../src/run/index.js";

let directory: string;
let projectRoot: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-bdd-context-"));
  projectRoot = path.join(directory, "project");

  const artifacts = path.join(
    projectRoot,
    "openspec",
    "changes",
    "deliver-reservation-management",
    "artifacts",
  );

  await mkdir(artifacts, { recursive: true });
  await writeFile(path.join(artifacts, "change-manifest.json"), "{}\n");
  await writeFile(path.join(artifacts, "test-matrix.json"), `${JSON.stringify(testMatrix())}\n`);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("Spec/BDD context pack", () => {
  it("builds context paths for a change", async () => {
    const run = createInitialRun(
      {
        sources: [],
        baseCommit: "abcdef1",
      },
      {
        id: "run_11111111111111111111111111111111",
        pluginVersion: "0.1.0",
        projectRoot,
        now: "2026-06-23T00:00:00.000Z",
      },
    );

    const context = await buildSpecBddContextPack({
      run,
      changeName: "deliver-reservation-management",
    });

    expect(context.changeName).toBe("deliver-reservation-management");
    expect(context.openSpec.manifestPath).toBe(
      "openspec/changes/deliver-reservation-management/artifacts/change-manifest.json",
    );
    expect(context.allowedWritePaths).toContain(
      "openspec/changes/deliver-reservation-management/artifacts/spec-bdd-review.md",
    );
  });
});

function testMatrix() {
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
