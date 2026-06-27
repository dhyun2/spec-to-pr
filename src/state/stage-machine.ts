import { randomUUID } from "node:crypto";

import { RunManifestSchema, type RunManifest } from "../run/run.js";
import {
  LeaseIdSchema,
  RunStageNameSchema,
  StageLeaseSchema,
  StageStateSchema,
  type LeaseId,
  type RunStageName,
  type StageCheckpoint,
  type StageError,
  type StageLease,
  type StageState,
  type StageStatus,
  type WorkerId,
} from "../run/stages.js";
import type { ArtifactId, GapId } from "../runtime/ids.js";
import {
  InvalidStageTransitionError,
  StageLeaseExpiredError,
  StageLeaseMismatchError,
  StageNotFoundError,
  StageRetryExhaustedError,
} from "./errors.js";

export type Clock = () => string;

export type StartStageCommand = {
  stageName: RunStageName;
  workerId: WorkerId;
  leaseTtlMs?: number;
  owner?: StageState["owner"];
};

export type HeartbeatStageCommand = {
  stageName: RunStageName;
  leaseId: LeaseId;
  workerId: WorkerId;
  leaseTtlMs?: number;
  checkpoint?: Omit<StageCheckpoint, "updatedAt">;
};

export type CompleteStageCommand = {
  stageName: RunStageName;
  leaseId: LeaseId;
  workerId: WorkerId;
  artifactIds?: ArtifactId[];
  checkpoint?: Omit<StageCheckpoint, "updatedAt">;
};

export type FailStageCommand = {
  stageName: RunStageName;
  leaseId: LeaseId;
  workerId: WorkerId;
  error: StageError;
  artifactIds?: ArtifactId[];
  checkpoint?: Omit<StageCheckpoint, "updatedAt">;
};

export type BlockStageCommand = {
  stageName: RunStageName;
  leaseId: LeaseId;
  workerId: WorkerId;
  error: StageError;
  gapIds: GapId[];
  artifactIds?: ArtifactId[];
  checkpoint?: Omit<StageCheckpoint, "updatedAt">;
};

export type SkipStageCommand = {
  stageName: RunStageName;
  leaseId: LeaseId;
  workerId: WorkerId;
  reason: string;
  artifactIds?: ArtifactId[];
};

export type StageTransitionResult = {
  run: RunManifest;
  stage: StageState;
};

export const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;

const ALLOWED_TRANSITIONS = new Map<StageStatus, StageStatus[]>([
  ["pending", ["running"]],
  ["running", ["passed", "failed", "blocked", "skipped"]],
  ["failed", ["running"]],
  ["blocked", ["running"]],
  ["skipped", ["running"]],
  ["passed", []],
  ["waived", []],
]);

export function startStage(
  run: RunManifest,
  command: StartStageCommand,
  now: Clock,
): StageTransitionResult {
  const stage = findStage(run, command.stageName);
  const nowIso = now();

  if (stage.status === "running") {
    if (!isLeaseExpired(stage, nowIso)) {
      throw new InvalidStageTransitionError(stage.name, stage.status, "running");
    }

    return replaceStage(run, withRunningLease(stage, command, nowIso, false), nowIso);
  }

  assertTransition(stage, "running");

  if (["failed", "blocked", "skipped"].includes(stage.status) && !canRetry(stage)) {
    throw new StageRetryExhaustedError(stage.name);
  }

  return replaceStage(
    run,
    withRunningLease(stage, command, nowIso, stage.status !== "pending"),
    nowIso,
  );
}

export function heartbeatStage(
  run: RunManifest,
  command: HeartbeatStageCommand,
  now: Clock,
): StageTransitionResult {
  const stage = findStage(run, command.stageName);
  const nowIso = now();

  assertCurrentLease(stage, command.leaseId, command.workerId, nowIso);

  const next = StageStateSchema.parse({
    ...stage,
    lease: renewLease(stage.lease, nowIso, command.leaseTtlMs),
    checkpoint:
      command.checkpoint === undefined
        ? stage.checkpoint
        : {
            ...command.checkpoint,
            updatedAt: nowIso,
          },
  });

  return replaceStage(run, next, nowIso);
}

export function completeStage(
  run: RunManifest,
  command: CompleteStageCommand,
  now: Clock,
): StageTransitionResult {
  const stage = findStage(run, command.stageName);
  const nowIso = now();

  assertCurrentLease(stage, command.leaseId, command.workerId, nowIso);
  assertTransition(stage, "passed");

  const next = StageStateSchema.parse({
    ...stage,
    status: "passed",
    lease: undefined,
    completedAt: nowIso,
    artifactIds: mergeUnique(stage.artifactIds, command.artifactIds ?? []),
    checkpoint:
      command.checkpoint === undefined
        ? stage.checkpoint
        : {
            ...command.checkpoint,
            updatedAt: nowIso,
          },
    error: undefined,
  });

  return replaceStage(run, next, nowIso);
}

export function failStage(
  run: RunManifest,
  command: FailStageCommand,
  now: Clock,
): StageTransitionResult {
  const stage = findStage(run, command.stageName);
  const nowIso = now();

  assertCurrentLease(stage, command.leaseId, command.workerId, nowIso);
  assertTransition(stage, "failed");

  const next = StageStateSchema.parse({
    ...stage,
    status: "failed",
    lease: undefined,
    completedAt: nowIso,
    artifactIds: mergeUnique(stage.artifactIds, command.artifactIds ?? []),
    checkpoint:
      command.checkpoint === undefined
        ? stage.checkpoint
        : {
            ...command.checkpoint,
            updatedAt: nowIso,
          },
    error: command.error,
  });

  return replaceStage(run, next, nowIso);
}

export function blockStage(
  run: RunManifest,
  command: BlockStageCommand,
  now: Clock,
): StageTransitionResult {
  const stage = findStage(run, command.stageName);
  const nowIso = now();

  assertCurrentLease(stage, command.leaseId, command.workerId, nowIso);
  assertTransition(stage, "blocked");

  const next = StageStateSchema.parse({
    ...stage,
    status: "blocked",
    lease: undefined,
    completedAt: nowIso,
    gapIds: mergeUnique(stage.gapIds, command.gapIds),
    artifactIds: mergeUnique(stage.artifactIds, command.artifactIds ?? []),
    checkpoint:
      command.checkpoint === undefined
        ? stage.checkpoint
        : {
            ...command.checkpoint,
            updatedAt: nowIso,
          },
    error: command.error,
  });

  return replaceStage(run, next, nowIso);
}

export function skipStage(
  run: RunManifest,
  command: SkipStageCommand,
  now: Clock,
): StageTransitionResult {
  const stage = findStage(run, command.stageName);
  const nowIso = now();

  assertCurrentLease(stage, command.leaseId, command.workerId, nowIso);
  assertTransition(stage, "skipped");

  const next = StageStateSchema.parse({
    ...stage,
    status: "skipped",
    lease: undefined,
    completedAt: nowIso,
    artifactIds: mergeUnique(stage.artifactIds, command.artifactIds ?? []),
    checkpoint: {
      name: "skipped",
      data: {
        reason: command.reason,
      },
      updatedAt: nowIso,
    },
    error: undefined,
  });

  return replaceStage(run, next, nowIso);
}

export function isLeaseExpired(stage: StageState, nowIso: string): boolean {
  if (stage.lease === undefined) {
    return false;
  }

  return Date.parse(stage.lease.expiresAt) <= Date.parse(nowIso);
}

export function canRetry(stage: StageState): boolean {
  return stage.attempt + 1 <= stage.maxAttempts;
}

function findStage(run: RunManifest, stageName: RunStageName): StageState {
  const parsedStageName = RunStageNameSchema.parse(stageName);
  const stage = run.stages.find((item) => item.name === parsedStageName);

  if (stage === undefined) {
    throw new StageNotFoundError(parsedStageName);
  }

  return stage;
}

function assertTransition(stage: StageState, to: StageStatus): void {
  const allowed = ALLOWED_TRANSITIONS.get(stage.status) ?? [];

  if (!allowed.includes(to)) {
    throw new InvalidStageTransitionError(stage.name, stage.status, to);
  }
}

function assertCurrentLease(
  stage: StageState,
  leaseId: LeaseId,
  workerId: WorkerId,
  nowIso: string,
): asserts stage is StageState & { lease: StageLease } {
  if (stage.status !== "running" || stage.lease === undefined) {
    throw new InvalidStageTransitionError(stage.name, stage.status, "running-update");
  }

  if (stage.lease.id !== leaseId || stage.lease.workerId !== workerId) {
    throw new StageLeaseMismatchError(stage.name);
  }

  if (isLeaseExpired(stage, nowIso)) {
    throw new StageLeaseExpiredError(stage.name);
  }
}

function withRunningLease(
  stage: StageState,
  command: StartStageCommand,
  nowIso: string,
  isRetry: boolean,
): StageState {
  return StageStateSchema.parse({
    ...stage,
    status: "running",
    attempt: isRetry ? stage.attempt + 1 : stage.attempt,
    owner: command.owner ?? stage.owner,
    startedAt: nowIso,
    completedAt: undefined,
    lease: createLease(command.workerId, nowIso, command.leaseTtlMs),
    error: undefined,
  });
}

function createLease(workerId: WorkerId, nowIso: string, ttlMs = DEFAULT_LEASE_TTL_MS): StageLease {
  return StageLeaseSchema.parse({
    id: createLeaseId(),
    workerId,
    acquiredAt: nowIso,
    heartbeatAt: nowIso,
    expiresAt: new Date(Date.parse(nowIso) + ttlMs).toISOString(),
  });
}

function renewLease(lease: StageLease, nowIso: string, ttlMs = DEFAULT_LEASE_TTL_MS): StageLease {
  return StageLeaseSchema.parse({
    ...lease,
    heartbeatAt: nowIso,
    expiresAt: new Date(Date.parse(nowIso) + ttlMs).toISOString(),
  });
}

function replaceStage(run: RunManifest, stage: StageState, nowIso: string): StageTransitionResult {
  const nextRun = {
    ...run,
    updatedAt: nowIso,
    revision: run.revision + 1,
    status: computeRunStatus(run, stage),
    stages: run.stages.map((item) => (item.name === stage.name ? stage : item)),
  };

  return {
    run: RunManifestSchema.parse(nextRun),
    stage,
  };
}

function computeRunStatus(run: RunManifest, changedStage: StageState): RunManifest["status"] {
  const stages = run.stages.map((item) => (item.name === changedStage.name ? changedStage : item));

  if (stages.some((stage) => stage.status === "blocked")) {
    return "blocked";
  }

  if (stages.some((stage) => stage.status === "failed")) {
    return "failed";
  }

  if (stages.some((stage) => stage.status === "running")) {
    return "running";
  }

  if (stages.every((stage) => ["passed", "skipped", "waived"].includes(stage.status))) {
    return "completed";
  }

  return "running";
}

function mergeUnique<T extends string>(left: T[], right: T[]): T[] {
  return [...new Set([...left, ...right])];
}

function createLeaseId(): LeaseId {
  return LeaseIdSchema.parse(`lease_${randomUUID().replaceAll("-", "")}`);
}
