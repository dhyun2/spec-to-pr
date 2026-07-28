import os from "node:os";
import { performance } from "node:perf_hooks";

import { afterAll, bench, describe } from "vitest";

import { RuntimeMetricsRecorder } from "../../src/runtime/performance-instrumentation.js";
import { sha256Digest } from "../../src/source-registry/content-hash.js";

const collectedAt = "2026-07-28T00:00:00.000Z";
const samples: number[] = [];
let peakRss = process.memoryUsage().rss;

const fixtures = {
  mixedIntake: {
    localDocuments: Array.from({ length: 20 }, (_, index) => ({
      path: `docs/document-${String(index + 1).padStart(2, "0")}.md`,
      content: `# Document ${String(index + 1)}\nDeterministic local intake fixture.\n`,
    })),
    parserSafeChunks: Array.from(
      { length: 4 },
      (_, index) => `Parser-safe chunk ${String(index + 1)} with bounded content.`,
    ),
    openApiSources: Array.from({ length: 4 }, (_, index) => ({
      path: `openapi/service-${String(index + 1)}.json`,
      operationId: `getDeterministic${String(index + 1)}`,
    })),
  },
  legacy: {
    files: Array.from({ length: 250 }, (_, index) => ({
      path: `legacy/${index % 2 === 0 ? "components" : "views"}/file-${String(index + 1).padStart(3, "0")}.${index % 2 === 0 ? "vue" : "js"}`,
      adapter: `shared-adapter-${String(index % 5)}`,
    })),
    terminalApiCalls: Array.from(
      { length: 40 },
      (_, index) => `GET /api/deterministic/${String(index + 1)}`,
    ),
  },
  visual: {
    targets: ["first", "second"].map((targetId) => ({ targetId, width: 360, height: 1831 })),
    comparisons: ["default", "empty", "loaded"],
  },
} as const;

const fixtureDigest = sha256Digest(Buffer.from(JSON.stringify(fixtures)));

function measureFixture(
  runId: `run_${string}`,
  operation: (recorder: RuntimeMetricsRecorder) => void,
) {
  const recorder = new RuntimeMetricsRecorder();
  const started = performance.now();
  operation(recorder);
  const elapsed = performance.now() - started;
  samples.push(elapsed);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  return recorder.snapshot({ runId, fixtureDigest, collectedAt });
}

describe("runtime reduction fixtures", () => {
  bench(
    "mixed intake: 20 local documents, 4 parser-safe chunks, 4 OpenAPI sources",
    () => {
      measureFixture("run_11111111111111111111111111111111", (recorder) => {
        recorder.increment("artifact.read_count", fixtures.mixedIntake.localDocuments.length);
        recorder.increment(
          "artifact.read_bytes",
          Buffer.byteLength(JSON.stringify(fixtures.mixedIntake)),
        );
        recorder.increment("legacy.parse_count", fixtures.mixedIntake.parserSafeChunks.length);
      });
    },
    { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 },
  );

  bench(
    "legacy: 250 JS/Vue files, shared adapters, 40 terminal API calls",
    () => {
      measureFixture("run_22222222222222222222222222222222", (recorder) => {
        recorder.increment("legacy.file_read_count", fixtures.legacy.files.length);
        recorder.increment("legacy.parse_count", fixtures.legacy.files.length);
        recorder.increment("legacy.rebuild_count");
        recorder.increment(
          "artifact.read_bytes",
          Buffer.byteLength(JSON.stringify(fixtures.legacy)),
        );
      });
    },
    { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 },
  );

  bench(
    "visual: two 360x1831 targets across three valid comparisons",
    () => {
      measureFixture("run_33333333333333333333333333333333", (recorder) => {
        const pixels = fixtures.visual.targets.reduce(
          (total, target) => total + target.width * target.height,
          0,
        );
        recorder.increment("visual.decode_pixels", pixels * fixtures.visual.comparisons.length);
        recorder.increment("visual.encode_pixels", pixels * fixtures.visual.comparisons.length);
        recorder.gauge("visual.active_workers", 0, { stage: "implementation" });
        recorder.gauge("visual.peak_workers", fixtures.visual.comparisons.length, {
          stage: "implementation",
        });
      });
    },
    { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 },
  );
});

afterAll(() => {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (percent: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percent) - 1)] ?? 0;
  console.info(
    JSON.stringify({
      schemaVersion: "runtime-reduction-benchmark-v1",
      fixtureDigest,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpuCount: os.cpus().length,
      warmupIterations: 1,
      measuredIterations: 5,
      p50WallMs: percentile(0.5),
      p95WallMs: percentile(0.95),
      peakRssBytes: peakRss,
      metricCounters: {
        mixedIntakeDocuments: fixtures.mixedIntake.localDocuments.length,
        legacyFiles: fixtures.legacy.files.length,
        legacyTerminalApiCalls: fixtures.legacy.terminalApiCalls.length,
        visualComparisons: fixtures.visual.comparisons.length,
      },
    }),
  );
});
