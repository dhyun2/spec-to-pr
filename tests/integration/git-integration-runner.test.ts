import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CherryPickIntegrationRunner } from "../../src/integration/cherry-pick-runner.js";
import { GitCommandRunner } from "../../src/integration/git-integration-runner.js";

const execFileAsync = promisify(execFile);

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-git-integration-"));
});

afterEach(async () => {
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("CherryPickIntegrationRunner", () => {
  it("applies a candidate commit into an integration worktree", async () => {
    const repo = await createRepo();
    const baseSha = await git(repo, ["rev-parse", "HEAD"]);

    await git(repo, ["checkout", "-b", "api-agent"]);
    await mkdir(path.join(repo, "src"), { recursive: true });
    await writeFile(path.join(repo, "src", "api.ts"), "export const api = true;\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "api agent"]);
    const commitSha = await git(repo, ["rev-parse", "HEAD"]);
    await git(repo, ["checkout", "main"]);

    const worktreePath = path.join(directory, "integration");
    await git(repo, ["worktree", "add", "-B", "integration", worktreePath, baseSha]);

    const result = await new CherryPickIntegrationRunner(new GitCommandRunner()).applyCandidate({
      runId: "run_11111111111111111111111111111111",
      worktreePath,
      candidate: {
        agentResultId: "ar_11111111111111111111111111111111",
        agent: "api-contract",
        commitSha,
        baseSha,
        order: 1,
        approvedByReviewCouncil: true,
        changedFiles: ["src/api.ts"],
      },
      now: "2026-06-23T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    await expect(readFile(path.join(worktreePath, "src", "api.ts"), "utf8")).resolves.toContain(
      "api",
    );
  });

  it("returns a conflict report when cherry-pick fails", async () => {
    const repo = await createRepo();
    const baseSha = await git(repo, ["rev-parse", "HEAD"]);

    await writeFile(path.join(repo, "README.md"), "main change\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "main change"]);
    const mainSha = await git(repo, ["rev-parse", "HEAD"]);
    await git(repo, ["checkout", "-b", "api-agent", baseSha]);
    await writeFile(path.join(repo, "README.md"), "api change\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "api change"]);
    const commitSha = await git(repo, ["rev-parse", "HEAD"]);
    await git(repo, ["checkout", "main"]);

    const worktreePath = path.join(directory, "integration-conflict");
    await git(repo, ["worktree", "add", "-B", "integration-conflict", worktreePath, mainSha]);

    const result = await new CherryPickIntegrationRunner(new GitCommandRunner()).applyCandidate({
      runId: "run_11111111111111111111111111111111",
      worktreePath,
      candidate: {
        agentResultId: "ar_11111111111111111111111111111111",
        agent: "api-contract",
        commitSha,
        baseSha,
        order: 1,
        approvedByReviewCouncil: true,
        changedFiles: ["README.md"],
      },
      now: "2026-06-23T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflictReport.conflictedFiles[0]).toMatchObject({
        path: "README.md",
        conflictMarkersDetected: true,
      });
    }
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

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
  });

  return stdout.trim();
}
