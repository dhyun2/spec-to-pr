import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

    await captureGitSnapshot(run, recorder);

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
});

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd, encoding: "utf8" });
}
