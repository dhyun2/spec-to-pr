import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

import { z } from "zod";

import { RunIdSchema, type RunId } from "./ids.js";
import { IsoDateTimeSchema, Sha256DigestSchema, type Sha256Digest } from "./scalars.js";

export const RuntimeMetricNameSchema = z.enum([
  "stage.wall_ms",
  "external_action.wall_ms",
  "artifact.read_count",
  "artifact.read_bytes",
  "artifact.write_count",
  "artifact.write_bytes",
  "artifact.hash_count",
  "run_store.get_count",
  "run_store.save_count",
  "run_store.serialized_bytes",
  "status.serialized_bytes",
  "legacy.file_read_count",
  "legacy.parse_count",
  "legacy.rebuild_count",
  "git.command_count",
  "git.binary_diff_bytes",
  "visual.decode_pixels",
  "visual.encode_pixels",
  "visual.active_workers",
  "visual.peak_workers",
  "visual.reservation_committed",
  "visual.reservation_aborted",
  "visual.reservation_stale",
  "visual.normalization_cache_hit",
  "visual.normalization_cache_miss",
  "publisher.http_count",
  "publisher.retry_count",
  "review.wall_ms",
  "review.invalidated_wall_ms",
]);

export type RuntimeMetricName = z.infer<typeof RuntimeMetricNameSchema>;

const RuntimeMetricStageSchema = z.enum([
  "intake",
  "contracts",
  "implementation",
  "functional-review",
  "design-review",
  "report",
  "publish",
  "archive",
]);
const RuntimeMetricActionSchema = z.enum([
  "start",
  "advance",
  "submit",
  "status",
  "publish",
  "archive",
  "external",
]);
const RuntimeMetricHostSchema = z.enum(["github", "gitlab", "local"]);
const RuntimeMetricOutcomeSchema = z.enum([
  "success",
  "error",
  "ready",
  "blocked",
  "reserved",
  "committed",
  "aborted",
  "stale",
  "busy",
  "replay",
]);
const RuntimeMetricCacheSchema = z.enum(["hit", "miss"]);
const RuntimeMetricViewSchema = z.enum(["status", "tool-result"]);

export const RuntimeMetricTagsSchema = z
  .object({
    stage: RuntimeMetricStageSchema.optional(),
    action: RuntimeMetricActionSchema.optional(),
    host: RuntimeMetricHostSchema.optional(),
    outcome: RuntimeMetricOutcomeSchema.optional(),
    cache: RuntimeMetricCacheSchema.optional(),
    view: RuntimeMetricViewSchema.optional(),
  })
  .strict();

export type RuntimeMetricTags = z.infer<typeof RuntimeMetricTagsSchema>;

export interface RuntimeMetricsSink {
  increment(name: RuntimeMetricName, value?: number, tags?: RuntimeMetricTags): void;
  gauge(name: RuntimeMetricName, value: number, tags?: RuntimeMetricTags): void;
  time<T>(
    name: RuntimeMetricName,
    tags: RuntimeMetricTags,
    operation: () => Promise<T>,
  ): Promise<T>;
}

const RuntimePerformanceSampleSchema = z
  .object({
    kind: z.enum(["counter", "gauge"]),
    name: RuntimeMetricNameSchema,
    tags: RuntimeMetricTagsSchema,
    value: z.number().finite().nonnegative(),
  })
  .strict();

export type RuntimePerformanceSample = z.infer<typeof RuntimePerformanceSampleSchema>;

export const RuntimePerformanceSnapshotSchema = z
  .object({
    schemaVersion: z.literal("runtime-performance-v1"),
    runId: RunIdSchema,
    fixtureDigest: Sha256DigestSchema,
    collectedAt: IsoDateTimeSchema,
    samples: z.array(RuntimePerformanceSampleSchema),
  })
  .strict();

export type RuntimePerformanceSnapshot = z.infer<typeof RuntimePerformanceSnapshotSchema>;

export class NoopRuntimeMetrics implements RuntimeMetricsSink {
  public increment(_name: RuntimeMetricName, _value?: number, _tags?: RuntimeMetricTags): void {}

  public gauge(_name: RuntimeMetricName, _value: number, _tags?: RuntimeMetricTags): void {}

  public async time<T>(
    _name: RuntimeMetricName,
    _tags: RuntimeMetricTags,
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }
}

type RuntimeMetricsRecorderOptions = {
  now?: () => number;
};

export class RuntimeMetricsRecorder implements RuntimeMetricsSink {
  private readonly samplesByRun = new Map<string, Map<string, RuntimePerformanceSample>>();
  private readonly unscopedSamples = new Map<string, RuntimePerformanceSample>();
  private readonly runScope = new AsyncLocalStorage<RunId>();
  private readonly now: () => number;

  public constructor(options: RuntimeMetricsRecorderOptions = {}) {
    this.now = options.now ?? performance.now.bind(performance);
  }

  public increment(name: RuntimeMetricName, value = 1, tags: RuntimeMetricTags = {}): void {
    const parsedName = RuntimeMetricNameSchema.parse(name);
    const parsedTags = RuntimeMetricTagsSchema.parse(tags);
    const parsedValue = metricValue(value);
    const key = sampleKey("counter", parsedName, parsedTags);
    const samples = this.currentSamples();
    const current = samples.get(key);

    samples.set(key, {
      kind: "counter",
      name: parsedName,
      tags: parsedTags,
      value: (current?.value ?? 0) + parsedValue,
    });
  }

  public gauge(name: RuntimeMetricName, value: number, tags: RuntimeMetricTags = {}): void {
    const parsedName = RuntimeMetricNameSchema.parse(name);
    const parsedTags = RuntimeMetricTagsSchema.parse(tags);
    const parsedValue = metricValue(value);

    this.currentSamples().set(sampleKey("gauge", parsedName, parsedTags), {
      kind: "gauge",
      name: parsedName,
      tags: parsedTags,
      value: parsedValue,
    });
  }

  public async withRun<T>(runId: RunId, operation: () => Promise<T>): Promise<T> {
    const parsedRunId = RunIdSchema.parse(runId);
    return this.runScope.run(parsedRunId, operation);
  }

  public async time<T>(
    name: RuntimeMetricName,
    tags: RuntimeMetricTags,
    operation: () => Promise<T>,
  ): Promise<T> {
    const startedAt = this.now();
    try {
      return await operation();
    } finally {
      this.increment(name, this.now() - startedAt, tags);
    }
  }

  public snapshot(input: {
    runId: RunId;
    fixtureDigest: Sha256Digest;
    collectedAt: string;
  }): RuntimePerformanceSnapshot {
    return RuntimePerformanceSnapshotSchema.parse({
      schemaVersion: "runtime-performance-v1",
      runId: input.runId,
      fixtureDigest: input.fixtureDigest,
      collectedAt: input.collectedAt,
      samples: [...(this.samplesByRun.get(input.runId) ?? this.unscopedSamples).values()].sort(
        (left, right) =>
          sampleKey(left.kind, left.name, left.tags).localeCompare(
            sampleKey(right.kind, right.name, right.tags),
          ),
      ),
    });
  }

  private currentSamples(): Map<string, RuntimePerformanceSample> {
    const runId = this.runScope.getStore();
    if (runId === undefined) return this.unscopedSamples;
    let samples = this.samplesByRun.get(runId);
    if (samples === undefined) {
      samples = new Map();
      this.samplesByRun.set(runId, samples);
    }
    return samples;
  }
}

function metricValue(value: number): number {
  return z.number().finite().nonnegative().parse(value);
}

function sampleKey(
  kind: RuntimePerformanceSample["kind"],
  name: RuntimeMetricName,
  tags: RuntimeMetricTags,
): string {
  return `${kind}:${name}:${JSON.stringify(Object.fromEntries(Object.entries(tags).sort(([left], [right]) => left.localeCompare(right))))}`;
}
