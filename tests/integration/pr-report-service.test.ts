import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { PrReportService } from "../../src/application/pr-report-service.js";
import { RunService } from "../../src/application/run-service.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let store: SqliteRunStore;
let runService: RunService;
let service: PrReportService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-pr-report-"));
  projectRoot = path.join(directory, "project");
  await mkdir(projectRoot, { recursive: true });

  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  runService = new RunService(store, {
    pluginVersion: "0.1.0",
    now: () => "2026-06-23T00:00:00.000Z",
  });
  service = new PrReportService(
    store,
    new ArtifactBlobStore(path.join(directory, "artifacts")),
    () => "2026-06-23T00:00:01.000Z",
  );
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("PrReportService", () => {
  it("generates reads and reviews PR report artifacts", async () => {
    const run = await runService.createRun({
      projectRoot,
    });

    const generated = await service.generatePrReport({
      runId: run.id,
    });

    expect(generated.markdownArtifactId).toMatch(/^art_/);
    expect(generated.viewModelArtifactId).toMatch(/^art_/);

    const report = await service.getPrReport({
      runId: run.id,
      artifactId: generated.markdownArtifactId,
    });

    expect(report.markdown).toContain("# Summary");
    expect(report.markdown).toContain("## Decision");

    const review = await service.recordReview({
      runId: run.id,
      reportArtifactId: generated.markdownArtifactId,
      review: {
        status: "passed",
        findings: [],
      },
    });

    expect(review.findingCount).toBe(0);

    const loaded = await store.get(run.id);

    expect(loaded.artifacts.some((artifact) => artifact.kind === "pr-report")).toBe(true);
  });
});
