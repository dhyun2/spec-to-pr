import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { QualityGateService } from "../../src/application/quality-gate-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let store: SqliteRunStore;
let service: QualityGateService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-quality-service-"));
  projectRoot = path.join(directory, "project");

  await mkdir(projectRoot, {
    recursive: true,
  });
  await mkdir(path.join(projectRoot, "coverage"), {
    recursive: true,
  });
  await writeFile(
    path.join(projectRoot, "coverage", "coverage-summary.json"),
    JSON.stringify({
      total: {
        lines: { total: 10, covered: 9, skipped: 0, pct: 90 },
        statements: { total: 10, covered: 9, skipped: 0, pct: 90 },
        functions: { total: 5, covered: 5, skipped: 0, pct: 100 },
        branches: { total: 4, covered: 2, skipped: 0, pct: 50 },
      },
    }),
  );

  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  service = new QualityGateService(
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

describe("QualityGateService", () => {
  it("records checks artifacts coverage gaps and verification result", async () => {
    const result = await service.run({
      runId: "run_11111111111111111111111111111111",
      gates: ["typecheck", "build"],
      commands: {
        typecheck: {
          command: process.execPath,
          args: ["-e", "console.log('typecheck ok')"],
        },
        build: {
          command: process.execPath,
          args: ["-e", "console.error('build failed'); process.exit(2)"],
        },
      },
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("failed");
    expect(result.passedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(result.coverageArtifactId).toBeDefined();
    expect(result.gapIds).toHaveLength(1);

    const loaded = await store.get("run_11111111111111111111111111111111");

    expect(loaded.artifacts.some((artifact) => artifact.id === result.reportArtifactId)).toBe(true);
    expect(
      loaded.artifacts.some((artifact) => artifact.metadata["reportKind"] === "coverage-summary"),
    ).toBe(true);
    expect(loaded.gaps).toHaveLength(1);
    expect(loaded.agentResults).toHaveLength(1);
    expect(loaded.agentResults[0]).toMatchObject({
      kind: "verification",
      agent: "evidence-verifier",
      status: "failed",
    });
    expect(loaded.agentResults[0]?.checks.map((check) => check.status)).toEqual([
      "passed",
      "failed",
    ]);
  });

  it("records missing gates as skipped checks", async () => {
    const result = await service.run({
      runId: "run_11111111111111111111111111111111",
      gates: ["lint"],
      coverageSummaryPath: "coverage/missing-summary.json",
    });

    expect(result.status).toBe("passed");
    expect(result.passedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.skippedCount).toBe(1);

    const loaded = await store.get("run_11111111111111111111111111111111");

    expect(loaded.agentResults[0]?.checks[0]).toMatchObject({
      name: "lint",
      status: "skipped",
    });
  });
});
