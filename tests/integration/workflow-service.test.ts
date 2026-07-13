import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { IntakeRequestService } from "../../src/application/intake-request-service.js";
import { ProjectProfileService } from "../../src/application/profile-service.js";
import { RunService } from "../../src/application/run-service.js";
import { StageService } from "../../src/application/stage-service.js";
import { WorkflowService } from "../../src/application/workflow-service.js";
import { JsonProfileStore } from "../../src/profile/profile-store.js";
import { SourceSnapshotStore } from "../../src/source-registry/snapshot-store.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

describe("WorkflowService", () => {
  let directory: string;
  let store: SqliteRunStore;
  let service: WorkflowService;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-workflow-"));
    store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
    const artifacts = new ArtifactBlobStore(path.join(directory, "artifacts"));

    service = new WorkflowService({
      runStore: store,
      artifactStore: artifacts,
      runService: new RunService(store, { pluginVersion: "0.2.0" }),
      intakeRequestService: new IntakeRequestService(
        store,
        new SourceSnapshotStore(path.join(directory, "sources")),
        artifacts,
      ),
      profileService: new ProjectProfileService(
        new JsonProfileStore(path.join(directory, "profiles")),
      ),
      stageService: new StageService(store),
    });
  });

  afterEach(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("starts compactly and stops at the contracts boundary", async () => {
    const status = await service.start({
      projectRoot: directory,
      requestText: "Refactor the parser and add unit tests",
      scope: "non-ui",
    });

    expect(status.stages).toHaveLength(8);
    expect(status.stages[0]).toEqual({ name: "intake", status: "passed" });
    expect(status.nextActions).toEqual([{ kind: "prepare-contracts", runId: status.runId }]);
    expect(status).not.toHaveProperty("sources");
    expect(status).not.toHaveProperty("evidence");
    expect(status).not.toHaveProperty("agentResults");
  });

  it("enforces contracts and API-ready before accepting UI implementation", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Implement the checkout screen from Figma with OpenAPI mocks",
      scope: "ui",
    });

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "implementation",
          status: "passed",
          summary: "UI implemented.",
          apiReady: true,
          uiChanged: true,
          changedFiles: ["src/checkout.tsx"],
          artifactPaths: ["test-results/unit.json"],
        },
      }),
    ).rejects.toThrow("contracts");

    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Generated API contracts and UI requirements.",
        artifactPaths: ["generated/api.ts", "generated/mock.ts"],
      },
    });

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "implementation",
          status: "passed",
          summary: "UI implemented without mock readiness.",
          apiReady: false,
          uiChanged: true,
          changedFiles: ["src/checkout.tsx"],
          artifactPaths: ["test-results/unit.json"],
        },
      }),
    ).rejects.toThrow("api-ready");
  });

  it("runs functional and design reviews independently after one implementation", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Implement the checkout screen from Figma with OpenAPI mocks",
      scope: "ui",
    });

    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Contracts and mocks generated.",
        artifactPaths: ["generated/mock.ts"],
      },
    });
    const implemented = await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "API-backed UI implemented.",
        apiReady: true,
        uiChanged: true,
        changedFiles: ["src/checkout.tsx"],
        artifactPaths: ["test-results/contract.json"],
      },
    });

    expect(implemented.nextActions.map((action) => action.kind).sort()).toEqual([
      "review-design",
      "review-functional",
    ]);

    await service.submit({
      runId: started.runId,
      submission: {
        kind: "design-review",
        verdict: "approved",
        summary: "Visual and interaction evidence passed.",
        findings: [],
        requirements: [{ id: "checkout-states", verdict: "accepted" }],
        artifactPaths: ["visual/diff.png"],
      },
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "functional-review",
        verdict: "approved",
        summary: "Contracts and tests passed.",
        findings: [],
        requirements: [{ id: "checkout-submit", verdict: "accepted" }],
        artifactPaths: ["test-results/unit.json"],
      },
    });

    const ready = await service.advance({ runId: started.runId, until: "publish-ready" });

    expect(ready.status).toBe("publish-ready");
    expect(ready.currentStage).toBe("publish");
    expect(ready.artifactIds.length).toBeGreaterThanOrEqual(4);
  });

  it("skips design review for non-UI scope", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Refactor the parser and add unit tests",
      scope: "non-ui",
    });

    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Requirements normalized.",
        artifactPaths: ["contracts/requirements.json"],
      },
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "Parser changed.",
        apiReady: true,
        uiChanged: false,
        changedFiles: ["src/parser.ts"],
        artifactPaths: ["test-results/unit.json"],
      },
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "functional-review",
        verdict: "approved",
        summary: "Functional evidence passed.",
        findings: [],
        requirements: [{ id: "parser", verdict: "accepted" }],
        artifactPaths: ["test-results/unit.json"],
      },
    });

    const ready = await service.advance({ runId: started.runId, until: "publish-ready" });

    expect(ready.stages.find((stage) => stage.name === "design-review")?.status).toBe("skipped");
    expect(ready.status).toBe("publish-ready");
  });
});
