import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { OpenApiIntakeService } from "../../src/application/openapi-intake-service.js";
import { RunService } from "../../src/application/run-service.js";
import { SourceRegistryService } from "../../src/application/source-registry-service.js";
import { SourceSnapshotStore } from "../../src/source-registry/snapshot-store.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let dataRoot: string;
let store: SqliteRunStore;
let runService: RunService;
let sourceRegistryService: SourceRegistryService;
let openApiIntakeService: OpenApiIntakeService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-openapi-service-"));
  projectRoot = path.join(directory, "project");
  dataRoot = path.join(directory, "data");

  await mkdir(path.join(projectRoot, "docs"), { recursive: true });

  await writeFile(
    path.join(projectRoot, "docs", "openapi.yaml"),
    `
openapi: 3.1.0
info:
  title: Reservation API
  version: 1.0.0
paths:
  /reservations:
    get:
      responses:
        '200':
          description: OK
`,
  );

  store = new SqliteRunStore(path.join(dataRoot, "runs.sqlite3"));
  const snapshotStore = new SourceSnapshotStore(path.join(dataRoot, "source-snapshots"));
  const artifactStore = new ArtifactBlobStore(path.join(dataRoot, "artifacts"));

  runService = new RunService(store, {
    pluginVersion: "0.1.0",
    now: () => "2026-06-23T00:00:00.000Z",
  });

  sourceRegistryService = new SourceRegistryService(
    store,
    snapshotStore,
    () => "2026-06-23T00:00:00.000Z",
  );

  openApiIntakeService = new OpenApiIntakeService(
    store,
    snapshotStore,
    artifactStore,
    () => "2026-06-23T00:00:01.000Z",
  );
});

afterEach(async () => {
  await store.close();
  await rm(directory, { recursive: true, force: true });
});

describe("OpenApiIntakeService", () => {
  it("analyzes an OpenAPI source and updates the Run", async () => {
    const run = await runService.createRun({ projectRoot });

    const registered = await sourceRegistryService.registerFileSource({
      runId: run.id,
      kind: "openapi",
      path: "docs/openapi.yaml",
      mediaType: "application/yaml",
    });

    const result = await openApiIntakeService.analyzeOpenApiSource({
      runId: run.id,
      sourceId: registered.source.id,
    });

    expect(result.duplicate).toBe(false);
    expect(result.operationCount).toBe(1);
    expect(result.gapsAdded).toBeGreaterThan(0);

    const loaded = await store.get(run.id);

    expect(loaded.evidence.length).toBeGreaterThan(0);
    expect(loaded.artifacts.some((artifact) => artifact.kind === "openapi-intake-report")).toBe(
      true,
    );
    expect(loaded.gaps.some((gap) => gap.category === "api")).toBe(true);
  });
});
