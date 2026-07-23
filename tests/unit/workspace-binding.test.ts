import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  WorkspaceBindingSchema,
  assertChangedFilesWithinWorkspace,
  assertWorkspaceFresh,
  resolveWorkspaceBinding,
} from "../../src/workspace/workspace-binding.js";

const execFileAsync = promisify(execFile);

describe("workspace binding", () => {
  it("normalizes a nested requested path to the Git root and target path", async () => {
    const repository = await createRepository();
    const requestedPath = path.join(repository.root, "src/pages/shop");

    const binding = await resolveWorkspaceBinding({
      requestedPath,
      sourceBranch: "codex/shop",
      targetBranch: "release-qa",
      remoteName: "origin",
    });

    expect(binding).toMatchObject({
      repositoryRoot: await realpath(repository.root),
      targetPaths: ["src/pages/shop"],
      supportingPaths: [],
      sourceBranch: "codex/shop",
      targetBranch: "release-qa",
      baseSha: repository.releaseQaSha,
      initialHeadSha: repository.releaseQaSha,
      remoteName: "origin",
      remoteProvider: "gitlab",
      remoteHost: "gitlab.com",
    });
  });

  it("rejects a source branch that already diverged from the requested target", async () => {
    const repository = await createRepository();
    await writeFile(path.join(repository.root, "src/pages/shop/App.ts"), "export const app = 2;\n");
    await git(repository.root, "add", ".");
    await git(repository.root, "commit", "-m", "unexpected implementation");

    await expect(
      resolveWorkspaceBinding({
        requestedPath: path.join(repository.root, "src/pages/shop"),
        sourceBranch: "codex/shop",
        targetBranch: "release-qa",
        remoteName: "origin",
      }),
    ).rejects.toThrow(/WORKSPACE_TARGET_REF_MISMATCH/);
  });

  it("rejects target paths that escape the repository root", async () => {
    const repository = await createRepository();

    await expect(
      resolveWorkspaceBinding({
        requestedPath: repository.root,
        sourceBranch: "codex/shop",
        targetBranch: "release-qa",
        targetPaths: ["../outside"],
        remoteName: "origin",
      }),
    ).rejects.toThrow(/WORKSPACE_TARGET_PATH_INVALID/);
  });

  it("allows only declared target and supporting paths in a strict packet", () => {
    const binding = WorkspaceBindingSchema.parse({
      repositoryRoot: "/repo",
      targetPaths: ["src/pages/shop"],
      supportingPaths: ["package.json"],
      sourceBranch: "codex/shop",
      targetBranch: "release-qa",
      baseSha: "a".repeat(40),
      initialHeadSha: "a".repeat(40),
      remoteName: "origin",
      remoteUrl: "git@gitlab.com:example/mobydick.git",
      remoteProvider: "gitlab",
      remoteHost: "gitlab.com",
      publicationTarget: {
        host: "gitlab",
        webBaseUrl: "https://gitlab.com",
        apiBaseUrl: "https://gitlab.com/api/v4",
        projectPath: "example/mobydick",
      },
    });

    expect(() =>
      assertChangedFilesWithinWorkspace(
        ["package.json", "src/pages/shop/App.ts", "src/pages/shop/assets/logo.webp"],
        binding,
      ),
    ).not.toThrow();
    expect(() => assertChangedFilesWithinWorkspace(["src/pages/other/App.ts"], binding)).toThrow(
      /WORKSPACE_TARGET_PATH_INVALID.*src\/pages\/other\/App.ts/,
    );
  });

  it("pins publication to the bound branch, reviewed head, target ref, and remote", async () => {
    const repository = await createRepository();
    const binding = await resolveWorkspaceBinding({
      requestedPath: path.join(repository.root, "src/pages/shop"),
      sourceBranch: "codex/shop",
      targetBranch: "release-qa",
      remoteName: "origin",
    });
    await writeFile(path.join(repository.root, "src/pages/shop/App.ts"), "export const app = 2;\n");
    await git(repository.root, "add", ".");
    await git(repository.root, "commit", "-m", "implementation");
    const reviewedHeadSha = await git(repository.root, "rev-parse", "HEAD");

    await expect(
      assertWorkspaceFresh(binding, {
        sourceBranch: "codex/shop",
        targetBranch: "release-qa",
        remoteName: "origin",
        reviewedHeadSha,
      }),
    ).resolves.toBeUndefined();

    await expect(
      assertWorkspaceFresh(binding, {
        sourceBranch: "codex/other",
        targetBranch: "release-qa",
        remoteName: "origin",
        reviewedHeadSha,
      }),
    ).rejects.toThrow(/WORKSPACE_BRANCH_MISMATCH/);
    await expect(
      assertWorkspaceFresh(binding, {
        sourceBranch: "codex/shop",
        targetBranch: "main",
        remoteName: "origin",
        reviewedHeadSha,
      }),
    ).rejects.toThrow(/WORKSPACE_TARGET_REF_MISMATCH/);
    await expect(
      assertWorkspaceFresh(binding, {
        sourceBranch: "codex/shop",
        targetBranch: "release-qa",
        remoteName: "upstream",
        reviewedHeadSha,
      }),
    ).rejects.toThrow(/WORKSPACE_REMOTE_MISMATCH/);
  });

  it("rejects target-ref and remote drift after workflow start", async () => {
    const targetDrift = await createRepository();
    const targetBinding = await resolveWorkspaceBinding({
      requestedPath: path.join(targetDrift.root, "src/pages/shop"),
      sourceBranch: "codex/shop",
      targetBranch: "release-qa",
      remoteName: "origin",
    });
    await writeFile(path.join(targetDrift.root, "src/pages/shop/App.ts"), "export const app = 2;\n");
    await git(targetDrift.root, "add", ".");
    await git(targetDrift.root, "commit", "-m", "implementation");
    const targetHead = await git(targetDrift.root, "rev-parse", "HEAD");
    await git(targetDrift.root, "branch", "-f", "release-qa", targetHead);

    await expect(
      assertWorkspaceFresh(targetBinding, {
        sourceBranch: "codex/shop",
        targetBranch: "release-qa",
        remoteName: "origin",
        reviewedHeadSha: targetHead,
      }),
    ).rejects.toThrow(/WORKSPACE_TARGET_REF_MISMATCH/);

    const remoteDrift = await createRepository();
    const remoteBinding = await resolveWorkspaceBinding({
      requestedPath: path.join(remoteDrift.root, "src/pages/shop"),
      sourceBranch: "codex/shop",
      targetBranch: "release-qa",
      remoteName: "origin",
    });
    await git(
      remoteDrift.root,
      "remote",
      "set-url",
      "origin",
      "git@gitlab.com:attacker/mobydick.git",
    );

    await expect(
      assertWorkspaceFresh(remoteBinding, {
        sourceBranch: "codex/shop",
        targetBranch: "release-qa",
        remoteName: "origin",
      }),
    ).rejects.toThrow(/WORKSPACE_REMOTE_MISMATCH/);
  });
});

async function createRepository(): Promise<{
  root: string;
  releaseQaSha: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "spec-to-pr-workspace-binding-"));
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "codex@example.com");
  await git(root, "config", "user.name", "Codex");
  await mkdir(path.join(root, "src/pages/shop"), { recursive: true });
  await writeFile(path.join(root, "src/pages/shop/App.ts"), "export const app = 1;\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "initial");
  await git(root, "switch", "-c", "release-qa");
  const releaseQaSha = await git(root, "rev-parse", "HEAD");
  await git(root, "switch", "-c", "codex/shop");
  await git(root, "remote", "add", "origin", "git@gitlab.com:example/mobydick.git");
  return { root, releaseQaSha };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}
