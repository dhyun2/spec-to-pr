import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { AccessibilityGateService } from "../../src/application/accessibility-gate-service.js";
import { RunService } from "../../src/application/run-service.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

let directory: string;
let projectRoot: string;
let store: SqliteRunStore;
let runService: RunService;
let accessibilityGateService: AccessibilityGateService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-a11y-"));
  projectRoot = path.join(directory, "project");

  await mkdir(projectRoot, {
    recursive: true,
  });

  store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
  runService = new RunService(store, {
    pluginVersion: "0.1.0",
    now: () => "2026-06-23T00:00:00.000Z",
  });
  accessibilityGateService = new AccessibilityGateService(
    store,
    new ArtifactBlobStore(path.join(directory, "artifacts")),
    () => "2026-06-23T00:00:01.000Z",
  );
});

afterEach(async () => {
  await store.close();
  await rm(directory, {
    recursive: true,
    force: true,
  });
});

describe("AccessibilityGateService", () => {
  it("records accessibility report and gaps", async () => {
    const run = await runService.createRun({
      projectRoot,
    });

    const result = await accessibilityGateService.run({
      runId: run.id,
      targets: [
        {
          id: "reservation-list",
          name: "Reservation list",
          url: "http://localhost:4173/reservations",
          viewport: {
            width: 390,
            height: 844,
          },
        },
      ],
      rawAxeResults: {
        "reservation-list": {
          violations: [
            {
              id: "button-name",
              impact: "serious",
              help: "Buttons must have discernible text",
              tags: ["wcag2a"],
              nodes: [
                {
                  target: ["button.icon-only"],
                  html: "<button></button>",
                  failureSummary: "Element has no accessible name",
                },
              ],
            },
          ],
        },
      },
    });

    expect(result.decision).toBe("failed");
    expect(result.gapsAdded).toBe(1);

    const report = await accessibilityGateService.getReport({
      runId: run.id,
      artifactId: result.artifactId,
    });

    expect(report.report.manualReviewItems).toHaveLength(1);

    const reviewed = await accessibilityGateService.recordReview({
      runId: run.id,
      reportArtifactId: result.artifactId,
      reviewer: "accessibility-reviewer",
      summary: "Button name needs design-ui follow-up.",
      falsePositiveNotes: [],
      manualReviewNotes: ["Screen reader flow still needs manual review."],
    });

    expect(reviewed.artifactId).toMatch(/^art_/);

    const loaded = await store.get(run.id);

    expect(loaded.gaps.some((gap) => gap.category === "accessibility")).toBe(true);
    expect(loaded.artifacts.some((artifact) => artifact.kind === "accessibility-report")).toBe(
      true,
    );
  });
});
