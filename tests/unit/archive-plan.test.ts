import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOpenSpecArchivePlan, type MergeEvidence } from "../../src/archive/index.js";
import { createInitialRun } from "../../src/run/index.js";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-archive-plan-"));
});

afterEach(async () => {
  await rm(projectRoot, {
    recursive: true,
    force: true,
  });
});

describe("OpenSpec archive planner", () => {
  it("requires explicit merge evidence and never polls", async () => {
    const run = createInitialRun(
      { sources: [] },
      {
        id: "run_11111111111111111111111111111111",
        pluginVersion: "0.1.0",
        projectRoot,
        now: "2026-06-23T00:00:00.000Z",
      },
    );

    const plan = await createOpenSpecArchivePlan({
      run,
      changeName: "deliver-reservation-management",
      publishResultUrl: "https://github.com/acme/spec-to-pr/pull/1",
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(plan.status).toBe("needs-merge-evidence");
    expect(plan.executeAllowed).toBe(false);
    expect(plan.polling).toBe(false);
    expect(plan.blockingReasons).toContain("No merge evidence found.");
  });

  it("is ready when publish result URL, matching merged evidence, and change files exist", async () => {
    const changeRoot = path.join(
      projectRoot,
      "openspec",
      "changes",
      "deliver-reservation-management",
    );

    await mkdir(path.join(changeRoot, "specs", "reservation-management"), {
      recursive: true,
    });
    await writeFile(path.join(changeRoot, "proposal.md"), "# Proposal\n");
    await writeFile(path.join(changeRoot, "design.md"), "# Design\n");
    await writeFile(path.join(changeRoot, "tasks.md"), "# Tasks\n");

    const run = createInitialRun(
      { sources: [] },
      {
        id: "run_11111111111111111111111111111111",
        pluginVersion: "0.1.0",
        projectRoot,
        now: "2026-06-23T00:00:00.000Z",
      },
    );

    const mergeEvidence: MergeEvidence = {
      id: "art_11111111111111111111111111111111",
      runId: run.id,
      kind: "user-attested",
      provider: "github",
      reviewRequestUrl: "https://github.com/acme/spec-to-pr/pull/1",
      status: "merged",
      statement: "User confirmed that the review request was merged.",
      checkedAt: "2026-06-23T00:00:00.000Z",
      attestedBy: "user",
      metadata: {},
    };

    const plan = await createOpenSpecArchivePlan({
      run,
      changeName: "deliver-reservation-management",
      publishResultUrl: "https://github.com/acme/spec-to-pr/pull/1",
      mergeEvidence,
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(plan.status).toBe("ready");
    expect(plan.executeAllowed).toBe(true);
    expect(plan.archiveCommand).toBe("openspec archive deliver-reservation-management --yes");
    expect(plan.polling).toBe(false);
  });
});
