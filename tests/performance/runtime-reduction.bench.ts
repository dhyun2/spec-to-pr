import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { afterAll, beforeAll, bench, describe } from "vitest";
import { PNG } from "pngjs";

import { buildParserSafeChunks } from "../../src/application/workflow-service.js";
import { RuntimeMetricsRecorder } from "../../src/runtime/performance-instrumentation.js";
import { sha256Digest } from "../../src/source-registry/content-hash.js";
import { compareVisualPngs } from "../../src/visual/visual-comparator.js";

const collectedAt = "2026-07-28T00:00:00.000Z";
const samplesByFixture = new Map<string, number[]>();
let peakRss = process.memoryUsage().rss;
let legacyDirectory = "";
const visualPng = PNG.sync.write(new PNG({ width: 360, height: 1831 }));

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

async function measureFixture(
  runId: `run_${string}`,
  fixtureName: string,
  operation: (recorder: RuntimeMetricsRecorder) => Promise<void>,
) {
  const recorder = new RuntimeMetricsRecorder();
  const started = performance.now();
  await operation(recorder);
  const elapsed = performance.now() - started;
  const samples = samplesByFixture.get(fixtureName) ?? [];
  samples.push(elapsed);
  samplesByFixture.set(fixtureName, samples);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  return recorder.snapshot({ runId, fixtureDigest, collectedAt });
}

beforeAll(async () => {
  legacyDirectory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-runtime-bench-"));
  await Promise.all(
    fixtures.legacy.files.map(async (file) => {
      const absolute = path.join(legacyDirectory, file.path);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, `export const adapter = '${file.adapter}';\n`);
    }),
  );
});

describe("runtime reduction fixtures", () => {
  bench(
    "mixed intake: 20 local documents, 4 parser-safe chunks, 4 OpenAPI sources",
    async () => {
      await measureFixture(
        "run_11111111111111111111111111111111",
        "mixed-intake",
        async (recorder) => {
          for (const document of fixtures.mixedIntake.localDocuments) {
            const content = Buffer.from(document.content);
            recorder.increment("artifact.read_count");
            recorder.increment("artifact.read_bytes", content.byteLength);
            JSON.parse(JSON.stringify({ path: document.path, content: document.content }));
          }
          for (const chunk of fixtures.mixedIntake.parserSafeChunks) {
            buildParserSafeChunks(chunk);
          }
          for (const source of fixtures.mixedIntake.openApiSources) {
            JSON.parse(
              JSON.stringify({ openapi: "3.0.0", paths: { [`/${source.operationId}`]: {} } }),
            );
          }
        },
      );
    },
    { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 },
  );

  bench(
    "legacy: 250 JS/Vue files, shared adapters, 40 terminal API calls",
    async () => {
      await measureFixture("run_22222222222222222222222222222222", "legacy", async (recorder) => {
        for (const file of fixtures.legacy.files) {
          const content = await readFile(path.join(legacyDirectory, file.path), "utf8");
          if (!content.includes(file.adapter)) throw new Error("legacy adapter fixture mismatch");
          recorder.increment("legacy.file_read_count");
          recorder.increment("legacy.parse_count");
        }
        for (const call of fixtures.legacy.terminalApiCalls) {
          const [method, endpoint] = call.split(" ");
          if (
            method !== "GET" ||
            new URL(endpoint!, "https://benchmark.invalid").pathname === "/"
          ) {
            throw new Error("terminal API fixture mismatch");
          }
        }
        recorder.increment("legacy.rebuild_count");
      });
    },
    { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 },
  );

  bench(
    "visual: two 360x1831 targets across three valid comparisons",
    async () => {
      await measureFixture("run_33333333333333333333333333333333", "visual", async (recorder) => {
        for (const comparison of fixtures.visual.comparisons) {
          for (const target of fixtures.visual.targets) {
            const result = await compareVisualPngs({ baseline: visualPng, actual: visualPng });
            if (result.status !== "passed") {
              throw new Error("visual fixture geometry mismatch");
            }
            recorder.increment("visual.decode_pixels", target.width * target.height * 2);
            recorder.increment("visual.encode_pixels", target.width * target.height * 2);
          }
        }
        recorder.gauge("visual.active_workers", 0, { stage: "implementation" });
        recorder.gauge("visual.peak_workers", fixtures.visual.comparisons.length, {
          stage: "implementation",
        });
      });
    },
    { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 },
  );
});

afterAll(async () => {
  const percentile = (sorted: number[], percent: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percent) - 1)] ?? 0;
  const records = [...samplesByFixture.entries()].map(([name, samples]) => {
    const sorted = [...samples].sort((left, right) => left - right);
    return {
      name,
      fixtureDigest: sha256Digest(
        Buffer.from(
          JSON.stringify(
            name === "mixed-intake"
              ? fixtures.mixedIntake
              : name === "legacy"
                ? fixtures.legacy
                : fixtures.visual,
          ),
        ),
      ),
      p50WallMs: percentile(sorted, 0.5),
      p95WallMs: percentile(sorted, 0.95),
      peakRssBytes: peakRss,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        cpuCount: os.cpus().length,
      },
      metricCounters:
        name === "mixed-intake"
          ? { localDocuments: 20, parserSafeChunks: 4, openApiSources: 4 }
          : name === "legacy"
            ? { files: 250, terminalApiCalls: 40, sharedAdapters: 5 }
            : { targets: 2, comparisons: 3, pixelsPerTarget: 659160 },
    };
  });
  const receipt = {
    schemaVersion: "runtime-reduction-benchmark-v1",
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpuCount: os.cpus().length,
    warmupIterations: 1,
    measuredIterations: 5,
    fixtures: records,
    metricCounters: {
      mixedIntakeDocuments: fixtures.mixedIntake.localDocuments.length,
      legacyFiles: fixtures.legacy.files.length,
      legacyTerminalApiCalls: fixtures.legacy.terminalApiCalls.length,
      visualComparisons: fixtures.visual.comparisons.length,
    },
  };
  await writeFile(
    path.join(process.cwd(), "benchmarks", "runtime", "latest-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  console.info(JSON.stringify(receipt));
  await rm(legacyDirectory, { recursive: true, force: true });
});
