import { describe, expect, it } from "vitest";

import {
  NoopRuntimeMetrics,
  RuntimeMetricsRecorder,
  RuntimePerformanceSnapshotSchema,
} from "../../src/runtime/performance-instrumentation.js";

const runId = "run_00000000000000000000000000000000";
const fixtureDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const collectedAt = "2026-07-28T00:00:00.000Z";

describe("RuntimeMetricsRecorder", () => {
  it("records a secret-free, schema-valid deterministic snapshot", async () => {
    // Catches a recorder that leaks supplied tag values or emits events in insertion order.
    let tick = 0;
    const recorder = new RuntimeMetricsRecorder({ now: () => ++tick * 10 });

    recorder.increment("artifact.read_count", 2, { stage: "intake" });
    recorder.increment("artifact.read_bytes", 64, { stage: "intake" });
    await recorder.time("stage.wall_ms", { stage: "intake", outcome: "success" }, async () => {
      await recorder.time(
        "external_action.wall_ms",
        { action: "external", outcome: "success" },
        async () => undefined,
      );
    });
    recorder.gauge("visual.active_workers", 1, { stage: "report" });
    recorder.gauge("visual.peak_workers", 1, { stage: "report" });
    recorder.gauge("visual.active_workers", 0, { stage: "report" });

    const snapshot = recorder.snapshot({ runId, fixtureDigest, collectedAt });

    expect(RuntimePerformanceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /token|authorization|password|https?:\/\/[^\"]*[?#]|\/Users\//i,
    );
    expect(snapshot.samples).toEqual([
      {
        kind: "counter",
        name: "artifact.read_bytes",
        tags: { stage: "intake" },
        value: 64,
      },
      {
        kind: "counter",
        name: "artifact.read_count",
        tags: { stage: "intake" },
        value: 2,
      },
      {
        kind: "counter",
        name: "external_action.wall_ms",
        tags: { action: "external", outcome: "success" },
        value: 10,
      },
      {
        kind: "counter",
        name: "stage.wall_ms",
        tags: { outcome: "success", stage: "intake" },
        value: 30,
      },
      {
        kind: "gauge",
        name: "visual.active_workers",
        tags: { stage: "report" },
        value: 0,
      },
      {
        kind: "gauge",
        name: "visual.peak_workers",
        tags: { stage: "report" },
        value: 1,
      },
    ]);
  });

  it("rejects tags outside the low-cardinality schema", () => {
    // Catches accepting user-controlled identifiers as metric labels.
    const recorder = new RuntimeMetricsRecorder();

    expect(() =>
      recorder.increment("artifact.read_count", 1, { stage: "intake", runId } as never),
    ).toThrow(/unrecognized key/i);
    expect(() =>
      recorder.increment("artifact.read_count", 1, { stage: "unbounded" } as never),
    ).toThrow(/invalid option/i);
  });

  it("provides a no-op sink compatible with every metric operation", async () => {
    // Catches the optional default path changing an operation's result or throwing.
    const sink = new NoopRuntimeMetrics();
    sink.increment("artifact.read_count");
    sink.gauge("visual.active_workers", 0);

    await expect(
      sink.time("stage.wall_ms", { stage: "intake" }, async () => "preserved"),
    ).resolves.toBe("preserved");
  });
});
