import { describe, expect, it } from "vitest";

import { createInitialRun } from "../../src/run/index.js";
import { createResumePlan } from "../../src/state/resume-plan.js";
import { failStage, startStage } from "../../src/state/stage-machine.js";

const runId = "run_11111111111111111111111111111111";

function baseRun() {
  return createInitialRun(
    { sources: [] },
    {
      id: runId,
      pluginVersion: "0.1.0",
      projectRoot: "/tmp/project",
      now: "2026-06-23T00:00:00.000Z",
    },
  );
}

describe("resume planner", () => {
  it("returns the first pending stage", () => {
    const plan = createResumePlan(baseRun(), "2026-06-23T00:00:00.000Z");

    expect(plan.nextStages).toEqual(["intake"]);
  });

  it("returns expired running stages first", () => {
    const started = startStage(
      baseRun(),
      {
        stageName: "intake",
        workerId: "worker-1",
        leaseTtlMs: 1_000,
      },
      () => "2026-06-23T00:00:00.000Z",
    );

    const plan = createResumePlan(started.run, "2026-06-23T00:00:02.000Z");

    expect(plan.expiredLeases).toEqual(["intake"]);
    expect(plan.nextStages).toEqual(["intake"]);
  });

  it("returns retryable failed stages", () => {
    const started = startStage(
      baseRun(),
      {
        stageName: "intake",
        workerId: "worker-1",
      },
      () => "2026-06-23T00:00:00.000Z",
    );

    const failed = failStage(
      started.run,
      {
        stageName: "intake",
        workerId: "worker-1",
        leaseId: started.stage.lease!.id,
        error: {
          code: "FAIL",
          message: "Failed",
          retryable: true,
        },
      },
      () => "2026-06-23T00:00:10.000Z",
    );

    const plan = createResumePlan(failed.run, "2026-06-23T00:00:20.000Z");

    expect(plan.failedRetryableStages).toEqual(["intake"]);
    expect(plan.nextStages).toEqual(["intake"]);
  });
});
