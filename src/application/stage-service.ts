import { z } from "zod";

import { RunManifestSchema } from "../run/run.js";
import {
  LeaseIdSchema,
  RunStageNameSchema,
  StageErrorSchema,
  WorkerIdSchema,
} from "../run/stages.js";
import { ArtifactIdSchema, GapIdSchema, RunIdSchema } from "../runtime/ids.js";
import { createResumePlan } from "../state/resume-plan.js";
import {
  blockStage,
  completeStage,
  failStage,
  heartbeatStage,
  skipStage,
  startStage,
} from "../state/stage-machine.js";
import type { RunStore } from "../store/run-store.js";

const CheckpointInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const StartStageInputSchema = z
  .object({
    runId: RunIdSchema,
    stageName: RunStageNameSchema,
    workerId: WorkerIdSchema,
    leaseTtlMs: z
      .number()
      .int()
      .positive()
      .max(60 * 60 * 1000)
      .optional(),
  })
  .strict();

export const HeartbeatStageInputSchema = z
  .object({
    runId: RunIdSchema,
    stageName: RunStageNameSchema,
    leaseId: LeaseIdSchema,
    workerId: WorkerIdSchema,
    leaseTtlMs: z
      .number()
      .int()
      .positive()
      .max(60 * 60 * 1000)
      .optional(),
    checkpoint: CheckpointInputSchema.optional(),
  })
  .strict();

export const CompleteStageInputSchema = z
  .object({
    runId: RunIdSchema,
    stageName: RunStageNameSchema,
    leaseId: LeaseIdSchema,
    workerId: WorkerIdSchema,
    artifactIds: z.array(ArtifactIdSchema).default([]),
    checkpoint: CheckpointInputSchema.optional(),
  })
  .strict();

export const FailStageInputSchema = z
  .object({
    runId: RunIdSchema,
    stageName: RunStageNameSchema,
    leaseId: LeaseIdSchema,
    workerId: WorkerIdSchema,
    error: StageErrorSchema,
    artifactIds: z.array(ArtifactIdSchema).default([]),
    checkpoint: CheckpointInputSchema.optional(),
  })
  .strict();

export const BlockStageInputSchema = z
  .object({
    runId: RunIdSchema,
    stageName: RunStageNameSchema,
    leaseId: LeaseIdSchema,
    workerId: WorkerIdSchema,
    error: StageErrorSchema,
    gapIds: z.array(GapIdSchema).min(1),
    artifactIds: z.array(ArtifactIdSchema).default([]),
    checkpoint: CheckpointInputSchema.optional(),
  })
  .strict();

export const SkipStageInputSchema = z
  .object({
    runId: RunIdSchema,
    stageName: RunStageNameSchema,
    leaseId: LeaseIdSchema,
    workerId: WorkerIdSchema,
    reason: z.string().trim().min(1).max(1_000),
    artifactIds: z.array(ArtifactIdSchema).default([]),
  })
  .strict();

export const GetResumePlanInputSchema = z
  .object({
    runId: RunIdSchema,
  })
  .strict();

export class StageService {
  public constructor(
    private readonly store: RunStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async start(rawInput: unknown) {
    const input = StartStageInputSchema.parse(rawInput);
    const run = await this.store.get(input.runId);
    const result = startStage(
      run,
      {
        stageName: input.stageName,
        workerId: input.workerId,
        ...(input.leaseTtlMs === undefined ? {} : { leaseTtlMs: input.leaseTtlMs }),
      },
      this.now,
    );

    await this.store.save(result.run, run.revision);

    return result;
  }

  public async heartbeat(rawInput: unknown) {
    const input = HeartbeatStageInputSchema.parse(rawInput);
    const run = await this.store.get(input.runId);
    const result = heartbeatStage(
      run,
      {
        stageName: input.stageName,
        leaseId: input.leaseId,
        workerId: input.workerId,
        ...(input.leaseTtlMs === undefined ? {} : { leaseTtlMs: input.leaseTtlMs }),
        ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
      },
      this.now,
    );

    await this.store.save(result.run, run.revision);

    return result;
  }

  public async complete(rawInput: unknown) {
    const input = CompleteStageInputSchema.parse(rawInput);
    const run = await this.store.get(input.runId);
    const result = completeStage(
      run,
      {
        stageName: input.stageName,
        leaseId: input.leaseId,
        workerId: input.workerId,
        artifactIds: input.artifactIds,
        ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
      },
      this.now,
    );

    await this.store.save(result.run, run.revision);

    return result;
  }

  public async fail(rawInput: unknown) {
    const input = FailStageInputSchema.parse(rawInput);
    const run = await this.store.get(input.runId);
    const result = failStage(
      run,
      {
        stageName: input.stageName,
        leaseId: input.leaseId,
        workerId: input.workerId,
        error: input.error,
        artifactIds: input.artifactIds,
        ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
      },
      this.now,
    );

    await this.store.save(result.run, run.revision);

    return result;
  }

  public async block(rawInput: unknown) {
    const input = BlockStageInputSchema.parse(rawInput);
    const run = await this.store.get(input.runId);
    const result = blockStage(
      run,
      {
        stageName: input.stageName,
        leaseId: input.leaseId,
        workerId: input.workerId,
        error: input.error,
        gapIds: input.gapIds,
        artifactIds: input.artifactIds,
        ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
      },
      this.now,
    );

    await this.store.save(result.run, run.revision);

    return result;
  }

  public async skip(rawInput: unknown) {
    const input = SkipStageInputSchema.parse(rawInput);
    const run = await this.store.get(input.runId);
    const result = skipStage(
      run,
      {
        stageName: input.stageName,
        leaseId: input.leaseId,
        workerId: input.workerId,
        reason: input.reason,
        artifactIds: input.artifactIds,
      },
      this.now,
    );

    await this.store.save(result.run, run.revision);

    return result;
  }

  public async getResumePlan(rawInput: unknown) {
    const input = GetResumePlanInputSchema.parse(rawInput);
    const run = RunManifestSchema.parse(await this.store.get(input.runId));

    return createResumePlan(run, this.now());
  }
}
