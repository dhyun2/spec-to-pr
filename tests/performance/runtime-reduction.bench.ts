import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { afterAll, beforeAll, bench, describe } from "vitest";
import { PNG } from "pngjs";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { IntakeRequestService } from "../../src/application/intake-request-service.js";
import { RunService } from "../../src/application/run-service.js";
import { StageService } from "../../src/application/stage-service.js";
import { WorkflowService } from "../../src/application/workflow-service.js";
import {
  assertLegacyInventoryFresh,
  buildLegacyInventory,
} from "../../src/legacy/legacy-inventory.js";
import {
  LegacySourceCache,
  type LegacySourceCacheStats,
} from "../../src/legacy/legacy-source-cache.js";
import { RuntimeMetricsRecorder } from "../../src/runtime/performance-instrumentation.js";
import { sha256Digest } from "../../src/source-registry/content-hash.js";
import { SourceSnapshotStore } from "../../src/source-registry/snapshot-store.js";
import { orderedConcurrentMap } from "../../src/source-ingestion/source-loader.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";
import { compareVisualPngs } from "../../src/visual/visual-comparator.js";

const collectedAt = "2026-07-28T00:00:00.000Z";
const samplesByFixture = new Map<string, number[]>();
const measuredMixedIntakeRunSaves: number[] = [];
const measuredMixedIntakeMaxSourceConcurrency: number[] = [];
const measuredLegacyCounters: Array<{
  coldReads: number;
  coldParses: number;
  warmReads: number;
  warmParses: number;
  warmRebuilds: number;
  changeReads: number;
  changeParses: number;
  changeRebuilds: number;
}> = [];
let peakRss = process.memoryUsage().rss;
let legacyDirectory = "";
let statusDirectory = "";
let statusStore: SqliteRunStore;
let statusRunId: `run_${string}`;
let statusDetailBytes = 0;
const measuredStatusActionBytes: number[] = [];
const measuredStatusArtifactReads: number[] = [];
const measuredMutatingInventoryReads: number[] = [];
const measuredMutatingStartBytes: number[] = [];
const measuredMutatingAdvanceBytes: number[] = [];
const measuredMutatingSubmitBytes: number[] = [];
let mutatingIteration = 0;
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
  status: {
    view: "action",
    legacyFiles: 250,
    maximumDetailRatio: 0.25,
    maximumInventoryReads: 0,
  },
  mutatingStatus: {
    views: ["start", "advance", "submit"],
    legacyFiles: 250,
    maximumInventoryReads: 0,
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

function subtractLegacyStats(
  after: Readonly<LegacySourceCacheStats>,
  before: Readonly<LegacySourceCacheStats>,
): LegacySourceCacheStats {
  return {
    fileReads: after.fileReads - before.fileReads,
    astParses: after.astParses - before.astParses,
    semanticRebuilds: after.semanticRebuilds - before.semanticRebuilds,
  };
}

beforeAll(async () => {
  legacyDirectory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-runtime-bench-"));
  await Promise.all(
    fixtures.legacy.files.map(async (file) => {
      const absolute = path.join(legacyDirectory, file.path);
      await mkdir(path.dirname(absolute), { recursive: true });
      const index = fixtures.legacy.files.indexOf(file);
      const endpoint =
        index < fixtures.legacy.terminalApiCalls.length
          ? `\nexport const load${index} = () => fetch("/api/deterministic/${index + 1}");`
          : "";
      const script = `export const adapter = '${file.adapter}';${endpoint}\n`;
      await writeFile(
        absolute,
        file.path.endsWith(".vue") ? `<script>${script}</script><template />\n` : script,
      );
    }),
  );
  statusDirectory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-status-bench-"));
  statusStore = new SqliteRunStore(path.join(statusDirectory, "runs.sqlite3"));
  const statusArtifactStore = new ArtifactBlobStore(path.join(statusDirectory, "artifacts"));
  const statusService = new WorkflowService({
    runStore: statusStore,
    artifactStore: statusArtifactStore,
    runService: new RunService(statusStore, {
      pluginVersion: "benchmark",
      now: () => collectedAt,
    }),
    intakeRequestService: new IntakeRequestService(
      statusStore,
      new SourceSnapshotStore(path.join(statusDirectory, "source-snapshots")),
      statusArtifactStore,
      () => collectedAt,
    ),
    stageService: new StageService(statusStore, () => collectedAt),
    now: () => collectedAt,
  });
  const statusDetail = await statusService.start({
    projectRoot: statusDirectory,
    legacyProjectRoot: legacyDirectory,
    requestText: "Measure compact status for the deterministic legacy fixture.",
    mode: "legacy",
    changeKind: "migration",
    publication: "none",
  });
  statusRunId = statusDetail.runId as `run_${string}`;
  statusDetailBytes = Buffer.byteLength(JSON.stringify(statusDetail), "utf8");
});

describe("runtime reduction fixtures", () => {
  bench(
    "mixed intake: 20 local documents, 4 parser-safe chunks, 4 OpenAPI sources",
    async () => {
      const metricRunId = "run_11111111111111111111111111111111";
      let maxSourceConcurrency = 0;
      const snapshot = await measureFixture(
        "run_11111111111111111111111111111111",
        "mixed-intake",
        async (recorder) =>
          recorder.withRun(metricRunId, async () => {
            const directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-intake-bench-"));
            await Promise.all(
              fixtures.mixedIntake.localDocuments.map(async (document) => {
                const absolutePath = path.join(directory, document.path);
                await mkdir(path.dirname(absolutePath), { recursive: true });
                await writeFile(absolutePath, document.content);
              }),
            );
            let activeSourceLoads = 0;
            const loadedDocuments = await orderedConcurrentMap(
              fixtures.mixedIntake.localDocuments,
              4,
              async (document) => {
                activeSourceLoads += 1;
                maxSourceConcurrency = Math.max(maxSourceConcurrency, activeSourceLoads);
                try {
                  return {
                    ...document,
                    content: await readFile(path.join(directory, document.path), "utf8"),
                  };
                } finally {
                  activeSourceLoads -= 1;
                }
              },
            );
            const databasePath = path.join(directory, "runs.sqlite3");
            const setupStore = new SqliteRunStore(databasePath);
            const runService = new RunService(setupStore, {
              pluginVersion: "benchmark",
              now: () => collectedAt,
              newRunId: () => metricRunId,
            });
            const run = await runService.createRun({ projectRoot: directory });
            await setupStore.close();
            const store = new SqliteRunStore(databasePath, recorder);
            try {
              const intakeService = new IntakeRequestService(
                store,
                new SourceSnapshotStore(path.join(directory, "source-snapshots")),
                new ArtifactBlobStore(path.join(directory, "artifacts"), recorder),
                () => collectedAt,
              );
              await intakeService.parseIntakeRequest({
                runId: run.id,
                requestText: "Process the deterministic mixed intake fixture.",
                label: "user-request",
              });
              const requests = [
                ...loadedDocuments.map((document) => ({
                  requestText: document.content,
                  label: `docs:${document.path}`,
                })),
                ...fixtures.mixedIntake.parserSafeChunks.map((chunk, index) => ({
                  requestText: chunk,
                  label: `docs:chunk-${index + 1}`,
                })),
                ...fixtures.mixedIntake.openApiSources.map((source) => ({
                  requestText: `\`\`\`json\n${JSON.stringify({
                    openapi: "3.0.0",
                    paths: {
                      [`/${source.operationId}`]: {
                        get: { operationId: source.operationId },
                      },
                    },
                  })}\n\`\`\``,
                  label: `openapi:${source.path}`,
                })),
              ];
              const results = await intakeService.parseIntakeRequests({
                runId: run.id,
                requests,
              });
              const resultLabels = results.map((result) =>
                result.source.locator.type === "inline" ? result.source.locator.label : "",
              );
              if (resultLabels.some((label, index) => label !== requests[index]?.label)) {
                throw new Error("mixed intake result order mismatch");
              }
            } finally {
              await store.close();
              await rm(directory, { recursive: true, force: true });
            }
          }),
      );
      const totalRunSaves = snapshot.samples.find(
        (sample) => sample.kind === "counter" && sample.name === "run_store.save_count",
      )?.value;
      if (totalRunSaves === undefined) {
        throw new Error("mixed intake benchmark did not record actual Run saves");
      }
      measuredMixedIntakeMaxSourceConcurrency.push(maxSourceConcurrency);
      measuredMixedIntakeRunSaves.push(totalRunSaves);
    },
    { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 },
  );

  bench(
    "legacy: 250 JS/Vue files, shared adapters, 40 terminal API calls",
    async () => {
      await measureFixture("run_22222222222222222222222222222222", "legacy", async () => {
        const sourceCache = new LegacySourceCache();
        const pinned = await buildLegacyInventory(legacyDirectory, {}, { sourceCache });
        if (pinned.apiCandidates.length !== fixtures.legacy.terminalApiCalls.length) {
          throw new Error("legacy terminal API fixture mismatch");
        }
        const cold = sourceCache.snapshotStats();

        const warm = await assertLegacyInventoryFresh(legacyDirectory, pinned, {
          sourceCache,
        });
        if (warm !== pinned)
          throw new Error("legacy warm freshness did not reuse pinned inventory");
        const afterWarm = sourceCache.snapshotStats();
        const warmStats = subtractLegacyStats(afterWarm, cold);

        const changedPath = path.join(legacyDirectory, fixtures.legacy.files[125]!.path);
        const original = await readFile(changedPath, "utf8");
        await writeFile(changedPath, `${original} `, "utf8");
        try {
          await assertLegacyInventoryFresh(legacyDirectory, pinned, {
            sourceCache,
          });
          throw new Error("legacy one-byte mutation was not detected");
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("LEGACY_SOURCE_CHANGED")) {
            throw error;
          }
        } finally {
          await writeFile(changedPath, original, "utf8");
        }
        const changed = subtractLegacyStats(sourceCache.snapshotStats(), afterWarm);
        measuredLegacyCounters.push({
          coldReads: cold.fileReads,
          coldParses: cold.astParses,
          warmReads: warmStats.fileReads,
          warmParses: warmStats.astParses,
          warmRebuilds: warmStats.semanticRebuilds,
          changeReads: changed.fileReads,
          changeParses: changed.astParses,
          changeRebuilds: changed.semanticRebuilds,
        });
      });
    },
    { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 },
  );

  bench(
    "status action: compact projection for the 250-file legacy Run",
    async () => {
      const snapshot = await measureFixture(statusRunId, "status-action", async (recorder) => {
        const artifactStore = new ArtifactBlobStore(
          path.join(statusDirectory, "artifacts"),
          recorder,
        );
        const service = new WorkflowService({
          runStore: statusStore,
          artifactStore,
          runService: new RunService(statusStore, {
            pluginVersion: "benchmark",
            now: () => collectedAt,
          }),
          intakeRequestService: new IntakeRequestService(
            statusStore,
            new SourceSnapshotStore(path.join(statusDirectory, "source-snapshots")),
            artifactStore,
            () => collectedAt,
          ),
          stageService: new StageService(statusStore, () => collectedAt),
          now: () => collectedAt,
          metrics: recorder,
        });
        const action = await service.status({ runId: statusRunId, view: "action" });
        measuredStatusActionBytes.push(Buffer.byteLength(JSON.stringify(action), "utf8"));
      });
      measuredStatusArtifactReads.push(
        snapshot.samples.find(
          (sample) => sample.kind === "counter" && sample.name === "artifact.read_count",
        )?.value ?? 0,
      );
    },
    { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 },
  );

  bench(
    "mutating action hot path: start, advance, and submit for a 250-file legacy Run",
    async () => {
      mutatingIteration += 1;
      const runId = `run_${mutatingIteration.toString(16).padStart(32, "0")}` as `run_${string}`;
      await measureFixture(runId, "mutating-action", async (recorder) => {
        const artifactStore = new ArtifactBlobStore(
          path.join(statusDirectory, "artifacts"),
          recorder,
        );
        const readDigests: string[] = [];
        const readContent = artifactStore.readContent.bind(artifactStore);
        artifactStore.readContent = async (digest) => {
          readDigests.push(digest);
          return readContent(digest);
        };
        const service = new WorkflowService({
          runStore: statusStore,
          artifactStore,
          runService: new RunService(statusStore, {
            pluginVersion: "benchmark",
            now: () => collectedAt,
            newRunId: () => runId,
          }),
          intakeRequestService: new IntakeRequestService(
            statusStore,
            new SourceSnapshotStore(path.join(statusDirectory, "source-snapshots")),
            artifactStore,
            () => collectedAt,
          ),
          stageService: new StageService(statusStore, () => collectedAt),
          now: () => collectedAt,
          metrics: recorder,
        });
        const started = await service.start(
          {
            projectRoot: statusDirectory,
            legacyProjectRoot: legacyDirectory,
            requestText: "Measure compact mutating action responses.",
            mode: "legacy",
            changeKind: "migration",
            publication: "none",
          },
          "action",
        );
        if (started.view !== "action") {
          throw new Error(`mutating start returned ${started.view} instead of action`);
        }
        const run = await statusStore.get(runId);
        const inventoryDigest = run.artifacts.find(
          (artifact) => artifact.kind === "legacy-feature-inventory",
        )?.digest;
        if (inventoryDigest === undefined) throw new Error("mutating benchmark inventory missing");
        const advanced = await service.advance({ runId }, "action");
        if (advanced.view !== "action") {
          throw new Error(`mutating advance returned ${advanced.view} instead of action`);
        }
        const submitted = await service.submit(
          {
            runId,
            submission: {
              kind: "contracts",
              status: "blocked",
              summary: "Approval is required.",
              blocker: {
                stage: "contracts",
                code: "MISSING_APPROVAL",
                kind: "missing-input",
                summary: "Approval is required.",
                retryable: false,
                resumable: true,
                completedWork: ["Legacy intake passed."],
                evidencePaths: [],
                attemptedRecovery: [],
                unrunValidations: ["functional"],
                exactUnblockAction: "Provide approval.",
              },
            },
          },
          "action",
        );
        if (submitted.view !== "action") {
          throw new Error(`mutating submit returned ${submitted.view} instead of action`);
        }
        measuredMutatingInventoryReads.push(
          readDigests.filter((digest) => digest === inventoryDigest).length,
        );
        measuredMutatingStartBytes.push(Buffer.byteLength(JSON.stringify(started), "utf8"));
        measuredMutatingAdvanceBytes.push(Buffer.byteLength(JSON.stringify(advanced), "utf8"));
        measuredMutatingSubmitBytes.push(Buffer.byteLength(JSON.stringify(submitted), "utf8"));
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
  const observedMixedIntakeMaxSourceConcurrency = [
    ...new Set(measuredMixedIntakeMaxSourceConcurrency),
  ];
  if (
    observedMixedIntakeMaxSourceConcurrency.length !== 1 ||
    observedMixedIntakeMaxSourceConcurrency[0] !== 4
  ) {
    throw new Error(
      "mixed intake source concurrency must be four and derived from the production pool",
    );
  }
  if (
    measuredMutatingInventoryReads.some(
      (reads) => reads !== fixtures.mutatingStatus.maximumInventoryReads,
    )
  ) {
    throw new Error(
      `mutating action hot path read inventory blobs: ${JSON.stringify(measuredMutatingInventoryReads)}`,
    );
  }
  for (const [name, samples] of [
    ["start", measuredMutatingStartBytes],
    ["advance", measuredMutatingAdvanceBytes],
    ["submit", measuredMutatingSubmitBytes],
  ] as const) {
    if (new Set(samples).size !== 1 || samples[0] === undefined) {
      throw new Error(`mutating ${name} serialized bytes must be deterministic`);
    }
  }
  const mixedIntakeMaxSourceConcurrency = observedMixedIntakeMaxSourceConcurrency[0];
  const observedMixedIntakeRunSaves = [...new Set(measuredMixedIntakeRunSaves)];
  if (observedMixedIntakeRunSaves.length !== 1) {
    throw new Error("mixed intake Run saves must be stable and derived from measured services");
  }
  const mixedIntakeRunSaves = observedMixedIntakeRunSaves[0]!;
  if (mixedIntakeRunSaves > 2) {
    throw new Error(`mixed intake exceeded two bounded Run saves: ${mixedIntakeRunSaves}`);
  }
  const legacyCounters = measuredLegacyCounters[0];
  if (
    legacyCounters === undefined ||
    measuredLegacyCounters.some((value) => JSON.stringify(value) !== JSON.stringify(legacyCounters))
  ) {
    throw new Error("legacy cold/warm/change counters must be stable");
  }
  const statusActionBytes = [...new Set(measuredStatusActionBytes)];
  if (statusActionBytes.length !== 1 || statusActionBytes[0] === undefined) {
    throw new Error("status action serialized bytes must be deterministic");
  }
  if (statusActionBytes[0] > statusDetailBytes * fixtures.status.maximumDetailRatio) {
    throw new Error(
      `status action exceeded 25% of detail: ${statusActionBytes[0]}/${statusDetailBytes}`,
    );
  }
  if (
    measuredStatusArtifactReads.some((reads) => reads !== fixtures.status.maximumInventoryReads)
  ) {
    throw new Error(
      `status action read an inventory blob: ${JSON.stringify(measuredStatusArtifactReads)}`,
    );
  }
  if (
    legacyCounters.coldReads !== 250 ||
    legacyCounters.coldParses !== 250 ||
    legacyCounters.warmReads !== 250 ||
    legacyCounters.warmParses !== 0 ||
    legacyCounters.warmRebuilds !== 0 ||
    legacyCounters.changeReads !== 500 ||
    legacyCounters.changeParses !== 1 ||
    legacyCounters.changeRebuilds !== 1
  ) {
    throw new Error(
      `legacy cold/warm/change counters were unexpected: ${JSON.stringify(legacyCounters)}`,
    );
  }
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
                : name === "status-action"
                  ? fixtures.status
                  : name === "mutating-action"
                    ? fixtures.mutatingStatus
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
          ? {
              localDocuments: 20,
              parserSafeChunks: 4,
              openApiSources: 4,
              maxSourceConcurrency: mixedIntakeMaxSourceConcurrency,
              intakeRunSaves: mixedIntakeRunSaves,
            }
          : name === "legacy"
            ? {
                files: 250,
                terminalApiCalls: 40,
                sharedAdapters: 5,
                ...legacyCounters,
              }
            : name === "status-action"
              ? {
                  legacyFiles: fixtures.status.legacyFiles,
                  artifactReads: measuredStatusArtifactReads[0]!,
                  actionSerializedBytes: statusActionBytes[0],
                  detailSerializedBytes: statusDetailBytes,
                }
              : name === "mutating-action"
                ? {
                    legacyFiles: fixtures.mutatingStatus.legacyFiles,
                    inventoryReads: measuredMutatingInventoryReads[0]!,
                    startSerializedBytes: measuredMutatingStartBytes[0]!,
                    advanceSerializedBytes: measuredMutatingAdvanceBytes[0]!,
                    submitSerializedBytes: measuredMutatingSubmitBytes[0]!,
                  }
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
      mixedIntakeMaxSourceConcurrency,
      mixedIntakeRunSaves,
      legacyFiles: fixtures.legacy.files.length,
      legacyTerminalApiCalls: fixtures.legacy.terminalApiCalls.length,
      legacyColdReads: legacyCounters.coldReads,
      legacyColdParses: legacyCounters.coldParses,
      legacyWarmReads: legacyCounters.warmReads,
      legacyWarmParses: legacyCounters.warmParses,
      legacyWarmRebuilds: legacyCounters.warmRebuilds,
      legacyChangeReads: legacyCounters.changeReads,
      legacyChangeParses: legacyCounters.changeParses,
      legacyChangeRebuilds: legacyCounters.changeRebuilds,
      statusActionArtifactReads: measuredStatusArtifactReads[0]!,
      statusActionSerializedBytes: statusActionBytes[0],
      statusDetailSerializedBytes: statusDetailBytes,
      mutatingActionInventoryReads: measuredMutatingInventoryReads[0]!,
      mutatingStartSerializedBytes: measuredMutatingStartBytes[0]!,
      mutatingAdvanceSerializedBytes: measuredMutatingAdvanceBytes[0]!,
      mutatingSubmitSerializedBytes: measuredMutatingSubmitBytes[0]!,
      visualComparisons: fixtures.visual.comparisons.length,
    },
  };
  await writeFile(
    path.join(process.cwd(), "benchmarks", "runtime", "latest-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  console.info(JSON.stringify(receipt));
  await statusStore.close();
  await rm(statusDirectory, { recursive: true, force: true });
  await rm(legacyDirectory, { recursive: true, force: true });
});
