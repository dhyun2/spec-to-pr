import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { RunManifest } from "../run/index.js";
import { GitObjectIdSchema } from "../runtime/scalars.js";
import type { GitCommandRunner } from "./git-integration-runner.js";

export type IntegrationWorktreeInfo = {
  branch: string;
  path: string;
  baseCommit: string;
};

export function integrationBranchName(runId: string): string {
  const shortRunId = runId.replace(/^run_/, "").slice(0, 12);
  return `spec-to-pr/${shortRunId}/integration`;
}

export function integrationWorktreePath(input: { projectRoot: string; runId: string }): string {
  return path.join(input.projectRoot, ".spec-to-pr", "worktrees", input.runId, "integration");
}

export class IntegrationWorktreeManager {
  public constructor(private readonly git: GitCommandRunner) {}

  public async ensureIntegrationWorktree(run: RunManifest): Promise<IntegrationWorktreeInfo> {
    const branch = integrationBranchName(run.id);
    const worktreePath = integrationWorktreePath({
      projectRoot: run.projectRoot,
      runId: run.id,
    });
    const baseCommit = GitObjectIdSchema.parse(
      run.baseCommit ?? (await this.currentHead(run.projectRoot)),
    );

    await mkdir(path.dirname(worktreePath), {
      recursive: true,
      mode: 0o700,
    });
    await this.git.exec({
      cwd: run.projectRoot,
      args: ["worktree", "add", "-B", branch, worktreePath, baseCommit],
      allowFailure: false,
    });

    return {
      branch,
      path: worktreePath,
      baseCommit,
    };
  }

  private async currentHead(projectRoot: string): Promise<string> {
    const result = await this.git.exec({
      cwd: projectRoot,
      args: ["rev-parse", "HEAD"],
    });

    return result.stdout.trim();
  }
}
