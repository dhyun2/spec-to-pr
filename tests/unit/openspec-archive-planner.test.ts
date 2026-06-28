import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOpenSpecArchivePlan } from "../../src/openspec-archive/index.js";
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
  it("blocks archive when review request is not merged", async () => {
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
      generatedAt: "2026-06-23T00:00:00.000Z",
      review: {
        provider: "github",
        merged: false,
        raw: {},
      },
    });

    expect(plan.canExecute).toBe(false);
    expect(
      plan.preconditions.some(
        (item) => item.id === "review-request-merged" && item.status === "failed",
      ),
    ).toBe(true);
  });

  it("passes blocking preconditions when merged status and change files exist", async () => {
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

    const plan = await createOpenSpecArchivePlan({
      run,
      changeName: "deliver-reservation-management",
      generatedAt: "2026-06-23T00:00:00.000Z",
      review: {
        provider: "github",
        reviewRequestUrl: "https://github.com/acme/spec-to-pr/pull/1",
        number: "1",
        merged: true,
        mergedAt: "2026-06-23T00:00:00.000Z",
        mergedCommitSha: "abcdef1",
        raw: {},
      },
    });

    expect(plan.canExecute).toBe(true);
    expect(plan.command).toEqual([
      "openspec",
      "archive",
      "deliver-reservation-management",
      "--yes",
    ]);
  });
});
