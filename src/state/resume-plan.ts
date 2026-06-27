import type { RunManifest } from "../run/run.js";
import type { RunStageName, StageState } from "../run/stages.js";
import { canRetry, isLeaseExpired } from "./stage-machine.js";

export type ResumePlan = {
  runId: string;
  status: RunManifest["status"];
  nextStages: RunStageName[];
  runningStages: RunStageName[];
  expiredLeases: RunStageName[];
  blockedStages: RunStageName[];
  failedRetryableStages: RunStageName[];
  completedStages: RunStageName[];
};

export function createResumePlan(run: RunManifest, nowIso: string): ResumePlan {
  const expiredLeases = run.stages
    .filter((stage) => stage.status === "running" && isLeaseExpired(stage, nowIso))
    .map((stage) => stage.name);

  const runningStages = run.stages
    .filter((stage) => stage.status === "running" && !isLeaseExpired(stage, nowIso))
    .map((stage) => stage.name);

  const blockedStages = run.stages
    .filter((stage) => stage.status === "blocked")
    .map((stage) => stage.name);

  const failedRetryableStages = run.stages
    .filter((stage) => stage.status === "failed" && canRetry(stage))
    .map((stage) => stage.name);

  const completedStages = run.stages
    .filter((stage) => ["passed", "skipped", "waived"].includes(stage.status))
    .map((stage) => stage.name);

  return {
    runId: run.id,
    status: run.status,
    nextStages: computeNextStages(run.stages, expiredLeases),
    runningStages,
    expiredLeases,
    blockedStages,
    failedRetryableStages,
    completedStages,
  };
}

function computeNextStages(stages: StageState[], expiredLeases: RunStageName[]): RunStageName[] {
  if (expiredLeases.length > 0) {
    return expiredLeases;
  }

  const retryableFailure = stages.find((stage) => stage.status === "failed" && canRetry(stage));

  if (retryableFailure !== undefined) {
    return [retryableFailure.name];
  }

  const retryableBlocked = stages.find((stage) => stage.status === "blocked" && canRetry(stage));

  if (retryableBlocked !== undefined) {
    return [retryableBlocked.name];
  }

  const pending = stages.find((stage) => stage.status === "pending");

  return pending === undefined ? [] : [pending.name];
}
