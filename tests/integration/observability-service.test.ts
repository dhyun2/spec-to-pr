import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { ObservabilityService } from "../../src/application/observability-service.js";
import { RunService } from "../../src/application/run-service.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let store: SqliteRunStore;
let runService: RunService;
let service: ObservabilityService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-observability-"));
  projectRoot = path.join(directory, "project");

  await mkdir(projectRoot, {
    recursive: true,
  });

  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  runService = new RunService(store, {
    pluginVersion: "0.1.0",
    now: () => "2026-06-23T00:00:00.000Z",
  });
  service = new ObservabilityService(
    store,
    new ArtifactBlobStore(path.join(directory, "artifacts")),
    () => "2026-06-23T00:00:01.000Z",
  );
});

afterEach(async () => {
  await store.close();
  await rm(directory, { recursive: true, force: true });
});

describe("ObservabilityService", () => {
  it("creates observability artifacts, report, and review", async () => {
    const run = await runService.createRun({
      projectRoot,
    });

    const planned = await service.planObservability({
      runId: run.id,
      target: "both",
      serviceName: "rangepro",
      serviceVersion: "1.0.0",
    });

    expect(planned.plan.enableLogCorrelation).toBe(true);

    const result = await service.generateConfig({
      runId: run.id,
      target: "both",
      serviceName: "rangepro",
      serviceVersion: "1.0.0",
    });

    expect(result.artifactIds.length).toBeGreaterThan(0);

    const report = await service.getReport({
      runId: run.id,
      reportArtifactId: result.reportArtifactId,
    });

    expect(report.report.plan.enableOtelLogs).toBe(false);

    const review = await service.recordReview({
      runId: run.id,
      reportArtifactId: result.reportArtifactId,
      review: {
        status: "passed",
        findings: [],
        requiredFollowUps: [],
      },
    });

    expect(review.findingCount).toBe(0);

    const loaded = await store.get(run.id);

    expect(loaded.artifacts.some((artifact) => artifact.kind === "telemetry-config")).toBe(true);
  });
});
