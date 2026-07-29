import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { PNG } from "pngjs";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { IntakeRequestService } from "../../src/application/intake-request-service.js";
import { RunService } from "../../src/application/run-service.js";
import { StageService } from "../../src/application/stage-service.js";
import { WorkflowService } from "../../src/application/workflow-service.js";
import {
  figmaPublicApiCatalogDigest,
  figmaStateFactsDigest,
} from "../../src/figma/figma-capture-contract.js";
import { RuntimeMetricsRecorder } from "../../src/runtime/performance-instrumentation.js";
import { SourceSnapshotStore } from "../../src/source-registry/snapshot-store.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTPUT_PATH = path.join(
  REPOSITORY_ROOT,
  "benchmarks/runtime/reviewer-scheduling-decision.json",
);
const FIGMA_URL = "https://www.figma.com/design/controlled/file?node-id=1-2";
const COLLECTED_AT = "2026-07-28T16:00:42.000Z";
const WORKLOADS = ["XS", "S", "M", "L", "XL"] as const;
type Workload = (typeof WORKLOADS)[number];

const TOKEN_RANGES: Record<Workload, { min: number; max: number }> = {
  XS: { min: 20_000, max: 50_000 },
  S: { min: 45_000, max: 100_000 },
  M: { min: 90_000, max: 180_000 },
  L: { min: 160_000, max: 320_000 },
  XL: { min: 280_000, max: 600_000 },
};

export type ReviewerPacketFixture = {
  attempt: 1 | 2;
  expectedVisualStatus: "passed" | "failed";
  baselineRgba: readonly [number, number, number, number];
  actualRgba: readonly [number, number, number, number];
  fixtureDigest: `sha256:${string}`;
};

export type ReviewerSchedulingCase = {
  sampleId: string;
  workload: Workload;
  firstAttemptFails: boolean;
  packetFixtures: readonly ReviewerPacketFixture[];
};

export type ReviewerSchedulingDecisionArtifact = {
  schemaVersion: "reviewer-scheduling-decision-v2";
  collectedAt: string;
  provenance: Record<string, unknown>;
  digests: Record<string, string>;
  controlledEnvironment: Record<string, unknown>;
  fixture: Record<string, unknown>;
  aggregates: {
    sampleSize: number;
    deliverySampleCount: number;
    numericVisualResultCount: number;
    firstAttemptVisualFailures: number;
    firstAttemptVisualFailureRate: number;
    reviewerWallStartedBeforeVisualStabilityMs: number;
    totalReviewerWallMs: number;
    invalidatedReviewerWallMs: number;
    invalidationRatio: number;
    workloadDistribution: Record<Workload, number>;
    numericVisualStatuses: { passed: number; failed: number };
    visualReviewMatchRatio: { minimum: number; mean: number; maximum: number };
    passToBothReviewsWallMs: { total: number; mean: number; p50: number; p95: number };
    task1MetricTotals: Record<string, unknown>;
  };
  measurementDefinitions: Record<string, string>;
  decisionRule: {
    formula: string;
    minimumSampleSize: number;
    minimumInvalidationRatio: number;
    sampleSizeGatePassed: boolean;
    invalidationRatioGatePassed: boolean;
    selectedStablePacketScheduling: boolean;
    decision: "retain-current-parallel-scheduling" | "defer-reviews-until-visual-stability";
    speedupClaim: "none";
  };
};

export type ReviewerSchedulingCollection = {
  artifact: ReviewerSchedulingDecisionArtifact;
  diagnostics: {
    deliverySampleCount: number;
    packetCount: number;
    packetDigests: string[];
    fixtureDigests: string[];
    numericStatuses: { passed: number; failed: number };
    repairableFailureCount: number;
    preVisualFunctionalActionCount: number;
  };
};

class ManualClock {
  private valueMs = 0;

  public monotonicNow = (): number => this.valueMs;

  public now = (): string =>
    new Date(Date.parse("2026-07-28T00:00:00.000Z") + this.valueMs).toISOString();

  public advance(milliseconds: number): void {
    this.valueMs += milliseconds;
  }
}

export function buildReviewerSchedulingCases(): ReviewerSchedulingCase[] {
  return Array.from({ length: 30 }, (_, index) => {
    const ordinal = index + 1;
    const sampleId = `sample-${String(ordinal).padStart(2, "0")}`;
    const workload = WORKLOADS[index % WORKLOADS.length]!;
    const firstAttemptFails = ordinal % 6 === 0;
    const baselineRgba = colorFor(ordinal);
    const failedRgba = [
      255 - baselineRgba[0],
      255 - baselineRgba[1],
      255 - baselineRgba[2],
      255,
    ] as const;
    const packetFixtures = [
      packetFixture(sampleId, 1, baselineRgba, firstAttemptFails ? failedRgba : baselineRgba),
      ...(firstAttemptFails ? [packetFixture(sampleId, 2, baselineRgba, baselineRgba)] : []),
    ];
    return { sampleId, workload, firstAttemptFails, packetFixtures };
  });
}

export async function collectReviewerSchedulingDecision(): Promise<ReviewerSchedulingCollection> {
  const cases = buildReviewerSchedulingCases();
  const directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-reviewer-decision-"));
  const clock = new ManualClock();
  const metrics = new RuntimeMetricsRecorder({ now: clock.monotonicNow });
  const store = new SqliteRunStore(path.join(directory, "runs.sqlite3"), metrics);
  const artifactStore = new ArtifactBlobStore(path.join(directory, "artifacts"), metrics);
  let runOrdinal = 0;
  const service = new WorkflowService({
    runStore: store,
    artifactStore,
    runService: new RunService(store, {
      pluginVersion: "reviewer-scheduling-collector-v1",
      now: clock.now,
      newRunId: () => `run_${String(++runOrdinal).padStart(32, "0")}` as `run_${string}`,
    }),
    intakeRequestService: new IntakeRequestService(
      store,
      new SourceSnapshotStore(path.join(directory, "sources")),
      artifactStore,
      clock.now,
    ),
    stageService: new StageService(store, clock.now, metrics),
    metrics,
    now: clock.now,
    monotonicNow: clock.monotonicNow,
  });
  const packetDigests: string[] = [];
  const fixtureDigests: string[] = [];
  const visualRatios: number[] = [];
  const passToBothReviewWall: number[] = [];
  let repairableFailureCount = 0;
  let preVisualFunctionalActionCount = 0;
  const numericStatuses = { passed: 0, failed: 0 };

  try {
    await prepareWorkspace(directory);
    for (const sample of cases) {
      await writeSampleBaseline(directory, sample);
      await git(directory, "add", ".");
      await git(directory, "commit", "-qm", `fixture ${sample.sampleId}`);

      const started = await service.start({
        projectRoot: directory,
        requestText: `Controlled UI delivery ${sample.sampleId}`,
        scope: "ui",
        mode: "figma",
        publication: "none",
        figmaUrl: FIGMA_URL,
      });
      await setWorkload(store, started.runId, sample.workload, clock.now());
      const bundle = figmaBundle(sample);
      const {
        kind: _kind,
        artifactPaths: _artifactPaths,
        manifestPath: _manifestPath,
        ...manifest
      } = bundle;
      await writeFile(
        path.join(directory, "figma/design-context.json"),
        `${JSON.stringify({ ...manifest, visualPaths: ["visual/baseline.png"] })}\n`,
      );
      await service.submit({
        runId: started.runId,
        submission: bundle,
      });
      await service.submit({
        runId: started.runId,
        submission: {
          kind: "contracts",
          status: "passed",
          summary: "Controlled UI contract ready.",
          artifactPaths: ["contracts/requirements.json"],
          requirementManifest: [
            {
              id: "screen",
              title: "Controlled screen",
              acceptanceCriteria: ["The controlled screen matches its declared visual state."],
            },
          ],
        },
      });

      const firstPacket = await implementPacket(
        service,
        store,
        directory,
        started.runId,
        sample,
        1,
      );
      packetDigests.push(firstPacket.packetDigest);
      fixtureDigests.push(sample.packetFixtures[0]!.fixtureDigest);
      preVisualFunctionalActionCount += assertPreVisualActions(firstPacket.status);

      if (sample.firstAttemptFails) {
        clock.advance(20);
        await submitFunctionalReview(service, started.runId, firstPacket.packetId);
        clock.advance(5);
        const failed = await submitVisual(
          service,
          store,
          artifactStore,
          directory,
          started.runId,
          firstPacket.packetId,
          sample,
          sample.packetFixtures[0]!,
        );
        recordNumericResult(failed, "failed", numericStatuses, visualRatios);
        if (!failed.status.nextActions.some((action) => action.kind === "implementation-repair")) {
          throw new Error("Controlled repairable failure did not expose implementation-repair");
        }
        repairableFailureCount += 1;

        const repairedPacket = await implementPacket(
          service,
          store,
          directory,
          started.runId,
          sample,
          2,
        );
        packetDigests.push(repairedPacket.packetDigest);
        fixtureDigests.push(sample.packetFixtures[1]!.fixtureDigest);
        preVisualFunctionalActionCount += assertPreVisualActions(repairedPacket.status);
        const passStartedAt = clock.monotonicNow();
        clock.advance(5);
        const passed = await submitVisual(
          service,
          store,
          artifactStore,
          directory,
          started.runId,
          repairedPacket.packetId,
          sample,
          sample.packetFixtures[1]!,
        );
        recordNumericResult(passed, "passed", numericStatuses, visualRatios);
        clock.advance(20);
        const functional = await submitFunctionalReview(
          service,
          started.runId,
          repairedPacket.packetId,
        );
        clock.advance(10);
        await submitDesignReview(service, started.runId, repairedPacket.packetId, functional);
        passToBothReviewWall.push(clock.monotonicNow() - (passStartedAt + 5));
      } else {
        const passStartedAt = clock.monotonicNow();
        clock.advance(5);
        const passed = await submitVisual(
          service,
          store,
          artifactStore,
          directory,
          started.runId,
          firstPacket.packetId,
          sample,
          sample.packetFixtures[0]!,
        );
        recordNumericResult(passed, "passed", numericStatuses, visualRatios);
        clock.advance(20);
        const functional = await submitFunctionalReview(
          service,
          started.runId,
          firstPacket.packetId,
        );
        clock.advance(10);
        await submitDesignReview(service, started.runId, firstPacket.packetId, functional);
        passToBothReviewWall.push(clock.monotonicNow() - (passStartedAt + 5));
      }
    }

    const allReviewSamples = aggregateMetricAcrossRuns(metrics, runOrdinal, "review.wall_ms");
    const invalidatedSamples = aggregateMetricAcrossRuns(
      metrics,
      runOrdinal,
      "review.invalidated_wall_ms",
    );
    const functionalWall = allReviewSamples["functional-review"] ?? 0;
    const designWall = allReviewSamples["design-review"] ?? 0;
    const invalidatedWall = Object.values(invalidatedSamples).reduce(
      (total, value) => total + value,
      0,
    );
    const totalReviewerWall = functionalWall + designWall;
    const invalidationRatio = invalidatedWall / Math.max(1, totalReviewerWall);
    const packetWorkloads = Object.fromEntries(
      WORKLOADS.map((workload) => [workload, 0]),
    ) as Record<Workload, number>;
    for (const sample of cases) {
      packetWorkloads[sample.workload] += sample.packetFixtures.length;
    }
    const sortedPassWalls = [...passToBothReviewWall].sort((left, right) => left - right);
    const dependencyLockfileDigest = sha256(
      await readFile(path.join(REPOSITORY_ROOT, "pnpm-lock.yaml")),
    );
    const controlledEnvironment = {
      schemaVersion: "reviewer-scheduling-environment-v1",
      monotonicClock: "manual-milliseconds-v1",
      nodeEngine: ">=22.0.0",
      packageManager: "pnpm@10.34.4",
      dependencyLockfileDigest,
    };
    const fixtureRootDigest = sha256Json({
      schemaVersion: "reviewer-scheduling-fixtures-v1",
      fixtureDigests: [...fixtureDigests].sort(),
    });
    const sampleSize = packetDigests.length;
    const artifact: ReviewerSchedulingDecisionArtifact = {
      schemaVersion: "reviewer-scheduling-decision-v2",
      collectedAt: COLLECTED_AT,
      provenance: {
        sourceType: "controlled-deterministic-workflow-service-executions",
        productionTelemetry: false,
        sourceFixture: "Task 1 runtime metrics plus production WorkflowService visual comparison",
        method:
          "Thirty distinct controlled UI deliveries execute real WorkflowService status, reviewer submission, visual comparison, repair, and reviewer invalidation paths. Five deterministic first failures repair to new packets and pass. A manual monotonic clock supplies reviewer event durations; host wall time is not a decision input.",
        sanitization:
          "Only aggregate counts, rates, deterministic wall durations, bounded fixture metadata, and SHA-256 aggregate digests are persisted.",
      },
      digests: {
        fixtureRoot: fixtureRootDigest,
        controlledEnvironment: sha256Json(controlledEnvironment),
        dependencyLockfile: dependencyLockfileDigest,
        fixtureDigestAggregate: sha256Json([...fixtureDigests].sort()),
        packetDigestAggregate: sha256Json([...packetDigests].sort()),
      },
      controlledEnvironment,
      fixture: {
        deliverySampleCount: cases.length,
        sampleSize,
        distinctPacketDigestCount: new Set(packetDigests).size,
        distinctFixtureDigestCount: new Set(fixtureDigests).size,
        targetCountPerPacket: 1,
        logicalSize: { width: 1, height: 1 },
        firstFailureRule: "Every sixth delivery fails its first packet; one failure per workload.",
        repairRule:
          "Each first failure changes implementation source and produces a new passing packet.",
        fixtureDigestSerialization:
          "sha256(JSON.stringify({schemaVersion,sampleId,attempt,expectedVisualStatus,baselineRgba,actualRgba}))",
        aggregateDigestSerialization: "sha256(JSON.stringify(sortedDigestArray))",
      },
      aggregates: {
        sampleSize,
        deliverySampleCount: cases.length,
        numericVisualResultCount: visualRatios.length,
        firstAttemptVisualFailures: cases.filter((sample) => sample.firstAttemptFails).length,
        firstAttemptVisualFailureRate:
          cases.filter((sample) => sample.firstAttemptFails).length / cases.length,
        reviewerWallStartedBeforeVisualStabilityMs: functionalWall,
        totalReviewerWallMs: totalReviewerWall,
        invalidatedReviewerWallMs: invalidatedWall,
        invalidationRatio,
        workloadDistribution: packetWorkloads,
        numericVisualStatuses: numericStatuses,
        visualReviewMatchRatio: {
          minimum: Math.min(...visualRatios),
          mean: visualRatios.reduce((total, value) => total + value, 0) / visualRatios.length,
          maximum: Math.max(...visualRatios),
        },
        passToBothReviewsWallMs: {
          total: passToBothReviewWall.reduce((total, value) => total + value, 0),
          mean:
            passToBothReviewWall.reduce((total, value) => total + value, 0) /
            passToBothReviewWall.length,
          p50: percentile(sortedPassWalls, 0.5),
          p95: percentile(sortedPassWalls, 0.95),
        },
        task1MetricTotals: {
          "review.wall_ms": {
            "functional-review": functionalWall,
            "design-review": designWall,
          },
          "review.invalidated_wall_ms": invalidatedSamples,
        },
      },
      measurementDefinitions: {
        reviewerWallStartedBeforeVisualStabilityMs:
          "Sum of functional reviewer action wall time because every measured functional action was exposed by current status before its packet had a numeric visual pass.",
        totalReviewerWallMs:
          "Sum of review.wall_ms emitted by real functional and design review completion or invalidation events.",
        invalidatedReviewerWallMs:
          "Sum of review.invalidated_wall_ms emitted when a real repairable visual failure reopened implementation and reset exposed reviewer work.",
        passToBothReviewsWallMs:
          "Manual-clock elapsed duration from real visual pass completion until both applicable real reviewer submissions completed.",
      },
      decisionRule: {
        formula: "invalidatedReviewerWallMs / Math.max(1, totalReviewerWallMs)",
        minimumSampleSize: 30,
        minimumInvalidationRatio: 0.15,
        sampleSizeGatePassed: sampleSize >= 30,
        invalidationRatioGatePassed: invalidationRatio >= 0.15,
        selectedStablePacketScheduling: sampleSize >= 30 && invalidationRatio >= 0.15,
        decision:
          sampleSize >= 30 && invalidationRatio >= 0.15
            ? "defer-reviews-until-visual-stability"
            : "retain-current-parallel-scheduling",
        speedupClaim: "none",
      },
    };
    return {
      artifact,
      diagnostics: {
        deliverySampleCount: cases.length,
        packetCount: packetDigests.length,
        packetDigests,
        fixtureDigests,
        numericStatuses,
        repairableFailureCount,
        preVisualFunctionalActionCount,
      },
    };
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

export function serializeReviewerSchedulingDecision(
  artifact: ReviewerSchedulingDecisionArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

async function prepareWorkspace(directory: string): Promise<void> {
  const files: Record<string, string | Buffer> = {
    ".gitignore": "artifacts/\nsources/\nruns.sqlite3*\nvisual/actual/\n",
    "contracts/requirements.json": JSON.stringify({ requirement: "screen" }),
    "test-results/unit.json": JSON.stringify({ status: "passed" }),
    "src/checkout.tsx": "export const checkout = 'base';\n",
    "figma/design-context.json": "{}\n",
    "visual/baseline.png": png([0, 0, 0, 255]),
    "mocks/checkout.json": "{}\n",
    "mocks/manifest.json": "{}\n",
    "test-ui-package/index.js": "export const Button = {};\n",
    "test-ui-package/icons/vue.js": "export const Icon = {};\n",
    "test-ui-package/code-connect.manifest.json": JSON.stringify({
      mappings: [],
      packageName: "@frontend/ui",
      packageVersion: "1.2.3",
    }),
    "test-ui-package/package.json": JSON.stringify({
      name: "@frontend/ui",
      version: "1.2.3",
      exports: { ".": "./index.js", "./icons/vue": "./icons/vue.js" },
    }),
  };
  for (const [relativePath, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, relativePath)), { recursive: true });
    await writeFile(path.join(directory, relativePath), content);
  }
  await git(directory, "init", "-q");
  await git(directory, "config", "user.email", "collector@example.test");
  await git(directory, "config", "user.name", "Reviewer Scheduling Collector");
  await git(directory, "add", ".");
  await git(directory, "commit", "-qm", "collector base");
}

async function writeSampleBaseline(
  directory: string,
  sample: ReviewerSchedulingCase,
): Promise<void> {
  const stateContract = stateContracts(sample)[0]!;
  const fixtureBytes = Buffer.from(JSON.stringify({ sampleId: sample.sampleId }), "utf8");
  await writeFile(
    path.join(directory, "visual/baseline.png"),
    png(sample.packetFixtures[0]!.baselineRgba),
  );
  await writeFile(path.join(directory, "mocks/checkout.json"), fixtureBytes);
  await writeFile(
    path.join(directory, "mocks/manifest.json"),
    JSON.stringify({
      deterministic: true,
      fixtures: [
        {
          id: `mock:${sample.sampleId}`,
          path: "mocks/checkout.json",
          sha256: sha256(fixtureBytes),
          stateContractDigest: stateContract.digest,
        },
      ],
    }),
  );
}

function figmaBundle(sample: ReviewerSchedulingCase) {
  const publicApiCatalog = publicCatalog();
  return {
    kind: "figma-bundle" as const,
    provider: "host-connected-figma" as const,
    capturedAt: COLLECTED_AT,
    fileUrl: FIGMA_URL,
    fileUrls: [FIGMA_URL],
    nodeIds: ["1:2"],
    capturedComponents: [],
    designMapping: {
      designSystem: {
        packageName: "@frontend/ui" as const,
        packageVersion: "1.2.3",
        catalogDigest: publicApiCatalog.digest,
        guidanceSkill: "design-system",
      },
      publicApiCatalog,
      components: [],
      fonts: [],
      tokens: [],
    },
    manifestPath: "figma/design-context.json",
    stateContracts: stateContracts(sample),
    visualTargets: [visualTarget(sample)],
    artifactPaths: ["figma/design-context.json", "visual/baseline.png"],
  };
}

async function implementPacket(
  service: WorkflowService,
  store: SqliteRunStore,
  directory: string,
  runId: string,
  sample: ReviewerSchedulingCase,
  attempt: 1 | 2,
) {
  await writeFile(
    path.join(directory, "src/checkout.tsx"),
    `export const checkout = '${sample.sampleId}-attempt-${String(attempt)}';\n`,
  );
  const status = await service.submit({
    runId,
    submission: {
      kind: "implementation",
      status: "passed",
      summary: `Implemented ${sample.sampleId} attempt ${String(attempt)}.`,
      apiReady: false,
      uiChanged: true,
      changedFiles: ["figma/design-context.json", "src/checkout.tsx"],
      artifactPaths: ["test-results/unit.json", "mocks/manifest.json", "mocks/checkout.json"],
      mockDataEvidence: {
        manifestPath: "mocks/manifest.json",
        fixtures: [
          {
            id: `mock:${sample.sampleId}`,
            path: "mocks/checkout.json",
            stateContractDigest: stateContracts(sample)[0]!.digest,
          },
        ],
      },
    },
  });
  const action = status.nextActions.find((candidate) => candidate.kind === "compare-visuals");
  if (action === undefined || !("reviewPacketId" in action)) {
    throw new Error("Implementation did not expose visual comparison");
  }
  const run = await store.get(runId as `run_${string}`);
  const packetArtifact = [...run.artifacts].reverse().find((artifact) => {
    const packet = artifact.metadata["reviewPacket"] as { id?: unknown } | undefined;
    return packet?.id === action.reviewPacketId;
  });
  const packet = packetArtifact?.metadata["reviewPacket"] as
    { id?: unknown; diffDigest?: unknown } | undefined;
  if (typeof packet?.id !== "string" || typeof packet.diffDigest !== "string") {
    throw new Error("Implementation packet metadata is incomplete");
  }
  return { status, packetId: packet.id, packetDigest: packet.diffDigest };
}

async function submitFunctionalReview(service: WorkflowService, runId: string, packetId: string) {
  return service.submit({
    runId,
    submission: {
      kind: "functional-review",
      reviewPacketId: packetId,
      verdict: "approved",
      summary: "Controlled functional review passed.",
      findings: [],
      requirements: [{ id: "screen", verdict: "accepted" }],
      artifactPaths: ["test-results/unit.json"],
      gateResults: [
        { id: "functional", status: "passed", evidencePaths: ["test-results/unit.json"] },
      ],
    },
  });
}

async function submitDesignReview(
  service: WorkflowService,
  runId: string,
  packetId: string,
  status: Awaited<ReturnType<typeof submitFunctionalReview>>,
) {
  if (!status.nextActions.some((action) => action.kind === "review-design")) {
    throw new Error("Passing visual and functional review did not expose design review");
  }
  return service.submit({
    runId,
    submission: {
      kind: "design-review",
      reviewPacketId: packetId,
      verdict: "approved",
      summary: "Controlled design review passed.",
      findings: [],
      requirements: [{ id: "screen", verdict: "accepted" }],
      artifactPaths: ["visual/baseline.png"],
      gateResults: [
        { id: "visual", status: "passed", evidencePaths: ["visual/baseline.png"] },
        { id: "accessibility", status: "passed", evidencePaths: ["visual/baseline.png"] },
      ],
    },
  });
}

async function submitVisual(
  service: WorkflowService,
  store: SqliteRunStore,
  artifactStore: ArtifactBlobStore,
  directory: string,
  runId: string,
  packetId: string,
  sample: ReviewerSchedulingCase,
  fixture: ReviewerPacketFixture,
) {
  const run = await store.get(runId);
  const implementation = [...run.artifacts].reverse().find((artifact) => {
    const packet = artifact.metadata["reviewPacket"] as { id?: unknown } | undefined;
    return packet?.id === packetId;
  });
  const packet = implementation?.metadata["reviewPacket"] as
    { id?: unknown; headSha?: unknown } | undefined;
  if (packet?.id !== packetId || typeof packet.headSha !== "string") {
    throw new Error("Missing packet head for controlled visual submission");
  }
  const actualPath = `visual/actual/${packetId}/${sample.sampleId}-${String(fixture.attempt)}.png`;
  const actualBytes = png(fixture.actualRgba);
  await writeProjectFile(directory, actualPath, actualBytes);
  const fixtureBytes = await readFile(path.join(directory, "mocks/checkout.json"));
  const stateContract = stateContracts(sample)[0]!;
  const receiptPath = actualPath.replace(/\.png$/, ".receipt.json");
  const observationPath = actualPath.replace(/\.png$/, ".observation.json");
  const resultPath = actualPath.replace(/\.png$/, ".playwright.json");
  const assertionPath = actualPath.replace(/\.png$/, ".assertions.json");
  const actualDigest = sha256(actualBytes);
  const observationBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: "ui-assertion-observation-v1",
      targetId: sample.sampleId,
      state: "default",
      fixtureId: `mock:${sample.sampleId}`,
      screenshot: { path: actualPath, digest: actualDigest },
      observations: { "assert-screen": "rendered" },
    }),
  );
  const observationDigest = sha256(observationBytes);
  const producerBinding = {
    targetId: sample.sampleId,
    state: "default",
    fixtureId: `mock:${sample.sampleId}`,
    observation: { path: observationPath, digest: observationDigest },
    screenshot: { path: actualPath, digest: actualDigest },
  };
  const annotation = {
    type: "spec-to-pr-ui-binding",
    description: JSON.stringify(producerBinding),
  };
  const resultBytes = Buffer.from(
    JSON.stringify({
      config: { version: "1.61.1" },
      suites: [
        {
          title: "controlled.spec.ts",
          specs: [
            {
              title: "controlled screen assertions",
              ok: true,
              tests: [
                {
                  expectedStatus: "passed",
                  projectId: "ui-chromium",
                  projectName: "ui-chromium",
                  results: [
                    {
                      status: "passed",
                      errors: [],
                      annotations: [annotation],
                      attachments: [
                        {
                          name: "spec-to-pr-ui-observation",
                          contentType: "application/vnd.spec-to-pr.ui-observation+json",
                          body: observationBytes.toString("base64"),
                        },
                      ],
                    },
                  ],
                  status: "expected",
                  annotations: [annotation],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
      stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
    }),
  );
  const resultDigest = sha256(resultBytes);
  const receiptBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: "visual-capture-receipt-v2",
      reviewPacketId: packetId,
      headSha: packet.headSha,
      stateContractDigest: stateContract.digest,
      targetId: sample.sampleId,
      route: "http://127.0.0.1:4173/controlled",
      state: "default",
      captureKind: "viewport",
      logicalSize: { width: 1, height: 1 },
      deviceScaleFactor: 1,
      environment: {
        browser: {
          family: "chromium",
          channel: "chromium",
          version: "138.0.7204.168",
          userAgent: "Controlled Chromium",
        },
        renderer: {
          adapter: "spec-to-pr-playwright",
          adapterVersion: "capture-runner-v2",
          playwrightVersion: "1.61.1",
        },
        locale: "ko-KR",
        timezone: "Asia/Seoul",
        colorScheme: "light",
        reducedMotion: "reduce",
        serverOrigin: "http://127.0.0.1:4173",
        readiness: {
          documentReadyState: "complete",
          fontsReady: true,
          imagesReady: true,
          assetsReady: true,
        },
      },
      fonts: [],
      fixture: { id: `mock:${sample.sampleId}`, digest: sha256(fixtureBytes) },
      assets: [],
      actual: {
        path: actualPath,
        digest: actualDigest,
        bitmapSize: { width: 1, height: 1 },
      },
      normalizerVersion: "visual-normalizer-v1",
      capturedAt: COLLECTED_AT,
    }),
  );
  const receiptDigest = sha256(receiptBytes);
  const assertionBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: "ui-assertions-v1",
      reviewPacketId: packetId,
      headSha: packet.headSha,
      targetId: sample.sampleId,
      fixtureId: `mock:${sample.sampleId}`,
      stateContractDigest: stateContract.digest,
      captureReceiptDigest: receiptDigest,
      producer: {
        kind: "playwright-test-cli",
        testId: "controlled screen assertions",
        projectName: "ui-chromium",
        resultPath,
        resultDigest,
        binding: producerBinding,
      },
      assertions: [
        {
          id: "assert-screen",
          kind: "interaction",
          selector: "[data-ui=screen]",
          subject: "controlled screen rendered",
          action: "click",
          expected: "rendered",
          observed: "rendered",
          status: "passed",
        },
      ],
      status: "passed",
    }),
  );
  await writeProjectFile(directory, receiptPath, receiptBytes);
  await writeProjectFile(directory, observationPath, observationBytes);
  await writeProjectFile(directory, resultPath, resultBytes);
  await writeProjectFile(directory, assertionPath, assertionBytes);
  const isolation = await baselineIsolation(directory, run, packetId);
  const status = await service.submit({
    runId,
    submission: {
      kind: "visual-comparison",
      reviewPacketId: packetId,
      captures: [
        {
          targetId: sample.sampleId,
          route: "/controlled",
          state: "default",
          viewport: { width: 1, height: 1 },
          deviceScaleFactor: 1,
          fixture: `mock:${sample.sampleId}`,
          provider: "playwright",
          capturedAt: COLLECTED_AT,
          actualPath,
          actualDigest,
          assertionReportPath: assertionPath,
          assertionReportDigest: sha256(assertionBytes),
          assertionResultPath: resultPath,
          assertionResultDigest: resultDigest,
          assertionObservationPath: observationPath,
          assertionObservationDigest: observationDigest,
          receiptPath,
          receiptDigest,
        },
      ],
      ...isolation,
      artifactPaths: [
        actualPath,
        receiptPath,
        observationPath,
        resultPath,
        assertionPath,
        isolation.baselineIsolationPath,
      ],
    },
  });
  const persisted = await store.get(runId);
  const report = [...persisted.artifacts]
    .reverse()
    .find(
      (artifact) =>
        artifact.kind === "visual-report" && artifact.metadata["reviewPacketId"] === packetId,
    );
  const reportPayload =
    report === undefined
      ? undefined
      : (JSON.parse((await artifactStore.readContent(report.digest)).toString("utf8")) as {
          results?: Array<{
            status?: unknown;
            metrics?: { reviewMatchRatio?: unknown };
          }>;
        });
  const results = reportPayload?.results;
  const numeric = results?.[0];
  if (
    (numeric?.status !== "passed" && numeric?.status !== "failed") ||
    typeof numeric.metrics?.reviewMatchRatio !== "number"
  ) {
    throw new Error("Controlled workflow did not persist a numeric visual result");
  }
  const visualStatus: "passed" | "failed" = numeric.status;
  return {
    status,
    visualStatus,
    reviewMatchRatio: numeric.metrics.reviewMatchRatio,
  };
}

async function baselineIsolation(
  directory: string,
  run: Awaited<ReturnType<SqliteRunStore["get"]>>,
  packetId: string,
) {
  const implementation = [...run.artifacts].reverse().find((artifact) => {
    const packet = artifact.metadata["reviewPacket"] as { id?: unknown } | undefined;
    return packet?.id === packetId;
  });
  const packet = implementation?.metadata["reviewPacket"] as
    { headSha?: unknown; changedFiles?: unknown } | undefined;
  const baseline = [...run.artifacts]
    .reverse()
    .find((artifact) => artifact.metadata["projectRelativePath"] === "visual/baseline.png");
  if (
    typeof packet?.headSha !== "string" ||
    !Array.isArray(packet.changedFiles) ||
    baseline === undefined
  ) {
    throw new Error("Controlled baseline isolation inputs are incomplete");
  }
  const sourceBytes = await readFile(path.join(directory, "src/checkout.tsx"));
  const baselineIsolationPath = `visual/actual/${packetId}/baseline-isolation.json`;
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: "baseline-isolation-v1",
      reviewPacketId: packetId,
      headSha: packet.headSha,
      baselineArtifacts: [
        { artifactId: baseline.id, path: "visual/baseline.png", digest: baseline.digest },
      ],
      checkedSourceFiles: [{ path: "src/checkout.tsx", digest: sha256(sourceBytes) }],
      requestedResources: [],
      renderedMedia: [],
      violations: [],
      status: "passed",
    }),
  );
  await writeProjectFile(directory, baselineIsolationPath, bytes);
  return { baselineIsolationPath, baselineIsolationDigest: sha256(bytes) };
}

async function setWorkload(
  store: SqliteRunStore,
  runId: string,
  size: Workload,
  timestamp: string,
): Promise<void> {
  const run = await store.get(runId);
  const tokenRange = TOKEN_RANGES[size];
  await store.save(
    {
      ...run,
      revision: run.revision + 1,
      updatedAt: timestamp,
      stages: run.stages.map((stage) =>
        stage.name === "intake"
          ? {
              ...stage,
              checkpoint: {
                ...stage.checkpoint!,
                data: {
                  ...stage.checkpoint!.data,
                  workload: {
                    size,
                    score:
                      size === "XS"
                        ? 8
                        : size === "S"
                          ? 24
                          : size === "M"
                            ? 50
                            : size === "L"
                              ? 90
                              : 91,
                    confidence: "high",
                    source: "contracts",
                    tokenRange,
                    budget: {
                      checkpointPercent: 80,
                      checkpointAtTokens: Math.floor(tokenRange.max * 0.8),
                      hardLimitTokens: tokenRange.max,
                    },
                    sampleCount: 1,
                    reasons: ["controlled reviewer scheduling distribution"],
                  },
                },
              },
            }
          : stage,
      ),
    },
    run.revision,
  );
}

function publicCatalog() {
  const rootBytes = Buffer.from("export const Button = {};\n");
  const iconsBytes = Buffer.from("export const Icon = {};\n");
  const connectBytes = Buffer.from(
    JSON.stringify({
      mappings: [],
      packageName: "@frontend/ui",
      packageVersion: "1.2.3",
    }),
  );
  const packageBytes = Buffer.from(
    JSON.stringify({
      name: "@frontend/ui",
      version: "1.2.3",
      exports: { ".": "./index.js", "./icons/vue": "./icons/vue.js" },
    }),
  );
  const fields = {
    schemaVersion: "figma-public-api-catalog-v1" as const,
    packageName: "@frontend/ui" as const,
    packageVersion: "1.2.3",
    packageManifest: {
      path: "test-ui-package/package.json",
      digest: sha256(packageBytes),
    },
    publicBarrels: [
      {
        module: "@frontend/ui" as const,
        path: "test-ui-package/index.js",
        digest: sha256(rootBytes),
      },
      {
        module: "@frontend/ui/icons/vue" as const,
        path: "test-ui-package/icons/vue.js",
        digest: sha256(iconsBytes),
      },
    ],
    codeConnectManifest: {
      path: "test-ui-package/code-connect.manifest.json",
      digest: sha256(connectBytes),
    },
    exports: [],
  };
  return { ...fields, digest: figmaPublicApiCatalogDigest(fields) };
}

function stateContracts(sample: ReviewerSchedulingCase) {
  const fields = {
    targetId: sample.sampleId,
    nodeId: "1:2",
    state: "default",
    fixtureId: `mock:${sample.sampleId}`,
    facts: [
      {
        id: "sample",
        kind: "text" as const,
        subject: "sample",
        value: sample.sampleId,
      },
    ],
    requiredAssertions: [
      {
        id: "assert-screen",
        kind: "interaction" as const,
        selector: "[data-ui=screen]",
        subject: "controlled screen rendered",
        action: "click" as const,
        expected: "rendered",
      },
    ],
    designBindingIds: [],
  };
  return [{ ...fields, digest: figmaStateFactsDigest(fields) }];
}

function visualTarget(sample: ReviewerSchedulingCase) {
  return {
    targetId: sample.sampleId,
    name: `Controlled ${sample.sampleId}`,
    state: "default",
    route: "/controlled",
    baselineKind: "figma" as const,
    baselinePath: "visual/baseline.png",
    viewport: { width: 1, height: 1 },
    deviceScaleFactor: 1,
    fixture: `mock:${sample.sampleId}`,
    figmaCapture: {
      schemaVersion: "figma-capture-geometry-v2" as const,
      provider: "host-connected-figma-native-export" as const,
      nodeId: "1:2",
      state: "default",
      captureKind: "viewport" as const,
      logicalSize: { width: 1, height: 1 },
      exportScale: 1,
      bitmapSize: { width: 1, height: 1 },
      colorSpace: "srgb" as const,
    },
    masks: [],
  };
}

function packetFixture(
  sampleId: string,
  attempt: 1 | 2,
  baselineRgba: readonly [number, number, number, number],
  actualRgba: readonly [number, number, number, number],
): ReviewerPacketFixture {
  const expectedVisualStatus = baselineRgba.every((value, index) => value === actualRgba[index])
    ? "passed"
    : "failed";
  const preimage = {
    schemaVersion: "reviewer-scheduling-packet-fixture-v1",
    sampleId,
    attempt,
    expectedVisualStatus,
    baselineRgba,
    actualRgba,
  };
  return {
    attempt,
    expectedVisualStatus,
    baselineRgba,
    actualRgba,
    fixtureDigest: sha256Json(preimage),
  };
}

function colorFor(ordinal: number): readonly [number, number, number, number] {
  return [(ordinal * 7) % 256, (ordinal * 13) % 256, (ordinal * 29) % 256, 255];
}

function png(rgba: readonly [number, number, number, number]): Buffer {
  const image = new PNG({ width: 1, height: 1 });
  image.data.set(rgba);
  return PNG.sync.write(image);
}

function assertPreVisualActions(status: Awaited<ReturnType<WorkflowService["status"]>>): number {
  const kinds = status.nextActions.map((action) => action.kind);
  if (!kinds.includes("compare-visuals") || !kinds.includes("review-functional")) {
    throw new Error("Current status did not expose visual comparison with functional review");
  }
  if (kinds.includes("review-design")) {
    throw new Error("Current status exposed design review before numeric visual pass");
  }
  return 1;
}

function recordNumericResult(
  result: { visualStatus: "passed" | "failed"; reviewMatchRatio: number },
  expected: "passed" | "failed",
  statuses: { passed: number; failed: number },
  ratios: number[],
): void {
  if (result.visualStatus !== expected || !Number.isFinite(result.reviewMatchRatio)) {
    throw new Error(`Expected numeric ${expected} visual result`);
  }
  statuses[result.visualStatus] += 1;
  ratios.push(result.reviewMatchRatio);
}

function aggregateMetricAcrossRuns(
  metrics: RuntimeMetricsRecorder,
  runCount: number,
  name: "review.wall_ms" | "review.invalidated_wall_ms",
): Partial<Record<"functional-review" | "design-review", number>> {
  const totals: Partial<Record<"functional-review" | "design-review", number>> = {};
  for (let ordinal = 1; ordinal <= runCount; ordinal += 1) {
    const snapshot = metrics.snapshot({
      runId: `run_${String(ordinal).padStart(32, "0")}`,
      fixtureDigest: `sha256:${"0".repeat(64)}`,
      collectedAt: COLLECTED_AT,
    });
    for (const sample of snapshot.samples) {
      const stage = sample.tags.stage;
      if (sample.name === name && (stage === "functional-review" || stage === "design-review")) {
        totals[stage] = (totals[stage] ?? 0) + sample.value;
      }
    }
  }
  return totals;
}

function percentile(sorted: readonly number[], percent: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percent) - 1)] ?? 0;
}

async function writeProjectFile(
  directory: string,
  relativePath: string,
  content: string | Buffer,
): Promise<void> {
  const absolute = path.join(directory, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function git(directory: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: directory });
}

function sha256(value: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha256Json(value: unknown): `sha256:${string}` {
  return sha256(JSON.stringify(value));
}

async function main(): Promise<void> {
  const result = await collectReviewerSchedulingDecision();
  const serialized = serializeReviewerSchedulingDecision(result.artifact);
  if (process.argv.includes("--check")) {
    const current = await readFile(OUTPUT_PATH, "utf8");
    if (current !== serialized) {
      throw new Error(
        "reviewer scheduling decision is stale; run pnpm reviewer-scheduling:generate",
      );
    }
    return;
  }
  await writeFile(OUTPUT_PATH, serialized);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
