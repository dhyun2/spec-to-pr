import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { OpenSpecArchiveService } from "../../src/application/openspec-archive-service.js";
import { createInitialRun, RunManifestSchema } from "../../src/run/index.js";
import { ArtifactRefSchema } from "../../src/runtime/artifact.js";
import { createArtifactId } from "../../src/runtime/id-factory.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let dataRoot: string;
let store: SqliteRunStore;
let artifactStore: ArtifactBlobStore;
let service: OpenSpecArchiveService;
let originalGithubToken: string | undefined;
let originalGhToken: string | undefined;
let originalGitlabToken: string | undefined;
let originalGitlabPrivateToken: string | undefined;

beforeEach(async () => {
  originalGithubToken = process.env.GITHUB_TOKEN;
  originalGhToken = process.env.GH_TOKEN;
  originalGitlabToken = process.env.GITLAB_TOKEN;
  originalGitlabPrivateToken = process.env.GITLAB_PRIVATE_TOKEN;
  process.env.GITHUB_TOKEN = "";
  process.env.GH_TOKEN = "";
  process.env.GITLAB_TOKEN = "";
  process.env.GITLAB_PRIVATE_TOKEN = "";

  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-archive-service-"));
  projectRoot = path.join(directory, "project");
  dataRoot = path.join(directory, "data");

  await mkdir(projectRoot, {
    recursive: true,
  });

  store = new SqliteRunStore(path.join(dataRoot, "runs.sqlite3"));
  artifactStore = new ArtifactBlobStore(path.join(dataRoot, "artifacts"));

  service = new OpenSpecArchiveService(
    store,
    artifactStore,
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
  restoreEnv("GITHUB_TOKEN", originalGithubToken);
  restoreEnv("GH_TOKEN", originalGhToken);
  restoreEnv("GITLAB_TOKEN", originalGitlabToken);
  restoreEnv("GITLAB_PRIVATE_TOKEN", originalGitlabPrivateToken);
});

describe("OpenSpecArchiveService", () => {
  it("records attestation, plans ready, runs archive, and loads report", async () => {
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
    await writeFile(path.join(changeRoot, "tasks.md"), "# Tasks\n");

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
    await addPublishResult(run.id);

    const resolved = await service.resolveTarget({});

    expect(resolved).toMatchObject({
      resolved: true,
      runId: run.id,
      changeName: "deliver-reservation-management",
      reviewRequestUrl: "https://github.com/acme/spec-to-pr/pull/123",
      source: "latest-published-run",
    });

    const attestation = await service.recordUserMergeAttestation({
      runId: run.id,
      changeName: "deliver-reservation-management",
      reviewRequestUrl: "https://github.com/acme/spec-to-pr/pull/123",
      statement: "The GitHub pull request has been merged.",
      attestedBy: "user",
    });

    expect(attestation.type).toBe("user-attested-merge");

    const plan = await service.plan({
      runId: run.id,
      changeName: "deliver-reservation-management",
    });

    expect(plan).toMatchObject({
      status: "ready",
      executeAllowed: true,
      polling: false,
      changeName: "deliver-reservation-management",
    });

    const executed = await service.runArchive({
      runId: run.id,
      changeName: "deliver-reservation-management",
      mergeEvidenceId: attestation.mergeEvidenceId,
      yes: true,
    });

    expect(executed.status).toBe("passed");
    expect(executed.stdoutArtifactId).toMatch(/^art_/);
    expect(executed.reportArtifactId).toMatch(/^art_/);

    const loadedResult = await service.getReport({
      runId: run.id,
      archiveResultId: executed.archiveResultId,
    });

    expect(loadedResult.status).toBe("passed");
    expect(loadedResult.reportArtifactId).toBe(executed.reportArtifactId);
  });

  it("records a one-shot remote status check as unknown when no token is configured", async () => {
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

    const checked = await service.checkReviewRequestStatusOnce({
      runId: run.id,
      provider: "github",
      reviewRequestUrl: "https://github.com/acme/spec-to-pr/pull/123",
    });

    expect(checked.status).toBe("unknown");
    expect(checked.evidence.kind).toBe("remote-checked");
    expect(checked.evidence.metadata["polling"]).toBe(false);
  });
});

async function addPublishResult(
  runId: string,
  url = "https://github.com/acme/spec-to-pr/pull/123",
): Promise<void> {
  const run = await store.get(runId);
  const publishedAt = "2026-06-23T00:00:00.000Z";
  const result = {
    runId,
    status: "passed",
    target: {
      host: "github",
      webBaseUrl: "https://github.com",
      apiBaseUrl: "https://api.github.com",
      owner: "acme",
      repo: "spec-to-pr",
    },
    request: {
      host: "github",
      url,
      number: "123",
      draft: false,
      sourceBranch: "spec-to-pr/run-1",
      targetBranch: "main",
      created: true,
      updated: false,
    },
    retryable: false,
    publishedAt,
  };
  const blob = await artifactStore.writeBlob({
    content: Buffer.from(`${JSON.stringify(result, null, 2)}\n`, "utf8"),
    mediaType: "application/json",
    storedAt: publishedAt,
    label: "publish-result",
  });
  const artifact = ArtifactRefSchema.parse({
    id: createArtifactId(),
    kind: "agent-result-report",
    uri: blob.uri,
    mediaType: "application/json",
    digest: blob.digest,
    producedBy: "pr-publisher",
    evidenceIds: [],
    createdAt: publishedAt,
    metadata: {
      adapter: "publisher-v1",
      label: "publish-result",
      reportKind: "publish-result",
      status: "passed",
      host: "github",
      requestUrl: url,
    },
  });
  const nextRun = RunManifestSchema.parse({
    ...run,
    revision: run.revision + 1,
    updatedAt: publishedAt,
    artifacts: [...run.artifacts, artifact],
  });

  await store.save(nextRun, run.revision);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
