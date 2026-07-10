import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { LegacyCoverageService } from "../../src/application/legacy-coverage-service.js";
import { RunService } from "../../src/application/run-service.js";
import type { ArtifactRef } from "../../src/runtime/index.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let legacyRoot: string;
let store: SqliteRunStore;
let artifactStore: ArtifactBlobStore;
let runService: RunService;
let service: LegacyCoverageService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-legacy-coverage-"));
  projectRoot = path.join(directory, "target");
  legacyRoot = path.join(directory, "legacy");

  await mkdir(path.join(legacyRoot, "src"), {
    recursive: true,
  });
  await writeFile(
    path.join(legacyRoot, "src", "Map.vue"),
    `
NetFunnel_Action();
window.nativeBackPressed = () => history.back();
location.href = '/booking/#/stores/' + rgnNo;
trackEvent('mapfinder', 'reserve');
`,
  );
  await mkdir(projectRoot, {
    recursive: true,
  });

  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  artifactStore = new ArtifactBlobStore(path.join(directory, "artifacts"));
  runService = new RunService(store, {
    pluginVersion: "0.1.0",
    now: () => "2026-06-23T00:00:00.000Z",
  });
  service = new LegacyCoverageService(store, artifactStore, () => "2026-06-23T00:00:01.000Z");
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("LegacyCoverageService", () => {
  it("records legacy inventory and blocker gaps for uncovered legacy features", async () => {
    const run = await runService.createRun({
      projectRoot,
    });

    const inventory = await service.generateInventory({
      runId: run.id,
      legacyRoot,
    });
    const coverage = await service.buildCoverageMatrix({
      runId: run.id,
      inventoryArtifactId: inventory.inventoryArtifactId,
    });

    expect(inventory.featureCount).toBeGreaterThanOrEqual(4);
    expect(coverage.uncoveredCount).toBe(inventory.featureCount);
    expect(coverage.gapIds).toHaveLength(coverage.uncoveredCount);

    const loaded = await store.get(run.id);

    expect(loaded.artifacts.some((artifact) => artifact.kind === "legacy-feature-inventory")).toBe(
      true,
    );
    expect(
      loaded.evidence.filter(
        (evidence) => evidence.metadata["adapter"] === "legacy-feature-inventory-v1",
      ),
    ).toHaveLength(inventory.featureCount);
    expect(loaded.artifacts.some((artifact) => artifact.kind === "feature-coverage-matrix")).toBe(
      true,
    );
    expect(
      loaded.gaps.some((gap) => gap.category === "legacy-coverage" && gap.severity === "blocker"),
    ).toBe(true);
    expect(
      loaded.gaps
        .filter((gap) => gap.category === "legacy-coverage")
        .every((gap) => gap.sourceEvidenceIds.length === 1),
    ).toBe(true);
  });

  it("reuses open legacy coverage gaps when the coverage matrix is rebuilt", async () => {
    const run = await runService.createRun({
      projectRoot,
    });

    const inventory = await service.generateInventory({
      runId: run.id,
      legacyRoot,
    });
    const firstCoverage = await service.buildCoverageMatrix({
      runId: run.id,
      inventoryArtifactId: inventory.inventoryArtifactId,
    });
    const secondCoverage = await service.buildCoverageMatrix({
      runId: run.id,
      inventoryArtifactId: inventory.inventoryArtifactId,
    });
    const loaded = await store.get(run.id);
    const legacyCoverageGaps = loaded.gaps.filter((gap) => gap.category === "legacy-coverage");

    expect(secondCoverage.gapIds).toEqual(firstCoverage.gapIds);
    expect(legacyCoverageGaps).toHaveLength(firstCoverage.gapIds.length);
  });

  it("treats Gherkin text as documented coverage but still requires execution evidence", async () => {
    const run = await runService.createRun({
      projectRoot,
    });

    const inventory = await service.generateInventory({
      runId: run.id,
      legacyRoot,
    });

    await appendArtifact(
      run.id,
      "art_11111111111111111111111111111111",
      "gherkin",
      [
        "NetFunnel_Action",
        "nativeBackPressed",
        "location.href",
        "rgnNo",
        "/booking/#/stores/",
        "trackEvent",
        "mapfinder reserve",
      ].join("\n"),
    );

    const coverage = await service.buildCoverageMatrix({
      runId: run.id,
      inventoryArtifactId: inventory.inventoryArtifactId,
    });
    const loaded = await store.get(run.id);
    const matrixArtifact = loaded.artifacts.find(
      (artifact) => artifact.id === coverage.matrixArtifactId,
    );

    expect(matrixArtifact).toBeDefined();

    const matrix = JSON.parse(
      (await artifactStore.readContent(matrixArtifact!.digest)).toString("utf8"),
    ) as {
      rows: Array<{
        coverageLevel: string;
        covered: boolean;
        documentationArtifactIds: string[];
        testArtifactIds: string[];
        fidelitySeverity: string;
      }>;
    };

    expect(matrix.rows.every((row) => row.coverageLevel === "documented")).toBe(true);
    expect(matrix.rows.every((row) => row.covered === false)).toBe(true);
    expect(matrix.rows.every((row) => row.documentationArtifactIds.length > 0)).toBe(true);
    expect(matrix.rows.every((row) => row.testArtifactIds.length === 0)).toBe(true);
    expect(matrix.rows.every((row) => row.fidelitySeverity === "major")).toBe(true);
    expect(
      loaded.gaps.some((gap) => gap.category === "legacy-coverage" && gap.severity === "major"),
    ).toBe(true);
  });

  it("treats matching test-report evidence as executed legacy coverage", async () => {
    const run = await runService.createRun({
      projectRoot,
    });

    const inventory = await service.generateInventory({
      runId: run.id,
      legacyRoot,
    });

    await appendArtifact(
      run.id,
      "art_22222222222222222222222222222222",
      "test-report",
      [
        "passed NetFunnel_Action",
        "passed nativeBackPressed",
        "passed location.href",
        "passed rgnNo",
        "passed /booking/#/stores/",
        "passed trackEvent",
        "mapfinder reserve",
      ].join("\n"),
    );

    const coverage = await service.buildCoverageMatrix({
      runId: run.id,
      inventoryArtifactId: inventory.inventoryArtifactId,
    });
    const loaded = await store.get(run.id);
    const matrixArtifact = loaded.artifacts.find(
      (artifact) => artifact.id === coverage.matrixArtifactId,
    );
    const matrix = JSON.parse(
      (await artifactStore.readContent(matrixArtifact!.digest)).toString("utf8"),
    ) as {
      rows: Array<{
        coverageLevel: string;
        covered: boolean;
        testArtifactIds: string[];
        fidelitySeverity: string;
      }>;
    };

    expect(coverage.uncoveredCount).toBe(0);
    expect(coverage.gapIds).toHaveLength(0);
    expect(matrix.rows.every((row) => row.coverageLevel === "executed")).toBe(true);
    expect(matrix.rows.every((row) => row.covered === true)).toBe(true);
    expect(matrix.rows.every((row) => row.testArtifactIds.length > 0)).toBe(true);
    expect(matrix.rows.every((row) => row.fidelitySeverity === "info")).toBe(true);
  });
});

async function appendArtifact(
  runId: string,
  artifactId: string,
  kind: ArtifactRef["kind"],
  content: string,
): Promise<void> {
  const run = await store.get(runId);
  const timestamp = "2026-06-23T00:00:00.750Z";
  const blob = await artifactStore.writeBlob({
    content: Buffer.from(`${content}\n`, "utf8"),
    mediaType: "text/plain",
    storedAt: timestamp,
    label: `${kind}.txt`,
  });

  await store.save(
    {
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      artifacts: [
        ...run.artifacts,
        {
          id: artifactId,
          kind,
          uri: blob.uri,
          mediaType: "text/plain",
          digest: blob.digest,
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: timestamp,
          metadata: {
            reportKind: `${kind}-text`,
          },
        },
      ],
    },
    run.revision,
  );
}
