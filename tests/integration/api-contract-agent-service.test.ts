import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiContractAgentService } from "../../src/application/api-contract-agent-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { RUNTIME_CONTRACT_VERSION } from "../../src/runtime/constants.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let store: SqliteRunStore;
let service: ApiContractAgentService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-api-agent-service-"));
  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  service = new ApiContractAgentService(store, directory, () => "2026-06-23T00:00:00.000Z");
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("ApiContractAgentService", () => {
  it("prepares context and records a valid result", async () => {
    const run = createInitialRun(
      {
        sources: [],
        baseCommit: "abcdef1",
      },
      {
        id: "run_11111111111111111111111111111111",
        pluginVersion: "0.1.0",
        projectRoot: "/repo",
        now: "2026-06-23T00:00:00.000Z",
      },
    );

    await store.create(run);

    const prepared = await service.prepare({
      runId: run.id,
      worktreePath: "/worktree/api",
      baseSha: "abcdef1",
    });

    expect(prepared.contextArtifactId).toMatch(/^art_/);

    const loadedContext = await service.getContext({
      runId: run.id,
      contextArtifactId: prepared.contextArtifactId,
    });

    expect(loadedContext.contextPackPath).toContain("api-contract");

    const recorded = await service.recordResult({
      runId: run.id,
      contextArtifactId: prepared.contextArtifactId,
      result: {
        schemaVersion: RUNTIME_CONTRACT_VERSION,
        id: "ar_11111111111111111111111111111111",
        runId: run.id,
        kind: "implementation",
        agent: "api-contract",
        status: "passed",
        baseSha: "abcdef1",
        commitSha: "1234567",
        changedFiles: ["src/features/reservation/api/fetch-reservations.ts"],
        evidenceIds: [],
        artifactIds: [],
        gapIds: [],
        checks: [],
        decisions: [],
        startedAt: "2026-06-23T00:00:00.000Z",
        completedAt: "2026-06-23T00:00:01.000Z",
      },
    });

    expect(recorded.status).toBe("passed");

    const loaded = await store.get(run.id);
    expect(loaded.agentResults).toHaveLength(1);
    expect(loaded.agentResults[0]?.agent).toBe("api-contract");
  });
});
