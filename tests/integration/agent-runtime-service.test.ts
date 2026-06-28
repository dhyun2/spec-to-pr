import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentRuntimeService } from "../../src/application/agent-runtime-service.js";
import { RunService } from "../../src/application/run-service.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

const execFileAsync = promisify(execFile);

let directory: string;
let projectRoot: string;
let dataRoot: string;
let store: SqliteRunStore;
let runService: RunService;
let agentRuntimeService: AgentRuntimeService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-agent-runtime-"));
  projectRoot = path.join(directory, "project");
  dataRoot = path.join(directory, "data");
  await mkdir(projectRoot, { recursive: true });
  await initializeGitRepository(projectRoot);

  store = new SqliteRunStore(path.join(dataRoot, "runs.sqlite3"));
  runService = new RunService(store, {
    pluginVersion: "0.1.0",
    now: () => "2026-06-28T00:00:00.000Z",
  });
  agentRuntimeService = new AgentRuntimeService(
    store,
    undefined,
    () => "2026-06-28T00:00:01.000Z",
  );
});

afterEach(async () => {
  await store.close();
  await rm(directory, { recursive: true, force: true });
});

describe("AgentRuntimeService", () => {
  it("prepares worktrees, context packs, and a Run report artifact", async () => {
    const run = await runService.createRun({ projectRoot });
    const result = await agentRuntimeService.prepare({
      runId: run.id,
      agents: ["spec-bdd"],
    });

    expect(result.runId).toBe(run.id);
    expect(result.worktrees).toHaveLength(1);
    expect(result.worktrees[0]?.agent).toBe("spec-bdd");

    const contextPack = await agentRuntimeService.getContextPack({
      runId: run.id,
      agent: "spec-bdd",
    });

    expect(contextPack.pack.agent.agent).toBe("spec-bdd");
    expect(contextPack.markdown).toContain("# Spec/BDD Agent Context Pack");
    await expect(readFile(contextPack.jsonPath, "utf8")).resolves.toContain(run.id);

    const listed = await agentRuntimeService.listWorktrees({ runId: run.id });

    expect(listed.worktrees.map((item) => path.resolve(item.path))).toContain(
      path.resolve(result.worktrees[0]!.worktreePath),
    );

    const loaded = await store.get(run.id);
    const reportArtifact = loaded.artifacts.find(
      (artifact) => artifact.metadata["adapter"] === "agent-runtime-v1",
    );

    expect(reportArtifact?.kind).toBe("log");
    expect(loaded.revision).toBe(1);

    const cleanup = await agentRuntimeService.cleanupWorktree({
      runId: run.id,
      agent: "spec-bdd",
    });

    expect(cleanup.removed).toBe(true);
  });
});

async function initializeGitRepository(cwd: string): Promise<void> {
  await runGit(cwd, ["init"]);
  await runGit(cwd, ["config", "user.email", "test@example.com"]);
  await runGit(cwd, ["config", "user.name", "Spec To PR Test"]);
  await writeFile(path.join(cwd, "README.md"), "# Test Project\n");
  await runGit(cwd, ["add", "README.md"]);
  await runGit(cwd, ["commit", "-m", "initial"]);
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    timeout: 15_000,
  });
}
