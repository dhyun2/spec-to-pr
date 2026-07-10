import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { ReviewCouncilService } from "../../src/application/review-council-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let store: SqliteRunStore;
let service: ReviewCouncilService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-review-"));
  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  service = new ReviewCouncilService(
    store,
    new ArtifactBlobStore(path.join(directory, "artifacts")),
    directory,
    () => "2026-06-23T00:00:02.000Z",
  );
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("ReviewCouncilService", () => {
  it("prepares context and records structured results", async () => {
    const run = createInitialRun(
      { sources: [], baseCommit: "abcdef1" },
      {
        id: "run_11111111111111111111111111111111",
        pluginVersion: "0.1.0",
        projectRoot: "/tmp/project",
        now: "2026-06-23T00:00:00.000Z",
      },
    );
    await store.create(run);

    const prepared = await service.prepare({
      runId: run.id,
    });

    expect(prepared.contextArtifactId).toBeDefined();

    const context = await service.getContext({
      runId: run.id,
      contextArtifactId: prepared.contextArtifactId,
    });

    expect(context.context.runId).toBe(run.id);

    const recorded = await service.record({
      runId: run.id,
      contextArtifactId: prepared.contextArtifactId,
      result: {
        schemaVersion: "review-council-v1",
        runId: run.id,
        agent: "review-council",
        generatedAt: "2026-06-23T00:00:01.000Z",
        summary: "One API evidence gap was found.",
        findings: [
          {
            id: "rf_11111111111111111111111111111111",
            category: "api-contract",
            severity: "major",
            status: "open",
            title: "Missing OpenAPI evidence",
            expected: "API claim cites OpenAPI evidence.",
            observed: "No operation evidence was cited.",
            recommendation: "Keep this work as an API gap.",
            createdAt: "2026-06-23T00:00:01.000Z",
          },
        ],
        requirementVerdicts: [
          {
            requirementId: "REQ-001",
            verdict: "blocked",
            reason: "API evidence is missing.",
            findingIds: ["rf_11111111111111111111111111111111"],
          },
        ],
        contradictions: [],
        newGapDrafts: [
          {
            findingId: "rf_11111111111111111111111111111111",
            category: "api",
            severity: "major",
            title: "Missing OpenAPI evidence",
            expected: "Operation evidence exists.",
            observed: "No operation evidence was cited.",
            impact: "API implementation cannot be accepted as complete.",
          },
        ],
        sourceArtifactIds: [prepared.contextArtifactId],
      },
    });

    expect(recorded.reportArtifactId).toBeDefined();
    expect(recorded.agentResultId).toBeDefined();
    expect(recorded.newGapCount).toBe(1);

    const loaded = await store.get(run.id);

    expect(loaded.gaps).toHaveLength(1);
    expect(loaded.agentResults.some((result) => result.agent === "review-council")).toBe(true);
  });
});
