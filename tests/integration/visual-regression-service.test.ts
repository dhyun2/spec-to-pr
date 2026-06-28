import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { VisualRegressionService } from "../../src/application/visual-regression-service.js";
import { createInitialRun, RunManifestSchema } from "../../src/run/index.js";
import { ArtifactRefSchema } from "../../src/runtime/artifact.js";
import { createArtifactId } from "../../src/runtime/id-factory.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let store: SqliteRunStore;
let artifactStore: ArtifactBlobStore;
let service: VisualRegressionService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-visual-"));
  projectRoot = path.join(directory, "project");

  await mkdir(projectRoot, {
    recursive: true,
  });

  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  artifactStore = new ArtifactBlobStore(path.join(directory, "artifacts"));
  service = new VisualRegressionService(store, artifactStore, () => "2026-06-23T00:00:00.000Z");

  const baselineArtifact = await createImageArtifact({
    label: "figma-screenshot",
    kind: "figma-screenshot",
    reportKind: "figma-screenshot",
    rgba: [255, 0, 0, 255],
    metadata: {
      sourceId: "src_figma_1",
      name: "Reservation list",
      route: "/reservations",
      viewportWidth: 2,
      viewportHeight: 2,
      isMobile: false,
    },
  });
  const actualArtifact = await createImageArtifact({
    label: "browser-screenshot",
    kind: "screenshot",
    reportKind: "browser-screenshot",
    rgba: [0, 0, 255, 255],
    metadata: {
      visualTargetId: "visual-1",
    },
  });
  const run = createInitialRun(
    { sources: [] },
    {
      id: "run_11111111111111111111111111111111",
      pluginVersion: "0.1.0",
      projectRoot,
      now: "2026-06-23T00:00:00.000Z",
    },
  );

  await store.create(
    RunManifestSchema.parse({
      ...run,
      artifacts: [baselineArtifact, actualArtifact],
    }),
  );
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("VisualRegressionService", () => {
  it("plans compares reports and records visual review results", async () => {
    const planned = await service.plan({
      runId: "run_11111111111111111111111111111111",
      changeName: "reservation-list",
    });

    expect(planned.targetCount).toBe(1);
    expect(planned.targets[0]).toMatchObject({
      id: "visual-1",
      route: "/reservations",
    });

    const compared = await service.compare({
      runId: "run_11111111111111111111111111111111",
      changeName: "reservation-list",
      targets: planned.targets,
      browserScreenshotArtifactIds: {
        "visual-1": "art_22222222222222222222222222222222",
      },
    });

    expect(compared.report.failedCount).toBe(1);
    expect(compared.diffArtifactIds).toHaveLength(1);
    expect(compared.overlayArtifactIds).toHaveLength(1);
    expect(compared.gapIds).toHaveLength(1);

    const loadedReport = await service.getReport({
      runId: "run_11111111111111111111111111111111",
    });

    expect(loadedReport.reportArtifactId).toBe(compared.reportArtifactId);
    expect(loadedReport.report.results[0]?.status).toBe("failed");

    const reviewed = await service.recordReviewResult({
      runId: "run_11111111111111111111111111111111",
      reportArtifactId: compared.reportArtifactId,
      result: {
        summary: "Primary content color diverges from Figma.",
        findings: [
          {
            targetId: "visual-1",
            severity: "major",
            category: "implementation-mismatch",
            description: "The browser screenshot is blue while Figma is red.",
            recommendedOwner: "design-ui",
            requiresHumanReview: true,
            artifactIds: compared.diffArtifactIds,
          },
        ],
      },
    });

    expect(reviewed.findingCount).toBe(1);
    expect(reviewed.humanReviewFindingCount).toBe(1);

    const loaded = await store.get("run_11111111111111111111111111111111");

    expect(
      loaded.artifacts.some((artifact) => artifact.metadata["reportKind"] === "visual-report-json"),
    ).toBe(true);
    expect(
      loaded.artifacts.some(
        (artifact) => artifact.metadata["reportKind"] === "visual-review-result",
      ),
    ).toBe(true);
    expect(loaded.gaps).toHaveLength(1);
  });
});

async function createImageArtifact(input: {
  label: string;
  kind: "figma-screenshot" | "screenshot";
  reportKind: string;
  rgba: [number, number, number, number];
  metadata: Record<string, unknown>;
}) {
  const blob = await artifactStore.writeBlob({
    content: solidPng(input.rgba),
    mediaType: "image/png",
    storedAt: "2026-06-23T00:00:00.000Z",
    label: input.label,
  });

  return ArtifactRefSchema.parse({
    id:
      input.kind === "figma-screenshot"
        ? createArtifactId()
        : "art_22222222222222222222222222222222",
    kind: input.kind,
    uri: blob.uri,
    mediaType: "image/png",
    digest: blob.digest,
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:00.000Z",
    metadata: {
      adapter: "visual-regression-test",
      reportKind: input.reportKind,
      ...input.metadata,
    },
  });
}

function solidPng(rgba: [number, number, number, number]): Buffer {
  const image = new PNG({ width: 2, height: 2 });

  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = rgba[0];
    image.data[index + 1] = rgba[1];
    image.data[index + 2] = rgba[2];
    image.data[index + 3] = rgba[3];
  }

  return PNG.sync.write(image);
}
