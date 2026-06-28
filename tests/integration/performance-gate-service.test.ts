import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { PerformanceGateService } from "../../src/application/performance-gate-service.js";
import { RunService } from "../../src/application/run-service.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let store: SqliteRunStore;
let runService: RunService;
let service: PerformanceGateService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-performance-"));
  projectRoot = path.join(directory, "project");

  await mkdir(projectRoot, {
    recursive: true,
  });

  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  runService = new RunService(store, {
    pluginVersion: "0.1.0",
    now: () => "2026-06-23T00:00:00.000Z",
  });
  service = new PerformanceGateService(
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

describe("PerformanceGateService", () => {
  it("records performance report and gaps", async () => {
    const run = await runService.createRun({
      projectRoot,
    });

    const planned = await service.plan({
      runId: run.id,
      baseUrl: "http://localhost:3000",
      routes: [
        {
          id: "reservation",
          urlPath: "/reservations",
          label: "Reservations",
        },
      ],
    });

    expect(planned.plan.routes).toHaveLength(1);

    const result = await service.run({
      runId: run.id,
      baseUrl: "http://localhost:3000",
      routes: [
        {
          id: "reservation",
          urlPath: "/reservations",
          label: "Reservations",
        },
      ],
      lighthouseReports: [
        {
          requestedUrl: "http://localhost:3000/reservations",
          categories: {
            performance: {
              score: 0.5,
            },
          },
          audits: {
            "largest-contentful-paint": {
              numericValue: 4000,
            },
            "cumulative-layout-shift": {
              numericValue: 0.2,
            },
            "total-blocking-time": {
              numericValue: 300,
            },
          },
        },
      ],
      assets: [
        {
          path: "main.js",
          type: "script",
          transferBytes: 500_000,
          initial: true,
        },
      ],
      packageJson: {
        dependencies: {},
      },
      sourceTexts: [],
    });

    expect(result.decision).toBe("failed");
    expect(result.reportArtifactId).toMatch(/^art_/);
    expect(result.gapIds.length).toBeGreaterThan(0);

    const report = await service.getReport({
      runId: run.id,
      reportArtifactId: result.reportArtifactId,
    });

    expect(report.report.fieldDataCaveat).toBe("lab-only");

    const reviewed = await service.recordReview({
      runId: run.id,
      reportArtifactId: result.reportArtifactId,
      review: {
        summary: "LCP and initial JS need design-ui and integrator follow-up.",
        findings: [
          {
            severity: "major",
            metric: "LCP",
            observed: "4000ms",
            likelyCause: "Large above-the-fold payload",
            owner: "design-ui",
            recommendedAction: "Audit hero/media loading.",
          },
        ],
        fieldDataCaveat: "lab-only",
      },
    });

    expect(reviewed.findingCount).toBe(1);

    const loaded = await store.get(run.id);

    expect(loaded.artifacts.some((artifact) => artifact.kind === "performance-report")).toBe(true);
    expect(loaded.gaps.some((gap) => gap.category === "performance")).toBe(true);
  });
});
