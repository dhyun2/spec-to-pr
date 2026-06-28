import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DesignUiAgentLaneService } from "../../src/application/design-ui-agent-lane-service.js";
import { createInitialRun, RunManifestSchema } from "../../src/run/index.js";
import { RUNTIME_CONTRACT_VERSION } from "../../src/runtime/constants.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let store: SqliteRunStore;
let service: DesignUiAgentLaneService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-design-ui-service-"));
  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  service = new DesignUiAgentLaneService(store, directory, () => "2026-06-23T00:00:00.000Z");
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("DesignUiAgentLaneService", () => {
  it("prepares context and records design-ui result", async () => {
    const run = buildRun();
    await store.create(run);

    const prepared = await service.prepare({
      runId: run.id,
      changeName: "deliver-reservation-management",
      worktreePath: path.join(directory, "worktree"),
      contextRoot: path.join(directory, "context"),
      designContractArtifactId: "art_11111111111111111111111111111111",
    });

    expect(prepared.context.agent).toBe("design-ui");

    const context = await service.getContext({
      runId: run.id,
      contextArtifactId: prepared.contextArtifactId,
    });

    expect(context.changeName).toBe("deliver-reservation-management");

    const recorded = await service.recordResult({
      runId: run.id,
      contextArtifactId: prepared.contextArtifactId,
      result: {
        schemaVersion: RUNTIME_CONTRACT_VERSION,
        id: "ar_11111111111111111111111111111111",
        runId: run.id,
        kind: "implementation",
        agent: "design-ui",
        status: "passed",
        baseSha: "abcdef1",
        commitSha: "1234567",
        changedFiles: ["src/features/reservation/ui/reservation-list.tsx"],
        evidenceIds: [],
        artifactIds: [],
        gapIds: [],
        checks: [],
        decisions: [],
        startedAt: "2026-06-23T00:00:00.000Z",
        completedAt: "2026-06-23T00:00:01.000Z",
      },
    });

    expect(recorded.result.agent).toBe("design-ui");
    expect(recorded.run.agentResultCount).toBe(1);
  });

  it("rejects forbidden changed files", async () => {
    const run = buildRun();
    await store.create(run);

    const prepared = await service.prepare({
      runId: run.id,
      changeName: "deliver-reservation-management",
      worktreePath: path.join(directory, "worktree"),
      contextRoot: path.join(directory, "context"),
      designContractArtifactId: "art_11111111111111111111111111111111",
    });

    await expect(
      service.recordResult({
        runId: run.id,
        contextArtifactId: prepared.contextArtifactId,
        result: {
          schemaVersion: RUNTIME_CONTRACT_VERSION,
          id: "ar_11111111111111111111111111111111",
          runId: run.id,
          kind: "implementation",
          agent: "design-ui",
          status: "passed",
          baseSha: "abcdef1",
          commitSha: "1234567",
          changedFiles: ["src/shared/api/generated/staff/client.ts"],
          evidenceIds: [],
          artifactIds: [],
          gapIds: [],
          checks: [],
          decisions: [],
          startedAt: "2026-06-23T00:00:00.000Z",
          completedAt: "2026-06-23T00:00:01.000Z",
        },
      }),
    ).rejects.toThrow(/forbidden file/);
  });
});

function buildRun() {
  const run = createInitialRun(
    {
      sources: [],
      baseCommit: "abcdef1",
    },
    {
      id: "run_11111111111111111111111111111111",
      pluginVersion: "0.1.0",
      projectRoot: path.join(directory, "project"),
      now: "2026-06-23T00:00:00.000Z",
    },
  );

  return RunManifestSchema.parse({
    ...run,
    artifacts: [
      {
        id: "art_11111111111111111111111111111111",
        kind: "figma-design-contract",
        uri: "artifact://design-contract",
        mediaType: "application/json",
        digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        producedBy: "orchestrator",
        evidenceIds: [],
        createdAt: "2026-06-23T00:00:00.000Z",
      },
    ],
  });
}
