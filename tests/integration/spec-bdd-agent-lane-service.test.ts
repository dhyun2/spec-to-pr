import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SpecBddAgentLaneService } from "../../src/application/spec-bdd-agent-lane-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let store: SqliteRunStore;
let service: SpecBddAgentLaneService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-bdd-service-"));
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

  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  service = new SpecBddAgentLaneService(store, () => "2026-06-23T00:00:00.000Z");

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

  await store.create(run);
});

afterEach(async () => {
  await store.close();
  await rm(directory, { recursive: true, force: true });
});

describe("SpecBddAgentLaneService", () => {
  it("prepares context pack and records result", async () => {
    const prepared = await service.prepare({
      runId: "run_11111111111111111111111111111111",
      changeName: "deliver-reservation-management",
    });

    expect(prepared.contextPackJsonPath).toContain("context-pack.json");

    const loadedContext = await service.getContext({
      runId: "run_11111111111111111111111111111111",
      changeName: "deliver-reservation-management",
    });

    expect(loadedContext.contextPack.changeName).toBe("deliver-reservation-management");

    const recorded = await service.recordResult({
      runId: "run_11111111111111111111111111111111",
      changeName: "deliver-reservation-management",
      status: "passed",
      reviewedRequirements: 1,
      reviewedScenarios: 1,
      acceptanceSkeletonCount: 1,
      findings: [],
      force: true,
    });

    expect(recorded.artifactIds).toHaveLength(2);
    expect(recorded.acceptanceSkeletonFiles).toHaveLength(1);

    const report = await readFile(path.join(projectRoot, recorded.reportMarkdownPath), "utf8");
    expect(report).toContain("Spec/BDD Review");

    const loaded = await store.get("run_11111111111111111111111111111111");
    expect(loaded.agentResults).toHaveLength(1);
    expect(loaded.agentResults[0]?.agent).toBe("spec-bdd");
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
