import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { FigmaIntakeService } from "../../src/application/figma-intake-service.js";
import { RunService } from "../../src/application/run-service.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let store: SqliteRunStore;
let runService: RunService;
let service: FigmaIntakeService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-figma-intake-"));
  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  runService = new RunService(store, {
    pluginVersion: "0.1.0",
  });
  service = new FigmaIntakeService(store, new ArtifactBlobStore(path.join(directory, "artifacts")));
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("FigmaIntakeService", () => {
  it("registers source and records metadata", async () => {
    const run = await runService.createRun({
      projectRoot: directory,
    });
    const sourceResult = await service.registerFigmaSource({
      runId: run.id,
      url: "https://www.figma.com/design/abc123/Product?node-id=238-941",
    });

    const recorded = await service.recordTextArtifact({
      runId: run.id,
      sourceId: sourceResult.source.id,
      kind: "metadata",
      content: '<node id="238:941" name="Reservation" />',
      mediaType: "application/xml",
      providerId: "figma-local",
    });

    expect(recorded.duplicate).toBe(false);

    const loaded = await store.get(run.id);

    expect(loaded.sources).toHaveLength(1);
    expect(loaded.evidence).toHaveLength(1);
    expect(loaded.artifacts[0]?.kind).toBe("figma-metadata");
  });
});
