import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { ReviewScorecardService } from "../../src/application/review-scorecard-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { RunManifestSchema } from "../../src/run/run.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let store: SqliteRunStore;
let artifactStore: ArtifactBlobStore;
let service: ReviewScorecardService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-scorecard-"));
  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  artifactStore = new ArtifactBlobStore(path.join(directory, "artifacts"));
  service = new ReviewScorecardService(store, artifactStore, () => "2026-06-23T00:00:02.000Z");
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("ReviewScorecardService", () => {
  it("records a scorecard artifact and chooses the lowest failing dimension as next repair target", async () => {
    const run = RunManifestSchema.parse({
      ...createInitialRun(
        { sources: [], baseCommit: "abcdef1" },
        {
          id: "run_11111111111111111111111111111111",
          pluginVersion: "0.1.0",
          projectRoot: "/tmp/project",
          now: "2026-06-23T00:00:00.000Z",
        },
      ),
      artifacts: [
        artifact("art_11111111111111111111111111111111", "traceability-matrix", {
          rowCount: 3,
        }),
        artifact("art_22222222222222222222222222222222", "legacy-feature-inventory", {
          reportKind: "legacy-feature-inventory-json",
        }),
        artifact("art_33333333333333333333333333333333", "feature-coverage-matrix", {
          reportKind: "feature-coverage-matrix-json",
          inventoryArtifactId: "art_22222222222222222222222222222222",
          uncoveredCount: 1,
          documentedOnlyCount: 0,
        }),
        artifact("art_44444444444444444444444444444444", "gherkin", {}),
        artifact("art_55555555555555555555555555555555", "test-matrix", {}),
        artifact("art_66666666666666666666666666666666", "visual-report", {
          reportKind: "visual-report-json",
          comparisonMode: "legacy-vs-target",
          decision: "passed",
        }),
      ],
      agentResults: [
        {
          schemaVersion: "0.1.0",
          id: "ar_11111111111111111111111111111111",
          runId: "run_11111111111111111111111111111111",
          kind: "verification",
          agent: "evidence-verifier",
          status: "passed",
          baseSha: "0000000",
          changedFiles: [],
          evidenceIds: [],
          artifactIds: ["art_55555555555555555555555555555555"],
          gapIds: [],
          checks: [
            {
              id: "chk_11111111111111111111111111111111",
              name: "unit",
              kind: "unit",
              status: "passed",
              exitCode: 0,
              summary: "unit passed.",
            },
          ],
          decisions: [],
          startedAt: "2026-06-23T00:00:00.000Z",
          completedAt: "2026-06-23T00:00:01.000Z",
        },
      ],
    });
    await store.create(run);

    const generated = await service.generate({
      runId: run.id,
      minimumScore: 8,
      attempt: 1,
      maxAttempts: 3,
    });

    expect(generated.decision).toMatchObject({
      status: "retry",
      score: 5,
      minimumScore: 8,
      nextRepairTarget: "legacy-coverage",
    });
    expect(generated.dimensions).toHaveLength(9);
    expect(
      generated.dimensions.find((dimension) => dimension.id === "legacy-coverage"),
    ).toMatchObject({
      score: 5,
      status: "fail",
      nextRepairTarget: true,
    });

    const loaded = await store.get(run.id);
    const scorecardArtifact = loaded.artifacts.find(
      (item) => item.id === generated.scorecardArtifactId,
    );

    expect(scorecardArtifact).toMatchObject({
      kind: "review-scorecard",
      metadata: {
        reportKind: "review-scorecard-json",
        decision: "retry",
        nextRepairTarget: "legacy-coverage",
      },
    });

    const content = await artifactStore.readContent(scorecardArtifact!.digest);

    expect(content.toString("utf8")).toContain("Review scorecard retry");
  });

  it("normalizes fractional minimumScore values onto the ten-point score scale", async () => {
    const run = RunManifestSchema.parse({
      ...createInitialRun(
        { sources: [], baseCommit: "abcdef1" },
        {
          id: "run_11111111111111111111111111111111",
          pluginVersion: "0.1.0",
          projectRoot: "/tmp/project",
          now: "2026-06-23T00:00:00.000Z",
        },
      ),
      artifacts: [
        artifact("art_11111111111111111111111111111111", "traceability-matrix", {
          rowCount: 3,
        }),
        artifact("art_22222222222222222222222222222222", "legacy-feature-inventory", {
          reportKind: "legacy-feature-inventory-json",
        }),
        artifact("art_33333333333333333333333333333333", "feature-coverage-matrix", {
          reportKind: "feature-coverage-matrix-json",
          inventoryArtifactId: "art_22222222222222222222222222222222",
          uncoveredCount: 1,
          documentedOnlyCount: 0,
        }),
        artifact("art_44444444444444444444444444444444", "gherkin", {}),
        artifact("art_55555555555555555555555555555555", "test-matrix", {}),
        artifact("art_66666666666666666666666666666666", "visual-report", {
          reportKind: "visual-report-json",
          comparisonMode: "legacy-vs-target",
          decision: "passed",
        }),
      ],
    });
    await store.create(run);

    const generated = await service.generate({
      runId: run.id,
      minimumScore: 0.85,
      attempt: 1,
      maxAttempts: 3,
    });

    expect(generated.decision).toMatchObject({
      status: "retry",
      minimumScore: 8.5,
    });
    expect(
      generated.dimensions.find((dimension) => dimension.id === "legacy-coverage"),
    ).toMatchObject({
      threshold: 8.5,
      status: "fail",
    });
  });

  it("does not treat markdown-only visual reports as comparison evidence", async () => {
    const run = RunManifestSchema.parse({
      ...createInitialRun(
        { sources: [], baseCommit: "abcdef1" },
        {
          id: "run_11111111111111111111111111111111",
          pluginVersion: "0.1.0",
          projectRoot: "/tmp/project",
          now: "2026-06-23T00:00:00.000Z",
        },
      ),
      artifacts: [
        artifact("art_11111111111111111111111111111111", "legacy-feature-inventory", {
          reportKind: "legacy-feature-inventory-json",
        }),
        artifact("art_22222222222222222222222222222222", "feature-coverage-matrix", {
          reportKind: "feature-coverage-matrix-json",
          inventoryArtifactId: "art_11111111111111111111111111111111",
          uncoveredCount: 0,
          documentedOnlyCount: 0,
        }),
        artifact("art_33333333333333333333333333333333", "visual-report", {
          reportKind: "visual-report-markdown",
          jsonReportArtifactId: "art_missingmissingmissingmissingmiss",
        }),
      ],
    });
    await store.create(run);

    const generated = await service.generate({
      runId: run.id,
      minimumScore: 8,
      attempt: 1,
      maxAttempts: 3,
    });

    expect(
      generated.dimensions.find((dimension) => dimension.id === "visual-parity"),
    ).toMatchObject({
      score: 0,
      status: "fail",
      notes: "Visual scope exists, but no official visual comparison report was recorded.",
    });
  });

  it("explains stale feature coverage matrices in the legacy coverage score", async () => {
    const run = RunManifestSchema.parse({
      ...createInitialRun(
        { sources: [], baseCommit: "abcdef1" },
        {
          id: "run_11111111111111111111111111111111",
          pluginVersion: "0.1.0",
          projectRoot: "/tmp/project",
          now: "2026-06-23T00:00:00.000Z",
        },
      ),
      artifacts: [
        artifact("art_11111111111111111111111111111111", "legacy-feature-inventory", {
          reportKind: "legacy-feature-inventory-json",
        }),
        artifact("art_22222222222222222222222222222222", "feature-coverage-matrix", {
          reportKind: "feature-coverage-matrix-json",
          inventoryArtifactId: "art_11111111111111111111111111111111",
          uncoveredCount: 0,
          documentedOnlyCount: 0,
        }),
        artifact("art_33333333333333333333333333333333", "legacy-feature-inventory", {
          reportKind: "legacy-feature-inventory-json",
        }),
      ],
    });
    await store.create(run);

    const generated = await service.generate({
      runId: run.id,
      minimumScore: 8,
      attempt: 1,
      maxAttempts: 3,
    });

    expect(
      generated.dimensions.find((dimension) => dimension.id === "legacy-coverage"),
    ).toMatchObject({
      score: 0,
      status: "fail",
      notes: expect.stringContaining("stale feature coverage matrix"),
    });
    expect(
      generated.dimensions.find((dimension) => dimension.id === "legacy-coverage")?.notes,
    ).toContain("art_22222222222222222222222222222222");
  });
});

function artifact(id: string, kind: string, metadata: Record<string, unknown>) {
  return {
    id,
    kind,
    uri: `artifact://sha256/${id}`,
    mediaType: "application/json",
    digest: `sha256:${id.slice(4).padEnd(64, "0")}`,
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:00.000Z",
    metadata,
  };
}
