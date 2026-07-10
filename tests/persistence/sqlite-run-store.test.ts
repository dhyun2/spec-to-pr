import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createInitialRun } from "../../src/run/index.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";
import { RevisionConflictError, RunNotFoundError } from "../../src/store/errors.js";

const now = "2026-06-23T00:00:00.000Z";
const runId = "run_11111111111111111111111111111111";

describe("SqliteRunStore", () => {
  let directory: string;
  let databasePath: string;
  let store: SqliteRunStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-store-"));
    databasePath = path.join(directory, "runs.sqlite3");
    store = new SqliteRunStore(databasePath);
  });

  afterEach(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates and reads a Run", async () => {
    const run = createRun();

    await store.create(run);

    const loaded = await store.get(run.id);

    expect(loaded.id).toBe(run.id);
    expect(loaded.revision).toBe(0);
  });

  it("persists Runs across store instances", async () => {
    const run = createRun();

    await store.create(run);
    await store.close();

    store = new SqliteRunStore(databasePath);

    const loaded = await store.get(run.id);

    expect(loaded.id).toBe(run.id);
  });

  it("lists Run summaries", async () => {
    const run = createRun();

    await store.create(run);

    const summaries = await store.list();

    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.id).toBe(run.id);
    expect(summaries[0]!.stageCount).toBe(run.stages.length);
  });

  it("saves when expected revision matches", async () => {
    const run = createRun();

    await store.create(run);

    const next = {
      ...run,
      revision: 1,
      status: "running" as const,
      updatedAt: "2026-06-23T00:00:01.000Z",
    };

    await store.save(next, 0);

    const loaded = await store.get(run.id);

    expect(loaded.revision).toBe(1);
    expect(loaded.status).toBe("running");
  });

  it("rejects stale revision updates", async () => {
    const run = createRun();

    await store.create(run);

    const next = {
      ...run,
      revision: 1,
      status: "running" as const,
      updatedAt: "2026-06-23T00:00:01.000Z",
    };

    await store.save(next, 0);

    await expect(store.save({ ...next, revision: 1 }, 0)).rejects.toBeInstanceOf(
      RevisionConflictError,
    );
  });

  it("throws RunNotFoundError for missing Runs", async () => {
    await expect(store.get(runId)).rejects.toBeInstanceOf(RunNotFoundError);
  });
});

function createRun() {
  return createInitialRun(
    {
      sources: [],
    },
    {
      id: runId,
      pluginVersion: "0.1.0",
      projectRoot: "/tmp/project",
      now,
    },
  );
}
