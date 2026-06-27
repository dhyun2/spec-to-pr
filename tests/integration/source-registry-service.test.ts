import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-source-service-"));
  projectRoot = path.join(directory, "project");
  dataRoot = path.join(directory, "data");

  await mkdir(path.join(projectRoot, "docs"), {
    recursive: true,
  });

  await writeFile(path.join(projectRoot, "docs", "brief.md"), "# Brief\r\nHello\r\n");

  store = new SqliteRunStore(path.join(dataRoot, "runs.sqlite3"));

  runService = new RunService(store, {
    pluginVersion: "0.1.0",
    now: () => "2026-06-23T00:00:00.000Z",
  });

  sourceRegistryService = new SourceRegistryService(
    store,
    new SourceSnapshotStore(path.join(dataRoot, "source-snapshots")),
    () => "2026-06-23T00:00:00.000Z",
  );
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("SourceRegistryService", () => {
  it("registers a file source and updates the Run", async () => {
    const run = await runService.createRun({
      projectRoot,
    });

    const result = await sourceRegistryService.registerFileSource({
      runId: run.id,
      kind: "brief",
      path: "docs/brief.md",
      mediaType: "text/markdown",
    });

    expect(result.duplicate).toBe(false);
    expect(result.source.kind).toBe("brief");
    expect(result.source.locator).toMatchObject({
      type: "file",
      path: "docs/brief.md",
    });

    const loaded = await store.get(run.id);

    expect(loaded.sources).toHaveLength(1);
    expect(loaded.revision).toBe(1);
  });

  it("does not duplicate the same source digest", async () => {
    const run = await runService.createRun({
      projectRoot,
    });

    const first = await sourceRegistryService.registerFileSource({
      runId: run.id,
      kind: "brief",
      path: "docs/brief.md",
    });

    const second = await sourceRegistryService.registerFileSource({
      runId: run.id,
      kind: "brief",
      path: "docs/brief.md",
    });

    expect(first.source.id).toBe(second.source.id);
    expect(second.duplicate).toBe(true);

    const loaded = await store.get(run.id);

    expect(loaded.sources).toHaveLength(1);
  });
});
