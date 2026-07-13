import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { SpecBddAgentLaneService } from "../../src/application/spec-bdd-agent-lane-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let artifactStore: ArtifactBlobStore;
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

  artifactStore = new ArtifactBlobStore(path.join(directory, "artifacts"));
  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  service = new SpecBddAgentLaneService(store, artifactStore, () => "2026-06-23T00:00:00.000Z");

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
    expect(loadedContext.contextPack.allowedWritePaths).toEqual([]);
    expect(loadedContext.contextPack.expectedOutputs).toEqual([
      "artifact-store://openspec/changes/deliver-reservation-management/artifacts/spec-bdd-review.md",
      "artifact-store://openspec/changes/deliver-reservation-management/artifacts/spec-bdd-review.json",
    ]);

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
    expect(recorded.acceptanceSkeletonFiles).toHaveLength(0);

    const loaded = await store.get("run_11111111111111111111111111111111");
    const markdownArtifact = loaded.artifacts.find(
      (artifact) => artifact.id === recorded.artifactIds[1],
    );
    expect(markdownArtifact?.uri).toMatch(/^artifact:\/\/sha256\//);

    const report = (await artifactStore.readContent(markdownArtifact!.digest)).toString("utf8");
    expect(report).toContain("Spec/BDD Review");

    expect(loaded.agentResults).toHaveLength(1);
    expect(loaded.agentResults[0]?.agent).toBe("implementation");

    await expect(
      access(path.join(projectRoot, "tests", "acceptance", "generated")),
    ).rejects.toMatchObject({ code: "ENOENT" });
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
