import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { OpenSpecChangeService } from "../../src/application/openspec-change-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { ArtifactRefSchema } from "../../src/runtime/artifact.js";
import { createArtifactId } from "../../src/runtime/id-factory.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let dataRoot: string;
let store: SqliteRunStore;
let artifactStore: ArtifactBlobStore;
let service: OpenSpecChangeService;

const now = "2026-06-23T00:00:00.000Z";
const runId = "run_11111111111111111111111111111111";
const sourceId = "src_11111111111111111111111111111111";
const evidenceId = "ev_11111111111111111111111111111111";
const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-openspec-"));
  projectRoot = path.join(directory, "project");
  dataRoot = path.join(directory, "data");

  await mkdir(projectRoot, {
    recursive: true,
  });

  store = new SqliteRunStore(path.join(dataRoot, "runs.sqlite3"));
  artifactStore = new ArtifactBlobStore(path.join(dataRoot, "artifacts"));

  service = new OpenSpecChangeService(store, artifactStore, () => now);
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("OpenSpecChangeService", () => {
  it("generates OpenSpec change files from a traceability matrix artifact", async () => {
    const run = createInitialRun(
      {
        sources: [
          {
            id: sourceId,
            kind: "brief",
            locator: {
              type: "file",
              path: "docs/brief.md",
            },
            digest,
            capturedAt: now,
            metadata: {},
          },
        ],
      },
      {
        id: runId,
        pluginVersion: "0.1.0",
        projectRoot,
        now,
      },
    );

    const evidence = {
      id: evidenceId,
      sourceId,
      location: {
        type: "file-lines" as const,
        path: "docs/brief.md",
        startLine: 1,
        endLine: 1,
      },
      summary: "예약 목록 조회 요구사항",
      digest,
      capturedAt: now,
      metadata: {},
    };

    const matrix = {
      rows: [
        {
          requirementId: "REQ-001",
          title: "예약 목록 조회",
          summary: "예약 목록을 조회해야 한다.",
          briefEvidenceIds: [evidence.id],
          figmaEvidenceIds: [],
          openApiEvidenceIds: [],
          gapIds: [],
          tags: [],
        },
      ],
      artifactIds: [],
    };

    const matrixBlob = await artifactStore.writeBlob({
      content: Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      storedAt: now,
      label: "traceability-matrix",
    });

    const matrixArtifact = ArtifactRefSchema.parse({
      id: createArtifactId(),
      kind: "traceability-matrix",
      uri: matrixBlob.uri,
      mediaType: "application/json",
      digest: matrixBlob.digest,
      producedBy: "orchestrator",
      evidenceIds: [evidence.id],
      createdAt: now,
      metadata: {},
    });

    await store.create({
      ...run,
      evidence: [evidence],
      artifacts: [matrixArtifact],
    });

    const result = await service.generateOpenSpecChange({
      runId: run.id,
      traceabilityArtifactId: matrixArtifact.id,
      changeName: "deliver-reservation-management",
    });

    expect(result.duplicate).toBe(false);
    expect(result.changedFiles).toContain(
      "openspec/changes/deliver-reservation-management/proposal.md",
    );
    expect(result.changedFiles).toContain(
      "openspec/changes/deliver-reservation-management/specs/reservation-management/spec.md",
    );
  });
});
