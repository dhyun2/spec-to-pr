import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { EvidenceGraphService } from "../../src/application/evidence-graph-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let store: SqliteRunStore;
let service: EvidenceGraphService;

const now = "2026-06-23T00:00:00.000Z";
const runId = "run_11111111111111111111111111111111";
const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-graph-service-"));
  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  service = new EvidenceGraphService(
    store,
    new ArtifactBlobStore(path.join(directory, "artifacts")),
    () => now,
  );
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("EvidenceGraphService", () => {
  it("builds graph artifacts and updates Run", async () => {
    const run = createInitialRun(
      {
        sources: [
          {
            id: "src_11111111111111111111111111111111",
            kind: "brief",
            locator: { type: "file", path: "docs/brief.md" },
            digest,
            capturedAt: now,
            metadata: {},
          },
        ],
      },
      {
        id: runId,
        pluginVersion: "0.1.0",
        projectRoot: "/tmp/project",
        now,
      },
    );

    run.evidence.push({
      id: "ev_11111111111111111111111111111111",
      sourceId: "src_11111111111111111111111111111111",
      location: {
        type: "file-lines",
        path: "docs/brief.md",
        startLine: 1,
        endLine: 1,
      },
      summary: "Reservations list should be shown",
      excerpt: "Reservations list should be shown.",
      digest,
      capturedAt: now,
      metadata: {
        adapter: "brief-adapter-v1",
        sourceDigest: digest,
        itemType: "requirement",
      },
    });

    await store.create(run);

    const result = await service.buildEvidenceGraph({
      runId,
    });

    expect(result.duplicate).toBe(false);
    expect(result.requirementCount).toBe(1);
    expect(result.graphArtifactId).toBeDefined();

    const loaded = await store.get(runId);

    expect(loaded.artifacts.some((artifact) => artifact.kind === "traceability-graph")).toBe(true);
    expect(loaded.artifacts.some((artifact) => artifact.kind === "traceability-matrix")).toBe(true);
  });
});
