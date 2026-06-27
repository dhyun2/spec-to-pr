import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  createInitialRun,
  RunManifestSchema,
  RunStatusSchema,
  summarizeRun,
} from "../run/index.js";
import type { RunManifest, RunSummary } from "../run/index.js";
import { RunIdSchema, type RunId } from "../runtime/ids.js";
import { GitObjectIdSchema } from "../runtime/scalars.js";
import { SourceRefSchema } from "../runtime/source.js";
import type { ListRunsFilter, RunStore } from "../store/run-store.js";

export const CreateRunInputSchema = z
  .object({
    projectRoot: z.string().trim().min(1),
    baseCommit: GitObjectIdSchema.optional(),
    sources: z.array(SourceRefSchema).default([]),
  })
  .strict();

export const GetRunInputSchema = z
  .object({
    runId: RunIdSchema,
  })
  .strict();

export const ListRunsInputSchema = z
  .object({
    status: RunStatusSchema.optional(),
    limit: z.number().int().positive().max(500).default(50),
  })
  .strict();

export type CreateRunInput = z.infer<typeof CreateRunInputSchema>;
export type GetRunInput = z.infer<typeof GetRunInputSchema>;
export type ListRunsInput = z.infer<typeof ListRunsInputSchema>;

export type RunServiceOptions = {
  pluginVersion: string;
  now?: () => string;
  newRunId?: () => RunId;
};

export class RunService {
  private readonly now: () => string;
  private readonly newRunId: () => RunId;

  public constructor(
    private readonly store: RunStore,
    private readonly options: RunServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.newRunId = options.newRunId ?? createRunId;
  }

  public async createRun(rawInput: unknown): Promise<RunSummary> {
    const input = CreateRunInputSchema.parse(rawInput);
    const projectRoot = await canonicalDirectory(input.projectRoot);

    const run = createInitialRun(
      {
        ...(input.baseCommit === undefined ? {} : { baseCommit: input.baseCommit }),
        sources: input.sources,
      },
      {
        id: this.newRunId(),
        pluginVersion: this.options.pluginVersion,
        projectRoot,
        now: this.now(),
      },
    );

    await this.store.create(run);

    return summarizeRun(run);
  }

  public async getRun(rawInput: unknown): Promise<RunManifest> {
    const input = GetRunInputSchema.parse(rawInput);
    const run = await this.store.get(input.runId);

    return RunManifestSchema.parse(run);
  }

  public async listRuns(rawInput: unknown): Promise<RunSummary[]> {
    const input = ListRunsInputSchema.parse(rawInput);

    const filter: ListRunsFilter = {
      limit: input.limit,
      ...(input.status === undefined ? {} : { status: input.status }),
    };

    return this.store.list(filter);
  }

  public async close(): Promise<void> {
    await this.store.close();
  }
}

export function createRunId(): RunId {
  return RunIdSchema.parse(`run_${randomUUID().replaceAll("-", "")}`);
}

async function canonicalDirectory(rawPath: string): Promise<string> {
  const absolute = path.resolve(rawPath);
  const canonical = await realpath(absolute);
  const metadata = await stat(canonical);

  if (!metadata.isDirectory()) {
    throw new Error(`Project root is not a directory: ${canonical}`);
  }

  return canonical;
}
