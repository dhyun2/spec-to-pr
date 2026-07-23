import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { detectPublishTargetFromRemote, normalizeGitRemoteUrl } from "../publisher/index.js";
import { GitObjectIdSchema } from "../runtime/scalars.js";

const execFileAsync = promisify(execFile);

const RepoRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .transform(normalizeRepoPath)
  .refine((value) => isRepoRelativePath(value), {
    message: "Workspace paths must stay within the repository",
  });

export const WorkspaceStartInputSchema = z
  .object({
    sourceBranch: z.string().trim().min(1).max(500),
    targetBranch: z.string().trim().min(1).max(500),
    targetPaths: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
    supportingPaths: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
    remoteName: z.string().trim().min(1).max(200).default("origin"),
  })
  .strict();

export const WorkspaceBindingSchema = z
  .object({
    repositoryRoot: z.string().trim().min(1),
    targetPaths: z.array(RepoRelativePathSchema).max(100),
    supportingPaths: z.array(RepoRelativePathSchema).max(100),
    sourceBranch: z.string().trim().min(1).max(500),
    targetBranch: z.string().trim().min(1).max(500),
    baseSha: GitObjectIdSchema,
    initialHeadSha: GitObjectIdSchema,
    remoteName: z.string().trim().min(1).max(200),
    remoteUrl: z.string().trim().min(1).max(4_000),
    remoteProvider: z.enum(["github", "gitlab"]),
    remoteHost: z.string().trim().min(1).max(500),
  })
  .strict();

export type WorkspaceStartInput = z.input<typeof WorkspaceStartInputSchema>;
export type WorkspaceBinding = z.infer<typeof WorkspaceBindingSchema>;

export async function resolveWorkspaceBinding(
  rawInput: WorkspaceStartInput & { requestedPath: string },
): Promise<WorkspaceBinding> {
  const { requestedPath: rawRequestedPath, ...rawWorkspace } = rawInput;
  const input = WorkspaceStartInputSchema.parse(rawWorkspace);
  const requestedPath = await realpath(rawRequestedPath);
  const repositoryRoot = await canonicalGitRoot(requestedPath);
  const currentBranch = await git(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (currentBranch !== input.sourceBranch) {
    throw workspaceError(
      "WORKSPACE_BRANCH_MISMATCH",
      `expected checked-out source branch ${input.sourceBranch}, found ${currentBranch || "detached HEAD"}`,
    );
  }
  if (!input.sourceBranch.startsWith("codex/") || input.sourceBranch === input.targetBranch) {
    throw workspaceError(
      "WORKSPACE_BRANCH_MISMATCH",
      "source branch must be a non-target codex/* branch",
    );
  }

  const status = await git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status !== "") {
    throw workspaceError(
      "WORKSPACE_ROOT_MISMATCH",
      "source worktree must be clean before workflow_start",
    );
  }

  const [initialHeadSha, baseSha] = await Promise.all([
    git(repositoryRoot, ["rev-parse", "--verify", "HEAD"]),
    git(repositoryRoot, ["rev-parse", "--verify", `${input.targetBranch}^{commit}`]),
  ]);
  if (initialHeadSha !== baseSha) {
    throw workspaceError(
      "WORKSPACE_TARGET_REF_MISMATCH",
      `source HEAD ${initialHeadSha} does not equal target ${input.targetBranch} at ${baseSha}`,
    );
  }

  const derivedTargetPath = normalizeRepoPath(path.relative(repositoryRoot, requestedPath));
  if (!isRepoRelativePath(derivedTargetPath)) {
    throw workspaceError(
      "WORKSPACE_TARGET_PATH_INVALID",
      `requested path escapes repository root: ${rawRequestedPath}`,
    );
  }
  const targetPaths = normalizeWorkspacePaths(
    input.targetPaths.length > 0
      ? input.targetPaths
      : derivedTargetPath === ""
        ? []
        : [derivedTargetPath],
  );
  const supportingPaths = normalizeWorkspacePaths(input.supportingPaths);
  const remoteUrl = await git(repositoryRoot, ["remote", "get-url", input.remoteName]);
  const target = detectPublishTargetFromRemote({ name: input.remoteName, url: remoteUrl });
  const remote = normalizeGitRemoteUrl(remoteUrl);

  return WorkspaceBindingSchema.parse({
    repositoryRoot,
    targetPaths,
    supportingPaths,
    sourceBranch: input.sourceBranch,
    targetBranch: input.targetBranch,
    baseSha,
    initialHeadSha,
    remoteName: input.remoteName,
    remoteUrl,
    remoteProvider: target.host,
    remoteHost: remote.host,
  });
}

export function assertChangedFilesWithinWorkspace(
  changedFiles: string[],
  binding: WorkspaceBinding | undefined,
): void {
  if (binding === undefined || binding.targetPaths.length === 0) return;
  const allowed = [...binding.targetPaths, ...binding.supportingPaths];
  const outside = changedFiles.filter(
    (filePath) => !allowed.some((root) => filePath === root || filePath.startsWith(`${root}/`)),
  );
  if (outside.length > 0) {
    throw workspaceError(
      "WORKSPACE_TARGET_PATH_INVALID",
      `changed files are outside the declared target paths: ${outside.join(", ")}`,
    );
  }
}

async function canonicalGitRoot(requestedPath: string): Promise<string> {
  try {
    const topLevel = await git(requestedPath, ["rev-parse", "--show-toplevel"]);
    return await realpath(topLevel);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw workspaceError("WORKSPACE_ROOT_MISMATCH", message);
  }
}

function normalizeWorkspacePaths(values: string[]): string[] {
  const normalized = values.map(normalizeRepoPath);
  const invalid = normalized.find((value) => !isRepoRelativePath(value) || value === "");
  if (invalid !== undefined) {
    throw workspaceError(
      "WORKSPACE_TARGET_PATH_INVALID",
      `workspace path must be repository-relative: ${invalid || "."}`,
    );
  }
  return [...new Set(normalized)].sort();
}

function normalizeRepoPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
}

function isRepoRelativePath(value: string): boolean {
  return (
    value === "" ||
    (!path.posix.isAbsolute(value) &&
      value !== ".." &&
      !value.startsWith("../") &&
      !value.split("/").includes(".."))
  );
}

function workspaceError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 5 * 1024 * 1024,
    });
    return result.stdout.trim();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.join(" ")} failed: ${message}`);
  }
}
