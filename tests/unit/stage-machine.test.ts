import { describe, expect, it } from "vitest";

import { createInitialRun } from "../../src/run/index.js";
import {
  InvalidStageTransitionError,
  StageLeaseExpiredError,
  StageLeaseMismatchError,
} from "../../src/state/errors.js";
import {
  completeStage,
  failStage,
  heartbeatStage,
  startStage,
} from "../../src/state/stage-machine.js";

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

describe("stage machine", () => {
  it("starts a pending stage with a lease", () => {
    const result = startStage(
      baseRun(),
      {
        stageName: "intake",
        workerId: "worker-1",
        leaseTtlMs: 60_000,
      },
      () => "2026-06-23T00:00:00.000Z",
    );

    expect(result.stage.status).toBe("running");
    expect(result.stage.lease?.workerId).toBe("worker-1");
    expect(result.run.revision).toBe(1);
  });

  it("rejects completing a pending stage", () => {
    expect(() =>
      completeStage(
        baseRun(),
        {
          stageName: "intake",
          workerId: "worker-1",
          leaseId: "lease_11111111111111111111111111111111",
        },
        () => "2026-06-23T00:00:00.000Z",
      ),
    ).toThrow(InvalidStageTransitionError);
  });

  it("completes a running stage with matching lease", () => {
    const started = startStage(
      baseRun(),
      {
        stageName: "intake",
        workerId: "worker-1",
        leaseTtlMs: 60_000,
      },
      () => "2026-06-23T00:00:00.000Z",
    );

    const completed = completeStage(
      started.run,
      {
        stageName: "intake",
        workerId: "worker-1",
        leaseId: started.stage.lease!.id,
      },
      () => "2026-06-23T00:00:10.000Z",
    );

    expect(completed.stage.status).toBe("passed");
    expect(completed.stage.lease).toBeUndefined();
  });

  it("rejects lease mismatch", () => {
    const started = startStage(
      baseRun(),
      {
        stageName: "intake",
        workerId: "worker-1",
        leaseTtlMs: 60_000,
      },
      () => "2026-06-23T00:00:00.000Z",
    );

    expect(() =>
      completeStage(
        started.run,
        {
          stageName: "intake",
          workerId: "worker-2",
          leaseId: started.stage.lease!.id,
        },
        () => "2026-06-23T00:00:10.000Z",
      ),
    ).toThrow(StageLeaseMismatchError);
  });

  it("rejects expired lease updates", () => {
    const started = startStage(
      baseRun(),
      {
        stageName: "intake",
        workerId: "worker-1",
        leaseTtlMs: 1_000,
      },
      () => "2026-06-23T00:00:00.000Z",
    );

    expect(() =>
      heartbeatStage(
        started.run,
        {
          stageName: "intake",
          workerId: "worker-1",
          leaseId: started.stage.lease!.id,
        },
        () => "2026-06-23T00:00:02.000Z",
      ),
    ).toThrow(StageLeaseExpiredError);
  });

  it("retries failed stages by incrementing attempt", () => {
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
          code: "TEST_FAILURE",
          message: "Test failed",
          retryable: true,
        },
      },
      () => "2026-06-23T00:00:10.000Z",
    );

    const retried = startStage(
      failed.run,
      {
        stageName: "intake",
        workerId: "worker-2",
      },
      () => "2026-06-23T00:00:20.000Z",
    );

    expect(retried.stage.status).toBe("running");
    expect(retried.stage.attempt).toBe(1);
  });
});
