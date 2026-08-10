import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { captureGitSnapshot } from "../../src/application/workflow-service.js";
import { createInitialRun } from "../../src/run/index.js";
import { RuntimeMetricsRecorder } from "../../src/runtime/performance-instrumentation.js";
import { sha256Digest } from "../../src/source-registry/content-hash.js";

const execFileAsync = promisify(execFile);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("WorkflowService Git performance instrumentation", () => {
  it("counts direct Git subprocesses and records binary diff bytes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-git-metrics-"));
    directories.push(directory);
    await git(directory, ["init", "--initial-branch=main"]);
    await git(directory, ["config", "user.email", "bench@example.invalid"]);
    await git(directory, ["config", "user.name", "Benchmark"]);
    await writeFile(path.join(directory, "tracked.txt"), "before\n");
    await git(directory, ["add", "tracked.txt"]);
    await git(directory, ["commit", "-m", "base"]);
    const baseCommit = (await git(directory, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(directory, "tracked.txt"), "after\n");
    const run = createInitialRun(
      { baseCommit, sources: [] },
      {
        id: "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        pluginVersion: "test",
        projectRoot: directory,
        now: "2026-07-28T00:00:00.000Z",
      },
    );
    const recorder = new RuntimeMetricsRecorder();

    await recorder.withRun(run.id, () => captureGitSnapshot(run, recorder));

    const snapshot = recorder.snapshot({
      runId: run.id,
      fixtureDigest: sha256Digest(Buffer.from("workflow-git")),
      collectedAt: "2026-07-28T00:00:00.000Z",
    });
    expect(snapshot.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "git.command_count", value: expect.any(Number) }),
        expect.objectContaining({ name: "git.binary_diff_bytes", value: expect.any(Number) }),
      ]),
    );
  });

  it("permits only declared packet-local visual outputs in a strict worktree", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-git-visual-output-"));
    directories.push(directory);
    await git(directory, ["init", "--initial-branch=codex/visual-output"]);
    await git(directory, ["config", "user.email", "visual@example.invalid"]);
    await git(directory, ["config", "user.name", "Visual output"]);
    await mkdir(path.join(directory, "src"));
    await writeFile(path.join(directory, "src", "screen.ts"), "export const screen = 'base';\n");
    await git(directory, ["add", "src/screen.ts"]);
    await git(directory, ["commit", "-m", "base"]);
    const baseCommit = (await git(directory, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(
      path.join(directory, "src", "screen.ts"),
      "export const screen = 'migrated';\n",
    );
    await git(directory, ["commit", "-am", "migration"]);
    const headSha = (await git(directory, ["rev-parse", "HEAD"])).stdout.trim();
    const run = createInitialRun(
      {
        baseCommit,
        sources: [],
        workspaceBinding: {
          repositoryRoot: directory,
          targetPaths: ["src"],
          supportingPaths: [],
          sourceBranch: "codex/visual-output",
          targetBranch: "refactor/base",
          baseSha: baseCommit,
          initialHeadSha: baseCommit,
          remoteName: "origin",
          remoteUrl: "https://gitlab.example.invalid/acme/app.git",
          remoteProvider: "gitlab",
          remoteHost: "gitlab.example.invalid",
          publicationTarget: {
            host: "gitlab",
            webBaseUrl: "https://gitlab.example.invalid",
            apiBaseUrl: "https://gitlab.example.invalid/api/v4",
            projectPath: "acme/app",
          },
        },
      },
      {
        id: "run_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        pluginVersion: "test",
        projectRoot: directory,
        now: "2026-08-10T04:00:00.000Z",
      },
    );
    const cleanSnapshot = await captureGitSnapshot(run);
    expect(cleanSnapshot.headSha).toBe(headSha);

    const visualPath =
      "visual/actual/packet_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/current.png";
    await mkdir(path.dirname(path.join(directory, visualPath)), { recursive: true });
    await writeFile(path.join(directory, visualPath), "visual evidence");

    await expect(captureGitSnapshot(run)).rejects.toThrow(/WORKSPACE_ROOT_MISMATCH/);

    const visualOutputSnapshot = await captureGitSnapshot(run, undefined, undefined, {
      allowedUntrackedPaths: [visualPath],
    });
    expect(visualOutputSnapshot).toMatchObject({
      headSha,
      diffDigest: cleanSnapshot.diffDigest,
      changedFiles: cleanSnapshot.changedFiles,
    });
  });
});

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd, encoding: "utf8" });
}
