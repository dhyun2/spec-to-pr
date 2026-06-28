import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { OpenSpecArchiveService } from "../../src/application/openspec-archive-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let dataRoot: string;
let store: SqliteRunStore;
let service: OpenSpecArchiveService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-archive-service-"));
  projectRoot = path.join(directory, "project");
  dataRoot = path.join(directory, "data");

  await mkdir(projectRoot, {
    recursive: true,
  });

  store = new SqliteRunStore(path.join(dataRoot, "runs.sqlite3"));

  service = new OpenSpecArchiveService(
    store,
    new ArtifactBlobStore(path.join(dataRoot, "artifacts")),
    () => "2026-06-23T00:00:00.000Z",
    async () => ({
      stdout: "archived\n",
      stderr: "",
      exitCode: 0,
    }),
  );
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("OpenSpecArchiveService", () => {
  it("records merge status plan blocked execution result and archive review", async () => {
    const run = createInitialRun(
      { sources: [] },
      {
        id: "run_11111111111111111111111111111111",
        pluginVersion: "0.1.0",
        projectRoot,
        now: "2026-06-23T00:00:00.000Z",
      },
    );

    await store.create(run);

    const verified = await service.verifyMerged({
      runId: run.id,
      review: {
        provider: "github",
        reviewRequestUrl: "https://github.com/acme/spec-to-pr/pull/123",
        number: "123",
        merged: false,
        raw: {},
      },
    });

    expect(verified.verification.verified).toBe(false);

    const plan = await service.plan({
      runId: run.id,
      changeName: "deliver-reservation-management",
      mergeStatusArtifactId: verified.artifactId,
    });

    expect(plan.plan.canExecute).toBe(false);

    const executed = await service.execute({
      runId: run.id,
      changeName: "deliver-reservation-management",
      mergeStatusArtifactId: verified.artifactId,
    });

    expect(executed.result.status).toBe("blocked");
    expect(executed.reportArtifactId).toMatch(/^art_/);

    const loadedResult = await service.getResult({
      runId: run.id,
      artifactId: executed.resultArtifactId,
    });

    expect(loadedResult.result.status).toBe("blocked");

    const review = await service.recordReview({
      runId: run.id,
      archiveResultArtifactId: executed.resultArtifactId,
      review: {
        status: "passed",
        findings: [],
      },
    });

    expect(review.findingCount).toBe(0);
  });

  it("executes with a fake command runner after merge preconditions pass", async () => {
    const changeRoot = path.join(
      projectRoot,
      "openspec",
      "changes",
      "deliver-reservation-management",
    );

    await mkdir(path.join(changeRoot, "specs", "reservation-management"), {
      recursive: true,
    });
    await writeFile(path.join(changeRoot, "proposal.md"), "# Proposal\n");
    await writeFile(path.join(changeRoot, "design.md"), "# Design\n");
    await writeFile(path.join(changeRoot, "tasks.md"), "# Tasks\n");

    const run = createInitialRun(
      { sources: [] },
      {
        id: "run_22222222222222222222222222222222",
        pluginVersion: "0.1.0",
        projectRoot,
        now: "2026-06-23T00:00:00.000Z",
      },
    );

    await store.create(run);

    const executed = await service.execute({
      runId: run.id,
      changeName: "deliver-reservation-management",
      review: {
        provider: "github",
        reviewRequestUrl: "https://github.com/acme/spec-to-pr/pull/123",
        number: "123",
        merged: true,
        mergedAt: "2026-06-23T00:00:00.000Z",
        mergedCommitSha: "abcdef1",
        raw: {},
      },
    });

    expect(executed.result.status).toBe("passed");
    expect(executed.result.stdoutArtifactId).toMatch(/^art_/);
    expect(executed.artifactIds).toContain(executed.resultArtifactId);
  });
});
