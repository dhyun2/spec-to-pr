import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GitWorktreeManager } from "../../src/agent-runtime/worktree-manager.js";

const execFileAsync = promisify(execFile);
const runId = "run_22222222222222222222222222222222";

let directory: string;
let projectRoot: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-worktree-"));
  projectRoot = path.join(directory, "project");
  await mkdir(projectRoot, { recursive: true });
  await initializeGitRepository(projectRoot);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("GitWorktreeManager", () => {
  it("creates lists and removes isolated worktrees", async () => {
    const manager = new GitWorktreeManager();
    const worktree = await manager.createAgentWorktree({
      runId,
      agent: "spec-bdd",
      projectRoot,
    });

    expect(worktree.branchName).toBe("spec-to-pr/222222222222/spec-bdd");
    await expect(stat(path.join(worktree.worktreePath, "README.md"))).resolves.toBeDefined();

    const listed = await manager.listWorktrees(projectRoot);

    expect(listed.map((item) => path.resolve(item.path))).toContain(
      path.resolve(worktree.worktreePath),
    );

    await manager.removeWorktree(projectRoot, worktree.worktreePath);

    const afterRemoval = await manager.listWorktrees(projectRoot);

    expect(afterRemoval.map((item) => path.resolve(item.path))).not.toContain(
      path.resolve(worktree.worktreePath),
    );
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
