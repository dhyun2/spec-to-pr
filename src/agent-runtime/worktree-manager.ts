import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { RunIdSchema, type RunId } from "../runtime/ids.js";
import { GitObjectIdSchema } from "../runtime/scalars.js";
import { RuntimeAgentKindSchema, type RuntimeAgentKind } from "./agent-descriptor.js";
import { runCommand } from "./command-runner.js";

export const AgentWorktreeSchema = z
  .object({
    runId: RunIdSchema,
    agent: RuntimeAgentKindSchema,
    projectRoot: z.string().trim().min(1),
    worktreePath: z.string().trim().min(1),
    branchName: z.string().trim().min(1),
    baseCommit: GitObjectIdSchema,
  })
  .strict();

export type AgentWorktree = z.infer<typeof AgentWorktreeSchema>;

export type CreateAgentWorktreeInput = {
  runId: RunId;
  agent: RuntimeAgentKind;
  projectRoot: string;
  baseCommit?: string;
};

export class GitWorktreeManager {
  public async createAgentWorktree(input: CreateAgentWorktreeInput): Promise<AgentWorktree> {
    const projectRoot = await realpath(input.projectRoot);
    await this.assertGitRepository(projectRoot);
    const baseCommit = GitObjectIdSchema.parse(
      input.baseCommit ?? (await this.currentHead(projectRoot)),
    );
    const branchName = branchNameFor(input.runId, input.agent);
    const worktreePath = worktreePathFor(projectRoot, input.runId, input.agent);

    await mkdir(path.dirname(worktreePath), { recursive: true });
    await runCommand({
      cwd: projectRoot,
      command: "git",
      args: ["worktree", "add", "-B", branchName, worktreePath, baseCommit],
      timeoutMs: 30_000,
    });

    return AgentWorktreeSchema.parse({
      runId: input.runId,
      agent: input.agent,
      projectRoot,
      worktreePath,
      branchName,
      baseCommit,
    });
  }

  public async listWorktrees(projectRoot: string): Promise<
    Array<{
      path: string;
      head?: string;
      branch?: string;
    }>
  > {
    await this.assertGitRepository(projectRoot);
    const output = await runCommand({
      cwd: projectRoot,
      command: "git",
      args: ["worktree", "list", "--porcelain"],
    });

    return parseWorktreeList(output.stdout);
  }

  public async removeWorktree(projectRoot: string, worktreePath: string): Promise<void> {
    await this.assertGitRepository(projectRoot);
    await runCommand({
      cwd: projectRoot,
      command: "git",
      args: ["worktree", "remove", worktreePath],
      timeoutMs: 30_000,
    });
    await this.prune(projectRoot);
  }

  public async prune(projectRoot: string): Promise<void> {
    await runCommand({
      cwd: projectRoot,
      command: "git",
      args: ["worktree", "prune"],
    });
  }

  public async currentHead(projectRoot: string): Promise<string> {
    const output = await runCommand({
      cwd: projectRoot,
      command: "git",
      args: ["rev-parse", "HEAD"],
    });

    return output.stdout.trim();
  }

  private async assertGitRepository(projectRoot: string): Promise<void> {
    const output = await runCommand({
      cwd: projectRoot,
      command: "git",
      args: ["rev-parse", "--is-inside-work-tree"],
    });

    if (output.stdout.trim() !== "true") {
      throw new Error(`Not a git work tree: ${projectRoot}`);
    }
  }
}

export function worktreePathFor(
  projectRoot: string,
  runId: RunId,
  agent: RuntimeAgentKind,
): string {
  return path.join(projectRoot, ".spec-to-pr", "worktrees", runId, agent);
}

export function branchNameFor(runId: RunId, agent: RuntimeAgentKind): string {
  const shortRunId = runId.replace(/^run_/, "").slice(0, 12);
  return `spec-to-pr/${shortRunId}/${agent}`;
}

function parseWorktreeList(
  stdout: string,
): Array<{ path: string; head?: string; branch?: string }> {
  const worktrees: Array<{ path: string; head?: string; branch?: string }> = [];
  let current: { path?: string; head?: string; branch?: string } = {};

  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) {
      if (current.path !== undefined) {
        worktrees.push({
          path: current.path,
          ...(current.head === undefined ? {} : { head: current.head }),
          ...(current.branch === undefined ? {} : { branch: current.branch }),
        });
      }
      current = {};
      continue;
    }

    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");

    if (key === "worktree") {
      current.path = value;
    } else if (key === "HEAD") {
      current.head = value;
    } else if (key === "branch") {
      current.branch = value;
    }
  }

  if (current.path !== undefined) {
    worktrees.push({
      path: current.path,
      ...(current.head === undefined ? {} : { head: current.head }),
      ...(current.branch === undefined ? {} : { branch: current.branch }),
    });
  }

  return worktrees;
}
