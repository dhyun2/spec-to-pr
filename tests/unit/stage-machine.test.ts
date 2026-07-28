import { describe, expect, it } from "vitest";

import { ArtifactRefSchema, type ArtifactRef } from "../../src/runtime/artifact.js";
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
  reopenImplementationForReviewChanges,
  reopenImplementationForVisualRepair,
  startStage,
  terminalizeVisualThresholdFailure,
} from "../../src/state/stage-machine.js";
import { ImplementationReviewPacketSchema } from "../../src/workflow/workflow-contracts.js";

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

function artifact(
  id: `art_${string}`,
  kind: ArtifactRef["kind"],
  digestCharacter: string,
): ArtifactRef {
  return ArtifactRefSchema.parse({
    id,
    kind,
    uri: `blob:sha256:${digestCharacter.repeat(64)}`,
    mediaType: "application/json",
    digest: `sha256:${digestCharacter.repeat(64)}`,
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:20.000Z",
    metadata: {},
  });
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

  it("repairs an exhausted legacy review-change retry budget when implementation restarts", () => {
    const run = baseRun();
    const legacyReopened = {
      ...run,
      stages: run.stages.map((stage) =>
        stage.name === "implementation"
          ? {
              ...stage,
              status: "failed" as const,
              attempt: 3,
              maxAttempts: 3,
              completedAt: "2026-06-23T00:00:10.000Z",
              error: {
                code: "REVIEW_CHANGES_REQUESTED",
                message: "The implementation needs another repair round.",
                retryable: true,
              },
            }
          : stage,
      ),
    };

    const restarted = startStage(
      legacyReopened,
      { stageName: "implementation", workerId: "worker-2" },
      () => "2026-06-23T00:00:20.000Z",
    );

    expect(restarted.stage).toMatchObject({ status: "running", attempt: 4, maxAttempts: 4 });
  });

  it("reopens an exhausted retryable publication after its precondition is repaired", () => {
    const run = baseRun();
    const failedPublication = {
      ...run,
      stages: run.stages.map((stage) =>
        stage.name === "publish"
          ? {
              ...stage,
              status: "failed" as const,
              attempt: 3,
              maxAttempts: 3,
              completedAt: "2026-06-23T00:00:10.000Z",
              error: {
                code: "PUBLISH_FAILED",
                message: "The publisher credential precondition was repaired.",
                retryable: true,
              },
            }
          : stage,
      ),
    };

    const restarted = startStage(
      failedPublication,
      { stageName: "publish", workerId: "worker-2" },
      () => "2026-06-23T00:00:20.000Z",
    );

    expect(restarted.stage).toMatchObject({ status: "running", attempt: 4, maxAttempts: 4 });
  });

  it("reopens implementation and invalidates stale verification after review changes", () => {
    const run = baseRun();
    const prepared = {
      ...run,
      stages: run.stages.map((stage) =>
        ["implementation", "functional-review", "design-review", "report"].includes(stage.name)
          ? {
              ...stage,
              status: "passed" as const,
              completedAt: "2026-06-23T00:00:10.000Z",
              artifactIds: [],
              ...(stage.name === "implementation" ? { attempt: 3, maxAttempts: 3 } : {}),
            }
          : stage,
      ),
    };

    const reopened = reopenImplementationForReviewChanges(
      prepared,
      "The empty state is incorrect.",
      () => "2026-06-23T00:00:20.000Z",
    );

    expect(reopened.stages.find((stage) => stage.name === "implementation")).toMatchObject({
      status: "failed",
      attempt: 3,
      maxAttempts: 4,
      error: { code: "REVIEW_CHANGES_REQUESTED", retryable: true },
    });
    expect(
      startStage(
        reopened,
        { stageName: "implementation", workerId: "worker-2" },
        () => "2026-06-23T00:00:30.000Z",
      ).stage,
    ).toMatchObject({ status: "running", attempt: 4, maxAttempts: 4 });
    for (const name of ["functional-review", "design-review", "report", "publish"]) {
      expect(reopened.stages.find((stage) => stage.name === name)).toMatchObject({
        status: "pending",
        artifactIds: [],
      });
    }
  });

  it("reopens implementation with a retryable visual repair code", () => {
    const run = baseRun();
    const prepared = {
      ...run,
      stages: run.stages.map((stage) =>
        stage.name === "implementation"
          ? {
              ...stage,
              status: "passed" as const,
              completedAt: "2026-06-23T00:00:10.000Z",
              attempt: 1,
              artifactIds: [],
            }
          : stage,
      ),
    };

    const reopened = reopenImplementationForVisualRepair(
      prepared,
      "Visual comparison failed.",
      () => "2026-06-23T00:00:20.000Z",
    );

    expect(reopened.stages.find((stage) => stage.name === "implementation")).toMatchObject({
      status: "failed",
      error: { code: "VISUAL_IMPLEMENTATION_REPAIR_REQUIRED", retryable: true },
    });
    expect(
      startStage(
        reopened,
        { stageName: "implementation", workerId: "worker-2" },
        () => "2026-06-23T00:00:30.000Z",
      ).stage,
    ).toMatchObject({ status: "running", attempt: 2 });
  });

  it("terminalizes the third failed visual comparison in one revision", () => {
    const reviewPacket = ImplementationReviewPacketSchema.parse({
      id: `packet_${"a".repeat(64)}`,
      runId,
      revision: 3,
      baseSha: "1".repeat(40),
      headSha: "2".repeat(40),
      evidenceDigest: `sha256:${"3".repeat(64)}`,
      diffDigest: `sha256:${"4".repeat(64)}`,
      changedFiles: ["src/checkout.tsx"],
      visualLineageId: `packet_${"5".repeat(64)}`,
    });
    const run = {
      ...baseRun(),
      status: "running" as const,
      revision: 9,
      stages: baseRun().stages.map((stage) =>
        [
          "implementation",
          "functional-review",
          "design-review",
          "report",
          "publish",
          "archive",
        ].includes(stage.name)
          ? {
              ...stage,
              status: "passed" as const,
              startedAt: "2026-06-23T00:00:10.000Z",
              completedAt: "2026-06-23T00:00:15.000Z",
              artifactIds: [],
              checkpoint:
                stage.name === "implementation"
                  ? {
                      name: "implementation-complete",
                      data: { reviewPacket },
                      updatedAt: "2026-06-23T00:00:15.000Z",
                    }
                  : {
                      name: `${stage.name}-complete`,
                      data: { stale: true },
                      updatedAt: "2026-06-23T00:00:15.000Z",
                    },
            }
          : stage,
      ),
    };
    const committedAttempt = artifact("art_11111111111111111111111111111111", "other", "6");
    const visualReport = artifact("art_22222222222222222222222222222222", "visual-report", "7");
    const exhaustedLineage = artifact("art_33333333333333333333333333333333", "other", "8");
    const terminalIdentity = `sha256:${"9".repeat(64)}`;
    const visualLineageId = reviewPacket.visualLineageId!;
    const timestamp = "2026-06-23T00:00:20.000Z";

    const terminal = terminalizeVisualThresholdFailure(run, {
      artifacts: [committedAttempt, visualReport, exhaustedLineage],
      reviewPacket,
      visualLineageId,
      visualReportArtifactId: visualReport.id,
      visualReportDigest: visualReport.digest,
      terminalIdentity,
      timestamp,
    });

    expect(terminal.revision).toBe(run.revision + 1);
    expect(terminal.status).toBe("blocked");
    expect(terminal.artifacts.slice(-3)).toEqual([
      committedAttempt,
      visualReport,
      exhaustedLineage,
    ]);
    expect(terminal.stages.find((stage) => stage.name === "implementation")).toMatchObject({
      status: "failed",
      artifactIds: [committedAttempt.id, visualReport.id, exhaustedLineage.id],
      error: {
        code: "VISUAL_REVIEW_THRESHOLD_NOT_MET",
        message: expect.stringContaining("92%"),
        retryable: false,
      },
      checkpoint: {
        name: "visual-threshold-not-met",
        data: {
          reviewPacket,
          visualLineageId,
          visualComparisonAttempt: 3,
          visualReportArtifactId: visualReport.id,
          visualReportDigest: visualReport.digest,
          visualTerminalIdentity: terminalIdentity,
        },
      },
    });
    for (const name of ["functional-review", "design-review", "report", "publish", "archive"]) {
      expect(terminal.stages.find((stage) => stage.name === name)).toMatchObject({
        status: "pending",
        attempt: 0,
        artifactIds: [],
        gapIds: [],
      });
      expect(terminal.stages.find((stage) => stage.name === name)?.checkpoint).toBeUndefined();
      expect(terminal.stages.find((stage) => stage.name === name)?.error).toBeUndefined();
    }
  });
});
