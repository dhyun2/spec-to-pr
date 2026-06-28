import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { IntegrationService } from "../../src/application/integration-service.js";
import { createInitialRun, RunManifestSchema } from "../../src/run/index.js";
import { RUNTIME_CONTRACT_VERSION } from "../../src/runtime/index.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

const execFileAsync = promisify(execFile);

let directory: string;
let store: SqliteRunStore;
let service: IntegrationService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-integration-service-"));
  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  service = new IntegrationService(
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

describe("IntegrationService", () => {
  it("prepares, applies, and finalizes approved agent commits", async () => {
    const repo = await createRepo();
    const baseSha = await git(repo, ["rev-parse", "HEAD"]);
    const apiCommit = await createAgentCommit(
      repo,
      "api-agent",
      "src/api.ts",
      "export const api = true;\n",
    );
    const uiCommit = await createAgentCommit(
      repo,
      "ui-agent",
      "src/ui.tsx",
      "export const ui = true;\n",
    );
    const run = buildRun({
      projectRoot: repo,
      baseSha,
      apiCommit,
      uiCommit,
    });

    await store.create(run);

    const prepared = await service.prepareIntegration({
      runId: run.id,
      approvedAgentResultIds: [
        "ar_11111111111111111111111111111111",
        "ar_22222222222222222222222222222222",
      ],
    });

    expect(prepared.plan.candidates.map((candidate) => candidate.agent)).toEqual([
      "api-contract",
      "design-ui",
    ]);

    const loadedPlan = await service.getIntegrationPlan({
      runId: run.id,
      planArtifactId: prepared.planArtifactId,
    });

    expect(loadedPlan.plan.integrationBranch).toBe(prepared.plan.integrationBranch);

    const applied = await service.applyIntegration({
      runId: run.id,
      planArtifactId: prepared.planArtifactId,
    });

    expect(applied.result.status).toBe("passed");

    const finalized = await service.finalizeIntegration({
      runId: run.id,
      resultArtifactId: applied.resultArtifactId,
    });

    expect(finalized.result.status).toBe("passed");

    const loaded = await store.get(run.id);

    expect(loaded.agentResults.some((result) => result.agent === "integrator")).toBe(true);
  });
});

async function createRepo(): Promise<string> {
  const repo = path.join(directory, "repo");

  await mkdir(repo);
  await git(repo, ["init"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "user.name", "Test User"]);
  await writeFile(path.join(repo, "README.md"), "base\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "base"]);
  await git(repo, ["branch", "-M", "main"]);

  return repo;
}

async function createAgentCommit(
  repo: string,
  branch: string,
  filePath: string,
  content: string,
): Promise<string> {
  await git(repo, ["checkout", "-b", branch, "main"]);
  await mkdir(path.dirname(path.join(repo, filePath)), {
    recursive: true,
  });
  await writeFile(path.join(repo, filePath), content);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", branch]);
  const commitSha = await git(repo, ["rev-parse", "HEAD"]);
  await git(repo, ["checkout", "main"]);

  return commitSha;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
  });

  return stdout.trim();
}

function buildRun(input: {
  projectRoot: string;
  baseSha: string;
  apiCommit: string;
  uiCommit: string;
}) {
  return RunManifestSchema.parse({
    ...createInitialRun(
      { sources: [], baseCommit: input.baseSha },
      {
        id: "run_11111111111111111111111111111111",
        pluginVersion: "0.1.0",
        projectRoot: input.projectRoot,
        now: "2026-06-23T00:00:00.000Z",
      },
    ),
    artifacts: [
      {
        id: "art_11111111111111111111111111111111",
        kind: "log",
        uri: "artifact://review-council-report",
        mediaType: "text/markdown",
        digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        producedBy: "review-council",
        evidenceIds: [],
        createdAt: "2026-06-23T00:00:00.000Z",
      },
    ],
    agentResults: [
      {
        schemaVersion: RUNTIME_CONTRACT_VERSION,
        id: "ar_99999999999999999999999999999999",
        runId: "run_11111111111111111111111111111111",
        kind: "verification",
        agent: "review-council",
        status: "passed",
        baseSha: input.baseSha,
        changedFiles: [],
        evidenceIds: [],
        artifactIds: ["art_11111111111111111111111111111111"],
        gapIds: [],
        checks: [],
        decisions: [],
        startedAt: "2026-06-23T00:00:00.000Z",
        completedAt: "2026-06-23T00:00:01.000Z",
      },
      {
        schemaVersion: RUNTIME_CONTRACT_VERSION,
        id: "ar_11111111111111111111111111111111",
        runId: "run_11111111111111111111111111111111",
        kind: "implementation",
        agent: "api-contract",
        status: "passed",
        baseSha: input.baseSha,
        commitSha: input.apiCommit,
        changedFiles: ["src/api.ts"],
        evidenceIds: [],
        artifactIds: [],
        gapIds: [],
        checks: [],
        decisions: [],
        startedAt: "2026-06-23T00:00:00.000Z",
        completedAt: "2026-06-23T00:00:01.000Z",
      },
      {
        schemaVersion: RUNTIME_CONTRACT_VERSION,
        id: "ar_22222222222222222222222222222222",
        runId: "run_11111111111111111111111111111111",
        kind: "implementation",
        agent: "design-ui",
        status: "passed",
        baseSha: input.baseSha,
        commitSha: input.uiCommit,
        changedFiles: ["src/ui.tsx"],
        evidenceIds: [],
        artifactIds: [],
        gapIds: [],
        checks: [],
        decisions: [],
        startedAt: "2026-06-23T00:00:00.000Z",
        completedAt: "2026-06-23T00:00:01.000Z",
      },
    ],
  });
}
