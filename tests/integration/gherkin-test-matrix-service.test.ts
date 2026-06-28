import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GherkinTestMatrixService } from "../../src/application/gherkin-test-matrix-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let store: SqliteRunStore;
let service: GherkinTestMatrixService;

const now = "2026-06-23T00:00:00.000Z";
const runId = "run_11111111111111111111111111111111";
const sourceId = "src_11111111111111111111111111111111";
const evidenceId = "ev_11111111111111111111111111111111";
const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const changeName = "deliver-reservation-management";

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-gherkin-"));
  projectRoot = path.join(directory, "project");

  await mkdir(projectRoot, { recursive: true });

  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  service = new GherkinTestMatrixService(store, () => now);
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("GherkinTestMatrixService", () => {
  it("writes feature files and matrix artifacts", async () => {
    const run = createInitialRun(
      { sources: [] },
      {
        id: runId,
        pluginVersion: "0.1.0",
        projectRoot,
        now,
      },
    );

    await store.create({
      ...run,
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
      evidence: [
        {
          id: evidenceId,
          sourceId,
          location: {
            type: "file-lines",
            path: "docs/brief.md",
            startLine: 1,
            endLine: 1,
          },
          summary: "예약 목록 조회 요구사항",
          digest,
          capturedAt: now,
          metadata: {},
        },
      ],
    });

    const changeRoot = path.join(projectRoot, "openspec", "changes", changeName);

    await mkdir(path.join(changeRoot, "artifacts"), {
      recursive: true,
    });

    await writeFile(
      path.join(changeRoot, "artifacts", "change-manifest.json"),
      `${JSON.stringify(
        {
          runId: run.id,
          changeName,
          title: "Deliver Reservation Management",
          summary: "Reservation change",
          generatedAt: now,
          sourceArtifactIds: [],
          specAreas: ["reservation-management"],
          gapIds: [],
          requirements: [
            {
              id: "REQ-001",
              area: "reservation-management",
              title: "예약 목록 조회",
              summary: "예약 목록을 조회해야 한다.",
              status: "ready",
              briefEvidenceIds: [evidenceId],
              figmaEvidenceIds: [],
              openApiEvidenceIds: [],
              gapIds: [],
              tags: [],
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const result = await service.generate({
      runId: run.id,
      changeName,
    });

    expect(result.duplicate).toBe(false);
    expect(result.scenarioCount).toBe(1);
    expect(result.changedFiles).toContain(
      "openspec/changes/deliver-reservation-management/artifacts/test-matrix.json",
    );

    const loaded = await store.get(run.id);

    expect(loaded.artifacts.some((artifact) => artifact.kind === "gherkin")).toBe(true);
    expect(loaded.artifacts.some((artifact) => artifact.kind === "test-matrix")).toBe(true);
  });
});
