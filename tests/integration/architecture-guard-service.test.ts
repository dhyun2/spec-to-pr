import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { ArchitectureGuardService } from "../../src/application/architecture-guard-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let store: SqliteRunStore;
let service: ArchitectureGuardService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-arch-"));
  projectRoot = path.join(directory, "project");

  await mkdir(path.join(projectRoot, "src/features/reservation-list/ui"), {
    recursive: true,
  });
  await writeFile(
    path.join(projectRoot, "src/features/reservation-list/ui/list.tsx"),
    `
import { ReservationApi } from "@/shared/api/generated/staff";

export function List() {
  fetch("/reservations");
  return null;
}
`,
  );

  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  service = new ArchitectureGuardService(
    store,
    new ArtifactBlobStore(path.join(directory, "artifacts")),
    () => "2026-06-23T00:00:00.000Z",
  );

  await store.create(
    createInitialRun(
      { sources: [] },
      {
        id: "run_11111111111111111111111111111111",
        pluginVersion: "0.1.0",
        projectRoot,
        now: "2026-06-23T00:00:00.000Z",
      },
    ),
  );
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("ArchitectureGuardService", () => {
  it("records architecture violations as report artifact and gaps", async () => {
    const result = await service.analyze({
      runId: "run_11111111111111111111111111111111",
    });

    expect(result.violationCount).toBeGreaterThan(0);
    expect(result.blockerCount).toBeGreaterThan(0);
    expect(result.gapIds.length).toBeGreaterThan(0);

    const loaded = await store.get("run_11111111111111111111111111111111");

    expect(loaded.artifacts).toHaveLength(1);
    expect(loaded.gaps.length).toBeGreaterThan(0);
  });

  it("writes source guard tests", async () => {
    const result = await service.generateSourceGuardTests({
      runId: "run_11111111111111111111111111111111",
    });

    expect(result.relativePath).toBe("tests/architecture/source-guard.generated.test.ts");

    const loaded = await store.get("run_11111111111111111111111111111111");

    expect(
      loaded.artifacts.some((artifact) => artifact.metadata["purpose"] === "source-guard-test"),
    ).toBe(true);
  });
});
