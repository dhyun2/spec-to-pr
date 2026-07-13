import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactBlobStore } from "../../src/artifact-registry/artifact-blob-store.js";
import { IntakeRequestService } from "../../src/application/intake-request-service.js";
import type { OpenSpecArchiveService } from "../../src/application/openspec-archive-service.js";
import { ProjectProfileService } from "../../src/application/profile-service.js";
import type { PublisherService } from "../../src/application/publisher-service.js";
import { RunService } from "../../src/application/run-service.js";
import { StageService } from "../../src/application/stage-service.js";
import {
  WorkflowService,
  type WorkflowServiceDependencies,
} from "../../src/application/workflow-service.js";
import { JsonProfileStore } from "../../src/profile/profile-store.js";
import { SourceSnapshotStore } from "../../src/source-registry/snapshot-store.js";
import { SqliteRunStore } from "../../src/store/sqlite-run-store.js";

describe("WorkflowService", () => {
  let directory: string;
  let store: SqliteRunStore;
  let service: WorkflowService;
  let dependencies: WorkflowServiceDependencies;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "spec-to-pr-workflow-"));
    for (const relativePath of [
      "generated/api.ts",
      "generated/mock.ts",
      "test-results/unit.json",
      "test-results/contract.json",
      "visual/diff.png",
      "contracts/requirements.json",
    ]) {
      const absolutePath = path.join(directory, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, `${relativePath}\n`, "utf8");
    }
    store = new SqliteRunStore(path.join(directory, "runs.sqlite3"));
    const artifacts = new ArtifactBlobStore(path.join(directory, "artifacts"));

    dependencies = {
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
    };
    service = new WorkflowService(dependencies);
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
        gateResults: [
          {
            id: "accessibility",
            status: "passed",
            evidencePaths: ["visual/diff.png"],
          },
        ],
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
        gateResults: [
          {
            id: "functional",
            status: "passed",
            evidencePaths: ["test-results/unit.json"],
          },
        ],
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

    const contracted = await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Requirements normalized.",
        artifactPaths: ["contracts/requirements.json"],
      },
    });
    expect(contracted.nextActions).toEqual([
      { kind: "implement", runId: started.runId, requireApiReady: false },
    ]);
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "Parser changed.",
        apiReady: false,
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
        gateResults: [
          {
            id: "functional",
            status: "passed",
            evidencePaths: ["test-results/unit.json"],
          },
        ],
      },
    });

    const ready = await service.advance({ runId: started.runId, until: "publish-ready" });

    expect(ready.stages.find((stage) => stage.name === "design-review")?.status).toBe("skipped");
    expect(ready.status).toBe("publish-ready");
  });

  it("rejects missing or out-of-project evidence instead of trusting path claims", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Refactor the parser",
      scope: "non-ui",
    });

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "contracts",
          status: "passed",
          summary: "Claimed contracts.",
          artifactPaths: ["contracts/does-not-exist.json"],
        },
      }),
    ).rejects.toThrow(/evidence/i);

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "contracts",
          status: "passed",
          summary: "Claimed outside evidence.",
          artifactPaths: [path.join(directory, "..", "outside.json")],
        },
      }),
    ).rejects.toThrow(/project root/i);
  });

  it("rejects UI changes that contradict a non-UI intake scope", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Refactor the parser",
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

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "implementation",
          status: "passed",
          summary: "Unexpected UI changes.",
          apiReady: true,
          uiChanged: true,
          changedFiles: ["src/page.tsx"],
          artifactPaths: ["test-results/unit.json"],
        },
      }),
    ).rejects.toThrow(/UI changes.*scope/i);
  });

  it("does not accept approval without every required gate result", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Add observability and trace correlation to the API",
      scope: "non-ui",
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "contracts",
        status: "passed",
        summary: "Contracts ready.",
        artifactPaths: ["contracts/requirements.json"],
      },
    });
    await service.submit({
      runId: started.runId,
      submission: {
        kind: "implementation",
        status: "passed",
        summary: "Tracing implemented.",
        apiReady: true,
        uiChanged: false,
        changedFiles: ["src/tracing.ts"],
        artifactPaths: ["test-results/unit.json"],
      },
    });

    await expect(
      service.submit({
        runId: started.runId,
        submission: {
          kind: "functional-review",
          verdict: "approved",
          summary: "Only functional tests were supplied.",
          findings: [],
          requirements: [{ id: "tracing", verdict: "accepted" }],
          artifactPaths: ["test-results/unit.json"],
          gateResults: [
            {
              id: "functional",
              status: "passed",
              evidencePaths: ["test-results/unit.json"],
            },
          ],
        },
      }),
    ).rejects.toThrow(/observability/i);
  });

  it.each([
    {
      name: "failed publication",
      result: {
        status: "failed" as const,
        requestSynced: false,
        visualPreviewExpected: false,
        visualPreviewSynced: false,
        partialReasons: ["body sync failed"],
        errorCode: "PUBLISH_FAILED",
        errorMessage: "body sync failed",
        retryable: true,
      },
      expectedCode: "PUBLISH_FAILED",
      expectedRetryable: true,
      expectedWorkflowStatus: "publish-ready",
    },
    {
      name: "partially synchronized publication",
      result: {
        status: "passed" as const,
        requestSynced: true,
        visualPreviewExpected: true,
        visualPreviewSynced: false,
        partialReasons: ["visual preview sync failed"],
        retryable: false,
      },
      expectedCode: "PUBLISH_PARTIAL",
      expectedRetryable: true,
      expectedWorkflowStatus: "publish-ready",
    },
    {
      name: "blocked publication",
      result: {
        status: "blocked" as const,
        requestSynced: false,
        visualPreviewExpected: false,
        visualPreviewSynced: false,
        partialReasons: ["publisher credentials are unavailable"],
        errorCode: "PUBLISH_BLOCKED",
        errorMessage: "publisher credentials are unavailable",
        retryable: false,
      },
      expectedCode: "PUBLISH_BLOCKED",
      expectedRetryable: false,
      expectedWorkflowStatus: "blocked",
    },
  ])(
    "fails the publish stage for $name",
    async ({ result, expectedCode, expectedRetryable, expectedWorkflowStatus }) => {
      const runId = await preparePublishReadyWorkflow(service, directory);
      const reportArtifactId = (await store.get(runId)).artifacts.find(
        (artifact) => artifact.kind === "pr-report",
      )!.id;
      const publish = vi.fn().mockResolvedValue({
        result: {
          runId,
          fallbackMode: "none",
          publishedAssets: [],
          publishedAt: new Date().toISOString(),
          ...result,
        },
        publishResultArtifactId: reportArtifactId,
      });
      service = new WorkflowService({
        ...dependencies,
        publisherService: { publish } as unknown as PublisherService,
      });

      const response = (await service.publish(publishInput(runId))) as {
        status: { status: string };
      };
      const run = await store.get(runId);
      const publishStage = run.stages.find((item) => item.name === "publish")!;

      expect(response.status.status).toBe(expectedWorkflowStatus);
      expect(publishStage.status).toBe("failed");
      expect(publishStage.lease).toBeUndefined();
      expect(publishStage.error).toMatchObject({
        code: expectedCode,
        retryable: expectedRetryable,
      });
      expect(run.stages.find((item) => item.name === "archive")?.status).toBe("pending");
    },
  );

  it("completes publication only when every expected surface is synchronized", async () => {
    const runId = await preparePublishReadyWorkflow(service, directory);
    const reportArtifactId = (await store.get(runId)).artifacts.find(
      (artifact) => artifact.kind === "pr-report",
    )!.id;
    service = new WorkflowService({
      ...dependencies,
      publisherService: {
        publish: vi.fn().mockResolvedValue({
          result: {
            runId,
            status: "passed",
            requestSynced: true,
            visualPreviewExpected: true,
            visualPreviewSynced: true,
            fallbackMode: "none",
            partialReasons: [],
            publishedAssets: [],
            retryable: false,
            publishedAt: new Date().toISOString(),
          },
          publishResultArtifactId: reportArtifactId,
        }),
      } as unknown as PublisherService,
    });

    const response = (await service.publish(publishInput(runId))) as {
      status: { status: string };
    };
    const run = await store.get(runId);

    expect(response.status.status).toBe("completed");
    expect(run.stages.find((item) => item.name === "publish")?.status).toBe("passed");
    expect(run.stages.find((item) => item.name === "archive")?.status).toBe("skipped");
  });

  it("renews the publish lease while an external publisher is still running", async () => {
    const runId = await preparePublishReadyWorkflow(service, directory);
    const reportArtifactId = (await store.get(runId)).artifacts.find(
      (artifact) => artifact.kind === "pr-report",
    )!.id;
    service = new WorkflowService({
      ...dependencies,
      externalLeaseTtlMs: 200,
      externalHeartbeatMs: 40,
      publisherService: {
        publish: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 320));
          return {
            result: {
              runId,
              status: "passed",
              requestSynced: true,
              visualPreviewExpected: false,
              visualPreviewSynced: false,
              fallbackMode: "none",
              partialReasons: [],
              publishedAssets: [],
              retryable: false,
              publishedAt: new Date().toISOString(),
            },
            publishResultArtifactId: reportArtifactId,
          };
        }),
      } as unknown as PublisherService,
    });

    const response = (await service.publish(publishInput(runId))) as {
      status: { status: string };
    };

    expect(response.status.status).toBe("completed");
    const publishStage = (await store.get(runId)).stages.find((item) => item.name === "publish");
    expect(publishStage?.status).toBe("passed");
    expect(publishStage?.lease).toBeUndefined();
  });

  it("fails the publish stage when the publisher throws after the lease starts", async () => {
    const runId = await preparePublishReadyWorkflow(service, directory);
    service = new WorkflowService({
      ...dependencies,
      publisherService: {
        publish: vi.fn().mockRejectedValue(new Error("publisher transport crashed")),
      } as unknown as PublisherService,
    });

    await expect(service.publish(publishInput(runId))).rejects.toThrow(
      "publisher transport crashed",
    );

    const publishStage = (await store.get(runId)).stages.find((item) => item.name === "publish")!;
    expect(publishStage.status).toBe("failed");
    expect(publishStage.lease).toBeUndefined();
    expect(publishStage.error).toMatchObject({
      code: "PUBLISH_UNEXPECTED_ERROR",
      retryable: true,
    });
  });

  it("fails the archive stage when the archive service throws after the lease starts", async () => {
    const started = await service.start({
      projectRoot: directory,
      requestText: "Archive the merged OpenSpec change",
      scope: "docs",
    });
    service = new WorkflowService({
      ...dependencies,
      archiveService: {
        runArchive: vi.fn().mockRejectedValue(new Error("archive command crashed")),
      } as unknown as OpenSpecArchiveService,
    });

    await expect(
      service.archive({
        runId: started.runId,
        mode: "execute",
        changeName: "fast-workflow-v2",
        mergeEvidenceId: "art_0123456789abcdef0123456789abcdef",
        confirm: true,
      }),
    ).rejects.toThrow("archive command crashed");

    const archiveStage = (await store.get(started.runId)).stages.find(
      (item) => item.name === "archive",
    )!;
    expect(archiveStage.status).toBe("failed");
    expect(archiveStage.lease).toBeUndefined();
    expect(archiveStage.error).toMatchObject({
      code: "ARCHIVE_UNEXPECTED_ERROR",
      retryable: true,
    });
  });
});

async function preparePublishReadyWorkflow(
  service: WorkflowService,
  projectRoot: string,
): Promise<string> {
  const started = await service.start({
    projectRoot,
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
      gateResults: [
        {
          id: "functional",
          status: "passed",
          evidencePaths: ["test-results/unit.json"],
        },
      ],
    },
  });
  await service.advance({ runId: started.runId, until: "publish-ready" });

  return started.runId;
}

function publishInput(runId: string) {
  return {
    runId,
    mode: "execute" as const,
    sourceBranch: "codex/fast-workflow-v2",
    targetBranch: "main",
    remoteName: "origin",
    pushBranch: true,
    confirm: true,
  };
}
